"use client";

import { useMemo } from "react";
import { AnimatePresence } from "motion/react";
import { TicketRow, type TicketRowData } from "./ticket-row";
import { indexRules } from "@/lib/sla";
import type { SlaRule } from "@/lib/database.types";

export function DashboardList({
  tickets,
  rules,
  showAssignee,
  showRequester,
}: {
  tickets: TicketRowData[];
  rules: SlaRule[];
  showAssignee?: boolean;
  showRequester?: boolean;
}) {
  const ruleIndex = useMemo(() => indexRules(rules), [rules]);

  return (
    <div className="card overflow-hidden">
      <ul>
        <AnimatePresence initial={false} mode="popLayout">
          {tickets.map((ticket, index) => (
            <TicketRow
              key={ticket.id}
              ticket={ticket}
              rules={ruleIndex}
              index={index}
              showAssignee={showAssignee}
              showRequester={showRequester}
            />
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
