/**
 * Transkit Cloud SDK
 * Handles Supabase auth + Soniox temporary key management.
 *
 * CLOUD_ENABLED is true when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are
 * present at build time (baked in by Vite) AND VITE_DISABLE_CLOUD !== 'true'.
 *
 * Open-source contributors: copy .env.example → .env and fill in your own
 * Supabase project credentials, or leave empty to build in local-only mode.
 * Official releases set these via CI secrets so end-users never need a .env.
 */
import { createClient, type SupabaseClient, type Session, type User } from '@supabase/supabase-js'
import { listen } from '@tauri-apps/api/event'
import { open as openBrowser } from '@tauri-apps/api/shell'
import { invoke } from '@tauri-apps/api/tauri'

// ─── Cloud feature flag ────────────────────────────────────────────────────────

const _url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const _key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/**
 * True when Supabase credentials were present at build time and cloud has not
 * been explicitly disabled via VITE_DISABLE_CLOUD=true.
 * All functions in this module are no-ops / return null when false.
 */
export const CLOUD_ENABLED: boolean =
  import.meta.env.VITE_DISABLE_CLOUD !== 'true' && !!_url && !!_key

// ─── Supabase client (null when cloud is disabled) ────────────────────────────

// Local port used for OAuth callback — must match Supabase allowed redirect URLs
const OAUTH_CALLBACK_PORT = 54321

// Must use PKCE flow so the auth code arrives as a query param (?code=...)
// which Rust's HTTP server can read. Implicit flow puts tokens in the hash
// fragment (#access_token=...) which is never sent to the server.
export const supabase: SupabaseClient | null = CLOUD_ENABLED
  ? createClient(_url!, _key!, { auth: { flowType: 'pkce' } })
  : null

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function getSession(): Promise<Session | null> {
  if (!CLOUD_ENABLED || !supabase) return null
  try {
    const { data } = await supabase.auth.getSession()
    return data.session
  } catch (e) {
    console.warn('[transkit-cloud] getSession failed (auth lock conflict?):', e)
    return null
  }
}

export async function getUser(): Promise<User | null> {
  if (!CLOUD_ENABLED || !supabase) return null
  try {
    const { data } = await supabase.auth.getUser()
    return data.user ?? null
  } catch (e) {
    // Supabase can throw a lock conflict error when multiple concurrent requests
    // race to refresh the auth token. Treat this as "not authenticated" so callers
    // get a clean null instead of an unhandled rejection.
    console.warn('[transkit-cloud] getUser failed (auth lock conflict?):', e)
    return null
  }
}

export function onAuthStateChange(callback: (user: User | null) => void): () => void {
  if (!CLOUD_ENABLED || !supabase) {
    // Immediately signal "not authenticated" so consumers set their initial state
    callback(null)
    return () => {}
  }
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null)
  })
  return data.subscription.unsubscribe
}

export async function signInWithGoogle(): Promise<void> {
  if (!CLOUD_ENABLED) throw new Error('cloud_disabled')
  return _oauthFlow('google')
}

export async function signInWithGitHub(): Promise<void> {
  if (!CLOUD_ENABLED) throw new Error('cloud_disabled')
  return _oauthFlow('github')
}

export async function signOut(): Promise<void> {
  if (!CLOUD_ENABLED || !supabase) return
  await supabase.auth.signOut({ scope: 'local' })
}

// ─── OAuth flow (localhost redirect) ─────────────────────────────────────────

async function _oauthFlow(provider: 'google' | 'github'): Promise<void> {
  const redirectTo = `http://127.0.0.1:${OAUTH_CALLBACK_PORT}/callback`

  // Start one-shot HTTP server in Rust to capture the callback
  await invoke('start_oauth_server', { port: OAUTH_CALLBACK_PORT })

  // Get OAuth URL without opening browser (PKCE flow)
  const { data, error } = await supabase!.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  })
  if (error || !data.url) throw error ?? new Error('No OAuth URL')

  // Open in system browser
  await openBrowser(data.url)

  // Wait for Rust to emit the callback URL
  return new Promise<void>((resolve, reject) => {
    let unlisten: (() => void) | null = null
    const timeout = setTimeout(() => {
      unlisten?.()
      reject(new Error('OAuth timed out'))
    }, 5 * 60 * 1000)

    listen<string>('oauth-callback', async (event) => {
      clearTimeout(timeout)
      unlisten?.()
      try {
        // Extract just the `code` query param — exchangeCodeForSession
        // expects the code value, not the full URL.
        const url = new URL(event.payload)
        const code = url.searchParams.get('code')
        if (!code) {
          reject(new Error('No authorization code in callback URL'))
          return
        }
        const { data: authData, error } = await supabase!.auth.exchangeCodeForSession(code)
        if (error) { reject(error); return }
        // Ensure profile row exists — fire-and-forget so any failure here
        // (network blip, auth lock conflict) never rejects the login promise.
        if (authData.session?.user) {
          _ensureProfile(authData.session.user).catch(e =>
            console.warn('[transkit-cloud] _ensureProfile failed (non-blocking):', e)
          )
        }
        resolve()
      } catch (e) {
        reject(e)
      }
    }).then((fn) => {
      unlisten = fn
    })
  })
}

