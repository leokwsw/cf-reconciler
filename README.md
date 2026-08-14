# cf-reconciler

以 TypeScript/Node.js 實作的輕量 Linux daemon。`config.yml` 是 Cloudflare A records 與 Nginx reverse proxies 的唯一 source of truth；PM2 負責開機啟動、程序重啟與 logs。

## 功能

- 單一 Cloudflare account，多 zones、apex、subdomain及 nested subdomain
- `ip: auto` 自動追蹤 public IPv4，或使用 static IPv4
- 只建立/更新 YAML 宣告的 A records，絕不掃描或改寫其他 records
- Cloudflare proxy `true/false`，scoped API Token只從 environment 讀取
- Nginx HTTP/HTTPS、既有 TLS cert/key、redirect、WebSocket、CORS、timeouts、`/.well-known`
- 完整 staging set、候選驗證、production `nginx -t`、受管檔案級部署與 rollback
- Config file watch、500ms debounce、serial reconciliation
- 每次 public IP檢查輸出 heartbeat log，IP改變時才執行 reconciliation
- `run`、`sync`、`sync --dry-run`、`validate`、`version`

## 快速開始

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
chmod 600 .env
node --import tsx src/cli.ts validate --config config.yml
```

`.env`、`config.yml`、PM2 ecosystem及 TypeScript source全部放在專案 root；Node.js會在所有 CLI commands啟動時載入目前工作目錄的 `.env`。PM2的 `cwd`已設定為專案 root。

```yaml
cloudflare:
  token_env: CLOUDFLARE_API_TOKEN
settings:
  ip_check_interval: 60s
  nginx_generated_dir: /etc/nginx/sites-enabled
zones:
  - domain: example.com
    records:
      - name: api.dev
        type: A
        ip: auto
        proxied: true
        nginx:
          target: 127.0.0.1:3000
          websocket: true
```

完整部署見 [INSTALL.md](INSTALL.md)，所有 YAML 欄位見 [設定參考](CONFIGURATION.md)。正式支援 Node.js 22+、Ubuntu/Debian、PM2、Nginx與 Cloudflare DNS。

## TLS 與 V1 邊界

`cf-reconciler` 可以引用已存在的 certificate/key、生成 HTTPS server blocks及 HTTP→HTTPS redirect；不會申請、續期或管理 certificates。V1 不支援 IPv6/AAAA、CNAME/TXT/MX、多 Cloudflare accounts、Let's Encrypt automation、Cloudflare Tunnel、Docker、database、UI或 telemetry。
