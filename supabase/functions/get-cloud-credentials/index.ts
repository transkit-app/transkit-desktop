/**
 * get-cloud-credentials
 *
 * Unified credential resolver for all Transkit Cloud services.
 * Validates the user's JWT, checks quota, reads cloud_service_config to find
 * the active provider, then generates short-lived session credentials for that
 * provider — without ever exposing master API keys to the client.
 *
 * ── Key storage ───────────────────────────────────────────────────────────────
 * Master API keys are stored in Supabase Secrets (Deno.env), NOT in the database.
 * Secret names follow the pattern: <PROVIDER>_MASTER_API_KEY
 *   DEEPGRAM_MASTER_API_KEY  — Deepgram master API key
 *   SONIOX_MASTER_API_KEY    — Soniox master API key
 *   GLADIA_MASTER_API_KEY    — Gladia master API key
 *
 * cloud_service_config.provider_config stores only non-sensitive metadata:
 *   deepgram → { "model": "nova-3" }
 *   soniox   → {}
 *   gladia   → { "model": "solaria-1" }
 *
 * Set secrets with: supabase secrets set DEEPGRAM_MASTER_API_KEY=dg-xxxx
 *
 * ── Gladia webhook ────────────────────────────────────────────────────────────
 * For Gladia sessions, a callback_config is injected at session creation time
 * pointing to the gladia-session-events edge function. This allows server-side
 * quota reconciliation when the session ends, independent of the client calling
 * report-usage. The callback URL is authenticated with GLADIA_WEBHOOK_SECRET.
 *
 * Set with: supabase secrets set GLADIA_WEBHOOK_SECRET=<random-string>
 *
 * ── Request body ──────────────────────────────────────────────────────────────
 *   {
 *     service_type: 'stt' | 'tts' | 'ai',
 *     options?: {
 *       sourceLanguage?: string,
 *       targetLanguage?: string,
 *       context?: { text?: string; terms?: string[] },
 *       endpointing?: number,
 *       speechThreshold?: number,
 *     }
 *   }
 *
 * ── Response (200) ────────────────────────────────────────────────────────────
 *   {
 *     provider:          string,   // 'deepgram' | 'soniox' | 'gladia'
 *     credentials:       object,   // provider-specific session credentials only
 *     session_id:        string,
 *     remaining_seconds: number,
 *     debited_seconds:   number,
 *     plan:              string,
 *   }
 *
 * Credential shapes (short-lived, never contain master keys):
 *   deepgram →  { token: string }          (TTL-limited Deepgram access token)
 *   soniox   →  { api_key: string }        (TTL-limited Soniox temporary key)
 *   gladia   →  { url: string }            (pre-created WSS session URL)
 *
 * Error codes:
 *   unauthorized           – missing / invalid JWT
 *   invalid_request        – missing / unknown service_type
 *   profile_not_found      – profile row missing
 *   quota_exceeded         – no seconds left in plan
 *   service_not_configured – no active provider in cloud_service_config
 *   key_not_configured     – secret not set for this provider
 *   credential_error       – upstream provider API failed
 *   server_error           – unexpected internal failure
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyUser, AuthError } from '../_shared/auth.ts'

const MAX_SESSION_CAP = 1800 // 30 minutes

const VALID_SERVICE_TYPES = ['stt', 'tts', 'ai'] as const
type ServiceType = typeof VALID_SERVICE_TYPES[number]

// ─── Entry point ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  // 1. Verify JWT — manual verification required (Supabase JWT middleware disabled)
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  let user: Awaited<ReturnType<typeof verifyUser>>
  try {
    user = await verifyUser(req, admin)
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.code }, e.status)
    return json({ error: 'unauthorized' }, 401)
  }

  // 2. Parse body
  let body: { service_type?: string; options?: Record<string, unknown> } = {}
  try { body = await req.json() } catch { /* empty body — service_type check below */ }

  const serviceType = body.service_type as ServiceType | undefined
  if (!serviceType || !VALID_SERVICE_TYPES.includes(serviceType)) {
    return json({
      error: 'invalid_request',
      detail: `service_type must be one of: ${VALID_SERVICE_TYPES.join(', ')}`,
    }, 400)
  }

  const options = body.options ?? {}

  // 3. Load user profile for quota check
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('stt_seconds_used, plan_stt_limit, plan')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    await admin.from('profiles').upsert(
      { id: user.id, email: user.email },
      { onConflict: 'id', ignoreDuplicates: true }
    )
    return json({ error: 'profile_not_found' }, 404)
  }

  // 4. Quota enforcement
  let remaining = 0
  if (serviceType === 'stt') {
    const isUnlimited = profile.plan_stt_limit === -1
    remaining = isUnlimited
      ? MAX_SESSION_CAP
      : profile.plan_stt_limit - profile.stt_seconds_used

    if (!isUnlimited && remaining <= 0) {
      return json({
        error: 'quota_exceeded',
        used: profile.stt_seconds_used,
        limit: profile.plan_stt_limit,
      }, 403)
    }
  } else {
    // TTS / AI: not available in this phase
    return json({ error: 'quota_exceeded', used: 0, limit: 0 }, 403)
  }

  // 5. Resolve active provider (metadata only — no API keys in DB)
  const { data: serviceConfig, error: configError } = await admin
    .from('cloud_service_config')
    .select('provider_name, provider_config, min_plan')
    .eq('service_type', serviceType)
    .eq('is_active', true)
    .single()

  if (configError || !serviceConfig) {
    console.error('[get-cloud-credentials] No active config for service_type:', serviceType, configError)
    return json({ error: 'service_not_configured' }, 503)
  }

  const providerName: string = serviceConfig.provider_name
  // provider_config contains only non-sensitive options (model name, etc.)
  const providerMeta: Record<string, string> = serviceConfig.provider_config ?? {}

  // 6. Resolve master API key from Supabase Secrets — never from DB
  const secretName = `${providerName.toUpperCase()}_MASTER_API_KEY`
  const masterKey = Deno.env.get(secretName)
  if (!masterKey) {
    console.error(`[get-cloud-credentials] Secret not set: ${secretName}`)
    return json({ error: 'key_not_configured' }, 503)
  }

  // 7. Create session ID early — needed for Gladia callback_config before debit
  const sessionId = crypto.randomUUID()

  // 8. Atomic pre-debit via RPC (FOR UPDATE lock prevents concurrent over-spend)
  //    RPC returns the actual seconds debited; 0 means quota was already exhausted.
  const debitTarget = Math.min(remaining, MAX_SESSION_CAP)

  const { data: actualDebit, error: debitError } = await admin.rpc('debit_trial_usage', {
    p_user_id: user.id,
    p_seconds: debitTarget,
  })
  if (debitError) {
    console.error('[get-cloud-credentials] Debit error:', debitError)
    return json({ error: 'server_error' }, 500)
  }

  // RPC returns 0 if quota was exhausted by a concurrent request
  if (!actualDebit || actualDebit <= 0) {
    return json({
      error: 'quota_exceeded',
      used: profile.stt_seconds_used,
      limit: profile.plan_stt_limit,
    }, 403)
  }

  const debitedSeconds: number = actualDebit

  // 9. Generate short-lived session credentials using the master key from Secrets
  let credentials: Record<string, string>

  try {
    switch (providerName) {
      case 'deepgram':
        credentials = await _getDeepgramToken(masterKey, debitedSeconds)
        break
      case 'soniox':
        credentials = await _getSonioxKey(masterKey, debitedSeconds, user.id)
        break
      case 'gladia':
        credentials = await _getGladiaSession(masterKey, providerMeta, options, {
          sessionId,
          userId: user.id,
        })
        break
      default:
        throw new Error(`Unsupported provider: ${providerName}`)
    }
  } catch (credErr) {
    // Refund pre-debit so the user is not charged for a failed session
    await admin.rpc('reconcile_trial_usage', { p_user_id: user.id, p_refund_seconds: debitedSeconds })
    console.error('[get-cloud-credentials] Credential error:', credErr)
    return json({ error: 'credential_error', detail: String(credErr) }, 502)
  }

  // 10. Persist usage session record
  await admin.from('usage_sessions').insert({
    id: sessionId,
    user_id: user.id,
    duration_seconds: 0,
    debited_seconds: debitedSeconds,
    service_type: serviceType,
    provider_name: providerName,
  })

  return json({
    provider: providerName,
    credentials,
    session_id: sessionId,
    remaining_seconds: remaining,
    debited_seconds: debitedSeconds,
    plan: profile.plan ?? 'trial',
  })
})

