import { Hono } from "hono";
import { DEFAULT_TEMPLATES, type EmailStyle, type EmailTemplate, type TemplateKind } from "../../shared/templates";
import { cleanFontName, DEFAULT_THEME, mergeDeep, type Theme } from "../../shared/theme";
import {
  DEFAULT_EVENT_CONFIG,
  EMAIL_SECRET_PATHS,
  type EmailSettings,
  type EventTypeConfig,
  type Question,
  type TimeWindow,
} from "../../shared/types";
import { getEventType, getSetting, listEventTypes, SETTING_DEFAULTS, setSetting } from "../db";
import type { AppContext } from "../env";
import { hashAuthKey, isAuthKey, requireAdmin } from "../lib/auth";
import { cancelBooking, findBooking, toAdminBooking, type BookingRow } from "../lib/bookings";
import { fetchIcs, syncCalendar, SYNC_HORIZON_DAYS, toCalendarRow, type CalendarDbRow } from "../lib/calendars";
import { addDnsRecords, addRoute, attachDomain, listZones, removeDomain, removeRoutes, TOKEN_TEMPLATE_URL } from "../lib/cloudflare";
import { renderEmail, SAMPLE_VARS } from "../lib/email-render";
import { emailConfigured, sendEmail } from "../lib/email-send";
import { accessToken, accountEmail, exchangeCode, googleAuthUrl, listCalendars, type GoogleAccountConfig } from "../lib/google";
import { buildInvite } from "../lib/ics-build";
import { ensureDomain, getDomain, verifyDomain } from "../lib/resend";
import { localDateKey } from "../lib/slots";
import { isEmail, isTimezone, keepSecrets, maskSecrets, randomId } from "../util";

const DAY = 86_400_000;
const RESERVED_SLUGS = new Set(["admin", "api", "booking", "assets", "embed.js"]);

/** An error whose message is safe to show in the admin panel. */
class InputError extends Error {}

export const adminRoutes = new Hono<AppContext>();

adminRoutes.use("*", requireAdmin);

