/**
 * gladia-session-events
 *
 * Webhook receiver for Gladia lifecycle events.
 * Gladia POSTs to this endpoint when a live session ends (and optionally for
 * other lifecycle milestones). We use the event to reconcile the pre-debited
 * quota against actual usage — completely server-side, independent of whether
 * the client called report-usage.
 *
 * ── Security ──────────────────────────────────────────────────────────────────
 * Gladia does not sign webhook payloads, so we protect the endpoint with a
 * shared secret appended as a query parameter:
 *   ?secret=<GLADIA_WEBHOOK_SECRET>
 *
 * The secret is set via: supabase secrets set GLADIA_WEBHOOK_SECRET=<random>
 * The same secret is read by get-cloud-credentials to construct the callback URL.
 *
 * ── Session mapping ───────────────────────────────────────────────────────────
 * When get-cloud-credentials creates a Gladia session it passes:
 *   custom_metadata: { session_id: "<our UUID>", user_id: "<user UUID>" }
 *
 * We use session_id to look up and update the matching usage_sessions row.
 *
 * ── Lifecycle event payload (Gladia) ─────────────────────────────────────────
 * Gladia sends a JSON body. For lifecycle events the relevant fields are:
 *   {
 *     type: "lifecycle",
 *     data: {
 *       event: "session_end" | "session_start" | ...,
 *       duration?: number,   // seconds, may be absent on some events
 *     },
 *     custom_metadata: { session_id: string, user_id: string }
 *   }
 *
 * If Gladia does not include duration we fall back to wall-clock time
 * (NOW() - session.created_at).
 *
 * ── Idempotency ───────────────────────────────────────────────────────────────
 * We only update sessions where duration_seconds IS NULL or 0 (not yet
 * reconciled). Duplicate events are silently ignored.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MIN_DEBIT_SECONDS = 60 // always consume at least 60 s once a session started

Deno.serve(async (req: Request) => {
  // Only accept POST (Gladia sends POST)
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() })
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  // ── 1. Validate shared secret ──────────────────────────────────────────────
  const expectedSecret = Deno.env.get('GLADIA_WEBHOOK_SECRET')
  if (!expectedSecret) {
    // Secret not configured — refuse all requests rather than silently accepting
    console.error('[gladia-session-events] GLADIA_WEBHOOK_SECRET not set')
    return json({ error: 'server_misconfigured' }, 500)
  }

  const url = new URL(req.url)
  const providedSecret = url.searchParams.get('secret') ?? ''

  // Constant-time comparison to avoid timing attacks
  if (!timingSafeEqual(providedSecret, expectedSecret)) {
    return json({ error: 'unauthorized' }, 401)
  }

  // ── 2. Parse body ──────────────────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const eventType = (body.type as string | undefined)?.toLowerCase()
  const data = body.data as Record<string, unknown> | undefined
  const meta = body.custom_metadata as Record<string, unknown> | undefined

  // We only act on lifecycle events
  if (eventType !== 'lifecycle') {
    return json({ ok: true, note: 'ignored_non_lifecycle' })
  }

  const gladiaEvent = (data?.event as string | undefined)?.toLowerCase()
  if (gladiaEvent !== 'session_end') {
    return json({ ok: true, note: `ignored_lifecycle_event:${gladiaEvent}` })
  }

  // ── 3. Extract our session_id from custom_metadata ─────────────────────────
  const sessionId = meta?.session_id as string | undefined
  const userId    = meta?.user_id    as string | undefined

  if (!sessionId || !userId) {
    console.error('[gladia-session-events] Missing custom_metadata', body)
    return json({ error: 'missing_metadata' }, 400)
  }

  // ── 4. Look up the session ─────────────────────────────────────────────────
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: session, error: fetchError } = await admin
    .from('usage_sessions')
    .select('id, user_id, debited_seconds, duration_seconds, created_at')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .single()

  if (fetchError || !session) {
    console.error('[gladia-session-events] Session not found:', sessionId, fetchError)
    return json({ error: 'session_not_found' }, 404)
  }

  // Idempotency: already reconciled
  if (session.duration_seconds > 0) {
    return json({ ok: true, note: 'already_reconciled' })
  }

  // ── 5. Compute actual duration ─────────────────────────────────────────────
  // Prefer duration from Gladia event payload; fall back to wall-clock delta.
  let actualSeconds: number

  const gladiaDuration = data?.duration as number | undefined
  if (typeof gladiaDuration === 'number' && gladiaDuration > 0) {
    actualSeconds = Math.floor(gladiaDuration)
  } else {
    // Wall-clock fallback: time from session creation to now
    const createdMs = new Date(session.created_at as string).getTime()
    actualSeconds = Math.floor((Date.now() - createdMs) / 1000)
  }

  // Enforce floor (session started → at least MIN_DEBIT_SECONDS consumed)
  // and cap at debited_seconds (can't consume more than what was pre-debited)
  const billable = Math.min(
    Math.max(actualSeconds, MIN_DEBIT_SECONDS),
    session.debited_seconds
  )
  const refund = session.debited_seconds - billable

  console.log(
    `[gladia-session-events] session=${sessionId} debited=${session.debited_seconds}s actual=${actualSeconds}s billable=${billable}s refund=${refund}s`
  )

  // ── 6. Update session record ───────────────────────────────────────────────
  const { error: updateError } = await admin
    .from('usage_sessions')
    .update({ duration_seconds: billable })
    .eq('id', sessionId)
    .eq('user_id', userId)

  if (updateError) {
    console.error('[gladia-session-events] Update error:', updateError)
    return json({ error: 'update_failed' }, 500)
  }

  // ── 7. Refund unused seconds ───────────────────────────────────────────────
  if (refund > 0) {
    const { error: refundError } = await admin.rpc('reconcile_trial_usage', {
      p_user_id: userId,
      p_refund_seconds: refund,
    })
    if (refundError) {
      // Non-fatal: session is recorded correctly, refund can be retried/adjusted manually
      console.error('[gladia-session-events] Refund error:', refundError)
    }
  }

  return json({ ok: true, billable_seconds: billable, refunded_seconds: refund })
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Constant-time string comparison to prevent timing-based secret enumeration.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
