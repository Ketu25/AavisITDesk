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

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A dynamic segment is whatever was in the URL, so it reaches the handler as
 * an unvalidated string. Passing a non-UUID down to Postgres raises a 22P02,
 * which arrives as an opaque 400 quoting the malformed value back — where the
 * honest answer is simply that no such record exists.
 */
export function routeUuid(id: string): string {
  if (!UUID.test(id)) throw new ApiError(404, "That record does not exist.");
  return id;
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
  // Everything we actually mean to say is an ApiError above. What is left is
  // a thrown exception — a Postgres message, a stack, an SDK internal — and
  // handing that to the browser tells an attacker about the schema while
  // telling the user nothing. It goes to the log; the caller gets a sentence.
  console.error("[api]", error);
  const detail = error instanceof Error ? error.message : "Unexpected server error.";
  return NextResponse.json(
    {
      error:
        process.env.NODE_ENV === "production"
          ? "Something went wrong at our end. Please try again."
          : detail,
    },
    { status: 500 },
  );
}
