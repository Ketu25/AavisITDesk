"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False during server render and the hydration pass, true afterwards.
 *
 * Anything derived from the current time has to wait for this. The SLA
 * readings are computed from `Date.now()`, so the server and the browser
 * necessarily disagree — rendering them straight away produces a hydration
 * mismatch and React discards the tree. `useSyncExternalStore` is the
 * hydration-safe way to ask "am I on the client yet", unlike a state flag set
 * from an effect.
 */
export function useIsClient() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
