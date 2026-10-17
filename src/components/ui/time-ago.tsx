"use client";

import { useNow } from "./use-now";
import { absoluteTime, relativeTime } from "@/lib/format";

/**
 * "4 minutes ago", safe to server-render and kept current while it is on
 * screen.
 *
 * Rendered straight from `relativeTime`, a timestamp is wrong twice over on
 * hydration: the server and the browser read the clock seconds apart, and the
 * server formats the tooltip in its own time zone (UTC on Workers) rather than
 * the reader's. Either difference makes React throw the server markup away and
 * redraw the page. Here the text tolerates the few seconds of drift — a
 * timestamp is the case `suppressHydrationWarning` exists for — and the
 * tooltip is left off until the browser can format it in local time.
 */
export function TimeAgo({
  value,
  className,
}: {
  value: string | null | undefined;
  className?: string;
}) {
  const now = useNow();

  if (!value) return <span className={className}>—</span>;

  // Everything shown here has already happened, so a time ahead of the clock
  // is "now", not "in 12 seconds": the shared clock only ticks every 15
  // seconds, and the database's clock is not the browser's, so a ticket sent a
  // moment ago can carry a timestamp the page's reading has not reached yet.
  const at = Date.parse(value);
  const reading = now === null ? null : Number.isNaN(at) ? now : Math.max(now, at);

  return (
    <time
      dateTime={value}
      title={reading === null ? undefined : absoluteTime(value)}
      className={className}
      suppressHydrationWarning
    >
      {reading === null ? relativeTime(value) : relativeTime(value, reading)}
    </time>
  );
}
