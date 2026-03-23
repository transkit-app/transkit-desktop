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

  if (!session_id || duration_seconds <= 0) {
    return json({ ok: true }) // nothing to record
  }

  // 3. Update session duration (verify ownership via user_id check)
  const { error: sessionError } = await admin
    .from('usage_sessions')
    .update({ duration_seconds })
    .eq('id', session_id)
    .eq('user_id', user.id)

  if (sessionError) {
    console.error('Session update error:', sessionError)
    return json({ error: 'update_failed' }, 500)
  }

  // 4. Atomically add to profile total
  const { error: rpcError } = await admin.rpc('increment_trial_usage', {
    p_user_id: user.id,
    p_seconds: duration_seconds,
  })

  if (rpcError) {
    console.error('RPC error:', rpcError)
    return json({ error: 'increment_failed' }, 500)
  }

  return json({ ok: true })
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
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
