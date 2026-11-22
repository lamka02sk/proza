/**
 * Moving between blocks, select mode and block selection.
 */
import { expect, test } from '@playwright/test'
import { MOD, announcements, caret, focusedBlock, heading, item, list, open, outline, para, selection, separator } from './editor-helpers'

const SAME = 'The quick brown fox jumps'
const MOVE = process.platform === 'darwin' ? 'Control+Shift' : 'Alt+Shift'

test.describe('caret between blocks', () => {
  test('Down from the last line goes to the next block at the same column, and back up', async ({ page }) => {
    await open(page, [para(SAME, 'a'), para(SAME, 'b')])
    await caret(page, 'a', 10)
    await page.keyboard.press('ArrowDown')
    expect(await selection(page)).toMatchObject({ kind: 'text', blockId: 'b', anchor: 10, focus: 10 })
    await page.keyboard.press('ArrowUp')
    expect(await selection(page)).toMatchObject({ kind: 'text', blockId: 'a', anchor: 10, focus: 10 })
  })

  test('the goal column survives a shorter block in between', async ({ page }) => {
    await open(page, [para(SAME, 'a'), para('ab', 'b'), para(SAME, 'c')])
    await caret(page, 'a', 15)
    await page.keyboard.press('ArrowDown')
    expect(await selection(page)).toMatchObject({ blockId: 'b', focus: 2 })
    await page.keyboard.press('ArrowDown')
    expect(await selection(page)).toMatchObject({ blockId: 'c', focus: 15 })
  })

  test('Right at the end and Left at the start cross into the neighbour', async ({ page }) => {
    await open(page, [para('one', 'a'), para('two', 'b')])
    await caret(page, 'a', 3)
    await page.keyboard.press('ArrowRight')
    expect(await selection(page)).toMatchObject({ blockId: 'b', focus: 0 })
    await page.keyboard.press('ArrowLeft')
    expect(await selection(page)).toMatchObject({ blockId: 'a', focus: 3 })
  })

  test('in right-to-left text, Left at the end goes forward into the next block', async ({ page }) => {
    await open(page, [para('שלום עולם', 'a'), para('תודה', 'b')])
    await caret(page, 'a', 9)
    await page.keyboard.press('ArrowLeft')
    expect(await selection(page)).toMatchObject({ blockId: 'b', focus: 0 })
    await page.keyboard.press('ArrowRight')
    expect(await selection(page)).toMatchObject({ blockId: 'a', focus: 9 })
  })

  test('arrows go into and out of nested list items in reading order', async ({ page }) => {
    await open(page, [para('top', 'a'), list([item('one', 'i1', [list([item('deep', 'i2')], 'bullet', 'l2')])], 'bullet', 'l'), para('end', 'b')])
    await caret(page, 'a', 3)
    await page.keyboard.press('ArrowRight')
    expect(await selection(page)).toMatchObject({ blockId: 'i1', focus: 0 })
    await page.keyboard.press('ArrowDown')
    expect(await selection(page)).toMatchObject({ blockId: 'i2' })
    await page.keyboard.press('ArrowDown')
    expect(await selection(page)).toMatchObject({ blockId: 'b' })
  })

  test('a separator is selected as a whole on the way, and Down continues into the text after', async ({ page }) => {
    await open(page, [para('one', 'a'), separator('s'), para('two', 'b')])
    await caret(page, 'a', 1)
    await page.keyboard.press('ArrowDown')
    expect(await selection(page)).toEqual({ kind: 'blocks', anchorId: 's', focusId: 's' })
    expect(await focusedBlock(page)).toBe('s')
    await page.keyboard.press('ArrowDown')
    expect(await selection(page)).toMatchObject({ kind: 'text', blockId: 'b' })
  })

  test('Enter on a selected separator adds text after it', async ({ page }) => {
    await open(page, [separator('s')])
    await page.evaluate(() => { window.__editor!.editor.select({ kind: 'blocks', anchorId: 's', focusId: 's' }, 'edit') })
    await page.keyboard.press('Enter')
    await page.keyboard.type('after')
    expect(await outline(page)).toEqual(['separator', 'paragraph: after'])
  })
})

