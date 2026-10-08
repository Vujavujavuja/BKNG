import type { DnsRecord } from "../../shared/types";

const API = "https://api.cloudflare.com/client/v4";

async function cf<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
  const data = (await res.json().catch(() => null)) as {
    success?: boolean;
    result?: T;
    errors?: { message: string }[];
  } | null;
  if (!res.ok || !data?.success) {
    throw new Error(data?.errors?.map((e) => e.message).join("; ") || `Cloudflare returned ${res.status}`);
  }
  return data.result as T;
}

export interface Zone {
  id: string;
  name: string;
  accountId: string;
}

export async function listZones(token: string): Promise<Zone[]> {
  const zones = await cf<{ id: string; name: string; account: { id: string } }[]>(token, "/zones?per_page=50");
  return zones.map((z) => ({ id: z.id, name: z.name, accountId: z.account.id }));
}

/** Serves the whole hostname from this Worker; Cloudflare creates the DNS record and certificate. */
export function attachDomain(token: string, accountId: string, zoneId: string, hostname: string, worker: string) {
  return cf(token, `/accounts/${accountId}/workers/domains`, {
    method: "PUT",
    body: JSON.stringify({ environment: "production", hostname, service: worker, zone_id: zoneId }),
  });
}

/** Sends one path of an existing site to this Worker, e.g. example.com/book*. */
export function addRoute(token: string, zoneId: string, pattern: string, worker: string) {
  return cf(token, `/zones/${zoneId}/workers/routes`, {
    method: "POST",
    body: JSON.stringify({ pattern, script: worker }),
  });
}

export async function removeRoutes(token: string, zoneId: string, worker: string): Promise<void> {
  const routes = await cf<{ id: string; script?: string }[]>(token, `/zones/${zoneId}/workers/routes`);
  for (const route of routes.filter((r) => r.script === worker)) {
    await cf(token, `/zones/${zoneId}/workers/routes/${route.id}`, { method: "DELETE" });
  }
}

export async function removeDomain(token: string, accountId: string, hostname: string): Promise<void> {
  const domains = await cf<{ id: string; hostname: string }[]>(
    token,
    `/accounts/${accountId}/workers/domains?hostname=${encodeURIComponent(hostname)}`,
  );
  for (const domain of domains.filter((d) => d.hostname === hostname)) {
    await cf(token, `/accounts/${accountId}/workers/domains/${domain.id}`, { method: "DELETE" });
  }
}

/** Adds the DNS records an email provider asks for. Records that already exist are left alone. */
export async function addDnsRecords(token: string, zone: Zone, records: DnsRecord[]): Promise<string[]> {
  const added: string[] = [];
  for (const record of records) {
    const name = record.name.endsWith(zone.name) ? record.name : `${record.name}.${zone.name}`;
    try {
      await cf(token, `/zones/${zone.id}/dns_records`, {
        method: "POST",
        body: JSON.stringify({
          type: record.type,
          name,
          content: record.type === "TXT" ? `"${record.value.replace(/^"|"$/g, "")}"` : record.value,
          ttl: 1,
          ...(record.type === "MX" ? { priority: record.priority ?? 10 } : {}),
          ...(record.type === "CNAME" ? { proxied: false } : {}),
        }),
      });
      added.push(`${record.type} ${name}`);
    } catch (error) {
      if (!/already exists|identical record/i.test(String(error))) throw error;
    }
  }
  return added;
}

/** Link that opens Cloudflare's token page with the right permissions already selected. */
export const TOKEN_TEMPLATE_URL =
  "https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=" +
  encodeURIComponent(
    JSON.stringify([
      { key: "workers_scripts", type: "edit" },
      { key: "workers_routes", type: "edit" },
      { key: "dns", type: "edit" },
      { key: "zone", type: "read" },
    ]),
  ) +
  "&accountId=*&zoneId=all&name=BKNG";
