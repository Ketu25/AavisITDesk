import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireApiAdmin } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { allowlistSchema } from "@/lib/validation";
import { throwDbError } from "@/lib/db-error";

/** Individual address exceptions to the domain allow-list. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireApiAdmin();
    const body = allowlistSchema.parse(await request.json());

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("email_allowlist")
      .insert({ email: body.email, note: body.note ?? null, added_by: ctx.userId })
      .select("*")
      .single();

    if (error) throwDbError(error, "That address could not be added.");
    return NextResponse.json({ entry: data }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
