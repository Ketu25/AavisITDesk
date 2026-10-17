"use client";

import { Highlight } from "@/components/ui/highlight";
import { Spinner } from "@/components/ui/spinner";
import { Icons } from "@/components/shell/icons";
import { PRIORITY_META } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { QuickIssue } from "@/lib/quick-tickets";
import { useQuickTicket, type OpenTicket } from "./context";

/**
 * One quick ticket on a launchpad tile. It only opens the confirm dialog;
 * nothing is sent from here. It carries the number of a ticket the viewer
 * already has open for it, so a second report of the same jam is a decision
 * rather than an accident, and stays lit while its dialog is open so the
 * dialog visibly belongs to it.
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
  const { open, pendingId, activeId } = useQuickTicket();
  const sending = pendingId === issue.id;
  const active = activeId === issue.id;
  const raised = issue.startsAt === "urgent" || issue.startsAt === "high";
  const priority = PRIORITY_META[issue.startsAt];

  return (
    <button
      type="button"
      data-nav-item=""
      data-active={active || undefined}
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
        // Named, because the tile around it is a `group` too.
        "group/issue relative flex min-h-11 w-full scroll-my-24 items-center gap-2 rounded-[10px] py-1.5 pl-3 pr-2.5 text-left lg:min-h-10",
        "text-[0.8125rem] text-ink transition-[background-color,scale] duration-150 ease-[var(--ease-standard)]",
        "hover:bg-surface-hover active:scale-[0.985] data-[active]:bg-accent-soft",
        // Drawn inside the row: the row can sit in a list that is clipping
        // its height while it unfolds, and an outside ring would be cut off.
        "focus-visible:-outline-offset-2",
      )}
    >
      {/* A pip that grows in beside the row under the pointer, and stays on
          the one whose dialog is open. */}
      <span
        aria-hidden
        className={cn(
          "absolute left-1 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-accent",
          "scale-y-0 opacity-0 transition-[scale,opacity] duration-200 ease-[var(--ease-entrance)]",
          "group-hover/issue:scale-y-100 group-hover/issue:opacity-100",
          "group-focus-visible/issue:scale-y-100 group-focus-visible/issue:opacity-100",
          "group-data-[active]/issue:scale-y-100 group-data-[active]/issue:opacity-100",
        )}
      />
      <span className="line-clamp-2 min-w-0 flex-1 break-words leading-snug">
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
            "size-3.5 flex-none text-ink-faint transition-[opacity,translate,color] duration-200 ease-[var(--ease-entrance)]",
            "opacity-40 group-hover/issue:translate-x-0.5 group-hover/issue:text-accent group-hover/issue:opacity-100",
            "group-focus-visible/issue:opacity-100 group-data-[active]/issue:text-accent group-data-[active]/issue:opacity-100",
          )}
        />
      )}
    </button>
  );
}
