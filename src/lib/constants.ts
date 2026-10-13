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

/** Longest SLA an admin can set. The API enforces it; the SLA screen explains it. */
export const SLA_MAX_MINUTES = 60 * 24 * 90;

/**
 * Lengths a new ticket must fall within, after trimming. Here rather than in
 * lib/validation so the form can check them without shipping zod to the
 * browser; the schema reads the same numbers, so the two cannot drift.
 */
export const TICKET_LIMITS = {
  subjectMin: 3,
  subjectMax: 160,
  descriptionMin: 5,
  descriptionMax: 8000,
} as const;

/**
 * Lengths for quick tickets, after trimming. The quick_tickets migration holds
 * the same numbers as check constraints. A template's details stop well short
 * of a ticket's own limit so the requester's answer and note always fit; the
 * title shares the ticket's limits outright.
 */
export const QUICK_TICKET_LIMITS = {
  groupNameMax: 60,
  groupDescriptionMax: 160,
  labelMin: 2,
  labelMax: 60,
  descriptionMax: 2000,
  promptMin: 3,
  promptMax: 120,
  answerMax: 200,
  noteMax: 2000,
} as const;

/** The icons a quick-ticket group can wear. The migration checks against this same list. */
export const QUICK_TICKET_ICONS = [
  "printer", "folder", "wifi", "mail", "monitor", "phone", "key", "shield", "app", "wrench", "bolt",
] as const;

export type QuickTicketIcon = (typeof QUICK_TICKET_ICONS)[number];

export const QUICK_ICON_LABEL: Record<QuickTicketIcon, string> = {
  printer: "Printer",
  folder: "Folder",
  wifi: "Network",
  mail: "Email",
  monitor: "Computer",
  phone: "Phone",
  key: "Access",
  shield: "Security",
  app: "Software",
  wrench: "Equipment",
  bolt: "General",
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
