"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { Icons } from "@/components/shell/icons";
import { PriorityPill, StatusPill } from "./pills";
import { SlaDial } from "./sla-instrument";
import {
  TicketTimeline,
  type CommentWithAuthor,
  type EventWithActor,
} from "./timeline";
import { api, ApiClientError } from "@/lib/api";
import { AGENT_NEXT_STATUS, PRIORITY_META, STATUS_META } from "@/lib/constants";
import { indexRules } from "@/lib/sla";
import { absoluteTime, relativeTime } from "@/lib/format";
import { TICKET_PRIORITIES, type SlaRule, type TicketPriority, type TicketStatus } from "@/lib/database.types";
import { cn } from "@/lib/utils";
import type { TicketRowData } from "./ticket-row";

type Agent = { id: string; full_name: string; role: string };

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

  const [message, setMessage] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const ruleIndex = useMemo(() => indexRules(rules), [rules]);
  const names = useMemo(() => {
    const map = new Map<string, string>();
    agents.forEach((a) => map.set(a.id, a.full_name));
    if (ticket.assignee) map.set(ticket.assignee.id, ticket.assignee.full_name);
    if (ticket.creator) map.set(ticket.creator.id, ticket.creator.full_name);
    return map;
  }, [agents, ticket.assignee, ticket.creator]);

  async function mutate(label: string, patch: Record<string, unknown>) {
    setBusy(label);
    try {
      await api(`/api/tickets/${ticket.id}`, { method: "PATCH", json: patch });
      router.refresh();
    } catch (error) {
      push({
        tone: "error",
        title: "Update failed",
        description: error instanceof ApiClientError ? error.message : "Please try again.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function postComment(event: React.FormEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    setBusy("comment");
    try {
      await api(`/api/tickets/${ticket.id}/comments`, {
        method: "POST",
        json: { message, is_internal: internal },
      });
      setMessage("");
      setInternal(false);
      router.refresh();
    } catch (error) {
      push({
        tone: "error",
        title: "Could not post that",
        description: error instanceof ApiClientError ? error.message : "Please try again.",
      });
    } finally {
      setBusy(null);
    }
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
              <p className="whitespace-pre-wrap text-[0.875rem] leading-relaxed text-ink-muted">
                {ticket.description}
              </p>
              <p className="mt-4 border-t border-line pt-3 text-[0.75rem] text-ink-faint">
                Raised by {ticket.creator?.full_name ?? "—"} ·{" "}
                <span title={absoluteTime(ticket.created_at)}>
                  {relativeTime(ticket.created_at)}
                </span>
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
                    onClick={() => mutate("closed", { status: "closed" })}
                  >
                    Yes, close it
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Icons.refresh />}
                    loading={busy === "reopened"}
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
                  <Link
                    href="/tickets/new"
                    className="inline-flex h-8 flex-none items-center gap-1.5 rounded-[9px] border border-line-strong bg-surface px-3 text-[0.8125rem] font-medium text-ink transition-colors hover:bg-surface-hover"
                  >
                    <Icons.plus className="size-3.5" />
                    New ticket
                  </Link>
                )}
              </div>
            ) : (
            <form onSubmit={postComment} className="card space-y-3 p-4">
              <Textarea
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={
                  internal
                    ? "Internal note — the requester will not see this…"
                    : "Add a reply…"
                }
                className={cn(
                  internal &&
                    "border-[rgb(245_158_11_/_0.4)] bg-[rgb(245_158_11_/_0.05)]",
                )}
              />
              <div className="flex items-center justify-between gap-3">
                {viewer.isAgent ? (
                  <label className="flex cursor-pointer items-center gap-2 text-[0.8125rem] text-ink-muted">
                    <input
                      type="checkbox"
                      checked={internal}
                      onChange={(e) => setInternal(e.target.checked)}
                      className="size-3.5 accent-[var(--accent)]"
                    />
                    Internal note
                  </label>
                ) : (
                  <span />
                )}
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  loading={busy === "comment"}
                  disabled={!message.trim()}
                >
                  {internal ? "Save note" : "Reply"}
                </Button>
              </div>
            </form>
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
                  <span title={absoluteTime(ticket.created_at)}>
                    {relativeTime(ticket.created_at)}
                  </span>
                </Row>
                {ticket.first_response_at && (
                  <Row label="First reply">
                    <span title={absoluteTime(ticket.first_response_at)}>
                      {relativeTime(ticket.first_response_at)}
                    </span>
                  </Row>
                )}
                {ticket.resolved_at && (
                  <Row label="Resolved">
                    <span title={absoluteTime(ticket.resolved_at)}>
                      {relativeTime(ticket.resolved_at)}
                    </span>
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
