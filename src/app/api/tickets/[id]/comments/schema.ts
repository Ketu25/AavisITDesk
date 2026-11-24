import { z } from "zod";
import { ATTACHMENT_PATH, MAX_ATTACHMENTS, cleanFileName } from "@/lib/attachments";

/*
 * Here rather than in lib/validation: that module is imported by nearly every
 * route, and the Worker holds a separate server copy of it for each one. This
 * schema and the attachment helpers it needs are used by one route only.
 */

const dimension = z.number().int().min(1).max(50_000).nullable().optional();

/** An image the browser has already put in Storage, named by its path. */
export const commentAttachmentSchema = z.object({
  path: z.string().regex(ATTACHMENT_PATH, "That image could not be attached."),
  name: z.string().transform((name) => cleanFileName(name)),
  width: dimension,
  height: dimension,
});

export const commentSchema = z
  .object({
    message: z.string().trim().max(8000, "Keep the message under 8,000 characters.").default(""),
    is_internal: z.boolean().optional().default(false),
    attachments: z
      .array(commentAttachmentSchema)
      .max(MAX_ATTACHMENTS, `A message can carry up to ${MAX_ATTACHMENTS} images.`)
      .default([]),
  })
  .refine((body) => body.message.length > 0 || body.attachments.length > 0, {
    message: "Write something or attach an image first.",
    path: ["message"],
  })
  .refine((body) => new Set(body.attachments.map((a) => a.path)).size === body.attachments.length, {
    message: "The same image is attached twice.",
    path: ["attachments"],
  });
