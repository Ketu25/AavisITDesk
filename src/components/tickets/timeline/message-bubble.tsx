"use client";

import { motion, useReducedMotion } from "motion/react";
import { Avatar } from "@/components/ui/avatar";
import { RAIL } from "./rail";
import { absoluteTime, relativeTime } from "@/lib/format";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { CommentWithAuthor } from "./types";

/**
 * A message in the thread.
 *
 * Side is decided by who is reading, not by role: your own messages sit on the
 * right the way they do in any messaging app, and everyone else's sit on the
 * left. Consecutive messages from one person collapse into a group so a back
 * and forth reads as a conversation rather than a stack of identical cards.
 *
 * Internal notes keep the dashed amber treatment wherever they land — a
 * requester never sees them, so an agent must never be in doubt about which
 * they are writing in.
 */
export function MessageBubble({
  comment,
  own,
  grouped,
  className,
}: {
  comment: CommentWithAuthor;
  own: boolean;
  /** Same author as the message directly above, close in time. */
  grouped: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const internal = comment.is_internal;
  const name = comment.author?.full_name ?? "Deleted user";

  return (
    <motion.li
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6, x: own ? 8 : -8 }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      transition={spring.gentle}
      className={cn("relative", RAIL, grouped ? "pt-1" : "pt-3", className)}
    >
      {/* Avatar aligns to the top of the turn, level with the name header —
          the two belong to the same label and should read as one unit. */}
      <div className={cn("flex items-start gap-2", own ? "flex-row-reverse" : "flex-row")}>
        {/* Space is held even when grouped, so bubbles stay in one column. */}
        <span className={cn("w-6 flex-none", grouped ? "h-0" : "pt-5")}>
          {!grouped && (
            <Avatar name={name} id={comment.author?.id ?? comment.id} size="sm" />
          )}
        </span>

        <div className={cn("flex min-w-0 max-w-[min(30rem,80%)] flex-col", own && "items-end")}>
          {!grouped && (
            <div
              className={cn(
                "mb-1 flex items-baseline gap-2 px-0.5",
                own && "flex-row-reverse",
              )}
            >
              <span className="text-[0.75rem] font-medium text-ink">
                {own ? "You" : name}
              </span>
              <time
                dateTime={comment.created_at}
                title={absoluteTime(comment.created_at)}
                className="readout text-[0.625rem] text-ink-faint"
              >
                {relativeTime(comment.created_at)}
              </time>
              {internal && (
                <span
                  className="eyebrow"
                  style={{ color: "var(--spec-warn)" }}
                >
                  Internal
                </span>
              )}
            </div>
          )}

          <div
            className={cn(
              "w-fit max-w-full rounded-2xl border px-3.5 py-2.5",
              "text-[0.8125rem] leading-relaxed",
              // One squared corner points back at the author.
              own ? "rounded-br-sm" : "rounded-bl-sm",
              internal
                ? "border-dashed border-[rgb(224_163_58_/_0.45)] bg-[rgb(224_163_58_/_0.07)] text-ink"
                : own
                  ? "border-accent-line bg-accent-soft text-ink"
                  : "border-line bg-surface text-ink-muted",
            )}
          >
            <p className="whitespace-pre-wrap break-words">{comment.message}</p>
          </div>
        </div>
      </div>
    </motion.li>
  );
}
