import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import recipeFixture from './import/recipeKeeper.fixture.html?raw'
import App from './App'
import { mealLearning } from './domain/learning'
import { classifyRecovery } from './domain/outcomes'
import { APP_STATE_STORAGE_KEY, createEmptyAppState, importAppState } from './state/storage'

function backup(mealId: string) {
  const state = createEmptyAppState()
  state.meals.push({ id: mealId, name: 'Tacos', active: true })
  return JSON.stringify(state)
}

function openPlanRepair(planId = 'plan') {
  fireEvent.change(screen.getByLabelText('Plan to repair'), { target: { value: planId } })
  const dates = screen.getByLabelText('Date to repair') as HTMLSelectElement
  fireEvent.change(dates, { target: { value: dates.options[1].value } })
  fireEvent.click(screen.getByRole('button', { name: 'Plans changed' }))
}

function openShopping(planId = 'plan') {
  fireEvent.change(screen.getByLabelText('Plan for shopping'), { target: { value: planId } })
}

function openFailedLeftover(multiplier?: 1.5 | 2, recipe = true) {
  const state = createEmptyAppState()
  state.meals.push({ id: 'chili', name: 'Chili', active: true, plannedLeftoverDinner: true, ...(recipe && { recipeIds: ['chili-recipe'] }) }, { id: 'soup', name: 'Soup', active: true, recipeIds: ['soup-recipe'] })
  if (recipe) state.recipes.push({ id: 'chili-recipe', title: 'Chili', mealId: 'chili', ingredients: ['1 cup beans', 'salt to taste'], ...(multiplier && { leftoverQuantityMultiplier: multiplier }) })
  state.recipes.push({ id: 'soup-recipe', title: 'Soup', mealId: 'soup', ingredients: ['1 cup tomatoes'] })
  state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'source', date: '2026-08-17', mealId: 'chili', ...(recipe && { recipeId: 'chili-recipe' }), cookingStartedAt: '2026-08-17T17:00:00.000Z', dinnerReadyAt: '2026-08-17T18:00:00.000Z', feedbackEligibleAt: '2026-08-17T18:30:00.000Z' }, { id: 'middle', date: '2026-08-18', mealId: 'soup', recipeId: 'soup-recipe' }, { id: 'dependent', date: '2026-08-19', mealId: 'chili', ...(recipe && { recipeId: 'chili-recipe' }), leftoverFromSlotId: 'source' }], repairRevisions: [{ id: '00000000-0000-0000-0000-000000000001', createdAt: '2026-08-17T00:00:00.000Z', slotId: 'middle', kind: 'takeout', takeoutContext: 'planned' }] } as never)
  localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const view = render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }))
  return view
}

