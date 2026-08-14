import { resolve } from "node:path";

export function loadCwdEnv(): void {
  const path = resolve(process.cwd(), ".env");
  try {
    process.loadEnvFile(path);
  } catch (error) {
    throw new Error(
      `cannot load ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
