/**
 * The rich-text spike in three engines.
 * Real keyboard input through Playwright; composition through CDP on Chromium.
 */
import { expect, test, type Page } from '@playwright/test'
import type { RichTextValue } from '../../src/model/richtext'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

async function open(page: Page, values?: RichTextValue[]): Promise<void> {
  await page.goto('/spikes/richtext/?empty')
  await page.waitForFunction(() => window.__proza !== undefined)
  if (values) await page.evaluate((v) => { window.__proza!.doc.load(v) }, values)
}

const doc = (page: Page): Promise<RichTextValue[]> => page.evaluate(() => window.__proza!.json())
const texts = async (page: Page): Promise<string[]> => (await doc(page)).map((v) => v.text)
const canonical = (page: Page): Promise<boolean[]> =>
  page.evaluate(() => [...window.__proza!.doc.fields.values()].map((f) => (f as unknown as { isCanonical(): boolean }).isCanonical()))
const selection = (page: Page, i: number) => page.evaluate((n) => window.__proza!.doc.field(n)!.selection, i)

/** Place the caret by text offset through the field API, as a click would. */
async function caret(page: Page, block: number, anchor: number, focus = anchor): Promise<void> {
  await page.evaluate(([b, a, f]) => { window.__proza!.doc.field(b!)!.setSelection({ anchor: a!, focus: f! }) }, [block, anchor, focus])
}

const p = (text: string, formats: RichTextValue['formats'] = []): RichTextValue => ({ text, formats })

test.describe('typing', () => {
  test('plain text with real spaces', async ({ page }) => {
    await open(page)
    await page.locator('[data-block]').first().click()
    await page.keyboard.type('Hello  world ')
    expect(await texts(page)).toEqual(['Hello  world '])
    expect(await canonical(page)).toEqual([true])
    expect(await page.locator('[data-block]').first().innerHTML()).not.toContain('&nbsp;')
  })

  test('diacritics and emoji', async ({ page }) => {
    await open(page)
    await page.locator('[data-block]').first().click()
    await page.keyboard.type('Žluťoučký kůň 😀 ok')
    expect(await texts(page)).toEqual(['Žluťoučký kůň 😀 ok'])
  })

  test('backspace and delete inside text keep formats', async ({ page }) => {
    await open(page, [p('abcdef', [{ type: 'bold', start: 0, end: 6 }])])
    await caret(page, 0, 3)
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Delete')
    expect(await doc(page)).toEqual([p('abef', [{ type: 'bold', start: 0, end: 4 }])])
    expect(await canonical(page)).toEqual([true])
  })

  test('replacing a selection by typing', async ({ page }) => {
    await open(page, [p('one two three')])
    await caret(page, 0, 4, 7)
    await page.keyboard.type('2')
    expect(await texts(page)).toEqual(['one 2 three'])
  })

  test('select all in a field and type replaces only that field', async ({ page }) => {
    await open(page, [p('first'), p('second')])
    await caret(page, 1, 2)
    await page.keyboard.press(`${MOD}+a`)
    await page.keyboard.type('x')
    expect(await texts(page)).toEqual(['first', 'x'])
  })
})

