/**
 * Import in the editor: pastes from other
 * applications, HTML content on load, the source view's HTML, Word files,
 * pictures through the upload adapter, and the report.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { announcements, caret, open, outline, para } from './editor-helpers'

const fixtures = join(import.meta.dirname, '../fixtures/import')
const fixture = (name: string): string => readFileSync(join(fixtures, name), 'utf8')

/** A paste from outside, as an application puts it on the clipboard. */
async function paste(page: Page, data: Record<string, string>, target = '[data-field]'): Promise<void> {
  await page.evaluate(([d, sel]) => {
    const dt = new DataTransfer()
    for (const [k, v] of Object.entries(d)) dt.setData(k, v)
    const root = document.querySelector('#editor')!.shadowRoot!
    // Selected parts take a paste through the paste bin, which the editor focuses on Mod+V.
    const el = sel === '.pz-paste-bin' ? root.querySelector(sel)! : root.activeElement?.closest(sel) ?? root.activeElement ?? root.querySelector(sel)!
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, [data, target] as const)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)))
}

const status = (page: Page) => page.locator('#editor .status')
const reportDialog = (page: Page) => page.getByRole('dialog', { name: 'What the import changed' })

test.describe('pastes from other applications', () => {
  test.skip(({ browserName }) => browserName === 'firefox', 'Firefox drops clipboardData on synthetic ClipboardEvents: real pastes are tested by hand')

  test('Word: lists, footnote and quote come in as parts; the status line offers the report', async ({ page }) => {
    await open(page, [para('', 'a')])
    await caret(page, 'a', 0)
    await paste(page, { 'text/html': fixture('word-desktop/report-lists-footnote.html'), 'text/plain': 'Quarterly report' })
    expect(await outline(page)).toEqual([
      'heading1: Quarterly report',
      expect.stringMatching(/^paragraph: This paragraph has bold/) as unknown as string,
      'heading2: Highlights',
      'list', '  list-item: Sales grew in every region', '    list', '      list-item: North: 12 %', '      list-item: South: 9 %', '  list-item: Costs stayed flat',
      'paragraph: Next steps, continuing the numbering:',
      'list', '  list-item: Hire two people', '  list-item: Open the new office',
      'quote', '  paragraph: “Numbers tell the story.”',
      'paragraph: Prepared by the finance team.',
    ])
    await expect(status(page)).toContainText('Pasted from Word.')
    expect(await announcements(page)).toContainEqual(expect.stringMatching(/^Pasted from Word\. \d+ changes$/))
    await status(page).getByRole('button', { name: 'What changed' }).click()
    const dialog = reportDialog(page)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Not kept' })).toBeVisible()
    await expect(dialog).toContainText('A comment from the document.')
    await expect(dialog).toContainText('Tracked changes accepted (2)')
    await expect(dialog).toContainText('2 lists rebuilt from numbered paragraphs.')
    expect((await new AxeBuilder({ page }).include('#editor').analyze()).violations).toEqual([])
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    // The report stays reachable after the message has gone.
    await expect(status(page).getByRole('button', { name: 'What the import changed' })).toBeVisible()
    // One undo step takes the whole paste back.
    await page.evaluate(() => { window.__editor!.editor.undo() })
    expect(await outline(page)).toEqual(['paragraph: '])
  })

  test('one formatted paragraph goes into the text where the caret is, with its formats', async ({ page }) => {
    await open(page, [para('Hello world', 'a')])
    await caret(page, 'a', 6)
    await paste(page, { 'text/html': '<meta charset="utf-8"><span style="font-weight:700">bold</span> <em>new</em> ', 'text/plain': 'bold new ' })
    const json = await page.evaluate(() => window.__editor!.json())
    expect(json.blocks).toHaveLength(1)
    expect(json.blocks[0]!.attrs.content).toEqual({ text: 'Hello bold newworld', formats: [{ type: 'bold', start: 6, end: 10 }, { type: 'italic', start: 11, end: 14 }] })
  })

  test('a LibreOffice Calc range pastes as a table with editable cells', async ({ page }) => {
    await open(page, [para('', 'a')])
    await caret(page, 'a', 0)
    await paste(page, { 'text/html': fixture('libreoffice-calc/range.html'), 'text/plain': 'Name\tScore\nEva\t91\nJán\t78' })
    const table = page.locator('.pz-canvas table')
    await expect(table.getByRole('row')).toHaveCount(3)
    await expect(table.getByRole('cell', { name: 'Name', exact: true })).toBeVisible()
    const score = table.getByRole('row').nth(1).getByRole('cell').nth(1).getByRole('textbox')
    await expect(score).toHaveText('91')
    // The cell tools sit over the row above the caret's cell; they step aside for a pointer coming from another cell.
    const from = (await table.getByRole('cell', { name: 'Name', exact: true }).boundingBox())!
    const at = (await score.boundingBox())!
    await page.mouse.move(from.x + 4, from.y + 4)
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2, { steps: 4 })
    await score.click()
    await score.press('Home')
    await score.press('Backspace')
    await expect(score).toHaveText('91')
    await score.press('End')
    await score.press('Delete')
    await expect(score).toHaveText('91')
    await page.keyboard.type('0')
    await expect(score).toHaveText('910')
    expect(await page.evaluate(() => window.__editor!.editor.getHTML())).toMatch(/<td[^>]*>(?:<p[^>]*>)?910(?:<\/p>)?<\/td>/)
  })

  test('a Writer table keeps the header, merged and empty cells, and surrounding text', async ({ page }) => {
    await open(page, [para('', 'a')])
    await caret(page, 'a', 0)
    await paste(page, { 'text/html': `<meta name="generator" content="LibreOffice 24.2.7.2 (Linux)">
      <p>Before</p><table><caption>People</caption><tr><th colspan="2" scope="colgroup"><p>Names</p></th></tr>
      <tr><td><p>Eva</p></td><td><p><br></p></td></tr></table><p>After</p>` })
    const table = page.getByRole('table', { name: 'People' })
    await expect(table.getByRole('columnheader', { name: 'Names' })).toHaveAttribute('colspan', '2')
    await expect(table.getByRole('cell')).toHaveCount(2)
    await expect(table.getByRole('cell').last().getByRole('textbox')).toBeEmpty()
    const doc = await page.evaluate(() => {
      const { editor } = window.__editor!
      const types = editor.getJSON().blocks.map((b) => b.type)
      const html = editor.getHTML()
      editor.setContent({ version: 1, blocks: editor.importHtml(html, { source: 'proza' }).blocks })
      return { types, html, roundTrip: editor.getHTML() }
    })
    expect(doc.types).toEqual(['core/paragraph', 'core/table', 'core/paragraph'])
    expect(doc.html).toContain('<th colspan="2" scope="colgroup">Names</th>')
    expect(doc.html).toContain('<td>Eva</td><td></td>')
    expect(doc.roundTrip).toBe(doc.html)
  })

  test('plain text with blank lines and list lines becomes paragraphs and lists', async ({ page }) => {
    await open(page, [para('', 'a')])
    await caret(page, 'a', 0)
    await paste(page, { 'text/plain': 'First\nsame paragraph\n\n- one\n- two\n\nLast' })
    expect(await outline(page)).toEqual(['paragraph: First\nsame paragraph', 'list', '  list-item: one', '  list-item: two', 'paragraph: Last'])
  })

  test('an online video address alone on an empty line becomes the video', async ({ page }) => {
    await open(page, [para('Intro', 'a'), para('', 'b')])
    await caret(page, 'b', 0)
    await paste(page, { 'text/plain': 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
    const json = await page.evaluate(() => window.__editor!.json())
    expect(json.blocks.map((b) => b.type)).toEqual(['core/paragraph', 'core/embed'])
    expect(json.blocks[1]!.attrs.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    // In text, an address stays a link.
    await caret(page, 'a', 5)
    await paste(page, { 'text/plain': 'https://vimeo.com/76979871' })
    expect((await page.evaluate(() => window.__editor!.json())).blocks.map((b) => b.type)).toEqual(['core/paragraph', 'core/embed'])
  })

  test('a picture stored in pasted HTML is uploaded; one Word only points at comes from its RTF', async ({ page }) => {
    await open(page, [para('', 'a')])
    await caret(page, 'a', 0)
    const png = readFileSync(join(fixtures, '../media/picture.png')).toString('base64')
    await paste(page, { 'text/html': `<p>Before</p><img src="data:image/png;base64,${png}" alt="A dot"><p>After</p>`, 'text/plain': 'Before After' })
    await expect.poll(async () => (await page.evaluate(() => window.__editor!.json())).blocks[1]?.attrs.src).toMatch(/^\/__upload\//)
    const pic = (await page.evaluate(() => window.__editor!.json())).blocks[1]!.attrs
    expect(pic.alt).toBe('A dot')
    expect(pic.naturalWidth).toBeGreaterThan(0)

    await open(page, [para('', 'b')])
    await caret(page, 'b', 0)
    await paste(page, { 'text/html': fixture('word-desktop/picture-caption.html'), 'text/rtf': fixture('word-desktop/picture-caption.rtf'), 'text/plain': 'x' })
    await expect.poll(async () => (await page.evaluate(() => window.__editor!.json())).blocks[0]?.attrs.src).toMatch(/^\/__upload\//)
    const word = (await page.evaluate(() => window.__editor!.json())).blocks[0]!
    expect(word.attrs).toMatchObject({ alt: 'Stĺpcový graf predaja podľa štvrťrokov', caption: { text: 'Obrázok 1: Predaj podľa štvrťrokov' } })
  })

  test('a Word picture without its RTF keeps its place, ready for the file', async ({ page }) => {
    await open(page, [para('', 'a')])
    await caret(page, 'a', 0)
    await paste(page, { 'text/html': fixture('word-desktop/picture-without-rtf.html'), 'text/plain': 'x' })
    const pic = (await page.evaluate(() => window.__editor!.json())).blocks[0]!
    expect(pic).toMatchObject({ type: 'core/image', attrs: { src: '', alt: 'Stĺpcový graf predaja podľa štvrťrokov' } })
    await status(page).getByRole('button', { name: 'What changed' }).click()
    await expect(reportDialog(page)).toContainText('A picture the browser could not read (clip_image002.png). Its place is kept: add the picture there.')
  })

  test('HTML pasted on selected parts replaces them', async ({ page }) => {
    await open(page, [para('one', 'a'), para('two', 'b')])
    await caret(page, 'a', 1)
    await page.keyboard.press('Escape')
    await paste(page, { 'text/html': '<h3>Title</h3><p>Body</p>', 'text/plain': 'Title Body' }, '.pz-paste-bin')
    expect(await outline(page)).toEqual(['heading3: Title', 'paragraph: Body', 'paragraph: two'])
  })
})

test('HTML content on load is converted in memory and its report offered', async ({ page }) => {
  await open(page)
  const result = await page.evaluate((html) => {
    const target = document.createElement('div')
    document.body.append(target)
    const second = window.__editor!.createEditor({ target, content: html, contentSource: 'tinymce', label: 'Legacy' })
    return { blocks: second.editor.getJSON().blocks.map((b) => b.type), origin: second.editor.lastImport?.origin, source: second.editor.lastImport?.report.source }
  }, fixture('tinymce/offer-page.html'))
  expect(result).toMatchObject({ origin: 'load', source: 'tinymce' })
  expect(result.blocks.slice(0, 4)).toEqual(['core/heading', 'core/paragraph', 'core/paragraph', 'core/image'])
  await expect(page.getByRole('group', { name: 'Legacy' }).getByRole('button', { name: 'What the import changed' })).toBeVisible()
})

test('the source view takes edited HTML through the import, one undo step', async ({ page }) => {
  await open(page, [para('Old text', 'a')])
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Source of the content' })
  await dialog.getByRole('textbox', { name: 'Content as HTML' }).fill('<h2>New</h2><p>Text with <b>bold</b></p><p style="text-align: justify">Even</p>')
  await dialog.getByRole('button', { name: 'Apply HTML' }).click()
  expect(await outline(page)).toEqual(['heading2: New', 'paragraph: Text with bold', 'paragraph: Even'])
  await expect(page.locator('#editor .status').getByRole('button', { name: 'What the import changed' })).toBeVisible()
  await page.evaluate(() => { window.__editor!.editor.undo() })
  expect(await outline(page)).toEqual(['paragraph: Old text'])
})

test('Text from Word reads a .docx into the empty field', async ({ page }) => {
  await open(page, undefined, '?empty')
  await page.getByRole('button', { name: 'Text from Word' }).click({ trial: true })
  await page.locator('#editor input[type="file"][accept*=".docx"]').setInputFiles(join(fixtures, 'docx/report.docx'))
  await expect.poll(() => outline(page)).toContain('heading1: Annual report')
  const lines = await outline(page)
  expect(lines).toEqual(expect.arrayContaining(['heading1: Summary', '  list-item: North', 'quote', '  paragraph: Quoted line', 'paragraph: Prepared by the team.']))
  // The picture in the file goes to the upload adapter.
  await expect.poll(async () => (await page.evaluate(() => window.__editor!.json())).blocks.find((b) => b.type === 'core/image')?.attrs.src).toMatch(/^\/__upload\//)
  expect(await announcements(page)).toContainEqual(expect.stringMatching(/^Imported from a Word file\. \d+ changes?$/))
  await expect(page.locator('#editor .status').getByRole('button', { name: 'What the import changed' })).toBeVisible()
})

test('a file that is not a Word document says so', async ({ page }) => {
  await open(page, undefined, '?empty')
  await page.locator('#editor input[type="file"][accept*=".docx"]').setInputFiles({ name: 'notes.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('not a zip') })
  await expect.poll(() => announcements(page)).toContain('notes.docx could not be read. Choose a Word document (.docx).')
})

test('the report in Slovak, and axe-clean in the dark', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page, [para('Starý text', 'a')], '?locale=sk&theme=dark')
  await page.evaluate(() => { window.__editor!.editor.replaceHtml('<p style="text-align:justify"><font face="Arial" color="#00aa00">Text</font></p><table><tr><td>a</td><td>b</td></tr></table>') })
  await expect(page.getByRole('table').getByRole('cell')).toHaveCount(2)
  await page.locator('#editor .status').getByRole('button', { name: 'Čo import zmenil' }).click()
  const dialog = page.getByRole('dialog', { name: 'Čo import zmenil' })
  await expect(dialog).toContainText('Použité z webovej stránky.')
  await expect(dialog.getByRole('heading', { name: 'Nezachovalo sa' })).toBeVisible()
  await expect(dialog).toContainText('Písma (Arial)')
  expect((await new AxeBuilder({ page }).include('#editor').analyze()).violations).toEqual([])
})

test('re-hosting pictures: a paste stores only the pictures it brought', async ({ page, browserName }) => {
  test.skip(browserName === 'firefox', 'Firefox drops clipboardData on synthetic ClipboardEvents: real pastes are tested by hand')
  // Two other sites: where the pictures come from, and the host's storage at another origin.
  for (const site of ['https://pictures.example/**', 'https://cdn.example/**']) {
    await page.route(site, (route) => route.fulfill({ path: join(import.meta.dirname, '../fixtures/media/picture.png'), contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } }))
  }
  await open(page)
  await page.evaluate(() => {
    const target = document.createElement('div')
    target.id = 'second'
    document.body.append(target)
    const w = window as unknown as { stored: string[] }
    w.stored = []
    window.__editor!.createEditor({
      target,
      // A picture the author placed by address: only an import re-hosts, and only what it brought.
      content: { version: 1, blocks: [
        { id: 'a', type: 'core/paragraph', attrs: { content: { text: 'Intro', formats: [] } } },
        { id: 'pic', type: 'core/image', attrs: { src: 'https://pictures.example/placed.png', alt: 'Placed' } },
      ] },
      import: { rehostImages: true },
      upload: (file) => { w.stored.push(file.name); return Promise.resolve({ url: `https://cdn.example/${String(w.stored.length)}.png`, width: 4, height: 4 }) },
    })
  })
  const stored = () => page.evaluate(() => (window as unknown as { stored: string[] }).stored)
  const pasteHtml = (html: string) => page.evaluate((markup) => {
    const dt = new DataTransfer()
    dt.setData('text/html', markup)
    dt.setData('text/plain', 'More')
    const root = document.querySelector('#second')!.shadowRoot!
    root.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, html)
  await page.locator('#second').getByText('Intro').click()
  await pasteHtml('<p>More</p><figure><img src="https://pictures.example/b.png" alt="B"></figure>')
  await expect.poll(stored).toEqual(['b.png'])
  // Another paste brings no picture: nothing is stored again, neither the placed one nor the one on the host's storage.
  await page.locator('#second').getByText('Intro').click()
  await pasteHtml('<p>Again</p>')
  await page.waitForTimeout(300)
  expect(await stored()).toEqual(['b.png'])
})
