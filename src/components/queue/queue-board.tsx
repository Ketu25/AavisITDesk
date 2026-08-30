"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { TicketRow, type TicketRowData } from "@/components/tickets/ticket-row";
import { Select, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { Icons } from "@/components/shell/icons";
import { OPEN_STATUSES, PRIORITY_META, STATUS_META } from "@/lib/constants";
import { computeSla, indexRules, slaSortValue } from "@/lib/sla";
import { TICKET_PRIORITIES, TICKET_STATUSES, type SlaRule } from "@/lib/database.types";
import { cn } from "@/lib/utils";

type Filters = {
  sla: string;
  assignee: string;
  status: string;
  priority: string;
  department: string;
};

type Sort = "attention" | "newest" | "oldest" | "priority";

/**
 * Which slice of the lifecycle the queue is showing. A ticket the requester has
 * confirmed sits in `closed`, not `resolved`, so "done" has to mean both —
 * exactly what the Resolved tab on My tickets means.
 */
type View = "open" | "done" | "all";

const VIEWS: { key: View; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "done", label: "Resolved" },
  { key: "all", label: "All" },
];

const isDone = (status: string) => status === "resolved" || status === "closed";

/** The dropdown filters one exact status, so the two terminal states need to
 *  explain how they differ from each other. */
const STATUS_OPTION_LABEL: Partial<Record<string, string>> = {
  resolved: "Resolved · awaiting confirmation",
  closed: "Closed · confirmed by requester",
};

const SORTS: { key: Sort; label: string }[] = [
  { key: "attention", label: "Needs attention" },
  { key: "newest", label: "Newest" },
  { key: "oldest", label: "Oldest" },
  { key: "priority", label: "Priority" },
];