test.describe('formats', () => {
  test('Mod+B with a collapsed caret applies to the next typed text', async ({ page }) => {
    await open(page)
    await page.locator('[data-block]').first().click()
    await page.keyboard.type('a')
    await page.keyboard.press(`${MOD}+b`)
    await page.keyboard.type('bc')
    await page.keyboard.press(`${MOD}+b`)
    await page.keyboard.type('d')
    expect(await doc(page)).toEqual([p('abcd', [{ type: 'bold', start: 1, end: 3 }])])
    expect(await canonical(page)).toEqual([true])
  })

  test('Mod+B and Mod+I over a selection', async ({ page }) => {
    await open(page, [p('hello world')])
    await caret(page, 0, 0, 5)
    await page.keyboard.press(`${MOD}+b`)
    await page.keyboard.press(`${MOD}+i`)
    expect(await doc(page)).toEqual([p('hello world', [{ type: 'bold', start: 0, end: 5 }, { type: 'italic', start: 0, end: 5 }])])
    expect(await page.locator('[data-block]').first().innerHTML()).toBe('<strong><em>hello</em></strong> world')
    // The selection survives the re-render.
    expect(await selection(page, 0)).toEqual({ anchor: 0, focus: 5 })
  })

  test('typing at the end of bold continues bold', async ({ page }) => {
    await open(page, [p('ab', [{ type: 'bold', start: 0, end: 2 }])])
    await caret(page, 0, 2)
    await page.keyboard.type('c')
    expect(await doc(page)).toEqual([p('abc', [{ type: 'bold', start: 0, end: 3 }])])
  })

  test('typing at the end of a link does not extend it, typing inside does', async ({ page }) => {
    const link = { type: 'link', start: 0, end: 4, attrs: { href: 'https://example.com/' } }
    await open(page, [p('link', [link])])
    await caret(page, 0, 4)
    await page.keyboard.type(' after')
    await caret(page, 0, 2)
    await page.keyboard.type('NK')
    expect(await doc(page)).toEqual([p('liNKnk after', [{ ...link, end: 6 }])])
    expect(await canonical(page)).toEqual([true])
  })

  test('typing at the end of inline code leaves the code', async ({ page }) => {
    await open(page, [p('x = 1', [{ type: 'code', start: 0, end: 5 }])])
    await caret(page, 0, 5)
    await page.keyboard.type(' ok')
    expect(await doc(page)).toEqual([p('x = 1 ok', [{ type: 'code', start: 0, end: 5 }])])
  })

  test('replacing bold text by typing keeps bold (word processor behaviour)', async ({ page }) => {
    await open(page, [p('ab cd', [{ type: 'bold', start: 0, end: 2 }])])
    await caret(page, 0, 0, 2)
    await page.keyboard.type('X')
    expect(await doc(page)).toEqual([p('X cd', [{ type: 'bold', start: 0, end: 1 }])])
  })

  test('toolbar buttons report state and keep the selection', async ({ page }) => {
    await open(page, [p('hello')])
    await caret(page, 0, 1, 4)
    await page.getByRole('button', { name: 'Italic' }).click()
    expect(await doc(page)).toEqual([p('hello', [{ type: 'italic', start: 1, end: 4 }])])
    await expect(page.getByRole('button', { name: 'Italic' })).toHaveAttribute('aria-pressed', 'true')
    expect(await selection(page, 0)).toEqual({ anchor: 1, focus: 4 })
  })
})

