import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { MyTickets } from "@/components/tickets/my-tickets";
import { Icons } from "@/components/shell/icons";
import { TICKET_SELECT, ticketSearchFilter } from "@/lib/queries";
import { normalizeQuery, parseSearchTerms } from "@/lib/search";
import type { TicketRowData } from "@/components/tickets/ticket-row";

export const metadata: Metadata = { title: "My tickets" };

/** How much of a person's history the page carries so the list, the tab counts
 *  and an instant client-side filter all have something to work with. */
const RECENT_LIMIT = 200;

/** Ceiling on the extra rows a search may pull in from beyond that window. A
 *  query broad enough to hit this is not a query anyone is reading to the end
 *  of; the UI says so rather than pretending the list is complete. */
const SEARCH_LIMIT = 200;

export default async function MyTicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { profile } = await requireUser();
  const params = await searchParams;

  // A repeated `?q=a&q=b` arrives as an array; take the first and ignore the
  // rest rather than stringifying it into a query nobody typed.
  const rawQuery = params.q;
  const query = normalizeQuery(Array.isArray(rawQuery) ? (rawQuery[0] ?? "") : (rawQuery ?? ""));
  const terms = parseSearchTerms(query);

  const supabase = await createClient();

  // The recent window is fetched whether or not there is a search, so clearing
  // the box restores the full list from what the client already holds instead
  // of blanking it until a round trip comes back.
  const recentQuery = supabase
    .from("tickets")
    .select(TICKET_SELECT)
    .eq("created_by", profile.id)
    .order("created_at", { ascending: false })
    .limit(RECENT_LIMIT);

  // The search runs over the whole history. Each term contributes one `or`
  // group, and PostgREST ANDs the groups — so every word has to appear, each
  // of them in any searchable column. The filter is deliberately loose; the
  // client narrows these rows down to the exact matches.
  let matchQuery = null;
  if (terms.length > 0) {
    let builder = supabase.from("tickets").select(TICKET_SELECT).eq("created_by", profile.id);
    let applied = 0;
    for (const term of terms) {
      const filter = ticketSearchFilter(term);
      if (!filter) continue;
      builder = builder.or(filter);
      applied++;
    }
    // Every term was punctuation the filter cannot express. Asking for the
    // whole history unfiltered would be a worse answer than none.
    if (applied > 0) {
      matchQuery = builder.order("created_at", { ascending: false }).limit(SEARCH_LIMIT);
    }
  }

  const [recentResult, matchResult, rulesResult] = await Promise.all([
    recentQuery,
    matchQuery,
    supabase.from("sla_rules").select("*"),
  ]);

  // A failed history search degrades to searching the recent window, which the
  // client can still do on its own — but it should not do so silently.
  if (matchResult?.error) {
    console.error("[my-tickets] history search failed", matchResult.error.message);
  }

  const recent = (recentResult.data ?? []) as unknown as TicketRowData[];
  const matches = (matchResult?.data ?? []) as unknown as TicketRowData[];

  // One list, newest first, with the older matches folded in. De-duplicated by
  // id because anything recent enough is in both results.
  const byId = new Map<string, TicketRowData>();
  for (const ticket of recent) byId.set(ticket.id, ticket);
  for (const ticket of matches) if (!byId.has(ticket.id)) byId.set(ticket.id, ticket);

  const tickets = [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <>
      <PageHeader
        title="My tickets"
        description="Everything you've raised, newest first."
        actions={
          <Link
            href="/tickets/new"
            className="inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-accent px-3 text-[0.8125rem] font-medium text-[var(--accent-ink)] transition-[filter] hover:brightness-110"
          >
            <Icons.plus className="size-3.5" />
            New ticket
          </Link>
        }
      />
      <PageBody>
        <MyTickets
          tickets={tickets}
          rules={rulesResult.data ?? []}
          initialQuery={query}
          searchTruncated={matches.length >= SEARCH_LIMIT}
        />
      </PageBody>
    </>
  );
}
