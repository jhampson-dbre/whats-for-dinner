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

  it('restores surrounding whitespace exactly', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-1', name: ' Tacos ', active: true })
    const raw = JSON.stringify(state)
    const storage = { getItem: () => raw } as unknown as Storage

    expect(importAppState(raw)).toEqual(state)
    expect(loadAppState(storage)).toEqual({ kind: 'ready', state })
  })
})
