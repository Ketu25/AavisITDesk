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
  const [rect, setRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
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

  const measure = useCallback(() => {
    const node = triggerRef.current;
    if (!node) return;
    const box = node.getBoundingClientRect();
    setRect({ top: box.bottom + 6, left: box.left, width: box.width });
  }, []);

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

  useEscape(open, close);

  // Keeps the portalled panel attached to its trigger while the page moves,
  // and dismisses it on an outside press. The state writes live in listener
  // callbacks, not in the effect body.
  useEffect(() => {
    if (!open) return;

    const onScroll = (event: Event) => {
      // Scrolling inside the panel is a long option list being read, not
      // the page moving underneath it.
      if (panelRef.current?.contains(event.target as Node)) return;
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
                {open && rect && (
                  <motion.ul
                    ref={panelRef}
                    id={listId}
                    role="listbox"
                    initial={
                      reduced
                        ? { opacity: 0 }
                        : { opacity: 0, scaleY: 0.85, y: -4 }
                    }
                    animate={{ opacity: 1, scaleY: 1, y: 0 }}
                    exit={
                      reduced
                        ? { opacity: 0, transition: transition.fast }
                        : {
                            opacity: 0,
                            scaleY: 0.9,
                            y: -2,
                            transition: transition.fast,
                          }
                    }
                    transition={reduced ? transition.fast : spring.gentle}
                    style={{
                      position: "fixed",
                      top: rect.top,
                      left: rect.left,
                      width: rect.width,
                      originY: 0,
                    }}
                    className={cn(
                      "z-[60] max-h-72 overflow-auto rounded-[12px] border border-line-strong",
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