adminRoutes.onError((error, c) => {
  if (error instanceof InputError) return c.json({ error: error.message }, 400);
  console.error(error);
  return c.json({ error: error instanceof Error ? error.message : "Something went wrong." }, 500);
});

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function cleanWindows(raw: unknown): TimeWindow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((w): w is TimeWindow => /^\d{2}:\d{2}$/.test(w?.start) && /^\d{2}:\d{2}$/.test(w?.end) && w.start < w.end)
    .map((w) => ({ start: w.start, end: w.end }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

function cleanConfig(raw: Partial<EventTypeConfig> = {}): EventTypeConfig {
  const d = DEFAULT_EVENT_CONFIG;
  // Every weekday is stored explicitly so a day switched off stays off.
  const weeklyHours: Record<string, TimeWindow[]> = {};
  for (let day = 0; day < 7; day++) weeklyHours[day] = cleanWindows(raw.weeklyHours?.[day]);
  const dateOverrides: Record<string, TimeWindow[]> = {};
  for (const [date, windows] of Object.entries(raw.dateOverrides ?? {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) dateOverrides[date] = cleanWindows(windows);
  }
  const questions: Question[] = (Array.isArray(raw.questions) ? raw.questions : [])
    .filter((q) => q && String(q.label ?? "").trim())
    .slice(0, 20)
    .map((q) => ({
      id: /^[a-z0-9]{4,32}$/.test(q.id) ? q.id : randomId(6),
      label: String(q.label).trim().slice(0, 200),
      type: (["text", "textarea", "select", "checkbox", "phone"] as const).includes(q.type) ? q.type : "text",
      required: Boolean(q.required),
      placeholder: String(q.placeholder ?? "").slice(0, 200),
      options: Array.isArray(q.options) ? q.options.map((o) => String(o).trim()).filter(Boolean).slice(0, 30) : [],
    }));
  const locationUrl = String(raw.locationUrl ?? "").trim();
  if (locationUrl && !/^https?:\/\/\S+$/.test(locationUrl)) {
    throw new InputError("The meeting link must start with https://");
  }
  return {
    slotStepMinutes: clamp(raw.slotStepMinutes, 5, 480, d.slotStepMinutes),
    bufferBeforeMinutes: clamp(raw.bufferBeforeMinutes, 0, 240, 0),
    bufferAfterMinutes: clamp(raw.bufferAfterMinutes, 0, 240, 0),
    minNoticeMinutes: clamp(raw.minNoticeMinutes, 0, 30 * 1440, d.minNoticeMinutes),
    maxDaysAhead: clamp(raw.maxDaysAhead, 1, SYNC_HORIZON_DAYS - 10, d.maxDaysAhead),
    maxPerDay: clamp(raw.maxPerDay, 0, 50, 0),
    weeklyHours,
    dateOverrides,
    locationUrl,
    locationLabel: String(raw.locationLabel ?? d.locationLabel).trim().slice(0, 80),
    questions,
    hostEmails: (Array.isArray(raw.hostEmails) ? raw.hostEmails : []).map((e) => String(e).trim().toLowerCase()).filter(isEmail).slice(0, 10),
    sendHostInvite: raw.sendHostInvite !== false,
    googleCalendarId: String(raw.googleCalendarId ?? ""),
    reminderMinutes: [...new Set((Array.isArray(raw.reminderMinutes) ? raw.reminderMinutes : []).map((m) => clamp(m, 5, 7 * 1440, 60)))].slice(0, 3),
  };
}

function cleanEventType(body: Record<string, unknown>) {
  const title = String(body.title ?? "").trim().slice(0, 120);
  if (!title) throw new InputError("Please give the meeting type a name.");
  const slug = String(body.slug ?? title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (!slug || RESERVED_SLUGS.has(slug)) throw new InputError("Please choose a different link name.");
  return {
    slug,
    title,
    description: String(body.description ?? "").trim().slice(0, 2000),
    durationMinutes: clamp(body.durationMinutes, 5, 480, 30),
    active: body.active !== false,
    config: cleanConfig(body.config as Partial<EventTypeConfig>),
  };
}

// ---- Dashboard ----

adminRoutes.get("/dashboard", async (c) => {
  const db = c.env.DB;
  const now = Date.now();
  const since = now - 30 * DAY;
  const [general, email, counts, created, byType, next, calendars, eventTypes, failed] = await Promise.all([
    getSetting(db, "general"),
    getSetting(db, "email"),
    db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'confirmed' AND start_utc > ?1 THEN 1 ELSE 0 END) AS upcoming,
           SUM(CASE WHEN status = 'confirmed' AND start_utc > ?1 AND start_utc < ?2 THEN 1 ELSE 0 END) AS week,
           SUM(CASE WHEN created_at > ?3 THEN 1 ELSE 0 END) AS booked30,
           SUM(CASE WHEN created_at > ?3 AND status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled30
         FROM bookings`,
      )
      .bind(now, now + 7 * DAY, since)
      .first<{ upcoming: number | null; week: number | null; booked30: number | null; cancelled30: number | null }>(),
    db.prepare(`SELECT created_at FROM bookings WHERE created_at > ?`).bind(since).all<{ created_at: number }>(),
    db
      .prepare(
        `SELECT e.title AS title, COUNT(*) AS count FROM bookings b JOIN event_types e ON e.id = b.event_type_id
         WHERE b.created_at > ? GROUP BY e.id ORDER BY count DESC`,
      )
      .bind(since)
      .all<{ title: string; count: number }>(),
    db
      .prepare(`SELECT * FROM bookings WHERE status = 'confirmed' AND start_utc > ? ORDER BY start_utc LIMIT 5`)
      .bind(now)
      .all<BookingRow>(),
    db.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN last_error IS NOT NULL THEN 1 ELSE 0 END) AS errors FROM calendars`).first<{ n: number; errors: number | null }>(),
    listEventTypes(db),
    db.prepare(`SELECT COUNT(*) AS n FROM email_log WHERE status = 'failed' AND created_at > ?`).bind(now - 7 * DAY).first<{ n: number }>(),
  ]);

  const perDay = new Map<string, number>();
  for (const row of created.results) {
    const key = localDateKey(row.created_at, general.timezone);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  const series: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const date = localDateKey(now - i * DAY, general.timezone);
    series.push({ date, count: perDay.get(date) ?? 0 });
  }
  const types = new Map(eventTypes.map((e) => [e.id, e]));

  return c.json({
    stats: {
      upcoming: counts?.upcoming ?? 0,
      week: counts?.week ?? 0,
      booked30: counts?.booked30 ?? 0,
      cancelled30: counts?.cancelled30 ?? 0,
    },
    series,
    byType: byType.results,
    next: next.results.flatMap((row) => {
      const eventType = types.get(row.event_type_id);
      return eventType ? [toAdminBooking(row, eventType)] : [];
    }),
    checklist: {
      eventType: eventTypes.some((e) => e.active),
      calendar: (calendars?.n ?? 0) > 0,
      email: emailConfigured(email),
      domain: Boolean(general.publicUrl) && !new URL(general.publicUrl).hostname.endsWith(".workers.dev") && !/^(localhost|127\.)/.test(new URL(general.publicUrl).hostname),
    },
    warnings: { calendarErrors: calendars?.errors ?? 0, failedEmails: failed?.n ?? 0 },
    publicUrl: general.publicUrl,
    timezone: general.timezone,
  });
});

// ---- Meeting types ----

adminRoutes.get("/event-types", async (c) => c.json({ eventTypes: await listEventTypes(c.env.DB) }));

adminRoutes.post("/event-types", async (c) => {
  const input = cleanEventType(await c.req.json());
  if (await getEventType(c.env.DB, "slug", input.slug)) throw new InputError("Another meeting type already uses that link name.");
  const id = randomId();
  const position = (await c.env.DB.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM event_types`).first<{ p: number }>())!.p;
  await c.env.DB.prepare(
    `INSERT INTO event_types (id, slug, title, description, duration_minutes, config, active, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, input.slug, input.title, input.description, input.durationMinutes, JSON.stringify(input.config), input.active ? 1 : 0, position, Date.now())
    .run();
  return c.json({ eventType: await getEventType(c.env.DB, "id", id) });
});

adminRoutes.put("/event-types/:id", async (c) => {
  const id = c.req.param("id");
  const input = cleanEventType(await c.req.json());
  const clash = await getEventType(c.env.DB, "slug", input.slug);
  if (clash && clash.id !== id) throw new InputError("Another meeting type already uses that link name.");
  await c.env.DB.prepare(
    `UPDATE event_types SET slug = ?, title = ?, description = ?, duration_minutes = ?, config = ?, active = ? WHERE id = ?`,
  )
    .bind(input.slug, input.title, input.description, input.durationMinutes, JSON.stringify(input.config), input.active ? 1 : 0, id)
    .run();
  return c.json({ eventType: await getEventType(c.env.DB, "id", id) });
});

adminRoutes.delete("/event-types/:id", async (c) => {
  const id = c.req.param("id");
  const used = await c.env.DB.prepare(`SELECT 1 AS x FROM bookings WHERE event_type_id = ? LIMIT 1`).bind(id).first();
  if (used) throw new InputError("This meeting type has bookings, so it can't be deleted. Switch it off instead.");
  await c.env.DB.prepare(`DELETE FROM event_types WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

adminRoutes.post("/event-types/reorder", async (c) => {
  const { ids } = await c.req.json<{ ids: string[] }>();
  if (!Array.isArray(ids) || !ids.length) return c.json({ ok: true });
  await c.env.DB.batch(ids.map((id, i) => c.env.DB.prepare(`UPDATE event_types SET position = ? WHERE id = ?`).bind(i, String(id))));
  return c.json({ ok: true });
});

// ---- Bookings ----

adminRoutes.get("/bookings", async (c) => {
  const scope = c.req.query("scope") ?? "upcoming";
  const now = Date.now();
  const where =
    scope === "past"
      ? `status = 'confirmed' AND start_utc <= ?1 ORDER BY start_utc DESC`
      : scope === "cancelled"
        ? `status = 'cancelled' AND ?1 > 0 ORDER BY start_utc DESC`
        : `status = 'confirmed' AND start_utc > ?1 ORDER BY start_utc`;
  const { results } = await c.env.DB.prepare(`SELECT * FROM bookings WHERE ${where} LIMIT 200`).bind(now).all<BookingRow>();
  const types = new Map((await listEventTypes(c.env.DB)).map((e) => [e.id, e]));
  return c.json({
    bookings: results.flatMap((row) => {
      const eventType = types.get(row.event_type_id);
      return eventType ? [toAdminBooking(row, eventType)] : [];
    }),
  });
});

adminRoutes.post("/bookings/:id/cancel", async (c) => {
  const found = await findBooking(c.env.DB, "id", c.req.param("id"));
  if (!found) throw new InputError("Booking not found.");
  const { reason } = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  await cancelBooking(c.env.DB, c.get("baseUrl"), found.row, found.eventType, String(reason ?? ""));
  return c.json({ ok: true });
});

adminRoutes.get("/email-log", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT recipient, subject, kind, status, error, created_at AS createdAt FROM email_log ORDER BY created_at DESC LIMIT 50`,
  ).all();
  return c.json({ log: results });
});

// ---- Settings ----

adminRoutes.get("/settings", async (c) => {
  const db = c.env.DB;
  const [general, site, email, templates, emailStyle, google, cloudflare, me] = await Promise.all([
    getSetting(db, "general"),
    getSetting(db, "site"),
    getSetting(db, "email"),
    getSetting(db, "templates"),
    getSetting(db, "emailStyle"),
    getSetting(db, "google"),
    getSetting(db, "cloudflare"),
    db.prepare(`SELECT id, email, name FROM users WHERE id = ?`).bind(c.get("userId")).first(),
  ]);
  return c.json({
    general,
    site,
    email: maskSecrets(email, EMAIL_SECRET_PATHS),
    emailReady: emailConfigured(email),
    templates,
    emailStyle,
    google: maskSecrets(google, ["clientSecret"]),
    cloudflare: maskSecrets(cloudflare, ["apiToken"]),
    tokenTemplateUrl: TOKEN_TEMPLATE_URL,
    me,
  });
});

adminRoutes.put("/settings/general", async (c) => {
  const body = await c.req.json<Record<string, string>>();
  const stored = await getSetting(c.env.DB, "general");
  if (!isTimezone(body.timezone)) throw new InputError("Please choose a valid timezone.");
  if (body.ownerEmail && !isEmail(body.ownerEmail)) throw new InputError("Please enter a valid email address.");
  const publicUrl = String(body.publicUrl ?? stored.publicUrl).trim().replace(/\/+$/, "");
  if (publicUrl && !/^https?:\/\/[^\s/]+(\/\S*)?$/.test(publicUrl)) throw new InputError("The public address must start with https://");
  const basePath = String(body.basePath ?? stored.basePath).trim().replace(/\/+$/, "");
  if (basePath && !/^\/[a-z0-9\-/]+$/i.test(basePath)) throw new InputError("The path must look like /book");
  await setSetting(c.env.DB, "general", {
    businessName: String(body.businessName ?? "").trim().slice(0, 120),
    timezone: body.timezone,
    ownerEmail: String(body.ownerEmail ?? stored.ownerEmail).trim().toLowerCase(),
    publicUrl,
    basePath,
    workerName: String(body.workerName ?? stored.workerName).trim(),
  });
  return c.json({ ok: true });
});

adminRoutes.put("/settings/site", async (c) => {
  const theme = mergeDeep<Theme>(DEFAULT_THEME, await c.req.json());
  // The CSS is written into a <style> tag, so it must not be able to close it.
  theme.customCss = String(theme.customCss).slice(0, 20_000).replace(/<\/?style/gi, "");
  theme.customFonts = (Array.isArray(theme.customFonts) ? theme.customFonts : [])
    .map((f) => ({ name: cleanFontName(String(f?.name ?? "")), assetId: String(f?.assetId ?? "") }))
    .filter((f) => f.name && /^[0-9a-f]+$/.test(f.assetId))
    .slice(0, 8);
  theme.font = cleanFontName(theme.font) || "system";
  theme.headingFont = cleanFontName(theme.headingFont) || "system";
  await setSetting(c.env.DB, "site", theme);
  return c.json({ ok: true });
});

adminRoutes.put("/settings/email", async (c) => {
  const stored = await getSetting(c.env.DB, "email");
  const next = keepSecrets(mergeDeep<EmailSettings>(SETTING_DEFAULTS.email, await c.req.json()), stored, EMAIL_SECRET_PATHS);
  if (next.fromEmail && !isEmail(next.fromEmail)) throw new InputError("Please enter a valid sender address.");
  if (next.replyTo && !isEmail(next.replyTo)) throw new InputError("Please enter a valid reply-to address.");
  next.smtp.port = clamp(next.smtp.port, 1, 65535, 465);
  if (next.resend.apiKey !== stored.resend.apiKey) next.resend.domainId = "";
  await setSetting(c.env.DB, "email", next);
  return c.json({ ok: true, emailReady: emailConfigured(next) });
});

adminRoutes.put("/settings/templates", async (c) => {
  await setSetting(c.env.DB, "templates", mergeDeep(DEFAULT_TEMPLATES, await c.req.json()));
  return c.json({ ok: true });
});

adminRoutes.put("/settings/emailStyle", async (c) => {
  await setSetting(c.env.DB, "emailStyle", mergeDeep(SETTING_DEFAULTS.emailStyle, await c.req.json()));
  return c.json({ ok: true });
});

adminRoutes.put("/settings/google", async (c) => {
  const stored = await getSetting(c.env.DB, "google");
  const body = await c.req.json<{ clientId?: string; clientSecret?: string }>();
  await setSetting(c.env.DB, "google", {
    clientId: String(body.clientId ?? "").trim(),
    clientSecret: String(body.clientSecret ?? "").trim() || stored.clientSecret,
  });
  return c.json({ ok: true });
});

// ---- Images ----

const UPLOAD_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "font/woff2",
  "font/woff",
  "font/ttf",
  "font/otf",
];

adminRoutes.post("/assets", async (c) => {
  const type = (c.req.header("Content-Type") ?? "").split(";")[0]!.trim();
  if (!UPLOAD_TYPES.includes(type)) throw new InputError("Please use a PNG, JPG, WebP, GIF or SVG image, or a WOFF2, WOFF, TTF or OTF font.");
  const data = await c.req.arrayBuffer();
  if (data.byteLength > 1_500_000) throw new InputError("That file is too large. Please use one under 1.5 MB.");
  const id = randomId();
  await c.env.DB.prepare(`INSERT INTO assets (id, content_type, data, created_at) VALUES (?, ?, ?, ?)`).bind(id, type, data, Date.now()).run();
  return c.json({ id });
});

// ---- Calendars ----

async function calendarRows(db: D1Database) {
  const { results } = await db.prepare(`SELECT * FROM calendars ORDER BY created_at`).all<CalendarDbRow>();
  return results;
}

adminRoutes.get("/calendars", async (c) => c.json({ calendars: (await calendarRows(c.env.DB)).map(toCalendarRow) }));

adminRoutes.post("/calendars", async (c) => {
  const body = await c.req.json<{ label?: string; url?: string; ignoreAllDay?: boolean }>();
  const url = String(body.url ?? "").trim().replace(/^webcal:/i, "https:");
  if (!/^https?:\/\/\S+$/.test(url)) throw new InputError("Please paste the calendar link. It starts with https:// or webcal://");
  try {
    await fetchIcs(url);
  } catch (error) {
    throw new InputError(error instanceof Error ? error.message : "That calendar link could not be read.");
  }
  const id = randomId();
  await c.env.DB.prepare(`INSERT INTO calendars (id, kind, label, config, blocks, created_at) VALUES (?, 'ics', ?, ?, 1, ?)`)
    .bind(id, String(body.label ?? "").trim().slice(0, 80) || "Calendar", JSON.stringify({ url, ignoreAllDay: Boolean(body.ignoreAllDay) }), Date.now())
    .run();
  const row = (await c.env.DB.prepare(`SELECT * FROM calendars WHERE id = ?`).bind(id).first<CalendarDbRow>())!;
  await syncCalendar(c.env.DB, row);
  return c.json({ ok: true });
});

adminRoutes.patch("/calendars/:id", async (c) => {
  const row = await c.env.DB.prepare(`SELECT * FROM calendars WHERE id = ?`).bind(c.req.param("id")).first<CalendarDbRow>();
  if (!row) throw new InputError("Calendar not found.");
  const body = await c.req.json<Record<string, unknown>>();
  const config = JSON.parse(row.config) as Record<string, unknown>;
  if (row.kind === "ics") {
    if (typeof body.ignoreAllDay === "boolean") config.ignoreAllDay = body.ignoreAllDay;
  } else {
    const known = new Set((config.calendars as { id: string }[]).map((cal) => cal.id));
    if (Array.isArray(body.blockingIds)) config.blockingIds = body.blockingIds.filter((id) => known.has(String(id)));
    if (typeof body.writeId === "string" && (known.has(body.writeId) || body.writeId === "")) config.writeId = body.writeId;
  }
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : row.label;
  const blocks = typeof body.blocks === "boolean" ? (body.blocks ? 1 : 0) : row.blocks;
  await c.env.DB.prepare(`UPDATE calendars SET label = ?, blocks = ?, config = ? WHERE id = ?`).bind(label, blocks, JSON.stringify(config), row.id).run();
  await syncCalendar(c.env.DB, { ...row, label, blocks, config: JSON.stringify(config) });
  return c.json({ ok: true });
});

adminRoutes.post("/calendars/:id/sync", async (c) => {
  const row = await c.env.DB.prepare(`SELECT * FROM calendars WHERE id = ?`).bind(c.req.param("id")).first<CalendarDbRow>();
  if (!row) throw new InputError("Calendar not found.");
  await syncCalendar(c.env.DB, row);
  return c.json({ ok: true });
});

adminRoutes.delete("/calendars/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM busy_intervals WHERE calendar_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM calendars WHERE id = ?`).bind(id),
  ]);
  return c.json({ ok: true });
});

