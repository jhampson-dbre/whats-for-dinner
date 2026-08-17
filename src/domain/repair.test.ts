import { describe, expect, it } from 'vitest'
import { adaptSharedMeal, missingLeftoverDependencies, previewRepair } from './repair'

const plan = { id: 'plan', confirmed: true, slots: [
  { id: 'done', date: '2026-08-17', mealId: 'pasta', dinnerReadyAt: '2026-08-17T18:00:00.000Z' },
  { id: 'target', date: '2026-08-18', mealId: 'tacos' },
  { id: 'future', date: '2026-08-19', mealId: 'soup' },
] }

describe('repair', () => {
  it('swaps two unfinished slots without mutating until applied', () => {
    const repair = previewRepair(plan, { slotId: 'target', kind: 'swap', swapSlotId: 'future' })
    expect(repair.changedSlotIds).toEqual(['target', 'future'])
    expect(repair.plan.slots).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'done', mealId: 'pasta' }), expect.objectContaining({ id: 'future', mealId: 'tacos' })]))
    expect(plan.slots[1].mealId).toBe('tacos')
    expect(repair.plan.slots.find((slot) => slot.id === 'target')?.mealId).toBe('soup')
  })

  it('rejects a completed slot and invalid shared-meal adaptations', () => {
    expect(() => previewRepair(plan, { slotId: 'done', kind: 'swap', mealId: 'soup' })).toThrow('completed')
    expect(adaptSharedMeal({ dinerId: 'ava', issue: 'spice', name: 'Mild seasoning', solvesIssue: true, coordinatedCooking: true, secondEntree: false, unplannedProtein: false, separateTimeline: false, extraEffort: false })).toMatchObject({ valid: true })
    expect(adaptSharedMeal({ dinerId: 'ava', issue: 'spice', name: 'Separate chicken', solvesIssue: true, coordinatedCooking: false, secondEntree: true, unplannedProtein: true, separateTimeline: true, extraEffort: true })).toMatchObject({ valid: false })
  })

  it('flags only future slots that depend on missing leftovers', () => {
    const dependent = { ...plan, slots: [{ ...plan.slots[0] }, { ...plan.slots[1], leftoverFromSlotId: 'done' }, plan.slots[2]] }
    expect(missingLeftoverDependencies(dependent, 'done')).toEqual(['target'])
  })

  it('clears a stale recipe when replacing a meal and links selected leftovers', () => {
    const recipePlan = { ...plan, slots: [{ ...plan.slots[0] }, { ...plan.slots[1], recipeId: 'taco-recipe' }, plan.slots[2]] }
    expect(previewRepair(recipePlan, { slotId: 'target', kind: 'recovery', mealId: 'soup' }).plan.slots.find((slot) => slot.id === 'target')).toMatchObject({ mealId: 'soup', recipeId: undefined })
    expect(previewRepair(recipePlan, { slotId: 'target', kind: 'leftovers', mealId: 'soup', leftoverLotId: 'lot-1' }).plan.slots.find((slot) => slot.id === 'target')).toMatchObject({ mealId: 'soup', recipeId: undefined, leftoverLotIds: ['lot-1'] })
  })
})
