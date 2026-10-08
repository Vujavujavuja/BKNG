import { useEffect, useState } from "react";
import { TEMPLATE_LABELS, TEMPLATE_VARIABLES, type EmailStyle, type EmailTemplate, type EmailTemplates, type TemplateKind } from "../../../shared/templates";
import type { DnsRecord, EmailProvider, EmailSettings } from "../../../shared/types";
import { api, send } from "../lib/api";
import { Link } from "../lib/router";
import { Button, Card, ColorField, CopyButton, Field, Loading, PageHead, SaveBar, Tabs, Toggle, toast, toastError, useDraft, useLoad } from "./ui";

type MaskedEmail = EmailSettings & { secretsSet: Record<string, boolean> };

interface SettingsData {
  email: MaskedEmail;
  emailReady: boolean;
  templates: EmailTemplates;
  emailStyle: EmailStyle;
  cloudflare: { secretsSet: Record<string, boolean> };
  me: { email: string };
}

interface DomainStatus {
  id: string;
  name: string;
  verified: boolean;
  status: string;
  records: DnsRecord[];
}

const PROVIDERS: { id: EmailProvider; label: string; note: string }[] = [
  { id: "resend", label: "Resend", note: "Free for 3,000 emails a month. Guided domain setup below." },
  { id: "cloudflare", label: "Cloudflare Email", note: "Needs the Workers Paid plan ($5 a month) to email people outside your account." },
  { id: "brevo", label: "Brevo", note: "Free for 300 emails a day." },
  { id: "postmark", label: "Postmark", note: "Paid, very reliable delivery." },
  { id: "smtp", label: "Any mail server (SMTP)", note: "Proton Mail, Fastmail, Google Workspace and most others." },
];

function SecretField(props: { label: string; value: string; saved: boolean; onChange: (value: string) => void; hint?: React.ReactNode }) {
  return (
    <Field label={props.label} hint={props.saved ? "Saved. Leave blank to keep it." : props.hint}>
      <input type="password" autoComplete="off" value={props.value} placeholder={props.saved ? "••••••••" : ""} onChange={(e) => props.onChange(e.target.value)} />
    </Field>
  );
}

