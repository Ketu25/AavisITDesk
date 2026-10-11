"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence } from "motion/react";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { resetDraft, type Draft } from "./draft";
import { NewTicketDialog, type Origin } from "./dialog";
import {
  NEW_TICKET_PAGE_ID,
  NEW_TICKET_PATH,
  NewTicketContext,
  useNewTicket,
  type CategoriesState,
  type Category,
  type CreatedTicket,
  type NewTicketContextValue,
  type Submission,
} from "./context";

/**
 * Raising a ticket from wherever you are.
 *
 * Every "New ticket" control opens the same dialog over the current page
 * instead of navigating away from it — the thing someone wants to report is
 * usually on the screen they are looking at. The open state, the category
 * list and the submission live here, above the dialog, for three reasons:
 *
 * - The dialog unmounts when closed, but a submission in flight must not. If
 *   it is closed mid-request the result still lands, and is announced with a
 *   toast when no form is on screen to show it.
 * - Categories are fetched once and refreshed on each open, so reopening is
 *   instant and an admin's change still shows up.
 * - The full-page form at /tickets/new shares the same draft and submission,
 *   so the two can never disagree about what has been sent.
 */

const IDLE: Submission = { status: "idle" };

type Session = { origin: Origin | null };

export function NewTicketProvider({
  userId,
  departmentName,
  isAdmin,
  children,
}: {
  userId: string;
  departmentName: string | null;
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { push } = useToast();

  const [session, setSession] = useState<Session | null>(null);

  // Any navigation takes the dialog with it — "View ticket", the browser's
  // Back, a link in a toast. Adjusted during render rather than in an effect,
  // so the closed state is the one that paints, and the dialog cannot come
  // back on its own when Back returns to the page it was opened on.
  const [trackedPath, setTrackedPath] = useState(pathname);
  if (trackedPath !== pathname) {
    setTrackedPath(pathname);
    if (session) setSession(null);
  }

  const isOpen = session !== null;

  // ------------------------------------------------------------ categories --

  const [categories, setCategories] = useState<CategoriesState>({
    list: null,
    failed: false,
    loading: false,
  });
  const loadSeq = useRef(0);

  const loadCategories = useCallback(() => {
    const seq = ++loadSeq.current;
    setCategories((prev) => (prev.loading ? prev : { ...prev, loading: true }));

    // Only the newest request may write: a slow answer to an older one must
    // not replace a fresher list. A failed refresh keeps the list already on
    // screen — it is far more likely to be right than an error is useful.
    const settle = (list: Category[] | null) => {
      if (seq !== loadSeq.current) return;
      setCategories((prev) =>
        list ? { list, failed: false, loading: false } : { ...prev, failed: true, loading: false },
      );
    };

    createClient()
      .from("routing_rules")
      .select("category, description, default_priority")
      .eq("is_active", true)
      .order("sort_order")
      .order("category")
      .then(
        ({ data, error }) => settle(error ? null : (data ?? [])),
        () => settle(null),
      );
  }, []);

  // ------------------------------------------------------------ submission --

  const [submission, setSubmission] = useState<Submission>(IDLE);
  const inFlight = useRef(false);

  // Read when a request settles, which may be long after the render that
  // started it — so refs, not the values captured at the time.
  const dialogOpen = useRef(false);
  const pageViewers = useRef(0);
  useEffect(() => {
    dialogOpen.current = isOpen;
  }, [isOpen]);

  const submit = useCallback(
    async (draft: Draft) => {
      // A double click, or Enter held down, must not send two tickets.
      if (inFlight.current) return;
      inFlight.current = true;
      setSubmission({ status: "pending" });

      try {
        const { ticket } = await api<{ ticket: CreatedTicket }>("/api/tickets", {
          method: "POST",
          json: {
            subject: draft.subject,
            description: draft.description,
            category: draft.category,
            priority: draft.priority,
          },
        });

        resetDraft(userId);
        setSubmission({ status: "success", ticket, requested: draft.priority });
        // The sidebar count, My tickets and the overview are server-rendered.
        router.refresh();

        if (!dialogOpen.current && pageViewers.current === 0) {
          push({
            tone: "success",
            title: `${ticket.ticket_number} sent to IT`,
            description: "You can follow it in My tickets.",
            action: { label: "View ticket", href: `/tickets/${ticket.id}` },
            duration: 8000,
          });
        }
      } catch (error) {
        const failure = describeFailure(error);
        setSubmission({ status: "error", ...failure });
        if (failure.field === "category") loadCategories();

        if (!dialogOpen.current && pageViewers.current === 0) {
          push({
            tone: "error",
            title: "Your ticket was not sent",
            description: `${failure.message} Your draft is saved — open New ticket to try again.`,
            duration: 8000,
          });
        }
      } finally {
        inFlight.current = false;
      }
    },
    [userId, router, push, loadCategories],
  );

  const clearSubmission = useCallback(() => {
    setSubmission((s) => (s.status === "pending" ? s : IDLE));
  }, []);

  /** Leaving the page form drops a success it was showing; the next visit starts blank. */
  const watchPage = useCallback(() => {
    pageViewers.current++;
    return () => {
      pageViewers.current--;
      setSubmission((s) => (s.status === "success" ? IDLE : s));
    };
  }, []);

  // ---------------------------------------------------------- open / close --

  const open = useCallback(
    (trigger?: HTMLElement | null) => {
      // The form is already the page. Bring it into view rather than stacking
      // a second copy of it on top.
      if (pathname === NEW_TICKET_PATH) {
        const form = document.getElementById(NEW_TICKET_PAGE_ID);
        form?.focus({ preventScroll: true });
        form?.scrollIntoView({ block: "start", behavior: "smooth" });
        return;
      }

      const rect = trigger?.getBoundingClientRect();
      const origin =
        rect && rect.width > 0 && rect.height > 0
          ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : null;

      // A finished result or an old error is not what anyone opening the
      // form again wants to see. A request still in flight stays visible.
      setSubmission((s) => (s.status === "pending" ? s : IDLE));
      setSession({ origin });
    },
    [pathname],
  );

  const close = useCallback(() => setSession(null), []);

  const value = useMemo<NewTicketContextValue>(
    () => ({
      userId,
      departmentName,
      isAdmin,
      open,
      categories,
      loadCategories,
      submission,
      submit,
      clearSubmission,
      watchPage,
    }),
    [
      userId,
      departmentName,
      isAdmin,
      open,
      categories,
      loadCategories,
      submission,
      submit,
      clearSubmission,
      watchPage,
    ],
  );

  return (
    <NewTicketContext.Provider value={value}>
      {children}
      <AnimatePresence
        // Once the dialog has fully gone, a success it showed is spent.
        onExitComplete={() => setSubmission((s) => (s.status === "success" ? IDLE : s))}
      >
        {session && <NewTicketDialog key="new-ticket" origin={session.origin} onClose={close} />}
      </AnimatePresence>
    </NewTicketContext.Provider>
  );
}

/**
 * What to tell someone whose ticket did not go through — and whether it might
 * have anyway. A dropped connection or a gateway timeout says nothing about
 * whether the insert ran, and sending again blind is how duplicates are made.
 */
function describeFailure(error: unknown): Omit<Extract<Submission, { status: "error" }>, "status"> {
  if (error instanceof ApiClientError) {
    if (error.status === 401) {
      return {
        message: "Your session has ended. Sign in again — this draft will still be here.",
        uncertain: false,
      };
    }
    const details = error.details as { field?: unknown } | null | undefined;
    const field = details && typeof details === "object" && details.field === "category" ? "category" : undefined;
    // A 2xx that could not be read is a ticket that probably exists.
    const uncertain =
      error.status === 408 || error.status >= 502 || (error.status >= 200 && error.status < 300);
    return { message: error.message, field, uncertain };
  }
  // fetch() itself threw: offline, DNS, or the connection dropped mid-request.
  return { message: "Couldn't reach the server. Check your connection.", uncertain: true };
}

/**
 * The one control every entry point uses. A plain button, so server-rendered
 * pages can drop it into their headers with their own styling and children.
 */
export function NewTicketButton({
  className,
  children,
  onOpen,
}: {
  className?: string;
  children: React.ReactNode;
  /** Runs first — the mobile drawer uses it to step aside. */
  onOpen?: () => void;
}) {
  const { open } = useNewTicket();
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={(event) => {
        const trigger = event.currentTarget;
        onOpen?.();
        open(trigger);
      }}
      className={className}
    >
      {children}
    </button>
  );
}
