import { NextResponse, type NextRequest } from "next/server";
import { apiError, ApiError, requireApiAdmin } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateUserSchema } from "@/lib/validation";
import { throwDbError } from "@/lib/db-error";

/**
 * Role, department, display name and enable/disable. Never deletes: a disabled
 * account keeps every ticket and comment attributed to it.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireApiAdmin();
    const { id } = await params;
    const patch = updateUserSchema.parse(await request.json());

    // Guard against an admin locking themselves out of administration.
    if (id === ctx.userId) {
      if (patch.status === "disabled") {
        throw new ApiError(422, "You cannot disable your own account.");
      }
      if (patch.role && patch.role !== "admin") {
        throw new ApiError(422, "You cannot remove your own admin role.");
      }
    }

    const admin = createAdminClient();

    if (patch.status === "disabled") {
      // Kill live sessions so the change takes effect immediately.
      await admin.auth.admin.signOut(id, "global").catch(() => {});
    }

    const { data, error } = await admin
      .from("profiles")
      .update(patch)
      .eq("id", id)
      .select("id, full_name, role, status, department_id")
      .single();

    if (error) throwDbError(error, "The account could not be updated.");

    return NextResponse.json({ user: data });
  } catch (error) {
    return apiError(error);
  }
}
