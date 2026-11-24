"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Icons } from "@/components/shell/icons";
import { attachmentUrl } from "@/lib/attachments";
import { cn } from "@/lib/utils";
import type { AttachmentSummary } from "./types";

// Opened by a click and never by the server, so it stays out of the Worker.
const ImageViewer = dynamic(() => import("./image-viewer").then((m) => m.ImageViewer), {
  ssr: false,
});

/**
 * The images in one message. A single image keeps its shape; several sit in a
 * two-column grid of even tiles. Either way a click opens the full image.
 */
export function AttachmentGallery({ attachments }: { attachments: AttachmentSummary[] }) {
  const [open, setOpen] = useState<number | null>(null);
  // The viewer unmounts outright, so its focus trap cannot hand focus back;
  // the thumbnail that opened it takes it here instead.
  const openerRef = useRef<HTMLElement | null>(null);
  const single = attachments.length === 1;

  function close() {
    openerRef.current?.focus({ preventScroll: true });
    setOpen(null);
  }

  return (
    <>
      <ul
        aria-label={single ? "Attached image" : `${attachments.length} attached images`}
        // A fixed width with a percentage cap, not min(20rem, 100%): inside the
        // shrink-to-fit bubble a percentage width stretches the bubble to its
        // maximum first, leaving the grid adrift in empty space.
        className={cn(single ? "flex max-w-full" : "grid w-80 max-w-full grid-cols-2 gap-1.5")}
      >
        {attachments.map((attachment, index) => (
          <li key={attachment.id} className="min-w-0 max-w-full">
            <Thumbnail
              attachment={attachment}
              single={single}
              onOpen={(opener) => {
                openerRef.current = opener;
                setOpen(index);
              }}
            />
          </li>
        ))}
      </ul>

      {open !== null && (
        <ImageViewer
          images={attachments}
          index={open}
          onIndex={setOpen}
          onClose={close}
        />
      )}
    </>
  );
}

function Thumbnail({
  attachment,
  single,
  onOpen,
}: {
  attachment: AttachmentSummary;
  single: boolean;
  onOpen: (opener: HTMLElement) => void;
}) {
  const [failed, setFailed] = useState(false);
  // Bumped by "retry": a new URL skips the cached redirect that just failed.
  const [attempt, setAttempt] = useState(0);
  const src = `${attachmentUrl(attachment.id)}${attempt > 0 ? `?retry=${attempt}` : ""}`;

  if (failed) {
    return (
      <button
        type="button"
        onClick={() => {
          setFailed(false);
          setAttempt((n) => n + 1);
        }}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2.5 text-left",
          "text-[0.75rem] text-ink-faint transition-colors hover:text-ink",
        )}
      >
        <Icons.image className="size-4 flex-none" />
        <span className="min-w-0">
          <span className="block truncate">{attachment.file_name}</span>
          <span className="block">Didn’t load · Retry</span>
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={(event) => onOpen(event.currentTarget)}
      aria-label={`Open ${attachment.file_name}`}
      className={cn(
        "block max-w-full overflow-hidden rounded-lg border border-line bg-surface-sunk",
        "transition-[filter] hover:brightness-95",
        !single && "w-full",
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a private image behind a per-reader redirect; next/image's optimiser cannot fetch it */}
      <img
        src={src}
        alt={attachment.file_name}
        // Reserves the right shape before the bytes arrive, so the thread
        // does not jump as images load.
        width={attachment.width ?? undefined}
        height={attachment.height ?? undefined}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={
          single
            ? "block h-auto max-h-72 w-auto max-w-full object-contain"
            : "block aspect-[4/3] w-full object-cover"
        }
      />
    </button>
  );
}
