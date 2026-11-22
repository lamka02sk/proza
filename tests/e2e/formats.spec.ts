/**
 * Inline formats, format boundaries and inline objects in three engines.
 */
import { expect, test, type Page } from '@playwright/test'
import type { FormatRange, Mark, RichTextValue } from '../../src/model/richtext'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const O = '￼'

async function open(page: Page, values?: RichTextValue[], query = ''): Promise<void> {
  await page.goto(`/spikes/richtext/?empty${query}`)
  await page.waitForFunction(() => window.__proza !== undefined)
  if (values) await page.evaluate((v) => { window.__proza!.doc.load(v) }, values)
}

const doc = (page: Page): Promise<RichTextValue[]> => page.evaluate(() => window.__proza!.json())
const canonical = (page: Page): Promise<boolean[]> =>
  page.evaluate(() => [...window.__proza!.doc.fields.values()].map((f) => (f as unknown as { isCanonical(): boolean }).isCanonical()))
const selection = (page: Page, i = 0) => page.evaluate((n) => window.__proza!.doc.field(n)!.selection, i)
const p = (text: string, formats: FormatRange[] = []): RichTextValue => ({ text, formats })

async function caret(page: Page, block: number, anchor: number, focus = anchor): Promise<void> {
  await page.evaluate(([b, a, f]) => { window.__proza!.doc.field(b!)!.setSelection({ anchor: a!, focus: f! }) }, [block, anchor, focus])
}

/** Text of each range in a named CSS highlight. */
const highlight = (page: Page, name: string): Promise<string[]> =>
  page.evaluate((n) => [...(CSS.highlights.get(n) ?? [])].map((r) => (r instanceof Range ? r.toString() : '')), name)

const LINK = { type: 'link', start: 0, end: 4, attrs: { href: '/x' } }

test.describe('shortcuts', () => {
  for (const [keys, type] of [['Shift+x', 'strikethrough'], ['e', 'code'], ['.', 'superscript'], [',', 'subscript']] as const) {
    test(`Mod+${keys} toggles ${type}`, async ({ page }) => {
      await open(page, [p('hello')])
      await caret(page, 0, 1, 4)
      await page.keyboard.press(`${MOD}+${keys}`)
      expect(await doc(page)).toEqual([p('hello', [{ type, start: 1, end: 4 }])])
      await page.keyboard.press(`${MOD}+${keys}`)
      expect(await doc(page)).toEqual([p('hello')])
      expect(await canonical(page)).toEqual([true])
    })
  }

  test('Mod+\\ clears formatting', async ({ page }) => {
    await open(page, [p('hello', [{ type: 'bold', start: 0, end: 5 }, { type: 'italic', start: 1, end: 3 }])])
    await caret(page, 0, 0, 5)
    await page.keyboard.press(`${MOD}+Backslash`)
    expect(await doc(page)).toEqual([p('hello')])
  })

  test('Mod+K asks the interface for a link', async ({ page }) => {
    await open(page, [p('hello')])
    await page.evaluate(() => { window.__proza!.doc.requestLink = (f) => { f.setLink('https://k.example/') } })
    await caret(page, 0, 0, 5)
    await page.keyboard.press(`${MOD}+k`)
    expect(await doc(page)).toEqual([p('hello', [{ type: 'link', start: 0, end: 5, attrs: { href: 'https://k.example/' } }])])
  })

  test('formats the field does not allow are refused', async ({ page }) => {
    await open(page, [p('hello')], '&allowed=italic')
    await caret(page, 0, 0, 5)
    await page.keyboard.press(`${MOD}+b`)
    await page.keyboard.press(`${MOD}+i`)
    expect(await doc(page)).toEqual([p('hello', [{ type: 'italic', start: 0, end: 5 }])])
  })
})

