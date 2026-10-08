export function randomId(bytes = 12): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}

export function base64(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function isEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);
}

export function setPath(obj: unknown, path: string, value: unknown): void {
  const keys = path.split(".");
  const last = keys.pop()!;
  const target = keys.reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);
  if (target && typeof target === "object") (target as Record<string, unknown>)[last] = value;
}

/** Blanks secrets before settings go to the browser, and reports which ones are set. */
export function maskSecrets<T>(settings: T, paths: string[]): T & { secretsSet: Record<string, boolean> } {
  const copy = structuredClone(settings) as T & { secretsSet: Record<string, boolean> };
  copy.secretsSet = {};
  for (const path of paths) {
    copy.secretsSet[path] = Boolean(getPath(settings, path));
    setPath(copy, path, "");
  }
  return copy;
}

/** A blank secret in a save request means "keep what is stored". */
export function keepSecrets<T>(incoming: T, stored: T, paths: string[]): T {
  const copy = structuredClone(incoming) as T & { secretsSet?: unknown };
  delete copy.secretsSet;
  for (const path of paths) {
    if (!getPath(copy, path)) setPath(copy, path, getPath(stored, path) ?? "");
  }
  return copy;
}

export function formatWhen(start: number, end: number, timezone: string, timeFormat: "12h" | "24h") {
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(start);
  const time = new Intl.DateTimeFormat(timeFormat === "12h" ? "en-US" : "en-GB", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: timeFormat === "12h",
  });
  return { date, time: `${time.format(start)} – ${time.format(end)}` };
}