test.describe('select mode', () => {
  test('Escape selects the block; arrows move the selection; Enter edits again at its end', async ({ page }) => {
    await open(page, [para('one', 'a'), para('two', 'b')])
    await caret(page, 'a', 1)
    await page.keyboard.press('Escape')
    expect(await selection(page)).toEqual({ kind: 'blocks', anchorId: 'a', focusId: 'a' })
    expect(await focusedBlock(page)).toBe('a')
    const wrapper = page.locator('[data-block="a"]')
    await expect(wrapper).toHaveAttribute('role', 'group')
    await expect(wrapper).toHaveAttribute('aria-label', 'Text: one')
    await page.keyboard.press('ArrowDown')
    expect(await selection(page)).toEqual({ kind: 'blocks', anchorId: 'b', focusId: 'b' })
    await page.keyboard.press('Enter')
    await page.keyboard.type('!')
    expect(await outline(page)).toEqual(['paragraph: one', 'paragraph: two!'])
  })

  test('Delete removes the selected block and the caret goes to the end of the one before', async ({ page }) => {
    await open(page, [para('one', 'a'), para('two', 'b'), para('three', 'c')])
    await caret(page, 'b', 1)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Delete')
    expect(await outline(page)).toEqual(['paragraph: one', 'paragraph: three'])
    expect(await selection(page)).toMatchObject({ kind: 'text', blockId: 'a', focus: 3 })
    expect(await announcements(page)).toContain('Part removed')
  })

  test('typing on selected blocks replaces them with the text', async ({ page }) => {
    await open(page, [para('one', 'a'), para('two', 'b')])
    await caret(page, 'a', 1)
    await page.keyboard.press('Escape')
    await page.keyboard.type('xy')
    expect(await outline(page)).toEqual(['paragraph: xy', 'paragraph: two'])
  })

  test('Shift+Down on a selected block extends to whole blocks', async ({ page }) => {
    await open(page, [para('one', 'a'), para('two', 'b'), para('three', 'c')])
    await caret(page, 'a', 1)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Shift+ArrowDown')
    expect(await selection(page)).toEqual({ kind: 'blocks', anchorId: 'a', focusId: 'b' })
    await page.keyboard.press('Shift+ArrowDown')
    expect(await selection(page)).toEqual({ kind: 'blocks', anchorId: 'a', focusId: 'c' })
    expect(await page.locator('.pz-block.is-selected').count()).toBe(3)
    await page.keyboard.press('Backspace')
    expect(await outline(page)).toEqual(['paragraph: '])
  })

  test('Mod+A selects the text, then every block', async ({ page }) => {
    await open(page, [para('one', 'a'), para('two', 'b')])
    await caret(page, 'a', 1)
    await page.keyboard.press(`${MOD}+a`)
    expect(await selection(page)).toMatchObject({ kind: 'text', blockId: 'a', anchor: 0, focus: 3 })
    await page.keyboard.press(`${MOD}+a`)
    expect(await selection(page)).toEqual({ kind: 'blocks', anchorId: 'a', focusId: 'b' })
    expect(await announcements(page)).toContain('2 parts selected')
  })

  test('Escape on text selected from a list item to the text after it selects the whole list', async ({ page }) => {
    await open(page, [list([item('one', 'i1'), item('two', 'i2')], 'bullet', 'l'), para('after', 'p')])
    await caret(page, 'i2', 0, 3)
    await page.keyboard.press('Shift+ArrowDown')
    expect(await selection(page)).toMatchObject({ kind: 'range', anchor: { blockId: 'i2' }, focus: { blockId: 'p' } })
    await page.keyboard.press('Escape')
    expect(await page.locator('.pz-block.is-selected').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.block))).toEqual(['l', 'p'])
  })
})

