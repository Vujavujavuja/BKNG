import { DEFAULT_EMAIL_STYLE, DEFAULT_TEMPLATES, type EmailStyle, type EmailTemplates } from "../shared/templates";
import { DEFAULT_THEME, mergeDeep, type Theme } from "../shared/theme";
import {
  DEFAULT_EMAIL,
  DEFAULT_EVENT_CONFIG,
  DEFAULT_GENERAL,
  type EmailSettings,
  type EventType,
  type EventTypeConfig,
  type GeneralSettings,
} from "../shared/types";

// The app migrates its own database on first request, so installs and upgrades need no manual step.
// All timestamps are UTC epoch milliseconds. Append new migrations; never edit old ones.
const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      pass_hash TEXT NOT NULL,
      pass_salt TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      content_type TEXT NOT NULL,
      data BLOB NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS event_types (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      duration_minutes INTEGER NOT NULL,
      config TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    // kind = 'ics' covers Proton, Google's private link, iCloud and Outlook; kind = 'google' is a connected account.
    `CREATE TABLE IF NOT EXISTS calendars (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      config TEXT NOT NULL,
      blocks INTEGER NOT NULL DEFAULT 1,
      last_synced INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL
    )`,
    // Busy time cached from connected calendars, refreshed by cron and when slots are viewed.
    `CREATE TABLE IF NOT EXISTS busy_intervals (
      calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
      start_utc INTEGER NOT NULL,
      end_utc INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS busy_intervals_range ON busy_intervals (start_utc, end_utc)`,
    `CREATE INDEX IF NOT EXISTS busy_intervals_calendar ON busy_intervals (calendar_id)`,
    `CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      event_type_id TEXT NOT NULL REFERENCES event_types(id),
      start_utc INTEGER NOT NULL,
      end_utc INTEGER NOT NULL,
      booker_name TEXT NOT NULL,
      booker_email TEXT NOT NULL,
      booker_tz TEXT NOT NULL,
      answers TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'confirmed',
      manage_token TEXT NOT NULL UNIQUE,
      sequence INTEGER NOT NULL DEFAULT 0,
      google_event_id TEXT NOT NULL DEFAULT '',
      reminders_sent TEXT NOT NULL DEFAULT '[]',
      cancel_reason TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS bookings_range ON bookings (start_utc, end_utc)`,
    // Last line of defence against two people taking the same slot.
    `CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_per_start ON bookings (start_utc) WHERE status = 'confirmed'`,
    `CREATE TABLE IF NOT EXISTS email_log (
      id TEXT PRIMARY KEY,
      booking_id TEXT,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS email_log_created ON email_log (created_at)`,
  ],
];

let ready: Promise<void> | null = null;

export function ensureDb(db: D1Database): Promise<void> {
  ready ??= migrate(db).catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}

async function migrate(db: D1Database): Promise<void> {
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`)
    .run();
  const row = await db.prepare(`SELECT MAX(version) AS v FROM _migrations`).first<{ v: number | null }>();
  for (let i = row?.v ?? 0; i < MIGRATIONS.length; i++) {
    await db.batch([
      ...MIGRATIONS[i]!.map((sql) => db.prepare(sql)),
      db.prepare(`INSERT OR IGNORE INTO _migrations (version, applied_at) VALUES (?, ?)`).bind(i + 1, Date.now()),
    ]);
  }
}

export interface SettingsMap {
  general: GeneralSettings;
  site: Theme;
  email: EmailSettings;
  templates: EmailTemplates;
  emailStyle: EmailStyle;
  google: { clientId: string; clientSecret: string };
  cloudflare: { apiToken: string; accountId: string; zoneId: string; hostname: string; mode: "" | "domain" | "path" };
  oauthState: { value: string; expires: number };
}

export const SETTING_DEFAULTS: SettingsMap = {
  general: DEFAULT_GENERAL,
  site: DEFAULT_THEME,
  email: DEFAULT_EMAIL,
  templates: DEFAULT_TEMPLATES,
  emailStyle: DEFAULT_EMAIL_STYLE,
  google: { clientId: "", clientSecret: "" },
  cloudflare: { apiToken: "", accountId: "", zoneId: "", hostname: "", mode: "" },
  oauthState: { value: "", expires: 0 },
};

export async function getSetting<K extends keyof SettingsMap>(db: D1Database, key: K): Promise<SettingsMap[K]> {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = ?`).bind(key).first<{ value: string }>();
  return mergeDeep(SETTING_DEFAULTS[key], row ? JSON.parse(row.value) : undefined);
}

export async function setSetting<K extends keyof SettingsMap>(
  db: D1Database,
  key: K,
  value: SettingsMap[K],
): Promise<void> {
  await db
    .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(key, JSON.stringify(value))
    .run();
  cached = null;
}

// The public side reads these on every request, so keep a short per-isolate cache.
let cached: { at: number; general: GeneralSettings; site: Theme } | null = null;

export async function getPublicConfig(db: D1Database): Promise<{ general: GeneralSettings; site: Theme }> {
  if (cached && Date.now() - cached.at < 5000) return cached;
  const [general, site] = await Promise.all([getSetting(db, "general"), getSetting(db, "site")]);
  cached = { at: Date.now(), general, site };
  return cached;
}

interface EventTypeRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  duration_minutes: number;
  config: string;
  active: number;
  position: number;
}

export function toEventType(row: EventTypeRow): EventType {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    durationMinutes: row.duration_minutes,
    active: row.active === 1,
    position: row.position,
    config: mergeDeep<EventTypeConfig>(DEFAULT_EVENT_CONFIG, JSON.parse(row.config)),
  };
}

export async function listEventTypes(db: D1Database, activeOnly = false): Promise<EventType[]> {
  const { results } = await db
    .prepare(`SELECT * FROM event_types ${activeOnly ? "WHERE active = 1" : ""} ORDER BY position, created_at`)
    .all<EventTypeRow>();
  return results.map(toEventType);
}

export async function getEventType(db: D1Database, field: "id" | "slug", value: string): Promise<EventType | null> {
  const row = await db.prepare(`SELECT * FROM event_types WHERE ${field} = ?`).bind(value).first<EventTypeRow>();
  return row ? toEventType(row) : null;
}

/** Returns false once `limit` hits have been recorded for `key` in the current window. */
export async function rateLimit(db: D1Database, key: string, limit: number, windowMs: number): Promise<boolean> {
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
         window_start = excluded.window_start
       RETURNING count`,
    )
    .bind(key, windowStart)
    .first<{ count: number }>();
  return (row?.count ?? 1) <= limit;
}
