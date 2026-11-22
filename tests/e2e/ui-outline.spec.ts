/**
 * The list view and moving parts by dragging the
 * stems, with the non-drag path beside it (WCAG 2.5.7).
 */
import { expect, test } from '@playwright/test'
import { announcements, caret, focusedBlock, item, list, open, outline, para, selection } from './editor-helpers'

const OUTLINE = process.platform === 'darwin' ? 'Control+Alt+o' : 'Alt+Shift+o'
const MOVE_DOWN = process.platform === 'darwin' ? 'Control+Shift+ArrowDown' : 'Alt+Shift+ArrowDown'

const tree = (page: import('@playwright/test').Page) => page.getByRole('tree', { name: 'Outline of all parts' })
const focusedRow = (page: import('@playwright/test').Page) => page.evaluate(() => document.querySelector('#editor')!.shadowRoot!.activeElement?.getAttribute('data-row') ?? null)

test('the outline is a tree of every part with level and position, starting on the part with the caret', async ({ page }) => {
  await open(page, [para('one', 'a'), list([item('first', 'i1'), item('second', 'i2')], 'bullet', 'l'), para('end', 'b')])
  await caret(page, 'i2', 1)
  await page.keyboard.press(OUTLINE)
  await expect(tree(page)).toBeVisible()
  const row = tree(page).getByRole('treeitem', { name: 'List item: second' })
  await expect(row).toBeFocused()
  await expect(row).toHaveAttribute('aria-level', '2')
  await expect(row).toHaveAttribute('aria-posinset', '2')
  await expect(row).toHaveAttribute('aria-setsize', '2')
  await expect(row).toHaveAttribute('aria-selected', 'true')
  await expect(tree(page).getByRole('treeitem', { name: 'List', exact: true })).toHaveAttribute('aria-expanded', 'true')
})

