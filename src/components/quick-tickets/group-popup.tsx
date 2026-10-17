"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
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
import { Spinner } from "@/components/ui/spinner";
import { useEscape, useFocusTrap, useScrollLock } from "@/components/ui/use-overlay";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { Icons } from "@/components/shell/icons";
import { useNewTicket } from "@/components/tickets/new-ticket";
import {
  DISMISS_DISTANCE,
  DISMISS_VELOCITY,
  SHEET_QUERY,
  useKeyboardInset,
} from "@/components/tickets/new-ticket/dialog";
import { PRIORITY_META } from "@/lib/constants";
import { ease, spring, stagger } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { QuickGroup, QuickIssue } from "@/lib/quick-tickets";
import { useQuickTicket, type OpenTicket } from "./context";
import { ConfirmStep } from "./dialog";
import { QuickIcon } from "./icon";
import { ARROWS, nearest } from "./spatial";
import { useSpotlight } from "./spotlight";

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
type Arrival = "grow" | "sheet" | "fade";

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

/**
 * A quick-ticket group, opened: the card the requester clicked grows into a
 * pop-up over the dimmed page, its icon flying up into the header, and its
 * quick tickets arrive one after another as tiles. Closing reverses it — the
 * pop-up shrinks back into the card it came from.
 *
 * Picking a tile does not stack a second dialog: the pop-up slides on to the
 * confirm step (<ConfirmStep>, the same one ⌘K's dialog shows) with a way
 * back, and after sending shows the result in place. The pick itself lives in
 * the provider (an `embedded` session), so a request still in flight when the
 * requester goes back or closes still lands, and is announced if nothing is
 * on screen to show it.
 *
 * Only ever drawn after a click or from a link, so it is loaded on demand and
 * kept out of the server render. On a phone it is a bottom sheet that drags
 * away; for anyone who asked for less motion it simply fades.
 *
 * Escape goes back from the confirm step, and closes from the list or once a
 * ticket is sent.
 */