// ---- Google account connection ----

const googleRedirect = (baseUrl: string) => `${baseUrl}/api/admin/google/callback`;

adminRoutes.get("/google/start", async (c) => {
  const creds = await getSetting(c.env.DB, "google");
  if (!creds.clientId || !creds.clientSecret) throw new InputError("Add your Google client ID and secret first.");
  const state = randomId(16);
  await setSetting(c.env.DB, "oauthState", { value: state, expires: Date.now() + 10 * 60_000 });
  return c.json({ url: googleAuthUrl(creds, googleRedirect(c.get("baseUrl")), state) });
});

adminRoutes.get("/google/callback", async (c) => {
  const baseUrl = c.get("baseUrl");
  const back = (params: string) => c.redirect(`${baseUrl}/admin/calendars?${params}`);
  try {
    const expected = await getSetting(c.env.DB, "oauthState");
    if (!c.req.query("state") || c.req.query("state") !== expected.value || expected.expires < Date.now()) {
      throw new Error("The sign-in link expired. Please try again.");
    }
    await setSetting(c.env.DB, "oauthState", { value: "", expires: 0 });
    const code = c.req.query("code");
    if (!code) throw new Error(c.req.query("error") ?? "Google did not return a sign-in code.");
    const creds = await getSetting(c.env.DB, "google");
    const tokens = await exchangeCode(creds, googleRedirect(baseUrl), code);
    if (!tokens.refresh_token) throw new Error("Google did not grant long-term access. Remove BKNG at myaccount.google.com/permissions and try again.");
    const [email, calendars] = await Promise.all([accountEmail(tokens.access_token), listCalendars(tokens.access_token)]);
    const primary = calendars.find((cal) => cal.primary) ?? calendars[0];
    const config: GoogleAccountConfig = {
      email,
      refreshToken: tokens.refresh_token,
      calendars: calendars.map((cal) => ({ id: cal.id, name: cal.name })),
      blockingIds: primary ? [primary.id] : [],
      writeId: primary?.writable ? primary.id : "",
    };
    const id = randomId();
    await c.env.DB.prepare(`INSERT INTO calendars (id, kind, label, config, blocks, created_at) VALUES (?, 'google', ?, ?, 1, ?)`)
      .bind(id, email, JSON.stringify(config), Date.now())
      .run();
    const row = (await c.env.DB.prepare(`SELECT * FROM calendars WHERE id = ?`).bind(id).first<CalendarDbRow>())!;
    await syncCalendar(c.env.DB, row);
    return back("connected=1");
  } catch (error) {
    return back(`error=${encodeURIComponent(error instanceof Error ? error.message : String(error))}`);
  }
});

