import { PRIORITY_META } from "@/lib/constants";
import type { Json, TicketEvent, TicketPriority } from "@/lib/database.types";

/**
 * What a live update says, worked out from the ticket's own audit trail.
 *
 * One action on a ticket can write several events in the same transaction —
 * assigning a new ticket records both the assignment and the status moving to
 * Assigned — so events arrive in small bursts and are described a burst at a
 * time. Each burst becomes one notice about the thing that matters most to the
 * person who raised the ticket, not one notice per row.
 */

export type NoticeEvent = Pick<
  TicketEvent,
  "id" | "ticket_id" | "actor_id" | "event_type" | "from_value" | "to_value" | "metadata"
>;

export type NoticeTicket = { id: string; ticket_number: string; subject: string };

export type Notice = {
  title: string;
  description: string;
  tone: "success" | "info";
  href: string;
};

/**
 * Event types worth interrupting the requester for. `created` is always their
 * own doing, and `escalated` / `sla_breached` are the desk's internal alarms —
 * telling a requester their ticket breached a target helps nobody.
 */
const NOTICEABLE = new Set([
  "status_changed",
  "assigned",
  "unassigned",
  "priority_changed",
  "commented",
]);

/** A comment's event says whether the comment was an internal note. Only an
 *  explicit `false` counts as public: a requester can read these events (the
 *  row-level policy does not filter them), so anything ambiguous stays quiet
 *  rather than announcing a note they cannot open. */
function isPublicComment(metadata: Json) {
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    !Array.isArray(metadata) &&
    metadata.is_internal === false
  );
}

export function isNoticeable(event: NoticeEvent, viewerId: string) {
  if (!NOTICEABLE.has(event.event_type)) return false;
  // Your own actions are already on your screen.
  if (event.actor_id === viewerId) return false;
  if (event.event_type === "commented" && !isPublicComment(event.metadata)) return false;
  return true;
}

/** Ids whose names a burst's description needs. */
export function namesNeeded(events: NoticeEvent[]) {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.actor_id) ids.add(event.actor_id);
    if (event.event_type === "assigned" && event.to_value) ids.add(event.to_value);
  }
  return [...ids];
}

export function describeNotice(
  events: NoticeEvent[],
  ticket: NoticeTicket,
  names: Map<string, string>,
): Notice | null {
  const href = `/tickets/${ticket.id}`;
  const about = `${ticket.ticket_number} · ${ticket.subject}`;
  // No actor means the database did it on IT's behalf — auto-assignment runs
  // with the service role, for one.
  const who = (id: string | null) => (id ? names.get(id) : undefined) ?? "IT";
  const statusTo = (status: string) =>
    events.find((e) => e.event_type === "status_changed" && e.to_value === status);
  const first = (type: string) => events.find((e) => e.event_type === type);

  // Most important first: a fix to confirm, then a question to answer, then
  // anything someone said, then movement.
  const resolved = statusTo("resolved");
  if (resolved) {
    return {
      tone: "success",
      title: `${ticket.ticket_number} is resolved`,
      description: `${who(resolved.actor_id)} marked it fixed. Check it works, then confirm or reopen it.`,
      href,
    };
  }

  const waiting = statusTo("waiting_on_user");
  if (waiting) {
    return { tone: "info", title: `${who(waiting.actor_id)} needs your reply`, description: about, href };
  }

  const reply = first("commented");
  if (reply) {
    return { tone: "info", title: `${who(reply.actor_id)} replied`, description: about, href };
  }

  const assigned = first("assigned");
  if (assigned) {
    const assignee = (assigned.to_value && names.get(assigned.to_value)) || "An IT agent";
    return {
      tone: "info",
      title:
        assigned.actor_id && assigned.actor_id === assigned.to_value
          ? `${assignee} picked up your ticket`
          : `${assignee} is now on your ticket`,
      description: about,
      href,
    };
  }

  const working = statusTo("in_progress");
  if (working) {
    const again = working.from_value === "resolved" || working.from_value === "closed";
    return {
      tone: "info",
      title: again
        ? `${who(working.actor_id)} reopened work on it`
        : `${who(working.actor_id)} started work`,
      description: about,
      href,
    };
  }

  const closed = statusTo("closed");
  if (closed) {
    return { tone: "info", title: `${ticket.ticket_number} was closed`, description: ticket.subject, href };
  }

  const reopened = statusTo("reopened");
  if (reopened) {
    return { tone: "info", title: `${ticket.ticket_number} was reopened`, description: ticket.subject, href };
  }

  const priority = first("priority_changed");
  if (priority) {
    const to = PRIORITY_META[priority.to_value as TicketPriority];
    const from = PRIORITY_META[priority.from_value as TicketPriority];
    if (to) {
      const raised = from ? to.rank < from.rank : false;
      return {
        tone: "info",
        title: `Priority ${raised ? "raised" : "changed"} to ${to.label}`,
        description: about,
        href,
      };
    }
  }

  if (first("unassigned")) {
    return {
      tone: "info",
      title: "Back in the queue",
      description: `${about} — waiting for someone to pick it up`,
      href,
    };
  }

  // A status moving to New or Assigned on its own only restates an
  // (un)assignment, which is described above when it is in the burst.
  return null;
}
