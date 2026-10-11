"use client";

import { useId, useMemo, useRef } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Highlight } from "@/components/ui/highlight";
import { Icons } from "@/components/shell/icons";
import { PRIORITY_META, TICKET_LIMITS } from "@/lib/constants";
import { ease, spring, stagger } from "@/lib/motion";
import { SEARCH_MAX_LENGTH, fold, matchesAllTerms, parseSearchTerms } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { TicketPriority } from "@/lib/database.types";
import type { Category, CreatedTicket, Submission } from "./context";
import type { Draft, Step } from "./draft";

export type FieldName = "category" | "subject" | "description";
export type FieldErrors = Partial<Record<FieldName, string>>;

/** Where focus goes to fix each field. Scoped to the visible step by the caller. */
export const FIELD_SELECTOR: Record<FieldName, string> = {
  category: "[data-autofocus]",
  subject: '[data-field="subject"]',
  description: '[data-field="description"]',
};

/** Past this many, the list grows a filter box. */
const FILTER_THRESHOLD = 8;

/** Calm to critical, left to right — the meter reads like the scale it is. */
const URGENCY: TicketPriority[] = ["low", "normal", "high", "urgent"];

const URGENCY_COPY: Record<TicketPriority, string> = {
  low: "A minor annoyance, or there's an easy workaround.",
  normal: "It slows you down, but you can keep working.",
  high: "It blocks part of your work, or affects several people.",
  urgent: "Work has stopped, or there's a security risk.",
};

