import { z } from "zod";
import { TICKET_PRIORITIES, TICKET_STATUSES, USER_ROLES } from "@/lib/database.types";
import {
  QUICK_TICKET_ICONS,
  QUICK_TICKET_LIMITS,
  SLA_MAX_MINUTES,
  TICKET_LIMITS,
} from "@/lib/constants";

export const createTicketSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(TICKET_LIMITS.subjectMin, "Give the ticket a short title.")
    .max(TICKET_LIMITS.subjectMax),
  description: z
    .string()
    .trim()
    .min(TICKET_LIMITS.descriptionMin, "Describe what is happening.")
    .max(TICKET_LIMITS.descriptionMax),
  category: z.string().trim().min(1, "Pick a category."),
  priority: z.enum(TICKET_PRIORITIES),
});

export const updateTicketSchema = z
  .object({
    status: z.enum(TICKET_STATUSES).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    category: z.string().trim().min(1).optional(),
    assigned_to: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const commentSchema = z.object({
  message: z.string().trim().min(1, "Write something first.").max(8000),
  is_internal: z.boolean().optional().default(false),
});

export const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email("That is not a valid email address."),
  full_name: z.string().trim().min(1, "A name is required.").max(120),
  department: z.string().trim().min(1, "Pick a department.").optional().nullable(),
  department_id: z.string().uuid().optional().nullable(),
  role: z.enum(USER_ROLES).default("user"),
  /** Blank means "generate one". Only used when delivery is "temp_password". */
  password: z.string().trim().max(72).optional().nullable(),
  /** Temporary passwords avoid Supabase's ~2/hour auth email cap entirely. */
  delivery: z.enum(["temp_password", "email_invite"]).default("temp_password"),
});

export const tempPasswordSchema = z.object({
  password: z.string().trim().max(72).optional().nullable(),
});

