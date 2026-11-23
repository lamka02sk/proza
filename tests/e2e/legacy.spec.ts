/**
 * Legacy HTML (decision 0020): stored HTML of an older editor, read with a
 * legacy policy, comes back as HTML that loses nothing a page shows, in every
 * engine, and reading that output again changes nothing.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { caret } from './editor-helpers'

const fixture = readFileSync(join(import.meta.dirname, '../fixtures/legacy/tinymce-page.html'), 'utf8')

async function harness(page: Page): Promise<void> {
  await page.goto('/harness/import/')
  await page.waitForFunction(() => window.__import !== undefined)
}

interface LegacyResult { html: string; losses: { kind: string; detail: string; count: number }[]; stable: boolean; again: string }

function run(page: Page, input: string): Promise<LegacyResult> {
  return page.evaluate((i) => {
    const policy = { frames: ['maps.example.org', { host: 'forms.example.org', sandbox: false as const }] }
    return window.__import!.run(i, { source: 'tinymce', legacy: policy }) as unknown as LegacyResult
  }, input)
}

test('a TinyMCE page loses nothing and reads back the same', async ({ page }) => {
  await harness(page)
  const r = await run(page, fixture)
  expect(r.losses, r.html).toEqual([])
  expect(r.stable, `${r.html}\n---\n${r.again}`).toBe(true)
  expect(r.again).toBe(r.html)
})

/** One construction of legacy HTML each, with what the output must contain. */
const CASES: readonly (readonly [string, string, readonly string[]])[] = [
  ['text colour', '<p><span style="color: #a3001b;">Red</span></p>', ['<span style="color: #a3001b">Red</span>']],
  ['background of text', '<p><span style="background-color: #fff1cc;">Marked</span></p>', ['<span style="background-color: #fff1cc">Marked</span>']],
  ['font size', '<p><span style="font-size: 14pt;">Big</span></p>', ['<span style="font-size: 14pt">Big</span>']],
  ['font family', '<p><span style="font-family: georgia, serif;">Serif</span></p>', ['<span style="font-family: georgia, serif">Serif</span>']],
  ['a font element', '<p><font color="#004370" face="Arial" size="2">Old</font></p>', ['<span style="color: #004370; font-family: Arial; font-size: small">Old</span>']],
  ['a box with a class and a style', '<div class="box" style="border: 1px solid red;"><p>Inside</p></div>', ['<div class="box" style="border: 1px solid red"><p>Inside</p></div>']],
  ['a section with a class', '<section class="card"><p>Card</p></section>', ['<section class="card"><p>Card</p></section>']],
  ['text directly in a box', '<div class="slot" style="padding: 10px;">[WIDGET=1]</div>', ['<div class="slot" style="padding: 10px">[WIDGET=1]</div>']],
  ['alignment as a style', '<p style="text-align: right;">Right</p><h2 style="text-align: left;">Left</h2>', ['<p style="text-align: right">Right</p>', '<h2 style="text-align: left">Left</h2>']],
  ['justified text', '<p align="justify">Even</p>', ['<p style="text-align: justify">Even</p>']],
  ['a frame of a listed site', '<iframe src="https://maps.example.org/embed?q=1" width="100%" height="450" title="Map"></iframe>', ['<iframe src="https://maps.example.org/embed?q=1" title="Map" width="100%" height="450" sandbox="']],
  ['a frame without a sandbox', '<iframe src="https://forms.example.org/f/1" width="640" height="800" frameborder="0"></iframe>', ['<iframe src="https://forms.example.org/f/1" width="640" height="800" frameborder="0"></iframe>']],
  ['a named anchor', '<p><a name="top"></a>Start</p>', ['<p><a name="top"></a>Start</p>']],
  ['an icon', '<p><i class="icon icon-file"></i> File</p>', ['<p><i class="icon icon-file"></i> File</p>']],
  ['a link with a title and classes', '<p><a href="/a" class="btn md:px-5" title="Go">Go</a></p>', ['<a class="btn md:px-5" href="/a" title="Go">Go</a>']],
  ['a picture with its own style', '<figure class="image"><img src="/a.jpg" alt="A" style="float: left;"></figure>', ['<figure class="image"><img src="/a.jpg" alt="A"', 'style="float: left"']],
  ['a picture inside text', '<p>Before <img src="/a.png" alt="A" style="vertical-align: middle;"> after</p>', ['<p>Before <img src="/a.png" alt="A" style="vertical-align: middle"> after</p>']],
  ['a table as written', '<table border="1" cellspacing="0"><colgroup><col width="120"></colgroup><tr><td valign="top">A</td></tr></table>', ['<table border="1" cellspacing="0"><colgroup><col style="width: 120px"></colgroup><tbody><tr><td style="vertical-align: top">A</td></tr></tbody></table>']],
  ['an empty line', '<p>&nbsp;</p>', ['<p> </p>']],
  ['a form as raw HTML', '<form action="/s"><input name="q" onfocus="x()"></form>', ['<form action="/s"><input name="q"></form>']],
]