export function GroupPopup({
  group,
  openByIssue,
  getCard,
  onClose,
  onHide,
}: {
  group: QuickGroup;
  /** The viewer's newest unfinished ticket per quick ticket. */
  openByIssue: Record<string, OpenTicket>;
  /** The group's card on the page, which the pop-up grows out of and lands back in. */
  getCard: (groupId: string) => HTMLElement | null;
  /** Close the pop-up: the board takes the group out of the address. */
  onClose: () => void;
  /** Hide the card while the pop-up stands in for it, and show it again. */
  onHide: (groupId: string, hidden: boolean) => void;
}) {
  const [isPresent, safeToRemove] = usePresence();
  const reduced = useReducedMotion() ?? false;
  const sheet = useMediaQuery(SHEET_QUERY);
  const keyboard = useKeyboardInset(sheet);
  const dragControls = useDragControls();
  const { session, open, close: putDown, clearSubmission, submission, activeId, pendingId } =
    useQuickTicket();
  const { open: openNewTicket } = useNewTicket();
  const id = useId();

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
        : onScreen(getCard(group.id)?.getBoundingClientRect())
          ? "grow"
          : "fade",
  );
  /** The header's own icon, shown once the flying one has landed in its place. */
  const iconOpacity = useMotionValue(arrival === "grow" ? 0 : 1);

  // ---------------------------------------------------------------- step --

  const live = session?.embedded && session.issue.group.id === group.id ? session : null;
  // What the pop-up shows: the list, or the pick it has moved on to. Held
  // still while it leaves, so it shrinks away showing what it showed.
  const [step, setStep] = useState(live);
  /** Which way the views slide: 1 on to the confirm step, -1 back, 0 for the first view. */
  const [dir, setDir] = useState(0);
  /**
   * The tile to put focus back on when the list returns. A fresh object per
   * return, so the list acts on it even when it is the same list coming back
   * — stepping back quickly catches it before it has finished leaving.
   */
  const [returnTo, setReturnTo] = useState<{ issueId: string } | null>(null);
  if (isPresent && live !== step) {
    if (Boolean(live) !== Boolean(step)) setDir(live ? 1 : -1);
    setStep(live);
  }

  const stepSent =
    step !== null && submission.status === "success" && submission.issueId === step.issue.id;

  const back = useCallback(() => {
    if (!session?.embedded) return;
    setReturnTo({ issueId: session.issue.id });
    putDown();
  }, [session, putDown]);

  const pick = useCallback(
    (issue: QuickIssue) => open(issue, { embedded: true, knownOpen: openByIssue[issue.id] ?? null }),
    [open, openByIssue],
  );

  const raise = useCallback(() => {
    onClose();
    openNewTicket();
  }, [onClose, openNewTicket]);

  const onEscape = useCallback(() => {
    if (step && !stepSent) back();
    else onClose();
  }, [step, stepSent, back, onClose]);

  useEscape(isPresent, onEscape);
  useScrollLock(isPresent);
  useFocusTrap(panelRef, isPresent);

  // A pick left open as the pop-up goes is put down with it.
  useEffect(() => {
    if (!isPresent && live) putDown();
  }, [isPresent, live, putDown]);

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
  // anything is painted: the first frame the requester sees is the card.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const frame = frameRef.current;
    if (!panel || !frame) return;
    const token = ++seq.current;
    play(animate(backdrop, 1, { duration: 0.24, ease: ease.standard }));

    if (arrival === "grow") {
      const card = getCard(group.id);
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
        // Before the first paint, not on the next frame: what the requester
        // sees first is the card, exactly where it was.
        frame.style.transform = `translateX(${start.x}px) translateY(${start.y}px) scaleX(${start.sx}) scaleY(${start.sy})`;
        frame.style.borderRadius = `${CARD_RADIUS / start.sx}px / ${CARD_RADIUS / start.sy}px`;
        if (contentRef.current) contentRef.current.style.opacity = "0";
        onHide(group.id, true);
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
          onHide(group.id, false);
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
      onHide(group.id, false);
      safeToRemove?.();
    };
    play(animate(backdrop, 0, { duration: 0.22, ease: ease.exit }));
    if (!panel) return finish();

    const card = arrival === "grow" && !reduced && !sheet ? getCard(group.id) : null;
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
      onHide(group.id, false);
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
    group.id,
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
    onHide(group.id, arrival === "grow");
    play(animate(contentOpacity, 1, { duration: 0.16, ease: ease.standard }));
    ghostOpacity.set(0);
    iconOpacity.set(1);
    play(animate(backdrop, 1, { duration: 0.2, ease: ease.standard }));
    play(animate(frameOpacity, 1, { duration: 0.1 }));
    for (const value of [frameX, frameY, panelY]) play(animate(value, 0, GROW));
    for (const value of [frameSX, frameSY, panelScale, panelOpacity]) play(animate(value, 1, GROW));
  }, [
    arrival,
    group.id,
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

  // The views' height, so moving between the list and the confirm step
  // resizes the pop-up smoothly rather than in a jump.
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
      if ((event.target as HTMLElement).closest("button, a, input, textarea")) return;
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
  const cap = sheet ? "max-h-[calc(100dvh-3.25rem)]" : "max-h-[min(42rem,calc(100dvh-3rem))]";
  const capStyle = keyboard ? { maxHeight: keyboard.height - 28 } : undefined;
  const dragHeader = sheet && !reduced ? startDrag : undefined;

  const listTitle = `${id}-list-title`;
  const listHint = `${id}-list-hint`;
  const stepTitle = `${id}-step-title`;
  const stepHint = `${id}-step-hint`;

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
        aria-labelledby={step ? stepTitle : listTitle}
        aria-describedby={step ? stepHint : group.description ? listHint : undefined}
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
        className={cn("relative w-full outline-none", !sheet && "max-w-[38rem]")}
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
              <AnimatePresence
                mode="popLayout"
                custom={dir}
                onExitComplete={() => {
                  // Back on the list: what the step showed is spent.
                  if (!step) clearSubmission();
                }}
              >
                {step ? (
                  <motion.div
                    key={`step-${step.key}`}
                    custom={dir}
                    variants={views}
                    initial="enter"
                    animate="center"
                    exit="exit"
                  >
                    <ConfirmStep
                      issue={step.issue}
                      changed={step.changed}
                      knownOpen={step.knownOpen}
                      onClose={onClose}
                      onBack={back}
                      containerRef={panelRef}
                      titleId={stepTitle}
                      hintId={stepHint}
                      sheet={sheet}
                      onHeaderPointerDown={dragHeader}
                      autoFocus
                      className={cn("flex-none", cap)}
                      style={capStyle}
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key="list"
                    custom={dir}
                    variants={views}
                    initial="enter"
                    animate="center"
                    exit="exit"
                  >
                    <ListView
                      group={group}
                      openByIssue={openByIssue}
                      activeId={activeId}
                      pendingId={pendingId}
                      titleId={listTitle}
                      hintId={listHint}
                      iconRef={iconRef}
                      iconOpacity={iconOpacity}
                      // Growing out of the card, it plays once it has landed instead.
                      playIcon={dir !== 0 || arrival !== "grow"}
                      entrance={dir === 0 ? arrival : "back"}
                      returnTo={returnTo}
                      reduced={reduced}
                      sheet={sheet}
                      className={cap}
                      style={capStyle}
                      onHeaderPointerDown={dragHeader}
                      onPick={pick}
                      onClose={onClose}
                      onRaise={raise}
                    />
                  </motion.div>
                )}
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
          <QuickIcon name={group.icon} className="size-[1.25rem]" />
        </span>
        <motion.span
          style={{ opacity: ghostAccent }}
          className="absolute inset-0 flex items-center justify-center rounded-[12px] bg-accent text-[var(--accent-ink)] shadow-[var(--shadow-sm)]"
        >
          <QuickIcon name={group.icon} className="size-[1.25rem]" />
        </motion.span>
      </motion.div>
    </div>,
    document.body,
  );
}