adminRoutes.post("/google/refresh/:id", async (c) => {
  const row = await c.env.DB.prepare(`SELECT * FROM calendars WHERE id = ? AND kind = 'google'`).bind(c.req.param("id")).first<CalendarDbRow>();
  if (!row) throw new InputError("Calendar not found.");
  const config = JSON.parse(row.config) as GoogleAccountConfig;
  const token = await accessToken(await getSetting(c.env.DB, "google"), config.refreshToken);
  config.calendars = (await listCalendars(token)).map((cal) => ({ id: cal.id, name: cal.name }));
  await c.env.DB.prepare(`UPDATE calendars SET config = ? WHERE id = ?`).bind(JSON.stringify(config), row.id).run();
  return c.json({ ok: true });
});

// ---- Email ----

adminRoutes.post("/email/preview", async (c) => {
  const body = await c.req.json<{ kind: TemplateKind; template?: EmailTemplate; style?: EmailStyle }>();
  const [general, theme, templates, style] = await Promise.all([
    getSetting(c.env.DB, "general"),
    getSetting(c.env.DB, "site"),
    getSetting(c.env.DB, "templates"),
    getSetting(c.env.DB, "emailStyle"),
  ]);
  const template = mergeDeep(templates[body.kind] ?? DEFAULT_TEMPLATES.booker_confirmation, body.template);
  const publicUrl = general.publicUrl || c.get("baseUrl");
  const rendered = renderEmail({
    template,
    style: mergeDeep(style, body.style),
    theme,
    vars: { ...SAMPLE_VARS, business_name: general.businessName || SAMPLE_VARS.business_name, timezone: general.timezone },
    buttonUrl: `${publicUrl}/booking/sample`,
    logoUrl: theme.logoAssetId ? `${publicUrl}/api/assets/${theme.logoAssetId}` : "",
  });
  return c.json({ subject: rendered.subject, html: rendered.html });
});

