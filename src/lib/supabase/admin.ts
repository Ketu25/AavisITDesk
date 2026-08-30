import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Service-role client. Bypasses RLS entirely, so it is only ever constructed
 * inside a route handler that has already verified the caller is an admin.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local — user " +
        "provisioning (invite, CSV import, enable/disable) cannot work without it.",
    );
  }

  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function hasServiceRoleKey() {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
