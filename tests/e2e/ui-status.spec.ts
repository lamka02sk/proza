/**
 * The status line and what it opens:
 * tips, messages with Undo, undo and redo, help, keyboard help, source view,
 * phone view, expand.
 */
import { expect, test } from '@playwright/test'
import { announcements, caret, open, outline, para } from './editor-helpers'

const HELP = process.platform === 'darwin' ? 'Control+Alt+h' : 'Alt+0'
const tools = (page: import('@playwright/test').Page) => page.getByRole('toolbar', { name: 'Editor tools' })

test('the tip names the part with the caret; nothing selected says how to start', async ({ page }) => {
  await open(page, [para('one', 'a')])
  await expect(page.locator('.status-l')).toHaveText('Nothing selected Click a part of the text to work on it.')
  await caret(page, 'a', 1)
  await expect(page.locator('.status-l strong')).toHaveText('Text')
  await page.keyboard.press('Escape')
  // What just happened comes first; the tip returns after it.
  await expect(page.locator('.status-l')).toContainText('Part selected')
})

test('a change shows its message with Undo beside it; the copy is hidden from screen readers, who hear the live region', async ({ page }) => {
  await open(page, [para('one', 'a'), para('two', 'b')])
  await caret(page, 'b', 1)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Delete')
  const msg = page.locator('.status .msg-on')
  await expect(msg).toContainText('Part removed')
  await expect(msg.locator('[aria-hidden="true"]')).toHaveText('Part removed')
  await expect(page.locator('.pz-live[aria-live="polite"]')).toHaveText('Part removed')
  await msg.getByRole('button', { name: 'Undo' }).click()
  expect(await outline(page)).toEqual(['paragraph: one', 'paragraph: two'])
})

test('undo and redo buttons follow the history', async ({ page }) => {
  await open(page, [para('one', 'a')])
  const undo = tools(page).getByRole('button', { name: 'Undo' })
  const redo = tools(page).getByRole('button', { name: 'Redo' })
  await expect(undo).toBeDisabled()
  await caret(page, 'a', 3)
  await page.keyboard.type('!')
  await expect(undo).toBeEnabled()
  await undo.click()
  expect(await outline(page)).toEqual(['paragraph: one'])
  await expect(redo).toBeEnabled()
  await redo.click()
  expect(await outline(page)).toEqual(['paragraph: one!'])
})

test('the editor tools are one Tab stop with arrow keys inside', async ({ page }) => {
  await open(page, [para('one', 'a')])
  await caret(page, 'a', 3)
  await page.keyboard.type('!')
  await tools(page).getByRole('button', { name: 'Undo' }).focus()
  await page.keyboard.press('ArrowRight')
  // Redo is disabled and skipped.
  await expect(tools(page).getByRole('button', { name: 'Outline' })).toBeFocused()
  await page.keyboard.press('End')
  await expect(tools(page).getByRole('button', { name: 'More tools' })).toBeFocused()
})

test('help: the four things popover, then the keyboard shortcuts dialog; Alt+0 opens it from the text', async ({ page }) => {
  await open(page, [para('one', 'a')])
  await tools(page).getByRole('button', { name: 'Help' }).click()
  const pop = page.getByRole('dialog', { name: 'Help' })
  await expect(pop).toBeVisible()
  await pop.getByRole('button', { name: /All keyboard shortcuts/ }).click()
  const keys = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(keys).toBeVisible()
  await expect(keys.getByRole('heading', { name: 'Parts' })).toBeVisible()
  await expect(keys.getByText('Go to the toolbar: the words you selected, or the part tools')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(keys).toBeHidden()
  // The popover closed when the dialog took the focus: focus returns to Help.
  await expect(tools(page).getByRole('button', { name: 'Help' })).toBeFocused()
  await caret(page, 'a', 1)
  await page.keyboard.press(HELP)
  await expect(keys).toBeVisible()
  await keys.getByRole('button', { name: 'Close' }).click()
  await expect(keys).toBeHidden()
  // Focus goes back where it was.
  await expect(page.locator('[data-block="a"] [data-field]')).toBeFocused()
})

test('source view: JSON applies as one undo step; invalid JSON is refused; HTML is shown', async ({ page }) => {
  await open(page, [para('one', 'a')])
  await tools(page).getByRole('button', { name: 'Source' }).click()
  const dlg = page.getByRole('dialog', { name: 'Source of the content' })
  await expect(dlg).toBeVisible()
  await expect(dlg.getByLabel('Content as HTML')).toHaveValue('<p>one</p>')
  const jsonBox = dlg.getByLabel('Content as JSON')
  await jsonBox.fill('{ nope')
  await dlg.getByRole('button', { name: 'Apply JSON' }).click()
  await expect(dlg.getByRole('alert')).toContainText('This is not valid JSON')
  await expect(jsonBox).toHaveAttribute('aria-invalid', 'true')
  await jsonBox.fill(JSON.stringify({ version: 1, blocks: [{ type: 'core/heading', attrs: { level: 2, content: { text: 'New', formats: [] } } }] }))
  await dlg.getByRole('button', { name: 'Apply JSON' }).click()
  await expect(dlg).toBeHidden()
  expect(await outline(page)).toEqual(['heading2: New'])
  expect(await announcements(page)).toContain('Source applied')
  await tools(page).getByRole('button', { name: 'Undo' }).click()
  expect(await outline(page)).toEqual(['paragraph: one'])
})

test('device preview narrows the text column to a tablet or a phone; expand puts the field in the top layer and back', async ({ page }) => {
  await open(page, [para('one', 'a')])
  const width = (): Promise<string> => page.evaluate(() => getComputedStyle(document.querySelector('#editor')!.shadowRoot!.querySelector('.pz-canvas')!).width)
  const preview = tools(page).getByRole('button', { name: 'Device preview' })
  await preview.click()
  await page.getByRole('menuitemradio', { name: /Phone/ }).click()
  await expect.poll(width).toBe('390px')
  expect(await announcements(page)).toContain('Phone preview, 390 pixels wide')
  // The content answers the device's width: the canvas is the container while previewing.
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#editor')!.shadowRoot!.querySelector('.pz-canvas')!).containerType)).toBe('inline-size')
  await preview.click()
  await expect(page.getByRole('menuitemradio', { name: /Phone/ })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('menuitemradio', { name: 'Editor width' }).click()
  await expect.poll(width).not.toBe('390px')
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#editor')!.shadowRoot!.querySelector('.pz-canvas')!).containerType)).toBe('normal')
  await tools(page).getByRole('button', { name: 'Expand' }).click()
  await expect.poll(() => page.evaluate(() => document.querySelector('#editor')!.shadowRoot!.querySelector('.ed')!.matches(':popover-open'))).toBe(true)
  const box = (await page.locator('.ed').boundingBox())!
  const view = page.viewportSize()!
  expect(Math.round(box.width)).toBe(view.width)
  await tools(page).getByRole('button', { name: 'Back to normal size' }).click()
  await expect.poll(() => page.evaluate(() => document.querySelector('#editor')!.shadowRoot!.querySelector('.ed')!.matches(':popover-open'))).toBe(false)
})
