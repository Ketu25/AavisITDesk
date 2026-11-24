import type { TicketAttachment, TicketComment, TicketEvent } from "@/lib/database.types";

/** What the thread needs to draw an image; never the storage path. */
export type AttachmentSummary = Pick<
  TicketAttachment,
  "id" | "file_name" | "mime_type" | "size_bytes" | "width" | "height" | "position"
>;

export type CommentWithAuthor = TicketComment & {
  author: { id: string; full_name: string; role: string } | null;
  /** Visible exactly when the message is — the same RLS decides both. */
  attachments?: AttachmentSummary[];
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
