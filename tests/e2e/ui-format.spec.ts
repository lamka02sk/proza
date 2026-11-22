/**
 * The format bar: the bubble over selected
 * words, the link field, more formats, Alt+F10, the docked option.
 */
import { expect, test } from '@playwright/test'
import { MOD, caret, code, expectCanonical, open, para } from './editor-helpers'

const bubble = (page: import('@playwright/test').Page) => page.getByRole('toolbar', { name: 'Format the selected words' })
const json = (page: import('@playwright/test').Page) => page.evaluate(() => window.__editor!.json().blocks.map((b) => b.attrs.content))

test('the bubble shows only while words are selected, above them', async ({ page }) => {
  await open(page, [para('one two three', 'a')])
  await caret(page, 'a', 2)
  await expect(bubble(page)).toBeHidden()
  await caret(page, 'a', 4, 7)
  await expect(bubble(page)).toBeVisible()
  const words = await page.locator('[data-block="a"] [data-field]').boundingBox()
  const bar = await bubble(page).boundingBox()
  expect(bar!.y + bar!.height).toBeLessThanOrEqual(words!.y + 2)
  await caret(page, 'a', 4)
  await expect(bubble(page)).toBeHidden()
})

test('bold from the bubble formats the words and shows as pressed; the caret stays in the text', async ({ page }) => {
  await open(page, [para('one two three', 'a')])
  await caret(page, 'a', 4, 7)
  const bold = bubble(page).getByRole('button', { name: 'Bold' })
  await expect(bold).toHaveAttribute('aria-pressed', 'false')
  await bold.click()
  expect(await json(page)).toEqual([{ text: 'one two three', formats: [{ type: 'bold', start: 4, end: 7 }] }])
  await expect(bold).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-block="a"] [data-field]')).toBeFocused()
  await expectCanonical(page)
})

test('Mod+K opens the link field; Enter links the words; a bad address is refused with a message', async ({ page }) => {
  await open(page, [para('see the docs', 'a')])
  await caret(page, 'a', 8, 12)
  await page.keyboard.press(`${MOD}+k`)
  const input = page.getByRole('combobox', { name: 'Web address the words should lead to' })
  await expect(input).toBeFocused()
  await input.fill('javascript:alert(1)')
  await input.press('Enter')
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('alert')).toHaveText(/Use a web address/)
  await input.fill('https://example.com/docs')
  await input.press('Enter')
  expect(await json(page)).toEqual([{ text: 'see the docs', formats: [{ type: 'link', start: 8, end: 12, attrs: { href: 'https://example.com/docs' } }] }])
  await expect(page.locator('[data-block="a"] [data-field]')).toBeFocused()
})

test('the link field edits and removes an existing link; Escape cancels', async ({ page }) => {
  await open(page, [{ id: 'a', type: 'core/paragraph', attrs: { content: { text: 'see docs', formats: [{ type: 'link', start: 4, end: 8, attrs: { href: 'https://a.example' } }] } } }])
  await caret(page, 'a', 4, 8)
  await bubble(page).getByRole('button', { name: 'Link' }).click()
  const input = page.getByRole('combobox', { name: 'Web address the words should lead to' })
  await expect(input).toHaveValue('https://a.example')
  await page.keyboard.press('Escape')
  await expect(input).toBeHidden()
  await expect(page.locator('[data-block="a"] [data-field]')).toBeFocused()
  await caret(page, 'a', 4, 8)
  await bubble(page).getByRole('button', { name: 'Link' }).click()
  await page.getByRole('button', { name: 'Remove link' }).click()
  expect(await json(page)).toEqual([{ text: 'see docs', formats: [] }])
})

test('more formats from the menu, and clear formatting', async ({ page }) => {
  await open(page, [para('one two', 'a')])
  await caret(page, 'a', 0, 3)
  await bubble(page).getByRole('button', { name: 'More formatting' }).click()
  await page.getByRole('menuitem', { name: 'Underline' }).click()
  expect(await json(page)).toEqual([{ text: 'one two', formats: [{ type: 'underline', start: 0, end: 3 }] }])
  await caret(page, 'a', 0, 3)
  await bubble(page).getByRole('button', { name: 'More formatting' }).click()
  await page.getByRole('menuitem', { name: 'Clear formatting' }).click()
  expect(await json(page)).toEqual([{ text: 'one two', formats: [] }])
})

test('Alt+F10 goes to the bubble when words are selected, to the part tools otherwise; Escape comes back', async ({ page }) => {
  await open(page, [para('one two', 'a')])
  await caret(page, 'a', 0, 3)
  await page.keyboard.press('Alt+F10')
  await expect(bubble(page).getByRole('button', { name: 'Bold' })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(bubble(page).getByRole('button', { name: 'Italic' })).toBeFocused()
  await page.keyboard.press('Enter')
  expect(await json(page)).toEqual([{ text: 'one two', formats: [{ type: 'italic', start: 0, end: 3 }] }])
  await caret(page, 'a', 1)
  await page.keyboard.press('Alt+F10')
  await expect(page.getByRole('toolbar', { name: 'Tools for this part' }).getByRole('button', { name: 'Settings for this part' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-block="a"] [data-field]')).toBeFocused()
})

test('a code block gets no bubble', async ({ page }) => {
  await open(page, [code('const x = 1', 'c')])
  await caret(page, 'c', 0, 5)
  await expect(bubble(page)).toBeHidden()
})

test('docked: the format bar sits at the top of the field and formats at the caret', async ({ page }) => {
  await open(page, [para('one', 'a')], '?toolbar=docked')
  await caret(page, 'a', 3)
  const bar = page.locator('.fmt-docked')
  await expect(bar).toBeVisible()
  const field = await page.locator('.ed').boundingBox()
  expect((await bar.boundingBox())!.y).toBeLessThan(field!.y + 12)
  await bar.getByRole('button', { name: 'Bold' }).click()
  await page.keyboard.type('X')
  expect(await json(page)).toEqual([{ text: 'oneX', formats: [{ type: 'bold', start: 3, end: 4 }] }])
})
