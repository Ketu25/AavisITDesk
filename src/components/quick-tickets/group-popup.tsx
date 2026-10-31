"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { motion, useIsPresent, type MotionValue } from "motion/react";
import { Spinner } from "@/components/ui/spinner";
import { Icons } from "@/components/shell/icons";
import { useNewTicket } from "@/components/tickets/new-ticket";
import { PRIORITY_META } from "@/lib/constants";
import { labelPrefill } from "@/lib/qr-labels";
import { ease, spring, stagger } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { QuickGroup, QuickIssue } from "@/lib/quick-tickets";
import { useQuickTicket, type OpenTicket } from "./context";
import { ConfirmStep } from "./dialog";
import { QuickIcon } from "./icon";
import { MorphPopup, type Arrival } from "./morph-popup";
import { ARROWS, nearest } from "./spatial";
import { useSpotlight } from "./spotlight";

/**
 * A quick-ticket group, opened: the card the requester clicked grows into a
 * pop-up over the dimmed page (<MorphPopup>), its icon flying up into the
 * header, and its quick tickets arrive one after another as tiles. Closing
 * reverses it — the pop-up shrinks back into the card it came from.
 *
 * Picking a tile does not stack a second dialog: the pop-up slides on to the
 * confirm step (<ConfirmStep>, the same one ⌘K's dialog shows) with a way
 * back, and after sending shows the result in place. The pick itself lives in
 * the provider (an `embedded` session), so a request still in flight when the
 * requester goes back or closes still lands, and is announced if nothing is
 * on screen to show it.
 *
 * Only ever drawn after a click or from a link, so it is loaded on demand and
 * kept out of the server render. On a phone it is a bottom sheet that drags
 * away; for anyone who asked for less motion it simply fades.
 *
 * Escape goes back from the confirm step, and closes from the list or once a
 * ticket is sent.
 */
