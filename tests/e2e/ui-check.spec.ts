/**
 * The accessibility checker: the count on the status
 * line's button, the panel by keyboard, marks in the text, going to a problem,
 * repairs as one undo step, `validate()` for the host and `a11y.onSave`.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { MOD, announcements, caret, heading, open, para } from './editor-helpers'

const root = (page: Page) => page.locator('#editor')
const button = (page: Page) => root(page).locator('[data-pz-check]')
const panel = (page: Page) => root(page).locator('.ck')
const rows = (page: Page) => panel(page).getByRole('option')
const highlighted = (page: Page, name: string): Promise<string[]> => page.evaluate((n) => {
  const h = CSS.highlights.get(n)
  return h ? [...h].map((r) => (r instanceof Range ? r.toString() : '')) : []
}, name)
const rich = (text: string, formats: unknown[] = []) => ({ text, formats })
const link = (text: string, href = '/a') => ({ id: 'lk', type: 'core/paragraph', attrs: { content: rich(text, [{ type: 'link', start: 0, end: text.length, attrs: { href } }]) } })
const cell = (id: string, text: string) => ({ id, type: 'core/table-cell', attrs: {}, children: [{ id: `${id}p`, type: 'core/paragraph', attrs: { content: rich(text) } }] })
const table = { id: 't', type: 'core/table', attrs: { caption: rich('Prices') }, children: [
  { id: 'r1', type: 'core/table-row', attrs: {}, children: [cell('a1', 'Item'), cell('a2', 'Price')] },
  { id: 'r2', type: 'core/table-row', attrs: {}, children: [cell('b1', 'Tea'), cell('b2', '2 €')] },
] }
const picture = { id: 'img', type: 'core/image', attrs: { src: '/brand/logo.svg' } }

test('the button counts the problems; the panel lists them by group, moves by arrows and marks their text', async ({ page }) => {
  await open(page, [heading('Intro', 2, 'h'), link('Click here'), table, heading('Deep', 4, 'h4')])
  await expect(button(page)).toHaveAccessibleName('Accessibility check: 3 problems')
  await expect(button(page).locator('.count')).toHaveText('3')
  await button(page).click()
  await expect(rows(page)).toHaveCount(3)
  // Groups in the plan's order, reading order inside a group.
  await expect(panel(page).locator('.ck-group-name')).toHaveText(['Structure', 'Tables', 'Links'])
  await expect(rows(page).nth(0)).toBeFocused()
  await expect(rows(page).nth(0)).toContainText('Heading level 4 follows level 2')
  await expect(panel(page)).toContainText('1 to fix, 2 to look at')
  expect(await announcements(page)).toContain('3 problems found')
  // The focused problem says what to do; the link's words are marked in the canvas.
  await expect(panel(page).locator('.ck-hint')).toContainText('Use the next level')
  expect(await highlighted(page, 'pz-check')).toEqual(['Click here'])
  await page.keyboard.press('End')
  await expect(rows(page).nth(2)).toBeFocused()
  await expect(rows(page).nth(2)).toHaveAccessibleName(/^To look at: The link “Click here” does not say where it goes/)
  expect(await highlighted(page, 'pz-check-current')).toEqual(['Click here'])
  await page.keyboard.press('ArrowUp')
  await expect(rows(page).nth(1)).toContainText('Table without header cells')
  expect((await new AxeBuilder({ page }).include('#editor').analyze()).violations).toEqual([])
  // Enter goes to it: the panel closes, the caret is in the problem's part.
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(panel(page)).toHaveCount(0)
  const s = await page.evaluate(() => window.__editor!.editor.selection)
  expect(s).toMatchObject({ kind: 'text', blockId: 'lk', field: 'content', anchor: 0, focus: 10 })
  expect(await highlighted(page, 'pz-check')).toEqual([])
})

test('a repair is one undo step, announced; focus goes to the next problem', async ({ page }) => {
  await open(page, [para('Intro', 'p'), table, heading('Deep', 4, 'h4')])
  await button(page).click()
  await expect(rows(page)).toHaveCount(2)
  await page.keyboard.press('ArrowDown')
  await panel(page).getByRole('button', { name: 'Make a header row' }).click()
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toBeFocused()
  expect(await announcements(page)).toContain('Fixed: Make a header row')
  const header = await page.evaluate(() => ['a1', 'a2', 'b1'].map((id) => window.__editor!.editor.tree.nodes.get(id)!.attrs.header))
  expect(header).toEqual([true, true, false])
  await panel(page).getByRole('button', { name: 'Use the next level' }).click()
  await expect(panel(page)).toContainText('No problems found.')
  await expect(panel(page).locator('.ck-none')).toBeFocused()
  await expect(button(page)).toHaveAccessibleName('Accessibility check')
  await page.keyboard.press('Escape')
  await caret(page, 'p', 0)
  await page.keyboard.press(`${MOD}+Z`)
  expect(await page.evaluate(() => window.__editor!.editor.tree.nodes.get('h4')!.attrs.level)).toBe(4)
  await page.keyboard.press(`${MOD}+Z`)
  expect(await page.evaluate(() => window.__editor!.editor.tree.nodes.get('a1')!.attrs.header)).toBe(false)
})

test('a picture without a description: Go to it selects the picture and opens its options', async ({ page }) => {
  await open(page, [para('Intro', 'p'), picture])
  await button(page).click()
  await expect(rows(page).first()).toContainText('Picture without a description')
  await panel(page).getByRole('button', { name: 'Go to it' }).click()
  await expect(panel(page)).toHaveCount(0)
  expect(await page.evaluate(() => window.__editor!.editor.selection)).toMatchObject({ kind: 'blocks', anchorId: 'img' })
  await expect(root(page).locator('.pop-blk')).toBeVisible()
})

test('Alt+Shift+A opens the check (Ctrl+Option+A on a Mac); it is in keyboard help', async ({ page }) => {
  await open(page, [para('Fine text.', 'p')])
  await caret(page, 'p', 0)
  await page.keyboard.press(process.platform === 'darwin' ? 'Control+Alt+A' : 'Alt+Shift+A')
  await expect(panel(page)).toContainText('No problems found.')
  expect(await announcements(page)).toContain('No problems found')
  const help = await page.evaluate(() => window.__editor!.editor.keyboardHelp().flatMap((g) => g.entries.map((i) => i.text)))
  expect(help).toContain('Accessibility check of the text')
})

test('validate() gives the host the problems in words', async ({ page }) => {
  await open(page, [picture, link('https://example.com/page', 'https://example.com/page')])
  const issues = await page.evaluate(() => window.__editor!.editor.validate().map(({ rule, severity, message, part, fixable }) => ({ rule, severity, message, part, fixable })))
  expect(issues).toEqual([
    { rule: 'alt-missing', severity: 'error', message: 'Picture without a description', part: 'Picture: no description yet', fixable: false },
    { rule: 'link-url', severity: 'warning', message: 'A web address as link text', part: 'Text: https://example.com/page', fixable: false },
  ])
})

test('saving with errors: warn saves and says so, with the problems a click away; block refuses and shows them', async ({ page }) => {
  await open(page, [para('Intro', 'p'), picture])
  await page.evaluate(() => { (window as unknown as { saves: number }).saves = 0; window.__editor!.editor.on('save', () => { (window as unknown as { saves: number }).saves++ }) })
  await caret(page, 'p', 0)
  await page.keyboard.press(`${MOD}+S`)
  expect(await page.evaluate(() => (window as unknown as { saves: number }).saves)).toBe(1)
  expect(await announcements(page)).toContain('One accessibility problem left in the text.')
  await root(page).locator('.status').getByRole('button', { name: 'Show problems' }).click()
  await expect(rows(page)).toHaveCount(1)

  await open(page, [para('Intro', 'p'), picture], '?onsave=block')
  await page.evaluate(() => { (window as unknown as { saves: number }).saves = 0; window.__editor!.editor.on('save', () => { (window as unknown as { saves: number }).saves++ }) })
  await caret(page, 'p', 0)
  await page.keyboard.press(`${MOD}+S`)
  await expect(rows(page)).toHaveCount(1)
  expect(await page.evaluate(() => (window as unknown as { saves: number }).saves)).toBe(0)
  expect(await announcements(page)).toContain('Not saved: one accessibility problem to fix first.')
})

test('a form does not submit while block finds errors; once they are fixed it does', async ({ page }) => {
  await page.goto('/forms/?onsave=block')
  await page.waitForFunction(() => window.__forms?.vue() != null)
  await page.evaluate(() => { window.__forms!.textarea.editor.setContent({ version: 1, blocks: [{ id: 'img', type: 'core/image', attrs: { src: '/brand/logo.svg' } }] }) })
  await page.locator('#submit').click()
  expect(await page.evaluate(() => window.__forms!.sent())).toEqual({})
  await expect(page.locator('#body + .proza-host .ck')).toBeVisible()
  await page.evaluate(() => { window.__forms!.textarea.editor.setAttrs('img', { decorative: true }) })
  await page.locator('#submit').click()
  expect(await page.evaluate(() => Object.keys(window.__forms!.sent()))).toContain('body')
})
