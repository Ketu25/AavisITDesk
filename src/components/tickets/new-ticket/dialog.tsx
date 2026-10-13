"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  motion,
  useDragControls,
  useIsPresent,
  useReducedMotion,
  type PanInfo,
} from "motion/react";
import { useEscape, useFocusTrap, useScrollLock } from "@/components/ui/use-overlay";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useNewTicket } from "./context";
import { NewTicketWizard } from "./wizard";

/** Viewport point the dialog grows out of — the centre of the control that opened it. */
export type Origin = { x: number; y: number };

/** Below `sm`, the dialog is a sheet that rises from the bottom edge. Shared with the quick-ticket dialog. */
export const SHEET_QUERY = "(max-width: 639.98px)";

/** How far, or how fast, a sheet has to be pulled down before letting go closes it. */
export const DISMISS_DISTANCE = 110;
export const DISMISS_VELOCITY = 520;

export function NewTicketDialog({
  origin,
  onClose,
}: {
  origin: Origin | null;
  onClose: () => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const sheet = useMediaQuery(SHEET_QUERY);
  const keyboard = useKeyboardInset(sheet);
  const dragControls = useDragControls();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { categories, loadCategories } = useNewTicket();

  // Held while present, released the moment the exit animation starts —
  // while the dialog is still in the document, so focus can be handed back
  // to whatever opened it. Released at unmount instead, the trap would find
  // its own nodes already gone and leave focus on <body>.
  const present = useIsPresent();
  useEscape(present, onClose);
  useScrollLock(present);
  useFocusTrap(panelRef, present);

  // Every open asks again — cheap, and it is how an admin's change to the
  // list reaches someone who already had it loaded. What is cached shows
  // straight away in the meantime.
  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  /**
   * On a pointer screen the dialog grows out of the control that opened it,
   * so it reads as that button unfolding rather than something arriving from
   * nowhere. Set on the node during commit — before the first frame paints —
   * from layout offsets, which ignore the entrance transform already applied.
   * The container is fixed at the viewport origin, so offsets are viewport
   * coordinates. Without an origin (the palette, a shortcut) it grows from
   * its own centre.
   */
  const setPanel = useCallback(
    (node: HTMLDivElement | null) => {
      panelRef.current = node;
      if (!node) return;
      node.style.transformOrigin =
        origin && !sheet ? `${origin.x - node.offsetLeft}px ${origin.y - node.offsetTop}px` : "";
    },
    [origin, sheet],
  );

  const startDrag = useCallback(
    (event: React.PointerEvent) => {
      // A press on a control in the header is a click, not a grab.
      if ((event.target as HTMLElement).closest("button, a, input, textarea")) return;
      dragControls.start(event);
    },
    [dragControls],
  );

  function onDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.y > DISMISS_DISTANCE || info.velocity.y > DISMISS_VELOCITY) onClose();
  }

  const enter = reduced
    ? { opacity: 0 }
    : sheet
      ? { opacity: 1, y: "100%", scale: 1 }
      : { opacity: 0, y: 10, scale: 0.92 };

  const leave = reduced
    ? { opacity: 0, transition: { duration: 0.12 } }
    : sheet
      ? { opacity: 1, y: "100%", transition: { duration: 0.24, ease: ease.exit } }
      : { opacity: 0, y: 6, scale: 0.96, transition: { duration: 0.16, ease: ease.exit } };

  return (
    <div
      className={cn(
        "fixed inset-0 z-[60] flex justify-center",
        sheet ? "items-end" : "items-center p-6",
      )}
    >
      <motion.div
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.2, ease: ease.exit } }}
        transition={{ duration: 0.22, ease: ease.standard }}
        onClick={onClose}
        className="fixed inset-0 bg-black/45 backdrop-blur-[3px]"
      />

      <motion.div
        ref={setPanel}
        role="dialog"
        aria-modal="true"
        aria-label="New ticket"
        tabIndex={-1}
        initial={enter}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={leave}
        transition={
          reduced
            ? { duration: 0.16 }
            : sheet
              ? { type: "spring", stiffness: 420, damping: 40 }
              : { type: "spring", stiffness: 380, damping: 32, mass: 0.9 }
        }
        drag={sheet && !reduced ? "y" : false}
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.85 }}
        onDragEnd={onDragEnd}
        style={
          keyboard
            ? // Sit on top of the on-screen keyboard instead of behind it.
              { marginBottom: keyboard.inset, maxHeight: keyboard.height - 8 }
            : undefined
        }
        className={cn(
          "relative flex w-full flex-col overflow-hidden outline-none",
          "border-line-strong bg-canvas-raised shadow-[var(--shadow-lg)]",
          sheet
            ? "max-h-[calc(100dvh-2rem)] rounded-t-[22px] border-x border-t"
            : "max-h-[min(48rem,calc(100dvh-3rem))] max-w-[36rem] rounded-[20px] border",
        )}
      >
        {/* A lit top edge, the same highlight the cards carry in dark mode. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-[var(--accent-line)] to-transparent"
        />

        {sheet && (
          <div
            aria-hidden
            onPointerDown={startDrag}
            className="flex h-5 flex-none cursor-grab touch-none items-end justify-center active:cursor-grabbing"
          >
            <span className="h-1 w-10 rounded-full bg-line-strong" />
          </div>
        )}

        <NewTicketWizard
          variant="dialog"
          sheet={sheet}
          categories={categories.list}
          categoriesFailed={categories.failed}
          categoriesLoading={categories.loading}
          onRetryCategories={loadCategories}
          onClose={onClose}
          onGrab={sheet && !reduced ? startDrag : undefined}
        />
      </motion.div>
    </div>
  );
}

/**
 * How much of the bottom of the layout viewport the on-screen keyboard is
 * covering, and how tall the part left visible is.
 *
 * iOS Safari, and Chrome on Android by default, shrink only the *visual*
 * viewport when the keyboard opens; a sheet fixed to the bottom of the layout
 * viewport ends up underneath it, along with the field being typed into. The
 * visual viewport reports what is actually visible, including any panning the
 * browser has done to reveal the focused field. A pinch-zoom shrinks the
 * visual viewport too, but that is not a keyboard and is ignored.
 */
export function useKeyboardInset(enabled: boolean) {
  const [state, setState] = useState<{ inset: number; height: number } | null>(null);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!enabled || !viewport) return;

    const read = () => {
      const inset =
        viewport.scale > 1.01
          ? 0
          : Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
      // Under ~80px is browser chrome settling, not a keyboard.
      const next = inset > 80 ? { inset, height: Math.round(viewport.height) } : null;
      setState((prev) =>
        prev?.inset === next?.inset && prev?.height === next?.height ? prev : next,
      );
    };

    viewport.addEventListener("resize", read);
    viewport.addEventListener("scroll", read);
    return () => {
      viewport.removeEventListener("resize", read);
      viewport.removeEventListener("scroll", read);
    };
  }, [enabled]);

  return enabled ? state : null;
}
