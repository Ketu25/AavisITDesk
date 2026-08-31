import { NextResponse, type NextRequest } from "next/server";
import { apiError, ApiError, requireApiUser } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { commentSchema } from "@/lib/validation";
import { throwDbError } from "@/lib/db-error";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireApiUser();
    const { id } = await params;
    const body = commentSchema.parse(await request.json());

    if (body.is_internal && !ctx.isAgent) {
      throw new ApiError(403, "Only agents can leave internal notes.");
    }

    const supabase = await createClient();

    // A closed ticket takes no further comment from anyone. RLS enforces this
    // too; checking here turns an opaque policy rejection into a message that
    // says what to do instead.
    const { data: ticket } = await supabase
      .from("tickets")
      .select("status")
      .eq("id", id)
      .maybeSingle();

    if (!ticket) throw new ApiError(404, "That ticket does not exist, or you cannot see it.");

    if (ticket.status === "closed") {
      throw new ApiError(
        409,
        ctx.isAgent
          ? "This ticket is closed. Move it back to In progress to add anything further."
          : "This ticket is closed. Please raise a new ticket if you still need help.",
      );
    }

    const { data, error } = await supabase
      .from("ticket_comments")
      .insert({
        ticket_id: id,
        author_id: ctx.userId,
        message: body.message,
        is_internal: body.is_internal ?? false,
      })
      .select("id, created_at")
      .single();

    if (error) throwDbError(error, "The comment could not be posted.");

    return NextResponse.json({ comment: data }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
