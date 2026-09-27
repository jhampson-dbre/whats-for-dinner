import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createClient, getUser, rpc } = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn(), rpc: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient }))

import handler from '../api/records'

const householdId = '31a95af5-89dc-4858-9546-5c039852f63a'
const headers = { authorization: 'Bearer user-token', 'content-type': 'application/json' }

describe('record API', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('SUPABASE_SECRET_KEY', 'server-only-key')
    vi.clearAllMocks()
    createClient.mockReturnValue({ auth: { getUser }, rpc })
    getUser.mockResolvedValue({ data: { user: { id: 'user-id', email: 'cook@example.com', email_confirmed_at: '2026-09-27T00:00:00Z' } }, error: null })
  })

  it('requires a verified actor and live membership for a pinned page', async () => {
    rpc.mockResolvedValue({ data: { status: 403 }, error: null })
    const response = await handler.fetch(new Request(`https://dinner.example/api/records?householdId=${householdId}&kind=meal&revision=4`, { headers }))
    expect(response.status).toBe(403)
    expect(rpc).toHaveBeenCalledWith('read_household_records', expect.objectContaining({ p_household_id: householdId, p_user_id: 'user-id', p_revision: 4 }))
  })

  it('rejects an invalid changed record before writing', async () => {
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 0, idempotencyKey: 'once', changes: [{ kind: 'meal', id: 'm1', value: { id: 'm1', name: '', active: true } }],
    }) }))
    expect(response.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('replays a stale request through the membership-checked write RPC', async () => {
    rpc.mockResolvedValueOnce({ data: { status: 409 }, error: null })
      .mockResolvedValueOnce({ data: { status: 200, revision: 1 }, error: null })
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 0, idempotencyKey: 'once', changes: [{ kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Pasta', active: true } }],
    }) }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ revision: 1 })
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['read_household_records', 'write_household_records'])
  })

  it('rejects a plan slot whose meal does not exist before CAS', async () => {
    rpc.mockResolvedValue({ data: { status: 200, revision: 0, records: [], nextCursor: null }, error: null })
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 0, idempotencyKey: 'once', changes: [
        { kind: 'plan', id: 'p1', value: { id: 'p1' } },
        { kind: 'slot', id: 's1', planId: 'p1', position: 0, value: { id: 's1', date: '2026-09-27', mealId: 'missing' } },
      ],
    }) }))
    expect(response.status).toBe(400)
    expect(rpc.mock.calls.every(([name]) => name === 'read_household_records')).toBe(true)
  })

  it('requires the revision on continuation pages', async () => {
    const response = await handler.fetch(new Request(`https://dinner.example/api/records?householdId=${householdId}&kind=meal&after=123`, { headers }))
    expect(response.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
})