// ─── Cloud credential resolver ────────────────────────────────────────────────

/**
 * Credentials returned per provider:
 *   deepgram →  { token: string }       (short-lived Deepgram access token)
 *   soniox   →  { api_key: string }     (short-lived Soniox temporary key)
 *   gladia   →  { url: string }         (pre-created WSS session URL)
 */
export interface CloudCredentialsResult {
  provider: string
  credentials: Record<string, string>
  session_id: string
  remaining_seconds: number
  debited_seconds: number
  plan: string
}

export interface CloudCredentialsOptions {
  // STT session options — forwarded to providers that need them at session-creation
  // time (Gladia creates its live session server-side).
  sourceLanguage?: string | null
  targetLanguage?: string | null
  context?: { text?: string; terms?: string[] }
  endpointing?: number
  speechThreshold?: number
}

// FunctionsHttpError.context is the raw Response — must be awaited to read body.
// Throws with the `error` field from our JSON body, or falls back to the SDK message.
async function _throwFunctionError(error: any): Promise<never> {
  let body: any = null
  try {
    body = await (error?.context as Response | undefined)?.json?.()
  } catch { /* non-JSON response */ }

  const code: string = body?.error ?? 'server_error'
  const err = new Error(code) as any
  if (body?.used !== undefined) err.used = body.used
  if (body?.limit !== undefined) err.limit = body.limit
  throw err
}

/**
 * Request session credentials for a cloud-managed provider.
 * The backend validates the user's JWT, checks quota, reads cloud_service_config
 * to pick the active provider, and returns short-lived credentials — never
 * exposing master API keys.
 */
export async function getCloudCredentials(
  serviceType: 'stt' | 'tts' | 'ai',
  options?: CloudCredentialsOptions,
  signal?: AbortSignal
): Promise<CloudCredentialsResult> {
  if (!CLOUD_ENABLED || !supabase) throw new Error('cloud_disabled')

  const { data, error } = await supabase.functions.invoke<CloudCredentialsResult>(
    'get-cloud-credentials',
    { body: { service_type: serviceType, options: options ?? {} }, signal }
  )
  if (error) await _throwFunctionError(error)
  if (!data) throw new Error('server_error')
  return data
}

export async function reportUsage(sessionId: string, durationSeconds: number): Promise<void> {
  if (!CLOUD_ENABLED || !supabase) return

  const user = await getUser()
  if (!user) return // not logged in — nothing to report

  try {
    await supabase.functions.invoke('report-usage', {
      body: { session_id: sessionId, duration_seconds: durationSeconds },
    })
  } catch (e) {
    console.warn('[transkit-cloud] reportUsage failed (non-blocking):', e)
  }
}

// ─── Profile (usage info for UI) ─────────────────────────────────────────────

export async function getUserProfile(): Promise<UserProfile | null> {
  if (!CLOUD_ENABLED || !supabase) return null

  const user = await getUser()
  if (!user) return null

  // Read profile including denormalized plan limit columns (synced by trigger in migration 007).
  // This avoids a second query to subscription_plans which requires separate table permissions.
  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('email, full_name, avatar_url, role, company, experience_level, expertise, notes, stt_seconds_used, stt_addon_seconds, plan, tts_chars_used, ai_requests_used, translate_requests_used, plan_stt_limit, plan_tts_chars_limit, plan_ai_requests_limit, plan_translate_requests_limit, subscription_ends_at')
    .eq('id', user.id)
    .single()

  if (profileError || !profileData) return null

  const raw = profileData as any

  return {
    ...raw,
    plan_display_name:             raw.plan ?? 'trial',
    stt_seconds_used:              raw.stt_seconds_used               ?? 0,
    stt_addon_seconds:             raw.stt_addon_seconds              ?? 0,
    plan_stt_limit:                raw.plan_stt_limit                 ?? 0,
    subscription_ends_at:          raw.subscription_ends_at           ?? null,
    plan_tts_chars_limit:          raw.plan_tts_chars_limit           ?? 0,
    plan_ai_requests_limit:        raw.plan_ai_requests_limit         ?? 0,
    plan_translate_requests_limit: raw.plan_translate_requests_limit  ?? 0,
    tts_chars_used:                raw.tts_chars_used                 ?? 0,
    ai_requests_used:              raw.ai_requests_used               ?? 0,
    translate_requests_used:       raw.translate_requests_used        ?? 0,
  } as UserProfile
}