export function QueueBoard({
  tickets,
  departments,
  agents,
  rules,
  categories,
  viewerId,
  initialFilters,
}: {
  tickets: TicketRowData[];
  departments: { id: string; name: string }[];
  agents: { id: string; full_name: string }[];
  rules: SlaRule[];
  categories: string[];
  viewerId: string;
  initialFilters: Filters;
}) {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("attention");
  const [view, setView] = useState<View>(
    initialFilters.status && isDone(initialFilters.status) ? "done" : "open",
  );

  const ruleIndex = useMemo(() => indexRules(rules), [rules]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();

    const filtered = tickets.filter((ticket) => {
      // An explicit status filter is more specific than the view, so it wins.
      if (!filters.status) {
        if (view === "open" && isDone(ticket.status)) return false;
        if (view === "done" && !isDone(ticket.status)) return false;
      }
      if (filters.status && ticket.status !== filters.status) return false;
      if (filters.priority && ticket.priority !== filters.priority) return false;
      if (filters.department && ticket.department_id !== filters.department) return false;
      if (category && ticket.category !== category) return false;

      if (filters.assignee === "unassigned" && ticket.assigned_to) return false;
      if (filters.assignee === "me" && ticket.assigned_to !== viewerId) return false;
      if (
        filters.assignee &&
        filters.assignee !== "unassigned" &&
        filters.assignee !== "me" &&
        ticket.assigned_to !== filters.assignee
      )
        return false;

      if (filters.sla) {
        const state = computeSla(ticket, ruleIndex).state;
        if (filters.sla === "breached" && state !== "breached") return false;
        if (filters.sla === "at_risk" && state !== "at_risk") return false;
        if (filters.sla === "on_track" && state !== "on_track") return false;
      }

      if (term) {
        const haystack = [
          ticket.ticket_number,
          ticket.subject,
          ticket.description,
          ticket.category,
          ticket.creator?.full_name,
          ticket.department?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }

      return true;
    });

    const sorted = [...filtered];
    if (sort === "attention") {
      sorted.sort(
        (a, b) =>
          slaSortValue(computeSla(a, ruleIndex)) - slaSortValue(computeSla(b, ruleIndex)),
      );
    } else if (sort === "newest") {
      sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    } else if (sort === "oldest") {
      sorted.sort((a, b) => a.created_at.localeCompare(b.created_at));
    } else {
      sorted.sort(
        (a, b) =>
          PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank ||
          a.created_at.localeCompare(b.created_at),
      );
    }
    return sorted;
  }, [tickets, filters, category, search, sort, view, ruleIndex, viewerId]);

  const summary = useMemo(() => {
    const open = tickets.filter((t) => OPEN_STATUSES.includes(t.status));
    let breached = 0;
    let atRisk = 0;
    open.forEach((t) => {
      const state = computeSla(t, ruleIndex).state;
      if (state === "breached") breached++;
      else if (state === "at_risk") atRisk++;
    });
    return {
      open: open.length,
      breached,
      atRisk,
      unassigned: open.filter((t) => !t.assigned_to).length,
      done: tickets.filter((t) => isDone(t.status)).length,
      all: tickets.length,
    };
  }, [tickets, ruleIndex]);

  const viewCounts: Record<View, number> = {
    open: summary.open,
    done: summary.done,
    all: summary.all,
  };

  const activeFilterCount =
    Object.values(filters).filter(Boolean).length + (category ? 1 : 0) + (search ? 1 : 0);

  function reset() {
    setFilters({ sla: "", assignee: "", status: "", priority: "", department: "" });
    setCategory("");
    setSearch("");
    setView("open");
  }

  return (
    <div className="space-y-4">
      {/* Health strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <QuickFilter
          label="Open"
          value={summary.open}
          active={view === "open" && !activeFilterCount}
          onClick={reset}
        />
        <QuickFilter
          label="Breached"
          value={summary.breached}
          tone="rose"
          active={filters.sla === "breached"}
          onClick={() => setFilters((f) => ({ ...f, sla: f.sla === "breached" ? "" : "breached" }))}
        />
        <QuickFilter
          label="At risk"
          value={summary.atRisk}
          tone="amber"
          active={filters.sla === "at_risk"}
          onClick={() => setFilters((f) => ({ ...f, sla: f.sla === "at_risk" ? "" : "at_risk" }))}
        />
        <QuickFilter
          label="Unassigned"
          value={summary.unassigned}
          tone="violet"
          active={filters.assignee === "unassigned"}
          onClick={() =>
            setFilters((f) => ({
              ...f,
              assignee: f.assignee === "unassigned" ? "" : "unassigned",
            }))
          }
        />
      </div>

      {/* Filter bar */}
      <div className="card flex flex-wrap items-center gap-2 p-2.5">
        <div className="relative min-w-[12rem] flex-1">
          <Icons.search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search number, subject, requester…"
            className="pl-8"
          />
        </div>

        <Select
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
          className="w-auto min-w-[8rem]"
        >
          <option value="">Any status</option>
          {TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_OPTION_LABEL[s] ?? STATUS_META[s].label}
            </option>
          ))}
        </Select>

        <Select
          value={filters.priority}
          onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}
          className="w-auto min-w-[7.5rem]"
        >
          <option value="">Any priority</option>
          {TICKET_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_META[p].label}
            </option>
          ))}
        </Select>

        <Select
          value={filters.department}
          onChange={(e) => setFilters((f) => ({ ...f, department: e.target.value }))}
          className="w-auto min-w-[9rem]"
        >
          <option value="">Any department</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>

        <Select
          value={filters.assignee}
          onChange={(e) => setFilters((f) => ({ ...f, assignee: e.target.value }))}
          className="w-auto min-w-[9rem]"
        >
          <option value="">Any assignee</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.full_name}
            </option>
          ))}
        </Select>

        <Select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-auto min-w-[9rem]"
        >
          <option value="">Any category</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>

        {activeFilterCount > 0 && (
          <Button size="sm" variant="ghost" onClick={reset}>
            Clear
          </Button>
        )}
      </div>

      {/* Lifecycle view + count. Mirrors the tabs on My tickets so "Resolved"
          means the same thing on both sides of the desk. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-[10px] border border-line bg-surface-sunk p-0.5">
            {VIEWS.map((item) => {
              const active = item.key === view && !filters.status;
              return (
                <button
                  key={item.key}
                  onClick={() => {
                    setView(item.key);
                    setFilters((f) => ({ ...f, status: "" }));
                  }}
                  className={cn(
                    "relative rounded-[7px] px-3 py-1.5 text-[0.8125rem] font-medium transition-colors",
                    active ? "text-ink" : "text-ink-faint hover:text-ink-muted",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="queue-view"
                      transition={{ type: "spring", stiffness: 480, damping: 36 }}
                      className="absolute inset-0 -z-10 rounded-[7px] border border-line bg-surface shadow-[var(--shadow-sm)]"
                    />
                  )}
                  {item.label}
                  <span className="tabular ml-1.5 text-ink-faint">{viewCounts[item.key]}</span>
                </button>
              );
            })}
          </div>
          <p className="tabular text-[0.8125rem] text-ink-muted">
            {visible.length} shown
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-[9px] border border-line bg-surface-sunk p-0.5">
            {SORTS.map((item) => {
              const active = item.key === sort;
              return (
                <button
                  key={item.key}
                  onClick={() => setSort(item.key)}
                  className={cn(
                    "relative rounded-[6px] px-2.5 py-1 text-[0.75rem] font-medium transition-colors",
                    active ? "text-ink" : "text-ink-faint hover:text-ink-muted",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="queue-sort"
                      transition={{ type: "spring", stiffness: 480, damping: 36 }}
                      className="absolute inset-0 -z-10 rounded-[6px] border border-line bg-surface"
                    />
                  )}
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        {visible.length === 0 ? (
          <EmptyState
            icon={<Icons.check />}
            title={
              activeFilterCount
                ? "Nothing matches those filters"
                : view === "done"
                  ? "Nothing finished yet"
                  : "Queue is clear"
            }
            description={
              activeFilterCount
                ? "Try widening the filters or clearing them."
                : view === "done"
                  ? "Tickets appear here once an agent resolves them, and stay after the requester confirms."
                  : "Every ticket is resolved or closed. Switch to Resolved to see them."
            }
            action={
              activeFilterCount ? (
                <Button size="sm" variant="secondary" onClick={reset}>
                  Clear filters
                </Button>
              ) : undefined
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
                  showRequester
                />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  );
}

function QuickFilter({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone?: "rose" | "amber" | "violet";
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      data-tone={tone}
      className={cn(
        "card px-3 py-2.5 text-left transition-colors",
        active ? "border-accent-line bg-accent-soft" : "hover:bg-surface-hover",
      )}
    >
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </p>
      <p
        className="tabular mt-0.5 text-lg font-semibold tracking-tight text-ink"
        style={tone && value > 0 ? { color: "var(--tone-fg)" } : undefined}
      >
        {value}
      </p>
    </button>
  );
}
