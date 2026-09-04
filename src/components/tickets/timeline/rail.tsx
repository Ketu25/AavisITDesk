"use client";

import { cn } from "@/lib/utils";

/** Width of the rail gutter. Everything on the timeline aligns to this. */
export const RAIL = "pl-9";

/**
 * The spine. A single hairline runs the height of the stream so the whole
 * ticket reads as one continuous record rather than a pile of cards.
 */
export function RailLine() {
  return (
    <span
      aria-hidden
      className="absolute bottom-0 left-[11px] top-0 w-px bg-line"
    />
  );
}

const MARKER_COLOR = {
  neutral: "var(--ink-faint)",
  ok: "var(--spec-ok)",
  warn: "var(--spec-warn)",
  fail: "var(--spec-fail)",
} as const;

/**
 * A node sitting on the spine. Ringed in the page background so the rail
 * appears to pass behind it rather than through it.
 */
export function RailMarker({
  tone = "neutral",
  size = "sm",
  className,
}: {
  tone?: keyof typeof MARKER_COLOR;
  size?: "sm" | "lg";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute left-[11px] -translate-x-1/2 rounded-full ring-4 ring-canvas",
        size === "sm" ? "size-[7px]" : "size-2.5",
        className,
      )}
      style={{ background: MARKER_COLOR[tone] }}
    />
  );
}