export function sameCategory(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Two digits, like a channel on a panel: stable however the list is filtered. */
const channel = (index: number) => String(index + 1).padStart(2, "0");

// ---------------------------------------------------------------- category --

export function CategoryStep({
  categories,
  failed,
  loading,
  onRetry,
  selected,
  missing,
  error,
  filter,
  onFilter,
  onPick,
  disabled,
  isAdmin,
  focusFilterFirst,
  reduced,
}: {
  categories: Category[] | null;
  failed: boolean;
  loading: boolean;
  onRetry: () => void;
  selected: Category | undefined;
  /** A category the draft held that is no longer offered. */
  missing: string | null;
  error?: string;
  filter: string;
  onFilter: (value: string) => void;
  onPick: (category: Category, advance: boolean) => void;
  disabled: boolean;
  isAdmin: boolean;
  /** On a keyboard-and-pointer screen with nothing picked yet, typing is the fastest way in. */
  focusFilterFirst: boolean;
  reduced: boolean;
}) {
  const filterRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const errorId = useId();

  const terms = useMemo(() => parseSearchTerms(filter), [filter]);
  const indexOf = useMemo(
    () => new Map((categories ?? []).map((item, index) => [item.category, index])),
    [categories],
  );
  const visible = useMemo(() => {
    if (!categories) return [];
    if (terms.length === 0) return categories;
    return categories.filter((item) =>
      matchesAllTerms(fold(`${item.category} ${item.description ?? ""}`), terms),
    );
  }, [categories, terms]);

  if (!categories) {
    if (failed) {
      return (
        <div className="flex flex-col items-center gap-3 rounded-[14px] border border-dashed border-line-strong px-4 py-8 text-center">
          <Icons.alert className="size-5 text-ink-faint" />
          <div>
            <p className="text-[0.875rem] font-medium text-ink">Couldn&apos;t load the categories</p>
            <p className="mt-1 text-[0.8125rem] text-ink-muted">
              Check your connection, then try again. Anything you&apos;ve typed is kept.
            </p>
          </div>
          <Button size="sm" variant="secondary" loading={loading} icon={<Icons.refresh className="size-3.5" />} onClick={onRetry}>
            Try again
          </Button>
        </div>
      );
    }
    return (
      <div aria-busy="true" aria-label="Loading categories" className="grid gap-2 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="shimmer h-[4.25rem] rounded-[12px] border border-line bg-surface" />
        ))}
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-line-strong px-4 py-8 text-center">
        <Icons.route className="size-5 text-ink-faint" />
        <p className="text-[0.875rem] font-medium text-ink">No categories are set up yet</p>
        <p className="text-[0.8125rem] text-ink-muted">
          {isAdmin ? (
            <>
              Add one in{" "}
              <Link href="/admin/routing" className="font-medium text-accent underline-offset-4 hover:underline">
                Routing
              </Link>{" "}
              and it will appear here.
            </>
          ) : (
            "Tickets can't be routed without one. Let IT know."
          )}
        </p>
      </div>
    );
  }

  const showFilter = categories.length > FILTER_THRESHOLD;
  // Without a filter box, the opening focus goes to the list itself.
  const filterFirst = focusFilterFirst && showFilter;
  const selectedVisible = selected ? visible.findIndex((item) => item === selected) : -1;
  const tabbable = selectedVisible >= 0 ? selectedVisible : 0;

  const focusCard = (index: number) =>
    gridRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus();

  function onCardKey(event: React.KeyboardEvent, index: number) {
    const count = visible.length;
    let next = -1;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = (index + 1) % count;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        next = (index - 1 + count) % count;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = count - 1;
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        onPick(visible[index], true);
        return;
      default:
        // Type-ahead: a printable key sends focus to the filter, and the
        // character lands there, so nobody has to aim for the box first.
        if (
          showFilter &&
          event.key.length === 1 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey
        ) {
          filterRef.current?.focus();
        }
        return;
    }
    event.preventDefault();
    // Moving through a radio group selects as it goes; only a press commits.
    onPick(visible[next], false);
    focusCard(next);
  }

  function onFilterKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && visible.length > 0) {
      event.preventDefault();
      onPick(visible[selectedVisible >= 0 && terms.length === 0 ? selectedVisible : 0], true);
    } else if (event.key === "ArrowDown" && visible.length > 0) {
      event.preventDefault();
      focusCard(tabbable);
    } else if (event.key === "Escape" && filter) {
      // First Escape empties the box; the next one closes the dialog.
      event.stopPropagation();
      onFilter("");
    }
  }

  return (
    <div className="space-y-3">
      <AnimatePresence initial={false}>
        {missing && (
          <motion.p
            initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: ease.standard }}
            data-tone="amber"
            className="overflow-hidden"
          >
            <span className="flex items-start gap-2 rounded-[10px] border border-[var(--tone-bd)] bg-[var(--tone-bg)] px-3 py-2 text-[0.8125rem] text-[var(--tone-fg)]">
              <Icons.alert className="mt-px size-4 flex-none" />
              <span>
                &ldquo;{missing}&rdquo; is no longer offered. Pick the closest match — the rest of
                your draft is kept.
              </span>
            </span>
          </motion.p>
        )}
      </AnimatePresence>

      {showFilter && (
        <div className="relative">
          <Icons.search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint" />
          <Input
            ref={filterRef}
            type="text"
            role="searchbox"
            aria-label="Filter categories"
            aria-controls={`${errorId}-grid`}
            data-autofocus={filterFirst || undefined}
            value={filter}
            onChange={(event) => onFilter(event.target.value)}
            onKeyDown={onFilterKey}
            maxLength={SEARCH_MAX_LENGTH}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder="Filter — try “printer” or “vpn”"
            disabled={disabled}
            className="pl-8 pr-9"
          />
          {filter && (
            <button
              type="button"
              onClick={() => {
                onFilter("");
                filterRef.current?.focus();
              }}
              aria-label="Clear filter"
              // Not `tap-safe`: that utility sets `position: relative`, which
              // would override `absolute` and drop this into the flow.
              className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
            >
              <Icons.close className="size-3.5" />
            </button>
          )}
        </div>
      )}

      <div
        ref={gridRef}
        id={`${errorId}-grid`}
        role="radiogroup"
        aria-label="Category"
        aria-required="true"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="grid gap-2 sm:grid-cols-2"
      >
        {visible.map((item, i) => {
          const active = item === selected;
          const isTabbable = i === tabbable;
          const starts = item.default_priority && item.default_priority !== "normal" ? item.default_priority : null;
          return (
            <motion.button
              key={item.category}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={isTabbable ? 0 : -1}
              data-index={i}
              data-autofocus={(isTabbable && !filterFirst) || undefined}
              disabled={disabled}
              onClick={() => onPick(item, true)}
              onKeyDown={(event) => onCardKey(event, i)}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              whileTap={reduced || disabled ? undefined : { scale: 0.985 }}
              transition={{
                opacity: { duration: 0.22, delay: stagger(i, 0.022, 10) },
                y: { ...spring.gentle, delay: stagger(i, 0.022, 10) },
                scale: spring.snappy,
              }}
              className={cn(
                "group relative flex min-h-[4.25rem] items-start gap-3 rounded-[12px] border p-3 text-left",
                "transition-[background-color,border-color,box-shadow] duration-200",
                active
                  ? "border-accent-line bg-accent-soft shadow-[var(--glow)]"
                  : "border-line bg-surface hover:border-line-strong hover:bg-surface-hover",
              )}
            >
              <span
                className={cn(
                  "readout flex size-7 flex-none items-center justify-center rounded-[8px] border text-[0.6875rem] font-medium",
                  "transition-colors duration-200",
                  active
                    ? "border-transparent bg-accent text-[var(--accent-ink)]"
                    : "border-line bg-surface-sunk text-ink-faint group-hover:text-ink-muted",
                )}
              >
                {channel(indexOf.get(item.category) ?? i)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.8125rem] font-medium leading-snug text-ink">
                  <Highlight text={item.category} terms={terms} />
                </span>
                {item.description && (
                  <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-ink-faint">
                    <Highlight text={item.description} terms={terms} />
                  </span>
                )}
                {starts && (
                  <span data-tone={PRIORITY_META[starts].tone} className="mt-1.5 inline-flex items-center gap-1.5 text-[0.6875rem] text-ink-muted">
                    <span className="tone-dot" />
                    Starts {PRIORITY_META[starts].label.toLowerCase()}
                  </span>
                )}
              </span>
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex size-[1.125rem] flex-none items-center justify-center rounded-full border transition-colors duration-200",
                  active ? "border-accent bg-accent text-[var(--accent-ink)]" : "border-line-strong",
                )}
              >
                <AnimatePresence initial={false}>
                  {active && (
                    <motion.span
                      initial={reduced ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.4, opacity: 0, transition: { duration: 0.1 } }}
                      transition={spring.snappy}
                    >
                      <Icons.check className="size-3" />
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
            </motion.button>
          );
        })}
      </div>

      {visible.length === 0 && (
        <div className="rounded-[12px] border border-dashed border-line-strong px-4 py-6 text-center">
          <p className="text-[0.8125rem] font-medium text-ink">Nothing matches &ldquo;{filter.trim()}&rdquo;</p>
          <p className="mt-1 text-xs text-ink-faint">
            Try another word, or{" "}
            <button
              type="button"
              onClick={() => {
                onFilter("");
                filterRef.current?.focus();
              }}
              className="font-medium text-accent underline-offset-4 hover:underline"
            >
              show every category
            </button>
            .
          </p>
        </div>
      )}

      <AnimatePresence initial={false}>
        {error && (
          <motion.p
            id={errorId}
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.15 }}
            className="text-xs text-[#e11d48] dark:text-[#fb7185]"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

