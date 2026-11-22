/**
 * Layout parts: columns, group, fold-out, buttons
 * and space; the part options' path to the part inside; wide and full parts;
 * columns stacking in the device preview.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { announcements, caret, expectCanonical, open, para, selection } from './editor-helpers'

type Raw = Record<string, unknown>
const rich = (text: string) => ({ text, formats: [] })
const columns = (ratio: string, ...texts: string[]): Raw => ({
  id: 'cs', type: 'core/columns', attrs: { ratio },
  children: texts.map((t, i) => ({ id: `col${i}`, type: 'core/column', attrs: {}, children: [{ id: `cp${i}`, type: 'core/paragraph', attrs: { content: rich(t) } }] })),
})
const html = (page: Page): Promise<string> => page.evaluate(() => window.__editor!.editor.getHTML())
const options = (page: Page) => page.getByRole('dialog', { name: /^Options for this part/ })
const openOptions = (page: Page) => page.locator('.gut:not(.is-hover) .cfg').click()

async function add(page: Page, name: string): Promise<void> {
  await page.keyboard.type(`/${name}`)
  await page.keyboard.press('Enter')
}

test('Columns from the add menu: two columns to type in, never joined by Backspace; the options switch the ratio', async ({ page }) => {
  await open(page, [para('', 'a')])
  await caret(page, 'a', 0)
  await add(page, 'columns')
  await page.keyboard.type('Left')
  expect(await html(page)).toBe('<div class="pz-columns pz-layout-1-1"><div class="pz-column"><p>Left</p></div><div class="pz-column"><p></p></div></div>')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type('Right')
  await page.keyboard.press('Home')
  await page.keyboard.press('Backspace')
  expect(await html(page)).toContain('<p>Left</p></div><div class="pz-column"><p>Right</p>')
  await openOptions(page)
  // The options act on the text inside; the path reaches the columns.
  const path = options(page).getByRole('group', { name: 'Options for' })
  await expect(path.getByRole('button')).toHaveText(['Columns', 'Column', 'Text'])
  await expect(path.getByRole('button', { name: 'Text' })).toHaveAttribute('aria-pressed', 'true')
  await path.getByRole('button', { name: 'Columns' }).click()
  await options(page).getByRole('group', { name: 'Columns' }).getByRole('button', { name: 'Three equal' }).click()
  expect(await html(page)).toContain('<div class="pz-columns pz-layout-1-1-1">')
  expect(await page.locator('.pz-canvas .pz-column').count()).toBe(3)
  await options(page).getByRole('group', { name: 'Columns' }).getByRole('button', { name: 'Two equal' }).click()
  expect(await html(page)).toBe('<div class="pz-columns pz-layout-1-1"><div class="pz-column"><p>Left</p></div><div class="pz-column"><p>Right</p></div></div>')
  await expectCanonical(page)
})

test('columns stack on a phone, first column on top; side by side on a tablet', async ({ page }) => {
  await open(page, [columns('2-1', 'Main', 'Side')])
  const tracks = (): Promise<number> => page.evaluate(() => getComputedStyle(document.querySelector('#editor')!.shadowRoot!.querySelector('.pz-columns')!).gridTemplateColumns.split(' ').length)
  expect(await tracks()).toBe(2)
  const preview = page.getByRole('toolbar', { name: 'Editor tools' }).getByRole('button', { name: 'Device preview' })
  await preview.click()
  await page.getByRole('menuitemradio', { name: /Phone/ }).click()
  await expect.poll(tracks).toBe(1)
  const top = async (id: string): Promise<number> => (await page.locator(`[data-block="${id}"]`).boundingBox())!.y
  expect(await top('col0')).toBeLessThan(await top('col1'))
  await preview.click()
  await page.getByRole('menuitemradio', { name: /Tablet/ }).click()
  await expect.poll(tracks).toBe(2)
})

test('a group: its look and meaning in the options, taken apart again', async ({ page }) => {
  await open(page, [para('', 'a')])
  await caret(page, 'a', 0)
  await add(page, 'group')
  await page.keyboard.type('Inside')
  await openOptions(page)
  await options(page).getByRole('group', { name: 'Options for' }).getByRole('button', { name: 'Group' }).click()
  await options(page).getByRole('group', { name: 'Meaning' }).getByRole('button', { name: 'Side note' }).click()
  expect(await html(page)).toBe('<aside class="pz-group pz-look-panel"><p>Inside</p></aside>')
  await options(page).getByRole('group', { name: 'Look' }).getByRole('button', { name: 'Outline' }).click()
  expect(await html(page)).toBe('<aside class="pz-group pz-look-line"><p>Inside</p></aside>')
  await options(page).getByRole('button', { name: 'Take the group apart' }).click()
  expect(await html(page)).toBe('<p>Inside</p>')
  expect((await announcements(page)).at(-1)).toBe('Group taken apart')
})

test('a fold-out: Enter after its title starts its content; the page gets details, open if asked', async ({ page }) => {
  await open(page, [para('', 'a')])
  await caret(page, 'a', 0)
  await add(page, 'fold')
  await expect(page.locator('.pz-canvas .pz-summary [data-field]')).toHaveAccessibleName('Title of the fold-out')
  await page.keyboard.type('Do you deliver?')
  await page.keyboard.press('Enter')
  await page.keyboard.type('On Fridays.')
  expect(await html(page)).toBe('<details class="pz-details"><summary>Do you deliver?</summary><div class="pz-details-body"><p>On Fridays.</p><p></p></div></details>')
  await openOptions(page)
  await options(page).getByRole('group', { name: 'Options for' }).getByRole('button', { name: 'Fold-out' }).click()
  await options(page).getByRole('checkbox', { name: /Open when the page loads/ }).check()
  expect(await html(page)).toContain('<details class="pz-details" open>')
  await expectCanonical(page)
})

test('buttons: the part asks for a link; Enter adds a button, Enter on an empty one leaves for text', async ({ page }) => {
  await open(page, [para('', 'a')])
  await caret(page, 'a', 0)
  await add(page, 'button')
  await page.keyboard.type('Book a visit')
  // Without an address a button is not published, and the part says so.
  expect(await html(page)).toBe('')
  await page.locator('.pz-canvas').getByRole('button', { name: 'Add a link' }).click()
  const link = options(page).getByRole('textbox', { name: 'Goes to' })
  await expect(options(page).getByRole('group', { name: 'Options for' }).getByRole('button', { name: 'Button', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await link.fill('javascript:alert(1)')
  await link.press('Enter')
  await expect(options(page).getByText('This address cannot be used. Start it with https:// or /.')).toBeVisible()
  await link.fill('/book')
  await link.press('Enter')
  expect(await html(page)).toBe('<div class="pz-buttons"><a class="pz-button pz-button-fill" href="/book">Book a visit</a></div>')
  await page.keyboard.press('Escape')
  await page.locator('.pz-canvas .pz-button [data-field]').first().click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(page.locator('.pz-canvas .pz-button')).toHaveCount(2)
  await page.keyboard.press('Enter')
  await expect(page.locator('.pz-canvas .pz-button')).toHaveCount(1)
  expect(await page.evaluate(() => window.__editor!.outline())).toEqual(['buttons', '  button: Book a visit', 'paragraph: '])
  expect(await selection(page)).toMatchObject({ kind: 'text', field: 'content', anchor: 0 })
})

test('a space is chosen as a whole and its height is a preset; wide and full go past the column', async ({ page }) => {
  await open(page, [para('Before', 'a'), { id: 's', type: 'core/spacer', attrs: {} }, { id: 'g', type: 'core/group', attrs: {}, children: [para('In', 'gp')] }])
  await caret(page, 'a', 6)
  await page.keyboard.press('ArrowRight')
  expect(await selection(page)).toEqual({ kind: 'blocks', anchorId: 's', focusId: 's' })
  await openOptions(page)
  await options(page).getByRole('group', { name: 'Height' }).getByRole('button', { name: 'Large', exact: true }).click()
  expect(await html(page)).toContain('<div class="pz-spacer pz-space-l" aria-hidden="true"></div>')
  await page.keyboard.press('Escape')
  await caret(page, 'gp', 0)
  await openOptions(page)
  await options(page).getByRole('group', { name: 'Options for' }).getByRole('button', { name: 'Group' }).click()
  await options(page).getByRole('group', { name: 'Page width' }).getByRole('button', { name: 'Full width' }).click()
  expect(await html(page)).toContain('<div class="pz-group pz-bleed-full"><p>In</p></div>')
})

test('the layout sample passes axe in light and dark', async ({ page }) => {
  // Measured at rest: contrast is not measured halfway through a fade.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const theme of ['light', 'dark']) {
    await open(page, undefined, `?sample=layout&theme=${theme}`)
    await page.locator('[data-block="b1p"] [data-field]').click()
    const results = await new AxeBuilder({ page }).include('#editor').analyze()
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  }
})
