/**
 * Blocks on the clipboard and dragging text between blocks.
 */
import { expect, test, type Page } from '@playwright/test'
import { MOD, announcements, caret, code, item, list, open, outline, para, selection } from './editor-helpers'

async function realClipboard(page: Page, browserName: string): Promise<void> {
  if (browserName === 'chromium') await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
}

test.describe('copy, cut and paste of blocks (real clipboard)', () => {
  test('copied blocks paste into the middle of a paragraph, splitting it', async ({ page, browserName }) => {
    await realClipboard(page, browserName)
    await open(page, [para('one', 'a'), para('two', 'b'), para('AB', 'c')])
    await caret(page, 'a', 1)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press(`${MOD}+c`)
    expect(await announcements(page)).toContain('2 parts copied')
    await caret(page, 'c', 1)
    await page.keyboard.press(`${MOD}+v`)
    expect(await outline(page)).toEqual(['paragraph: one', 'paragraph: two', 'paragraph: A', 'paragraph: one', 'paragraph: two', 'paragraph: B'])
    expect(await selection(page)).toMatchObject({ kind: 'text', focus: 3 })
  })

  test('cut removes the blocks; paste on selected blocks replaces them', async ({ page, browserName }) => {
    await realClipboard(page, browserName)
    await open(page, [para('one', 'a'), para('two', 'b'), para('three', 'c')])
    await caret(page, 'a', 1)
    await page.keyboard.press('Escape')
    await page.keyboard.press(`${MOD}+x`)
    expect(await outline(page)).toEqual(['paragraph: two', 'paragraph: three'])
    await caret(page, 'c', 1)
    await page.keyboard.press('Escape')
    await page.keyboard.press(`${MOD}+v`)
    expect(await outline(page)).toEqual(['paragraph: two', 'paragraph: one'])
  })

  test('one copied block pastes as text inside the field', async ({ page, browserName }) => {
    await realClipboard(page, browserName)
    await open(page, [para('word', 'a'), para('[]', 'b')])
    await caret(page, 'a', 1)
    await page.keyboard.press('Escape')
    await page.keyboard.press(`${MOD}+c`)
    await caret(page, 'b', 1)
    await page.keyboard.press(`${MOD}+v`)
    expect(await outline(page)).toEqual(['paragraph: word', 'paragraph: [word]'])
  })

  test('copied list items paste into another list as items', async ({ page, browserName }) => {
    await realClipboard(page, browserName)
    await open(page, [list([item('x', 'i1'), item('y', 'i2')], 'bullet', 'l'), list([item('a', 'j1')], 'bullet', 'm')])
    await caret(page, 'i1', 1)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press(`${MOD}+c`)
    await caret(page, 'j1', 1)
    await page.keyboard.press(`${MOD}+v`)
    expect(await outline(page)).toEqual(['list', '  list-item: x', '  list-item: y', 'list', '  list-item: a', '  list-item: x', '  list-item: y'])
  })

  test('paragraphs pasted into a list item split the list around them', async ({ page, browserName }) => {
    await realClipboard(page, browserName)
    await open(page, [para('p1', 'a'), para('p2', 'b'), list([item('x', 'i1'), item('y', 'i2')], 'bullet', 'l')])
    await caret(page, 'a', 1)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press(`${MOD}+c`)
    await caret(page, 'i1', 1)
    await page.keyboard.press(`${MOD}+v`)
    expect(await outline(page)).toEqual(['paragraph: p1', 'paragraph: p2', 'list', '  list-item: x', 'paragraph: p1', 'paragraph: p2', 'list', '  list-item: y'])
  })
})

test('copied blocks are on the clipboard as plain text and as rendered HTML carrying the JSON', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'reading the system clipboard from a page needs the Chromium permission')
  await realClipboard(page, browserName)
  await open(page, [para('one', 'a'), para('two', 'b')])
  await caret(page, 'a', 0, 3)
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press(`${MOD}+c`)
  const clip = await page.evaluate(async () => {
    const [entry] = await navigator.clipboard.read()
    return { text: await (await entry!.getType('text/plain')).text(), html: await (await entry!.getType('text/html')).text() }
  })
  expect(clip.text).toBe('one\n\ntwo')
  expect(clip.html).toContain('<p>one</p>')
  expect(clip.html).toContain('data-pz-clip=')
})

