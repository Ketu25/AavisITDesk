import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireApiAdmin } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { settingsSchema } from "@/lib/validation";
import { throwDbError } from "@/lib/db-error";

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireApiAdmin();
    const body = settingsSchema.parse(await request.json());

    // Empty strings mean "unset", not "set to empty".
    const patch = Object.fromEntries(
      Object.entries(body).map(([key, value]) => [key, value === "" ? null : value]),
    );

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("app_settings")
      .update({ ...patch, updated_by: ctx.userId })
      .eq("id", true)
      .select("*")
      .single();

    if (error) throwDbError(error, "Settings could not be saved.");
    return NextResponse.json({ settings: data });
  } catch (error) {
    return apiError(error);
  }
}
