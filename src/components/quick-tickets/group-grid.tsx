"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion, type Transition } from "motion/react";
import { Spinner } from "@/components/ui/spinner";
import { Icons } from "@/components/shell/icons";
import { NewTicketButton } from "@/components/tickets/new-ticket";
import { ease, spring, stagger } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { QuickGroup } from "@/lib/quick-tickets";
import { useQuickTicket, type OpenTicket } from "./context";
import { IssueButton } from "./issue-button";
import { QuickIcon } from "./icon";

/**
 * Pulls a closed panel up into the row gap above it, so a panel at height 0
 * takes no room at all. Must match the grid's `gap-3`.
 */
const COLLAPSED_OFFSET = "-0.75rem";

/** Room kept between an opened panel and the edges of the window. */
const REVEAL_MARGIN = 16;

/** Long enough for a panel to finish opening, and for one closing above it to finish too. */
const REVEAL_DELAY_MS = 420;

const NO_TERMS: string[] = [];

export const panelId = (groupId: string) => `quick-panel-${groupId}`;

type Metrics = { cols: number; width: number; gap: number };

/**
 * The quick-ticket groups as cards. Opening one unfolds a panel under its
 * row, with a notch pointing back at the card, listing its quick tickets.
 *
 * The panel sits right after the open card in the document, which is where a
 * disclosure's content belongs for anyone tabbing or listening. `dense`
 * packing is what then draws it under the whole row: the full-width panel
 * cannot fit beside the card, so it drops to the next row, and the cards that
 * follow fill the gap it left. No measuring is needed to place it, so a panel
 * opened from the address is in the right place from the first paint.
 *
 * Which group is open is owned by the board — it lives in the address.
 */
