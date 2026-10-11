"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A live `matchMedia` answer. False on the server and through hydration, so
 * only use it to decide things that are not in the server-rendered markup —
 * how an overlay moves, which control takes focus — never what is printed.
 */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (notify: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
