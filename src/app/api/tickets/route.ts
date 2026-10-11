import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiError, requireApiUser } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { createTicketSchema } from "@/lib/validation";
import { throwDbError } from "@/lib/db-error";

/**
 * Any active account may open a ticket — agents and admins included. The
 * department, ticket number and SLA target are all derived server-side; a
 * client-supplied value for any of them is ignored by the insert trigger.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireApiUser();
    const body = createTicketSchema.parse(await request.json());

    const supabase = await createClient();

    // The insert trigger routes by category but accepts any string, so a
    // category an admin has since switched off — or renamed — would still
    // open a ticket that no rule routes. That is exactly what a draft kept
    // across a session can carry. Matched the way the trigger matches
    // (trimmed, case-insensitive) and stored in its canonical spelling.
    const { data: rules, error: rulesError } = await supabase
      .from("routing_rules")
      .select("category")
      .eq("is_active", true);
    if (rulesError) throwDbError(rulesError, "The ticket could not be created.");

    const wanted = body.category.toLowerCase();
    const rule = (rules ?? []).find((r) => r.category.trim().toLowerCase() === wanted);
    if (!rule) {
      throw new ApiError(422, "That category is no longer offered. Pick another one.", {
        field: "category",
      });
    }

    const { data, error } = await supabase
      .from("tickets")
      .insert({
        created_by: ctx.userId,
        subject: body.subject,
        description: body.description,
        category: rule.category,
        priority: body.priority,
      })
      // Priority comes back because the trigger can raise it to the
      // category's default; the confirmation should show what IT will see.
      .select("id, ticket_number, subject, priority, category")
      .single();

    if (error) throwDbError(error, "The ticket could not be created.");

    return NextResponse.json({ ticket: data }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
