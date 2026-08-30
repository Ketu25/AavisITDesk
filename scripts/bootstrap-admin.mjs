#!/usr/bin/env node
/**
 * Creates (or promotes) the first administrator.
 *
 *   npm run bootstrap:admin -- someone@aavispharma.com "Their Name"
 *
 * Sends a normal Supabase invite — no password is ever generated or printed.
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(file) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // No .env.local: fall back to the ambient environment.
  }
}

loadEnv(".env.local");

const [email, name] = process.argv.slice(2);

if (!email) {
  console.error('Usage: npm run bootstrap:admin -- <email> "<Full Name>"');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const allowed = await supabase.rpc("is_email_allowed", { p_email: email });
if (allowed.error) {
  console.error("Could not check the allow-list:", allowed.error.message);
  process.exit(1);
}
if (!allowed.data) {
  console.error(
    `${email} is not on the allow-list. Add its domain to app_settings.allowed_email_domains,\n` +
      "or add the address to email_allowlist, then run this again.",
  );
  process.exit(1);
}

// Already has an account? Just make sure the role is right.
const existing = await supabase.from("profiles").select("id, role, status").eq("email", email.toLowerCase()).maybeSingle();

if (existing.data) {
  const { error } = await supabase
    .from("profiles")
    .update({ role: "admin", status: existing.data.status === "disabled" ? "active" : existing.data.status })
    .eq("id", existing.data.id);

  if (error) {
    console.error("Could not promote that account:", error.message);
    process.exit(1);
  }
  console.log(`${email} already existed — promoted to admin.`);
  process.exit(0);
}

const { error } = await supabase.auth.admin.inviteUserByEmail(email, {
  redirectTo: `${site}/auth/callback?next=/invite`,
  data: { full_name: name ?? email.split("@")[0], role: "admin" },
});

if (error) {
  console.error("Invite failed:", error.message);
  process.exit(1);
}

console.log(`Invite sent to ${email}. They set their own password from the link.`);
