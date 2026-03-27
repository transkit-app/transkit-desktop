/**
 * proxy-ai
 *
 * Transkit Cloud AI proxy. Handles both AI suggestions and translation
 * requests by routing to Gemini 2.5 Flash. Master API keys never reach
 * the client.
 *
 * ── Auth ──────────────────────────────────────────────────────────────────────
 * Requires Bearer JWT. Manual verification via admin.auth.getUser(token)
 * because Supabase JWT middleware is disabled on this project.
 *
 * ── Request body ──────────────────────────────────────────────────────────────
 *   {
 *     task:     "ai" | "translate",
 *     messages: Array<{ role: "system" | "user" | "model", content: string }>,
 *     options?: {
 *       source_lang?: string,   // for translate task
 *       target_lang?: string,   // for translate task
 *     }
 *   }
 *
 *   For task="translate": if messages contains only a user message (the text),
 *   the server injects the system prompt automatically.
 *   For task="ai": messages are passed as-is (client provides system prompt).
 *
 * ── Response (200) ────────────────────────────────────────────────────────────
 *   {
 *     text:               string,  — generated text
 *     requests_remaining: number,  — requests left (-1 = unlimited)
 *   }
 *   Headers:
 *     X-Requests-Remaining: number
 *     X-Session-Id:         string
 *
 * ── Error codes ───────────────────────────────────────────────────────────────
 *   unauthorized           — missing / invalid JWT
 *   invalid_request        — missing required fields
 *   quota_exceeded         — no AI/translate requests left in plan
 *   service_not_configured — no active AI provider in cloud_service_config
 *   key_not_configured     — provider secret not set
 *   provider_error         — upstream AI API failure
 *   server_error           — unexpected internal failure
 *
 * ── Supported providers ───────────────────────────────────────────────────────
 *   gemini — Google Gemini API
 *     Secret:  GEMINI_MASTER_API_KEY
 *     Config:  { model: "gemini-2.5-flash-preview-05-20" }
 *
 * ── Token safety ──────────────────────────────────────────────────────────────
 *   max_tokens_per_request comes from subscription_plans.ai_tokens_limit.
 *   Input messages are truncated to fit within this cap before sending.
 *   Output is capped at max_tokens_per_request / 4 (generous for responses).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyUser, AuthError } from '../_shared/auth.ts'

const VALID_TASKS = ['ai', 'translate'] as const
type Task = typeof VALID_TASKS[number]

// Translate system prompt — injected server-side when task='translate'
function buildTranslateSystemPrompt(sourceLang: string, targetLang: string): string {
  return `You are a professional translator. Translate the user's text from ${sourceLang} to ${targetLang}.
Return ONLY the translated text — no explanations, no notes, no original text, no markdown.
Preserve formatting, tone, and meaning as closely as possible.`
}

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
  let task: Task
  let messages: Array<{ role: string; content: string }>
  let options: Record<string, string>

  try {
    const body = await req.json()
    task     = body.task as Task
    messages = Array.isArray(body.messages) ? body.messages : []
    options  = body.options ?? {}
  } catch {
    return json({ error: 'invalid_request', detail: 'invalid JSON body' }, 400)
  }

  if (!task || !VALID_TASKS.includes(task)) {
    return json({ error: 'invalid_request', detail: `task must be: ${VALID_TASKS.join(', ')}` }, 400)
  }
  if (!messages.length) {
    return json({ error: 'invalid_request', detail: 'messages is required' }, 400)
  }

  // ── 3. Load profile and check quota ──────────────────────────────────────
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('ai_requests_used, translate_requests_used, plan')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    await admin.from('profiles').upsert(
      { id: user.id, email: user.email },
      { onConflict: 'id', ignoreDuplicates: true }
    )
    return json({ error: 'profile_not_found' }, 404)
  }

  const { data: planData } = await admin
    .from('subscription_plans')
    .select('ai_requests_limit, translate_requests_limit, ai_tokens_limit')
    .eq('name', profile.plan ?? 'trial')
    .single()

  const requestsLimit: number = task === 'ai'
    ? (planData?.ai_requests_limit ?? 0)
    : (planData?.translate_requests_limit ?? 0)

  const requestsUsed: number = task === 'ai'
    ? (profile.ai_requests_used ?? 0)
    : (profile.translate_requests_used ?? 0)

  const maxTokensPerRequest: number = planData?.ai_tokens_limit ?? 4000

  if (requestsLimit === 0) {
    return json({ error: 'quota_exceeded', detail: `${task} not available on your plan` }, 403)
  }

  const isUnlimited = requestsLimit === -1
  if (!isUnlimited && requestsUsed >= requestsLimit) {
    return json({
      error: 'quota_exceeded',
      used:  requestsUsed,
      limit: requestsLimit,
    }, 403)
  }

  // ── 4. Resolve active AI provider ────────────────────────────────────────
  const { data: serviceConfig, error: configError } = await admin
    .from('cloud_service_config')
    .select('provider_name, provider_config')
    .eq('service_type', 'ai')
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
    console.error(`[proxy-ai] Secret not set: ${secretName}`)
    return json({ error: 'key_not_configured' }, 503)
  }

  // ── 6. Prepare messages ───────────────────────────────────────────────────
  let finalMessages = [...messages]

  if (task === 'translate') {
    const sourceLang = options.source_lang ?? 'auto'
    const targetLang = options.target_lang ?? 'en'
    const sysPrompt  = buildTranslateSystemPrompt(sourceLang, targetLang)

    // Inject system prompt if not already present
    const hasSystem = finalMessages.some(m => m.role === 'system')
    if (!hasSystem) {
      finalMessages = [{ role: 'system', content: sysPrompt }, ...finalMessages]
    }
  }

  // ── 7. Call AI provider ───────────────────────────────────────────────────
  let resultText: string
  try {
    switch (providerName) {
      case 'gemini':
        resultText = await _callGemini(masterKey, finalMessages, providerMeta, maxTokensPerRequest)
        break
      default:
        throw new Error(`Unsupported AI provider: ${providerName}`)
    }
  } catch (err) {
    console.error('[proxy-ai] Provider error:', err)
    return json({ error: 'provider_error', detail: String(err) }, 502)
  }

  // ── 8. Debit quota AFTER successful response ──────────────────────────────
  const { error: debitError } = await admin.rpc('debit_ai_usage', {
    p_user_id: user.id,
    p_task:    task,
  })

  if (debitError) {
    console.error('[proxy-ai] Debit error:', debitError)
    // Non-fatal: response already generated, return it.
  }

  // ── 9. Record usage session ───────────────────────────────────────────────
  const sessionId = crypto.randomUUID()
  await admin.from('usage_sessions').insert({
    id:               sessionId,
    user_id:          user.id,
    service_type:     task,        // 'ai' or 'translate'
    provider_name:    providerName,
    debited_seconds:  1,           // reused column: 1 request
    duration_seconds: 1,
  })

  // ── 10. Return result ─────────────────────────────────────────────────────
  const remaining = isUnlimited ? -1 : Math.max(requestsLimit - (requestsUsed + 1), 0)

  return json(
    { text: resultText, requests_remaining: remaining },
    200,
    { 'X-Requests-Remaining': String(remaining), 'X-Session-Id': sessionId }
  )
})

// ─── Gemini provider ──────────────────────────────────────────────────────────

interface GeminiMessage {
  role: 'user' | 'model'
  parts: Array<{ text: string }>
}

async function _callGemini(
  masterKey: string,
  messages: Array<{ role: string; content: string }>,
  providerMeta: Record<string, unknown>,
  maxOutputTokens: number
): Promise<string> {
  const model = (providerMeta.model as string | undefined) ?? 'gemini-2.5-flash-preview-05-20'

  // Separate system instruction from conversation messages
  let systemInstruction: string | undefined
  const conversationMessages: GeminiMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemInstruction = msg.content
    } else {
      // Gemini uses 'user' / 'model' roles (not 'assistant')
      const role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user'
      conversationMessages.push({ role, parts: [{ text: msg.content }] })
    }
  }

  // Gemini requires alternating user/model turns — merge consecutive same-role messages
  const normalizedMessages: GeminiMessage[] = []
  for (const msg of conversationMessages) {
    const last = normalizedMessages[normalizedMessages.length - 1]
    if (last && last.role === msg.role) {
      last.parts.push(...msg.parts)
    } else {
      normalizedMessages.push({ ...msg, parts: [...msg.parts] })
    }
  }

  // Gemini must start with a user turn
  if (!normalizedMessages.length || normalizedMessages[0].role !== 'user') {
    normalizedMessages.unshift({ role: 'user', parts: [{ text: '.' }] })
  }

  const requestBody: Record<string, unknown> = {
    contents: normalizedMessages,
    generationConfig: {
      maxOutputTokens: Math.min(maxOutputTokens, 2048),
      temperature:     0.3,
    },
  }

  if (systemInstruction) {
    requestBody.systemInstruction = { parts: [{ text: systemInstruction }] }
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${masterKey}`

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(requestBody),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Gemini API ${res.status}: ${detail}`)
  }

  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text

  if (typeof text !== 'string') {
    throw new Error('Gemini returned no text content')
  }

  return text
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
      ...corsHeaders(),
    },
  })
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
