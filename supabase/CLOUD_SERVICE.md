# Transkit Cloud Service — Architecture & Operations Guide

## Overview

Transkit Cloud allows users to transcribe audio using managed provider credentials (Deepgram, Soniox, Gladia) without managing their own API keys. The backend handles authentication, quota enforcement, key rotation, and usage reconciliation.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client (Tauri)                          │
│  TranskitCloudSTTClient                                         │
│    1. getCloudCredentials('stt', options)  ──────────────────┐  │
│    2. innerClient.connect(short-lived-credential)            │  │
│    3. stream audio over WebSocket (direct to provider)       │  │
│    4. reportUsage(session_id, duration_seconds)              │  │
└──────────────────────────────────────────────────────────────│──┘
                                                               │
                    ┌──────────────────────────────────────────▼──┐
                    │           Supabase Edge Functions            │
                    │                                              │
                    │  get-cloud-credentials  (JWT-authenticated)  │
                    │    ├── validates JWT                         │
                    │    ├── checks quota (profiles table)         │
                    │    ├── reads cloud_service_config (admin)    │
                    │    ├── reads master key from Secrets         │
                    │    ├── atomic pre-debit (RPC)               │
                    │    ├── creates short-lived credential        │
                    │    └── inserts usage_sessions row            │
                    │                                              │
                    │  report-usage  (JWT-authenticated)           │
                    │    ├── verifies session ownership            │
                    │    ├── applies MIN_DEBIT_FLOOR               │
                    │    └── reconcile_trial_usage RPC (refund)    │
                    │                                              │
                    │  gladia-session-events  (secret-protected)   │
                    │    ├── validates GLADIA_WEBHOOK_SECRET        │
                    │    ├── parses lifecycle event                │
                    │    └── reconcile_trial_usage RPC (refund)    │
                    └──────────────────────────────────────────────┘
                                        │
              ┌─────────────────────────┼──────────────────────┐
              ▼                         ▼                       ▼
         Deepgram API             Soniox API             Gladia API
    (temporary token TTL)   (temporary key TTL)    (single-use WSS URL
                                                    + lifecycle webhook)
```

---

## Supabase Secrets (master keys — never in DB)

Set with: `supabase secrets set KEY=value`

| Secret | Purpose |
|--------|---------|
| `DEEPGRAM_MASTER_API_KEY` | Deepgram master key used to mint TTL tokens |
| `SONIOX_MASTER_API_KEY` | Soniox master key used to mint temporary keys |
| `GLADIA_MASTER_API_KEY` | Gladia master key used to create WSS sessions |
| `GLADIA_WEBHOOK_SECRET` | Shared secret authenticating Gladia → `gladia-session-events` POST calls |

The secret naming convention is `<PROVIDER_UPPERCASE>_MASTER_API_KEY`. Adding a new provider requires setting this secret and adding a case in `get-cloud-credentials`.

---

## Database Schema

### `profiles` (quota tracking)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | auth.users FK |
| `trial_seconds_used` | INT | protected: REVOKE UPDATE from `authenticated` |
| `trial_limit_seconds` | INT | protected: REVOKE UPDATE from `authenticated` |
| `plan` | TEXT | FK → subscription_plans; protected |

Column-level `REVOKE UPDATE` (migration 003) prevents authenticated users from writing these fields directly via the Supabase client, even if they craft raw API calls.

### `cloud_service_config` (provider routing — admin-managed)

| Column | Type | Notes |
|--------|------|-------|
| `service_type` | TEXT | `'stt'` / `'tts'` / `'ai'` |
| `provider_name` | TEXT | `'deepgram'` / `'soniox'` / `'gladia'` |
| `provider_config` | JSONB | Non-sensitive metadata only (e.g. `{"model":"nova-3"}`) |
| `is_active` | BOOL | Only one active per service_type (unique index) |

**RLS is enabled with no policies** — only `service_role` (edge functions) can access this table. This prevents any client from reading it.

**provider_config must never contain API keys.** Keys live exclusively in Supabase Secrets.

To switch providers:
```sql
UPDATE public.cloud_service_config SET is_active = false WHERE service_type = 'stt';
INSERT INTO public.cloud_service_config (service_type, provider_name, provider_config, is_active)
VALUES ('stt', 'gladia', '{"model":"solaria-1"}', true);
```

### `usage_sessions` (audit trail)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | our session identifier (shared across all providers) |
| `user_id` | UUID | FK → profiles |
| `service_type` | TEXT | `'stt'` / `'tts'` / `'ai'` |
| `provider_name` | TEXT | which provider handled the session |
| `debited_seconds` | INT | seconds pre-debited at session start |
| `duration_seconds` | INT | actual seconds billed after reconciliation (0 = pending) |
| `created_at` | TIMESTAMPTZ | session creation time |

`duration_seconds = 0` means the session has not been reconciled yet. This is set to a positive value by either `report-usage` (client-side) or `gladia-session-events` (server-side webhook), whichever fires first.

---

## Quota Flow

### Pre-debit model

Every session pre-debits up to `MAX_SESSION_CAP = 1800` seconds (30 min) at the start. This ensures quota is always reserved even if the client disconnects abnormally.

```
getCloudCredentials called
  → atomic debit_trial_usage RPC (FOR UPDATE lock)
  → returns actualDebit (0 = quota exhausted → abort)

