import { useState, type FormEvent } from "react";
import type { GeneralSettings } from "../../../shared/types";
import { deriveAuthKey, send } from "../lib/api";
import { allTimezones } from "../lib/time";
import { Button, Card, Field, Loading, PageHead, SaveBar, toast, toastError, useDraft, useLoad } from "./ui";

interface SettingsData {
  general: GeneralSettings;
  me: { id: string; email: string; name: string };
}

interface User {
  id: string;
  email: string;
  name: string;
}

function Team({ me }: { me: User }) {
  const { data, reload } = useLoad<{ users: User[] }>("/admin/users");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password.length < 10) return toastError(new Error("Please use a password of at least 10 characters."));
    setBusy(true);
    try {
      await send("POST", "/admin/users", { name: form.name, email: form.email, authKey: await deriveAuthKey(form.email, form.password) });
      toast(`${form.name} can now sign in`);
      setForm({ name: "", email: "", password: "" });
      void reload();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (user: User) => {
    if (!window.confirm(`Remove ${user.name}'s access?`)) return;
    try {
      await send("DELETE", `/admin/users/${user.id}`);
      void reload();
    } catch (error) {
      toastError(error);
    }
  };

  return (
    <Card title="Team" description="Everyone here can sign in and change everything. Share the password with them yourself; they can change it after signing in.">
      <div className="ad-stack">
        <div className="ad-list">
          {data?.users.map((user) => (
            <div key={user.id} className="ad-item">
              <div className="ad-item-body">
                <strong>{user.name}</strong> {user.id === me.id && <span className="ad-badge">You</span>}
                <div className="ad-muted ad-small">{user.email}</div>
              </div>
              {user.id !== me.id && (
                <Button variant="danger" small onClick={() => void remove(user)}>
                  Remove
                </Button>
              )}
            </div>
          ))}
        </div>
        <form className="ad-stack" onSubmit={add}>
          <h3>Add someone</h3>
          <div className="ad-grid-3">
            <Field label="Name">
              <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Email">
              <input type="email" required value={form.email} autoComplete="off" onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Starting password">
              <input type="password" required minLength={10} value={form.password} autoComplete="new-password" onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
          </div>
          <div>
            <Button type="submit" variant="secondary" busy={busy}>
              Add to team
            </Button>
          </div>
        </form>
      </div>
    </Card>
  );
}

function Password({ me }: { me: User }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await send("POST", "/admin/password", { authKey: await deriveAuthKey(me.email, password) });
      toast("Password changed");
      setPassword("");
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Your password">
      <form className="ad-row" onSubmit={submit} style={{ alignItems: "flex-end" }}>
        <div style={{ flex: 1, maxWidth: 320 }}>
          <Field label="New password" hint="At least 10 characters.">
            <input type="password" required minLength={10} value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" variant="secondary" busy={busy}>
          Change password
        </Button>
      </form>
    </Card>
  );
}

export function Settings() {
  const { data, error, reload } = useLoad<SettingsData>("/admin/settings");
  const { draft, setDraft, dirty } = useDraft<GeneralSettings>(data?.general ?? null);
  const [busy, setBusy] = useState(false);
  if (!data || !draft) return <Loading error={error} />;
  const set = (patch: Partial<GeneralSettings>) => setDraft({ ...draft, ...patch });

  const save = async () => {
    setBusy(true);
    try {
      await send("PUT", "/admin/settings/general", draft);
      toast("Settings saved");
      await reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ad-stack">
      <PageHead title="Settings" />
      <Card title="General">
        <div className="ad-grid-3">
          <Field label="Business name" hint="Shown on the booking page and in emails.">
            <input type="text" value={draft.businessName} onChange={(e) => set({ businessName: e.target.value })} />
          </Field>
          <Field label="Your timezone" hint="Working hours on meeting types are in this timezone.">
            <select value={draft.timezone} onChange={(e) => set({ timezone: e.target.value })}>
              {allTimezones(draft.timezone).map((zone) => (
                <option key={zone}>{zone}</option>
              ))}
            </select>
          </Field>
          <Field label="Booking notices go to" hint="Unless a meeting type lists other addresses.">
            <input type="email" value={draft.ownerEmail} onChange={(e) => set({ ownerEmail: e.target.value })} />
          </Field>
        </div>
      </Card>
      <Team me={data.me} />
      <Password me={data.me} />
      <SaveBar dirty={dirty} busy={busy} onSave={() => void save()} />
    </div>
  );
}