export interface UserProfile {
  email: string | null
  full_name: string | null
  avatar_url: string | null
  role: string | null
  company: string | null
  experience_level: string | null
  expertise: string[] | null
  notes: string | null
  // STT quota
  stt_seconds_used: number
  stt_addon_seconds: number  // addon quota (not reset monthly)
  plan: string              // 'trial' | 'starter' | 'pro' | 'team'
  plan_display_name: string // e.g. 'Free Trial', 'Starter', 'Pro', 'Team'
  plan_stt_limit: number    // authoritative STT limit from subscription_plans (-1 = unlimited)
  subscription_ends_at: string | null  // grace period end; null if active
  // TTS quota
  tts_chars_used: number
  plan_tts_chars_limit: number
  // AI quota
  ai_requests_used: number
  plan_ai_requests_limit: number
  // Translate quota
  translate_requests_used: number
  plan_translate_requests_limit: number
}

export type ProfilePatch = Partial<Pick<UserProfile, 'full_name' | 'role' | 'company' | 'experience_level' | 'expertise' | 'notes'>>

export async function updateUserProfile(patch: ProfilePatch): Promise<void> {
  if (!CLOUD_ENABLED || !supabase) return

  const user = await getUser()
  if (!user) return

  await supabase
    .from('profiles')
    .update(patch)
    .eq('id', user.id)
}

// ─── Cloud TTS ────────────────────────────────────────────────────────────────

export interface CloudVoice {
  id: string
  label: string
  is_default?: boolean
}

export interface CloudTTSConfig {
  available: boolean
  voices: CloudVoice[]
  min_plan: string
}

// Cache voice catalog for 5 minutes
let _ttsConfigCache: { data: CloudTTSConfig; expiresAt: number } | null = null

export async function getCloudTTSConfig(): Promise<CloudTTSConfig> {
  if (!CLOUD_ENABLED) return { available: false, voices: [], min_plan: 'trial' }

  const now = Date.now()
  if (_ttsConfigCache && now < _ttsConfigCache.expiresAt) return _ttsConfigCache.data

  try {
    const url = `${_url}/functions/v1/cloud-config?service=tts`
    const res = await fetch(url)
    if (!res.ok) return { available: false, voices: [], min_plan: 'trial' }
    const data: CloudTTSConfig = await res.json()
    _ttsConfigCache = { data, expiresAt: now + 5 * 60 * 1000 }
    return data
  } catch {
    return { available: false, voices: [], min_plan: 'trial' }
  }
}

/**
 * Synthesize text via Transkit Cloud TTS proxy.
 * Returns raw audio ArrayBuffer (audio/mpeg).
 * Throws with code 'quota_exceeded', 'unauthorized', 'service_not_configured', etc.
 */
export async function callCloudTTS(
  text: string,
  voiceId: string,
  language: string
): Promise<ArrayBuffer> {
  if (!CLOUD_ENABLED || !supabase) throw new Error('cloud_disabled')

  const session = await supabase.auth.getSession()
  const token = session.data.session?.access_token
  if (!token) throw new Error('unauthorized')

  const res = await fetch(`${_url}/functions/v1/proxy-tts`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ text, voice_id: voiceId, language }),
  })

  if (!res.ok) {
    let code = 'server_error'
    try { code = (await res.json()).error ?? code } catch { /* ignore */ }
    const err: any = new Error(code)
    err.status = res.status
    throw err
  }

  return res.arrayBuffer()
}

// ─── Cloud AI / Translate ─────────────────────────────────────────────────────

export interface CloudAIMessage {
  role: 'system' | 'user' | 'model' | 'assistant'
  content: string
}

export interface CloudAIOptions {
  source_lang?: string
  target_lang?: string
}

export interface CloudAIResult {
  text: string
  requests_remaining: number
}

/**
 * Send an AI suggestion or translation request via Transkit Cloud proxy.
 * task = 'ai'        → AI suggestion (messages must include system prompt)
 * task = 'translate' → Translation (system prompt injected server-side)
 */
export async function callCloudAI(
  messages: CloudAIMessage[],
  task: 'ai' | 'translate',
  options?: CloudAIOptions
): Promise<CloudAIResult> {
  if (!CLOUD_ENABLED || !supabase) throw new Error('cloud_disabled')

  const session = await supabase.auth.getSession()
  const token = session.data.session?.access_token
  if (!token) throw new Error('unauthorized')

  const { data, error } = await supabase.functions.invoke<CloudAIResult>('proxy-ai', {
    body: { task, messages, options: options ?? {} },
  })
  if (error) await _throwFunctionError(error)
  if (!data) throw new Error('server_error')
  return data
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function _ensureProfile(user: User): Promise<void> {
  await supabase!.from('profiles').upsert(
    {
      id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name ?? null,
      avatar_url: user.user_metadata?.avatar_url ?? null,
    },
    { onConflict: 'id', ignoreDuplicates: true }
  )
}