test.describe('clipboard data from outside (synthetic events)', () => {
  test.skip(({ browserName }) => browserName === 'firefox', 'synthetic ClipboardEvent data is dropped by Firefox')

  test('inline clipboard JSON: a format attribute that fails its rule does not reach the document', async ({ page }) => {
    await open(page, [para('', 'a')])
    await caret(page, 'a', 0)
    await page.evaluate(() => {
      const dt = new DataTransfer()
      dt.setData('application/x-proza+json', JSON.stringify({ version: 1, inline: { text: 'click', formats: [{ type: 'link', start: 0, end: 5, attrs: { href: 'javascript:alert(1)' } }, { type: 'bold', start: 0, end: 2 }] } }))
      dt.setData('text/plain', 'click')
      const field = document.querySelector('#editor')!.shadowRoot!.querySelector('[data-block="a"] [data-field]')!
      field.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })
    await expect.poll(() => page.evaluate(() => window.__editor!.json().blocks[0]!.attrs.content)).toEqual({ text: 'click', formats: [{ type: 'bold', start: 0, end: 2 }] })
  })

  test('pasted JSON goes through validation: unsafe links, unknown types and bad ids are repaired', async ({ page }) => {
    await open(page, [para('', 'a')])
    await caret(page, 'a', 0)
    await page.evaluate(() => {
      const json = JSON.stringify({ version: 1, blocks: [
        { id: 'a', type: 'core/paragraph', attrs: { content: { text: 'click', formats: [{ type: 'link', start: 0, end: 5, attrs: { href: 'javascript:alert(1)' } }] } } },
        { id: 'x', type: 'evil/script', attrs: { src: 'x' } },
        { id: 'a', type: 'core/heading', attrs: { level: 9, content: { text: 'H', formats: [] } } },
      ] })
      const dt = new DataTransfer()
      dt.setData('application/x-proza+json', json)
      dt.setData('text/plain', 'fallback')
      const field = document.querySelector('#editor')!.shadowRoot!.querySelector('[data-block="a"] [data-field]')!
      field.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })
    const json = await page.evaluate(() => window.__editor!.json())
    const types = json.blocks.map((b) => b.type)
    expect(types).toEqual(['core/paragraph', 'evil/script', 'core/heading'])
    expect(json.blocks[0]!.attrs.content).toEqual({ text: 'click', formats: [] })
    expect(json.blocks[2]!.attrs.level).toBe(2)
    const ids = json.blocks.map((b) => b.id)
    expect(new Set(ids).size).toBe(3)
    expect(ids).not.toContain('a')
    // Placeholders keep what this editor cannot show, and are not published.
    expect(await page.evaluate(() => window.__editor!.editor.getHTML())).not.toContain('script')
  })
})

test.describe('dragging text', () => {

  async function drag(page: Page, from: { block: string; start: number; end: number }, to: { block: string; x: number }, copy = false): Promise<void> {
    await caret(page, from.block, from.start, from.end)
    await page.evaluate(([f, t, c]) => {
      const root = document.querySelector('#editor')!.shadowRoot!
      const src = root.querySelector(`[data-block="${f}"] [data-field]`)!
      const dst = root.querySelector<HTMLElement>(`[data-block="${t.block}"] [data-field]`)!
      const dt = new DataTransfer()
      src.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true, cancelable: true }))
      const r = dst.getBoundingClientRect()
      const at = { clientX: r.left + t.x, clientY: r.top + r.height / 2, dataTransfer: dt, bubbles: true, cancelable: true, ctrlKey: c, altKey: c }
      dst.dispatchEvent(new DragEvent('dragover', at))
      dst.dispatchEvent(new DragEvent('drop', at))
      src.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }))
    }, [from.block, to, copy] as const)
  }

  test('text dragged into another block moves, in one undo step', async ({ page }) => {
    await open(page, [para('move me', 'a'), para('here', 'b')])
    await drag(page, { block: 'a', start: 0, end: 4 }, { block: 'b', x: 0 })
    expect(await outline(page)).toEqual(['paragraph:  me', 'paragraph: movehere'])
    expect(await selection(page)).toMatchObject({ blockId: 'b', anchor: 0, focus: 4 })
    await page.keyboard.press(`${MOD}+z`)
    expect(await outline(page)).toEqual(['paragraph: move me', 'paragraph: here'])
  })

  test('text dragged into a code block leaves the formats code cannot hold behind', async ({ page }) => {
    const linked = { id: 'a', type: 'core/paragraph', attrs: { content: { text: 'see docs', formats: [{ type: 'link', start: 4, end: 8, attrs: { href: 'https://a.example/' } }, { type: 'bold', start: 0, end: 8 }] } } }
    await open(page, [linked, code('x = 1', 'c')])
    await drag(page, { block: 'a', start: 4, end: 8 }, { block: 'c', x: 0 })
    const json = await page.evaluate(() => window.__editor!.json())
    expect(json.blocks[1]!.attrs.content).toEqual({ text: 'docsx = 1', formats: [] })
    expect(await page.evaluate(() => window.__editor!.editor.getHTML())).not.toContain('<pre><code><a')
  })

  test('text dragged inside its block moves; with the copy key it is copied', async ({ page }) => {
    await open(page, [para('abc xyz', 'a')])
    await drag(page, { block: 'a', start: 0, end: 3 }, { block: 'a', x: 1000 })
    expect(await outline(page)).toEqual(['paragraph:  xyzabc'])
    await drag(page, { block: 'a', start: 0, end: 1 }, { block: 'a', x: 1000 }, true)
    expect(await outline(page)).toEqual(['paragraph:  xyzabc '])
  })
})
