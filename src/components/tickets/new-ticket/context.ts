"use client";

import { createContext, useContext } from "react";
import type { Draft } from "./draft";
import type { TicketPriority } from "@/lib/database.types";

/** The full-page fallback, kept for bookmarks and links from before the dialog. */
export const NEW_TICKET_PATH = "/tickets/new";
/** The page form's container, which takes focus when a trigger is used on that page. */
export const NEW_TICKET_PAGE_ID = "new-ticket-form";

export type Category = {
  category: string;
  description: string | null;
  default_priority: TicketPriority | null;
};

export type CategoriesState = {
  /** Null until the first answer arrives. */
  list: Category[] | null;
  failed: boolean;
  loading: boolean;
};

export type CreatedTicket = {
  id: string;
  ticket_number: string;
  subject: string;
  priority: TicketPriority;
  category: string;
};

export type Submission =
  | { status: "idle" }
  | { status: "pending" }
  | {
      status: "error";
      message: string;
      /** The server rejected the category itself — it has been switched off since it was picked. */
      field?: "category";
      /** No clear answer came back, so the ticket may exist. Worth checking before sending again. */
      uncertain: boolean;
    }
  | { status: "success"; ticket: CreatedTicket; requested: TicketPriority };

export type NewTicketContextValue = {
  userId: string;
  departmentName: string | null;
  isAdmin: boolean;
  /** Opens the dialog, grown from `trigger` when one is given. */
  open: (trigger?: HTMLElement | null) => void;
  categories: CategoriesState;
  loadCategories: () => void;
  submission: Submission;
  submit: (draft: Draft) => Promise<void>;
  /** Back to a blank form after a success, or past an error. */
  clearSubmission: () => void;
  /** The page form registers while mounted, so a result is never left unannounced. */
  watchPage: () => () => void;
};

export const NewTicketContext = createContext<NewTicketContextValue | null>(null);

export function useNewTicket() {
  const ctx = useContext(NewTicketContext);
  if (!ctx) throw new Error("useNewTicket must be used inside <NewTicketProvider>");
  return ctx;
}
