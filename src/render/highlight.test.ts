import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { highlights, tokenize } from './highlight'

const show = (code: string, lang: string): string[] => tokenize(code, lang).map((t) => `${t.type}:${code.slice(t.start, t.end)}`)

describe('highlight', () => {
  it('JavaScript: keywords, strings, numbers, comments, calls; never inside a word', () => {
    expect(show('const classic = load("a") // done\nreturn 0x1F', 'js')).toEqual([
      'keyword:const', 'function:load', 'string:"a"', 'comment:// done', 'keyword:return', 'number:0x1F',
    ])
  })

  it('HTML tags and attributes, PHP variables, SQL in any case', () => {
    expect(show('<a href="/x">Go</a>', 'html')).toEqual(['tag:<a', 'attr:href', 'string:"/x"', 'tag:>', 'tag:</a', 'tag:>'])
    expect(show('echo $name;', 'php')).toEqual(['keyword:echo', 'variable:$name'])
    expect(show('SELECT id FROM t', 'sql')).toEqual(['keyword:SELECT', 'keyword:FROM'])
  })

  it('YAML keys, also in list items', () => {
    expect(show('- name: x\n  - a.b: 1\nkey: v', 'yaml')).toEqual(['property:- name', 'property:  - a.b', 'number:1', 'property:key'])
  })

  it('long runs that almost match stay linear (CSS "-", YAML "-", HTML ":")', () => {
    for (const [code, lang] of [['-'.repeat(40_000), 'css'], ['-'.repeat(40_000), 'yaml'], ['a:'.repeat(20_000), 'html']] as const) {
      const started = performance.now()
      tokenize(code, lang)
      expect(performance.now() - started).toBeLessThan(200)
    }
  })

  it('knows aliases, and nothing for an unknown language', () => {
    expect(tokenize('x', 'constructor')).toEqual([])
    expect(highlights('TypeScript')).toBe(true)
    expect(highlights('cobol')).toBe(false)
    expect(tokenize('x = 1', 'cobol')).toEqual([])
  })

  it('property: tokens are ordered, inside the text and never overlap, for any input', () => {
    fc.assert(fc.property(fc.string({ maxLength: 80 }), fc.constantFrom('js', 'json', 'css', 'html', 'python', 'php', 'sql', 'bash', 'c', 'ruby', 'yaml'), (code, lang) => {
      let at = 0
      for (const t of tokenize(code, lang)) {
        expect(t.start).toBeGreaterThanOrEqual(at)
        expect(t.end).toBeGreaterThan(t.start)
        expect(t.end).toBeLessThanOrEqual(code.length)
        at = t.end
      }
    }), { numRuns: 500 })
  })
})
