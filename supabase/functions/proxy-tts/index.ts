/**
 * proxy-tts
 *
 * Transkit Cloud TTS proxy. Receives text from the client, calls the active
 * TTS provider (e.g. ElevenLabs), and streams the audio back.
 * Master API keys never reach the client.
 *
 * ── Auth ──────────────────────────────────────────────────────────────────────
 * Requires Bearer JWT. Manual verification via admin.auth.getUser(token)
 * because Supabase JWT middleware is disabled on this project.
 *
 * ── Request body ──────────────────────────────────────────────────────────────
 *   {
 *     text:     string,   // text to synthesize (max chars enforced by plan)
 *     voice_id: string,   // opaque voice id from cloud-config, or "auto"
 *     language: string,   // BCP-47 language code, e.g. "en", "vi"
 *   }
 *
 * ── Response ──────────────────────────────────────────────────────────────────
 *   200: audio/mpeg binary stream
 *       Headers:
 *         X-Chars-Used:      number  — chars billed for this request
 *         X-Chars-Remaining: number  — chars left after billing (-1 = unlimited)
 *         X-Session-Id:      string  — usage_sessions row id for audit
 *
 * ── Error codes ───────────────────────────────────────────────────────────────
 *   unauthorized           — missing / invalid JWT
 *   invalid_request        — missing required fields or text too long
 *   quota_exceeded         — no TTS chars left in plan
 *   service_not_configured — no active TTS provider in cloud_service_config
 *   key_not_configured     — provider secret not set
 *   provider_error         — upstream TTS API failure
 *   server_error           — unexpected internal failure
 *
 * ── Supported providers ───────────────────────────────────────────────────────
 *   elevenlabs — ElevenLabs TTS API
 *     Secret:  ELEVENLABS_MASTER_API_KEY
 *     Config:  { model, voices: [{ id, label, is_default }] }
 *
 * ── Quota ─────────────────────────────────────────────────────────────────────
 *   Debited AFTER successful audio generation (text.length chars).
 *   If provider call fails, no quota is consumed.
 *   Max text length per request: enforced here (2000 chars hard limit to prevent abuse).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyUser, AuthError } from '../_shared/auth.ts'

const MAX_CHARS_PER_REQUEST = 2000

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  // ── 1. Verify JWT ─────────────────────────────────────────────────────────
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

  // ── 2. Parse body ─────────────────────────────────────────────────────────
  let text: string, voiceId: string, language: string
  try {
    const body = await req.json()
    text     = String(body.text     ?? '').trim()
    voiceId  = String(body.voice_id ?? 'auto').trim()
    language = String(body.language ?? 'en').trim()
  } catch {
    return json({ error: 'invalid_request', detail: 'invalid JSON body' }, 400)
  }

  if (!text) return json({ error: 'invalid_request', detail: 'text is required' }, 400)
  if (text.length > MAX_CHARS_PER_REQUEST) {
    return json({
      error: 'invalid_request',
      detail: `text exceeds max length of ${MAX_CHARS_PER_REQUEST} chars`,
    }, 400)
  }

  // ── 3. Load profile and check TTS quota ──────────────────────────────────
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('tts_chars_used, plan')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    await admin.from('profiles').upsert(
      { id: user.id, email: user.email },
      { onConflict: 'id', ignoreDuplicates: true }
    )
    return json({ error: 'profile_not_found' }, 404)
  }

  // Read plan limits
  const { data: planData } = await admin
    .from('subscription_plans')
    .select('tts_chars_limit')
    .eq('name', profile.plan ?? 'trial')
    .single()

  const charsLimit: number = planData?.tts_chars_limit ?? 0
  const charsUsed:  number = profile.tts_chars_used ?? 0

  if (charsLimit === 0) {
    return json({ error: 'quota_exceeded', detail: 'TTS not available on your plan' }, 403)
  }

  const isUnlimited = charsLimit === -1
  if (!isUnlimited && charsUsed >= charsLimit) {
    return json({
      error: 'quota_exceeded',
      used: charsUsed,
      limit: charsLimit,
    }, 403)
  }

  // ── 4. Resolve active TTS provider ───────────────────────────────────────
  const { data: serviceConfig, error: configError } = await admin
    .from('cloud_service_config')
    .select('provider_name, provider_config')
    .eq('service_type', 'tts')
    .eq('is_active', true)
    .single()

  if (configError || !serviceConfig) {
    return json({ error: 'service_not_configured' }, 503)
  }

  const providerName: string = serviceConfig.provider_name
  const providerMeta = serviceConfig.provider_config as Record<string, unknown> ?? {}

  // ── 5. Resolve master API key ─────────────────────────────────────────────
  const secretName = `${providerName.toUpperCase()}_MASTER_API_KEY`
  const masterKey  = Deno.env.get(secretName)
  if (!masterKey) {
    console.error(`[proxy-tts] Secret not set: ${secretName}`)
    return json({ error: 'key_not_configured' }, 503)
  }

  // ── 6. Resolve actual voice id ────────────────────────────────────────────
  const resolvedVoiceId = resolveVoiceId(voiceId, language, providerMeta)

  // ── 7. Call TTS provider ──────────────────────────────────────────────────
  let audioBuffer: ArrayBuffer
  try {
    switch (providerName) {
      case 'elevenlabs':
        audioBuffer = await _callElevenLabs(masterKey, text, resolvedVoiceId, providerMeta)
        break
      default:
        throw new Error(`Unsupported TTS provider: ${providerName}`)
    }
  } catch (err) {
    console.error('[proxy-tts] Provider error:', err)
    return json({ error: 'provider_error', detail: String(err) }, 502)
  }

  // ── 8. Debit quota AFTER successful synthesis ─────────────────────────────
  const charsToDebit = text.length

  const { data: actualDebit, error: debitError } = await admin.rpc('debit_tts_usage', {
    p_user_id: user.id,
    p_chars:   charsToDebit,
  })

  if (debitError) {
    console.error('[proxy-tts] Debit error:', debitError)
    // Non-fatal: audio already generated, return it. Log for manual reconciliation.
  }

  const debited: number = actualDebit ?? charsToDebit

  // ── 9. Record usage session ───────────────────────────────────────────────
  const sessionId = crypto.randomUUID()
  await admin.from('usage_sessions').insert({
    id:               sessionId,
    user_id:          user.id,
    service_type:     'tts',
    provider_name:    providerName,
    debited_seconds:  debited,   // reused column; semantics: chars for TTS
    duration_seconds: debited,   // TTS is synchronous — no reconciliation needed
  })

  // ── 10. Return audio ──────────────────────────────────────────────────────
  const remaining = isUnlimited ? -1 : Math.max(charsLimit - (charsUsed + debited), 0)

  return new Response(audioBuffer, {
    status: 200,
    headers: {
      'Content-Type':       'audio/mpeg',
      'X-Chars-Used':       String(debited),
      'X-Chars-Remaining':  String(remaining),
      'X-Session-Id':       sessionId,
      ...corsHeaders(),
    },
  })
})

// ─── Voice resolution ─────────────────────────────────────────────────────────

/**
 * Resolve "auto" to a concrete voice id using the voice catalog in provider_config.
 * Falls back to the first voice in the catalog, or a hardcoded default.
 */
