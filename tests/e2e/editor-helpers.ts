/** Shared helpers for the editor core specs (playground/editor). */
import { expect, type Page } from '@playwright/test'
import type { EditorSelection } from '../../src/editor/selection'

export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

type Raw = Record<string, unknown>
let n = 0
const rich = (text: string) => ({ text, formats: [] })
export const para = (text: string, id = `p${++n}`): Raw => ({ id, type: 'core/paragraph', attrs: { content: rich(text) } })
export const heading = (text: string, level = 2, id = `h${++n}`): Raw => ({ id, type: 'core/heading', attrs: { level, content: rich(text) } })
export const item = (text: string, id = `i${++n}`, children?: Raw[]): Raw => ({ id, type: 'core/list-item', attrs: { content: rich(text) }, ...(children ? { children } : {}) })
export const list = (items: Raw[], style = 'bullet', id = `l${++n}`): Raw => ({ id, type: 'core/list', attrs: { style }, children: items })
export const quote = (children: Raw[], citation = '', id = `q${++n}`): Raw => ({ id, type: 'core/quote', attrs: { citation: rich(citation) }, children })
export const code = (text: string, id = `c${++n}`): Raw => ({ id, type: 'core/code', attrs: { content: rich(text) } })
export const separator = (id = `s${++n}`): Raw => ({ id, type: 'core/separator', attrs: {} })

export async function open(page: Page, blocks?: Raw[], query = ''): Promise<void> {
  await page.goto(`/editor/${query}`)
  await page.waitForFunction(() => window.__editor !== undefined)
  if (blocks) {
    await page.evaluate((b) => { window.__editor!.editor.setContent({ version: 1, blocks: b }) }, blocks)
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)))
  }
}

/** Block types and main texts, indented by nesting: `paragraph: text`, `  list-item: text`. */
export const outline = (page: Page): Promise<string[]> => page.evaluate(() => window.__editor!.outline())
export const selection = (page: Page): Promise<EditorSelection> => page.evaluate(() => window.__editor!.editor.selection)
export const announcements = (page: Page): Promise<string[]> => page.evaluate(() => window.__editor!.announcements)

/** Put the caret (or a range) into a field, as a click would. */
export async function caret(page: Page, blockId: string, offset: number, focus = offset, field = 'content'): Promise<void> {
  await page.evaluate(([b, f, a, o]) => {
    window.__editor!.editor.select({ kind: 'text', blockId: b!, field: f!, anchor: Number(a), focus: Number(o) })
  }, [blockId, field, String(offset), String(focus)])
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)))
}

/** Every mounted field's DOM is what its value renders to. */
export async function expectCanonical(page: Page): Promise<void> {
  const bad = await page.evaluate(() => {
    const out: string[] = []
    const ed = window.__editor!.editor
    for (const [id] of ed.tree.nodes) for (const attr of ['content', 'citation']) {
      const f = ed.field(id, attr)
      if (f && !f.isCanonical()) out.push(`${id}:${attr}`)
    }
    return out
  })
  expect(bad).toEqual([])
}

/** The id of the block holding the DOM focus. */
export const focusedBlock = (page: Page): Promise<string | null> => page.evaluate(() => {
  const root = document.querySelector('#editor')!.shadowRoot!
  return root.activeElement?.closest<HTMLElement>('[data-block]')?.dataset.block ?? null
})
