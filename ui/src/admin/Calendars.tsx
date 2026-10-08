import { useEffect, useState, type FormEvent } from "react";
import type { CalendarRow } from "../../../shared/types";
import { api, ORIGIN, send } from "../lib/api";
import { navigate } from "../lib/router";
import { Button, Card, CopyButton, Field, Loading, PageHead, Toggle, toast, toastError, useLoad } from "./ui";

interface SettingsData {
  google: { clientId: string; secretsSet: Record<string, boolean> };
}

const ago = (ts: number | null) => {
  if (!ts) return "never";
  const minutes = Math.round((Date.now() - ts) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
};

function CalendarItem({ calendar, reload }: { calendar: CalendarRow; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await action();
      if (done) toast(done);
      reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const patch = (body: Record<string, unknown>) => run(() => send("PATCH", `/admin/calendars/${calendar.id}`, body));

  return (
    <div className="ad-card ad-stack" style={{ gap: 12 }}>
      <div className="ad-row">
        <div style={{ minWidth: 0, flex: 1 }}>
          <strong>{calendar.label}</strong>{" "}
          <span className="ad-badge">{calendar.kind === "google" ? "Google account" : "Calendar link"}</span>{" "}
          {calendar.lastError ? <span className="ad-badge is-bad">Not syncing</span> : <span className="ad-badge is-good">Syncing</span>}
          <div className="ad-muted ad-small">Last checked {ago(calendar.lastSynced)}</div>
        </div>
        <Button variant="secondary" small busy={busy} onClick={() => void run(() => send("POST", `/admin/calendars/${calendar.id}/sync`), "Calendar checked")}>
          Check now
        </Button>
        <Button
          variant="danger"
          small
          onClick={() => {
            if (window.confirm(`Disconnect "${calendar.label}"? Its events will stop blocking your booking times.`)) {
              void run(() => send("DELETE", `/admin/calendars/${calendar.id}`), "Calendar disconnected");
            }
          }}
        >
          Disconnect
        </Button>
      </div>
      {calendar.lastError && <div className="ad-note is-bad">{calendar.lastError}</div>}
      <Toggle checked={calendar.blocks} onChange={(blocks) => void patch({ blocks })} label="Events in this calendar block booking times" />
      {calendar.kind === "ics" && <Toggle checked={Boolean(calendar.ignoreAllDay)} onChange={(ignoreAllDay) => void patch({ ignoreAllDay })} label="Ignore all-day events (birthdays, holidays)" />}
      {calendar.kind === "google" && (
        <>
          <div>
            <div className="ad-label" style={{ marginBottom: 6 }}>
              Calendars that block booking times
            </div>
            <div className="ad-stack" style={{ gap: 6 }}>
              {calendar.calendars?.map((c) => {
                const checked = calendar.blockingIds?.includes(c.id) ?? false;
                return (
                  <label key={c.id} className="ad-row" style={{ gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => void patch({ blockingIds: checked ? calendar.blockingIds?.filter((id) => id !== c.id) : [...(calendar.blockingIds ?? []), c.id] })}
                    />
                    {c.name}
                  </label>
                );
              })}
            </div>
          </div>
          <Field label="Write new bookings into" hint="Then pick this account on a meeting type, under Notifications and calendar.">
            <select value={calendar.writeId ?? ""} onChange={(e) => void patch({ writeId: e.target.value })}>
              <option value="">Don't write bookings</option>
              {calendar.calendars?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
    </div>
  );
}

function AddLink({ reload }: { reload: () => void }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [ignoreAllDay, setIgnoreAllDay] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await send("POST", "/admin/calendars", { label, url, ignoreAllDay });
      toast("Calendar connected");
      setLabel("");
      setUrl("");
      reload();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Connect a calendar with a link" description="Works with Proton, Google, iCloud and Outlook. The link is private and read-only: it only lets this app see when you are busy.">
      <form className="ad-stack" onSubmit={submit}>
        <div className="ad-grid-2">
          <Field label="Name" hint="Just for you, e.g. Work calendar.">
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field label="Calendar link">
            <input type="text" required value={url} placeholder="https://… or webcal://…" onChange={(e) => setUrl(e.target.value)} />
          </Field>
        </div>
        <Toggle checked={ignoreAllDay} onChange={setIgnoreAllDay} label="Ignore all-day events (birthdays, holidays)" />
        <details>
          <summary>Where do I find the link?</summary>
          <div className="ad-stack ad-small" style={{ gap: 8 }}>
            <div>
              <strong>Proton Calendar:</strong> Settings → Calendars → pick the calendar → Share outside Proton → Create link. "Limited view" is enough: it shares only when you are busy.
            </div>
            <div>
              <strong>Google Calendar:</strong> Settings → pick the calendar under "Settings for my calendars" → Integrate calendar → copy "Secret address in iCal format".
            </div>
            <div>
              <strong>iCloud:</strong> Calendar app → share icon next to the calendar → tick Public Calendar → copy the link.
            </div>
            <div>
              <strong>Outlook:</strong> Settings → Calendar → Shared calendars → Publish a calendar → copy the ICS link.
            </div>
          </div>
        </details>
        <div>
          <Button type="submit" busy={busy}>
            Connect calendar
          </Button>
        </div>
      </form>
    </Card>
  );
}

function GoogleConnect() {
  const settings = useLoad<SettingsData>("/admin/settings");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (settings.data) setClientId(settings.data.google.clientId);
  }, [settings.data]);
  if (!settings.data) return null;
  const hasSecret = settings.data.google.secretsSet.clientSecret;
  const redirect = `${ORIGIN}/api/admin/google/callback`;

  const connect = async () => {
    setBusy(true);
    try {
      await send("PUT", "/admin/settings/google", { clientId, clientSecret });
      const { url } = await api<{ url: string }>("/admin/google/start");
      window.location.href = url;
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  };

  return (
    <Card
      title="Connect a Google account directly (advanced)"
      description="Optional. Lets bookings be written straight into Google Calendar and checks several calendars at once. A calendar link above is enough for most people."
    >
      <details>
        <summary>Set up the Google connection</summary>
        <div className="ad-stack">
          <ol className="ad-small" style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
            <li>
              Open <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Google Cloud Console</a> and create a project.
            </li>
            <li>
              Enable the <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noreferrer">Google Calendar API</a> for it.
            </li>
            <li>
              Under <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noreferrer">Google Auth Platform</a>, set the audience to External and publish the app (status "In production"), otherwise Google signs you out every 7 days.
            </li>
            <li>
              Create an OAuth client of type "Web application" and add this as an authorised redirect URI:
              <div className="ad-row" style={{ marginTop: 6 }}>
                <code className="ad-code" style={{ flex: 1 }}>
                  {redirect}
                </code>
                <CopyButton text={redirect} />
              </div>
            </li>
            <li>Paste the client ID and secret below, then connect. Google shows an "unverified app" warning once; choose Advanced → continue.</li>
          </ol>
          <div className="ad-grid-2">
            <Field label="Client ID">
              <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} />
            </Field>
            <Field label="Client secret" hint={hasSecret ? "Saved. Leave blank to keep it." : undefined}>
              <input type="password" value={clientSecret} autoComplete="off" onChange={(e) => setClientSecret(e.target.value)} />
            </Field>
          </div>
          <div>
            <Button busy={busy} disabled={!clientId || (!clientSecret && !hasSecret)} onClick={() => void connect()}>
              Connect Google account
            </Button>
          </div>
        </div>
      </details>
    </Card>
  );
}

export function Calendars() {
  const { data, error, reload } = useLoad<{ calendars: CalendarRow[] }>("/admin/calendars");

  // Google sends people back here with the outcome in the address.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("connected")) toast("Google account connected");
    if (params.has("error")) toast(params.get("error")!, true);
    if (params.has("connected") || params.has("error")) navigate("/admin/calendars", true);
  }, []);

  if (!data) return <Loading error={error} />;
  return (
    <div className="ad-stack">
      <PageHead title="Calendars" description="Connected calendars block out the times you're busy. You can connect as many as you like." />
      {data.calendars.length === 0 && <div className="ad-note">No calendar connected yet, so only existing bookings block your times.</div>}
      {data.calendars.map((calendar) => (
        <CalendarItem key={calendar.id} calendar={calendar} reload={() => void reload()} />
      ))}
      <AddLink reload={() => void reload()} />
      <GoogleConnect />
    </div>
  );
}
