import { describe, expect, it } from 'vitest'
import {
  APP_STATE_STORAGE_KEY,
  createEmptyAppState,
  importAppState,
  loadAppState,
  migrateV1ToV2,
  migrateV2ToV3,
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
  it('migrates V2 directly to V3, preserving legacy fields and deriving leftover servings', () => {
    const v2 = { ...createEmptyAppState(), schemaVersion: 2 as const }
    v2.meals.push({ id: 'meal-1', name: 'Soup', active: true })
    v2.plans.push({ id: 'plan-1', slots: [{ id: 'source', date: '2026-08-17', mealId: 'meal-1' }, { id: 'target', date: '2026-08-18', mealId: 'meal-1', leftoverFromSlotId: 'source' }] } as never)
    v2.outcomes.push({ id: 'outcome-1', planId: 'plan-1', planSlotId: 'target', mealId: 'meal-1', acceptance: 'accepted' })

    expect(migrateV2ToV3(v2)).toMatchObject({ schemaVersion: 3, outcomes: [expect.objectContaining({ leftoverServing: true })] })
  })
  it('migrates every valid V1 field, removing only provisional meal flags', () => {
    const v1 = { ...createEmptyAppState(), schemaVersion: 1 as const, household: { diners: [{ id: 'diner-1', name: 'Ava', active: true }], hardRestrictions: [{ id: 'restriction-1', label: 'Peanuts', dinerId: 'diner-1' }], scheduleExceptions: [{ id: 'exception-1', date: '2026-08-17', constrained: true }] }, meals: [{ id: 'true', name: 'True', active: true, provisional: true, safetyReview: 'approved' as const }, { id: 'false', name: 'False', active: true, provisional: false, safetyReview: 'rejected' as const }, { id: 'absent', name: 'Absent', active: true, safetyReview: 'unknown' as const }] }

    expect(migrateV1ToV2(v1)).toEqual({ ...v1, schemaVersion: 2, meals: [{ id: 'true', name: 'True', active: true, safetyReview: 'approved' }, { id: 'false', name: 'False', active: true, safetyReview: 'rejected' }, { id: 'absent', name: 'Absent', active: true, safetyReview: 'unknown' }] })
  })

  it('saves and restores a complete V2 document', () => {
    const storage = storageWith()
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-1', name: 'Tacos', active: true })

    expect(saveAppState(storage, state)).toEqual({ saved: true })
    expect(loadAppState(storage)).toEqual({ kind: 'ready', state })
  })

  it('restores cooking and delayed-feedback fields after reload', () => {
    const storage = storageWith()
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-1', name: 'Tacos', active: true })
    state.plans.push({ id: 'plan-1', confirmed: true, slots: [{ id: 'slot-1', date: '2026-08-17', mealId: 'meal-1', cookingStartedAt: '2026-08-17T17:00:00.000Z', dinnerReadyAt: '2026-08-17T17:25:00.000Z', feedbackEligibleAt: '2026-08-17T17:55:00.000Z', feedbackDismissed: true }] } as never)

    expect(saveAppState(storage, state)).toEqual({ saved: true })
    expect(loadAppState(storage)).toMatchObject({ kind: 'ready', state: { plans: [expect.objectContaining({ slots: [expect.objectContaining({ feedbackEligibleAt: '2026-08-17T17:55:00.000Z', feedbackDismissed: true })] })] } })
  })

  it.each(['{broken', JSON.stringify({ schemaVersion: 1 }), JSON.stringify({ schemaVersion: 2 })])(
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
    expect(importAppState(JSON.stringify({ ...imported, schemaVersion: 1 }))).toEqual(imported)
    expect(() => importAppState('{"schemaVersion":1}')).toThrow()
  })

  it('migrates V1 once on load, preserves the old raw on write failure, and reloads V2 directly', () => {
    const v1 = { ...createEmptyAppState(), schemaVersion: 1 as const, meals: [{ id: 'meal-1', name: 'Tacos', active: true, provisional: true }] }
    const raw = JSON.stringify(v1)
    const storage = storageWith(raw)

    expect(loadAppState(storage)).toEqual({ kind: 'ready', state: migrateV2ToV3(migrateV1ToV2(v1)) })
    expect(JSON.parse(storage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toEqual(migrateV2ToV3(migrateV1ToV2(v1)))
    expect(loadAppState(storage)).toEqual({ kind: 'ready', state: migrateV2ToV3(migrateV1ToV2(v1)) })

    const failing = storageWith(raw)
    failing.setItem = () => { throw new Error('quota exceeded') }
    expect(loadAppState(failing)).toEqual({ kind: 'ready', state: migrateV2ToV3(migrateV1ToV2(v1)), unsaved: true })
    expect(failing.getItem(APP_STATE_STORAGE_KEY)).toBe(raw)
  })

  it('keeps future versions in unsupported recovery', () => {
    const raw = JSON.stringify({ schemaVersion: 4 })
    expect(loadAppState(storageWith(raw))).toEqual({ kind: 'recovery', raw, reason: 'unsupported-version' })
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
