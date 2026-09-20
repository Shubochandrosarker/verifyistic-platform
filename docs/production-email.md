# Verifyistic production email

The cloud worker sends signing invitations from the DB-backed email outbox. The
production adapter is Postmark's transactional API. The Worker never sends
through a browser request to the MailRivo/Sendlr dashboard. The production
configuration is:

- provider: `postmark`
- message stream: `outbound`
- sender: `Verifyistic <noreply@verifyistic.com>`

The Worker secrets are set at deployment time and must never be committed:

```text
POSTMARK_SERVER_TOKEN
WEBHOOK_ENCRYPTION_KEY
```

Postmark must have `verifyistic.com` verified with SPF and DKIM. Publish a
DMARC policy for the domain before sending production traffic. The sender and
message stream must remain transactional; bulk campaigns belong in a separate
provider stream and should not share the signing-email reputation.

The release gate for email is:

1. Postmark has verified the sending domain and sender.
2. SPF, DKIM, and DMARC are published for the sending domain.
3. `POSTMARK_SERVER_TOKEN` is injected with `wrangler secret put`.
4. A real Verifyistic signing invitation reaches a controlled test mailbox and
   the corresponding D1 `email_outbox` row becomes `sent`.

The repository still includes an authenticated SMTP adapter as a compatibility
fallback, but production selection is explicit through `EMAIL_PROVIDER` and is
currently set to Postmark.
