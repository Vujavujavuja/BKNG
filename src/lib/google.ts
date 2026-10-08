import type { Interval } from "./slots";

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
}

export interface GoogleAccountConfig {
  email: string;
  refreshToken: string;
  calendars: { id: string; name: string }[];
  blockingIds: string[];
  writeId: string;
}

export function googleAuthUrl(creds: GoogleCredentials, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function token(body: Record<string, string>): Promise<{ access_token: string; refresh_token?: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const data = (await res.json()) as { access_token?: string; refresh_token?: string; error_description?: string; error?: string };
  if (!res.ok || !data.access_token) throw new Error(`Google sign-in failed: ${data.error_description ?? data.error ?? res.status}`);
  return data as { access_token: string; refresh_token?: string };
}

export function exchangeCode(creds: GoogleCredentials, redirectUri: string, code: string) {
  return token({
    code,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
}

export async function accessToken(creds: GoogleCredentials, refreshToken: string): Promise<string> {
  const data = await token({
    refresh_token: refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    grant_type: "refresh_token",
  });
  return data.access_token;
}

async function api<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://www.googleapis.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...init.headers },
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Google Calendar: ${data.error?.message ?? res.status}`);
  return data;
}

export async function accountEmail(token: string): Promise<string> {
  const data = await api<{ email?: string }>(token, "/oauth2/v3/userinfo");
  return data.email ?? "Google account";
}

export async function listCalendars(token: string): Promise<{ id: string; name: string; primary: boolean; writable: boolean }[]> {
  const data = await api<{ items?: { id: string; summary: string; primary?: boolean; accessRole: string }[] }>(
    token,
    "/calendar/v3/users/me/calendarList?maxResults=250",
  );
  return (data.items ?? []).map((c) => ({
    id: c.id,
    name: c.summary,
    primary: Boolean(c.primary),
    writable: c.accessRole === "owner" || c.accessRole === "writer",
  }));
}

/** Busy time across the given calendars. Google caps the range per query, so long ranges are chunked. */
export async function freeBusy(token: string, calendarIds: string[], from: number, to: number): Promise<Interval[]> {
  const out: Interval[] = [];
  const chunk = 60 * 86_400_000;
  for (let start = from; start < to; start += chunk) {
    const data = await api<{ calendars?: Record<string, { busy?: { start: string; end: string }[] }> }>(
      token,
      "/calendar/v3/freeBusy",
      {
        method: "POST",
        body: JSON.stringify({
          timeMin: new Date(start).toISOString(),
          timeMax: new Date(Math.min(start + chunk, to)).toISOString(),
          items: calendarIds.map((id) => ({ id })),
        }),
      },
    );
    for (const calendar of Object.values(data.calendars ?? {})) {
      for (const b of calendar.busy ?? []) out.push({ start: Date.parse(b.start), end: Date.parse(b.end) });
    }
  }
  return out;
}

export interface GoogleEvent {
  summary: string;
  description: string;
  location: string;
  start: number;
  end: number;
}

const eventBody = (e: GoogleEvent) => ({
  summary: e.summary,
  description: e.description,
  location: e.location,
  start: { dateTime: new Date(e.start).toISOString() },
  end: { dateTime: new Date(e.end).toISOString() },
});

export async function insertEvent(token: string, calendarId: string, event: GoogleEvent): Promise<string> {
  const data = await api<{ id: string }>(token, `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    body: JSON.stringify(eventBody(event)),
  });
  return data.id;
}

export async function updateEvent(token: string, calendarId: string, eventId: string, event: GoogleEvent) {
  await api(token, `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    body: JSON.stringify(eventBody(event)),
  });
}

export async function deleteEvent(token: string, calendarId: string, eventId: string) {
  await api(token, `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
  });
}