/** Rendered by the card grid once the page is idle, purely so this module is fetched before the first click. */
export function Preload() {
  return null;
}

/** Shows an element where an animation is about to start, before the next paint rather than on the next frame. */
function paint(node: HTMLElement | null, x: number, y: number, scale: number) {
  if (!node) return;
  node.style.transform = `translateX(${x}px) translateY(${y}px) scale(${scale})`;
  node.style.opacity = "1";
}

// ------------------------------------------------------------------ list --

function ListView({
  group,
  openByIssue,
  activeId,
  pendingId,
  titleId,
  hintId,
  iconRef,
  iconOpacity,
  playIcon,
  entrance,
  returnTo,
  reduced,
  sheet,
  className,
  style,
  onHeaderPointerDown,
  onPick,
  onClose,
  onRaise,
}: {
  group: QuickGroup;
  openByIssue: Record<string, OpenTicket>;
  activeId: string | null;
  pendingId: string | null;
  titleId: string;
  hintId: string;
  iconRef: React.RefObject<HTMLSpanElement | null>;
  /** Nought while the card's icon is still flying in to take this one's place. */
  iconOpacity: MotionValue<number>;
  /** Play its problem as it appears. */
  playIcon: boolean;
  /** Grown out of the card (the content waits for room), arrived plainly, or come back from the confirm step. */
  entrance: Arrival | "back";
  /** The tile to focus as the list comes back, set afresh by every return. */
  returnTo: { issueId: string } | null;
  reduced: boolean;
  sheet: boolean;
  className?: string;
  style?: React.CSSProperties;
  onHeaderPointerDown?: (event: React.PointerEvent) => void;
  onPick: (issue: QuickIssue) => void;
  onClose: () => void;
  onRaise: () => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  useSpotlight(listRef);

  // Coming back from the confirm step, focus returns to the tile it came
  // from — or the first, if IT has taken that one away meanwhile.
  useEffect(() => {
    if (!returnTo) return;
    const list = listRef.current;
    const target =
      list?.querySelector<HTMLElement>(`[data-issue="${CSS.escape(returnTo.issueId)}"]`) ??
      list?.querySelector<HTMLElement>("[data-nav-item]");
    target?.focus({ preventScroll: true });
  }, [returnTo]);

  /** Where the content's entrance starts: after the card has grown into room for it. */
  const start = entrance === "grow" ? 0.14 : entrance === "back" ? 0 : 0.05;
  const rise = (delay: number) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.16, delay } }
      : {
          initial: { opacity: 0, y: 6 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.26, ease: ease.entrance, delay },
        };

  function onListKey(event: React.KeyboardEvent<HTMLUListElement>) {
    if (event.nativeEvent.isComposing) return;
    const item = (event.target as HTMLElement).closest<HTMLElement>("[data-nav-item]");
    if (!item) return;
    const modified = event.altKey || event.ctrlKey || event.metaKey;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-nav-item]"));
    const dir = ARROWS[event.key];
    if (dir && !modified) {
      // Handled even at an edge, so an arrow key never scrolls the list instead.
      event.preventDefault();
      nearest(item, items, dir)?.focus();
    } else if ((event.key === "Home" || event.key === "End") && !modified) {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    }
  }

  const count = group.issues.length;

  return (
    <div style={style} className={cn("flex flex-col", className)}>
      <div
        onPointerDown={onHeaderPointerDown}
        className={cn(
          "flex flex-none items-start gap-3.5 px-5 pb-4",
          sheet ? "pt-1" : "pt-5",
          onHeaderPointerDown && "touch-none",
        )}
      >
        {/* Plays its problem as it arrives, and again on hover. */}
        <motion.span
          ref={iconRef}
          data-play={playIcon || undefined}
          style={{ opacity: iconOpacity }}
          className="glyph-host flex size-11 flex-none items-center justify-center rounded-[12px] bg-accent text-[var(--accent-ink)] shadow-[var(--shadow-sm)]"
        >
          <QuickIcon name={group.icon} className="size-[1.25rem]" />
        </motion.span>
        <motion.div {...rise(start)} className="min-w-0 flex-1 pt-0.5">
          <p className="eyebrow">{count === 1 ? "1 quick ticket" : `${count} quick tickets`}</p>
          <h2
            id={titleId}
            className="mt-1 break-words text-[1.0625rem] font-semibold leading-snug tracking-tight text-ink"
          >
            {group.name}
          </h2>
          {group.description && (
            <p id={hintId} className="mt-0.5 break-words text-[0.8125rem] text-ink-muted text-pretty">
              {group.description}
            </p>
          )}
        </motion.div>
        <motion.button
          {...rise(start)}
          type="button"
          onClick={onClose}
          aria-label={`Close ${group.name}`}
          className="tap-safe -mr-1.5 flex size-8 flex-none items-center justify-center rounded-[9px] text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
        >
          <Icons.close className="size-4" />
        </motion.button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line p-3 sm:p-4">
        <ul ref={listRef} role="list" onKeyDown={onListKey} className="grid gap-2 sm:grid-cols-2">
          {group.issues.map((issue, index) => (
            <IssueTile
              key={issue.id}
              issue={issue}
              existing={openByIssue[issue.id] ?? null}
              active={activeId === issue.id}
              sending={pendingId === issue.id}
              // The trap puts focus here as the pop-up opens; a returning list places it itself.
              first={index === 0 && entrance !== "back"}
              delay={reduced ? 0 : start + 0.04 + stagger(index, 0.04, 10)}
              reduced={reduced}
              onPick={onPick}
            />
          ))}
        </ul>
      </div>

      <motion.div
        {...rise(reduced ? 0 : start + 0.12)}
        className={cn(
          "flex flex-none flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-5 py-3 text-xs text-ink-faint",
          sheet && "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        )}
      >
        <span>You&apos;ll see exactly what IT gets before anything is sent.</span>
        <span>
          Not listed?{" "}
          <button
            type="button"
            onClick={onRaise}
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            Raise a ticket
          </button>
        </span>
      </motion.div>
    </div>
  );
}

function IssueTile({
  issue,
  existing,
  active,
  sending,
  first,
  delay,
  reduced,
  onPick,
}: {
  issue: QuickIssue;
  /** The viewer's newest unfinished ticket raised from this quick ticket. */
  existing: OpenTicket | null;
  /** Its confirm step is the one open. */
  active: boolean;
  sending: boolean;
  first: boolean;
  delay: number;
  reduced: boolean;
  onPick: (issue: QuickIssue) => void;
}) {
  const raised = issue.startsAt === "urgent" || issue.startsAt === "high";
  const priority = PRIORITY_META[issue.startsAt];

  return (
    <motion.li
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        opacity: { duration: 0.22, ease: ease.standard, delay },
        y: { ...spring.gentle, delay },
        scale: { ...spring.gentle, delay },
      }}
      className="min-w-0"
    >
      <button
        type="button"
        data-nav-item=""
        data-issue={issue.id}
        data-active={active || undefined}
        data-autofocus={first || undefined}
        aria-label={
          [
            issue.label,
            raised && `Starts ${priority.label.toLowerCase()}`,
            issue.detail_prompt && "Asks one question",
            existing && `You already reported this as ${existing.ticket_number}`,
          ]
            .filter(Boolean)
            .join(". ") + "."
        }
        aria-busy={sending || undefined}
        onClick={() => onPick(issue)}
        className={cn(
          // `quick-tile` takes the pointer light.
          // Two to a row from `sm`, where a shared height keeps the rows even.
          "quick-tile group/tile relative flex h-full min-h-12 w-full flex-col justify-between gap-2 rounded-[12px] border p-3 pl-3.5 text-left sm:min-h-[4.5rem]",
          "border-line bg-surface transition-[translate,scale,border-color,background-color,box-shadow] duration-200 ease-[var(--ease-standard)]",
          "hover:border-accent-line hover:shadow-[var(--shadow-md)] motion-safe:hover:-translate-y-0.5 active:scale-[0.98]",
          "data-[active]:border-accent-line data-[active]:bg-accent-soft",
        )}
      >
        <span aria-hidden className="spot-wash" />
        <span aria-hidden className="spot-ring" />
        <span className="relative flex items-start gap-2.5">
          <span className="line-clamp-2 min-w-0 flex-1 break-words text-[0.875rem] font-medium leading-snug text-ink">
            {issue.label}
          </span>
          <span
            aria-hidden
            className={cn(
              "flex size-6 flex-none items-center justify-center rounded-full border border-line text-ink-faint",
              "transition-[background-color,border-color,color] duration-200 ease-[var(--ease-standard)]",
              "group-hover/tile:border-transparent group-hover/tile:bg-accent group-hover/tile:text-[var(--accent-ink)]",
              "group-focus-visible/tile:border-transparent group-focus-visible/tile:bg-accent group-focus-visible/tile:text-[var(--accent-ink)]",
            )}
          >
            {sending ? (
              <Spinner className="size-3" />
            ) : (
              <Icons.arrowRight className="size-3 transition-[translate] duration-200 group-hover/tile:translate-x-px" />
            )}
          </span>
        </span>
        {(raised || issue.detail_prompt || existing) && (
          <span
            aria-hidden
            className="relative flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.6875rem] text-ink-faint"
          >
            {raised && (
              <span data-tone={priority.tone} className="inline-flex items-center gap-1">
                <span className="tone-dot" />
                {priority.label}
              </span>
            )}
            {issue.detail_prompt && <span>Asks one question</span>}
            {existing && (
              <span
                title="You reported this and it's still open"
                className="readout rounded border border-line bg-surface-sunk px-1.5 leading-4"
              >
                {existing.ticket_number} open
              </span>
            )}
          </span>
        )}
      </button>
    </motion.li>
  );
}
