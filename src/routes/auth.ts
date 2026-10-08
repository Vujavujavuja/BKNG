import { Hono } from "hono";
import { DEFAULT_EVENT_CONFIG } from "../../shared/types";
import { getSetting, rateLimit, setSetting } from "../db";
import type { AppContext } from "../env";
import { createSession, currentUser, destroySession, hashAuthKey, isAuthKey } from "../lib/auth";
import { isEmail, isTimezone, randomId } from "../util";

export const authRoutes = new Hono<AppContext>();

async function hasUsers(db: D1Database): Promise<boolean> {
  return Boolean(await db.prepare(`SELECT 1 AS x FROM users LIMIT 1`).first());
}

authRoutes.get("/state", async (c) => {
  const [setupDone, user] = await Promise.all([hasUsers(c.env.DB), currentUser(c)]);
  return c.json({ setupDone, user });
});

// First run: whoever opens the fresh install creates the owner account. Closed for good after that.
authRoutes.post("/setup", async (c) => {
  if (await hasUsers(c.env.DB)) return c.json({ error: "This site is already set up." }, 403);
  const body = await c.req.json<Record<string, string>>().catch(() => ({}) as Record<string, string>);
  const name = String(body.name ?? "").trim();
  const businessName = String(body.businessName ?? "").trim() || name;
  if (!name) return c.json({ error: "Please enter your name." }, 400);
  if (!isEmail(body.email)) return c.json({ error: "Please enter a valid email address." }, 400);
  if (!isAuthKey(body.authKey)) return c.json({ error: "Please choose a password." }, 400);
  const timezone = isTimezone(body.timezone) ? body.timezone : "UTC";

  const id = randomId();
  const salt = randomId(16);
  const email = body.email.trim().toLowerCase();
  await c.env.DB.prepare(`INSERT INTO users (id, email, name, pass_hash, pass_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, email, name, await hashAuthKey(body.authKey, salt), salt, Date.now())
    .run();

  const baseUrl = c.get("baseUrl");
  const host = new URL(baseUrl).hostname;
  await setSetting(c.env.DB, "general", {
    ...(await getSetting(c.env.DB, "general")),
    businessName,
    timezone,
    ownerEmail: email,
    publicUrl: baseUrl,
    // On workers.dev the first label of the hostname is the Worker's name.
    workerName: host.endsWith(".workers.dev") ? host.split(".")[0]! : "",
  });
  // Start with one meeting type so the booking page works straight away.
  await c.env.DB.prepare(
    `INSERT INTO event_types (id, slug, title, description, duration_minutes, config, active, position, created_at)
     VALUES (?, 'intro-call', 'Intro call', 'A quick call to get to know each other.', 30, ?, 1, 0, ?)`,
  )
    .bind(randomId(), JSON.stringify(DEFAULT_EVENT_CONFIG), Date.now())
    .run();

  await createSession(c, id);
  return c.json({ ok: true });
});

authRoutes.post("/login", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  if (!(await rateLimit(c.env.DB, `login:${ip}`, 10, 15 * 60_000))) {
    return c.json({ error: "Too many attempts. Please wait 15 minutes." }, 429);
  }
  const body = await c.req.json<Record<string, string>>().catch(() => ({}) as Record<string, string>);
  const user = await c.env.DB.prepare(`SELECT id, pass_hash, pass_salt FROM users WHERE email = ?`)
    .bind(String(body.email ?? "").trim().toLowerCase())
    .first<{ id: string; pass_hash: string; pass_salt: string }>();
  const ok = user && isAuthKey(body.authKey) && (await hashAuthKey(body.authKey, user.pass_salt)) === user.pass_hash;
  if (!ok) return c.json({ error: "Wrong email or password." }, 401);
  await createSession(c, user.id);
  return c.json({ ok: true });
});

authRoutes.post("/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});
