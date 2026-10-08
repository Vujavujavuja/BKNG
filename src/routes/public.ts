import { Hono } from "hono";
import type { PublicEventType } from "../../shared/types";
import { getEventType, getPublicConfig, listEventTypes, rateLimit } from "../db";
import type { AppContext } from "../env";
import {
  afterCreate,
  afterReschedule,
  BookingError,
  cancelBooking,
  createBooking,
  findBooking,
  rescheduleBooking,
  slotsFor,
  toBookingView,
} from "../lib/bookings";
import { refreshCalendars } from "../lib/calendars";
import { buildInvite } from "../lib/ics-build";
import type { EventType } from "../../shared/types";

const DAY = 86_400_000;

const toPublic = (e: EventType): PublicEventType => ({
  slug: e.slug,
  title: e.title,
  description: e.description,
  durationMinutes: e.durationMinutes,
  locationLabel: e.config.locationLabel,
  questions: e.config.questions,
});

export const publicRoutes = new Hono<AppContext>();

publicRoutes.onError((error, c) => {
  if (error instanceof BookingError) return c.json({ error: error.message }, error.status);
  console.error(error);
  return c.json({ error: "Something went wrong. Please try again." }, 500);
});

publicRoutes.get("/site", async (c) => {
  const [{ general, site }, eventTypes] = await Promise.all([getPublicConfig(c.env.DB), listEventTypes(c.env.DB, true)]);
  return c.json({
    businessName: general.businessName,
    timezone: general.timezone,
    theme: site,
    eventTypes: eventTypes.map(toPublic),
  });
});

publicRoutes.get("/event-types/:slug/slots", async (c) => {
  const eventType = await getEventType(c.env.DB, "slug", c.req.param("slug"));
  if (!eventType?.active) return c.json({ error: "Not found." }, 404);
  const from = Number(c.req.query("from"));
  const to = Number(c.req.query("to"));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 45 * DAY) {
    return c.json({ error: "Invalid date range." }, 400);
  }
  // Someone is looking at times, so bring calendar data up to date in the background.
  c.executionCtx.waitUntil(refreshCalendars(c.env.DB, 3 * 60_000));

  let exclude = "";
  const rescheduling = c.req.query("booking");
  if (rescheduling) exclude = (await findBooking(c.env.DB, "manage_token", rescheduling))?.row.id ?? "";
  const { general } = await getPublicConfig(c.env.DB);
  return c.json({ slots: await slotsFor(c.env.DB, eventType, general, from, to, Date.now(), exclude) });
});

publicRoutes.post("/bookings", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  if (!(await rateLimit(c.env.DB, `book:${ip}`, 10, 3_600_000))) {
    return c.json({ error: "Too many bookings from this network. Please try again later." }, 429);
  }
  const { row, eventType, general } = await createBooking(c.env.DB, {
    slug: String(body.slug ?? ""),
    start: Number(body.start),
    name: String(body.name ?? ""),
    email: String(body.email ?? ""),
    tz: String(body.tz ?? ""),
    answers: (body.answers ?? {}) as Record<string, unknown>,
  });
  c.executionCtx.waitUntil(afterCreate(c.env.DB, c.get("baseUrl"), row, eventType, general));
  return c.json({ token: row.manage_token, booking: toBookingView(row, eventType) });
});

publicRoutes.get("/bookings/:token", async (c) => {
  const found = await findBooking(c.env.DB, "manage_token", c.req.param("token"));
  if (!found) return c.json({ error: "Booking not found." }, 404);
  return c.json({ booking: toBookingView(found.row, found.eventType) });
});

publicRoutes.get("/bookings/:token/invite.ics", async (c) => {
  const found = await findBooking(c.env.DB, "manage_token", c.req.param("token"));
  if (!found) return c.text("Not found", 404);
  const { row, eventType } = found;
  const { general } = await getPublicConfig(c.env.DB);
  const ics = buildInvite({
    method: "REQUEST",
    uid: `${row.id}@bkng`,
    sequence: row.sequence,
    start: row.start_utc,
    end: row.end_utc,
    summary: `${eventType.title}: ${row.booker_name} and ${general.businessName || "host"}`,
    description: eventType.config.locationUrl ? `Join: ${eventType.config.locationUrl}` : "",
    location: eventType.config.locationUrl,
    organizer: { name: general.businessName || "Bookings", email: general.ownerEmail || "noreply@example.com" },
    attendees: [],
  }).replace("METHOD:REQUEST\r\n", "METHOD:PUBLISH\r\n");
  return c.body(ics, 200, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": 'attachment; filename="booking.ics"',
  });
});

publicRoutes.post("/bookings/:token/cancel", async (c) => {
  const found = await findBooking(c.env.DB, "manage_token", c.req.param("token"));
  if (!found) return c.json({ error: "Booking not found." }, 404);
  const body = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  if (found.row.status === "confirmed") {
    await cancelBooking(c.env.DB, c.get("baseUrl"), found.row, found.eventType, String(body.reason ?? ""));
  }
  return c.json({ booking: { ...toBookingView(found.row, found.eventType), status: "cancelled" } });
});

publicRoutes.post("/bookings/:token/reschedule", async (c) => {
  const found = await findBooking(c.env.DB, "manage_token", c.req.param("token"));
  if (!found) return c.json({ error: "Booking not found." }, 404);
  const body = await c.req.json<{ start?: number }>().catch(() => ({}) as { start?: number });
  const row = await rescheduleBooking(c.env.DB, found.row, found.eventType, Number(body.start));
  c.executionCtx.waitUntil(afterReschedule(c.env.DB, c.get("baseUrl"), row, found.eventType));
  return c.json({ booking: toBookingView(row, found.eventType) });
});