export function GroupGrid({
  groups,
  openByIssue,
  selectedId,
  onSelect,
  onTypeAhead,
}: {
  groups: QuickGroup[];
  openByIssue: Record<string, OpenTicket>;
  /** One of `groups`, or null. */
  selectedId: string | null;
  onSelect: (groupId: string | null) => void;
  /** A printable key pressed on a card: hand it to the filter box, if there is one. */
  onTypeAhead?: () => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const { pendingId } = useQuickTicket();
  const gridRef = useRef<HTMLDivElement>(null);
  const metrics = useGridMetrics(gridRef);

  const selectedIndex = selectedId ? groups.findIndex((group) => group.id === selectedId) : -1;

  // A new panel only when the open group moves to another row: one panel
  // closes where it was as the other opens. Within a row the same panel stays
  // and its contents change, so the notch can glide across instead.
  const [panel, setPanel] = useState({ id: selectedId, key: 0 });
  if (panel.id !== selectedId) {
    const from = panel.id ? groups.findIndex((group) => group.id === panel.id) : -1;
    const sameRow =
      metrics !== null &&
      from >= 0 &&
      selectedIndex >= 0 &&
      Math.floor(from / metrics.cols) === Math.floor(selectedIndex / metrics.cols);
    setPanel({ id: selectedId, key: sameRow ? panel.key : panel.key + 1 });
  }

  // The centre of the open card's column, in the grid's own pixels. Unknown
  // until the grid has been laid out once, and the notch waits for it.
  const notchX =
    metrics && selectedIndex >= 0
      ? (((selectedIndex % metrics.cols) + 0.5) * (metrics.width + metrics.gap)) / metrics.cols -
        metrics.gap / 2
      : null;

  const getCard = useCallback(
    (groupId: string) =>
      gridRef.current?.querySelector<HTMLElement>(`[data-card="${CSS.escape(groupId)}"]`) ?? null,
    [],
  );

  /** Somewhere sensible for focus when what held it is leaving the page. */
  const focusFallback = useCallback((preferId?: string) => {
    const grid = gridRef.current;
    if (!grid) return;
    const preferred = preferId
      ? grid.querySelector<HTMLElement>(`[data-card="${CSS.escape(preferId)}"]:not([data-leaving])`)
      : null;
    (preferred ?? grid.querySelector<HTMLElement>("[data-card]:not([data-leaving])"))?.focus({
      preventScroll: true,
    });
  }, []);

  /** Close the open group, handing focus back to its card first so it never sits in a closing panel. */
  const close = useCallback(() => {
    if (!selectedId) return;
    getCard(selectedId)?.focus({ preventScroll: true });
    onSelect(null);
  }, [selectedId, getCard, onSelect]);

  function onCardKey(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.nativeEvent.isComposing) return;
    const count = groups.length;
    const cols = metrics?.cols ?? 1;
    const lastRow = Math.floor((count - 1) / cols);
    let next: number | null = null;

    switch (event.key) {
      case "ArrowRight":
        next = index + 1 < count ? index + 1 : null;
        break;
      case "ArrowLeft":
        next = index > 0 ? index - 1 : null;
        break;
      case "ArrowDown":
        // From the open card, down goes into its panel rather than past it.
        if (groups[index].id === selectedId) {
          const first = gridRef.current?.querySelector<HTMLElement>(
            `#${CSS.escape(panelId(groups[index].id))} button[aria-haspopup="dialog"]`,
          );
          if (first) {
            event.preventDefault();
            first.focus();
            return;
          }
        }
        next =
          index + cols < count ? index + cols : Math.floor(index / cols) < lastRow ? count - 1 : null;
        break;
      case "ArrowUp":
        next = index - cols >= 0 ? index - cols : null;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = count - 1;
        break;
      default:
        // Type-ahead: the character follows focus into the filter box, so
        // nobody has to aim for it first.
        if (
          onTypeAhead &&
          event.key.length === 1 &&
          event.key !== " " &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey
        ) {
          onTypeAhead();
        }
        return;
    }

    // Handled even at an edge, so an arrow key never scrolls the page instead.
    event.preventDefault();
    if (next !== null) getCard(groups[next].id)?.focus();
  }

  const sendingGroupId = pendingId
    ? (groups.find((group) => group.issues.some((issue) => issue.id === pendingId))?.id ?? null)
    : null;

  const items: React.ReactNode[] = [];
  groups.forEach((group, index) => {
    const selected = group.id === selectedId;
    items.push(
      <GroupCard
        key={group.id}
        group={group}
        index={index}
        selected={selected}
        openCount={group.issues.reduce((sum, issue) => sum + (openByIssue[issue.id] ? 1 : 0), 0)}
        sending={sendingGroupId === group.id}
        reduced={reduced}
        onToggle={() => onSelect(selected ? null : group.id)}
        onKeyDown={(event) => onCardKey(event, index)}
        onFocusAway={focusFallback}
      />,
    );
    if (selected) {
      items.push(
        <GroupPanel
          key={`panel-${panel.key}`}
          group={group}
          notchX={notchX}
          openByIssue={openByIssue}
          reduced={reduced}
          onClose={close}
          getCard={getCard}
          onFocusAway={focusFallback}
        />,
      );
    }
  });

  return (
    <div
      ref={gridRef}
      role="group"
      aria-label="Quick ticket groups"
      onKeyDown={(event) => {
        // Bound here, not on the document: Escape in the confirm dialog
        // belongs to the dialog, and must not also close the group behind it.
        if (event.key === "Escape" && selectedId && !event.nativeEvent.isComposing) close();
      }}
      // Sized by the room the board actually gets, not the window: the
      // sidebar takes a different share at every breakpoint.
      className="relative grid grid-flow-row-dense grid-cols-1 gap-3 @xs:grid-cols-2 @2xl:grid-cols-3 @5xl:grid-cols-4"
    >
      <AnimatePresence>{items}</AnimatePresence>
    </div>
  );
}

// -------------------------------------------------------------------- card --

