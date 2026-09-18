"use client";

import {
  Children,
  Fragment,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useIsClient } from "@/components/motion/use-is-client";
import { useEscape } from "./use-overlay";
import { spring, transition } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The app's dropdown.
 *
 * A native <select> is always in the DOM and is always the source of truth. On
 * touch it *is* the control, because the platform picker beats anything we
 * could draw: a thumb-sized wheel that already knows the user's language and
 * accessibility settings. On a pointer it is hidden and a listbox is drawn
 * over it, which is where the animation lives.
 *
 * Keeping the real element underneath rather than replacing it is what lets
 * every existing call site stay untouched. Selection is applied by writing to
 * the select and dispatching a real `change` event, so `e.target.value` in the
 * seventeen handlers across the app is genuinely the select's value rather
 * than a synthesised object that resembles one. `name`, `disabled` and form
 * association keep working for the same reason.
 */

type OptionData = {
  value: string;
  label: string;
  disabled?: boolean;
};

/** Reads `<option>` children, following fragments and `.map()` output. */
function collectOptions(
  children: React.ReactNode,
  out: OptionData[] = [],
): OptionData[] {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;

    if (child.type === Fragment) {
      collectOptions(
        (child.props as { children?: React.ReactNode }).children,
        out,
      );
      return;
    }

    if (child.type === "option") {
      const props = child.props as React.ComponentProps<"option">;
      const label =
        typeof props.children === "string"
          ? props.children
          : Array.isArray(props.children)
            ? props.children.filter((part) => typeof part === "string").join("")
            : String(props.children ?? "");

      out.push({
        value: String(props.value ?? label),
        label,
        disabled: props.disabled,
      });
    }
  });

  return out;
}

/**
 * True on touch. Read through `useSyncExternalStore` rather than an effect:
 * this project bans `setState` in an effect body, and a media query is exactly
 * the external store this hook exists for.
 */
function usePointerCoarse() {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia("(pointer: coarse)");
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia("(pointer: coarse)").matches,
    // The server cannot know. Assuming a pointer means it sends the listbox
    // shell; the native select is in the markup either way, so the hydration
    // pass has nothing to disagree about.
    () => false,
  );
}

/**
 * React installs its own `value` setter on the element to track changes, so
 * assigning `node.value` directly leaves React believing nothing happened and
 * the `change` event is swallowed. Writing through the prototype descriptor
 * goes past that tracker, which is what makes the dispatched event real.
 */
function commitValue(node: HTMLSelectElement, next: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )?.set;
  setter?.call(node, next);
  node.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Breathing room kept between the panel and the edge of the viewport. */
const VIEWPORT_MARGIN = 8;
/** Distance between the trigger and the panel. */
const TRIGGER_GAP = 6;
/** The tallest the panel grows to when there is room for it. */
const MAX_PANEL_HEIGHT = 288;
/** One option row plus the panel's own padding and borders. Only ever used to
 *  guess which side of the trigger fits the list better — the measured clamp
 *  below is what actually keeps the panel on screen. */
const ROW_HEIGHT = 30;
const PANEL_CHROME = 10;

type Placement = {
  left: number;
  width: number;
  maxHeight: number;
  /** Distance from the top of the viewport, for a panel below the trigger. */
  top: number;
  /** Distance from the bottom, for a panel flipped above it. */
  bottom: number;
  above: boolean;
};

const CONTROL_BASE =
  "w-full rounded-[10px] border border-line bg-surface-sunk px-3 text-sm text-ink " +
  "transition-colors duration-150 hover:border-line-strong " +
  "focus:border-accent-line focus:outline-none focus:ring-4 focus:ring-[var(--accent-soft)] " +
  "disabled:opacity-50";

export const Select = forwardRef<
  HTMLSelectElement,
  React.ComponentProps<"select">
