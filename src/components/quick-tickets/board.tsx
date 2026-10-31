"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Highlight } from "@/components/ui/highlight";
import { EmptyState } from "@/components/ui/states";
import { Icons } from "@/components/shell/icons";
import { NewTicketButton } from "@/components/tickets/new-ticket";
import { ease, spring, stagger } from "@/lib/motion";
import { SEARCH_MAX_LENGTH, fold, matchesAllTerms, parseSearchTerms } from "@/lib/search";
import { LABEL_PARAM, cleanLocation } from "@/lib/qr-labels";
import type { QuickGroup } from "@/lib/quick-tickets";
import type { OpenTicket } from "./context";
import { GroupGrid } from "./group-grid";
import { IssueButton } from "./issue-button";
import { QuickIcon } from "./icon";
import { OpenReports, iconsByIssue, type OpenReport } from "./open-reports";

/** Past this many quick tickets, the page grows a filter box — the same point the category picker does. */
const FILTER_THRESHOLD = 8;

/** The address parameter naming the open group, so a refresh, Back, or a shared link opens it again. */
const GROUP_PARAM = "group";

const countIssues = (groups: QuickGroup[]) =>
  groups.reduce((sum, group) => sum + group.issues.length, 0);

/**
 * Names the open group in the address, or none. Replace, not push: opening a
 * card is not a page, and Back should leave the Quick tickets page rather
 * than step through every card tried.
 */
function writeAddress(groupId: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (groupId) params.set(GROUP_PARAM, groupId);
  else params.delete(GROUP_PARAM);
  // A label speaks for the group it opened, and only while that stays open:
  // once it closes, nothing is pre-filled from it again.
  params.delete(LABEL_PARAM);
  const query = params.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
  );
}

const SECONDARY_ACTION =
  "inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-line-strong bg-surface px-3 " +
  "text-[0.8125rem] font-medium text-ink transition-colors hover:bg-surface-hover";

/**
 * The Quick tickets page: what the viewer already reported and is waiting on,
 * then the common problems IT has written up, grouped the way people think
 * about them.
 *
 * Each group is a card of the same size however many quick tickets it holds;
 * opening one lists them in a panel under its row, and each of those opens
 * the confirm dialog — nothing is sent from here. Typing in the filter skips
 * the cards and goes straight to the quick tickets that match, since anyone
 * typing already knows what they are looking for.
 */
export function QuickTicketsBoard({
  groups,
  reports,
  viewerId,
  isAdmin,
  failed,
}: {
  groups: QuickGroup[];
  /** The viewer's unfinished tickets raised from quick tickets, newest first. */
  reports: OpenReport[];
  viewerId: string;
  isAdmin: boolean;
  /** The list could not be read; say so rather than claim there is nothing. */
  failed: boolean;
}) {
  const router = useRouter();
  const reduced = useReducedMotion() ?? false;
  const [refreshing, startRefresh] = useTransition();
  const filterRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState("");

  const terms = useMemo(() => parseSearchTerms(filter), [filter]);

  // Newest first from the server, so the first seen per quick ticket is the
  // one to point at.
  const openByIssue = useMemo(() => {
    const byIssue: Record<string, OpenTicket> = {};
    for (const report of reports) {
      byIssue[report.quick_ticket_id] ??= { id: report.id, ticket_number: report.ticket_number };
    }
    return byIssue;
  }, [reports]);
  const iconByIssue = useMemo(() => iconsByIssue(groups), [groups]);
  const showFilter = countIssues(groups) > FILTER_THRESHOLD;
  // Only while the box is there to clear it: a refresh can take it away with
  // words still in it, and a filter nobody can see must not hide anything.
  const searching = showFilter && terms.length > 0;

  // The address is the one record of which group is open — kept current with
  // replaceState, which Next folds into useSearchParams without a server
  // round trip. A group that is not on the page counts as none.
  const searchParams = useSearchParams();
  const requested = searchParams.get(GROUP_PARAM);
  const selectedId = requested && groups.some((group) => group.id === requested) ? requested : null;
  // Arrived by scanning a QR label: where the label is stuck, if it says,
  // for the group it opened. Checked again here — it came from an address.
  const labelParam = searchParams.get(LABEL_PARAM);
  const labelLocation = labelParam ? cleanLocation(labelParam) : "";

  // A scanned label whose group is no longer offered — switched off, or
  // deleted since it was printed. Decided once, on arrival: the address is
  // tidied up straight after, and the notice has to outlive that.
  const [missedLabel, setMissedLabel] = useState(
    () => labelParam !== null && !failed && selectedId === null,
  );

  const select = useCallback((groupId: string | null) => {
    // Opening a group is moving on from a label that pointed nowhere.
    if (groupId) setMissedLabel(false);
    writeAddress(groupId);
  }, []);

  // A link to a group IT has since switched off, or one that went while it
  // was open: drop it from the address so it cannot spring open later — and
  // a label along with it. Not when the list failed to load — then nothing
  // can be said about it.
  useEffect(() => {
    if (!failed && (requested || labelParam !== null) && !selectedId) writeAddress(null);
  }, [failed, requested, labelParam, selectedId]);

  // An issue matches when every word is somewhere in it or its group, so
  // "printer jam" finds Paper jam under Printer.
  const visible = useMemo(() => {
    if (!searching) return groups;
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
  }, [groups, terms, searching]);

  const clearFilter = () => {
    setFilter("");
    filterRef.current?.focus();
  };

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

  const labelNotice = missedLabel ? <MissedLabel onDismiss={() => setMissedLabel(false)} /> : null;

  if (groups.length === 0) {
    return (
      <div className="space-y-7">
        {labelNotice}
        <OpenReports reports={reports} iconByIssue={iconByIssue} viewerId={viewerId} />
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
      </div>
    );
  }

  const view = { duration: 0.2, ease: ease.entrance };

  return (
    <div ref={boardRef} className="space-y-7">
      {labelNotice}
      <OpenReports reports={reports} iconByIssue={iconByIssue} viewerId={viewerId} />

      <section aria-labelledby="quick-problems" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 id="quick-problems" className="eyebrow">
            Common problems
          </h2>
          {showFilter && (
            <div className="relative w-full sm:w-72">
              <Icons.search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint" />
              <Input
                ref={filterRef}
                type="text"
                role="searchbox"
                aria-label="Filter quick tickets"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Escape" && filter) {
                    event.stopPropagation();
                    setFilter("");
                  } else if (event.key === "ArrowDown") {
                    // Down from the box to the first thing it is filtering.
                    const first = boardRef.current?.querySelector<HTMLElement>(
                      '[data-view="results"] button[aria-haspopup="dialog"], [data-view="cards"] [data-card]',
                    );
                    if (first) {
                      event.preventDefault();
                      first.focus();
                    }
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
                  onClick={clearFilter}
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
        </div>

        <p aria-live="polite" className="sr-only">
          {searching
            ? countIssues(visible) === 1
              ? "1 quick ticket matches."
              : `${countIssues(visible)} quick tickets match.`
            : ""}
        </p>

        {/* Sized by the room the board actually gets, not the window: the
            sidebar takes a different share at every breakpoint. */}
        <div className="@container">
          <AnimatePresence mode="wait" initial={false}>
            {searching ? (
              <motion.div
                key="results"
                data-view="results"
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.1, ease: ease.exit } }}
                transition={view}
              >
                {visible.length === 0 ? (
                  <div className="card px-4 py-8 text-center">
                    <p className="text-[0.8125rem] font-medium text-ink">
                      Nothing matches &ldquo;{filter.trim()}&rdquo;
                    </p>
                    <p className="mt-1 text-xs text-ink-faint">
                      Try another word,{" "}
                      <button
                        type="button"
                        onClick={clearFilter}
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
                  <Results groups={visible} openByIssue={openByIssue} terms={terms} reduced={reduced} />
                )}
              </motion.div>
            ) : (
              <motion.div
                key="cards"
                data-view="cards"
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.1, ease: ease.exit } }}
                transition={view}
              >
                <GroupGrid
                  groups={groups}
                  openByIssue={openByIssue}
                  selectedId={selectedId}
                  labelLocation={labelLocation || null}
                  onSelect={select}
                  onTypeAhead={showFilter ? () => filterRef.current?.focus() : undefined}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>
    </div>
  );
}