test.describe('formats with attributes', () => {
  const set = (page: Page, mark: Mark) => page.evaluate((m) => { window.__proza!.doc.field(0)!.setFormat!(m) }, mark)

  test('colour, language and abbreviation over a selection render as the output does', async ({ page }) => {
    await open(page, [p('WHO says hallo')])
    await caret(page, 0, 0, 3)
    await set(page, { type: 'abbr', attrs: { title: 'World Health Organization' } })
    await caret(page, 0, 9, 14)
    await set(page, { type: 'lang', attrs: { lang: 'de' } })
    await caret(page, 0, 4, 8)
    await set(page, { type: 'color', attrs: { color: 'accent' } })
    expect(await page.locator('[data-block]').first().innerHTML())
      .toBe('<abbr title="World Health Organization">WHO</abbr> <span class="pz-color-accent">says</span> <span lang="de">hallo</span>')
    expect(await canonical(page)).toEqual([true])
  })

  test('an invalid preset or language is refused', async ({ page }) => {
    await open(page, [p('ab')])
    await caret(page, 0, 0, 2)
    await set(page, { type: 'color', attrs: { color: 'red;x' } })
    await set(page, { type: 'lang', attrs: { lang: 'not a tag' } })
    expect(await doc(page)).toEqual([p('ab')])
  })

  test('with the caret in a link, editing and removing act on the whole link', async ({ page }) => {
    await open(page, [p('a link b', [{ type: 'link', start: 2, end: 6, attrs: { href: '/old' } }])])
    await caret(page, 0, 4)
    await page.evaluate(() => { window.__proza!.doc.field(0)!.setLink('/new') })
    expect(await doc(page)).toEqual([p('a link b', [{ type: 'link', start: 2, end: 6, attrs: { href: '/new' } }])])
    await page.evaluate(() => { window.__proza!.doc.field(0)!.setLink('javascript:alert(1)') })
    expect((await doc(page))[0]!.formats[0]!.attrs).toEqual({ href: '/new' })
    await page.evaluate(() => { window.__proza!.doc.field(0)!.setLink(null) })
    expect(await doc(page)).toEqual([p('a link b')])
  })

  test('applying a format with a collapsed caret makes it pending', async ({ page }) => {
    await open(page, [p('a')])
    await caret(page, 0, 1)
    await set(page, { type: 'highlight', attrs: { color: 'yellow' } })
    await page.keyboard.type('bc')
    expect(await doc(page)).toEqual([p('abc', [{ type: 'highlight', start: 1, end: 3, attrs: { color: 'yellow' } }])])
  })
})

test.describe('format boundaries', () => {
  test('at the end of a link, ArrowLeft steps inside before it moves', async ({ page }) => {
    await open(page, [p('link after', [LINK])])
    await caret(page, 0, 4)
    expect(await highlight(page, 'pz-boundary')).toEqual([])
    await page.keyboard.press('ArrowLeft')
    expect(await selection(page)).toEqual({ anchor: 4, focus: 4 })
    expect(await highlight(page, 'pz-boundary')).toEqual(['link'])
    await page.keyboard.type('X')
    expect(await doc(page)).toEqual([p('linkX after', [{ ...LINK, end: 5 }])])
    expect(await canonical(page)).toEqual([true])
  })

  test('inside the end of a link, ArrowRight steps out before it moves', async ({ page }) => {
    await open(page, [p('link after', [LINK])])
    await caret(page, 0, 3)
    await page.keyboard.press('ArrowRight')
    // Arriving from inside keeps the caret inside.
    expect(await selection(page)).toEqual({ anchor: 4, focus: 4 })
    expect(await highlight(page, 'pz-boundary')).toEqual(['link'])
    await page.keyboard.press('ArrowRight')
    expect(await selection(page)).toEqual({ anchor: 4, focus: 4 })
    expect(await highlight(page, 'pz-boundary')).toEqual([])
    await page.keyboard.type('Y')
    expect(await doc(page)).toEqual([p('linkY after', [LINK])])
  })

  test('at the start of inline code, ArrowRight steps inside', async ({ page }) => {
    await open(page, [p('a code', [{ type: 'code', start: 2, end: 6 }])])
    await caret(page, 0, 2)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.type('X')
    expect(await doc(page)).toEqual([p('a Xcode', [{ type: 'code', start: 2, end: 7 }])])
    await caret(page, 0, 2)
    await page.keyboard.press('ArrowLeft')
    expect(await selection(page)).toEqual({ anchor: 1, focus: 1 })
  })

  test('a link at the start of a block: Left steps out, then leaves the block', async ({ page }) => {
    await open(page, [p('prev'), p('link', [LINK])])
    await caret(page, 1, 1)
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.type('a')
    expect((await doc(page))[1]).toEqual(p('alink', [{ ...LINK, start: 1, end: 5 }]))
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.type('!')
    expect((await doc(page))[0]).toEqual(p('prev!'))
  })
})