adminRoutes.post("/email/test", async (c) => {
  const { to } = await c.req.json<{ to?: string }>();
  if (!isEmail(to)) throw new InputError("Please enter an address to send the test to.");
  const [general, theme, templates, style, email] = await Promise.all([
    getSetting(c.env.DB, "general"),
    getSetting(c.env.DB, "site"),
    getSetting(c.env.DB, "templates"),
    getSetting(c.env.DB, "emailStyle"),
    getSetting(c.env.DB, "email"),
  ]);
  const publicUrl = general.publicUrl || c.get("baseUrl");
  const start = Math.ceil(Date.now() / 3_600_000) * 3_600_000 + DAY;
  const rendered = renderEmail({
    template: templates.booker_confirmation,
    style,
    theme,
    vars: { ...SAMPLE_VARS, business_name: general.businessName || SAMPLE_VARS.business_name, timezone: general.timezone },
    buttonUrl: `${publicUrl}/booking/sample`,
    logoUrl: theme.logoAssetId ? `${publicUrl}/api/assets/${theme.logoAssetId}` : "",
  });
  try {
    await sendEmail(email, {
      to,
      ...rendered,
      subject: `[Test] ${rendered.subject}`,
      ics: {
        method: "REQUEST",
        content: buildInvite({
          method: "REQUEST",
          uid: `test-${randomId(6)}@bkng`,
          sequence: 0,
          start,
          end: start + 30 * 60_000,
          summary: "Test booking",
          description: "This is a test invite from your booking page.",
          location: "",
          organizer: { name: general.businessName || "Bookings", email: email.fromEmail },
          attendees: [{ name: to, email: to }],
        }),
      },
    });
  } catch (error) {
    throw new InputError(`The test email could not be sent. ${error instanceof Error ? error.message : error}`);
  }
  return c.json({ ok: true });
});

