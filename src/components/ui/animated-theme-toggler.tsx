"use client";

import { useEffect, useRef } from "react";
import { Moon, Sun } from "lucide-react";
import { persistTheme, readThemeCookie } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * One reveal at a time across every copy of the button. A second click while
 * the circle is still growing would abort it half-drawn and start another from
 * the same spot, which reads as a stutter rather than a second switch.
 */
let revealing = false;

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  persistTheme(dark ? "dark" : "light");
}

/**
 * The 21st.dev theme toggler: the new theme grows out of the button as a
 * circle until it covers the screen.
 *
 * Unlike the original it keeps no React state. The server already puts the
 * `dark` class on <html> from the theme cookie, so the icons are picked by
 * CSS from that class. A state value would have to start from a guess on the
 * server, and the wrong icon would flip — animating — on every page load.
 */
export function AnimatedThemeToggler({
  className,
  duration = 700,
}: {
  className?: string;
  /** Milliseconds for the circle to reach the farthest corner. */
  duration?: number;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // First visit only: adopt the OS preference and remember it, so the
    // server renders the right theme from the next request onwards.
    if (readThemeCookie()) return;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(prefersDark);
  }, []);

  async function toggle() {
    const root = document.documentElement;
    const next = !root.classList.contains("dark");
    const button = buttonRef.current;

    // Without the View Transitions API, or when motion is reduced, the theme
    // simply switches. Nothing about the result depends on the animation.
    if (
      !button ||
      typeof document.startViewTransition !== "function" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      applyTheme(next);
      return;
    }
    if (revealing) return;
    revealing = true;

    // Turns off the browser's default cross-fade for this transition only
    // (see globals.css), so the old theme holds still under the circle.
    root.dataset.themeReveal = "";
    const transition = document.startViewTransition(() => applyTheme(next));
    transition.finished.finally(() => {
      delete root.dataset.themeReveal;
      revealing = false;
    });

    try {
      await transition.ready;
    } catch {
      // Skipped (the tab was hidden, say). The theme has still changed.
      return;
    }

    const { left, top, width, height } = button.getBoundingClientRect();
    const x = left + width / 2;
    const y = top + height / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

    root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration, easing: "ease-in-out", pseudoElement: "::view-transition-new(root)" },
    );
  }

  /**
   * The icon is the theme a click switches to. The leaving icon fades
   * straight away and the arriving one spins in just after it, so the two
   * never sit on top of each other mid-swap.
   */
  const icon = "col-start-1 row-start-1 size-[1.05rem] transition-[opacity,scale,rotate]";

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={toggle}
      title="Switch theme"
      className={cn(
        "flex size-11 flex-none items-center justify-center rounded-full lg:size-8",
        "text-ink-muted transition-colors duration-150 hover:bg-surface-hover hover:text-ink",
        className,
      )}
    >
      {/* The accessible name follows the theme the same way the icon does. */}
      <span className="sr-only dark:hidden">Switch to dark theme</span>
      <span className="sr-only hidden dark:block">Switch to light theme</span>
      <span className="grid place-items-center" aria-hidden>
        <Moon
          strokeWidth={1.8}
          className={cn(
            icon,
            "duration-[330ms] delay-[120ms]",
            "dark:-rotate-25 dark:scale-55 dark:opacity-0 dark:duration-150 dark:delay-0",
          )}
        />
        <Sun
          strokeWidth={1.8}
          className={cn(
            icon,
            "rotate-25 scale-55 opacity-0 duration-150",
            "dark:rotate-0 dark:scale-100 dark:opacity-100 dark:duration-[330ms] dark:delay-[120ms]",
          )}
        />
      </span>
    </button>
  );
}
