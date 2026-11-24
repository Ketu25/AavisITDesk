"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Celebration } from "@/components/ui/celebration";
import { useToast } from "@/components/ui/toast";
import { TimeAgo } from "@/components/ui/time-ago";
import { LinkifiedText } from "@/components/ui/linkified-text";
import { Icons } from "@/components/shell/icons";
import { PriorityPill, StatusPill } from "./pills";
import { NewTicketButton } from "./new-ticket";
import { SlaDial } from "./sla-instrument";
import { ComposerPlaceholder } from "./composer/placeholder";
import {
  TicketTimeline,
  type CommentWithAuthor,
  type EventWithActor,
} from "./timeline";
import { api, ApiClientError } from "@/lib/api";
import { AGENT_NEXT_STATUS, PRIORITY_META, STATUS_META } from "@/lib/constants";
import { indexRules } from "@/lib/sla";
import { TICKET_PRIORITIES, type SlaRule, type TicketPriority, type TicketStatus } from "@/lib/database.types";
import type { TicketRowData } from "./ticket-row";

type Agent = { id: string; full_name: string; role: string };

// Browser-only: see ComposerPlaceholder for why.
const ReplyComposer = dynamic(
  () => import("./composer/reply-composer").then((m) => m.ReplyComposer),
  { ssr: false, loading: () => <ComposerPlaceholder /> },
);

