import { createHash, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

const uuid = z.string().uuid()
const email = z.email().max(320)
const accept = z.object({ action: z.literal('accept'), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
const invite = z.object({ action: z.literal('invite'), householdId: uuid, email })
const revokeMember = z.object({ action: z.literal('revoke-member'), householdId: uuid, userId: uuid })
const revokeInvite = z.object({ action: z.literal('revoke-invite'), householdId: uuid, inviteId: uuid })
const bodySchema = z.discriminatedUnion('action', [accept, invite, revokeMember, revokeInvite])

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
const fail = (status: number) => json({ error: status === 500 ? 'Server error' : status === 403 ? 'Forbidden' : 'Invalid request' }, status)

export default {
  async fetch(request: Request): Promise<Response> {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SECRET_KEY
    if (!url || !key) return fail(500)
    const token = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]
    if (!token) return fail(401)
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
    const { data: { user }, error: authError } = await db.auth.getUser(token)
    if (authError || !user) return fail(401)
    if (!user.email || !user.email_confirmed_at || user.is_anonymous) return fail(403)

    if (request.method === 'GET') {
      const householdId = new URL(request.url).searchParams.get('householdId')
      if (!householdId) {
        const { data, error } = await db.from('household_memberships').select('household_id,role').eq('user_id', user.id)
        return error ? fail(500) : json({ households: data })
      }
      if (!uuid.safeParse(householdId).success) return fail(400)
      const { data: membership, error } = await db.from('household_memberships').select('role').eq('user_id', user.id).eq('household_id', householdId).maybeSingle()
      if (error) return fail(500)
      if (!membership) return fail(403)
      const { data, error: listError } = await db.from('household_memberships').select('user_id,email,role').eq('household_id', householdId)
      return listError ? fail(500) : json({ members: data })
    }

    if (request.method !== 'POST') return fail(405)
    if (Number(request.headers.get('content-length') ?? 0) > 2048) return fail(400)
    let raw: unknown
    try { raw = JSON.parse(await request.text()) } catch { return fail(400) }
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) return fail(400)
    const body = parsed.data

    if (body.action === 'accept') {
      const { data, error } = await db.rpc('accept_household_invitation', {
        p_token_hash: createHash('sha256').update(body.token).digest('hex'),
        p_user_id: user.id,
        p_email: user.email.toLowerCase(),
      })
      return error ? fail(error.message === 'invalid_invitation' ? 403 : 500) : json({ householdId: data })
    }

    const { data: membership, error: memberError } = await db.from('household_memberships').select('role').eq('user_id', user.id).eq('household_id', body.householdId).maybeSingle()
    if (memberError) return fail(500)
    if (membership?.role !== 'creator') return fail(403)

    if (body.action === 'invite') {
      const secret = randomBytes(32).toString('base64url')
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await db.from('household_invitations').insert({
        token_hash: createHash('sha256').update(secret).digest('hex'),
        email: body.email.trim().toLowerCase(), role: 'member', household_id: body.householdId, expires_at: expiresAt,
      }).select('id').single()
      return error ? fail(500) : json({ inviteId: data.id, token: secret, expiresAt }, 201)
    }

    if (body.action === 'revoke-member') {
      const { data, error } = await db.rpc('revoke_household_member', { p_household_id: body.householdId, p_user_id: body.userId })
      return error ? fail(500) : data ? json({ revoked: true }) : fail(404)
    }

    const { data, error } = await db.from('household_invitations').update({ revoked_at: new Date().toISOString() }).eq('id', body.inviteId).eq('household_id', body.householdId).eq('role', 'member').is('used_at', null).is('revoked_at', null).select('id')
    return error ? fail(500) : data?.length ? json({ revoked: true }) : fail(404)
  },
}
