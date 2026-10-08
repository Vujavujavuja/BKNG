import { Hono } from "hono";
import { ensureDb, getPublicConfig } from "./db";
import type { AppContext, Env } from "./env";
import { sendReminders } from "./lib/bookings";
import { refreshCalendars } from "./lib/calendars";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { publicRoutes } from "./routes/public";

const BASE_HEADER = "x-bkng-base-url";

const app = new Hono<AppContext>();

app.use("*", async (c, next) => {
  c.set("baseUrl", c.req.header(BASE_HEADER) ?? new URL(c.req.url).origin);
  await next();
});

app.route("/api/public", publicRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/admin", adminRoutes);

app.get("/api/assets/:id", async (c) => {
  const row = await c.env.DB.prepare(`SELECT content_type, data FROM assets WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<{ content_type: string; data: ArrayLike<number> }>();
  if (!row) return c.notFound();
  return c.body(new Uint8Array(row.data), 200, {
    "Content-Type": row.content_type,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    // Uploaded SVGs must never run scripts on this origin.
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  });
});

// Drop-in script for other websites: <div data-bkng="intro-call"></div><script src=".../embed.js" async></script>
app.get("/embed.js", (c) => {
  const script = `(function(){var base=${JSON.stringify(c.get("baseUrl"))};
document.querySelectorAll("[data-bkng]").forEach(function(el){
if(el.dataset.bkngReady)return;el.dataset.bkngReady="1";
var f=document.createElement("iframe");
f.src=base+"/"+encodeURIComponent(el.dataset.bkng||"")+"?embed=1";
f.title="Book a time";f.loading="lazy";
f.style.cssText="width:100%;border:0;min-height:640px;display:block;color-scheme:normal";
el.appendChild(f);
window.addEventListener("message",function(e){
if(e.source===f.contentWindow&&e.data&&typeof e.data.bkngHeight==="number")f.style.height=e.data.bkngHeight+"px";
});});})();`;
  return c.body(script, 200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" });
});

app.all("/api/*", (c) => c.json({ error: "Not found." }, 404));

const escapeAttr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    await ensureDb(env.DB);
    const url = new URL(request.url);
    const { general, site } = await getPublicConfig(env.DB);

    // On a shared domain the app lives under a path such as /book; everything inside is addressed without it.
    const mounted = general.basePath && (url.pathname === general.basePath || url.pathname.startsWith(`${general.basePath}/`));
    const base = mounted ? general.basePath : "";
    const path = url.pathname.slice(base.length) || "/";
    const baseUrl = url.origin + base;

    if (path.startsWith("/api/") || path === "/embed.js") {
      const inner = new URL(url);
      inner.pathname = path;
      const forwarded = new Request(inner.toString(), request);
      forwarded.headers.set(BASE_HEADER, baseUrl);
      return app.fetch(forwarded, env, ctx);
    }

    if (/\.[a-z0-9]+$/i.test(path)) {
      const asset = await env.ASSETS.fetch(new Request(new URL(path, url.origin), { headers: request.headers }));
      if (asset.status !== 404) return asset;
    }

    // Everything else is a page: serve the app shell with the base path and theme baked in,
    // so the first paint already has the right colors.
    const shell = await env.ASSETS.fetch(new Request(new URL("/", url.origin)));
    const boot = JSON.stringify({ base, businessName: general.businessName, timezone: general.timezone, theme: site }).replace(/</g, "\\u003c");
    const html = (await shell.text())
      .replace("<head>", `<head><base href="${escapeAttr(base)}/"><script>window.__BKNG__=${boot}</script>`)
      .replace("<title>BKNG</title>", `<title>${escapeAttr(general.businessName || "Book a time")}</title>`);
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
        ...(path.startsWith("/admin") ? { "X-Frame-Options": "DENY" } : {}),
      },
    });
  },

  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await ensureDb(env.DB);
    await refreshCalendars(env.DB, 10 * 60_000);
    await sendReminders(env.DB);
  },
} satisfies ExportedHandler<Env>;
