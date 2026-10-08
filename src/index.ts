import { Hono } from "hono";
import type { AppContext } from "./env";

const app = new Hono<AppContext>();

app.get("/api/health", (c) => c.json({ ok: true }));

export default app;
