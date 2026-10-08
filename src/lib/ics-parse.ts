import { zonedTimeToUtc, type Interval } from "./slots";

const DAY = 86_400_000;
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

// Outlook exports Windows zone names; these cover the common ones, the rest fall back to the host's zone.
const WINDOWS_ZONES: Record<string, string> = {
  "GMT Standard Time": "Europe/London",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "Romance Standard Time": "Europe/Paris",
  "E. Europe Standard Time": "Europe/Chisinau",
  "FLE Standard Time": "Europe/Helsinki",
  "GTB Standard Time": "Europe/Bucharest",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
  "India Standard Time": "Asia/Kolkata",
  "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo",
  "AUS Eastern Standard Time": "Australia/Sydney",
  UTC: "UTC",
};

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface DateValue {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  isDate: boolean;
  tz: string;
}

interface ParsedEvent {
  uid: string;
  start: DateValue;
  durationMs: number;
  rrule: Record<string, string> | null;
  exdates: number[];
  recurrenceId: number | null;
  skip: boolean;
}

export interface IcsOptions {
  /** Zone for floating and all-day times. */
  defaultTz: string;
  from: number;
  to: number;
  ignoreAllDay?: boolean;
}

function parseLine(line: string): Prop | null {
  let colon = -1;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const raw of rawParams) {
    const eq = raw.indexOf("=");
    if (eq > 0) params[raw.slice(0, eq).toUpperCase()] = raw.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name!.toUpperCase(), params, value: line.slice(colon + 1) };
}

const zoneCache = new Map<string, string>();

function resolveZone(tzid: string | undefined, fallback: string): string {
  if (!tzid) return fallback;
  let zone = zoneCache.get(tzid);
  if (zone === undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tzid });
      zone = tzid;
    } catch {
      zone = WINDOWS_ZONES[tzid] ?? "";
    }
    zoneCache.set(tzid, zone);
  }
  return zone || fallback;
}

function parseDate(value: string, tzid: string | undefined, defaultTz: string): DateValue | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  return {
    y: Number(m[1]),
    mo: Number(m[2]),
    d: Number(m[3]),
    h: Number(m[4] ?? 0),
    mi: Number(m[5] ?? 0),
    s: Number(m[6] ?? 0),
    isDate: m[4] === undefined,
    tz: m[7] ? "UTC" : resolveZone(tzid, defaultTz),
  };
}

function toUtc(v: DateValue): number {
  return zonedTimeToUtc(v.y, v.mo, v.d, v.h, v.mi, v.tz) + v.s * 1000;
}

function parseDuration(value: string): number {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return 0;
  const n = (i: number) => Number(m[i] ?? 0);
  return (n(2) * 7 * DAY + n(3) * DAY + n(4) * 3_600_000 + n(5) * 60_000 + n(6) * 1000) * (m[1] === "-" ? -1 : 1);
}

function parseRule(value: string): Record<string, string> {
  const rule: Record<string, string> = {};
  for (const part of value.split(";")) {
    const [k, v] = part.split("=");
    if (k && v) rule[k.toUpperCase()] = v.toUpperCase();
  }
  return rule;
}

const dayNumber = (y: number, mo: number, d: number) => Math.floor(Date.UTC(y, mo - 1, d) / DAY);
const weekdayOf = (dayNum: number) => (((dayNum + 4) % 7) + 7) % 7; // 1 Jan 1970 was a Thursday
const daysInMonth = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

/** Days in a month matching BYDAY entries such as "TU", "2TU" or "-1FR". */
function byDayInMonth(y: number, mo: number, byDay: string[], setPos: number | null): number[] {
  const total = daysInMonth(y, mo);
  const days = new Set<number>();
  for (const entry of byDay) {
    const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(entry);
    if (!m) continue;
    const weekday = WEEKDAYS.indexOf(m[2]!);
    const matches: number[] = [];
    for (let d = 1; d <= total; d++) if (weekdayOf(dayNumber(y, mo, d)) === weekday) matches.push(d);
    if (m[1]) {
      const n = Number(m[1]);
      const pick = n > 0 ? matches[n - 1] : matches[matches.length + n];
      if (pick) days.add(pick);
    } else {
      for (const d of matches) days.add(d);
    }
  }
  const sorted = [...days].sort((a, b) => a - b);
  if (setPos === null) return sorted;
  const pick = setPos > 0 ? sorted[setPos - 1] : sorted[sorted.length + setPos];
  return pick ? [pick] : [];
}

