/**
 * The reader's time zone, carried to the server in a cookie.
 *
 * The app renders on Cloudflare Workers, where the clock is always UTC. Left
 * alone, anything that depends on the reader's day — "Good afternoon", which
 * month a ticket was raised in — comes out in UTC on the server and in local
 * time in the browser, which is both wrong for the reader and a hydration
 * mismatch. The browser reports its zone once; from the next request on the
 * server renders in it, and the browser only has to correct the very first
 * page.
 */

export const TZ_COOKIE = "aavis-tz";

/** IANA names only: `Asia/Kolkata`, `America/Argentina/Buenos_Aires`,
 *  `Etc/GMT+5`. Every one of them is already cookie-safe, so nothing is
 *  encoded and nothing else is accepted. */
const IANA_NAME = /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/;

/** The zone if the runtime recognises it, otherwise null. Never throws. */
export function safeTimeZone(value: string | null | undefined): string | null {
  if (!value || !IANA_NAME.test(value)) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

/** 0–23 in `timeZone`. `h23` because `hour12: false` reports midnight as 24 in
 *  some engines. */
export function hourIn(timeZone: string, at: number) {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
  })
    .formatToParts(at)
    .find((part) => part.type === "hour")?.value;
  return Number(hour) % 24;
}

export type DayPart = "morning" | "afternoon" | "evening";

export function dayPart(hour: number): DayPart {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}