test.describe('block structure', () => {
  test('Enter splits and keeps formats on both halves', async ({ page }) => {
    await open(page, [p('abcd', [{ type: 'bold', start: 1, end: 3 }])])
    await caret(page, 0, 2)
    await page.keyboard.press('Enter')
    await page.keyboard.type('X')
    expect(await doc(page)).toEqual([p('ab', [{ type: 'bold', start: 1, end: 2 }]), p('Xcd', [{ type: 'bold', start: 0, end: 2 }])])
    expect(await page.locator('[data-block]').count()).toBe(2)
    expect(await canonical(page)).toEqual([true, true])
  })

  test('Enter at the end makes an empty paragraph that accepts typing', async ({ page }) => {
    await open(page, [p('one')])
    await caret(page, 0, 3)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('three')
    expect(await texts(page)).toEqual(['one', '', 'three'])
  })

  test('Enter at the end of bold text keeps typing bold in the new block, but not a link', async ({ page }) => {
    await open(page, [p('ab', [{ type: 'bold', start: 0, end: 2 }, { type: 'link', start: 0, end: 2, attrs: { href: '/x' } }])])
    await caret(page, 0, 2)
    await page.keyboard.press('Enter')
    await page.keyboard.type('cd')
    expect((await doc(page))[1]).toEqual(p('cd', [{ type: 'bold', start: 0, end: 2 }]))
  })

  test('Enter with a selection deletes it first', async ({ page }) => {
    await open(page, [p('abcdef')])
    await caret(page, 0, 2, 4)
    await page.keyboard.press('Enter')
    expect(await texts(page)).toEqual(['ab', 'ef'])
  })

  test('Backspace at the start merges into the previous block, caret at the join', async ({ page }) => {
    await open(page, [p('ab', [{ type: 'italic', start: 0, end: 2 }]), p('cd')])
    await caret(page, 1, 0)
    await page.keyboard.press('Backspace')
    await page.keyboard.type('X')
    expect(await doc(page)).toEqual([p('abXcd', [{ type: 'italic', start: 0, end: 3 }])])
  })

  test('Delete at the end merges the next block', async ({ page }) => {
    await open(page, [p('ab'), p('cd')])
    await caret(page, 0, 2)
    await page.keyboard.press('Delete')
    await page.keyboard.type('X')
    expect(await texts(page)).toEqual(['abXcd'])
  })

  test('Backspace in an empty paragraph removes it', async ({ page }) => {
    await open(page, [p('ab'), p('')])
    await caret(page, 1, 0)
    await page.keyboard.press('Backspace')
    await page.keyboard.type('c')
    expect(await texts(page)).toEqual(['abc'])
  })

  test('Shift+Enter inserts a soft line break, also at the end', async ({ page }) => {
    await open(page)
    await page.locator('[data-block]').first().click()
    await page.keyboard.type('a')
    await page.keyboard.press('Shift+Enter')
    expect(await texts(page)).toEqual(['a\n'])
    expect(await canonical(page)).toEqual([true])
    await page.keyboard.type('b')
    expect(await texts(page)).toEqual(['a\nb'])
    expect(await page.locator('[data-block]').first().innerHTML()).toBe('a<br>b')
  })
})

test.describe('caret movement between blocks', () => {
  test('arrows cross block boundaries', async ({ page }) => {
    await open(page, [p('first'), p('second'), p('third')])
    await caret(page, 0, 5)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.type('>')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.type('v')
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.type('<')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.type('^')
    const t = await texts(page)
    expect(t[1]).toBe('>second<')
    expect(t[2]).toContain('v')
    expect(t[0]).toContain('^')
  })
})

test.describe('history', () => {
  test('undo and redo restore content and selection', async ({ page }) => {
    await open(page)
    await page.locator('[data-block]').first().click()
    await page.keyboard.type('abc')
    await page.keyboard.press('Enter')
    await page.keyboard.type('d')
    await page.keyboard.press(`${MOD}+z`)
    expect(await texts(page)).toEqual(['abc', ''])
    await page.keyboard.press(`${MOD}+z`)
    expect(await texts(page)).toEqual(['abc'])
    expect(await selection(page, 0)).toEqual({ anchor: 3, focus: 3 })
    await page.keyboard.press(`${MOD}+z`)
    expect(await texts(page)).toEqual([''])
    await page.keyboard.press(`${MOD}+Shift+z`)
    await page.keyboard.press(`${MOD}+Shift+z`)
    await page.keyboard.press(`${MOD}+Shift+z`)
    expect(await texts(page)).toEqual(['abc', 'd'])
  })

  test('formatting is its own undo step', async ({ page }) => {
    await open(page, [p('hello')])
    await caret(page, 0, 0, 5)
    await page.keyboard.press(`${MOD}+b`)
    await page.keyboard.press(`${MOD}+z`)
    expect(await doc(page)).toEqual([p('hello')])
  })
})

