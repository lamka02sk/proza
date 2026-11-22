/**
 * Undo and redo over the editor's transactions.
 */
import { expect, test } from '@playwright/test'
import { MOD, announcements, caret, open, outline, para, selection } from './editor-helpers'

test('typing undoes by words, and redo brings them back', async ({ page }) => {
  await open(page, [para('', 'a')])
  await caret(page, 'a', 0)
  await page.keyboard.type('hello world')
  await page.keyboard.press(`${MOD}+z`)
  expect(await outline(page)).toEqual(['paragraph: hello '])
  await page.keyboard.press(`${MOD}+z`)
  expect(await outline(page)).toEqual(['paragraph: '])
  await page.keyboard.press(`${MOD}+Shift+z`)
  await page.keyboard.press(`${MOD}+Shift+z`)
  expect(await outline(page)).toEqual(['paragraph: hello world'])
})

test('undo of a split restores one block and the caret where Enter was pressed', async ({ page }) => {
  await open(page, [para('onetwo', 'a')])
  await caret(page, 'a', 3)
  await page.keyboard.press('Enter')
  expect(await outline(page)).toEqual(['paragraph: one', 'paragraph: two'])
  await page.keyboard.press(`${MOD}+z`)
  expect(await outline(page)).toEqual(['paragraph: onetwo'])
  expect(await selection(page)).toMatchObject({ kind: 'text', blockId: 'a', anchor: 3, focus: 3 })
  await page.keyboard.type('|')
  expect(await outline(page)).toEqual(['paragraph: one|two'])
})

test('an inline input rule is its own step: undo gives back the typed delimiters', async ({ page }) => {
  await open(page, [para('', 'a')])
  await caret(page, 'a', 0)
  await page.keyboard.type('**b**')
  const formats = await page.evaluate(() => window.__editor!.json().blocks[0]!.attrs.content)
  expect(formats).toEqual({ text: 'b', formats: [{ type: 'bold', start: 0, end: 1 }] })
  await page.keyboard.press(`${MOD}+z`)
  expect(await outline(page)).toEqual(['paragraph: **b**'])
})

test('undo on selected blocks brings removed blocks back, selected', async ({ page }) => {
  await open(page, [para('one', 'a'), para('two', 'b')])
  await caret(page, 'b', 1)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Delete')
  expect(await outline(page)).toEqual(['paragraph: one'])
  await page.keyboard.press(`${MOD}+z`)
  expect(await outline(page)).toEqual(['paragraph: one', 'paragraph: two'])
  expect(await selection(page)).toEqual({ kind: 'blocks', anchorId: 'b', focusId: 'b' })
  expect(await announcements(page)).toContain('Undone')
})

test('a join is one step', async ({ page }) => {
  await open(page, [para('one', 'a'), para('two', 'b')])
  await caret(page, 'b', 0)
  await page.keyboard.press('Backspace')
  await page.keyboard.press(`${MOD}+z`)
  expect(await outline(page)).toEqual(['paragraph: one', 'paragraph: two'])
  expect(await selection(page)).toMatchObject({ blockId: 'b', focus: 0 })
})
