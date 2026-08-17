import { describe, expect, it } from 'vitest'
import { buildGroceryList } from './grocery'

describe('buildGroceryList', () => {
  it('uses only the current confirmed plan, merges direct unit aliases, retains source lines, and exposes incomplete meals', () => {
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
    })

    expect(list.complete).toBe(false)
    expect(list.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '2 cups tomatoes', sourceLines: ['1 cup Tomatoes', '1 cups tomatoes'] }),
      expect.objectContaining({ label: '3 tbsp olive oil', sourceLines: ['2 tbsp olive oil', '1 tablespoon olive oil'] }),
    ]))
    expect(list.items.some((item) => item.label.includes('old flour'))).toBe(false)
    expect(list.incompleteMeals).toEqual([{ mealId: 'missing', mealName: 'Missing meal' }])
  })

  it('keeps ambiguous ingredient lines separate', () => {
    const list = buildGroceryList({ meals: [{ id: 'meal', name: 'Meal' }], recipes: [{ id: 'recipe', mealId: 'meal', ingredients: ['to taste salt', 'salt'] }], plans: [{ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'meal', recipeId: 'recipe' }] }] })

    expect(list.items.map((item) => item.label)).toEqual(['to taste salt', 'salt'])
  })

  it('does not buy recipe ingredients again for a planned-leftover slot', () => {
    const list = buildGroceryList({ meals: [{ id: 'chili', name: 'Chili' }], recipes: [{ id: 'recipe', mealId: 'chili', ingredients: ['1 cup beans'] }], plans: [{ id: 'plan', confirmed: true, slots: [{ id: 'cook', date: '2026-08-17', mealId: 'chili', recipeId: 'recipe' }, { id: 'leftovers', date: '2026-08-18', mealId: 'chili', recipeId: 'recipe', leftoverFromSlotId: 'cook' }] }] })

    expect(list.items).toEqual([expect.objectContaining({ label: '1 cup beans', mealIds: ['chili'] })])
  })
})