test.describe('clipboard', () => {
  test('copy then paste through the real clipboard keeps formats', async ({ page, browserName, context }) => {
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await open(page, [p('ab cd', [{ type: 'bold', start: 0, end: 2 }]), p('[]')])
    await caret(page, 0, 0, 4)
    await page.keyboard.press(`${MOD}+c`)
    await caret(page, 1, 1)
    await page.keyboard.press(`${MOD}+v`)
    expect(await doc(page)).toEqual([p('ab cd', [{ type: 'bold', start: 0, end: 2 }]), p('[ab c]', [{ type: 'bold', start: 1, end: 3 }])])
  })

  test('cut removes the selection and fills the clipboard', async ({ page, browserName, context }) => {
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await open(page, [p('abcdef'), p('')])
    await caret(page, 0, 1, 3)
    await page.keyboard.press(`${MOD}+x`)
    expect(await texts(page)).toEqual(['adef', ''])
    await caret(page, 1, 0)
    await page.keyboard.press(`${MOD}+v`)
    expect(await texts(page)).toEqual(['adef', 'bc'])
  })
})

test.describe('clipboard events (synthetic)', () => {
  // Firefox ignores clipboardData passed to a synthetic ClipboardEvent; the real-clipboard tests cover it.
  test.skip(({ browserName }) => browserName === 'firefox', 'synthetic ClipboardEvent data is dropped by Firefox')

  test('copy writes plain text, HTML and the internal format', async ({ page }) => {
    await open(page, [p('ab cd', [{ type: 'bold', start: 0, end: 2 }])])
    await caret(page, 0, 0, 4)
    const data = await page.evaluate(() => {
      const dt = new DataTransfer()
      const el = window.__proza!.doc.field(0)!.element
      el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }))
      return { text: dt.getData('text/plain'), html: dt.getData('text/html'), json: dt.getData('application/x-proza+json') }
    })
    expect(data.text).toBe('ab c')
    expect(data.html).toContain('<strong>ab</strong> c</span>')
    expect(data.html).toMatch(/^<span data-pz-clip="/)
    expect(JSON.parse(data.json)).toEqual({ version: 1, inline: p('ab c', [{ type: 'bold', start: 0, end: 2 }]) })
  })

  test('paste rejects malformed internal data and falls back to text', async ({ page }) => {
    await open(page, [p('')])
    await caret(page, 0, 0)
    await page.evaluate(() => {
      const el = window.__proza!.doc.field(0)!.element
      const dt = new DataTransfer()
      dt.setData('text/plain', 'fallback')
      dt.setData('application/x-proza+json', JSON.stringify({ version: 1, inline: { text: 'x', formats: [{ type: 'bold', start: '0', end: 1 }] } }))
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })
    expect(await texts(page)).toEqual(['fallback'])
  })

  test('paste prefers the internal format, then plain text; never inserts foreign markup', async ({ page }) => {
    await open(page, [p('[]')])
    await caret(page, 0, 1)
    await page.evaluate(() => {
      const el = window.__proza!.doc.field(0)!.element
      const dt = new DataTransfer()
      dt.setData('text/html', '<b style="color:red">bad</b><script>x</script>')
      dt.setData('text/plain', 'plain\r\ntext')
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
      const dt2 = new DataTransfer()
      dt2.setData('text/plain', 'ignored')
      dt2.setData('application/x-proza+json', JSON.stringify({ version: 1, inline: { text: '!', formats: [{ type: 'italic', start: 0, end: 1 }] } }))
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt2, bubbles: true, cancelable: true }))
    })
    expect(await doc(page)).toEqual([p('[plain\ntext!]', [{ type: 'italic', start: 11, end: 12 }])])
    expect(await canonical(page)).toEqual([true])
  })
})

