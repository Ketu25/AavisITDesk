"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AnimatePresence,
  motion,
  useDragControls,
  useIsPresent,
  useReducedMotion,
  type PanInfo,
} from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { useEscape, useFocusTrap, useScrollLock } from "@/components/ui/use-overlay";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { useIsClient } from "@/components/motion";
import { Icons } from "@/components/shell/icons";
import { useNewTicket } from "@/components/tickets/new-ticket";
import {
  DISMISS_DISTANCE,
  DISMISS_VELOCITY,
  SHEET_QUERY,
  useKeyboardInset,
} from "@/components/tickets/new-ticket/dialog";
import { SentView } from "@/components/tickets/new-ticket/steps";
import { createClient } from "@/lib/supabase/client";
import { OPEN_STATUSES, PRIORITY_META, QUICK_TICKET_LIMITS } from "@/lib/constants";
import { composeQuickTicket, oneLine, type QuickIssue } from "@/lib/quick-tickets";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useQuickTicket, type OpenTicket, type Origin } from "./context";
import { QuickIcon } from "./icon";

/** Clicks this soon after opening are the tail of whatever opened it — a double click on the row. */
const ARM_MS = 350;

/**
 * A pick, in a dialog of its own: ⌘K and the Quick tickets filter's results
 * open one. A group's pop-up shows the same <ConfirmStep> as its next step
 * instead.
 *
 * This is only the shell — the backdrop, the panel, growing out of the row
 * that opened it, and on a phone a sheet that drags away. Everything the
 * requester reads and does is the step's.
 */
