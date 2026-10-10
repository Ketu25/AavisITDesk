"use client";

import { useId, useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { BarList } from "@/components/reports/charts";
import { Reveal } from "@/components/motion";
import { useNow } from "@/components/ui/use-now";
import { duration } from "@/lib/format";
import { spring, stagger } from "@/lib/motion";
import { safeTimeZone } from "@/lib/timezone";

/**
 * A requester's last year at a glance: how often they needed IT, for what, and
 * how long a fix usually takes.
 *
 * Months are the reader's months. A ticket raised at 1 am on the 1st in
 * Mumbai is still the 31st in UTC, so bucketing on the server's clock would
 * file it under the wrong month — the zone comes from the reader's cookie on
 * the server and from the browser itself once it is running.
 */

export type HistoryRow = { created_at: string; category: string; resolved_at: string | null };

const MONTHS = 12;
/** Below this there is no pattern to show, only a list with extra steps. */
const MIN_TICKETS = 3;
const TOP_CATEGORIES = 4;

const SHORT_MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const LONG_MONTH = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

type YearMonth = { year: number; month: number };

function yearMonth(at: number | Date, format: Intl.DateTimeFormat): YearMonth {
  let year = 0;
  let month = 0;
  for (const part of format.formatToParts(at)) {
    if (part.type === "year") year = Number(part.value);
    else if (part.type === "month") month = Number(part.value);
  }
  return { year, month };
}

function monthFormat(timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric" });
}

export function summarizeHistory(rows: HistoryRow[], timeZone: string, current: YearMonth) {
  const format = monthFormat(timeZone);

  // Twelve slots ending with the current month. Arithmetic on the 1st at UTC
  // midnight, so stepping back a month never overflows a day or meets a DST
  // change, and the labels format identically on the server and the client.
  const months: { key: string; label: string; long: string; count: number }[] = [];
  const slots = new Map<string, number>();
  for (let back = MONTHS - 1; back >= 0; back--) {
    const first = new Date(Date.UTC(current.year, current.month - 1 - back, 1));
    const key = `${first.getUTCFullYear()}-${first.getUTCMonth() + 1}`;
    slots.set(key, months.length);
    months.push({ key, label: SHORT_MONTH.format(first), long: LONG_MONTH.format(first), count: 0 });
  }

  const categories = new Map<string, number>();
  const fixes: number[] = [];
  let total = 0;

  for (const row of rows) {
    const created = new Date(row.created_at);
    if (Number.isNaN(created.getTime())) continue;

    const { year, month } = yearMonth(created, format);
    const slot = slots.get(`${year}-${month}`);
    // The server over-fetches by a few weeks so every zone's twelve months are
    // covered; whatever falls outside this reader's window is dropped here.
    if (slot === undefined) continue;

    months[slot].count++;
    total++;
    categories.set(row.category, (categories.get(row.category) ?? 0) + 1);

    if (row.resolved_at) {
      const took = new Date(row.resolved_at).getTime() - created.getTime();
      if (Number.isFinite(took) && took >= 0) fixes.push(took);
    }
  }

  // The median, not the mean: one ticket that sat for a month over a holiday
  // should not make every fix look slow.
  fixes.sort((a, b) => a - b);
  const mid = Math.floor(fixes.length / 2);
  const typicalFix =
    fixes.length === 0 ? null : fixes.length % 2 ? fixes[mid] : (fixes[mid - 1] + fixes[mid]) / 2;

  const ranked = [...categories.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const byCategory =
    ranked.length <= TOP_CATEGORIES
      ? ranked
      : [
          ...ranked.slice(0, TOP_CATEGORIES - 1),
          {
            label: "Everything else",
            count: ranked.slice(TOP_CATEGORIES - 1).reduce((sum, c) => sum + c.count, 0),
            meta: `${ranked.length - (TOP_CATEGORIES - 1)} categories`,
          },
        ];

  return { months, total, byCategory, typicalFix, fixedCount: fixes.length };
}

export function TicketHistory({
  rows,
  serverTimeZone,
  serverNow,
  partial = false,
}: {
  rows: HistoryRow[];
  /** What the server rendered with, so hydration draws the same months. */
  serverTimeZone: string;
  serverNow: number;
  /** The server stopped short of the whole history. */
  partial?: boolean;
}) {
  const reduced = useReducedMotion();
  const headingId = useId();
  const now = useNow();

  // Server and hydration pass: the server's zone and moment. Afterwards: this
  // browser's own. Usually they agree; on a first visit, before the zone
  // cookie exists, this is where the months are corrected.
  const zone =
    now === null
      ? serverTimeZone
      : (safeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? serverTimeZone);
  const current = yearMonth(now ?? serverNow, monthFormat(zone));

  const summary = useMemo(
    () => summarizeHistory(rows, zone, { year: current.year, month: current.month }),
    [rows, zone, current.year, current.month],
  );

  if (summary.total < MIN_TICKETS) return null;

  const max = Math.max(...summary.months.map((m) => m.count), 1);
  const described = summary.months.map((m) => `${m.long}: ${m.count}`).join(", ");

  return (
    <Reveal index={2} role="region" aria-labelledby={headingId} className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={headingId} className="eyebrow">
          Your history
        </h2>
        <span className="text-[0.75rem] text-ink-faint">Last 12 months</span>
      </div>

      <div className="card grid gap-6 p-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-8 sm:p-5">
        <div className="min-w-0">
          <p className="flex items-baseline gap-2">
            <span className="readout text-[1.75rem] font-semibold leading-none text-ink">
              {summary.total}
            </span>
            <span className="text-[0.8125rem] text-ink-muted">
              {summary.total === 1 ? "ticket" : "tickets"} raised
            </span>
          </p>

          <div className="mt-5" role="img" aria-label={`Tickets raised per month. ${described}.`}>
            <div className="flex h-24 items-end gap-1 sm:gap-1.5">
              {summary.months.map((month, i) => {
                const isCurrent = i === summary.months.length - 1;
                return (
                  <div
                    key={month.key}
                    title={`${month.long}: ${month.count} ${month.count === 1 ? "ticket" : "tickets"}`}
                    className="flex h-full min-w-0 flex-1 flex-col justify-end"
                  >
                    {month.count > 0 ? (
                      <motion.div
                        className="w-full origin-bottom rounded-t-[4px]"
                        style={{
                          // A floor, so a one-ticket month beside a busy one is
                          // still a bar and not a hairline.
                          height: `${Math.max(month.count / max, 0.08) * 100}%`,
                          background: "var(--accent)",
                          opacity: isCurrent ? 1 : 0.5,
                        }}
                        initial={reduced ? false : { scaleY: 0 }}
                        animate={{ scaleY: 1 }}
                        transition={
                          reduced ? { duration: 0 } : { ...spring.gentle, delay: stagger(i, 0.03) }
                        }
                      />
                    ) : (
                      <div className="h-[2px] w-full rounded-full bg-line-strong" />
                    )}
                  </div>
                );
              })}
            </div>
            <div aria-hidden className="mt-1.5 flex gap-1 sm:gap-1.5">
              {summary.months.map((month, i) => (
                <span
                  key={month.key}
                  className={
                    i === summary.months.length - 1
                      ? "readout min-w-0 flex-1 text-center text-[0.5625rem] font-medium text-ink sm:text-[0.625rem]"
                      : "readout min-w-0 flex-1 text-center text-[0.5625rem] text-ink-faint sm:text-[0.625rem]"
                  }
                >
                  {month.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-5">
          <div>
            <p className="eyebrow">Typically fixed in</p>
            {summary.typicalFix === null ? (
              <p className="mt-2 text-[0.8125rem] text-ink-muted">
                Nothing fixed in this period yet.
              </p>
            ) : (
              <>
                <p className="readout mt-2 text-xl font-semibold leading-none text-ink">
                  {duration(summary.typicalFix)}
                </p>
                <p className="mt-1.5 text-[0.75rem] text-ink-faint">
                  {summary.fixedCount === 1
                    ? "From raised to resolved, on your one fixed ticket"
                    : `About half of your ${summary.fixedCount} fixed tickets were sorted sooner`}
                </p>
              </>
            )}
          </div>

          <div>
            <p className="eyebrow mb-3">By category</p>
            <BarList data={summary.byCategory} colorByIndex />
          </div>
        </div>
      </div>

      {partial && (
        <p className="text-[0.75rem] text-ink-faint">
          Counted from your {rows.length.toLocaleString("en-US")} most recent tickets.
        </p>
      )}
    </Reveal>
  );
}
