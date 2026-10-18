import type { QuickTicket, QuickTicketGroup, TicketPriority } from "@/lib/database.types";

/**
 * What Quick ticket setup's card grid (server-rendered) and a group's pop-up
 * (loaded on first open) both read. Kept free of components, so importing it
 * from the pop-up pulls nothing else into the page.
 */

export type QuickUsage = { total: number; recent: number; lastUsedAt: string | null };

export type RuleOption = {
  id: string;
  category: string;
  is_active: boolean;
  default_priority: TicketPriority | null;
};

/**
 * Runs one admin change under a busy key, says how it went, and refreshes the
 * page. Resolves to whether it worked.
 */
export type Act = (key: string, run: () => Promise<unknown>, success: string) => Promise<boolean>;

/** A function the open step puts in front of leaving it, to keep unsaved changes from vanishing. */
export type Guard = (proceed: () => void, kind: "back" | "close") => void;
/** Puts a step's guard in place; returns what takes it down again. */
export type RegisterGuard = (guard: Guard) => () => void;

export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * How a group stands with requesters. Live quick tickets whose category is
 * live too are what a requester can reach — and none at all when the group
 * itself is hidden.
 */
export function groupStats(
  group: QuickTicketGroup,
  items: QuickTicket[],
  ruleById: Map<string, RuleOption>,
  usage: Record<string, QuickUsage>,
) {
  const reachable = group.is_active
    ? items.filter((item) => item.is_active && ruleById.get(item.routing_rule_id)?.is_active).length
    : 0;
  let raised = 0;
  let recent = 0;
  for (const item of items) {
    raised += usage[item.id]?.total ?? 0;
    recent += usage[item.id]?.recent ?? 0;
  }
  return { reachable, raised, recent };
}
