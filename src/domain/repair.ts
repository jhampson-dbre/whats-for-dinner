type Slot = { id: string; date: string; mealId?: string; recipeId?: string; dinnerReadyAt?: string; leftoverFromSlotId?: string; leftoverLotIds?: string[] }
type Plan = { id: string; confirmed?: boolean; slots: Slot[] }
export type RepairChoice = { slotId: string; kind: 'simpler' | 'swap' | 'leftovers' | 'recovery' | 'takeout'; swapSlotId?: string; leftoverLotId?: string; adaptationId?: string; mealId?: string; recipeId?: string; reason?: string; takeoutContext?: 'planned' | 'unforeseeable-disruption' | 'predictable-planning-or-acceptance-failure' }
export type RepairPreview = { plan: Plan; changedSlotIds: string[]; choice: RepairChoice }

export function previewRepair(plan: Plan, choice: RepairChoice): RepairPreview {
  const slot = plan.slots.find((item) => item.id === choice.slotId)
  if (!slot) throw new Error('Unknown plan slot.')
  if (slot.dinnerReadyAt) throw new Error('Cannot repair a completed slot.')
  if (choice.kind === 'swap') {
    const other = plan.slots.find((item) => item.id === choice.swapSlotId)
    if (!other || other.dinnerReadyAt) throw new Error('Choose another unfinished plan slot.')
    const hasLeftoverLink = (item: Slot) => Boolean(item.leftoverFromSlotId || item.leftoverLotIds?.length || plan.slots.some((candidate) => !candidate.dinnerReadyAt && candidate.leftoverFromSlotId === item.id))
    if (hasLeftoverLink(slot) || hasLeftoverLink(other)) throw new Error('Cannot swap a slot with leftover links.')
    return { plan: { ...plan, slots: plan.slots.map((item) => item.id === slot.id ? { ...item, mealId: other.mealId, recipeId: other.recipeId } : item.id === other.id ? { ...item, mealId: slot.mealId, recipeId: slot.recipeId } : item) }, changedSlotIds: [slot.id, other.id], choice }
  }
  const replacingMeal = choice.mealId !== undefined && choice.mealId !== slot.mealId
  const clearsLeftovers = replacingMeal || choice.kind === 'takeout'
  const replacement = { ...slot, ...(choice.mealId && { mealId: choice.mealId }), ...(choice.recipeId ? { recipeId: choice.recipeId } : replacingMeal || choice.kind === 'leftovers' || choice.kind === 'takeout' ? { recipeId: undefined } : {}), ...(clearsLeftovers && { leftoverLotIds: undefined, leftoverFromSlotId: undefined }), ...(choice.kind === 'leftovers' && { leftoverLotIds: choice.leftoverLotId ? [choice.leftoverLotId] : [], leftoverFromSlotId: undefined }), ...(choice.kind === 'takeout' && { mealId: undefined, recipeId: undefined, leftoverLotIds: undefined }) }
  const dependentIds = clearsLeftovers ? missingLeftoverDependencies(plan, slot.id) : []
  return { plan: { ...plan, slots: plan.slots.map((item) => item.id === slot.id ? replacement : dependentIds.includes(item.id) ? { ...item, leftoverFromSlotId: undefined, leftoverLotIds: undefined } : item) }, changedSlotIds: [slot.id, ...dependentIds], choice }
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
