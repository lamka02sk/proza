/**
 * The import fixture corpus: every synthetic
 * fixture against its snapshot, real captures and TinyMCE records against the
 * invariants, stored documents through `import(render(doc))`. Same result in
 * every engine: the snapshot is shared.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { FixtureOptions } from '../../playground/harness/import/main'

const root = join(import.meta.dirname, '../fixtures')
const update = process.env.PROZA_UPDATE_FIXTURES === '1'

function files(dir: string, ext: RegExp): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(name) ? [p] : []
  }).sort()
}

async function harness(page: Page): Promise<void> {
  await page.goto('/harness/import/')
  await page.waitForFunction(() => window.__import !== undefined)
}

function run(page: Page, input: string, options: FixtureOptions) {
  return page.evaluate(([i, o]) => window.__import!.run(i, o), [input, options] as const)
}

test.describe('synthetic fixtures', () => {
  for (const path of files(join(root, 'import'), /\.(?:html|txt|docx)$/)) {
    const name = relative(join(root, 'import'), path)
    test(name, async ({ page, browserName }) => {
      await harness(page)
      const rtfPath = path.replace(/\.html$/, '.rtf')
      const options: FixtureOptions = {
        ...(path.endsWith('.txt') ? { text: true } : {}),
        // Stored TinyMCE records carry no markers; the host says where they come from.
        ...(name.startsWith('tinymce/') ? { source: 'tinymce' as const } : {}),
        ...(existsSync(rtfPath) ? { rtf: readFileSync(rtfPath, 'utf8') } : {}),
      }
      const result = path.endsWith('.docx')
        ? await page.evaluate((b64) => window.__import!.docx(b64), readFileSync(path).toString('base64'))
        : await run(page, readFileSync(path, 'utf8'), options)
      const expectedPath = path.replace(/\.(?:html|txt|docx)$/, '.expected.json')
      const actual = { source: result.report.source, blocks: result.blocks, report: result.report.entries, pending: result.pending }
      if (update && browserName === 'chromium') writeFileSync(expectedPath, `${JSON.stringify(actual, null, 2)}\n`)
      expect(existsSync(expectedPath), `no snapshot: run PROZA_UPDATE_FIXTURES=1 for ${basename(path)}`).toBe(true)
      expect(actual).toEqual(JSON.parse(readFileSync(expectedPath, 'utf8')))
    })
  }
})

/** Words of the visible text: what an import must not lose without saying so. */
const WORDS = /\p{L}{2,}/gu

test.describe('real captures and records', () => {
  const clipboard = files(join(root, 'clipboard'), /\.json$/)
  const tinymce = files(join(root, 'tinymce'), /\.html$/)
  test.skip(clipboard.length + tinymce.length === 0, 'no real captures committed yet (tests/fixtures/clipboard/README.md, tests/fixtures/tinymce/README.md)')
  for (const path of [...clipboard, ...tinymce]) {
    const name = relative(root, path)
    test(name, async ({ page }) => {
      await harness(page)
      let input: string, options: FixtureOptions
      if (path.endsWith('.json')) {
        const fixture = JSON.parse(readFileSync(path, 'utf8')) as { data: Record<string, string> }
        const html = fixture.data['text/html'] ?? ''
        input = html !== '' ? html : fixture.data['text/plain'] ?? ''
        options = { ...(html === '' ? { text: true } : {}), ...(fixture.data['text/rtf'] ? { rtf: fixture.data['text/rtf'] } : {}) }
      } else {
        input = readFileSync(path, 'utf8')
        options = { source: 'tinymce' }
      }
      const result = await run(page, input, options)
      const visible = await page.evaluate((html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html')
        doc.querySelectorAll('script, style, head, del, [style*="mso-list:Ignore"], [style*="mso-element:comment"]').forEach((e) => { e.remove() })
        return doc.body.textContent
      }, input)
      const before = (options.text ? input : visible).match(WORDS)?.length ?? 0
      const after = result.html.replace(/<[^>]*>/g, ' ').match(WORDS)?.length ?? 0
      expect(after, 'words kept').toBeGreaterThanOrEqual(Math.floor(before * 0.9))
      const expectedPath = path.replace(/\.(?:html|json)$/, '.expected.json')
      if (existsSync(expectedPath)) expect({ blocks: result.blocks, report: result.report.entries }).toEqual(JSON.parse(readFileSync(expectedPath, 'utf8')))
    })
  }
})

test('stored documents come back from their own HTML', async ({ page }) => {
  await harness(page)
  for (const json of files(join(root, 'documents'), /\.json$/)) {
    const html = readFileSync(json.replace(/\.json$/, '.html'), 'utf8')
    const stored = JSON.parse(readFileSync(json, 'utf8')) as unknown
    const [back, want] = await page.evaluate(([h, s]) => {
      const imported = window.__import!.run(h, { source: 'proza' })
      return [imported.blocks, window.__import!.shape(s)]
    }, [html, stored] as const)
    // A file's size shows rounded ("48 kB"), so it comes back rounded; everything else exactly.
    const sizes = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, x: unknown) => (k === 'bytes' ? Number(Number(x).toPrecision(2)) : x)))
    expect(sizes(back), basename(json)).toEqual(sizes(want))
  }
})
