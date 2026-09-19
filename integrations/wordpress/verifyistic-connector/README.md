# Verifyistic Connector (WordPress)

Connects a WordPress site to **Verifyistic Cloud** or a **Self-Hosted** endpoint (project doc 10). Companion to the Verifyistic Core plugin — this connector never owns the local age gate and never treats an age-gate cookie as a signed waiver.

## Features

- **Settings page** (Settings → Verifyistic Connector): mode (Cloud / Self-Hosted), API base URL, site-scoped API key, webhook signing secret, site id. The key and secret are stored server-side only, never rendered back (masked hints only).
- **Connection test** button — verifies the credential against `GET /v1/organization` with admin capability + nonce.
- **Webhook receiver** at `POST /wp-json/verifyistic-connector/v1/webhook`:
  - validates `Verifyistic-Signature` (HMAC-SHA256 over `timestamp.body`),
  - enforces a 10-minute replay window,
  - deduplicates by event id,
  - fires `verifyistic_document_completed`, `verifyistic_status_changed` actions with safe cloud ids only.
- **User waiver flow** — from a user profile, an administrator sends a waiver request: the connector idempotently creates the cloud customer + signing session (Idempotency-Key per user) and stores the signer link in user meta. Completion arrives via webhook and updates status.
- **`[verifyistic_waiver_status]` shortcode** — displays the current user's (or a given user's) waiver status.
- **WooCommerce guard** — optionally block checkout for configured product categories until the current user has a waiver on file (option `verifyistic_connector_woo_categories`, array of term ids).

## Security model (doc 06 §5, doc 10 §5)

- The connector uses a **site-scoped API key** (restricted to its site + scopes) — never an organization master key.
- The key and webhook secret live in `wp_options`, server-side only; admin UI shows masked hints.
- All admin actions are capability-checked (`manage_options` / `edit_user`) + nonced.
- Webhook handler authenticates by HMAC — the route is public by URL but unprovable requests are rejected (401) before any processing.

## Setup

1. In Verifyistic, create a site + an API key restricted to that site (`site_restrictions`).
2. Install and activate this plugin; fill Settings → Verifyistic Connector.
3. Copy the **Webhook receiver URL** into your Verifyistic webhook endpoint configuration and paste the endpoint's signing secret back into the settings.
4. Set the option `verifyistic_connector_template_id` to a published template id to enable "Send waiver request".