// ----------------------------------------------------------------- details --

export function DetailsStep({
  draft,
  category,
  errors,
  onChange,
  onPriority,
  onSubjectEnter,
  disabled,
  autoFocusInput,
  sheet,
  reduced,
}: {
  draft: Draft;
  category: Category | undefined;
  errors: FieldErrors;
  onChange: (field: "subject" | "description", value: string) => void;
  onPriority: (priority: TicketPriority) => void;
  onSubjectEnter: () => void;
  disabled: boolean;
  /** Not on touch screens: a keyboard sliding up mid-transition is not a welcome. */
  autoFocusInput: boolean;
  sheet: boolean;
  reduced: boolean;
}) {
  const id = useId();
  const subjectId = `${id}-subject`;
  const descriptionId = `${id}-description`;
  const urgencyLabelId = `${id}-urgency`;

  const suggested =
    category?.default_priority && !draft.priorityChosen && category.default_priority === draft.priority
      ? category.category
      : null;

  function onUrgencyKey(event: React.KeyboardEvent, index: number) {
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % URGENCY.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (index - 1 + URGENCY.length) % URGENCY.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = URGENCY.length - 1;
    if (next < 0) return;
    event.preventDefault();
    onPriority(URGENCY[next]);
    (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  }

  return (
    <div className="space-y-5">
      <Field label="Title" htmlFor={subjectId} required error={errors.subject ?? null} hint="One line, like the subject of an email.">
        <div className="relative">
          <Input
            id={subjectId}
            data-field="subject"
            data-autofocus={autoFocusInput || undefined}
            value={draft.subject}
            maxLength={TICKET_LIMITS.subjectMax}
            placeholder="Laptop won't connect to the shop-floor Wi-Fi"
            aria-invalid={errors.subject ? true : undefined}
            aria-describedby={`${subjectId}-message`}
            autoComplete="off"
            enterKeyHint="next"
            disabled={disabled}
            onChange={(event) => onChange("subject", event.target.value)}
            onKeyDown={(event) => {
              // Enter moves on to the description instead of doing nothing.
              if (event.key === "Enter" && !event.nativeEvent.isComposing && !event.metaKey && !event.ctrlKey) {
                event.preventDefault();
                onSubjectEnter();
              }
            }}
            className="pr-16"
          />
          <Counter value={draft.subject.length} max={TICKET_LIMITS.subjectMax} className="right-3 top-1/2 -translate-y-1/2" />
        </div>
      </Field>

      <Field
        label="What's happening?"
        htmlFor={descriptionId}
        required
        error={errors.description ?? null}
        hint="When did it start, what have you tried, and is it stopping your work?"
      >
        <div className="relative">
          <Textarea
            id={descriptionId}
            data-field="description"
            rows={sheet ? 5 : 6}
            value={draft.description}
            maxLength={TICKET_LIMITS.descriptionMax}
            placeholder="Describe the problem in your own words…"
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={`${descriptionId}-message`}
            disabled={disabled}
            onChange={(event) => onChange("description", event.target.value)}
            // Fixed height: the panel animates to fit its content, and a
            // textarea dragged taller would have it chasing the handle.
            className="resize-none pb-6"
          />
          <Counter value={draft.description.length} max={TICKET_LIMITS.descriptionMax} className="bottom-2 right-3" />
        </div>
      </Field>

      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p id={urgencyLabelId} className="text-[0.8125rem] font-medium text-ink-muted">
            How urgent is it?
          </p>
          <AnimatePresence initial={false}>
            {suggested && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="text-[0.6875rem] text-ink-faint"
              >
                Suggested for {suggested}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <div
          role="radiogroup"
          aria-labelledby={urgencyLabelId}
          className="grid grid-cols-4 gap-1 rounded-[12px] border border-line bg-surface-sunk p-1"
        >
          {URGENCY.map((value, index) => {
            const active = value === draft.priority;
            const meta = PRIORITY_META[value];
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                disabled={disabled}
                onClick={() => onPriority(value)}
                onKeyDown={(event) => onUrgencyKey(event, index)}
                className={cn(
                  "relative flex h-14 flex-col items-center justify-center gap-1.5 rounded-[9px] text-[0.75rem] font-medium sm:h-[3.25rem]",
                  "transition-colors duration-150",
                  active ? "text-ink" : "text-ink-faint hover:text-ink-muted",
                )}
              >
                {active && (
                  <motion.span
                    aria-hidden
                    layoutId={`${id}-urgency-pill`}
                    transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 480, damping: 36 }}
                    className="absolute inset-0 rounded-[9px] border border-line bg-surface shadow-[var(--shadow-sm)]"
                  />
                )}
                <span className="relative">
                  <SignalBars level={index + 1} lit={active} tone={meta.tone} />
                </span>
                <span className="relative">{meta.label}</span>
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={draft.priority}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -3 }}
            transition={{ duration: 0.13 }}
            className="text-xs text-ink-faint"
          >
            {URGENCY_COPY[draft.priority]}
            {draft.priority !== "urgent" && " IT may adjust this based on impact."}
          </motion.p>
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {draft.priority === "urgent" && <UrgentNote reduced={reduced} />}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Four bars, lit up to the level — the same reading at a glance as a signal meter. */
function SignalBars({ level, lit, tone }: { level: number; lit: boolean; tone: string }) {
  return (
    <span aria-hidden data-tone={tone} className="flex h-3 items-end gap-[2px]">
      {[1, 2, 3, 4].map((bar) => (
        <span
          key={bar}
          className="w-[3px] rounded-[1px] transition-colors duration-200"
          style={{
            height: `${bar * 25}%`,
            background:
              bar > level ? "var(--line-strong)" : lit ? "var(--tone-dot)" : "var(--ink-faint)",
          }}
        />
      ))}
    </span>
  );
}

function UrgentNote({ reduced }: { reduced: boolean }) {
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
      transition={{ duration: 0.2, ease: ease.standard }}
      className="overflow-hidden"
    >
      <p
        data-tone="rose"
        className="mt-1 flex items-start gap-2 rounded-[10px] border border-[var(--tone-bd)] bg-[var(--tone-bg)] px-3 py-2 text-xs leading-relaxed text-[var(--tone-fg)]"
      >
        <Icons.alert className="mt-px size-3.5 flex-none" />
        Urgent tickets are flagged for IT&apos;s immediate attention and get the tightest response
        target. Keep it for real emergencies.
      </p>
    </motion.div>
  );
}

/** Appears only near the limit — a running count from the first keystroke is noise. */
function Counter({ value, max, className }: { value: number; max: number; className?: string }) {
  const show = value >= max * 0.8;
  return (
    <span
      aria-hidden={!show}
      className={cn(
        "readout pointer-events-none absolute text-[0.6875rem] transition-opacity duration-150",
        show ? "opacity-100" : "opacity-0",
        value >= max ? "text-[#e11d48] dark:text-[#fb7185]" : "text-ink-faint",
        className,
      )}
    >
      {value}/{max}
    </span>
  );
}

// ------------------------------------------------------------------ review --

export function ReviewStep({
  draft,
  category,
  departmentName,
  failure,
  pending,
  onEdit,
}: {
  draft: Draft;
  category: Category | undefined;
  departmentName: string | null;
  failure: Extract<Submission, { status: "error" }> | null;
  pending: boolean;
  onEdit: (step: Step, field?: FieldName | "urgency") => void;
}) {
  const priority = PRIORITY_META[draft.priority];

  return (
    <div className="space-y-4">
      <dl className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
        <Row term="Category" onEdit={() => onEdit(0)} disabled={pending}>
          <span className="font-medium text-ink">{category?.category ?? draft.category}</span>
        </Row>
        <Row term="Urgency" onEdit={() => onEdit(1, "urgency")} disabled={pending}>
          <Badge tone={priority.tone} emphasis="quiet">
            {priority.label}
          </Badge>
        </Row>
        <Row term="Title" onEdit={() => onEdit(1, "subject")} disabled={pending}>
          <span className="break-words text-ink">{draft.subject.trim()}</span>
        </Row>
        <Row term="Details" onEdit={() => onEdit(1, "description")} disabled={pending}>
          <span
            // Scrollable, so it has to be reachable by keyboard too.
            tabIndex={0}
            role="region"
            aria-label="Ticket details"
            className="block max-h-36 overflow-y-auto whitespace-pre-wrap break-words rounded-sm leading-relaxed text-ink-muted"
          >
            {draft.description.trim()}
          </span>
        </Row>
        <Row term="Department">
          <span className="text-ink">{departmentName ?? "Not set"}</span>
          <span className="mt-0.5 block text-[0.6875rem] text-ink-faint">
            From your profile — IT can change it if it&apos;s wrong.
          </span>
        </Row>
      </dl>

      <AnimatePresence mode="wait" initial={false}>
        {failure ? (
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
                before sending it again.
              </p>
            )}
            {failure.field === "category" && (
              <button
                type="button"
                onClick={() => onEdit(0)}
                className="mt-1.5 pl-6 text-xs font-medium text-accent underline-offset-4 hover:underline"
              >
                Choose another category
              </button>
            )}
          </motion.div>
        ) : (
          <motion.p
            key="note"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-2 text-xs text-ink-faint"
          >
            <Icons.inbox className="size-3.5 flex-none" />
            {pending ? "Sending to IT…" : "IT is notified the moment you send it."}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function Row({
  term,
  children,
  onEdit,
  disabled,
}: {
  term: string;
  children: React.ReactNode;
  onEdit?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-1 px-4 py-3 text-[0.8125rem] sm:grid-cols-[5.5rem_1fr] sm:gap-3">
      <dt className="eyebrow pt-[3px]">{term}</dt>
      <dd className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">{children}</div>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            disabled={disabled}
            aria-label={`Change ${term.toLowerCase()}`}
            className="tap-safe flex-none text-xs font-medium text-accent underline-offset-4 hover:underline disabled:opacity-40"
          >
            Change
          </button>
        )}
      </dd>
    </div>
  );
}

// -------------------------------------------------------------------- sent --

export function SentView({
  ticket,
  requested,
  reduced,
}: {
  ticket: CreatedTicket;
  requested: TicketPriority;
  reduced: boolean;
}) {
  const priority = PRIORITY_META[ticket.priority];
  // The insert trigger lifts "normal" to the category's own default.
  const raised = ticket.priority !== requested;

  const rise = (order: number) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2 } }
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.36, ease: ease.entrance, delay: 0.22 + order * 0.06 },
        };

  return (
    <div className="flex flex-col items-center px-1 pb-2 pt-7 text-center">
      <SentMark reduced={reduced} />

      <motion.p {...rise(0)} className="eyebrow mt-6">
        Ticket number
      </motion.p>
      <motion.h3
        {...rise(1)}
        tabIndex={-1}
        data-autofocus
        className="readout mt-1.5 text-[1.75rem] font-semibold leading-none tracking-tight text-ink outline-none"
      >
        {ticket.ticket_number}
      </motion.h3>
      <motion.p {...rise(2)} className="mt-3 max-w-sm break-words text-[0.875rem] font-medium text-ink text-pretty">
        {ticket.subject}
      </motion.p>
      <motion.div {...rise(3)} className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
        <Badge tone="slate" dot={false}>
          {ticket.category}
        </Badge>
        <Badge tone={priority.tone} emphasis="quiet">
          {priority.label}
        </Badge>
      </motion.div>
      <motion.p {...rise(4)} className="mt-4 max-w-sm text-[0.8125rem] leading-relaxed text-ink-muted text-pretty">
        IT has been notified. Follow its progress — and reply to IT — from the ticket or My tickets.
        {raised && (
          <span className="mt-1.5 block text-xs text-ink-faint">
            Urgency set to {priority.label.toLowerCase()}, the starting level for {ticket.category}.
          </span>
        )}
      </motion.p>
    </div>
  );
}

