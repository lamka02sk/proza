/**
 * Canvas isolation spike: how much host CSS leaks into
 * the editor per isolation mode, and whether editing works in a shadow root.
 */
import { expect, test, type Page } from '@playwright/test'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
type Probes = Record<string, Record<string, string>>

async function probes(page: Page, mode: string, host: string): Promise<Probes> {
  await page.goto(`/spikes/isolation/?mode=${mode}&host=${host}`)
  await page.waitForFunction(() => window.__isolation !== undefined)
  return page.evaluate(() => window.__isolation!.probes())
}

function diff(base: Probes, got: Probes): string[] {
  const out: string[] = []
  for (const [probe, props] of Object.entries(base)) {
    for (const [prop, v] of Object.entries(props)) {
      const g = got[probe]?.[prop]
      if (g !== v) out.push(`${probe}.${prop}: ${v} -> ${g}`)
    }
  }
  return out
}

for (const mode of ['light', 'hardened', 'shadow'] as const) {
  for (const host of ['realistic', 'adversarial'] as const) {
    test(`style leakage: ${mode} under ${host} host CSS`, async ({ page }) => {
      const base = await probes(page, mode, 'none')
      const got = await probes(page, mode, host)
      const leaks = diff(base, got)
      test.info().annotations.push({ type: 'leaks', description: `${leaks.length}: ${leaks.join('; ')}` })
      if (mode === 'shadow') expect(leaks).toEqual([])
    })
  }
}

for (const mode of ['light', 'shadow'] as const) {
  test(`typing under adversarial host CSS: ${mode}`, async ({ page }) => {
    await page.goto(`/spikes/isolation/?mode=${mode}&host=adversarial`)
    await page.waitForFunction(() => window.__isolation !== undefined)
    await page.evaluate(() => { window.__isolation!.doc.load([{ text: '', formats: [] }]); window.__isolation!.doc.field(0)!.focus(0) })
    await page.keyboard.type('a  b ')
    const text = await page.evaluate(() => window.__isolation!.doc.blocks[0]!.value.text)
    const whiteSpace = await page.evaluate(() => getComputedStyle(window.__isolation!.doc.field(0)!.element).whiteSpace)
    test.info().annotations.push({ type: 'typed', description: `${JSON.stringify(text)} white-space=${whiteSpace}` })
    // Inline !important beats author !important, so the field keeps pre-wrap in both modes.
    expect(whiteSpace).toMatch(/pre-wrap/)
    // Recorded for light: host `user-select` / `-webkit-user-modify` rules can switch editing off.
    if (mode === 'shadow') expect(text).toBe('a  b ')
  })
}

test.describe('editing inside a shadow root', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/spikes/isolation/?mode=shadow&host=realistic')
    await page.waitForFunction(() => window.__isolation !== undefined)
    await page.evaluate(() => { window.__isolation!.doc.load([{ text: '', formats: [] }]) })
  })

  test('selection capabilities of this engine', async ({ page }) => {
    await page.locator('proza-editor p').first().click()
    await page.keyboard.type('abc')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.waitForTimeout(100)
    const caps = await page.evaluate(() => window.__isolation!.caps())
    test.info().annotations.push({ type: 'caps', description: JSON.stringify(caps) })
    expect(caps.getComposedRanges).toBe(true)
  })

  test('typing, keyboard selection, format, split, merge', async ({ page }) => {
    await page.locator('proza-editor p').first().click()
    await page.keyboard.type('hello world')
    for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowLeft')
    const sel = await page.evaluate(() => window.__isolation!.doc.field(0)!.selection)
    // Backward selection: direction must survive the shadow boundary.
    expect(sel).toEqual({ anchor: 11, focus: 6 })
    await page.keyboard.press(`${MOD}+b`)
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Enter')
    await page.keyboard.type('X')
    await page.keyboard.press('Home')
    await page.keyboard.press('Backspace')
    const blocks = await page.evaluate(() => window.__isolation!.doc.blocks.map((b) => b.value))
    // Enter after the bold word's start carries nothing (the char before is plain), so X is plain.
    expect(blocks).toEqual([{ text: 'hello Xworld', formats: [{ type: 'bold', start: 7, end: 12 }] }])
  })

  test('toolbar button keeps the selection', async ({ page }) => {
    await page.evaluate(() => { window.__isolation!.doc.load([{ text: 'abcd', formats: [] }]); window.__isolation!.doc.field(0)!.setSelection({ anchor: 1, focus: 3 }) })
    await page.locator('proza-editor .pz-button').click()
    const v = await page.evaluate(() => window.__isolation!.doc.blocks[0]!.value)
    expect(v).toEqual({ text: 'abcd', formats: [{ type: 'bold', start: 1, end: 3 }] })
  })
})