describe('backup import', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('replaces the document after confirmation and shows an unsaved write failure', async () => {
    localStorage.setItem(APP_STATE_STORAGE_KEY, backup('old-meal'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const originalSetItem = Storage.prototype.setItem
    let failWrites = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (failWrites) throw new Error('quota exceeded')
      return originalSetItem.call(this, key, value)
    })

    const { container } = render(<App />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [{ text: () => Promise.resolve(backup('new-meal')) }] } })

    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      meals: [{ id: 'new-meal' }],
    }))
    expect(screen.getByRole('status')).toHaveTextContent('Backup imported.')

    failWrites = true
    fireEvent.change(input, { target: { files: [{ text: () => Promise.resolve(backup('unsaved-meal')) }] } })

    await waitFor(() => expect(screen.getByText('Changes are not saved locally.')).toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('Loaded but not saved locally.')
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      meals: [{ id: 'new-meal' }],
    })
  })

  it('hydrates imported shopping evidence before re-confirming it', async () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, recipeIds: ['tacos-recipe'] }, { id: 'soup', name: 'Soup', active: true })
    state.recipes.push({ id: 'tacos-recipe', title: 'Tacos', mealId: 'tacos', ingredients: ['1 cup tomatoes'] })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'tacos-slot', date: '2026-08-17', mealId: 'tacos', recipeId: 'tacos-recipe' }, { id: 'soup-slot', date: '2026-08-18', mealId: 'soup' }], shopping: { confirmedAt: '2026-08-17T12:00:00.000Z', partial: true, skippedIncompleteMealIds: ['soup'], items: [{ id: 'tacos-slot:0', label: '1 cup tomatoes', sourceLines: ['1 cup tomatoes'], mealIds: ['tacos'], perishable: true, availability: 'unavailable' }] } } as never)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { container } = render(<App />)

    fireEvent.change(container.querySelector('input[accept="application/json"]')!, { target: { files: [{ text: () => Promise.resolve(JSON.stringify(state)) }] } })
    await waitFor(() => expect(screen.getByLabelText('Plan for shopping')).toBeInTheDocument())
    openShopping()
    await waitFor(() => expect(screen.getByLabelText('Unavailable 1 cup tomatoes')).toBeChecked())
    expect(screen.getByLabelText('Perishable 1 cup tomatoes')).toBeChecked()
    expect(screen.getByText('This saved shopping record is partial.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Shopping done' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].shopping).toMatchObject({ partial: true, skippedIncompleteMealIds: ['soup'], items: [{ id: 'tacos-slot:0', perishable: true, availability: 'unavailable' }] })
  })

  it('keeps the current backup when reading an import file fails', async () => {
    localStorage.setItem(APP_STATE_STORAGE_KEY, backup('old-meal'))
    const { container } = render(<App />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, { target: { files: [{ text: () => Promise.reject(new Error('read failed')) }] } })

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('That file is not a valid backup.'))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      meals: [{ id: 'old-meal' }],
    })
  })

  it('shows migrated V1 data as unsaved when its startup write fails', () => {
    const v1 = { ...createEmptyAppState(), schemaVersion: 1, meals: [{ id: 'old-meal', name: 'Tacos', active: true, provisional: true }] }
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(v1))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded') })

    render(<App />)

    expect(screen.getByText('Changes are not saved locally.')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Tacos')).toBeInTheDocument()
    expect(localStorage.getItem(APP_STATE_STORAGE_KEY)).toBe(JSON.stringify(v1))
  })

  it('keeps recovery visible when resetting malformed data cannot be saved', () => {
    localStorage.setItem(APP_STATE_STORAGE_KEY, '{broken')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded') })

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Reset saved data' }))

    expect(screen.getByRole('heading', { name: 'Saved data needs recovery' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Could not reset saved data locally.')
  })
})

describe('household onboarding and meal library', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('keeps inactive diner restrictions without constraining plans, then restores conservative review after reactivation', () => {
    const state = createEmptyAppState()
    state.household.diners.push({ id: 'ava', name: 'Ava', active: true })
    state.household.hardRestrictions.push({ id: 'peanuts', label: 'Peanuts', dinerId: 'ava' })
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'history', date: '2026-08-16', mealId: 'tacos', cookingStartedAt: '2026-08-16T17:00:00.000Z', dinnerReadyAt: '2026-08-16T17:25:00.000Z', feedbackEligibleAt: '2020-01-01T00:00:00.000Z', expectedDinerIds: ['ava'] }, { id: 'slot', date: '2026-08-17', mealId: 'tacos' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    const view = render(<App />)
    fireEvent.change(screen.getByLabelText('Diner name Ava'), { target: { value: 'Avery' } })
    fireEvent.click(screen.getByLabelText('Active Avery'))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].slots[0].expectedDinerIds).toEqual(['ava'])
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }))
    expect(screen.getByLabelText('Feedback for Avery')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start cooking Tacos' })).toBeEnabled()
    view.unmount(); const reloaded = render(<App />)
    expect(screen.getByRole('button', { name: 'Start cooking Tacos' })).toBeEnabled()
    fireEvent.click(screen.getByLabelText('Active Avery'))

    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').meals).toEqual([expect.objectContaining({ safetyReview: 'unknown' })])
    expect(screen.getByRole('button', { name: 'Review needed' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start cooking Tacos' })).toBeDisabled()
    reloaded.unmount(); const restored = render(<App />)
    expect(screen.getByRole('button', { name: 'Review needed' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove restriction Peanuts' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').household.hardRestrictions).toEqual([])
    restored.unmount(); render(<App />)
    expect(screen.queryByRole('button', { name: 'Remove restriction Peanuts' })).not.toBeInTheDocument()
  })

  it('unblocks a plan immediately when its newly added diner restriction becomes inactive', () => {
    const state = createEmptyAppState()
    state.household.diners.push({ id: 'ava', name: 'Ava', active: true })
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'tacos' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Hard restriction'), { target: { value: 'Peanuts' } })
    fireEvent.change(screen.getByLabelText('Applies to'), { target: { value: 'ava' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add restriction' }))
    expect(screen.getByRole('button', { name: 'Review needed' })).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Active Ava'))

    expect(screen.queryByRole('button', { name: 'Review needed' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start cooking Tacos' })).toBeEnabled()
  })

  it('onboards a diner, a diner restriction, and a schedule exception', () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText('Diner name'), { target: { value: 'Ava' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add diner' }))
    fireEvent.change(screen.getByLabelText('Hard restriction'), { target: { value: 'Peanuts' } })
    fireEvent.change(screen.getByLabelText('Applies to'), { target: { value: screen.getByRole('option', { name: 'Ava' }).getAttribute('value') } })
    fireEvent.click(screen.getByRole('button', { name: 'Add restriction' }))
    fireEvent.change(screen.getByLabelText('Exception date'), { target: { value: '2026-08-20' } })
    fireEvent.change(screen.getByLabelText('Exception note'), { target: { value: 'Late practice' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add exception' }))

    expect(screen.getByText('Peanuts — Ava')).toBeInTheDocument()
    expect(screen.getByText('2026-08-20: Normal — Late practice')).toBeInTheDocument()
  })

  it('keeps a name-only meal ineligible with a restriction until compatibility is confirmed, and persists the choice', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Hard restriction'), { target: { value: 'Peanuts' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add restriction' }))
    fireEvent.change(screen.getByLabelText('Meal name'), { target: { value: 'Tacos' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add meal' }))

    expect(screen.getByText('No linked recipe. Grocery ingredients are incomplete.')).toBeInTheDocument()
    expect(screen.getByText('Confirm compatibility before planning.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Safety review for Tacos'), { target: { value: 'approved' } })
    expect(screen.getByText('Eligible to plan.')).toBeInTheDocument()

    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      meals: [{ name: 'Tacos', active: true, safetyReview: 'approved' }],
    })
  })

  it('requires a new safety review when a hard restriction changes', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Meal name'), { target: { value: 'Tacos' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add meal' }))
    fireEvent.change(screen.getByLabelText('Safety review for Tacos'), { target: { value: 'approved' } })
    fireEvent.change(screen.getByLabelText('Hard restriction'), { target: { value: 'Peanuts' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add restriction' }))

    expect(screen.getByText('Confirm compatibility before planning.')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      meals: [{ name: 'Tacos', safetyReview: 'unknown' }],
    })
  })

  it('shows active-meal count guidance and updates active name-only meals', () => {
    render(<App />)
    expect(screen.getByText('0 selected. For a useful first plan, select 8–12 active meals.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Meal name'), { target: { value: 'Soup' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add meal' }))
    expect(screen.getByText('1 selected. For a useful first plan, select 8–12 active meals.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Meal name Soup'), { target: { value: 'Tomato soup' } })
    fireEvent.click(screen.getByLabelText('Active Tomato soup'))
    expect(screen.getByText('0 selected. For a useful first plan, select 8–12 active meals.')).toBeInTheDocument()
  })

  it('persists whether a meal intentionally covers one leftover dinner', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Meal name'), { target: { value: 'Chili' } })
    fireEvent.click(screen.getByLabelText('Plan one leftover dinner for Chili'))
    fireEvent.click(screen.getByRole('button', { name: 'Add meal' }))

    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({ meals: [{ name: 'Chili', plannedLeftoverDinner: true }] })
    fireEvent.click(screen.getByLabelText('Plan one leftover dinner for Chili'))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').meals[0]).not.toHaveProperty('plannedLeftoverDinner')
  })

  it('does not save a blank inline meal name', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Meal name'), { target: { value: 'Soup' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add meal' }))
    fireEvent.change(screen.getByLabelText('Meal name Soup'), { target: { value: '' } })

    expect(screen.getByText('Changes saved locally.')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({ meals: [{ name: 'Soup' }] })
  })

  it('does not save an overlong inline meal name', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Meal name'), { target: { value: 'Soup' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add meal' }))
    fireEvent.change(screen.getByLabelText('Meal name Soup'), { target: { value: 'x'.repeat(161) } })

    expect(screen.getByText('Changes saved locally.')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({ meals: [{ name: 'Soup' }] })
  })

  it('restores committed onboarding and name-only meals after reload', () => {
    const view = render(<App />)
    fireEvent.change(screen.getByLabelText('Diner name'), { target: { value: 'Ava' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add diner' }))
    fireEvent.change(screen.getByLabelText('Meal name'), { target: { value: 'Tacos' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add meal' }))
    view.unmount()

    render(<App />)
    expect(screen.getByText('Ava', { selector: 'li' })).toBeInTheDocument()
    expect(screen.getByLabelText('Meal name Tacos')).toHaveValue('Tacos')
  })

  it('shows a linked recipe separately and warns when its ingredients are incomplete', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-1', name: 'Soup', active: true, recipeIds: ['recipe-1'] })
    state.recipes.push({ id: 'recipe-1', title: 'Weeknight soup', mealId: 'meal-1' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    expect(screen.getByText('Recipe: Weeknight soup')).toBeInTheDocument()
    expect(screen.getByText('1 linked recipe. Grocery ingredients are incomplete.')).toBeInTheDocument()
  })

  it('shows ingredient lines for linked recipes without inventing missing ingredients', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-1', name: 'Soup', active: true, recipeIds: ['recipe-1', 'recipe-2'] })
    state.recipes.push(
      { id: 'recipe-1', title: 'Weeknight soup', mealId: 'meal-1', ingredients: ['1 onion', '2 cups broth'] },
      { id: 'recipe-2', title: 'Mystery soup', mealId: 'meal-1' },
    )
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)

    expect(within(screen.getByRole('region', { name: 'Ingredients for Weeknight soup' })).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('1 onion')).toBeInTheDocument()
    expect(screen.getByText('2 cups broth')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Ingredients for Mystery soup' })).not.toBeInTheDocument()
  })

  it('resets imported meal approvals when imported restrictions differ', async () => {
    const current = createEmptyAppState()
    current.household.hardRestrictions.push({ id: 'restriction-current', label: 'Peanuts' })
    current.meals.push({ id: 'meal-current', name: 'Tacos', active: true, safetyReview: 'approved' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(current))
    const imported = createEmptyAppState()
    imported.household.hardRestrictions.push({ id: 'restriction-imported', label: 'Dairy' })
    imported.meals.push({ id: 'meal-imported', name: 'Pasta', active: true, safetyReview: 'approved' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const { container } = render(<App />)
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [{ text: () => Promise.resolve(JSON.stringify(imported)) }] } })

    await waitFor(() => expect(screen.getByText('Confirm compatibility before planning.')).toBeInTheDocument())
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      household: { hardRestrictions: [{ id: 'restriction-imported', label: 'Dairy' }] },
      meals: [{ name: 'Pasta', safetyReview: 'unknown' }],
    })
  })
})

describe('weekly planning', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('keeps the seven-day preview out of AppStateV1 until confirmation, then restores it', () => {
    const state = createEmptyAppState()
    state.meals.push(
      { id: 'meal-a', name: 'Soup', active: true, safetyReview: 'approved' },
      { id: 'meal-b', name: 'Pasta', active: true, safetyReview: 'approved' },
    )
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    const view = render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    expect(screen.getByRole('heading', { name: 'Weekly plan preview' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].slots).toHaveLength(7)
    view.unmount()

    render(<App />)
    expect(screen.getByRole('heading', { name: 'Current weekly plan' })).toBeInTheDocument()
    expect(screen.getByText(/2026-08-17: Soup/)).toBeInTheDocument()
  })

  it('keeps storage and rendered plans unchanged when confirmation fails V3 validation', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-a', name: 'Soup', active: true, safetyReview: 'approved' }, { id: 'meal-b', name: 'Pasta', active: true, safetyReview: 'approved' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000000')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))

    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans).toEqual([])
    expect(screen.queryByText('Current weekly plan')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Plan for shopping')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Changes are invalid and were not applied.')
  })

  it('clears a weekly preview when a committed household change invalidates it', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-a', name: 'Soup', active: true, safetyReview: 'approved' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.change(screen.getByLabelText('Hard restriction'), { target: { value: 'Peanuts' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add restriction' }))

    expect(screen.queryByRole('heading', { name: 'Weekly plan preview' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm weekly plan' })).not.toBeInTheDocument()
  })

  it('clears a weekly preview when its week-start date changes', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-a', name: 'Soup', active: true, safetyReview: 'approved' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    expect(screen.getByRole('heading', { name: 'Weekly plan preview' })).toBeInTheDocument()
    const weekStarts = screen.getByLabelText('Week starts') as HTMLInputElement
    fireEvent.change(weekStarts, { target: { value: weekStarts.value === '2026-08-24' ? '2026-08-31' : '2026-08-24' } })

    expect(screen.queryByRole('heading', { name: 'Weekly plan preview' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm weekly plan' })).not.toBeInTheDocument()
  })

  it('does not preview a plan without a week-start date', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '' } })

    expect(screen.getByRole('button', { name: 'Preview weekly plan' })).toBeDisabled()
  })

  it('keeps guidance and no-eligible previews transient and non-confirmable', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'only', name: 'Only', active: true, safetyReview: 'approved' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    const view = render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    expect(screen.getByText('Add another active compatible meal for a useful first plan.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm weekly plan' })).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans).toHaveLength(0)
    view.unmount()

    state.meals[0].active = false
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    expect(screen.getByText('Activate or confirm a compatible meal, then try again.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm weekly plan' })).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans).toHaveLength(0)
  })

  it('keeps the fallback selected when an optional meal cannot fit the first cooking night', () => {
    const state = createEmptyAppState()
    state.household.scheduleExceptions.push({ id: 'late', date: '2026-08-17', constrained: true })
    state.meals.push(
      { id: 'fallback', name: 'Fallback', active: true, safetyReview: 'approved' },
      { id: 'backup', name: 'Backup', active: true, safetyReview: 'approved' },
      { id: 'new', name: 'New', active: true, provisional: true, safetyReview: 'approved' },
    )
    state.outcomes.push({ id: 'fallback-outcome', mealId: 'fallback', acceptance: 'accepted' })
    state.recipes.push({ id: 'fallback-recipe', title: 'Fallback', mealId: 'fallback', prepMinutes: 10, cookMinutes: 10 }, { id: 'backup-recipe', title: 'Backup', mealId: 'backup', prepMinutes: 10, cookMinutes: 10 }, { id: 'new-recipe', title: 'New', mealId: 'new', prepMinutes: 20, cookMinutes: 30 })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use this meal' }))

    expect(screen.getByText('Your chosen unfamiliar meal is in this preview.')).toBeInTheDocument()
  })

  it('shows and persists the actual scored fallback when IDs sort differently', () => {
    const state = createEmptyAppState()
    state.household.scheduleExceptions.push({ id: 'late', date: '2026-08-17', constrained: true })
    state.meals.push({ id: 'a-slow', name: 'A slow', active: true, safetyReview: 'approved' }, { id: 'z-quick', name: 'Z quick', active: true, safetyReview: 'approved' }, { id: 'new', name: 'New', active: true, provisional: true, safetyReview: 'approved' })
    state.recipes.push({ id: 'a-recipe', title: 'A slow', mealId: 'a-slow', prepMinutes: 20, cookMinutes: 30 }, { id: 'z-recipe', title: 'Z quick', mealId: 'z-quick', prepMinutes: 10, cookMinutes: 10 }, { id: 'new-recipe', title: 'New', mealId: 'new', prepMinutes: 20, cookMinutes: 30 })
    state.outcomes.push({ id: 'accepted', mealId: 'a-slow', acceptance: 'accepted' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    expect(screen.getByText(/No action keeps familiar fallback A slow/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Not for us' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))

    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].variants).toEqual([expect.objectContaining({ mealId: 'a-slow', label: 'Familiar fallback for optional unfamiliar meal' })])
  })

  it('makes a rejected provisional meal inactive when the weekly plan is confirmed', () => {
    const state = createEmptyAppState()
    state.meals.push(
      { id: 'fallback', name: 'Fallback', active: true, safetyReview: 'approved' },
      { id: 'backup', name: 'Backup', active: true, safetyReview: 'approved' },
      { id: 'new', name: 'New', active: true, provisional: true, safetyReview: 'approved' },
    )
    state.outcomes.push({ id: 'fallback-outcome', mealId: 'fallback', acceptance: 'accepted' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Not for us' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))

    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({ meals: expect.arrayContaining([expect.objectContaining({ id: 'new', active: false })]) })
  })

  it('records user-selected planned takeout as a takeout revision, not a planner meal', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-a', name: 'Soup', active: true, safetyReview: 'approved' }, { id: 'meal-b', name: 'Pasta', active: true, safetyReview: 'approved' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan takeout for 2026-08-17' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))
    const plan = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0]
    expect(plan.slots).toContainEqual(expect.not.objectContaining({ mealId: expect.anything() }))
    expect(plan.repairRevisions).toEqual([expect.objectContaining({ kind: 'takeout', takeoutContext: 'planned' })])
  })

  it('keeps multiple user-selected takeout dates in an initial plan', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' }, { id: 'soup', name: 'Soup', active: true, safetyReview: 'approved' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan takeout for 2026-08-17' }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan takeout for 2026-08-18' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))

    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].repairRevisions).toEqual([
      expect.objectContaining({ kind: 'takeout', takeoutContext: 'planned' }),
      expect.objectContaining({ kind: 'takeout', takeoutContext: 'planned' }),
    ])
  })

  it('replaces an untouched overlapping week after confirmation', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' }, { id: 'soup', name: 'Soup', active: true, safetyReview: 'approved' })
    state.plans.push({ id: 'legacy', confirmed: true, slots: ['23', '24', '25', '26', '27', '28', '29'].map((day) => ({ id: `legacy-${day}`, date: `2026-08-${day}`, mealId: 'tacos' })) } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-24' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))

    const saved = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')
    expect(confirm).toHaveBeenCalledWith('Replace the existing untouched weekly plan(s)?')
    expect(saved.plans).toHaveLength(1)
    expect(saved.plans[0].slots.map((slot: { date: string }) => slot.date)).not.toContain('2026-08-23')
    expect(saved.plans[0].slots.map((slot: { date: string }) => slot.date)).toContain('2026-08-30')
  })

  it('replaces an untouched overlapping week with planned takeout configuration', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' }, { id: 'soup', name: 'Soup', active: true, safetyReview: 'approved' })
    state.plans.push({ id: 'legacy', confirmed: true, slots: ['23', '24', '25', '26', '27', '28', '29'].map((day) => ({ id: `legacy-${day}`, date: `2026-08-${day}`, ...(day !== '29' && { mealId: 'tacos' }) })), repairRevisions: [{ id: 'planned-takeout', createdAt: '2026-08-23T12:00:00.000Z', slotId: 'legacy-29', kind: 'takeout', takeoutContext: 'planned' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-24' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))

    const saved = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')
    expect(confirm).toHaveBeenCalledWith('Replace the existing untouched weekly plan(s)? Planned takeout choices will also be replaced.')
    expect(saved.plans).toHaveLength(1)
    expect(saved.plans[0]).not.toMatchObject({ id: 'legacy' })
    expect(saved.plans[0].slots.map((slot: { date: string }) => slot.date)).toContain('2026-08-30')
  })

  it('keeps an overlapping week with a non-planned repair revision on the repair path', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' }, { id: 'soup', name: 'Soup', active: true, safetyReview: 'approved' })
    state.plans.push({ id: 'legacy', confirmed: true, slots: ['23', '24', '25', '26', '27', '28', '29'].map((day) => ({ id: `legacy-${day}`, date: `2026-08-${day}`, mealId: 'tacos' })), repairRevisions: [{ id: 'repair', createdAt: '2026-08-23T12:00:00.000Z', slotId: 'legacy-23', kind: 'recovery' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-24' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))

    expect(confirm).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans).toEqual([expect.objectContaining({ id: 'legacy' })])
  })

  it.each(['leftoverLotIds', 'leftoverDependencyIds'] as const)('keeps an overlapping week with slot %s evidence on the repair path', (field) => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' }, { id: 'soup', name: 'Soup', active: true, safetyReview: 'approved' })
    state.leftoverLots.push({ id: 'reserved' })
    state.plans.push({ id: 'legacy', confirmed: true, slots: ['23', '24', '25', '26', '27', '28', '29'].map((day) => ({ id: `legacy-${day}`, date: `2026-08-${day}`, mealId: 'tacos', ...(day === '24' && { [field]: ['reserved'] }) })) } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-24' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))

    expect(confirm).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans).toEqual([expect.objectContaining({ id: 'legacy' })])
  })

  it.each([false, true])('keeps the 100-plan limit when an overlap is %sprotected', (protectedPlan) => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' }, { id: 'soup', name: 'Soup', active: true, safetyReview: 'approved' })
    state.plans.push({ id: 'legacy', confirmed: true, slots: ['23', '24', '25', '26', '27', '28', '29'].map((day) => ({ id: `legacy-${day}`, date: `2026-08-${day}`, mealId: 'tacos' })), ...(protectedPlan && { shopping: { confirmedAt: '2026-08-23T12:00:00.000Z', partial: false, skippedIncompleteMealIds: [], items: [] } }) } as never, ...Array.from({ length: 99 }, (_, index) => ({ id: `other-${index}`, confirmed: true, slots: [{ id: `other-slot-${index}`, date: '2026-07-01', mealId: 'soup' }] })) as never[])
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-24' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))

    const saved = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')
    expect(saved.plans).toHaveLength(100)
    expect(saved.plans.some((plan: { id: string }) => plan.id === 'legacy')).toBe(protectedPlan)
    expect(confirm).toHaveBeenCalledTimes(protectedPlan ? 0 : 1)
  })

  it('keeps an untouched overlapping week and preview when replacement is cancelled', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' }, { id: 'soup', name: 'Soup', active: true, safetyReview: 'approved' })
    state.plans.push({ id: 'legacy', confirmed: true, slots: ['23', '24', '25', '26', '27', '28', '29'].map((day) => ({ id: `legacy-${day}`, date: `2026-08-${day}`, mealId: 'tacos' })) } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-24' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))

    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans).toEqual([expect.objectContaining({ id: 'legacy' })])
    expect(screen.getByRole('heading', { name: 'Weekly plan preview' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Weekly plan replacement was cancelled.')
  })

  it('keeps an overlapping week with cooking or durable repair evidence on the repair path', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' }, { id: 'soup', name: 'Soup', active: true, safetyReview: 'approved' })
    state.plans.push({ id: 'legacy', confirmed: true, slots: ['23', '24', '25', '26', '27', '28', '29'].map((day) => ({ id: `legacy-${day}`, date: `2026-08-${day}`, mealId: 'tacos', ...(day === '23' && { cookingStartedAt: '2026-08-23T17:00:00.000Z' }) })), repairRevisions: [{ id: 'legacy-repair', createdAt: '2026-08-24T17:00:00.000Z', slotId: 'legacy-24', kind: 'takeout', takeoutContext: 'planned' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-24' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))

    expect(confirm).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans).toEqual([expect.objectContaining({ id: 'legacy' })])
    expect(screen.getByRole('status')).toHaveTextContent('Choose the overlapping confirmed plan and unfinished date explicitly')
  })

  it('requires explicit selection when an overlapping confirmed plan is protected', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' }, { id: 'soup', name: 'Soup', active: true, safetyReview: 'approved' })
    state.plans.push({ id: 'first', confirmed: true, slots: [{ id: 'first-slot', date: '2026-08-17', mealId: 'tacos' }] }, { id: 'second', confirmed: true, slots: [{ id: 'second-slot', date: '2026-08-17', mealId: 'soup' }], shopping: { confirmedAt: '2026-08-17T12:00:00.000Z', partial: false, skippedIncompleteMealIds: [], items: [] } } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))

    expect(screen.getByRole('status')).toHaveTextContent('Choose the overlapping confirmed plan and unfinished date explicitly')
    expect(screen.getByLabelText('Plan to repair')).toHaveValue('')
  })

  it('marks review only after a planning-relevant change, not cooking', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'tacos' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    const view = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Start cooking Tacos' }))
    expect(screen.queryByRole('button', { name: 'Review needed' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Hard restriction'), { target: { value: 'Peanuts' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add restriction' }))
    expect(screen.getByRole('button', { name: 'Review needed' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dinner’s ready Tacos' })).toBeDisabled()
    view.unmount(); render(<App />)
    expect(screen.getByRole('button', { name: 'Review needed' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dinner’s ready Tacos' })).toBeDisabled()
  })

  it.each([
    ['unknown', undefined],
    ['slow', 31],
  ] as const)('persists constrained-night review when hands-on effort is %s', (_label, prepMinutes) => {
    const state = createEmptyAppState()
    state.household.scheduleExceptions.push({ id: 'late', date: '2026-08-17', constrained: true })
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' })
    state.recipes.push({ id: 'recipe', title: 'Tacos', mealId: 'tacos', prepMinutes })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'tacos', recipeId: 'recipe' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    const view = render(<App />)
    expect(screen.getByRole('button', { name: 'Review needed' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start cooking Tacos' })).toBeDisabled()
    view.unmount(); render(<App />)
    expect(screen.getByRole('button', { name: 'Review needed' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start cooking Tacos' })).toBeDisabled()
  })

  it('does not review a valid meal-linked recipe fallback', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' })
    state.recipes.push({ id: 'recipe', title: 'Tacos', mealId: 'tacos' })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'tacos' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    expect(screen.queryByRole('button', { name: 'Review needed' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start cooking Tacos' })).toBeEnabled()
  })

  it('uses a meal recipeIds fallback after reload', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved', recipeIds: ['recipe'] })
    state.recipes.push({ id: 'recipe', title: 'Tacos' })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'tacos' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    const view = render(<App />)
    expect(screen.queryByRole('button', { name: 'Review needed' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start cooking Tacos' })).toBeEnabled()
    view.unmount(); render(<App />)
    expect(screen.queryByRole('button', { name: 'Review needed' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start cooking Tacos' })).toBeEnabled()
  })

  it('persists unavailable-shopping review using a meal-linked recipe fallback', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' })
    state.recipes.push({ id: 'recipe', title: 'Tacos', mealId: 'tacos', ingredients: ['1 cup tomatoes'] })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'tacos' }], shopping: { confirmedAt: '2026-08-17T12:00:00.000Z', partial: false, skippedIncompleteMealIds: [], items: [{ label: '1 cup tomatoes', sourceLines: ['1 cup tomatoes'], mealIds: ['tacos'], perishable: false, availability: 'unavailable' }] } } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    const view = render(<App />)
    expect(screen.getByRole('button', { name: 'Review needed' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start cooking Tacos' })).toBeDisabled()
    view.unmount(); render(<App />)
    expect(screen.getByRole('button', { name: 'Review needed' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start cooking Tacos' })).toBeDisabled()
  })

  it('keeps a slow planned-leftover target ready-capable on a constrained night after reload', () => {
    const state = createEmptyAppState()
    state.household.scheduleExceptions.push({ id: 'late', date: '2026-08-18', constrained: true })
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' })
    state.recipes.push({ id: 'recipe', title: 'Tacos', mealId: 'tacos', prepMinutes: 31 })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'source', date: '2026-08-17', mealId: 'tacos', recipeId: 'recipe', cookingStartedAt: '2026-08-17T17:00:00.000Z', dinnerReadyAt: '2026-08-17T18:00:00.000Z' }, { id: 'target', date: '2026-08-18', mealId: 'tacos', recipeId: 'recipe', leftoverFromSlotId: 'source' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    const view = render(<App />)
    expect(screen.getByRole('button', { name: 'Dinner’s ready Tacos' })).toBeEnabled()
    view.unmount(); render(<App />)
    expect(screen.getByRole('button', { name: 'Dinner’s ready Tacos' })).toBeEnabled()
  })

  it('keeps a planned-leftover target ready-capable when its source ingredient is unavailable', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' })
    state.recipes.push({ id: 'recipe', title: 'Tacos', mealId: 'tacos', ingredients: ['1 cup tomatoes'] })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'source', date: '2026-08-17', mealId: 'tacos', recipeId: 'recipe', cookingStartedAt: '2026-08-17T17:00:00.000Z', dinnerReadyAt: '2026-08-17T18:00:00.000Z' }, { id: 'target', date: '2026-08-18', mealId: 'tacos', recipeId: 'recipe', leftoverFromSlotId: 'source' }], shopping: { confirmedAt: '2026-08-17T12:00:00.000Z', partial: false, skippedIncompleteMealIds: [], items: [{ label: '1 cup tomatoes', sourceLines: ['1 cup tomatoes'], mealIds: ['tacos'], perishable: false, availability: 'unavailable' }] } } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    const view = render(<App />)
    expect(screen.getByRole('button', { name: 'Dinner’s ready Tacos' })).toBeEnabled()
    view.unmount(); render(<App />)
    expect(screen.getByRole('button', { name: 'Dinner’s ready Tacos' })).toBeEnabled()
  })

  it('continues to block a planned-leftover target when its meal is unsafe', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'rejected' })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'source', date: '2026-08-17', mealId: 'tacos' }, { id: 'target', date: '2026-08-18', mealId: 'tacos', leftoverFromSlotId: 'source' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    const view = render(<App />)
    expect(screen.getAllByRole('button', { name: 'Dinner’s ready Tacos' })[1]).toBeDisabled()
    view.unmount(); render(<App />)
    expect(screen.getAllByRole('button', { name: 'Dinner’s ready Tacos' })[1]).toBeDisabled()
  })

  it.each([
    ['unforeseeable-disruption', 'accepted', 'successful'],
    ['predictable-planning-or-acceptance-failure', 'accepted', 'unsuccessful'],
    ['planned', 'rejected', 'unsuccessful'],
  ] as const)('classifies repair takeout with %s and %s feedback as %s', (takeoutContext, acceptance, result) => {
    expect(classifyRecovery({ repairKind: 'takeout', takeoutContext, acceptance })).toBe(result)
  })

  it('does not mark an unrelated confirmed plan after a name-only meal edit', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' }, { id: 'soup', name: 'Soup', active: true, safetyReview: 'approved' })
    state.plans.push({ id: 'tacos-plan', confirmed: true, slots: [{ id: 'tacos-slot', date: '2026-08-17', mealId: 'tacos' }] }, { id: 'soup-plan', confirmed: true, slots: [{ id: 'soup-slot', date: '2026-08-18', mealId: 'soup' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Meal name Tacos'), { target: { value: 'Tuesday tacos' } })

    expect(screen.queryByRole('button', { name: 'Review needed' })).not.toBeInTheDocument()
  })

  it('does not mark an existing plan for review when confirming a non-overlapping plan', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' }, { id: 'soup', name: 'Soup', active: true, safetyReview: 'approved' })
    state.plans.push({ id: 'old', confirmed: true, slots: [{ id: 'old-slot', date: '2026-08-10', mealId: 'tacos' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))

    expect(screen.queryByRole('button', { name: 'Review needed' })).not.toBeInTheDocument()
  })

  it('lets either end of a planned leftover link become takeout', () => {
    const state = createEmptyAppState()
    state.household.scheduleExceptions.push({ id: 'mon', date: '2026-08-17', constrained: true }, { id: 'wed', date: '2026-08-19', constrained: true })
    state.meals.push({ id: 'crockpot', name: 'Crockpot', active: true, safetyReview: 'approved', plannedLeftoverDinner: true }, { id: 'regular', name: 'Regular', active: true, safetyReview: 'approved' })
    state.recipes.push({ id: 'crockpot-r', title: 'Crockpot', mealId: 'crockpot', prepMinutes: 30, cookMinutes: 600 })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    const source = screen.getByRole('button', { name: 'Plan takeout for 2026-08-17' })
    const target = screen.getByRole('button', { name: 'Plan takeout for 2026-08-19' })
    expect(source).toBeEnabled()
    expect(target).toBeEnabled()
    fireEvent.click(source)
    expect(screen.getByRole('button', { name: 'Use planned meal' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Use planned meal' }))
    fireEvent.click(target)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))
    const slots = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].slots
    const takeout = slots.find((slot: { date: string }) => slot.date === '2026-08-19')
    expect(takeout.mealId).toBeUndefined()
    expect(slots.some((slot: { leftoverFromSlotId?: string }) => slot.leftoverFromSlotId === takeout.id)).toBe(false)
  })

  it('records dependent leftover recovery separately from a source takeout repair', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'source', name: 'Source', active: true, safetyReview: 'approved' }, { id: 'replacement', name: 'Replacement', active: true, safetyReview: 'approved' })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'source', date: '2026-08-17', mealId: 'source', cookingStartedAt: '2026-08-17T17:00:00.000Z' }, { id: 'dependent', date: '2026-08-18', mealId: 'source', leftoverFromSlotId: 'source' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    fireEvent.change(screen.getByLabelText('Plan to repair'), { target: { value: 'plan' } })
    fireEvent.change(screen.getByLabelText('Date to repair'), { target: { value: 'source' } })
    fireEvent.click(screen.getByRole('button', { name: 'Plans changed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose takeout' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))

    const plan = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0]
    expect(plan.slots.find((slot: { id: string }) => slot.id === 'source')).not.toHaveProperty('cookingStartedAt')
    expect(plan.slots.find((slot: { id: string }) => slot.id === 'dependent').leftoverFromSlotId).toBeUndefined()
    expect(plan.repairRevisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ slotId: 'source', kind: 'takeout' }),
      expect.objectContaining({ slotId: 'dependent', kind: 'recovery', reason: 'replan' }),
    ]))
  })

  it('does not carry an old plan incomplete-meal acknowledgement into a new plan', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'soup', name: 'Soup', active: true, safetyReview: 'approved' }, { id: 'pasta', name: 'Pasta', active: true, safetyReview: 'approved' })
    state.plans.push({ id: 'old', confirmed: true, slots: [{ id: 'old-slot', date: '2026-08-10', mealId: 'soup' }], shopping: { confirmedAt: '2026-08-10T00:00:00.000Z', partial: true, skippedIncompleteMealIds: ['soup'], items: [] } } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))
    const plans = screen.getByLabelText('Plan for shopping') as HTMLSelectElement
    openShopping(plans.options[plans.options.length - 1].value)
    expect(screen.getByRole('button', { name: 'Shopping done' })).toBeDisabled()
  })
})

describe('shopping and repair', () => {
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

  it('shows incomplete groceries, records an unavailable item, and applies a selected repair only after confirmation', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, recipeIds: ['tacos-recipe'] }, { id: 'soup', name: 'Soup', active: true, recipeIds: ['soup-recipe'] })
    state.recipes.push({ id: 'tacos-recipe', title: 'Tacos', mealId: 'tacos', ingredients: ['1 cup tomatoes'] }, { id: 'soup-recipe', title: 'Soup', mealId: 'soup' })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'tacos-slot', date: '2026-08-17', mealId: 'tacos', recipeId: 'tacos-recipe' }, { id: 'soup-slot', date: '2026-08-18', mealId: 'soup', recipeId: 'soup-recipe' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    openShopping()
    expect(screen.getByText('Shopping list is incomplete: Soup.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Shopping done' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Ingredients unavailable or skipped for Soup'))
    fireEvent.click(screen.getByLabelText('Unavailable 1 cup tomatoes'))
    fireEvent.click(screen.getByRole('button', { name: 'Shopping done' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].shopping).toMatchObject({ partial: true, skippedIncompleteMealIds: ['soup'], items: [{ id: 'tacos-slot:0', label: '1 cup tomatoes', sourceLines: ['1 cup tomatoes'], mealIds: ['tacos'], perishable: false, availability: 'unavailable' }] })
    openPlanRepair()
    fireEvent.click(screen.getByRole('button', { name: 'Replan with eligible meal' }))
    expect(screen.getByText(/Repair preview: Tacos becomes Soup/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].slots[0].mealId).toBe('soup')
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].slots[1].mealId).toBe('soup')
  })

  it('uses the explicitly selected plan for shopping and invalidates a repair preview on local availability changes', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, recipeIds: ['tacos-r'] }, { id: 'soup', name: 'Soup', active: true, recipeIds: ['soup-r'] })
    state.recipes.push({ id: 'tacos-r', title: 'Tacos', mealId: 'tacos', ingredients: ['1 cup tomatoes'] }, { id: 'soup-r', title: 'Soup', mealId: 'soup', ingredients: ['1 cup beans'] })
    state.plans.push({ id: 'old', confirmed: true, slots: [{ id: 'old-slot', date: '2026-08-17', mealId: 'tacos', recipeId: 'tacos-r' }] }, { id: 'new', confirmed: true, slots: [{ id: 'new-slot', date: '2026-08-18', mealId: 'soup', recipeId: 'soup-r' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    openShopping('old')
    fireEvent.click(screen.getByLabelText('Unavailable 1 cup tomatoes'))
    fireEvent.click(screen.getByRole('button', { name: 'Shopping done' }))
    const saved = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')
    expect(saved.plans.find((plan: { id: string }) => plan.id === 'old').shopping.items[0].availability).toBe('unavailable')
    expect(saved.plans.find((plan: { id: string }) => plan.id === 'new').shopping).toBeUndefined()

    openPlanRepair('new')
    fireEvent.click(screen.getByRole('button', { name: 'Choose takeout' }))
    expect(screen.getByRole('button', { name: 'Confirm repair' })).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Unavailable 1 cup tomatoes'))
    expect(screen.queryByRole('button', { name: 'Confirm repair' })).not.toBeInTheDocument()
  })

  it('preserves first unavailable shopping evidence with no unfinished target', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, recipeIds: ['recipe'] })
    state.recipes.push({ id: 'recipe', title: 'Tacos', mealId: 'tacos', ingredients: ['1 cup tomatoes'] })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'done', date: '2026-08-17', mealId: 'tacos', recipeId: 'recipe', cookingStartedAt: '2026-08-17T17:00:00.000Z', dinnerReadyAt: '2026-08-17T18:00:00.000Z' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state)); vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />); openShopping(); fireEvent.click(screen.getByLabelText('Unavailable 1 cup tomatoes')); fireEvent.click(screen.getByRole('button', { name: 'Shopping done' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].shopping.items[0]).toMatchObject({ id: 'done:0', availability: 'unavailable', sourceLines: ['1 cup tomatoes'], sourceSlotIds: ['done'] })
    expect(screen.getByRole('status')).toHaveTextContent('Shopping completion recorded.')
    expect((screen.getByLabelText('Plan to repair') as HTMLSelectElement).value).toBe('')
  })

  it('routes an aligned shared unavailable item to all affected slots for review', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'a', name: 'A', active: true, recipeIds: ['ra'] }, { id: 'b', name: 'B', active: true, recipeIds: ['rb'] })
    state.recipes.push({ id: 'ra', title: 'A', mealId: 'a', ingredients: ['1 cup tomatoes'] }, { id: 'rb', title: 'B', mealId: 'b', ingredients: ['1 cups tomatoes'] })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'a-slot', date: '2026-08-17', mealId: 'a', recipeId: 'ra' }, { id: 'b-slot', date: '2026-08-18', mealId: 'b', recipeId: 'rb' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state)); vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />); openShopping(); fireEvent.click(screen.getByLabelText('Unavailable 2 cups tomatoes')); fireEvent.click(screen.getByRole('button', { name: 'Shopping done' }))
    expect((screen.getByLabelText('Plan to repair') as HTMLSelectElement).value).toBe('plan')
    expect((screen.getByLabelText('Date to repair') as HTMLSelectElement).value).toBe('')
    expect(screen.getAllByRole('button', { name: 'Review needed' })).toHaveLength(2)
  })

  it('links a distinct recovery meal and exposes it to plan repair', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true }, { id: 'soup', name: 'Soup', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'tacos-slot', date: '2026-08-17', mealId: 'tacos' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Meal needing recovery'), { target: { value: 'tacos' } })
    fireEvent.change(screen.getByLabelText('Recovery meal'), { target: { value: 'soup' } })
    fireEvent.click(screen.getByRole('button', { name: 'Link recovery meal' }))
    openPlanRepair()
    expect(screen.getByRole('button', { name: 'Use recovery Soup' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').meals.find((meal: { id: string }) => meal.id === 'tacos').recoveryMealIds).toEqual(['soup'])
  })

  it('saves a selected shared adaptation recipe and exposes it for repair', () => {
    const state = createEmptyAppState()
    state.household.diners.push({ id: 'ava', name: 'Ava', active: true })
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, recipeIds: ['tacos-normal', 'tacos-simple'] }, { id: 'soup', name: 'Soup', active: true })
    state.recipes.push({ id: 'tacos-normal', title: 'Tacos', mealId: 'tacos' }, { id: 'tacos-simple', title: 'Simple tacos', mealId: 'tacos' })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'tacos', recipeId: 'tacos-normal' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Adapt meal'), { target: { value: 'tacos' } })
    fireEvent.change(screen.getByLabelText('Adaptation recipe'), { target: { value: 'tacos-simple' } })
    fireEvent.change(screen.getByLabelText('Diner'), { target: { value: 'ava' } })
    fireEvent.change(screen.getByLabelText('Issue'), { target: { value: 'Too spicy' } })
    fireEvent.change(screen.getByLabelText('Shared adaptation'), { target: { value: 'Mild version' } })
    ;['Solves the issue', 'One coordinated cooking session', 'No second entree', 'No unplanned non-staple protein', 'No separate timeline', 'No needless extra effort'].forEach((label) => fireEvent.click(screen.getByLabelText(label)))
    fireEvent.click(screen.getByRole('button', { name: 'Add shared adaptation' }))

    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').meals.find((meal: { id: string }) => meal.id === 'tacos').adaptations).toEqual([expect.objectContaining({ recipeId: 'tacos-simple' })])
    openPlanRepair()
    expect(screen.getByRole('button', { name: 'Use Mild version' })).toBeInTheDocument()
  })

  it('plans and confirms the selected adaptation recipe for an optional meal', () => {
    const state = createEmptyAppState()
    state.household.diners.push({ id: 'ava', name: 'Ava', active: true })
    state.meals.push({ id: 'fallback', name: 'Fallback', active: true, safetyReview: 'approved' }, { id: 'other', name: 'Other', active: true, safetyReview: 'approved' }, { id: 'new', name: 'New', active: true, provisional: true, safetyReview: 'approved', recipeIds: ['new-normal', 'new-adapted'] })
    state.recipes.push({ id: 'new-normal', title: 'New normal', mealId: 'new' }, { id: 'new-adapted', title: 'New adapted', mealId: 'new' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Adapt meal'), { target: { value: 'new' } })
    fireEvent.change(screen.getByLabelText('Adaptation recipe'), { target: { value: 'new-adapted' } })
    fireEvent.change(screen.getByLabelText('Diner'), { target: { value: 'ava' } })
    fireEvent.change(screen.getByLabelText('Issue'), { target: { value: 'Too spicy' } })
    fireEvent.change(screen.getByLabelText('Shared adaptation'), { target: { value: 'Mild version' } })
    ;['Solves the issue', 'One coordinated cooking session', 'No second entree', 'No unplanned non-staple protein', 'No separate timeline', 'No needless extra effort'].forEach((label) => fireEvent.click(screen.getByLabelText(label)))
    fireEvent.click(screen.getByRole('button', { name: 'Add shared adaptation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Make it work for us' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))

    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].slots[0]).toMatchObject({ mealId: 'new', recipeId: 'new-adapted', scoreReasons: expect.arrayContaining(['Uses shared adaptation with New adapted.']) })
    expect(screen.getByText('Recipe: New adapted')).toBeInTheDocument()
  })

  it('does not add recovery links beyond the meal limit', () => {
    const state = createEmptyAppState()
    const recoveryMealIds = Array.from({ length: 50 }, (_, index) => `recovery-${index}`)
    state.meals.push(
      { id: 'tacos', name: 'Tacos', active: true, recoveryMealIds },
      { id: 'soup', name: 'Soup', active: true },
      ...recoveryMealIds.map((id) => ({ id, name: id, active: true })),
    )
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Meal needing recovery'), { target: { value: 'tacos' } })
    fireEvent.change(screen.getByLabelText('Recovery meal'), { target: { value: 'soup' } })
    expect(screen.getByRole('button', { name: 'Link recovery meal' })).toBeDisabled()

    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').meals.find((meal: { id: string }) => meal.id === 'tacos').recoveryMealIds).toEqual(recoveryMealIds)
  })

  it('hydrates shopping controls from the saved record and keeps their stable item evidence on re-confirmation', async () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, recipeIds: ['tacos-recipe'] })
    state.recipes.push({ id: 'tacos-recipe', title: 'Tacos', mealId: 'tacos', ingredients: ['1 cup tomatoes'] })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'tacos-slot', date: '2026-08-17', mealId: 'tacos', recipeId: 'tacos-recipe' }], shopping: { confirmedAt: '2026-08-17T12:00:00.000Z', partial: false, skippedIncompleteMealIds: [], items: [{ id: 'tacos-slot:0', label: '1 cup tomatoes', sourceLines: ['1 cup tomatoes'], mealIds: ['tacos'], perishable: true, availability: 'unavailable' }] } } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const first = render(<App />)
    openShopping()
    await waitFor(() => expect(screen.getByLabelText('Unavailable 1 cup tomatoes')).toBeChecked())
    expect(screen.getByLabelText('Perishable 1 cup tomatoes')).toBeChecked()
    expect(screen.getByLabelText('Unavailable 1 cup tomatoes')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Shopping done' })).toBeDisabled()
    first.unmount()
    render(<App />)
    openShopping()
    await waitFor(() => expect(screen.getByLabelText('Unavailable 1 cup tomatoes')).toBeChecked())
    fireEvent.click(screen.getByRole('button', { name: 'Shopping done' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].shopping.items).toEqual([{ id: 'tacos-slot:0', label: '1 cup tomatoes', sourceLines: ['1 cup tomatoes'], mealIds: ['tacos'], perishable: true, availability: 'unavailable' }])
  })

  it('hydrates legacy shopping evidence without an item id by matching its saved sources', async () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, recipeIds: ['tacos-recipe'] })
    state.recipes.push({ id: 'tacos-recipe', title: 'Tacos', mealId: 'tacos', ingredients: ['1 cup tomatoes'] })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'tacos-slot', date: '2026-08-17', mealId: 'tacos', recipeId: 'tacos-recipe' }], shopping: { confirmedAt: '2026-08-17T12:00:00.000Z', partial: false, skippedIncompleteMealIds: [], items: [{ label: '1 cup tomatoes', sourceLines: ['1 cup tomatoes'], mealIds: ['tacos'], perishable: true, availability: 'skipped' }] } } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    openShopping()
    await waitFor(() => expect(screen.getByLabelText('Skip 1 cup tomatoes')).toBeChecked())
    expect(screen.getByLabelText('Perishable 1 cup tomatoes')).toBeChecked()
  })

  it('requires acknowledgement before replacing a meal with confirmed perishables', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, recipeIds: ['tacos-recipe'], recoveryMealIds: ['soup'] }, { id: 'soup', name: 'Soup', active: true })
    state.recipes.push({ id: 'tacos-recipe', title: 'Tacos', mealId: 'tacos', ingredients: ['1 cup tomatoes'] })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'tacos-slot', date: '2026-08-17', mealId: 'tacos', recipeId: 'tacos-recipe' }], shopping: { confirmedAt: '2026-08-17T12:00:00.000Z', partial: false, skippedIncompleteMealIds: [], items: [{ id: 'tacos-slot:0', label: '1 cup tomatoes', sourceLines: ['1 cup tomatoes'], mealIds: ['tacos'], perishable: true, availability: 'available' }] } } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    openPlanRepair()
    fireEvent.click(screen.getByRole('button', { name: 'Use recovery Soup' }))
    expect(screen.getByLabelText('Acknowledge perishable grocery risk')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))
    expect(screen.getByRole('status')).toHaveTextContent('Acknowledge the confirmed perishable groceries')
    expect(confirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Acknowledge perishable grocery risk'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].repairRevisions[0]).toMatchObject({ kind: 'recovery', perishableDisposition: 'acknowledged-preservation-risk' })
  })

  it('omits swaps when either unfinished slot participates in planned leftovers', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true }, { id: 'soup', name: 'Soup', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'tacos-slot', date: '2026-08-17', mealId: 'tacos' }, { id: 'soup-slot', date: '2026-08-18', mealId: 'soup', leftoverFromSlotId: 'tacos-slot' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    openPlanRepair()
    expect(screen.queryByRole('button', { name: 'Swap with Soup' })).not.toBeInTheDocument()
  })

  it('keeps failed-leftover recovery to future preferences and saves its 1.5x choice with the dependent replan', () => {
    openFailedLeftover()
    expect(screen.getByRole('button', { name: 'Remove leftover planning' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Increase recipe quantity to 1.5x' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Increase recipe quantity to 2x' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Choose takeout' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Increase recipe quantity to 1.5x' }))
    expect(screen.getByText(/Future recipe preference cannot fix cooked food/)).toBeInTheDocument()
    expect(screen.getByText(/Manual quantity adjustment/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))
    const saved = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')
    expect(saved.recipes.find((recipe: { id: string }) => recipe.id === 'chili-recipe').leftoverQuantityMultiplier).toBe(1.5)
    expect(saved.plans[0].slots.find((slot: { id: string }) => slot.id === 'dependent').leftoverFromSlotId).toBeUndefined()
    expect(saved.meals.find((meal: { id: string }) => meal.id === 'chili').plannedLeftoverDinner).toBe(true)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-09-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    expect(document.querySelector('.weekly-plan-preview')).toHaveTextContent('(planned leftovers)')
  })

  it.each([[1.5, true, ['Remove leftover planning', 'Increase recipe quantity to 2x']], [2, true, ['Remove leftover planning']], [undefined, false, ['Remove leftover planning']]] as const)('offers only permitted failed-leftover actions for multiplier %s', (multiplier, recipe, choices) => {
    openFailedLeftover(multiplier, recipe)
    expect(screen.getAllByRole('button').filter((button) => /leftover planning|Increase recipe quantity/.test(button.textContent ?? '')).map((button) => button.textContent)).toEqual(choices)
  })

  it('removes leftover planning only when its dependent replan is confirmed', () => {
    openFailedLeftover()
    fireEvent.click(screen.getByRole('button', { name: 'Remove leftover planning' }))
    const before = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')
    expect(before.meals.find((meal: { id: string }) => meal.id === 'chili').plannedLeftoverDinner).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))
    const saved = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')
    expect(saved.meals.find((meal: { id: string }) => meal.id === 'chili').plannedLeftoverDinner).toBeUndefined()
    expect(saved.plans[0].slots.find((slot: { id: string }) => slot.id === 'dependent').leftoverFromSlotId).toBeUndefined()
  })

  it('keeps failed-leftover preview and storage unchanged when its complete candidate is invalid', () => {
    openFailedLeftover()
    fireEvent.click(screen.getByRole('button', { name: 'Increase recipe quantity to 1.5x' }))
    const savedBefore = localStorage.getItem(APP_STATE_STORAGE_KEY)
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000001')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))
    expect(localStorage.getItem(APP_STATE_STORAGE_KEY)).toBe(savedBefore)
    expect(screen.getByRole('button', { name: 'Confirm repair' })).toBeInTheDocument()
    expect(screen.getByText(/Future recipe preference cannot fix cooked food/)).toBeInTheDocument()
    expect(screen.getByRole('status')).not.toHaveTextContent('Plan repair confirmed.')
  })

  it('reopens persisted failed-leftover recovery after reload and suppresses only its future reservation', () => {
    const first = openFailedLeftover()
    first.unmount()
    render(<App />)
    expect(screen.getByRole('button', { name: 'Remove leftover planning' })).toBeInTheDocument()
    expect((screen.getByLabelText('Plan to repair') as HTMLSelectElement).value).toBe('plan')
    expect((screen.getByLabelText('Date to repair') as HTMLSelectElement).value).toBe('dependent')
    expect(screen.getByLabelText('Plan to repair')).toBeDisabled()
    expect(screen.getByLabelText('Date to repair')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Plans changed' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-09-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    expect(document.querySelector('.weekly-plan-preview')).not.toHaveTextContent('(planned leftovers)')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans.at(-1).slots.every((slot: { leftoverFromSlotId?: string }) => slot.leftoverFromSlotId === undefined)).toBe(true)
  })

  it('renders confirmed shopping evidence instead of current recipe derivation', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal', name: 'Meal', active: true, recipeIds: ['recipe'] })
    state.recipes.push({ id: 'recipe', title: 'Meal', mealId: 'meal', ingredients: ['2 cups tomatoes'] })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'meal', recipeId: 'recipe' }], shopping: { confirmedAt: '2026-08-17T00:00:00.000Z', partial: false, skippedIncompleteMealIds: [], items: [{ id: 'slot:0', label: '1 cup tomatoes', sourceLines: ['1 cup tomatoes'], sourceSlotIds: ['slot'], mealIds: ['meal'], perishable: true, availability: 'unavailable' }] } } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    render(<App />); openShopping()
    expect(screen.getByLabelText('Unavailable 1 cup tomatoes')).toBeChecked()
    expect(screen.getByLabelText('Unavailable 1 cup tomatoes')).toBeDisabled()
    expect(screen.getByText('Sources: 1 cup tomatoes')).toBeInTheDocument()
    expect(screen.queryByLabelText('Unavailable 2 cups tomatoes')).not.toBeInTheDocument()
  })

  it('renders legacy saved checkbox states without matching a changed recipe row', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal', name: 'Meal', active: true, recipeIds: ['recipe'] })
    state.recipes.push({ id: 'recipe', title: 'Meal', mealId: 'meal', ingredients: ['2 cups tomatoes'] })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'meal', recipeId: 'recipe' }], shopping: { confirmedAt: '2026-08-17T00:00:00.000Z', partial: false, skippedIncompleteMealIds: [], items: [{ label: '1 cup tomatoes', sourceLines: ['1 cup tomatoes'], mealIds: ['meal'], perishable: true, availability: 'skipped' }] } } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    render(<App />); openShopping()
    expect(screen.getByLabelText('Skip 1 cup tomatoes')).toBeChecked()
    expect(screen.getByLabelText('Perishable 1 cup tomatoes')).toBeChecked()
    expect(screen.getByLabelText('Unavailable 1 cup tomatoes')).not.toBeChecked()
    expect(screen.getByLabelText('Skip 1 cup tomatoes')).toBeDisabled()
  })

  it('suppresses every unresolved source and advances to the older prompt after resolving the latest', () => {
    const first = openFailedLeftover()
    first.unmount()
    const state = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')
    state.meals.push({ id: 'other', name: 'Other', active: true, plannedLeftoverDinner: true })
    state.plans.push({ id: 'other-plan', confirmed: true, slots: [{ id: 'other-source', date: '2026-08-20', mealId: 'other', cookingStartedAt: '2026-08-20T17:00:00.000Z', dinnerReadyAt: '2026-08-20T18:00:00.000Z' }, { id: 'other-dependent', date: '2026-08-21', mealId: 'other', leftoverFromSlotId: 'other-source' }] })
    state.outcomes.push({ id: '00000000-0000-0000-0000-000000000099', planId: 'other-plan', planSlotId: 'other-source', mealId: 'other', recordedAt: '2026-08-20T19:00:00.000Z', acceptance: 'unknown', personFeedback: [], leftoverCoverage: 'none', recoveryClassification: 'none' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state)); vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />)
    expect((screen.getByLabelText('Plan to repair') as HTMLSelectElement).value).toBe('other-plan')
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-09-01' } }); fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    expect(document.querySelector('.weekly-plan-preview')).not.toHaveTextContent('(planned leftovers)')
    fireEvent.click(screen.getByRole('button', { name: 'Remove leftover planning' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))
    expect((screen.getByLabelText('Plan to repair') as HTMLSelectElement).value).toBe('plan')
    expect(screen.getByRole('button', { name: 'Remove leftover planning' })).toBeInTheDocument()
  })

  it('clears a repair preview after another persisted change', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true }, { id: 'soup', name: 'Soup', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'tacos-slot', date: '2026-08-17', mealId: 'tacos' }, { id: 'soup-slot', date: '2026-08-18', mealId: 'soup' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    openPlanRepair()
    fireEvent.click(screen.getByRole('button', { name: 'Swap with Soup' }))
    expect(screen.getByRole('button', { name: 'Confirm repair' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Meal name Tacos'), { target: { value: 'Tacos tonight' } })
    expect(screen.queryByRole('button', { name: 'Confirm repair' })).not.toBeInTheDocument()
  })

  it('allows a valid swap after compatibility is reconfirmed', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' }, { id: 'soup', name: 'Soup', active: true, safetyReview: 'approved' })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'tacos-slot', date: '2026-08-17', mealId: 'tacos' }, { id: 'soup-slot', date: '2026-08-18', mealId: 'soup' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    fireEvent.change(screen.getByLabelText('Hard restriction'), { target: { value: 'Peanuts' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add restriction' }))
    expect(screen.getAllByRole('button', { name: 'Review needed' })).toHaveLength(2)
    fireEvent.change(screen.getByLabelText('Safety review for Tacos'), { target: { value: 'approved' } })
    fireEvent.change(screen.getByLabelText('Safety review for Soup'), { target: { value: 'approved' } })
    openPlanRepair()
    fireEvent.click(screen.getByRole('button', { name: 'Swap with Soup' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))

    expect(screen.queryByRole('button', { name: 'Review needed' })).not.toBeInTheDocument()
  })

  it('keeps a repair preview, notices, storage, and rendered plan unchanged when repair confirmation fails V3 validation', () => {
    const duplicateId = '00000000-0000-0000-0000-000000000001'
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' }, { id: 'soup', name: 'Soup', active: true, safetyReview: 'approved' })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'tacos-slot', date: '2026-08-17', mealId: 'tacos' }, { id: 'soup-slot', date: '2026-08-18', mealId: 'soup' }], repairRevisions: [{ id: duplicateId, createdAt: '2026-08-17T00:00:00.000Z', slotId: 'tacos-slot', kind: 'swap' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    fireEvent.change(screen.getByLabelText('Hard restriction'), { target: { value: 'Peanuts' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add restriction' }))
    fireEvent.change(screen.getByLabelText('Safety review for Tacos'), { target: { value: 'approved' } })
    fireEvent.change(screen.getByLabelText('Safety review for Soup'), { target: { value: 'approved' } })
    const savedBeforeRepair = localStorage.getItem(APP_STATE_STORAGE_KEY)
    openPlanRepair()
    fireEvent.click(screen.getByRole('button', { name: 'Swap with Soup' }))
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(duplicateId)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))

    expect(localStorage.getItem(APP_STATE_STORAGE_KEY)).toBe(savedBeforeRepair)
    expect(screen.getAllByText(/2026-08-17: Tacos/)).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Confirm repair' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review needed' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Changes are invalid and were not applied.')
    expect(screen.getByRole('status')).not.toHaveTextContent('Plan repair confirmed.')
  })

  it('consumes a one-dinner leftover lot only when its repair is confirmed', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'tacos-slot', date: '2026-08-17', mealId: 'tacos' }] } as never)
    state.leftoverLots.push({ id: 'lot', sourcePlanId: 'plan', sourceSlotId: 'tacos-slot', sourceMealId: 'tacos', dinnerCoverage: 'one', active: true })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    openPlanRepair()
    fireEvent.click(screen.getByRole('button', { name: 'Use confirmed leftovers' }))
    expect(screen.getByText('Confirmed leftover lots consumed: lot.')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').leftoverLots[0]).toMatchObject({ active: true })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').leftoverLots[0]).toMatchObject({ active: false })
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].repairRevisions).toHaveLength(1)
    openPlanRepair()
    expect(screen.queryByRole('button', { name: 'Use confirmed leftovers' })).not.toBeInTheDocument()
  })
})

