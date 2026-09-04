import type { TicketComment, TicketEvent } from "@/lib/database.types";

export type CommentWithAuthor = TicketComment & {
  author: { id: string; full_name: string; role: string } | null;
};

export type EventWithActor = TicketEvent & {
  actor: { id: string; full_name: string } | null;
};

/**
 * One chronological stream. Events are the ticket's own record of itself;
 * comments are people talking. They share a spine but are drawn differently,
 * because they are different kinds of fact.
 */
export type Entry =
  | { kind: "comment"; at: string; comment: CommentWithAuthor }
  | { kind: "event"; at: string; event: EventWithActor };
