import { z } from 'zod'

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const nonBlank = (max: number) => z.string().min(1).max(max).refine((value) => value.trim().length > 0)
const text = nonBlank(500)
const shortText = nonBlank(160)
const importedText = nonBlank(1024)
const importedItem = nonBlank(2048)
const importedList = z.array(importedItem).max(500).superRefine((items, context) => {
  if (items.reduce((total, item) => total + item.length, 0) > 128 * 1024) context.addIssue({ code: 'custom', message: 'Imported text is too large.' })
})
const date = z.iso.date()
const timestamp = z.string().datetime({ offset: true }).refine((value) => value.endsWith('Z'))
const minutes = z.number().int().min(0).max(10_080)

const dinerSchema = z.object({ id, name: shortText, active: z.boolean() }).strict()
const restrictionSchema = z.object({ id, label: shortText, dinerId: id.optional() }).strict()
const scheduleExceptionSchema = z.object({ id, date, note: text.optional(), constrained: z.boolean().optional() }).strict()
const v4ScheduleExceptionSchema = scheduleExceptionSchema.extend({ handsOff: z.literal(true).optional() })
const adaptationSchema = z.object({ id, name: shortText, mealId: id.optional(), recipeId: id.optional(), dinerId: id.optional(), issue: text.optional(), solvesIssue: z.literal(true).optional(), coordinatedCooking: z.literal(true).optional(), noSecondEntree: z.literal(true).optional(), noUnplannedProtein: z.literal(true).optional(), noSeparateTimeline: z.literal(true).optional(), noExtraEffort: z.literal(true).optional() }).strict()

const mealSchema = z.object({
  id, name: shortText, active: z.boolean(), provisional: z.boolean().optional(),
  safetyReview: z.enum(['unknown', 'approved', 'rejected']).optional(), plannedLeftoverDinner: z.boolean().optional(),
  recipeIds: z.array(id).max(50).optional(), adaptations: z.array(adaptationSchema).max(50).optional(), recoveryMealIds: z.array(id).max(50).optional(),
}).strict()
const recipeSchema = z.object({
  id, title: importedText, externalId: importedText.optional(), mealId: id.optional(), source: z.object({ provider: importedText, reference: importedText.optional() }).strict().optional(),
  category: importedText.optional(), prepMinutes: minutes.optional(), cookMinutes: minutes.optional(), yield: importedText.optional(),
  servings: z.number().int().positive().max(100).optional(), ingredients: importedList.optional(), instructions: importedList.optional(), preparationNotes: text.optional(),
}).strict()
const v3RecipeSchema = recipeSchema.extend({ leftoverQuantityMultiplier: z.union([z.literal(1.5), z.literal(2)]).optional() })
const v4RecipeSchema = v3RecipeSchema.extend({ handsOffSlowCooker: z.literal(true).optional() })
const planSlotSchema = z.object({
  id, date, mealId: id.optional(), recipeId: id.optional(), leftoverLotIds: z.array(id).max(50).optional(), leftoverDependencyIds: z.array(id).max(50).optional(), leftoverFromSlotId: id.optional(),
  score: z.number().min(0).max(100).optional(), confidence: z.enum(['Estimated', 'Learning', 'Established']).optional(), scoreReasons: z.array(text).max(20).optional(),
  cookingStartedAt: timestamp.optional(), dinnerReadyAt: timestamp.optional(), feedbackEligibleAt: timestamp.optional(), feedbackDismissed: z.boolean().optional(), expectedDinerIds: z.array(id).max(20).optional(),
}).strict()
const planVariantSchema = z.object({ id, label: shortText, mealId: id.optional(), recipeId: id.optional() }).strict()
const shoppingItemId = z.string().min(1).max(128)
const shoppingSchema = z.object({ confirmedAt: timestamp, items: z.array(z.object({ id: shoppingItemId.optional(), label: importedText, sourceLines: importedList, mealIds: z.array(id).max(50), perishable: z.boolean(), availability: z.enum(['available', 'unavailable', 'skipped']) }).strict()).max(1_000), skippedIncompleteMealIds: z.array(id).max(500).default([]), partial: z.boolean().default(false) }).strict()
const v3ShoppingSchema = z.object({ confirmedAt: timestamp, items: z.array(z.object({ id: shoppingItemId.optional(), label: importedText, sourceLines: importedList, sourceSlotIds: z.array(id).max(500).optional(), mealIds: z.array(id).max(50), perishable: z.boolean(), availability: z.enum(['available', 'unavailable', 'skipped']) }).strict()).max(1_000), skippedIncompleteMealIds: z.array(id).max(500).default([]), partial: z.boolean().default(false) }).strict()
const repairRevisionSchema = z.object({ id, createdAt: timestamp, slotId: id.optional(), kind: z.enum(['simpler', 'swap', 'leftovers', 'recovery', 'takeout']).optional(), leftoverLotId: id.optional(), adaptationId: id.optional(), perishableDisposition: z.literal('acknowledged-preservation-risk').optional(), reason: text.optional(), takeoutContext: z.enum(['planned', 'unforeseeable-disruption', 'predictable-planning-or-acceptance-failure']).optional() }).strict()
const planSchema = z.object({
  id, slots: z.array(planSlotSchema).max(31), confirmed: z.boolean().optional(), variants: z.array(planVariantSchema).max(100).optional(), scoreReasons: z.array(text).max(50).optional(), shopping: shoppingSchema.optional(), repairRevisions: z.array(repairRevisionSchema).max(100).optional(),
}).strict()
const v3PlanSchema = planSchema.extend({ shopping: v3ShoppingSchema.optional() })
const leftoverLotSchema = z.object({
  id, sourcePlanId: id.optional(), sourceSlotId: id.optional(), sourceMealId: id.optional(), dinnerCoverage: z.enum(['none', 'some', 'one', 'more-than-one']).optional(), active: z.boolean().optional(),
}).strict()
const personFeedbackSchema = z.object({ dinerId: id, acceptance: z.enum(['accepted', 'rejected', 'neutral']), neutralReason: z.enum(['absent', 'ate-separately', 'not-hungry']).optional() }).strict()
const outcomeSchema = z.object({
  id, planId: id.optional(), planSlotId: id.optional(), mealId: id.optional(), recipeId: id.optional(), correctionOfOutcomeId: id.optional(), recordedAt: timestamp.optional(), cookingStartedAt: timestamp.optional(), dinnerReadyAt: timestamp.optional(), activeEffortMinutes: minutes.optional(), availability: z.enum(['unknown', 'available', 'unavailable']).optional(), acceptance: z.enum(['unknown', 'accepted', 'rejected', 'neutral']).optional(), personFeedback: z.array(personFeedbackSchema).max(20).optional(), leftoverCoverage: z.enum(['none', 'some', 'one', 'more-than-one']).optional(), recoveryClassification: z.enum(['none', 'successful', 'unsuccessful']).optional(),
}).strict()
const v3OutcomeSchema = outcomeSchema.extend({ leftoverServing: z.literal(true).optional() })