test.describe('robustness', () => {
  test('foreign DOM changes are read back as text and the DOM is made canonical', async ({ page }) => {
    await open(page, [p('hello world')])
    await caret(page, 0, 5)
    await page.evaluate(() => {
      // What a browser extension or a spell-check replacement might do.
      const el = window.__proza!.doc.field(0)!.element
      el.innerHTML = '<span style="color: red" data-ext="1">hello</span> <font>wide</font> world'
      el.dispatchEvent(new InputEvent('input', { inputType: 'insertReplacementText', bubbles: true }))
    })
    expect(await texts(page)).toEqual(['hello wide world'])
    expect(await canonical(page)).toEqual([true])
  })

  test('browser-native bold markup from execCommand is ignored, the model decides', async ({ page }) => {
    await open(page, [p('ab')])
    await caret(page, 0, 0, 2)
    await page.evaluate(() => {
      const el = window.__proza!.doc.field(0)!.element
      el.innerHTML = '<b>ab</b>'
      el.dispatchEvent(new InputEvent('input', { inputType: 'formatBold', bubbles: true }))
    })
    expect(await doc(page)).toEqual([p('ab')])
    expect(await canonical(page)).toEqual([true])
  })
})

test.describe('composition (Chromium, CDP)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'CDP input methods exist only in Chromium')

  test('IME composition commits once and keeps surrounding formats', async ({ page }) => {
    await open(page, [p('ab', [{ type: 'bold', start: 0, end: 2 }])])
    await caret(page, 0, 2)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.imeSetComposition', { text: 'かん', selectionStart: 2, selectionEnd: 2 })
    // During composition the field must not touch the DOM or the model.
    expect(await texts(page)).toEqual(['ab'])
    await cdp.send('Input.imeSetComposition', { text: '漢', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.insertText', { text: '漢' })
    await page.waitForFunction(() => window.__proza!.json()[0]!.text === 'ab漢')
    expect(await doc(page)).toEqual([p('ab漢', [{ type: 'bold', start: 0, end: 3 }])])
    expect(await canonical(page)).toEqual([true])
    await page.keyboard.type('!')
    expect(await texts(page)).toEqual(['ab漢!'])
  })

  test('composition replacing a selection keeps the formats of the replaced text', async ({ page }) => {
    await open(page, [p('abcd', [{ type: 'italic', start: 1, end: 3 }])])
    await caret(page, 0, 1, 3)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.insertText', { text: '日本' })
    await page.waitForFunction(() => window.__proza!.json()[0]!.text === 'a日本d')
    expect(await doc(page)).toEqual([p('a日本d', [{ type: 'italic', start: 1, end: 3 }])])
    expect(await canonical(page)).toEqual([true])
  })

  test('composition at the end of a link commits outside it', async ({ page }) => {
    await open(page, [p('link', [{ type: 'link', start: 0, end: 4, attrs: { href: '/x' } }])])
    await caret(page, 0, 4)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.insertText', { text: '한' })
    await page.waitForFunction(() => window.__proza!.json()[0]!.text === 'link한')
    expect(await doc(page)).toEqual([p('link한', [{ type: 'link', start: 0, end: 4, attrs: { href: '/x' } }])])
    expect(await canonical(page)).toEqual([true])
  })

  test('a cancelled composition changes nothing', async ({ page }) => {
    await open(page, [p('ab')])
    await caret(page, 0, 1)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'x', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 })
    await page.evaluate(() => new Promise((r) => setTimeout(r, 50)))
    expect(await doc(page)).toEqual([p('ab')])
    expect(await canonical(page)).toEqual([true])
  })

  test('a keyboard that commits a word and its space at once still triggers rules (Android)', async ({ page }) => {
    await open(page, [p('')])
    await caret(page, 0, 0)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: '#', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.insertText', { text: '# ' })
    await page.waitForFunction(() => window.__proza!.types()[0] === 'heading-1')
    expect(await doc(page)).toEqual([p('')])
  })

  test('composition after Mod+B uses the pending format', async ({ page }) => {
    await open(page, [p('a')])
    await caret(page, 0, 1)
    await page.keyboard.press(`${MOD}+b`)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'é', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.insertText', { text: 'é' })
    await page.waitForFunction(() => window.__proza!.json()[0]!.text === 'aé')
    expect(await doc(page)).toEqual([p('aé', [{ type: 'bold', start: 1, end: 2 }])])
  })
})
