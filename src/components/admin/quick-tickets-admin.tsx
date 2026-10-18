"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { Icons } from "@/components/shell/icons";
import { QuickIcon } from "@/components/quick-tickets/icon";
import { ARROWS, nearest } from "@/components/quick-tickets/spatial";
import { useSpotlight } from "@/components/quick-tickets/spotlight";
import { api, ApiClientError } from "@/lib/api";
import { QUICK_ICON_LABEL, QUICK_TICKET_LIMITS } from "@/lib/constants";
import { guessIcon, isQuickIcon } from "@/lib/quick-tickets";
import { ease, spring, stagger } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { QuickTicket, QuickTicketGroup } from "@/lib/database.types";
import type { GroupPopupStart } from "./quick-group-popup";
import { groupStats, plural, type Act, type QuickUsage, type RuleOption } from "./quick-tickets-shared";
import { useSavedOrder } from "./use-saved-order";

export type { QuickUsage } from "./quick-tickets-shared";

// Only ever drawn after a card is opened, so it stays out of the server
// render — which is bundled into the Cloudflare Worker, already close to its
// size limit. Both go through next/dynamic, which is what keeps them out: a
// bare import() here would pull the pop-up, and the editor with it, into the
// Worker even though nothing renders it there.
const QuickGroupPopup = dynamic(() => import("./quick-group-popup").then((m) => m.QuickGroupPopup), {
  ssr: false,
  loading: () => null,
});
/** Draws nothing; rendering it fetches the pop-up's code ahead of the first click. */
const PopupPreload = dynamic(() => import("./quick-group-popup").then((m) => m.Preload), {
  ssr: false,
  loading: () => null,
});

/** The address parameter naming the open group, so a refresh opens it again — as on Quick tickets. */
const GROUP_PARAM = "group";

/**
 * Names the open group in the address, or none. Replace, not push: opening a
 * card is not a page, and Back should leave the page rather than step
 * through every card opened.
 */
function writeAddress(groupId: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (groupId) params.set(GROUP_PARAM, groupId);
  else params.delete(GROUP_PARAM);
  const query = params.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
  );
}

/**
 * Quick ticket setup: the groups as cards, laid out the way requesters see
 * them on the Quick tickets page, and a card at the end for adding one.
 *
 * Opening a card grows it into a pop-up (<QuickGroupPopup>) where the group
 * and its quick tickets are managed: their order, live or hidden, and each
 * one's editor. Each card's menu has what is done to a group as a whole —
 * moving it earlier or later, hiding or showing it, its details, deleting it.
 *
 * Which group is open lives in the address. Arrow keys move between cards by
 * where they sit.
 */