test.describe('inline objects', () => {
  const IMG = { type: 'image', attrs: { src: '/favicon.svg', alt: 'Logo' } }
  const NOTE = { type: 'footnote', attrs: { note: 'A note.' } }
  const insert = (page: Page, mark: Mark) => page.evaluate((m) => { window.__proza!.doc.field(0)!.insertObject!(m) }, mark)

  test('a picture is inserted at the caret, typed around and kept canonical', async ({ page }) => {
    await open(page, [p('ab')])
    await caret(page, 0, 1)
    await insert(page, IMG)
    await page.keyboard.type('X')
    expect(await doc(page)).toEqual([p(`a${O}Xb`, [{ type: 'image', start: 1, end: 2, attrs: IMG.attrs }])])
    expect(await page.locator('[data-block] img').getAttribute('alt')).toBe('Logo')
    expect(await canonical(page)).toEqual([true])
  })

  test('the arrow keys step over an object in one press', async ({ page }) => {
    await open(page, [p(`a${O}b`, [{ type: 'footnote', start: 1, end: 2, attrs: NOTE.attrs }])])
    await caret(page, 0, 1)
    await page.keyboard.press('ArrowRight')
    expect(await selection(page)).toEqual({ anchor: 2, focus: 2 })
    await page.keyboard.press('ArrowLeft')
    expect(await selection(page)).toEqual({ anchor: 1, focus: 1 })
  })

  test('Backspace and Delete remove exactly one object', async ({ page }) => {
    const v = p(`a${O}${O}b`, [{ type: 'image', start: 1, end: 2, attrs: IMG.attrs }, { type: 'footnote', start: 2, end: 3, attrs: NOTE.attrs }])
    await open(page, [v])
    await caret(page, 0, 2)
    await page.keyboard.press('Backspace')
    expect(await doc(page)).toEqual([p(`a${O}b`, [{ type: 'footnote', start: 1, end: 2, attrs: NOTE.attrs }])])
    await page.keyboard.press('Delete')
    expect(await doc(page)).toEqual([p('ab')])
    expect(await canonical(page)).toEqual([true])
  })

  test('a footnote at the end of a block: the caret goes after it and typing continues', async ({ page }) => {
    await open(page, [p('end')])
    await caret(page, 0, 3)
    await insert(page, NOTE)
    await page.keyboard.type(' more')
    expect(await doc(page)).toEqual([p(`end${O} more`, [{ type: 'footnote', start: 3, end: 4, attrs: NOTE.attrs }])])
    expect(await canonical(page)).toEqual([true])
  })

  test('footnote markers count through the canvas and are named by their note', async ({ page }) => {
    const note = (n: string, at: number): FormatRange => ({ type: 'footnote', start: at, end: at + 1, attrs: { note: n } })
    await open(page, [p(`a${O}`, [note('one', 1)]), p(`${O}b${O}`, [note('two', 0), note('three', 2)])])
    // One counter for the whole canvas (checked by eye in each engine: 1, 2, 3); the computed styles prove the wiring.
    const markers = await page.locator('.pz-fn').evaluateAll((els) => els.map((e) => [getComputedStyle(e).counterIncrement, e.getAttribute('aria-label')]))
    expect(markers).toEqual([['pz-fn 1', 'Footnote: one'], ['pz-fn 1', 'Footnote: two'], ['pz-fn 1', 'Footnote: three']])
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).counterReset)).toBe('pz-fn 0')
    await expect(page.getByRole('img', { name: 'Footnote: three' })).toHaveCount(1)
  })

  test('copy and paste through the real clipboard keep objects; plain text leaves them out', async ({ page, browserName, context }) => {
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await open(page, [p(`a${O}b`, [{ type: 'image', start: 1, end: 2, attrs: IMG.attrs }]), p('[]')])
    await caret(page, 0, 0, 3)
    await page.keyboard.press(`${MOD}+c`)
    await caret(page, 1, 1)
    await page.keyboard.press(`${MOD}+v`)
    expect((await doc(page))[1]).toEqual(p(`[a${O}b]`, [{ type: 'image', start: 2, end: 3, attrs: IMG.attrs }]))
  })
})

