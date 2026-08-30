"use client";

import { motion } from "motion/react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { STATUS_META, PRIORITY_META } from "@/lib/constants";
import { absoluteTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TicketComment, TicketEvent, TicketPriority, TicketStatus } from "@/lib/database.types";

export type CommentWithAuthor = TicketComment & {
  author: { id: string; full_name: string; role: string } | null;
};
export type EventWithActor = TicketEvent & {
  actor: { id: string; full_name: string } | null;
};

type Entry =
  | { kind: "comment"; at: string; comment: CommentWithAuthor }
  | { kind: "event"; at: string; event: EventWithActor };

/** Events that would just duplicate a comment bubble are folded away. */
const HIDDEN_EVENTS = new Set(["commented"]);

function describe(event: EventWithActor, names: Map<string, string>) {
  const actor = event.actor?.full_name ?? "The system";

  switch (event.event_type) {
    case "created":
      return <>{actor} opened this ticket</>;
    case "status_changed": {
      const to = STATUS_META[event.to_value as TicketStatus];
      const from = STATUS_META[event.from_value as TicketStatus];
      return (
        <>
          {actor} moved it from{" "}
          <span className="font-medium text-ink-muted">{from?.label ?? event.from_value}</span> to{" "}
          <span className="font-medium text-ink">{to?.label ?? event.to_value}</span>
        </>
      );
    }
    case "assigned":
      return (
        <>
          {actor} assigned it to{" "}
          <span className="font-medium text-ink">
            {names.get(event.to_value ?? "") ?? "an agent"}
          </span>
        </>
      );
    case "unassigned":
      return <>{actor} removed the assignee</>;
    case "priority_changed": {
      const to = PRIORITY_META[event.to_value as TicketPriority];
      return (
        <>
          {actor} set priority to{" "}
          <span className="font-medium text-ink">{to?.label ?? event.to_value}</span>
        </>
      );
    }
    case "escalated":
      return <>Escalated — still unassigned past the configured threshold</>;
    case "sla_breached":
      return <>SLA target passed while the ticket was still open</>;
    default:
      return <>{event.event_type.replace(/_/g, " ")}</>;
  }
}

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
  const entries: Entry[] = [
    ...comments.map((c) => ({ kind: "comment" as const, at: c.created_at, comment: c })),
    ...events
      .filter((e) => !HIDDEN_EVENTS.has(e.event_type))
      .map((e) => ({ kind: "event" as const, at: e.created_at, event: e })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <ol className="space-y-3">
      {entries.map((entry, index) =>
        entry.kind === "event" ? (
          <motion.li
            key={`e-${entry.event.id}`}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: Math.min(index * 0.015, 0.2) }}
            className="flex items-center gap-2.5 pl-1 text-[0.75rem] text-ink-faint"
          >
            <span className="size-1.5 flex-none rounded-full bg-line-strong" />
            <span className="min-w-0 flex-1 truncate">
              {describe(entry.event, names)}
            </span>
            <time
              dateTime={entry.at}
              title={absoluteTime(entry.at)}
              className="flex-none tabular"
            >
              {relativeTime(entry.at)}
            </time>
          </motion.li>
        ) : (
          <motion.li
            key={`c-${entry.comment.id}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 32, delay: Math.min(index * 0.015, 0.2) }}
            className={cn(
              "flex gap-3 rounded-xl border p-3.5",
              entry.comment.is_internal
                ? "border-dashed border-[rgb(245_158_11_/_0.4)] bg-[rgb(245_158_11_/_0.05)]"
                : "border-line bg-surface",
            )}
          >
            <Avatar
              name={entry.comment.author?.full_name ?? "Unknown"}
              id={entry.comment.author?.id ?? entry.comment.id}
              size="sm"
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-[0.8125rem] font-medium text-ink">
                  {entry.comment.author?.full_name ?? "Deleted user"}
                  {entry.comment.author?.id === viewerId && (
                    <span className="ml-1 text-[0.6875rem] font-normal text-ink-faint">you</span>
                  )}
                </span>
                {entry.comment.is_internal && (
                  <Badge tone="amber" dot={false}>
                    Internal note
                  </Badge>
                )}
                <time
                  dateTime={entry.at}
                  title={absoluteTime(entry.at)}
                  className="ml-auto flex-none text-[0.6875rem] text-ink-faint"
                >
                  {relativeTime(entry.at)}
                </time>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-[0.8125rem] leading-relaxed text-ink-muted">
                {entry.comment.message}
              </p>
            </div>
          </motion.li>
        ),
      )}
    </ol>
  );
}
