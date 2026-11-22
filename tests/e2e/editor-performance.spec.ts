/**
 * The 2,000-block budget, reported as
 * annotations (`pnpm e2e:annotations editor-performance`). Frame times depend on
 * how busy the machine is (the full suite runs in parallel), so they are only
 * reported; the assertions are loose ceilings on the editor's own work. Measure
 * alone for the report: `pnpm e2e:annotations editor-performance --workers=1`
 * (the annotations script runs the tests itself; without --workers=1 the three
 * engines run at once and WebKit's numbers double).
 */
import { expect, test } from '@playwright/test'

const BLOCKS = 2000

// With a host listening to blocksChange , typing must cost the same: the change is found from the operations.
for (const hooks of [false, true]) test(`typing in a 2,000-block document paints within a frame${hooks ? ', with a blocksChange subscriber' : ''}`, async ({ page }, info) => {
  const t0 = Date.now()
  await page.goto(`/editor/?blocks=${BLOCKS}${hooks ? '&hooks' : ''}`)
  await page.waitForFunction(() => window.__editor !== undefined)
  const mount = Date.now() - t0
  const id = await page.evaluate((n) => window.__editor!.editor.getJSON().blocks[n]!.id, BLOCKS / 2)
  await page.evaluate((b) => { window.__editor!.editor.select({ kind: 'text', blockId: b, field: 'content', anchor: 5, focus: 5 }) }, id)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)))
  await page.evaluate(() => {
    const w = window as unknown as { __times: number[]; __work: number[] }
    w.__times = []
    w.__work = []
    const root = document.querySelector('#editor')!.shadowRoot!
    let start = 0
    root.addEventListener('keydown', () => { start = performance.now() }, { capture: true })
    // Bubbling: runs after the field read the text back and the editor recorded the transaction.
    root.addEventListener('input', () => {
      const s = start
      w.__work.push(performance.now() - s)
      requestAnimationFrame(() => { w.__times.push(performance.now() - s) })
    })
  })
  await page.keyboard.type('the quick brown fox jumps over', { delay: 40 })
  await page.keyboard.press('Enter')
  await page.keyboard.press('Backspace')
  const times = await page.evaluate(() => (window as unknown as { __times: number[] }).__times.slice().sort((a, b) => a - b))
  const work = await page.evaluate(() => (window as unknown as { __work: number[] }).__work.slice().sort((a, b) => a - b))
  const pct = (p: number, list = times): number => list[Math.min(list.length - 1, Math.floor(list.length * p))]!
  info.annotations.push(
    { type: 'blocks', description: String(BLOCKS) },
    { type: 'load and mount (ms)', description: String(mount) },
    { type: 'keystroke handling, median (ms)', description: pct(0.5, work).toFixed(2) },
    { type: 'keystroke to frame, median (ms)', description: pct(0.5).toFixed(1) },
    { type: 'keystroke to frame, p95 (ms)', description: pct(0.95).toFixed(1) },
  )
  expect(times.length).toBeGreaterThan(20)
  expect(pct(0.5, work)).toBeLessThan(30)
  expect(await page.evaluate(() => window.__editor!.editor.getJSON().blocks.length)).toBe(BLOCKS)
  if (hooks) expect(await page.evaluate(() => window.__editor!.hooks.changes.length)).toBeGreaterThan(20)
})

test('a structural change (Enter) in a 2,000-block document', async ({ page }, info) => {
  await page.goto(`/editor/?blocks=${BLOCKS}`)
  await page.waitForFunction(() => window.__editor !== undefined)
  const id = await page.evaluate((n) => window.__editor!.editor.getJSON().blocks[n]!.id, BLOCKS / 2)
  await page.evaluate((b) => { window.__editor!.editor.select({ kind: 'text', blockId: b, field: 'content', anchor: 5, focus: 5 }) }, id)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)))
  const times: number[] = []
  for (let i = 0; i < 10; i++) {
    const ms = await page.evaluate(() => new Promise<number>((resolve) => {
      const root = document.querySelector('#editor')!.shadowRoot!
      const start = performance.now()
      const field = root.activeElement as HTMLElement
      field.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertParagraph', bubbles: true, cancelable: true }))
      requestAnimationFrame(() => { resolve(performance.now() - start) })
    }))
    times.push(ms)
  }
  times.sort((a, b) => a - b)
  info.annotations.push({ type: 'Enter to frame, median (ms)', description: times[5]!.toFixed(1) })
  // A ceiling, not the budget: under the full parallel suite WebKit's median has measured 208 to 398 ms.
  // Alone it is 42 to 74 ms.
  expect(times[5]).toBeLessThan(500)
  expect(await page.evaluate(() => window.__editor!.editor.getJSON().blocks.length)).toBe(BLOCKS + 10)
})

test('selecting every part of a 2,000-block document', async ({ page }, info) => {
  await page.goto(`/editor/?blocks=${BLOCKS}`)
  await page.waitForFunction(() => window.__editor !== undefined)
  const id = await page.evaluate((n) => window.__editor!.editor.getJSON().blocks[n]!.id, BLOCKS / 2)
  await page.evaluate((b) => { window.__editor!.editor.select({ kind: 'text', blockId: b, field: 'content', anchor: 0, focus: 0 }) }, id)
  await page.waitForTimeout(500)
  // To the end of the frame that shows it: a message posted from requestAnimationFrame runs after rendering.
  const ms = await page.evaluate(() => new Promise<number>((resolve) => {
    const blocks = window.__editor!.editor.getJSON().blocks
    const start = performance.now()
    window.__editor!.editor.select({ kind: 'blocks', anchorId: blocks[0]!.id, focusId: blocks.at(-1)!.id })
    requestAnimationFrame(() => {
      const ch = new MessageChannel()
      ch.port1.onmessage = () => { resolve(performance.now() - start) }
      ch.port2.postMessage(0)
    })
  }))
  info.annotations.push({ type: 'select all to painted (ms)', description: ms.toFixed(0) })
  expect(ms).toBeLessThan(1500)
})
