import chokidar, { type FSWatcher } from "chokidar";
import { CloudflareClient } from "./cloudflare.js";
import type { Config } from "./config.js";
import { loadConfig, parseDuration } from "./config.js";
import type { IpDetector } from "./ip.js";
import { HttpIpDetector } from "./ip.js";
import { CommandNginxRunner, NginxManager, type NginxRunner } from "./nginx.js";
import { Reconciler } from "./reconciler.js";

const CONFIG_DEBOUNCE_MS = 500;

export class App {
  constructor(
    private readonly detector: IpDetector = new HttpIpDetector(),
    private readonly nginxRunner: NginxRunner = new CommandNginxRunner(),
    private readonly logger: Pick<Console, "log" | "error"> = console,
  ) {}

  async validate(path: string): Promise<void> {
    await loadConfig(path);
  }

  async sync(
    path: string,
    dryRun: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    const config = await loadConfig(path);
    const publicIp = await this.detector.detect(signal);
    await this.reconciler(config).sync(config, publicIp, {
      dryRun,
      ...(signal ? { signal } : {}),
    });
  }

  async run(path: string, signal: AbortSignal): Promise<void> {
    let config = await loadConfig(path);
    let publicIp = await this.detector.detect(signal);
    await this.reconciler(config)
      .sync(config, publicIp, { dryRun: false, signal })
      .catch((error: unknown) => this.logger.error(error));

    let queue = Promise.resolve();
    let debounce: NodeJS.Timeout | undefined;
    let interval: NodeJS.Timeout;
    const enqueue = (operation: () => Promise<void>): void => {
      queue = queue
        .then(operation)
        .catch((error: unknown) => this.logger.error(error));
    };
    const resetInterval = (): void => {
      clearInterval(interval);
      interval = setInterval(
        () => enqueue(checkIp),
        parseDuration(config.settings.ip_check_interval),
      );
    };
    const checkIp = async (): Promise<void> => {
      const nextIp = await this.detector.detect(signal);
      if (nextIp === publicIp) {
        this.logger.log(`Public IPv4 checked: ${publicIp} (unchanged)`);
        return;
      }
      this.logger.log(`Public IPv4 changed: ${publicIp} -> ${nextIp}`);
      publicIp = nextIp;
      await this.reconciler(config).sync(config, publicIp, {
        dryRun: false,
        signal,
      });
    };
    const reloadConfig = async (): Promise<void> => {
      let next: Config;
      try {
        next = await loadConfig(path);
      } catch (error) {
        this.logger.error(
          `New configuration rejected; retaining previous configuration: ${String(error)}`,
        );
        return;
      }
      config = next;
      resetInterval();
      try {
        publicIp = await this.detector.detect(signal);
      } catch (error) {
        this.logger.error(
          `Public IP lookup failed; retaining ${publicIp}: ${String(error)}`,
        );
      }
      await this.reconciler(config).sync(config, publicIp, {
        dryRun: false,
        signal,
      });
    };

    let watcher: FSWatcher | undefined;
    interval = setInterval(
      () => enqueue(checkIp),
      parseDuration(config.settings.ip_check_interval),
    );
    try {
      watcher = chokidar.watch(path, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 },
      });
      watcher.on("all", () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => enqueue(reloadConfig), CONFIG_DEBOUNCE_MS);
      });
      watcher.on("error", (error) =>
        this.logger.error(`Config watcher error: ${String(error)}`),
      );
      if (!signal.aborted) {
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      }
      await queue;
    } finally {
      clearInterval(interval);
      if (debounce) clearTimeout(debounce);
      await watcher?.close();
    }
  }

  private reconciler(config: Config): Reconciler {
    return new Reconciler(
      new CloudflareClient(process.env[config.cloudflare.token_env]!),
      new NginxManager(this.nginxRunner),
      undefined,
      this.logger,
    );
  }
}