test.describe('each construction survives', () => {
  for (const [name, input, wanted] of CASES) {
    test(name, async ({ page }) => {
      await harness(page)
      const r = await run(page, input)
      for (const w of wanted) expect(r.html).toContain(w)
      expect(r.html).not.toMatch(/class="[^"]*\bpz-/)
      expect(r.losses, r.html).toEqual([])
      expect(r.again).toBe(r.html)
    })
  }
})

test('without the policy nothing changes', async ({ page }) => {
  await harness(page)
  const r = await page.evaluate((i) => window.__import!.run(i, { source: 'tinymce' }), '<p style="text-align: center;"><span style="color: #1D4ED8;">Blue</span></p>')
  expect(r.html).toBe('<p class="pz-text-center pz-color-blue">Blue</p>')
})

test('legacy import of any HTML is valid and reads back the same', async ({ page }) => {
  await harness(page)
  const failures = await page.evaluate(() => window.__import!.legacyProperties(400))
  expect(failures).toEqual([])
})

test.describe('in the editor', () => {
  const LEGACY = '<p style="text-align: center;"><span style="color: #a3001b;">Red</span> text</p><div class="note" style="border: 1px solid #ccc;"><p>In a box</p></div><p><a name="top"></a>End</p><iframe src="https://maps.example.org/embed" width="600" height="400" title="Map"></iframe>'

  test('loads legacy HTML, shows its look, keeps it through typing, and writes it back', async ({ page }) => {
    await page.goto('/editor/?legacy')
    await page.waitForFunction(() => window.__editor !== undefined)
    await page.evaluate((h) => { window.__editor!.editor.setContent(h) }, LEGACY)
    // The look shows in the canvas, set through the CSSOM.
    await expect(page.locator('#editor [data-field] span[data-pz-style]')).toHaveCSS('color', 'rgb(163, 0, 27)')
    await expect(page.locator('#editor .pz-block.note')).toHaveCSS('border-top-style', 'solid')
    await expect(page.locator('#editor [data-pz-object="anchor"]')).toHaveCount(1)
    await expect(page.locator('#editor .pz-frame-part')).toContainText('maps.example.org')
    // Typing at the end of the coloured word extends its span, as a format does.
    const first = await page.evaluate(() => window.__editor!.json().blocks[0]!.id)
    await caret(page, first, 3)
    await page.keyboard.type('dish')
    expect(await page.evaluate(() => window.__editor!.editor.getHTML())).toBe([
      '<p style="text-align: center"><span style="color: #a3001b">Reddish</span> text</p>',
      '<div class="note" style="border: 1px solid #ccc"><p>In a box</p></div>',
      '<p><a name="top"></a>End</p>',
      '<iframe src="https://maps.example.org/embed" title="Map" width="600" height="400" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"></iframe>',
    ].join('\n'))
  })

  test('pasted HTML is still converted to clean parts', async ({ page }) => {
    await page.goto('/editor/?legacy')
    await page.waitForFunction(() => window.__editor !== undefined)
    const result = await page.evaluate(() => window.__editor!.editor.importHtml('<p style="text-align: center;"><span style="color: #a3001b;">Red</span></p>').blocks)
    expect(result[0]!.attrs).toMatchObject({ textAlign: 'center', htmlStyle: '' })
  })

  test('a frame part names the sites it may show and refuses others', async ({ page }) => {
    await page.goto('/editor/?legacy')
    await page.waitForFunction(() => window.__editor !== undefined)
    await page.evaluate(() => { window.__editor!.editor.setContent({ version: 1, blocks: [{ id: 'f', type: 'core/frame', attrs: { src: '' } }] }) })
    await page.locator('#editor [data-block="f"]').click()
    await expect(page.locator('#editor .pz-frame-part .hint')).toContainText('maps.example.org')
    const address = page.locator('#editor .pz-frame-part input').first()
    await address.fill('https://elsewhere.example/page')
    await address.press('Tab')
    await expect(page.locator('#editor .pz-frame-part .hint')).toHaveText('This address cannot be embedded here. It is published as a link.')
    await expect(address).toHaveAttribute('aria-invalid', 'true')
    expect(await page.evaluate(() => window.__editor!.editor.getHTML())).toBe('<p><a href="https://elsewhere.example/page">https://elsewhere.example/page</a></p>')
  })
})
