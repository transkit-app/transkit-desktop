import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SONIOX_API_URL = 'https://soniox.com/v1/auth/temporary-api-key'

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() })
  }

  // 1. Verify user session
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)

  // Client-facing Supabase (respects RLS)
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  // Admin Supabase (bypasses RLS for writes)
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return json({ error: 'unauthorized' }, 401)

  // 2. Check trial quota
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('trial_seconds_used, trial_limit_seconds')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    // Profile may not exist yet (race on first login), create it
    await admin.from('profiles').insert({ id: user.id, email: user.email }).onConflict('id').ignore()
    return json({ error: 'profile_not_found' }, 404)
  }

  const remaining = profile.trial_limit_seconds - profile.trial_seconds_used
  if (remaining <= 0) {
    return json({
      error: 'trial_expired',
      used: profile.trial_seconds_used,
      limit: profile.trial_limit_seconds,
    }, 403)
  }

  // 3. Create session record to get a session_id
  const sessionId = crypto.randomUUID()
  const referenceId = `${user.id}:${sessionId}`

  await admin.from('usage_sessions').insert({
    id: sessionId,
    user_id: user.id,
    duration_seconds: 0,
    soniox_reference_id: referenceId,
  })

  // 4. Request temporary key from Soniox
  const masterKey = Deno.env.get('SONIOX_MASTER_API_KEY')
  if (!masterKey) return json({ error: 'server_misconfigured' }, 500)

  const sonioxRes = await fetch(SONIOX_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${masterKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      usage_type: 'transcribe_websocket',
      expires_in_seconds: Math.min(remaining, 3600), // Soniox max = 3600s
      client_reference_id: referenceId,
    }),
  })

  if (!sonioxRes.ok) {
    const detail = await sonioxRes.text()
    console.error('Soniox API error:', sonioxRes.status, detail)
    return json({ error: 'soniox_error' }, 502)
  }

  const { api_key, expires_at } = await sonioxRes.json()

  return json({
    api_key,
    expires_at,
    remaining_seconds: remaining,
    session_id: sessionId,
  })
})

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
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  }
}
