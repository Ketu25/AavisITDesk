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
