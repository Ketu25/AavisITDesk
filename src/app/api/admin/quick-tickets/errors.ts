import type { PostgrestError } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api-auth";

/**
 * The write failures an admin can cause and fix, in words. Anything else is
 * left to throwDbError, which keeps Postgres's own wording out of responses.
 */
export function quickTicketWriteError(error: PostgrestError, label?: string): ApiError | null {
  switch (error.code) {
    case "23505":
      return new ApiError(
        409,
        label
          ? `“${label}” is already in that group. Give it a different label.`
          : "That group already has a quick ticket with this label.",
        { field: "label" },
      );
    case "23503":
      return new ApiError(
        422,
        "That group or category no longer exists. The page has been reloaded — pick another.",
        { reason: "reference" },
      );
    case "23514":
      return new ApiError(
        422,
        "Something in the form is outside what is allowed. Check the highlighted fields.",
      );
    default:
      return null;
  }
}
