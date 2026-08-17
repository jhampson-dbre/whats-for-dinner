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
const scheduleExceptionSchema = z.object({ id, date, note: text.optional() }).strict()
const adaptationSchema = z.object({ id, name: shortText, mealId: id.optional(), recipeId: id.optional() }).strict()

const mealSchema = z.object({
  id, name: shortText, active: z.boolean(), provisional: z.boolean().optional(),
  safetyReview: z.enum(['unknown', 'approved', 'rejected']).optional(),
  recipeIds: z.array(id).max(50).optional(), adaptations: z.array(adaptationSchema).max(50).optional(), recoveryMealIds: z.array(id).max(50).optional(),
}).strict()
const recipeSchema = z.object({
  id, title: importedText, externalId: importedText.optional(), mealId: id.optional(), source: z.object({ provider: importedText, reference: importedText.optional() }).strict().optional(),
  category: importedText.optional(), prepMinutes: minutes.optional(), cookMinutes: minutes.optional(), yield: importedText.optional(),
  servings: z.number().int().positive().max(100).optional(), ingredients: importedList.optional(), instructions: importedList.optional(), preparationNotes: text.optional(),
}).strict()
const planSlotSchema = z.object({
  id, date, mealId: id.optional(), recipeId: id.optional(), leftoverLotIds: z.array(id).max(50).optional(), leftoverDependencyIds: z.array(id).max(50).optional(),
  cookingStartedAt: timestamp.optional(), dinnerReadyAt: timestamp.optional(), feedbackEligibleAt: timestamp.optional(), feedbackDismissed: z.boolean().optional(),
}).strict()
const planVariantSchema = z.object({ id, label: shortText, mealId: id.optional(), recipeId: id.optional() }).strict()
const repairRevisionSchema = z.object({ id, createdAt: timestamp, reason: text.optional() }).strict()
const planSchema = z.object({
  id, slots: z.array(planSlotSchema).max(31), confirmed: z.boolean().optional(), variants: z.array(planVariantSchema).max(100).optional(), scoreReasons: z.array(text).max(50).optional(), repairRevisions: z.array(repairRevisionSchema).max(100).optional(),
}).strict()
const leftoverLotSchema = z.object({
  id, sourcePlanId: id.optional(), sourceSlotId: id.optional(), sourceMealId: id.optional(), dinnerCoverage: z.enum(['none', 'some', 'one', 'more-than-one']).optional(),
}).strict()
const outcomeSchema = z.object({
  id, planId: id.optional(), planSlotId: id.optional(), mealId: id.optional(), recipeId: id.optional(), correctionOfOutcomeId: id.optional(), recordedAt: timestamp.optional(), cookingStartedAt: timestamp.optional(), dinnerReadyAt: timestamp.optional(), availability: z.enum(['unknown', 'available', 'unavailable']).optional(), acceptance: z.enum(['unknown', 'accepted', 'rejected', 'neutral']).optional(), leftoverCoverage: z.enum(['none', 'some', 'one', 'more-than-one']).optional(), recoveryClassification: z.enum(['none', 'successful', 'unsuccessful']).optional(),
}).strict()

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

