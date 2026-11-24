/**
 * Finds the links in text someone typed — a pasted meeting invite, a vendor's
 * status page, a colleague's email address — so they can be drawn as links
 * while the text itself is never treated as markup.
 *
 * Only http(s) and mailto come out, and every href is rebuilt by the URL
 * parser from what was matched. A scheme like `javascript:` is never matched
 * in the first place, so it cannot reach an href.
 */

export type MeetingKind = "Teams" | "Zoom" | "Google Meet" | "Webex";

export type TextToken =
  | { kind: "text"; text: string }
  | {
      kind: "link";
      /** What to show: as typed, or shortened when it would swamp the message. */
      text: string;
      href: string;
      /** True when `text` is shortened, so the full address belongs in a tooltip. */
      shortened: boolean;
      meeting: MeetingKind | null;
    }
  | { kind: "email"; text: string; href: string };

/*
 * A URL runs from `http(s)://` or `www.` to the next space, quote or angle
 * bracket; trailing punctuation is trimmed afterwards. Email parts are bounded
 * (64 is the RFC limit for the local part), which keeps a long unbroken paste
 * — a token, a hash, a base64 blob — linear to scan instead of quadratic.
 */
const CANDIDATE =
  /(?:https?:\/\/|www\.)[^\s<>"]+|[\w.%+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,8}\.[a-z]{2,24}/gi;

/** Punctuation that ends a sentence, not a URL: "see https://x.com." */
const TRAILING = new Set([".", ",", ";", ":", "!", "?", "'", "*", "`", "…", "，", "。", "、", "；", "：", "！", "？"]);
const CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/**
 * "logo@2x.png" has the shape of an address but is a file name, and IT chat is
 * full of them. Real domains on these endings are vanishingly rare in an
 * address someone would paste here.
 */
const FILE_ENDINGS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "heic",
  "js", "ts", "tsx", "jsx", "css", "json", "xml", "yml", "yaml",
  "txt", "log", "csv", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "exe", "dll", "msi", "bat", "ps1", "sh", "zip", "rar", "gz", "tar",
]);

/** Longer than this and a link is shown shortened, in full in its tooltip. */
const SHORTEN_OVER = 64;
const SHORTEN_TO = 48;

function count(text: string, char: string) {
  let n = 0;
  for (const c of text) if (c === char) n++;
  return n;
}

/**
 * Drops trailing punctuation, and a closing bracket only when it has no
 * partner inside the URL — "(see https://x.com/a)" loses its ")", while
 * "https://en.wikipedia.org/wiki/Mercury_(planet)" keeps it.
 */
function trimUrl(raw: string) {
  let url = raw;
  for (;;) {
    const last = url.at(-1);
    if (!last) return url;
    if (TRAILING.has(last)) {
      url = url.slice(0, -1);
    } else if (last in CLOSERS && count(url, last) > count(url, CLOSERS[last])) {
      url = url.slice(0, -1);
    } else {
      return url;
    }
  }
}

function parseUrl(raw: string): URL | null {
  const bare = /^www\./i.test(raw);
  let url: URL;
  try {
    url = new URL(bare ? `https://${raw}` : raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  // "www." alone, or "www.example" with nothing after it, is a word.
  if (bare && !/^www\.[^.]+\.[^.]+/i.test(url.hostname)) return null;
  return url;
}

function onDomain(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Labels a link by its real hostname only, so "teams.microsoft.com.evil.example"
 * is just a link, never a "Teams meeting".
 */
export function meetingKind(url: URL): MeetingKind | null {
  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  if (
    (onDomain(host, "teams.microsoft.com") ||
      onDomain(host, "teams.live.com") ||
      onDomain(host, "teams.cloud.microsoft")) &&
    /^\/(?:l\/meetup-join|meet)\//i.test(path)
  ) {
    return "Teams";
  }
  if (
    (onDomain(host, "zoom.us") || onDomain(host, "zoom.com") || onDomain(host, "zoomgov.com")) &&
    /^\/(?:j|my|w|s|wc\/join)\//i.test(path)
  ) {
    return "Zoom";
  }
  if (host === "meet.google.com" && /^\/(?:[a-z]{3,4}-[a-z]{4}-[a-z]{3}|lookup\/)/i.test(path)) {
    return "Google Meet";
  }
  if (onDomain(host, "webex.com") && /\/(?:meet|join|j\.php)\b/i.test(path)) {
    return "Webex";
  }
  return null;
}

function shorten(raw: string) {
  const withoutScheme = raw.replace(/^https?:\/\//i, "");
  return `${Array.from(withoutScheme).slice(0, SHORTEN_TO).join("")}…`;
}

/** Splits `text` into plain runs and links, in order. Joining every token's text gives back the visible message. */
export function tokenize(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  let plainFrom = 0;

  const pushPlain = (until: number) => {
    if (until > plainFrom) tokens.push({ kind: "text", text: text.slice(plainFrom, until) });
  };

  for (const match of text.matchAll(CANDIDATE)) {
    const start = match.index;
    const found = match[0];
    const before = start > 0 ? text[start - 1] : "";

    if (/^(?:https?:|www\.)/i.test(found)) {
      // "xhttps://…" or "1.www.…" is part of some other word.
      if (/[\w.@/]/.test(before)) continue;

      const raw = trimUrl(found);
      const url = parseUrl(raw);
      if (!url) continue;

      pushPlain(start);
      const shortened = Array.from(raw).length > SHORTEN_OVER;
      tokens.push({
        kind: "link",
        text: shortened ? shorten(raw) : raw,
        href: url.href,
        shortened,
        meeting: meetingKind(url),
      });
      plainFrom = start + raw.length;
    } else {
      // A leading dot belongs to the sentence (".john@x.com"), not the address.
      const lead = found.length - found.replace(/^\.+/, "").length;
      const address = found.slice(lead);
      if (!address || address.startsWith("@")) continue;
      if (FILE_ENDINGS.has(address.slice(address.lastIndexOf(".") + 1).toLowerCase())) continue;

      pushPlain(start + lead);
      tokens.push({ kind: "email", text: address, href: `mailto:${address}` });
      plainFrom = start + found.length;
    }
  }

  pushPlain(text.length);
  return tokens;
}
