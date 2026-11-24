/**
 * Images in the ticket chat. One set of limits, read by the browser that
 * prepares a file, the route that accepts the message, and — as the same
 * numbers written in SQL — the bucket, table and policies that hold the line
 * if either of those is bypassed.
 */

export const ATTACHMENT_BUCKET = "ticket-attachments";
export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** What may be stored, and the extension each is stored under. */
export const ATTACHMENT_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
} as const;

export type AttachmentType = keyof typeof ATTACHMENT_TYPES;

export function isAttachmentType(type: string): type is AttachmentType {
  return Object.hasOwn(ATTACHMENT_TYPES, type);
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** `<ticket id>/<random uuid>.<ext>` — the only shape the upload policy accepts. */
export const ATTACHMENT_PATH = new RegExp(`^(${UUID})/${UUID}\\.(png|jpg|gif|webp)$`);

/** The ticket folder a stored path sits in. */
export function attachmentTicketId(path: string): string | null {
  return ATTACHMENT_PATH.exec(path)?.[1] ?? null;
}

/**
 * Where the app shows an attachment from. A stable URL of our own, not a
 * signed Storage URL: those change every time one is issued, and the page
 * re-renders on every realtime event, so signing them into the page would make
 * every image on it download again whenever any ticket anywhere changed.
 */
export function attachmentUrl(id: string, { download = false } = {}) {
  return `/api/attachments/${id}${download ? "?download=1" : ""}`;
}

/**
 * A file name as typed by someone's operating system is free text. It is shown
 * back and offered as the download name, so: no control characters, no path
 * separators, and a length that fits the column.
 */
export function cleanFileName(name: string, fallback = "image") {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || fallback).slice(0, 120);
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
