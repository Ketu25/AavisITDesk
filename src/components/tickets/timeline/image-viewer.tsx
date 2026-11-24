"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { Icons } from "@/components/shell/icons";
import { Spinner } from "@/components/ui/spinner";
import { useEscape, useFocusTrap, useScrollLock } from "@/components/ui/use-overlay";
import { attachmentUrl, formatBytes } from "@/lib/attachments";
import { cn } from "@/lib/utils";
import type { AttachmentSummary } from "./types";

const TOOL =
  "inline-flex size-9 flex-none items-center justify-center rounded-lg text-white/80 " +
  "transition-colors hover:bg-white/10 hover:text-white";

/**
 * A chat image at full size, over everything. Arrow keys and the side buttons
 * step through the other images in the same message; Escape, the close button
 * or a click on the backdrop closes it.
 *
 * Portalled to the body: the message it opens from animates with a transform,
 * and `fixed` inside a transformed element is fixed to that element.
 */
export function ImageViewer({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: AttachmentSummary[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const count = images.length;
  const current = images[Math.min(index, count - 1)];

  useEscape(true, onClose);
  useScrollLock(true);
  useFocusTrap(panelRef, true);

  const step = useCallback(
    (delta: number) => onIndex((index + delta + count) % count),
    [count, index, onIndex],
  );

  useEffect(() => {
    if (count < 2) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowRight") step(1);
      else if (event.key === "ArrowLeft") step(-1);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [count, step]);

  if (!current) return null;

  return createPortal(
    <motion.div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={count > 1 ? `Image ${index + 1} of ${count}: ${current.file_name}` : current.file_name}
      tabIndex={-1}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[60] flex flex-col bg-[rgb(4_8_14_/_0.9)] outline-none backdrop-blur-sm"
    >
      <div className="flex items-center gap-1 px-3 py-2 text-white sm:px-4">
        <p className="min-w-0 flex-1 truncate pr-2 text-[0.8125rem]">
          {current.file_name}
          <span className="text-white/55"> · {formatBytes(current.size_bytes)}</span>
        </p>
        {count > 1 && (
          <span className="readout px-2 text-[0.75rem] text-white/70">
            {index + 1} / {count}
          </span>
        )}
        <a
          href={attachmentUrl(current.id)}
          target="_blank"
          rel="noopener noreferrer"
          className={TOOL}
          aria-label="Open the original in a new tab"
          title="Open original"
        >
          <Icons.external />
        </a>
        <a
          href={attachmentUrl(current.id, { download: true })}
          className={TOOL}
          aria-label={`Download ${current.file_name}`}
          title="Download"
        >
          <Icons.download />
        </a>
        <button type="button" onClick={onClose} className={TOOL} aria-label="Close" data-autofocus>
          <Icons.close />
        </button>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-3 pb-4 sm:px-16"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        {/* Keyed so each image starts in its own loading state. */}
        <FullImage key={current.id} attachment={current} />

        {count > 1 && (
          <>
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous image"
              className={cn(TOOL, "absolute left-2 top-1/2 -translate-y-1/2 bg-black/30 sm:left-4")}
            >
              <Icons.arrowLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next image"
              className={cn(TOOL, "absolute right-2 top-1/2 -translate-y-1/2 bg-black/30 sm:right-4")}
            >
              <Icons.arrowRight className="size-4" />
            </button>
          </>
        )}
      </div>
    </motion.div>,
    document.body,
  );
}

function FullImage({ attachment }: { attachment: AttachmentSummary }) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- a private image behind a per-reader redirect; next/image's optimiser cannot fetch it */}
      <img
        src={attachmentUrl(attachment.id)}
        alt={attachment.file_name}
        onLoad={() => setState("loaded")}
        onError={() => setState("failed")}
        className={cn(
          "max-h-full max-w-full rounded-md object-contain shadow-[0_20px_60px_rgb(0_0_0_/_0.5)]",
          "transition-opacity duration-200",
          state === "loaded" ? "opacity-100" : "opacity-0",
        )}
      />
      {state === "loading" && (
        <span className="pointer-events-none absolute inset-0 grid place-items-center text-white/70" aria-hidden>
          <Spinner className="size-6" />
        </span>
      )}
      {state === "failed" && (
        <p className="pointer-events-none absolute inset-0 grid place-items-center text-[0.875rem] text-white/75">
          This image couldn’t be loaded.
        </p>
      )}
    </>
  );
}