// ─── Provider credential generators ──────────────────────────────────────────
// masterKey comes from Supabase Secrets via Deno.env — never from the database.
// Only short-lived session credentials are returned to the client.

/**
 * Deepgram — creates a TTL-limited access token via Deepgram's grant API.
 * Returns: { token: string }
 */
async function _getDeepgramToken(
  masterKey: string,
  ttlSeconds: number
): Promise<{ token: string }> {
  const res = await fetch('https://api.deepgram.com/v1/auth/grant', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${masterKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ time_to_live_in_seconds: ttlSeconds }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Deepgram API ${res.status}: ${detail}`)
  }

  const { access_token } = await res.json()
  return { token: access_token }
}

/**
 * Soniox — creates a TTL-limited temporary API key.
 * Returns: { api_key: string }
 */
async function _getSonioxKey(
  masterKey: string,
  ttlSeconds: number,
  userId: string
): Promise<{ api_key: string }> {
  const referenceId = `transkit_${userId}_${Date.now()}`

  const res = await fetch('https://soniox.com/v1/auth/temporary-api-key', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${masterKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      usage_type: 'transcribe_websocket',
      expires_in_seconds: ttlSeconds,
      client_reference_id: referenceId,
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Soniox API ${res.status}: ${detail}`)
  }

  const { api_key } = await res.json()
  return { api_key }
}

