/**
 * Tables: adding one, Tab and
 * the arrows between cells, the cell tools (rows, columns, merge, split),
 * cell selection by keyboard and pointer, clipboard over cells, the table's
 * options and its output in both responsive modes.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { MOD, announcements, caret, expectCanonical, open, para, selection } from './editor-helpers'

type Raw = Record<string, unknown>
const rich = (text: string) => ({ text, formats: [] })
const cell = (id: string, text: string, header = false): Raw => ({ id, type: 'core/table-cell', attrs: header ? { header: true, scope: 'col' } : {}, children: [{ id: `${id}p`, type: 'core/paragraph', attrs: { content: rich(text) } }] })
/** A table `t` of rows × cols with a header row; cell ids `c<row><col>`, paragraph ids `c<row><col>p`, texts `<row>.<col>`. */
const table = (rows: number, cols: number): Raw => ({
  id: 't', type: 'core/table', attrs: { caption: rich('Prices') },
  children: Array.from({ length: rows }, (_, r) => ({ id: `r${r}`, type: 'core/table-row', attrs: {}, children: Array.from({ length: cols }, (_, c) => cell(`c${r}${c}`, `${r}.${c}`, r === 0)) })),
})

/** Cell texts row by row, from the model. */
const grid = (page: Page): Promise<string[][]> => page.evaluate(() => {
  const ed = window.__editor!.editor
  const t = ed.tree
  const text = (id: string): string => (t.children.get(id) ?? []).map((p) => (t.nodes.get(p)!.attrs.content as { text: string }).text).join('|')
  return (t.children.get('t') ?? []).map((r) => (t.children.get(r) ?? []).map(text))
})
const html = (page: Page): Promise<string> => page.evaluate(() => window.__editor!.editor.getHTML())
const cellBar = (page: Page) => page.getByRole('toolbar', { name: 'This row and column' })
const options = (page: Page) => page.getByRole('dialog', { name: /^Options for this part/ })

test('Table from the add menu: a header row, the caret in the first cell; Tab walks the cells and adds a row at the end', async ({ page }) => {
  await open(page, [para('', 'a')])
  await caret(page, 'a', 0)
  await page.keyboard.type('/table')
  await page.keyboard.press('Enter')
  const canvas = page.locator('.pz-canvas table')
  await expect(canvas.locator('th')).toHaveCount(3)
  await expect(canvas.locator('tr')).toHaveCount(3)
  await page.keyboard.type('Item')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Price')
  for (let i = 0; i < 8; i++) await page.keyboard.press('Tab')
  // Past the last cell: a new row, the caret in its first cell.
  await expect(canvas.locator('tr')).toHaveCount(4)
  expect((await announcements(page)).at(-1)).toBe('Row added')
  await page.keyboard.type('Tea')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.type('!')
  expect(await html(page)).toMatch(/<th scope="col">Item<\/th><th scope="col">Price<\/th>/)
  expect(await html(page)).toMatch(/<tr><td>Tea<\/td><td><\/td><td><\/td><\/tr>/)
  expect(await html(page)).toContain('<tr><td>!</td><td></td><td></td></tr><tr><td>Tea</td>')
  await expectCanonical(page)
})

test('Up and Down keep to the column, and leave the table at its edges', async ({ page }) => {
  await open(page, [para('Before', 'a'), table(3, 3), para('After', 'z')])
  await caret(page, 'c01p', 1)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  expect(await selection(page)).toMatchObject({ kind: 'text', blockId: 'c21p' })
  await page.keyboard.press('ArrowDown')
  expect(await selection(page)).toMatchObject({ kind: 'text', blockId: 'z' })
  await page.keyboard.press('ArrowUp')
  expect(await selection(page)).toMatchObject({ kind: 'text', blockId: 'c21p' })
  // From below, the cell under the caret: the end of "After" is in the first column.
  await caret(page, 'z', 0)
  await page.keyboard.press('ArrowUp')
  expect(await selection(page)).toMatchObject({ kind: 'text', blockId: 'c20p' })
})

test('the cell tools add and remove rows and columns, announced, one undo step each', async ({ page }) => {
  await open(page, [table(2, 2)])
  await page.locator('[data-block="c10p"] [data-field]').click()
  const bar = cellBar(page)
  await expect(bar).toBeVisible()
  await bar.getByRole('button', { name: 'Row' }).click()
  await page.getByRole('menuitem', { name: 'Add row below' }).click()
  expect(await grid(page)).toEqual([['0.0', '0.1'], ['1.0', '1.1'], ['', '']])
  expect((await announcements(page)).at(-1)).toBe('Row added')
  await bar.getByRole('button', { name: 'Column' }).click()
  await page.getByRole('menuitem', { name: 'Add column right' }).click()
  expect(await grid(page)).toEqual([['0.0', '', '0.1'], ['1.0', '', '1.1'], ['', '', '']])
  // The new column's header cell is a header cell too.
  await expect(page.locator('.pz-canvas table tr').first().locator('th')).toHaveCount(3)
  await bar.getByRole('button', { name: 'Column' }).click()
  await page.getByRole('menuitem', { name: 'Remove this column' }).click()
  expect(await grid(page)).toEqual([['0.0', '0.1'], ['1.0', '1.1'], ['', '']])
  await page.keyboard.press(`${MOD}+z`)
  await page.keyboard.press(`${MOD}+z`)
  await page.keyboard.press(`${MOD}+z`)
  expect(await grid(page)).toEqual([['0.0', '0.1'], ['1.0', '1.1']])
  await expectCanonical(page)
})

