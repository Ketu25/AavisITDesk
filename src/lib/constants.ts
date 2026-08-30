import type { TicketPriority, TicketStatus, UserRole, UserStatus } from "@/lib/database.types";
import type { SlaState } from "@/lib/sla";

/** Tone names resolve to CSS custom properties defined in globals.css, so a
 *  status colour is identical in every surface and in both themes. */
export type Tone =
  | "sky" | "violet" | "amber" | "orange" | "fuchsia" | "emerald" | "rose" | "slate";

type Meta = { label: string; tone: Tone };

export const STATUS_META: Record<TicketStatus, Meta> = {
  new:             { label: "New",         tone: "sky" },
  assigned:        { label: "Assigned",    tone: "violet" },
  in_progress:     { label: "In progress", tone: "amber" },
  waiting_on_user: { label: "Waiting",     tone: "fuchsia" },
  resolved:        { label: "Resolved",    tone: "emerald" },
  closed:          { label: "Closed",      tone: "slate" },
  reopened:        { label: "Reopened",    tone: "rose" },
};

export const PRIORITY_META: Record<TicketPriority, Meta & { rank: number }> = {
  urgent: { label: "Urgent", tone: "rose",   rank: 0 },
  high:   { label: "High",   tone: "orange", rank: 1 },
  normal: { label: "Normal", tone: "sky",    rank: 2 },
  low:    { label: "Low",    tone: "slate",  rank: 3 },
};

export const SLA_META: Record<SlaState, Meta> = {
  on_track: { label: "On track", tone: "emerald" },
  at_risk:  { label: "At risk",  tone: "amber" },
  breached: { label: "Breached", tone: "rose" },
  paused:   { label: "Paused",   tone: "slate" },
  met:      { label: "Met",      tone: "emerald" },
  none:     { label: "No SLA",   tone: "slate" },
};

export const ROLE_META: Record<UserRole, Meta & { blurb: string }> = {
  user:  { label: "User",  tone: "slate",
           blurb: "Submits and tracks their own tickets." },
  agent: { label: "Agent", tone: "violet",
           blurb: "Everything a user can do, plus works the shared queue." },
  admin: { label: "Admin", tone: "amber",
           blurb: "Everything an agent can do, plus user, department and rule management." },
};

export const USER_STATUS_META: Record<UserStatus, Meta> = {
  pending:  { label: "Pending",  tone: "amber" },
  active:   { label: "Active",   tone: "emerald" },
  disabled: { label: "Disabled", tone: "slate" },
};

/** Transitions an agent may drive from the ticket detail view. */
export const AGENT_NEXT_STATUS: Record<TicketStatus, TicketStatus[]> = {
  new:             ["in_progress", "waiting_on_user", "resolved"],
  assigned:        ["in_progress", "waiting_on_user", "resolved"],
  in_progress:     ["waiting_on_user", "resolved"],
  waiting_on_user: ["in_progress", "resolved"],
  reopened:        ["in_progress", "waiting_on_user", "resolved"],
  resolved:        ["in_progress", "closed"],
  closed:          ["in_progress"],
};

export const OPEN_STATUSES: TicketStatus[] = [
  "new", "assigned", "in_progress", "waiting_on_user", "reopened",
];

export const STATUS_LABEL = (s: TicketStatus) => STATUS_META[s].label;
