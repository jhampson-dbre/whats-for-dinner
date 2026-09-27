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

  const mockAffected = (records: Array<{ seq: number; kind: string; id: string; planId?: string; position?: number; value: unknown }>, totals: Array<{ planId?: string; mealId: string; recipeId?: string; count: string; sum: string; hasRecipe: boolean; unavailable?: boolean }> = [], contributions: unknown[] = []) => {
    rpc.mockImplementation((name: string, args: { p_keys?: Array<{ kind: string; id: string }>; p_plan_ids?: string[] }) => {
      if (name === 'read_household_dependencies') return Promise.resolve({ data: {
        status: 200, revision: 0,
        records: records.filter((row) => args.p_keys?.some((key) => key.kind === row.kind && key.id === row.id)
          || (row.kind === 'slot' && args.p_plan_ids?.includes(row.planId ?? ''))), nextCursor: null,
      }, error: null })
      if (name === 'read_household_effort') return Promise.resolve({ data: { status: 200, totals, contributions }, error: null })
      return Promise.resolve({ data: { status: 200, revision: 1 }, error: null })
    })
  }

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
    expect(rpc.mock.calls.some(([name]) => name === 'write_household_records')).toBe(false)
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
      : name === 'check_household_record_changes'
        ? Promise.resolve({ data: { status: 200 }, error: null })
      : name === 'write_household_records'
        ? Promise.resolve({ data: { status: 200, revision: 1 }, error: null })
        : Promise.reject(new Error('whole-household scan')))
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 0, idempotencyKey: 'new-meal', changes: [{ kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Pasta', active: true } }],
    }) }))
    expect(response.status).toBe(200)
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['read_household_dependencies', 'check_household_record_changes', 'write_household_records'])
  })

  it('does not hydrate years of incoming slots for a meal recipe change', async () => {
    const records = [
      { seq: 1, kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Pasta', active: true, recipeIds: ['r1'] } },
      { seq: 2, kind: 'recipe', id: 'r1', value: { id: 'r1', title: 'Original', mealId: 'm1' } },
      { seq: 3, kind: 'recipe', id: 'r2', value: { id: 'r2', title: 'New', mealId: 'm1' } },
      ...Array.from({ length: 300 }, (_, index) => ({ seq: index + 4, kind: 'slot', id: `historical-slot-${index}`, planId: `historical-plan-${index}`, value: { id: `historical-slot-${index}`, date: '2026-09-27', mealId: 'm1', recipeId: 'r1' } })),
    ]
    let returned = 0
    rpc.mockImplementation((name: string, args: { p_keys?: Array<{ kind: string; id: string }>; p_incoming?: unknown[] }) => {
      if (name === 'check_household_record_changes') return Promise.resolve({ data: { status: 200 }, error: null })
      if (name === 'write_household_records') return Promise.resolve({ data: { status: 200, revision: 2 }, error: null })
      if (name !== 'read_household_dependencies' || args.p_incoming?.length) throw new Error('incoming history hydrated')
      const selected = records.filter((row) => args.p_keys?.some((key) => key.kind === row.kind && key.id === row.id))
      returned += selected.length
      return Promise.resolve({ data: { status: 200, revision: 1, records: selected, nextCursor: null }, error: null })
    })
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 1, idempotencyKey: 'recipe-change', changes: [{ kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Pasta', active: true, recipeIds: ['r1', 'r2'] } }],
    }) }))
    expect(response.status).toBe(200)
    expect(rpc.mock.calls.filter(([name]) => name === 'read_household_dependencies').length).toBeLessThanOrEqual(2)
    expect(returned).toBeLessThanOrEqual(3)
  })

  it('rejects assigning a listed recipe to another meal through indexed owner lookup', async () => {
    const records = [
      { seq: 1, kind: 'recipe', id: 'r1', value: { id: 'r1', title: 'Soup' } },
      { seq: 2, kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Owner', active: true, recipeIds: ['r1'] } },
      { seq: 3, kind: 'meal', id: 'm2', value: { id: 'm2', name: 'Other', active: true } },
    ]
    rpc.mockImplementation((name: string, args: { p_keys?: Array<{ kind: string; id: string }>; p_incoming?: Array<{ kind: string; id: string; sourceKinds: string[] }> }) => {
      if (name === 'read_household_dependencies') return Promise.resolve({ data: { status: 200, revision: 1,
        records: records.filter((row) => args.p_keys?.some((key) => key.kind === row.kind && key.id === row.id)
          || args.p_incoming?.some((key) => key.kind === 'recipe' && key.id === 'r1' && key.sourceKinds.includes('meal') && row.id === 'm1')),
        nextCursor: null }, error: null })
      return Promise.resolve({ data: { status: 200, revision: 2 }, error: null })
    })
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 1, idempotencyKey: 'dual-owner', changes: [{ kind: 'recipe', id: 'r1', value: { id: 'r1', title: 'Soup', mealId: 'm2' } }],
    }) }))
    expect(response.status).toBe(400)
    expect(rpc.mock.calls.some(([name, args]) => name === 'read_household_dependencies' && args.p_incoming?.some((key: { kind: string }) => key.kind === 'recipe'))).toBe(true)
  })

  it('rejects listing a recipe already assigned to another meal without traversing its owner', async () => {
    mockAffected([
      { seq: 1, kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Owner', active: true } },
      { seq: 2, kind: 'recipe', id: 'r1', value: { id: 'r1', title: 'Soup', mealId: 'm2' } },
    ])
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 0, idempotencyKey: 'reverse-owner', changes: [{ kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Owner', active: true, recipeIds: ['r1'] } }],
    }) }))
    expect(response.status).toBe(400)
    expect(rpc.mock.calls.some(([name]) => name === 'write_household_records')).toBe(false)
  })

  it('keeps a long recovery chain out of a simple meal edit while rejecting a missing direct edge', async () => {
    const records = Array.from({ length: 200 }, (_, index) => ({ seq: index + 1, kind: 'meal', id: `chain_${index}`, value: {
      id: `chain_${index}`, name: `Meal ${index}`, active: true, ...(index < 199 && { recoveryMealIds: [`chain_${index + 1}`] }),
    } }))
    let returned = 0
    rpc.mockImplementation((name: string, args: { p_keys?: Array<{ kind: string; id: string }> }) => {
      if (name === 'read_household_dependencies') {
        const selected = records.filter((row) => args.p_keys?.some((key) => key.kind === row.kind && key.id === row.id))
        returned += selected.length
        return Promise.resolve({ data: { status: 200, revision: 1, records: selected, nextCursor: null }, error: null })
      }
      return Promise.resolve({ data: { status: 200, revision: 2 }, error: null })
    })
    const change = (recoveryMealIds: string[]) => new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 1, idempotencyKey: recoveryMealIds[0], changes: [{ kind: 'meal', id: 'chain_0', value: { id: 'chain_0', name: 'Edited', active: true, recoveryMealIds } }],
    }) })
    expect((await handler.fetch(change(['chain_1']))).status).toBe(200)
    expect(rpc.mock.calls.filter(([name]) => name === 'read_household_dependencies').length).toBeLessThanOrEqual(2)
    expect(returned).toBeLessThanOrEqual(2)
    expect((await handler.fetch(change(['missing']))).status).toBe(400)
  })

  it('checks a correction against its direct predecessor without reading the correction chain', async () => {
    const records = Array.from({ length: 200 }, (_, index) => ({ seq: index + 1, kind: 'outcome', id: `outcome_${index}`, value: {
      id: `outcome_${index}`, ...(index > 0 && { correctionOfOutcomeId: `outcome_${index - 1}` }),
    } }))
    let returned = 0
    rpc.mockImplementation((name: string, args: { p_keys?: Array<{ kind: string; id: string }> }) => {
      if (name === 'read_household_dependencies') {
        const selected = records.filter((row) => args.p_keys?.some((key) => key.kind === row.kind && key.id === row.id))
        returned += selected.length
        return Promise.resolve({ data: { status: 200, revision: 1, records: selected, nextCursor: null }, error: null })
      }
      return Promise.resolve({ data: { status: 200, revision: 2, totals: [], contributions: [] }, error: null })
    })
    const request = (prior: string) => new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 1, idempotencyKey: prior, changes: [{ kind: 'outcome', id: 'outcome_200', value: { id: 'outcome_200', correctionOfOutcomeId: prior } }],
    }) })
    expect((await handler.fetch(request('outcome_199'))).status).toBe(200)
    expect(rpc.mock.calls.filter(([name]) => name === 'read_household_dependencies').length).toBeLessThanOrEqual(2)
    expect(returned).toBeLessThanOrEqual(1)
    expect((await handler.fetch(request('missing'))).status).toBe(400)
  })

  it('rejects direct confirmation of a meal marked unsafe', async () => {
    const existing = [{ seq: 1, kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Pasta', active: true, safetyReview: 'rejected' } }]
    rpc.mockImplementation((name: string, args: { p_keys?: Array<{ kind: string; id: string }> }) => name === 'read_household_dependencies'
      ? Promise.resolve({ data: { status: 200, revision: 0, records: existing.filter((row) => args.p_keys?.some((key) => key.kind === row.kind && key.id === row.id)), nextCursor: null }, error: null })
      : Promise.resolve({ data: { status: 200, revision: 1 }, error: null }))
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 0, idempotencyKey: 'unsafe-plan', changes: [
        { kind: 'plan', id: 'p1', value: { id: 'p1', confirmed: true } },
        { kind: 'slot', id: 's1', planId: 'p1', position: 0, value: { id: 's1', date: '2026-09-27', mealId: 'm1' } },
      ],
    }) }))
    expect(response.status).toBe(400)
    expect(rpc.mock.calls.some(([name]) => name === 'write_household_records')).toBe(false)
  })

  it('rejects an unsafe selection in a confirmed-plan repair', async () => {
    mockAffected([
      { seq: 1, kind: 'plan', id: 'p1', value: { id: 'p1', confirmed: true } },
      { seq: 2, kind: 'slot', id: 's1', planId: 'p1', position: 0, value: { id: 's1', date: '2026-09-27', mealId: 'm1' } },
      { seq: 3, kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Pasta', active: true } },
      { seq: 4, kind: 'meal', id: 'm2', value: { id: 'm2', name: 'Soup', active: true, safetyReview: 'rejected' } },
    ], [{ mealId: 'm2', count: '0', sum: '0', hasRecipe: false }])
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 0, idempotencyKey: 'unsafe-repair', changes: [
        { kind: 'slot', id: 's1', planId: 'p1', position: 0, value: { id: 's1', date: '2026-09-27', mealId: 'm2' } },
        { kind: 'repair', id: 'repair1', planId: 'p1', position: 0, value: { id: 'repair1', createdAt: '2026-09-27T19:00:00Z', slotId: 's1', kind: 'recovery' } },
      ],
    }) }))
    expect(response.status).toBe(400)
    expect(rpc.mock.calls.some(([name]) => name === 'write_household_records')).toBe(false)
  })

  it('allows a settings edit that makes an existing confirmed plan need repair', async () => {
    mockAffected([{ seq: 1, kind: 'settings', id: 'settings', value: { diners: [], hardRestrictions: [], scheduleExceptions: [] } }])
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 0, idempotencyKey: 'new-restriction', changes: [{ kind: 'settings', id: 'settings', value: {
        diners: [], hardRestrictions: [{ id: 'restriction1', label: 'No peanuts' }], scheduleExceptions: [],
      } }],
    }) }))
    expect(response.status).toBe(200)
    expect(rpc.mock.calls.some(([name]) => name === 'read_household_effort')).toBe(false)
  })

  it('uses a corrected effort outcome for constrained-night confirmation', async () => {
    mockAffected([
      { seq: 1, kind: 'settings', id: 'settings', value: { diners: [], hardRestrictions: [], scheduleExceptions: [{ id: 'night1', date: '2026-09-27', constrained: true }] } },
      { seq: 2, kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Pasta', active: true, recipeIds: ['r1'] } },
      { seq: 3, kind: 'recipe', id: 'r1', value: { id: 'r1', title: 'Pasta', prepMinutes: 45 } },
      { seq: 4, kind: 'outcome', id: 'o1', value: { id: 'o1', mealId: 'm1', recipeId: 'r1', activeEffortMinutes: 45 } },
    ], [{ mealId: 'm1', recipeId: 'r1', count: '1', sum: '45', hasRecipe: false }], [
      { outcomeId: 'o1', mealId: 'm1', recipeId: 'r1', minutes: 45, active: true },
    ])
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 0, idempotencyKey: 'corrected-effort', changes: [
        { kind: 'outcome', id: 'o2', value: { id: 'o2', mealId: 'm1', recipeId: 'r1', activeEffortMinutes: 10, correctionOfOutcomeId: 'o1' } },
        { kind: 'plan', id: 'p1', value: { id: 'p1', confirmed: true } },
        { kind: 'slot', id: 's1', planId: 'p1', position: 0, value: { id: 's1', date: '2026-09-27', mealId: 'm1', recipeId: 'r1' } },
      ],
    }) }))
    expect(response.status).toBe(200)
    expect(rpc.mock.calls.some(([name]) => name === 'read_household_effort')).toBe(true)
  })

  it('rejects a confirmed recipe with an indexed unavailable ingredient', async () => {
    mockAffected([
      { seq: 1, kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Pasta', active: true, recipeIds: ['r1'] } },
      { seq: 2, kind: 'recipe', id: 'r1', value: { id: 'r1', title: 'Pasta', ingredients: ['2 cups milk'] } },
    ], [{ planId: 'p1', mealId: 'm1', recipeId: 'r1', count: '0', sum: '0', hasRecipe: false, unavailable: true }])
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 0, idempotencyKey: 'unavailable', changes: [
        { kind: 'plan', id: 'p1', value: { id: 'p1', confirmed: true } },
        { kind: 'slot', id: 's1', planId: 'p1', position: 0, value: { id: 's1', date: '2026-09-27', mealId: 'm1', recipeId: 'r1' } },
      ],
    }) }))
    expect(response.status).toBe(400)
  })

  it.each([
    { rule: { constrained: true }, label: 'unknown constrained effort' },
    { rule: { handsOff: true }, label: 'missing slow-cooker recipe' },
  ])('rejects confirmation with $label', async ({ rule }) => {
    mockAffected([
      { seq: 1, kind: 'settings', id: 'settings', value: { diners: [], hardRestrictions: [], scheduleExceptions: [{ id: 'night1', date: '2026-09-27', ...rule }] } },
      { seq: 2, kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Pasta', active: true } },
    ], [{ mealId: 'm1', count: '0', sum: '0', hasRecipe: false }])
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 0, idempotencyKey: 'capacity', changes: [
        { kind: 'plan', id: 'p1', value: { id: 'p1', confirmed: true } },
        { kind: 'slot', id: 's1', planId: 'p1', position: 0, value: { id: 's1', date: '2026-09-27', mealId: 'm1' } },
      ],
    }) }))
    expect(response.status).toBe(400)
  })

  it('allows a valid linked leftover on a hands-off night', async () => {
    mockAffected([
      { seq: 1, kind: 'settings', id: 'settings', value: { diners: [], hardRestrictions: [], scheduleExceptions: [{ id: 'night1', date: '2026-09-28', handsOff: true }] } },
      { seq: 2, kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Pasta', active: true, plannedLeftoverDinner: true, recipeIds: ['r1'] } },
      { seq: 3, kind: 'recipe', id: 'r1', value: { id: 'r1', title: 'Pasta' } },
    ], [{ mealId: 'm1', recipeId: 'r1', count: '0', sum: '0', hasRecipe: false }, { mealId: 'm1', count: '0', sum: '0', hasRecipe: false }])
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 0, idempotencyKey: 'leftover-night', changes: [
        { kind: 'plan', id: 'p1', value: { id: 'p1', confirmed: true } },
        { kind: 'slot', id: 's1', planId: 'p1', position: 0, value: { id: 's1', date: '2026-09-27', mealId: 'm1', recipeId: 'r1' } },
        { kind: 'slot', id: 's2', planId: 'p1', position: 1, value: { id: 's2', date: '2026-09-28', mealId: 'm1', leftoverFromSlotId: 's1' } },
      ],
    }) }))
    expect(response.status).toBe(200)
  })

  it.each([
    { label: 'two targets from one source', links: ['s1', 's1'] },
    { label: 'a leftover consumer as source', links: ['s1', 's2'] },
  ])('rejects confirmation of $label', async ({ links }) => {
    mockAffected([{ seq: 1, kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Pasta', active: true, plannedLeftoverDinner: true } }],
      [{ mealId: 'm1', count: '0', sum: '0', hasRecipe: false }])
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 0, idempotencyKey: 'invalid-leftovers', changes: [
        { kind: 'plan', id: 'p1', value: { id: 'p1', confirmed: true } },
        { kind: 'slot', id: 's1', planId: 'p1', position: 0, value: { id: 's1', date: '2026-09-27', mealId: 'm1' } },
        { kind: 'slot', id: 's2', planId: 'p1', position: 1, value: { id: 's2', date: '2026-09-28', mealId: 'm1', leftoverFromSlotId: links[0] } },
        { kind: 'slot', id: 's3', planId: 'p1', position: 2, value: { id: 's3', date: '2026-09-29', mealId: 'm1', leftoverFromSlotId: links[1] } },
      ],
    }) }))
    expect(response.status).toBe(400)
    expect(rpc.mock.calls.some(([name]) => name === 'write_household_records')).toBe(false)
  })

  it.each([
    { label: 'no explicit leftover intent', planned: false, targetDate: '2026-09-28' },
    { label: 'a source on the target date', planned: true, targetDate: '2026-09-27' },
  ])('rejects a planned leftover with $label', async ({ planned, targetDate }) => {
    mockAffected([{ seq: 1, kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Pasta', active: true, ...(planned && { plannedLeftoverDinner: true }) } }],
      [{ mealId: 'm1', count: '0', sum: '0', hasRecipe: false }])
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 0, idempotencyKey: 'invalid-source', changes: [
        { kind: 'plan', id: 'p1', value: { id: 'p1', confirmed: true } },
        { kind: 'slot', id: 's1', planId: 'p1', position: 0, value: { id: 's1', date: '2026-09-27', mealId: 'm1' } },
        { kind: 'slot', id: 's2', planId: 'p1', position: 1, value: { id: 's2', date: targetDate, mealId: 'm1', leftoverFromSlotId: 's1' } },
      ],
    }) }))
    expect(response.status).toBe(400)
  })

  it('rejects changing the date of an existing confirmed slot', async () => {
    mockAffected([
      { seq: 1, kind: 'plan', id: 'p1', value: { id: 'p1', confirmed: true } },
      { seq: 2, kind: 'slot', id: 's1', planId: 'p1', position: 0, value: { id: 's1', date: '2026-09-27', mealId: 'm1' } },
      { seq: 3, kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Pasta', active: true } },
    ])
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 0, idempotencyKey: 'move-date', changes: [
        { kind: 'slot', id: 's1', planId: 'p1', position: 0, value: { id: 's1', date: '2026-09-28', mealId: 'm1' } },
      ],
    }) }))
    expect(response.status).toBe(400)
  })

  it('allows one request to release a lot and reserve it for another plan', async () => {
    mockAffected([
      { seq: 1, kind: 'plan', id: 'p1', value: { id: 'p1', confirmed: true } },
      { seq: 2, kind: 'plan', id: 'p2', value: { id: 'p2', confirmed: true } },
      { seq: 3, kind: 'slot', id: 's1', planId: 'p1', position: 0, value: { id: 's1', date: '2026-09-27', mealId: 'm1', leftoverLotIds: ['lot1'] } },
      { seq: 4, kind: 'slot', id: 's2', planId: 'p2', position: 0, value: { id: 's2', date: '2026-09-28', mealId: 'm1' } },
      { seq: 5, kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Pasta', active: true } },
      { seq: 6, kind: 'leftover-lot', id: 'lot1', value: { id: 'lot1', sourceMealId: 'm1', dinnerCoverage: 'one' } },
    ], [{ mealId: 'm1', count: '0', sum: '0', hasRecipe: false }])
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 0, idempotencyKey: 'transfer-lot', changes: [
        { kind: 'slot', id: 's1', planId: 'p1', position: 0, value: { id: 's1', date: '2026-09-27', mealId: 'm1' } },
        { kind: 'repair', id: 'repair1', planId: 'p1', position: 0, value: { id: 'repair1', createdAt: '2026-09-27T18:00:00Z', slotId: 's1', kind: 'recovery' } },
        { kind: 'slot', id: 's2', planId: 'p2', position: 0, value: { id: 's2', date: '2026-09-28', mealId: 'm1', leftoverLotIds: ['lot1'] } },
        { kind: 'repair', id: 'repair2', planId: 'p2', position: 0, value: { id: 'repair2', createdAt: '2026-09-27T18:00:00Z', slotId: 's2', kind: 'leftovers', leftoverLotId: 'lot1' } },
      ],
    }) }))
    expect(response.status).toBe(200)
    expect(rpc.mock.calls.at(-1)?.[0]).toBe('write_household_records')
  })

  it('rejects replacement of an existing outcome', async () => {
    rpc.mockResolvedValue({ data: { status: 200, revision: 3, records: [{
      seq: 1, kind: 'outcome', id: 'o1', value: { id: 'o1', acceptance: 'accepted' },
    }], nextCursor: null }, error: null })
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 3, idempotencyKey: 'replace', changes: [{ kind: 'outcome', id: 'o1', value: { id: 'o1', acceptance: 'rejected' } }],
    }) }))
    expect(response.status).toBe(400)
    expect(rpc.mock.calls.some(([name]) => name === 'write_household_records')).toBe(false)
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
    expect(rpc.mock.calls.some(([name]) => name === 'write_household_records')).toBe(false)
  })

  it('rejects a second correction of the same outcome', async () => {
    rpc.mockImplementation((name: string, args: { p_incoming?: unknown[] }) => name === 'check_household_record_changes'
      ? Promise.resolve({ data: { status: 400 }, error: null })
      : name === 'read_household_dependencies'
      ? Promise.resolve({ data: { status: 200, revision: 2, records: args.p_incoming?.length ? [
        { seq: 1, kind: 'outcome', id: 'o1', value: { id: 'o1', acceptance: 'accepted' } },
        { seq: 2, kind: 'outcome', id: 'o2', value: { id: 'o2', correctionOfOutcomeId: 'o1', acceptance: 'rejected' } },
      ] : [], nextCursor: null }, error: null })
      : Promise.reject(new Error('unexpected write')))
    const response = await handler.fetch(new Request('https://dinner.example/api/records', { method: 'POST', headers, body: JSON.stringify({
      householdId, expectedRevision: 2, idempotencyKey: 'fork', changes: [{ kind: 'outcome', id: 'o3', value: { id: 'o3', correctionOfOutcomeId: 'o1', acceptance: 'neutral' } }],
    }) }))
    expect(response.status).toBe(400)
    expect(rpc.mock.calls.some(([name]) => name === 'write_household_records')).toBe(false)
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
      if (name === 'check_household_record_changes') return Promise.resolve({ data: { status: 400 }, error: null })
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
    expect(rpc.mock.calls.some(([name]) => name === 'check_household_record_changes')).toBe(true)
    expect(rpc.mock.calls.some(([name, args]) => name === 'read_household_dependencies' && args.p_incoming?.length)).toBe(false)
  })

  it('accepts an atomic completed-dinner takeout correction with append-only evidence', async () => {
    const existing = [
      { seq: 1, kind: 'plan', id: 'p1', value: { id: 'p1', confirmed: true } },
      { seq: 2, kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Pasta', active: true } },
      { seq: 3, kind: 'slot', id: 's1', planId: 'p1', position: 0, value: { id: 's1', date: '2026-09-27', mealId: 'm1', dinnerReadyAt: '2026-09-27T18:00:00Z' } },
      { seq: 4, kind: 'outcome', id: 'o1', value: { id: 'o1', planId: 'p1', planSlotId: 's1', mealId: 'm1', acceptance: 'accepted' } },
    ]
    rpc.mockImplementation((name: string, args: { p_keys?: Array<{ kind: string; id: string }>; p_incoming?: Array<{ kind: string; id: string }>; p_plan_ids?: string[] }) => name === 'read_household_dependencies'
      ? (args.p_incoming?.length ? Promise.reject(new Error('outcome history hydrated')) : Promise.resolve({ data: { status: 200, revision: 4, records: existing.filter((row) => args.p_keys?.some((key) => key.kind === row.kind && key.id === row.id)
        || (row.kind === 'slot' && args.p_plan_ids?.includes(row.planId ?? ''))
        ), nextCursor: null }, error: null }))
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
    expect(rpc.mock.calls.filter(([name]) => name === 'read_household_dependencies').length).toBeLessThanOrEqual(4)
  })
})
