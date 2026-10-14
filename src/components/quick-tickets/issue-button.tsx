"use client";

import { Highlight } from "@/components/ui/highlight";
import { Spinner } from "@/components/ui/spinner";
import { Icons } from "@/components/shell/icons";
import { PRIORITY_META } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { QuickIssue } from "@/lib/quick-tickets";
import { useQuickTicket, type OpenTicket } from "./context";

/**
 * One quick ticket, wherever the page lists it — a group's panel, or the
 * filter's results. It only opens the confirm dialog; nothing is sent from
 * here. It carries the number of a ticket the viewer already has open for it,
 * so a second report of the same jam is a decision rather than an accident.
 */
export function IssueButton({
  issue,
  existing,
  terms,
}: {
  issue: QuickIssue;
  /** The viewer's newest unfinished ticket raised from this quick ticket. */
  existing: OpenTicket | null;
  /** Filter terms to mark in the label. */
  terms: string[];
}) {
  const { open, pendingId } = useQuickTicket();
  const sending = pendingId === issue.id;
  const raised = issue.startsAt === "urgent" || issue.startsAt === "high";
  const priority = PRIORITY_META[issue.startsAt];

  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={
        [
          `${issue.label}, ${issue.group.name}`,
          raised && `Starts ${priority.label.toLowerCase()}`,
          existing && `You already reported this as ${existing.ticket_number}`,
        ]
          .filter(Boolean)
          .join(". ") + "."
      }
      aria-busy={sending || undefined}
      onClick={(event) => open(issue, { trigger: event.currentTarget, knownOpen: existing })}
      className={cn(
        // Named, because the group cards around it are a `group` too.
        "group/issue flex min-h-11 w-full items-center gap-2 rounded-[9px] px-2.5 text-left lg:min-h-9",
        "text-[0.8125rem] text-ink transition-colors duration-150 hover:bg-surface-hover",
      )}
    >
      <span className="min-w-0 flex-1 truncate">
        <Highlight text={issue.label} terms={terms} />
      </span>
      {raised && (
        <span
          aria-hidden
          data-tone={priority.tone}
          title={`Starts ${priority.label.toLowerCase()}`}
          className="inline-flex flex-none items-center gap-1 text-[0.6875rem] text-ink-faint"
        >
          <span className="tone-dot" />
          {priority.label}
        </span>
      )}
      {existing && (
        <span
          aria-hidden
          title="You reported this and it's still open"
          className="readout flex-none rounded border border-line bg-surface-sunk px-1.5 text-[0.625rem] leading-4 text-ink-faint"
        >
          {existing.ticket_number}
        </span>
      )}
      {sending ? (
        <Spinner className="size-3.5 flex-none text-ink-faint" />
      ) : (
        <Icons.arrowRight
          className={cn(
            "size-3.5 flex-none text-ink-faint transition-[opacity,translate] duration-150",
            "opacity-40 group-hover/issue:translate-x-0.5 group-hover/issue:opacity-100 group-focus-visible/issue:opacity-100",
          )}
        />
      )}
    </button>
  );
}
