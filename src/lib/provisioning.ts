import "server-only";

import { randomBytes } from "node:crypto";

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

// ---------------------------------------------------------------------------
// Temporary-password provisioning
// ---------------------------------------------------------------------------

/**
 * Ambiguous glyphs are removed on purpose: these get read off a screen, typed
 * by hand, or dictated over a desk, so 0/O and 1/l/I cause real support calls.
 * Three groups of four from a 28-character alphabet is ~57 bits of entropy.
 */
const TEMP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz";

export function generateTempPassword() {
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, (b) => TEMP_ALPHABET[b % TEMP_ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}`;
}

async function tempPasswordExpiry() {
  const admin = createAdminClient();
  const { data } = await admin.from("app_settings").select("invite_expiry_hours").maybeSingle();
  const hours = data?.invite_expiry_hours ?? 48;
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

/**
 * Records the pending state together with a fingerprint of the password hash
 * that was just written. Activation later requires that hash to have changed,
 * which is what makes "they must replace it" enforceable rather than advisory.
 */
async function stampTempPassword(userId: string) {
  const admin = createAdminClient();
  const { error } = await admin.rpc("stamp_temp_password", {
    p_user_id: userId,
    p_expires: await tempPasswordExpiry(),
  });

  if (error) {
    throw new ApiError(500, `The account was created but could not be marked pending: ${error.message}`);
  }
}

export type CreatedUser = {
  id: string;
  email: string;
  full_name: string;
  temp_password: string;
  expires_at: string;
};

/**
 * Creates an account that is immediately sign-in-able with a temporary
 * password, but cannot use the app until that password is replaced. No email
 * is sent — the admin hands the credentials over out of band.
 */
export async function createUserWithTempPassword(
  input: InviteInput & { password?: string | null },
  createdBy: string,
): Promise<CreatedUser> {
  await assertEmailAllowed(input.email);

  const password = input.password?.trim() || generateTempPassword();

  if (password.length < 8) {
    throw new ApiError(422, "A temporary password must be at least 8 characters.");
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password,
    // Confirmed up front: there is no email round-trip in this flow, so an
    // unconfirmed address would just block sign-in for no benefit.
    email_confirm: true,
    user_metadata: {
      full_name: input.full_name,
      role: input.role,
      department_id: input.department_id ?? "",
      invited_by: createdBy,
      // Read by the auth trigger: creates the profile as pending, owing a change.
      must_change_password: true,
    },
  });

  if (error) {
    if (error.status === 422 || /already/i.test(error.message)) {
      throw new ApiError(409, `${input.email} already has an account.`);
    }
    throw new ApiError(error.status ?? 500, error.message);
  }
  if (!data.user) throw new ApiError(500, "The account was not created.");

  // The auth trigger creates the profile from the metadata above; make sure
  // role and department landed even if the row already existed.
  await admin
    .from("profiles")
    .update({
      full_name: input.full_name,
      role: input.role,
      department_id: input.department_id,
      invited_by: createdBy,
    })
    .eq("id", data.user.id);

  await stampTempPassword(data.user.id);

  const { data: profile } = await admin
    .from("profiles")
    .select("temp_password_expires_at")
    .eq("id", data.user.id)
    .maybeSingle();

  return {
    id: data.user.id,
    email: input.email,
    full_name: input.full_name,
    temp_password: password,
    expires_at: profile?.temp_password_expires_at ?? "",
  };
}

/** Re-issues a temporary password for an existing account (lost password, or
 *  an expired one). The account drops back to pending until it is replaced. */
export async function issueTempPassword(
  userId: string,
  password?: string | null,
): Promise<CreatedUser> {
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("id, email, full_name, status")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) throw new ApiError(404, "That account no longer exists.");
  if (profile.status === "disabled") {
    throw new ApiError(422, "Re-enable the account before issuing a new password.");
  }

  const next = password?.trim() || generateTempPassword();
  if (next.length < 8) {
    throw new ApiError(422, "A temporary password must be at least 8 characters.");
  }

  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: next,
    email_confirm: true,
  });
  if (error) throw new ApiError(error.status ?? 500, error.message);

  // Existing sessions must not survive a credential reset.
  await admin.auth.admin.signOut(userId, "global").catch(() => {});
  await stampTempPassword(userId);

  const { data: updated } = await admin
    .from("profiles")
    .select("temp_password_expires_at")
    .eq("id", userId)
    .maybeSingle();

  return {
    id: profile.id,
    email: profile.email,
    full_name: profile.full_name,
    temp_password: next,
    expires_at: updated?.temp_password_expires_at ?? "",
  };
}
