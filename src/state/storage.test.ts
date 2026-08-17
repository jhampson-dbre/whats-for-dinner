import { describe, expect, it } from 'vitest'
import {
  APP_STATE_STORAGE_KEY,
  createEmptyAppState,
  importAppState,
  loadAppState,
  saveAppState,
} from './storage'

function storageWith(value: string | null = null): Storage {
  const values = new Map<string, string>()
  if (value !== null) values.set(APP_STATE_STORAGE_KEY, value)
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, next) => values.set(key, next),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size
    },
  }
}

describe('local app-state persistence', () => {
  it('saves and restores a complete V1 document', () => {
    const storage = storageWith()
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-1', name: 'Tacos', active: true })

    expect(saveAppState(storage, state)).toEqual({ saved: true })
    expect(loadAppState(storage)).toEqual({ kind: 'ready', state })
  })

  it.each(['{broken', JSON.stringify({ schemaVersion: 2 })])(
    'enters recovery for invalid stored data without overwriting it',
    (raw) => {
      const storage = storageWith(raw)

      expect(loadAppState(storage)).toMatchObject({ kind: 'recovery', raw })
      expect(storage.getItem(APP_STATE_STORAGE_KEY)).toBe(raw)
    },
  )

  it('validates an imported whole document before replacement', () => {
    const imported = createEmptyAppState()
    imported.recipes.push({ id: 'recipe-1', title: 'Soup' })
    const storage = storageWith(JSON.stringify(createEmptyAppState()))

    const replacement = importAppState(JSON.stringify(imported))
    expect(saveAppState(storage, replacement)).toEqual({ saved: true })
    expect(loadAppState(storage)).toEqual({ kind: 'ready', state: imported })
    expect(() => importAppState('{"schemaVersion":1}')).toThrow()
  })

  it('keeps the stored value when a write fails', () => {
    const raw = JSON.stringify(createEmptyAppState())
    const storage = storageWith(raw)
    storage.setItem = () => {
      throw new Error('quota exceeded')
    }

    expect(saveAppState(storage, createEmptyAppState())).toMatchObject({
      saved: false,
    })
    expect(storage.getItem(APP_STATE_STORAGE_KEY)).toBe(raw)
  })
})
