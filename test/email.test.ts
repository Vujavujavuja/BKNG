import { describe, expect, it } from "vitest";
import { DEFAULT_EMAIL_STYLE, DEFAULT_TEMPLATES } from "../shared/templates";
import { DEFAULT_THEME } from "../shared/theme";
import { DEFAULT_EMAIL } from "../shared/types";
import { renderEmail, SAMPLE_VARS } from "../src/lib/email-render";
import { buildMime } from "../src/lib/email-send";
import { buildInvite } from "../src/lib/ics-build";

const invite = buildInvite({
  method: "REQUEST",
  uid: "abc@bkng",
  sequence: 2,
  start: Date.UTC(2026, 9, 12, 8, 0),
  end: Date.UTC(2026, 9, 12, 8, 30),
  summary: "Intro call: Ana, and a very long title that goes well past the seventy-five octet line limit",
  description: "Line one\nLine two; with punctuation",
  location: "https://meet.example.com/room",
  organizer: { name: "Vujic", email: "bookings@example.com" },
  attendees: [{ name: "Ana", email: "ana@example.com" }],
  now: Date.UTC(2026, 9, 1),
});

describe("buildInvite", () => {
  it("produces a valid, folded invitation", () => {
    const lines = invite.split("\r\n");
    expect(lines.every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    expect(invite).toContain("METHOD:REQUEST");
    expect(invite).toContain("DTSTART:20261012T080000Z");
    expect(invite).toContain("SEQUENCE:2");
    expect(invite).toContain("DESCRIPTION:Line one\\nLine two\; with punctuation");
    expect(invite).toContain('ATTENDEE;CN="Ana"');
    expect(invite.replace(/\r\n /g, "")).toContain("SUMMARY:Intro call: Ana\\, and a very long title");
  });

  it("marks cancellations", () => {
    const cancel = buildInvite({ method: "CANCEL", uid: "x", sequence: 1, start: 0, end: 1, summary: "s", description: "", location: "", organizer: { name: "a", email: "a@b.c" }, attendees: [] });
    expect(cancel).toContain("METHOD:CANCEL");
    expect(cancel).toContain("STATUS:CANCELLED");
    expect(cancel).not.toContain("LOCATION");
  });
});

describe("renderEmail", () => {
  const render = (body: string, vars = SAMPLE_VARS) =>
    renderEmail({
      template: { ...DEFAULT_TEMPLATES.booker_confirmation, body },
      style: DEFAULT_EMAIL_STYLE,
      theme: DEFAULT_THEME,
      vars,
      buttonUrl: "https://example.com/booking/x",
      logoUrl: "",
    });

  it("fills variables in the subject and body", () => {
    const out = render("Hi {{booker_name}}, see you for {{ event_title }}. {{unknown}}");
    expect(out.subject).toBe("Confirmed: Intro call on Monday 12 October 2026");
    expect(out.html).toContain("Hi Alex Morgan, see you for Intro call. {{unknown}}");
    expect(out.text).toContain("Reschedule or cancel: https://example.com/booking/x");
  });

  it("escapes what people type and supports bold and links", () => {
    const out = render("**Hello** {{booker_name}} [docs](https://example.com/a)", { ...SAMPLE_VARS, booker_name: "<script>x</script>" });
    expect(out.html).toContain("<strong>Hello</strong> &lt;script&gt;x&lt;/script&gt;");
    expect(out.html).toContain('<a href="https://example.com/a"');
    expect(out.html).not.toContain("<script>x");
  });
});

describe("buildMime", () => {
  it("includes the invite inline and as an attachment", () => {
    const mime = buildMime(
      { ...DEFAULT_EMAIL, fromName: "Vujić", fromEmail: "bookings@example.com", replyTo: "me@example.com" },
      { to: "ana@example.com", subject: "Potvrđeno", html: "<p>Hi</p>", text: "Hi", ics: { content: invite, method: "REQUEST" } },
    );
    expect(mime).toContain("Subject: =?UTF-8?B?");
    expect(mime).toContain("Reply-To: me@example.com");
    expect(mime).toContain("text/calendar; charset=utf-8; method=REQUEST");
    expect(mime).toContain('filename="invite.ics"');
    expect(mime).toMatch(/--mix_[0-9a-f]+--$/);
  });
});