export function QuickTicketsAdmin({
  groups,
  items,
  rules,
  usage,
  usageKnown,
  failed,
}: {
  groups: QuickTicketGroup[];
  items: QuickTicket[];
  rules: RuleOption[];
  usage: Record<string, QuickUsage>;
  usageKnown: boolean;
  failed: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const reduced = useReducedMotion() ?? false;
  const gridRef = useRef<HTMLDivElement>(null);
  useSpotlight(gridRef);

  const [busy, setBusy] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  /** Deleted from their pop-up: off the grid at once, before the refresh confirms it. */
  const [vanished, setVanished] = useState<ReadonlySet<string>>(() => new Set());
  /** What the pop-up opens on, for the group it was asked for — a card's menu can open it on its details. */
  const [start, setStart] = useState<{ id: string; view: GroupPopupStart } | null>(null);
  /** Cards a pop-up is standing in for — grown out of them, not yet landed back. */
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());

  const live = groups.filter((group) => !vanished.has(group.id));
  const byId = new Map(live.map((group) => [group.id, group]));
  const groupOrder = useSavedOrder(
    live.map((group) => group.id),
    live.map((group) => `${group.id}:${group.sort_order}`).join("|"),
    (ids) => api("/api/admin/quick-tickets/groups/order", { method: "PUT", json: { ids } }),
  );
  const orderedGroups = groupOrder.orderIds.map((id) => byId.get(id)).filter((group) => group !== undefined);

  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
  const itemsByGroup = new Map<string, QuickTicket[]>();
  for (const item of items) {
    const list = itemsByGroup.get(item.group_id) ?? [];
    list.push(item);
    itemsByGroup.set(item.group_id, list);
  }

  const act = useCallback<Act>(
    async (key, run, success) => {
      setBusy(key);
      try {
        await run();
        push({ tone: "success", title: success });
        router.refresh();
        return true;
      } catch (error) {
        push({
          tone: "error",
          title: "That didn't work",
          description: error instanceof ApiClientError ? error.message : "Please try again.",
        });
        // A 404 or a stale reference means the page is behind; catch it up.
        if (error instanceof ApiClientError && (error.status === 404 || error.status === 422)) {
          router.refresh();
        }
        return false;
      } finally {
        setBusy(null);
      }
    },
    [push, router],
  );

  // ---------------------------------------------------------- selection --

  // The address is the one record of which group is open — kept current with
  // replaceState, which Next folds into useSearchParams without a server
  // round trip. A group that is not on the page counts as none.
  const requested = useSearchParams().get(GROUP_PARAM);
  const selectedId = requested && byId.has(requested) ? requested : null;
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;

  const select = useCallback((groupId: string | null, view: GroupPopupStart = "list") => {
    setStart(groupId ? { id: groupId, view } : null);
    writeAddress(groupId);
  }, []);

  // A link to a group that has since been deleted, or one that went while it
  // was open: drop it from the address so it cannot spring open later. Not
  // when the list failed to load — then nothing can be said about it.
  useEffect(() => {
    if (!failed && requested && !selectedId) writeAddress(null);
  }, [failed, requested, selectedId]);

  const getCard = useCallback(
    (groupId: string) =>
      gridRef.current?.querySelector<HTMLElement>(`[data-card="${CSS.escape(groupId)}"]:not([data-leaving])`) ??
      null,
    [],
  );

  const onHide = useCallback((groupId: string, hide: boolean) => {
    setHidden((prev) => {
      if (prev.has(groupId) === hide) return prev;
      const next = new Set(prev);
      if (hide) next.add(groupId);
      else next.delete(groupId);
      return next;
    });
  }, []);

  /** Somewhere sensible for focus when what held it is leaving the page. */
  const focusFallback = useCallback(() => {
    gridRef.current?.querySelector<HTMLElement>("[data-nav-card]:not([data-leaving])")?.focus({
      preventScroll: true,
    });
  }, []);

  /** Close the open group, focus back on its card — which the pop-up is about to land on. */
  const close = useCallback(() => {
    if (!selectedId) return;
    getCard(selectedId)?.focus({ preventScroll: true });
    select(null);
  }, [selectedId, getCard, select]);

  /** Deleted from its pop-up: the card goes, and the pop-up fades rather than landing in it. */
  function onDeleted(groupId: string) {
    // Focus first, while the pop-up is still here to hand it over: the card
    // after it, or before it, or the card for adding one.
    const ids = orderedGroups.map((group) => group.id);
    const at = ids.indexOf(groupId);
    const neighbour = ids[at + 1] ?? ids[at - 1];
    const target =
      (neighbour ? getCard(neighbour) : null) ??
      gridRef.current?.querySelector<HTMLElement>("[data-add-card]") ??
      null;
    target?.focus({ preventScroll: true });
    setVanished((prev) => new Set(prev).add(groupId));
    select(null);
    router.refresh();
  }

  // The pop-up's code, fetched once the page is idle rather than on the first
  // click, so the first card opened grows straight away like every other.
  const [preload, setPreload] = useState(false);
  useEffect(() => {
    const begin = () => setPreload(true);
    if ("requestIdleCallback" in window) {
      const handle = window.requestIdleCallback(begin, { timeout: 2500 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = setTimeout(begin, 1200);
    return () => clearTimeout(timer);
  }, []);

  function onCardKey(event: React.KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing) return;
    const modified = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
    const cards = Array.from(
      gridRef.current?.querySelectorAll<HTMLElement>("[data-nav-card]:not([data-leaving])") ?? [],
    );
    const dir = ARROWS[event.key];
    if (dir && !modified) {
      // Handled even at an edge, so an arrow key never scrolls the page instead.
      event.preventDefault();
      nearest(event.currentTarget, cards, dir)?.focus();
    } else if ((event.key === "Home" || event.key === "End") && !modified) {
      event.preventDefault();
      cards[event.key === "Home" ? 0 : cards.length - 1]?.focus();
    }
  }

  if (failed) {
    return (
      <div className="card flex flex-col items-center gap-3 px-4 py-10 text-center">
        <Icons.alert className="size-5 text-ink-faint" />
        <div>
          <p className="text-[0.875rem] font-medium text-ink">Couldn&apos;t load the quick tickets</p>
          <p className="mt-1 text-[0.8125rem] text-ink-muted">
            Nothing has changed. Check your connection, then try again.
          </p>
        </div>
        <Button size="sm" variant="secondary" icon={<Icons.refresh className="size-3.5" />} onClick={() => router.refresh()}>
          Try again
        </Button>
      </div>
    );
  }

  const totals = orderedGroups.reduce(
    (sum, group) => {
      const groupItems = itemsByGroup.get(group.id) ?? [];
      sum.items += groupItems.length;
      sum.shown += groupStats(group, groupItems, ruleById, usage).reachable;
      return sum;
    },
    { items: 0, shown: 0 },
  );
  const selectedIndex = selected ? orderedGroups.indexOf(selected) : -1;

  return (
    <div className="space-y-7">
      <About />

      <section aria-labelledby="quick-setup-groups" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="quick-setup-groups" className="eyebrow">
            Groups
          </h2>
          {orderedGroups.length > 0 && (
            <p className="text-xs text-ink-faint">
              {plural(orderedGroups.length, "group")} · {plural(totals.items, "quick ticket")} ·{" "}
              {totals.shown} shown to requesters
            </p>
          )}
        </div>

        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>

        {/* Sized by the room the grid actually gets, not the window: the
            sidebar takes a different share at every breakpoint. */}
        <div className="@container">
          <div
            ref={gridRef}
            role="group"
            aria-label="Quick ticket groups"
            className="relative grid grid-cols-1 gap-3 @xs:grid-cols-2 @2xl:grid-cols-3 @5xl:grid-cols-4"
          >
            <AnimatePresence>
              {orderedGroups.map((group, index) => (
                <GroupCard
                  key={group.id}
                  group={group}
                  items={itemsByGroup.get(group.id) ?? []}
                  ruleById={ruleById}
                  usage={usage}
                  usageKnown={usageKnown}
                  index={index}
                  position={index + 1}
                  total={orderedGroups.length}
                  selected={group.id === selectedId}
                  popped={hidden.has(group.id)}
                  busy={busy}
                  reduced={reduced}
                  onOpen={(view) => select(group.id, view)}
                  onMove={(delta) => {
                    const ids = groupOrder.move(group.id, delta);
                    if (ids) {
                      setAnnouncement(`${group.name} moved to position ${ids.indexOf(group.id) + 1} of ${ids.length}.`);
                    }
                  }}
                  onToggle={(value) =>
                    void act(
                      `toggle-group-${group.id}`,
                      () =>
                        api(`/api/admin/quick-tickets/groups/${group.id}`, {
                          method: "PATCH",
                          json: { is_active: value },
                        }),
                      value ? "Group is live" : "Group hidden from requesters",
                    )
                  }
                  onKeyDown={onCardKey}
                  onFocusAway={focusFallback}
                />
              ))}
            </AnimatePresence>
            <NewGroupCard
              first={orderedGroups.length === 0}
              act={act}
              busy={busy === "create-group"}
              onKeyDown={onCardKey}
            />
          </div>
        </div>
      </section>

      {preload && <PopupPreload />}
      <AnimatePresence>
        {selected && (
          <QuickGroupPopup
            key={selected.id}
            group={selected}
            items={itemsByGroup.get(selected.id) ?? []}
            allItems={items}
            groups={orderedGroups}
            rules={rules}
            usage={usage}
            usageKnown={usageKnown}
            position={selectedIndex + 1}
            total={orderedGroups.length}
            busy={busy}
            act={act}
            start={start?.id === selected.id ? start.view : "list"}
            getCard={getCard}
            onHide={onHide}
            onClose={close}
            onDeleted={() => onDeleted(selected.id)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** What quick tickets are, for whoever is setting them up. */
function About() {
  return (
    <div className="card flex gap-3.5 p-4">
      <span
        aria-hidden
        className="hidden size-9 flex-none items-center justify-center rounded-[10px] border border-line bg-surface-sunk text-ink-muted sm:flex"
      >
        <Icons.bolt className="size-4" />
      </span>
      <div className="max-w-3xl space-y-2 text-[0.8125rem] leading-relaxed text-ink-muted">
        <p>
          Requesters see live groups on the{" "}
          <Link href="/quick-tickets" className="text-accent underline-offset-4 hover:underline">
            Quick tickets
          </Link>{" "}
          page in the sidebar and in{" "}
          <kbd className="readout rounded border border-line bg-surface-sunk px-1 text-[0.6875rem]">⌘K</kbd>.
          Picking one shows them exactly what IT will receive — the title, details, category and
          urgency you write here — and they send it after a check. Nothing is sent on a single tap.
        </p>
        <p>
          Give a quick ticket a question, like &ldquo;Which printer?&rdquo;, and the answer lands in
          the ticket&apos;s title so IT can tell the reports apart. Tickets route by their category,
          the same as any other — see{" "}
          <Link href="/admin/routing" className="text-accent underline-offset-4 hover:underline">
            Routing
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- card --

function GroupCard({
  group,
  items,
  ruleById,
  usage,
  usageKnown,
  index,
  position,
  total,
  selected,
  popped,
  busy,
  reduced,
  onOpen,
  onMove,
  onToggle,
  onKeyDown,
  onFocusAway,
}: {
  group: QuickTicketGroup;
  items: QuickTicket[];
  ruleById: Map<string, RuleOption>;
  usage: Record<string, QuickUsage>;
  usageKnown: boolean;
  index: number;
  position: number;
  total: number;
  /** Its pop-up is open, or opening. */
  selected: boolean;
  /** Its pop-up has grown out of it and stands in its place: the card itself is not drawn. */
  popped: boolean;
  busy: string | null;
  reduced: boolean;
  onOpen: (view: GroupPopupStart) => void;
  onMove: (delta: -1 | 1) => void;
  onToggle: (live: boolean) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onFocusAway: () => void;
}) {
  const present = useIsPresent();
  const id = useId();
  const ref = useRef<HTMLButtonElement>(null);

  // Deleted elsewhere and dropped by a refresh while it had focus.
  useLayoutEffect(() => {
    if (!present && ref.current === document.activeElement) onFocusAway();
  }, [present, onFocusAway]);

  const icon = isQuickIcon(group.icon) ? group.icon : "bolt";
  const { reachable, raised } = groupStats(group, items, ruleById, usage);
  const count = items.length;
  // With no description, the quick tickets in it say what it is for — as on the requester's card.
  const summary = group.description ?? (count > 0 ? items.map((item) => item.label).join(" · ") : null);
  const toggling = busy === `toggle-group-${group.id}`;
  const status: { tone: "emerald" | "slate" | "amber"; label: string } = !group.is_active
    ? { tone: "slate", label: "Hidden" }
    : reachable === 0
      ? { tone: "amber", label: "Not shown" }
      : { tone: "emerald", label: "Live" };
  const delay = reduced ? 0 : stagger(index, 0.035, 10);

  const menu: MenuItem[] = [
    { label: "Edit name and icon", onSelect: () => onOpen("details") },
    { separator: true },
    {
      label: "Move earlier",
      disabled: position === 1,
      hint: `Now ${position} of ${total}`,
      onSelect: () => onMove(-1),
    },
    {
      label: "Move later",
      disabled: position === total,
      hint: `Now ${position} of ${total}`,
      onSelect: () => onMove(1),
    },
    { separator: true },
    {
      label: group.is_active ? "Hide from requesters" : "Show to requesters",
      disabled: toggling,
      onSelect: () => onToggle(!group.is_active),
    },
    { separator: true },
    {
      label: "Delete group…",
      danger: true,
      disabled: raised > 0 || !usageKnown,
      hint:
        raised > 0
          ? `${plural(raised, "ticket")} ${raised === 1 ? "was" : "were"} raised from it — hide it instead.`
          : !usageKnown
            ? "Usage couldn't be loaded, so deleting is off for now."
            : count > 0
              ? `Deletes it and its ${plural(count, "quick ticket")}.`
              : "Nothing in it has been used.",
      onSelect: () => onOpen("delete"),
    },
  ];

  return (
    <motion.div
      layout="position"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.16, ease: ease.exit } }}
      transition={{ opacity: { duration: 0.24, delay }, y: { ...spring.gentle, delay }, layout: spring.gentle }}
      className={cn("min-w-0", !present && "pointer-events-none")}
    >
      {/* Not drawn while its pop-up stands in for it, but still laid out — the
          pop-up lands back on it — and still focusable, so focus can wait here. */}
      <div className="relative h-full" style={popped ? { opacity: 0, pointerEvents: "none" } : undefined}>
        <button
          ref={ref}
          type="button"
          data-card={group.id}
          data-nav-card=""
          data-leaving={present ? undefined : ""}
          aria-haspopup="dialog"
          aria-expanded={selected}
          aria-label={
            `${group.name}, group ${position} of ${total}, ` +
            (group.is_active ? "" : "hidden, ") +
            `${reachable} of ${plural(count, "quick ticket")} shown to requesters` +
            (usageKnown && raised > 0 ? `, ${raised} raised` : "")
          }
          aria-describedby={summary ? `${id}-summary` : undefined}
          onClick={() => onOpen("list")}
          onKeyDown={onKeyDown}
          // Leaving, it passes on focus it is handed — its pop-up, closing
          // because the group went, gives focus back to the card it came from.
          onFocus={present ? undefined : onFocusAway}
          className={cn(
            // `quick-tile` takes the pointer light; `glyph-host` plays the icon.
            "quick-tile glyph-host group/card relative flex h-full min-h-[10.5rem] w-full scroll-mt-24 flex-col rounded-[14px] border p-3.5 text-left sm:p-4",
            "transition-[translate,scale,box-shadow,border-color] duration-200 ease-[var(--ease-standard)]",
            "bg-surface active:scale-[0.985]",
            selected
              ? "border-accent-line shadow-[var(--glow)]"
              : "border-line shadow-[var(--shadow-sm)] hover:border-line-strong hover:shadow-[var(--shadow-md)] motion-safe:hover:-translate-y-0.5",
          )}
        >
          <span aria-hidden className="spot-wash" />
          <span aria-hidden className="spot-ring" />
          {/* A wash of the accent from the icon's corner, while the card is open. */}
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-300",
              "bg-[radial-gradient(120%_90%_at_0%_0%,var(--accent-soft),transparent_65%)]",
              selected ? "opacity-100" : "opacity-0",
            )}
          />

          {/* The right of this row is where the card's menu sits, over the card. */}
          <span aria-hidden className="relative flex items-start gap-3 pr-10">
            {/* What the pop-up's header icon flies up from, and lands back on. */}
            <span
              data-card-icon=""
              className={cn(
                "flex size-10 flex-none items-center justify-center rounded-[11px] border",
                "transition-[background-color,border-color,color,scale] duration-300 ease-[var(--ease-entrance)]",
                selected
                  ? "border-transparent bg-accent text-[var(--accent-ink)] shadow-[var(--shadow-sm)]"
                  : cn(
                      "bg-surface-sunk text-ink-muted group-hover/card:border-accent-line group-hover/card:text-accent motion-safe:group-hover/card:scale-105",
                      group.is_active ? "border-line" : "border-dashed border-line-strong",
                    ),
              )}
            >
              <QuickIcon name={icon} className="size-[1.15rem]" />
            </span>
            <span className="readout ml-auto pt-1.5 text-[0.6875rem] text-ink-faint">
              {String(position).padStart(2, "0")}
            </span>
          </span>

          <span className="relative mt-3 block min-w-0">
            <span
              className={cn(
                "line-clamp-2 break-words text-[0.875rem] font-semibold leading-snug tracking-tight",
                group.is_active ? "text-ink" : "text-ink-muted",
              )}
            >
              {group.name}
            </span>
            <span
              id={`${id}-summary`}
              className={cn(
                "mt-1 line-clamp-2 break-words text-xs leading-relaxed",
                summary ? "text-ink-faint" : "italic text-ink-faint/80",
              )}
            >
              {summary ?? "Empty — open it to add the first quick ticket."}
            </span>
          </span>

          <span
            aria-hidden
            className="relative mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-3 text-[0.6875rem] text-ink-muted"
          >
            <span data-tone={status.tone} className="inline-flex items-center gap-1.5 font-medium text-[var(--tone-fg)]">
              <span className="tone-dot" />
              {status.label}
            </span>
            <span>
              {count === 0 ? (
                "No quick tickets"
              ) : (
                <>
                  <span className="readout font-medium text-ink">{reachable}</span> of {plural(count, "quick ticket")} shown
                </>
              )}
            </span>
            {usageKnown && raised > 0 && (
              <span className="tabular text-ink-faint">{raised} raised</span>
            )}
            {toggling && (
              <span className="inline-flex items-center gap-1 text-ink-faint">
                <Spinner className="size-3" />
                Saving
              </span>
            )}
          </span>
        </button>

        <div className="absolute right-2.5 top-2.5 sm:right-3 sm:top-3">
          <Menu items={menu} label={`Actions for ${group.name}`}>
            <Icons.more className="size-4" />
          </Menu>
        </div>
      </div>
    </motion.div>
  );
}

// ----------------------------------------------------------------- adding --

/**
 * The last card: adding a group. It opens into a name field; the icon is
 * guessed from the name and can be changed once it is added. It stays open
 * after adding, for the next one.
 */
function NewGroupCard({
  first,
  act,
  busy,
  onKeyDown,
}: {
  /** There are no groups yet: this is the whole page. */
  first: boolean;
  act: Act;
  busy: boolean;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const openRef = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);
  const id = useId();

  // Put away from the keyboard, focus goes back to what opened it.
  useEffect(() => {
    if (open || !restore.current) return;
    restore.current = false;
    openRef.current?.focus();
  }, [open]);

  const guessed = guessIcon(name);
  const shut = () => {
    restore.current = true;
    setOpen(false);
  };

  return (
    <motion.div layout="position" transition={{ layout: spring.gentle }} className="min-w-0">
      {/* Swapped at once, no exit: focus moves between the two, and has to have somewhere to land. */}
      {open ? (
        <motion.form
          key="form"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.18, ease: ease.entrance }}
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (!trimmed || busy) return;
            void act(
              "create-group",
              async () => {
                await api("/api/admin/quick-tickets/groups", { method: "POST", json: { name: trimmed } });
                setName("");
              },
              "Group added at the end",
            );
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.nativeEvent.isComposing) {
              event.stopPropagation();
              shut();
            }
          }}
          aria-labelledby={`${id}-title`}
          className="flex h-full min-h-[10.5rem] flex-col rounded-[14px] border border-accent-line bg-surface p-3.5 shadow-[var(--glow)] sm:p-4"
        >
          <div className="flex items-center gap-3">
            <span
              title={`Icon: ${QUICK_ICON_LABEL[guessed]} — change it after adding`}
              className="glyph-host flex size-10 flex-none items-center justify-center rounded-[11px] border border-line bg-surface-sunk text-ink-muted"
            >
              <QuickIcon name={guessed} className="size-[1.15rem]" />
            </span>
            <p id={`${id}-title`} className="text-[0.875rem] font-semibold tracking-tight text-ink">
              New group
            </p>
          </div>
          <Input
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            maxLength={QUICK_TICKET_LIMITS.groupNameMax}
            placeholder="e.g. Printer, Shared drive, Email"
            aria-label="New group name"
            aria-describedby={`${id}-hint`}
            className="mt-3"
          />
          <p id={`${id}-hint`} className="mt-1.5 text-[0.6875rem] leading-relaxed text-ink-faint">
            Added at the end. Its icon is guessed from the name — change it after.
          </p>
          <div className="mt-auto flex justify-end gap-2 pt-3">
            <Button type="button" size="sm" variant="ghost" onClick={shut}>
              {first ? "Cancel" : "Done"}
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="primary"
              icon={<Icons.plus className="size-3.5" />}
              loading={busy}
              disabled={!name.trim()}
            >
              Add group
            </Button>
          </div>
        </motion.form>
      ) : (
        <motion.button
          key="button"
          ref={openRef}
          type="button"
          data-add-card=""
          data-nav-card=""
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18, ease: ease.standard }}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn(
            "group/add flex h-full min-h-[10.5rem] w-full flex-col items-center justify-center gap-2.5 rounded-[14px] border border-dashed p-4 text-center",
            "border-line-strong text-ink-muted transition-[border-color,background-color,color] duration-200",
            "hover:border-accent-line hover:bg-accent-soft/40 hover:text-ink",
          )}
        >
          <span className="flex size-10 items-center justify-center rounded-full border border-line bg-surface text-ink-faint transition-colors duration-200 group-hover/add:border-accent-line group-hover/add:text-accent">
            <Icons.plus className="size-4" />
          </span>
          <span>
            <span className="block text-[0.875rem] font-semibold tracking-tight text-ink">
              {first ? "Add the first group" : "New group"}
            </span>
            <span className="mt-0.5 block text-xs text-ink-faint">
              {first
                ? "Printer, say — then the problems people report about it most."
                : "Printer, Shared drive, Email…"}
            </span>
          </span>
        </motion.button>
      )}
    </motion.div>
  );
}
