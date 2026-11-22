import { expect, test } from '@playwright/test'

// Probe: Reka UI primitives inside a shadow root.
const active = (page: import('@playwright/test').Page) => page.evaluate(() => document.querySelector('#host')!.shadowRoot!.activeElement?.getAttribute('data-t') ?? null)

test.beforeEach(async ({ page }) => { await page.goto('/spikes/reka-shadow/') })

test('popover: opens, keeps focus inside, closes on Escape and returns focus', async ({ page }) => {
  await page.locator('[data-t="pop-trigger"]').click()
  await expect(page.locator('[data-t="pop"]')).toBeVisible()
  await page.locator('[data-t="pop-input"]').click()
  await page.keyboard.type('abc')
  await page.locator('[data-t="pop-btn"]').click()
  await expect(page.locator('[data-t="pop"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-t="pop"]')).toBeHidden()
  expect(await active(page)).toBe('pop-trigger')
})

test('popover: a click elsewhere in the shadow root closes it', async ({ page }) => {
  await page.locator('[data-t="pop-trigger"]').click()
  await expect(page.locator('[data-t="pop"]')).toBeVisible()
  await page.locator('[data-t="outside"]').click()
  await expect(page.locator('[data-t="pop"]')).toBeHidden()
})

// Reka's popover content loops Tab inside itself; Escape is the way out (WCAG 1.4.13, 2.1.2).
test('popover: Tab loops inside it', async ({ page }) => {
  await page.locator('[data-t="pop-trigger"]').click()
  await page.locator('[data-t="pop-btn"]').focus()
  await page.keyboard.press('Tab')
  expect(await active(page)).toBe('pop-input')
  await expect(page.locator('[data-t="pop"]')).toBeVisible()
})

test('menu: keyboard opens, arrows move, Enter selects, focus returns', async ({ page }) => {
  await page.locator('[data-t="menu-trigger"]').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-t="menu"]')).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-t="menu"]')).toBeHidden()
  expect(await page.evaluate(() => (window as unknown as { __log: string[] }).__log)).toContain('select Two')
  expect(await active(page)).toBe('menu-trigger')
})

test('toolbar: roving tabindex with arrows, Home and End', async ({ page }) => {
  await page.locator('[data-t="tb-Bold"]').focus()
  await page.keyboard.press('ArrowRight')
  expect(await active(page)).toBe('tb-Italic')
  await page.keyboard.press('End')
  expect(await active(page)).toBe('tb-Link')
  await page.keyboard.press('Home')
  expect(await active(page)).toBe('tb-Bold')
  await expect(page.locator('[data-t="tb-Italic"]')).toHaveAttribute('tabindex', '-1')
})
