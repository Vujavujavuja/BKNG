import { useEffect, useState, type FormEvent } from "react";
import { BASE, deriveAuthKey, send } from "../lib/api";
import { Link, navigate, usePath } from "../lib/router";
import { allTimezones, browserTimezone } from "../lib/time";
import "./admin.css";
import { Bookings } from "./Bookings";
import { Calendars } from "./Calendars";
import { Dashboard } from "./Dashboard";
import { Design } from "./Design";
import { Domain } from "./Domain";
import { Emails } from "./Emails";
import { EventTypeEditor, EventTypes } from "./EventTypes";
import { Settings } from "./Settings";
import { Button, Field, Loading, Toasts, toastError, useLoad } from "./ui";

interface AuthState {
  setupDone: boolean;
  user: { id: string; email: string; name: string } | null;
}

const NAV = [
  { to: "/admin", label: "Dashboard" },
  { to: "/admin/bookings", label: "Bookings" },
  { to: "/admin/types", label: "Meeting types" },
  { to: "/admin/calendars", label: "Calendars" },
  { to: "/admin/design", label: "Design" },
  { to: "/admin/emails", label: "Emails" },
  { to: "/admin/domain", label: "Domain" },
  { to: "/admin/settings", label: "Settings" },
];

function Setup({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ name: "", businessName: "", email: "", password: "", timezone: browserTimezone() });
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password.length < 10) return toastError(new Error("Please use a password of at least 10 characters."));
    setBusy(true);
    try {
      const authKey = await deriveAuthKey(form.email, form.password);
      await send("POST", "/auth/setup", { ...form, password: undefined, authKey });
      onDone();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ad-auth">
      <form className="ad-card ad-stack" onSubmit={submit}>
        <div>
          <h1>Set up your booking page</h1>
          <p className="ad-muted">This creates the owner account. It takes a minute.</p>
        </div>
        <Field label="Your name">
          <input type="text" required autoComplete="name" value={form.name} onChange={set("name")} />
        </Field>
        <Field label="Business name" hint="Shown on your booking page and in emails. Leave blank to use your name.">
          <input type="text" autoComplete="organization" value={form.businessName} onChange={set("businessName")} />
        </Field>
        <Field label="Email" hint="You sign in with this, and booking notices go here.">
          <input type="email" required autoComplete="email" value={form.email} onChange={set("email")} />
        </Field>
        <Field label="Password" hint="At least 10 characters.">
          <input type="password" required minLength={10} autoComplete="new-password" value={form.password} onChange={set("password")} />
        </Field>
        <Field label="Your timezone" hint="Your working hours are set in this timezone.">
          <select value={form.timezone} onChange={set("timezone")}>
            {allTimezones(form.timezone).map((zone) => (
              <option key={zone}>{zone}</option>
            ))}
          </select>
        </Field>
        <Button type="submit" busy={busy}>
          Create account
        </Button>
      </form>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await send("POST", "/auth/login", { email, authKey: await deriveAuthKey(email, password) });
      onDone();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ad-auth">
      <form className="ad-card ad-stack" onSubmit={submit}>
        <h1>Sign in</h1>
        <Field label="Email">
          <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" busy={busy}>
          Sign in
        </Button>
      </form>
    </div>
  );
}

function Page({ path }: { path: string }) {
  const editor = /^\/admin\/types\/([^/]+)$/.exec(path);
  if (editor) return <EventTypeEditor key={editor[1]} id={editor[1]!} />;
  switch (path.replace(/\/$/, "")) {
    case "/admin":
      return <Dashboard />;
    case "/admin/bookings":
      return <Bookings />;
    case "/admin/types":
      return <EventTypes />;
    case "/admin/calendars":
      return <Calendars />;
    case "/admin/design":
      return <Design />;
    case "/admin/emails":
      return <Emails />;
    case "/admin/domain":
      return <Domain />;
    case "/admin/settings":
      return <Settings />;
    default:
      return <div className="ad-empty">That page doesn't exist.</div>;
  }
}

export default function AdminApp() {
  const path = usePath();
  const auth = useLoad<AuthState>("/auth/state");

  useEffect(() => {
    document.body.style.margin = "0";
    document.title = "Admin";
  }, []);

  let content;
  if (!auth.data) content = <Loading error={auth.error} />;
  else if (!auth.data.setupDone) content = <Setup onDone={auth.reload} />;
  else if (!auth.data.user) content = <Login onDone={auth.reload} />;
  else {
    const active = (to: string) => (to === "/admin" ? path.replace(/\/$/, "") === "/admin" : path.startsWith(to));
    const signOut = async () => {
      await send("POST", "/auth/logout");
      navigate("/admin");
      void auth.reload();
    };
    content = (
      <div className="ad-layout">
        <nav className="ad-nav" aria-label="Admin">
          <div className="ad-brand">BKNG</div>
          {NAV.map((item) => (
            <Link key={item.to} to={item.to} className={`ad-nav-link ${active(item.to) ? "is-active" : ""}`} aria-current={active(item.to) ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
          <div className="ad-nav-foot">
            <a className="ad-nav-link" href={`${BASE}/`} target="_blank" rel="noreferrer">
              View booking page ↗
            </a>
            <a
              className="ad-nav-link"
              href={`${BASE}/admin`}
              onClick={(e) => {
                e.preventDefault();
                void signOut();
              }}
            >
              Sign out
            </a>
          </div>
        </nav>
        <main className="ad-main">
          <Page path={path} />
        </main>
      </div>
    );
  }

  return (
    <div className="ad">
      {content}
      <Toasts />
    </div>
  );
}
