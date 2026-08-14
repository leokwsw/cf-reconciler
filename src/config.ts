import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, normalize, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const safePath = (value: string): boolean => {
  if (!value || /[\s;{}]/.test(value)) return false;
  const normalized = normalize(value);
  return (
    isAbsolute(value) || (!normalized.startsWith("..") && normalized !== "..")
  );
};

export function parseDuration(value: string): number {
  const match = /^(\d+)(ms|s|m|h)$/.exec(value);
  if (!match) throw new Error(`invalid duration ${JSON.stringify(value)}`);
  const amount = Number(match[1]);
  if (amount <= 0) throw new Error("duration must be positive");
  const factors = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 } as const;
  return amount * factors[match[2] as keyof typeof factors];
}

const duration = z.string().refine((value) => {
  try {
    parseDuration(value);
    return true;
  } catch {
    return false;
  }
}, "must be a positive duration such as 500ms, 60s, 5m, or 1h");

const recordName = z.string().refine((value) => {
  if (value === "@") return true;
  if (
    value !== value.toLowerCase() ||
    value.startsWith(".") ||
    value.endsWith(".")
  )
    return false;
  return value.split(".").every((label) => dnsLabel.test(label));
}, "must be @ or lowercase DNS labels separated by dots");

const domain = z.string().refine((value) => {
  const labels = value.split(".");
  return (
    value.length <= 253 &&
    value === value.toLowerCase() &&
    labels.length >= 2 &&
    labels.every((label) => dnsLabel.test(label))
  );
}, "must be a valid lowercase domain");

const ipv4 = z.string().refine((value) => {
  if (value === "auto") return true;
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}, "must be auto or a valid IPv4 address");

const target = z.string().refine((value) => {
  const match = /^([^\s:/]+):(\d{1,5})$/.exec(value);
  return match !== null && Number(match[2]) >= 1 && Number(match[2]) <= 65_535;
}, "must be host:port");

const nginxSchema = z.strictObject({
  target,
  websocket: z.boolean().default(false),
  cors: z.boolean().default(false),
  well_known_root: z
    .string()
    .refine(safePath, "must be a safe absolute or config-relative path")
    .optional(),
  proxy_read_timeout: duration.optional(),
  proxy_send_timeout: duration.optional(),
  proxy_connect_timeout: duration.optional(),
  tls: z
    .strictObject({
      certificate: z
        .string()
        .refine(safePath, "must be a safe absolute or config-relative path"),
      certificate_key: z
        .string()
        .refine(safePath, "must be a safe absolute or config-relative path"),
      redirect_http: z.boolean().default(false),
    })
    .optional(),
});

const configSchema = z
  .strictObject({
    cloudflare: z.strictObject({ token_env: z.string().min(1) }),
    settings: z
      .strictObject({
        ip_check_interval: duration.default("60s"),
        nginx_generated_dir: z
          .string()
          .refine(safePath, "must be a safe absolute or config-relative path")
          .default("/etc/nginx/sites-enabled"),
      })
      .default({
        ip_check_interval: "60s",
        nginx_generated_dir: "/etc/nginx/sites-enabled",
      }),
    zones: z
      .array(
        z.strictObject({
          domain,
          records: z.array(
            z.strictObject({
              name: recordName,
              type: z.literal("A"),
              ip: ipv4,
              proxied: z.boolean(),
              nginx: nginxSchema.optional(),
            }),
          ),
        }),
      )
      .min(1),
  })
  .superRefine((config, context) => {
    const seen = new Set<string>();
    for (const zone of config.zones) {
      for (const record of zone.records) {
        const host = hostname(zone.domain, record.name);
        if (host.length > 253)
          context.addIssue({
            code: "custom",
            message: `${host} exceeds 253 characters`,
          });
        if (seen.has(host))
          context.addIssue({
            code: "custom",
            message: `duplicate hostname: ${host}`,
          });
        seen.add(host);
      }
    }
  });

export type Config = z.infer<typeof configSchema>;
export type NginxConfig = NonNullable<
  Config["zones"][number]["records"][number]["nginx"]
>;

export function hostname(zone: string, name: string): string {
  return name === "@" ? zone : `${name}.${zone}`;
}

export async function loadConfig(
  path: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Config> {
  let raw: unknown;
  try {
    raw = parseYaml(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(
      `cannot read or parse ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const result = configSchema.safeParse(raw);
  if (!result.success)
    throw new Error(`invalid configuration:\n${z.prettifyError(result.error)}`);
  if (!env[result.data.cloudflare.token_env]) {
    throw new Error(
      `environment variable ${result.data.cloudflare.token_env} is not set`,
    );
  }
  const root = dirname(resolve(path));
  result.data.settings.nginx_generated_dir = resolve(
    root,
    result.data.settings.nginx_generated_dir,
  );
  for (const zone of result.data.zones) {
    for (const record of zone.records) {
      if (record.nginx?.well_known_root) {
        record.nginx.well_known_root = resolve(
          root,
          record.nginx.well_known_root,
        );
      }
      if (record.nginx?.tls) {
        record.nginx.tls.certificate = resolve(
          root,
          record.nginx.tls.certificate,
        );
        record.nginx.tls.certificate_key = resolve(
          root,
          record.nginx.tls.certificate_key,
        );
      }
    }
  }
  return result.data;
}
