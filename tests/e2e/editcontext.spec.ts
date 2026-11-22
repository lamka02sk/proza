/**
 * EditContext evaluation. Records support per engine and
 * runs the core editing flows on the Chromium implementation.
 */
import { expect, test, type Page } from '@playwright/test'
import type { RichTextValue } from '../../src/model/richtext'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const p = (text: string, formats: RichTextValue['formats'] = []): RichTextValue => ({ text, formats })

async function open(page: Page, values: RichTextValue[]): Promise<void> {
  await page.goto('/spikes/editcontext/?empty')
  await page.waitForFunction(() => window.__proza !== undefined)
  await page.evaluate((v) => { window.__proza!.doc.load(v) }, values)
}
const doc = (page: Page): Promise<RichTextValue[]> => page.evaluate(() => window.__proza!.json())
const caret = (page: Page, b: number, a: number, f = a): Promise<void> =>
  page.evaluate(([bb, aa, ff]) => { window.__proza!.doc.field(bb!)!.setSelection({ anchor: aa!, focus: ff! }) }, [b, a, f])

test('support per engine', async ({ page, browserName }) => {
  await page.goto('/spikes/editcontext/')
  const supported = await page.evaluate(() => typeof (globalThis as { EditContext?: unknown }).EditContext === 'function')
  test.info().annotations.push({ type: 'EditContext', description: `${browserName}: ${supported ? 'supported' : 'not supported'}` })
  // Recorded, not required: the decision depends on this matrix.
  expect(typeof supported).toBe('boolean')
})

test.describe('Chromium EditContext field', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'EditContext ships only in Chromium')

  test('typing, pending bold, Enter and Backspace', async ({ page }) => {
    await open(page, [p('')])
    await caret(page, 0, 0)
    await page.keyboard.type('ab')
    await page.keyboard.press(`${MOD}+b`)
    await page.keyboard.type('cd')
    await page.keyboard.press('Enter')
    await page.keyboard.type('ef')
    expect(await doc(page)).toEqual([p('abcd', [{ type: 'bold', start: 2, end: 4 }]), p('ef', [{ type: 'bold', start: 0, end: 2 }])])
    await caret(page, 1, 0)
    await page.keyboard.press('Backspace')
    expect((await doc(page)).map((v) => v.text)).toEqual(['abcdef'])
  })

  test('Backspace and word deletion inside text come through textupdate', async ({ page }) => {
    await open(page, [p('one two three')])
    await caret(page, 0, 13)
    await page.keyboard.press('Backspace')
    await page.keyboard.press(`${MOD}+Backspace`)
    expect((await doc(page)).map((v) => v.text)).toEqual(['one two '])
  })

  test('IME composition', async ({ page }) => {
    await open(page, [p('ab', [{ type: 'bold', start: 0, end: 2 }])])
    await caret(page, 0, 2)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.imeSetComposition', { text: '漢', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.insertText', { text: '漢' })
    await page.waitForFunction(() => window.__proza!.json()[0]!.text === 'ab漢')
    expect(await doc(page)).toEqual([p('ab漢', [{ type: 'bold', start: 0, end: 3 }])])
  })

  test('accessibility tree compared with contenteditable', async ({ page }) => {
    const axOf = async (url: string): Promise<unknown> => {
      await page.goto(url)
      await page.waitForFunction(() => window.__proza !== undefined)
      await page.evaluate(() => { window.__proza!.doc.load([{ text: 'Hello world', formats: [] }]); window.__proza!.doc.field(0)!.focus(5) })
      const cdp = await page.context().newCDPSession(page)
      const { nodes } = await cdp.send('Accessibility.getFullAXTree') as { nodes: { role?: { value: string }; name?: { value: string }; properties?: { name: string; value: { value: unknown } }[]; value?: { value: unknown } }[] }
      const box = nodes.find((n) => n.role?.value === 'textbox')
      return box && {
        role: box.role?.value,
        name: box.name?.value,
        value: box.value?.value,
        editable: box.properties?.find((x) => x.name === 'editable')?.value.value,
        focused: box.properties?.find((x) => x.name === 'focused')?.value.value,
        multiline: box.properties?.find((x) => x.name === 'multiline')?.value.value,
      }
    }
    const ce = await axOf('/spikes/richtext/?empty')
    const ec = await axOf('/spikes/editcontext/?empty')
    test.info().annotations.push({ type: 'AX contenteditable', description: JSON.stringify(ce) }, { type: 'AX EditContext', description: JSON.stringify(ec) })
    expect(ce).toMatchObject({ role: 'textbox', editable: 'richtext', focused: true })
    // What EditContext exposes is the finding; the assertion only pins the role.
    expect(ec).toMatchObject({ role: 'textbox' })
  })
})
