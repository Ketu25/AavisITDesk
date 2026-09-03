"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { PRIORITY_META, SLA_META, STATUS_META } from "@/lib/constants";
import { computeSla } from "@/lib/sla";
import { duration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SlaRule, Ticket, TicketPriority, TicketStatus } from "@/lib/database.types";

export function StatusPill({ status }: { status: TicketStatus }) {
  const meta = STATUS_META[status];
  // Categorical: no hue, just the label and a dot for shape.
  return <Badge tone={meta.tone} emphasis="quiet">{meta.label}</Badge>;
}

export function PriorityPill({ priority }: { priority: TicketPriority }) {
  const meta = PRIORITY_META[priority];
  // Ordered, so the dot keeps its rank colour while the chip stays quiet.
  return <Badge tone={meta.tone} emphasis="quiet">{meta.label}</Badge>;
}

type SlaTicket = Pick<
  Ticket,
  "sla_due_at" | "sla_paused_at" | "created_at" | "resolved_at" | "status" | "priority"
>;

/**
 * Ticks a clock in state and derives the snapshot during render, so "at risk"
 * appears without a page reload and the ticket's own props stay the source of
 * truth for everything else.
 */
export function useSla(
  ticket: SlaTicket,
  rules?: Partial<Record<TicketPriority, SlaRule>>,
  /** Lists tick slowly; a dial the user is actually looking at ticks every second. */
  intervalMs = 30_000,
) {
  // Seeded once via a lazy initialiser, then advanced only by the interval
  // below — every render after the first reads it from state, not the clock.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return useMemo(() => computeSla(ticket, rules, now), [ticket, rules, now]);
}

export function SlaPill({
  ticket,
  rules,
  showRemaining = true,
}: {
  ticket: SlaTicket;
  rules?: Partial<Record<TicketPriority, SlaRule>>;
  showRemaining?: boolean;
}) {
  const sla = useSla(ticket, rules);
  const meta = SLA_META[sla.state];

  if (sla.state === "none") return null;

  const suffix =
    showRemaining && (sla.state === "on_track" || sla.state === "at_risk")
      ? ` · ${duration(sla.remainingMs)} left`
      : showRemaining && sla.state === "breached" && ticket.status !== "resolved" && ticket.status !== "closed"
        ? ` · ${duration(sla.remainingMs)} over`
        : "";

  return (
    <Badge tone={meta.tone}>
      <span className="readout">
        {meta.label}
        {suffix}
      </span>
    </Badge>
  );
}

/** Thin progress bar version, for the ticket detail sidebar. */
export function SlaMeter({
  ticket,
  rules,
}: {
  ticket: SlaTicket;
  rules?: Partial<Record<TicketPriority, SlaRule>>;
}) {
  const sla = useSla(ticket, rules);
  if (sla.state === "none") return null;

  const meta = SLA_META[sla.state];
  const pct = Math.min(Math.max(sla.progress, 0), 1) * 100;

  return (
    <div data-tone={meta.tone} className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-faint">
          SLA
        </span>
        <span className="tabular text-[0.75rem] font-medium" style={{ color: "var(--tone-fg)" }}>
          {meta.label}
          {sla.state !== "met" &&
            sla.state !== "paused" &&
            ` · ${duration(sla.remainingMs)} ${sla.remainingMs < 0 ? "over" : "left"}`}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunk">
        <div
          className={cn("h-full rounded-full transition-[width] duration-700 ease-out")}
          style={{ width: `${pct}%`, background: "var(--tone-dot)" }}
        />
      </div>
    </div>
  );
}
