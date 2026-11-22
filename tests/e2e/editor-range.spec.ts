/**
 * Text selected across parts: made
 * with Shift and the arrows, a drag or Shift+click; deleted, typed over,
 * formatted, copied, cut and pasted as one undo step each.
 */
import { expect, test, type Page } from '@playwright/test'
import { MOD, announcements, caret, expectCanonical, focusedBlock, item, list, open, outline, para, selection, separator } from './editor-helpers'

const range = (anchor: [string, number], focus: [string, number], field = 'content') => ({
  kind: 'range',
  anchor: { blockId: anchor[0], field, offset: anchor[1] },
  focus: { blockId: focus[0], field, offset: focus[1] },
})

async function select(page: Page, anchor: [string, number], focus: [string, number]): Promise<void> {
  await page.evaluate((r) => { window.__editor!.editor.select(r as never) }, range(anchor, focus))
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)))
}

async function realClipboard(page: Page, browserName: string): Promise<void> {
  if (browserName === 'chromium') await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
}

/** Whether the canvas is the editing host (only while a selection spans fields). */
const spanning = (page: Page): Promise<boolean> => page.evaluate(() => document.querySelector('#editor')!.shadowRoot!.querySelector('.pz-canvas')!.getAttribute('contenteditable') === 'true')

/** The text the native selection covers. */
const nativeText = (page: Page): Promise<string> => page.evaluate(() => document.getSelection()?.toString() ?? '')

test.describe('making a selection across parts', () => {
  test('Shift+Down on the last line goes on into the next parts, Shift+Up comes back into one field', async ({ page }) => {
    await open(page, [para('one two', 'a'), para('three four', 'b'), para('five', 'c')])
    await caret(page, 'a', 4)
    await page.keyboard.press('Shift+ArrowDown')
    const s = await selection(page)
    expect(s).toMatchObject({ kind: 'range', anchor: { blockId: 'a', offset: 4 }, focus: { blockId: 'b' } })
    expect(await spanning(page)).toBe(true)
    expect(await announcements(page)).toContain('Text selected across 2 parts')
    await page.keyboard.press('Shift+ArrowDown')
    expect(await selection(page)).toMatchObject({ kind: 'range', anchor: { blockId: 'a', offset: 4 }, focus: { blockId: 'c' } })
    await page.keyboard.press('Shift+ArrowUp')
    await page.keyboard.press('Shift+ArrowUp')
    expect(await selection(page)).toMatchObject({ kind: 'text', blockId: 'a', anchor: 4 })
    expect(await spanning(page)).toBe(false)
    expect(await focusedBlock(page)).toBe('a')
  })

  test('Shift+Right at the end of a part selects the break; Backspace joins the parts', async ({ page }) => {
    await open(page, [para('one', 'a'), para('two', 'b')])
    await caret(page, 'a', 3)
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    expect(await selection(page)).toEqual(range(['a', 3], ['b', 1]))
    await page.keyboard.press('Backspace')
    expect(await outline(page)).toEqual(['paragraph: onewo'])
    expect(await selection(page)).toMatchObject({ kind: 'text', blockId: 'a', focus: 3 })
    expect(await announcements(page)).toContain('Text deleted across 2 parts')
    await page.keyboard.type('X')
    expect(await outline(page)).toEqual(['paragraph: oneXwo'])
    await expectCanonical(page)
  })

  test('a drag from one field into another selects the text between', async ({ page }) => {
    await open(page, [para('one one one', 'a'), para('two two two', 'b'), para('three', 'c')])
    const a = (await page.locator('[data-block="a"] [data-field]').boundingBox())!
    const b = (await page.locator('[data-block="b"] [data-field]').boundingBox())!
    await page.mouse.move(a.x + 2, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 6 })
    await page.mouse.up()
    const s = await selection(page)
    expect(s).toMatchObject({ kind: 'range', anchor: { blockId: 'a', offset: 0 }, focus: { blockId: 'b' } })
    const focus = s.kind === 'range' ? s.focus.offset : -1
    expect(focus).toBeGreaterThan(0)
    expect(focus).toBeLessThan(11)
    expect((await nativeText(page)).replace(/\s+/g, ' ')).toBe(`one one one ${'two two two'.slice(0, focus)}`)
    await page.keyboard.type('Z')
    expect(await outline(page)).toEqual([`paragraph: Z${'two two two'.slice(focus)}`, 'paragraph: three'])
  })

  test('Shift+click in another part selects the text up to there', async ({ page }) => {
    await open(page, [para('one', 'a'), para('two', 'b'), para('three', 'c')])
    await caret(page, 'a', 1)
    const c = (await page.locator('[data-block="c"] [data-field]').boundingBox())!
    await page.keyboard.down('Shift')
    await page.mouse.click(c.x + c.width - 1, c.y + c.height / 2)
    await page.keyboard.up('Shift')
    expect(await selection(page)).toEqual(range(['a', 1], ['c', 5]))
    await page.keyboard.press('Delete')
    expect(await outline(page)).toEqual(['paragraph: o'])
  })

  test('Escape selects the parts whole; a plain arrow ends the selection at its edge', async ({ page }) => {
    await open(page, [para('one', 'a'), para('two', 'b'), para('three', 'c')])
    await select(page, ['a', 1], ['b', 2])
    await page.keyboard.press('ArrowLeft')
    expect(await selection(page)).toMatchObject({ kind: 'text', blockId: 'a', anchor: 1, focus: 1 })
    await select(page, ['a', 1], ['b', 2])
    await page.keyboard.press('ArrowDown')
    expect(await selection(page)).toMatchObject({ kind: 'text', blockId: 'b', anchor: 2, focus: 2 })
    await select(page, ['a', 1], ['b', 2])
    await page.keyboard.press('Escape')
    expect(await selection(page)).toEqual({ kind: 'blocks', anchorId: 'a', focusId: 'b' })
    expect(await spanning(page)).toBe(false)
  })
})

