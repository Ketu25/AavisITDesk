import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getAuthContext, type AuthContext } from "@/lib/auth";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Every mutating route calls one of these first. Role checks live here and in
 * RLS — the frontend hiding a button is never the thing that stops a request.
 */
export async function requireApiUser(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw new ApiError(401, "You are not signed in.");

  // A temporary password authenticates, but grants nothing until replaced.
  if (ctx.profile.must_change_password) {
    throw new ApiError(403, "Set a new password before using the desk.");
  }
  if (ctx.profile.status !== "active") {
    throw new ApiError(403, "This account is not active.");
  }
  return ctx;
}

export async function requireApiAgent(): Promise<AuthContext> {
  const ctx = await requireApiUser();
  if (!ctx.isAgent) throw new ApiError(403, "Agent access is required.");
  return ctx;
}

export async function requireApiAdmin(): Promise<AuthContext> {
  const ctx = await requireApiUser();
  if (!ctx.isAdmin) throw new ApiError(403, "Administrator access is required.");
  return ctx;
}

export function apiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message, details: error.details },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "That request was not valid.", details: error.issues },
      { status: 422 },
    );
  }
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  console.error("[api]", error);
  return NextResponse.json({ error: message }, { status: 500 });
}