export const appStateV1Schema = z.object({
  schemaVersion: z.literal(1),
  household: z.object({ diners: z.array(dinerSchema).max(20), hardRestrictions: z.array(restrictionSchema).max(50), scheduleExceptions: z.array(scheduleExceptionSchema).max(100) }).strict(),
  meals: z.array(mealSchema).max(500), recipes: z.array(recipeSchema).max(1_000), plans: z.array(planSchema).max(100), leftoverLots: z.array(leftoverLotSchema).max(500), outcomes: z.array(outcomeSchema).max(2_000),
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
  const outcomes = new Set(state.outcomes.map(({ id: value }) => value))
  const slots = new Set(state.plans.flatMap(({ slots: values }) => values.map(({ id: value }) => value)))
  const requireReference = (exists: boolean, path: (string | number)[], label: string) => { if (!exists) referenceIssue(ctx, path, label) }

  state.household.hardRestrictions.forEach((value, index) => { if (value.dinerId) requireReference(diners.has(value.dinerId), ['household', 'hardRestrictions', index, 'dinerId'], 'diner') })
  state.recipes.forEach((value, index) => { if (value.mealId) requireReference(meals.has(value.mealId), ['recipes', index, 'mealId'], 'meal') })
  state.meals.forEach((value, index) => {
    value.recipeIds?.forEach((ref, refIndex) => requireReference(recipes.has(ref), ['meals', index, 'recipeIds', refIndex], 'recipe'))
    value.adaptations?.forEach((adaptation, adaptationIndex) => {
      if (adaptation.mealId) requireReference(meals.has(adaptation.mealId), ['meals', index, 'adaptations', adaptationIndex, 'mealId'], 'meal')
      if (adaptation.recipeId) requireReference(recipes.has(adaptation.recipeId), ['meals', index, 'adaptations', adaptationIndex, 'recipeId'], 'recipe')
    })
    value.recoveryMealIds?.forEach((ref, refIndex) => requireReference(meals.has(ref), ['meals', index, 'recoveryMealIds', refIndex], 'meal'))
  })
  state.plans.forEach((plan, planIndex) => plan.slots.forEach((slot, slotIndex) => {
    if (slot.mealId) requireReference(meals.has(slot.mealId), ['plans', planIndex, 'slots', slotIndex, 'mealId'], 'meal')
    if (slot.recipeId) requireReference(recipes.has(slot.recipeId), ['plans', planIndex, 'slots', slotIndex, 'recipeId'], 'recipe')
    slot.leftoverLotIds?.forEach((ref, refIndex) => requireReference(leftovers.has(ref), ['plans', planIndex, 'slots', slotIndex, 'leftoverLotIds', refIndex], 'leftover lot'))
    slot.leftoverDependencyIds?.forEach((ref, refIndex) => requireReference(leftovers.has(ref), ['plans', planIndex, 'slots', slotIndex, 'leftoverDependencyIds', refIndex], 'leftover lot'))
  }))
  state.plans.forEach((plan, planIndex) => plan.variants?.forEach((variant, variantIndex) => {
    if (variant.mealId) requireReference(meals.has(variant.mealId), ['plans', planIndex, 'variants', variantIndex, 'mealId'], 'meal')
    if (variant.recipeId) requireReference(recipes.has(variant.recipeId), ['plans', planIndex, 'variants', variantIndex, 'recipeId'], 'recipe')
  }))
  state.leftoverLots.forEach((value, index) => {
    if (value.sourcePlanId) requireReference(plans.has(value.sourcePlanId), ['leftoverLots', index, 'sourcePlanId'], 'plan')
    if (value.sourceSlotId) requireReference(slots.has(value.sourceSlotId), ['leftoverLots', index, 'sourceSlotId'], 'plan slot')
    if (value.sourceMealId) requireReference(meals.has(value.sourceMealId), ['leftoverLots', index, 'sourceMealId'], 'meal')
  })
  state.outcomes.forEach((value, index) => {
    if (value.planId) requireReference(plans.has(value.planId), ['outcomes', index, 'planId'], 'plan')
    if (value.planSlotId) requireReference(slots.has(value.planSlotId), ['outcomes', index, 'planSlotId'], 'plan slot')
    if (value.mealId) requireReference(meals.has(value.mealId), ['outcomes', index, 'mealId'], 'meal')
    if (value.recipeId) requireReference(recipes.has(value.recipeId), ['outcomes', index, 'recipeId'], 'recipe')
    if (value.correctionOfOutcomeId) requireReference(outcomes.has(value.correctionOfOutcomeId), ['outcomes', index, 'correctionOfOutcomeId'], 'outcome')
  })
})

export type AppStateV1 = z.infer<typeof appStateV1Schema>
