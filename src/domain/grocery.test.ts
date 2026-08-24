import { describe, expect, it } from 'vitest'
import { buildGroceryList, unavailableShoppingTargets } from './grocery'

describe('buildGroceryList', () => {
  it('uses the selected confirmed plan, merges direct unit aliases, retains source lines, and exposes incomplete meals', () => {
    const list = buildGroceryList({
      meals: [{ id: 'soup', name: 'Soup' }, { id: 'toast', name: 'Toast' }, { id: 'old', name: 'Old meal' }, { id: 'missing', name: 'Missing meal' }],
      recipes: [
        { id: 'soup-recipe', mealId: 'soup', ingredients: ['1 cup Tomatoes', '2 tbsp olive oil'] },
        { id: 'toast-recipe', mealId: 'toast', ingredients: ['1 cups tomatoes', '1 tablespoon olive oil'] },
        { id: 'old-recipe', mealId: 'old', ingredients: ['99 cups old flour'] },
      ],
      plans: [
        { id: 'old-plan', confirmed: true, slots: [{ id: 'old-slot', date: '2026-08-01', mealId: 'old', recipeId: 'old-recipe' }] },
        { id: 'plan', confirmed: true, slots: [{ id: 'soup-slot', date: '2026-08-17', mealId: 'soup', recipeId: 'soup-recipe' }, { id: 'toast-slot', date: '2026-08-18', mealId: 'toast', recipeId: 'toast-recipe' }, { id: 'missing-slot', date: '2026-08-19', mealId: 'missing' }] },
      ],
    }, 'plan')

    expect(list.complete).toBe(false)
    expect(list.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '2 cups tomatoes', sourceLines: ['1 cup Tomatoes', '1 cups tomatoes'], sourceSlotIds: ['soup-slot', 'toast-slot'] }),
      expect.objectContaining({ label: '3 tbsp olive oil', sourceLines: ['2 tbsp olive oil', '1 tablespoon olive oil'] }),
    ]))
    expect(list.items.some((item) => item.label.includes('old flour'))).toBe(false)
    expect(list.incompleteMeals).toEqual([{ mealId: 'missing', mealName: 'Missing meal' }])
  })

  it('keeps ambiguous ingredient lines separate', () => {
    const list = buildGroceryList({ meals: [{ id: 'meal', name: 'Meal' }], recipes: [{ id: 'recipe', mealId: 'meal', ingredients: ['to taste salt', 'salt'] }], plans: [{ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'meal', recipeId: 'recipe' }] }] }, 'plan')

    expect(list.items.map((item) => item.label)).toEqual(['to taste salt', 'salt'])
  })

  it('does not buy recipe ingredients again for a planned-leftover slot', () => {
    const list = buildGroceryList({ meals: [{ id: 'chili', name: 'Chili' }], recipes: [{ id: 'recipe', mealId: 'chili', ingredients: ['1 cup beans'] }], plans: [{ id: 'plan', confirmed: true, slots: [{ id: 'cook', date: '2026-08-17', mealId: 'chili', recipeId: 'recipe' }, { id: 'leftovers', date: '2026-08-18', mealId: 'chili', recipeId: 'recipe', leftoverFromSlotId: 'cook' }] }] }, 'plan')

    expect(list.items).toEqual([expect.objectContaining({ label: '1 cup beans', mealIds: ['chili'] })])
  })
  it('returns an empty list for an unknown or unconfirmed selected plan', () => {
    const state = { meals: [{ id: 'meal', name: 'Meal' }], recipes: [{ id: 'recipe', mealId: 'meal', ingredients: ['1 cup beans'] }], plans: [{ id: 'draft', confirmed: false, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'meal', recipeId: 'recipe' }] }] }

    expect(buildGroceryList(state, 'missing').items).toEqual([])
    expect(buildGroceryList(state, 'draft').items).toEqual([])
  })

  it('targets every unfinished aligned source, and conservatively falls back when provenance is stale', () => {
    const state = { meals: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], recipes: [{ id: 'ra', mealId: 'a', ingredients: ['1 cup tomatoes'] }, { id: 'rb', mealId: 'b', ingredients: ['1 cups tomatoes'] }], plans: [{ id: 'plan', confirmed: true, slots: [{ id: 'a-slot', date: '2026-08-17', mealId: 'a', recipeId: 'ra' }, { id: 'b-slot', date: '2026-08-18', mealId: 'b', recipeId: 'rb' }] }] }
    const item = { availability: 'unavailable', sourceLines: ['1 cup tomatoes', '1 cups tomatoes'], sourceSlotIds: ['a-slot', 'b-slot'] }
    expect(unavailableShoppingTargets(state, 'plan', item)).toEqual(['a-slot', 'b-slot'])
    expect(unavailableShoppingTargets(state, 'plan', { ...item, sourceSlotIds: ['missing'] })).toEqual(['a-slot', 'b-slot'])
  })

  it('uses legacy exact raw-line matching but never targets a completed slot', () => {
    const state = { meals: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], recipes: [{ id: 'ra', mealId: 'a', ingredients: ['salt to taste'] }, { id: 'rb', mealId: 'b', ingredients: ['  SALT   TO taste '] }], plans: [{ id: 'plan', confirmed: true, slots: [{ id: 'done', date: '2026-08-17', mealId: 'a', recipeId: 'ra', dinnerReadyAt: '2026-08-17T18:00:00.000Z' }, { id: 'open', date: '2026-08-18', mealId: 'b', recipeId: 'rb' }] }] }
    expect(unavailableShoppingTargets(state, 'plan', { availability: 'unavailable', sourceLines: ['salt to taste'] })).toEqual(['open'])
  })

  it('scales only parsed known-unit quantities and marks each unchanged raw row', () => {
    const list = buildGroceryList({ meals: [{ id: 'meal', name: 'Meal' }], recipes: [{ id: 'recipe', mealId: 'meal', leftoverQuantityMultiplier: 1.5 as const, ingredients: ['1.2 cups beans', 'salt to taste'] }], plans: [{ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'meal', recipeId: 'recipe' }] }] }, 'plan')
    expect(list.items).toEqual(expect.arrayContaining([expect.objectContaining({ label: '1.8 cups beans' }), expect.objectContaining({ label: 'salt to taste', manualQuantityAdjustment: true })]))
  })
})
