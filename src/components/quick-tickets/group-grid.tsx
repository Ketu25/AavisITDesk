"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { Spinner } from "@/components/ui/spinner";
import { Icons } from "@/components/shell/icons";
import { ease, spring, stagger } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { QuickGroup } from "@/lib/quick-tickets";
import { useQuickTicket, type OpenTicket } from "./context";
import { QuickIcon } from "./icon";
import { ARROWS, nearest } from "./spatial";
import { useSpotlight } from "./spotlight";

// Only ever drawn after a card is opened, so it stays out of the server
// render — which is bundled into the Cloudflare Worker, already close to its
// size limit. Both go through next/dynamic, which is what keeps them out: a
// bare import() here would pull the pop-up, and the confirm step with it, into
// the Worker even though nothing renders it there.
const GroupPopup = dynamic(() => import("./group-popup").then((m) => m.GroupPopup), {
  ssr: false,
  loading: () => null,
});
/** Draws nothing; rendering it fetches the pop-up's code ahead of the first click. */
const PopupPreload = dynamic(() => import("./group-popup").then((m) => m.Preload), {
  ssr: false,
  loading: () => null,
});

/**
 * The quick-ticket groups as cards, each the same size however many quick
 * tickets it holds. Opening one grows it into a pop-up over the page
 * (<GroupPopup>) that lists them; closing shrinks it back into the card.
 *
 * Which group is open is owned by the board — it lives in the address, so a
 * refresh, Back or a link opens it again.
 *
 * Alive without being busy: a light follows the pointer across the cards'
 * edges, each card's icon acts out its problem when hovered or focused, and a
 * card lifts under the pointer. Arrow keys move between cards by where they
 * sit; typing a letter goes to the filter box.
 */
