"use client";

import { useEffect } from "react";
import { TZ_COOKIE, safeTimeZone } from "@/lib/timezone";

/**
 * Tells the server which zone this browser is in, so the next render can use
 * it. Writes only when the cookie is missing or out of date — a laptop that
 * travels gets corrected on its first page in the new zone.
 */
export function TimeZoneSync() {
  useEffect(() => {
    const zone = safeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (!zone) return;

    const current = document.cookie.match(new RegExp(`(?:^|; )${TZ_COOKIE}=([^;]*)`))?.[1];
    if (current === zone) return;

    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${TZ_COOKIE}=${zone}; path=/; max-age=31536000; samesite=lax${secure}`;
  }, []);

  return null;
}
