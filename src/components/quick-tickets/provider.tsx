"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence } from "motion/react";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError } from "@/lib/api";
import type { QuickIssue } from "@/lib/quick-tickets";
import {
  QuickTicketContext,
  type CreatedTicket,
  type OpenTicket,
  type Origin,
  type QuickDraft,
  type QuickFailure,
  type QuickSubmission,
  type QuickTicketContextValue,
} from "./context";

// Only ever drawn after someone picks a quick ticket, so it has no business in
// the server render — which is bundled into the Cloudflare Worker, already
// close to its size limit. Fetched on first open instead.
const QuickTicketDialog = dynamic(() => import("./dialog").then((m) => m.QuickTicketDialog), {
  ssr: false,
  loading: () => null,
});

/**
 * Raising a quick ticket from wherever one is offered — the Quick tickets
 * page, or ⌘K.
 *
 * Picking one opens a short confirmation: the requester sees exactly what IT
 * will receive, answers the admin's question if there is one, and sends. The
 * open dialog, the submission and anything typed live here, above the dialog,
 * for the same reasons as the new-ticket dialog's provider:
 *
 * - The dialog unmounts when closed, but a request in flight must not. Its
 *   result still lands, and is announced with a toast if nothing is on screen
 *   to show it.
 * - Closing the dialog is not a decision to throw away a typed answer. Drafts
 *   are kept per quick ticket for as long as the page is, and cleared once
 *   the ticket is sent.
 */

type Session = {
  /** A fresh dialog per open, so nothing from the last one carries over. */
  key: number;
  issue: QuickIssue;
  origin: Origin | null;
  /** Set when IT edited the quick ticket while it was on screen. */
  changed: boolean;
  /** What the Quick tickets page already knew about an open ticket for it. */
  knownOpen: OpenTicket | null;
};

const IDLE: QuickSubmission = { status: "idle" };
const EMPTY_DRAFT: QuickDraft = Object.freeze({ answer: "", note: "" });

