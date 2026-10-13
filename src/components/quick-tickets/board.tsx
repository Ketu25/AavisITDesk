"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Highlight } from "@/components/ui/highlight";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/states";
import { Icons } from "@/components/shell/icons";
import { NewTicketButton } from "@/components/tickets/new-ticket";
import { PRIORITY_META } from "@/lib/constants";
import { spring, stagger } from "@/lib/motion";
import { SEARCH_MAX_LENGTH, fold, matchesAllTerms, parseSearchTerms } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { QuickGroup } from "@/lib/quick-tickets";
import { useQuickTicket, type OpenTicket } from "./context";
import { QuickIcon } from "./icon";

/** Past this many quick tickets, the page grows a filter box — the same point the category picker does. */
const FILTER_THRESHOLD = 8;

const countIssues = (groups: QuickGroup[]) =>
  groups.reduce((sum, group) => sum + group.issues.length, 0);

const SECONDARY_ACTION =
  "inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-line-strong bg-surface px-3 " +
  "text-[0.8125rem] font-medium text-ink transition-colors hover:bg-surface-hover";

/**
 * The Quick tickets page: the common problems IT has already written up,
 * grouped the way people think about them. Each row opens the confirm dialog —
 * nothing is sent from here — and carries the number of a ticket the viewer
 * already has open for it, so a second report of the same jam is a decision
 * rather than an accident.
 */
