import type { TimeWindow } from "../../shared/types";

export interface Interval {
  start: number;
  end: number;
}

export interface SlotRules {
  timezone: string;
  /** Keyed by weekday, Sunday = 0. Missing days are unavailable. */
  weeklyHours: Partial<Record<number, TimeWindow[]>>;
  durationMinutes: number;
  slotStepMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  maxDaysAhead: number;
  /** Keyed by "YYYY-MM-DD" in the host's timezone; replaces the weekly hours for that date. */
  dateOverrides?: Record<string, TimeWindow[]>;
  /** 0 or undefined means no daily limit. */
  maxPerDay?: number;
}

const MINUTE = 60_000;
const DAY = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timezone, f);
  }
  return f;
}

/** Wall-clock fields of a UTC instant in the given timezone, expressed as a UTC timestamp. */
export function wallClock(utc: number, timezone: string): number {
  const p: Record<string, number> = {};
  for (const part of formatterFor(timezone).formatToParts(utc)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
}

/** UTC instant for a wall-clock time in the given timezone. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (utc: number) => wallClock(utc, timezone) - Math.floor(utc / 1000) * 1000;
  const guess = wall - offsetAt(wall);
  // Second pass settles times that fall near a DST change.
  return wall - offsetAt(guess);
}

/** "YYYY-MM-DD" of a UTC instant in the given timezone. */
export function localDateKey(utc: number, timezone: string): string {
  return new Date(wallClock(utc, timezone)).toISOString().slice(0, 10);
}

function parseHHMM(value: string): [number, number] {
  const [h, m] = value.split(":").map(Number);
  return [h ?? 0, m ?? 0];
}

/**
 * Bookable slot start times (UTC ms) between rangeStart and rangeEnd.
 * `busy` holds existing bookings and connected-calendar events;
 * `bookedStarts` holds existing booking start times, for the daily limit.
 */
export function computeSlots(
  rules: SlotRules,
  busy: Interval[],
  rangeStart: number,
  rangeEnd: number,
  now: number,
  bookedStarts: number[] = [],
): number[] {
  const earliest = Math.max(rangeStart, now + rules.minNoticeMinutes * MINUTE);
  const latest = Math.min(rangeEnd, now + rules.maxDaysAhead * DAY);
  if (earliest >= latest) return [];

  const duration = rules.durationMinutes * MINUTE;
  const step = rules.slotStepMinutes * MINUTE;
  const before = rules.bufferBeforeMinutes * MINUTE;
  const after = rules.bufferAfterMinutes * MINUTE;
  const sortedBusy = [...busy].sort((a, b) => a.start - b.start);

  const perDay = new Map<string, number>();
  for (const start of bookedStarts) {
    const key = localDateKey(start, rules.timezone);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }

  const slots: number[] = [];
  // Walk local calendar days; one day of padding each side covers timezone offsets.
  const firstDay = Math.floor(wallClock(earliest, rules.timezone) / DAY) * DAY - DAY;
  const lastDay = Math.floor(wallClock(latest, rules.timezone) / DAY) * DAY + DAY;

  for (let dayTs = firstDay; dayTs <= lastDay; dayTs += DAY) {
    const day = new Date(dayTs);
    const dateKey = day.toISOString().slice(0, 10);
    if (rules.maxPerDay && (perDay.get(dateKey) ?? 0) >= rules.maxPerDay) continue;
    const windows = rules.dateOverrides?.[dateKey] ?? rules.weeklyHours[day.getUTCDay()] ?? [];
    for (const window of windows) {
      const [sh, sm] = parseHHMM(window.start);
      const [eh, em] = parseHHMM(window.end);
      const y = day.getUTCFullYear();
      const mo = day.getUTCMonth() + 1;
      const d = day.getUTCDate();
      const windowStart = zonedTimeToUtc(y, mo, d, sh, sm, rules.timezone);
      const windowEnd = zonedTimeToUtc(y, mo, d, eh, em, rules.timezone);

      for (let start = windowStart; start + duration <= windowEnd; start += step) {
        if (start < earliest || start >= latest) continue;
        const blockedFrom = start - before;
        const blockedTo = start + duration + after;
        const clash = sortedBusy.some((b) => b.start < blockedTo && b.end > blockedFrom);
        if (!clash) slots.push(start);
      }
    }
  }
  return slots;
}
