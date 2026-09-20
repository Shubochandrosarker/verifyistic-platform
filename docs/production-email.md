# Verifyistic production email

The cloud worker sends signing invitations from the DB-backed email outbox. The
production adapter is authenticated SMTP, not a browser request to the Sendlr
dashboard. `apps/worker/wrangler.toml` is preconfigured for:

- host: `mail.wpistic.com`
- implicit TLS port: `465`
- envelope/header sender: `Verifyistic <noreply@verifyistic.com>`

The Worker secrets are set at deployment time and must never be committed:

```text
SMTP_USER
SMTP_PASSWORD
WEBHOOK_ENCRYPTION_KEY
```

Before deploying those secrets, verify that `mail.wpistic.com` is DNS-only and
resolves directly to the VPS SMTP service. Cloudflare's HTTP proxy/tunnel route
for the Sendlr web UI is not an SMTP service and does not proxy SMTP on 465.
The SMTP daemon must advertise `AUTH PLAIN` or `AUTH LOGIN` over implicit TLS on
465. Port 587 can be used by changing `SMTP_MODE` to `starttls` and
`SMTP_PORT` to `587`.

The release gate for email is:

1. The VPS has a real SMTP listener on the selected port.
2. The sender mailbox exists and authenticates successfully.
3. SPF, DKIM, and DMARC are published for the sending domain.
4. `SMTP_USER` and `SMTP_PASSWORD` are injected with `wrangler secret put`.
5. A real Verifyistic signing invitation reaches a controlled test mailbox and
   the corresponding D1 `email_outbox` row becomes `sent`.

Until these checks pass, the Worker intentionally retries the outbox and does
not claim successful delivery.
