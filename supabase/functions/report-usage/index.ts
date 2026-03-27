/**
 * report-usage
 *
 * Called by the client when a cloud STT session ends to reconcile the
 * pre-debited seconds against actual usage.
 *
 * For Gladia sessions, the gladia-session-events webhook performs server-side
 * reconciliation independently. If that webhook fires first, the
 * duration_seconds > 0 guard below makes this call a no-op, preventing
 * double-reconciliation.
 *
 * ── MIN_DEBIT_FLOOR ──────────────────────────────────────────────────────────
 * To prevent "use the service fully, report 0 seconds, receive full refund",
 * any session whose duration_seconds is reported as less than MIN_DEBIT_FLOOR
 * is billed at MIN_DEBIT_FLOOR. This bounds the maximum refund to
 * (debited_seconds - MIN_DEBIT_FLOOR) rather than debited_seconds.
 *
 * Exception: if debited_seconds < MIN_DEBIT_FLOOR the floor is set to
 * debited_seconds (avoids billing more than was debited).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyUser, AuthError } from '../_shared/auth.ts'

const MIN_DEBIT_FLOOR = 60 // seconds — minimum billable once a session opens

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() })
  }

  // 1. Verify user session — manual verification required (Supabase JWT middleware disabled)
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
  let session_id: string, duration_seconds: number
  try {
    const body = await req.json()
    session_id = body.session_id
    duration_seconds = Math.max(0, Math.floor(Number(body.duration_seconds)))
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }

  if (!session_id) return json({ error: 'missing_session_id' }, 400)

  // 3. Fetch session (verify ownership via user_id)
  const { data: session, error: sessionFetchError } = await admin
    .from('usage_sessions')
    .select('debited_seconds, duration_seconds')
    .eq('id', session_id)
    .eq('user_id', user.id)
    .single()

  if (sessionFetchError || !session) {
    return json({ error: 'session_not_found' }, 404)
  }

  // Idempotency: already reconciled (either by this endpoint or by Gladia webhook)
  if (session.duration_seconds > 0) {
    return json({ ok: true, note: 'already_reconciled' })
  }

  // 4. Apply floor and cap:
  //   - Floor: always bill at least MIN_DEBIT_FLOOR once a session was opened
  //   - Cap: never bill more than what was debited
  const floor = Math.min(MIN_DEBIT_FLOOR, session.debited_seconds)
  const actual = Math.min(
    Math.max(duration_seconds, floor),
    session.debited_seconds
  )
  const refund = session.debited_seconds - actual

  // 5. Update session with actual duration
  const { error: sessionError } = await admin
    .from('usage_sessions')
    .update({ duration_seconds: actual })
    .eq('id', session_id)
    .eq('user_id', user.id)

  if (sessionError) {
    console.error('Session update error:', sessionError)
    return json({ error: 'update_failed' }, 500)
  }

  // 6. Refund unused seconds back to profile
  if (refund > 0) {
    const { error: refundError } = await admin.rpc('reconcile_trial_usage', {
      p_user_id: user.id,
      p_refund_seconds: refund,
    })
    if (refundError) {
      console.error('Refund RPC error:', refundError)
      // Non-fatal: session is recorded, refund can be retried manually
    }
  }

  return json({ ok: true, actual_seconds: actual, refunded_seconds: refund })
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
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
