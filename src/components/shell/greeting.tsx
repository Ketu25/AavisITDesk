"use client";

import { useNow } from "@/components/ui/use-now";
import { dayPart, type DayPart } from "@/lib/timezone";

/**
 * "Good afternoon, Nandini" by the reader's clock, not the server's.
 *
 * The server's guess (from the time-zone cookie) is what the first paint and
 * the hydration pass both show, so they agree; after that the browser's own
 * hour takes over. With no cookie yet — a first visit — the server has no
 * honest guess and says hello instead of risking "Good morning" at 9 pm.
 */
export function Greeting({ name, serverPart }: { name: string; serverPart: DayPart | null }) {
  const now = useNow();
  const part = now === null ? serverPart : dayPart(new Date(now).getHours());
  return <>{part ? `Good ${part}, ${name}` : `Hello, ${name}`}</>;
}
