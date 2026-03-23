import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() })
  }

  // 1. Verify user session
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return json({ error: 'unauthorized' }, 401)

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

  // 3. Fetch session to get debited_seconds (verify ownership via user_id)
  const { data: session, error: sessionFetchError } = await admin
    .from('usage_sessions')
    .select('debited_seconds, duration_seconds')
    .eq('id', session_id)
    .eq('user_id', user.id)
    .single()

  if (sessionFetchError || !session) {
    return json({ error: 'session_not_found' }, 404)
  }

  // Ignore duplicate reconcile calls (duration already set)
  if (session.duration_seconds > 0) {
    return json({ ok: true, note: 'already_reconciled' })
  }

  const actual = Math.min(duration_seconds, session.debited_seconds)
  const refund = session.debited_seconds - actual

  // 4. Update session with actual duration
  const { error: sessionError } = await admin
    .from('usage_sessions')
    .update({ duration_seconds: actual })
    .eq('id', session_id)
    .eq('user_id', user.id)

  if (sessionError) {
    console.error('Session update error:', sessionError)
    return json({ error: 'update_failed' }, 500)
  }

  // 5. Refund unused seconds back to profile
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