test.describe('paste rules (synthetic clipboard)', () => {
  test.skip(({ browserName }) => browserName === 'firefox', 'synthetic ClipboardEvent data is dropped by Firefox')

  const paste = (page: Page, text: string) => page.evaluate((t) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    window.__proza!.doc.field(0)!.element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, text)

  test('an address pasted onto selected words links them', async ({ page }) => {
    await open(page, [p('read this')])
    await caret(page, 0, 5, 9)
    await paste(page, ' https://a.example/doc ')
    expect(await doc(page)).toEqual([p('read this', [{ type: 'link', start: 5, end: 9, attrs: { href: 'https://a.example/doc' } }])])
  })

  test('addresses in pasted text become links; stray object characters are dropped', async ({ page }) => {
    await open(page, [p('')])
    await caret(page, 0, 0)
    await paste(page, `see www.a.example.${O}`)
    expect(await doc(page)).toEqual([p('see www.a.example.', [{ type: 'link', start: 4, end: 17, attrs: { href: 'https://www.a.example' } }])])
  })
})

test.describe('direction and language', () => {
  test('fields follow the first strong character', async ({ page }) => {
    await open(page, [p('שלום עולם')])
    expect(await page.locator('[data-block]').first().getAttribute('dir')).toBe('auto')
    expect(await page.locator('[data-block]').first().evaluate((e) => getComputedStyle(e).direction)).toBe('rtl')
  })
})

test.describe('highlights', () => {
  test('named highlights paint through the Custom Highlight API and survive edits', async ({ page }) => {
    await open(page, [p('find me, find me')])
    await page.evaluate(() => {
      const f = window.__proza!.doc.field(0) as unknown as { setHighlight(n: string, r: { start: number; end: number }[]): void }
      f.setHighlight('pz-find', [{ start: 0, end: 4 }, { start: 9, end: 13 }])
    })
    expect(await highlight(page, 'pz-find')).toEqual(['find', 'find'])
    await caret(page, 0, 16)
    await page.keyboard.type('!')
    expect(await highlight(page, 'pz-find')).toEqual(['find', 'find'])
    expect(await canonical(page)).toEqual([true])
    await page.evaluate(() => { window.__proza!.doc.field(0)!.destroy() })
    expect(await highlight(page, 'pz-find')).toEqual([])
  })
})

test.describe('inside the shadow root', () => {
  test('format boundaries and objects work there too', async ({ page }) => {
    await page.goto('/spikes/isolation/?mode=shadow&host=realistic')
    await page.waitForFunction(() => window.__isolation !== undefined)
    await page.evaluate((v) => { window.__isolation!.doc.load(v) }, [p('link after', [LINK])])
    await page.evaluate(() => { window.__isolation!.doc.field(0)!.setSelection({ anchor: 4, focus: 4 }) })
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.type('X')
    await page.evaluate(() => { window.__isolation!.doc.field(0)!.insertObject!({ type: 'footnote', attrs: { note: 'n' } }) })
    await page.keyboard.type('Y')
    const value = await page.evaluate(() => window.__isolation!.doc.field(0)!.value)
    // A footnote reference is a link of its own, so the link goes around it.
    expect(value).toEqual(p(`linkX${O}Y after`, [{ ...LINK, end: 5 }, { type: 'footnote', start: 5, end: 6, attrs: { note: 'n' } }, { ...LINK, start: 6, end: 7 }]))
  })
})
