import { z } from "zod";
import { TICKET_PRIORITIES, TICKET_STATUSES, USER_ROLES } from "@/lib/database.types";

export const createTicketSchema = z.object({
  subject: z.string().trim().min(3, "Give the ticket a short title.").max(160),
  description: z.string().trim().min(5, "Describe what is happening.").max(8000),
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
  duration_minutes: z.number().int().min(1).max(60 * 24 * 90),
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
