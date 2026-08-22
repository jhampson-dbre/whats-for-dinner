import { expect, test } from '@playwright/test'

test('onboards, plans, shops, cooks, and records feedback', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Diner name').fill('Ava')
  await page.getByRole('button', { name: 'Add diner' }).click()
  await page.getByLabel('Meal name').fill('Tacos')
  await page.getByRole('button', { name: 'Add meal' }).click()
  await page.getByRole('textbox', { name: 'Meal name', exact: true }).fill('Pasta')
  await page.getByRole('button', { name: 'Add meal' }).click()
  await page.getByRole('button', { name: 'Preview weekly plan' }).click()
  await page.getByRole('button', { name: 'Confirm weekly plan' }).click()
  await page.getByLabel('Ingredients unavailable or skipped for Tacos').first().check()
  await page.getByLabel('Ingredients unavailable or skipped for Pasta').first().check()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Shopping done' }).click()
  await page.getByRole('button', { name: 'Start cooking Tacos' }).first().click()
  await page.getByRole('button', { name: 'Dinner’s ready Tacos' }).first().click()
  await page.evaluate(() => {
    const key = 'whats-for-dinner.app-state'
    const state = JSON.parse(localStorage.getItem(key) ?? '{}')
    state.plans[0].slots.find((slot: { dinnerReadyAt?: string }) => slot.dinnerReadyAt).feedbackEligibleAt = '2020-01-01T00:00:00.000Z'
    localStorage.setItem(key, JSON.stringify(state))
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Dinner feedback' })).toBeVisible()
  await page.getByRole('button', { name: 'Save feedback' }).click()
  await expect(page.getByRole('button', { name: 'Correct feedback' }).first()).toBeVisible()
})
