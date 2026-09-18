"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

/**
 * Places a portalled panel against a trigger, inside the viewport.
 *
 * Extracted from the Select when the row-actions Menu needed the same thing.
 * The rule it enforces is the one a naive `top: rect.bottom` gets wrong: a
 * panel opened from the lower third of a page runs off the bottom edge, and
 * the part past the edge cannot be reached at all. So it clamps on both axes,
 * flips above the trigger when below cannot hold the content, and caps the
 * height to whatever the chosen side actually has. Panels scroll, so a cap
 * costs nothing; overflowing costs the content.
 */

/** Breathing room kept between the panel and the edge of the viewport. */
const VIEWPORT_MARGIN = 8;
/** Distance between the trigger and the panel. */
const TRIGGER_GAP = 6;

export type Placement = {
  left: number;
  width: number;
  maxHeight: number;
  /** Distance from the top of the viewport, for a panel below the trigger. */
  top: number;
  /** Distance from the bottom, for a panel flipped above it. */
  bottom: number;
  above: boolean;
};

export type AnchoredPanelOptions = {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLElement | null>;
  /** "anchor" matches the trigger's width (a select); a number is fixed (a menu). */
  width: "anchor" | number;
  /** Which edge of the panel lines up with the same edge of the trigger. */
  align?: "start" | "end";
  /** The height the content would like, used only to choose a side. */
  desiredHeight: number;
  /** The tallest the panel may get when there is room. */
  maxHeight: number;
};

export function useAnchoredPanel({
  open,
  onClose,
  anchorRef,
  panelRef,
  width,
  align = "start",
  desiredHeight,
  maxHeight,
}: AnchoredPanelOptions) {
  const [placement, setPlacement] = useState<Placement | null>(null);

  const measure = useCallback(() => {
    const node = anchorRef.current;
    if (!node) return;

    const box = node.getBoundingClientRect();
    // clientWidth/clientHeight exclude the scrollbars, which is the box a
    // `position: fixed` element is laid out in. innerWidth would let the panel
    // slide under a vertical scrollbar.
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    const panelWidth = Math.min(
      width === "anchor" ? box.width : width,
      vw - VIEWPORT_MARGIN * 2,
    );
    const preferredLeft = align === "end" ? box.right - panelWidth : box.left;
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, preferredLeft),
      Math.max(VIEWPORT_MARGIN, vw - panelWidth - VIEWPORT_MARGIN),
    );

    const spaceBelow = vh - box.bottom - TRIGGER_GAP - VIEWPORT_MARGIN;
    const spaceAbove = box.top - TRIGGER_GAP - VIEWPORT_MARGIN;
    const wanted = Math.min(maxHeight, desiredHeight);

    // Flip only when below genuinely cannot hold the content and above does
    // better. A panel that changes sides over a couple of pixels reads as a
    // glitch, so the test is not "is there room for all of it".
    const above = spaceBelow < wanted && spaceAbove > spaceBelow;

    setPlacement({
      left,
      width: panelWidth,
      maxHeight: Math.min(wanted, Math.max(above ? spaceAbove : spaceBelow, 0)),
      top: box.bottom + TRIGGER_GAP,
      bottom: vh - box.top + TRIGGER_GAP,
      above,
    });
  }, [anchorRef, width, align, desiredHeight, maxHeight]);

  // Keeps the panel attached while the page moves, and dismisses it on an
  // outside press. The state writes live in listener callbacks, not in the
  // effect body — this project does not setState while rendering an effect.
  useEffect(() => {
    if (!open) return;

    const onScroll = (event: Event) => {
      // Scrolling inside the panel is its own content being read, not the page
      // moving underneath it.
      if (panelRef.current?.contains(event.target as Node)) return;

      // Once the trigger has scrolled out of the viewport the panel points at
      // nothing, so it closes — the same thing a native menu does rather than
      // leaving itself floating over unrelated content.
      const box = anchorRef.current?.getBoundingClientRect();
      if (
        box &&
        (box.bottom < 0 ||
          box.top > document.documentElement.clientHeight ||
          box.right < 0 ||
          box.left > document.documentElement.clientWidth)
      ) {
        onClose();
        return;
      }

      measure();
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };

    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", measure);
    document.addEventListener("pointerdown", onPointerDown, true);

    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", measure);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, measure, onClose, anchorRef, panelRef]);

  return { placement, measure };
}