test.describe('block commands', () => {
  test('moving a block up and down, with its position announced', async ({ page }) => {
    await open(page, [para('one', 'a'), para('two', 'b'), para('three', 'c')])
    await caret(page, 'c', 2)
    await page.keyboard.press(`${MOVE}+ArrowUp`)
    expect(await outline(page)).toEqual(['paragraph: one', 'paragraph: three', 'paragraph: two'])
    expect(await announcements(page)).toContain('Moved to position 2 of 3')
    // The caret stays where it was in the moved block.
    await page.keyboard.type('x')
    expect(await outline(page)).toEqual(['paragraph: one', 'paragraph: thxree', 'paragraph: two'])
    await page.keyboard.press(`${MOVE}+ArrowDown`)
    expect(await outline(page)).toEqual(['paragraph: one', 'paragraph: two', 'paragraph: thxree'])
  })

  test('duplicate puts a copy after the block with the caret in it', async ({ page }) => {
    await open(page, [heading('Title', 2, 'h')])
    await caret(page, 'h', 5)
    await page.keyboard.press(`${MOD}+Shift+d`)
    await page.keyboard.type('2')
    expect(await outline(page)).toEqual(['heading2: Title', 'heading2: Title2'])
  })
})

test.describe('focus', () => {
  /** Where each Tab lands until focus leaves the editor: text, part tools, Add, status line. */
  async function tabStops(page: import('@playwright/test').Page, key: 'Tab' | 'Shift+Tab', until: () => Promise<boolean>): Promise<string[]> {
    const out: string[] = []
    for (let i = 0; i < 6 && !(await until()); i++) {
      await page.keyboard.press(key)
      out.push(await page.evaluate(() => {
        const a = document.activeElement
        const inner = a?.shadowRoot?.activeElement
        if (!inner) return `#${a?.id ?? ''}`
        return inner.closest('.gut') ? 'part tools' : inner.closest('.appender') ? 'add' : inner.closest('.status') ? 'status' : inner.closest('[data-block]') ? 'text' : inner.className
      }))
    }
    return out
  }

  test('Tab from a field visits the part tools, Add and the status line, then leaves; Shift+Tab comes back to the same place', async ({ page }) => {
    await open(page, [para('one', 'a'), para('two', 'b'), para('three', 'c')])
    await caret(page, 'b', 1)
    const forward = await tabStops(page, 'Tab', async () => (await page.evaluate(() => document.activeElement?.id)) === 'after')
    expect(forward).toEqual(['part tools', 'add', 'status', '#after'])
    await tabStops(page, 'Shift+Tab', async () => (await focusedBlock(page)) === 'b')
    expect(await focusedBlock(page)).toBe('b')
    expect(await selection(page)).toMatchObject({ kind: 'text', blockId: 'b' })
  })

  test('Escape then Tab leaves the text area; the editor is left after its tools', async ({ page }) => {
    await open(page, [list([item('one', 'i1')], 'bullet', 'l')])
    await caret(page, 'i1', 1)
    await page.keyboard.press('Escape')
    const forward = await tabStops(page, 'Tab', async () => (await page.evaluate(() => document.activeElement?.id)) === 'after')
    expect(forward).toEqual(['part tools', 'add', 'status', '#after'])
  })
})

test.describe('pointer', () => {
  test('Shift+click on a part without text selects whole parts up to it', async ({ page }) => {
    await open(page, [para('one', 'a'), para('two', 'b'), separator('s')])
    await caret(page, 'a', 1)
    await page.locator('[data-block="s"]').click({ modifiers: ['Shift'] })
    expect(await selection(page)).toEqual({ kind: 'blocks', anchorId: 'a', focusId: 's' })
  })

  test('a click on a separator selects it', async ({ page }) => {
    await open(page, [para('one', 'a'), separator('s')])
    await page.locator('[data-block="s"]').click()
    expect(await selection(page)).toEqual({ kind: 'blocks', anchorId: 's', focusId: 's' })
  })
})
