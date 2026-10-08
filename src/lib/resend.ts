import type { DnsRecord } from "../../shared/types";

interface ResendDomain {
  id: string;
  name: string;
  status: string;
  records?: { type: string; name: string; value: string; priority?: number; status?: string }[];
}

async function resend<T>(apiKey: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(data.message ?? `Resend returned ${res.status}`);
  return data;
}

export interface DomainStatus {
  id: string;
  name: string;
  verified: boolean;
  status: string;
  records: DnsRecord[];
}

const toStatus = (d: ResendDomain): DomainStatus => ({
  id: d.id,
  name: d.name,
  verified: d.status === "verified",
  status: d.status,
  records: (d.records ?? []).map((r) => ({
    type: r.type,
    name: r.name,
    value: r.value,
    priority: r.priority,
    status: r.status,
  })),
});

/** Registers the sending domain with Resend, or finds it if it is already there. */
export async function ensureDomain(apiKey: string, name: string): Promise<DomainStatus> {
  const existing = await resend<{ data?: ResendDomain[] }>(apiKey, "/domains");
  const match = existing.data?.find((d) => d.name === name);
  if (match) return getDomain(apiKey, match.id);
  return toStatus(await resend<ResendDomain>(apiKey, "/domains", "POST", { name }));
}

export async function getDomain(apiKey: string, id: string): Promise<DomainStatus> {
  return toStatus(await resend<ResendDomain>(apiKey, `/domains/${id}`));
}

export async function verifyDomain(apiKey: string, id: string): Promise<void> {
  await resend(apiKey, `/domains/${id}/verify`, "POST");
}
