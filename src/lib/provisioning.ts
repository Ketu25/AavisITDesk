import "server-only";

import { createClient as createPublicClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError } from "@/lib/api-auth";
import type { UserRole } from "@/lib/database.types";

export type InviteInput = {
  email: string;
  full_name: string;
  role: UserRole;
  department_id: string | null;
};

export function siteUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "http://localhost:3000"
  );
}

// Both link styles land on /invite: the default ConfirmationURL redirects
// here with a session, and the recommended TokenHash template links here with
// ?token_hash=, which the page spends only on an explicit click.
export const INVITE_REDIRECT = `${siteUrl()}/invite`;

/** Supabase applies its own auth-email cap regardless of the SMTP provider. */
export const RATE_LIMIT_HELP =
  "Supabase's auth email rate limit was hit. Raise it under Authentication -> " +
  "Rate Limits, and configure a custom SMTP provider under Authentication -> " +
  "Emails — the built-in mailer allows only a couple of messages an hour.";

/**
 * The allow-list is checked in the database too (a trigger on profiles), but
 * checking here first means the admin gets a clear message instead of an
 * orphaned auth user.
 */
export async function assertEmailAllowed(email: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("is_email_allowed", { p_email: email });

  if (error) throw new ApiError(500, `Could not check the allow-list: ${error.message}`);
  if (!data) {
    throw new ApiError(
      422,
      `${email} is not permitted. Add its domain under Settings, or add the address itself as an exception.`,
    );
  }
}

/** Maps a department name (as it appears in a CSV) onto its id. */
export async function resolveDepartment(nameOrId: string | null | undefined) {
  if (!nameOrId) return null;

  const admin = createAdminClient();
  const value = nameOrId.trim();
  if (!value) return null;

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const query = admin.from("departments").select("id");

  const { data } = uuid.test(value)
    ? await query.eq("id", value).maybeSingle()
    : await query.ilike("name", value).maybeSingle();

  if (!data) {
    throw new ApiError(422, `There is no department called "${value}".`);
  }
  return data.id;
}

export async function inviteUser(input: InviteInput, invitedBy: string) {
  await assertEmailAllowed(input.email);

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, {
    redirectTo: INVITE_REDIRECT,
    data: {
      full_name: input.full_name,
      role: input.role,
      department_id: input.department_id ?? "",
      invited_by: invitedBy,
    },
  });

  if (error) {
    // GoTrue speaks in status codes; translate the ones an admin will hit.
    if (error.status === 422 || /already/i.test(error.message)) {
      throw new ApiError(409, `${input.email} already has an account.`);
    }
    if (error.status === 429) {
      throw new ApiError(429, RATE_LIMIT_HELP);
    }
    throw new ApiError(error.status ?? 500, error.message);
  }

  // The auth trigger creates the profile; make sure the metadata landed even
  // if the invite was for a user row that already existed.
  if (data.user) {
    await admin
      .from("profiles")
      .update({
        full_name: input.full_name,
        role: input.role,
        department_id: input.department_id,
        invited_by: invitedBy,
        last_invite_sent_at: new Date().toISOString(),
      })
      .eq("id", data.user.id);
  }

  return data.user;
}

/** Sends a Supabase password-recovery email — used for already-active users. */
export async function sendPasswordReset(email: string) {
  const publicClient = createPublicClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );

  const { error } = await publicClient.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl()}/reset-password`,
  });

  if (error) {
    // A 429 here is the single most common reason "the email never arrived",
    // so say what it is rather than surfacing "Request failed".
    if (error.status === 429) throw new ApiError(429, RATE_LIMIT_HELP);
    throw new ApiError(error.status ?? 500, error.message);
  }
}