describe('Recipe Keeper import', () => {
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

  it('keeps state unchanged until confirmation, then saves a new meal with unknown safety', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    localStorage.setItem(APP_STATE_STORAGE_KEY, backup('old-meal'))
    render(<App />)
    const input = screen.getByLabelText('Recipe Keeper ZIP')
    const bytes = zipSync({ 'recipes.html': strToU8(recipeFixture), 'images/ignored.jpg': strToU8('image') })
    fireEvent.change(input, { target: { files: [{ arrayBuffer: () => Promise.resolve(bytes.buffer) }] } })

    await screen.findByText('Preview: Weeknight Soup — Dinner / Soup (2 ingredients)')
    expect(screen.getByLabelText('New to our household')).not.toBeChecked()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({ meals: [{ id: 'old-meal' }], recipes: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }))

    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      meals: expect.arrayContaining([expect.objectContaining({ name: 'Weeknight Soup', safetyReview: 'unknown' })]),
      recipes: expect.arrayContaining([expect.objectContaining({ title: 'Weeknight Soup', externalId: 'rk-1', source: { provider: 'Recipe Keeper', reference: 'Family notes' } })]),
    }))
  })

  it('marks an opted-in new meal unfamiliar and preserves an existing meal familiarity for recipe versions', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const state = createEmptyAppState()
    state.meals.push({ id: 'familiar', name: 'Existing dinner', active: true, provisional: false })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    render(<App />)
    const bytes = zipSync({ 'recipes.html': strToU8(recipeFixture) })
    const secondBytes = zipSync({ 'recipes.html': strToU8(recipeFixture.replace('rk-1', 'rk-2')) })
    fireEvent.change(screen.getByLabelText('Recipe Keeper ZIP'), { target: { files: [{ arrayBuffer: () => Promise.resolve(secondBytes.buffer) }] } })
    await screen.findByText(/Preview: Weeknight Soup/)
    fireEvent.click(screen.getByLabelText('New to our household'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').meals).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Weeknight Soup', provisional: true })])))

    fireEvent.change(screen.getByLabelText('Recipe Keeper ZIP'), { target: { files: [{ arrayBuffer: () => Promise.resolve(bytes.buffer) }] } })
    await screen.findByText(/Preview: Weeknight Soup/)
    fireEvent.click(screen.getByLabelText('Add as a version of an existing meal'))
    fireEvent.change(screen.getByLabelText('Existing meal'), { target: { value: 'familiar' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').meals).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'familiar', provisional: false, safetyReview: 'unknown' })])))
  })

  it('does not carry the unfamiliar opt-in from one candidate to another', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />)
    const second = recipeFixture.replace('rk-1', 'rk-2').replace('Weeknight Soup', 'Quick Pasta')
    const bytes = zipSync({ 'recipes.html': strToU8(recipeFixture.replace('</body>', `${second}</body>`)) })
    fireEvent.change(screen.getByLabelText('Recipe Keeper ZIP'), { target: { files: [{ arrayBuffer: () => Promise.resolve(bytes.buffer) }] } })
    await screen.findByText(/Preview: Weeknight Soup/)
    fireEvent.click(screen.getByLabelText('New to our household'))
    fireEvent.change(screen.getByLabelText('Recipe'), { target: { value: 'rk-2' } })
    expect(screen.getByLabelText('New to our household')).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').meals).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Quick Pasta' })])))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').meals.find((meal: { name: string }) => meal.name === 'Quick Pasta')).not.toHaveProperty('provisional')
  })

  it('saves the visible filtered candidate after saving another import', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />)
    const secondRecipe = recipeFixture
      .replace('rk-1', 'rk-2')
      .replace('Weeknight Soup', 'Hidden Salad')
    const thirdRecipe = recipeFixture
      .replace('rk-1', 'rk-3')
      .replace('Weeknight Soup', 'Quick Pasta')
    const bytes = zipSync({ 'recipes.html': strToU8(recipeFixture.replace('</body>', `${secondRecipe}${thirdRecipe}</body>`)) })
    fireEvent.change(screen.getByLabelText('Recipe Keeper ZIP'), { target: { files: [{ arrayBuffer: () => Promise.resolve(bytes.buffer) }] } })

    await screen.findByText(/Preview: Weeknight Soup/)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }))
    await screen.findByText('Recipe saved. Confirm compatibility before planning.')
    fireEvent.change(screen.getByLabelText('Search recipes'), { target: { value: 'Quick Pasta' } })

    const confirmImport = screen.getByRole('button', { name: 'Confirm import' })
    expect(confirmImport).toBeEnabled()
    fireEvent.click(confirmImport)
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').recipes).toEqual([
      expect.objectContaining({ title: 'Weeknight Soup', externalId: 'rk-1' }),
      expect.objectContaining({ title: 'Quick Pasta', externalId: 'rk-3' }),
    ]))
  })

  it('does not turn an overlong imported title into an invalid new meal', async () => {
    const { container } = render(<App />)
    const bytes = zipSync({ 'recipes.html': strToU8(recipeFixture.replace('Weeknight Soup', 'x'.repeat(161))) })
    fireEvent.change(screen.getByLabelText('Recipe Keeper ZIP'), { target: { files: [{ arrayBuffer: () => Promise.resolve(bytes.buffer) }] } })

    await screen.findByText(/Preview: x{161}/)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }))

    expect(screen.getByRole('status')).toHaveTextContent('Save recipe only or choose an existing meal; this title is too long for a new meal.')
    expect(container.querySelectorAll('.meal-list li')).toHaveLength(0)
  })

  it('keeps save-only recipes available for reassignment and marks affected plans for review', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const state = createEmptyAppState()
    state.meals.push(
      { id: 'old', name: 'Old meal', active: true, safetyReview: 'approved', recipeIds: ['saved-recipe'] },
      { id: 'new', name: 'New meal', active: true, safetyReview: 'approved' },
    )
    state.recipes.push({ id: 'saved-recipe', title: 'Saved recipe', mealId: 'old', ingredients: ['1 cup beans'] })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'old', recipeId: 'saved-recipe' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    const view = render(<App />)

    fireEvent.change(screen.getByLabelText('Meal association for Saved recipe'), { target: { value: 'new' } })
    const reassigned = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')
    expect(reassigned).toMatchObject({
      recipes: [expect.objectContaining({ id: 'saved-recipe', mealId: 'new' })],
      meals: [expect.objectContaining({ id: 'old', safetyReview: 'unknown' }), expect.objectContaining({ id: 'new', recipeIds: ['saved-recipe'], safetyReview: 'unknown' })],
    })
    expect(reassigned.meals.find((meal: { id: string }) => meal.id === 'old').recipeIds ?? []).not.toContain('saved-recipe')
    expect(screen.getByRole('button', { name: 'Review needed' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start cooking Old meal' })).toBeDisabled()
    view.unmount(); render(<App />)
    expect(screen.getByRole('button', { name: 'Review needed' })).toBeInTheDocument()
    expect(screen.getByLabelText('Meal association for Saved recipe')).toHaveValue('new')
    expect(screen.getByLabelText('Ingredients for Saved recipe')).toHaveTextContent('1 cup beans')

    fireEvent.change(screen.getByLabelText('Meal association for Saved recipe'), { target: { value: '' } })
    const unlinked = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')
    expect(unlinked.recipes[0]).not.toHaveProperty('mealId')
    expect(unlinked.meals.find((meal: { id: string }) => meal.id === 'new').recipeIds ?? []).not.toContain('saved-recipe')
  })

  it('associates a reloaded save-only import with an existing meal', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const state = createEmptyAppState()
    state.meals.push({ id: 'soup', name: 'Soup', active: true })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    const first = render(<App />)
    const bytes = zipSync({ 'recipes.html': strToU8(recipeFixture) })
    fireEvent.change(screen.getByLabelText('Recipe Keeper ZIP'), { target: { files: [{ arrayBuffer: () => Promise.resolve(bytes.buffer) }] } })
    await screen.findByText(/Preview: Weeknight Soup/)
    fireEvent.click(screen.getByLabelText('Save recipe only'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }))
    await screen.findByText('Recipe saved without a meal.')
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').recipes[0]).not.toHaveProperty('mealId')

    first.unmount(); render(<App />)
    fireEvent.change(screen.getByLabelText('Meal association for Weeknight Soup'), { target: { value: 'soup' } })
    expect(screen.getByText('1 linked recipe. Grocery ingredients are available.')).toBeInTheDocument()
    expect(screen.getByLabelText('Ingredients for Weeknight Soup')).toBeInTheDocument()
  })

  it('preserves completed recipe attribution after reassignment', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'old', name: 'Old meal', active: true, recipeIds: ['recipe'] }, { id: 'new', name: 'New meal', active: true })
    state.recipes.push({ id: 'recipe', title: 'Saved recipe', mealId: 'old' })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'old', recipeId: 'recipe', cookingStartedAt: '2026-08-17T17:00:00.000Z', dinnerReadyAt: '2026-08-17T17:25:00.000Z' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    const view = render(<App />)

    fireEvent.change(screen.getByLabelText('Meal association for Saved recipe'), { target: { value: 'new' } })
    const persisted = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')
    expect(persisted.recipes[0]).toMatchObject({ mealId: 'new' })
    expect(persisted.plans[0].slots[0]).toMatchObject({ id: 'slot', mealId: 'old', recipeId: 'recipe', cookingStartedAt: '2026-08-17T17:00:00.000Z', dinnerReadyAt: '2026-08-17T17:25:00.000Z' })
    expect(() => importAppState(JSON.stringify(persisted))).not.toThrow()
    view.unmount(); render(<App />)
    expect(screen.queryByRole('button', { name: 'Review needed' })).not.toBeInTheDocument()
  })

  it('repairs an unfinished reassigned recipe to a cookable associated meal', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const state = createEmptyAppState()
    state.meals.push({ id: 'old', name: 'Old meal', active: false, recipeIds: ['recipe'] }, { id: 'new', name: 'New meal', active: true })
    state.recipes.push({ id: 'recipe', title: 'Saved recipe', mealId: 'old' })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'old', recipeId: 'recipe' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    render(<App />)

    fireEvent.change(screen.getByLabelText('Meal association for Saved recipe'), { target: { value: 'new' } })
    expect(screen.getByRole('button', { name: 'Review needed' })).toBeInTheDocument()
    openPlanRepair()
    fireEvent.click(screen.getByRole('button', { name: 'Replan with eligible meal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))
    const persisted = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')
    expect(persisted.plans[0].slots[0]).toMatchObject({ mealId: 'new', recipeId: 'recipe' })
    expect(() => importAppState(JSON.stringify(persisted))).not.toThrow()
    expect(screen.queryByRole('button', { name: 'Review needed' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start cooking New meal' })).toBeEnabled()
  })

  it('clears candidates and preserves saved state after an importer failure', async () => {
    localStorage.setItem(APP_STATE_STORAGE_KEY, backup('old-meal'))
    render(<App />)
    const input = screen.getByLabelText('Recipe Keeper ZIP')
    fireEvent.change(input, { target: { files: [{ size: 1, arrayBuffer: () => Promise.resolve(zipSync({ 'recipes.html': strToU8(recipeFixture) }).buffer) }] } })
    await screen.findByText(/Preview: Weeknight Soup/)
    fireEvent.change(input, { target: { files: [{ size: 1, arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer) }] } })
    await waitFor(() => expect(screen.queryByText(/Preview: Weeknight Soup/)).not.toBeInTheDocument())
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({ meals: [{ id: 'old-meal' }], recipes: [] })
  })

  it('does not read oversized files and keeps state unchanged when confirmation is cancelled', async () => {
    const read = vi.fn(); localStorage.setItem(APP_STATE_STORAGE_KEY, backup('old-meal'))
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<App />)
    fireEvent.change(screen.getByLabelText('Recipe Keeper ZIP'), { target: { files: [{ size: 32 * 1024 * 1024 + 1, arrayBuffer: read }] } })
    expect(read).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('32 MiB')
    const bytes = zipSync({ 'recipes.html': strToU8(recipeFixture) })
    fireEvent.change(screen.getByLabelText('Recipe Keeper ZIP'), { target: { files: [{ size: bytes.length, arrayBuffer: () => Promise.resolve(bytes.buffer) }] } })
    await screen.findByText(/Preview: Weeknight Soup/)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({ meals: [{ id: 'old-meal' }], recipes: [] })
  })

  it.each([
    ['recipe storage', (state: ReturnType<typeof createEmptyAppState>) => { state.recipes.push(...Array.from({ length: 1000 }, (_, index) => ({ id: `recipe-${index}`, title: 'Saved' }))) }, 'Recipe storage is full'],
    ['meal storage', (state: ReturnType<typeof createEmptyAppState>) => { state.meals.push(...Array.from({ length: 500 }, (_, index) => ({ id: `meal-${index}`, name: 'Saved', active: true }))) }, 'Meal storage is full'],
    ['meal recipe links', (state: ReturnType<typeof createEmptyAppState>) => { const recipeIds = Array.from({ length: 50 }, (_, index) => `recipe-${index}`); state.recipes.push(...recipeIds.map((id) => ({ id, title: 'Saved' }))); state.meals.push({ id: 'meal-1', name: 'Saved', active: true, recipeIds }) }, 'maximum number of recipes'],
  ])('does not dispatch when %s is at capacity', async (_name, prepare, message) => {
    const state = createEmptyAppState(); prepare(state); localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    render(<App />)
    const bytes = zipSync({ 'recipes.html': strToU8(recipeFixture) })
    fireEvent.change(screen.getByLabelText('Recipe Keeper ZIP'), { target: { files: [{ size: bytes.length, arrayBuffer: () => Promise.resolve(bytes.buffer) }] } })
    await screen.findByText(/Preview: Weeknight Soup/)
    if (message === 'maximum number of recipes') {
      fireEvent.click(screen.getByLabelText('Add as a version of an existing meal'))
      fireEvent.change(screen.getByLabelText('Existing meal'), { target: { value: 'meal-1' } })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }))
    expect(screen.getByRole('status')).toHaveTextContent(message)
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toEqual(state)
  }, 10_000)
})

