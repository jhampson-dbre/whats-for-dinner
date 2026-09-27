import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createClient, getUser, from, rpc } = vi.hoisted(() => ({
  createClient: vi.fn(), getUser: vi.fn(), from: vi.fn(), rpc: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient }))

import handler from '../api/households'

const request = (method: string, body?: object) => new Request('https://dinner.example/api/households', {
  method, headers: { authorization: 'Bearer user-token', ...(body ? { 'content-type': 'application/json' } : {}) },
  body: body && JSON.stringify(body),
})

describe('household access API', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('SUPABASE_SECRET_KEY', 'server-only-key')
    vi.clearAllMocks()
    createClient.mockReturnValue({ auth: { getUser }, from, rpc })
    getUser.mockResolvedValue({ data: { user: { id: 'user-id', email: 'cook@example.com', email_confirmed_at: '2026-09-27T00:00:00Z' } }, error: null })
  })

  it('rejects an unverified account before accessing household data', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-id', email: 'cook@example.com', email_confirmed_at: null } }, error: null })
    expect((await handler.fetch(request('GET'))).status).toBe(403)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects member invitation without current creator membership', async () => {
    const membership = { maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'member' }, error: null }) }
    from.mockReturnValue({ select: () => ({ eq: () => ({ eq: () => membership }) }) })
    const response = await handler.fetch(request('POST', { action: 'invite', householdId: '31a95af5-89dc-4858-9546-5c039852f63a', email: 'guest@example.com' }))
    expect(response.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects revocation after creator membership disappears', async () => {
    const membership = { maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }
    from.mockReturnValue({ select: () => ({ eq: () => ({ eq: () => membership }) }) })
    const response = await handler.fetch(request('POST', { action: 'revoke-member', householdId: '31a95af5-89dc-4858-9546-5c039852f63a', userId: '11111111-1111-4111-8111-111111111111' }))
    expect(response.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('issues only a hashed member invitation for a current creator', async () => {
    const insert = vi.fn().mockReturnValue({ select: () => ({ single: () => Promise.resolve({ data: { id: 'invite-id' }, error: null }) }) })
    from.mockImplementation((table: string) => table === 'household_memberships'
      ? { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { role: 'creator' }, error: null }) }) }) }) }
      : { insert })
    const response = await handler.fetch(request('POST', { action: 'invite', householdId: '31a95af5-89dc-4858-9546-5c039852f63a', email: 'GUEST@example.com' }))
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ email: 'guest@example.com', role: 'member', token_hash: expect.stringMatching(/^[a-f0-9]{64}$/) }))
    expect(insert.mock.calls[0][0].token_hash).not.toBe(body.token)
  })

  it('passes only a token hash and the verified identity to atomic acceptance', async () => {
    rpc.mockResolvedValue({ data: '31a95af5-89dc-4858-9546-5c039852f63a', error: null })
    const response = await handler.fetch(request('POST', { action: 'accept', token: 'a'.repeat(43), email: 'someone-else@example.com' }))
    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('accept_household_invitation', {
      p_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/), p_user_id: 'user-id', p_email: 'cook@example.com',
    })
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('a'.repeat(43))
  })
})