export const updateUserSchema = z
  .object({
    full_name: z.string().trim().min(1).max(120).optional(),
    role: z.enum(USER_ROLES).optional(),
    department_id: z.string().uuid().nullable().optional(),
    status: z.enum(["active", "disabled"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const departmentSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

export const slaRuleSchema = z.object({
  priority: z.enum(TICKET_PRIORITIES),
  duration_minutes: z.number().int().min(1).max(SLA_MAX_MINUTES),
  at_risk_threshold_pct: z.number().int().min(1).max(99),
});

export const routingRuleSchema = z.object({
  category: z.string().trim().min(1, "Category is required.").max(80),
  description: z.string().trim().max(240).nullable().optional(),
  default_assignee_id: z.string().uuid().nullable().optional(),
  default_department_id: z.string().uuid().nullable().optional(),
  default_priority: z.enum(TICKET_PRIORITIES).nullable().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

/** The whole category list, top to bottom — never a partial move. */
export const routingOrderSchema = z.object({
  ids: z
    .array(z.string().uuid())
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, "Each category can appear only once."),
});

export const settingsSchema = z.object({
  allowed_email_domains: z.array(z.string().trim().toLowerCase()).optional(),
  invite_expiry_hours: z.number().int().min(1).max(720).optional(),
  teams_webhook_url: z.string().trim().url().or(z.literal("")).nullable().optional(),
  it_distribution_email: z.string().trim().email().or(z.literal("")).nullable().optional(),
  notify_email_enabled: z.boolean().optional(),
  notify_teams_enabled: z.boolean().optional(),
  auto_assign_strategy: z.enum(["off", "round_robin", "least_busy"]).optional(),
  escalation_unassigned_minutes: z.number().int().min(5).max(10080).optional(),
  escalation_lead_id: z.string().uuid().nullable().optional(),
  app_base_url: z.string().trim().url().or(z.literal("")).nullable().optional(),
});

export const allowlistSchema = z.object({
  email: z.string().trim().toLowerCase().email("That is not a valid email address."),
  note: z.string().trim().max(200).nullable().optional(),
});

// ------------------------------------------------------------ quick tickets --

/** Blank means "none": an emptied field clears the column rather than storing "". */
function optionalText(max: number, min = 1, tooShort = "That is too short.") {
  return z.preprocess(
    (value) => (typeof value === "string" ? value.trim() || null : value),
    z.string().min(min, tooShort).max(max).nullable(),
  );
}

export const quickTicketGroupSchema = z.object({
  name: z.string().trim().min(1, "Give the group a name.").max(QUICK_TICKET_LIMITS.groupNameMax),
  description: optionalText(QUICK_TICKET_LIMITS.groupDescriptionMax).optional(),
  icon: z.enum(QUICK_TICKET_ICONS).optional(),
  is_active: z.boolean().optional(),
});

export const quickTicketGroupUpdateSchema = quickTicketGroupSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

const quickLabel = z
  .string()
  .trim()
  .min(QUICK_TICKET_LIMITS.labelMin, "Give it a short label, like “Paper jam”.")
  .max(QUICK_TICKET_LIMITS.labelMax);
const quickSubject = z
  .string()
  .trim()
  .min(TICKET_LIMITS.subjectMin, "Give the ticket a title.")
  .max(TICKET_LIMITS.subjectMax);
const quickDescription = z
  .string()
  .trim()
  .min(TICKET_LIMITS.descriptionMin, "Describe the problem IT will be fixing.")
  .max(QUICK_TICKET_LIMITS.descriptionMax);
const quickPrompt = optionalText(
  QUICK_TICKET_LIMITS.promptMax,
  QUICK_TICKET_LIMITS.promptMin,
  "Make the question a little longer.",
);

/**
 * The columns a requester reads. Changing any of them bumps the quick
 * ticket's revision, so an update that touches one must say which revision it
 * was editing.
 */
export const QUICK_TICKET_CONTENT_FIELDS = [
  "group_id",
  "routing_rule_id",
  "label",
  "subject",
  "description",
  "priority",
  "detail_prompt",
  "detail_required",
] as const;

const requiredNeedsPrompt = (v: { detail_prompt?: string | null; detail_required?: boolean }) =>
  !v.detail_required || Boolean(v.detail_prompt);
const requiredNeedsPromptIssue = {
  message: "Write the question first, or don't require an answer.",
  path: ["detail_required"],
};

export const quickTicketCreateSchema = z
  .object({
    group_id: z.string().uuid("Pick a group."),
    routing_rule_id: z.string().uuid("Pick a category."),
    label: quickLabel,
    subject: quickSubject,
    description: quickDescription,
    priority: z.enum(TICKET_PRIORITIES).default("normal"),
    detail_prompt: quickPrompt.optional().default(null),
    detail_required: z.boolean().default(false),
    is_active: z.boolean().default(true),
  })
  .refine(requiredNeedsPrompt, requiredNeedsPromptIssue);

export const quickTicketUpdateSchema = z
  .object({
    group_id: z.string().uuid("Pick a group.").optional(),
    routing_rule_id: z.string().uuid("Pick a category.").optional(),
    label: quickLabel.optional(),
    subject: quickSubject.optional(),
    description: quickDescription.optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    detail_prompt: quickPrompt.optional(),
    detail_required: z.boolean().optional(),
    is_active: z.boolean().optional(),
    /** The revision the editor opened. Required alongside any content change. */
    expected_revision: z.number().int().positive().optional(),
  })
  .refine(
    (v) => Object.keys(v).some((key) => key !== "expected_revision"),
    "Nothing to update.",
  );

const orderedIds = z
  .array(z.string().uuid())
  .max(500)
  .refine((ids) => new Set(ids).size === ids.length, "Each item can appear only once.");

/** The whole list, top to bottom — never a partial move. */
export const quickGroupOrderSchema = z.object({ ids: orderedIds });
export const quickTicketOrderSchema = z.object({ group_id: z.string().uuid(), ids: orderedIds });

/**
 * A requester raising one. The caps are generous on the raw text — the
 * composer trims, collapses and clips it — and exist only to refuse a body
 * nobody typed.
 */
export const raiseQuickTicketSchema = z.object({
  quick_ticket_id: z.string().uuid(),
  revision: z.number().int().positive(),
  answer: z.string().max(QUICK_TICKET_LIMITS.answerMax * 4).optional().default(""),
  note: z.string().max(QUICK_TICKET_LIMITS.noteMax * 2).optional().default(""),
  allow_duplicate: z.boolean().optional().default(false),
});
