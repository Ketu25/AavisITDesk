"use client";

import { useEffect, type RefObject } from "react";

/**
 * The three behaviours every overlay in the app owes the keyboard.
 *
 * They live together because they are always used together: an overlay that
 * traps focus but cannot be dismissed with Escape is worse than one that does
 * neither, since it strands anyone not using a mouse.
 */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Visible and reachable — `offsetParent` is null for anything display:none. */
function focusablesIn(node: HTMLElement) {
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || getComputedStyle(el).position === "fixed",
  );
}

/**
 * Keeps Tab inside `ref` while `active`, and hands focus back to whatever had
 * it when the overlay closes — without that, dismissing a drawer drops the
 * caret at the top of the document and the next Tab starts over.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const node = ref.current;
    if (!active || !node) return;

    const restoreTo = document.activeElement as HTMLElement | null;

    // Synchronously, not on the next frame. requestAnimationFrame does not
    // run in a backgrounded tab, and deferring to it left the Tab handler
    // below armed while focus was still outside the overlay — the worst of
    // both states. `preventScroll` keeps the entrance animation from being
    // yanked into view mid-flight.
    const [first] = focusablesIn(node);
    (first ?? node).focus({ preventScroll: true });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || !node) return;
      const items = focusablesIn(node);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;

      if (event.shiftKey && (current === first || !node.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Only reclaim focus if it is still somewhere inside the overlay we are
      // tearing down; if the user has already clicked elsewhere, leave it.
      if (!node.contains(document.activeElement)) return;
      restoreTo?.focus?.({ preventScroll: true });
    };
  }, [ref, active]);
}

/**
 * Freezes the page behind an overlay. Restores the caller's own value rather
 * than clearing it, so two overlaps do not fight over the style.
 */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}

/**
 * Escape closes. Bound to the document so it works wherever focus sits.
 *
 * `capture` + `stopPropagation` is how a nested overlay claims the key. A
 * dropdown inside a dialog owes Escape to the dropdown only, but both listen on
 * `document`, so ordering by registration does not help — the dialog mounted
 * first and its bubble-phase listener runs first. Claiming the event on the way
 * *down* is the only point at which the inner overlay is still ahead.
 */
export function useEscape(
  active: boolean,
  onEscape: () => void,
  { capture = false, stopPropagation = false } = {},
) {
  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (stopPropagation) event.stopPropagation();
      onEscape();
    }
    document.addEventListener("keydown", onKeyDown, capture);
    return () => document.removeEventListener("keydown", onKeyDown, capture);
  }, [active, onEscape, capture, stopPropagation]);
}
