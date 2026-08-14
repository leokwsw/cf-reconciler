# Contributing

需要 Node.js 22+、Corepack與 pnpm：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

測試必須使用 fake `fetch`、Cloudflare API及 Nginx runner，不可依賴真實 token、network、root或 installed Nginx。PR保持單一目的、使用 strict TypeScript、避免 `any`與 floating promises，並同步文件及 changelog。

優先序：correctness、安全、簡單、可維護性、低資源使用。不要加入 Docker、database、UI、其他 DNS types或 framework-heavy abstractions。
