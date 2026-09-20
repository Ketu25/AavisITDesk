/**
 * Text-search primitives shared by any list that grows a search box.
 *
 * The rules are deliberately boring. Fold the text and the query the same way,
 * split the query into terms, and require every term to appear somewhere in the
 * row. No fuzzy matching and no ranking: on a ticket desk a near-miss is worse
 * than an empty result, because the person searching already knows the ticket
 * exists and is only trying to reach it.
 *
 * Everything here is plain string work with no React and no Supabase in it, so
 * the server filter and the client filter can be built from the same rules.
 */

/** Longer than any real query, and short enough that pasting an email body in
 *  cannot turn into a hundred-term filter. */
export const SEARCH_MAX_LENGTH = 120;

/** Past this, extra terms cost more than they narrow. */
const MAX_TERMS = 8;

/** Combining marks, which is what NFD leaves behind once it has split an
 *  accented letter in two. Stripping them is the whole of our accent folding.
 *  Written as an explicit range rather than `\p{Diacritic}`, which needs an
 *  ES2018 target and this project builds to ES2017. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/** Pathological queries ("a" against a long field) should not build an
 *  unbounded list of highlight ranges. */
const MAX_RANGES = 200;

/**
 * ASCII punctuation, spelled out by code point rather than as `[^a-z0-9]` so
 * that a query in a non-Latin script is not stripped down to nothing.
 *
 * Only the edges of a term are trimmed with it: `#1009` and `(urgent)` are
 * someone reaching for a ticket, not asking for a literal `#`, while the hyphen
 * inside `AAV-1009` or `wi-fi` is part of what they typed and stays.
 */
const EDGE_PUNCTUATION =
  /^[!-/:-@[-`{-~]+|[!-/:-@[-`{-~]+$/g;

/** One original character's contribution to the folded string. Folding a
 *  character at a time — rather than the whole string at once — is what keeps
 *  {@link foldWithMap} able to point every folded index back at the character
 *  it came from. */
function foldChar(char: string) {
  return char.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
}

/**
 * Lowercase and accent-stripped. Both sides of every comparison go through
 * this, so "Résumé" finds "resume" and "RESUME" finds "résumé".
 */
export function fold(value: string) {
  let out = "";
  // Iterating the string yields whole code points, so an emoji or any other
  // surrogate pair is never split down the middle.
  for (const char of value) out += foldChar(char);
  return out;
}

export type FoldedText = {
  text: string;
  /** `offsets[i]` is the index in the original string of the character that
   *  produced `text[i]`. One extra entry at the end holds the original length,
   *  so a match that runs to the very end still has somewhere to land. */
  offsets: number[];
};

/**
 * {@link fold}, but remembering where every folded character came from.
 *
 * Folding is not length-preserving — "é" decomposes to two code points before
 * one of them is dropped — so a match found in the folded text cannot be sliced
 * out of the original text by the same indices. The map is how a highlight ends
 * up around the right letters.
 */
export function foldWithMap(value: string): FoldedText {
  let text = "";
  const offsets: number[] = [];
  let index = 0;

  for (const char of value) {
    const folded = foldChar(char);
    for (let i = 0; i < folded.length; i++) offsets.push(index);
    text += folded;
    index += char.length;
  }

  offsets.push(value.length);
  return { text, offsets };
}

/**
 * Collapse whitespace, trim, and cap the length. Run on every query before it
 * is stored, compared or put in a URL, so "  AAV-1000 " and "AAV-1000" are one
 * query and not two round trips.
 */
export function normalizeQuery(raw: string) {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (trimmed.length <= SEARCH_MAX_LENGTH) return trimmed;

  const capped = trimmed.slice(0, SEARCH_MAX_LENGTH);
  // Never leave half a surrogate pair behind at the cut.
  return /[\uD800-\uDBFF]$/.test(capped) ? capped.slice(0, -1) : capped;
}

/**
 * Split a query into the folded terms every matching row has to contain.
 *
 * Whitespace separates terms and a double-quoted run stays one term, so
 * `printer jam` finds a jammed printer whichever order the words appear in,
 * while `"out of office"` only finds that exact phrase. Terms are de-duplicated
 * and capped: repeating a word cannot narrow anything, and a hundred of them
 * only costs time.
 *
 * Terms that are nothing but punctuation drop out entirely. A stray `&` or `-`
 * left in the list would quietly demand that every result contain it, which is
 * never what the person meant by typing it.
 */
export function parseSearchTerms(raw: string): string[] {
  const query = normalizeQuery(raw);
  if (!query) return [];

  const terms: string[] = [];
  const pattern = /"([^"]*)"|(\S+)/g;

  for (let match = pattern.exec(query); match !== null; match = pattern.exec(query)) {
    // An unbalanced quote falls through to the bare-word branch, where the
    // stray character would never match anything — so drop it rather than
    // letting one typo empty the list.
    const raw = match[1] !== undefined ? match[1] : (match[2] ?? "").replace(/"/g, "");
    const term = fold(raw).replace(EDGE_PUNCTUATION, "").trim();

    if (term && !terms.includes(term)) terms.push(term);
    if (terms.length >= MAX_TERMS) break;
  }

  return terms;
}

/** True when every term appears somewhere in an already-folded haystack. */
export function matchesAllTerms(foldedHaystack: string, terms: string[]) {
  for (const term of terms) {
    if (!foldedHaystack.includes(term)) return false;
  }
  return true;
}

/**
 * Where `terms` occur in `text`, as `[start, end)` pairs indexing the original
 * string — overlapping hits merged, so two terms that touch are drawn as one
 * highlight rather than two abutting ones.
 */
export function findMatchRanges(text: string, terms: string[]): [number, number][] {
  if (!text || terms.length === 0) return [];

  const { text: folded, offsets } = foldWithMap(text);
  const hits: [number, number][] = [];

  for (const term of terms) {
    if (!term) continue;
    let from = 0;
    while (hits.length < MAX_RANGES) {
      const at = folded.indexOf(term, from);
      if (at === -1) break;
      hits.push([offsets[at], offsets[at + term.length]]);
      from = at + term.length;
    }
  }

  if (hits.length === 0) return [];

  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const merged: [number, number][] = [];
  for (const [start, end] of hits) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
