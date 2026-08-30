import { ApiError } from "@/lib/api-auth";
import type { PostgrestError } from "@supabase/supabase-js";

/** Turns Postgres/PostgREST failures into something a person can act on. */
export function throwDbError(error: PostgrestError, fallback = "That did not work."): never {
  const map: Record<string, number> = {
    "42501": 403, // insufficient_privilege — our guard triggers raise this
    "23505": 409, // unique_violation
    "23503": 422, // foreign_key_violation
    "23514": 422, // check_violation
    "22023": 422, // invalid_parameter_value — allow-list rejection
    PGRST116: 404,
  };

  const status = map[error.code] ?? 400;

  const message =
    error.code === "23505"
      ? "That already exists."
      : error.code === "PGRST116"
        ? "Not found."
        : error.message || fallback;

  throw new ApiError(status, message);
}
