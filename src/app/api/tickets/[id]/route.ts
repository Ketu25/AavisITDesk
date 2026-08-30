import { NextResponse, type NextRequest } from "next/server";
import { apiError, ApiError, requireApiUser } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { updateTicketSchema } from "@/lib/validation";
import { throwDbError } from "@/lib/db-error";

/**
 * Requesters may only confirm (resolved -> closed) or reopen their own ticket.
 * That rule is enforced by a database trigger, so this check is a second
 * layer rather than the only one.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireApiUser();
    const { id } = await params;
    const patch = updateTicketSchema.parse(await request.json());

    if (!ctx.isAgent) {
      const touchesAgentOnlyField =
        patch.priority !== undefined ||
        patch.category !== undefined ||
        patch.assigned_to !== undefined;

      if (touchesAgentOnlyField) {
        throw new ApiError(403, "Only an agent can change priority, category or assignment.");
      }
      if (patch.status && !["closed", "reopened"].includes(patch.status)) {
        throw new ApiError(403, "You can only confirm or reopen a resolved ticket.");
      }
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("tickets")
      .update(patch)
      .eq("id", id)
      .select("id, status, priority, assigned_to, category")
      .single();

    if (error) throwDbError(error, "The ticket could not be updated.");

    return NextResponse.json({ ticket: data });
  } catch (error) {
    return apiError(error);
  }
}
