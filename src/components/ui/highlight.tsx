"use client";

import { useMemo } from "react";
import { findMatchRanges } from "@/lib/search";

/**
 * Marks the parts of `text` a search actually matched.
 *
 * Without it a filtered list is a claim the user has to take on trust — three
 * rows come back and nothing on them says why. The mark is drawn in the accent,
 * not the browser's default yellow, so it reads as part of the interface in
 * both themes.
 *
 * Matching is accent- and case-insensitive, so the highlight can sit over
 * letters that do not look like what was typed; the ranges come back indexed
 * against the original text, which is what keeps it around the right ones.
 */
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const ranges = useMemo(() => findMatchRanges(text, terms), [text, terms]);

  if (ranges.length === 0) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const [start, end] of ranges) {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark
        key={start}
        className="rounded-[3px] bg-accent-soft px-0.5 text-accent decoration-clone"
      >
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));

  return <>{parts}</>;
}
