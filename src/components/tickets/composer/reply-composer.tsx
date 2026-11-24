"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useIsClient } from "@/components/motion/use-is-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { Icons } from "@/components/shell/icons";
import { api, ApiClientError } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { ATTACHMENT_BUCKET, ATTACHMENT_TYPES, MAX_ATTACHMENTS, formatBytes } from "@/lib/attachments";
import { cn } from "@/lib/utils";
import { ImageRejected, prepareImage, type PreparedImage } from "./prepare-image";

type Item = {
  key: string;
  status: "preparing" | "ready" | "uploading" | "uploaded" | "failed";
  image?: PreparedImage;
  /** Object URL of the prepared image, for the thumbnail. Revoked when the item goes. */
  preview?: string;
  /** Set once the file is in Storage. Kept across a failed send so a retry reuses it. */
  path?: string;
  error?: string;
};

type Source = "paste" | "drop" | "picker";

const ACCEPT = Object.keys(ATTACHMENT_TYPES).join(",");

/** `crypto.randomUUID` exists only on secure origins; a LAN address in dev is not one. */
function randomId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The files in a paste, or null when the paste is text.
 *
 * Copying cells from Excel or a paragraph from Word puts a picture of the
 * selection on the clipboard beside the text; that paste means the text, and
 * the browser is left to insert it. A screenshot, a browser's "Copy image", or
 * an image file copied in Finder or Explorer is the image.
 */
function filesFromClipboard(data: DataTransfer): File[] | null {
  const files = Array.from(data.files ?? []);
  if (files.length === 0) {
    for (const item of Array.from(data.items ?? [])) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (files.length === 0) return null;

  const text = data.getData("text/plain").trim();
  if (!text) return files;

  const html = data.getData("text/html");
  const htmlIsOnlyImages =
    /<img\b/i.test(html) &&
    html.replace(/<[^>]*>/g, "").replace(/&nbsp;|\s/g, "") === "";
  const textIsFileNames = files.some((file) => file.name && text.includes(file.name));

  return htmlIsOnlyImages || textIsFileNames ? files : null;
}

function isFileDrag(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/** Another dialog is open over the page; files dropped or pasted there are not for this reply. */
function overlayOpen() {
  return document.querySelector('[aria-modal="true"]') !== null;
}

function isEditable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null
  );
}

function uploadFailure(error: unknown) {
  const status = Number(
    (error as { status?: unknown; statusCode?: unknown })?.status ??
      (error as { statusCode?: unknown })?.statusCode,
  );
  const text = String((error as { message?: unknown })?.message ?? "").toLowerCase();

  if (status === 413 || text.includes("maximum allowed size") || text.includes("too large")) {
    return "It is larger than the 10 MB limit.";
  }
  if (text.includes("mime")) return "That kind of file can’t be stored.";
  if (status === 401 || status === 403 || text.includes("row-level security") || text.includes("unauthorized")) {
    return "This ticket isn’t accepting images from you right now — it may have just been closed. Reload the page to check.";
  }
  return "The upload didn’t finish. Check your connection and try again.";
}

/** The server's own sentence, or the first field error behind a 422. */
function postFailure(error: unknown) {
  if (!(error instanceof ApiClientError)) return "Check your connection and try again.";
  if (error.status === 422 && Array.isArray(error.details)) {
    const first = error.details[0] as { message?: unknown } | undefined;
    if (typeof first?.message === "string") return first.message;
  }
  return error.message;
}

/**
 * The server answered and said no — nothing was written, so uploads made for
 * this attempt belong to no message. Network failures and 5xx are different:
 * the message may have been saved and only the answer lost.
 */
function definitelyRejected(error: unknown) {
  return (
    error instanceof ApiClientError &&
    error.status >= 400 &&
    error.status < 500 &&
    ![408, 425, 429].includes(error.status)
  );
}

function alreadyPosted(error: unknown) {
  return (
    error instanceof ApiClientError &&
    error.status === 409 &&
    (error.details as { reason?: unknown } | undefined)?.reason === "already_posted"
  );
}

/**
 * The reply box: text, plus up to five images pasted, dropped anywhere on the
 * page, or picked (on a phone, the button offers the camera and gallery).
 *
 * Files go to Storage only when Reply is pressed, all of them or none: a
 * message is never posted with some of its images missing. If the upload works
 * but the post fails, what happens to the files depends on whether the server
 * definitely refused (they are removed) or the answer was lost (they are kept,
 * and a retry that finds them already used is the earlier send succeeding).
 */
