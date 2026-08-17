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
})
