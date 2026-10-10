"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Icons } from "./icons";
import { useIsClient } from "@/components/motion";
import { Highlight } from "@/components/ui/highlight";
import { Spinner } from "@/components/ui/spinner";
import { useEscape, useFocusTrap, useScrollLock } from "@/components/ui/use-overlay";
import { createClient } from "@/lib/supabase/client";
import { STATUS_META } from "@/lib/constants";
import { ticketSearchFilter, ticketSearchText } from "@/lib/queries";
import { SEARCH_MAX_LENGTH, fold, matchesAllTerms, parseSearchTerms } from "@/lib/search";
import { transition } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { TicketStatus, UserRole } from "@/lib/database.types";

/**
 * ⌘K / Ctrl-K from anywhere: type a ticket number, a few words of a subject or
 * a page name, press Enter, and you are there.
 *
 * Tickets are searched through the same rules as the My tickets box — a loose
 * database filter, then an exact client-side match — and through row-level
 * security, so a requester only ever finds their own tickets and an agent can
 * reach any ticket on the desk.
 */

type PaletteTicket = {
  id: string;
  ticket_number: string;
  subject: string;
  category: string;
  status: TicketStatus;
  creator: { full_name: string } | null;
};

const TICKET_COLUMNS =
  "id, ticket_number, subject, category, status, creator:profiles!tickets_created_by_fkey(full_name)";

/** Settled typing, not every keystroke: one request per word, not six. */
const DEBOUNCE_MS = 160;
/** Rows asked for before the exact filter; a little slack over what is shown. */
const SEARCH_FETCH = 30;
const SEARCH_SHOWN = 8;
const RECENT_SHOWN = 5;

type PageItem = { href: string; label: string; icon: keyof typeof Icons; keywords: string };

const PAGES: PageItem[] = [
  { href: "/tickets/new", label: "New ticket", icon: "plus", keywords: "raise create report problem issue help" },
  { href: "/dashboard", label: "Overview", icon: "overview", keywords: "home dashboard start" },
  { href: "/tickets", label: "My tickets", icon: "ticket", keywords: "requests mine history" },
  { href: "/profile", label: "Profile", icon: "people", keywords: "account password me" },
];
const AGENT_PAGES: PageItem[] = [
  { href: "/queue", label: "Queue", icon: "queue", keywords: "desk inbox open unassigned work" },
  { href: "/reports", label: "Reports", icon: "reports", keywords: "charts stats analytics numbers" },
];
const ADMIN_PAGES: PageItem[] = [
  { href: "/admin/users", label: "People", icon: "people", keywords: "users invite accounts staff" },
  { href: "/admin/departments", label: "Departments", icon: "building", keywords: "teams org" },
  { href: "/admin/sla", label: "SLA rules", icon: "clock", keywords: "targets service level" },
  { href: "/admin/routing", label: "Routing", icon: "route", keywords: "categories assignment" },
  { href: "/admin/settings", label: "Settings", icon: "settings", keywords: "notifications teams email config" },
];

type Item =
  | { kind: "ticket"; key: string; href: string; ticket: PaletteTicket }
  | { kind: "page"; key: string; href: string; page: PageItem };

// ------------------------------------------------------------------ context --

type PaletteContextValue = { open: boolean; setOpen: (open: boolean) => void };

const PaletteContext = createContext<PaletteContextValue | null>(null);

export function useCommandPalette() {
  const ctx = useContext(PaletteContext);
  if (!ctx) throw new Error("useCommandPalette must be used inside <CommandPaletteProvider>");
  return ctx;
}

/** ⌘K on a Latin layout, and the same physical key on one that is not — on a
 *  Cyrillic keyboard `key` is "л", but the shortcut is still where K is. */
function isPaletteShortcut(event: KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return false;
  const key = event.key.toLowerCase();
  return key === "k" || (!/^[a-z]$/.test(key) && event.code === "KeyK");
}