export function QuickTicketsBoard({
  groups,
  openByIssue,
  isAdmin,
  failed,
}: {
  groups: QuickGroup[];
  /** The viewer's newest unfinished ticket per quick ticket. */
  openByIssue: Record<string, OpenTicket>;
  isAdmin: boolean;
  /** The list could not be read; say so rather than claim there is nothing. */
  failed: boolean;
}) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [refreshing, startRefresh] = useTransition();
  const { open, pendingId } = useQuickTicket();
  const filterRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState("");

  const terms = useMemo(() => parseSearchTerms(filter), [filter]);
  const showFilter = countIssues(groups) > FILTER_THRESHOLD;

  // An issue matches when every word is somewhere in it or its group, so
  // "printer jam" finds Paper jam under Printer.
  const visible = useMemo(() => {
    if (terms.length === 0) return groups;
    return groups
      .map((group) => ({
        ...group,
        issues: group.issues.filter((issue) =>
          matchesAllTerms(
            fold(
              `${group.name} ${group.description ?? ""} ${issue.label} ${issue.subject} ${issue.category}`,
            ),
            terms,
          ),
        ),
      }))
      .filter((group) => group.issues.length > 0);
  }, [groups, terms]);

  if (failed) {
    return (
      <div className="card flex flex-col items-center gap-3 px-4 py-10 text-center">
        <Icons.alert className="size-5 text-ink-faint" />
        <div>
          <p className="text-[0.875rem] font-medium text-ink">Couldn&apos;t load the quick tickets</p>
          <p className="mt-1 text-[0.8125rem] text-ink-muted">
            Check your connection, then try again — or raise a ticket the usual way.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            loading={refreshing}
            icon={<Icons.refresh className="size-3.5" />}
            onClick={() => startRefresh(() => router.refresh())}
          >
            Try again
          </Button>
          <NewTicketButton className={SECONDARY_ACTION}>
            <Icons.plus className="size-3.5" />
            New ticket
          </NewTicketButton>
        </div>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="card overflow-hidden">
        <EmptyState
          icon={<Icons.bolt />}
          title="No quick tickets yet"
          description={
            isAdmin
              ? "Write up the problems people report most — a paper jam, a missing drive — and they appear here, ready to send."
              : "IT hasn't written any up yet. For anything that's wrong, raise a ticket — it only takes a minute."
          }
          action={
            isAdmin ? (
              <Link href="/admin/quick-tickets" className={SECONDARY_ACTION}>
                <Icons.wrench className="size-3.5" />
                Set up quick tickets
              </Link>
            ) : (
              <NewTicketButton className={SECONDARY_ACTION}>
                <Icons.plus className="size-3.5" />
                New ticket
              </NewTicketButton>
            )
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showFilter && (
        <div className="relative max-w-md">
          <Icons.search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint" />
          <Input
            ref={filterRef}
            type="text"
            role="searchbox"
            aria-label="Filter quick tickets"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && filter && !event.nativeEvent.isComposing) {
                event.stopPropagation();
                setFilter("");
              }
            }}
            maxLength={SEARCH_MAX_LENGTH}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            placeholder="Filter — try “toner” or “drive”"
            className="pl-8 pr-9"
          />
          {filter && (
            <button
              type="button"
              onClick={() => {
                setFilter("");
                filterRef.current?.focus();
              }}
              aria-label="Clear filter"
              // Not `tap-safe`: it sets `position: relative`, which would
              // override `absolute` and drop this into the flow.
              className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
            >
              <Icons.close className="size-3.5" />
            </button>
          )}
        </div>
      )}

      <p aria-live="polite" className="sr-only">
        {terms.length > 0
          ? countIssues(visible) === 1
            ? "1 quick ticket matches."
            : `${countIssues(visible)} quick tickets match.`
          : ""}
      </p>

      {visible.length === 0 ? (
        <div className="card px-4 py-8 text-center">
          <p className="text-[0.8125rem] font-medium text-ink">Nothing matches &ldquo;{filter.trim()}&rdquo;</p>
          <p className="mt-1 text-xs text-ink-faint">
            Try another word,{" "}
            <button
              type="button"
              onClick={() => {
                setFilter("");
                filterRef.current?.focus();
              }}
              className="font-medium text-accent underline-offset-4 hover:underline"
            >
              show every quick ticket
            </button>
            , or{" "}
            <NewTicketButton className="font-medium text-accent underline-offset-4 hover:underline">
              raise a ticket
            </NewTicketButton>
            .
          </p>
        </div>
      ) : (
        // Sized by the room the board actually gets, not the window: the
        // sidebar takes a different share at every breakpoint.
        <div className="@container">
          <ul className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
            {visible.map((group, index) => (
              <motion.li
                key={group.id}
                initial={reduced ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...spring.gentle, delay: reduced ? 0 : stagger(index, 0.04, 8) }}
                aria-labelledby={`quick-group-${group.id}`}
                className="card flex min-w-0 flex-col p-2"
              >
                <div className="flex items-center gap-2.5 px-2 pb-2 pt-1.5">
                  <span className="flex size-8 flex-none items-center justify-center rounded-[9px] border border-line bg-surface text-ink-muted">
                    <QuickIcon name={group.icon} className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <h2
                      id={`quick-group-${group.id}`}
                      className="truncate text-[0.875rem] font-semibold tracking-tight text-ink"
                    >
                      <Highlight text={group.name} terms={terms} />
                    </h2>
                    {group.description && (
                      <p className="truncate text-[0.6875rem] text-ink-faint">{group.description}</p>
                    )}
                  </div>
                </div>

                <ul className="space-y-px border-t border-line pt-1.5">
                  {group.issues.map((issue) => {
                    const existing = openByIssue[issue.id] ?? null;
                    const sending = pendingId === issue.id;
                    const raised = issue.startsAt === "urgent" || issue.startsAt === "high";
                    return (
                      <li key={issue.id}>
                        <button
                          type="button"
                          aria-haspopup="dialog"
                          aria-label={
                            `${issue.label}, ${group.name}` +
                            (existing ? `. You already reported this as ${existing.ticket_number}.` : "")
                          }
                          aria-busy={sending || undefined}
                          onClick={(event) =>
                            open(issue, { trigger: event.currentTarget, knownOpen: existing })
                          }
                          className={cn(
                            "group flex min-h-11 w-full items-center gap-2 rounded-[9px] px-2 text-left lg:min-h-9",
                            "text-[0.8125rem] text-ink transition-colors duration-150 hover:bg-surface-hover",
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            <Highlight text={issue.label} terms={terms} />
                          </span>
                          {raised && (
                            <span
                              aria-hidden
                              data-tone={PRIORITY_META[issue.startsAt].tone}
                              title={`Starts ${PRIORITY_META[issue.startsAt].label.toLowerCase()}`}
                              className="tone-dot flex-none"
                            />
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
                                "size-3.5 flex-none text-ink-faint transition-[opacity,transform] duration-150",
                                "opacity-40 group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-visible:opacity-100",
                              )}
                            />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </motion.li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
