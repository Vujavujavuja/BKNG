import type { TemplateKind } from "../../shared/templates";
import type { AdminBooking, BookingView, EventType, GeneralSettings } from "../../shared/types";
import { getEventType, getSetting } from "../db";
import { formatWhen, isEmail, isTimezone, randomId } from "../util";
import type { CalendarDbRow } from "./calendars";
import { renderEmail, type EmailVars } from "./email-render";
import { emailConfigured, sendEmail } from "./email-send";
import { accessToken, deleteEvent, insertEvent, updateEvent, type GoogleAccountConfig, type GoogleEvent } from "./google";
import { buildInvite } from "./ics-build";
import { computeSlots, type Interval } from "./slots";

const DAY = 86_400_000;
const MINUTE = 60_000;

export interface BookingRow {
  id: string;
  event_type_id: string;
  start_utc: number;
  end_utc: number;
  booker_name: string;
  booker_email: string;
  booker_tz: string;
  answers: string;
  status: "confirmed" | "cancelled";
  manage_token: string;
  sequence: number;
  google_event_id: string;
  reminders_sent: string;
  cancel_reason: string;
  created_at: number;
}

/** An error whose message is safe to show to the person booking. */
export class BookingError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

export function toBookingView(row: BookingRow, eventType: EventType): BookingView {
  return {
    token: row.manage_token,
    status: row.status,
    start: row.start_utc,
    end: row.end_utc,
    bookerName: row.booker_name,
    bookerEmail: row.booker_email,
    bookerTz: row.booker_tz,
    eventTitle: eventType.title,
    eventSlug: eventType.slug,
    durationMinutes: eventType.durationMinutes,
    locationUrl: eventType.config.locationUrl,
    locationLabel: eventType.config.locationLabel,
  };
}

export function toAdminBooking(row: BookingRow, eventType: EventType): AdminBooking {
  return {
    ...toBookingView(row, eventType),
    id: row.id,
    answers: JSON.parse(row.answers) as Record<string, string>,
    cancelReason: row.cancel_reason,
    createdAt: row.created_at,
  };
}

/** Bookable start times for an event type, from cached calendar busy time and existing bookings. */
export async function slotsFor(
  db: D1Database,
  eventType: EventType,
  general: GeneralSettings,
  from: number,
  to: number,
  now: number,
  excludeBookingId = "",
): Promise<number[]> {
  const [calendarBusy, bookings] = await Promise.all([
    db
      .prepare(
        `SELECT b.start_utc AS start, b.end_utc AS end FROM busy_intervals b
         JOIN calendars c ON c.id = b.calendar_id
         WHERE c.blocks = 1 AND b.start_utc < ? AND b.end_utc > ?`,
      )
      .bind(to + DAY, from - DAY)
      .all<Interval>(),
    db
      .prepare(
        `SELECT id, event_type_id, start_utc AS start, end_utc AS end FROM bookings
         WHERE status = 'confirmed' AND start_utc < ? AND end_utc > ?`,
      )
      .bind(to + 2 * DAY, from - 2 * DAY)
      .all<Interval & { id: string; event_type_id: string }>(),
  ]);
  const others = bookings.results.filter((b) => b.id !== excludeBookingId);
  const config = eventType.config;
  return computeSlots(
    {
      timezone: general.timezone,
      weeklyHours: config.weeklyHours,
      dateOverrides: config.dateOverrides,
      durationMinutes: eventType.durationMinutes,
      slotStepMinutes: config.slotStepMinutes,
      bufferBeforeMinutes: config.bufferBeforeMinutes,
      bufferAfterMinutes: config.bufferAfterMinutes,
      minNoticeMinutes: config.minNoticeMinutes,
      maxDaysAhead: config.maxDaysAhead,
      maxPerDay: config.maxPerDay,
    },
    [...calendarBusy.results, ...others],
    from,
    to,
    now,
    others.filter((b) => b.event_type_id === eventType.id).map((b) => b.start),
  );
}

function answersText(eventType: EventType, answers: Record<string, string>): string {
  return eventType.config.questions
    .filter((q) => answers[q.id])
    .map((q) => `${q.label}: ${answers[q.id]}`)
    .join("\n");
}

