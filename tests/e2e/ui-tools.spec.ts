/**
 * The More menu's parity tools: find and replace,
 * special characters and emoji, date and time, the non-breaking space,
 * spaces and marks shown, outlines of parts, word count, the page as published.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { MOD, announcements, caret, heading, open, outline, para } from './editor-helpers'

const root = (page: Page) => page.locator('#editor')
const more = async (page: Page, tool: string): Promise<void> => {
  await root(page).locator('[data-pz-more]').click()
  await root(page).locator(`[data-pz-tool="${tool}"]`).click()
}
/** A dialog fades in; axe measures colours as painted, so it waits for the end. */
const settled = (el: Locator): Promise<unknown> => el.evaluate((d) => Promise.all(d.getAnimations({ subtree: true }).map((a) => a.finished)))
const findBar = (page: Page) => root(page).getByRole('search')
const highlighted = (page: Page, name: string): Promise<string[]> => page.evaluate((n) => {
  const h = CSS.highlights.get(n)
  return h ? [...h].map((r) => (r instanceof Range ? r.toString() : '')) : []
}, name)

test.describe('find and replace', () => {
  test('Mod+F finds across parts from the selected words; Enter steps, the count is announced', async ({ page }) => {
    await open(page, [heading('The cat', 2, 'h'), para('A cat and a dog.', 'a'), para('Cats sleep. CAT', 'b')])
    await caret(page, 'h', 4, 7)
    await page.keyboard.press(`${MOD}+F`)
    const input = findBar(page).getByRole('searchbox', { name: 'Find' })
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('cat')
    await expect(findBar(page)).toContainText('1 of 4')
    expect(await highlighted(page, 'pz-find')).toHaveLength(3)
    expect(await highlighted(page, 'pz-find-current')).toEqual(['cat'])
    await page.keyboard.press('Enter')
    await expect(findBar(page)).toContainText('2 of 4')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.press('Shift+Enter')
    await expect(findBar(page)).toContainText('4 of 4')
    expect(await announcements(page)).toContain('4 of 4')
    // Whole words and case narrow it.
    await findBar(page).getByRole('button', { name: 'Match case' }).click()
    await expect(findBar(page)).toContainText('1 of 2')
    await findBar(page).getByRole('button', { name: 'Match case' }).click()
    await findBar(page).getByRole('button', { name: 'Whole words' }).click()
    await expect(findBar(page)).toContainText('of 3')
    expect((await new AxeBuilder({ page }).include('#editor').analyze()).violations).toEqual([])
    // Escape closes and selects the match it was on.
    await input.focus()
    await page.keyboard.press('Escape')
    await expect(findBar(page)).toHaveCount(0)
    expect(await highlighted(page, 'pz-find')).toEqual([])
    const s = await page.evaluate(() => window.__editor!.editor.selection)
    expect(s.kind).toBe('text')
  })

  test('Replace and Replace all are one undo step each and keep the formats of the text they replace', async ({ page }) => {
    await open(page, [para('red, red and red', 'a'), { id: 'b', type: 'core/paragraph', attrs: { content: { text: 'a red apple', formats: [{ type: 'bold', start: 2, end: 5 }] } } }])
    await caret(page, 'a', 0)
    await more(page, 'find')
    await findBar(page).getByRole('searchbox', { name: 'Find' }).fill('red')
    await findBar(page).getByRole('textbox', { name: 'Replace with' }).fill('blue')
    await findBar(page).getByRole('button', { name: 'Replace', exact: true }).click()
    expect(await outline(page)).toEqual(['paragraph: blue, red and red', 'paragraph: a red apple'])
    await expect(findBar(page)).toContainText('1 of 3')
    await findBar(page).getByRole('button', { name: 'Replace all' }).click()
    expect(await outline(page)).toEqual(['paragraph: blue, blue and blue', 'paragraph: a blue apple'])
    expect(await page.evaluate(() => window.__editor!.json().blocks[1]!.attrs.content)).toEqual({ text: 'a blue apple', formats: [{ type: 'bold', start: 2, end: 6 }] })
    expect(await announcements(page)).toContain('Replaced 3 matches')
    await expect(findBar(page)).toContainText('No matches')
    await page.evaluate(() => { window.__editor!.editor.undo() })
    expect(await outline(page)).toEqual(['paragraph: blue, red and red', 'paragraph: a red apple'])
  })
})

