/**
 * _shared/auth.ts
 *
 * Shared JWT verification helper for Transkit Cloud edge functions.
 *
 * Background: Supabase's "Verify JWT with legacy secret" setting is disabled,
 * which means the built-in JWT middleware no longer validates tokens before
 * the function runs. Functions that used the old pattern:
 *
 *   const supabase = createClient(URL, ANON_KEY, { global: { headers: { Authorization } } })
 *   const { data: { user } } = await supabase.auth.getUser()  // ← returns 401
 *
 * must instead use the admin client to call auth.getUser(token) explicitly:
 *
 *   const { data: { user } } = await admin.auth.getUser(token) // ← works
 *
 * This module centralises that pattern so every function has consistent auth.
 */

import { SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2'

export class AuthError extends Error {
  constructor(public code = 'unauthorized', public status = 401) {
    super(code)
  }
}

/**
 * Verify the Bearer token in the Authorization header using the admin client.
 * Returns the authenticated User on success.
 * Throws AuthError({ code: 'unauthorized', status: 401 }) on failure.
 */
export async function verifyUser(
  req: Request,
  admin: SupabaseClient
): Promise<User> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) throw new AuthError()

  const token = authHeader.slice('Bearer '.length).trim()
  if (!token) throw new AuthError()

  // admin.auth.getUser(token) validates the JWT via Supabase Auth API regardless
  // of whether the edge function's JWT middleware is enabled or disabled.
  const { data: { user }, error } = await admin.auth.getUser(token)
  if (error || !user) throw new AuthError()

  return user
}