describe('cooking outcomes', () => {
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); vi.useRealTimers() })

  it('carries a linked recovery through confirmed repair, completion, and household learning', () => {
    const state = createEmptyAppState()
    state.household.diners.push({ id: 'ava', name: 'Ava', active: true })
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, recoveryMealIds: ['soup'] }, { id: 'soup', name: 'Soup', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'tacos', expectedDinerIds: ['ava'] }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const view = render(<App />)
    fireEvent.change(screen.getByLabelText('Plan to repair'), { target: { value: 'plan' } })
    fireEvent.change(screen.getByLabelText('Date to repair'), { target: { value: 'slot' } })
    fireEvent.click(screen.getByRole('button', { name: 'Plans changed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use recovery Soup' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].repairRevisions).toEqual([expect.objectContaining({ slotId: 'slot', kind: 'recovery' })])

    fireEvent.click(screen.getByRole('button', { name: 'Start cooking Soup' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dinner’s ready Soup' }))
    const saved = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')
    saved.plans[0].slots[0].feedbackEligibleAt = '2020-01-01T00:00:00.000Z'
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(saved))
    view.unmount()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }))
    fireEvent.change(screen.getByLabelText('Feedback for Ava'), { target: { value: 'accepted' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }))

    const outcomes = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').outcomes
    expect(outcomes).toEqual([expect.objectContaining({ mealId: 'soup', acceptance: 'accepted', recoveryClassification: 'successful' })])
    expect(mealLearning(outcomes, 'soup')).toMatchObject({ confidence: 'Learning', relevant: 1 })
  })

  it('persists cooking timestamps and only opens delayed feedback after a reload', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T17:00:00.000Z'))
    const state = createEmptyAppState()
    state.household.diners.push({ id: 'ava', name: 'Ava', active: true })
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'tacos' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    const first = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Start cooking Tacos' }))
    vi.setSystemTime(new Date('2026-08-17T17:25:00.000Z'))
    fireEvent.click(screen.getByRole('button', { name: 'Dinner’s ready Tacos' }))
    expect(screen.queryByRole('heading', { name: 'Dinner feedback' })).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].slots[0]).toMatchObject({ cookingStartedAt: '2026-08-17T17:00:00.000Z', dinnerReadyAt: '2026-08-17T17:25:00.000Z', feedbackEligibleAt: '2026-08-17T17:55:00.000Z', expectedDinerIds: ['ava'] })
    first.unmount()
    vi.setSystemTime(new Date('2026-08-17T17:56:00.000Z'))

    render(<App />)
    expect(screen.queryByRole('heading', { name: 'Dinner feedback' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }))
    fireEvent.change(screen.getByLabelText('Feedback for Ava'), { target: { value: 'rejected' } })
    fireEvent.change(screen.getByLabelText('Leftover coverage'), { target: { value: 'some' } })
    fireEvent.change(screen.getByLabelText('Active effort minutes'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').outcomes).toEqual([expect.objectContaining({ acceptance: 'rejected', personFeedback: [{ dinerId: 'ava', acceptance: 'rejected' }], activeEffortMinutes: 12, leftoverCoverage: 'some', recoveryClassification: 'none' })])
    fireEvent.click(screen.getByRole('button', { name: 'Correct feedback' }))
    expect(screen.getByLabelText('Active effort minutes')).toHaveValue(12)
    expect(screen.getByLabelText('Leftover coverage')).toHaveValue('some')
    fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').outcomes).toEqual([expect.any(Object), expect.objectContaining({ correctionOfOutcomeId: expect.any(String), activeEffortMinutes: 12, leftoverCoverage: 'some' })])
  })

  it('records a cooked dinner without timing, unlocks planned leftovers, and omits elapsed feedback evidence', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-17T18:00:00.000Z'))
    const state = createEmptyAppState()
    state.household.diners.push({ id: 'ava', name: 'Ava', active: true })
    state.meals.push({ id: 'soup', name: 'Soup', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'source', date: '2026-08-17', mealId: 'soup' }, { id: 'dependent', date: '2026-08-18', mealId: 'soup', leftoverFromSlotId: 'source' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    const view = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Record dinner without timing Soup' }))
    const saved = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')
    expect(saved.plans[0].slots[0]).toMatchObject({ dinnerReadyAt: '2026-08-17T18:00:00.000Z', feedbackEligibleAt: '2026-08-17T18:30:00.000Z', expectedDinerIds: ['ava'] })
    expect(saved.plans[0].slots[0]).not.toHaveProperty('cookingStartedAt')
    expect(screen.getByRole('button', { name: 'Dinner’s ready Soup' })).toBeEnabled()

    vi.setSystemTime(new Date('2026-08-17T18:31:00.000Z'))
    view.unmount()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }))
    fireEvent.change(screen.getByLabelText('Feedback for Ava'), { target: { value: 'accepted' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }))
    const outcome = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').outcomes[0]
    expect(outcome).not.toHaveProperty('cookingStartedAt')
    expect(outcome).not.toHaveProperty('dinnerReadyAt')
  })

  it('does not offer timing-unknown recovery for a future dinner', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-17T18:00:00.000Z'))
    const state = createEmptyAppState()
    state.meals.push({ id: 'soup', name: 'Soup', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'future', date: '2026-08-18', mealId: 'soup' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    expect(screen.queryByRole('button', { name: 'Record dinner without timing Soup' })).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].slots[0]).not.toHaveProperty('dinnerReadyAt')
  })

  it('does not save dinner-covering feedback when leftover history is full', () => {
    const state = createEmptyAppState()
    state.household.diners.push({ id: 'ava', name: 'Ava', active: true })
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'tacos', cookingStartedAt: '2026-08-17T17:00:00.000Z', dinnerReadyAt: '2026-08-17T17:25:00.000Z', feedbackEligibleAt: '2020-01-01T17:55:00.000Z', expectedDinerIds: ['ava'] }] } as never)
    state.leftoverLots.push(...Array.from({ length: 500 }, (_, index) => ({ id: `lot-${index}`, sourcePlanId: 'plan', sourceSlotId: 'slot', sourceMealId: 'tacos', dinnerCoverage: 'one' as const, active: false })))
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }))
    fireEvent.change(screen.getByLabelText('Leftover coverage'), { target: { value: 'one' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }))

    expect(screen.getByRole('status')).toHaveTextContent('Leftover storage is full.')
    const saved = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')
    expect(saved.outcomes).toEqual([])
    expect(saved.leftoverLots).toHaveLength(500)
  })

  it('reopens dismissed feedback with the dinner-time diner snapshot and preserves the neutral reason', () => {
    const state = createEmptyAppState()
    state.household.diners.push({ id: 'ava', name: 'Ava', active: false })
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'tacos', cookingStartedAt: '2026-08-17T17:00:00.000Z', dinnerReadyAt: '2026-08-17T17:25:00.000Z', feedbackEligibleAt: '2020-01-01T17:55:00.000Z', feedbackDismissed: true, expectedDinerIds: ['ava'] }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }))
    fireEvent.change(screen.getByLabelText('Feedback for Ava'), { target: { value: 'not-hungry' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').outcomes).toEqual([expect.objectContaining({ acceptance: 'neutral', personFeedback: [{ dinerId: 'ava', acceptance: 'neutral', neutralReason: 'not-hungry' }] })])
  })

  it('hides early history feedback and keeps blank active effort unknown', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-17T17:30:00.000Z'))
    const state = createEmptyAppState()
    state.household.diners.push({ id: 'ava', name: 'Ava', active: true })
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'tacos', cookingStartedAt: '2026-08-17T17:00:00.000Z', dinnerReadyAt: '2026-08-17T17:20:00.000Z', feedbackEligibleAt: '2026-08-17T18:00:00.000Z', feedbackDismissed: true, expectedDinerIds: ['ava'] }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    const first = render(<App />)
    expect(screen.queryByRole('button', { name: 'Add feedback' })).not.toBeInTheDocument()
    first.unmount()
    state.plans[0].slots[0].feedbackEligibleAt = '2026-08-17T17:00:00.000Z'
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').outcomes[0]).not.toHaveProperty('activeEffortMinutes')
  })

  it('records a linked leftover dinner without cooking or effort', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-19T18:00:00.000Z'))
    const state = createEmptyAppState()
    state.meals.push({ id: 'soup', name: 'Soup', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'source', date: '2026-08-17', mealId: 'soup', cookingStartedAt: '2026-08-17T17:00:00.000Z', dinnerReadyAt: '2026-08-17T18:00:00.000Z' }, { id: 'normal', date: '2026-08-18', mealId: 'soup' }, { id: 'target', date: '2026-08-19', mealId: 'soup', leftoverFromSlotId: 'source' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    const view = render(<App />)
    expect(screen.getAllByRole('button', { name: 'Start cooking Soup' })).toHaveLength(1)
    const ready = screen.getAllByRole('button', { name: 'Dinner’s ready Soup' })
    fireEvent.click(ready[1])
    expect(screen.getByRole('status')).toHaveTextContent('Dinner recorded')
    vi.setSystemTime(new Date('2026-08-19T18:31:00.000Z'))
    view.unmount()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }))
    expect(screen.queryByLabelText('Active effort minutes')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }))
    const outcome = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').outcomes[0]
    expect(outcome).not.toHaveProperty('activeEffortMinutes')
    expect(outcome).not.toHaveProperty('cookingStartedAt')
    expect(outcome).not.toHaveProperty('dinnerReadyAt')
    expect(outcome).not.toHaveProperty('leftoverCoverage')
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').leftoverLots).toEqual([])
  })

  it('requires the source dinner to be ready before completing planned leftovers', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'soup', name: 'Soup', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'source', date: '2026-08-17', mealId: 'soup' }, { id: 'target', date: '2026-08-19', mealId: 'soup', leftoverFromSlotId: 'source' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    expect(screen.getAllByRole('button', { name: 'Dinner’s ready Soup' })[1]).toBeDisabled()
    expect(screen.getByText('Mark the source dinner ready before serving leftovers.')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].slots[1].dinnerReadyAt).toBeUndefined()
  })

  it('records an actual leftover dinner without showing cooking controls or saving cooking metrics', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-19T18:00:00.000Z'))
    const state = createEmptyAppState()
    state.meals.push({ id: 'soup', name: 'Soup', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'source', date: '2026-08-17', mealId: 'soup' }, { id: 'actual', date: '2026-08-19', mealId: 'soup', leftoverLotIds: ['lot'] }] } as never)
    state.leftoverLots.push({ id: 'lot', sourcePlanId: 'plan', sourceSlotId: 'source', sourceMealId: 'soup', dinnerCoverage: 'one', active: true })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    const view = render(<App />)
    expect(screen.getAllByRole('button', { name: 'Start cooking Soup' })).toHaveLength(1)
    fireEvent.click(screen.getAllByRole('button', { name: 'Dinner’s ready Soup' })[1])
    expect(screen.getByRole('status')).toHaveTextContent('Dinner recorded.')
    vi.setSystemTime(new Date('2026-08-19T18:31:00.000Z'))
    view.unmount()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }))
    expect(screen.queryByLabelText('Active effort minutes')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }))
    const outcome = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').outcomes[0]
    expect(outcome).toMatchObject({ leftoverServing: true })
    expect(outcome).not.toHaveProperty('activeEffortMinutes')
    expect(outcome).not.toHaveProperty('cookingStartedAt')
    expect(outcome).not.toHaveProperty('dinnerReadyAt')
  })

  it('keeps an actual-leftover dinner blocked after reload when its lot is inactive', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'soup', name: 'Soup', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'source', date: '2026-08-17', mealId: 'soup' }, { id: 'actual', date: '2026-08-19', mealId: 'soup', leftoverLotIds: ['lot'] }] } as never)
    state.leftoverLots.push({ id: 'lot', sourcePlanId: 'plan', sourceSlotId: 'source', sourceMealId: 'soup', dinnerCoverage: 'one', active: false })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)

    expect(screen.getByRole('button', { name: 'Review needed' })).toBeInTheDocument()
    const actualDinner = screen.getAllByRole('listitem').find((item) => item.textContent?.startsWith('2026-08-19: Soup'))!
    expect(within(actualDinner).queryByRole('button', { name: 'Start cooking Soup' })).not.toBeInTheDocument()
    expect(within(actualDinner).getByRole('button', { name: 'Dinner’s ready Soup' })).toBeDisabled()
  })

  it('records ordinary elapsed time but neither effort nor leftovers for takeout', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-19T18:00:00.000Z'))
    const state = createEmptyAppState()
    state.household.diners.push({ id: 'ava', name: 'Ava', active: true })
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'cook', date: '2026-08-17', mealId: 'tacos', cookingStartedAt: '2026-08-17T17:00:00.000Z', dinnerReadyAt: '2026-08-17T17:25:00.000Z', feedbackEligibleAt: '2020-01-01T00:00:00.000Z', feedbackDismissed: true }, { id: 'takeout', date: '2026-08-19' }], repairRevisions: [{ id: 'takeout-repair', createdAt: '2026-08-19T17:00:00.000Z', slotId: 'takeout', kind: 'takeout', takeoutContext: 'planned' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    const view = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').outcomes[0]).toMatchObject({ dinnerReadyAt: '2026-08-17T17:25:00.000Z' })
    fireEvent.click(screen.getByRole('button', { name: 'Dinner’s ready Takeout' }))
    view.unmount(); vi.setSystemTime(new Date('2026-08-19T18:31:00.000Z')); render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }))
    fireEvent.change(screen.getByLabelText('Feedback for Ava'), { target: { value: 'accepted' } })
    expect(screen.queryByLabelText('Active effort minutes')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Leftover coverage')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').outcomes[1]).toMatchObject({ recoveryClassification: 'successful' })
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').outcomes[1]).not.toHaveProperty('cookingStartedAt')
  })

  it('retroactively corrects a completed dinner to attributed takeout without retaining cooking evidence', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-19', mealId: 'tacos', cookingStartedAt: '2026-08-19T17:00:00.000Z', dinnerReadyAt: '2026-08-19T18:00:00.000Z' }] } as never)
    state.outcomes.push({ id: 'outcome', planId: 'plan', planSlotId: 'slot', mealId: 'tacos', cookingStartedAt: '2026-08-19T17:00:00.000Z', dinnerReadyAt: '2026-08-19T18:00:00.000Z', activeEffortMinutes: 25, leftoverCoverage: 'one' } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    fireEvent.change(screen.getByLabelText('Plan to repair'), { target: { value: 'plan' } })
    fireEvent.change(screen.getByLabelText('Date to repair'), { target: { value: 'slot' } })
    fireEvent.click(screen.getByRole('button', { name: 'Plans changed' }))
    fireEvent.change(screen.getByLabelText('Takeout context'), { target: { value: 'unforeseeable-disruption' } })
    fireEvent.click(screen.getByRole('button', { name: 'Choose takeout' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))

    const saved = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')
    expect(saved.plans[0].slots[0]).toMatchObject({ dinnerReadyAt: '2026-08-19T18:00:00.000Z' })
    expect(saved.plans[0].slots[0]).not.toHaveProperty('mealId')
    expect(saved.plans[0].slots[0]).not.toHaveProperty('cookingStartedAt')
    expect(saved.plans[0].repairRevisions).toEqual(expect.arrayContaining([expect.objectContaining({ slotId: 'slot', kind: 'takeout', takeoutContext: 'unforeseeable-disruption' })]))
    expect(saved.outcomes).toEqual([expect.any(Object), expect.objectContaining({ correctionOfOutcomeId: 'outcome', planId: 'plan', planSlotId: 'slot', dinnerReadyAt: '2026-08-19T18:00:00.000Z' })])
    expect(saved.outcomes[1]).not.toHaveProperty('mealId')
    expect(saved.outcomes[1]).not.toHaveProperty('cookingStartedAt')
    expect(saved.outcomes[1]).not.toHaveProperty('activeEffortMinutes')
    expect(saved.outcomes[1]).not.toHaveProperty('leftoverCoverage')
  })

  it('persists a completed cooking-source correction after deactivating its produced lot', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'chili', name: 'Chili', active: true }, { id: 'soup', name: 'Soup', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'source', date: '2026-08-19', mealId: 'chili', cookingStartedAt: '2026-08-19T17:00:00.000Z', dinnerReadyAt: '2026-08-19T18:00:00.000Z' }, { id: 'dependent', date: '2026-08-20', mealId: 'chili', leftoverLotIds: ['produced'] }] } as never)
    state.leftoverLots.push({ id: 'produced', sourcePlanId: 'plan', sourceSlotId: 'source', sourceMealId: 'chili', dinnerCoverage: 'one', active: true })
    state.outcomes.push({ id: 'outcome', planId: 'plan', planSlotId: 'source', mealId: 'chili', cookingStartedAt: '2026-08-19T17:00:00.000Z', dinnerReadyAt: '2026-08-19T18:00:00.000Z', activeEffortMinutes: 25, leftoverCoverage: 'one' } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    fireEvent.change(screen.getByLabelText('Plan to repair'), { target: { value: 'plan' } })
    fireEvent.change(screen.getByLabelText('Date to repair'), { target: { value: 'source' } })
    fireEvent.click(screen.getByRole('button', { name: 'Plans changed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose takeout' }))
    expect(screen.getByText(/2026-08-20: Chili.*confirmed leftover lots: produced.*none/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))

    const saved = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')
    expect(saved.leftoverLots[0]).toMatchObject({ id: 'produced', active: false })
    expect(saved.plans[0].slots.find((slot: { id: string }) => slot.id === 'dependent')).not.toHaveProperty('leftoverLotIds')
    expect(saved.outcomes).toEqual([expect.any(Object), expect.objectContaining({ correctionOfOutcomeId: 'outcome', planSlotId: 'source' })])
    expect(saved.outcomes[1]).not.toHaveProperty('mealId')
    expect(saved.outcomes[1]).not.toHaveProperty('cookingStartedAt')
    expect(saved.outcomes[1]).not.toHaveProperty('leftoverCoverage')
  })

  it('persists a completed actual-leftover correction after releasing its lot and superseding leftover evidence', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'soup', name: 'Soup', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'source', date: '2026-08-18', mealId: 'soup', cookingStartedAt: '2026-08-18T17:00:00.000Z', dinnerReadyAt: '2026-08-18T18:00:00.000Z' }, { id: 'target', date: '2026-08-19', mealId: 'soup', leftoverLotIds: ['lot'], dinnerReadyAt: '2026-08-19T18:00:00.000Z' }] } as never)
    state.leftoverLots.push({ id: 'lot', sourcePlanId: 'plan', sourceSlotId: 'source', sourceMealId: 'soup', dinnerCoverage: 'one', active: false })
    state.outcomes.push({ id: 'outcome', planId: 'plan', planSlotId: 'target', mealId: 'soup', dinnerReadyAt: '2026-08-19T18:00:00.000Z', leftoverServing: true } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    fireEvent.change(screen.getByLabelText('Plan to repair'), { target: { value: 'plan' } })
    fireEvent.change(screen.getByLabelText('Date to repair'), { target: { value: 'target' } })
    fireEvent.click(screen.getByRole('button', { name: 'Plans changed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose takeout' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))

    const saved = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')
    expect(saved.leftoverLots[0]).toMatchObject({ id: 'lot', active: true })
    expect(saved.plans[0].slots.find((slot: { id: string }) => slot.id === 'target')).not.toHaveProperty('leftoverLotIds')
    expect(saved.outcomes).toEqual([expect.any(Object), expect.objectContaining({ correctionOfOutcomeId: 'outcome', planSlotId: 'target' })])
    expect(saved.outcomes[1]).not.toHaveProperty('mealId')
    expect(saved.outcomes[1]).not.toHaveProperty('cookingStartedAt')
    expect(saved.outcomes[1]).not.toHaveProperty('leftoverServing')
  })

  it('atomically replans an unfinished actual-leftover consumer in another plan', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'chili', name: 'Chili', active: false }, { id: 'soup', name: 'Soup', active: true, recipeIds: ['soup-recipe'] })
    state.recipes.push({ id: 'soup-recipe', title: 'Soup', mealId: 'soup', ingredients: ['1 cup tomatoes'] })
    state.plans.push({ id: 'source-plan', confirmed: true, slots: [{ id: 'source', date: '2026-08-19', mealId: 'chili', cookingStartedAt: '2026-08-19T17:00:00.000Z', dinnerReadyAt: '2026-08-19T18:00:00.000Z' }] } as never, { id: 'consumer-plan', confirmed: true, slots: [{ id: 'consumer', date: '2026-08-20', mealId: 'chili', leftoverLotIds: ['produced'] }], shopping: { confirmedAt: '2026-08-18T12:00:00.000Z', partial: false, skippedIncompleteMealIds: [], items: [{ id: 'consumer:0', label: '1 cup tomatoes', sourceLines: ['1 cup tomatoes'], sourceSlotIds: ['consumer'], mealIds: ['chili'], perishable: true, availability: 'available' }] } } as never)
    state.leftoverLots.push({ id: 'produced', sourcePlanId: 'source-plan', sourceSlotId: 'source', sourceMealId: 'chili', dinnerCoverage: 'one', active: true })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    const before = localStorage.getItem(APP_STATE_STORAGE_KEY)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    fireEvent.change(screen.getByLabelText('Plan to repair'), { target: { value: 'source-plan' } })
    fireEvent.change(screen.getByLabelText('Date to repair'), { target: { value: 'source' } })
    fireEvent.click(screen.getByRole('button', { name: 'Plans changed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose takeout' }))
    expect(screen.getByText(/2026-08-20: Chili.*confirmed leftover lots: produced.*none/)).toBeInTheDocument()
    expect(screen.getByText(/Grocery changes: add.*tomatoes/)).toBeInTheDocument()
    expect(screen.getByLabelText('Acknowledge perishable grocery risk')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))
    expect(localStorage.getItem(APP_STATE_STORAGE_KEY)).toBe(before)
    fireEvent.click(screen.getByLabelText('Acknowledge perishable grocery risk'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))

    const saved = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')
    expect(saved.leftoverLots[0]).toMatchObject({ active: false })
    expect(saved.plans.find((plan: { id: string }) => plan.id === 'consumer-plan').slots[0]).not.toHaveProperty('leftoverLotIds')
    expect(saved.plans.find((plan: { id: string }) => plan.id === 'consumer-plan').repairRevisions).toEqual([expect.objectContaining({ slotId: 'consumer', kind: 'recovery', reason: 'replan' })])
    expect(saved.plans.find((plan: { id: string }) => plan.id === 'consumer-plan').repairRevisions[0]).toMatchObject({ perishableDisposition: 'acknowledged-preservation-risk' })
    expect(saved.plans.find((plan: { id: string }) => plan.id === 'consumer-plan').repairRevisions[0]).not.toHaveProperty('takeoutContext')
    expect(saved.plans.find((plan: { id: string }) => plan.id === 'source-plan').repairRevisions).toEqual([expect.objectContaining({ slotId: 'source', kind: 'takeout', takeoutContext: 'planned' })])
  })

  it('corrects a completed planned-leftover target without changing source cooking history', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'soup', name: 'Soup', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'source', date: '2026-08-18', mealId: 'soup', cookingStartedAt: '2026-08-18T17:00:00.000Z', dinnerReadyAt: '2026-08-18T18:00:00.000Z' }, { id: 'target', date: '2026-08-19', mealId: 'soup', leftoverFromSlotId: 'source', dinnerReadyAt: '2026-08-19T18:00:00.000Z' }] } as never)
    state.outcomes.push({ id: 'outcome', planId: 'plan', planSlotId: 'target', mealId: 'soup', dinnerReadyAt: '2026-08-19T18:00:00.000Z', leftoverServing: true } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state)); vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    fireEvent.change(screen.getByLabelText('Plan to repair'), { target: { value: 'plan' } }); fireEvent.change(screen.getByLabelText('Date to repair'), { target: { value: 'target' } }); fireEvent.click(screen.getByRole('button', { name: 'Plans changed' })); fireEvent.click(screen.getByRole('button', { name: 'Choose takeout' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))

    const saved = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')
    expect(saved.plans[0].slots[0]).toMatchObject({ cookingStartedAt: '2026-08-18T17:00:00.000Z', mealId: 'soup' })
    expect(saved.outcomes[1]).toMatchObject({ correctionOfOutcomeId: 'outcome' })
    expect(saved.outcomes[1]).not.toHaveProperty('leftoverServing')
    expect(saved.outcomes[1]).not.toHaveProperty('cookingStartedAt')
  })

  it('hides recipe-less and same-recipe simpler adaptations', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, recipeIds: ['tacos-r', 'tacos-other'], adaptations: [{ id: 'missing', name: 'Missing recipe', solvesIssue: true, coordinatedCooking: true, noSecondEntree: true, noUnplannedProtein: true, noSeparateTimeline: true, noExtraEffort: true }, { id: 'same', name: 'Same recipe', recipeId: 'tacos-r', solvesIssue: true, coordinatedCooking: true, noSecondEntree: true, noUnplannedProtein: true, noSeparateTimeline: true, noExtraEffort: true }] })
    state.recipes.push({ id: 'tacos-r', mealId: 'tacos', title: 'Tacos' }, { id: 'tacos-other', mealId: 'tacos', title: 'Other tacos' })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-19', mealId: 'tacos', recipeId: 'tacos-other' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    openPlanRepair()
    expect(screen.queryByRole('button', { name: 'Use Missing recipe' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use Same recipe' })).not.toBeInTheDocument()
  })

  it('supersedes a corrected leftover lot instead of leaving two active lots', () => {
    const state = createEmptyAppState()
    state.household.diners.push({ id: 'ava', name: 'Ava', active: true })
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'tacos', cookingStartedAt: '2020-01-01T17:00:00.000Z', dinnerReadyAt: '2020-01-01T17:20:00.000Z', feedbackEligibleAt: '2020-01-01T18:00:00.000Z', feedbackDismissed: true, expectedDinerIds: ['ava'] }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }))
    fireEvent.change(screen.getByLabelText('Leftover coverage'), { target: { value: 'one' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }))
    fireEvent.click(screen.getByRole('button', { name: 'Correct feedback' }))
    fireEvent.change(screen.getByLabelText('Leftover coverage'), { target: { value: 'none' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').leftoverLots).toEqual([expect.objectContaining({ dinnerCoverage: 'one', active: false })])
  })

  it('keeps feedback actions available for older confirmed plans', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true }, { id: 'soup', name: 'Soup', active: true })
    state.plans.push(
      { id: 'old', confirmed: true, slots: [{ id: 'old-slot', date: '2026-08-15', mealId: 'tacos', cookingStartedAt: '2020-01-01T17:00:00.000Z', dinnerReadyAt: '2020-01-01T17:20:00.000Z', feedbackEligibleAt: '2020-01-01T18:00:00.000Z', feedbackDismissed: true }, { id: 'old-cook', date: '2026-08-15', mealId: 'tacos' }] },
      { id: 'middle', confirmed: true, slots: [{ id: 'middle-slot', date: '2026-08-16', mealId: 'tacos', cookingStartedAt: '2020-01-01T17:00:00.000Z', dinnerReadyAt: '2020-01-01T17:20:00.000Z', feedbackEligibleAt: '2020-01-01T18:00:00.000Z' }] },
      { id: 'new', confirmed: true, slots: [{ id: 'new-slot', date: '2026-08-17', mealId: 'soup' }] },
    )
    state.outcomes.push({ id: 'middle-outcome', planId: 'middle', planSlotId: 'middle-slot', mealId: 'tacos', acceptance: 'accepted' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    expect(screen.getByRole('button', { name: 'Start cooking Tacos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dinner’s ready Tacos' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Start cooking Soup' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }))
    expect(screen.getByRole('heading', { name: 'Dinner feedback' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    fireEvent.click(screen.getByRole('button', { name: 'Correct feedback' }))
    expect(screen.getByRole('heading', { name: 'Dinner feedback' })).toBeInTheDocument()
  })

  it('lets the household mark a hands-off night and selected slow-cooker recipe before previewing', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'slow', name: 'Slow stew', active: true, safetyReview: 'approved', recipeIds: ['slow-r'] }, { id: 'other', name: 'Other dinner', active: true, safetyReview: 'approved' })
    state.recipes.push({ id: 'slow-r', title: 'Slow stew', mealId: 'slow' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.click(screen.getByLabelText('Hands-off slow cooker Slow stew'))
    fireEvent.change(screen.getByLabelText('Exception date'), { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByLabelText('Hands-off night'))
    fireEvent.click(screen.getByRole('button', { name: 'Add exception' }))
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))

    expect(screen.getByText(/Fits this hands-off night with the selected slow-cooker recipe/)).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').household.scheduleExceptions).toEqual([expect.objectContaining({ date: '2026-08-17', handsOff: true })])
  })

  it('shows only the blocked hands-off date for takeout and keeps exclusions collapsed', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'first', name: 'First', active: true, safetyReview: 'approved' }, { id: 'second', name: 'Second', active: true, safetyReview: 'approved' })
    state.household.scheduleExceptions.push({ id: 'hands-off', date: '2026-08-25', handsOff: true })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    const { container } = render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    expect(screen.getByText(/2026-08-25 needs a hands-off dinner/)).toBeInTheDocument()
    expect(screen.getByText(/Mark a slow-cooker recipe, plan leftovers, change this schedule exception to quick-cook/)).toBeInTheDocument()
    expect(screen.queryByText('Add or confirm a meal that fits every constrained or hands-off night.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Plan takeout for 2026-08-25' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Plan takeout for 2026-08-26' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm weekly plan' })).not.toBeInTheDocument()
    const exclusions = container.querySelector('details')
    expect(exclusions).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('2 meal exclusions'))
    expect(screen.getAllByText(/Does not fit hands-off night on 2026-08-25/)).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Plan takeout for 2026-08-25' }))

    expect(screen.getByRole('button', { name: 'Confirm weekly plan' })).toBeInTheDocument()
  })

  it('does not offer automatic replan for an unfinished planned-takeout slot', () => {
    const state = createEmptyAppState()
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'takeout', date: '2026-08-17' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Plan to repair'), { target: { value: 'plan' } })
    fireEvent.change(screen.getByLabelText('Date to repair'), { target: { value: 'takeout' } })
    fireEvent.click(screen.getByRole('button', { name: 'Plans changed' }))

    expect(screen.queryByRole('button', { name: 'Replan with eligible meal' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose takeout' })).toBeInTheDocument()
  })

  it('handles a hands-off plan through replan, completion, and completed takeout correction', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'slow', name: 'Slow stew', active: true, safetyReview: 'approved', recipeIds: ['slow-r'] }, { id: 'other', name: 'Other dinner', active: true, safetyReview: 'approved' })
    state.recipes.push({ id: 'slow-r', title: 'Slow stew', mealId: 'slow' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    fireEvent.click(screen.getByLabelText('Hands-off slow cooker Slow stew'))
    fireEvent.change(screen.getByLabelText('Exception date'), { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByLabelText('Hands-off night'))
    fireEvent.click(screen.getByRole('button', { name: 'Add exception' }))
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))

    fireEvent.change(screen.getByLabelText('Exception date'), { target: { value: '2026-08-18' } })
    fireEvent.click(screen.getByLabelText('Hands-off night'))
    fireEvent.click(screen.getByRole('button', { name: 'Add exception' }))
    const plan = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0]
    const target = plan.slots.find((slot: { date: string }) => slot.date === '2026-08-18')
    fireEvent.change(screen.getByLabelText('Plan to repair'), { target: { value: plan.id } })
    fireEvent.change(screen.getByLabelText('Date to repair'), { target: { value: target.id } })
    fireEvent.click(screen.getByRole('button', { name: 'Plans changed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Replan with eligible meal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))

    const repaired = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0]
    const repairedTarget = repaired.slots.find((slot: { id: string }) => slot.id === target.id)
    expect(repairedTarget).toMatchObject({ mealId: 'slow', recipeId: 'slow-r' })
    const targetItem = screen.getByText(/^2026-08-18: Slow stew/)
    fireEvent.click(within(targetItem).getByRole('button', { name: 'Start cooking Slow stew' }))
    fireEvent.click(within(targetItem).getByRole('button', { name: 'Dinner’s ready Slow stew' }))

    fireEvent.change(screen.getByLabelText('Plan to repair'), { target: { value: repaired.id } })
    fireEvent.change(screen.getByLabelText('Date to repair'), { target: { value: repairedTarget.id } })
    fireEvent.click(screen.getByRole('button', { name: 'Plans changed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose takeout' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))
    const corrected = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].slots.find((slot: { id: string }) => slot.id === target.id)
    expect(corrected).toMatchObject({ dinnerReadyAt: expect.any(String) })
    expect(corrected).not.toHaveProperty('mealId')
  })

  it('canonically replaces duplicate date exceptions at the cap with the latest note', () => {
    const state = createEmptyAppState()
    state.household.scheduleExceptions.push(...Array.from({ length: 98 }, (_, index) => ({ id: `filler-${index}`, date: '2026-09-01', note: 'filler' })), { id: 'first', date: '2026-08-17', note: 'first note', constrained: true }, { id: 'latest', date: '2026-08-17', note: 'latest note', constrained: true })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Exception date'), { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByLabelText('Hands-off night'))
    fireEvent.click(screen.getByRole('button', { name: 'Add exception' }))

    const exceptions = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').household.scheduleExceptions.filter((item: { date: string }) => item.date === '2026-08-17')
    expect(exceptions).toEqual([expect.objectContaining({ note: 'latest note', handsOff: true })])
  })

  it('shows persisted hands-off capacity after reload', () => {
    const state = createEmptyAppState()
    state.household.scheduleExceptions.push({ id: 'hands-off', date: '2026-08-17', handsOff: true })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    expect(screen.getByText('2026-08-17: Hands-off')).toBeInTheDocument()
  })

  it('flags a hands-off meal-only confirmed slot for review even when a linked recipe is marked', () => {
    const state = createEmptyAppState()
    state.household.scheduleExceptions.push({ id: 'hands-off', date: '2026-08-17', handsOff: true })
    state.meals.push({ id: 'slow', name: 'Slow stew', active: true, safetyReview: 'approved', recipeIds: ['slow-r'] })
    state.recipes.push({ id: 'slow-r', title: 'Slow stew', mealId: 'slow', handsOffSlowCooker: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'slow' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    expect(screen.getByRole('button', { name: 'Review needed' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start cooking Slow stew' })).toBeDisabled()
  })

  it('flags a confirmed hands-off cooking slot when its selected recipe loses the marker', () => {
    const state = createEmptyAppState()
    state.household.scheduleExceptions.push({ id: 'hands-off', date: '2026-08-17', handsOff: true })
    state.meals.push({ id: 'slow', name: 'Slow stew', active: true, safetyReview: 'approved', recipeIds: ['slow-r'] })
    state.recipes.push({ id: 'slow-r', title: 'Slow stew', mealId: 'slow', handsOffSlowCooker: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'slow', recipeId: 'slow-r' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hands-off slow cooker Slow stew' }))
    expect(screen.getByRole('button', { name: 'Review needed' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start cooking Slow stew' })).toBeDisabled()
  })

  it('persists a supplied note for a normal date', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Exception date'), { target: { value: '2026-08-17' } })
    fireEvent.change(screen.getByLabelText('Exception note'), { target: { value: 'Family event' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add exception' }))

    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').household.scheduleExceptions).toEqual([expect.objectContaining({ date: '2026-08-17', note: 'Family event' })])
  })
})
