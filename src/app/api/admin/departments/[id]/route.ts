import { NextResponse, type NextRequest } from "next/server";
import { apiError, ApiError, requireApiAdmin } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { departmentSchema } from "@/lib/validation";
import { throwDbError } from "@/lib/db-error";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireApiAdmin();
    const { id } = await params;
    const body = departmentSchema.partial().parse(await request.json());

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("departments")
      .update(body)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throwDbError(error, "That department could not be updated.");
    return NextResponse.json({ department: data });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Removing a department is only safe while nobody and nothing references it.
 * Otherwise we steer the admin to deactivating it, which keeps history intact.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireApiAdmin();
    const { id } = await params;
    const admin = createAdminClient();

    const [{ count: people }, { count: tickets }] = await Promise.all([
      admin.from("profiles").select("id", { count: "exact", head: true }).eq("department_id", id),
      admin.from("tickets").select("id", { count: "exact", head: true }).eq("department_id", id),
    ]);

    if ((people ?? 0) > 0 || (tickets ?? 0) > 0) {
      throw new ApiError(
        409,
        `Still in use by ${people ?? 0} ${people === 1 ? "person" : "people"} and ` +
          `${tickets ?? 0} ticket${tickets === 1 ? "" : "s"}. Deactivate it instead — ` +
          "that hides it from new tickets without touching history.",
      );
    }

    const supabase = await createClient();
    const { error } = await supabase.from("departments").delete().eq("id", id);
    if (error) throwDbError(error, "That department could not be removed.");

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
