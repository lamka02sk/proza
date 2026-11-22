/**
 * Split, merge and change of type in the editor core.
 * Real keys in three engines; assertions on the model, then the DOM.
 */
import { expect, test } from '@playwright/test'
import { MOD, caret, code, expectCanonical, heading, item, list, open, outline, para, quote, selection, separator } from './editor-helpers'

const ALT_SHIFT = process.platform === 'darwin' ? 'Control+Alt' : 'Alt+Shift'

test.describe('Enter', () => {
  test('splits a paragraph and puts the caret at the start of the new one', async ({ page }) => {
    await open(page, [para('Hello world', 'a')])
    await caret(page, 'a', 5)
    await page.keyboard.press('Enter')
    await page.keyboard.type('X')
    expect(await outline(page)).toEqual(['paragraph: Hello', 'paragraph: X world'])
    await expectCanonical(page)
  })

  test('at the end of a heading starts a paragraph; in the middle keeps the heading', async ({ page }) => {
    await open(page, [heading('Title here', 2, 'h')])
    await caret(page, 'h', 5)
    await page.keyboard.press('Enter')
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Body')
    expect(await outline(page)).toEqual(['heading2: Title', 'heading2:  here', 'paragraph: Body'])
  })

  test('at the start of text pushes it down: an empty paragraph above, the caret stays', async ({ page }) => {
    await open(page, [heading('Title', 2, 'h')])
    await caret(page, 'h', 0)
    await page.keyboard.press('Enter')
    await page.keyboard.type('T')
    expect(await outline(page)).toEqual(['paragraph: ', 'heading2: TTitle'])
  })

  test('carries bold into the new paragraph, not a link', async ({ page }) => {
    await open(page, [para('ab', 'a')])
    await caret(page, 'a', 2)
    await page.keyboard.press(`${MOD}+b`)
    await page.keyboard.type('c')
    await page.keyboard.press('Enter')
    await page.keyboard.type('d')
    const json = await page.evaluate(() => window.__editor!.json().blocks.map((b) => b.attrs.content))
    expect(json).toEqual([
      { text: 'abc', formats: [{ type: 'bold', start: 2, end: 3 }] },
      { text: 'd', formats: [{ type: 'bold', start: 0, end: 1 }] },
    ])
  })

  test('in a list item adds an item; in an empty last item leaves the list', async ({ page }) => {
    await open(page, [list([item('one', 'i1')], 'bullet', 'l')])
    await caret(page, 'i1', 3)
    await page.keyboard.press('Enter')
    await page.keyboard.type('two')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('after')
    expect(await outline(page)).toEqual(['list', '  list-item: one', '  list-item: two', 'paragraph: after'])
    await expectCanonical(page)
  })

  test('in an empty last paragraph of a quote leaves the quote', async ({ page }) => {
    await open(page, [quote([para('Quoted', 'qp')], '', 'q')])
    await caret(page, 'qp', 6)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Out')
    expect(await outline(page)).toEqual(['quote', '  paragraph: Quoted', 'paragraph: Out'])
  })

  test('in code adds a line; on two empty lines at the end leaves the code', async ({ page }) => {
    await open(page, [code('a', 'c')])
    await caret(page, 'c', 1)
    await page.keyboard.press('Enter')
    await page.keyboard.type('b')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('text')
    expect(await outline(page)).toEqual(['code: a\nb', 'paragraph: text'])
  })
})

test.describe('Backspace and Delete at the edges', () => {
  test('Backspace at the start joins with the block before; the caret sits at the join', async ({ page }) => {
    await open(page, [heading('Head', 2, 'h'), para('tail', 'p')])
    await caret(page, 'p', 0)
    await page.keyboard.press('Backspace')
    await page.keyboard.type('|')
    expect(await outline(page)).toEqual(['heading2: Head|tail'])
    await expectCanonical(page)
  })

  test('Backspace at the start of the document turns a heading into text', async ({ page }) => {
    await open(page, [heading('Head', 2, 'h')])
    await caret(page, 'h', 0)
    await page.keyboard.press('Backspace')
    expect(await outline(page)).toEqual(['paragraph: Head'])
  })

  test('Delete at the end pulls the next block in', async ({ page }) => {
    await open(page, [para('one', 'a'), para('two', 'b')])
    await caret(page, 'a', 3)
    await page.keyboard.press('Delete')
    expect(await outline(page)).toEqual(['paragraph: onetwo'])
    expect(await selection(page)).toMatchObject({ kind: 'text', blockId: 'a', anchor: 3, focus: 3 })
  })

  test('after a separator: Backspace selects it, the next Backspace removes it', async ({ page }) => {
    await open(page, [para('one', 'a'), separator('s'), para('two', 'b')])
    await caret(page, 'b', 0)
    await page.keyboard.press('Backspace')
    expect(await selection(page)).toEqual({ kind: 'blocks', anchorId: 's', focusId: 's' })
    await page.keyboard.press('Backspace')
    expect(await outline(page)).toEqual(['paragraph: one', 'paragraph: two'])
    await page.keyboard.type('!')
    expect(await outline(page)).toEqual(['paragraph: one!', 'paragraph: two'])
  })

  test('Backspace at the start of a first list item turns it into text; of a later item joins it to the one before', async ({ page }) => {
    await open(page, [list([item('one', 'i1'), item('two', 'i2'), item('three', 'i3')], 'bullet', 'l')])
    await caret(page, 'i2', 0)
    await page.keyboard.press('Backspace')
    expect(await outline(page)).toEqual(['list', '  list-item: onetwo', '  list-item: three'])
    await caret(page, 'i1', 0)
    await page.keyboard.press('Backspace')
    expect(await outline(page)).toEqual(['paragraph: onetwo', 'list', '  list-item: three'])
  })

  test('Backspace at the start of the first paragraph of a quote takes it out of the quote', async ({ page }) => {
    await open(page, [quote([para('first', 'a'), para('second', 'b')], '', 'q')])
    await caret(page, 'a', 0)
    await page.keyboard.press('Backspace')
    expect(await outline(page)).toEqual(['paragraph: first', 'quote', '  paragraph: second'])
  })
})