/**
 * Gladia — creates a live session server-side and returns the single-use WSS URL.
 * The client connects directly to this URL; the master key never leaves the server.
 * Returns: { url: string }
 *
 * A callback_config is injected pointing to gladia-session-events so quota is
 * reconciled server-side when the session ends, independent of the client.
 *
 * providerMeta: non-sensitive options from cloud_service_config (e.g. { model: 'solaria-1' })
 * options: session options forwarded from the client (language, translation, context…)
 * session: our session_id and user_id for callback_config custom_metadata
 */
async function _getGladiaSession(
  masterKey: string,
  providerMeta: Record<string, string>,
  options: Record<string, unknown>,
  session: { sessionId: string; userId: string }
): Promise<{ url: string }> {
  const sourceLanguage = options.sourceLanguage as string | undefined
  const targetLanguage = options.targetLanguage as string | undefined
  const context = options.context as { text?: string; terms?: string[] } | undefined
  const endpointing = (options.endpointing as number | undefined) ?? 0.1
  const speechThreshold = (options.speechThreshold as number | undefined) ?? 0.3

  // Build webhook URL with shared secret for authentication
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const webhookSecret = Deno.env.get('GLADIA_WEBHOOK_SECRET') ?? ''
  const callbackUrl = `${supabaseUrl}/functions/v1/gladia-session-events?secret=${encodeURIComponent(webhookSecret)}`

  const body: Record<string, unknown> = {
    encoding: 'wav/pcm',
    sample_rate: 16000,
    bit_depth: 16,
    channels: 1,
    model: providerMeta.model ?? 'solaria-1',
    endpointing,
    maximum_duration_without_endpointing: 5,
    pre_processing: { speech_threshold: speechThreshold },
    // WebSocket messages config (what the client receives over the WS connection)
    messages_config: {
      receive_partial_transcripts: true,
      receive_final_transcripts: true,
      receive_speech_events: false,
      receive_pre_processing_events: false,
      receive_realtime_processing_events: true,
      receive_post_processing_events: false,
      receive_acknowledgments: false,
      receive_lifecycle_events: false,
      receive_errors: true,
    },
    // Webhook callback config (server-to-server, for quota reconciliation)
    callback: true,
    callback_config: {
      url: callbackUrl,
      receive_lifecycle_events: true,   // session_end → reconcile quota
      receive_final_transcripts: false,
      receive_partial_transcripts: false,
      receive_speech_events: false,
      receive_pre_processing_events: false,
      receive_realtime_processing_events: false,
      receive_post_processing_events: false,
      receive_acknowledgments: false,
      receive_errors: false,
    },
    // Passed back to us in every webhook payload for session lookup
    custom_metadata: {
      session_id: session.sessionId,
      user_id: session.userId,
    },
  }

  if (sourceLanguage) {
    body.language_config = { languages: [sourceLanguage], code_switching: false }
  }

  if (targetLanguage) {
    const translationConfig: Record<string, unknown> = {
      target_languages: [targetLanguage],
      model: 'base',
      match_original_utterances: true,
    }
    const contextText = context?.text?.trim()
    if (contextText) {
      translationConfig.context = contextText
      translationConfig.context_adaptation = true
    }

    body.realtime_processing = { translation: true, translation_config: translationConfig }

    const terms = (context?.terms ?? []).filter(
      (t): t is string => typeof t === 'string' && t.trim() !== ''
    )
    if (terms.length > 0) {
      const rp = body.realtime_processing as Record<string, unknown>
      rp.custom_vocabulary = true
      rp.custom_vocabulary_config = { vocabulary: terms.map(t => ({ value: t.trim() })) }
    }
  }

  const res = await fetch('https://api.gladia.io/v2/live', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GLADIA-KEY': masterKey,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Gladia API ${res.status}: ${detail}`)
  }

  const data = await res.json()
  if (!data.url) throw new Error('Gladia did not return a WebSocket URL')

  return { url: data.url }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  })
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