export function QuickTicketProvider({
  userId,
  departmentName,
  children,
}: {
  userId: string;
  departmentName: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { push } = useToast();

  const [session, setSession] = useState<Session | null>(null);
  const [submission, setSubmission] = useState<QuickSubmission>(IDLE);
  const sessionKey = useRef(0);
  /** The quick ticket whose request is in flight. Also the double-send guard. */
  const inFlight = useRef<string | null>(null);
  const drafts = useRef(new Map<string, QuickDraft>());

  // Any navigation takes the dialog with it — "View ticket", Back, a toast's
  // link. Adjusted during render so the closed state is the one that paints.
  const [trackedPath, setTrackedPath] = useState(pathname);
  if (trackedPath !== pathname) {
    setTrackedPath(pathname);
    if (session) setSession(null);
  }

  // Read when a request settles, possibly long after the render that sent it.
  const openIssueId = useRef<string | null>(null);
  useEffect(() => {
    openIssueId.current = session?.issue.id ?? null;
  }, [session]);

  const getDraft = useCallback((issueId: string) => drafts.current.get(issueId) ?? EMPTY_DRAFT, []);
  const setDraft = useCallback((issueId: string, draft: QuickDraft) => {
    if (draft.answer || draft.note) drafts.current.set(issueId, draft);
    else drafts.current.delete(issueId);
  }, []);

  const open = useCallback<QuickTicketContextValue["open"]>(
    (issue, options) => {
      // One request at a time. Opening the one being sent shows its progress;
      // any other waits rather than appearing to send twice at once.
      if (inFlight.current !== null && inFlight.current !== issue.id) {
        push({
          tone: "info",
          title: "Still sending your last quick ticket",
          description: "Try again in a moment.",
        });
        return;
      }

      const rect = options?.trigger?.getBoundingClientRect();
      const origin =
        rect && rect.width > 0 && rect.height > 0
          ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : null;

      // An old result or error is not what anyone opening it again wants to see.
      setSubmission((s) => (s.status === "pending" ? s : IDLE));
      setSession({
        key: ++sessionKey.current,
        issue,
        origin,
        changed: false,
        knownOpen: options?.knownOpen ?? null,
      });
    },
    [push],
  );

  const close = useCallback(() => setSession(null), []);

  const submit = useCallback<QuickTicketContextValue["submit"]>(
    async ({ issue, answer, note, allowDuplicate }) => {
      // A double click, or Enter held down, must not send two tickets.
      if (inFlight.current !== null) return;
      inFlight.current = issue.id;
      setSubmission({ status: "pending", issueId: issue.id });

      const onScreen = () => openIssueId.current === issue.id;

      try {
        const { ticket } = await api<{ ticket: CreatedTicket }>("/api/tickets/quick", {
          method: "POST",
          json: {
            quick_ticket_id: issue.id,
            revision: issue.revision,
            answer,
            note,
            allow_duplicate: allowDuplicate,
          },
        });

        drafts.current.delete(issue.id);
        setSubmission({ status: "success", issueId: issue.id, ticket, expected: issue.startsAt });
        // The sidebar count, the overview's trackers, My tickets, and the
        // "already reported" marks on the Quick tickets page.
        router.refresh();

        if (!onScreen()) {
          push({
            tone: "success",
            title: `${ticket.ticket_number} sent to IT`,
            description: "You can follow it in My tickets.",
            action: { label: "View ticket", href: `/tickets/${ticket.id}` },
            duration: 8000,
          });
        }
      } catch (error) {
        const details =
          error instanceof ApiClientError && error.details && typeof error.details === "object"
            ? (error.details as Record<string, unknown>)
            : {};

        // IT edited it while it was open: show the new version in place of
        // the old one, keep what was typed, and let the requester send again.
        if (details.reason === "changed" && isIssue(details.issue)) {
          const fresh = details.issue;
          setSubmission(IDLE);
          setSession((s) => (s && s.issue.id === fresh.id ? { ...s, issue: fresh, changed: true } : s));
          router.refresh();
          if (!onScreen()) {
            push({
              tone: "info",
              title: "Your quick ticket was not sent",
              description: "IT updated it while you had it open. Open it again to check it and send.",
              duration: 8000,
            });
          }
          return;
        }

        const failure = describeFailure(error, issue.id, details);
        setSubmission(failure);
        // Switched off since the page loaded: bring the list up to date.
        if (failure.reason === "unavailable") router.refresh();

        if (!onScreen()) {
          push({
            tone: "error",
            title: "Your quick ticket was not sent",
            description: failure.uncertain
              ? `${failure.message} It may have reached IT anyway — check My tickets before sending it again.`
              : failure.message,
            duration: 8000,
          });
        }
      } finally {
        inFlight.current = null;
      }
    },
    [router, push],
  );

  const clearSubmission = useCallback(() => {
    setSubmission((s) => (s.status === "pending" ? s : IDLE));
  }, []);

  const pendingId = submission.status === "pending" ? submission.issueId : null;

  const value = useMemo<QuickTicketContextValue>(
    () => ({
      userId,
      departmentName,
      open,
      pendingId,
      submission,
      submit,
      clearSubmission,
      getDraft,
      setDraft,
    }),
    [userId, departmentName, open, pendingId, submission, submit, clearSubmission, getDraft, setDraft],
  );

  return (
    <QuickTicketContext.Provider value={value}>
      {children}
      <AnimatePresence
        // Once the dialog has fully gone, a result it showed is spent.
        onExitComplete={() =>
          setSubmission((s) => (s.status === "success" || s.status === "error" ? IDLE : s))
        }
      >
        {session && (
          <QuickTicketDialog
            key={session.key}
            issue={session.issue}
            changed={session.changed}
            knownOpen={session.knownOpen}
            origin={session.origin}
            onClose={close}
          />
        )}
      </AnimatePresence>
    </QuickTicketContext.Provider>
  );
}

function isIssue(value: unknown): value is QuickIssue {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.revision === "number" &&
    typeof v.label === "string" &&
    typeof v.subject === "string" &&
    typeof v.description === "string" &&
    typeof v.category === "string" &&
    typeof v.startsAt === "string" &&
    !!v.group &&
    typeof v.group === "object"
  );
}

/**
 * What to tell someone whose quick ticket did not go through — and whether it
 * might have anyway. A dropped connection or a gateway timeout says nothing
 * about whether the insert ran.
 */
function describeFailure(error: unknown, issueId: string, details: Record<string, unknown>): QuickFailure {
  if (error instanceof ApiClientError) {
    if (error.status === 401) {
      return {
        status: "error",
        issueId,
        message: "Your session has ended. Sign in again, then send it.",
        uncertain: false,
      };
    }

    if (details.reason === "duplicate") {
      const ticket = details.ticket as Record<string, unknown> | undefined;
      return {
        status: "error",
        issueId,
        message: error.message,
        uncertain: false,
        reason: "duplicate",
        duplicate:
          ticket && typeof ticket.id === "string" && typeof ticket.ticket_number === "string"
            ? { id: ticket.id, ticket_number: ticket.ticket_number }
            : undefined,
      };
    }

    const reason =
      details.reason === "unavailable" ? "unavailable" : details.field === "answer" ? "answer" : undefined;
    // A 2xx that could not be read is a ticket that probably exists.
    const uncertain =
      error.status === 408 || error.status >= 502 || (error.status >= 200 && error.status < 300);
    return { status: "error", issueId, message: error.message, uncertain, reason };
  }
  // fetch() itself threw: offline, DNS, or the connection dropped mid-request.
  return {
    status: "error",
    issueId,
    message: "Couldn't reach the server. Check your connection.",
    uncertain: true,
  };
}