export function GroupPopup({
  group,
  openByIssue,
  location = null,
  getCard,
  onClose,
  onHide,
}: {
  group: QuickGroup;
  /** The viewer's newest unfinished ticket per quick ticket. */
  openByIssue: Record<string, OpenTicket>;
  /**
   * Where the QR label that opened this group is stuck ("HP LaserJet · 2nd
   * floor"), when it says. Shown under the name, and what each quick ticket
   * picked from here starts out filled in with.
   */
  location?: string | null;
  /** The group's card on the page, which the pop-up grows out of and lands back in. */
  getCard: (groupId: string) => HTMLElement | null;
  /** Close the pop-up: the board takes the group out of the address. */
  onClose: () => void;
  /** Hide the card while the pop-up stands in for it, and show it again. */
  onHide: (groupId: string, hidden: boolean) => void;
}) {
  const isPresent = useIsPresent();
  const { session, open, close: putDown, clearSubmission, submission, activeId, pendingId } =
    useQuickTicket();
  const { open: openNewTicket } = useNewTicket();
  const id = useId();

  const live = session?.embedded && session.issue.group.id === group.id ? session : null;
  // What the pop-up shows: the list, or the pick it has moved on to. Held
  // still while it leaves, so it shrinks away showing what it showed.
  const [step, setStep] = useState(live);
  /** Which way the views slide: 1 on to the confirm step, -1 back, 0 for the first view. */
  const [dir, setDir] = useState(0);
  /**
   * The tile to put focus back on when the list returns. A fresh object per
   * return, so the list acts on it even when it is the same list coming back
   * — stepping back quickly catches it before it has finished leaving.
   */
  const [returnTo, setReturnTo] = useState<{ issueId: string } | null>(null);
  if (isPresent && live !== step) {
    if (Boolean(live) !== Boolean(step)) setDir(live ? 1 : -1);
    setStep(live);
  }

  const stepSent =
    step !== null && submission.status === "success" && submission.issueId === step.issue.id;

  const back = useCallback(() => {
    if (!session?.embedded) return;
    setReturnTo({ issueId: session.issue.id });
    putDown();
  }, [session, putDown]);

  const pick = useCallback(
    (issue: QuickIssue) => open(issue, { embedded: true, knownOpen: openByIssue[issue.id] ?? null }),
    [open, openByIssue],
  );

  const raise = useCallback(() => {
    onClose();
    openNewTicket();
  }, [onClose, openNewTicket]);

  const onEscape = useCallback(() => {
    if (step && !stepSent) back();
    else onClose();
  }, [step, stepSent, back, onClose]);

  // A pick left open as the pop-up goes is put down with it.
  useEffect(() => {
    if (!isPresent && live) putDown();
  }, [isPresent, live, putDown]);

  const listTitle = `${id}-list-title`;
  const listHint = `${id}-list-hint`;
  const stepTitle = `${id}-step-title`;
  const stepHint = `${id}-step-hint`;

  return (
    <MorphPopup
      cardId={group.id}
      icon={group.icon}
      getCard={getCard}
      onHide={onHide}
      onClose={onClose}
      onEscape={onEscape}
      labelledBy={step ? stepTitle : listTitle}
      describedBy={step ? stepHint : group.description ? listHint : undefined}
      viewKey={step ? `step-${step.key}` : "list"}
      dir={dir}
      onViewExitComplete={() => {
        // Back on the list: what the step showed is spent.
        if (!step) clearSubmission();
      }}
      className="max-w-[38rem]"
      renderView={(view) =>
        step ? (
          <ConfirmStep
            issue={step.issue}
            changed={step.changed}
            knownOpen={step.knownOpen}
            prefill={location ? labelPrefill(step.issue, location) : undefined}
            onClose={onClose}
            onBack={back}
            containerRef={view.panelRef}
            titleId={stepTitle}
            hintId={stepHint}
            sheet={view.sheet}
            onHeaderPointerDown={view.dragHeader}
            autoFocus
            className={cn("flex-none", view.capClass)}
            style={view.capStyle}
          />
        ) : (
          <ListView
            group={group}
            openByIssue={openByIssue}
            location={location}
            activeId={activeId}
            pendingId={pendingId}
            titleId={listTitle}
            hintId={listHint}
            iconRef={view.iconRef}
            iconOpacity={view.iconOpacity}
            // Growing out of the card, it plays once it has landed instead.
            playIcon={dir !== 0 || view.arrival !== "grow"}
            entrance={dir === 0 ? view.arrival : "back"}
            returnTo={returnTo}
            reduced={view.reduced}
            sheet={view.sheet}
            className={view.capClass}
            style={view.capStyle}
            onHeaderPointerDown={view.dragHeader}
            onPick={pick}
            onClose={onClose}
            onRaise={raise}
          />
        )
      }
    />
  );
}

/** Rendered by the card grid once the page is idle, purely so this module is fetched before the first click. */
export function Preload() {
  return null;
}

// ------------------------------------------------------------------ list --

