const UNITS: [limit: number, divisor: number, unit: Intl.RelativeTimeFormatUnit][] = [
  [60, 1, "second"],
  [3600, 60, "minute"],
  [86400, 3600, "hour"],
  [604800, 86400, "day"],
  [2629800, 604800, "week"],
  [31557600, 2629800, "month"],
  [Infinity, 31557600, "year"],
];

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function relativeTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  const seconds = (date.getTime() - Date.now()) / 1000;
  const abs = Math.abs(seconds);
  for (const [limit, divisor, unit] of UNITS) {
    if (abs < limit) return rtf.format(Math.round(seconds / divisor), unit);
  }
  return date.toLocaleDateString();
}

export function absoluteTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Compact duration: 2d 4h, 3h 20m, 45m, 30s. */
export function duration(ms: number) {
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export function minutesToLabel(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) return "—";
  return duration(minutes * 60000);
}
