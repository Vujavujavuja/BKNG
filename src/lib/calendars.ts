import type { CalendarRow } from "../../shared/types";
import { getSetting } from "../db";
import { accessToken, freeBusy, type GoogleAccountConfig } from "./google";
import { mergeIntervals, parseIcsBusy } from "./ics-parse";
import type { Interval } from "./slots";

const DAY = 86_400_000;
/** How far ahead busy time is cached. Booking windows are capped below this. */
export const SYNC_HORIZON_DAYS = 190;

export interface CalendarDbRow {
  id: string;
  kind: "ics" | "google";
  label: string;
  config: string;
  blocks: number;
  last_synced: number | null;
  last_error: string | null;
}

export interface IcsConfig {
  url: string;
  ignoreAllDay: boolean;
}

export function toCalendarRow(row: CalendarDbRow): CalendarRow {
  const base = {
    id: row.id,
    kind: row.kind,
    label: row.label,
    blocks: row.blocks === 1,
    lastSynced: row.last_synced,
    lastError: row.last_error,
  };
  if (row.kind === "google") {
    const config = JSON.parse(row.config) as GoogleAccountConfig;
    return {
      ...base,
      account: config.email,
      calendars: config.calendars,
      blockingIds: config.blockingIds,
      writeId: config.writeId,
    };
  }
  return { ...base, ignoreAllDay: (JSON.parse(row.config) as IcsConfig).ignoreAllDay };
}

export async function fetchIcs(url: string): Promise<string> {
  const res = await fetch(url.trim().replace(/^webcal:/i, "https:"), {
    headers: { Accept: "text/calendar, text/plain, */*", "User-Agent": "BKNG calendar sync" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`The calendar link returned ${res.status}.`);
  const text = await res.text();
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error("That link did not return a calendar feed.");
  return text;
}

async function loadBusy(db: D1Database, row: CalendarDbRow, timezone: string, from: number, to: number): Promise<Interval[]> {
  if (row.kind === "ics") {
    const config = JSON.parse(row.config) as IcsConfig;
    return parseIcsBusy(await fetchIcs(config.url), { defaultTz: timezone, from, to, ignoreAllDay: config.ignoreAllDay });
  }
  const config = JSON.parse(row.config) as GoogleAccountConfig;
  if (!config.blockingIds.length) return [];
  const token = await accessToken(await getSetting(db, "google"), config.refreshToken);
  return mergeIntervals(await freeBusy(token, config.blockingIds, from, to));
}

/** Replaces the cached busy time for one calendar. Failures are recorded on the row, not thrown. */
export async function syncCalendar(db: D1Database, row: CalendarDbRow): Promise<void> {
  const now = Date.now();
  try {
    const { timezone } = await getSetting(db, "general");
    const busy = await loadBusy(db, row, timezone, now - DAY, now + SYNC_HORIZON_DAYS * DAY);
    const statements = [db.prepare(`DELETE FROM busy_intervals WHERE calendar_id = ?`).bind(row.id)];
    for (let i = 0; i < busy.length; i += 30) {
      const chunk = busy.slice(i, i + 30);
      statements.push(
        db
          .prepare(
            `INSERT INTO busy_intervals (calendar_id, start_utc, end_utc) VALUES ${chunk.map(() => "(?, ?, ?)").join(", ")}`,
          )
          .bind(...chunk.flatMap((b) => [row.id, b.start, b.end])),
      );
    }
    statements.push(
      db.prepare(`UPDATE calendars SET last_synced = ?, last_error = NULL WHERE id = ?`).bind(now, row.id),
    );
    await db.batch(statements);
  } catch (error) {
    // Keep the last good data: stale busy time is safer than none.
    await db
      .prepare(`UPDATE calendars SET last_synced = ?, last_error = ? WHERE id = ?`)
      .bind(now, error instanceof Error ? error.message : String(error), row.id)
      .run();
  }
}

/** Syncs calendars not refreshed within maxAgeMs, stalest first. */
export async function refreshCalendars(db: D1Database, maxAgeMs: number): Promise<void> {
  const { results } = await db
    .prepare(`SELECT * FROM calendars WHERE last_synced IS NULL OR last_synced < ? ORDER BY last_synced`)
    .bind(Date.now() - maxAgeMs)
    .all<CalendarDbRow>();
  for (const row of results) await syncCalendar(db, row);
}
