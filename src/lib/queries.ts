import { fold } from "@/lib/search";

/** The join shape every ticket list and detail view selects. */
export const TICKET_SELECT = `
  *,
  department:departments(name),
  creator:profiles!tickets_created_by_fkey(id, full_name, email),
  assignee:profiles!tickets_assigned_to_fkey(id, full_name, email)
` as const;

/** The columns a ticket search reads. Anything not listed here is invisible to
 *  the search box, on the server and on the client alike. */
const SEARCHABLE_COLUMNS = ["ticket_number", "subject", "category"] as const;

type SearchableTicket = {
  ticket_number: string;
  subject: string;
  category: string;
};

/**
 * Everything a ticket can be found by, folded once and ready to match against.
 *
 * The ticket number goes in twice: once as it is printed, `AAV-1000`, and once
 * with the punctuation removed, `aav1000`, so someone retyping a number from
 * memory finds it whether or not they reach for the hyphen. A bare `1000` hits
 * the printed form on its own.
 */
export function ticketSearchText(ticket: SearchableTicket) {
  const number = ticket.ticket_number ?? "";
  return fold(
    [number, number.replace(/[^a-zA-Z0-9]+/g, ""), ticket.subject, ticket.category]
      .filter(Boolean)
      .join(" "),
  );
}

/**
 * PostgREST's `or=()` is a grammar, not a bound parameter: commas, parentheses,
 * dots and quotes are all structural inside it, `*` is its wildcard, and `%`
 * and `_` survive into the SQL `LIKE` underneath. Escaping a person's typing
 * through both layers is a good way to be subtly wrong, so instead every
 * character outside a small safe set becomes a wildcard.
 *
 * That can only ever widen a match, never narrow one — `foo_bar` asks for
 * `%foo%bar%`, which still contains `foo_bar` — and widening is free here,
 * because the rows this brings back are filtered exactly on the client.
 * A few extra rows cost nothing; a missed row is a bug.
 *
 * Returns null when nothing usable survives, e.g. a query of only punctuation,
 * so the caller can skip the filter instead of asking the database for
 * everything.
 */
function ilikePattern(term: string) {
  const core = term.replace(/[^a-z0-9-]+/gi, "*").replace(/\*{2,}/g, "*");
  const stripped = core.replace(/\*/g, "");
  if (!stripped) return null;
  return `*${core}*`.replace(/\*{2,}/g, "*");
}

/**
 * The `or=()` expression matching one term against any searchable column.
 *
 * Callers chain one of these per term, and chained filters are ANDed — so a
 * two-word query needs both words present, each of them in any column. Null
 * means the term cannot be expressed in SQL and should simply not narrow the
 * query.
 */
export function ticketSearchFilter(term: string) {
  const pattern = ilikePattern(term);
  if (!pattern) return null;

  const clauses = SEARCHABLE_COLUMNS.map((column) => `${column}.ilike.${pattern}`);

  // `aav1000` cannot reach `AAV-1000` through ILIKE, and neither can `#1000`.
  // Matching the digits alone against the number covers both, and the client
  // filter — which does know about the punctuation-free form — decides whether
  // the row really matched.
  const digits = term.replace(/\D+/g, "");
  const digitClause = `ticket_number.ilike.*${digits}*`;
  if (digits && digits !== term && !clauses.includes(digitClause)) clauses.push(digitClause);

  return clauses.join(",");
}