export function CommandPaletteProvider({
  role,
  children,
}: {
  role: UserRole;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ open, setOpen }), [open]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.isComposing || event.repeat || !isPaletteShortcut(event)) return;
      // Another dialog owns the keyboard while it is open; the palette itself
      // is the exception, so the shortcut also closes it.
      const dialog = document.querySelector("[role='dialog'][aria-modal='true']");
      if (dialog && !dialog.hasAttribute("data-command-palette")) return;
      event.preventDefault();
      setOpen((current) => !current);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <PaletteContext.Provider value={value}>
      {children}
      <AnimatePresence>{open && <Palette role={role} onClose={close} />}</AnimatePresence>
    </PaletteContext.Provider>
  );
}

// ------------------------------------------------------------------ trigger --

/** "⌘K" on Apple hardware, "Ctrl K" elsewhere, nothing without a keyboard. */
function useShortcutLabel() {
  const isClient = useIsClient();
  if (!isClient) return null;
  if (!window.matchMedia("(any-pointer: fine)").matches) return null;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || navigator.platform || navigator.userAgent;
  return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘K" : "Ctrl K";
}

export function CommandPaletteTrigger({ onOpen }: { onOpen?: () => void }) {
  const { setOpen } = useCommandPalette();
  const shortcut = useShortcutLabel();

  return (
    <button
      type="button"
      onClick={() => {
        onOpen?.();
        setOpen(true);
      }}
      aria-keyshortcuts="Meta+K Control+K"
      aria-haspopup="dialog"
      className={cn(
        "flex h-11 w-full items-center gap-2 rounded-[10px] border border-line bg-surface px-3 lg:h-9",
        "text-[0.8125rem] text-ink-faint transition-colors duration-150",
        "hover:border-line-strong hover:text-ink-muted",
      )}
    >
      <Icons.search className="size-3.5 flex-none" />
      <span className="flex-1 truncate text-left">Jump to…</span>
      {shortcut && (
        <kbd className="readout flex h-5 flex-none items-center rounded border border-line bg-surface-sunk px-1.5 text-[0.625rem] text-ink-faint">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}

// ------------------------------------------------------------------ dialog --

/** Exact number first, then any number containing what was typed, then the
 *  rest — each group newest first, as the database returned them. */
function rank(tickets: PaletteTicket[], query: string) {
  const typed = fold(query).replace(/[^a-z0-9]/g, "");
  const score = (ticket: PaletteTicket) => {
    if (!typed) return 2;
    const number = fold(ticket.ticket_number).replace(/[^a-z0-9]/g, "");
    const digits = number.replace(/\D/g, "");
    if (number === typed || digits === typed) return 0;
    if (number.includes(typed)) return 1;
    return 2;
  };
  return tickets
    .map((ticket, order) => ({ ticket, order, score: score(ticket) }))
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .map((entry) => entry.ticket);
}

function Palette({ role, onClose }: { role: UserRole; onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const optionId = useCallback((index: number) => `${listId}-option-${index}`, [listId]);

  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<PaletteTicket[] | null>(null);
  const [found, setFound] = useState<{ query: string; tickets: PaletteTicket[] } | null>(null);
  const [failedQuery, setFailedQuery] = useState<string | null>(null);

  useEscape(true, onClose);
  useScrollLock(true);
  useFocusTrap(panelRef, true);

  // Browser back, or anything else that navigates, takes the palette with it.
  const openedOn = useRef(pathname);
  useEffect(() => {
    if (pathname !== openedOn.current) onClose();
  }, [pathname, onClose]);

  const isAgent = role === "agent" || role === "admin";
  const terms = useMemo(() => parseSearchTerms(query), [query]);
  const searchKey = terms.join(" ");

  // What to offer before anything is typed.
  useEffect(() => {
    let cancelled = false;
    createClient()
      .from("tickets")
      .select(TICKET_COLUMNS)
      .order("updated_at", { ascending: false })
      .limit(RECENT_SHOWN)
      .then(({ data, error }) => {
        if (cancelled) return;
        setRecent(error ? [] : ((data ?? []) as unknown as PaletteTicket[]));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Mid-composition an IME reports partial text; searching on it would fight
    // the person typing.
    if (terms.length === 0 || composing) return;
    let cancelled = false;

    const timer = setTimeout(async () => {
      let builder = createClient().from("tickets").select(TICKET_COLUMNS);
      let applied = 0;
      for (const term of terms) {
        const filter = ticketSearchFilter(term);
        if (!filter) continue;
        builder = builder.or(filter);
        applied++;
      }

      // Every term was punctuation the filter cannot express; asking for the
      // whole desk unfiltered would be a worse answer than none.
      if (applied === 0) {
        if (!cancelled) setFound({ query: searchKey, tickets: [] });
        return;
      }

      const { data, error } = await builder
        .order("created_at", { ascending: false })
        .limit(SEARCH_FETCH);
      if (cancelled) return;
      if (error) {
        setFailedQuery(searchKey);
        return;
      }
      setFailedQuery(null);
      setFound({ query: searchKey, tickets: (data ?? []) as unknown as PaletteTicket[] });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [terms, searchKey, composing]);

  const searching = terms.length > 0;
  const settled = found?.query === searchKey;
  const failed = searching && failedQuery === searchKey;
  const pending = searching && !settled && !failed;

  const tickets = useMemo(() => {
    if (!searching) return (recent ?? []).slice(0, RECENT_SHOWN);
    // While the next answer is on its way, narrow the last one with what has
    // been typed since — results tighten as you type instead of blinking out.
    const pool = found?.tickets ?? [];
    const matching = pool.filter((ticket) => matchesAllTerms(ticketSearchText(ticket), terms));
    return rank(matching, query).slice(0, SEARCH_SHOWN);
  }, [searching, recent, found, terms, query]);

  const pages = useMemo(() => {
    const all = [...PAGES, ...(isAgent ? AGENT_PAGES : []), ...(role === "admin" ? ADMIN_PAGES : [])];
    if (!searching) return all;
    return all.filter((page) => matchesAllTerms(fold(`${page.label} ${page.keywords}`), terms));
  }, [isAgent, role, searching, terms]);

  const items: Item[] = useMemo(
    () => [
      ...tickets.map((ticket) => ({
        kind: "ticket" as const,
        key: `t-${ticket.id}`,
        href: `/tickets/${ticket.id}`,
        ticket,
      })),
      ...pages.map((page) => ({ kind: "page" as const, key: `p-${page.href}`, href: page.href, page })),
    ],
    [tickets, pages],
  );

  const activeIndex = items.length === 0 ? -1 : Math.min(active, items.length - 1);

  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, optionId]);

  function go(item: Item | undefined) {
    if (!item) return;
    onClose();
    if (item.href !== pathname) router.push(item.href);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (items.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((activeIndex + 1) % items.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((activeIndex - 1 + items.length) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(items[activeIndex]);
    }
  }

  const ticketHeading = searching ? "Tickets" : isAgent ? "Recently updated" : "Your recent tickets";
  const noMatches = searching && !pending && !failed && items.length === 0;
  const announcement = !searching || pending
    ? ""
    : failed
      ? "Ticket search is unavailable."
      : `${items.length} ${items.length === 1 ? "result" : "results"}.`;

  const option = (item: Item, index: number) => {
    const selected = index === activeIndex;
    return (
      <div
        key={item.key}
        id={optionId(index)}
        role="option"
        aria-selected={selected}
        // Keep focus in the input; the click still lands.
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={() => {
          if (!selected) setActive(index);
        }}
        onClick={() => go(item)}
        className={cn(
          "flex min-h-11 cursor-pointer items-center gap-3 rounded-[9px] px-2.5 py-2 sm:min-h-0",
          selected ? "bg-surface-hover text-ink" : "text-ink-muted",
        )}
      >
        {item.kind === "ticket" ? (
          <>
            <Icons.ticket className={cn("size-4 flex-none", selected ? "text-accent" : "text-ink-faint")} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.8125rem] text-ink">
                <span className="readout mr-2 text-[0.75rem] text-ink-muted">
                  <Highlight text={item.ticket.ticket_number} terms={terms} />
                </span>
                <Highlight text={item.ticket.subject} terms={terms} />
              </p>
              <p className="mt-0.5 truncate text-[0.6875rem] text-ink-faint">
                <Highlight text={item.ticket.category} terms={terms} />
                {isAgent && item.ticket.creator && <> · {item.ticket.creator.full_name}</>}
              </p>
            </div>
            <span className="flex-none text-[0.6875rem] text-ink-faint">
              {STATUS_META[item.ticket.status]?.label ?? item.ticket.status}
            </span>
          </>
        ) : (
          <>
            {(() => {
              const Icon = Icons[item.page.icon];
              return <Icon className={cn("size-4 flex-none", selected ? "text-accent" : "text-ink-faint")} />;
            })()}
            <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink">{item.page.label}</span>
            <span className="flex-none text-[0.6875rem] text-ink-faint">Page</span>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pb-4 pt-[10vh] sm:px-6 sm:pt-[14vh]">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/45 backdrop-blur-[3px]"
      />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Jump to a ticket or page"
        data-command-palette=""
        tabIndex={-1}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        // Leaving is quicker than arriving: once the choice is made, the
        // overlay should be out of the way, not settling on a spring.
        exit={{
          opacity: 0,
          ...(reduced ? {} : { y: -6, scale: 0.98 }),
          transition: transition.fast,
        }}
        transition={reduced ? transition.fast : { type: "spring", stiffness: 420, damping: 34 }}
        className="relative flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line-strong bg-canvas-raised shadow-[var(--shadow-lg)] outline-none"
      >
        <div className="flex flex-none items-center gap-2.5 border-b border-line px-4">
          <Icons.search className="size-4 flex-none text-ink-faint" />
          <input
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            aria-label="Search tickets or pages"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
              // A new query gets a fresh attempt, not the last one's error.
              setFailedQuery(null);
            }}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => {
              setComposing(false);
              setQuery(event.currentTarget.value);
            }}
            onKeyDown={onKeyDown}
            maxLength={SEARCH_MAX_LENGTH}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="go"
            placeholder="Ticket number, subject, or a page…"
            className="h-12 min-w-0 flex-1 bg-transparent text-[0.9375rem] text-ink outline-none placeholder:text-ink-faint"
          />
          {pending && <Spinner className="size-3.5 flex-none text-ink-faint" />}
          <button
            type="button"
            onClick={onClose}
            className="readout flex h-6 flex-none items-center rounded border border-line bg-surface-sunk px-1.5 text-[0.625rem] text-ink-faint transition-colors hover:text-ink"
          >
            Esc
          </button>
        </div>

        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>

        <div id={listId} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-2">
          {tickets.length > 0 && (
            <div role="group" aria-label={ticketHeading}>
              <p aria-hidden className="eyebrow px-2.5 pb-1.5 pt-1">
                {ticketHeading}
              </p>
              {items.slice(0, tickets.length).map((item, index) => option(item, index))}
            </div>
          )}

          {!searching && recent === null && (
            <p className="flex items-center gap-2 px-2.5 py-2 text-[0.8125rem] text-ink-faint">
              <Spinner className="size-3.5" /> Loading recent tickets…
            </p>
          )}

          {failed && (
            <p className="px-2.5 py-2 text-[0.8125rem] text-ink-muted">
              Ticket search isn&apos;t available right now. Check your connection and try again.
            </p>
          )}

          {pages.length > 0 && (
            <div role="group" aria-label="Pages" className={cn(tickets.length > 0 && "mt-2")}>
              <p aria-hidden className="eyebrow px-2.5 pb-1.5 pt-1">
                Go to
              </p>
              {items.slice(tickets.length).map((item, index) => option(item, tickets.length + index))}
            </div>
          )}

          {noMatches && (
            <div className="px-2.5 py-6 text-center">
              <p className="text-[0.8125rem] font-medium text-ink">Nothing matches that</p>
              <p className="mt-1 text-[0.75rem] text-ink-faint">
                Try the ticket number on its own, like {isAgent ? "AAV-1021" : "1021"}, or fewer words.
              </p>
            </div>
          )}
        </div>

        <div className="hidden flex-none items-center gap-4 border-t border-line px-4 py-2 text-[0.6875rem] text-ink-faint sm:flex">
          <span>
            <kbd className="readout">↑</kbd> <kbd className="readout">↓</kbd> to move
          </span>
          <span>
            <kbd className="readout">↵</kbd> to open
          </span>
          <span>
            <kbd className="readout">esc</kbd> to close
          </span>
        </div>
      </motion.div>
    </div>
  );
}