/** Local calendar dates (as day numbers) on which a recurring event starts, in order. */
function* recurrenceDays(start: DateValue, rule: Record<string, string>, skipToDay: number): Generator<number> {
  const freq = rule.FREQ;
  const interval = Math.max(1, Number(rule.INTERVAL ?? 1));
  const byDay = rule.BYDAY ? rule.BYDAY.split(",") : null;
  const byMonthDay = rule.BYMONTHDAY ? rule.BYMONTHDAY.split(",").map(Number) : null;
  const setPos = rule.BYSETPOS ? Number(rule.BYSETPOS) : null;
  const first = dayNumber(start.y, start.mo, start.d);
  // Jumping ahead is only safe when occurrences don't need counting from the start.
  const canSkip = !rule.COUNT && skipToDay > first;

  if (freq === "DAILY") {
    const allowed = byDay ? new Set(byDay.map((d) => WEEKDAYS.indexOf(d.slice(-2)))) : null;
    let n = canSkip ? Math.floor((skipToDay - first) / interval) : 0;
    for (; ; n++) {
      const day = first + n * interval;
      if (!allowed || allowed.has(weekdayOf(day))) yield day;
    }
  } else if (freq === "WEEKLY") {
    const weekStart = WEEKDAYS.indexOf(rule.WKST ?? "MO");
    const allowed = new Set(byDay ? byDay.map((d) => WEEKDAYS.indexOf(d.slice(-2))) : [weekdayOf(first)]);
    const firstWeek = first - ((weekdayOf(first) - weekStart + 7) % 7);
    let n = canSkip ? Math.floor((skipToDay - firstWeek) / (7 * interval)) : 0;
    for (; ; n++) {
      for (let offset = 0; offset < 7; offset++) {
        const day = firstWeek + n * 7 * interval + offset;
        if (day >= first && allowed.has(weekdayOf(day))) yield day;
      }
    }
  } else if (freq === "MONTHLY") {
    for (let n = 0; ; n++) {
      const index = start.y * 12 + (start.mo - 1) + n * interval;
      const y = Math.floor(index / 12);
      const mo = (index % 12) + 1;
      const total = daysInMonth(y, mo);
      let days: number[];
      if (byMonthDay) days = byMonthDay.map((d) => (d > 0 ? d : total + d + 1)).sort((a, b) => a - b);
      else if (byDay) days = byDayInMonth(y, mo, byDay, setPos);
      else days = [start.d];
      for (const d of days) {
        if (d < 1 || d > total) continue;
        const day = dayNumber(y, mo, d);
        if (day >= first) yield day;
      }
    }
  } else if (freq === "YEARLY") {
    const months = rule.BYMONTH ? rule.BYMONTH.split(",").map(Number) : [start.mo];
    for (let n = 0; ; n++) {
      const y = start.y + n * interval;
      for (const mo of [...months].sort((a, b) => a - b)) {
        const total = daysInMonth(y, mo);
        const days = byDay ? byDayInMonth(y, mo, byDay, setPos) : (byMonthDay ?? [start.d]);
        for (const d of days) {
          if (d < 1 || d > total) continue;
          const day = dayNumber(y, mo, d);
          if (day >= first) yield day;
        }
      }
    }
  }
}

function expand(event: ParsedEvent, excluded: Set<number>, opts: IcsOptions): Interval[] {
  const out: Interval[] = [];
  const rule = event.rrule!;
  const count = rule.COUNT ? Number(rule.COUNT) : Infinity;
  let until = Infinity;
  if (rule.UNTIL) {
    const parsed = parseDate(rule.UNTIL, undefined, event.start.tz);
    if (parsed) until = toUtc(parsed) + (parsed.isDate ? DAY - 1 : 0);
  }
  const skipToDay = Math.floor((opts.from - event.durationMs) / DAY) - 8;
  let seen = 0;
  let guard = 0;
  for (const day of recurrenceDays(event.start, rule, skipToDay)) {
    if (++guard > 20_000 || ++seen > count) break;
    const date = new Date(day * DAY);
    const start =
      zonedTimeToUtc(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
        event.start.h,
        event.start.mi,
        event.start.tz,
      ) +
      event.start.s * 1000;
    if (start > until || start >= opts.to) break;
    if (start + event.durationMs <= opts.from || excluded.has(start)) continue;
    out.push({ start, end: start + event.durationMs });
  }
  return out;
}

