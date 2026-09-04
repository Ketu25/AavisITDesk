"use client";

import { RAIL } from "./rail";
import { cn } from "@/lib/utils";

function label(date: Date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

/**
 * Breaks the stream by day. On a ticket that ran for a week this is the
 * difference between a wall of entries and a record you can navigate.
 */
export function DayDivider({ at, className }: { at: string; className?: string }) {
  return (
    <li className={cn("relative", RAIL, className)}>
      <div className="flex items-center gap-3 py-1">
        <span className="eyebrow rounded-full border border-line bg-canvas px-2 py-0.5">
          {label(new Date(at))}
        </span>
        <span aria-hidden className="h-px flex-1 bg-line" />
      </div>
    </li>
  );
}