test('special characters and emoji: search in either language, insert at the caret, recently used first', async ({ page }) => {
  // Axe over the dialog and the emoji grid take 15 s in Firefox alone, past 30 s with the whole suite running.
  test.setTimeout(60_000)
  await open(page, [para('Price 20', 'a')])
  await caret(page, 'a', 8)
  await more(page, 'characters')
  const dialog = page.getByRole('dialog', { name: 'Special characters and emoji' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('option', { name: 'euro' })).toBeVisible()
  // On the characters (the emoji list is long for axe in Firefox).
  await settled(dialog)
  expect((await new AxeBuilder({ page }).include('#editor').analyze()).violations).toEqual([])
  const search = dialog.getByRole('combobox', { name: 'Search by name' })
  await search.fill('euro')
  await expect(dialog.getByRole('option').first()).toHaveAccessibleName('euro')
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  expect(await outline(page)).toEqual(['paragraph: Price 20€'])
  expect(await announcements(page)).toContain('Inserted: euro')
  // The caret is after it, and typing goes on.
  await page.keyboard.type('!')
  expect(await outline(page)).toEqual(['paragraph: Price 20€!'])
  // Emoji, searched by a Slovak word in the English interface; arrows move through the grid.
  await more(page, 'characters')
  await dialog.getByRole('button', { name: 'Emoji' }).click()
  await expect(dialog.getByRole('option').first()).toBeVisible()
  await search.fill('mačka')
  await expect(dialog.getByRole('option', { name: 'cat face' })).toBeVisible()
  await search.fill('')
  await expect(dialog.getByText('Used recently')).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('date or time and the non-breaking space type at the caret', async ({ page }) => {
  await open(page, [para('Today: ', 'a')])
  await caret(page, 'a', 7)
  await root(page).locator('[data-pz-more]').click()
  await root(page).locator('[data-pz-tool="date"]').click()
  const iso = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })
  await root(page).getByRole('menuitem', { name: iso }).click()
  expect(await outline(page)).toEqual([`paragraph: Today: ${iso}`])
  await page.keyboard.press(`${MOD}+Shift+Space`)
  await page.keyboard.type('km')
  expect(await outline(page)).toEqual([`paragraph: Today: ${iso}\u00A0km`])
})

test('spaces and marks shown, outlines of parts', async ({ page }) => {
  await open(page, [para('One two km', 'a'), para('Next', 'b')])
  await more(page, 'invisibles')
  await expect(root(page).locator('.pz-canvas')).toHaveClass(/is-invisibles/)
  await expect.poll(() => highlighted(page, 'pz-space')).toEqual([' '])
  expect(await highlighted(page, 'pz-nbsp')).toEqual([' '])
  // Typing keeps them painted.
  await caret(page, 'b', 4)
  await page.keyboard.type(' more')
  await expect.poll(() => highlighted(page, 'pz-space')).toEqual([' ', ' '])
  expect(await announcements(page)).toContain('Show spaces and marks: on')
  await more(page, 'invisibles')
  await expect.poll(() => highlighted(page, 'pz-space')).toEqual([])
  await more(page, 'outlines')
  await expect(root(page).locator('.pz-canvas')).toHaveClass(/is-outlines/)
  await expect(root(page).locator('[data-block="a"]')).toHaveCSS('outline-style', 'dashed')
})

test('word count: the whole text and the selection', async ({ page }) => {
  await open(page, [heading('Two words', 2, 'h'), para('Príliš žluťoučký kôň.', 'a')])
  await caret(page, 'a', 0, 6)
  await more(page, 'counts')
  const dialog = page.getByRole('dialog', { name: 'Word count' })
  await expect(dialog.getByRole('row', { name: /^Words/ })).toHaveText(/Words\s*5\s*1/)
  await expect(dialog.getByRole('row', { name: /^Characters without spaces/ })).toHaveText(/without spaces\s*27\s*6/)
  await expect(dialog.getByRole('row', { name: /^Parts/ })).toHaveText(/Parts\s*2/)
  await settled(dialog)
  expect((await new AxeBuilder({ page }).include('#editor').analyze()).violations).toEqual([])
  await page.keyboard.press('Escape')
  await expect(root(page).locator('[data-pz-more]')).toBeFocused()
})

test('the page as published: rendered HTML without the editing chrome', async ({ page }) => {
  await open(page)
  await more(page, 'page')
  const dialog = page.getByRole('dialog', { name: 'Preview as published' })
  await expect(dialog).toBeVisible()
  const html = await dialog.locator('.page-host').evaluate((el) => el.shadowRoot?.querySelector('.pz-content')?.innerHTML ?? '')
  expect(html).toBe(await page.evaluate(() => window.__editor!.editor.getHTML()))
  await expect(dialog.locator('.page-host').locator('h2')).toHaveText('Writing in Proza')
  expect(await dialog.locator('.page-host').evaluate((el) => el.shadowRoot!.querySelectorAll('[contenteditable]').length)).toBe(0)
  await page.screenshot({ path: test.info().outputPath('page.png') })
})

test('the page as published: a link opens a new window and never navigates the editing page', async ({ page }) => {
  const linked = { id: 'a', type: 'core/paragraph', attrs: { content: { text: 'See the site.', formats: [{ type: 'link', start: 4, end: 12, attrs: { href: 'https://example.com/' } }] } } }
  await open(page, [linked])
  const url = page.url()
  await more(page, 'page')
  const dialog = page.getByRole('dialog', { name: 'Preview as published' })
  // The new window is stubbed: the test is about the editing page staying put.
  await page.evaluate(() => { (window as unknown as { opened: string[] }).opened = []; window.open = (u) => { (window as unknown as { opened: string[] }).opened.push(String(u)); return null } })
  await dialog.locator('.page-host').locator('a').click()
  expect(page.url()).toBe(url)
  expect(await page.evaluate(() => (window as unknown as { opened: string[] }).opened)).toEqual(['https://example.com/'])
})

test('the page as published: raw HTML without the host sanitiser shows in a sandboxed frame, never in the page', async ({ page }) => {
  await open(page, [para('Before', 'a'), { id: 'r', type: 'core/html', attrs: { html: '<img src="x" onerror="window.pwned = true"><b>raw</b>' } }], '?rawhtml')
  await more(page, 'page')
  const dialog = page.getByRole('dialog', { name: 'Preview as published' })
  const frame = dialog.locator('.page-host iframe')
  await expect(frame).toHaveAttribute('sandbox', '')
  await expect(dialog.locator('.page-host').frameLocator('iframe').locator('b')).toHaveText('raw')
  expect(await dialog.locator('.page-host').evaluate((el) => el.shadowRoot!.querySelectorAll('.pz-content > .pz-html > img').length)).toBe(0)
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => (window as unknown as { pwned?: boolean }).pwned)).toBeUndefined()
})