test('Shift+arrows out of a cell select cells; Merge and Split; Delete empties the selected cells', async ({ page }) => {
  await open(page, [table(3, 3)])
  await caret(page, 'c11p', 3)
  await page.keyboard.press('Shift+ArrowRight')
  expect(await selection(page)).toEqual({ kind: 'cells', tableId: 't', anchorId: 'c11', focusId: 'c12' })
  expect((await announcements(page)).at(-1)).toBe('1 by 2 cells selected')
  await page.keyboard.press('Shift+ArrowDown')
  expect((await announcements(page)).at(-1)).toBe('2 by 2 cells selected')
  await expect(page.locator('.pz-canvas td.is-selected')).toHaveCount(4)
  await cellBar(page).getByRole('button', { name: 'Merge cells' }).click()
  expect((await announcements(page)).at(-1)).toBe('Cells merged')
  expect(await html(page)).toContain('<td colspan="2" rowspan="2"><p>1.1</p><p>1.2</p><p>2.1</p><p>2.2</p></td>')
  await cellBar(page).getByRole('button', { name: 'Split cell' }).click()
  expect((await grid(page))[1]).toEqual(['1.0', '1.1|1.2|2.1|2.2', ''])
  await page.keyboard.press(`${MOD}+z`)
  await page.keyboard.press(`${MOD}+z`)
  // At the end of the text Shift+arrows go on into the next cells.
  await caret(page, 'c01p', 3)
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Delete')
  expect((await grid(page)).map((r) => r[1])).toEqual(['', '', ''])
  expect((await announcements(page)).at(-1)).toBe('3 cells emptied')
  // Escape selects the table; Enter goes back into it.
  await page.keyboard.press('Escape')
  expect(await selection(page)).toEqual({ kind: 'blocks', anchorId: 't', focusId: 't' })
})

test('a drag from one cell into another selects cells; typing replaces them', async ({ page }) => {
  await open(page, [table(2, 3)])
  const from = (await page.locator('[data-block="c10p"] [data-field]').boundingBox())!
  const to = (await page.locator('[data-block="c11p"] [data-field]').boundingBox())!
  await page.mouse.move(from.x + 4, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 })
  await page.mouse.up()
  expect(await selection(page)).toMatchObject({ kind: 'cells', anchorId: 'c10', focusId: 'c11' })
  await page.keyboard.type('x')
  expect((await grid(page))[1]).toEqual(['x', '', '1.2'])
  expect(await selection(page)).toMatchObject({ kind: 'text', anchor: 1 })
})

test('copied cells paste into other cells as a spreadsheet does', async ({ page, browserName }) => {
  if (browserName === 'chromium') await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await open(page, [table(3, 3)])
  await caret(page, 'c10p', 3)
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press(`${MOD}+c`)
  expect((await announcements(page)).at(-1)).toBe('2 parts copied')
  await caret(page, 'c22p', 0)
  await page.keyboard.press(`${MOD}+v`)
  // Pasting past the last column adds one.
  expect(await grid(page)).toEqual([['0.0', '0.1', '0.2', ''], ['1.0', '1.1', '1.2', ''], ['2.0', '2.1', '1.0', '1.1']])
  await expectCanonical(page)
})

test('the options: header row and column, rows as cards (not with merged cells), and the page output', async ({ page }) => {
  await open(page, [table(2, 2)])
  await caret(page, 'c10p', 0)
  await page.locator('.gut:not(.is-hover) .cfg').click()
  const dlg = options(page)
  await dlg.getByRole('checkbox', { name: 'Header column' }).check()
  expect(await html(page)).toContain('<th scope="row">1.0</th>')
  await dlg.getByRole('group', { name: 'On a narrow screen' }).getByRole('button', { name: 'Rows as cards' }).click()
  expect(await html(page)).toContain('class="pz-table pz-table-stack"')
  expect(await html(page)).toContain('<td role="cell" data-pz-label="0.1">1.1</td>')
  await dlg.getByRole('checkbox', { name: 'Header row' }).uncheck()
  expect(await html(page)).not.toContain('scope="col"')
  await page.keyboard.press('Escape')
  // Merged cells: cards are not offered, and the page keeps the table.
  await caret(page, 'c00p', 3)
  await page.keyboard.press('Shift+ArrowRight')
  await cellBar(page).getByRole('button', { name: 'Merge cells' }).click()
  await page.locator('.gut:not(.is-hover) .cfg').click()
  await expect(options(page).getByRole('button', { name: 'Rows as cards' })).toBeDisabled()
  await expect(options(page).getByText('Rows as cards needs a table without merged cells.')).toBeVisible()
  expect(await html(page)).not.toContain('pz-table-stack')
})

test('the cell tools pass axe and are reached with Alt+F10; Escape goes back to the cell', async ({ page }) => {
  // WebKit: axe measured the cell bar mid-fade and reported its contrast.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page, [table(2, 2)])
  await page.locator('[data-block="c11p"] [data-field]').click()
  // WebKit: Alt+F10 straight after the click can come before the cell bar renders, and then goes to the part tools.
  await expect(cellBar(page)).toBeVisible()
  await page.keyboard.press('Alt+F10')
  await expect(cellBar(page).getByRole('button', { name: 'Row' })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(cellBar(page).getByRole('button', { name: 'Column' })).toBeFocused()
  await page.keyboard.press('Escape')
  expect(await selection(page)).toMatchObject({ kind: 'text', blockId: 'c11p' })
  const results = await new AxeBuilder({ page }).include('#editor').analyze()
  expect(results.violations.map((v) => v.id)).toEqual([])
})
