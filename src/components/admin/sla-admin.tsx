"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { Icons } from "@/components/shell/icons";
import { StaggerChildren, useIsClient } from "@/components/motion";
import { api, ApiClientError } from "@/lib/api";
import { PRIORITY_META, SLA_MAX_MINUTES } from "@/lib/constants";
import { minutesToExact, relativeTime } from "@/lib/format";
import { transition } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { TICKET_PRIORITIES, type SlaRule, type TicketPriority } from "@/lib/database.types";

/** What sla_duration() hands a ticket whose priority has no rule. */
const FALLBACK_MINUTES = 8 * 60;

const UNITS = {
  minutes: { label: "Minutes", factor: 1 },
  hours: { label: "Hours", factor: 60 },
  days: { label: "Days", factor: 1440 },
} as const;

type Unit = keyof typeof UNITS;

type Draft = { amount: string; unit: Unit; threshold: string };

type Values = { minutes: number; threshold: number };

type Parsed = {
  minutes: number | null;
  minutesError: string | null;
  /** Set when hours or days did not land on a whole minute. */
  rounded: boolean;
  threshold: number | null;
  thresholdError: string | null;
};

/** The largest unit the value divides into evenly: 1440 reads as 1 day. */
function bestUnit(minutes: number): Unit {
  if (minutes % UNITS.days.factor === 0) return "days";
  if (minutes % UNITS.hours.factor === 0) return "hours";
  return "minutes";
}

/**
 * The shortest decimal that still converts back to exactly `minutes`. Fixed
 * two-place rounding would turn 90 minutes into 0.06 days — 86 minutes once
 * saved — so switching units could quietly change the SLA.
 */
function amountFor(minutes: number, unit: Unit) {
  const factor = UNITS[unit].factor;
  for (let places = 0; places <= 6; places++) {
    const text = String(Number((minutes / factor).toFixed(places)));
    if (Math.round(Number(text) * factor) === minutes) return text;
  }
  return String(minutes / factor);
}

function draftFrom(values: Values): Draft {
  const unit = bestUnit(values.minutes);
  return {
    amount: amountFor(values.minutes, unit),
    unit,
    threshold: String(values.threshold),
  };
}

const DECIMAL = /^(\d+\.?\d*|\.\d+)$/;
const WHOLE = /^\d+$/;

function parseDraft(draft: Draft): Parsed {
  const parsed: Parsed = {
    minutes: null,
    minutesError: null,
    rounded: false,
    threshold: null,
    thresholdError: null,
  };

  const amount = draft.amount.trim();
  if (!amount) {
    parsed.minutesError = "Enter how long to allow.";
  } else if (!DECIMAL.test(amount)) {
    parsed.minutesError = "Use a number, like 4 or 1.5.";
  } else if (draft.unit === "minutes" && !WHOLE.test(amount)) {
    parsed.minutesError = "Use whole minutes.";
  } else {
    const exact = Number(amount) * UNITS[draft.unit].factor;
    const minutes = Math.round(exact);
    if (minutes < 1) {
      parsed.minutesError = "Allow at least 1 minute.";
    } else if (minutes > SLA_MAX_MINUTES) {
      parsed.minutesError = `The longest SLA allowed is ${SLA_MAX_MINUTES / UNITS.days.factor} days.`;
    } else {
      parsed.minutes = minutes;
      parsed.rounded = Math.abs(exact - minutes) > 1e-9;
    }
  }

  const threshold = draft.threshold.trim();
  if (!threshold) {
    parsed.thresholdError = "Enter a percentage.";
  } else if (!WHOLE.test(threshold) || Number(threshold) < 1 || Number(threshold) > 99) {
    parsed.thresholdError = "Use a whole number from 1 to 99.";
  } else {
    parsed.threshold = Number(threshold);
  }

  return parsed;
}

export function SlaAdmin({ rules }: { rules: SlaRule[] }) {
  const byPriority = new Map(rules.map((rule) => [rule.priority, rule]));

  // Saved targets, for the per-card check that a less urgent priority is not
  // promised a faster turnaround than a more urgent one.
  const saved: Partial<Record<TicketPriority, number>> = Object.fromEntries(
    rules.map((rule) => [rule.priority, rule.duration_minutes]),
  );

  return (
    <StaggerChildren className="space-y-4">
      <SlaOverview byPriority={byPriority} />

      {/* Sized by the space the cards actually get, not by the window: the
          sidebar takes a different share at every breakpoint, so a viewport
          query would put four cards in a column too narrow for them. */}
      <div className="@container">
        <div className="grid gap-3 @xl:grid-cols-2 @5xl:grid-cols-4">
          {TICKET_PRIORITIES.map((priority, index) => {
            const rule = byPriority.get(priority);
            return rule ? (
              <SlaCard key={rule.id} rule={rule} saved={saved} index={index} />
            ) : (
              <MissingCard key={priority} priority={priority} index={index} />
            );
          })}
        </div>
      </div>

      <ClockGuide />
    </StaggerChildren>
  );
}

