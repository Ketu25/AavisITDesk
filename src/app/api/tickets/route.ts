import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireApiUser } from "@/lib/api-auth";
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
    const { data, error } = await supabase
      .from("tickets")
      .insert({
        created_by: ctx.userId,
        subject: body.subject,
        description: body.description,
        category: body.category,
        priority: body.priority,
      })
      .select("id, ticket_number")
      .single();

    if (error) throwDbError(error, "The ticket could not be created.");

    return NextResponse.json({ ticket: data }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
