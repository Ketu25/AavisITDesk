"use client";

import { useSyncExternalStore } from "react";

/**
 * One shared wall clock for everything that renders "how long ago".
 *
 * Null during the server render and the hydration pass, a timestamp after.
 * That split is the whole point: anything derived from the current time can
 * render the same markup on both sides first, and only then start reading the
 * real clock — the same contract as `useIsClient`, plus a tick so "4 minutes
 * ago" keeps up with the page it sits on.
 *
 * One interval serves every subscriber, started by the first and stopped by
 * the last, so a list of fifty timestamps costs one timer, not fifty.
 */

const TICK_MS = 15_000;

/** Zero means "not running" — the reading is unknown rather than stale. */
let now = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function tick() {
  now = Date.now();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    // React re-reads the snapshot right after subscribing, so taking a fresh
    // reading here is what replaces the placeholder render.
    now = Date.now();
    timer = setInterval(tick, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
      // Forget the reading: the next subscriber would otherwise render a time
      // from whenever the last one left.
      now = 0;
    }
  };
}

const getSnapshot = () => now;
const getServerSnapshot = () => 0;

export function useNow(): number | null {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return value === 0 ? null : value;
}
