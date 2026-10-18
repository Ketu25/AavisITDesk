"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  animate,
  motion,
  useDragControls,
  useMotionValue,
  usePresence,
  useReducedMotion,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
  type PanInfo,
  type Transition,
  type Variants,
} from "motion/react";
import { useEscape, useFocusTrap, useScrollLock } from "@/components/ui/use-overlay";
import { useMediaQuery } from "@/components/ui/use-media-query";
import {
  DISMISS_DISTANCE,
  DISMISS_VELOCITY,
  SHEET_QUERY,
  useKeyboardInset,
} from "@/components/tickets/new-ticket/dialog";
import { ease, spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { QuickIcon } from "./icon";

/** The card's corner and the pop-up's: the frame's corners turn from one to the other as it grows. */
const CARD_RADIUS = 14;
const POPUP_RADIUS = 20;
/** The pop-up header's icon, which the flying icon is drawn at. */
const ICON_SIZE = 44;

/** Growing out of the card: a little give at the end, so it lands rather than stops. */
const GROW: Transition = { type: "spring", stiffness: 320, damping: 28, mass: 0.9 };
/** Going back into it: quicker, and no overshoot — the card has to be exactly where it lands. */
const LAND: Transition = { type: "spring", stiffness: 420, damping: 40 };
const SHEET: Transition = { type: "spring", stiffness: 420, damping: 40 };

/** How the pop-up arrived, decided once as it opens, which also decides how it can leave. */
export type Arrival = "grow" | "sheet" | "fade";

type Rect = Pick<DOMRect, "left" | "top" | "width" | "height">;

const onScreen = (rect: Rect | undefined): rect is Rect =>
  !!rect &&
  rect.width > 0 &&
  rect.height > 0 &&
  rect.top + rect.height > 0 &&
  rect.left + rect.width > 0 &&
  rect.top < window.innerHeight &&
  rect.left < window.innerWidth;

/** The frame's offset and scale that lay the pop-up's box exactly over `from`. */
function cover(from: Rect, to: Rect) {
  return {
    x: from.left + from.width / 2 - (to.left + to.width / 2),
    y: from.top + from.height / 2 - (to.top + to.height / 2),
    sx: from.width / to.width,
    sy: from.height / to.height,
  };
}

/** Shows an element where an animation is about to start, before the next paint rather than on the next frame. */
function paint(node: HTMLElement | null, x: number, y: number, scale: number) {
  if (!node) return;
  node.style.transform = `translateX(${x}px) translateY(${y}px) scale(${scale})`;
  node.style.opacity = "1";
}

/** What the view on show needs from the pop-up around it. */
export type MorphView = {
  /** The dialog element, which takes focus when nothing in a view should. */
  panelRef: React.RefObject<HTMLDivElement | null>;
  /** For the header icon the card's icon flies into and out of. A view without one leaves it unset. */
  iconRef: React.RefObject<HTMLSpanElement | null>;
  /** Nought while the card's icon is still flying in to take the header icon's place. */
  iconOpacity: MotionValue<number>;
  arrival: Arrival;
  reduced: boolean;
  /** A bottom sheet on a phone; a pop-up anywhere wider. */
  sheet: boolean;
  /** Tall as the content, short of the window: the class and, while a keyboard is up, the style. */
  capClass: string;
  capStyle: React.CSSProperties | undefined;
  /** Starts dragging a sheet away from a view's header; unset when it cannot be dragged. */
  dragHeader: ((event: React.PointerEvent) => void) | undefined;
};

/**
 * A card, opened: it grows into a pop-up over the dimmed page, its icon
 * flying up into the header, and closing reverses it — the pop-up shrinks
 * back into the card it came from. The Quick tickets page opens its groups
 * this way, and Quick ticket setup opens the same cards to manage them.
 *
 * This is only the shell: the backdrop, the frame that grows, the flying
 * icon, and moving between views. What each view shows is the caller's
 * (`renderView`), and a new `viewKey` slides the next one in — forward when
 * `dir` is 1, back when it is -1.
 *
 * Must be the child of an <AnimatePresence>: leaving is an animation, and
 * the pop-up is removed once it has landed. On a phone it is a bottom sheet
 * that drags away; for anyone who asked for less motion it simply fades.
 */
export function MorphPopup({
  cardId,
  icon,
  getCard,
  onHide,
  onClose,
  onEscape,
  labelledBy,
  describedBy,
  viewKey,
  dir,
  onViewExitComplete,
  className,
  renderView,
}: {
  /** The card it grows out of, as `getCard` and `onHide` know it. */
  cardId: string;
  icon: string;
  /** The card on the page, which the pop-up grows out of and lands back in. Null when it has gone. */
  getCard: (cardId: string) => HTMLElement | null;
  /** Hide the card while the pop-up stands in for it, and show it again. */
  onHide: (cardId: string, hidden: boolean) => void;
  /** The backdrop pressed, or a sheet dragged away. */
  onClose: () => void;
  onEscape: () => void;
  labelledBy: string;
  describedBy: string | undefined;
  /** Which view is on show; a new key slides the next one in. */
  viewKey: string;
  /** 1 on to a further view, -1 back, 0 for the first. */
  dir: number;
  onViewExitComplete?: () => void;
  /** The pop-up's width, on anything wider than a phone. */
  className?: string;
  renderView: (view: MorphView) => React.ReactNode;
}) {
  const [isPresent, safeToRemove] = usePresence();
  const reduced = useReducedMotion() ?? false;
  const sheet = useMediaQuery(SHEET_QUERY);
  const keyboard = useKeyboardInset(sheet);
  const dragControls = useDragControls();

  const panelRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  // Everything that moves is a motion value, driven from here, so arriving,
  // leaving and arriving again half-way out all start from wherever things are.
  const backdrop = useMotionValue(0);
  const panelY = useMotionValue(0);
  const panelScale = useMotionValue(1);
  const panelOpacity = useMotionValue(1);
  const frameX = useMotionValue(0);
  const frameY = useMotionValue(0);
  const frameSX = useMotionValue(1);
  const frameSY = useMotionValue(1);
  const frameOpacity = useMotionValue(1);
  /** Everything inside the frame, which only appears once the frame has room for it. */
  const contentOpacity = useMotionValue(1);
  /** The horizontal scale the frame started growing from, so its corners can follow. */
  const frameFrom = useMotionValue(1);
  const ghostX = useMotionValue(0);
  const ghostY = useMotionValue(0);
  const ghostScale = useMotionValue(1);
  const ghostOpacity = useMotionValue(0);
  const ghostAccent = useMotionValue(1);

  // Scaling a box scales its corners with it. Drawn at the size it lands at,
  // corrected every frame for the scale it is at, so they stay round — and
  // turn from the card's radius into the pop-up's as it grows.
  const radius = useTransform(() => {
    const sx = frameSX.get();
    const sy = frameSY.get();
    const from = frameFrom.get();
    const progress = from >= 1 ? 1 : Math.min(1, Math.max(0, (sx - from) / (1 - from)));
    const r = CARD_RADIUS + (POPUP_RADIUS - CARD_RADIUS) * progress;
    return `${r / sx}px / ${r / sy}px`;
  });

  const [arrival] = useState<Arrival>(() =>
    reduced
      ? "fade"
      : sheet
        ? "sheet"
        : onScreen(getCard(cardId)?.getBoundingClientRect())
          ? "grow"
          : "fade",
  );
  /** The header's own icon, shown once the flying one has landed in its place. */
  const iconOpacity = useMotionValue(arrival === "grow" ? 0 : 1);

  useEscape(isPresent, onEscape);
  useScrollLock(isPresent);
  useFocusTrap(panelRef, isPresent);

  // ---------------------------------------------------------- animation --

  const running = useRef<AnimationPlaybackControls[]>([]);
  /** Bumped by every arrival and departure, so a superseded one stops where it is. */
  const seq = useRef(0);
  const leaving = useRef(false);

  const play = useCallback((controls: AnimationPlaybackControls) => {
    running.current.push(controls);
    return controls;
  }, []);
  const stopAll = useCallback(() => {
    for (const controls of running.current) controls.stop();
    running.current = [];
  }, []);

  /** Sends the icon flying between two boxes, drawn at the header's size and scaled to each. */
  const flyIcon = useCallback(
    (from: Rect, to: Rect, accentTo: number, transition: Transition) => {
      ghostX.set(from.left);
      ghostY.set(from.top);
      ghostScale.set(from.width / ICON_SIZE);
      ghostOpacity.set(1);
      // Before the first paint, not on the next frame.
      paint(ghostRef.current, from.left, from.top, from.width / ICON_SIZE);
      return Promise.all([
        play(animate(ghostX, to.left, transition)),
        play(animate(ghostY, to.top, transition)),
        play(animate(ghostScale, to.width / ICON_SIZE, transition)),
        play(animate(ghostAccent, accentTo, { duration: 0.28, ease: ease.standard })),
      ]);
    },
    [ghostX, ghostY, ghostScale, ghostOpacity, ghostAccent, play],
  );

  // Arriving. In a layout effect, so the frame is laid over the card before
  // anything is painted: the first frame anyone sees is the card.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const frame = frameRef.current;
    if (!panel || !frame) return;
    const token = ++seq.current;
    play(animate(backdrop, 1, { duration: 0.24, ease: ease.standard }));

    if (arrival === "grow") {
      const card = getCard(cardId);
      const from = card?.getBoundingClientRect();
      if (card && onScreen(from)) {
        const to = panel.getBoundingClientRect();
        const start = cover(from, to);
        frameX.set(start.x);
        frameY.set(start.y);
        frameSX.set(start.sx);
        frameSY.set(start.sy);
        frameFrom.set(start.sx);
        contentOpacity.set(0);
        // Before the first paint, not on the next frame: what is seen first
        // is the card, exactly where it was.
        frame.style.transform = `translateX(${start.x}px) translateY(${start.y}px) scaleX(${start.sx}) scaleY(${start.sy})`;
        frame.style.borderRadius = `${CARD_RADIUS / start.sx}px / ${CARD_RADIUS / start.sy}px`;
        if (contentRef.current) contentRef.current.style.opacity = "0";
        onHide(cardId, true);
        play(animate(frameX, 0, GROW));
        play(animate(frameY, 0, GROW));
        play(animate(frameSX, 1, GROW));
        play(animate(frameSY, 1, GROW));
        play(animate(contentOpacity, 1, { duration: 0.22, ease: ease.standard, delay: 0.08 }));

        const cardIcon = card.querySelector("[data-card-icon]")?.getBoundingClientRect();
        const headIcon = iconRef.current?.getBoundingClientRect();
        if (cardIcon && headIcon) {
          ghostAccent.set(1);
          void flyIcon(cardIcon, headIcon, 1, GROW).then(() => {
            if (seq.current !== token) return;
            iconOpacity.set(1);
            ghostOpacity.set(0);
            // Landed: now it plays its problem, as it does whenever it arrives.
            iconRef.current?.setAttribute("data-play", "");
          });
        } else {
          iconOpacity.set(1);
        }
        return () => {
          stopAll();
          onHide(cardId, false);
        };
      }
      // The card went between the click and now: arrive the plain way.
      iconOpacity.set(1);
    }

    if (arrival === "sheet") {
      const height = panel.offsetHeight + 24;
      panelY.set(height);
      panel.style.transform = `translateY(${height}px)`;
      play(animate(panelY, 0, SHEET));
    } else {
      panelOpacity.set(0);
      panel.style.opacity = "0";
      play(animate(panelOpacity, 1, { duration: reduced ? 0.16 : 0.2, ease: ease.standard }));
      if (!reduced) {
        panelScale.set(0.96);
        play(animate(panelScale, 1, spring.gentle));
      }
    }
    return () => stopAll();
    // Once, as it opens. How it leaves is decided as it leaves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Leaving: back into the card if it came out of one and the card is still in view; otherwise the way it came. */
  const leave = useCallback(async () => {
    const token = ++seq.current;
    stopAll();
    const panel = panelRef.current;
    const finish = () => {
      if (seq.current !== token) return;
      onHide(cardId, false);
      safeToRemove?.();
    };
    play(animate(backdrop, 0, { duration: 0.22, ease: ease.exit }));
    if (!panel) return finish();

    const card = arrival === "grow" && !reduced && !sheet ? getCard(cardId) : null;
    const from = card?.getBoundingClientRect();
    if (card && onScreen(from)) {
      const to = panel.getBoundingClientRect();
      const end = cover(from, to);
      frameFrom.set(end.sx);
      // Everything but the frame and the icon goes first.
      play(animate(contentOpacity, 0, { duration: 0.12, ease: ease.exit }));
      const head = iconRef.current;
      const cardIcon = card.querySelector("[data-card-icon]")?.getBoundingClientRect();
      if (head?.isConnected && cardIcon) {
        iconOpacity.set(0);
        void flyIcon(head.getBoundingClientRect(), cardIcon, 0, LAND);
      }
      await Promise.all([
        play(animate(frameX, end.x, LAND)),
        play(animate(frameY, end.y, LAND)),
        play(animate(frameSX, end.sx, LAND)),
        play(animate(frameSY, end.sy, LAND)),
      ]);
      if (seq.current !== token) return;
      // The card is back under the frame: show it, then let the frame go.
      onHide(cardId, false);
      await Promise.all([
        play(animate(frameOpacity, 0, { duration: 0.12, ease: ease.standard })),
        play(animate(ghostOpacity, 0, { duration: 0.12, ease: ease.standard })),
      ]);
      return finish();
    }

    if (sheet && !reduced) {
      await play(animate(panelY, panel.offsetHeight + 24, { duration: 0.24, ease: ease.exit }));
    } else {
      ghostOpacity.set(0);
      await Promise.all([
        play(animate(panelOpacity, 0, { duration: 0.14, ease: ease.exit })),
        reduced ? null : play(animate(panelScale, 0.97, { duration: 0.14, ease: ease.exit })),
      ]);
    }
    finish();
  }, [
    arrival,
    reduced,
    sheet,
    cardId,
    getCard,
    onHide,
    safeToRemove,
    stopAll,
    play,
    flyIcon,
    backdrop,
    frameFrom,
    frameX,
    frameY,
    frameSX,
    frameSY,
    frameOpacity,
    contentOpacity,
    ghostOpacity,
    iconOpacity,
    panelY,
    panelOpacity,
    panelScale,
  ]);

  /** Asked back while still leaving — the card clicked again mid-close: turn round from wherever it got to. */
  const reenter = useCallback(() => {
    ++seq.current;
    stopAll();
    onHide(cardId, arrival === "grow");
    play(animate(contentOpacity, 1, { duration: 0.16, ease: ease.standard }));
    ghostOpacity.set(0);
    iconOpacity.set(1);
    play(animate(backdrop, 1, { duration: 0.2, ease: ease.standard }));
    play(animate(frameOpacity, 1, { duration: 0.1 }));
    for (const value of [frameX, frameY, panelY]) play(animate(value, 0, GROW));
    for (const value of [frameSX, frameSY, panelScale, panelOpacity]) play(animate(value, 1, GROW));
  }, [
    arrival,
    cardId,
    onHide,
    stopAll,
    play,
    contentOpacity,
    ghostOpacity,
    iconOpacity,
    backdrop,
    frameOpacity,
    frameX,
    frameY,
    panelY,
    frameSX,
    frameSY,
    panelScale,
    panelOpacity,
  ]);

  useEffect(() => {
    if (isPresent) {
      if (leaving.current) {
        leaving.current = false;
        reenter();
      }
      return;
    }
    if (leaving.current) return;
    leaving.current = true;
    void leave();
  }, [isPresent, leave, reenter]);

  // ------------------------------------------------------------- layout --

  // The views' height, so moving from one to the next resizes the pop-up
  // smoothly rather than in a jump.
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const node = measureRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setHeight(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const startDrag = useCallback(
    (event: React.PointerEvent) => {
      if ((event.target as HTMLElement).closest("button, a, input, textarea, select")) return;
      dragControls.start(event);
    },
    [dragControls],
  );

  function onDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.y > DISMISS_DISTANCE || info.velocity.y > DISMISS_VELOCITY) onClose();
  }

  const views: Variants = {
    enter: (d: number) => (d === 0 || reduced ? { opacity: d === 0 ? 1 : 0, x: 0 } : { opacity: 0, x: 36 * d }),
    center: {
      opacity: 1,
      x: 0,
      transition: reduced
        ? { duration: 0.15 }
        : { x: spring.gentle, opacity: { duration: 0.2, ease: ease.standard } },
    },
    exit: (d: number) =>
      reduced
        ? { opacity: 0, transition: { duration: 0.12 } }
        : { opacity: 0, x: -36 * d, transition: { duration: 0.16, ease: ease.exit } },
  };

  // Tall as the content, short of the window: room above and below on a desk,
  // and for the handle on a phone — less whatever the keyboard has taken.
  const capClass = sheet ? "max-h-[calc(100dvh-3.25rem)]" : "max-h-[min(42rem,calc(100dvh-3rem))]";
  const capStyle = keyboard ? { maxHeight: keyboard.height - 28 } : undefined;

  const view: MorphView = {
    panelRef,
    iconRef,
    iconOpacity,
    arrival,
    reduced,
    sheet,
    capClass,
    capStyle,
    dragHeader: sheet && !reduced ? startDrag : undefined,
  };

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[60] flex justify-center",
        sheet ? "items-end" : "items-center p-4 sm:p-6",
        // Leaving, it is a picture of itself; the page under it is live again.
        !isPresent && "pointer-events-none",
      )}
    >
      <motion.div
        aria-hidden
        onClick={onClose}
        style={{ opacity: backdrop }}
        className="fixed inset-0 bg-black/45 backdrop-blur-[3px]"
      />

      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        drag={sheet && !reduced ? "y" : false}
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.85 }}
        onDragEnd={onDragEnd}
        style={{
          y: panelY,
          scale: panelScale,
          opacity: panelOpacity,
          marginBottom: keyboard?.inset,
        }}
        className={cn("relative w-full outline-none", !sheet && className)}
      >
        {/* The pop-up's body: the box that grows out of the card. Behind the
            content, which is never scaled — it fades in once there is room. */}
        <motion.div
          ref={frameRef}
          aria-hidden
          style={{
            x: frameX,
            y: frameY,
            scaleX: frameSX,
            scaleY: frameSY,
            opacity: frameOpacity,
            borderRadius: sheet ? undefined : radius,
          }}
          className={cn(
            "absolute inset-0 border-line-strong bg-canvas-raised shadow-[var(--shadow-lg)]",
            sheet ? "rounded-t-[22px] border-x border-t" : "border",
          )}
        />

        <motion.div
          ref={contentRef}
          style={{ opacity: contentOpacity }}
          className={cn("relative overflow-hidden", sheet ? "rounded-t-[22px]" : "rounded-[20px]")}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-[var(--accent-line)] to-transparent"
          />
          {sheet && (
            <div
              aria-hidden
              onPointerDown={startDrag}
              className="flex h-5 cursor-grab touch-none items-end justify-center active:cursor-grabbing"
            >
              <span className="h-1 w-10 rounded-full bg-line-strong" />
            </div>
          )}

          <motion.div
            initial={false}
            animate={{ height: height ?? "auto" }}
            transition={reduced ? { duration: 0 } : spring.gentle}
            className="overflow-hidden"
          >
            <div ref={measureRef} className="relative">
              <AnimatePresence mode="popLayout" custom={dir} onExitComplete={onViewExitComplete}>
                <motion.div
                  key={viewKey}
                  custom={dir}
                  variants={views}
                  initial="enter"
                  animate="center"
                  exit="exit"
                >
                  {renderView(view)}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      </motion.div>

      {/* The card's icon on its way up into the header, and back down again. */}
      <motion.div
        ref={ghostRef}
        aria-hidden
        style={{
          x: ghostX,
          y: ghostY,
          scale: ghostScale,
          opacity: ghostOpacity,
          originX: 0,
          originY: 0,
          width: ICON_SIZE,
          height: ICON_SIZE,
        }}
        className="glyph-host pointer-events-none fixed left-0 top-0 z-[61]"
        data-play=""
      >
        <span className="absolute inset-0 flex items-center justify-center rounded-[12px] border border-line bg-surface-sunk text-ink-muted">
          <QuickIcon name={icon} className="size-[1.25rem]" />
        </span>
        <motion.span
          style={{ opacity: ghostAccent }}
          className="absolute inset-0 flex items-center justify-center rounded-[12px] bg-accent text-[var(--accent-ink)] shadow-[var(--shadow-sm)]"
        >
          <QuickIcon name={icon} className="size-[1.25rem]" />
        </motion.span>
      </motion.div>
    </div>,
    document.body,
  );
}