test('arrows move, Left goes to the parent and collapses it, Right expands; Enter goes to the part', async ({ page }) => {
  await open(page, [para('one', 'a'), list([item('first', 'i1')], 'bullet', 'l'), para('end', 'b')])
  await caret(page, 'a', 0)
  await page.getByRole('toolbar', { name: 'Editor tools' }).getByRole('button', { name: 'Outline' }).click()
  expect(await focusedRow(page)).toBe('a')
  await page.keyboard.press('ArrowDown')
  expect(await focusedRow(page)).toBe('l')
  await page.keyboard.press('ArrowRight')
  expect(await focusedRow(page)).toBe('i1')
  await page.keyboard.press('ArrowLeft')
  expect(await focusedRow(page)).toBe('l')
  await page.keyboard.press('ArrowLeft')
  await expect(tree(page).getByRole('treeitem', { name: 'List', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('ArrowDown')
  expect(await focusedRow(page)).toBe('b')
  await page.keyboard.press('Enter')
  await expect(tree(page)).toBeHidden()
  expect(await selection(page)).toMatchObject({ kind: 'text', blockId: 'b' })
  expect(await focusedBlock(page)).toBe('b')
})

test('Alt+Shift+Down moves the part; Delete removes it and focus goes to the next row', async ({ page }) => {
  await open(page, [para('one', 'a'), para('two', 'b'), para('three', 'c')])
  await caret(page, 'a', 0)
  await page.keyboard.press(OUTLINE)
  await page.keyboard.press(MOVE_DOWN)
  expect(await outline(page)).toEqual(['paragraph: two', 'paragraph: one', 'paragraph: three'])
  expect(await focusedRow(page)).toBe('a')
  expect((await announcements(page)).at(-1)).toBe('Moved to position 2 of 3')
  await page.keyboard.press('Delete')
  expect(await outline(page)).toEqual(['paragraph: two', 'paragraph: three'])
  expect(await focusedRow(page)).toBe('c')
})

test('Move to: choose the part to put it after, or the very start; Escape cancels', async ({ page }) => {
  await open(page, [para('one', 'a'), para('two', 'b'), list([item('first', 'i1')], 'bullet', 'l')])
  await caret(page, 'b', 0)
  await page.keyboard.press(OUTLINE)
  await page.getByRole('button', { name: 'Move to…' }).click()
  expect((await announcements(page)).at(-1)).toMatch(/^Moving “Text: two”/)
  expect(await focusedRow(page)).toBe('pz:start')
  await page.keyboard.press('Enter')
  expect(await outline(page)).toEqual(['paragraph: two', 'paragraph: one', 'list', '  list-item: first'])
  // A paragraph cannot go into a list after an item: it is refused, and Escape cancels.
  await page.getByRole('button', { name: 'Move to…' }).click()
  await tree(page).getByRole('treeitem', { name: 'List item: first' }).click()
  expect((await announcements(page)).at(-1)).toBe('It cannot go there.')
  await page.keyboard.press('Escape')
  expect((await announcements(page)).at(-1)).toBe('Move cancelled')
  await expect(tree(page)).toBeVisible()
  await page.getByRole('button', { name: 'Move to…' }).click()
  await tree(page).getByRole('treeitem', { name: 'List', exact: true }).click()
  expect(await outline(page)).toEqual(['paragraph: one', 'list', '  list-item: first', 'paragraph: two'])
})

test('dragging the stems moves the part, with a drop line', async ({ page }) => {
  await open(page, [para('one', 'a'), para('two', 'b'), para('three', 'c')])
  await caret(page, 'a', 0)
  const handle = (await page.locator('.gut:not(.is-hover) .legs').boundingBox())!
  const target = (await page.locator('[data-block="c"]').boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 20, { steps: 4 })
  await page.mouse.move(handle.x + handle.width / 2, target.y + target.height - 2, { steps: 8 })
  await expect(page.locator('.dropline')).toBeVisible()
  await page.mouse.up()
  expect(await outline(page)).toEqual(['paragraph: two', 'paragraph: three', 'paragraph: one'])
  await expect(page.locator('.dropline')).toBeHidden()
  // The drag was not a click: the options stay closed.
  await expect(page.getByRole('dialog', { name: /^Options for this part/ })).toBeHidden()
})

test('parts selected whole from a drag across list items or table paragraphs keep the stems in the part gutter', async ({ page }) => {
  await open(page, [
    list([item('First item', 'i1'), item('Second item', 'i2')], 'bullet', 'l'),
    { type: 'core/table', id: 't', children: [
      { type: 'core/table-row', id: 'r', children: [
        { type: 'core/table-cell', id: 'left', children: [para('Adjacent cell', 'a')] },
        { type: 'core/table-cell', id: 'right', children: [para('First paragraph', 'p1'), para('Second paragraph', 'p2')] },
      ] },
    ] },
  ])

  for (const [part, first, last] of [['l', 'i1', 'i2'], ['t', 'p2', 'p1']] as const) {
    await caret(page, first, 0)
    const start = (await page.locator(`[data-block="${first}"] [data-field]`).boundingBox())!
    const end = (await page.locator(`[data-block="${last}"] [data-field]`).boundingBox())!
    await page.mouse.move(start.x + 10, start.y + 8)
    await page.mouse.down()
    await page.mouse.move(end.x + 10, end.y + 8, { steps: 8 })
    await page.mouse.up()
    // The drag selects text across the parts; Escape selects the parts whole.
    await page.keyboard.press('Escape')

    const selected = page.locator(`[data-block="${part}"] .is-selected`)
    await expect(selected).toHaveCount(2)
    await expect(page.locator('.stems')).toHaveCount(1)
    await expect(page.locator(`.stems + .gut [data-pz-legs="${part}"]`)).toBeVisible()
    expect(await selected.evaluateAll((els) => els.map((el) => [
      getComputedStyle(el, '::before').content,
      getComputedStyle(el, '::after').content,
    ]))).toEqual([['none', 'none'], ['none', 'none']])
  }
})
