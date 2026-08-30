import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireApiAdmin } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { throwDbError } from "@/lib/db-error";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireApiAdmin();
    const { id } = await params;

    const supabase = await createClient();
    const { error } = await supabase.from("email_allowlist").delete().eq("id", id);
    if (error) throwDbError(error, "That entry could not be removed.");

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
