import { isIP } from "node:net";

export interface IpDetector {
  detect(signal?: AbortSignal): Promise<string>;
}

export class HttpIpDetector implements IpDetector {
  constructor(
    private readonly endpoint = "https://api.ipify.org",
    private readonly attempts = 3,
    private readonly timeoutMs = 10_000,
  ) {}

  async detect(signal?: AbortSignal): Promise<string> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      try {
        const response = await fetch(this.endpoint, {
          signal: AbortSignal.any([
            AbortSignal.timeout(this.timeoutMs),
            ...(signal ? [signal] : []),
          ]),
        });
        if (!response.ok)
          throw new Error(`IP endpoint returned ${response.status}`);
        const value = (await response.text()).trim();
        if (isIP(value) !== 4)
          throw new Error("IP endpoint returned an invalid IPv4 address");
        return value;
      } catch (error) {
        lastError = error;
        if (attempt < this.attempts)
          await new Promise((resolve) => setTimeout(resolve, attempt * 200));
      }
    }
    throw new Error(
      `failed to detect public IPv4: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }
}
