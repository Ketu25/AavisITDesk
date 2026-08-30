import type { SlaRule, Ticket, TicketPriority } from "@/lib/database.types";

export type SlaState = "none" | "paused" | "on_track" | "at_risk" | "breached" | "met";

export type SlaSnapshot = {
  state: SlaState;
  /** 0-1 of the SLA window consumed; can exceed 1 when breached. */
  progress: number;
  remainingMs: number;
  dueAt: Date | null;
  label: string;
};

const DEFAULT_AT_RISK_PCT = 75;

/**
 * Single source of truth for the SLA badge, shared by the queue, the ticket
 * detail and the dashboard so they can never disagree.
 */
export function computeSla(
  ticket: Pick<
    Ticket,
    "sla_due_at" | "sla_paused_at" | "created_at" | "resolved_at" | "status" | "priority"
  >,
  rules?: Partial<Record<TicketPriority, SlaRule>>,
  now: number = Date.now(),
): SlaSnapshot {
  const dueAt = ticket.sla_due_at ? new Date(ticket.sla_due_at) : null;

  if (!dueAt) {
    return { state: "none", progress: 0, remainingMs: 0, dueAt: null, label: "No SLA" };
  }

  const start = new Date(ticket.created_at).getTime();
  const total = Math.max(dueAt.getTime() - start, 1);

  // A finished ticket is judged once, against when it was actually resolved.
  if (ticket.status === "resolved" || ticket.status === "closed") {
    const endedAt = ticket.resolved_at ? new Date(ticket.resolved_at).getTime() : now;
    const met = endedAt <= dueAt.getTime();
    return {
      state: met ? "met" : "breached",
      progress: Math.min((endedAt - start) / total, 1.5),
      remainingMs: dueAt.getTime() - endedAt,
      dueAt,
      label: met ? "Met" : "Breached",
    };
  }

  if (ticket.sla_paused_at) {
    const pausedAt = new Date(ticket.sla_paused_at).getTime();
    return {
      state: "paused",
      progress: Math.min((pausedAt - start) / total, 1),
      remainingMs: dueAt.getTime() - pausedAt,
      dueAt,
      label: "Paused",
    };
  }

  const remainingMs = dueAt.getTime() - now;
  const progress = (now - start) / total;
  const atRiskPct = rules?.[ticket.priority]?.at_risk_threshold_pct ?? DEFAULT_AT_RISK_PCT;

  if (remainingMs <= 0) {
    return { state: "breached", progress, remainingMs, dueAt, label: "Breached" };
  }
  if (progress * 100 >= atRiskPct) {
    return { state: "at_risk", progress, remainingMs, dueAt, label: "At risk" };
  }
  return { state: "on_track", progress, remainingMs, dueAt, label: "On track" };
}

/** Queue ordering: what needs attention first, not what arrived first. */
const STATE_WEIGHT: Record<SlaState, number> = {
  breached: 0,
  at_risk: 1,
  on_track: 2,
  paused: 3,
  none: 4,
  met: 5,
};

export function slaSortValue(snapshot: SlaSnapshot) {
  return STATE_WEIGHT[snapshot.state] * 1e13 + snapshot.remainingMs;
}

export function indexRules(rules: SlaRule[]): Partial<Record<TicketPriority, SlaRule>> {
  return Object.fromEntries(rules.map((r) => [r.priority, r]));
}
