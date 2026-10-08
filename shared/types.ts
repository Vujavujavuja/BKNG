export interface TimeWindow {
  /** Wall-clock "HH:MM" in the host's timezone. */
  start: string;
  end: string;
}

export type QuestionType = "text" | "textarea" | "select" | "checkbox" | "phone";

export interface Question {
  id: string;
  label: string;
  type: QuestionType;
  required: boolean;
  placeholder?: string;
  options?: string[];
}

export interface EventTypeConfig {
  slotStepMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  maxDaysAhead: number;
  /** 0 means no daily limit. */
  maxPerDay: number;
  /** Keyed by weekday, Sunday = "0". */
  weeklyHours: Record<string, TimeWindow[]>;
  /** Keyed by "YYYY-MM-DD"; an empty list blocks the whole day. */
  dateOverrides: Record<string, TimeWindow[]>;
  locationUrl: string;
  locationLabel: string;
  questions: Question[];
  /** Who gets the host notification. Empty means the owner. */
  hostEmails: string[];
  /** Attach a calendar invite to the host notification. */
  sendHostInvite: boolean;
  /** Connected Google account (calendars row id) to write events into, or "". */
  googleCalendarId: string;
  /** Reminder emails to the booker, in minutes before the start. */
  reminderMinutes: number[];
}

export interface EventType {
  id: string;
  slug: string;
  title: string;
  description: string;
  durationMinutes: number;
  active: boolean;
  position: number;
  config: EventTypeConfig;
}

export const DEFAULT_EVENT_CONFIG: EventTypeConfig = {
  slotStepMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minNoticeMinutes: 240,
  maxDaysAhead: 60,
  maxPerDay: 0,
  weeklyHours: {
    "1": [{ start: "09:00", end: "17:00" }],
    "2": [{ start: "09:00", end: "17:00" }],
    "3": [{ start: "09:00", end: "17:00" }],
    "4": [{ start: "09:00", end: "17:00" }],
    "5": [{ start: "09:00", end: "17:00" }],
  },
  dateOverrides: {},
  locationUrl: "",
  locationLabel: "Video call",
  questions: [],
  hostEmails: [],
  sendHostInvite: true,
  googleCalendarId: "",
  reminderMinutes: [60],
};

/** What the public booking page is allowed to see. */
export interface PublicEventType {
  slug: string;
  title: string;
  description: string;
  durationMinutes: number;
  locationLabel: string;
  questions: Question[];
}

export interface GeneralSettings {
  businessName: string;
  timezone: string;
  ownerEmail: string;
  /** Full public address including any base path, no trailing slash. */
  publicUrl: string;
  /** Path the app is mounted under on a shared domain, e.g. "/book". Empty for root. */
  basePath: string;
  workerName: string;
}

export const DEFAULT_GENERAL: GeneralSettings = {
  businessName: "",
  timezone: "UTC",
  ownerEmail: "",
  publicUrl: "",
  basePath: "",
  workerName: "",
};

export type EmailProvider = "" | "resend" | "cloudflare" | "postmark" | "brevo" | "smtp";

export interface EmailSettings {
  provider: EmailProvider;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  resend: { apiKey: string; domainId: string };
  cloudflare: { accountId: string; apiToken: string };
  postmark: { token: string };
  brevo: { apiKey: string };
  smtp: { host: string; port: number; username: string; password: string; security: "tls" | "starttls" | "none" };
}

export const DEFAULT_EMAIL: EmailSettings = {
  provider: "",
  fromName: "",
  fromEmail: "",
  replyTo: "",
  resend: { apiKey: "", domainId: "" },
  cloudflare: { accountId: "", apiToken: "" },
  postmark: { token: "" },
  brevo: { apiKey: "" },
  smtp: { host: "", port: 465, username: "", password: "", security: "tls" },
};

export const EMAIL_SECRET_PATHS = [
  "resend.apiKey",
  "cloudflare.apiToken",
  "postmark.token",
  "brevo.apiKey",
  "smtp.password",
];

export interface BookingView {
  token: string;
  status: "confirmed" | "cancelled";
  start: number;
  end: number;
  bookerName: string;
  bookerEmail: string;
  bookerTz: string;
  eventTitle: string;
  eventSlug: string;
  durationMinutes: number;
  locationUrl: string;
  locationLabel: string;
}

export interface AdminBooking extends BookingView {
  id: string;
  answers: Record<string, string>;
  cancelReason: string;
  createdAt: number;
}

export interface CalendarRow {
  id: string;
  kind: "ics" | "google";
  label: string;
  blocks: boolean;
  lastSynced: number | null;
  lastError: string | null;
  /** Google only. */
  account?: string;
  calendars?: { id: string; name: string }[];
  blockingIds?: string[];
  writeId?: string;
  /** ICS only. */
  ignoreAllDay?: boolean;
}

export interface DnsRecord {
  type: string;
  name: string;
  value: string;
  priority?: number;
  status?: string;
}