function ResendDomain({ fromEmail, hasCloudflare }: { fromEmail: string; hasCloudflare: boolean }) {
  const [domain, setDomain] = useState<DomainStatus | null>(null);
  const [name, setName] = useState(fromEmail.split("@")[1] ?? "");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    api<{ domain: DomainStatus | null }>("/admin/email/domain")
      .then((r) => setDomain(r.domain))
      .catch(() => {});
  }, []);

  const run = async (key: string, path: string, body?: unknown, done?: string) => {
    setBusy(key);
    try {
      const result = await send<{ domain: DomainStatus; added?: string[] }>("POST", path, body);
      setDomain(result.domain);
      if (result.added) toast(result.added.length ? `Added ${result.added.length} DNS records` : "The records were already there");
      else if (done) toast(done);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy("");
    }
  };

  return (
    <Card title="Send from your own domain" description="So emails come from an address like bookings@yourdomain.com instead of landing in spam.">
      <div className="ad-stack">
        <div className="ad-row" style={{ alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Field label="Your domain">
              <input type="text" value={name} placeholder="yourdomain.com" onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Button variant="secondary" busy={busy === "add"} disabled={!name} onClick={() => void run("add", "/admin/email/domain", { domain: name })}>
            {domain ? "Look up again" : "Get setup steps"}
          </Button>
        </div>

        {domain && (
          <>
            <div className="ad-row">
              <strong>{domain.name}</strong>
              {domain.verified ? <span className="ad-badge is-good">Verified, ready to send</span> : <span className="ad-badge is-warn">Waiting for DNS records</span>}
            </div>
            {!domain.verified && (
              <>
                <p>
                  Add these records where your domain's DNS is managed, then press Check. They sit alongside your existing email records and don't change where your mail is delivered.
                </p>
                <div className="ad-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Name</th>
                        <th>Value</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {domain.records.map((r, i) => (
                        <tr key={i}>
                          <td>
                            {r.type}
                            {r.priority != null && <div className="ad-muted ad-small">Priority {r.priority}</div>}
                          </td>
                          <td>
                            <div className="ad-row" style={{ flexWrap: "nowrap" }}>
                              <code style={{ overflowWrap: "anywhere" }}>{r.name}</code>
                              <CopyButton text={r.name} />
                            </div>
                          </td>
                          <td>
                            <div className="ad-row" style={{ flexWrap: "nowrap" }}>
                              <code style={{ overflowWrap: "anywhere", maxWidth: 280 }}>{r.value}</code>
                              <CopyButton text={r.value} />
                            </div>
                          </td>
                          <td>{r.status === "verified" ? <span className="ad-badge is-good">Found</span> : <span className="ad-badge is-warn">Not found yet</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="ad-row">
                  <Button busy={busy === "verify"} onClick={() => void run("verify", "/admin/email/domain/verify", undefined, "Checked. DNS changes can take a few minutes to show.")}>
                    Check
                  </Button>
                  {hasCloudflare ? (
                    <Button variant="secondary" busy={busy === "dns"} onClick={() => void run("dns", "/admin/email/domain/dns")}>
                      Add the records for me (Cloudflare)
                    </Button>
                  ) : (
                    <span className="ad-muted ad-small">
                      Domain on Cloudflare? <Link to="/admin/domain">Connect Cloudflare</Link> and this app can add the records for you.
                    </span>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function Sending({ data, reload }: { data: SettingsData; reload: () => Promise<void> }) {
  const { draft, setDraft, dirty } = useDraft<MaskedEmail>(data.email);
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState(data.me.email);
  const [testing, setTesting] = useState(false);
  if (!draft) return null;
  const set = (patch: Partial<MaskedEmail>) => setDraft({ ...draft, ...patch });
  const saved = (path: string) => Boolean(draft.secretsSet[path]);
  const provider = PROVIDERS.find((p) => p.id === draft.provider);

  const save = async () => {
    setBusy(true);
    try {
      await send("PUT", "/admin/settings/email", draft);
      toast("Email settings saved");
      await reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setTesting(true);
    try {
      await send("POST", "/admin/email/test", { to: testTo });
      toast(`Test email sent to ${testTo}`);
    } catch (e) {
      toastError(e);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="ad-stack">
      {!data.emailReady && <div className="ad-note is-warn">Email isn't set up yet. Bookings still work, but nobody gets a confirmation until it is.</div>}

      <Card title="1. Choose who delivers your email" description="Email needs a delivery service behind it. Pick one, create an account there, and paste the key it gives you.">
        <div className="ad-stack">
          <Field label="Delivery service" hint={provider?.note}>
            <select value={draft.provider} onChange={(e) => set({ provider: e.target.value as EmailProvider })}>
              <option value="">Choose…</option>
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>

          {draft.provider === "resend" && (
            <SecretField
              label="Resend API key"
              value={draft.resend.apiKey}
              saved={saved("resend.apiKey")}
              onChange={(apiKey) => set({ resend: { ...draft.resend, apiKey } })}
              hint={
                <>
                  Create a free account at <a href="https://resend.com/api-keys" target="_blank" rel="noreferrer">resend.com</a>, then API Keys → Create API key with full access.
                </>
              }
            />
          )}
          {draft.provider === "cloudflare" && (
            <div className="ad-grid-2">
              <Field label="Cloudflare account ID" hint="Shown in the Cloudflare dashboard address bar and on the Workers overview page.">
                <input type="text" value={draft.cloudflare.accountId} onChange={(e) => set({ cloudflare: { ...draft.cloudflare, accountId: e.target.value.trim() } })} />
              </Field>
              <SecretField label="API token with email sending permission" value={draft.cloudflare.apiToken} saved={saved("cloudflare.apiToken")} onChange={(apiToken) => set({ cloudflare: { ...draft.cloudflare, apiToken } })} />
            </div>
          )}
          {draft.provider === "brevo" && <SecretField label="Brevo API key" value={draft.brevo.apiKey} saved={saved("brevo.apiKey")} onChange={(apiKey) => set({ brevo: { apiKey } })} hint="In Brevo: Settings → SMTP & API → API keys." />}
          {draft.provider === "postmark" && <SecretField label="Postmark server token" value={draft.postmark.token} saved={saved("postmark.token")} onChange={(token) => set({ postmark: { token } })} hint="In Postmark: your server → API Tokens." />}
          {draft.provider === "smtp" && (
            <div className="ad-stack">
              <div className="ad-grid-3">
                <Field label="Server">
                  <input type="text" value={draft.smtp.host} placeholder="smtp.example.com" onChange={(e) => set({ smtp: { ...draft.smtp, host: e.target.value.trim() } })} />
                </Field>
                <Field label="Security">
                  <select
                    value={draft.smtp.security}
                    onChange={(e) => {
                      const security = e.target.value as EmailSettings["smtp"]["security"];
                      set({ smtp: { ...draft.smtp, security, port: security === "tls" ? 465 : 587 } });
                    }}
                  >
                    <option value="tls">TLS (port 465)</option>
                    <option value="starttls">STARTTLS (port 587)</option>
                    <option value="none">None (testing only)</option>
                  </select>
                </Field>
                <Field label="Port">
                  <input type="number" value={draft.smtp.port} onChange={(e) => set({ smtp: { ...draft.smtp, port: Number(e.target.value) } })} />
                </Field>
              </div>
              <div className="ad-grid-2">
                <Field label="Username">
                  <input type="text" autoComplete="off" value={draft.smtp.username} onChange={(e) => set({ smtp: { ...draft.smtp, username: e.target.value } })} />
                </Field>
                <SecretField label="Password or token" value={draft.smtp.password} saved={saved("smtp.password")} onChange={(password) => set({ smtp: { ...draft.smtp, password } })} />
              </div>
              <p className="ad-hint">Port 25 is not available on Cloudflare. For Proton Mail, create an SMTP token under Settings → IMAP/SMTP and use smtp.protonmail.ch with STARTTLS.</p>
            </div>
          )}
        </div>
      </Card>

      <Card title="2. Who the emails come from">
        <div className="ad-grid-3">
          <Field label="Sender name">
            <input type="text" value={draft.fromName} placeholder="Your business" onChange={(e) => set({ fromName: e.target.value })} />
          </Field>
          <Field label="Sender address" hint="Must be on a domain your delivery service has verified.">
            <input type="email" value={draft.fromEmail} placeholder="bookings@yourdomain.com" onChange={(e) => set({ fromEmail: e.target.value.trim() })} />
          </Field>
          <Field label="Replies go to" hint="Your real inbox. The sender address doesn't need a mailbox.">
            <input type="email" value={draft.replyTo} placeholder={data.me.email} onChange={(e) => set({ replyTo: e.target.value.trim() })} />
          </Field>
        </div>
      </Card>

      {draft.provider === "resend" && saved("resend.apiKey") && <ResendDomain fromEmail={draft.fromEmail} hasCloudflare={Boolean(data.cloudflare.secretsSet.apiToken)} />}
      {draft.provider === "resend" && !saved("resend.apiKey") && <div className="ad-note">Save your Resend key to continue with domain setup.</div>}

      <Card title="3. Send a test" description="Sends the confirmation email with a sample calendar invite.">
        <div className="ad-row">
          <input type="email" style={{ maxWidth: 320 }} value={testTo} aria-label="Send the test to" onChange={(e) => setTestTo(e.target.value)} />
          <Button variant="secondary" busy={testing} disabled={dirty} onClick={() => void test()}>
            Send test email
          </Button>
          {dirty && <span className="ad-muted ad-small">Save your changes first.</span>}
        </div>
      </Card>

      <SaveBar dirty={dirty} busy={busy} onSave={() => void save()} />
    </div>
  );
}

function Preview({ kind, template, style }: { kind: TemplateKind; template?: EmailTemplate; style?: EmailStyle }) {
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const body = JSON.stringify({ kind, template, style });
  useEffect(() => {
    const timer = setTimeout(() => {
      send<{ subject: string; html: string }>("POST", "/admin/email/preview", JSON.parse(body)).then(setPreview).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [body]);
  return (
    <div className="ad-preview" style={{ position: "static" }}>
      <div className="ad-preview-bar">
        <span className="ad-muted">Subject:</span>
        <strong style={{ overflowWrap: "anywhere" }}>{preview?.subject ?? "…"}</strong>
      </div>
      <iframe title="Email preview" sandbox="" srcDoc={preview?.html ?? ""} style={{ display: "block", width: "100%", height: 560, border: 0 }} />
    </div>
  );
}

function Templates({ data, reload }: { data: SettingsData; reload: () => Promise<void> }) {
  const { draft, setDraft, dirty } = useDraft<EmailTemplates>(data.templates);
  const [kind, setKind] = useState<TemplateKind>("booker_confirmation");
  const [busy, setBusy] = useState(false);
  if (!draft) return null;
  const template = draft[kind];
  const set = (patch: Partial<EmailTemplate>) => setDraft({ ...draft, [kind]: { ...template, ...patch } });

  const save = async () => {
    setBusy(true);
    try {
      await send("PUT", "/admin/settings/templates", draft);
      toast("Templates saved");
      await reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ad-builder">
      <div className="ad-stack">
        <Card>
          <div className="ad-stack">
            <Field label="Email">
              <select value={kind} onChange={(e) => setKind(e.target.value as TemplateKind)}>
                {(Object.keys(TEMPLATE_LABELS) as TemplateKind[]).map((k) => (
                  <option key={k} value={k}>
                    {TEMPLATE_LABELS[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Toggle checked={template.enabled} onChange={(enabled) => set({ enabled })} label="Send this email" />
            <Field label="Subject">
              <input type="text" value={template.subject} onChange={(e) => set({ subject: e.target.value })} />
            </Field>
            <Field label="Heading">
              <input type="text" value={template.heading} onChange={(e) => set({ heading: e.target.value })} />
            </Field>
            <Field label="Message" hint="Leave a blank line between paragraphs. **bold** and [link text](https://…) work.">
              <textarea style={{ minHeight: 160 }} value={template.body} onChange={(e) => set({ body: e.target.value })} />
            </Field>
            <Toggle checked={template.showDetails} onChange={(showDetails) => set({ showDetails })} label="Show the what, when and where summary" />
            <Field label="Button text" hint="Leave blank for no button.">
              <input type="text" value={template.buttonLabel} onChange={(e) => set({ buttonLabel: e.target.value })} />
            </Field>
          </div>
        </Card>
        <Card title="Placeholders" description="Type these anywhere in the subject, heading or message. They are replaced with the real details.">
          <div className="ad-stack" style={{ gap: 6 }}>
            {TEMPLATE_VARIABLES.map((v) => (
              <div key={v.name} className="ad-row ad-small" style={{ flexWrap: "nowrap" }}>
                <code style={{ flex: "none" }}>{`{{${v.name}}}`}</code>
                <span className="ad-muted">{v.description}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Preview kind={kind} template={template} />
      <SaveBar dirty={dirty} busy={busy} onSave={() => void save()} onReset={() => setDraft(data.templates)} />
    </div>
  );
}

function Look({ data, reload }: { data: SettingsData; reload: () => Promise<void> }) {
  const { draft, setDraft, dirty } = useDraft<EmailStyle>(data.emailStyle);
  const [busy, setBusy] = useState(false);
  if (!draft) return null;
  const set = (patch: Partial<EmailStyle>) => setDraft({ ...draft, ...patch });
  const save = async () => {
    setBusy(true);
    try {
      await send("PUT", "/admin/settings/emailStyle", draft);
      toast("Email look saved");
      await reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const colors: [keyof EmailStyle, string][] = [
    ["background", "Background"],
    ["card", "Card"],
    ["text", "Text"],
    ["muted", "Secondary text"],
    ["primary", "Button and links"],
    ["primaryText", "Text on the button"],
  ];
  return (
    <div className="ad-builder">
      <Card>
        <div className="ad-stack">
          <Toggle checked={draft.useSiteColors} onChange={(useSiteColors) => set({ useSiteColors })} label="Use the same colors as the booking page" />
          {!draft.useSiteColors && colors.map(([key, label]) => <ColorField key={key} label={label} value={draft[key] as string} onChange={(value) => set({ [key]: value })} />)}
          <Toggle checked={draft.showLogo} onChange={(showLogo) => set({ showLogo })} label="Show your logo at the top" />
          <Field label={`Corner roundness: ${draft.radius}px`}>
            <input type="range" min={0} max={24} value={draft.radius} onChange={(e) => set({ radius: Number(e.target.value) })} />
          </Field>
          <Field label="Footer" hint="Small print under every email. Placeholders work here too.">
            <input type="text" value={draft.footer} onChange={(e) => set({ footer: e.target.value })} />
          </Field>
          <p className="ad-hint">The logo comes from the Design page.</p>
        </div>
      </Card>
      <Preview kind="booker_confirmation" style={draft} />
      <SaveBar dirty={dirty} busy={busy} onSave={() => void save()} onReset={() => setDraft(data.emailStyle)} />
    </div>
  );
}

function Activity() {
  const { data, error } = useLoad<{ log: { recipient: string; subject: string; status: string; error: string; createdAt: number }[] }>("/admin/email-log");
  if (!data) return <Loading error={error} />;
  if (!data.log.length) return <div className="ad-empty">No emails sent yet.</div>;
  return (
    <Card>
      <div className="ad-table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>To</th>
              <th>Subject</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {data.log.map((row, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: "nowrap" }}>{new Date(row.createdAt).toLocaleString()}</td>
                <td>{row.recipient}</td>
                <td>{row.subject}</td>
                <td>
                  <span className={`ad-badge ${row.status === "sent" ? "is-good" : row.status === "failed" ? "is-bad" : "is-warn"}`}>{row.status === "sent" ? "Sent" : row.status === "failed" ? "Failed" : "Not sent"}</span>
                  {row.error && <div className="ad-muted ad-small">{row.error}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function Emails() {
  const { data, error, reload } = useLoad<SettingsData>("/admin/settings");
  const [tab, setTab] = useState<"sending" | "templates" | "look" | "activity">("sending");
  if (!data) return <Loading error={error} />;
  return (
    <div className="ad-stack">
      <PageHead title="Emails" description="Confirmations, reminders and notices sent to you and the people who book." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "sending", label: "Sending" },
          { id: "templates", label: "Wording" },
          { id: "look", label: "Look" },
          { id: "activity", label: "Activity" },
        ]}
      />
      {tab === "sending" && <Sending data={data} reload={reload} />}
      {tab === "templates" && <Templates data={data} reload={reload} />}
      {tab === "look" && <Look data={data} reload={reload} />}
      {tab === "activity" && <Activity />}
    </div>
  );
}
