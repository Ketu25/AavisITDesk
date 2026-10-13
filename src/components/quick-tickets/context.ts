"use client";

import { createContext, useContext } from "react";
import type { QuickIssue } from "@/lib/quick-tickets";
import type { TicketPriority } from "@/lib/database.types";

/** Viewport point the dialog grows out of — the centre of the control that opened it. */
export type Origin = { x: number; y: number };

export type CreatedTicket = {
  id: string;
  ticket_number: string;
  subject: string;
  priority: TicketPriority;
  category: string;
};

/** An unfinished ticket the requester already raised from the same quick ticket. */
export type OpenTicket = { id: string; ticket_number: string };

export type QuickFailure = {
  status: "error";
  issueId: string;
  message: string;
  /** No clear answer came back, so the ticket may exist. */
  uncertain: boolean;
  reason?: "unavailable" | "duplicate" | "answer";
  duplicate?: OpenTicket;
};

export type QuickSubmission =
  | { status: "idle" }
  | { status: "pending"; issueId: string }
  | QuickFailure
  | { status: "success"; issueId: string; ticket: CreatedTicket; expected: TicketPriority };

export type QuickDraft = { answer: string; note: string };

export type QuickTicketContextValue = {
  userId: string;
  departmentName: string | null;
  open: (
    issue: QuickIssue,
    options?: { trigger?: HTMLElement | null; knownOpen?: OpenTicket | null },
  ) => void;
  /** The quick ticket being sent right now, if any. */
  pendingId: string | null;
  submission: QuickSubmission;
  submit: (input: {
    issue: QuickIssue;
    answer: string;
    note: string;
    allowDuplicate: boolean;
  }) => Promise<void>;
  clearSubmission: () => void;
  getDraft: (issueId: string) => QuickDraft;
  setDraft: (issueId: string, draft: QuickDraft) => void;
};

export const QuickTicketContext = createContext<QuickTicketContextValue | null>(null);

export function useQuickTicket() {
  const ctx = useContext(QuickTicketContext);
  if (!ctx) throw new Error("useQuickTicket must be used inside <QuickTicketProvider>");
  return ctx;
}
