import { replanRemainingWeek, type ReplanState } from './weeklyPlan'

type Slot = { id: string; date: string; mealId?: string; recipeId?: string; dinnerReadyAt?: string; leftoverFromSlotId?: string; leftoverLotIds?: string[] }
type Plan = { id: string; confirmed?: boolean; slots: Slot[] }
export type RepairChoice = { slotId: string; kind: 'simpler' | 'swap' | 'leftovers' | 'recovery' | 'takeout'; swapSlotId?: string; leftoverLotId?: string; adaptationId?: string; mealId?: string; recipeId?: string; reason?: string; takeoutContext?: 'planned' | 'unforeseeable-disruption' | 'predictable-planning-or-acceptance-failure' }
export type RepairPreview = { plan: Plan; changedSlotIds: string[]; choice: RepairChoice; leftoverLots: ReplanState['leftoverLots']; revisionDrafts: Array<{ slotId: string; kind: RepairChoice['kind'] }>; releasedLotIds: string[]; consumedLotIds: string[]; perishableRisks: Array<{ itemId?: string; sourceSlotId?: string; sourceLine: string }> }

export function previewRepair(state: ReplanState, plan: Plan, choice: RepairChoice): RepairPreview {
  const slot = plan.slots.find((item) => item.id === choice.slotId)
  if (!slot) throw new Error('Unknown plan slot.')
  const action = choice.kind === 'simpler' ? { kind: 'simpler' as const, recipeId: choice.recipeId ?? '', adaptationId: choice.adaptationId ?? '' }
    : choice.kind === 'swap' ? { kind: 'swap' as const, otherDate: plan.slots.find((item) => item.id === choice.swapSlotId)?.date ?? '' }
      : choice.kind === 'leftovers' ? { kind: 'leftovers' as const, leftoverLotId: choice.leftoverLotId ?? '' }
        : choice.kind === 'recovery' ? { kind: 'recovery' as const, mealId: choice.mealId ?? '' }
          : choice.kind === 'takeout' ? { kind: 'takeout' as const, takeoutContext: choice.takeoutContext ?? 'planned' }
            : { kind: 'replan' as const }
  const result = replanRemainingWeek(state, { kind: 'repair', planId: plan.id, targetDate: slot.date, action })
  if (result.kind !== 'repair') throw new Error(result.nextStep)
  return { plan: result.plan, changedSlotIds: result.changedSlotIds, choice, leftoverLots: result.leftoverLots, revisionDrafts: result.revisionDrafts.map((draft) => ({ ...draft, kind: draft.kind === 'replan' ? 'recovery' : draft.kind })), releasedLotIds: result.releasedLotIds, consumedLotIds: result.consumedLotIds, perishableRisks: result.perishableRisks }
}

export function missingLeftoverDependencies(plan: Plan, sourceSlotId: string): string[] {
  return plan.slots.filter((slot) => slot.leftoverFromSlotId === sourceSlotId && !slot.dinnerReadyAt).map((slot) => slot.id)
}

export function adaptSharedMeal(input: { dinerId?: string; issue?: string; name: string; solvesIssue: boolean; coordinatedCooking: boolean; secondEntree: boolean; unplannedProtein: boolean; separateTimeline: boolean; extraEffort: boolean }): { valid: boolean; reason?: string } {
  if (!input.dinerId || !input.issue) return { valid: false, reason: 'Choose a diner and issue first.' }
  if (!input.solvesIssue) return { valid: false, reason: 'The adaptation does not solve the recorded issue.' }
  if (!input.coordinatedCooking || input.secondEntree || input.separateTimeline) return { valid: false, reason: 'An adaptation keeps one coordinated cooking session.' }
  if (input.unplannedProtein) return { valid: false, reason: 'An adaptation cannot require an unplanned non-staple protein.' }
  if (input.extraEffort) return { valid: false, reason: 'Choose a simpler shared-meal adjustment.' }
  return { valid: true }
}
