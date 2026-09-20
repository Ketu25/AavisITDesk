"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { TicketRow, type TicketRowData } from "./ticket-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/states";
import { Icons } from "@/components/shell/icons";
import { OPEN_STATUSES } from "@/lib/constants";
import { ticketSearchText } from "@/lib/queries";
import {
  SEARCH_MAX_LENGTH,
  matchesAllTerms,
  normalizeQuery,
  parseSearchTerms,
} from "@/lib/search";
import { indexRules } from "@/lib/sla";
import { transition } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { SlaRule } from "@/lib/database.types";

type Filter = "open" | "resolved" | "all";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "All" },
];

const isDone = (status: string) => status === "resolved" || status === "closed";

const inFilter = (ticket: TicketRowData, filter: Filter) =>
  filter === "all"
    ? true
    : filter === "open"
      ? OPEN_STATUSES.includes(ticket.status)
      : isDone(ticket.status);

/** How long typing has to settle before the server is asked to look past the
 *  rows this page already shipped with. Short enough to feel like part of the
 *  same gesture, long enough that a typed word is one request and not six. */
const SYNC_DELAY = 300;

export function MyTickets({
  tickets,
  rules,
  initialQuery = "",
  searchTruncated = false,
}: {
  tickets: TicketRowData[];
  rules: SlaRule[];
  /** The `?q=` the server ran, already normalized. Seeds the box so a shared
   *  or reloaded link comes back to the same result. */
  initialQuery?: string;
  /** The server hit its match ceiling and there are older matches it did not
   *  send. */
  searchTruncated?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [filter, setFilter] = useState<Filter>("open");
  const [query, setQuery] = useState(initialQuery);
  // State rather than a ref: finishing a composition has to re-run the sync
  // effect, and with an IME the final value is often identical to the last
  // intermediate one — so `setQuery` alone would not re-render.
  const [composing, setComposing] = useState(false);
  const [isSyncing, startSync] = useTransition();

  // Filtering runs against a deferred copy, so a long list re-filtering cannot
  // make the field itself feel heavy under the fingers.
  const deferredQuery = useDeferredValue(query);
  const terms = useMemo(() => parseSearchTerms(deferredQuery), [deferredQuery]);
  const searching = terms.length > 0;

  const ruleIndex = useMemo(() => indexRules(rules), [rules]);

  // Folded once per list rather than once per keystroke: the rows only change
  // when the server sends new ones.
  const haystacks = useMemo(() => {
    const map = new Map<string, string>();
    for (const ticket of tickets) map.set(ticket.id, ticketSearchText(ticket));
    return map;
  }, [tickets]);

  const matched = useMemo(() => {
    if (!searching) return tickets;
    return tickets.filter((ticket) =>
      matchesAllTerms(haystacks.get(ticket.id) ?? "", terms),
    );
  }, [tickets, haystacks, terms, searching]);

  // Counts follow the search. Without that, a query whose only hit is a closed
  // ticket reads as "no results" while the Open tab still claims twelve.
  const counts = useMemo(
    () => ({
      open: matched.filter((t) => OPEN_STATUSES.includes(t.status)).length,
      resolved: matched.filter((t) => isDone(t.status)).length,
      all: matched.length,
    }),
    [matched],
  );

  const visible = useMemo(
    () => matched.filter((ticket) => inFilter(ticket, filter)),
    [matched, filter],
  );

  /** Matches sitting in a tab the user is not looking at. */
  const hiddenByTab = counts.all - visible.length;

  const pushQuery = useCallback(
    (next: string) => {
      // Whatever was queued is now redundant; without this, submitting mid-
      // debounce costs a second identical round trip.
      if (syncTimer.current) {
        clearTimeout(syncTimer.current);
        syncTimer.current = null;
      }
      const params = new URLSearchParams(window.location.search);
      if (next) params.set("q", next);
      else params.delete("q");
      const search = params.toString();
      startSync(() => {
        router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
      });
    },
    [pathname, router],
  );

  // The box filters what is already here immediately; this hands the settled
  // term to the server so it can also reach tickets older than the page load.
  // Comparing against what the server last ran is what stops the effect from
  // firing again on the render that the navigation itself causes.
  useEffect(() => {
    const next = normalizeQuery(query);
    if (next === initialQuery) return;
    // Mid-composition an IME reports partial text; searching on it would fight
    // the person typing.
    if (composing) return;

    syncTimer.current = setTimeout(() => pushQuery(next), SYNC_DELAY);
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [query, initialQuery, composing, pushQuery]);

  const focusSearch = useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // `/` to search and ⌘K / Ctrl-K to search, the two things every list in every
  // tool has taught people to try.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // A dialog owns the keyboard while it is open.
      if (document.querySelector("[role='dialog']")) return;

      const target = event.target as HTMLElement | null;
      const typingElsewhere =
        !!target &&
        (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName));

      if ((event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        focusSearch();
        return;
      }
      if (
        event.key === "/" &&
        !typingElsewhere &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        focusSearch();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusSearch]);

  function clearSearch() {
    setQuery("");
    focusSearch();
  }

  return (
    <div className="space-y-4">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          // Enter means "I am done typing" — go to the server now rather than
          // waiting out the debounce.
          setComposing(false);
          pushQuery(normalizeQuery(query));
        }}
        className="card flex items-center gap-2 p-2.5"
      >
        <div className="relative min-w-0 flex-1">
          <Icons.search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint" />
          <Input
            ref={inputRef}
            type="search"
            name="q"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => {
              setComposing(false);
              setQuery(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              // Escape backs out one step at a time: clear the query, and only
              // leave the field once there is nothing left to clear.
              if (query) clearSearch();
              else inputRef.current?.blur();
            }}
            maxLength={SEARCH_MAX_LENGTH}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
            aria-label="Search your tickets"
            aria-describedby="my-tickets-search-hint"
            placeholder="Search by number, subject or category…"
            // Safari draws its own clear button inside a search field, which
            // would sit next to ours.
            className="pl-8 pr-20 [&::-webkit-search-cancel-button]:appearance-none"
          />

          <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {isSyncing && <Spinner className="size-3.5 text-ink-faint" />}
            {query ? (
              <button
                type="button"
                onClick={clearSearch}
                aria-label="Clear search"
                className="tap-safe flex size-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
              >
                <Icons.close className="size-3.5" />
              </button>
            ) : (
              <kbd className="pointer-events-none hidden h-5 select-none items-center rounded border border-line bg-surface px-1.5 text-[0.6875rem] font-medium text-ink-faint sm:flex">
                /
              </kbd>
            )}
          </div>
        </div>
      </form>

      <p id="my-tickets-search-hint" className="sr-only">
        Matches the ticket number, subject and category. Press Escape to clear.
      </p>

      {/* One announcement per settled query, so a screen reader hears the
          result rather than every intermediate keystroke. */}
      <p aria-live="polite" className="sr-only">
        {searching
          ? `${counts.all} ${counts.all === 1 ? "ticket matches" : "tickets match"} your search.`
          : ""}
      </p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="inline-flex rounded-[10px] border border-line bg-surface-sunk p-0.5">
          {FILTERS.map((item) => {
            const active = item.key === filter;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                aria-pressed={active}
                className={cn(
                  "relative flex min-h-11 items-center rounded-[7px] px-3.5 sm:min-h-8 sm:px-3",
                  "text-[0.8125rem] font-medium transition-colors",
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

        {searching && (
          <motion.p
            key={`${visible.length}-${searchTruncated}`}
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={transition.fast}
            className="tabular text-[0.8125rem] text-ink-muted"
          >
            {visible.length} shown
            {searchTruncated && (
              <span className="text-ink-faint"> · add a word to narrow older matches</span>
            )}
          </motion.p>
        )}
      </div>

      <div className="card overflow-hidden">
        {visible.length === 0 ? (
          searching ? (
            <EmptyState
              icon={<Icons.search />}
              title={
                hiddenByTab > 0
                  ? `No ${filter === "open" ? "open" : "resolved"} tickets match`
                  : "Nothing matches that search"
              }
              description={
                hiddenByTab > 0
                  ? `${hiddenByTab} ${hiddenByTab === 1 ? "ticket" : "tickets"} elsewhere in your history ${hiddenByTab === 1 ? "matches" : "match"}.`
                  : "Searches cover the ticket number, subject and category. Try fewer words, or the number on its own."
              }
              action={
                hiddenByTab > 0 ? (
                  <Button size="sm" variant="secondary" onClick={() => setFilter("all")}>
                    Show all {hiddenByTab}
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={clearSearch}>
                    Clear search
                  </Button>
                )
              }
            />
          ) : (
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
          )
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
                  terms={terms}
                />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  );
}
