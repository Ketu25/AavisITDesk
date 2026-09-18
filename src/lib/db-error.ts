import { ApiError } from "@/lib/api-auth";
import type { PostgrestError } from "@supabase/supabase-js";

const STATUS: Record<string, number> = {
  "42501": 403, // insufficient_privilege — our guard triggers raise this
  "23505": 409, // unique_violation
  "23503": 422, // foreign_key_violation
  "23514": 422, // check_violation
  "22023": 422, // invalid_parameter_value — allow-list rejection
  P0002: 404, // no_data_found — raised by name in the activation guards
  PGRST116: 404,
};

/**
 * Codes under which the message was written by us, in a migration, for this
 * person to read: "That temporary password has expired. Ask IT to issue a new
 * one." Every other code carries Postgres's own words, which name columns,
 * constraints and types — detail that helps an attacker map the schema and
 * helps the reader not at all.
 */
const APP_AUTHORED = new Set(["42501", "22023", "P0002"]);

/** Turns Postgres/PostgREST failures into something a person can act on. */
export function throwDbError(error: PostgrestError, fallback = "That did not work."): never {
  const status = STATUS[error.code] ?? 400;

  let message: string;
  if (APP_AUTHORED.has(error.code) && error.message) {
    message = error.message;
  } else if (error.code === "23505") {
    message = "That already exists.";
  } else if (error.code === "PGRST116") {
    message = "Not found.";
  } else {
    // Suppressed, not discarded — the detail still has to reach whoever is
    // debugging this, it just does not belong in the response.
    console.error("[db]", error.code, error.message, error.details ?? "");
    message = fallback;
  }

  throw new ApiError(status, message);
}
