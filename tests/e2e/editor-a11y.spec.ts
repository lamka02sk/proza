/**
 * Accessibility of the editor core: names,
 * roles, announcements, keyboard help, locales, and an axe scan of each state.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { MOD, announcements, caret, heading, item, list, open, para, separator } from './editor-helpers'

// Contrast is checked on the settled state: the status line's message fades in, and axe would measure it half-transparent.
test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: 'reduce' }) })

const HELP = process.platform === 'darwin' ? 'Control+Alt+h' : 'Alt+0'

async function axe(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).include('#editor').analyze()
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

test('fields are textboxes named by their kind; the editor is a named group', async ({ page }) => {
  await open(page, [heading('Title', 3, 'h'), para('Text', 'p'), list([item('One', 'i')], 'bullet', 'l'), separator('s')])
  await expect(page.getByRole('group', { name: 'Content' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Heading 3' })).toHaveText('Title')
  await expect(page.getByRole('textbox', { name: 'Text' })).toHaveText('Text')
  await expect(page.getByRole('textbox', { name: 'List item' })).toHaveText('One')
  await expect(page.getByRole('group', { name: 'Divider' })).toHaveAttribute('aria-describedby', 'pz-block-actions')
  await axe(page)
})

test('a selected block is a named group with a description of its keys, and passes axe', async ({ page }) => {
  await open(page, [para('Proza is a block editor written from scratch', 'p'), para('two', 'b')])
  await caret(page, 'p', 1)
  await page.keyboard.press('Escape')
  const group = page.getByRole('group', { name: 'Text: Proza is a block editor written from…' })
  await expect(group).toBeFocused()
  await expect(group).toHaveAccessibleDescription(/Enter to edit/)
  await axe(page)
})

test('only one element of the text area is in the Tab order', async ({ page }) => {
  await open(page, [para('one', 'a'), para('two', 'b'), para('three', 'c')])
  const tabbable = await page.evaluate(() => [...document.querySelector('#editor')!.shadowRoot!.querySelectorAll('.pz-canvas [tabindex="0"]')].length)
  expect(tabbable).toBe(1)
  await caret(page, 'c', 0)
  await page.keyboard.press('Escape')
  const stops = await page.evaluate(() => [...document.querySelector('#editor')!.shadowRoot!.querySelectorAll('.pz-canvas [tabindex="0"]')].map((e) => (e as HTMLElement).dataset.block))
  expect(stops).toEqual(['c'])
})

test('live regions exist before the first announcement', async ({ page }) => {
  await open(page)
  const regions = await page.evaluate(() => [...document.querySelector('#editor')!.shadowRoot!.querySelectorAll('[aria-live]')].map((e) => e.getAttribute('aria-live')))
  expect(regions).toEqual(['polite', 'assertive'])
})

test('stepping into and out of a link is announced', async ({ page }) => {
  await open(page, [{ id: 'a', type: 'core/paragraph', attrs: { content: { text: 'see docs now', formats: [{ type: 'link', start: 4, end: 8, attrs: { href: 'https://example.com' } }] } } }])
  await caret(page, 'a', 8)
  await page.keyboard.press('ArrowLeft')
  expect((await announcements(page)).at(-1)).toBe('In link')
  await page.keyboard.press('ArrowRight')
  expect((await announcements(page)).at(-1)).toBe('Out of link')
})

test('the polite region speaks the last announcement', async ({ page }) => {
  await open(page, [para('one', 'a'), para('two', 'b')])
  await caret(page, 'b', 0)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Delete')
  await expect(page.locator('[aria-live="polite"]')).toHaveText('Part removed')
})

test('keyboard help lists the field shortcuts and the commands', async ({ page }) => {
  await open(page, [para('one', 'a')])
  await caret(page, 'a', 1)
  await page.keyboard.press(HELP)
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Bold')
  await expect(dialog).toContainText('Move the part up')
  await expect(dialog).toContainText('Indent the list item')
})

test('a remapped shortcut is in help and works; a switched-off one does nothing', async ({ page }) => {
  await open(page)
  await page.evaluate(() => {
    window.__editor!.proza.destroy()
    const p = window.__editor!.createEditor({ target: '#editor', content: { version: 1, blocks: [{ id: 'a', type: 'core/paragraph', attrs: { content: { text: 'x', formats: [] } } }, { id: 'b', type: 'core/paragraph', attrs: { content: { text: 'y', formats: [] } } }] }, keys: { duplicate: [{ keys: 'Mod+Shift+K' }], moveDown: null } })
    window.__editor!.editor = p.editor
  })
  await caret(page, 'a', 1)
  await page.keyboard.press(`${MOD}+Shift+k`)
  await page.keyboard.press(process.platform === 'darwin' ? 'Control+Shift+ArrowDown' : 'Alt+Shift+ArrowDown')
  const types = await page.evaluate(() => window.__editor!.editor.getJSON().blocks.map((b) => (b.attrs.content as { text: string }).text))
  expect(types).toEqual(['x', 'x', 'y'])
  const help = await page.evaluate(() => window.__editor!.editor.keyboardHelp().flatMap((g) => g.entries.map((e) => `${e.keys} ${e.text}`)))
  expect(help.some((h) => h.includes('Duplicate') && h.includes('K'))).toBe(true)
  expect(help.some((h) => h.includes('Move the part down'))).toBe(false)
})

test('Slovak interface strings', async ({ page }) => {
  await open(page, undefined, '?locale=sk')
  await page.evaluate(() => { window.__editor!.editor.setContent({ version: 1, blocks: [{ id: 'a', type: 'core/paragraph', attrs: { content: { text: 'jeden', formats: [] } } }, { id: 'b', type: 'core/paragraph', attrs: { content: { text: 'dva', formats: [] } } }, { id: 'c', type: 'core/paragraph', attrs: { content: { text: 'tri', formats: [] } } }] }) })
  await caret(page, 'a', 0, 5)
  await page.keyboard.press('Shift+ArrowDown')
  expect((await announcements(page)).at(-1)).toBe('Text vybraný v 2 častiach')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Shift+ArrowDown')
  expect((await announcements(page)).at(-1)).toBe('3 časti vybrané')
  await page.keyboard.press('Delete')
  expect((await announcements(page)).at(-1)).toBe('3 časti odstránené')
  await expect(page.getByRole('textbox', { name: 'Text' })).toBeVisible()
})

test('in forced colours a selected block is outlined, not only tinted', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await open(page, [para('one', 'a')])
  await caret(page, 'a', 1)
  await page.keyboard.press('Escape')
  const outline = await page.locator('[data-block="a"]').evaluate((el) => getComputedStyle(el).outlineStyle)
  expect(outline).toBe('solid')
})