function GroupCard({
  group,
  index,
  selected,
  openCount,
  sending,
  reduced,
  onToggle,
  onKeyDown,
  onFocusAway,
}: {
  group: QuickGroup;
  index: number;
  selected: boolean;
  /** How many of its quick tickets the viewer has reported and are still open. */
  openCount: number;
  /** One of its quick tickets is being sent right now. */
  sending: boolean;
  reduced: boolean;
  onToggle: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  onFocusAway: (preferId?: string) => void;
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
        aria-expanded={selected}
        aria-controls={selected ? panelId(group.id) : undefined}
        aria-label={
          `${group.name}, ${countLabel}` +
          (openCount > 0 ? `, ${openCount} you reported still open` : "") +
          (sending ? ", sending one now" : "")
        }
        aria-describedby={`${id}-summary`}
        onClick={onToggle}
        onKeyDown={onKeyDown}
        className={cn(
          "group/card relative flex h-full w-full scroll-mt-24 flex-col rounded-[14px] border p-3.5 text-left sm:p-4",
          "transition-[translate,scale,box-shadow,border-color] duration-200 ease-[var(--ease-standard)]",
          "bg-surface active:scale-[0.985]",
          selected
            ? "border-accent-line shadow-[var(--glow)]"
            : "border-line shadow-[var(--shadow-sm)] hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[var(--shadow-md)]",
        )}
      >
        {/* A wash of the accent from the icon's corner: on hover a hint, once open a state. */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-300",
            "bg-[radial-gradient(120%_90%_at_0%_0%,var(--accent-soft),transparent_65%)]",
            selected ? "opacity-100" : "opacity-0 group-hover/card:opacity-100",
          )}
        />

        <span aria-hidden className="relative flex items-start justify-between gap-3">
          <span
            className={cn(
              "flex size-10 flex-none items-center justify-center rounded-[11px] border",
              "transition-[background-color,border-color,color,scale] duration-300 ease-[var(--ease-entrance)]",
              selected
                ? "scale-105 border-transparent bg-accent text-[var(--accent-ink)] shadow-[var(--shadow-sm)]"
                : "border-line bg-surface-sunk text-ink-muted group-hover/card:scale-105 group-hover/card:text-accent",
            )}
          >
            <QuickIcon name={group.icon} className="size-[1.15rem]" />
          </span>
          <span
            className={cn(
              "flex size-7 flex-none items-center justify-center rounded-full border",
              "transition-[rotate,border-color,color] duration-300 ease-[var(--ease-entrance)]",
              selected
                ? "rotate-180 border-accent-line text-accent"
                : "border-line text-ink-faint group-hover/card:border-line-strong group-hover/card:text-ink-muted",
            )}
          >
            <Icons.chevronDown className="size-3.5" />
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

// ------------------------------------------------------------------- panel --

function GroupPanel({
  group,
  notchX,
  openByIssue,
  reduced,
  onClose,
  getCard,
  onFocusAway,
}: {
  group: QuickGroup;
  /** Where the open card's centre is, or null until the grid has been measured. */
  notchX: number | null;
  openByIssue: Record<string, OpenTicket>;
  reduced: boolean;
  onClose: () => void;
  getCard: (groupId: string) => HTMLElement | null;
  onFocusAway: (preferId?: string) => void;
}) {
  const present = useIsPresent();
  const id = useId();
  const outerRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /** The contents' height, so a switch between groups resizes the panel smoothly rather than in a jump. */
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const node = contentRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setHeight(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Closed by something other than the viewer — the group went in a refresh —
  // while focus was inside: put it back on the grid, not the page.
  useLayoutEffect(() => {
    if (!present && outerRef.current?.contains(document.activeElement)) onFocusAway(group.id);
  }, [present, onFocusAway, group.id]);

  // Once it has opened, bring the end of it into view if it ran off the
  // bottom of the window — but never so far that its card goes under the header.
  useEffect(() => {
    if (!present) return;
    const timer = window.setTimeout(
      () => reveal(getCard(group.id), clipRef.current, contentRef.current, !reduced),
      reduced ? 0 : REVEAL_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [group.id, present, reduced, getCard]);

  const size: Transition = reduced ? { duration: 0 } : spring.gentle;
  const count = group.issues.length;
  const titleId = `${id}-${group.id}-title`;

  return (
    <motion.div
      ref={outerRef}
      initial={{ marginTop: COLLAPSED_OFFSET }}
      animate={{ marginTop: "0rem" }}
      exit={{ marginTop: COLLAPSED_OFFSET }}
      transition={size}
      className={cn("relative col-span-full min-w-0", !present && "pointer-events-none")}
    >
      {notchX !== null && (
        <motion.span
          aria-hidden
          initial={{ x: notchX, opacity: 0, scale: 0.4 }}
          animate={{ x: notchX, opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.4, transition: { duration: 0.14, ease: ease.exit } }}
          transition={reduced ? { duration: 0 } : spring.snappy}
          className="absolute left-0 top-0 z-10 -ml-[7px] -mt-[7px] size-3.5"
        >
          {/* Rotated inside, so motion's translate is not turned with it. */}
          <span className="block size-full rotate-45 rounded-tl-[3px] border-l border-t border-accent-line bg-canvas-raised" />
        </motion.span>
      )}

      <motion.div
        ref={clipRef}
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: height ?? "auto", opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ height: size, opacity: { duration: reduced ? 0.12 : 0.2, ease: ease.standard } }}
        className="overflow-hidden rounded-[16px] bg-canvas-raised shadow-[0_0_0_1px_var(--accent-line),var(--shadow-md)]"
      >
        <div ref={contentRef} className="relative">
          {/* popLayout: the outgoing group lifts out of the flow, so the
              panel's height is the incoming group's from the first frame. */}
          <AnimatePresence mode="popLayout">
            <motion.section
              key={group.id}
              // Only the live panel answers to the card's aria-controls; one
              // still closing elsewhere may hold the same group.
              id={present ? panelId(group.id) : undefined}
              aria-labelledby={titleId}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12, ease: ease.exit } }}
              transition={{ duration: 0.24, ease: ease.entrance }}
              className="bg-canvas-raised"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent-line)] to-transparent"
              />

              <div className="flex items-start gap-3 border-b border-line px-4 py-3.5 sm:px-5">
                <span className="mt-0.5 flex size-9 flex-none items-center justify-center rounded-[10px] bg-accent text-[var(--accent-ink)] shadow-[var(--shadow-sm)]">
                  <QuickIcon name={group.icon} className="size-[1.05rem]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="eyebrow">{count === 1 ? "1 quick ticket" : `${count} quick tickets`}</p>
                  <h2
                    id={titleId}
                    className="mt-1 break-words text-[0.9375rem] font-semibold leading-snug tracking-tight text-ink"
                  >
                    {group.name}
                  </h2>
                  {group.description && (
                    <p className="mt-0.5 break-words text-[0.8125rem] text-ink-muted text-pretty">
                      {group.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={`Close ${group.name}`}
                  className="tap-safe -mr-1.5 -mt-0.5 flex size-8 flex-none items-center justify-center rounded-[9px] text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
                >
                  <Icons.close className="size-4" />
                </button>
              </div>

              <ul className="grid gap-x-2 gap-y-px p-2 @2xl:grid-cols-2 @5xl:grid-cols-3">
                {group.issues.map((issue, i) => (
                  <motion.li
                    key={issue.id}
                    initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.22,
                      ease: ease.entrance,
                      delay: reduced ? 0 : 0.06 + stagger(i, 0.03, 10),
                    }}
                    className="min-w-0"
                  >
                    <IssueButton issue={issue} existing={openByIssue[issue.id] ?? null} terms={NO_TERMS} />
                  </motion.li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-xs text-ink-faint sm:px-5">
                <span>You&apos;ll see exactly what IT gets before anything is sent.</span>
                <span>
                  Not listed?{" "}
                  <NewTicketButton className="font-medium text-accent underline-offset-4 hover:underline">
                    Raise a ticket
                  </NewTicketButton>
                </span>
              </div>
            </motion.section>
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ------------------------------------------------------------------ layout --

/**
 * The grid's column count, width and gap as actually laid out. Container
 * queries decide the columns, so the layout is the only one that knows.
 * Unknown (null) until it has been laid out once.
 */
function useGridMetrics(ref: React.RefObject<HTMLElement | null>) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(grid);
      // Resolved as one length per track, repeat() and all.
      const cols = style.gridTemplateColumns.split(/\s+/).filter((track) => track.endsWith("px")).length;
      const next = cols > 0 ? { cols, width: grid.clientWidth, gap: parseFloat(style.columnGap) || 0 } : null;
      setMetrics((prev) =>
        prev && next && prev.cols === next.cols && prev.width === next.width && prev.gap === next.gap
          ? prev
          : next,
      );
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, [ref]);

  return metrics;
}

/**
 * Scrolls just far enough to show the end of an opened panel — by its final
 * height, not wherever its animation has got to — while keeping the card that
 * opened it clear of the sticky page header. Never scrolls up.
 */
function reveal(
  card: HTMLElement | null,
  panel: HTMLElement | null,
  content: HTMLElement | null,
  smooth: boolean,
) {
  if (!card || !panel || !content) return;
  const ceiling = (document.querySelector("header.sticky")?.getBoundingClientRect().bottom ?? 0) + REVEAL_MARGIN;
  const overflow =
    panel.getBoundingClientRect().top + content.offsetHeight + REVEAL_MARGIN - window.innerHeight;
  const room = card.getBoundingClientRect().top - ceiling;
  const delta = Math.min(overflow, room);
  if (delta > 1) window.scrollBy({ top: delta, behavior: smooth ? "smooth" : "auto" });
}