function referenceIssue(ctx: z.RefinementCtx, path: (string | number)[], label: string): void {
  ctx.addIssue({ code: 'custom', path, message: `Unknown ${label} reference.` })
}

function duplicateIds(ctx: z.RefinementCtx, values: { id: string; path: (string | number)[] }[]): void {
  const seen = new Set<string>()
  values.forEach((value) => {
    if (seen.has(value.id)) ctx.addIssue({ code: 'custom', path: value.path, message: 'Duplicate ID.' })
    seen.add(value.id)
  })
}

const appStateSchema = (schemaVersion: 1 | 2 | 3 | 4, recipe = recipeSchema, plan = planSchema, outcome = outcomeSchema, scheduleException = scheduleExceptionSchema) => z.object({
  schemaVersion: z.literal(schemaVersion),
  household: z.object({ diners: z.array(dinerSchema).max(20), hardRestrictions: z.array(restrictionSchema).max(50), scheduleExceptions: z.array(scheduleException).max(100) }).strict(),
  meals: z.array(mealSchema).max(500), recipes: z.array(recipe).max(1_000), plans: z.array(plan).max(100), leftoverLots: z.array(leftoverLotSchema).max(500), outcomes: z.array(outcome).max(2_000),
}).strict().superRefine((state, ctx) => {
  duplicateIds(ctx, state.household.diners.map((value, index) => ({ id: value.id, path: ['household', 'diners', index] })))
  duplicateIds(ctx, state.household.hardRestrictions.map((value, index) => ({ id: value.id, path: ['household', 'hardRestrictions', index] })))
  duplicateIds(ctx, state.household.scheduleExceptions.map((value, index) => ({ id: value.id, path: ['household', 'scheduleExceptions', index] })))
  duplicateIds(ctx, state.meals.map((value, index) => ({ id: value.id, path: ['meals', index] })))
  duplicateIds(ctx, state.recipes.map((value, index) => ({ id: value.id, path: ['recipes', index] })))
  duplicateIds(ctx, state.plans.map((value, index) => ({ id: value.id, path: ['plans', index] })))
  duplicateIds(ctx, state.leftoverLots.map((value, index) => ({ id: value.id, path: ['leftoverLots', index] })))
  duplicateIds(ctx, state.outcomes.map((value, index) => ({ id: value.id, path: ['outcomes', index] })))
  duplicateIds(ctx, state.plans.flatMap((plan, planIndex) => plan.slots.map((value, slotIndex) => ({ id: value.id, path: ['plans', planIndex, 'slots', slotIndex] }))))
  duplicateIds(ctx, state.meals.flatMap((meal, mealIndex) => meal.adaptations?.map((value, adaptationIndex) => ({ id: value.id, path: ['meals', mealIndex, 'adaptations', adaptationIndex] })) ?? []))
  duplicateIds(ctx, state.plans.flatMap((plan, planIndex) => plan.variants?.map((value, variantIndex) => ({ id: value.id, path: ['plans', planIndex, 'variants', variantIndex] })) ?? []))
  duplicateIds(ctx, state.plans.flatMap((plan, planIndex) => plan.repairRevisions?.map((value, revisionIndex) => ({ id: value.id, path: ['plans', planIndex, 'repairRevisions', revisionIndex] })) ?? []))
  const diners = new Set(state.household.diners.map(({ id: value }) => value))
  const meals = new Set(state.meals.map(({ id: value }) => value))
  const recipes = new Set(state.recipes.map(({ id: value }) => value))
  const plans = new Set(state.plans.map(({ id: value }) => value))
  const leftovers = new Set(state.leftoverLots.map(({ id: value }) => value))
  const adaptations = new Set(state.meals.flatMap((meal) => meal.adaptations?.map(({ id: value }) => value) ?? []))
  const slots = new Set(state.plans.flatMap(({ slots: values }) => values.map(({ id: value }) => value)))
  const slotRecords = state.plans.flatMap((plan) => plan.slots.map((slot) => ({ plan, slot })))
  const recipeMealIds = new Map<string, string>()
  const requireReference = (exists: boolean, path: (string | number)[], label: string) => { if (!exists) referenceIssue(ctx, path, label) }

  state.household.hardRestrictions.forEach((value, index) => { if (value.dinerId) requireReference(diners.has(value.dinerId), ['household', 'hardRestrictions', index, 'dinerId'], 'diner') })
  state.recipes.forEach((value, index) => { if (value.mealId) requireReference(meals.has(value.mealId), ['recipes', index, 'mealId'], 'meal') })
  state.meals.forEach((value, index) => {
    value.recipeIds?.forEach((ref, refIndex) => {
      requireReference(recipes.has(ref), ['meals', index, 'recipeIds', refIndex], 'recipe')
      const ownerMealId = recipeMealIds.get(ref)
      if (ownerMealId && ownerMealId !== value.id) ctx.addIssue({ code: 'custom', path: ['meals', index, 'recipeIds', refIndex], message: 'Recipe belongs to more than one meal.' })
      else recipeMealIds.set(ref, value.id)
      if (state.recipes.some((recipe) => recipe.id === ref && recipe.mealId && recipe.mealId !== value.id)) ctx.addIssue({ code: 'custom', path: ['meals', index, 'recipeIds', refIndex], message: 'Recipe belongs to another meal.' })
    })
    value.adaptations?.forEach((adaptation, adaptationIndex) => {
      if (adaptation.mealId) requireReference(meals.has(adaptation.mealId), ['meals', index, 'adaptations', adaptationIndex, 'mealId'], 'meal')
      if (adaptation.recipeId) requireReference(recipes.has(adaptation.recipeId), ['meals', index, 'adaptations', adaptationIndex, 'recipeId'], 'recipe')
      if (adaptation.dinerId) requireReference(diners.has(adaptation.dinerId), ['meals', index, 'adaptations', adaptationIndex, 'dinerId'], 'diner')
    })
    value.recoveryMealIds?.forEach((ref, refIndex) => requireReference(meals.has(ref), ['meals', index, 'recoveryMealIds', refIndex], 'meal'))
  })
  state.plans.forEach((plan, planIndex) => plan.slots.forEach((slot, slotIndex) => {
    if (slot.mealId) requireReference(meals.has(slot.mealId), ['plans', planIndex, 'slots', slotIndex, 'mealId'], 'meal')
    if (slot.recipeId) requireReference(recipes.has(slot.recipeId), ['plans', planIndex, 'slots', slotIndex, 'recipeId'], 'recipe')
    if (slot.recipeId && slot.mealId) requireReference(state.recipes.some((recipe) => recipe.id === slot.recipeId && (recipe.mealId === slot.mealId || state.meals.some((meal) => meal.id === slot.mealId && meal.recipeIds?.includes(recipe.id)))), ['plans', planIndex, 'slots', slotIndex, 'recipeId'], 'recipe associated with slot meal')
    if (slot.leftoverFromSlotId) requireReference(plan.slots.slice(0, slotIndex).some((value) => value.id === slot.leftoverFromSlotId), ['plans', planIndex, 'slots', slotIndex, 'leftoverFromSlotId'], 'earlier plan slot')
    slot.expectedDinerIds?.forEach((ref, refIndex) => requireReference(diners.has(ref), ['plans', planIndex, 'slots', slotIndex, 'expectedDinerIds', refIndex], 'diner'))
    if (slot.dinnerReadyAt && !slot.cookingStartedAt && !slot.leftoverFromSlotId && !(schemaVersion >= 3 && (slot.leftoverLotIds?.length || !slot.mealId))) ctx.addIssue({ code: 'custom', path: ['plans', planIndex, 'slots', slotIndex, 'dinnerReadyAt'], message: 'Dinner ready requires cooking start.' })
    if (slot.cookingStartedAt && slot.dinnerReadyAt && Date.parse(slot.dinnerReadyAt) < Date.parse(slot.cookingStartedAt)) ctx.addIssue({ code: 'custom', path: ['plans', planIndex, 'slots', slotIndex, 'dinnerReadyAt'], message: 'Dinner ready cannot precede cooking start.' })
    slot.leftoverLotIds?.forEach((ref, refIndex) => requireReference(leftovers.has(ref), ['plans', planIndex, 'slots', slotIndex, 'leftoverLotIds', refIndex], 'leftover lot'))
    slot.leftoverDependencyIds?.forEach((ref, refIndex) => requireReference(leftovers.has(ref), ['plans', planIndex, 'slots', slotIndex, 'leftoverDependencyIds', refIndex], 'leftover lot'))
  }))
  state.plans.forEach((plan, planIndex) => plan.shopping?.items.forEach((item, itemIndex) => {
    item.mealIds.forEach((ref, refIndex) => requireReference(meals.has(ref), ['plans', planIndex, 'shopping', 'items', itemIndex, 'mealIds', refIndex], 'meal'))
    const sourceSlotIds = (item as { sourceSlotIds?: string[] }).sourceSlotIds
    if (sourceSlotIds) {
      if (sourceSlotIds.length !== item.sourceLines.length) ctx.addIssue({ code: 'custom', path: ['plans', planIndex, 'shopping', 'items', itemIndex, 'sourceSlotIds'], message: 'Source slot IDs must align with source lines.' })
      sourceSlotIds.forEach((ref, refIndex) => requireReference(plan.slots.some((slot) => slot.id === ref), ['plans', planIndex, 'shopping', 'items', itemIndex, 'sourceSlotIds', refIndex], 'plan-local slot'))
    }
  }))
  state.plans.forEach((plan, planIndex) => plan.shopping?.skippedIncompleteMealIds.forEach((ref, refIndex) => requireReference(meals.has(ref), ['plans', planIndex, 'shopping', 'skippedIncompleteMealIds', refIndex], 'meal')))
  state.plans.forEach((plan, planIndex) => plan.variants?.forEach((variant, variantIndex) => {
    if (variant.mealId) requireReference(meals.has(variant.mealId), ['plans', planIndex, 'variants', variantIndex, 'mealId'], 'meal')
    if (variant.recipeId) requireReference(recipes.has(variant.recipeId), ['plans', planIndex, 'variants', variantIndex, 'recipeId'], 'recipe')
  }))
  state.plans.forEach((plan, planIndex) => plan.repairRevisions?.forEach((revision, revisionIndex) => {
    if (revision.slotId) requireReference(plan.slots.some((slot) => slot.id === revision.slotId), ['plans', planIndex, 'repairRevisions', revisionIndex, 'slotId'], 'plan slot')
    if (revision.leftoverLotId) requireReference(leftovers.has(revision.leftoverLotId), ['plans', planIndex, 'repairRevisions', revisionIndex, 'leftoverLotId'], 'leftover lot')
    if (revision.adaptationId) requireReference(adaptations.has(revision.adaptationId), ['plans', planIndex, 'repairRevisions', revisionIndex, 'adaptationId'], 'adaptation')
  }))
  state.leftoverLots.forEach((value, index) => {
    if (value.sourcePlanId) requireReference(plans.has(value.sourcePlanId), ['leftoverLots', index, 'sourcePlanId'], 'plan')
    if (value.sourceSlotId) requireReference(slots.has(value.sourceSlotId), ['leftoverLots', index, 'sourceSlotId'], 'plan slot')
    if (value.sourceMealId) requireReference(meals.has(value.sourceMealId), ['leftoverLots', index, 'sourceMealId'], 'meal')
    const source = slotRecords.find(({ slot }) => slot.id === value.sourceSlotId)
    if (value.sourcePlanId && source && source.plan.id !== value.sourcePlanId) ctx.addIssue({ code: 'custom', path: ['leftoverLots', index, 'sourceSlotId'], message: 'Source slot must belong to source plan.' })
    if (value.sourceMealId && source && source.slot.mealId !== value.sourceMealId) ctx.addIssue({ code: 'custom', path: ['leftoverLots', index, 'sourceMealId'], message: 'Source meal must match source slot.' })
  })
  state.outcomes.forEach((value, index) => {
    if (value.planId) requireReference(plans.has(value.planId), ['outcomes', index, 'planId'], 'plan')
    if (value.planSlotId) requireReference(slots.has(value.planSlotId), ['outcomes', index, 'planSlotId'], 'plan slot')
    if (value.mealId) requireReference(meals.has(value.mealId), ['outcomes', index, 'mealId'], 'meal')
    if (value.recipeId) requireReference(recipes.has(value.recipeId), ['outcomes', index, 'recipeId'], 'recipe')
    const source = slotRecords.find(({ slot }) => slot.id === value.planSlotId)
    if (value.planId && source && source.plan.id !== value.planId) ctx.addIssue({ code: 'custom', path: ['outcomes', index, 'planSlotId'], message: 'Plan slot must belong to plan.' })
    if (value.mealId && source && source.slot.mealId !== value.mealId) ctx.addIssue({ code: 'custom', path: ['outcomes', index, 'mealId'], message: 'Outcome meal must match plan slot.' })
    if (value.recipeId && source && source.slot.recipeId !== value.recipeId) ctx.addIssue({ code: 'custom', path: ['outcomes', index, 'recipeId'], message: 'Outcome recipe must match plan slot.' })
    if ((value as { leftoverServing?: true }).leftoverServing && !source?.slot.leftoverFromSlotId && !source?.slot.leftoverLotIds?.length) ctx.addIssue({ code: 'custom', path: ['outcomes', index, 'leftoverServing'], message: 'Leftover serving must reference a leftover-consumer slot.' })
    if (value.correctionOfOutcomeId) {
      const prior = state.outcomes.slice(0, index).find((outcome) => outcome.id === value.correctionOfOutcomeId)
      requireReference(Boolean(prior), ['outcomes', index, 'correctionOfOutcomeId'], 'earlier outcome')
      if (prior && (prior.planId !== value.planId || prior.planSlotId !== value.planSlotId || prior.mealId !== value.mealId)) ctx.addIssue({ code: 'custom', path: ['outcomes', index, 'correctionOfOutcomeId'], message: 'Correction must target the same plan slot and meal.' })
      if (state.outcomes.filter((outcome) => outcome.correctionOfOutcomeId === value.correctionOfOutcomeId).length > 1) ctx.addIssue({ code: 'custom', path: ['outcomes', index, 'correctionOfOutcomeId'], message: 'Outcome corrections cannot fork.' })
    }
    value.personFeedback?.forEach((feedback, feedbackIndex) => requireReference(diners.has(feedback.dinerId), ['outcomes', index, 'personFeedback', feedbackIndex, 'dinerId'], 'diner'))
  })
})

export type AppStateV1 = z.infer<typeof appStateV1Schema>
export const appStateV1Schema = appStateSchema(1)
export const appStateV2Schema = appStateSchema(2)
export type AppStateV2 = z.infer<typeof appStateV2Schema>
export const appStateV3Schema = appStateSchema(3, v3RecipeSchema, v3PlanSchema, v3OutcomeSchema)
export type AppStateV3 = z.infer<typeof appStateV3Schema>
export const appStateV4Schema = appStateSchema(4, v4RecipeSchema, v3PlanSchema, v3OutcomeSchema, v4ScheduleExceptionSchema)
export type AppStateV4 = Omit<AppStateV3, 'schemaVersion' | 'household' | 'recipes'> & { schemaVersion: 4; household: Omit<AppStateV3['household'], 'scheduleExceptions'> & { scheduleExceptions: Array<AppStateV3['household']['scheduleExceptions'][number] & { handsOff?: true }> }; recipes: Array<AppStateV3['recipes'][number] & { handsOffSlowCooker?: true }> }
