import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import { apiError, ApiError } from "@/lib/api-auth";

/**
 * Flips the *caller's own* profile from pending to active after they set a
 * password. It can never touch another account and never re-enables a
 * disabled one.
 */
export async function POST() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) throw new ApiError(401, "You are not signed in.");

    if (ctx.profile.status !== "pending") {
      return NextResponse.json({ status: ctx.profile.status });
    }

    if (!hasServiceRoleKey()) {
      throw new ApiError(
        503,
        "Account activation is unavailable: SUPABASE_SERVICE_ROLE_KEY is not configured.",
      );
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from("profiles")
      .update({ status: "active", activated_at: new Date().toISOString() })
      .eq("id", ctx.userId)
      .eq("status", "pending");

    if (error) throw new ApiError(500, error.message);

    return NextResponse.json({ status: "active" });
  } catch (error) {
    return apiError(error);
  }
}
