export interface DnsRecord {
  id?: string;
  type: "A";
  name: string;
  content: string;
  proxied: boolean;
}

interface ApiError {
  code?: number;
  message?: string;
}
interface Envelope<T> {
  success: boolean;
  result: T;
  errors?: ApiError[];
}

export interface CloudflareApi {
  zoneId(name: string, signal?: AbortSignal): Promise<string>;
  listRecords(
    zoneId: string,
    name: string,
    signal?: AbortSignal,
  ): Promise<DnsRecord[]>;
  createRecord(
    zoneId: string,
    record: DnsRecord,
    signal?: AbortSignal,
  ): Promise<void>;
  updateRecord(
    zoneId: string,
    record: DnsRecord,
    signal?: AbortSignal,
  ): Promise<void>;
}

export class CloudflareClient implements CloudflareApi {
  constructor(
    private readonly token: string,
    private readonly baseUrl = "https://api.cloudflare.com/client/v4",
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const requestSignal = AbortSignal.any([
      AbortSignal.timeout(15_000),
      ...(signal ? [signal] : []),
    ]);
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: requestSignal,
    });
    const text = (await response.text()).slice(0, 1_048_576);
    let envelope: Envelope<T>;
    try {
      envelope = JSON.parse(text) as Envelope<T>;
    } catch {
      throw new Error(
        `Cloudflare API ${response.status} ${response.statusText}: invalid JSON response`,
      );
    }
    if (!response.ok || !envelope.success) {
      const details = envelope.errors
        ?.filter((error) => error.message)
        .map(
          (error) =>
            `${error.code === undefined ? "" : `code ${error.code}: `}${error.message}`,
        )
        .join("; ");
      throw new Error(
        `Cloudflare API ${response.status} ${response.statusText}${details ? `: ${details}` : ""}`,
      );
    }
    return envelope.result;
  }

  async zoneId(name: string, signal?: AbortSignal): Promise<string> {
    const zones = await this.request<Array<{ id: string }>>(
      "GET",
      `/zones?name=${encodeURIComponent(name)}`,
      undefined,
      signal,
    );
    if (zones.length !== 1)
      throw new Error(
        `expected one Cloudflare zone for ${name}, found ${zones.length}`,
      );
    return zones[0]!.id;
  }
  listRecords(
    zoneId: string,
    name: string,
    signal?: AbortSignal,
  ): Promise<DnsRecord[]> {
    return this.request(
      "GET",
      `/zones/${zoneId}/dns_records?type=A&name=${encodeURIComponent(name)}`,
      undefined,
      signal,
    );
  }
  async createRecord(
    zoneId: string,
    record: DnsRecord,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.request("POST", `/zones/${zoneId}/dns_records`, record, signal);
  }
  async updateRecord(
    zoneId: string,
    record: DnsRecord,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!record.id)
      throw new Error(`cannot update ${record.name} without a record id`);
    await this.request(
      "PUT",
      `/zones/${zoneId}/dns_records/${record.id}`,
      record,
      signal,
    );
  }
}

export type DnsAction = {
  kind: "create" | "update" | "ok";
  before?: DnsRecord;
  desired: DnsRecord;
};
export function decideDns(
  existing: DnsRecord[],
  desired: DnsRecord,
): DnsAction {
  if (existing.length > 1)
    throw new Error(`multiple A records found for ${desired.name}`);
  const current = existing[0];
  if (!current) return { kind: "create", desired };
  const withId: DnsRecord = {
    ...desired,
    ...(current.id === undefined ? {} : { id: current.id }),
  };
  return current.content !== desired.content ||
    current.proxied !== desired.proxied
    ? { kind: "update", before: current, desired: withId }
    : { kind: "ok", before: current, desired: withId };
}
