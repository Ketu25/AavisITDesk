"use client";

import { Fragment, useMemo } from "react";
import { AnimatePresence } from "motion/react";
import { RailLine } from "./rail";
import { DayDivider } from "./day-divider";
import { EventNode } from "./event-node";
import { MessageBubble } from "./message-bubble";
import { HIDDEN_EVENTS } from "./describe-event";
import type { CommentWithAuthor, Entry, EventWithActor } from "./types";

export type { CommentWithAuthor, EventWithActor } from "./types";

/** Messages this close together from one author read as a single turn. */
const GROUP_WINDOW_MS = 5 * 60_000;

function sameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/**
 * The ticket as one vertical record.
 *
 * A single rail carries chronology. What the ticket did to itself — assigned,
 * moved, escalated — sits on that rail as quiet nodes. What people said hangs
 * beside it as a conversation, the reader's own messages on the right. Both
 * kinds stay in one stream, so "she replied, then it went to In progress"
 * survives as a sequence instead of being split across two panels.
 */
export function TicketTimeline({
  comments,
  events,
  viewerId,
  names,
}: {
  comments: CommentWithAuthor[];
  events: EventWithActor[];
  viewerId: string;
  names: Map<string, string>;
}) {
  const entries = useMemo<Entry[]>(
    () =>
      [
        ...comments.map((c) => ({ kind: "comment" as const, at: c.created_at, comment: c })),
        ...events
          .filter((e) => !HIDDEN_EVENTS.has(e.event_type))
          .map((e) => ({ kind: "event" as const, at: e.created_at, event: e })),
      ].sort((a, b) => a.at.localeCompare(b.at)),
    [comments, events],
  );

  if (entries.length === 0) return null;

  return (
    <div className="relative">
      <RailLine />
      <ol className="relative space-y-0.5">
        <AnimatePresence initial={false}>
          {entries.map((entry, index) => {
            const previous = entries[index - 1];
            const needsDivider = !previous || !sameDay(previous.at, entry.at);

            // Grouping only applies to an unbroken run from the same author.
            const grouped =
              !needsDivider &&
              entry.kind === "comment" &&
              previous?.kind === "comment" &&
              previous.comment.author?.id === entry.comment.author?.id &&
              previous.comment.is_internal === entry.comment.is_internal &&
              new Date(entry.at).getTime() - new Date(previous.at).getTime() < GROUP_WINDOW_MS;

            return (
              <Fragment key={`${entry.kind}-${entry.kind === "comment" ? entry.comment.id : entry.event.id}`}>
                {needsDivider && <DayDivider at={entry.at} className={index === 0 ? "" : "pt-4"} />}
                {entry.kind === "comment" ? (
                  <MessageBubble
                    comment={entry.comment}
                    own={entry.comment.author?.id === viewerId}
                    grouped={grouped}
                  />
                ) : (
                  <EventNode event={entry.event} names={names} />
                )}
              </Fragment>
            );
          })}
        </AnimatePresence>
      </ol>
    </div>
  );
}

