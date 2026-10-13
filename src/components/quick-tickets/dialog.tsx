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

/**
 * The one step between picking a quick ticket and IT having it.
 *
 * Everything the ticket will say is on screen before it goes: the title (with
 * the requester's answer folded in), the category, the urgency and the
 * details, composed by the same function the server uses. The admin's question,
 * when there is one, is the only thing asked; a note is optional.
 *
 * Two things can stand between Send and a ticket, and both are shown rather
 * than decided silently: an open ticket the requester already raised for the
 * same problem, and IT editing the quick ticket while it was on screen.
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
  const finePointer = useMediaQuery("(pointer: fine)");
  const isClient = useIsClient();
  const dragControls = useDragControls();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const answerRef = useRef<HTMLInputElement>(null);
  const id = useId();

  const { userId, departmentName, submission, submit, clearSubmission, getDraft, setDraft } =
    useQuickTicket();
  const { open: openNewTicket } = useNewTicket();

  // Released as the exit animation starts, while the dialog is still in the
  // document, so focus can go back to whatever opened it.
  const present = useIsPresent();
  useEscape(present, onClose);
  useScrollLock(present);
  useFocusTrap(panelRef, present);

  const [answer, setAnswer] = useState(() => getDraft(issue.id).answer);
  const [note, setNote] = useState(() => getDraft(issue.id).note);
  const [answerError, setAnswerError] = useState<string | null>(null);
  /** Undefined while the check is running. */
  const [existing, setExisting] = useState<OpenTicket | null | undefined>(knownOpen ?? undefined);

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
  const priority = PRIORITY_META[issue.startsAt];

  const mod =
    isClient && /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl";

  // Success, or finding it switched off, replaces the button that had focus;
  // hand focus to what replaced it rather than letting it fall to the page.
  useEffect(() => {
    if (!present || (!sent && !unavailable)) return;
    const target = sent ? '[data-view="sent"] [data-autofocus]' : "[data-raise-instead]";
    panelRef.current?.querySelector<HTMLElement>(target)?.focus({ preventScroll: true });
  }, [sent, unavailable, present]);

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
    if (pending || sent || unavailable) return;
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

  const enter = reduced
    ? { opacity: 0 }
    : sheet
      ? { opacity: 1, y: "100%", scale: 1 }
      : { opacity: 0, y: 10, scale: 0.92 };
  const leave = reduced
    ? { opacity: 0, transition: { duration: 0.12 } }
    : sheet
      ? { opacity: 1, y: "100%", transition: { duration: 0.24, ease: ease.exit } }
      : { opacity: 0, y: 6, scale: 0.96, transition: { duration: 0.16, ease: ease.exit } };

  const primaryLabel = pending
    ? "Sending…"
    : duplicateKnown && !failure?.uncertain
      ? "Send anyway"
      : failure && failure.reason !== "answer"
        ? "Try again"
        : "Send to IT";

  const answerId = `${id}-answer`;
  const noteId = `${id}-note`;

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
              : { type: "spring", stiffness: 380, damping: 32, mass: 0.9 }
        }
        drag={sheet && !reduced ? "y" : false}
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.85 }}
        onDragEnd={onDragEnd}
        onKeyDown={onKeyDown}
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

        {/* ------------------------------------------------------ header -- */}
        <div
          onPointerDown={sheet && !reduced ? startDrag : undefined}
          className={cn("flex flex-none items-start gap-3 px-5 pb-4", sheet ? "pt-1 touch-none" : "pt-4")}
        >
          <span className="mt-0.5 flex size-9 flex-none items-center justify-center rounded-[10px] border border-line bg-surface text-ink-muted">
            <QuickIcon name={issue.group.icon} className="size-[1.05rem]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">{sent ? "Quick ticket · Sent" : `Quick ticket · ${issue.group.name}`}</p>
            <h2
              id={`${id}-title`}
              className="mt-1.5 break-words text-[1.0625rem] font-semibold leading-snug tracking-tight text-ink"
            >
              {sent ? "Sent to IT" : issue.label}
            </h2>
            <p id={`${id}-hint`} className="mt-0.5 text-[0.8125rem] text-ink-muted text-pretty">
              {sent
                ? "That's everything — we'll take it from here."
                : issue.detail_prompt
                  ? "Answer one question, check what IT will see, and send."
                  : "Check what IT will see, then send. Nothing goes until you do."}
            </p>
          </div>
          <div className="-mr-1.5 flex flex-none items-center gap-1.5">
            {finePointer && (
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
                <p id={`${id}-preview`} className="eyebrow border-b border-line px-4 py-2.5">
                  What IT will receive
                </p>
                <dl className="divide-y divide-line text-[0.8125rem]">
                  <Row term="Title">
                    <span className="break-words font-medium text-ink">{composed.subject}</span>
                  </Row>
                  <Row term="Category">
                    <span className="text-ink">{issue.category}</span>
                  </Row>
                  <Row term="Urgency">
                    <Badge tone={priority.tone} emphasis="quiet">
                      {priority.label}
                    </Badge>
                    <span className="mt-1 block text-[0.6875rem] text-ink-faint">
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
              <Button variant="ghost" onClick={onClose} className="h-11 sm:h-9">
                Close
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
              <Button variant="ghost" onClick={onClose} className="h-11 sm:h-9">
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={send}
                // Not `disabled` while sending: that would drop focus out of
                // the dialog. The click is ignored instead.
                aria-disabled={pending || undefined}
                className={cn("ml-auto h-11 min-w-[7.5rem] sm:h-9", pending && "cursor-progress opacity-80")}
              >
                {pending && <Spinner className="size-3.5" />}
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
      </motion.div>
    </div>
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