function calendarEvent(row: BookingRow, eventType: EventType, general: GeneralSettings, publicUrl: string): GoogleEvent {
  const answers = answersText(eventType, JSON.parse(row.answers) as Record<string, string>);
  return {
    summary: `${eventType.title}: ${row.booker_name}`,
    description: [
      `${row.booker_name} (${row.booker_email})`,
      answers,
      eventType.config.locationUrl && `Join: ${eventType.config.locationUrl}`,
      `Manage: ${publicUrl}/booking/${row.manage_token}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    location: eventType.config.locationUrl,
    start: row.start_utc,
    end: row.end_utc,
  };
}

/** Mirrors a booking into the connected Google calendar, if the event type has one. Never throws. */
async function syncGoogle(
  db: D1Database,
  row: BookingRow,
  eventType: EventType,
  general: GeneralSettings,
  publicUrl: string,
  action: "create" | "update" | "delete",
): Promise<void> {
  if (!eventType.config.googleCalendarId) return;
  try {
    const calendar = await db
      .prepare(`SELECT * FROM calendars WHERE id = ? AND kind = 'google'`)
      .bind(eventType.config.googleCalendarId)
      .first<CalendarDbRow>();
    if (!calendar) return;
    const config = JSON.parse(calendar.config) as GoogleAccountConfig;
    if (!config.writeId) return;
    const token = await accessToken(await getSetting(db, "google"), config.refreshToken);
    const event = calendarEvent(row, eventType, general, publicUrl);
    if (action === "create") {
      const id = await insertEvent(token, config.writeId, event);
      await db.prepare(`UPDATE bookings SET google_event_id = ? WHERE id = ?`).bind(id, row.id).run();
    } else if (row.google_event_id) {
      if (action === "update") await updateEvent(token, config.writeId, row.google_event_id, event);
      else await deleteEvent(token, config.writeId, row.google_event_id);
    }
  } catch (error) {
    await logEmail(db, row.id, "Google Calendar", `${action} event`, "google", "failed", String(error));
  }
}

async function logEmail(
  db: D1Database,
  bookingId: string | null,
  recipient: string,
  subject: string,
  kind: string,
  status: "sent" | "failed" | "skipped",
  error = "",
) {
  await db
    .prepare(
      `INSERT INTO email_log (id, booking_id, recipient, subject, kind, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(randomId(), bookingId, recipient, subject, kind, status, error.slice(0, 500), Date.now())
    .run();
}

export type NotifyKind = "confirmation" | "reschedule" | "cancellation" | "reminder";

/** Emails the booker and the hosts about a booking. Every attempt lands in the email log; never throws. */
export async function notify(
  db: D1Database,
  baseUrl: string,
  row: BookingRow,
  eventType: EventType,
  kind: NotifyKind,
): Promise<void> {
  const [general, theme, email, templates, style] = await Promise.all([
    getSetting(db, "general"),
    getSetting(db, "site"),
    getSetting(db, "email"),
    getSetting(db, "templates"),
    getSetting(db, "emailStyle"),
  ]);
  const publicUrl = general.publicUrl || baseUrl;
  const hosts = (eventType.config.hostEmails.length ? eventType.config.hostEmails : [general.ownerEmail]).filter(isEmail);
  const manageUrl = `${publicUrl}/booking/${row.manage_token}`;
  const answers = answersText(eventType, JSON.parse(row.answers) as Record<string, string>);

  const recipients = [
    { to: row.booker_email, role: "booker", tz: row.booker_tz, buttonUrl: manageUrl, invite: true },
    ...(kind === "reminder"
      ? []
      : hosts.map((to) => ({
          to,
          role: "host",
          tz: general.timezone,
          buttonUrl: `${publicUrl}/admin/bookings`,
          invite: eventType.config.sendHostInvite,
        }))),
  ];

  const ics =
    kind === "reminder"
      ? undefined
      : {
          method: kind === "cancellation" ? ("CANCEL" as const) : ("REQUEST" as const),
          content: buildInvite({
            method: kind === "cancellation" ? "CANCEL" : "REQUEST",
            uid: `${row.id}@bkng`,
            sequence: row.sequence,
            start: row.start_utc,
            end: row.end_utc,
            summary: `${eventType.title}: ${row.booker_name} and ${general.businessName || "host"}`,
            description: [eventType.description, eventType.config.locationUrl && `Join: ${eventType.config.locationUrl}`, `Reschedule or cancel: ${manageUrl}`]
              .filter(Boolean)
              .join("\n\n"),
            location: eventType.config.locationUrl,
            organizer: { name: general.businessName || email.fromName || "Bookings", email: email.fromEmail },
            attendees: [
              { name: row.booker_name, email: row.booker_email },
              ...(eventType.config.sendHostInvite ? hosts.map((h) => ({ name: general.businessName || h, email: h })) : []),
            ],
          }),
        };

  for (const recipient of recipients) {
    const templateKind = `${recipient.role}_${kind}` as TemplateKind;
    const template = templates[templateKind];
    if (!template?.enabled) continue;
    const when = formatWhen(row.start_utc, row.end_utc, isTimezone(recipient.tz) ? recipient.tz : general.timezone, theme.timeFormat);
    const vars: EmailVars = {
      booker_name: row.booker_name,
      booker_email: row.booker_email,
      business_name: general.businessName,
      event_title: eventType.title,
      date: when.date,
      time: when.time,
      timezone: isTimezone(recipient.tz) ? recipient.tz : general.timezone,
      duration: String(eventType.durationMinutes),
      location: eventType.config.locationUrl,
      answers,
      cancel_reason: row.cancel_reason ? `Reason: ${row.cancel_reason}` : "",
      manage_url: manageUrl,
    };
    const rendered = renderEmail({
      template,
      style,
      theme,
      vars,
      buttonUrl: kind === "cancellation" && recipient.role === "booker" ? "" : recipient.buttonUrl,
      logoUrl: theme.logoAssetId ? `${publicUrl}/api/assets/${theme.logoAssetId}` : "",
    });
    if (!emailConfigured(email)) {
      await logEmail(db, row.id, recipient.to, rendered.subject, templateKind, "skipped", "Email sending is not set up.");
      continue;
    }
    try {
      await sendEmail(email, { to: recipient.to, ...rendered, ics: recipient.invite ? ics : undefined });
      await logEmail(db, row.id, recipient.to, rendered.subject, templateKind, "sent");
    } catch (error) {
      await logEmail(db, row.id, recipient.to, rendered.subject, templateKind, "failed", String(error));
    }
  }
}

export interface BookingInput {
  slug: string;
  start: number;
  name: string;
  email: string;
  tz: string;
  answers: Record<string, unknown>;
}

function cleanAnswers(eventType: EventType, raw: Record<string, unknown>): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const question of eventType.config.questions) {
    const value = raw?.[question.id];
    const text = question.type === "checkbox" ? (value === true || value === "Yes" ? "Yes" : "") : String(value ?? "").trim().slice(0, 2000);
    if (question.required && !text) throw new BookingError(`Please fill in "${question.label}".`);
    if (question.type === "select" && text && !question.options?.includes(text)) {
      throw new BookingError(`Please choose one of the options for "${question.label}".`);
    }
    if (text) answers[question.id] = text;
  }
  return answers;
}

export async function createBooking(
  db: D1Database,
  input: BookingInput,
): Promise<{ row: BookingRow; eventType: EventType; general: GeneralSettings }> {
  const eventType = await getEventType(db, "slug", input.slug);
  if (!eventType?.active) throw new BookingError("This booking page is not available.", 404);
  const name = String(input.name ?? "").trim().slice(0, 120);
  if (!name) throw new BookingError("Please enter your name.");
  if (!isEmail(input.email)) throw new BookingError("Please enter a valid email address.");
  if (!Number.isFinite(input.start)) throw new BookingError("Please pick a time.");
  const answers = cleanAnswers(eventType, input.answers);
  const general = await getSetting(db, "general");
  const now = Date.now();

  const open = await slotsFor(db, eventType, general, input.start - MINUTE, input.start + MINUTE, now);
  if (!open.includes(input.start)) throw new BookingError("That time was just taken. Please pick another.", 409);

  const row: BookingRow = {
    id: randomId(),
    event_type_id: eventType.id,
    start_utc: input.start,
    end_utc: input.start + eventType.durationMinutes * MINUTE,
    booker_name: name,
    booker_email: input.email.trim().toLowerCase(),
    booker_tz: isTimezone(input.tz) ? input.tz : general.timezone,
    answers: JSON.stringify(answers),
    status: "confirmed",
    manage_token: randomId(20),
    sequence: 0,
    google_event_id: "",
    reminders_sent: "[]",
    cancel_reason: "",
    created_at: now,
  };

  // The NOT EXISTS guard makes the overlap check and the insert one atomic statement.
  let inserted = 0;
  try {
    const result = await db
      .prepare(
        `INSERT INTO bookings (id, event_type_id, start_utc, end_utc, booker_name, booker_email, booker_tz, answers, status, manage_token, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM bookings WHERE status = 'confirmed' AND start_utc < ? AND end_utc > ?)`,
      )
      .bind(
        row.id,
        row.event_type_id,
        row.start_utc,
        row.end_utc,
        row.booker_name,
        row.booker_email,
        row.booker_tz,
        row.answers,
        row.manage_token,
        row.created_at,
        row.end_utc,
        row.start_utc,
      )
      .run();
    inserted = result.meta.changes;
  } catch (error) {
    if (!String(error).includes("UNIQUE")) throw error;
  }
  if (!inserted) throw new BookingError("That time was just taken. Please pick another.", 409);
  return { row, eventType, general };
}

/** Calendar write and emails that follow a new booking; safe to run after the response is sent. */
export async function afterCreate(db: D1Database, baseUrl: string, row: BookingRow, eventType: EventType, general: GeneralSettings) {
  await syncGoogle(db, row, eventType, general, general.publicUrl || baseUrl, "create");
  await notify(db, baseUrl, row, eventType, "confirmation");
}

export async function findBooking(db: D1Database, field: "id" | "manage_token", value: string) {
  const row = await db.prepare(`SELECT * FROM bookings WHERE ${field} = ?`).bind(value).first<BookingRow>();
  if (!row) return null;
  const eventType = await getEventType(db, "id", row.event_type_id);
  return eventType ? { row, eventType } : null;
}

export async function cancelBooking(db: D1Database, baseUrl: string, row: BookingRow, eventType: EventType, reason: string) {
  if (row.status === "cancelled") return;
  const updated: BookingRow = {
    ...row,
    status: "cancelled",
    cancel_reason: reason.trim().slice(0, 500),
    sequence: row.sequence + 1,
  };
  await db
    .prepare(`UPDATE bookings SET status = 'cancelled', cancel_reason = ?, sequence = ? WHERE id = ?`)
    .bind(updated.cancel_reason, updated.sequence, row.id)
    .run();
  const general = await getSetting(db, "general");
  await syncGoogle(db, updated, eventType, general, general.publicUrl || baseUrl, "delete");
  await notify(db, baseUrl, updated, eventType, "cancellation");
}

export async function rescheduleBooking(
  db: D1Database,
  row: BookingRow,
  eventType: EventType,
  start: number,
): Promise<BookingRow> {
  if (row.status !== "confirmed") throw new BookingError("This booking was cancelled.");
  if (!Number.isFinite(start)) throw new BookingError("Please pick a time.");
  const general = await getSetting(db, "general");
  const open = await slotsFor(db, eventType, general, start - MINUTE, start + MINUTE, Date.now(), row.id);
  if (!open.includes(start)) throw new BookingError("That time was just taken. Please pick another.", 409);
  const updated: BookingRow = {
    ...row,
    start_utc: start,
    end_utc: start + eventType.durationMinutes * MINUTE,
    sequence: row.sequence + 1,
    reminders_sent: "[]",
  };
  let changed = 0;
  try {
    const result = await db
      .prepare(
        `UPDATE bookings SET start_utc = ?, end_utc = ?, sequence = ?, reminders_sent = '[]'
         WHERE id = ? AND status = 'confirmed'
           AND NOT EXISTS (SELECT 1 FROM bookings o WHERE o.id != ? AND o.status = 'confirmed' AND o.start_utc < ? AND o.end_utc > ?)`,
      )
      .bind(updated.start_utc, updated.end_utc, updated.sequence, row.id, row.id, updated.end_utc, updated.start_utc)
      .run();
    changed = result.meta.changes;
  } catch (error) {
    if (!String(error).includes("UNIQUE")) throw error;
  }
  if (!changed) throw new BookingError("That time was just taken. Please pick another.", 409);
  return updated;
}

export async function afterReschedule(db: D1Database, baseUrl: string, row: BookingRow, eventType: EventType) {
  const general = await getSetting(db, "general");
  await syncGoogle(db, row, eventType, general, general.publicUrl || baseUrl, "update");
  await notify(db, baseUrl, row, eventType, "reschedule");
}

/** Sends due reminder emails. Run from the cron trigger. */
export async function sendReminders(db: D1Database): Promise<void> {
  const now = Date.now();
  const { results } = await db
    .prepare(`SELECT * FROM bookings WHERE status = 'confirmed' AND start_utc > ? AND start_utc < ?`)
    .bind(now, now + 8 * DAY)
    .all<BookingRow>();
  const general = await getSetting(db, "general");
  for (const row of results) {
    const eventType = await getEventType(db, "id", row.event_type_id);
    if (!eventType) continue;
    const sent = new Set(JSON.parse(row.reminders_sent) as number[]);
    let due = false;
    for (const minutes of eventType.config.reminderMinutes) {
      const at = row.start_utc - minutes * MINUTE;
      if (sent.has(minutes) || at > now) continue;
      sent.add(minutes);
      // Booked inside the reminder window: the confirmation already did the job.
      if (row.created_at < at) due = true;
    }
    if (sent.size === (JSON.parse(row.reminders_sent) as number[]).length) continue;
    await db.prepare(`UPDATE bookings SET reminders_sent = ? WHERE id = ?`).bind(JSON.stringify([...sent]), row.id).run();
    if (due) await notify(db, general.publicUrl, row, eventType, "reminder");
  }
}
