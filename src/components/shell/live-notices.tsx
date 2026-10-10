"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import {
  describeNotice,
  isNoticeable,
  namesNeeded,
  type Notice,
  type NoticeEvent,
  type NoticeTicket,
} from "@/lib/notices";

/** Long enough for every event one action writes to arrive and be told as one. */
const BURST_MS = 700;
/** Live updates are worth acting on, so they stay up a little longer than a
 *  confirmation does. */
const NOTICE_MS = 8000;
/** On returning to the tab, replay this many of what was missed; beyond that a
 *  single line says how many more there were. */
const REPLAY_LIMIT = 3;
/** Event ids remembered for de-duplication before the set starts over. */
const SEEN_LIMIT = 500;

type Pending = { notice: Notice; ticketId: string };

/**
 * "(2) Overview · Aavis IT Desk" while `count` updates are waiting. Next
 * rewrites the title on every navigation, so the prefix is re-applied whenever
 * <head> changes rather than set once — and taken off exactly as it was put on.
 */
export function useTabBadge(count: number) {
  const pathname = usePathname();

  useEffect(() => {
    if (count <= 0) return;
    const mark = `(${count > 9 ? "9+" : count}) `;
    const apply = () => {
      if (!document.title.startsWith(mark)) document.title = mark + document.title;
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (document.title.startsWith(mark)) document.title = document.title.slice(mark.length);
    };
  }, [count, pathname]);
}

/**
 * Tells people when someone else moves a ticket they raised — a toast while
 * they are looking, and a count in the tab title while they are not.
 *
 * Scoped to tickets the viewer raised, for every role: an agent can read the
 * whole desk, and a toast for every change in the queue would be noise, not a
 * notice. The page itself already refreshes live (<RealtimeRefresh>); this only
 * adds the "you might want to look" layer on top.
 */
export function LiveNotices({ viewerId }: { viewerId: string }) {
  const { push } = useToast();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const missed = useRef<Pending[]>([]);
  const [unseen, setUnseen] = useState(0);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const show = useCallback(
    (notice: Notice) =>
      push({
        tone: notice.tone,
        title: notice.title,
        description: notice.description,
        action: { label: "Open ticket", href: notice.href },
        duration: NOTICE_MS,
      }),
    [push],
  );

  const deliver = useCallback(
    (notice: Notice, ticketId: string) => {
      const hidden = document.visibilityState === "hidden";
      if (hidden || !document.hasFocus()) setUnseen((count) => count + 1);

      // A toast in a background tab times out before anyone sees it, so it
      // waits for them to come back instead.
      if (hidden) {
        missed.current.push({ notice, ticketId });
        return;
      }
      // Already on that ticket: the timeline is updating in front of them.
      if (pathnameRef.current === `/tickets/${ticketId}`) return;
      show(notice);
    },
    [show],
  );

  // Coming back to the tab clears the count and replays what was missed.
  useEffect(() => {
    function onReturn() {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      setUnseen(0);

      const queued = missed.current.splice(0);
      if (queued.length === 0) return;

      // Several updates to one ticket while away read best as the latest.
      const latest = new Map<string, Pending>();
      for (const item of queued) {
        latest.delete(item.ticketId);
        latest.set(item.ticketId, item);
      }
      const relevant = [...latest.values()].filter(
        (item) => pathnameRef.current !== `/tickets/${item.ticketId}`,
      );
      const replay = relevant.slice(-REPLAY_LIMIT);
      const extra = relevant.length - replay.length;

      replay.forEach((item) => show(item.notice));
      if (extra > 0) {
        push({
          tone: "info",
          title: `${extra} more ${extra === 1 ? "ticket was" : "tickets were"} updated while you were away`,
          action: { label: "Open My tickets", href: "/tickets" },
          duration: NOTICE_MS,
        });
      }
    }

    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [push, show]);

  useTabBadge(unseen);

  useEffect(() => {
    const supabase = createClient();
    // Null records a ticket this viewer cannot read; agents see every ticket,
    // so for them the lookup is what says whether it is theirs.
    const tickets = new Map<string, (NoticeTicket & { created_by: string }) | null>();
    const names = new Map<string, string>();
    const seen = new Set<string>();
    const bursts = new Map<string, { events: NoticeEvent[]; timer: ReturnType<typeof setTimeout> }>();
    let disposed = false;

    async function ticketFor(id: string) {
      if (tickets.has(id)) return tickets.get(id) ?? null;
      const { data, error } = await supabase
        .from("tickets")
        .select("id, ticket_number, subject, created_by")
        .eq("id", id)
        .maybeSingle();
      // A failed lookup is not cached, so the next update gets another try.
      if (error) return null;
      tickets.set(id, data);
      return data;
    }

    async function loadNames(ids: string[]) {
      const missing = ids.filter((id) => !names.has(id));
      if (missing.length === 0) return;
      const { data } = await supabase.from("profiles").select("id, full_name").in("id", missing);
      for (const person of data ?? []) names.set(person.id, person.full_name);
    }

    async function flush(ticketId: string) {
      const burst = bursts.get(ticketId);
      bursts.delete(ticketId);
      if (!burst) return;

      const ticket = await ticketFor(ticketId);
      if (disposed || !ticket || ticket.created_by !== viewerId) return;

      await loadNames(namesNeeded(burst.events));
      if (disposed) return;

      const notice = describeNotice(burst.events, ticket, names);
      if (notice) deliver(notice, ticketId);
    }

    const channel = supabase
      .channel(`aavis-notices:${viewerId}`)
      .on<NoticeEvent>(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ticket_events" },
        (payload) => {
          const event = payload.new;
          // A reconnect can redeliver; an event is told once.
          if (!event?.id || seen.has(event.id)) return;
          if (seen.size >= SEEN_LIMIT) seen.clear();
          seen.add(event.id);
          if (!isNoticeable(event, viewerId)) return;

          const burst = bursts.get(event.ticket_id);
          if (burst) {
            burst.events.push(event);
            return;
          }
          bursts.set(event.ticket_id, {
            events: [event],
            timer: setTimeout(() => void flush(event.ticket_id), BURST_MS),
          });
        },
      )
      .subscribe();

    return () => {
      disposed = true;
      bursts.forEach((burst) => clearTimeout(burst.timer));
      bursts.clear();
      supabase.removeChannel(channel);
    };
  }, [viewerId, deliver]);

  return null;
}