test.describe('editing a selection across parts', () => {
  test('typing replaces it; one undo brings the text and the selection back', async ({ page }) => {
    await open(page, [para('alpha', 'a'), para('beta', 'b'), para('gamma', 'c')])
    await select(page, ['a', 2], ['c', 3])
    await page.keyboard.type('Xy')
    expect(await outline(page)).toEqual(['paragraph: alXyma'])
    await page.keyboard.press(`${MOD}+z`)
    await page.keyboard.press(`${MOD}+z`)
    expect(await outline(page)).toEqual(['paragraph: alpha', 'paragraph: beta', 'paragraph: gamma'])
    expect(await selection(page)).toEqual(range(['a', 2], ['c', 3]))
    expect(await spanning(page)).toBe(true)
    await expectCanonical(page)
  })

  test('Enter replaces it with a split', async ({ page }) => {
    await open(page, [para('alpha', 'a'), para('beta', 'b')])
    await select(page, ['a', 2], ['b', 2])
    await page.keyboard.press('Enter')
    expect(await outline(page)).toEqual(['paragraph: al', 'paragraph: ta'])
    expect(await selection(page)).toMatchObject({ kind: 'text', focus: 0 })
  })

  test('from a list item into the text after the list: the text joins the item', async ({ page }) => {
    await open(page, [list([item('one', 'i1'), item('two', 'i2'), item('three', 'i3')], 'bullet', 'l'), para('after', 'p'), para('end', 'q')])
    await select(page, ['i2', 1], ['p', 2])
    await page.keyboard.press('Delete')
    expect(await outline(page)).toEqual(['list', '  list-item: one', '  list-item: tter', 'paragraph: end'])
  })

  test('parts without text in between go; a picture in between shows selected', async ({ page }) => {
    await open(page, [para('one', 'a'), separator('s'), para('two', 'b')])
    await select(page, ['a', 1], ['b', 1])
    await expect(page.locator('[data-block="s"]')).toHaveClass(/is-selected/)
    await expect(page.locator('[data-block="s"]')).toHaveAttribute('contenteditable', 'false')
    await page.keyboard.press('Backspace')
    expect(await outline(page)).toEqual(['paragraph: owo'])
  })

  test('a selection that reaches into a table takes the whole table', async ({ page }) => {
    await open(page, [para('before', 'a'), {
      id: 't', type: 'core/table', attrs: {}, children: [
        { id: 'r1', type: 'core/table-row', attrs: {}, children: [
          { id: 'c1', type: 'core/table-cell', attrs: {}, children: [para('x', 'x')] },
          { id: 'c2', type: 'core/table-cell', attrs: {}, children: [para('y', 'y')] },
        ] },
      ],
    }, para('after', 'b')])
    await select(page, ['a', 2], ['x', 1])
    expect(await selection(page)).toEqual(range(['a', 2], ['y', 1]))
    await page.keyboard.press('Delete')
    expect(await outline(page)).toEqual(['paragraph: be', 'paragraph: after'])
  })

  test('two cells of one table select cells, not text', async ({ page }) => {
    await open(page, [{
      id: 't', type: 'core/table', attrs: {}, children: [
        { id: 'r1', type: 'core/table-row', attrs: {}, children: [
          { id: 'c1', type: 'core/table-cell', attrs: {}, children: [para('x', 'x')] },
          { id: 'c2', type: 'core/table-cell', attrs: {}, children: [para('y', 'y')] },
        ] },
      ],
    }])
    await select(page, ['x', 0], ['y', 1])
    expect(await selection(page)).toMatchObject({ kind: 'cells', tableId: 't', anchorId: 'c1', focusId: 'c2' })
  })
})

