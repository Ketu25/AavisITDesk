"use client";

import { useCallback, useSyncExternalStore } from "react";
import { TICKET_LIMITS } from "@/lib/constants";
import { TICKET_PRIORITIES, type TicketPriority } from "@/lib/database.types";

/**
 * The half-written ticket, kept until it is sent or deliberately cleared.
 *
 * Closing the dialog is never a decision to throw work away — it is usually a
 * glance at another ticket for the error text — so what was typed survives the
 * dialog closing, navigating, and a reload. It lives in sessionStorage: it dies
 * with the tab, and it is keyed by user so a shared machine never offers one
 * person's draft to the next. Sign-out clears it as well (see `clearAllDrafts`).
 *
 * One store, read through `useSyncExternalStore`, so the dialog and the
 * full-page form are always looking at the same draft, and the server render —
 * which has no storage — sees an empty one without a hydration mismatch.
 */

export type Step = 0 | 1 | 2;
export const STEP_COUNT = 3;

export type Draft = {
  step: Step;
  category: string;
  priority: TicketPriority;
  /** Once someone picks an urgency themselves, a category's default stops overriding it. */
  priorityChosen: boolean;
  subject: string;
  description: string;
};

export const EMPTY_DRAFT: Draft = Object.freeze({
  step: 0,
  category: "",
  priority: "normal",
  priorityChosen: false,
  subject: "",
  description: "",
});

/** Versioned: a shape change bumps this and old drafts are simply not read. */
const PREFIX = "aavis:new-ticket-draft:v1:";

const cache = new Map<string, Draft>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Anything typed, or anything chosen. A draft that is only defaults is not worth keeping. */
export function hasContent(draft: Draft) {
  return Boolean(
    draft.category || draft.subject.trim() || draft.description.trim() || draft.priorityChosen,
  );
}

/** Storage is user-editable and may hold an older shape: trust nothing in it. */
function parse(raw: string | null): Draft {
  if (!raw) return EMPTY_DRAFT;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return EMPTY_DRAFT;
    const v = value as Record<string, unknown>;
    const step = v.step === 1 || v.step === 2 ? v.step : 0;
    const priority = TICKET_PRIORITIES.includes(v.priority as TicketPriority)
      ? (v.priority as TicketPriority)
      : "normal";
    return {
      step,
      category: typeof v.category === "string" ? v.category : "",
      priority,
      priorityChosen: v.priorityChosen === true,
      subject: typeof v.subject === "string" ? v.subject.slice(0, TICKET_LIMITS.subjectMax) : "",
      description:
        typeof v.description === "string"
          ? v.description.slice(0, TICKET_LIMITS.descriptionMax)
          : "",
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

function read(key: string): Draft {
  let draft = cache.get(key);
  if (!draft) {
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(key);
    } catch {
      // Storage disabled (some private modes, locked-down policies). The draft
      // still lives in memory for as long as this page does.
    }
    draft = parse(raw);
    cache.set(key, draft);
  }
  return draft;
}

function write(key: string, draft: Draft) {
  cache.set(key, draft);
  try {
    if (hasContent(draft)) window.sessionStorage.setItem(key, JSON.stringify(draft));
    else window.sessionStorage.removeItem(key);
  } catch {
    // Quota or disabled storage — the in-memory copy above is still current.
  }
  emit();
}

/** For code that clears the draft without rendering it — the submission, once it lands. */
export function resetDraft(userId: string) {
  write(PREFIX + userId, EMPTY_DRAFT);
}

/** Every user's draft in this tab. Called on sign-out, before the session ends. */
export function clearAllDrafts() {
  cache.clear();
  try {
    const storage = window.sessionStorage;
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key?.startsWith(PREFIX)) storage.removeItem(key);
    }
  } catch {
    // Nothing stored, then.
  }
  emit();
}

const serverSnapshot = () => EMPTY_DRAFT;

export function useDraft(userId: string) {
  const key = PREFIX + userId;
  const draft = useSyncExternalStore(subscribe, () => read(key), serverSnapshot);

  /** Patches are applied to the stored draft, not a render's copy, so two quick edits never undo each other. */
  const update = useCallback(
    (patch: Partial<Draft> | ((current: Draft) => Partial<Draft>)) => {
      const current = read(key);
      write(key, { ...current, ...(typeof patch === "function" ? patch(current) : patch) });
    },
    [key],
  );

  const reset = useCallback(() => write(key, EMPTY_DRAFT), [key]);

  return { draft, update, reset };
}