async function resendKey(db: D1Database): Promise<{ email: EmailSettings; key: string }> {
  const email = await getSetting(db, "email");
  if (!email.resend.apiKey) throw new InputError("Save your Resend API key first.");
  return { email, key: email.resend.apiKey };
}

adminRoutes.post("/email/domain", async (c) => {
  const { email, key } = await resendKey(c.env.DB);
  const domain = String((await c.req.json<{ domain?: string }>()).domain ?? "").trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new InputError("Please enter a domain like example.com");
  const status = await ensureDomain(key, domain).catch((error) => {
    throw new InputError(`Resend could not add the domain. ${error.message}`);
  });
  await setSetting(c.env.DB, "email", { ...email, resend: { ...email.resend, domainId: status.id } });
  return c.json({ domain: status });
});

adminRoutes.get("/email/domain", async (c) => {
  const email = await getSetting(c.env.DB, "email");
  if (!email.resend.apiKey || !email.resend.domainId) return c.json({ domain: null });
  return c.json({ domain: await getDomain(email.resend.apiKey, email.resend.domainId).catch(() => null) });
});

adminRoutes.post("/email/domain/verify", async (c) => {
  const { email, key } = await resendKey(c.env.DB);
  if (!email.resend.domainId) throw new InputError("Add your domain first.");
  await verifyDomain(key, email.resend.domainId).catch(() => {});
  return c.json({ domain: await getDomain(key, email.resend.domainId) });
});

