"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { PriorityPill, SlaPill, StatusPill } from "./pills";
import { Avatar } from "@/components/ui/avatar";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SlaRule, Ticket, TicketPriority } from "@/lib/database.types";

export type TicketRowData = Ticket & {
  department: { name: string } | null;
  creator: { id: string; full_name: string } | null;
  assignee: { id: string; full_name: string } | null;
};

export function TicketRow({
  ticket,
  rules,
  index = 0,
  showAssignee = false,
  showRequester = false,
}: {
  ticket: TicketRowData;
  rules?: Partial<Record<TicketPriority, SlaRule>>;
  index?: number;
  showAssignee?: boolean;
  showRequester?: boolean;
}) {
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{
        type: "spring",
        stiffness: 420,
        damping: 34,
        delay: Math.min(index * 0.022, 0.22),
      }}
    >
      <Link
        href={`/tickets/${ticket.id}`}
        className={cn(
          "group flex flex-col gap-2.5 border-b border-line px-4 py-3.5 last:border-b-0",
          "transition-colors duration-150 hover:bg-surface-hover sm:flex-row sm:items-center sm:gap-4",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="tabular font-mono text-[0.6875rem] text-ink-faint">
              {ticket.ticket_number}
            </span>
            <span className="text-[0.6875rem] text-ink-faint">·</span>
            <span className="truncate text-[0.6875rem] text-ink-faint">{ticket.category}</span>
            {ticket.reopen_count > 0 && (
              <span className="tabular rounded bg-surface-sunk px-1.5 text-[0.625rem] font-medium text-ink-muted">
                reopened ×{ticket.reopen_count}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[0.875rem] font-medium text-ink group-hover:text-ink">
            {ticket.subject}
          </p>
          <div className="mt-1 flex items-center gap-2 text-[0.75rem] text-ink-faint">
            {showRequester && ticket.creator && (
              <>
                <Avatar name={ticket.creator.full_name} id={ticket.creator.id} size="xs" />
                <span className="truncate">{ticket.creator.full_name}</span>
                <span>·</span>
              </>
            )}
            {ticket.department?.name && (
              <>
                <span className="truncate">{ticket.department.name}</span>
                <span>·</span>
              </>
            )}
            <span title={new Date(ticket.created_at).toLocaleString()}>
              {relativeTime(ticket.created_at)}
            </span>
          </div>
        </div>

        <div className="flex flex-none flex-wrap items-center gap-1.5">
          <SlaPill ticket={ticket} rules={rules} />
          <PriorityPill priority={ticket.priority} />
          <StatusPill status={ticket.status} />
          {showAssignee && (
            <div className="ml-1 w-6">
              {ticket.assignee ? (
                <Avatar name={ticket.assignee.full_name} id={ticket.assignee.id} size="sm" />
              ) : (
                <span
                  title="Unassigned"
                  className="flex size-6 items-center justify-center rounded-full border border-dashed border-line-strong text-[0.625rem] text-ink-faint"
                >
                  ?
                </span>
              )}
            </div>
          )}
        </div>
      </Link>
    </motion.li>
  );
}
