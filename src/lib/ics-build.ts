export interface InviteInput {
  method: "REQUEST" | "CANCEL";
  uid: string;
  sequence: number;
  start: number;
  end: number;
  summary: string;
  description: string;
  location: string;
  organizer: { name: string; email: string };
  attendees: { name: string; email: string }[];
  now?: number;
}

const stamp = (ts: number) => new Date(ts).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const escapeText = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

const quoteParam = (value: string) => `"${value.replace(/"/g, "'")}"`;

/** Lines must not exceed 75 octets; continuation lines start with a space. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const charSize = encoder.encode(char).length;
    if (size + charSize > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += charSize;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** A calendar invitation (or cancellation) that mail clients turn into a calendar event. */
export function buildInvite(input: InviteInput): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//BKNG//Booking//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.method}`,
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `SEQUENCE:${input.sequence}`,
    `DTSTAMP:${stamp(input.now ?? Date.now())}`,
    `DTSTART:${stamp(input.start)}`,
    `DTEND:${stamp(input.end)}`,
    `SUMMARY:${escapeText(input.summary)}`,
    `DESCRIPTION:${escapeText(input.description)}`,
    ...(input.location ? [`LOCATION:${escapeText(input.location)}`] : []),
    `STATUS:${input.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    `ORGANIZER;CN=${quoteParam(input.organizer.name)}:mailto:${input.organizer.email}`,
    ...input.attendees.map(
      (a) =>
        `ATTENDEE;CN=${quoteParam(a.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`,
    ),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** "Add to Google Calendar" link for people who prefer a click over an attachment. */
export function googleCalendarLink(input: Pick<InviteInput, "start" | "end" | "summary" | "description" | "location">) {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.summary,
    dates: `${stamp(input.start)}/${stamp(input.end)}`,
    details: input.description,
    location: input.location,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}
