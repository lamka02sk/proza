/**
 * Input rules typed with real keys in three engines.
 * Each rule is its own undo step: one undo gives the literal characters back.
 */
import { expect, test, type Page } from '@playwright/test'
import type { RichTextValue } from '../../src/model/richtext'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/spikes/richtext/?empty${query}`)
  await page.waitForFunction(() => window.__proza !== undefined)
  await page.locator('[data-block]').first().click()
}

const doc = (page: Page): Promise<RichTextValue[]> => page.evaluate(() => window.__proza!.json())
const types = (page: Page): Promise<string[]> => page.evaluate(() => window.__proza!.types())
const canonical = (page: Page): Promise<boolean[]> =>
  page.evaluate(() => [...window.__proza!.doc.fields.values()].map((f) => (f as unknown as { isCanonical(): boolean }).isCanonical()))
const p = (text: string, formats: RichTextValue['formats'] = []): RichTextValue => ({ text, formats })

test.describe('inline rules', () => {
  for (const [typed, text, type] of [
    ['a **bold**', 'a bold', 'bold'],
    ['a `x = 1`', 'a x = 1', 'code'],
    ['a _it_', 'a it', 'italic'],
    ['a *it*', 'a it', 'italic'],
    ['a ~~old~~', 'a old', 'strikethrough'],
  ] as const) {
    test(`${typed} becomes ${type}, and the next character is plain`, async ({ page }) => {
      await open(page)
      await page.keyboard.type(typed)
      await page.keyboard.type('!')
      expect(await doc(page)).toEqual([p(`${text}!`, [{ type, start: 2, end: text.length }])])
      expect(await canonical(page)).toEqual([true])
    })
  }

  test('one undo gives the literal characters back, the next removes the typing', async ({ page }) => {
    await open(page)
    await page.keyboard.type('**b**')
    expect(await doc(page)).toEqual([p('b', [{ type: 'bold', start: 0, end: 1 }])])
    await page.keyboard.press(`${MOD}+z`)
    expect(await doc(page)).toEqual([p('**b**')])
    await page.keyboard.press(`${MOD}+z`)
    expect(await doc(page)).toEqual([p('')])
  })

  test('no rules inside words, with rules off, or where the format is not allowed', async ({ page }) => {
    await open(page)
    await page.keyboard.type('snake_case_name_')
    expect(await doc(page)).toEqual([p('snake_case_name_')])
    await open(page, '&rules=off')
    await page.keyboard.type('**b**')
    expect(await doc(page)).toEqual([p('**b**')])
    await open(page, '&allowed=')
    await page.keyboard.type('**b** `c`')
    expect(await doc(page)).toEqual([p('**b** `c`')])
  })
})

test.describe('autolink', () => {
  test('an address becomes a link when a space follows it', async ({ page }) => {
    await open(page)
    await page.keyboard.type('see https://a.example/x, ok')
    expect(await doc(page)).toEqual([p('see https://a.example/x, ok', [{ type: 'link', start: 4, end: 23, attrs: { href: 'https://a.example/x' } }])])
    // The link does not continue into the next word.
    expect(await canonical(page)).toEqual([true])
  })

  test('and when Enter follows it', async ({ page }) => {
    await open(page)
    await page.keyboard.type('www.a.example')
    await page.keyboard.press('Enter')
    expect(await doc(page)).toEqual([p('www.a.example', [{ type: 'link', start: 0, end: 13, attrs: { href: 'https://www.a.example' } }]), p('')])
  })
})

test.describe('block rules', () => {
  for (const [typed, type] of [
    ['# ', 'heading-1'], ['### ', 'heading-3'], ['- ', 'list-bullet'], ['* ', 'list-bullet'],
    ['1. ', 'list-number'], ['[ ] ', 'list-check'], ['> ', 'quote'],
  ] as const) {
    test(`"${typed}" at the start makes ${type}`, async ({ page }) => {
      await open(page)
      await page.keyboard.type(`${typed}Title`)
      expect(await types(page)).toEqual([type])
      expect(await doc(page)).toEqual([p('Title')])
    })
  }

  test('three backticks or dashes, then Enter', async ({ page }) => {
    await open(page)
    await page.keyboard.type('```ts')
    await page.keyboard.press('Enter')
    expect(await types(page)).toEqual(['code'])
    expect(await doc(page)).toEqual([p('')])
    await open(page)
    await page.keyboard.type('---')
    await page.keyboard.press('Enter')
    expect(await types(page)).toEqual(['separator'])
  })

  test('undo turns the block back into the typed prefix', async ({ page }) => {
    await open(page)
    await page.keyboard.type('## ')
    expect(await types(page)).toEqual(['heading-2'])
    await page.keyboard.press(`${MOD}+z`)
    expect(await types(page)).toEqual(['paragraph'])
    expect(await doc(page)).toEqual([p('## ')])
  })

  test('only at the start of a block', async ({ page }) => {
    await open(page)
    await page.keyboard.type('a # b - c')
    expect(await types(page)).toEqual(['paragraph'])
    expect(await doc(page)).toEqual([p('a # b - c')])
  })
})
