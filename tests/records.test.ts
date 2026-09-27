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

  it('rejects a child position outside the database integer range before reading', async () => {
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 0, idempotencyKey: 'position', changes: [{ kind: 'slot', id: 's1', planId: 'p1', position: 2147483648, value: { id: 's1', date: '2026-09-27' } }],
    }) }))
    expect(response.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns 413 for an oversized individual record', async () => {
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 0, idempotencyKey: 'large-record', changes: [{ kind: 'recipe', id: 'r1', value: { id: 'r1', title: 'Pasta', ingredients: Array(100).fill('x'.repeat(400)) } }],
    }) }))
    expect(response.status).toBe(413)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns 400 when a change omits its value', async () => {
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 0, idempotencyKey: 'once', changes: [{ kind: 'meal', id: 'm1' }],
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
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['read_household_dependencies', 'write_household_records'])
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
    expect(rpc.mock.calls.every(([name]) => name === 'read_household_dependencies')).toBe(true)
  })

  it('requires the revision on continuation pages', async () => {
    const response = await handler.fetch(new Request(`https://dinner.example/api/records?householdId=${householdId}&kind=meal&after=123`, { headers }))
    expect(response.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('looks up one ID directly without scanning its kind history', async () => {
    rpc.mockImplementation((name: string) => name === 'read_household_dependencies'
      ? Promise.resolve({ data: { status: 200, revision: 8, records: [{ seq: 50000, kind: 'outcome', id: 'o-late', value: { id: 'o-late' } }], nextCursor: null }, error: null })
      : Promise.reject(new Error('history scan')))
    const response = await handler.fetch(new Request(`https://dinner.example/api/records?householdId=${householdId}&kind=outcome&id=o-late`, { headers }))
    expect(response.status).toBe(200)
    expect((await response.json()).record.id).toBe('o-late')
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['read_household_dependencies'])
  })

  it('validates a new meal through targeted reads without paging retained history', async () => {
    rpc.mockImplementation((name: string) => name === 'read_household_dependencies'
      ? Promise.resolve({ data: { status: 200, revision: 0, records: [], nextCursor: null }, error: null })
      : name === 'write_household_records'
        ? Promise.resolve({ data: { status: 200, revision: 1 }, error: null })
        : Promise.reject(new Error('whole-household scan')))
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 0, idempotencyKey: 'new-meal', changes: [{ kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Pasta', active: true } }],
    }) }))
    expect(response.status).toBe(200)
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['read_household_dependencies', 'write_household_records'])
  })

  it('rejects replacement of an existing outcome', async () => {
    rpc.mockResolvedValue({ data: { status: 200, revision: 3, records: [{
      seq: 1, kind: 'outcome', id: 'o1', value: { id: 'o1', acceptance: 'accepted' },
    }], nextCursor: null }, error: null })
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 3, idempotencyKey: 'replace', changes: [{ kind: 'outcome', id: 'o1', value: { id: 'o1', acceptance: 'rejected' } }],
    }) }))
    expect(response.status).toBe(400)
    expect(rpc.mock.calls.every(([name]) => name === 'read_household_dependencies')).toBe(true)
  })

  it('rejects a completed-slot takeout rewrite without an audit revision', async () => {
    rpc.mockResolvedValue({ data: { status: 200, revision: 2, records: [{
      seq: 1, kind: 'slot', id: 's1', planId: 'p1', position: 0,
      value: { id: 's1', date: '2026-09-27', mealId: 'm1', dinnerReadyAt: '2026-09-27T18:00:00Z' },
    }], nextCursor: null }, error: null })
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 2, idempotencyKey: 'rewrite', changes: [{ kind: 'slot', id: 's1', planId: 'p1', position: 0,
        value: { id: 's1', date: '2026-09-27', dinnerReadyAt: '2026-09-27T18:00:00Z' } }],
    }) }))
    expect(response.status).toBe(400)
    expect(rpc.mock.calls.every(([name]) => name === 'read_household_dependencies')).toBe(true)
  })

  it('rejects a second correction of the same outcome', async () => {
    rpc.mockImplementation((name: string, args: { p_incoming?: unknown[] }) => name === 'read_household_dependencies'
      ? Promise.resolve({ data: { status: 200, revision: 2, records: args.p_incoming?.length ? [
        { seq: 1, kind: 'outcome', id: 'o1', value: { id: 'o1', acceptance: 'accepted' } },
        { seq: 2, kind: 'outcome', id: 'o2', value: { id: 'o2', correctionOfOutcomeId: 'o1', acceptance: 'rejected' } },
      ] : [], nextCursor: null }, error: null })
      : Promise.reject(new Error('unexpected write')))
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 2, idempotencyKey: 'fork', changes: [{ kind: 'outcome', id: 'o3', value: { id: 'o3', correctionOfOutcomeId: 'o1', acceptance: 'neutral' } }],
    }) }))
    expect(response.status).toBe(400)
    expect(rpc.mock.calls.every(([name]) => name === 'read_household_dependencies')).toBe(true)
  })

  it('requires an atomic repair revision when a confirmed slot changes meals', async () => {
    const existing = [
      { seq: 1, kind: 'plan', id: 'p1', value: { id: 'p1', confirmed: true } },
      { seq: 2, kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Pasta', active: true } },
      { seq: 3, kind: 'meal', id: 'm2', value: { id: 'm2', name: 'Soup', active: true } },
      { seq: 4, kind: 'slot', id: 's1', planId: 'p1', position: 0, value: { id: 's1', date: '2026-09-27', mealId: 'm1' } },
    ]
    rpc.mockImplementation((name: string, args: { p_keys?: Array<{ kind: string; id: string }>; p_plan_ids?: string[] }) => name === 'read_household_dependencies'
      ? Promise.resolve({ data: { status: 200, revision: 4, records: existing.filter((row) => args.p_keys?.some((key) => key.kind === row.kind && key.id === row.id) || (row.kind === 'slot' && args.p_plan_ids?.includes(row.planId ?? ''))), nextCursor: null }, error: null })
      : Promise.resolve({ data: { status: 200, revision: 5 }, error: null }))
    const slot = { kind: 'slot', id: 's1', planId: 'p1', position: 0, value: { id: 's1', date: '2026-09-27', mealId: 'm2' } }
    const request = (changes: object[], idempotencyKey: string) => handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({ householdId, expectedRevision: 4, idempotencyKey, changes }) }))
    expect((await request([slot], 'missing-repair')).status).toBe(400)
    expect(rpc.mock.calls.some(([name]) => name === 'write_household_records')).toBe(false)
    const repair = { kind: 'repair', id: 'repair1', planId: 'p1', position: 0, value: { id: 'repair1', createdAt: '2026-09-27T18:00:00Z', slotId: 's1', kind: 'swap' } }
    expect((await request([slot, repair], 'with-repair')).status).toBe(200)
  })

  it('rejects removal of a recipe association used by an unfinished slot', async () => {
    const records = [
      { seq: 1, kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Pasta', active: true, recipeIds: ['r1'] } },
      { seq: 2, kind: 'recipe', id: 'r1', value: { id: 'r1', title: 'Pasta recipe' } },
      { seq: 3, kind: 'plan', id: 'p1', value: { id: 'p1' } },
      { seq: 4, kind: 'slot', id: 's1', planId: 'p1', position: 0, value: { id: 's1', date: '2026-09-27', mealId: 'm1', recipeId: 'r1' } },
    ]
    rpc.mockImplementation((name: string, args: { p_keys?: Array<{ kind: string; id: string }>; p_incoming?: Array<{ kind: string; id: string; sourceKinds: string[] }>; p_plan_ids?: string[] }) => {
      if (name !== 'read_household_dependencies') return Promise.reject(new Error('invalid write'))
      const selected = records.filter((row) => args.p_keys?.some((key) => key.kind === row.kind && key.id === row.id)
        || (row.kind === 'slot' && args.p_plan_ids?.includes(row.planId ?? ''))
        || (row.kind === 'slot' && args.p_incoming?.some((key) => key.kind === 'meal' && key.id === 'm1' && key.sourceKinds.includes('slot'))))
      return Promise.resolve({ data: { status: 200, revision: 1, records: selected, nextCursor: null }, error: null })
    })
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 1, idempotencyKey: 'remove-association', changes: [{ kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Pasta', active: true, recipeIds: [] } }],
    }) }))
    expect(response.status).toBe(400)
    expect(rpc.mock.calls.some(([name, args]) => name === 'read_household_dependencies' && args.p_incoming?.some((key: { kind: string }) => key.kind === 'meal'))).toBe(true)
  })

  it('accepts an atomic completed-dinner takeout correction with append-only evidence', async () => {
    const existing = [
      { seq: 1, kind: 'plan', id: 'p1', value: { id: 'p1', confirmed: true } },
      { seq: 2, kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Pasta', active: true } },
      { seq: 3, kind: 'slot', id: 's1', planId: 'p1', position: 0, value: { id: 's1', date: '2026-09-27', mealId: 'm1', dinnerReadyAt: '2026-09-27T18:00:00Z' } },
      { seq: 4, kind: 'outcome', id: 'o1', value: { id: 'o1', planId: 'p1', planSlotId: 's1', mealId: 'm1', acceptance: 'accepted' } },
    ]
    rpc.mockImplementation((name: string, args: { p_keys?: Array<{ kind: string; id: string }>; p_incoming?: Array<{ kind: string; id: string }>; p_plan_ids?: string[] }) => name === 'read_household_dependencies'
      ? Promise.resolve({ data: { status: 200, revision: 4, records: existing.filter((row) => args.p_keys?.some((key) => key.kind === row.kind && key.id === row.id)
        || (row.kind === 'slot' && args.p_plan_ids?.includes(row.planId ?? ''))
        || (row.kind === 'outcome' && args.p_incoming?.some((key) => key.kind === 'slot' && key.id === 's1'))), nextCursor: null }, error: null })
      : Promise.resolve({ data: { status: 200, revision: 5 }, error: null }))
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 4, idempotencyKey: 'takeout-correction', changes: [
        { kind: 'slot', id: 's1', planId: 'p1', position: 0, value: { id: 's1', date: '2026-09-27', dinnerReadyAt: '2026-09-27T18:00:00Z' } },
        { kind: 'repair', id: 'repair1', planId: 'p1', position: 0, value: { id: 'repair1', createdAt: '2026-09-27T19:00:00Z', slotId: 's1', kind: 'takeout' } },
        { kind: 'outcome', id: 'o2', value: { id: 'o2', planId: 'p1', planSlotId: 's1', correctionOfOutcomeId: 'o1', acceptance: 'accepted' } },
      ],
    }) }))
    expect(response.status).toBe(200)
    expect(rpc.mock.calls.at(-1)?.[0]).toBe('write_household_records')
  })
})
