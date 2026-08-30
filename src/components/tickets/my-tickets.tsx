"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { TicketRow, type TicketRowData } from "./ticket-row";
import { EmptyState } from "@/components/ui/states";
import { Icons } from "@/components/shell/icons";
import { OPEN_STATUSES } from "@/lib/constants";
import { indexRules } from "@/lib/sla";
import { cn } from "@/lib/utils";
import type { SlaRule } from "@/lib/database.types";

type Filter = "open" | "resolved" | "all";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "All" },
];

export function MyTickets({
  tickets,
  rules,
}: {
  tickets: TicketRowData[];
  rules: SlaRule[];
}) {
  const [filter, setFilter] = useState<Filter>("open");
  const ruleIndex = useMemo(() => indexRules(rules), [rules]);

  const counts = useMemo(
    () => ({
      open: tickets.filter((t) => OPEN_STATUSES.includes(t.status)).length,
      resolved: tickets.filter((t) => t.status === "resolved" || t.status === "closed").length,
      all: tickets.length,
    }),
    [tickets],
  );

  const visible = useMemo(() => {
    if (filter === "open") return tickets.filter((t) => OPEN_STATUSES.includes(t.status));
    if (filter === "resolved")
      return tickets.filter((t) => t.status === "resolved" || t.status === "closed");
    return tickets;
  }, [tickets, filter]);

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-[10px] border border-line bg-surface-sunk p-0.5">
        {FILTERS.map((item) => {
          const active = item.key === filter;
          return (
            <button
              key={item.key}
              onClick={() => setFilter(item.key)}
              className={cn(
                "relative rounded-[7px] px-3 py-1.5 text-[0.8125rem] font-medium transition-colors",
                active ? "text-ink" : "text-ink-faint hover:text-ink-muted",
              )}
            >
              {active && (
                <motion.span
                  layoutId="my-filter"
                  transition={{ type: "spring", stiffness: 480, damping: 36 }}
                  className="absolute inset-0 -z-10 rounded-[7px] border border-line bg-surface shadow-[var(--shadow-sm)]"
                />
              )}
              {item.label}
              <span className="tabular ml-1.5 text-ink-faint">{counts[item.key]}</span>
            </button>
          );
        })}
      </div>

      <div className="card overflow-hidden">
        {visible.length === 0 ? (
          <EmptyState
            icon={<Icons.inbox />}
            title={filter === "open" ? "Nothing open right now" : "Nothing here yet"}
            description={
              filter === "open"
                ? "When you raise a ticket it'll show up here and update live as IT works on it."
                : "Tickets you've raised will appear here."
            }
            action={
              <Link
                href="/tickets/new"
                className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-line-strong bg-surface px-3 text-[0.8125rem] font-medium text-ink transition-colors hover:bg-surface-hover"
              >
                <Icons.plus className="size-3.5" />
                Raise a ticket
              </Link>
            }
          />
        ) : (
          <ul>
            <AnimatePresence initial={false} mode="popLayout">
              {visible.map((ticket, index) => (
                <TicketRow
                  key={ticket.id}
                  ticket={ticket}
                  rules={ruleIndex}
                  index={index}
                  showAssignee
                />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  );
}
