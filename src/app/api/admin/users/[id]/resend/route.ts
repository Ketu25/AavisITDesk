import { NextResponse, type NextRequest } from "next/server";
import { apiError, ApiError, requireApiAdmin } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteUser, sendPasswordReset } from "@/lib/provisioning";

/**
 * Sends whichever link the account actually needs, decided by whether its
 * holder has ever chosen a password — NOT by `status`.
 *
 * That distinction matters: a mail-security scanner following the invite link
 * confirms the address without a human involved. Keying off status meant such
 * an account looked activated, so this route quietly sent a password reset for
 * an account that had never been set up. It now re-invites instead.
 *
 * Nothing is deleted or recreated either way, so the account keeps its id and
 * every ticket attributed to it.
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
      .select("id, email, full_name, role, department_id, status, password_set_at")
      .eq("id", id)
      .maybeSingle();

    if (!profile) throw new ApiError(404, "That account no longer exists.");
    if (profile.status === "disabled") {
      throw new ApiError(422, "Re-enable the account before sending a new link.");
    }

    if (profile.password_set_at) {
      // Genuinely set up: a reset link is what this person needs.
      await sendPasswordReset(profile.email);
      return NextResponse.json({
        sent: "password_reset",
        message: `Password reset link sent to ${profile.email}.`,
      });
    }

    // If a scanner already confirmed the address, GoTrue would reject a fresh
    // invite as "already registered". Clearing the confirmation first makes the
    // account invitable again; the RPC refuses if a password was ever set.
    await admin.rpc("reset_invite_state", { p_user_id: profile.id });

    await inviteUser(
      {
        email: profile.email,
        full_name: profile.full_name,
        role: profile.role,
        department_id: profile.department_id,
      },
      ctx.userId,
    );

    return NextResponse.json({
      sent: "invite",
      message: `Invite resent to ${profile.email}.`,
    });
  } catch (error) {
    return apiError(error);
  }
}
