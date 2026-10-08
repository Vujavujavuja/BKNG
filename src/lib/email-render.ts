import type { EmailStyle, EmailTemplate } from "../../shared/templates";
import type { Theme } from "../../shared/theme";
import { escapeHtml } from "../util";

export interface EmailVars {
  booker_name: string;
  booker_email: string;
  business_name: string;
  event_title: string;
  date: string;
  time: string;
  timezone: string;
  duration: string;
  location: string;
  answers: string;
  cancel_reason: string;
  manage_url: string;
}

export interface RenderInput {
  template: EmailTemplate;
  style: EmailStyle;
  theme: Theme;
  vars: EmailVars;
  /** Where the button points; no button when empty. */
  buttonUrl: string;
  /** Absolute URL of the logo, or "". */
  logoUrl: string;
}

const fill = (text: string, vars: EmailVars) =>
  text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => (name in vars ? vars[name as keyof EmailVars] : match));

/** Escapes text, then applies the two bits of formatting templates support: **bold** and [links](url). */
function inline(text: string, linkColor: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      `<a href="$2" style="color:${linkColor};text-decoration:underline">$1</a>`,
    )
    .replace(/\n/g, "<br>");
}

const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

export function renderEmail(input: RenderInput): { subject: string; html: string; text: string } {
  const { template, style, theme, vars } = input;
  const colors = style.useSiteColors
    ? { ...theme.colors }
    : {
        background: style.background,
        card: style.card,
        text: style.text,
        muted: style.muted,
        primary: style.primary,
        primaryText: style.primaryText,
      };
  const font = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
  const subject = fill(template.subject, vars).replace(/\s+/g, " ").trim();
  const heading = fill(template.heading, vars);
  const body = paragraphs(fill(template.body, vars));
  const footer = fill(style.footer, vars);
  const showButton = Boolean(template.buttonLabel && input.buttonUrl);

  const details: [string, string][] = [
    ["What", vars.event_title],
    ["When", `${vars.date}, ${vars.time} (${vars.timezone})`],
    ["Length", `${vars.duration} minutes`],
    ...(vars.location ? ([["Where", vars.location]] as [string, string][]) : []),
  ];

  const detailRows = details
    .map(([label, value]) => {
      const shown = /^https?:\/\//.test(value)
        ? `<a href="${escapeHtml(value)}" style="color:${colors.primary}">${escapeHtml(value)}</a>`
        : escapeHtml(value);
      return `<tr>
<td style="padding:6px 16px 6px 0;color:${colors.muted};font-size:13px;vertical-align:top;white-space:nowrap">${label}</td>
<td style="padding:6px 0;color:${colors.text};font-size:14px;word-break:break-word">${shown}</td>
</tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${colors.background};font-family:${font}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${colors.background}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${colors.card};border-radius:${style.radius}px">
<tr><td style="padding:32px">
${style.showLogo && input.logoUrl ? `<img src="${escapeHtml(input.logoUrl)}" alt="${escapeHtml(vars.business_name)}" height="${theme.logoHeight}" style="display:block;height:${theme.logoHeight}px;margin:0 0 24px">` : ""}
${heading ? `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${colors.text}">${escapeHtml(heading)}</h1>` : ""}
${body.map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${colors.text}">${inline(p, colors.primary)}</p>`).join("\n")}
${template.showDetails ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;border-top:1px solid ${colors.background};padding-top:8px;width:100%">${detailRows}</table>` : ""}
${showButton ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0 0"><tr><td style="background:${colors.primary};border-radius:${Math.min(style.radius, 10)}px"><a href="${escapeHtml(input.buttonUrl)}" style="display:inline-block;padding:12px 20px;color:${colors.primaryText};font-size:15px;font-weight:600;text-decoration:none">${escapeHtml(fill(template.buttonLabel, vars))}</a></td></tr></table>` : ""}
</td></tr></table>
${footer ? `<p style="margin:16px 0 0;font-size:12px;color:${colors.muted}">${inline(footer, colors.muted)}</p>` : ""}
</td></tr></table>
</body></html>`;

  const text = [
    heading,
    ...body.map((p) => p.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)")),
    ...(template.showDetails ? [details.map(([label, value]) => `${label}: ${value}`).join("\n")] : []),
    ...(showButton ? [`${fill(template.buttonLabel, vars)}: ${input.buttonUrl}`] : []),
    footer,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { subject, html, text };
}

export const SAMPLE_VARS: EmailVars = {
  booker_name: "Alex Morgan",
  booker_email: "alex@example.com",
  business_name: "Your business",
  event_title: "Intro call",
  date: "Monday 12 October 2026",
  time: "10:00 – 10:30",
  timezone: "Europe/Belgrade",
  duration: "30",
  location: "https://meet.example.com/your-room",
  answers: "What would you like to discuss?: Pricing and onboarding",
  cancel_reason: "Reason: Something came up.",
  manage_url: "https://example.com/booking/sample",
};