function ListView({
  group,
  openByIssue,
  location,
  activeId,
  pendingId,
  titleId,
  hintId,
  iconRef,
  iconOpacity,
  playIcon,
  entrance,
  returnTo,
  reduced,
  sheet,
  className,
  style,
  onHeaderPointerDown,
  onPick,
  onClose,
  onRaise,
}: {
  group: QuickGroup;
  openByIssue: Record<string, OpenTicket>;
  location: string | null;
  activeId: string | null;
  pendingId: string | null;
  titleId: string;
  hintId: string;
  iconRef: React.RefObject<HTMLSpanElement | null>;
  /** Nought while the card's icon is still flying in to take this one's place. */
  iconOpacity: MotionValue<number>;
  /** Play its problem as it appears. */
  playIcon: boolean;
  /** Grown out of the card (the content waits for room), arrived plainly, or come back from the confirm step. */
  entrance: Arrival | "back";
  /** The tile to focus as the list comes back, set afresh by every return. */
  returnTo: { issueId: string } | null;
  reduced: boolean;
  sheet: boolean;
  className?: string;
  style?: React.CSSProperties;
  onHeaderPointerDown?: (event: React.PointerEvent) => void;
  onPick: (issue: QuickIssue) => void;
  onClose: () => void;
  onRaise: () => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  useSpotlight(listRef);

  // Coming back from the confirm step, focus returns to the tile it came
  // from — or the first, if IT has taken that one away meanwhile.
  useEffect(() => {
    if (!returnTo) return;
    const list = listRef.current;
    const target =
      list?.querySelector<HTMLElement>(`[data-issue="${CSS.escape(returnTo.issueId)}"]`) ??
      list?.querySelector<HTMLElement>("[data-nav-item]");
    target?.focus({ preventScroll: true });
  }, [returnTo]);

  /** Where the content's entrance starts: after the card has grown into room for it. */
  const start = entrance === "grow" ? 0.14 : entrance === "back" ? 0 : 0.05;
  const rise = (delay: number) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.16, delay } }
      : {
          initial: { opacity: 0, y: 6 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.26, ease: ease.entrance, delay },
        };

  function onListKey(event: React.KeyboardEvent<HTMLUListElement>) {
    if (event.nativeEvent.isComposing) return;
    const item = (event.target as HTMLElement).closest<HTMLElement>("[data-nav-item]");
    if (!item) return;
    const modified = event.altKey || event.ctrlKey || event.metaKey;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-nav-item]"));
    const dir = ARROWS[event.key];
    if (dir && !modified) {
      // Handled even at an edge, so an arrow key never scrolls the list instead.
      event.preventDefault();
      nearest(item, items, dir)?.focus();
    } else if ((event.key === "Home" || event.key === "End") && !modified) {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    }
  }

  const count = group.issues.length;

  return (
    <div style={style} className={cn("flex flex-col", className)}>
      <div
        onPointerDown={onHeaderPointerDown}
        className={cn(
          "flex flex-none items-start gap-3.5 px-5 pb-4",
          sheet ? "pt-1" : "pt-5",
          onHeaderPointerDown && "touch-none",
        )}
      >
        {/* Plays its problem as it arrives, and again on hover. */}
        <motion.span
          ref={iconRef}
          data-play={playIcon || undefined}
          style={{ opacity: iconOpacity }}
          className="glyph-host flex size-11 flex-none items-center justify-center rounded-[12px] bg-accent text-[var(--accent-ink)] shadow-[var(--shadow-sm)]"
        >
          <QuickIcon name={group.icon} className="size-[1.25rem]" />
        </motion.span>
        <motion.div {...rise(start)} className="min-w-0 flex-1 pt-0.5">
          <p className="eyebrow">{count === 1 ? "1 quick ticket" : `${count} quick tickets`}</p>
          <h2
            id={titleId}
            className="mt-1 break-words text-[1.0625rem] font-semibold leading-snug tracking-tight text-ink"
          >
            {group.name}
          </h2>
          {group.description && (
            <p id={hintId} className="mt-0.5 break-words text-[0.8125rem] text-ink-muted text-pretty">
              {group.description}
            </p>
          )}
          {location && (
            <p className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-surface-sunk px-2 py-1 text-xs text-ink-muted">
              <Icons.pin className="size-3.5 flex-none text-accent" />
              <span className="sr-only">From the label at </span>
              <span className="min-w-0 break-words">{location}</span>
            </p>
          )}
        </motion.div>
        <motion.button
          {...rise(start)}
          type="button"
          onClick={onClose}
          aria-label={`Close ${group.name}`}
          className="tap-safe -mr-1.5 flex size-8 flex-none items-center justify-center rounded-[9px] text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
        >
          <Icons.close className="size-4" />
        </motion.button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line p-3 sm:p-4">
        <ul ref={listRef} role="list" onKeyDown={onListKey} className="grid gap-2 sm:grid-cols-2">
          {group.issues.map((issue, index) => (
            <IssueTile
              key={issue.id}
              issue={issue}
              existing={openByIssue[issue.id] ?? null}
              active={activeId === issue.id}
              sending={pendingId === issue.id}
              // The trap puts focus here as the pop-up opens; a returning list places it itself.
              first={index === 0 && entrance !== "back"}
              delay={reduced ? 0 : start + 0.04 + stagger(index, 0.04, 10)}
              reduced={reduced}
              onPick={onPick}
            />
          ))}
        </ul>
      </div>

      <motion.div
        {...rise(reduced ? 0 : start + 0.12)}
        className={cn(
          "flex flex-none flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-5 py-3 text-xs text-ink-faint",
          sheet && "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        )}
      >
        <span>You&apos;ll see exactly what IT gets before anything is sent.</span>
        <span>
          Not listed?{" "}
          <button
            type="button"
            onClick={onRaise}
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            Raise a ticket
          </button>
        </span>
      </motion.div>
    </div>
  );
}

function IssueTile({
  issue,
  existing,
  active,
  sending,
  first,
  delay,
  reduced,
  onPick,
}: {
  issue: QuickIssue;
  /** The viewer's newest unfinished ticket raised from this quick ticket. */
  existing: OpenTicket | null;
  /** Its confirm step is the one open. */
  active: boolean;
  sending: boolean;
  first: boolean;
  delay: number;
  reduced: boolean;
  onPick: (issue: QuickIssue) => void;
}) {
  const raised = issue.startsAt === "urgent" || issue.startsAt === "high";
  const priority = PRIORITY_META[issue.startsAt];

  return (
    <motion.li
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        opacity: { duration: 0.22, ease: ease.standard, delay },
        y: { ...spring.gentle, delay },
        scale: { ...spring.gentle, delay },
      }}
      className="min-w-0"
    >
      <button
        type="button"
        data-nav-item=""
        data-issue={issue.id}
        data-active={active || undefined}
        data-autofocus={first || undefined}
        aria-label={
          [
            issue.label,
            raised && `Starts ${priority.label.toLowerCase()}`,
            issue.detail_prompt && "Asks one question",
            existing && `You already reported this as ${existing.ticket_number}`,
          ]
            .filter(Boolean)
            .join(". ") + "."
        }
        aria-busy={sending || undefined}
        onClick={() => onPick(issue)}
        className={cn(
          // `quick-tile` takes the pointer light.
          // Two to a row from `sm`, where a shared height keeps the rows even.
          "quick-tile group/tile relative flex h-full min-h-12 w-full flex-col justify-between gap-2 rounded-[12px] border p-3 pl-3.5 text-left sm:min-h-[4.5rem]",
          "border-line bg-surface transition-[translate,scale,border-color,background-color,box-shadow] duration-200 ease-[var(--ease-standard)]",
          "hover:border-accent-line hover:shadow-[var(--shadow-md)] motion-safe:hover:-translate-y-0.5 active:scale-[0.98]",
          "data-[active]:border-accent-line data-[active]:bg-accent-soft",
        )}
      >
        <span aria-hidden className="spot-wash" />
        <span aria-hidden className="spot-ring" />
        <span className="relative flex items-start gap-2.5">
          <span className="line-clamp-2 min-w-0 flex-1 break-words text-[0.875rem] font-medium leading-snug text-ink">
            {issue.label}
          </span>
          <span
            aria-hidden
            className={cn(
              "flex size-6 flex-none items-center justify-center rounded-full border border-line text-ink-faint",
              "transition-[background-color,border-color,color] duration-200 ease-[var(--ease-standard)]",
              "group-hover/tile:border-transparent group-hover/tile:bg-accent group-hover/tile:text-[var(--accent-ink)]",
              "group-focus-visible/tile:border-transparent group-focus-visible/tile:bg-accent group-focus-visible/tile:text-[var(--accent-ink)]",
            )}
          >
            {sending ? (
              <Spinner className="size-3" />
            ) : (
              <Icons.arrowRight className="size-3 transition-[translate] duration-200 group-hover/tile:translate-x-px" />
            )}
          </span>
        </span>
        {(raised || issue.detail_prompt || existing) && (
          <span
            aria-hidden
            className="relative flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.6875rem] text-ink-faint"
          >
            {raised && (
              <span data-tone={priority.tone} className="inline-flex items-center gap-1">
                <span className="tone-dot" />
                {priority.label}
              </span>
            )}
            {issue.detail_prompt && <span>Asks one question</span>}
            {existing && (
              <span
                title="You reported this and it's still open"
                className="readout rounded border border-line bg-surface-sunk px-1.5 leading-4"
              >
                {existing.ticket_number} open
              </span>
            )}
          </span>
        )}
      </button>
    </motion.li>
  );
}