adminRoutes.post("/email/domain/dns", async (c) => {
  const { email, key } = await resendKey(c.env.DB);
  const cloudflare = await getSetting(c.env.DB, "cloudflare");
  if (!cloudflare.apiToken) throw new InputError("Connect Cloudflare on the Domain page first.");
  if (!email.resend.domainId) throw new InputError("Add your domain first.");
  const domain = await getDomain(key, email.resend.domainId);
  const zone = (await listZones(cloudflare.apiToken)).find((z) => domain.name === z.name || domain.name.endsWith(`.${z.name}`));
  if (!zone) throw new InputError(`${domain.name} is not in your Cloudflare account, so the records need adding by hand.`);
  const added = await addDnsRecords(cloudflare.apiToken, zone, domain.records);
  await verifyDomain(key, domain.id).catch(() => {});
  return c.json({ added, domain: await getDomain(key, domain.id) });
});

// ---- Cloudflare: custom domain ----

adminRoutes.post("/cloudflare/token", async (c) => {
  const token = String((await c.req.json<{ token?: string }>()).token ?? "").trim();
  const stored = await getSetting(c.env.DB, "cloudflare");
  const apiToken = token || stored.apiToken;
  if (!apiToken) throw new InputError("Please paste the token.");
  const zones = await listZones(apiToken).catch((error) => {
    throw new InputError(`Cloudflare did not accept that token. ${error.message}`);
  });
  await setSetting(c.env.DB, "cloudflare", { ...stored, apiToken });
  return c.json({ zones });
});

