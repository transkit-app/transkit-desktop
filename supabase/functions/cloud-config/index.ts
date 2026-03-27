/**
 * cloud-config
 *
 * Public endpoint — no authentication required.
 * Returns non-sensitive service metadata from cloud_service_config.
 * Clients use this to populate UI (e.g. available TTS voices) without
 * exposing provider names or API keys.
 *
 * ── Query params ──────────────────────────────────────────────────────────────
 *   ?service=tts | ai | translate | stt
 *
 * ── Response (200) ────────────────────────────────────────────────────────────
 *   {
 *     available: true,
 *     // For TTS service:
 *     voices?: Array<{ id: string, label: string, is_default?: boolean }>,
 *     // For AI/translate service: (future expansion)
 *   }
 *
 * ── Response (404) ────────────────────────────────────────────────────────────
 *   { available: false }   — no active provider configured for this service
 *
 * ── Voice catalog format (admin sets in cloud_service_config.provider_config) ─
 *   {
 *     "model": "eleven_flash_v2_5",
 *     "voices": [
 *       { "id": "auto",                  "label": "Auto (best for language)", "is_default": true },
 *       { "id": "QqID1ZB0DTItNxAKGBNW", "label": "Rachel (Female, EN/VI)"  },
 *       { "id": "21m00Tcm4TlvDq8ikWAM", "label": "Adam (Male, EN)"         }
 *     ]
 *   }
 *   The "auto" id is handled server-side — proxy-tts picks best voice for the
 *   requested language using provider_config.voices or a language→voice mapping.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VALID_SERVICES = ['stt', 'tts', 'ai', 'translate'] as const
type ServiceType = typeof VALID_SERVICES[number]

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)

  const url = new URL(req.url)
  const service = url.searchParams.get('service') as ServiceType | null

  if (!service || !VALID_SERVICES.includes(service)) {
    return json({
      error: 'invalid_request',
      detail: `service must be one of: ${VALID_SERVICES.join(', ')}`,
    }, 400)
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: config, error } = await admin
    .from('cloud_service_config')
    .select('provider_config, min_plan')
    .eq('service_type', service)
    .eq('is_active', true)
    .single()

  if (error || !config) {
    return json({ available: false }, 404)
  }

  const providerConfig = config.provider_config as Record<string, unknown> ?? {}

  // Build response: only expose metadata the client needs, never provider names or keys
  const response: Record<string, unknown> = {
    available: true,
    min_plan: config.min_plan,
  }

  if (service === 'tts') {
    // Return voice catalog so client can populate voice selector
    const voices = providerConfig.voices as Array<{ id: string; label: string; is_default?: boolean }> | undefined
    response.voices = voices ?? [{ id: 'auto', label: 'Auto', is_default: true }]
  }

  return json(response)
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  })
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  }
}