test.describe('lists', () => {
  test('Tab indents under the item before, Shift+Tab outdents, the caret stays', async ({ page }) => {
    await open(page, [list([item('one', 'i1'), item('two', 'i2'), item('three', 'i3')], 'bullet', 'l')])
    await caret(page, 'i2', 1)
    await page.keyboard.press('Tab')
    expect(await outline(page)).toEqual(['list', '  list-item: one', '    list', '      list-item: two', '  list-item: three'])
    await page.keyboard.type('x')
    expect(await outline(page)).toContain('      list-item: txwo')
    await page.keyboard.press('Shift+Tab')
    expect(await outline(page)).toEqual(['list', '  list-item: one', '  list-item: txwo', '  list-item: three'])
    await expectCanonical(page)
  })

  test('Tab on the first item stays in the editor and changes nothing', async ({ page }) => {
    await open(page, [list([item('one', 'i1')], 'bullet', 'l')])
    await caret(page, 'i1', 0)
    await page.keyboard.press('Tab')
    expect(await outline(page)).toEqual(['list', '  list-item: one'])
    expect(await selection(page)).toMatchObject({ kind: 'text', blockId: 'i1' })
  })

  test('Shift+Tab on a top-level item in the middle splits the list around a paragraph', async ({ page }) => {
    await open(page, [list([item('a', 'i1'), item('b', 'i2'), item('c', 'i3')], 'number', 'l')])
    await caret(page, 'i2', 1)
    await page.keyboard.press('Shift+Tab')
    expect(await outline(page)).toEqual(['list', '  list-item: a', 'paragraph: b', 'list', '  list-item: c'])
    const lists = await page.evaluate(() => window.__editor!.json().blocks.filter((b) => b.type === 'core/list').map((b) => b.attrs.style))
    expect(lists).toEqual(['number', 'number'])
  })
})

test.describe('block input rules and commands', () => {
  for (const [typed, want] of [
    ['## ', ['heading2: Title']],
    ['- ', ['list', '  list-item: Title']],
    ['1. ', ['list', '  list-item: Title']],
    ['> ', ['quote', '  paragraph: Title']],
  ] as const) {
    test(`"${typed}" changes the paragraph`, async ({ page }) => {
      await open(page, [para('', 'a')])
      await caret(page, 'a', 0)
      await page.keyboard.type(`${typed}Title`)
      expect(await outline(page)).toEqual(want)
      await expectCanonical(page)
    })
  }

  test('one undo after a block rule gives the typed prefix back', async ({ page }) => {
    await open(page, [para('', 'a')])
    await caret(page, 'a', 0)
    await page.keyboard.type('# ')
    expect(await outline(page)).toEqual(['heading1: '])
    await page.keyboard.press(`${MOD}+z`)
    expect(await outline(page)).toEqual(['paragraph: # '])
  })

  test('three backticks and Enter make a code block; three dashes a separator', async ({ page }) => {
    await open(page, [para('', 'a')])
    await caret(page, 'a', 0)
    await page.keyboard.type('```')
    await page.keyboard.press('Enter')
    await page.keyboard.type('x')
    expect(await outline(page)).toEqual(['code: x'])
    await open(page, [para('', 'b')])
    await caret(page, 'b', 0)
    await page.keyboard.type('---')
    await page.keyboard.press('Enter')
    await page.keyboard.type('y')
    expect(await outline(page)).toEqual(['separator', 'paragraph: y'])
  })

  test('shortcuts change the type and keep the caret', async ({ page }) => {
    await open(page, [para('Words', 'a')])
    await caret(page, 'a', 2)
    await page.keyboard.press(`${ALT_SHIFT}+2`)
    expect(await outline(page)).toEqual(['heading2: Words'])
    await page.keyboard.type('x')
    expect(await outline(page)).toEqual(['heading2: Woxrds'])
    await page.keyboard.press(`${ALT_SHIFT}+0`)
    await page.keyboard.press(`${MOD}+Shift+8`)
    expect(await outline(page)).toEqual(['list', '  list-item: Woxrds'])
  })
})
