"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
  type Variants,
} from "motion/react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { useIsClient } from "@/components/motion";
import { Icons } from "@/components/shell/icons";
import { TICKET_LIMITS } from "@/lib/constants";
import { ease, spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { TicketPriority } from "@/lib/database.types";
import { useNewTicket, type Category } from "./context";
import { STEP_COUNT, hasContent, useDraft, type Draft, type Step } from "./draft";
import {
  CategoryStep,
  DetailsStep,
  FIELD_SELECTOR,
  ReviewStep,
  SentView,
  sameCategory,
  type FieldErrors,
  type FieldName,
} from "./steps";

/**
 * Three short steps instead of one long form: what kind of problem, what is
 * happening, and a last look before it goes. Each step asks for one kind of
 * thing, which is easier on a phone and easier to get right first time.
 *
 * Shared by the dialog and the full-page fallback at /tickets/new. The draft
 * and the submission come from the provider, so both stay in step.
 */

const STEPS = [
  {
    label: "Category",
    title: "What's it about?",
    hint: "Pick the closest match — it decides who picks it up.",
  },
  {
    label: "Details",
    title: "What's happening?",
    hint: "A clear title and a few specifics save a round of questions.",
  },
  {
    label: "Review",
    title: "Check and send",
    hint: "Make sure it says what you mean. You can change anything.",
  },
] as const;

/** Long enough to see the choice land before the next step slides in. */
const AUTO_ADVANCE_MS = 220;
/** The second press on Clear has to come within this. */
const CLEAR_CONFIRM_MS = 4000;

type View = Step | "sent";
type Travel = { dir: 1 | -1; fade: boolean; reduced: boolean };

/**
 * Forward slides in from the right and back from the left, so the steps feel
 * laid out side by side. The success view and anything leaving it fade and
 * settle instead — it is an arrival, not a page turn.
 */
const travel: Variants = {
  enter: ({ dir, fade, reduced }: Travel) =>
    reduced || fade ? { opacity: 0, x: 0, scale: reduced ? 1 : 0.98 } : { opacity: 0, x: dir * 36, scale: 1 },
  center: ({ reduced }: Travel) => ({
    opacity: 1,
    x: 0,
    scale: 1,
    transition: reduced
      ? { duration: 0.12 }
      : {
          x: { type: "spring", stiffness: 380, damping: 36 },
          scale: { type: "spring", stiffness: 380, damping: 36 },
          opacity: { duration: 0.22, ease: ease.standard },
        },
  }),
  exit: ({ dir, fade, reduced }: Travel) =>
    reduced || fade
      ? { opacity: 0, x: 0, transition: { duration: 0.12, ease: ease.exit } }
      : { opacity: 0, x: dir * -36, transition: { duration: 0.16, ease: ease.exit } },
};

function problemsAt(step: Step, draft: Draft, categoryOk: boolean): FieldErrors {
  if (step === 0) {
    return categoryOk ? {} : { category: "Pick the category closest to the problem." };
  }
  if (step === 1) {
    const errors: FieldErrors = {};
    const subject = draft.subject.trim().length;
    if (subject < TICKET_LIMITS.subjectMin) {
      errors.subject =
        subject === 0
          ? "Give it a short title."
          : `Make the title at least ${TICKET_LIMITS.subjectMin} characters.`;
    }
    const description = draft.description.trim().length;
    if (description < TICKET_LIMITS.descriptionMin) {
      errors.description =
        description === 0 ? "Describe what's happening." : "Add a little more detail.";
    }
    return errors;
  }
  return {};
}

const FIELD_ORDER: FieldName[] = ["category", "subject", "description"];
const firstField = (errors: FieldErrors) => FIELD_ORDER.find((field) => errors[field]);

export function NewTicketWizard({
  variant,
  sheet = false,
  categories,
  categoriesFailed,
  categoriesLoading,
  onRetryCategories,
  onClose,
  onGrab,
}: {
  variant: "dialog" | "page";
  sheet?: boolean;
  categories: Category[] | null;
  categoriesFailed: boolean;
  categoriesLoading: boolean;
  onRetryCategories: () => void;
  onClose?: () => void;
  /** Sheet only: lets the header double as the drag handle. */
  onGrab?: (event: React.PointerEvent) => void;
}) {
  const reduced = useReducedMotion() ?? false;
  // False once the dialog has started closing. Nothing may pull focus back
  // into it then — a late answer would yank it away from the page.
  const present = useIsPresent();
  const finePointer = useMediaQuery("(pointer: fine)");
  const isClient = useIsClient();
  const { userId, departmentName, isAdmin, submission, submit, clearSubmission, watchPage } =
    useNewTicket();
  const { draft, update, reset } = useDraft(userId);

  const [direction, setDirection] = useState<1 | -1>(1);
  const [fadeNext, setFadeNext] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [filter, setFilter] = useState("");
  const [clearArmed, setClearArmed] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  /** A selector to focus once the next view has rendered, set by whoever moved there. */
  const focusNext = useRef<string | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ------------------------------------------------------------- derived --

  const selected = useMemo(
    () => categories?.find((item) => sameCategory(item.category, draft.category)),
    [categories, draft.category],
  );
  // The draft can outlive its category: an admin switches it off while the
  // draft sits in storage. Until the list has loaded it is given the benefit
  // of the doubt — the server checks it again either way.
  const categoryGone = categories !== null && draft.category !== "" && !selected;
  const categoryOk = draft.category !== "" && !categoryGone;
  // Nothing past the first step means anything without a category.
  const step: Step = categoryOk ? draft.step : 0;

  const pending = submission.status === "pending";
  const sent = submission.status === "success" ? submission : null;
  const failure = submission.status === "error" ? submission : null;
  const view: View = sent ? "sent" : step;
  const locked = pending || sent !== null;

  const mod =
    isClient && /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent)
      ? "⌘"
      : "Ctrl";

  // ------------------------------------------------------------- effects --

  useEffect(() => (variant === "page" ? watchPage() : undefined), [variant, watchPage]);

  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!clearArmed) return;
    const timer = setTimeout(() => setClearArmed(false), CLEAR_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [clearArmed]);

  // Each new view gets focus — the field it asked for, its first control, or
  // the view itself — and starts scrolled to the top. Skipped on the first
  // render: the dialog's focus trap places the opening focus.
  const shownView = useRef<View>(view);
  useEffect(() => {
    if (shownView.current === view) return;
    shownView.current = view;
    if (!present) return;

    const root = rootRef.current;
    const container = root?.querySelector<HTMLElement>(`[data-view="${view}"]`);
    if (!root || !container) return;

    scrollerRef.current?.scrollTo({ top: 0 });
    if (variant === "page" && root.getBoundingClientRect().top < 0) {
      root.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
    }

    const requested = focusNext.current;
    focusNext.current = null;
    let target =
      (requested && container.querySelector<HTMLElement>(requested)) ||
      container.querySelector<HTMLElement>("[data-autofocus]") ||
      container;
    // On touch, focusing a text field pops the keyboard over the slide.
    if (!finePointer && !requested && target.matches("input, textarea")) target = container;
    target.focus({ preventScroll: true });
  }, [view, variant, reduced, finePointer, present]);

  // On a first open the list is still loading when the focus trap places the
  // opening focus, so it settles on the close button. When the list lands,
  // hand focus to the step's own starting point — unless the person has
  // already moved into the step themselves.
  const hadCategories = useRef(categories !== null);
  useEffect(() => {
    if (hadCategories.current || categories === null) return;
    hadCategories.current = true;
    if (variant !== "dialog" || !present || shownView.current !== 0) return;
    const container = rootRef.current?.querySelector<HTMLElement>('[data-view="0"]');
    if (!container || container.contains(document.activeElement)) return;
    container.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
  }, [categories, variant, present]);

  // ---------------------------------------------------------- navigation --

  const cancelAdvance = () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = null;
  };

  function move(target: Step, focus: string | null = null) {
    cancelAdvance();
    setDirection(target >= step ? 1 : -1);
    setFadeNext(false);
    focusNext.current = focus;
    // A failure belongs to the attempt it described; moving on retires it.
    if (failure) clearSubmission();
    update({ step: target });
  }

  const focusInView = useCallback(
    (selector: string) =>
      rootRef.current
        ?.querySelector<HTMLElement>(`[data-view="${shownView.current}"] ${selector}`)
        ?.focus(),
    [],
  );

  /** Show every problem on the first step that has one, and put the cursor on it. */
  function stopAt(at: Step, problems: FieldErrors) {
    setErrors(problems);
    const field = firstField(problems);
    const selector = field ? FIELD_SELECTOR[field] : null;
    if (at === step) {
      if (selector) focusInView(selector);
    } else {
      move(at, selector);
    }
  }

  function goTo(target: Step) {
    if (locked || target === step) return;
    if (target > step) {
      for (let at = 0; at < target; at++) {
        const problems = problemsAt(at as Step, draft, categoryOk);
        if (firstField(problems)) return stopAt(at as Step, problems);
      }
    }
    setErrors({});
    move(target);
  }

  function send() {
    if (locked) return;
    for (const at of [0, 1] as const) {
      const problems = problemsAt(at, draft, categoryOk);
      if (firstField(problems)) return stopAt(at, problems);
    }
    setErrors({});
    void submit({ ...draft, category: selected?.category ?? draft.category });
  }

  function primary() {
    if (locked) return;
    if (step < 2) goTo((step + 1) as Step);
    else send();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    // ⌘↵ / Ctrl+↵ from anywhere in the form: next step, or send.
    if (
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey) &&
      !event.repeat &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      primary();
    }
  }

  // --------------------------------------------------------------- edits --

  function pickCategory(item: Category, advance: boolean) {
    if (locked) return;
    cancelAdvance();
    update((current) => ({
      category: item.category,
      // A picked category puts the form back on its first step, so a
      // replacement for a withdrawn one walks forward again rather than
      // jumping to wherever the draft last was.
      step: 0,
      // The category's usual urgency, unless one has been chosen by hand.
      priority: current.priorityChosen ? current.priority : (item.default_priority ?? "normal"),
    }));
    setErrors((e) => (e.category ? { ...e, category: undefined } : e));
    if (failure) clearSubmission();
    if (!advance) return;

    const go = () => {
      advanceTimer.current = null;
      setDirection(1);
      setFadeNext(false);
      focusNext.current = null;
      // Only if nothing has changed underneath in the meantime.
      update((current) =>
        current.step === 0 && sameCategory(current.category, item.category) ? { step: 1 } : {},
      );
    };
    if (reduced) go();
    else advanceTimer.current = setTimeout(go, AUTO_ADVANCE_MS);
  }

  function onFieldChange(field: "subject" | "description", value: string) {
    update({ [field]: value });
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  }

  function onPriority(priority: TicketPriority) {
    if (locked) return;
    update({ priority, priorityChosen: true });
  }

  function onEdit(target: Step, field?: FieldName | "urgency") {
    if (locked) return;
    setErrors({});
    move(
      target,
      field === "urgency" ? '[role="radio"][aria-checked="true"]' : field ? FIELD_SELECTOR[field] : null,
    );
  }

  function onClear() {
    if (locked) return;
    if (!clearArmed) {
      setClearArmed(true);
      return;
    }
    setClearArmed(false);
    cancelAdvance();
    setErrors({});
    setFilter("");
    setDirection(-1);
    setFadeNext(false);
    focusNext.current = null;
    if (failure) clearSubmission();
    reset();
    // Already on the first step there is no new view to take focus, and the
    // Clear button is about to disappear from under it.
    if (step === 0) {
      const first =
        rootRef.current?.querySelector<HTMLElement>('[data-view="0"] [data-autofocus]') ??
        rootRef.current?.querySelector<HTMLElement>('[data-view="0"]');
      first?.focus();
    }
  }

  function raiseAnother() {
    setErrors({});
    setFilter("");
    setDirection(1);
    setFadeNext(true);
    focusNext.current = null;
    clearSubmission();
  }

  // -------------------------------------------------------------- render --

  const canClear = !locked && hasContent(draft);
  const heading = sent
    ? { title: "Sent to IT", hint: "That's everything — we'll take it from here." }
    : STEPS[step];
  const live = sent
    ? `Ticket ${sent.ticket.ticket_number} sent to IT.`
    : `Step ${step + 1} of ${STEP_COUNT}: ${STEPS[step].label}.`;
  const custom: Travel = { dir: direction, fade: fadeNext || view === "sent", reduced };

  let content: React.ReactNode;
  if (view === "sent" && sent) {
    content = <SentView ticket={sent.ticket} requested={sent.requested} reduced={reduced} />;
  } else if (view === 0) {
    content = (
      <CategoryStep
        categories={categories}
        failed={categoriesFailed}
        loading={categoriesLoading}
        onRetry={onRetryCategories}
        selected={selected}
        missing={categoryGone ? draft.category : null}
        error={errors.category}
        filter={filter}
        onFilter={setFilter}
        onPick={pickCategory}
        disabled={locked}
        isAdmin={isAdmin}
        focusFilterFirst={finePointer && !selected}
        reduced={reduced}
      />
    );
  } else if (view === 1) {
    content = (
      <DetailsStep
        draft={draft}
        category={selected}
        errors={errors}
        onChange={onFieldChange}
        onPriority={onPriority}
        onSubjectEnter={() => focusInView(FIELD_SELECTOR.description)}
        disabled={locked}
        autoFocusInput={finePointer}
        sheet={sheet}
        reduced={reduced}
      />
    );
  } else {
    content = (
      <ReviewStep
        draft={draft}
        category={selected}
        departmentName={departmentName}
        failure={failure}
        pending={pending}
        onEdit={onEdit}
      />
    );
  }

  const primaryLabel = pending ? "Sending…" : step < 2 ? "Next" : failure ? "Try again" : "Send to IT";

  return (
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      className={cn("flex flex-col", variant === "dialog" && "min-h-0 flex-1")}
    >
      {/* ------------------------------------------------------- header -- */}
      <div
        onPointerDown={onGrab}
        className={cn("flex-none px-5", sheet ? "pt-1" : "pt-4", onGrab && "touch-none")}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="eyebrow">
              {sent ? "New ticket · Done" : `New ticket · Step ${step + 1} of ${STEP_COUNT}`}
            </p>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={String(view)}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
                transition={{ duration: 0.14, ease: ease.standard }}
              >
                <h2 className="mt-1.5 text-[1.0625rem] font-semibold leading-snug tracking-tight text-ink">
                  {heading.title}
                </h2>
                <p className="mt-0.5 text-[0.8125rem] text-ink-muted text-pretty">{heading.hint}</p>
              </motion.div>
            </AnimatePresence>
          </div>
          {onClose && (
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
          )}
        </div>

        <Progress step={step} done={sent !== null} disabled={locked} onJump={goTo} reduced={reduced} />
      </div>

      {/* --------------------------------------------------------- body -- */}
      <div
        ref={scrollerRef}
        className={cn(
          "border-t border-line",
          variant === "dialog" && "min-h-0 flex-1 overflow-y-auto overscroll-contain",
        )}
      >
        <MeasuredHeight reduced={reduced}>
          <AnimatePresence initial={false} mode="popLayout" custom={custom}>
            <motion.div
              key={String(view)}
              data-view={view}
              tabIndex={-1}
              custom={custom}
              variants={travel}
              initial="enter"
              animate="center"
              exit="exit"
              className="px-5 py-4 outline-none"
            >
              <InertWhileLeaving>{content}</InertWhileLeaving>
            </motion.div>
          </AnimatePresence>
        </MeasuredHeight>
      </div>

      {/* ------------------------------------------------------- footer -- */}
      <div
        className={cn(
          "flex flex-none items-center gap-2 border-t border-line px-5 py-3",
          sheet && "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        )}
      >
        {sent ? (
          <>
            <Button variant="ghost" onClick={raiseAnother} icon={<Icons.plus className="size-4" />} className="h-11 sm:h-9">
              Raise another
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
        ) : (
          <>
            <AnimatePresence initial={false}>
              {canClear && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <Button
                    variant={clearArmed ? "danger" : "ghost"}
                    onClick={onClear}
                    aria-label={clearArmed ? "Press again to clear the draft" : "Clear draft"}
                    className="h-11 sm:h-9"
                  >
                    {clearArmed ? "Clear draft?" : "Clear"}
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="ml-auto flex items-center gap-2">
              <AnimatePresence initial={false} mode="popLayout">
                {step > 0 && (
                  <motion.div
                    key="back"
                    initial={reduced ? { opacity: 0 } : { opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={reduced ? { opacity: 0 } : { opacity: 0, x: 8 }}
                    transition={{ duration: 0.16, ease: ease.standard }}
                  >
                    <Button
                      variant="ghost"
                      onClick={() => goTo((step - 1) as Step)}
                      disabled={locked}
                      icon={<Icons.arrowLeft className="size-4" />}
                      className="h-11 sm:h-9"
                    >
                      Back
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
              <Button
                variant="primary"
                onClick={primary}
                // Not `disabled` while sending: that would drop focus out of
                // the dialog. The click is ignored instead.
                aria-disabled={pending || undefined}
                className={cn("h-11 min-w-[7.5rem] sm:h-9", pending && "cursor-progress opacity-80")}
              >
                {pending && <Spinner className="size-3.5" />}
                {primaryLabel}
                {!pending &&
                  (finePointer ? (
                    <kbd className="readout ml-0.5 rounded border border-current/30 px-1 text-[0.625rem] leading-4 opacity-80">
                      {mod}↵
                    </kbd>
                  ) : step < 2 ? (
                    <Icons.arrowRight className="size-4" />
                  ) : null)}
              </Button>
            </div>
          </>
        )}
      </div>

      <p aria-live="polite" className="sr-only">
        {live}
      </p>
    </div>
  );
}

/**
 * Progress as three segments that fill as you go. Each is also a way back, or
 * forward as far as the form is valid — `goTo` stops at the first gap.
 */
function Progress({
  step,
  done,
  disabled,
  onJump,
  reduced,
}: {
  step: Step;
  done: boolean;
  disabled: boolean;
  onJump: (step: Step) => void;
  reduced: boolean;
}) {
  return (
    <ol aria-label="Progress" className="mt-3.5 grid grid-cols-3 gap-2">
      {STEPS.map((item, index) => {
        const current = !done && index === step;
        const filled = done || index <= step;
        const complete = done || index < step;
        return (
          <li key={item.label}>
            <button
              type="button"
              onClick={() => onJump(index as Step)}
              disabled={disabled || current}
              aria-current={current ? "step" : undefined}
              aria-label={`${item.label}${complete ? ", done" : ""}`}
              className="group block w-full rounded-sm pb-3 text-left disabled:cursor-default"
            >
              <span className="relative block h-[3px] overflow-hidden rounded-full bg-surface-sunk">
                <motion.span
                  className="absolute inset-0 origin-left rounded-full transition-[background-color] duration-500"
                  style={{ backgroundColor: done ? "var(--spec-ok)" : "var(--accent)" }}
                  initial={false}
                  animate={{ scaleX: filled ? 1 : 0 }}
                  transition={reduced ? { duration: 0 } : spring.gentle}
                />
              </span>
              <span
                className={cn(
                  "mt-1.5 flex items-center gap-1.5 text-[0.6875rem] font-medium transition-colors duration-200",
                  current ? "text-ink" : filled ? "text-ink-muted" : "text-ink-faint",
                  !disabled && !current && "group-hover:text-ink",
                )}
              >
                {complete ? (
                  <Icons.check className={cn("size-3", done ? "text-spec-ok" : "text-accent")} />
                ) : (
                  <span className="readout">{String(index + 1).padStart(2, "0")}</span>
                )}
                {item.label}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Animates its own height to whatever its content measures, so the panel
 * glides between steps of different lengths instead of snapping. Measured
 * with a ResizeObserver, which reports layout size and so is not thrown off
 * by the entrance transform scaling everything mid-flight.
 */
function MeasuredHeight({ children, reduced }: { children: React.ReactNode; reduced: boolean }) {
  const [height, setHeight] = useState<number | null>(null);

  const measure = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      initial={false}
      animate={{ height: height ?? "auto" }}
      transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 360, damping: 36 }}
      // `relative` anchors the outgoing step while it is popped out of flow.
      className="relative overflow-hidden"
    >
      <div ref={measure}>{children}</div>
    </motion.div>
  );
}

/** The outgoing step stays on screen while it animates away; it must not stay reachable by Tab. */
function InertWhileLeaving({ children }: { children: React.ReactNode }) {
  const present = useIsPresent();
  return <div inert={!present}>{children}</div>;
}