export function QuickTicketDialog({
  issue,
  changed,
  knownOpen,
  origin,
  onClose,
}: {
  issue: QuickIssue;
  changed: boolean;
  knownOpen: OpenTicket | null;
  origin: Origin | null;
  onClose: () => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const sheet = useMediaQuery(SHEET_QUERY);
  const keyboard = useKeyboardInset(sheet);
  const dragControls = useDragControls();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const id = useId();

  // Released as the exit animation starts, while the dialog is still in the
  // document, so focus can go back to whatever opened it.
  const present = useIsPresent();
  useEscape(present, onClose);
  useScrollLock(present);
  useFocusTrap(panelRef, present);

  /** Set on the node before the first paint, so the dialog grows out of what opened it. */
  const setPanel = useCallback(
    (node: HTMLDivElement | null) => {
      panelRef.current = node;
      if (!node) return;
      node.style.transformOrigin =
        origin && !sheet ? `${origin.x - node.offsetLeft}px ${origin.y - node.offsetTop}px` : "";
    },
    [origin, sheet],
  );

  const startDrag = useCallback(
    (event: React.PointerEvent) => {
      if ((event.target as HTMLElement).closest("button, a, input, textarea")) return;
      dragControls.start(event);
    },
    [dragControls],
  );

  function onDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.y > DISMISS_DISTANCE || info.velocity.y > DISMISS_VELOCITY) onClose();
  }

  // Grown out of the row that opened it — the transform origin is that row —
  // from small enough that it visibly leaves it, and shrunk back into it on
  // the way out. Opened from ⌘K there is no row, and it rises in place.
  const grow = origin !== null && !sheet && !reduced;
  const enter = reduced
    ? { opacity: 0 }
    : sheet
      ? { opacity: 1, y: "100%", scale: 1 }
      : grow
        ? { opacity: 0, y: 0, scale: 0.55 }
        : { opacity: 0, y: 10, scale: 0.92 };
  const leave = reduced
    ? { opacity: 0, transition: { duration: 0.12 } }
    : sheet
      ? { opacity: 1, y: "100%", transition: { duration: 0.24, ease: ease.exit } }
      : grow
        ? { opacity: 0, scale: 0.6, transition: { duration: 0.18, ease: ease.exit } }
        : { opacity: 0, y: 6, scale: 0.96, transition: { duration: 0.16, ease: ease.exit } };

  return (
    <div
      className={cn(
        "fixed inset-0 z-[60] flex justify-center",
        sheet ? "items-end" : "items-center p-6",
      )}
    >
      <motion.div
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.2, ease: ease.exit } }}
        transition={{ duration: 0.22, ease: ease.standard }}
        onClick={onClose}
        className="fixed inset-0 bg-black/45 backdrop-blur-[3px]"
      />

      <motion.div
        ref={setPanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-hint`}
        tabIndex={-1}
        initial={enter}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={leave}
        transition={
          reduced
            ? { duration: 0.16 }
            : sheet
              ? { type: "spring", stiffness: 420, damping: 40 }
              : grow
                ? {
                    type: "spring",
                    stiffness: 340,
                    damping: 30,
                    mass: 0.9,
                    opacity: { duration: 0.16, ease: ease.standard },
                  }
                : { type: "spring", stiffness: 380, damping: 32, mass: 0.9 }
        }
        drag={sheet && !reduced ? "y" : false}
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.85 }}
        onDragEnd={onDragEnd}
        style={keyboard ? { marginBottom: keyboard.inset, maxHeight: keyboard.height - 8 } : undefined}
        className={cn(
          "relative flex w-full flex-col overflow-hidden outline-none",
          "border-line-strong bg-canvas-raised shadow-[var(--shadow-lg)]",
          sheet
            ? "max-h-[calc(100dvh-2rem)] rounded-t-[22px] border-x border-t"
            : "max-h-[min(46rem,calc(100dvh-3rem))] max-w-[34rem] rounded-[20px] border",
        )}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-[var(--accent-line)] to-transparent"
        />

        {sheet && (
          <div
            aria-hidden
            onPointerDown={startDrag}
            className="flex h-5 flex-none cursor-grab touch-none items-end justify-center active:cursor-grabbing"
          >
            <span className="h-1 w-10 rounded-full bg-line-strong" />
          </div>
        )}

        <ConfirmStep
          issue={issue}
          changed={changed}
          knownOpen={knownOpen}
          onClose={onClose}
          containerRef={panelRef}
          titleId={`${id}-title`}
          hintId={`${id}-hint`}
          sheet={sheet}
          onHeaderPointerDown={sheet && !reduced ? startDrag : undefined}
        />
      </motion.div>
    </div>
  );
}

/**
 * The one step between picking a quick ticket and IT having it — in its own
 * dialog, or as the next step of a group's pop-up.
 *
 * Everything the ticket will say is on screen before it goes: the title (with
 * the requester's answer folded in), the category, the urgency and the
 * details, composed by the same function the server uses. The admin's question,
 * when there is one, is the only thing asked; a note is optional.
 *
 * Two things can stand between Send and a ticket, and both are shown rather
 * than decided silently: an open ticket the requester already raised for the
 * same problem, and IT editing the quick ticket while it was on screen.
 *
 * Built to be quick to get through: the one question, if there is one, has
 * the cursor; with nothing to answer, Send has focus, so Enter sends. The
 * preview leads with what matters — the title, with the requester's answer
 * marked where it joins it — and folds the rest behind "Full details".
 */
export function ConfirmStep({
  issue,
  changed,
  knownOpen,
  onClose,
  onBack,
  containerRef,
  titleId,
  hintId,
  sheet,
  onHeaderPointerDown,
  autoFocus = false,
  className,
  style,
}: {
  issue: QuickIssue;
  changed: boolean;
  knownOpen: OpenTicket | null;
  /** Ends it all: Done, and Raise a ticket instead. Cancel too, when there is nothing to go back to. */
  onClose: () => void;
  /** Inside a pop-up: back to the group's list, from the header's arrow, Back, and Escape. */
  onBack?: () => void;
  /** The dialog element, which takes focus when nothing in the step should. */
  containerRef: React.RefObject<HTMLElement | null>;
  titleId: string;
  hintId: string;
  sheet: boolean;
  /** Starts dragging a sheet away from its header. */
  onHeaderPointerDown?: (event: React.PointerEvent) => void;
  /**
   * Focus the field that matters as the step arrives. A dialog's focus trap
   * does this itself as it opens; a pop-up moving on to this step does not.
   */
  autoFocus?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const reduced = useReducedMotion() ?? false;
  const finePointer = useMediaQuery("(pointer: fine)");
  const isClient = useIsClient();
  const rootRef = useRef<HTMLDivElement>(null);
  const answerRef = useRef<HTMLInputElement>(null);
  const id = useId();

  const { userId, departmentName, submission, submit, clearSubmission, getDraft, setDraft } =
    useQuickTicket();
  const { open: openNewTicket } = useNewTicket();

  // False once the step is on its way out — the dialog closing, or the
  // pop-up going back — so nothing here grabs focus after that.
  const present = useIsPresent();

  const [answer, setAnswer] = useState(() => getDraft(issue.id).answer);
  const [note, setNote] = useState(() => getDraft(issue.id).note);
  const [answerError, setAnswerError] = useState<string | null>(null);
  /** Undefined while the check is running. */
  const [existing, setExisting] = useState<OpenTicket | null | undefined>(knownOpen ?? undefined);

  // Folded by default — except when IT has just changed what it says, which
  // the requester is asked to check, all of it.
  const [showDetails, setShowDetails] = useState(changed);
  const [sawChange, setSawChange] = useState(changed);
  if (changed !== sawChange) {
    setSawChange(changed);
    if (changed) setShowDetails(true);
  }

  const armed = useRef(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      armed.current = true;
    }, ARM_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // Arriving inside a pop-up, nothing else moves focus here: put it on the
  // field that matters, or on the dialog itself rather than leave it on the
  // list that is sliding away.
  useEffect(() => {
    if (!autoFocus) return;
    const target = rootRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? containerRef.current;
    target?.focus({ preventScroll: true });
  }, [autoFocus, containerRef]);

  // What the page knew is as old as the page, so ask again. RLS limits
  // this to the requester's own tickets; the filter says so explicitly too.
  useEffect(() => {
    let cancelled = false;
    createClient()
      .from("tickets")
      .select("id, ticket_number")
      .eq("created_by", userId)
      .eq("quick_ticket_id", issue.id)
      .in("status", OPEN_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(
        ({ data, error }) => {
          // A failed check is not a reason to block: the server checks again.
          if (!cancelled) setExisting(error ? (knownOpen ?? null) : (data ?? null));
        },
        () => {
          if (!cancelled) setExisting(knownOpen ?? null);
        },
      );
    return () => {
      cancelled = true;
    };
  }, [userId, issue.id, knownOpen]);

  const mine = submission.status !== "idle" && submission.issueId === issue.id ? submission : null;
  const pending = mine?.status === "pending";
  const sent = mine?.status === "success" ? mine : null;
  const failure = mine?.status === "error" ? mine : null;
  const unavailable = failure?.reason === "unavailable";
  /** Nothing to edit while sending, or once IT has switched it off. */
  const locked = pending || unavailable;

  const duplicate = failure?.reason === "duplicate" ? (failure.duplicate ?? existing ?? null) : (existing ?? null);
  const duplicateKnown = failure?.reason === "duplicate" || Boolean(existing);
  const answerMessage = answerError ?? (failure?.reason === "answer" ? failure.message : null);

  // An answer typed before IT removed the question has nothing to answer any
  // more; the server ignores it the same way, so the preview does too.
  const sentAnswer = issue.detail_prompt ? answer : "";
  const composed = useMemo(
    () => composeQuickTicket(issue, { answer: sentAnswer, note }),
    [issue, sentAnswer, note],
  );
  // The part of the title that is the requester's answer, so the preview can
  // show where it lands as they type.
  const bare = useMemo(() => composeQuickTicket(issue, {}).subject, [issue]);
  const added =
    composed.subject !== bare && composed.subject.startsWith(bare) ? composed.subject.slice(bare.length) : "";
  const priority = PRIORITY_META[issue.startsAt];
  /** Nothing to answer and nothing to warn about: Send takes focus, and Enter sends. */
  const sendFirst = !issue.detail_prompt && !knownOpen;

  const mod =
    isClient && /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl";

  // Success, or finding it switched off, replaces the button that had focus;
  // hand focus to what replaced it rather than letting it fall to the page.
  useEffect(() => {
    if (!present || (!sent && !unavailable)) return;
    const target = sent ? '[data-view="sent"] [data-autofocus]' : "[data-raise-instead]";
    rootRef.current?.querySelector<HTMLElement>(target)?.focus({ preventScroll: true });
  }, [sent, unavailable, present]);

  // An open ticket for the same problem turned up while Send had focus — the
  // check finished, or the server refused a duplicate. Enter must not now
  // become "Send anyway" before the warning has been seen: step focus back
  // to the dialog itself.
  useEffect(() => {
    if (duplicateKnown && document.activeElement?.hasAttribute("data-send")) {
      containerRef.current?.focus({ preventScroll: true });
    }
  }, [duplicateKnown, containerRef]);

  function onAnswer(value: string) {
    setAnswer(value);
    setDraft(issue.id, { answer: value, note });
    if (answerError) setAnswerError(null);
    if (failure?.reason === "answer") clearSubmission();
  }

  function onNote(value: string) {
    setNote(value);
    setDraft(issue.id, { answer, note: value });
  }

  function send() {
    if (pending || sent || unavailable || !armed.current) return;
    if (issue.detail_required && !oneLine(answer)) {
      setAnswerError("Answer this so IT can find the problem.");
      answerRef.current?.focus();
      return;
    }
    setAnswerError(null);
    void submit({
      issue,
      answer: sentAnswer,
      note,
      // Only once the requester has seen the open ticket. After an uncertain
      // failure the guard goes back on: if that attempt landed, the retry is
      // shown the ticket it made instead of making a second.
      allowDuplicate: duplicateKnown && !failure?.uncertain,
    });
  }

  function raiseInstead() {
    onClose();
    openNewTicket();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey) &&
      !event.repeat &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      send();
    }
  }

  const primaryLabel = pending
    ? "Sending…"
    : duplicateKnown && !failure?.uncertain
      ? "Send anyway"
      : failure && failure.reason !== "answer"
        ? "Try again"
        : "Send to IT";

  const answerId = `${id}-answer`;
  const noteId = `${id}-note`;
  /** Cancel, and Close once it is switched off: back to the list inside a pop-up, otherwise away. */
  const leave = onBack ?? onClose;

  return (
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      style={style}
      className={cn("flex min-h-0 flex-1 flex-col", className)}
    >
      {/* ------------------------------------------------------ header -- */}
      <div
        onPointerDown={onHeaderPointerDown}
        className={cn(
          "flex flex-none items-start gap-3 px-5 pb-4",
          sheet ? "pt-1" : "pt-4",
          onHeaderPointerDown && "touch-none",
        )}
      >
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={`Back to ${issue.group.name}`}
            className="tap-safe -ml-1.5 mt-0.5 flex size-9 flex-none items-center justify-center rounded-[10px] text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <Icons.arrowLeft className="size-4" />
          </button>
        )}
        <span className="glyph-host mt-0.5 flex size-9 flex-none items-center justify-center rounded-[10px] border border-line bg-surface text-ink-muted">
          <QuickIcon name={issue.group.icon} className="size-[1.05rem]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">{sent ? "Quick ticket · Sent" : `Quick ticket · ${issue.group.name}`}</p>
          <h2
            id={titleId}
            className="mt-1.5 break-words text-[1.0625rem] font-semibold leading-snug tracking-tight text-ink"
          >
            {sent ? "Sent to IT" : issue.label}
          </h2>
          <p id={hintId} className="mt-0.5 text-[0.8125rem] text-ink-muted text-pretty">
            {sent
              ? "That's everything — we'll take it from here."
              : issue.detail_prompt
                ? "Answer one question, check what IT will see, and send."
                : "Check what IT will see, then send. Nothing goes until you do."}
          </p>
        </div>
        <div className="-mr-1.5 flex flex-none items-center gap-1.5">
          {/* Escape closes a dialog; inside a pop-up it goes back, which the arrow already says. */}
          {finePointer && !onBack && (
            <kbd className="readout hidden h-5 items-center rounded border border-line bg-surface-sunk px-1.5 text-[0.625rem] text-ink-faint sm:flex">
              Esc
            </kbd>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="tap-safe flex size-8 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <Icons.close className="size-4" />
          </button>
        </div>
      </div>

      {/* -------------------------------------------------------- body -- */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line">
        {sent ? (
          <div data-view="sent" className="px-5 py-4">
            <SentView ticket={sent.ticket} requested={sent.expected} reduced={reduced} />
          </div>
        ) : (
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
            className="space-y-4 px-5 py-4"
          >
            <AnimatePresence initial={false}>
              {changed && (
                <Notice key="changed" tone="amber" reduced={reduced}>
                  IT updated this quick ticket while you had it open. It now reads as below —
                  check it, then send.
                </Notice>
              )}
              {duplicateKnown && !unavailable && (
                <Notice key="duplicate" tone="amber" reduced={reduced}>
                  You already reported this
                  {duplicate ? (
                    <>
                      {" "}as{" "}
                      <Link
                        href={`/tickets/${duplicate.id}`}
                        className="readout font-medium underline underline-offset-2"
                      >
                        {duplicate.ticket_number}
                      </Link>
                    </>
                  ) : null}
                  , and it&apos;s still open. Sending again opens a second ticket — to add
                  something, reply on the open one instead.
                </Notice>
              )}
            </AnimatePresence>

            {issue.detail_prompt && (
              <Field
                label={issue.detail_prompt}
                htmlFor={answerId}
                required={issue.detail_required}
                error={answerMessage}
                hint={issue.detail_required ? undefined : "Optional, but it helps IT find it faster."}
              >
                <Input
                  ref={answerRef}
                  id={answerId}
                  value={answer}
                  maxLength={QUICK_TICKET_LIMITS.answerMax}
                  onChange={(event) => onAnswer(event.target.value)}
                  aria-invalid={answerMessage ? true : undefined}
                  aria-describedby={`${answerId}-message`}
                  aria-required={issue.detail_required || undefined}
                  autoComplete="off"
                  enterKeyHint="send"
                  // Read-only, not disabled: disabling the field that has
                  // focus drops focus to the page, and the next Enter —
                  // sending again after a failure — would go nowhere.
                  readOnly={locked}
                  aria-readonly={locked || undefined}
                  className={cn(locked && "opacity-60")}
                  // On touch, a keyboard sliding up over the arriving sheet is not a welcome.
                  data-autofocus={finePointer || undefined}
                />
              </Field>
            )}

            <Field
              label="Anything else IT should know?"
              htmlFor={noteId}
              hint="Optional — when it started, what you've tried, who else it affects."
            >
              <Textarea
                id={noteId}
                rows={sheet ? 2 : 3}
                value={note}
                maxLength={QUICK_TICKET_LIMITS.noteMax}
                onChange={(event) => onNote(event.target.value)}
                aria-describedby={`${noteId}-message`}
                readOnly={locked}
                aria-readonly={locked || undefined}
                className={cn("resize-none", locked && "opacity-60")}
              />
            </Field>

            <section
              aria-labelledby={`${id}-preview`}
              className="overflow-hidden rounded-[14px] border border-line bg-surface"
            >
              <div className="flex items-center justify-between gap-3 border-b border-line py-1.5 pl-4 pr-2">
                <p id={`${id}-preview`} className="eyebrow">
                  What IT will receive
                </p>
                <button
                  type="button"
                  aria-expanded={showDetails}
                  aria-controls={`${id}-details`}
                  onClick={() => setShowDetails((open) => !open)}
                  className="tap-safe inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
                >
                  {showDetails ? "Hide details" : "Full details"}
                  <Icons.chevronDown
                    className={cn(
                      "size-3.5 transition-[rotate] duration-300 ease-[var(--ease-entrance)]",
                      showDetails && "rotate-180",
                    )}
                  />
                </button>
              </div>

              <div className="space-y-2.5 px-4 py-3">
                <p className="break-words text-[0.875rem] font-medium leading-snug text-ink">
                  <span className="sr-only">Title: </span>
                  {added ? bare : composed.subject}
                  {added && (
                    <motion.span
                      initial={reduced ? false : { opacity: 0.4 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.2 }}
                      className="text-accent"
                    >
                      {added}
                    </motion.span>
                  )}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="slate" dot={false}>
                    {issue.category}
                  </Badge>
                  <Badge tone={priority.tone} emphasis="quiet">
                    {priority.label}
                  </Badge>
                </div>
              </div>

              <div id={`${id}-details`}>
                <AnimatePresence initial={false}>
                  {showDetails && (
                    <motion.div
                      key="details"
                      initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                      transition={{
                        height: reduced ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 32 },
                        opacity: { duration: 0.18, ease: ease.standard },
                      }}
                      className="overflow-hidden"
                    >
                      <dl className="divide-y divide-line border-t border-line text-[0.8125rem]">
                        <Row term="Urgency">
                          <span className="text-ink">{priority.label}</span>
                          <span className="mt-0.5 block text-[0.6875rem] text-ink-faint">
                            Set by IT for this problem — they may adjust it.
                          </span>
                        </Row>
                        <Row term="Department">
                          <span className="text-ink">{departmentName ?? "Not set"}</span>
                        </Row>
                        <Row term="Details">
                          <span
                            tabIndex={0}
                            role="region"
                            aria-label="Ticket details"
                            className="block max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-sm leading-relaxed text-ink-muted"
                          >
                            {composed.description}
                          </span>
                        </Row>
                      </dl>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </section>

            <AnimatePresence initial={false}>
              {failure && failure.reason !== "duplicate" && failure.reason !== "answer" && (
                <motion.div
                  key="failure"
                  role="alert"
                  data-tone="rose"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="rounded-[12px] border border-[var(--tone-bd)] bg-[var(--tone-bg)] px-3.5 py-3"
                >
                  <p className="flex items-start gap-2 text-[0.8125rem] font-medium text-[var(--tone-fg)]">
                    <Icons.alert className="mt-px size-4 flex-none" />
                    <span>Not sent. {failure.message}</span>
                  </p>
                  {failure.uncertain && (
                    <p className="mt-1.5 pl-6 text-xs leading-relaxed text-ink-muted">
                      It may have reached IT anyway.{" "}
                      <Link href="/tickets" className="font-medium text-accent underline-offset-4 hover:underline">
                        Check My tickets
                      </Link>{" "}
                      — sending again will tell you if it did.
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </form>
        )}
      </div>

      {/* ------------------------------------------------------ footer -- */}
      <div
        className={cn(
          "flex flex-none items-center gap-2 border-t border-line px-5 py-3",
          sheet && "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        )}
      >
        {sent ? (
          <>
            <Button variant="ghost" onClick={onClose} className="h-11 sm:h-9">
              Done
            </Button>
            <Link
              href={`/tickets/${sent.ticket.id}`}
              className={cn(
                "ml-auto inline-flex h-11 items-center gap-2 rounded-[10px] bg-accent px-3.5 text-sm font-medium sm:h-9",
                "text-[var(--accent-ink)] shadow-[var(--shadow-sm)] transition-[filter] duration-150 hover:brightness-110",
              )}
            >
              View ticket
              <Icons.arrowRight className="size-4" />
            </Link>
          </>
        ) : unavailable ? (
          <>
            <Button variant="ghost" onClick={leave} className="h-11 sm:h-9">
              {onBack ? "Back" : "Close"}
            </Button>
            <Button
              variant="primary"
              onClick={raiseInstead}
              icon={<Icons.plus className="size-4" />}
              data-raise-instead=""
              className="ml-auto h-11 sm:h-9"
            >
              Raise a ticket instead
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={leave} className="h-11 sm:h-9">
              {onBack ? "Back" : "Cancel"}
            </Button>
            <Button
              variant="primary"
              onClick={send}
              onKeyDown={(event) => {
                // Enter held down on the row that opened the dialog keeps
                // repeating here once Send has focus; only a fresh press sends.
                if (event.key === "Enter" && event.repeat) event.preventDefault();
              }}
              data-send=""
              data-autofocus={sendFirst || undefined}
              // Not `disabled` while sending: that would drop focus out of
              // the dialog. The click is ignored instead.
              aria-disabled={pending || undefined}
              className={cn(
                "group/send ml-auto h-11 min-w-[7.5rem] sm:h-9",
                pending && "cursor-progress opacity-80",
              )}
            >
              {pending && reduced ? <Spinner className="size-3.5" /> : <Plane flying={pending} />}
              {primaryLabel}
              {!pending && finePointer && (
                <kbd className="readout ml-0.5 rounded border border-current/30 px-1 text-[0.625rem] leading-4 opacity-80">
                  {mod}↵
                </kbd>
              )}
            </Button>
          </>
        )}
      </div>

      <p aria-live="polite" className="sr-only">
        {sent
          ? `Ticket ${sent.ticket.ticket_number} sent to IT.`
          : pending
            ? "Sending to IT."
            : failure && failure.reason !== "answer"
              ? `Not sent. ${failure.message}`
              : ""}
      </p>
    </div>
  );
}

/** Send's paper plane. While the request is in flight it keeps taking off, inside its own box. */
function Plane({ flying }: { flying: boolean }) {
  return (
    <span aria-hidden className="-my-1 flex size-4 flex-none overflow-hidden">
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        className={cn(
          "size-4 transition-[translate] duration-200 ease-[var(--ease-entrance)]",
          flying
            ? "quick-plane-flying"
            : "group-hover/send:translate-x-px group-hover/send:-translate-y-px",
        )}
      >
        <path d="M17.2 2.8 2.8 8.2l5.8 3.2 3.2 5.8 5.4-14.4Z" />
        <path d="M17.2 2.8 8.6 11.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-2.5 sm:grid-cols-[5.5rem_1fr] sm:gap-3">
      <dt className="eyebrow pt-[3px]">{term}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Notice({
  tone,
  reduced,
  children,
}: {
  tone: "amber" | "rose";
  reduced: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
      transition={{ duration: 0.2, ease: ease.standard }}
      className="overflow-hidden"
    >
      <p
        role="status"
        data-tone={tone}
        className="flex items-start gap-2 rounded-[10px] border border-[var(--tone-bd)] bg-[var(--tone-bg)] px-3 py-2 text-[0.8125rem] leading-relaxed text-[var(--tone-fg)]"
      >
        <Icons.alert className="mt-0.5 size-4 flex-none" />
        <span>{children}</span>
      </p>
    </motion.div>
  );
}