export function GroupGrid({
  groups,
  openByIssue,
  selectedId,
  labelLocation,
  onSelect,
  onTypeAhead,
}: {
  groups: QuickGroup[];
  openByIssue: Record<string, OpenTicket>;
  /** One of `groups`, or null. */
  selectedId: string | null;
  /** Where the QR label that opened the selected group is stuck, when one did and it says. */
  labelLocation: string | null;
  onSelect: (groupId: string | null) => void;
  /** A printable key pressed on a card: hand it to the filter box, if there is one. */
  onTypeAhead?: () => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const { pendingId, clearSubmission } = useQuickTicket();
  const gridRef = useRef<HTMLDivElement>(null);
  useSpotlight(gridRef);

  /** Cards a pop-up is standing in for — grown out of them, not yet landed back. */
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const onHide = useCallback((groupId: string, hide: boolean) => {
    setHidden((prev) => {
      if (prev.has(groupId) === hide) return prev;
      const next = new Set(prev);
      if (hide) next.add(groupId);
      else next.delete(groupId);
      return next;
    });
  }, []);

  // The pop-up's code, fetched once the page is idle rather than on the first
  // click, so the first card opened grows straight away like every other.
  const [preload, setPreload] = useState(false);
  useEffect(() => {
    const start = () => setPreload(true);
    if ("requestIdleCallback" in window) {
      const handle = window.requestIdleCallback(start, { timeout: 2500 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = setTimeout(start, 1200);
    return () => clearTimeout(timer);
  }, []);

  const getCard = useCallback(
    (groupId: string) =>
      gridRef.current?.querySelector<HTMLElement>(`[data-card="${CSS.escape(groupId)}"]`) ?? null,
    [],
  );

  /** Somewhere sensible for focus when what held it is leaving the page. */
  const focusFallback = useCallback(() => {
    gridRef.current?.querySelector<HTMLElement>("[data-card]:not([data-leaving])")?.focus({
      preventScroll: true,
    });
  }, []);

  /** Close the open group, focus back on its card — which the pop-up is about to land on. */
  const close = useCallback(() => {
    if (!selectedId) return;
    getCard(selectedId)?.focus({ preventScroll: true });
    onSelect(null);
  }, [selectedId, getCard, onSelect]);

  function onCardKey(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.nativeEvent.isComposing) return;
    const modified = event.altKey || event.ctrlKey || event.metaKey;
    const cards = Array.from(
      gridRef.current?.querySelectorAll<HTMLElement>("[data-card]:not([data-leaving])") ?? [],
    );
    const dir = ARROWS[event.key];
    if (dir && !modified) {
      // Handled even at an edge, so an arrow key never scrolls the page instead.
      event.preventDefault();
      nearest(event.currentTarget, cards, dir)?.focus();
    } else if ((event.key === "Home" || event.key === "End") && !modified) {
      event.preventDefault();
      cards[event.key === "Home" ? 0 : cards.length - 1]?.focus();
    } else if (onTypeAhead && event.key.length === 1 && event.key !== " " && !modified) {
      // Type-ahead: the character follows focus into the filter box, so
      // nobody has to aim for it first.
      onTypeAhead();
    }
  }

  const sendingGroupId = pendingId
    ? (groups.find((group) => group.issues.some((issue) => issue.id === pendingId))?.id ?? null)
    : null;
  const selected = selectedId ? (groups.find((group) => group.id === selectedId) ?? null) : null;

  return (
    <>
      <div
        ref={gridRef}
        role="group"
        aria-label="Quick ticket groups"
        // Sized by the room the board actually gets, not the window: the
        // sidebar takes a different share at every breakpoint.
        className="relative grid grid-cols-1 gap-3 @xs:grid-cols-2 @2xl:grid-cols-3 @5xl:grid-cols-4"
      >
        <AnimatePresence>
          {groups.map((group, index) => (
            <GroupCard
              key={group.id}
              group={group}
              index={index}
              selected={group.id === selectedId}
              popped={hidden.has(group.id)}
              openCount={group.issues.reduce((sum, issue) => sum + (openByIssue[issue.id] ? 1 : 0), 0)}
              sending={sendingGroupId === group.id}
              reduced={reduced}
              onOpen={() => onSelect(group.id)}
              onKeyDown={onCardKey}
              onFocusAway={focusFallback}
            />
          ))}
        </AnimatePresence>
      </div>

      {preload && <PopupPreload />}
      <AnimatePresence
        // Once the pop-up has fully gone, a result it showed is spent.
        onExitComplete={clearSubmission}
      >
        {selected && (
          <GroupPopup
            key={selected.id}
            group={selected}
            openByIssue={openByIssue}
            location={labelLocation}
            getCard={getCard}
            onClose={close}
            onHide={onHide}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// -------------------------------------------------------------------- card --

function GroupCard({
  group,
  index,
  selected,
  popped,
  openCount,
  sending,
  reduced,
  onOpen,
  onKeyDown,
  onFocusAway,
}: {
  group: QuickGroup;
  index: number;
  /** Its pop-up is open, or opening. */
  selected: boolean;
  /** Its pop-up has grown out of it and stands in its place: the card itself is not drawn. */
  popped: boolean;
  /** How many of its quick tickets the viewer has reported and are still open. */
  openCount: number;
  /** One of its quick tickets is being sent right now. */
  sending: boolean;
  reduced: boolean;
  onOpen: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  onFocusAway: () => void;
}) {
  const present = useIsPresent();
  const id = useId();
  const ref = useRef<HTMLButtonElement>(null);

  // IT switched the group off and a refresh dropped it while it had focus.
  useLayoutEffect(() => {
    if (!present && ref.current === document.activeElement) onFocusAway();
  }, [present, onFocusAway]);

  const count = group.issues.length;
  const countLabel = count === 1 ? "1 quick ticket" : `${count} quick tickets`;
  // With no description, the first few problems say what the group is for.
  const summary = group.description ?? group.issues.map((issue) => issue.label).join(" · ");
  const delay = reduced ? 0 : stagger(index, 0.035, 10);

  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.16, ease: ease.exit } }}
      transition={{ opacity: { duration: 0.24, delay }, y: { ...spring.gentle, delay } }}
      className={cn("min-w-0", !present && "pointer-events-none")}
    >
      <button
        ref={ref}
        type="button"
        data-card={group.id}
        data-leaving={present ? undefined : ""}
        aria-haspopup="dialog"
        aria-expanded={selected}
        aria-label={
          `${group.name}, ${countLabel}` +
          (openCount > 0 ? `, ${openCount} you reported still open` : "") +
          (sending ? ", sending one now" : "")
        }
        aria-describedby={`${id}-summary`}
        onClick={onOpen}
        onKeyDown={onKeyDown}
        // Not drawn while its pop-up stands in for it, but still laid out — the
        // pop-up lands back on it — and still focusable, so focus can wait here.
        style={popped ? { opacity: 0, pointerEvents: "none" } : undefined}
        className={cn(
          // `quick-tile` takes the pointer light; `glyph-host` plays the icon.
          "quick-tile glyph-host group/card relative flex h-full w-full scroll-mt-24 flex-col rounded-[14px] border p-3.5 text-left sm:p-4",
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

        <span aria-hidden className="relative flex items-start justify-between gap-3">
          {/* What the pop-up's header icon flies up from, and lands back on. */}
          <span
            data-card-icon=""
            className={cn(
              "flex size-10 flex-none items-center justify-center rounded-[11px] border",
              "transition-[background-color,border-color,color,scale] duration-300 ease-[var(--ease-entrance)]",
              selected
                ? "border-transparent bg-accent text-[var(--accent-ink)] shadow-[var(--shadow-sm)]"
                : "border-line bg-surface-sunk text-ink-muted group-hover/card:border-accent-line group-hover/card:text-accent motion-safe:group-hover/card:scale-105",
            )}
          >
            <QuickIcon name={group.icon} className="size-[1.15rem]" />
          </span>
          {/* Says it opens out, and leans that way under the pointer. */}
          <span
            className={cn(
              "flex size-7 flex-none items-center justify-center rounded-full border",
              "transition-[border-color,color,background-color] duration-300 ease-[var(--ease-entrance)]",
              selected
                ? "border-accent-line text-accent"
                : "border-line text-ink-faint group-hover/card:border-accent-line group-hover/card:bg-accent-soft group-hover/card:text-accent",
            )}
          >
            <Icons.arrowRight
              className={cn(
                "size-3.5 -rotate-45 transition-[translate] duration-300 ease-[var(--ease-entrance)]",
                "motion-safe:group-hover/card:-translate-y-px motion-safe:group-hover/card:translate-x-px",
              )}
            />
          </span>
        </span>

        <span className="relative mt-3 block min-w-0">
          <span className="line-clamp-2 break-words text-[0.875rem] font-semibold leading-snug tracking-tight text-ink">
            {group.name}
          </span>
          <span
            id={`${id}-summary`}
            className="mt-1 line-clamp-2 break-words text-xs leading-relaxed text-ink-faint"
          >
            {summary}
          </span>
        </span>

        <span
          aria-hidden
          className="relative mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-3 text-[0.6875rem] text-ink-muted"
        >
          <span>
            <span className="readout font-medium text-ink">{count}</span>{" "}
            {count === 1 ? "quick ticket" : "quick tickets"}
          </span>
          {openCount > 0 && (
            <span data-tone="sky" className="inline-flex items-center gap-1">
              <span className="tone-dot" />
              {openCount} open
            </span>
          )}
          {sending && (
            <span className="inline-flex items-center gap-1 text-ink-faint">
              <Spinner className="size-3" />
              Sending
            </span>
          )}
        </span>
      </button>
    </motion.div>
  );
}
