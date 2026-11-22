/**
 * Locked parts and host style variants (as TinyMCE `noneditable` and
 * `importcss`).
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { MOD, announcements, caret, open, outline, para } from './editor-helpers'

const options = (page: Page) => page.getByRole('dialog', { name: /^Options for this part/ })
const cfg = (page: Page) => page.locator('.gut:not(.is-hover) .cfg')
const locked = (id: string, lock: string, text: string) => ({ ...para(text, id), attrs: { content: { text, formats: [] }, lock } })

test('a part locked in place keeps its place, its text can still change', async ({ page }) => {
  await open(page, [para('first', 'a'), locked('b', 'move', 'pinned'), para('last', 'c')])
  await caret(page, 'b', 6)
  await expect(page.locator('#editor .status')).toContainText('Locked in place')
  await page.keyboard.type(' text')
  expect(await outline(page)).toEqual(['paragraph: first', 'paragraph: pinned text', 'paragraph: last'])
  await page.keyboard.press('Alt+Shift+ArrowUp')
  await page.keyboard.press('Control+Shift+ArrowUp')
  expect(await outline(page)).toEqual(['paragraph: first', 'paragraph: pinned text', 'paragraph: last'])
  // Backspace at its start would join it into the part before: it stays.
  await caret(page, 'b', 0)
  await page.keyboard.press('Backspace')
  expect(await outline(page)).toEqual(['paragraph: first', 'paragraph: pinned text', 'paragraph: last'])
  expect(await announcements(page)).toContain('This part is locked in place: it cannot be moved or removed.')
  await cfg(page).click()
  await expect(options(page)).toContainText('Locked in place')
  await expect(options(page).getByRole('button', { name: 'Remove' })).toBeDisabled()
})

test('a part locked whole cannot be typed into, and a range over it removes nothing', async ({ page }) => {
  await open(page, [para('free', 'a'), locked('b', 'all', 'frozen'), para('end', 'c')])
  const field = page.locator('#editor [data-block="b"] [data-field]')
  await expect(field).toHaveAttribute('contenteditable', 'false')
  await caret(page, 'a', 2)
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Delete')
  expect(await outline(page)).toEqual(['paragraph: free', 'paragraph: frozen', 'paragraph: end'])
  // Select all and delete: the locked part stays.
  await caret(page, 'a', 0)
  await page.keyboard.press(`${MOD}+A`)
  await page.keyboard.press(`${MOD}+A`)
  await page.keyboard.press('Delete')
  expect(await outline(page)).toContainEqual('paragraph: frozen')
})

test('authors lock and unlock from the part options when the host allows it', async ({ page }) => {
  await open(page, [para('one', 'a'), para('two', 'b')], '?locking')
  await caret(page, 'b', 1)
  await cfg(page).click()
  await options(page).getByRole('button', { name: 'More' }).click()
  await options(page).getByRole('group', { name: 'Lock' }).getByRole('button', { name: 'Everything' }).click()
  expect(await page.evaluate(() => window.__editor!.json().blocks[1]!.attrs.lock)).toBe('all')
  await expect(page.locator('#editor [data-block="b"] [data-field]')).toHaveAttribute('contenteditable', 'false')
  expect((await new AxeBuilder({ page }).include('#editor').analyze()).violations).toEqual([])
  await options(page).getByRole('group', { name: 'Lock' }).getByRole('button', { name: 'Unlocked' }).click()
  await expect(page.locator('#editor [data-block="b"] [data-field]')).toHaveAttribute('contenteditable', 'true')
  // Without the host's permission there is no Lock row.
  await open(page, [para('one', 'a')])
  await caret(page, 'a', 1)
  await cfg(page).click()
  await options(page).getByRole('button', { name: 'More' }).click()
  await expect(options(page).getByRole('group', { name: 'Lock' })).toHaveCount(0)
})

test('style variants: the host names them, the part shows them, the page gets the class', async ({ page }) => {
  await open(page, [para('Intro text', 'a')], '?styles')
  await caret(page, 'a', 1)
  await cfg(page).click()
  await options(page).getByRole('group', { name: 'Style' }).getByRole('button', { name: 'Lead' }).click()
  const part = page.locator('#editor [data-block="a"]')
  await expect(part).toHaveClass(/pz-style-lead/)
  // The host's stylesheet reaches the canvas.
  expect(await part.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(18)
  expect(await page.evaluate(() => window.__editor!.editor.getHTML())).toBe('<p class="pz-style-lead">Intro text</p>')
  expect(await announcements(page)).toContain('Style: Lead')
  // Proza's own output reads back with its style.
  await page.evaluate(() => { window.__editor!.editor.setContent('<p class="pz-style-note">Back</p>') })
  expect(await page.evaluate(() => window.__editor!.json().blocks[0]!.attrs.variant)).toBe('note')
})

test('justified text: offered only where the host switches it on; imports keep it then', async ({ page }) => {
  await open(page, [para('Text', 'a')])
  await caret(page, 'a', 1)
  await cfg(page).click()
  await expect(options(page).getByRole('button', { name: 'Justified' })).toHaveCount(0)
  await open(page, [para('Text', 'a')], '?justify')
  await caret(page, 'a', 1)
  await cfg(page).click()
  await options(page).getByRole('button', { name: 'Justified' }).click()
  expect(await page.evaluate(() => window.__editor!.editor.getHTML())).toBe('<p class="pz-text-justify">Text</p>')
  await page.evaluate(() => { window.__editor!.editor.setContent('<p style="text-align: justify">Old</p>') })
  expect(await page.evaluate(() => window.__editor!.json().blocks[0]!.attrs.textAlign)).toBe('justify')
})
