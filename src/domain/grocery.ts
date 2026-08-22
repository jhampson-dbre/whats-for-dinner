type Meal = { id: string; name: string }
type Recipe = { id: string; mealId?: string; ingredients?: string[] }
type Slot = { id: string; date: string; mealId?: string; recipeId?: string; leftoverFromSlotId?: string }
type Plan = { id: string; confirmed?: boolean; slots: Slot[] }
type GroceryState = { meals: Meal[]; recipes: Recipe[]; plans: Plan[] }

export type GroceryItem = { id: string; label: string; sourceLines: string[]; sourceSlotIds: string[]; mealIds: string[] }
export type GroceryList = { items: GroceryItem[]; incompleteMeals: { mealId: string; mealName: string }[]; complete: boolean }

const unitAliases: Record<string, string> = { cup: 'cup', cups: 'cup', tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp', oz: 'oz', ounce: 'oz', ounces: 'oz', lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb' }

function parsed(line: string): { quantity: number; unit: string; ingredient: string } | undefined {
  const match = line.trim().match(/^(\d+(?:\.\d+)?)\s+([a-zA-Z]+)\s+(.+)$/)
  if (!match) return undefined
  const unit = unitAliases[match[2].toLowerCase()]
  const ingredient = match[3].trim().toLowerCase().replace(/\s+/g, ' ')
  return unit && ingredient ? { quantity: Number(match[1]), unit, ingredient } : undefined
}

export function normalizedIngredientLine(line: string): string {
  const value = parsed(line)
  return value ? `${value.unit}:${value.ingredient}` : `raw:${line.trim().toLowerCase().replace(/\s+/g, ' ')}`
}

export function recipeUsesUnavailableIngredient(recipe: { ingredients?: string[] } | undefined, items: Array<{ availability: string; sourceLines: string[] }>): boolean {
  const unavailable = new Set(items.filter((item) => item.availability === 'unavailable').flatMap((item) => item.sourceLines.map(normalizedIngredientLine)))
  return recipe?.ingredients?.some((line) => unavailable.has(normalizedIngredientLine(line))) ?? false
}

function plural(unit: string, quantity: number): string {
  return quantity === 1 ? unit : unit === 'tbsp' ? 'tbsp' : `${unit}s`
}

export function buildGroceryList(state: GroceryState, planId: string): GroceryList {
  const plan = state.plans.find((item) => item.id === planId && item.confirmed)
  if (!plan) return { items: [], incompleteMeals: [], complete: true }
  const items: GroceryItem[] = []
  const merged = new Map<string, { quantity: number; item: GroceryItem }>()
  const incompleteMeals: GroceryList['incompleteMeals'] = []
  for (const slot of plan.slots) {
    if (slot.leftoverFromSlotId) continue
    const meal = state.meals.find((item) => item.id === slot.mealId)
    if (!meal) continue
    const recipe = state.recipes.find((item) => item.id === slot.recipeId) ?? state.recipes.find((item) => item.mealId === meal.id)
    if (!recipe?.ingredients?.length) { incompleteMeals.push({ mealId: meal.id, mealName: meal.name }); continue }
    for (const [lineIndex, sourceLine] of recipe.ingredients.entries()) {
      const value = parsed(sourceLine)
      if (!value) { items.push({ id: `${slot.id}:${lineIndex}`, label: sourceLine, sourceLines: [sourceLine], sourceSlotIds: [slot.id], mealIds: [meal.id] }); continue }
      const key = `${value.unit}:${value.ingredient}`
      const existing = merged.get(key)
      if (existing) { existing.quantity += value.quantity; existing.item.sourceLines.push(sourceLine); existing.item.sourceSlotIds.push(slot.id); if (!existing.item.mealIds.includes(meal.id)) existing.item.mealIds.push(meal.id); existing.item.label = `${existing.quantity} ${plural(value.unit, existing.quantity)} ${value.ingredient}` }
      else { const item = { id: `${slot.id}:${lineIndex}`, label: `${value.quantity} ${plural(value.unit, value.quantity)} ${value.ingredient}`, sourceLines: [sourceLine], sourceSlotIds: [slot.id], mealIds: [meal.id] }; merged.set(key, { quantity: value.quantity, item }); items.push(item) }
    }
  }
  return { items, incompleteMeals: incompleteMeals.filter((item, index, all) => all.findIndex((other) => other.mealId === item.mealId) === index), complete: incompleteMeals.length === 0 }
}