>(function Select(
  { className, children, disabled, onChange, ...props },
  forwardedRef,
) {
  const coarse = usePointerCoarse();
  const reduced = useReducedMotion();
  // `createPortal` needs `document.body`, which does not exist on the
  // server. This component still server-renders — "use client" marks where
  // hydration begins, it does not opt out of SSR — so the portal has to wait
  // for the client or every page holding a dropdown 500s.
  const isClient = useIsClient();
  const listId = useId();

  const selectRef = useRef<HTMLSelectElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ term: "", at: 0 });

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [placement, setPlacement] = useState<Placement | null>(null);
  // Every call site in this app is controlled, but an uncontrolled instance
  // still has to render the right label. That fallback is tracked in state
  // rather than read off the DOM node: reading `selectRef.current` during
  // render is not just a lint error, it is wrong — the node's value can
  // change without React re-rendering, so the label would silently go stale.
  const [uncontrolledValue, setUncontrolledValue] = useState(() =>
    String(props.defaultValue ?? ""),
  );

  const options = useMemo(() => collectOptions(children), [children]);

  const currentValue =
    props.value !== undefined ? String(props.value) : uncontrolledValue;
  const selected = options.find((option) => option.value === currentValue);

  /**
   * Places the panel inside the viewport rather than merely below the trigger.
   *
   * A fixed panel pinned to `box.bottom` hangs off the bottom of the screen for
   * every dropdown in the lower third of a page — the role selects on the last
   * rows of the user table, the priority select in a ticket's sidebar — and the
   * part that runs past the edge cannot be reached at all. So: clamp to the
   * viewport on both axes, flip above when below cannot hold the list, and cap
   * the height to whatever the chosen side actually has. The panel already
   * scrolls, so a cap costs nothing; overflowing costs the options.
   */
  const measure = useCallback(() => {
    const node = triggerRef.current;
    if (!node) return;

    const box = node.getBoundingClientRect();
    // clientWidth/clientHeight exclude the scrollbars, which is the box a
    // `position: fixed` element is laid out in. innerWidth would let the
    // panel slide under a vertical scrollbar.
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    // The panel tracks the trigger's width, so this only bites on a narrow
    // window or a trigger sitting hard against an edge — but there it is the
    // difference between a readable list and one with its right half gone.
    const width = Math.min(box.width, vw - VIEWPORT_MARGIN * 2);
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, box.left),
      Math.max(VIEWPORT_MARGIN, vw - width - VIEWPORT_MARGIN),
    );

    const spaceBelow = vh - box.bottom - TRIGGER_GAP - VIEWPORT_MARGIN;
    const spaceAbove = box.top - TRIGGER_GAP - VIEWPORT_MARGIN;

    // What the list would like to be. Asking for this rather than for the cap
    // keeps a short list from flipping sides just because 288px would not fit.
    const wanted = Math.min(
      MAX_PANEL_HEIGHT,
      options.length * ROW_HEIGHT + PANEL_CHROME,
    );

    // Flip only when below genuinely cannot hold the list and above does
    // better. A panel that changes sides over a couple of pixels reads as a
    // glitch, so the test is deliberately not "is there room for all of it".
    const above = spaceBelow < wanted && spaceAbove > spaceBelow;

    const room = Math.max(above ? spaceAbove : spaceBelow, 0);

    setPlacement({
      left,
      width,
      maxHeight: Math.min(wanted, room),
      top: box.bottom + TRIGGER_GAP,
      bottom: vh - box.top + TRIGGER_GAP,
      above,
    });
  }, [options.length]);

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  const openPanel = useCallback(() => {
    // Measured in the event handler, not an effect: no `setState` in an
    // effect body, and no frame where the panel sits at the wrong position.
    measure();
    setActiveIndex(
      options.findIndex((option) => option.value === currentValue),
    );
    setOpen(true);
  }, [measure, options, currentValue]);

  const select = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option || option.disabled) return;
      const node = selectRef.current;
      if (node) commitValue(node, option.value);
      setUncontrolledValue(option.value);
      close();
      triggerRef.current?.focus();
    },
    [options, close],
  );

  /** Skips disabled entries, and stops at the ends rather than wrapping. */
  const step = useCallback(
    (from: number, delta: number) => {
      let next = from;
      for (let i = 0; i < options.length; i++) {
        next += delta;
        if (next < 0 || next >= options.length) return from;
        if (!options[next].disabled) return next;
      }
      return from;
    },
    [options],
  );

  // Capture, and claim the key: a dropdown inside a Modal owes Escape to the
  // dropdown alone. Both listen on `document`, and the Modal registered first,
  // so the only way to get there before it is the capture phase.
  useEscape(open, close, { capture: true, stopPropagation: true });

  // Keeps the portalled panel attached to its trigger while the page moves,
  // and dismisses it on an outside press. The state writes live in listener
  // callbacks, not in the effect body.
  useEffect(() => {
    if (!open) return;

    const onScroll = (event: Event) => {
      // Scrolling inside the panel is a long option list being read, not
      // the page moving underneath it.
      if (panelRef.current?.contains(event.target as Node)) return;

      // Once the trigger has scrolled out of the viewport the panel is
      // pointing at nothing, so it closes — the same thing a native select
      // does rather than leaving a menu floating over unrelated content.
      const box = triggerRef.current?.getBoundingClientRect();
      if (
        box &&
        (box.bottom < 0 ||
          box.top > document.documentElement.clientHeight ||
          box.right < 0 ||
          box.left > document.documentElement.clientWidth)
      ) {
        close();
        return;
      }

      measure();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        panelRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      )
        return;
      close();
    };

    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", measure);
    document.addEventListener("pointerdown", onPointerDown, true);

    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", measure);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, measure, close]);

  // With the panel's height clamped to the room available, arrowing past the
  // visible rows would otherwise walk an active option the user cannot see.
  // Read-only: this measures and scrolls, it never writes state.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    panelRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function onTriggerKeyDown(event: React.KeyboardEvent) {
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        openPanel();
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
        setActiveIndex(step(-1, 1));
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(step(options.length, -1));
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        select(activeIndex);
        break;
      case "Tab":
        // Tab commits and moves on, the way a native select does.
        select(activeIndex);
        break;
      default: {
        // Type-ahead: "pen" walks to Pending. The term resets after a pause
        // so a second search does not append to the first.
        if (event.key.length !== 1) return;
        const now = Date.now();
        const state = typeahead.current;
        state.term = now - state.at > 600 ? event.key : state.term + event.key;
        state.at = now;

        const match = options.findIndex(
          (option) =>
            !option.disabled &&
            option.label.toLowerCase().startsWith(state.term.toLowerCase()),
        );
        if (match >= 0) setActiveIndex(match);
      }
    }
  }

  const setRefs = (node: HTMLSelectElement | null) => {
    selectRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };

  return (
    <div className={cn("relative", className)}>
      <select
        ref={setRefs}
        disabled={disabled}
        onChange={onChange}
        // On a pointer the listbox is the control, so the select leaves the
        // tab order and the accessibility tree — two controls for one value
        // reads as a duplicate, not a fallback.
        aria-hidden={!coarse}
        tabIndex={coarse ? undefined : -1}
        className={cn(
          CONTROL_BASE,
          "h-11 cursor-pointer appearance-none pr-8 sm:h-9",
          !coarse && "pointer-events-none absolute inset-0 opacity-0",
        )}
        {...props}
      >
        {children}
      </select>

      {coarse ? (
        <Chevron className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" />
      ) : (
        <>
          <button
            ref={triggerRef}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-haspopup="listbox"
            aria-activedescendant={
              open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
            }
            disabled={disabled}
            onClick={() => (open ? close() : openPanel())}
            onKeyDown={onTriggerKeyDown}
            className={cn(
              CONTROL_BASE,
              "relative flex h-11 items-center justify-between gap-2 text-left sm:h-9",
              "disabled:pointer-events-none",
              open && "border-accent-line",
            )}
          >
            <span className={cn("truncate", !selected && "text-ink-faint")}>
              {selected?.label ?? ""}
            </span>
            <Chevron open={open} reduced={reduced} />
          </button>

          {isClient &&
            createPortal(
              <AnimatePresence>
                {open && placement && (
                  <motion.ul
                    ref={panelRef}
                    id={listId}
                    role="listbox"
                    initial={
                      reduced
                        ? { opacity: 0 }
                        : {
                            opacity: 0,
                            scaleY: 0.85,
                            // Always toward the trigger, so a flipped panel
                            // still grows out of the control rather than into it.
                            y: placement.above ? 4 : -4,
                          }
                    }
                    animate={{ opacity: 1, scaleY: 1, y: 0 }}
                    exit={
                      reduced
                        ? { opacity: 0, transition: transition.fast }
                        : {
                            opacity: 0,
                            scaleY: 0.9,
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
                      // One edge only. Setting both would stretch the panel
                      // between them and defeat the measured cap.
                      ...(placement.above
                        ? { bottom: placement.bottom }
                        : { top: placement.top }),
                      // Scale out of the edge nearest the trigger.
                      originY: placement.above ? 1 : 0,
                    }}
                    className={cn(
                      "z-[60] overflow-auto rounded-[12px] border border-line-strong",
                      "bg-canvas-raised p-1 shadow-[var(--shadow-lg)]",
                    )}
                  >
                    {options.map((option, index) => {
                      const isSelected = option.value === currentValue;
                      const isActive = index === activeIndex;

                      return (
                        <motion.li
                          key={`${option.value}-${index}`}
                          id={`${listId}-${index}`}
                          data-index={index}
                          role="option"
                          aria-selected={isSelected}
                          aria-disabled={option.disabled}
                          initial={reduced ? false : { opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            ...transition.fast,
                            // Capped so a long department list is not still
                            // arriving after the eye has landed.
                            delay: reduced ? 0 : Math.min(index, 8) * 0.022,
                          }}
                          onMouseEnter={() =>
                            !option.disabled && setActiveIndex(index)
                          }
                          onMouseDown={(event) => {
                            event.preventDefault();
                            select(index);
                          }}
                          className={cn(
                            "flex cursor-pointer items-center justify-between gap-2 rounded-[8px]",
                            "px-2.5 py-1.5 text-[0.8125rem] transition-colors duration-100",
                            option.disabled && "cursor-not-allowed opacity-40",
                            isActive && !option.disabled && "bg-surface-hover",
                            isSelected
                              ? "font-medium text-ink"
                              : "text-ink-muted",
                          )}
                        >
                          <span className="truncate">{option.label}</span>
                          {isSelected && (
                            <svg
                              viewBox="0 0 16 16"
                              className="size-3.5 flex-none text-accent"
                              fill="none"
                              aria-hidden
                            >
                              <path
                                d="m3.5 8.5 3 3 6-6.5"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </motion.li>
                      );
                    })}
                  </motion.ul>
                )}
              </AnimatePresence>,
              document.body,
            )}
        </>
      )}
    </div>
  );
});

function Chevron({
  open = false,
  reduced = false,
  className,
}: {
  open?: boolean;
  reduced?: boolean | null;
  className?: string;
}) {
  return (
    <motion.svg
      viewBox="0 0 16 16"
      className={cn("size-3.5 flex-none text-ink-faint", className)}
      fill="none"
      aria-hidden
      animate={{ rotate: open && !reduced ? 180 : 0 }}
      transition={transition.fast}
    >
      <path
        d="m4 6 4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </motion.svg>
  );
}