adminRoutes.get("/cloudflare/zones", async (c) => {
  const { apiToken } = await getSetting(c.env.DB, "cloudflare");
  if (!apiToken) return c.json({ zones: [] });
  return c.json({ zones: await listZones(apiToken).catch(() => []) });
});

adminRoutes.post("/cloudflare/connect", async (c) => {
  const body = await c.req.json<{ zoneId?: string; hostname?: string; path?: string; workerName?: string }>();
  const cloudflare = await getSetting(c.env.DB, "cloudflare");
  const general = await getSetting(c.env.DB, "general");
  if (!cloudflare.apiToken) throw new InputError("Connect Cloudflare first.");
  const zone = (await listZones(cloudflare.apiToken)).find((z) => z.id === body.zoneId);
  if (!zone) throw new InputError("Please choose a domain.");
  const hostname = String(body.hostname ?? "").trim().toLowerCase();
  if (hostname !== zone.name && !hostname.endsWith(`.${zone.name}`)) throw new InputError(`The address must be ${zone.name} or end in .${zone.name}`);
  const path = String(body.path ?? "").trim().replace(/\/+$/, "");
  if (path && !/^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/i.test(path)) throw new InputError("The path must look like /book");
  const workerName = String(body.workerName ?? general.workerName).trim();
  if (!workerName) throw new InputError("Please enter the name of this Worker, as shown in your Cloudflare dashboard.");

  try {
    if (path) await addRoute(cloudflare.apiToken, zone.id, `${hostname}${path}*`, workerName);
    else await attachDomain(cloudflare.apiToken, zone.accountId, zone.id, hostname, workerName);
  } catch (error) {
    throw new InputError(`Cloudflare could not connect the address. ${error instanceof Error ? error.message : error}`);
  }
  await setSetting(c.env.DB, "cloudflare", { ...cloudflare, accountId: zone.accountId, zoneId: zone.id, hostname, mode: path ? "path" : "domain" });
  await setSetting(c.env.DB, "general", { ...general, workerName, basePath: path, publicUrl: `https://${hostname}${path}` });
  return c.json({ publicUrl: `https://${hostname}${path}` });
});

adminRoutes.post("/cloudflare/disconnect", async (c) => {
  const cloudflare = await getSetting(c.env.DB, "cloudflare");
  const general = await getSetting(c.env.DB, "general");
  try {
    if (cloudflare.mode === "path") await removeRoutes(cloudflare.apiToken, cloudflare.zoneId, general.workerName);
    if (cloudflare.mode === "domain") await removeDomain(cloudflare.apiToken, cloudflare.accountId, cloudflare.hostname);
  } catch (error) {
    throw new InputError(`Cloudflare could not remove the address. ${error instanceof Error ? error.message : error}`);
  }
  await setSetting(c.env.DB, "cloudflare", { ...cloudflare, zoneId: "", hostname: "", mode: "" });
  await setSetting(c.env.DB, "general", { ...general, basePath: "", publicUrl: c.get("baseUrl") });
  return c.json({ ok: true });
});

// ---- Team ----

adminRoutes.get("/users", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT id, email, name FROM users ORDER BY created_at`).all();
  return c.json({ users: results });
});

adminRoutes.post("/users", async (c) => {
  const body = await c.req.json<Record<string, string>>();
  const name = String(body.name ?? "").trim();
  if (!name) throw new InputError("Please enter a name.");
  if (!isEmail(body.email)) throw new InputError("Please enter a valid email address.");
  if (!isAuthKey(body.authKey)) throw new InputError("Please choose a password.");
  const email = body.email.trim().toLowerCase();
  if (await c.env.DB.prepare(`SELECT 1 AS x FROM users WHERE email = ?`).bind(email).first()) {
    throw new InputError("Someone with that email already has access.");
  }
  const salt = randomId(16);
  await c.env.DB.prepare(`INSERT INTO users (id, email, name, pass_hash, pass_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(randomId(), email, name, await hashAuthKey(body.authKey, salt), salt, Date.now())
    .run();
  return c.json({ ok: true });
});

adminRoutes.delete("/users/:id", async (c) => {
  const id = c.req.param("id");
  if (id === c.get("userId")) throw new InputError("You can't remove yourself.");
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(id),
  ]);
  return c.json({ ok: true });
});

adminRoutes.post("/password", async (c) => {
  const { authKey } = await c.req.json<{ authKey?: string }>();
  if (!isAuthKey(authKey)) throw new InputError("Please choose a password.");
  const salt = randomId(16);
  await c.env.DB.prepare(`UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?`)
    .bind(await hashAuthKey(authKey, salt), salt, c.get("userId"))
    .run();
  return c.json({ ok: true });
});
