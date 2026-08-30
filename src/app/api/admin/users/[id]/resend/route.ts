import { NextResponse, type NextRequest } from "next/server";
import { apiError, ApiError, requireApiAdmin } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteUser, sendPasswordReset } from "@/lib/provisioning";

/**
 * Resends the invite for a pending account. Nothing is deleted or recreated,
 * so the account keeps its id and any history attached to it.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireApiAdmin();
    const { id } = await params;

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("id, email, full_name, role, department_id, status")
      .eq("id", id)
      .maybeSingle();

    if (!profile) throw new ApiError(404, "That account no longer exists.");
    if (profile.status === "disabled") {
      throw new ApiError(422, "Re-enable the account before sending a new invite.");
    }

    if (profile.status === "active") {
      // Already activated: an invite would be rejected, a reset link is what
      // this person actually needs.
      await sendPasswordReset(profile.email);
      return NextResponse.json({ sent: "password_reset" });
    }

    await inviteUser(
      {
        email: profile.email,
        full_name: profile.full_name,
        role: profile.role,
        department_id: profile.department_id,
      },
      ctx.userId,
    );

    return NextResponse.json({ sent: "invite" });
  } catch (error) {
    return apiError(error);
  }
}
