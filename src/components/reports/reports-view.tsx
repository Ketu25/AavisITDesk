"use client";

import { useState, useTransition } from "react";
import { motion } from "motion/react";
import { BarList, ChartCard, Donut, TrendChart } from "./charts";
import { Stat } from "@/components/ui/stat";
import { Spinner } from "@/components/ui/spinner";
import { createClient } from "@/lib/supabase/client";
import { PRIORITY_META, STATUS_META } from "@/lib/constants";
import { minutesToLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ReportSummary } from "@/lib/report-types";
import type { TicketPriority, TicketStatus } from "@/lib/database.types";

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

export function ReportsView({
  initial,
  initialDays,
}: {
  initial: ReportSummary;
  initialDays: number;
}) {
  const [data, setData] = useState(initial);
  const [days, setDays] = useState(initialDays);
  const [pending, startTransition] = useTransition();

  function changeRange(nextDays: number) {
    setDays(nextDays);
    startTransition(async () => {
      const supabase = createClient();
      const { data: next } = await supabase.rpc("report_summary", {
        p_from: new Date(Date.now() - nextDays * 86400000).toISOString(),
        p_to: new Date().toISOString(),
      });
      if (next) setData(next as unknown as ReportSummary);
    });
  }

  const { totals } = data;
  const resolutionRate =
    totals.total > 0 ? Math.round(((totals.resolved + totals.closed) / totals.total) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex rounded-[10px] border border-line bg-surface-sunk p-0.5">
          {RANGES.map((range) => {
            const active = range.days === days;
            return (
              <button
                key={range.days}
                onClick={() => changeRange(range.days)}
                className={cn(
                  "relative rounded-[7px] px-3 py-1.5 text-[0.8125rem] font-medium transition-colors",
                  active ? "text-ink" : "text-ink-faint hover:text-ink-muted",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="report-range"
                    transition={{ type: "spring", stiffness: 480, damping: 36 }}
                    className="absolute inset-0 -z-10 rounded-[7px] border border-line bg-surface shadow-[var(--shadow-sm)]"
                  />
                )}
                {range.label}
              </button>
            );
          })}
        </div>
        {pending && <Spinner className="size-4 text-ink-faint" />}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Tickets raised" value={totals.total} hint={`Last ${days} days`} />
        <Stat
          label="Resolved"
          value={totals.resolved + totals.closed}
          tone="emerald"
          suffix={totals.total ? `· ${resolutionRate}%` : undefined}
          hint="Resolved or closed in range"
        />
        <Stat
          label="Still open"
          value={totals.open}
          tone={totals.breached > 0 ? "amber" : undefined}
          hint={`${totals.unassigned} unassigned · ${totals.breached} breached`}
        />
        <Stat
          label="Reopened"
          value={totals.reopened}
          tone={totals.reopened > 0 ? "rose" : undefined}
          hint="Fixes that didn't stick"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="card p-4">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-faint">
            Average time to resolve
          </p>
          <p className="tabular mt-1.5 text-2xl font-semibold tracking-tight text-ink">
            {minutesToLabel(totals.avg_resolution_minutes)}
          </p>
          <p className="mt-1 text-[0.75rem] text-ink-faint">From creation to resolution</p>
        </div>
        <div className="card p-4">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-faint">
            Average first reply
          </p>
          <p className="tabular mt-1.5 text-2xl font-semibold tracking-tight text-ink">
            {minutesToLabel(totals.avg_first_response_minutes)}
          </p>
          <p className="mt-1 text-[0.75rem] text-ink-faint">
            First time an agent responded publicly
          </p>
        </div>
      </div>

      <ChartCard title="Volume over time" subtitle="Created versus resolved, per day">
        <TrendChart data={data.daily} />
      </ChartCard>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="By department" subtitle="Where the tickets come from">
          <BarList
            data={data.by_department.map((d) => ({
              label: d.label,
              count: d.count,
              meta: d.avg_resolution_minutes
                ? `avg ${minutesToLabel(d.avg_resolution_minutes)}`
                : undefined,
            }))}
            colorByIndex
          />
        </ChartCard>

        <ChartCard title="By category" subtitle="What keeps breaking">
          <BarList data={data.by_category} colorByIndex />
        </ChartCard>

        <ChartCard title="By priority" subtitle="Share of the total">
          <Donut
            data={data.by_priority.map((p) => ({
              label: PRIORITY_META[p.label as TicketPriority]?.label ?? p.label,
              count: p.count,
            }))}
          />
        </ChartCard>

        <ChartCard title="By status" subtitle="Where tickets are sitting right now">
          <BarList
            data={data.by_status.map((s) => ({
              label: STATUS_META[s.label as TicketStatus]?.label ?? s.label,
              count: s.count,
            }))}
            colorByIndex
          />
        </ChartCard>
      </div>

      <ChartCard title="Agent workload" subtitle="Open now, and resolved in this range">
        {data.agents.length === 0 ? (
          <p className="py-6 text-center text-[0.8125rem] text-ink-faint">
            No active agents yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-[0.8125rem]">
              <thead>
                <tr className="border-b border-line text-left text-[0.6875rem] uppercase tracking-wider text-ink-faint">
                  <th className="pb-2 font-semibold">Agent</th>
                  <th className="pb-2 text-right font-semibold">Open</th>
                  <th className="pb-2 text-right font-semibold">Resolved</th>
                  <th className="pb-2 text-right font-semibold">Avg resolve</th>
                </tr>
              </thead>
              <tbody>
                {data.agents.map((agent) => (
                  <tr key={agent.label} className="border-b border-line last:border-b-0">
                    <td className="py-2.5 font-medium text-ink">{agent.label}</td>
                    <td className="tabular py-2.5 text-right text-ink-muted">{agent.open}</td>
                    <td className="tabular py-2.5 text-right text-ink-muted">{agent.resolved}</td>
                    <td className="tabular py-2.5 text-right text-ink-muted">
                      {minutesToLabel(agent.avg_resolution_minutes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
