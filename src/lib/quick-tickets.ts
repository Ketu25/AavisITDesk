import {
  QUICK_TICKET_ICONS,
  QUICK_TICKET_LIMITS,
  TICKET_LIMITS,
  type QuickTicketIcon,
} from "@/lib/constants";
import { TICKET_PRIORITIES, type TicketPriority } from "@/lib/database.types";

/**
 * Quick tickets, as the requester side sees them, and the one place a quick
 * ticket's text is turned into a ticket's.
 *
 * Pure and dependency-free so the confirm dialog can preview a ticket with the
 * exact function the API uses to write it: what the requester checks is what
 * IT receives, character for character.
 */

/** One quick ticket a requester can raise right now. */
export type QuickIssue = {
  id: string;
  /** Sent back on raise; a mismatch means IT edited it while it was on screen. */
  revision: number;
  label: string;
  subject: string;
  description: string;
  /** As written by the admin — what is inserted. */
  priority: TicketPriority;
  /** What the ticket starts at once the category's default has applied. */
  startsAt: TicketPriority;
  detail_prompt: string | null;
  detail_required: boolean;
  category: string;
  group: { id: string; name: string; icon: QuickTicketIcon };
};

export type QuickGroup = {
  id: string;
  name: string;
  description: string | null;
  icon: QuickTicketIcon;
  issues: QuickIssue[];
};

/** The columns a requester-facing list reads, with what decides whether each is live. */
export const QUICK_ISSUE_SELECT = `
  id, revision, label, subject, description, priority, detail_prompt, detail_required,
  is_active, sort_order,
  group:quick_ticket_groups(id, name, description, icon, is_active, sort_order),
  rule:routing_rules(category, is_active, default_priority)
` as const;

export function isQuickIcon(value: unknown): value is QuickTicketIcon {
  return typeof value === "string" && (QUICK_TICKET_ICONS as readonly string[]).includes(value);
}

function isPriority(value: unknown): value is TicketPriority {
  return typeof value === "string" && (TICKET_PRIORITIES as string[]).includes(value);
}

/**
 * Mirrors tickets_before_insert: a category's default lifts a ticket that
 * would otherwise start at Normal, and leaves any other urgency alone.
 */
export function effectivePriority(
  priority: TicketPriority,
  categoryDefault: TicketPriority | null | undefined,
): TicketPriority {
  return priority === "normal" && categoryDefault ? categoryDefault : priority;
}

/** PostgREST hands a many-to-one embed back as an object, but an array is not worth crashing on. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

type Row = Record<string, unknown>;

type Read = {
  issue: QuickIssue;
  groupDescription: string | null;
  groupOrder: number;
  order: number;
};

/**
 * Admins can read hidden rows through RLS, so "live" is decided here,
 * explicitly: the quick ticket, its group and its category must all be
 * switched on, exactly as the insert trigger requires.
 */
function read(row: Row | null | undefined): Read | null {
  if (!row || row.is_active !== true) return null;
  const group = one(row.group as Row | Row[] | null);
  const rule = one(row.rule as Row | Row[] | null);
  if (!group || group.is_active !== true || !rule || rule.is_active !== true) return null;
  if (!isPriority(row.priority) || typeof rule.category !== "string") return null;

  const categoryDefault = isPriority(rule.default_priority) ? rule.default_priority : null;
  const prompt =
    typeof row.detail_prompt === "string" && row.detail_prompt.trim() ? row.detail_prompt.trim() : null;

  return {
    issue: {
      id: String(row.id),
      revision: Number(row.revision),
      label: String(row.label),
      subject: String(row.subject),
      description: String(row.description),
      priority: row.priority,
      startsAt: effectivePriority(row.priority, categoryDefault),
      detail_prompt: prompt,
      // A required answer with no question to answer is not something anyone can satisfy.
      detail_required: prompt !== null && row.detail_required === true,
      category: rule.category,
      group: {
        id: String(group.id),
        name: String(group.name),
        icon: isQuickIcon(group.icon) ? group.icon : "bolt",
      },
    },
    groupDescription:
      typeof group.description === "string" && group.description.trim() ? group.description : null,
    groupOrder: Number(group.sort_order) || 0,
    order: Number(row.sort_order) || 0,
  };
}