const SPARKS = 12;
const SPARK_COLORS = ["var(--spec-ok)", "var(--accent)", "#fbbf24", "#38bdf8"];

/** The one moment worth a flourish: a check drawn in, a ring, a short burst. Decorative only. */
function SentMark({ reduced }: { reduced: boolean }) {
  return (
    <div aria-hidden className="relative flex size-16 items-center justify-center">
      {!reduced && (
        <>
          <motion.span
            className="absolute inset-0 rounded-full border-2"
            style={{ borderColor: "var(--spec-ok)" }}
            initial={{ scale: 0.7, opacity: 0.7 }}
            animate={{ scale: 1.9, opacity: 0 }}
            transition={{ duration: 0.9, ease: "easeOut", delay: 0.12 }}
          />
          {Array.from({ length: SPARKS }, (_, i) => {
            const angle = (i / SPARKS) * Math.PI * 2 + 0.26;
            const distance = 46 + (i % 3) * 7;
            return (
              <motion.span
                key={i}
                className="absolute left-1/2 top-1/2 -ml-[3px] -mt-[3px] size-1.5 rounded-full"
                style={{ background: SPARK_COLORS[i % SPARK_COLORS.length] }}
                initial={{ x: 0, y: 0, scale: 0.4, opacity: 0 }}
                animate={{
                  x: Math.cos(angle) * distance,
                  y: Math.sin(angle) * distance,
                  scale: [0.4, 1, 0.5],
                  opacity: [0, 1, 0],
                }}
                transition={{ duration: 0.85, ease: ease.entrance, delay: 0.16 }}
              />
            );
          })}
        </>
      )}
      <motion.div
        className="relative flex size-16 items-center justify-center rounded-full shadow-[var(--shadow-md)]"
        style={{ background: "var(--spec-ok)" }}
        initial={reduced ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={reduced ? { duration: 0.2 } : spring.arrive}
      >
        <svg viewBox="0 0 24 24" className="size-8 text-white" fill="none">
          <motion.path
            d="m5 12.5 4.5 4.5L19 7.5"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={reduced ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.4, delay: 0.2, ease: "easeOut" }}
          />
        </svg>
      </motion.div>
    </div>
  );
}

