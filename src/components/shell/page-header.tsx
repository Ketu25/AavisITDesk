"use client";

import { useEffect, useState } from "react";
import { MobileNavTrigger } from "./mobile-nav";
import { cn } from "@/lib/utils";

/**
 * The bar every screen hangs from.
 *
 * It does not animate its own arrival any more — <RouteTransition> brings the
 * whole page in as one movement, and a header that faded separately made a
 * single navigation look like two.
 *
 * What it does do is react to scroll: once the content has moved underneath
 * it, the bar earns an edge. While the page is at rest the seam is invisible,
 * which is the point — the chrome only asserts itself when it is overlapping
 * something.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  const lifted = useScrolled();

  return (
    <header
      data-lifted={lifted || undefined}
      className={cn(
        "sticky top-0 z-30 border-b bg-canvas/85 backdrop-blur-xl",
        "border-transparent transition-[border-color,box-shadow] duration-300",
        "data-[lifted]:border-line data-[lifted]:shadow-[var(--shadow-sm)]",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
        {/* The drawer trigger sits inside the bar rather than floating over
            it, so the title no longer has to reserve a hole to avoid it. */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <MobileNavTrigger />
          <div className="min-w-0">
            <h1 className="truncate text-[0.9375rem] font-semibold tracking-tight text-ink">
              {title}
            </h1>
            {description && (
              <p className="mt-0.5 truncate text-[0.8125rem] text-ink-muted">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex flex-none items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/**
 * True once the window has scrolled past the point where the header overlaps
 * content. Read from a passive listener rather than a scroll-linked motion
 * value: this is a boolean that flips once, not something that tracks.
 */
function useScrolled(threshold = 8) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const read = () => setScrolled(window.scrollY > threshold);
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, [threshold]);

  return scrolled;
}

export function PageBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-[80rem] flex-1 px-4 py-5 sm:px-6", className)}>
      {children}
    </div>
  );
}
