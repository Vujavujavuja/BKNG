const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(key: string, locale: string, options: Intl.DateTimeFormatOptions) {
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, f);
  }
  return f;
}

/** "YYYY-MM-DD" of an instant in a timezone. */
export function dateKey(ts: number, tz: string): string {
  return formatter(`key:${tz}`, "en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(ts);
}

export function formatTime(ts: number, tz: string, timeFormat: "12h" | "24h"): string {
  return formatter(`time:${tz}:${timeFormat}`, timeFormat === "12h" ? "en-US" : "en-GB", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: timeFormat === "12h",
  }).format(ts);
}

export function formatDate(ts: number, tz: string): string {
  return formatter(`date:${tz}`, "en-GB", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(ts);
}

export function formatShortDate(ts: number, tz: string): string {
  return formatter(`short:${tz}`, "en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(ts);
}

/** Label for a "YYYY-MM-DD" key, independent of any timezone. */
export function formatDateKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return formatter("datekey", "en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(
    Date.UTC(y!, m! - 1, d!),
  );
}

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function allTimezones(current: string): string[] {
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return zones.includes(current) ? zones : [current, ...zones];
}
