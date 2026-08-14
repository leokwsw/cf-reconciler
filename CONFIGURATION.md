# Configuration

YAML使用 strict schema；未知欄位或無效值會拒絕整份設定。daemon運行時會保留上一份有效設定。

- `cloudflare.token_env`：必填，Cloudflare token環境變數名稱。
- `settings.ip_check_interval`：`ms/s/m/h` duration，預設 `60s`。
- `settings.nginx_generated_dir`：預設 `/etc/nginx/sites-enabled`；只管理 `cf-reconciler--*.conf`。
- `zones[].domain`：小寫 zone domain。
- `records[].name`：`@`、單層或 nested labels；`api.dev`會生成 `api.dev.example.com`。
- `type`：V1只接受 `A`。
- `ip`：`auto`或 IPv4。
- `proxied`：Cloudflare proxy boolean。
- `nginx.target`：`host:port`；省略整個 `nginx`即只管理 DNS。
- `nginx.websocket`、`cors`：預設 false。
- `nginx.well_known_root`：安全 absolute path。
- `proxy_read_timeout`、`proxy_send_timeout`、`proxy_connect_timeout`：Nginx duration。
- `nginx.tls.certificate`、`certificate_key`：既有檔案 absolute paths。
- `nginx.tls.redirect_http`：是否 redirect port 80至 HTTPS。

```yaml
cloudflare:
  token_env: CLOUDFLARE_API_TOKEN
settings:
  ip_check_interval: 60s
  nginx_generated_dir: /etc/nginx/sites-enabled
zones:
  - domain: example.com
    records:
      - name: "@"
        type: A
        ip: auto
        proxied: false
      - name: chat.dev
        type: A
        ip: auto
        proxied: true
        nginx:
          target: 10.0.0.107:9596
          websocket: true
          cors: true
          well_known_root: /var/www
          proxy_read_timeout: 500s
          proxy_send_timeout: 500s
          proxy_connect_timeout: 180s
          tls:
            certificate: /root/ssl/example.com/fullchain.cer
            certificate_key: /root/ssl/example.com/private.key
            redirect_http: true
      - name: static
        type: A
        ip: 192.0.2.10
        proxied: false
```

Name每個 label必須為小寫 DNS label，不能有空 label、前後 dot/hyphen；完整 hostname不可超過253字元且不可重複。TLS只引用現有檔案，不包含 ACME、簽發或續期。