/** A row read with QUICK_ISSUE_SELECT, as a requester may raise it — or null when it is not live. */
export function toQuickIssue(row: Row | null | undefined): QuickIssue | null {
  return read(row)?.issue ?? null;
}

/** Live quick tickets, grouped and in the order the admin set. Empty groups are left out. */
export function groupQuickIssues(rows: Row[] | null | undefined): QuickGroup[] {
  const live = (rows ?? [])
    .map(read)
    .filter((entry): entry is Read => entry !== null)
    .sort(
      (a, b) =>
        a.groupOrder - b.groupOrder ||
        a.issue.group.name.localeCompare(b.issue.group.name) ||
        a.issue.group.id.localeCompare(b.issue.group.id) ||
        a.order - b.order ||
        a.issue.label.localeCompare(b.issue.label),
    );

  // Insertion order is the sorted order, and a Map keeps it.
  const groups = new Map<string, QuickGroup>();
  for (const { issue, groupDescription } of live) {
    let group = groups.get(issue.group.id);
    if (!group) {
      group = { ...issue.group, description: groupDescription, issues: [] };
      groups.set(issue.group.id, group);
    }
    group.issues.push(issue);
  }
  return [...groups.values()];
}

/** Collapses runs of whitespace, newlines included: an answer goes into a one-line title. */
export function oneLine(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * At most `max` characters, counted the way Postgres counts them — by code
 * point — and never cutting an emoji in half. A lone surrogate is not valid
 * JSON text, so a sliced one would fail the whole request.
 */
export function clip(text: string, max: number) {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join("");
}

export const charCount = (text: string) => Array.from(text).length;

const TITLE_SEPARATOR = " · ";
/** Below this much room, an answer squeezed into the title says nothing useful. */
const MIN_TITLE_ROOM = 6;

/**
 * The ticket a quick ticket raises. The answer to the admin's question joins
 * the title — five "Printer: paper jam" tickets are indistinguishable in the
 * queue, five "Printer: paper jam · 2nd floor HP" are not — and goes into the
 * details in full under its question, followed by the requester's own note.
 */
export function composeQuickTicket(
  template: Pick<QuickIssue, "subject" | "description" | "detail_prompt">,
  input: { answer?: string; note?: string },
) {
  const answer = clip(oneLine(input.answer ?? ""), QUICK_TICKET_LIMITS.answerMax);
  const note = clip((input.note ?? "").trim(), QUICK_TICKET_LIMITS.noteMax);

  let subject = clip(template.subject.trim(), TICKET_LIMITS.subjectMax);
  if (answer) {
    const room = TICKET_LIMITS.subjectMax - charCount(subject) - TITLE_SEPARATOR.length;
    if (room >= MIN_TITLE_ROOM) {
      subject +=
        TITLE_SEPARATOR +
        (charCount(answer) > room ? `${clip(answer, room - 1).trimEnd()}…` : answer);
    }
  }

  const parts = [template.description.trim()];
  if (answer) parts.push(`${template.detail_prompt?.trim() || "Details"}\n${answer}`);
  if (note) parts.push(`Note:\n${note}`);

  return { subject, description: parts.join("\n\n") };
}

const ICON_HINTS: [RegExp, QuickTicketIcon][] = [
  [/print|scan|copier|toner|label|paper/i, "printer"],
  [/drive|folder|file|share|onedrive|sharepoint|document/i, "folder"],
  [/wi-?fi|network|internet|vpn|connect|lan\b/i, "wifi"],
  [/mail|outlook|inbox/i, "mail"],
  [/laptop|computer|\bpc\b|monitor|screen|desktop|dock|keyboard|mouse/i, "monitor"],
  [/phone|teams|call|meeting|conferenc|headset/i, "phone"],
  [/password|account|log\s?in|sign.?in|access|mfa|permission/i, "key"],
  [/secur|phish|virus|malware|spam|suspicious/i, "shield"],
  [/software|\bapps?\b|install|licen|erp|system|update/i, "app"],
  [/repair|equipment|facilit|maintenance|badge|camera|terminal/i, "wrench"],
];

/** A first guess at a new group's icon from its name; the admin can change it. */
export function guessIcon(name: string): QuickTicketIcon {
  return ICON_HINTS.find(([pattern]) => pattern.test(name))?.[1] ?? "bolt";
}
