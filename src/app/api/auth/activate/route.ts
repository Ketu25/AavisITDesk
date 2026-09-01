import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { apiError, ApiError } from "@/lib/api-auth";

/**
 * Turns the caller's own pending account into a live one, but only after the
 * database has confirmed the stored password hash differs from the one
 * recorded when the temporary password was issued.
 *
 * That check is the whole point: without it a session holding a temporary
 * password could call this endpoint and skip the change entirely.
 */
export async function POST() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) throw new ApiError(401, "You are not signed in.");

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("complete_activation");

    if (error) throw new ApiError(403, error.message);

    return NextResponse.json(data);
  } catch (error) {
    return apiError(error);
  }
}
