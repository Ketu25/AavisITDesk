"use client";

import { useEffect } from "react";

/**
 * Writes the pointer's position into every `.quick-tile` inside `ref`, in that
 * tile's own pixels, and marks the container `[data-spot]` while a mouse is
 * over it. The light itself is CSS (`.spot-ring`, `.spot-wash` in
 * globals.css). No React state: a pointer moving is not a reason to render,
 * and a frame is the most it can cost.
 */
export function useSpotlight(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let frame = 0;
    let x = 0;
    let y = 0;

    const paint = () => {
      frame = 0;
      for (const tile of root.querySelectorAll<HTMLElement>(".quick-tile")) {
        const rect = tile.getBoundingClientRect();
        tile.style.setProperty("--spot-x", `${x - rect.left}px`);
        tile.style.setProperty("--spot-y", `${y - rect.top}px`);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      x = event.clientX;
      y = event.clientY;
      root.dataset.spot = "";
      schedule();
    };
    const leave = () => {
      delete root.dataset.spot;
    };
    // The page moving under a still pointer moves the light too.
    const scroll = () => {
      if (root.dataset.spot !== undefined) schedule();
    };

    root.addEventListener("pointermove", move, { passive: true });
    root.addEventListener("pointerleave", leave);
    window.addEventListener("scroll", scroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", leave);
      window.removeEventListener("scroll", scroll);
    };
  }, [ref]);
}
