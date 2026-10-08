import { useEffect, useState } from "react";
import type { EventType, GeneralSettings } from "../../../shared/types";
import { api, send } from "../lib/api";
import { Button, Card, CopyButton, Field, Loading, PageHead, toast, toastError, useLoad } from "./ui";

interface Zone {
  id: string;
  name: string;
}

interface SettingsData {
  general: GeneralSettings;
  cloudflare: { hostname: string; mode: "" | "domain" | "path"; secretsSet: Record<string, boolean> };
  tokenTemplateUrl: string;
}

function Connect({ data, reload }: { data: SettingsData; reload: () => Promise<void> }) {
  const hasToken = Boolean(data.cloudflare.secretsSet.apiToken);
  const [token, setToken] = useState("");
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [zoneId, setZoneId] = useState("");
  const [mode, setMode] = useState<"subdomain" | "root" | "path">("subdomain");
  const [subdomain, setSubdomain] = useState("book");
  const [path, setPath] = useState("/book");
  const [workerName, setWorkerName] = useState(data.general.workerName);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (!hasToken) return;
    api<{ zones: Zone[] }>("/admin/cloudflare/zones")
      .then((r) => {
        setZones(r.zones);
        setZoneId((current) => current || r.zones[0]?.id || "");
      })
      .catch(() => setZones([]));
  }, [hasToken]);

  const saveToken = async () => {
    setBusy("token");
    try {
      const result = await send<{ zones: Zone[] }>("POST", "/admin/cloudflare/token", { token });
      setZones(result.zones);
      setZoneId(result.zones[0]?.id ?? "");
      setToken("");
      toast("Cloudflare connected");
      await reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy("");
    }
  };

  const zone = zones?.find((z) => z.id === zoneId);
  const hostname = zone ? (mode === "subdomain" ? `${subdomain.trim() || "book"}.${zone.name}` : zone.name) : "";
  const address = zone ? `https://${hostname}${mode === "path" ? path : ""}` : "";

  const connect = async () => {
    setBusy("connect");
    try {
      const result = await send<{ publicUrl: string }>("POST", "/admin/cloudflare/connect", { zoneId, hostname, path: mode === "path" ? path : "", workerName });
      toast("Connected. It can take a minute before the new address works.");
      await reload();
      // Carry on in the admin at the new address once it is live; this one keeps working meanwhile.
      console.info("Booking page is now at", result.publicUrl);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy("");
    }
  };
  const disconnect = async () => {
    if (!window.confirm(`Stop serving the booking page at ${data.cloudflare.hostname}?`)) return;
    setBusy("disconnect");
    try {
      await send("POST", "/admin/cloudflare/disconnect");
      toast("Address disconnected");
      await reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy("");
    }
  };

  return (
    <Card title="Use your own domain" description="For domains whose DNS is on Cloudflare. This app sets up the address and the security certificate for you.">
      <div className="ad-stack">
        {data.cloudflare.mode && (
          <div className="ad-row">
            <span className="ad-badge is-good">Connected</span>
            <strong style={{ overflowWrap: "anywhere" }}>{data.general.publicUrl}</strong>
            <span className="ad-spacer" />
            <Button variant="danger" small busy={busy === "disconnect"} onClick={() => void disconnect()}>
              Disconnect
            </Button>
          </div>
        )}

        <div>
          <h3 style={{ marginBottom: 6 }}>Step 1: let this app manage the address</h3>
          {hasToken ? (
            <div className="ad-row">
              <span className="ad-badge is-good">Cloudflare connected</span>
              <details>
                <summary className="ad-small">Replace the token</summary>
                <div className="ad-row">
                  <input type="password" style={{ maxWidth: 320 }} value={token} aria-label="New Cloudflare token" autoComplete="off" onChange={(e) => setToken(e.target.value)} />
                  <Button variant="secondary" busy={busy === "token"} disabled={!token} onClick={() => void saveToken()}>
                    Save
                  </Button>
                </div>
              </details>
            </div>
          ) : (
            <div className="ad-stack" style={{ gap: 10 }}>
              <ol className="ad-small" style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                <li>
                  <a href={data.tokenTemplateUrl} target="_blank" rel="noreferrer">
                    Open this Cloudflare page
                  </a>
                  . The right permissions are already selected.
                </li>
                <li>Press "Continue to summary", then "Create Token".</li>
                <li>Copy the token and paste it here.</li>
              </ol>
              <div className="ad-row">
                <input type="password" style={{ maxWidth: 360 }} value={token} placeholder="Paste the token" aria-label="Cloudflare token" autoComplete="off" onChange={(e) => setToken(e.target.value)} />
                <Button busy={busy === "token"} disabled={!token} onClick={() => void saveToken()}>
                  Connect Cloudflare
                </Button>
              </div>
            </div>
          )}
        </div>

        {hasToken && zones && (
          <div className="ad-stack">
            <h3>Step 2: choose the address</h3>
            {!zones.length ? (
              <div className="ad-note is-warn">No domains were found in this Cloudflare account. Add your domain to Cloudflare first, then come back.</div>
            ) : (
              <>
                <div className="ad-grid-2">
                  <Field label="Domain">
                    <select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                      {zones.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Where on that domain">
                    <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                      <option value="subdomain">A subdomain, like book.{zone?.name}</option>
                      <option value="path">A page on my existing site, like {zone?.name}/book</option>
                      <option value="root">The whole domain (no other site on it)</option>
                    </select>
                  </Field>
                </div>
                {mode === "subdomain" && (
                  <Field label="Subdomain">
                    <input type="text" style={{ maxWidth: 240 }} value={subdomain} onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} />
                  </Field>
                )}
                {mode === "path" && (
                  <Field label="Page" hint={`Your existing site must already be running on ${zone?.name} through Cloudflare (orange cloud on). Everything under this path will show the booking page.`}>
                    <input type="text" style={{ maxWidth: 240 }} value={path} onChange={(e) => setPath(`/${e.target.value.toLowerCase().replace(/[^a-z0-9-/]/g, "").replace(/^\/+/, "")}`)} />
                  </Field>
                )}
                <Field label="Worker name" hint="The name this app has in your Cloudflare dashboard under Workers & Pages. Filled in automatically when possible.">
                  <input type="text" style={{ maxWidth: 240 }} value={workerName} onChange={(e) => setWorkerName(e.target.value.trim())} />
                </Field>
                <div className="ad-row">
                  <Button busy={busy === "connect"} disabled={!workerName || !zone} onClick={() => void connect()}>
                    Connect {address.replace("https://", "")}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function Manual({ data, reload }: { data: SettingsData; reload: () => Promise<void> }) {
  const [publicUrl, setPublicUrl] = useState(data.general.publicUrl);
  const [basePath, setBasePath] = useState(data.general.basePath);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await send("PUT", "/admin/settings/general", { ...data.general, publicUrl, basePath });
      toast("Address saved");
      await reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Set the address by hand" description="Only needed if you connected the domain yourself, outside this page.">
      <details>
        <summary>Show</summary>
        <div className="ad-stack">
          <div className="ad-grid-2">
            <Field label="Public address" hint="Used for links in emails. No slash at the end.">
              <input type="url" value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} />
            </Field>
            <Field label="Path on a shared domain" hint="For example /book. Leave blank when the app has the whole address.">
              <input type="text" value={basePath} onChange={(e) => setBasePath(e.target.value)} />
            </Field>
          </div>
          <div>
            <Button variant="secondary" busy={busy} onClick={() => void save()}>
              Save address
            </Button>
          </div>
        </div>
      </details>
    </Card>
  );
}

export function Domain() {
  const { data, error, reload } = useLoad<SettingsData>("/admin/settings");
  const events = useLoad<{ eventTypes: EventType[] }>("/admin/event-types");
  if (!data) return <Loading error={error} />;
  const url = data.general.publicUrl || window.location.origin;
  const slug = events.data?.eventTypes.find((e) => e.active)?.slug ?? "intro-call";
  const snippet = `<div data-bkng="${slug}"></div>\n<script src="${url}/embed.js" async></script>`;

  return (
    <div className="ad-stack">
      <PageHead title="Domain" description="Where people find your booking page." />
      <Card title="Current address">
        <div className="ad-row">
          <a href={url} target="_blank" rel="noreferrer" style={{ overflowWrap: "anywhere", flex: 1 }}>
            {url}
          </a>
          <CopyButton text={url} label="Copy link" />
        </div>
      </Card>
      <Connect data={data} reload={reload} />
      <Card title="Put it inside a page on any website" description="Paste this where the booking calendar should appear. Works with WordPress, Webflow, Squarespace, Framer and plain HTML.">
        <div className="ad-stack">
          <code className="ad-code">{snippet}</code>
          <div className="ad-row">
            <CopyButton text={snippet} label="Copy code" />
            <span className="ad-muted ad-small">Change "{slug}" to the link name of another meeting type to show that one.</span>
          </div>
        </div>
      </Card>
      <Manual data={data} reload={reload} />
    </div>
  );
}
