import type { EmailSettings } from "../../shared/types";
import { base64, randomId } from "../util";

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Calendar invite to attach. */
  ics?: { content: string; method: "REQUEST" | "CANCEL" };
}

export function emailConfigured(cfg: EmailSettings): boolean {
  if (!cfg.fromEmail) return false;
  switch (cfg.provider) {
    case "resend":
      return Boolean(cfg.resend.apiKey);
    case "cloudflare":
      return Boolean(cfg.cloudflare.apiToken && cfg.cloudflare.accountId);
    case "postmark":
      return Boolean(cfg.postmark.token);
    case "brevo":
      return Boolean(cfg.brevo.apiKey);
    case "smtp":
      return Boolean(cfg.smtp.host);
    default:
      return false;
  }
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 400)}`);
}

const icsType = (method: string) => `text/calendar; charset=utf-8; method=${method}`;

export async function sendEmail(cfg: EmailSettings, msg: OutgoingEmail): Promise<void> {
  if (!emailConfigured(cfg)) throw new Error("Email sending is not set up yet.");
  const fromName = cfg.fromName.replace(/["<>\r\n]/g, "");
  const from = fromName ? `${fromName} <${cfg.fromEmail}>` : cfg.fromEmail;
  const ics = msg.ics ? base64(msg.ics.content) : "";

  switch (cfg.provider) {
    case "resend":
      return post("https://api.resend.com/emails", { Authorization: `Bearer ${cfg.resend.apiKey}` }, {
        from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}),
        ...(msg.ics
          ? { attachments: [{ filename: "invite.ics", content: ics, content_type: icsType(msg.ics.method) }] }
          : {}),
      });

    case "postmark":
      return post("https://api.postmarkapp.com/email", { "X-Postmark-Server-Token": cfg.postmark.token }, {
        From: from,
        To: msg.to,
        Subject: msg.subject,
        HtmlBody: msg.html,
        TextBody: msg.text,
        MessageStream: "outbound",
        ...(cfg.replyTo ? { ReplyTo: cfg.replyTo } : {}),
        ...(msg.ics
          ? { Attachments: [{ Name: "invite.ics", Content: ics, ContentType: icsType(msg.ics.method) }] }
          : {}),
      });

    case "brevo":
      return post("https://api.brevo.com/v3/smtp/email", { "api-key": cfg.brevo.apiKey }, {
        sender: { email: cfg.fromEmail, ...(fromName ? { name: fromName } : {}) },
        to: [{ email: msg.to }],
        subject: msg.subject,
        htmlContent: msg.html,
        textContent: msg.text,
        ...(cfg.replyTo ? { replyTo: { email: cfg.replyTo } } : {}),
        ...(msg.ics ? { attachment: [{ name: "invite.ics", content: ics }] } : {}),
      });

    case "cloudflare": {
      const url = `https://api.cloudflare.com/client/v4/accounts/${cfg.cloudflare.accountId}/email/sending/send`;
      const auth = { Authorization: `Bearer ${cfg.cloudflare.apiToken}` };
      const base = {
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        ...(msg.ics
          ? {
              attachments: [
                { filename: "invite.ics", content: ics, type: icsType(msg.ics.method), disposition: "attachment" },
              ],
            }
          : {}),
      };
      try {
        return await post(url, auth, {
          ...base,
          from: fromName ? { address: cfg.fromEmail, name: fromName } : cfg.fromEmail,
          ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}),
        });
      } catch (error) {
        // Fall back to the minimal documented shape if the richer one is rejected.
        if (!String(error).includes("invalid_request_schema")) throw error;
        return post(url, auth, { ...base, from: cfg.fromEmail });
      }
    }

    case "smtp":
      return sendSmtp(cfg, from, msg);
  }
}

