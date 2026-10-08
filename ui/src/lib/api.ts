import { DEFAULT_THEME, mergeDeep, type Theme } from "../../../shared/theme";

interface Boot {
  base: string;
  businessName: string;
  timezone: string;
  theme: Theme;
}

declare global {
  interface Window {
    __BKNG__?: Partial<Boot>;
  }
}

/** Values the server bakes into the page so the first paint needs no request. */
export const boot: Boot = {
  base: window.__BKNG__?.base ?? "",
  businessName: window.__BKNG__?.businessName ?? "",
  timezone: window.__BKNG__?.timezone ?? "UTC",
  theme: mergeDeep(DEFAULT_THEME, window.__BKNG__?.theme),
};

export const BASE = boot.base;
export const ORIGIN = window.location.origin + BASE;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: "same-origin",
    ...init,
    headers: {
      "X-Requested-With": "bkng",
      ...(typeof init.body === "string" ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? "Something went wrong. Please try again.", res.status);
  return data;
}

export const send = <T = unknown>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown) =>
  api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export const assetUrl = (id: string) => (id ? `${BASE}/api/assets/${id}` : "");

/**
 * Stretches the password in the browser before it is sent. The server runs on a plan with
 * almost no CPU time per request, so the slow part of password hashing happens here.
 */
export async function deriveAuthKey(email: string, password: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(`bkng:${email.trim().toLowerCase()}`), iterations: 300_000 },
    key,
    256,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