session ends
  → report-usage (client) OR gladia-session-events (webhook)
  → actual duration computed
  → floor applied: min(actual, MIN_DEBIT_FLOOR=60s)
  → refund = debited - billable
  → reconcile_trial_usage RPC
```

### Why two reconciliation paths?

| Path | When | Applies to |
|------|------|-----------|
| `report-usage` (client) | Client calls it on Stop | Deepgram, Soniox, Gladia |
| `gladia-session-events` (webhook) | Gladia POSTs when session ends | Gladia only |

For Gladia, the webhook is the authoritative path. `report-usage` becomes a no-op if the webhook already set `duration_seconds > 0`.

For Deepgram and Soniox, `report-usage` is the only path. Their TTL tokens expire automatically (provider-side), but quota reconciliation depends on the client calling `report-usage` correctly.

### MIN_DEBIT_FLOOR

`report-usage` always bills at least 60 seconds (`MIN_DEBIT_FLOOR`) for any open session, regardless of what `duration_seconds` the client reports. This prevents a client from opening a session, using it fully, then reporting 0 seconds for a full refund.

The floor does not apply to the Gladia webhook path (server-computed duration is authoritative).

---

## Edge Functions

### `get-cloud-credentials`

**Auth:** JWT (Supabase anon key)
**Method:** POST
**Body:** `{ service_type: 'stt', options: { sourceLanguage?, targetLanguage?, context?, endpointing?, speechThreshold? } }`

Returns short-lived credentials for the active provider. The credential shape differs per provider:

| Provider | Credential | Notes |
|----------|-----------|-------|
| `deepgram` | `{ token: string }` | TTL = debited_seconds |
| `soniox` | `{ api_key: string }` | TTL = debited_seconds |
| `gladia` | `{ url: string }` | Single-use WSS URL, valid until used or session timeout |

### `report-usage`

**Auth:** JWT
**Method:** POST
**Body:** `{ session_id: string, duration_seconds: number }`

Reconciles quota after a session ends. Idempotent — safe to call multiple times.

### `gladia-session-events`

**Auth:** `?secret=<GLADIA_WEBHOOK_SECRET>` query param
**Method:** POST
**Body:** Gladia lifecycle event payload

Receives `session_end` events from Gladia and reconciles quota server-side. The `custom_metadata.session_id` field maps back to `usage_sessions.id`.

The endpoint uses constant-time string comparison for secret validation to prevent timing attacks.

### `get-deepgram-token` / `get-soniox-key` (deprecated)

Both return **410 Gone**. These were the original per-provider endpoints before the unified `get-cloud-credentials` was introduced. They are kept deployed to fail loudly for any stale integrations rather than silently bypassing quota logic.

---

## Adding a New Provider

1. **Set the master key secret:**
   ```bash
   supabase secrets set NEWPROVIDER_MASTER_API_KEY=xxx
   ```

2. **Add a case in `get-cloud-credentials`** (`_getNewProviderCredential` function following the existing pattern).

3. **Insert into `cloud_service_config`:**
   ```sql
   INSERT INTO public.cloud_service_config (service_type, provider_name, provider_config, is_active)
   VALUES ('stt', 'newprovider', '{"model":"model-name"}', true);
   ```
   (Deactivate the previous active provider first if switching.)

4. **Add a case in `TranskitCloudSTTClient`** (client.js) to instantiate the matching inner client with the returned credentials.

5. **If the provider supports server-side lifecycle webhooks:** create a `<provider>-session-events` edge function following the `gladia-session-events` pattern.

---

## Security Properties Summary

| Property | Mechanism |
|----------|----------|
| Master keys never reach client | Keys in Deno.env (Secrets), not DB; only returned values are short-lived credentials |
| Client can't write own quota | Column-level `REVOKE UPDATE` on `trial_seconds_used`, `trial_limit_seconds`, `plan` |
| Client can't read provider config | `cloud_service_config` has RLS enabled, no policies for `authenticated` role |
| Concurrent session race prevented | `debit_trial_usage` uses `FOR UPDATE` row lock; returns 0 if quota exhausted |
| Session ownership enforced | `report-usage` queries `WHERE user_id = auth.uid()` |
| Webhook spoofing prevented | Constant-time secret comparison on `GLADIA_WEBHOOK_SECRET` |
| Credential fraud bounded | Short-lived TTL on all credentials; `MIN_DEBIT_FLOOR` limits refund abuse |
| Old endpoints can't bypass quota | Legacy functions return 410 Gone |
