#!/usr/bin/env node
import { App } from "./app.js";
import { loadCwdEnv } from "./env.js";

const VERSION = "0.1.0";

interface Options {
  config: string;
  dryRun: boolean;
}
function parseOptions(args: string[]): Options {
  let config = "./config.yml";
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--dry-run") dryRun = true;
    else if (value === "--config") {
      const next = args[index + 1];
      if (!next) throw new Error("--config requires a path");
      config = next;
      index += 1;
    } else throw new Error(`unknown option ${value}`);
  }
  return { config, dryRun };
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "version") {
    console.log(`cf-reconciler ${VERSION}`);
    return;
  }
  if (!command || !["run", "sync", "validate"].includes(command))
    throw new Error(
      "usage: cf-reconciler <run|sync|validate|version> [--config PATH] [--dry-run]",
    );
  const options = parseOptions(args);
  loadCwdEnv();
  if (options.dryRun && command !== "sync")
    throw new Error("--dry-run is only valid with sync");
  const controller = new AbortController();
  for (const event of ["SIGINT", "SIGTERM"] as const)
    process.once(event, () => controller.abort());
  const app = new App();
  if (command === "validate") {
    await app.validate(options.config);
    console.log("configuration is valid");
  } else if (command === "sync")
    await app.sync(options.config, options.dryRun, controller.signal);
  else await app.run(options.config, controller.signal);
}

main().catch((error: unknown) => {
  if (error instanceof AggregateError) {
    console.error(error.message);
    for (const item of error.errors)
      console.error(`- ${item instanceof Error ? item.message : String(item)}`);
  } else console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