export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const current of sorted) {
    const last = out[out.length - 1];
    if (last && current.start <= last.end) last.end = Math.max(last.end, current.end);
    else out.push({ ...current });
  }
  return out;
}

function readEvent(props: Prop[], opts: IcsOptions): ParsedEvent | null {
  const find = (name: string) => props.find((p) => p.name === name);
  const startProp = find("DTSTART");
  const start = startProp && parseDate(startProp.value, startProp.params.TZID, opts.defaultTz);
  if (!start) return null;

  const startUtc = toUtc(start);
  const endProp = find("DTEND");
  const end = endProp && parseDate(endProp.value, endProp.params.TZID, opts.defaultTz);
  const durationProp = find("DURATION");
  let durationMs = start.isDate ? DAY : 0;
  if (end) durationMs = toUtc(end) - startUtc;
  else if (durationProp) durationMs = parseDuration(durationProp.value);

  const exdates: number[] = [];
  for (const prop of props) {
    if (prop.name !== "EXDATE") continue;
    for (const value of prop.value.split(",")) {
      const parsed = parseDate(value, prop.params.TZID, opts.defaultTz);
      if (parsed) exdates.push(toUtc(parsed));
    }
  }

  const recurrenceProp = find("RECURRENCE-ID");
  const recurrence = recurrenceProp && parseDate(recurrenceProp.value, recurrenceProp.params.TZID, opts.defaultTz);
  const rruleProp = find("RRULE");
  const free =
    find("STATUS")?.value.toUpperCase() === "CANCELLED" ||
    find("TRANSP")?.value.toUpperCase() === "TRANSPARENT" ||
    find("X-MICROSOFT-CDO-BUSYSTATUS")?.value.toUpperCase() === "FREE";

  return {
    uid: find("UID")?.value ?? "",
    start,
    durationMs,
    rrule: rruleProp ? parseRule(rruleProp.value) : null,
    exdates,
    recurrenceId: recurrence ? toUtc(recurrence) : null,
    skip: free || durationMs <= 0 || Boolean(opts.ignoreAllDay && start.isDate),
  };
}

/** Busy intervals between opts.from and opts.to from an iCalendar feed, with recurring events expanded. */
export function parseIcsBusy(text: string, opts: IcsOptions): Interval[] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const events: ParsedEvent[] = [];
  let current: Prop[] | null = null;
  let nested = 0;

  for (const line of lines) {
    if (line.startsWith("BEGIN:")) {
      if (current) nested++;
      else if (line === "BEGIN:VEVENT") current = [];
      continue;
    }
    if (line.startsWith("END:")) {
      if (nested) nested--;
      else if (current && line === "END:VEVENT") {
        const event = readEvent(current, opts);
        if (event) events.push(event);
        current = null;
      }
      continue;
    }
    if (current && !nested) {
      const prop = parseLine(line);
      if (prop) current.push(prop);
    }
  }

  // An edited or cancelled single occurrence replaces the one its series would generate.
  const replaced = new Map<string, Set<number>>();
  for (const event of events) {
    if (event.recurrenceId === null) continue;
    if (!replaced.has(event.uid)) replaced.set(event.uid, new Set());
    replaced.get(event.uid)!.add(event.recurrenceId);
  }

  const busy: Interval[] = [];
  for (const event of events) {
    if (event.skip) continue;
    if (event.rrule && event.recurrenceId === null) {
      const excluded = new Set([...event.exdates, ...(replaced.get(event.uid) ?? [])]);
      busy.push(...expand(event, excluded, opts));
    } else {
      const start = toUtc(event.start);
      const end = start + event.durationMs;
      if (start < opts.to && end > opts.from) busy.push({ start, end });
    }
  }
  return mergeIntervals(busy);
}
