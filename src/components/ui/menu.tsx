"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useIsClient } from "@/components/motion/use-is-client";
import { useEscape } from "./use-overlay";
import { useAnchoredPanel } from "./use-anchored-panel";
import { spring, transition } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * A row-actions menu.
 *
 * Exists because putting every action on every row is what made the People
 * table unreadable: four buttons and two badges per row, none of them lining
 * up with the row above. The actions that are occasional live here; the edits
 * that are frequent stay as real columns.
 *
 * Shares placement, outside-press dismiss and scroll tracking with Select via
 * useAnchoredPanel, so a menu on the last row of a long table flips above its
 * trigger rather than opening off the bottom of the screen.
 */

export type MenuItem =
  | { separator: true }
  | {
      separator?: false;
      label: string;
      onSelect: () => void;
      disabled?: boolean;
      /** Renders in the failure tone and sits below a separator by convention. */
      danger?: boolean;
      /** Shown as the accessible description and the native tooltip. */
      hint?: string;
    };

const ITEM_HEIGHT = 32;
const SEPARATOR_HEIGHT = 9;
const PANEL_CHROME = 10;
const PANEL_WIDTH = 216;

/** Actionable entries only — separators are not focus targets. */
const isAction = (item: MenuItem): item is Extract<MenuItem, { label: string }> =>
  !item.separator;

