"use client";

import { useEffect } from "react";
import { persistTheme, readThemeCookie } from "@/lib/theme";

/**
 * No React state: the source of truth is the `dark` class the server put on
 * <html>. Both icons render and CSS picks one, which keeps this correct
 * through SSR without an effect or a hydration mismatch.
 */
export function ThemeToggle() {
  useEffect(() => {
    // First visit only: adopt the OS preference and remember it, so the
    // server renders the right theme from the next request onwards.
    if (readThemeCookie()) return;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", prefersDark);
    persistTheme(prefersDark ? "dark" : "light");
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    persistTheme(next ? "dark" : "light");
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle colour theme"
      title="Toggle colour theme"
      className="relative flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
    >
      <svg
        viewBox="0 0 20 20"
        className="size-[1.05rem] transition-transform duration-300 dark:hidden"
        fill="none"
        aria-hidden
      >
        <circle cx="10" cy="10" r="3.4" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M10 2.6v1.6M10 15.8v1.6M17.4 10h-1.6M4.2 10H2.6M15.2 4.8l-1.1 1.1M5.9 14.1l-1.1 1.1M15.2 15.2l-1.1-1.1M5.9 5.9 4.8 4.8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <svg
        viewBox="0 0 20 20"
        className="hidden size-[1.05rem] transition-transform duration-300 dark:block"
        fill="none"
        aria-hidden
      >
        <path
          d="M16.5 11.8A7 7 0 0 1 8.2 3.5a7 7 0 1 0 8.3 8.3Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
