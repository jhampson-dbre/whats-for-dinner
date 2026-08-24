import { describe, expect, it } from 'vitest'
import { createEmptyAppState, importAppState, loadAppState, APP_STATE_STORAGE_KEY } from './storage'
import { appStateV2Schema, appStateV3Schema } from './schema'

describe('V1 state validation', () => {
  it('rejects an explicit leftover-serving outcome outside a leftover consumer slot', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-1', name: 'Soup', active: true })
    state.plans.push({ id: 'plan-1', slots: [{ id: 'slot-1', date: '2026-08-17', mealId: 'meal-1' }] } as never)
    state.outcomes.push({ id: 'outcome-1', planId: 'plan-1', planSlotId: 'slot-1', mealId: 'meal-1', leftoverServing: true } as never)

    expect(() => importAppState(JSON.stringify(state))).toThrow('Leftover serving')
  })
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

  it('rejects a meal recipe link that contradicts the recipe owner', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-1', name: 'Soup', active: true, recipeIds: ['recipe-1'] }, { id: 'meal-2', name: 'Pasta', active: true })
    state.recipes.push({ id: 'recipe-1', title: 'Soup', mealId: 'meal-2' })

    expect(() => importAppState(JSON.stringify(state))).toThrow('Recipe belongs to another meal')
  })

  it('rejects a recipe listed by more than one meal', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-1', name: 'Soup', active: true, recipeIds: ['recipe-1'] }, { id: 'meal-2', name: 'Pasta', active: true, recipeIds: ['recipe-1'] })
    state.recipes.push({ id: 'recipe-1', title: 'Dinner' })

    expect(() => importAppState(JSON.stringify(state))).toThrow('Recipe belongs to more than one meal')
  })

  it('allows unlinked, recipe-sided, meal-sided, and matching two-sided recipe ownership', () => {
    const state = createEmptyAppState()
    state.meals.push(
      { id: 'recipe-sided', name: 'Recipe-sided', active: true },
      { id: 'meal-sided', name: 'Meal-sided', active: true, recipeIds: ['meal-sided-recipe'] },
      { id: 'two-sided', name: 'Two-sided', active: true, recipeIds: ['two-sided-recipe'] },
    )
    state.recipes.push(
      { id: 'unlinked-recipe', title: 'Unlinked' },
      { id: 'recipe-sided-recipe', title: 'Recipe-sided', mealId: 'recipe-sided' },
      { id: 'meal-sided-recipe', title: 'Meal-sided' },
      { id: 'two-sided-recipe', title: 'Two-sided', mealId: 'two-sided' },
    )

    expect(importAppState(JSON.stringify(state))).toEqual(state)
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

  it('rejects shopping references to unknown meals', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-1', name: 'Soup', active: true })
    state.plans.push({ id: 'plan-1', confirmed: true, slots: [{ id: 'slot-1', date: '2026-08-17', mealId: 'meal-1' }], shopping: { confirmedAt: '2026-08-16T00:00:00.000Z', partial: true, skippedIncompleteMealIds: ['missing-meal'], items: [{ label: '1 cup tomatoes', sourceLines: ['1 cup tomatoes'], mealIds: ['meal-1'], perishable: false, availability: 'available' }] } } as never)

    expect(() => importAppState(JSON.stringify(state))).toThrow('Unknown meal reference')
    state.plans[0].shopping!.skippedIncompleteMealIds = ['meal-1']
    state.plans[0].shopping!.items[0].mealIds = ['missing-meal']
    expect(() => importAppState(JSON.stringify(state))).toThrow('Unknown meal reference')
  })

  it('allows historical confirmed recipe drift but rejects unconfirmed drift and a repair slot from another plan', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-1', name: 'Soup', active: true }, { id: 'meal-2', name: 'Pasta', active: true })
    state.recipes.push({ id: 'recipe-1', title: 'Soup', mealId: 'meal-2' })
    state.plans.push({ id: 'plan-1', confirmed: true, slots: [{ id: 'slot-1', date: '2026-08-17', mealId: 'meal-1', recipeId: 'recipe-1' }] } as never, { id: 'plan-2', slots: [{ id: 'slot-2', date: '2026-08-18', mealId: 'meal-2' }] } as never)

    expect(() => importAppState(JSON.stringify(state))).not.toThrow()
    state.plans[0].confirmed = false
    expect(() => importAppState(JSON.stringify(state))).toThrow('Unknown recipe associated with slot meal reference')
    state.plans[0].confirmed = true
    state.plans[1].repairRevisions = [{ id: 'repair-1', createdAt: '2026-08-16T00:00:00.000Z', slotId: 'slot-1', kind: 'takeout' }]
    expect(() => importAppState(JSON.stringify(state))).toThrow('Unknown plan slot reference')
  })

  it('restores surrounding whitespace exactly', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-1', name: ' Tacos ', active: true })
    const raw = JSON.stringify(state)
    const storage = { getItem: () => raw } as unknown as Storage

    expect(importAppState(raw)).toEqual(state)
    expect(loadAppState(storage)).toEqual({ kind: 'ready', state })
  })

  it('allows a takeout dinner to be ready without cooking while preserving the cooking invariant', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-1', name: 'Tacos', active: true })
    state.plans.push({ id: 'plan-1', slots: [{ id: 'slot-1', date: '2026-08-17', mealId: 'meal-1', dinnerReadyAt: '2026-08-17T18:00:00.000Z' }] } as never)
    expect(() => importAppState(JSON.stringify(state))).toThrow()
    state.plans[0].slots[0] = { ...state.plans[0].slots[0], cookingStartedAt: '2026-08-17T18:30:00.000Z' } as never
    expect(() => importAppState(JSON.stringify(state))).toThrow()
    state.plans[0].slots[0] = { ...state.plans[0].slots[0], cookingStartedAt: '2026-08-17T17:30:00.000Z' } as never
    state.outcomes.push({ id: 'old', planId: 'plan-1', planSlotId: 'slot-1', mealId: 'meal-1' }, { id: 'fork-a', planId: 'plan-1', planSlotId: 'slot-1', mealId: 'meal-1', correctionOfOutcomeId: 'old' }, { id: 'fork-b', planId: 'plan-1', planSlotId: 'slot-1', mealId: 'meal-1', correctionOfOutcomeId: 'old' })
    expect(() => importAppState(JSON.stringify(state))).toThrow()
    state.outcomes = []
    state.plans[0].slots[0] = { id: 'takeout', date: '2026-08-18', dinnerReadyAt: '2026-08-18T18:00:00.000Z' } as never
    expect(importAppState(JSON.stringify(state))).toEqual(state)
  })

  it('allows a non-adjacent planned-leftover dinner to be ready without cooking', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-1', name: 'Soup', active: true })
    state.plans.push({ id: 'plan-1', slots: [{ id: 'source', date: '2026-08-17', mealId: 'meal-1' }, { id: 'normal', date: '2026-08-18', mealId: 'meal-1' }, { id: 'target', date: '2026-08-19', mealId: 'meal-1', leftoverFromSlotId: 'source', dinnerReadyAt: '2026-08-19T18:00:00.000Z' }] } as never)
    expect(importAppState(JSON.stringify(state))).toEqual(state)
  })

  it('keeps inactive lots and leftover outcomes valid after their completed dinners are corrected to takeout', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-1', name: 'Soup', active: true })
    state.plans.push({ id: 'plan-1', slots: [{ id: 'source', date: '2026-08-17', dinnerReadyAt: '2026-08-17T18:00:00.000Z' }, { id: 'target', date: '2026-08-18', dinnerReadyAt: '2026-08-18T18:00:00.000Z' }] } as never)
    state.leftoverLots.push({ id: 'lot-1', sourcePlanId: 'plan-1', sourceSlotId: 'source', sourceMealId: 'meal-1', active: false })
    state.outcomes.push({ id: 'source-old', planId: 'plan-1', planSlotId: 'source', mealId: 'meal-1' } as never, { id: 'source-correction', planId: 'plan-1', planSlotId: 'source', correctionOfOutcomeId: 'source-old' } as never, { id: 'target-old', planId: 'plan-1', planSlotId: 'target', mealId: 'meal-1', leftoverServing: true } as never, { id: 'target-correction', planId: 'plan-1', planSlotId: 'target', correctionOfOutcomeId: 'target-old' } as never)

    expect(importAppState(JSON.stringify(state))).toEqual(state)
  })

  it('keeps actual-leftover dinner-ready exemption V3-only', () => {
    const actualLotDinner = (schemaVersion: 2 | 3) => ({ schemaVersion, household: { diners: [], hardRestrictions: [], scheduleExceptions: [] }, meals: [{ id: 'meal-1', name: 'Soup', active: true }], recipes: [], plans: [{ id: 'plan-1', slots: [{ id: 'source', date: '2026-08-17', mealId: 'meal-1' }, { id: 'target', date: '2026-08-18', mealId: 'meal-1', leftoverLotIds: ['lot-1'], dinnerReadyAt: '2026-08-18T18:00:00.000Z' }] }], leftoverLots: [{ id: 'lot-1', sourcePlanId: 'plan-1', sourceSlotId: 'source', sourceMealId: 'meal-1', active: true }], outcomes: [] })

    expect(appStateV2Schema.safeParse(actualLotDinner(2)).success).toBe(false)
    expect(appStateV3Schema.safeParse(actualLotDinner(3)).success).toBe(true)
  })

  it('rejects outcome and leftover references that disagree with their source slot', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-1', name: 'Soup', active: true }, { id: 'meal-2', name: 'Tacos', active: true })
    state.recipes.push({ id: 'recipe-1', title: 'Soup', mealId: 'meal-1' }, { id: 'recipe-2', title: 'Tacos', mealId: 'meal-2' })
    state.plans.push({ id: 'plan-1', slots: [{ id: 'slot-1', date: '2026-08-17', mealId: 'meal-1', recipeId: 'recipe-1' }] }, { id: 'plan-2', slots: [{ id: 'slot-2', date: '2026-08-18', mealId: 'meal-2', recipeId: 'recipe-2' }] })
    state.outcomes.push({ id: 'outcome-1', planId: 'plan-1', planSlotId: 'slot-2', mealId: 'meal-2', recipeId: 'recipe-2' })
    expect(() => importAppState(JSON.stringify(state))).toThrow()
    state.outcomes[0] = { id: 'outcome-1', planId: 'plan-1', planSlotId: 'slot-1', mealId: 'meal-2', recipeId: 'recipe-2' }
    expect(() => importAppState(JSON.stringify(state))).toThrow()
    state.outcomes.length = 0
    state.leftoverLots.push({ id: 'lot-1', sourcePlanId: 'plan-1', sourceSlotId: 'slot-2', sourceMealId: 'meal-2' })
    expect(() => importAppState(JSON.stringify(state))).toThrow()
    state.leftoverLots[0] = { id: 'lot-1', sourcePlanId: 'plan-1', sourceSlotId: 'slot-1', sourceMealId: 'meal-2' }
    expect(() => importAppState(JSON.stringify(state))).toThrow()
  })
})