function resolveVoiceId(
  voiceId: string,
  language: string,
  providerMeta: Record<string, unknown>
): string {
  if (voiceId !== 'auto') return voiceId

  const voices = providerMeta.voices as Array<{ id: string; label: string; is_default?: boolean; lang?: string }> | undefined
  if (!voices?.length) return 'QqID1ZB0DTItNxAKGBNW' // ElevenLabs Rachel fallback

  // Try language-matched voice first
  const langVoice = voices.find(v => v.lang && v.lang.startsWith(language.split('-')[0]))
  if (langVoice && langVoice.id !== 'auto') return langVoice.id

  // Fall back to marked default
  const defaultVoice = voices.find(v => v.is_default && v.id !== 'auto')
  if (defaultVoice) return defaultVoice.id

  // Fall back to first non-auto voice
  const first = voices.find(v => v.id !== 'auto')
  return first?.id ?? 'QqID1ZB0DTItNxAKGBNW'
}

// ─── ElevenLabs provider ──────────────────────────────────────────────────────

async function _callElevenLabs(
  masterKey: string,
  text: string,
  voiceId: string,
  providerMeta: Record<string, unknown>
): Promise<ArrayBuffer> {
  const modelId = (providerMeta.model as string | undefined) ?? 'eleven_flash_v2_5'

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key':   masterKey,
      'Content-Type': 'application/json',
      'Accept':       'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability:        0.5,
        similarity_boost: 0.75,
      },
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`ElevenLabs API ${res.status}: ${detail}`)
  }

  return res.arrayBuffer()
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
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
