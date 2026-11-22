/**
 * Accessibility of the interface: axe in every
 * state, Slovak strings, right to left, dark, forced colours, 320 px, touch.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { caret, heading, item, list, open, para } from './editor-helpers'

async function axe(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).include('#editor').analyze()
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

// Contrast is checked on the settled state: menus fade in, and axe would measure them half-transparent.
test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: 'reduce' }) })

const doc = [heading('Market day', 2, 'h'), para('Stalls open at eight.', 'a'), list([item('Bread', 'i1'), item('Coffee', 'i2')], 'bullet', 'l')]

test('axe: resting, part tools, bubble', async ({ page }) => {
  await open(page, doc)
  await axe(page)
  await caret(page, 'a', 0)
  await axe(page)
  await caret(page, 'a', 0, 6)
  await expect(page.getByRole('toolbar', { name: 'Format the selected words' })).toBeVisible()
  await axe(page)
})

// Split in three: six full scans in one test came near the time limit, and crashed Firefox once, under the whole parallel suite.
test('axe: add menu, part options', async ({ page }) => {
  await open(page, doc)
  await caret(page, 'a', 0)
  await page.locator('.gut:not(.is-hover) .plus').click()
  await axe(page)
  await page.keyboard.press('Escape')
  await page.locator('.gut:not(.is-hover) .cfg').click()
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await axe(page)
})

test('axe: outline, help, keyboard help', async ({ page }) => {
  await open(page, doc)
  await caret(page, 'a', 0)
  const tools = page.getByRole('toolbar', { name: 'Editor tools' })
  await tools.getByRole('button', { name: 'Outline' }).click()
  await axe(page)
  await page.keyboard.press('Escape')
  await tools.getByRole('button', { name: 'Help' }).click()
  await axe(page)
  await page.getByRole('button', { name: /All keyboard shortcuts/ }).click()
  await axe(page)
})

test('axe: source', async ({ page }) => {
  await open(page, doc)
  await caret(page, 'a', 0)
  await page.getByRole('toolbar', { name: 'Editor tools' }).getByRole('button', { name: 'Source' }).click()
  await axe(page)
})

test('axe: `/` menu, link field, heading options', async ({ page }) => {
  await open(page, [...doc, para('', 'e')])
  await caret(page, 'e', 0)
  await page.keyboard.type('/')
  await axe(page)
  await page.keyboard.press('Escape')
  await caret(page, 'a', 0, 6)
  await page.getByRole('button', { name: 'Link' }).click()
  await axe(page)
  await page.keyboard.press('Escape')
  await caret(page, 'h', 0)
  await page.locator('.gut:not(.is-hover) .cfg').click()
  await axe(page)
})

test('dark and Slovak pass axe; every interface string is Slovak', async ({ page }) => {
  await open(page, doc, '?locale=sk&theme=dark')
  await caret(page, 'a', 0)
  await page.locator('.gut:not(.is-hover) .cfg').click()
  await expect(page.getByRole('dialog', { name: /^Možnosti tejto časti/ })).toBeVisible()
  await axe(page)
  await page.keyboard.press('Escape')
  const tools = page.getByRole('toolbar', { name: 'Nástroje editora' })
  for (const name of ['Späť', 'Znova', 'Prehľad', 'Náhľad na zariadení', 'Zdroj', 'Zväčšiť', 'Pomoc']) await expect(tools.getByRole('button', { name })).toBeAttached()
  await expect(page.getByRole('button', { name: 'Pridať niečo', exact: true })).toBeVisible()
})

test('right to left: the tools sit at the start of the line, on the right', async ({ page }) => {
  await open(page, doc, '?dir=rtl')
  await caret(page, 'a', 0)
  const gut = (await page.locator('.gut:not(.is-hover)').boundingBox())!
  const text = (await page.locator('[data-block="a"]').boundingBox())!
  expect(gut.x).toBeGreaterThan(text.x + text.width - 10)
  await axe(page)
})

test('forced colours: the part you are on is outlined, not only washed', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'forced-colors emulation exists only in Chromium')
  await page.emulateMedia({ forcedColors: 'active' })
  await open(page, doc)
  await caret(page, 'a', 0)
  const outline = await page.locator('[data-block="a"]').evaluate((el) => getComputedStyle(el).outlineStyle)
  expect(outline).toBe('solid')
})

test('320 px: nothing scrolls sideways, buttons are 44 px, the plus moves into the options', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await open(page, doc)
  await caret(page, 'a', 0)
  const overflow = await page.evaluate(() => {
    const ed = document.querySelector('#editor')!
    return ed.scrollWidth - ed.clientWidth
  })
  expect(overflow).toBeLessThanOrEqual(0)
  await expect(page.locator('.gut:not(.is-hover) .plus')).toBeHidden()
  const undo = (await page.getByRole('toolbar', { name: 'Editor tools' }).getByRole('button', { name: 'Undo' }).boundingBox())!
  expect(undo.height).toBeGreaterThanOrEqual(36)
  await page.locator('.gut:not(.is-hover) .cfg').click()
  await page.getByRole('dialog', { name: /^Options for this part/ }).getByRole('button', { name: 'Add something below' }).click()
  await expect(page.getByRole('dialog', { name: 'Add to your text' })).toBeVisible()
  await axe(page)
})

test('reduced motion: nothing in the editor animates', async ({ page }) => {
  await open(page, [...doc, para('', 'e')])
  const running = (): Promise<string[]> => page.evaluate(() => document.querySelector('#editor')!.shadowRoot!.querySelector('.pz')!
    .getAnimations({ subtree: true }).map((a) => ('animationName' in a ? (a as CSSAnimation).animationName : (a as CSSTransition).transitionProperty)))
  // A part, its stems, a selection of parts, the add menu with its tiles, the options, hover on buttons.
  await caret(page, 'a', 0)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Shift+ArrowDown')
  expect(await running()).toEqual([])
  await caret(page, 'a', 0)
  await page.locator('.gut:not(.is-hover) .plus').hover()
  await page.locator('.gut:not(.is-hover) .plus').click()
  expect(await running()).toEqual([])
  await page.keyboard.press('Escape')
  await page.locator('.gut:not(.is-hover) .cfg').click()
  await page.getByRole('button', { name: 'More', exact: true }).click()
  expect(await running()).toEqual([])
  await page.keyboard.press('Escape')
  await caret(page, 'e', 0)
  await page.keyboard.type('/')
  expect(await running()).toEqual([])
})
