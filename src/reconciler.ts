import type { CloudflareApi, DnsAction, DnsRecord } from "./cloudflare.js";
import { decideDns } from "./cloudflare.js";
import type { Config } from "./config.js";
import { hostname } from "./config.js";
import type { NginxServer } from "./nginx.js";
import {
  changed,
  managedFilename,
  renderNginx,
  type NginxManager,
} from "./nginx.js";

export interface SyncOptions {
  dryRun: boolean;
  signal?: AbortSignal;
}

export class Reconciler {
  constructor(
    private readonly cloudflare: CloudflareApi,
    private readonly nginx: NginxManager,
    private readonly render: (server: NginxServer) => string = renderNginx,
    private readonly output: Pick<Console, "log" | "error"> = console,
  ) {}

  async sync(
    config: Config,
    publicIp: string,
    options: SyncOptions,
  ): Promise<void> {
    const desiredNginx = this.buildDesiredNginx(config);
    const errors: Error[] = [];
    this.output.log(`Public IPv4: ${publicIp}\n\nCloudflare:`);
    for (const zone of config.zones) {
      let zoneId: string;
      try {
        zoneId = await this.cloudflare.zoneId(zone.domain, options.signal);
      } catch (error) {
        errors.push(asError(`${zone.domain}:`, error));
        continue;
      }
      for (const record of zone.records) {
        const name = hostname(zone.domain, record.name);
        const desired: DnsRecord = {
          type: "A",
          name,
          content: record.ip === "auto" ? publicIp : record.ip,
          proxied: record.proxied,
        };
        try {
          const action = decideDns(
            await this.cloudflare.listRecords(zoneId, name, options.signal),
            desired,
          );
          if (!options.dryRun)
            await this.applyDns(zoneId, action, options.signal);
          this.output.log(
            `${marker(action)} ${name} A ${desired.content} proxied=${String(desired.proxied)}`,
          );
        } catch (error) {
          errors.push(asError(`${name}:`, error));
        }
      }
    }

    this.output.log("\nNginx:");
    try {
      const diff = await this.nginx.reconcile(
        config.settings.nginx_generated_dir,
        desiredNginx,
        options.dryRun,
        options.signal,
      );
      for (const name of diff.create) this.output.log(`+ CREATE ${name}`);
      for (const name of diff.update) this.output.log(`~ UPDATE ${name}`);
      for (const name of diff.remove) this.output.log(`- REMOVE ${name}`);
      this.output.log(`Nginx reload required: ${changed(diff) ? "yes" : "no"}`);
    } catch (error) {
      errors.push(asError("Nginx:", error));
    }
    if (options.dryRun) this.output.log("\nDry run: no changes applied");
    if (errors.length)
      throw new AggregateError(errors, "reconciliation failed");
  }

  buildDesiredNginx(config: Config): Map<string, string> {
    const desired = new Map<string, string>();
    for (const zone of config.zones) {
      for (const record of zone.records) {
        if (!record.nginx) continue;
        const name = hostname(zone.domain, record.name);
        desired.set(
          managedFilename(name),
          this.render({ hostname: name, ...record.nginx }),
        );
      }
    }
    return desired;
  }

  private async applyDns(
    zoneId: string,
    action: DnsAction,
    signal?: AbortSignal,
  ): Promise<void> {
    if (action.kind === "create")
      await this.cloudflare.createRecord(zoneId, action.desired, signal);
    if (action.kind === "update")
      await this.cloudflare.updateRecord(zoneId, action.desired, signal);
  }
}

function marker(action: DnsAction): string {
  return action.kind === "create"
    ? "+ CREATE"
    : action.kind === "update"
      ? "~ UPDATE"
      : "= OK";
}
function asError(prefix: string, error: unknown): Error {
  return new Error(
    `${prefix} ${error instanceof Error ? error.message : String(error)}`,
  );
}
