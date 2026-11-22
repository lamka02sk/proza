/** Every committed fixture is well-formed. Grows with the corpus. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateClipboardFixture } from '../fixtures/clipboard-fixture'

const root = join(import.meta.dirname, '../fixtures')

function files(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? files(p, ext) : p.endsWith(ext) ? [p] : []
  })
}

describe('clipboard fixtures', () => {
  const list = files(join(root, 'clipboard'), '.json')
  it.each(list.map((p) => [relative(root, p), p]))('%s', (_name, path) => {
    const fixture: unknown = JSON.parse(readFileSync(path, 'utf8'))
    expect(validateClipboardFixture(fixture)).toEqual([])
    expect(path).toContain(`/clipboard/${(fixture as { source: string }).source}/`)
  })
  it('directory exists', () => { expect(statSync(join(root, 'clipboard')).isDirectory()).toBe(true) })
})

describe('TinyMCE fixtures', () => {
  const list = files(join(root, 'tinymce'), '.html')
  it.each(list.map((p) => [relative(root, p), p]))('%s is non-empty UTF-8', (_name, path) => {
    const html = readFileSync(path, 'utf8')
    expect(html.trim().length).toBeGreaterThan(0)
    expect(html).not.toContain('�')
  })
  it('directory exists', () => { expect(statSync(join(root, 'tinymce')).isDirectory()).toBe(true) })
})
