import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppContext } from "../env";
import { randomId, sha256Hex } from "../util";

const COOKIE = "bkng_session";
const SESSION_MS = 30 * 86_400_000;

// The browser stretches the password (PBKDF2) before sending it, because the free Workers plan
// has no CPU budget for a slow hash. The server only ever stores a salted hash of that stretched key.
export async function hashAuthKey(authKey: string, salt: string): Promise<string> {
  return sha256Hex(`${salt}:${authKey}`);
}

export function isAuthKey(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export async function createSession(c: Context<AppContext>, userId: string): Promise<void> {
  const token = randomId(32);
  const expires = Date.now() + SESSION_MS;
  await c.env.DB.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`)
    .bind(await sha256Hex(token), userId, expires)
    .run();
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_MS / 1000,
  });
}

export async function destroySession(c: Context<AppContext>): Promise<void> {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(await sha256Hex(token)).run();
  deleteCookie(c, COOKIE, { path: "/" });
}

export async function currentUser(c: Context<AppContext>): Promise<{ id: string; email: string; name: string } | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  return c.env.DB.prepare(
    `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256Hex(token), Date.now())
    .first<{ id: string; email: string; name: string }>();
}

export async function requireAdmin(c: Context<AppContext>, next: Next) {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Please sign in." }, 401);
  // Cookies are SameSite=Lax; the custom header additionally blocks cross-site form posts.
  if (c.req.method !== "GET" && c.req.header("X-Requested-With") !== "bkng") {
    return c.json({ error: "Bad request." }, 400);
  }
  c.set("userId", user.id);
  await next();
}