/** Ticks a log axis may show, in minutes: 1m, 15m, 1h, 4h, 1d, 3d, 7d, 30d, 90d. */
const SCALE_TICKS = [1, 15, 60, 240, 1440, 4320, 10080, 43200, 129600];

/**
 * A log scale bounded by the nearest ticks around the data. The lower bound
 * sits strictly below the shortest target so even that bar has length; the
 * upper bound can equal the longest, which simply reaches the end.
 */
function logScale(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const lo = [...SCALE_TICKS].reverse().find((tick) => tick < min) ?? min / 2;
  const hi = SCALE_TICKS.find((tick) => tick >= max) ?? max;
  const span = Math.log(hi / lo);

  return {
    position: (minutes: number) =>
      Math.min(100, Math.max(0, (Math.log(minutes / lo) / span) * 100)),
    ticks: SCALE_TICKS.filter((tick) => tick >= lo && tick <= hi),
  };
}

/**
 * Every saved target on one axis, so the ladder from Urgent to Low reads at a
 * glance — and a rung out of order is visible without opening any card.
 *
 * Logarithmic because the targets span orders of magnitude: on a linear axis
 * a 2-hour Urgent beside a 3-day Low is a sliver nobody can read.
 */
function SlaOverview({ byPriority }: { byPriority: Map<TicketPriority, SlaRule> }) {
  const rows = TICKET_PRIORITIES.map((priority) => {
    const rule = byPriority.get(priority);
    return {
      priority,
      rule,
      minutes: rule?.duration_minutes ?? FALLBACK_MINUTES,
    };
  });
  const scale = logScale(rows.map((row) => row.minutes));
  // Crowded axes keep only their end labels until there is room for the rest.
  const crowded = scale.ticks.length > 5;

  return (
    <section aria-labelledby="sla-overview-title" className="card p-4 sm:p-5">
      <div className="mb-4 border-b border-line pb-3">
        <h2
          id="sla-overview-title"
          className="text-[0.875rem] font-semibold tracking-tight text-ink"
        >
          SLA at a glance
        </h2>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-muted text-pretty">
          All four saved targets on one log scale, so hours and days both stay readable.
        </p>
      </div>

      <div className="@container">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 @md:gap-x-4">
          {rows.map(({ priority, rule, minutes }) => {
            const meta = PRIORITY_META[priority];
            const warnAt = rule
              ? Math.round((minutes * rule.at_risk_threshold_pct) / 100)
              : null;

            return (
              <Fragment key={priority}>
                <Badge tone={meta.tone} className="justify-self-start">
                  {meta.label}
                </Badge>

                <div aria-hidden className="relative h-2.5 rounded-full bg-surface-sunk">
                  <motion.span
                    data-tone={meta.tone}
                    className={cn(
                      "absolute inset-y-0 left-0 rounded-full",
                      !rule && "opacity-35",
                    )}
                    style={{ background: "var(--tone-dot)" }}
                    initial={false}
                    animate={{ width: `${Math.max(scale.position(minutes), 1.5)}%` }}
                    transition={transition.fast}
                  />
                </div>

                <div className="min-w-0 text-right">
                  <p className="tabular text-[0.8125rem] font-semibold leading-tight text-ink">
                    {minutesToExact(minutes)}
                  </p>
                  <p className="tabular hidden text-[0.6875rem] leading-tight text-ink-faint @md:block">
                    {warnAt === null ? "default · not set" : `at risk ${minutesToExact(warnAt)}`}
                  </p>
                </div>
              </Fragment>
            );
          })}

          <span aria-hidden />
          <div aria-hidden className="relative h-4">
            {scale.ticks.map((tick, index) => {
              const left = scale.position(tick);
              const end = index === 0 || index === scale.ticks.length - 1;
              return (
                <span
                  key={tick}
                  style={{ left: `${left}%` }}
                  className={cn(
                    "tabular absolute top-0 whitespace-nowrap text-[0.6875rem] text-ink-faint",
                    // Labels near an edge align to it instead of hanging off.
                    left < 6 ? "" : left > 94 ? "-translate-x-full" : "-translate-x-1/2",
                    !end && (crowded ? "hidden @3xl:block" : "hidden @md:block"),
                  )}
                >
                  {minutesToExact(tick)}
                </span>
              );
            })}
          </div>
          <span aria-hidden />
        </div>
      </div>
    </section>
  );
}