const wrap76 = (b64: string) => b64.replace(/(.{76})/g, "$1\r\n");
const encodeHeader = (value: string) => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${base64(value)}?=`);

export function buildMime(cfg: EmailSettings, msg: OutgoingEmail): string {
  const domain = cfg.fromEmail.split("@")[1] ?? "localhost";
  const alt = `alt_${randomId(8)}`;
  const mixed = `mix_${randomId(8)}`;
  const part = (type: string, content: string, extra: string[] = []) =>
    [`Content-Type: ${type}`, "Content-Transfer-Encoding: base64", ...extra, "", wrap76(base64(content))].join("\r\n");

  const alternatives = [
    part("text/plain; charset=utf-8", msg.text),
    part("text/html; charset=utf-8", msg.html),
    // An inline calendar part is what makes mail clients show accept/decline buttons.
    ...(msg.ics ? [part(icsType(msg.ics.method), msg.ics.content)] : []),
  ];
  const alternative = [
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    ...alternatives.flatMap((p) => [`--${alt}`, p]),
    `--${alt}--`,
  ].join("\r\n");

  const fromName = cfg.fromName.replace(/["<>\r\n]/g, "");
  const headers = [
    `From: ${fromName ? `"${encodeHeader(fromName)}" <${cfg.fromEmail}>` : cfg.fromEmail}`,
    `To: ${msg.to}`,
    ...(cfg.replyTo ? [`Reply-To: ${cfg.replyTo}`] : []),
    `Subject: ${encodeHeader(msg.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomId(16)}@${domain}>`,
    "MIME-Version: 1.0",
  ];

  if (!msg.ics) return [...headers, alternative].join("\r\n");
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    alternative,
    `--${mixed}`,
    part('application/ics; name="invite.ics"', msg.ics.content, ['Content-Disposition: attachment; filename="invite.ics"']),
    `--${mixed}--`,
  ].join("\r\n");
}

async function sendSmtp(cfg: EmailSettings, _from: string, msg: OutgoingEmail): Promise<void> {
  const { connect } = await import("cloudflare:sockets");
  const { host, port, username, password, security } = cfg.smtp;
  const transport = security === "tls" ? "on" : security === "starttls" ? "starttls" : "off";
  let socket = connect({ hostname: host, port }, { secureTransport: transport, allowHalfOpen: false });
  let reader = socket.readable.getReader();
  let writer = socket.writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";

  const read = async (): Promise<{ code: number; text: string }> => {
    for (;;) {
      const lines = buffer.split("\r\n");
      // Multi-line replies use "250-"; the last line uses "250 ".
      const last = lines.slice(0, -1).findIndex((line) => /^\d{3}( |$)/.test(line));
      if (last >= 0) {
        buffer = lines.slice(last + 1).join("\r\n");
        return { code: Number(lines[last]!.slice(0, 3)), text: lines.slice(0, last + 1).join(" ") };
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("The mail server closed the connection.");
      buffer += decoder.decode(value, { stream: true });
    }
  };
  const command = async (line: string, label: string, expected: number[]) => {
    await writer.write(encoder.encode(`${line}\r\n`));
    const reply = await read();
    if (!expected.includes(reply.code)) throw new Error(`Mail server rejected ${label}: ${reply.text}`);
  };

  try {
    await socket.opened.catch(() => {
      throw new Error(`Could not connect to the mail server at ${host}:${port}.`);
    });
    const greeting = await read();
    if (greeting.code !== 220) throw new Error(`Mail server refused the connection: ${greeting.text}`);
    const hello = `EHLO ${cfg.fromEmail.split("@")[1] ?? "localhost"}`;
    await command(hello, "EHLO", [250]);
    if (security === "starttls") {
      await command("STARTTLS", "STARTTLS", [220]);
      reader.releaseLock();
      writer.releaseLock();
      socket = socket.startTls();
      reader = socket.readable.getReader();
      writer = socket.writable.getWriter();
      buffer = "";
      await command(hello, "EHLO", [250]);
    }
    if (username) {
      await command("AUTH LOGIN", "AUTH", [334]);
      await command(base64(username), "the username", [334]);
      await command(base64(password), "the username or password", [235]);
    }
    await command(`MAIL FROM:<${cfg.fromEmail}>`, "the sender address", [250]);
    await command(`RCPT TO:<${msg.to}>`, "the recipient", [250, 251]);
    await command("DATA", "DATA", [354]);
    const body = buildMime(cfg, msg).replace(/\r\n\./g, "\r\n..");
    await command(`${body}\r\n.`, "the message", [250]);
    await writer.write(encoder.encode("QUIT\r\n")).catch(() => {});
  } finally {
    await socket.close().catch(() => {});
  }
}
