import { describe, expect, it } from 'vitest'
import { adaptSharedMeal, missingLeftoverDependencies, previewRepair } from './repair'
import { replanRemainingWeek, type ReplanState } from './weeklyPlan'

const plan = { id: 'plan', confirmed: true, slots: [
  { id: 'done', date: '2026-08-17', mealId: 'pasta', dinnerReadyAt: '2026-08-17T18:00:00.000Z' },
  { id: 'target', date: '2026-08-18', mealId: 'tacos' },
  { id: 'future', date: '2026-08-19', mealId: 'soup' },
] }
const state = (selectedPlan: typeof plan): ReplanState => ({ household: { hardRestrictions: [], scheduleExceptions: [] }, meals: [...new Set(selectedPlan.slots.flatMap((slot) => slot.mealId ? [slot.mealId] : []))].map((id) => ({ id, name: id, active: true, safetyReview: 'approved' })), recipes: [], outcomes: [], plans: [selectedPlan], leftoverLots: [{ id: 'lot-1', sourceMealId: 'soup' }] })

describe('repair', () => {
  it('delegates wrapper previews to the shared repair core', () => {
    const core = replanRemainingWeek(state(plan), { kind: 'repair', planId: 'plan', targetDate: '2026-08-18', action: { kind: 'recovery', mealId: 'soup' } })
    const wrapped = previewRepair(state(plan), plan, { slotId: 'target', kind: 'recovery', mealId: 'soup' })
    expect(core).toMatchObject({ kind: 'repair', plan: wrapped.plan, changedSlotIds: wrapped.changedSlotIds })
  })
  it('swaps two unfinished slots without mutating until applied', () => {
    const repair = previewRepair(state(plan), plan, { slotId: 'target', kind: 'swap', swapSlotId: 'future' })
    expect(repair.changedSlotIds).toEqual(['target', 'future'])
    expect(repair.plan.slots).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'done', mealId: 'pasta' }), expect.objectContaining({ id: 'future', mealId: 'tacos' })]))
    expect(plan.slots[1].mealId).toBe('tacos')
    expect(repair.plan.slots.find((slot) => slot.id === 'target')?.mealId).toBe('soup')
  })

  it('rejects a completed slot and invalid shared-meal adaptations', () => {
    expect(() => previewRepair(state(plan), plan, { slotId: 'done', kind: 'swap', mealId: 'soup' })).toThrow('unfinished')
    expect(adaptSharedMeal({ dinerId: 'ava', issue: 'spice', name: 'Mild seasoning', solvesIssue: true, coordinatedCooking: true, secondEntree: false, unplannedProtein: false, separateTimeline: false, extraEffort: false })).toMatchObject({ valid: true })
    expect(adaptSharedMeal({ dinerId: 'ava', issue: 'spice', name: 'Separate chicken', solvesIssue: true, coordinatedCooking: false, secondEntree: true, unplannedProtein: true, separateTimeline: true, extraEffort: true })).toMatchObject({ valid: false })
  })

  it('flags only future slots that depend on missing leftovers', () => {
    const dependent = { ...plan, slots: [{ ...plan.slots[0] }, { ...plan.slots[1], leftoverFromSlotId: 'done' }, plan.slots[2]] }
    expect(missingLeftoverDependencies(dependent, 'done')).toEqual(['target'])
  })

  it('clears a stale recipe when replacing a meal and links selected leftovers', () => {
    const recipePlan = { ...plan, slots: [{ ...plan.slots[0] }, { ...plan.slots[1], recipeId: 'taco-recipe' }, plan.slots[2]] }
    expect(previewRepair(state(recipePlan), recipePlan, { slotId: 'target', kind: 'recovery', mealId: 'soup' }).plan.slots.find((slot) => slot.id === 'target')).toMatchObject({ mealId: 'soup', recipeId: undefined })
    expect(previewRepair(state(recipePlan), recipePlan, { slotId: 'target', kind: 'leftovers', mealId: 'soup', leftoverLotId: 'lot-1' }).plan.slots.find((slot) => slot.id === 'target')).toMatchObject({ mealId: 'soup', recipeId: undefined, leftoverLotIds: ['lot-1'] })
  })

  it('clears target and unfinished dependent leftover links when replacing a source meal', () => {
    const dependent = { ...plan, slots: [{ ...plan.slots[0] }, { ...plan.slots[1], leftoverFromSlotId: 'done', leftoverLotIds: ['target-lot'] }, { ...plan.slots[2], leftoverFromSlotId: 'target' }] }
    const repair = previewRepair(state(dependent), dependent, { slotId: 'target', kind: 'recovery', mealId: 'pasta' })

    expect(repair.changedSlotIds).toEqual(['target', 'future'])
    expect(repair.changedSlotIds).toHaveLength(2)
    expect(repair.plan.slots.find((slot) => slot.id === 'target')).toMatchObject({ leftoverFromSlotId: undefined, leftoverLotIds: undefined })
    expect(repair.plan.slots.find((slot) => slot.id === 'future')).toMatchObject({ leftoverFromSlotId: undefined })
  })

  it('clears unfinished dependencies when confirmed leftovers keep the source meal', () => {
    const dependent = { ...plan, slots: [{ ...plan.slots[0] }, { ...plan.slots[1] }, { ...plan.slots[2], leftoverFromSlotId: 'target' }] }
    const repair = previewRepair(state(dependent), dependent, { slotId: 'target', kind: 'leftovers', mealId: 'tacos', leftoverLotId: 'lot-1' })

    expect(repair.changedSlotIds).toEqual(['target', 'future'])
    expect(repair.plan.slots.find((slot) => slot.id === 'target')).toMatchObject({ leftoverLotIds: ['lot-1'] })
    expect(repair.plan.slots.find((slot) => slot.id === 'future')).toMatchObject({ leftoverFromSlotId: undefined })
  })

  it('rejects swaps that would disturb leftover links', () => {
    const dependent = { ...plan, slots: [{ ...plan.slots[0] }, { ...plan.slots[1] }, { ...plan.slots[2], leftoverFromSlotId: 'target' }] }
    expect(() => previewRepair(state(dependent), dependent, { slotId: 'target', kind: 'swap', swapSlotId: 'future' })).toThrow('unlinked')
  })

  it('corrects a completed cooking source to takeout, replans its unfinished dependent, and deactivates produced lots', () => {
    const completed = { ...plan, slots: [{ ...plan.slots[0] }, { ...plan.slots[1], mealId: 'soup', cookingStartedAt: '2026-08-18T17:00:00.000Z', dinnerReadyAt: '2026-08-18T18:00:00.000Z' }, { ...plan.slots[2], mealId: 'soup', leftoverFromSlotId: 'target' }] }
    const repair = previewRepair({ ...state(completed), leftoverLots: [{ id: 'produced', sourceMealId: 'soup', sourcePlanId: 'plan', sourceSlotId: 'target', active: true }] }, completed, { slotId: 'target', kind: 'takeout' })

    expect(repair.plan.slots.find((slot) => slot.id === 'target')).toMatchObject({ dinnerReadyAt: '2026-08-18T18:00:00.000Z', mealId: undefined, recipeId: undefined })
    expect(repair.plan.slots.find((slot) => slot.id === 'target')).not.toHaveProperty('cookingStartedAt')
    expect(repair.plan.slots.find((slot) => slot.id === 'future')).toMatchObject({ leftoverFromSlotId: undefined })
    expect(repair.leftoverLots).toEqual([expect.objectContaining({ id: 'produced', active: false })])
  })

  it('corrects a completed leftover dinner to takeout, releases its lot, and keeps the source cooking dinner', () => {
    const completed = { ...plan, slots: [{ ...plan.slots[0], mealId: 'soup', cookingStartedAt: '2026-08-17T17:00:00.000Z', dinnerReadyAt: '2026-08-17T18:00:00.000Z' }, { ...plan.slots[1], mealId: 'soup', leftoverLotIds: ['lot-1'], dinnerReadyAt: '2026-08-18T18:00:00.000Z' }, plan.slots[2]] }
    const repair = previewRepair(state(completed), completed, { slotId: 'target', kind: 'takeout' })

    expect(repair.plan.slots.find((slot) => slot.id === 'done')).toMatchObject({ mealId: 'soup', cookingStartedAt: '2026-08-17T17:00:00.000Z' })
    expect(repair.plan.slots.find((slot) => slot.id === 'target')).toMatchObject({ dinnerReadyAt: '2026-08-18T18:00:00.000Z', leftoverLotIds: undefined })
    expect(repair.leftoverLots).toEqual([expect.objectContaining({ id: 'lot-1', active: true })])
  })

  it('requires correcting a completed dependent before its completed leftover source', () => {
    const completed = { ...plan, slots: [{ ...plan.slots[0] }, { ...plan.slots[1], cookingStartedAt: '2026-08-18T17:00:00.000Z', dinnerReadyAt: '2026-08-18T18:00:00.000Z' }, { ...plan.slots[2], leftoverFromSlotId: 'target', dinnerReadyAt: '2026-08-19T18:00:00.000Z' }] }
    expect(() => previewRepair(state(completed), completed, { slotId: 'target', kind: 'takeout' })).toThrow('Correct the completed dependent dinner first')
  })

  it('requires correcting a completed actual-leftover consumer before its source', () => {
    const completed = { ...plan, slots: [{ ...plan.slots[0] }, { ...plan.slots[1], cookingStartedAt: '2026-08-18T17:00:00.000Z', dinnerReadyAt: '2026-08-18T18:00:00.000Z' }, { ...plan.slots[2], leftoverLotIds: ['produced'], dinnerReadyAt: '2026-08-19T18:00:00.000Z' }] }
    const repairState = { ...state(completed), leftoverLots: [{ id: 'produced', sourcePlanId: 'plan', sourceSlotId: 'target', sourceMealId: 'tacos', active: true }] }
    expect(() => previewRepair(repairState, completed, { slotId: 'target', kind: 'takeout' })).toThrow('Correct the completed dependent dinner first')
  })
})