test.describe('formats across parts', () => {
  test('Mod+B makes all of it bold, and again takes bold away', async ({ page }) => {
    await open(page, [para('alpha', 'a'), para('beta', 'b')])
    await select(page, ['a', 2], ['b', 2])
    await page.keyboard.press(`${MOD}+b`)
    const formats = () => page.evaluate(() => {
      const t = window.__editor!.editor.tree
      return ['a', 'b'].map((id) => JSON.stringify((t.nodes.get(id)!.attrs.content as { formats: unknown }).formats))
    })
    expect(await formats()).toEqual(['[{"type":"bold","start":2,"end":5}]', '[{"type":"bold","start":0,"end":2}]'])
    expect(await selection(page)).toEqual(range(['a', 2], ['b', 2]))
    await expect(page.locator('[data-block="a"] strong')).toHaveText('pha')
    await page.keyboard.press(`${MOD}+b`)
    expect(await formats()).toEqual(['[]', '[]'])
    await expectCanonical(page)
  })

  test('the format bar shows over the selection and its buttons act on all of it', async ({ page }) => {
    await open(page, [para('alpha', 'a'), para('beta', 'b')])
    await select(page, ['a', 1], ['b', 3])
    const bar = page.getByRole('toolbar', { name: 'Format' })
    await expect(bar).toBeVisible()
    await bar.getByRole('button', { name: 'Italic' }).click()
    await expect(page.locator('[data-block="a"] em')).toHaveText('lpha')
    await expect(page.locator('[data-block="b"] em')).toHaveText('bet')
    await expect(bar.getByRole('button', { name: 'Italic' })).toHaveAttribute('aria-pressed', 'true')
    expect(await selection(page)).toEqual(range(['a', 1], ['b', 3]))
  })
})

test.describe('clipboard across parts (real clipboard)', () => {
  test('copied text across parts pastes into a part joining both ends', async ({ page, browserName }) => {
    await realClipboard(page, browserName)
    await open(page, [para('one', 'a'), para('two', 'b'), para('AB', 'c')])
    await select(page, ['a', 1], ['b', 2])
    await page.keyboard.press(`${MOD}+c`)
    expect(await announcements(page)).toContain('Text copied')
    await caret(page, 'c', 1)
    await page.keyboard.press(`${MOD}+v`)
    expect(await outline(page)).toEqual(['paragraph: one', 'paragraph: two', 'paragraph: Ane', 'paragraph: twB'])
    expect(await selection(page)).toMatchObject({ kind: 'text', focus: 2 })
  })

  test('cut removes the text; paste onto a selection across parts replaces it, one undo step', async ({ page, browserName }) => {
    await realClipboard(page, browserName)
    await open(page, [para('one', 'a'), para('two', 'b'), para('three', 'c'), para('four', 'd')])
    await select(page, ['a', 2], ['b', 1])
    await page.keyboard.press(`${MOD}+x`)
    expect(await outline(page)).toEqual(['paragraph: onwo', 'paragraph: three', 'paragraph: four'])
    await select(page, ['c', 1], ['d', 3])
    await page.keyboard.press(`${MOD}+v`)
    expect(await outline(page)).toEqual(['paragraph: onwo', 'paragraph: te', 'paragraph: tr'])
    await page.keyboard.press(`${MOD}+z`)
    expect(await outline(page)).toEqual(['paragraph: onwo', 'paragraph: three', 'paragraph: four'])
  })
})

test.describe('input methods', () => {
  test('a composition on a selection across parts replaces it in the first field', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'IME composition is driven through CDP, which only Chromium has')
    await open(page, [para('alpha', 'a'), para('beta', 'b')])
    await select(page, ['a', 2], ['b', 2])
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.insertText', { text: '字' })
    await page.evaluate(() => new Promise((r) => setTimeout(r, 50)))
    expect(await outline(page)).toEqual(['paragraph: al字ta'])
    await expectCanonical(page)
  })
})