export function TicketDetail({
  ticket,
  comments,
  events,
  rules,
  agents,
  viewer,
}: {
  ticket: TicketRowData;
  comments: CommentWithAuthor[];
  events: EventWithActor[];
  rules: SlaRule[];
  agents: Agent[];
  viewer: { id: string; isAgent: boolean; isOwner: boolean };
}) {
  const router = useRouter();
  const { push } = useToast();

  const [busy, setBusy] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState(false);

  // The burst is a moment, not a state: it clears itself.
  useEffect(() => {
    if (!celebrating) return;
    const timer = setTimeout(() => setCelebrating(false), 1600);
    return () => clearTimeout(timer);
  }, [celebrating]);

  const ruleIndex = useMemo(() => indexRules(rules), [rules]);
  const names = useMemo(() => {
    const map = new Map<string, string>();
    agents.forEach((a) => map.set(a.id, a.full_name));
    if (ticket.assignee) map.set(ticket.assignee.id, ticket.assignee.full_name);
    if (ticket.creator) map.set(ticket.creator.id, ticket.creator.full_name);
    return map;
  }, [agents, ticket.assignee, ticket.creator]);

  /** True when the change went through. */
  async function mutate(label: string, patch: Record<string, unknown>) {
    setBusy(label);
    try {
      await api(`/api/tickets/${ticket.id}`, { method: "PATCH", json: patch });
      router.refresh();
      return true;
    } catch (error) {
      push({
        tone: "error",
        title: "Update failed",
        description: error instanceof ApiClientError ? error.message : "Please try again.",
      });
      return false;
    } finally {
      setBusy(null);
    }
  }

  /** The requester saying the fix worked — the happy ending, so it gets one. */
  async function confirmFixed() {
    if (!(await mutate("closed", { status: "closed" }))) return;
    setCelebrating(true);
    push({
      tone: "success",
      title: "Ticket closed",
      description: "Thanks for confirming the fix.",
    });
  }

  async function autoAssign() {
    setBusy("auto");
    try {
      await api(`/api/tickets/${ticket.id}/auto-assign`, { method: "POST" });
      push({ tone: "success", title: "Assigned automatically" });
      router.refresh();
    } catch (error) {
      push({
        tone: "error",
        title: "Auto-assign failed",
        description: error instanceof ApiClientError ? error.message : "Please try again.",
      });
    } finally {
      setBusy(null);
    }
  }

  const nextStatuses = AGENT_NEXT_STATUS[ticket.status] ?? [];
  const canRequesterAct = viewer.isOwner && ticket.status === "resolved";

  // Closed is terminal: the conversation is over for everyone. RLS and the API
  // enforce it too — this just stops the UI offering something that would fail.
  const isLocked = ticket.status === "closed";

  return (
    <>
      <PageHeader
        title={ticket.subject}
        description={`${ticket.ticket_number} · ${ticket.category}`}
        actions={
          <Link
            href={viewer.isAgent ? "/queue" : "/tickets"}
            className="inline-flex h-8 items-center rounded-[9px] border border-line px-3 text-[0.8125rem] text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
          >
            Back
          </Link>
        }
      />

      <PageBody>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          {/* ------------------------------------------------ main column */}
          <div className="min-w-0 space-y-5">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="card p-5"
            >
              <div className="flex flex-wrap items-center gap-1.5 pb-3">
                <StatusPill status={ticket.status} />
                <PriorityPill priority={ticket.priority} />
                {ticket.reopen_count > 0 && (
                  <Badge tone="rose" dot={false}>
                    Reopened ×{ticket.reopen_count}
                  </Badge>
                )}
              </div>
              <LinkifiedText
                text={ticket.description}
                className="text-[0.875rem] leading-relaxed text-ink-muted"
              />
              <p className="mt-4 border-t border-line pt-3 text-[0.75rem] text-ink-faint">
                Raised by {ticket.creator?.full_name ?? "—"} ·{" "}
                <TimeAgo value={ticket.created_at} />
              </p>
            </motion.div>

            {canRequesterAct && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="card border-[rgb(16_185_129_/_0.3)] bg-[rgb(16_185_129_/_0.05)] p-4"
              >
                <p className="text-[0.875rem] font-medium text-ink">
                  IT marked this resolved — did it fix the problem?
                </p>
                <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-muted">
                  Confirming closes the ticket. Reopening puts it back in the queue with a fresh
                  SLA clock.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Icons.check />}
                    loading={busy === "closed"}
                    disabled={busy !== null}
                    onClick={confirmFixed}
                  >
                    Yes, close it
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Icons.refresh />}
                    loading={busy === "reopened"}
                    disabled={busy !== null}
                    onClick={() => mutate("reopened", { status: "reopened" })}
                  >
                    No, reopen
                  </Button>
                </div>
              </motion.div>
            )}

            <div>
              <h2 className="eyebrow mb-3">Activity</h2>
              <TicketTimeline
                comments={comments}
                events={events}
                viewerId={viewer.id}
                names={names}
              />
            </div>

            {isLocked ? (
              <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-[0.875rem] font-medium text-ink">
                    This ticket is closed
                  </p>
                  <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-ink-muted text-pretty">
                    {viewer.isAgent
                      ? "Move it back to In progress to add anything further — that keeps the history in order."
                      : "The conversation is finished. If you still need help, raise a new ticket."}
                  </p>
                </div>
                {viewer.isAgent ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Icons.refresh />}
                    loading={busy === "in_progress"}
                    onClick={() => mutate("in_progress", { status: "in_progress" })}
                  >
                    Reopen work
                  </Button>
                ) : (
                  <NewTicketButton
                    className="inline-flex h-8 flex-none items-center gap-1.5 rounded-[9px] border border-line-strong bg-surface px-3 text-[0.8125rem] font-medium text-ink transition-colors hover:bg-surface-hover"
                  >
                    <Icons.plus className="size-3.5" />
                    New ticket
                  </NewTicketButton>
                )}
              </div>
            ) : (
              <ReplyComposer ticketId={ticket.id} isAgent={viewer.isAgent} />
            )}
          </div>

          {/* ---------------------------------------------------- sidebar */}
          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <div className="card space-y-3.5 p-4">
              <SlaDial ticket={ticket} rules={ruleIndex} className="pt-1" />

              <dl className="space-y-3 border-t border-line pt-3.5 text-[0.8125rem]">
                <Row label="Requester">
                  {ticket.creator ? (
                    <span className="flex items-center gap-1.5">
                      <Avatar name={ticket.creator.full_name} id={ticket.creator.id} size="xs" />
                      <span className="truncate">{ticket.creator.full_name}</span>
                    </span>
                  ) : (
                    "—"
                  )}
                </Row>
                <Row label="Department">{ticket.department?.name ?? "—"}</Row>
                <Row label="Category">{ticket.category}</Row>
                {ticket.quick_ticket_id && (
                  <Row label="Raised with">
                    {ticket.quick ? (
                      <span className="block break-words">
                        {ticket.quick.group ? `${ticket.quick.group.name} › ` : ""}
                        {ticket.quick.label}
                      </span>
                    ) : (
                      "Quick ticket"
                    )}
                  </Row>
                )}
                <Row label="Assignee">
                  {ticket.assignee ? (
                    <span className="flex items-center gap-1.5">
                      <Avatar name={ticket.assignee.full_name} id={ticket.assignee.id} size="xs" />
                      <span className="truncate">{ticket.assignee.full_name}</span>
                    </span>
                  ) : (
                    <span className="text-ink-faint">Unassigned</span>
                  )}
                </Row>
                <Row label="Opened">
                  <TimeAgo value={ticket.created_at} />
                </Row>
                {ticket.first_response_at && (
                  <Row label="First reply">
                    <TimeAgo value={ticket.first_response_at} />
                  </Row>
                )}
                {ticket.resolved_at && (
                  <Row label="Resolved">
                    <TimeAgo value={ticket.resolved_at} />
                  </Row>
                )}
              </dl>
            </div>

            {viewer.isAgent && (
              <div className="card space-y-4 p-4">
                <p className="eyebrow">Agent controls</p>

                {nextStatuses.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-[0.75rem] text-ink-muted">Move to</span>
                    <div className="flex flex-wrap gap-1.5">
                      {nextStatuses.map((status) => (
                        <Button
                          key={status}
                          size="sm"
                          variant="secondary"
                          loading={busy === status}
                          onClick={() => mutate(status, { status })}
                        >
                          {STATUS_META[status as TicketStatus].label}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                <Field label="Assignee" htmlFor="assignee">
                  <Select
                    id="assignee"
                    value={ticket.assigned_to ?? ""}
                    disabled={busy === "assign"}
                    onChange={(e) =>
                      mutate("assign", { assigned_to: e.target.value || null })
                    }
                  >
                    <option value="">Unassigned</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.full_name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Button
                  variant="subtle"
                  size="sm"
                  className="w-full"
                  loading={busy === "auto"}
                  onClick={autoAssign}
                >
                  Auto-assign
                </Button>

                <Field label="Priority" htmlFor="priority">
                  <Select
                    id="priority"
                    value={ticket.priority}
                    disabled={busy === "priority"}
                    onChange={(e) =>
                      mutate("priority", { priority: e.target.value as TicketPriority })
                    }
                  >
                    {TICKET_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_META[p].label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
          </aside>
        </div>
      </PageBody>

      <Celebration show={celebrating} />
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="flex-none text-ink-faint">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-ink">{children}</dd>
    </div>
  );
}