export function ReplyComposer({ ticketId, isAgent }: { ticketId: string; isAgent: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [supabase] = useState(createClient);
  const hintId = useId();
  const isClient = useIsClient();

  const [message, setMessage] = useState("");
  const [internal, setInternal] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);

  // The ref is the source of truth and state follows it, so two pastes in one
  // tick both see the first one's items when counting against the limit.
  const itemsRef = useRef<Item[]>([]);
  const sendingRef = useRef(false);
  const mountedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const update = useCallback((next: (items: Item[]) => Item[]) => {
    itemsRef.current = next(itemsRef.current);
    setItems(itemsRef.current);
  }, []);

  const patch = useCallback(
    (key: string, changes: Partial<Item>) =>
      update((current) => current.map((item) => (item.key === key ? { ...item, ...changes } : item))),
    [update],
  );

  const discardUploads = useCallback(
    (paths: string[]) => {
      // Best effort: the policy only lets an unsent upload be removed, so a
      // path that did end up in a message is refused rather than lost.
      if (paths.length > 0) void supabase.storage.from(ATTACHMENT_BUCKET).remove(paths);
    },
    [supabase],
  );

  // Leaving the page with images still in the box: free the previews, and
  // remove anything already uploaded for a send that never completed.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const left = itemsRef.current;
      left.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
      discardUploads(left.flatMap((item) => (item.path ? [item.path] : [])));
    };
  }, [discardUploads]);

  const addFiles = useCallback(
    (files: File[], source: Source) => {
      if (files.length === 0) return;
      if (sendingRef.current) {
        push({ tone: "info", title: "Sending…", description: "Add more images once this message has gone." });
        return;
      }

      const room = MAX_ATTACHMENTS - itemsRef.current.length;
      const accepted = files.slice(0, Math.max(0, room));
      if (files.length > accepted.length) {
        push({
          tone: "info",
          title: room <= 0 ? `Already ${MAX_ATTACHMENTS} images` : `Only ${room} more ${room === 1 ? "image fits" : "images fit"}`,
          description: `A message can carry up to ${MAX_ATTACHMENTS} images. Send this one, then add the rest to the next.`,
        });
      }
      if (accepted.length === 0) return;

      const fresh: Item[] = accepted.map(() => ({ key: randomId(), status: "preparing" }));
      update((current) => [...current, ...fresh]);

      accepted.forEach((file, index) => {
        const { key } = fresh[index];
        prepareImage(file, { pasted: source === "paste" })
          .then((image) => {
            // Taken back out while it was still being prepared, or the page is gone.
            if (!mountedRef.current || !itemsRef.current.some((item) => item.key === key)) return;
            patch(key, { status: "ready", image, preview: URL.createObjectURL(image.blob) });
          })
          .catch((error: unknown) => {
            if (!mountedRef.current) return;
            update((current) => current.filter((item) => item.key !== key));
            push({
              tone: "error",
              title: "Couldn’t attach that image",
              description:
                error instanceof ImageRejected ? error.message : "Try saving it as PNG or JPEG first.",
              duration: 8000,
            });
          });
      });
    },
    [patch, push, update],
  );

  function remove(key: string) {
    if (sendingRef.current) return;
    const item = itemsRef.current.find((candidate) => candidate.key === key);
    if (!item) return;
    if (item.preview) URL.revokeObjectURL(item.preview);
    if (item.path) discardUploads([item.path]);
    update((current) => current.filter((candidate) => candidate.key !== key));
    textareaRef.current?.focus();
  }

  async function upload(image: PreparedImage) {
    const path = `${ticketId}/${randomId()}.${ATTACHMENT_TYPES[image.type]}`;
    const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(path, image.blob, {
      contentType: image.type,
      cacheControl: "3600",
      upsert: false,
    });
    if (error) throw error;
    return path;
  }

  async function send() {
    if (sendingRef.current) return;
    const snapshot = itemsRef.current;
    const text = message.trim();
    if (snapshot.some((item) => item.status === "preparing")) return;
    if (!text && snapshot.length === 0) return;

    sendingRef.current = true;
    setSending(true);
    try {
      const paths = await Promise.all(
        snapshot.map(async (item) => {
          if (item.path) return item.path;
          if (!item.image) return null;
          patch(item.key, { status: "uploading", error: undefined });
          try {
            const path = await upload(item.image);
            patch(item.key, { status: "uploaded", path });
            return path;
          } catch (error) {
            patch(item.key, { status: "failed", error: uploadFailure(error) });
            return null;
          }
        }),
      );

      const failures = itemsRef.current.filter((item) => item.status === "failed");
      if (paths.some((path) => path === null)) {
        push({
          tone: "error",
          title: failures.length === 1 ? "An image didn’t upload" : `${failures.length} images didn’t upload`,
          description: `${failures[0]?.error ?? ""} Nothing has been sent — press ${internal ? "Save note" : "Reply"} to try again, or remove ${failures.length === 1 ? "the image" : "those images"}.`,
          duration: 8000,
        });
        return;
      }

      try {
        await api(`/api/tickets/${ticketId}/comments`, {
          method: "POST",
          json: {
            message: text,
            is_internal: internal,
            attachments: snapshot.map((item, index) => ({
              path: paths[index],
              name: item.image?.name ?? "image",
              width: item.image?.width ?? null,
              height: item.image?.height ?? null,
            })),
          },
        });
      } catch (error) {
        if (!alreadyPosted(error)) {
          if (definitelyRejected(error)) {
            discardUploads(paths.filter((path): path is string => path !== null));
            update((current) =>
              current.map((item) => ({ ...item, status: item.image ? "ready" : item.status, path: undefined })),
            );
          }
          push({
            tone: "error",
            title: "Could not post that",
            description: postFailure(error),
            duration: 8000,
          });
          return;
        }
      }

      snapshot.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
      update(() => []);
      setMessage("");
      setInternal(false);
      router.refresh();
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  // Paste anywhere on the page that is not some other field: a screenshot
  // taken while reading the thread goes straight into the reply.
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      if (event.defaultPrevented || !event.clipboardData) return;
      if (event.target !== textareaRef.current && (isEditable(event.target) || overlayOpen())) return;
      const files = filesFromClipboard(event.clipboardData);
      if (!files) return;
      event.preventDefault();
      addFiles(files, "paste");
      textareaRef.current?.focus({ preventScroll: true });
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [addFiles]);

  // Drop anywhere on the page. Without this, missing the box by a few pixels
  // makes the browser open the image in place of the page — and the half
  // written reply goes with it.
  useEffect(() => {
    let depth = 0;

    function onDragEnter(event: DragEvent) {
      if (!isFileDrag(event) || overlayOpen()) return;
      depth += 1;
      setDragging(true);
    }
    function onDragOver(event: DragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = overlayOpen() ? "none" : "copy";
    }
    function onDragLeave(event: DragEvent) {
      if (!isFileDrag(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    }
    function onDrop(event: DragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      if (overlayOpen()) return;

      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) {
        push({
          tone: "error",
          title: "Nothing to attach",
          description: "That couldn’t be read as a file. Save the image first, then drop the saved file.",
        });
        return;
      }
      addFiles(files, "drop");
      formRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      textareaRef.current?.focus({ preventScroll: true });
    }
    function reset() {
      depth = 0;
      setDragging(false);
    }

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("blur", reset);
    };
  }, [addFiles, push]);

  // Closing the tab mid-upload would strand files and lose the message.
  useEffect(() => {
    if (!sending) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [sending]);

  const preparing = items.some((item) => item.status === "preparing");
  const full = items.length >= MAX_ATTACHMENTS;
  const canSend = !preparing && (message.trim().length > 0 || items.length > 0);
  const uploadingCount = items.filter((item) => item.status === "uploading").length;

  const hint = preparing
    ? "Preparing image…"
    : uploadingCount > 0
      ? `Uploading ${uploadingCount} ${uploadingCount === 1 ? "image" : "images"}…`
      : items.length > 0
        ? `${items.length} of ${MAX_ATTACHMENTS} images`
        : "Paste, drop or attach screenshots";

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      className="card space-y-3 p-4"
    >
      <Textarea
        ref={textareaRef}
        rows={3}
        value={message}
        readOnly={sending}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send();
          }
        }}
        aria-label={internal ? "Internal note" : "Reply"}
        aria-describedby={hintId}
        placeholder={
          internal ? "Internal note — the requester will not see this…" : "Add a reply…"
        }
        className={cn(
          internal && "border-[rgb(245_158_11_/_0.4)] bg-[rgb(245_158_11_/_0.05)]",
        )}
      />

      {items.length > 0 && (
        <ul aria-label="Images to send" className="flex flex-wrap gap-2">
          {items.map((item) => (
            <PendingImage
              key={item.key}
              item={item}
              disabled={sending}
              onRemove={() => remove(item.key)}
            />
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || full}
            aria-label="Attach images"
            title={full ? `Up to ${MAX_ATTACHMENTS} images per message` : "Attach images — or paste or drop them"}
            className={cn(
              "inline-flex size-8 flex-none items-center justify-center rounded-lg border border-line",
              "text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink",
              "disabled:pointer-events-none disabled:opacity-45",
            )}
          >
            <Icons.image />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            tabIndex={-1}
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []), "picker");
              // Picking the same file again must still fire a change.
              event.target.value = "";
            }}
          />

          {isAgent && (
            <label className="flex flex-none cursor-pointer items-center gap-2 text-[0.8125rem] text-ink-muted">
              <input
                type="checkbox"
                checked={internal}
                disabled={sending}
                onChange={(e) => setInternal(e.target.checked)}
                className="size-3.5 accent-[var(--accent)]"
              />
              Internal note
            </label>
          )}

          <p
            id={hintId}
            aria-live="polite"
            className={cn(
              "min-w-0 truncate text-[0.75rem] text-ink-faint",
              // The idle hint is about keyboards and mice; on a phone the button says it.
              items.length === 0 && !preparing && "hidden sm:block",
            )}
          >
            {hint}
          </p>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="sm"
          loading={sending}
          disabled={!canSend}
          className="flex-none"
        >
          {internal ? "Save note" : "Reply"}
        </Button>
      </div>

      {/* Portalled: an ancestor's transform (the route transition) would
          otherwise turn `fixed` into "fixed to that ancestor". */}
      {isClient &&
        createPortal(
          <AnimatePresence>
            {dragging && (
              <motion.div
                aria-hidden
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-[rgb(0_0_0_/_0.35)] p-6 backdrop-blur-[2px]"
              >
                <div className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-accent bg-canvas-raised px-6 py-5 text-ink shadow-[var(--shadow-lg)]">
                  <Icons.image className="size-5 text-accent" />
                  <div>
                    <p className="text-[0.9375rem] font-medium">
                      {full ? `Already ${MAX_ATTACHMENTS} images` : "Drop to add to your reply"}
                    </p>
                    <p className="text-[0.75rem] text-ink-muted">
                      PNG, JPEG, GIF or WebP · up to {MAX_ATTACHMENTS}, 10 MB each
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </form>
  );
}

function PendingImage({
  item,
  disabled,
  onRemove,
}: {
  item: Item;
  disabled: boolean;
  onRemove: () => void;
}) {
  const name = item.image?.name ?? "Image";
  const busy = item.status === "preparing" || item.status === "uploading";
  const state =
    item.status === "preparing"
      ? "Preparing"
      : item.status === "uploading"
        ? "Uploading"
        : item.status === "failed"
          ? `Not uploaded. ${item.error ?? ""}`
          : null;

  return (
    <li
      title={item.error ?? (item.image ? `${name} · ${formatBytes(item.image.blob.size)}` : undefined)}
      className={cn(
        "relative size-16 overflow-hidden rounded-lg border bg-surface-sunk sm:size-20",
        item.status === "failed" ? "border-[rgb(244_63_94_/_0.7)]" : "border-line",
      )}
    >
      {item.preview && (
        // eslint-disable-next-line @next/next/no-img-element -- a local object URL; there is nothing for next/image to optimise
        <img
          src={item.preview}
          alt={name}
          className={cn("size-full object-cover", busy && "opacity-55")}
        />
      )}
      {busy && (
        <span className="absolute inset-0 grid place-items-center text-ink">
          <Spinner className="size-4" />
        </span>
      )}
      {item.status === "failed" && (
        <span className="absolute inset-x-0 bottom-0 bg-[rgb(225_29_72_/_0.9)] px-1 py-0.5 text-center text-[0.625rem] font-medium text-white">
          Not uploaded
        </span>
      )}
      {state && <span className="sr-only">{state}</span>}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${name}`}
        className={cn(
          "absolute right-1 top-1 grid size-6 place-items-center rounded-full",
          "bg-[rgb(0_0_0_/_0.6)] text-white transition-colors hover:bg-[rgb(0_0_0_/_0.8)]",
          "disabled:hidden",
        )}
      >
        <Icons.close className="size-3.5" />
      </button>
    </li>
  );
}