/** Mirrors tickets_before_insert and tickets_apply_state in the database. */
const CLOCK_RULES = [
  {
    icon: Icons.ticket,
    title: "Starts when a ticket is raised",
    body: "The due time is set at creation from the priority's target. A routing rule that raises the priority applies first.",
  },
  {
    icon: Icons.pause,
    title: "Pauses while waiting",
    body: "Waiting on the requester stops the clock. The due time then shifts by however long it waited.",
  },
  {
    icon: Icons.refresh,
    title: "Restarts when reopened",
    body: "A reopened ticket gets a fresh SLA from the moment it reopens, at its current priority.",
  },
  {
    icon: Icons.clock,
    title: "Changes apply going forward",
    body: "New tickets use a target once it is saved. Open tickets re-target only when their priority changes; resolved ones keep the SLA they were judged against.",
  },
];

function ClockGuide() {
  return (
    <section aria-labelledby="sla-clock-title" className="space-y-2.5">
      <h2 id="sla-clock-title" className="text-[0.875rem] font-semibold tracking-tight text-ink">
        How the SLA clock works
      </h2>
      {/* Same container breakpoints as the priority cards, so the two rows of
          four line up column for column. */}
      <div className="@container">
        <ul className="grid gap-3 @xl:grid-cols-2 @5xl:grid-cols-4">
          {CLOCK_RULES.map(({ icon: Icon, title, body }) => (
            <li key={title} className="card flex min-w-0 gap-3 p-4">
              <span className="flex size-8 flex-none items-center justify-center rounded-lg border border-line bg-surface text-ink-faint">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[0.8125rem] font-medium text-ink">{title}</p>
                <p className="mt-1 text-[0.75rem] leading-relaxed text-ink-muted text-pretty">
                  {body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function SlaCard({
  rule,
  saved,
  index,
}: {
  rule: SlaRule;
  saved: Partial<Record<TicketPriority, number>>;
  index: number;
}) {
  const router = useRouter();
  const { push } = useToast();
  const isClient = useIsClient();
  const meta = PRIORITY_META[rule.priority];

  const server: Values = { minutes: rule.duration_minutes, threshold: rule.at_risk_threshold_pct };

  const [draft, setDraft] = useState<Draft>(() => draftFrom(server));
  const [base, setBase] = useState<Values>(server);
  // Values this card just saved, until the refresh carrying them arrives —
  // without it the card reads "Unsaved changes" for a beat after saving.
  const [justSaved, setJustSaved] = useState<Values | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);

  const parsed = parseDraft(draft);
  const matches = (values: Values) =>
    parsed.minutes === values.minutes && parsed.threshold === values.threshold;

  // The rule changed on the server: this card's own save landing, or another
  // admin. An untouched card follows the server; a card with edits in
  // progress keeps them and says the ground moved, rather than discarding
  // someone's typing or silently saving over a change they never saw.
  if (server.minutes !== base.minutes || server.threshold !== base.threshold) {
    setBase(server);
    setJustSaved(null);
    if (matches(server)) {
      setConflict(false);
    } else if (matches(base)) {
      setDraft(draftFrom(server));
      setConflict(false);
    } else {
      setConflict(true);
    }
  }

  const dirty = !matches(justSaved ?? server);
  const valid = parsed.minutes !== null && parsed.threshold !== null;

  // Leaving with unsaved edits loses them; reloads and closed tabs at least ask.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // What the card illustrates: the edit when it is valid, otherwise what is saved.
  const shownMinutes = parsed.minutes ?? server.minutes;
  const shownThreshold = parsed.threshold ?? server.threshold;

  const ladder = ladderWarning(rule.priority, shownMinutes, saved);

  async function save() {
    if (!dirty || parsed.minutes === null || parsed.threshold === null || saving) return;
    const values = { minutes: parsed.minutes, threshold: parsed.threshold };

    setSaving(true);
    try {
      await api(`/api/admin/sla/${rule.id}`, {
        method: "PATCH",
        json: { duration_minutes: values.minutes, at_risk_threshold_pct: values.threshold },
      });
      setJustSaved(values);
      setConflict(false);
      push({ tone: "success", title: `${meta.label} SLA updated` });
      router.refresh();
    } catch (error) {
      push({
        tone: "error",
        title: "Could not save",
        description: error instanceof ApiClientError ? error.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setDraft(draftFrom(server));
    setJustSaved(null);
    setConflict(false);
  }

  function changeUnit(unit: Unit) {
    // Converting keeps the SLA the same length; only the way it is written
    // changes. An amount that does not parse yet is left as typed.
    setDraft((current) => {
      const minutes = parseDraft(current).minutes;
      return {
        ...current,
        unit,
        amount: minutes !== null ? amountFor(minutes, unit) : current.amount,
      };
    });
  }

  const amountId = `sla-amount-${rule.id}`;
  const thresholdId = `sla-threshold-${rule.id}`;

  return (
    <motion.form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...transition.fast, delay: Math.min(index, 8) * 0.03 }}
      aria-label={`${meta.label} priority SLA`}
      className="card group relative flex min-w-0 flex-col overflow-hidden"
    >
      {/* The same corner bloom as the department cards, so the two admin
          grids read as one family. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0",
          "opacity-0 transition-opacity duration-300 ease-[var(--ease-standard)]",
          "group-hover:opacity-100 group-focus-within:opacity-100",
        )}
        style={{
          background: "radial-gradient(9rem 7rem at 100% 0%, var(--shimmer), transparent 72%)",
        }}
      />

      <div className="relative flex flex-1 flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-2">
          <Badge tone={meta.tone}>{meta.label}</Badge>
          {dirty && (
            <Badge tone="amber" emphasis="quiet">
              Unsaved
            </Badge>
          )}
        </div>

        <div className="min-w-0">
          <p className="tabular break-words text-[1.75rem] font-semibold leading-none tracking-tight text-ink">
            {minutesToExact(shownMinutes)}
          </p>
          <p className="mt-1.5 text-[0.75rem] text-ink-faint">
            {dirty && parsed.minutes !== null && parsed.minutes !== server.minutes
              ? `to resolve · was ${minutesToExact(server.minutes)}`
              : "to resolve"}
          </p>
        </div>

        <Timeline minutes={shownMinutes} threshold={shownThreshold} />

        <div className="mt-auto space-y-3.5 border-t border-line pt-4">
          <Field
            label="Resolve within"
            htmlFor={amountId}
            error={parsed.minutesError}
            hint={
              parsed.rounded && parsed.minutes !== null
                ? `Rounded to ${minutesToExact(parsed.minutes)} — SLAs are kept in whole minutes.`
                : undefined
            }
          >
            <div className="flex gap-2">
              <Input
                id={amountId}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                enterKeyHint="done"
                value={draft.amount}
                aria-invalid={parsed.minutesError ? true : undefined}
                aria-describedby={`${amountId}-message`}
                onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
                className="tabular min-w-0 flex-1"
              />
              <Select
                value={draft.unit}
                aria-label={`${meta.label} SLA unit`}
                onChange={(e) => changeUnit(e.target.value as Unit)}
                className="w-[6.5rem] flex-none"
              >
                {(Object.keys(UNITS) as Unit[]).map((unit) => (
                  <option key={unit} value={unit}>
                    {UNITS[unit].label}
                  </option>
                ))}
              </Select>
            </div>
          </Field>

          <Field label="Flag as at-risk at" htmlFor={thresholdId} error={parsed.thresholdError}>
            <div className="relative">
              <Input
                id={thresholdId}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                enterKeyHint="done"
                value={draft.threshold}
                aria-invalid={parsed.thresholdError ? true : undefined}
                aria-describedby={`${thresholdId}-message`}
                onChange={(e) => setDraft((d) => ({ ...d, threshold: e.target.value }))}
                className="tabular pr-14"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[0.8125rem] text-ink-faint"
              >
                % used
              </span>
            </div>
          </Field>

          {conflict && (
            <p role="status" className="text-[0.75rem] leading-relaxed text-ink-muted">
              <span className="font-medium text-[var(--spec-warn)]">Changed elsewhere.</span>{" "}
              It is now {minutesToExact(server.minutes)} at {server.threshold}%. Save to replace
              that, or reset to keep it.
            </p>
          )}

          {ladder && (
            <p className="text-[0.75rem] leading-relaxed text-ink-muted">
              <span className="font-medium text-[var(--spec-warn)]">Check the order.</span>{" "}
              {ladder}
            </p>
          )}
        </div>
      </div>

      <div className="relative flex min-h-[3.25rem] flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line px-4 py-2.5">
        <p className="min-w-0 text-[0.75rem] text-ink-faint" aria-live="polite">
          {saving ? (
            "Saving…"
          ) : dirty ? (
            <span className="text-ink-muted">Unsaved changes</span>
          ) : isClient ? (
            `Updated ${relativeTime(rule.updated_at)}`
          ) : (
            "Saved"
          )}
        </p>
        <div className="ml-auto flex flex-none items-center gap-1.5">
          {dirty && !saving && (
            <Button type="button" size="sm" variant="ghost" onClick={reset}>
              Reset
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            variant={dirty && valid ? "primary" : "secondary"}
            disabled={!dirty || !valid}
            loading={saving}
          >
            Save
          </Button>
        </div>
      </div>
    </motion.form>
  );
}

/**
 * The SLA as a strip: on track, then at risk from the threshold, then the
 * breach at the end. Proportions follow the threshold, so 60% and 90% look
 * different at a glance.
 */
function Timeline({ minutes, threshold }: { minutes: number; threshold: number }) {
  const warnAt = Math.round((minutes * threshold) / 100);

  return (
    <div>
      <div
        role="img"
        aria-label={`On track until ${minutesToExact(warnAt)}, at risk from then, breached after ${minutesToExact(minutes)}.`}
        className="flex h-2 gap-[3px]"
      >
        <motion.span
          className="rounded-l-full"
          style={{ background: "var(--spec-ok)", flexBasis: 0 }}
          initial={false}
          animate={{ flexGrow: threshold }}
          transition={transition.fast}
        />
        <motion.span
          style={{ background: "var(--spec-warn)", flexBasis: 0 }}
          initial={false}
          animate={{ flexGrow: 100 - threshold }}
          transition={transition.fast}
        />
        <span
          className="w-1.5 flex-none rounded-r-full"
          style={{ background: "var(--spec-fail)" }}
        />
      </div>

      <dl className="mt-3 space-y-1.5 text-[0.75rem]">
        <LegendRow color="var(--spec-ok)" label="On track" value={`until ${minutesToExact(warnAt)}`} />
        <LegendRow color="var(--spec-warn)" label="At risk" value={`from ${minutesToExact(warnAt)}`} />
        <LegendRow color="var(--spec-fail)" label="Breached" value={`after ${minutesToExact(minutes)}`} />
      </dl>
    </div>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <dt className="flex min-w-0 items-center gap-2 text-ink-muted">
        <span aria-hidden className="size-1.5 flex-none rounded-full" style={{ background: color }} />
        {label}
      </dt>
      <dd className="tabular text-right text-ink">{value}</dd>
    </div>
  );
}

/**
 * A less urgent priority promised a faster turnaround than a more urgent one
 * is almost always a typo — "8" left in minutes instead of hours. Worth a
 * nudge, not a block: an unusual order can still be deliberate.
 */
function ladderWarning(
  priority: TicketPriority,
  minutes: number,
  saved: Partial<Record<TicketPriority, number>>,
) {
  const rank = PRIORITY_META[priority].rank;

  for (const other of TICKET_PRIORITIES) {
    const otherMinutes = saved[other];
    if (other === priority || otherMinutes === undefined) continue;
    const otherRank = PRIORITY_META[other].rank;

    if (otherRank < rank && minutes < otherMinutes) {
      return `Shorter than ${PRIORITY_META[other].label} (${minutesToExact(otherMinutes)}), which is more urgent.`;
    }
    if (otherRank > rank && minutes > otherMinutes) {
      return `Longer than ${PRIORITY_META[other].label} (${minutesToExact(otherMinutes)}), which is less urgent.`;
    }
  }
  return null;
}

/**
 * sla_rules ships with all four priorities and the app has no way to delete
 * one, but a row removed in the database would otherwise make a priority
 * vanish from this screen while tickets quietly ran on the fallback.
 */
function MissingCard({ priority, index }: { priority: TicketPriority; index: number }) {
  const meta = PRIORITY_META[priority];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...transition.fast, delay: Math.min(index, 8) * 0.03 }}
      className="card flex min-w-0 flex-col gap-4 p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <Badge tone="slate" emphasis="quiet">
          Not set
        </Badge>
      </div>
      <div>
        <p className="tabular text-[1.75rem] font-semibold leading-none tracking-tight text-ink-faint">
          {minutesToExact(FALLBACK_MINUTES)}
        </p>
        <p className="mt-1.5 text-[0.75rem] text-ink-faint">default</p>
      </div>
      <p className="text-[0.75rem] leading-relaxed text-ink-muted">
        No rule is saved for this priority, so new {meta.label.toLowerCase()} tickets get the{" "}
        {minutesToExact(FALLBACK_MINUTES)} default. It has to be restored in the database before
        it can be edited here.
      </p>
    </motion.div>
  );
}
