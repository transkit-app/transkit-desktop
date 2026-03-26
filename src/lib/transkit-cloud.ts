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
  const { data } = await supabase.auth.getSession()
  return data.session
}

export async function getUser(): Promise<User | null> {
  if (!CLOUD_ENABLED || !supabase) return null
  const { data } = await supabase.auth.getUser()
  return data.user ?? null
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
  await supabase.auth.signOut()
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
        // Ensure profile row exists for this user (handles existing users
        // who signed up before the DB trigger was installed)
        if (authData.session?.user) {
          await _ensureProfile(authData.session.user)
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
  options?: CloudCredentialsOptions
): Promise<CloudCredentialsResult> {
  if (!CLOUD_ENABLED || !supabase) throw new Error('cloud_disabled')

  const { data, error } = await supabase.functions.invoke<CloudCredentialsResult>(
    'get-cloud-credentials',
    { body: { service_type: serviceType, options: options ?? {} } }
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

export interface UserProfile {
  email: string | null
  full_name: string | null
  avatar_url: string | null
  role: string | null
  company: string | null
  experience_level: string | null
  expertise: string[] | null
  notes: string | null
  trial_seconds_used: number
  trial_limit_seconds: number
  plan: string // 'trial' | 'starter' | 'pro'
}

export async function getUserProfile(): Promise<UserProfile | null> {
  if (!CLOUD_ENABLED || !supabase) return null

  const user = await getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('email, full_name, avatar_url, role, company, experience_level, expertise, notes, trial_seconds_used, trial_limit_seconds, plan')
    .eq('id', user.id)
    .single()

  if (error || !data) return null
  return data as UserProfile
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