/**
 * Said instead of opening anything, when the QR label someone just scanned
 * points at a group that is no longer offered — so they are not left
 * wondering why they got every quick ticket rather than the label's.
 */
function MissedLabel({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      role="status"
      data-tone="amber"
      className="flex items-start gap-3 rounded-[14px] border border-[var(--tone-bd)] bg-[var(--tone-bg)] py-3 pl-4 pr-2"
    >
      <Icons.qr className="mt-0.5 size-4 flex-none text-[var(--tone-fg)]" />
      <div className="min-w-0 flex-1">
        <p className="text-[0.8125rem] font-medium text-[var(--tone-fg)]">
          The label you scanned isn&apos;t in use any more
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted text-pretty">
          IT has switched off the quick tickets it pointed to. Pick your problem from what&apos;s
          here, or raise a ticket — and let IT know the label needs replacing.
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="tap-safe -mt-0.5 flex size-7 flex-none items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
      >
        <Icons.close className="size-3.5" />
      </button>
    </div>
  );
}

/** What the filter found: every group with a match, already open, the matching words marked. */
function Results({
  groups,
  openByIssue,
  terms,
  reduced,
}: {
  groups: QuickGroup[];
  openByIssue: Record<string, OpenTicket>;
  terms: string[];
  reduced: boolean;
}) {
  return (
    <ul className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
      {groups.map((group, index) => (
        <motion.li
          key={group.id}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring.gentle, delay: reduced ? 0 : stagger(index, 0.04, 8) }}
          aria-labelledby={`quick-results-${group.id}`}
          className="glyph-host card flex min-w-0 flex-col p-2"
        >
          <div className="flex items-center gap-2.5 px-2 pb-2 pt-1.5">
            <span className="flex size-8 flex-none items-center justify-center rounded-[9px] border border-line bg-surface text-ink-muted">
              <QuickIcon name={group.icon} className="size-4" />
            </span>
            <div className="min-w-0">
              <h3
                id={`quick-results-${group.id}`}
                className="truncate text-[0.875rem] font-semibold tracking-tight text-ink"
              >
                <Highlight text={group.name} terms={terms} />
              </h3>
              {group.description && (
                <p className="truncate text-[0.6875rem] text-ink-faint">
                  <Highlight text={group.description} terms={terms} />
                </p>
              )}
            </div>
          </div>

          <ul className="space-y-px border-t border-line pt-1.5">
            {group.issues.map((issue) => (
              <li key={issue.id}>
                <IssueButton issue={issue} existing={openByIssue[issue.id] ?? null} terms={terms} />
              </li>
            ))}
          </ul>
        </motion.li>
      ))}
    </ul>
  );
}
