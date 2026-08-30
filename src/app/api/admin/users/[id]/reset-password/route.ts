import { NextResponse, type NextRequest } from "next/server";
import { apiError, ApiError, requireApiAdmin } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPasswordReset } from "@/lib/provisioning";

/** Emails a password-reset link. We never set or reveal a password ourselves. */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireApiAdmin();
    const { id } = await params;

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("email, status")
      .eq("id", id)
      .maybeSingle();

    if (!profile) throw new ApiError(404, "That account no longer exists.");
    if (profile.status !== "active") {
      throw new ApiError(422, "Only active accounts can be sent a password reset.");
    }

    await sendPasswordReset(profile.email);
    return NextResponse.json({ sent: "password_reset" });
  } catch (error) {
    return apiError(error);
  }
}
