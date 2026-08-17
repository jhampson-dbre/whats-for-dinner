import { describe, expect, it } from 'vitest'
import { createEmptyAppState, importAppState, loadAppState, APP_STATE_STORAGE_KEY } from './storage'

describe('V1 state validation', () => {
  it('rejects malformed required records', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-1' } as never)

    expect(() => importAppState(JSON.stringify(state))).toThrow()
  })

  it('rejects dangling references during load without overwriting the document', () => {
    const state = createEmptyAppState()
    state.recipes.push({ id: 'recipe-1', title: 'Soup', mealId: 'missing-meal' } as never)
    const raw = JSON.stringify(state)
    const storage = {
      getItem: () => raw,
      setItem: () => { throw new Error('must not write') },
    } as unknown as Storage

    expect(loadAppState(storage)).toMatchObject({ kind: 'recovery', raw })
    expect(storage.getItem(APP_STATE_STORAGE_KEY)).toBe(raw)
  })

  it('rejects duplicate recipe IDs even when a meal refers to that ID', () => {
    const state = createEmptyAppState()
    state.recipes.push({ id: 'recipe-1', title: 'Soup' }, { id: 'recipe-1', title: 'Stew' })
    state.meals.push({ id: 'meal-1', name: 'Dinner', active: true, recipeIds: ['recipe-1'] })

    expect(() => importAppState(JSON.stringify(state))).toThrow()
  })

  it('rejects duplicate plan-slot IDs without replacing saved state', () => {
    const saved = createEmptyAppState()
    saved.meals.push({ id: 'saved-meal', name: 'Saved', active: true })
    const raw = JSON.stringify(saved)
    const imported = createEmptyAppState()
    imported.plans.push({
      id: 'plan-1',
      slots: [
        { id: 'slot-1', date: '2026-08-16' },
        { id: 'slot-1', date: '2026-08-17' },
      ],
    })
    const storage = {
      getItem: () => raw,
      setItem: () => { throw new Error('must not write') },
    } as unknown as Storage

    expect(() => importAppState(JSON.stringify(imported))).toThrow()
    expect(loadAppState(storage)).toEqual({ kind: 'ready', state: saved })
  })

  it('allows planned-leftover references only to earlier slots in the same plan', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-1', name: 'Soup', active: true })
    state.plans.push({ id: 'plan-1', slots: [
      { id: 'slot-1', date: '2026-08-17', mealId: 'meal-1' },
      { id: 'slot-2', date: '2026-08-18', mealId: 'meal-1', leftoverFromSlotId: 'slot-1' },
    ] } as never)

    expect(importAppState(JSON.stringify(state))).toEqual(state)
    state.plans[0].slots[1] = { ...state.plans[0].slots[1], leftoverFromSlotId: 'missing-slot' } as never
    expect(() => importAppState(JSON.stringify(state))).toThrow()
    state.plans[0].slots[1] = { ...state.plans[0].slots[1], leftoverFromSlotId: 'slot-2' } as never
    expect(() => importAppState(JSON.stringify(state))).toThrow()
    state.plans[0].slots[1] = { ...state.plans[0].slots[1], leftoverFromSlotId: 'slot-1' } as never
    state.plans.push({ id: 'plan-2', slots: [{ id: 'slot-3', date: '2026-08-19', mealId: 'meal-1', leftoverFromSlotId: 'slot-1' }] } as never)
    expect(() => importAppState(JSON.stringify(state))).toThrow()
  })

  it('persists shopping confirmation item availability and repair context', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-1', name: 'Soup', active: true })
    state.plans.push({ id: 'plan-1', confirmed: true, slots: [{ id: 'slot-1', date: '2026-08-17', mealId: 'meal-1' }], shopping: { confirmedAt: '2026-08-16T00:00:00.000Z', items: [{ label: '1 cup tomatoes', sourceLines: ['1 cup tomatoes'], mealIds: ['meal-1'], perishable: true, availability: 'unavailable' }] }, repairRevisions: [{ id: 'repair-1', createdAt: '2026-08-16T00:00:00.000Z', slotId: 'slot-1', kind: 'takeout', reason: 'Power outage', takeoutContext: 'unforeseeable-disruption' }] } as never)

    expect(importAppState(JSON.stringify(state))).toMatchObject({ plans: expect.arrayContaining([expect.objectContaining({ shopping: expect.objectContaining({ items: expect.arrayContaining([expect.objectContaining({ availability: 'unavailable' })]) }), repairRevisions: expect.arrayContaining([expect.objectContaining({ kind: 'takeout' })]) })]) })
  })

  it('restores surrounding whitespace exactly', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-1', name: ' Tacos ', active: true })
    const raw = JSON.stringify(state)
    const storage = { getItem: () => raw } as unknown as Storage

    expect(importAppState(raw)).toEqual(state)
    expect(loadAppState(storage)).toEqual({ kind: 'ready', state })
  })
})