export function Menu({
  items,
  label,
  className,
  disabled,
  children,
}: {
  items: MenuItem[];
  /** Accessible name for the trigger, e.g. "Actions for Jane Doe". */
  label: string;
  className?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const isClient = useIsClient();
  const menuId = useId();

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  // Which item the keyboard is on. -1 means the panel has focus but no item,
  // which is the state a pointer-opened menu starts in.
  const [activeIndex, setActiveIndex] = useState(-1);

  const actionable = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => isAction(item) && !item.disabled);

  const close = useCallback(() => {
    // Hand focus back to the trigger, but only when it is still inside the
    // menu we are tearing down. Escape and Tab land here with focus on an item
    // and would otherwise drop the caret at the top of the document, losing the
    // reader's place in a 25-row table. An outside click also lands here, and
    // there the user has already chosen where to put focus — leave it alone.
    if (panelRef.current?.contains(document.activeElement)) {
      triggerRef.current?.focus();
    }
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  const { placement, measure } = useAnchoredPanel({
    open,
    onClose: close,
    anchorRef: triggerRef,
    panelRef,
    width: PANEL_WIDTH,
    // Right edges line up: the trigger sits at the end of the row, so a panel
    // growing rightward would immediately leave the viewport.
    align: "end",
    desiredHeight:
      items.reduce(
        (sum, item) => sum + (item.separator ? SEPARATOR_HEIGHT : ITEM_HEIGHT),
        0,
      ) + PANEL_CHROME,
    maxHeight: 320,
  });

  // Escape belongs to the menu alone. Both this and any surrounding Modal
  // listen on `document`, and the Modal registered first, so the only way to
  // get there ahead of it is the capture phase.
  useEscape(open, close, { capture: true, stopPropagation: true });

  const openMenu = useCallback(
    (focusFirst: boolean) => {
      // Measured in the handler rather than an effect: no setState in an effect
      // body, and no frame where the panel sits at the wrong position.
      measure();
      setActiveIndex(focusFirst ? (actionable[0]?.index ?? -1) : -1);
      setOpen(true);
    },
    [measure, actionable],
  );

  const run = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item || !isAction(item) || item.disabled) return;
      // close() returns focus to the trigger on its own.
      close();
      item.onSelect();
    },
    [items, close],
  );

  /** Moves through actionable entries only, stopping at the ends. */
  const step = useCallback(
    (from: number, delta: number) => {
      if (actionable.length === 0) return from;
      const at = actionable.findIndex(({ index }) => index === from);
      if (at === -1) return (delta > 0 ? actionable[0] : actionable[actionable.length - 1]).index;
      const next = at + delta;
      if (next < 0 || next >= actionable.length) return from;
      return actionable[next].index;
    },
    [actionable],
  );

  // A menu takes real focus rather than aria-activedescendant, which is what
  // the menu pattern expects and what makes the browser's own focus ring land
  // on the row the keyboard is on.
  useEffect(() => {
    if (!open) return;
    const target =
      activeIndex >= 0
        ? panelRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
        : panelRef.current;
    target?.focus({ preventScroll: true });
  }, [open, activeIndex]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (!open) {
      if (["Enter", " ", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        openMenu(true);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        measure();
        setActiveIndex(actionable[actionable.length - 1]?.index ?? -1);
        setOpen(true);
      }
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((i) => step(i, 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((i) => step(i, -1));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(actionable[0]?.index ?? -1);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(actionable[actionable.length - 1]?.index ?? -1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        run(activeIndex);
        break;
      case "Tab":
        // Tab leaves the menu rather than cycling inside it, the way a native
        // menu does. The value is not committed by moving on.
        close();
        break;
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu(false))}
        onKeyDown={onKeyDown}
        className={cn(
          "tap-safe inline-flex size-8 items-center justify-center rounded-[9px]",
          "text-ink-faint transition-colors duration-150",
          "hover:bg-surface-hover hover:text-ink",
          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent-soft)]",
          "disabled:pointer-events-none disabled:opacity-40",
          open && "bg-surface-hover text-ink",
          className,
        )}
      >
        {children}
      </button>

      {isClient &&
        createPortal(
          <AnimatePresence>
            {open && placement && (
              <motion.div
                ref={panelRef}
                id={menuId}
                role="menu"
                tabIndex={-1}
                aria-label={label}
                onKeyDown={onKeyDown}
                initial={
                  reduced
                    ? { opacity: 0 }
                    : { opacity: 0, scaleY: 0.9, y: placement.above ? 4 : -4 }
                }
                animate={{ opacity: 1, scaleY: 1, y: 0 }}
                exit={
                  reduced
                    ? { opacity: 0, transition: transition.fast }
                    : {
                        opacity: 0,
                        scaleY: 0.94,
                        y: placement.above ? 2 : -2,
                        transition: transition.fast,
                      }
                }
                transition={reduced ? transition.fast : spring.gentle}
                style={{
                  position: "fixed",
                  left: placement.left,
                  width: placement.width,
                  maxHeight: placement.maxHeight,
                  ...(placement.above
                    ? { bottom: placement.bottom }
                    : { top: placement.top }),
                  originY: placement.above ? 1 : 0,
                }}
                className={cn(
                  "z-[60] overflow-auto rounded-[12px] border border-line-strong",
                  "bg-canvas-raised p-1 shadow-[var(--shadow-lg)]",
                  // Focused only in the moment between a pointer opening the
                  // menu and the first arrow key, but that moment still has to
                  // be visible to anyone who opened it from the keyboard.
                  "outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)]",
                )}
              >
                {items.map((item, index) =>
                  item.separator ? (
                    <div
                      key={`sep-${index}`}
                      role="separator"
                      className="my-1 h-px bg-line"
                    />
                  ) : (
                    <button
                      key={item.label}
                      data-index={index}
                      role="menuitem"
                      type="button"
                      tabIndex={-1}
                      disabled={item.disabled}
                      title={item.hint}
                      onMouseEnter={() => !item.disabled && setActiveIndex(index)}
                      onClick={() => run(index)}
                      className={cn(
                        "flex w-full items-center rounded-[8px] px-2.5 py-1.5 text-left",
                        "text-[0.8125rem] transition-colors duration-100",
                        // The tint below tracks the keyboard, but a tint is not
                        // a focus indicator: it reads as hover, and it is the
                        // only thing distinguishing the focused row otherwise.
                        "outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)]",
                        "disabled:cursor-not-allowed disabled:opacity-40",
                        index === activeIndex && !item.disabled && "bg-surface-hover",
                        item.danger ? "text-[var(--spec-fail)]" : "text-ink-muted",
                        !item.disabled && !item.danger && "hover:text-ink",
                      )}
                    >
                      {item.label}
                    </button>
                  ),
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
