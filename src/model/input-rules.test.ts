import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { linkify, matchAutolink, matchBlockRuleOnEnter, matchBlockRuleOnSpace, matchInlineRule } from './input-rules'
import { createValue, type RichTextValue } from './richtext'

const t = (text: string, formats: RichTextValue['formats'] = []): RichTextValue => createValue(text, formats)
const inline = (text: string): RichTextValue | null => matchInlineRule(t(text), text.length)?.value ?? null

describe('inline rules', () => {
  it('turn delimited text into formats', () => {
    expect(inline('a **bold**')).toEqual(t('a bold', [{ type: 'bold', start: 2, end: 6 }]))
    expect(inline('__bold__')).toEqual(t('bold', [{ type: 'bold', start: 0, end: 4 }]))
    expect(inline('x *it*')).toEqual(t('x it', [{ type: 'italic', start: 2, end: 4 }]))
    expect(inline('(_it_')).toEqual(t('(it', [{ type: 'italic', start: 1, end: 3 }]))
    expect(inline('~~gone~~')).toEqual(t('gone', [{ type: 'strikethrough', start: 0, end: 4 }]))
    expect(inline('run `npm i`')).toEqual(t('run npm i', [{ type: 'code', start: 4, end: 9 }]))
  })

  it('end the format at the caret, so the next character is plain', () => {
    const r = matchInlineRule(t('a **b**'), 7)!
    expect(r.caret).toBe(3)
    expect(r.marks).toEqual([])
    expect(r.rule).toBe('bold')
  })

  it('keep formats around the rule for the next character', () => {
    const r = matchInlineRule(t('x *b*', [{ type: 'underline', start: 0, end: 5 }]), 5)!
    expect(r.marks).toEqual([{ type: 'underline' }])
  })

  it('do not fire inside words, on empty or padded content, or on a half-typed bold', () => {
    for (const text of ['snake_case_', '2*3*', '** **', '* a*', '**bold*', '`', '``', 'a**b**', '_a\nb_']) expect(inline(text)).toBeNull()
  })

  it('do not fire in code, nor for formats the field refuses', () => {
    expect(matchInlineRule(t('`**a**`', [{ type: 'code', start: 0, end: 7 }]), 6)).toBeNull()
    expect(matchInlineRule(t('**a**'), 5, (f) => f !== 'bold')).toBeNull()
  })

  it('only ever remove the delimiters', () => {
    const arb = fc.string({ unit: fc.constantFrom('a', ' ', '*', '_', '`', '~'), maxLength: 16 })
    fc.assert(fc.property(arb, (text) => {
      const r = matchInlineRule(t(text), text.length)
      if (!r) return
      expect(r.value.text.length).toBeLessThan(text.length)
      expect(r.caret).toBeLessThanOrEqual(r.value.text.length)
      // Deleted characters are all delimiter characters.
      const delims = (x: string): number => x.replace(/[^*_`~]/g, '').length
      const removed = delims(text) - delims(r.value.text)
      expect(removed).toBe(text.length - r.value.text.length)
    }))
  })
})

describe('autolink', () => {
  const link = (href: string, start: number, end: number) => ({ type: 'link', start, end, attrs: { href } })

  it('links an address before the typed space', () => {
    expect(matchAutolink(t('see https://a.example/x '), 23)).toEqual(t('see https://a.example/x ', [link('https://a.example/x', 4, 23)]))
    expect(matchAutolink(t('www.example.com'), 15)).toEqual(t('www.example.com', [link('https://www.example.com', 0, 15)]))
  })

  it('leaves out trailing punctuation, but keeps a balanced parenthesis', () => {
    expect(matchAutolink(t('(https://a.example/x).'), 22)?.formats).toEqual([link('https://a.example/x', 1, 20)])
    expect(matchAutolink(t('https://w.example/A_(b)'), 23)?.formats).toEqual([link('https://w.example/A_(b)', 0, 23)])
  })

  it('ignores words that are not addresses, existing links and code', () => {
    expect(matchAutolink(t('example.com'), 11)).toBeNull()
    expect(matchAutolink(t('javascript:alert(1)'), 19)).toBeNull()
    expect(matchAutolink(t('https://a.example', [link('/x', 0, 17)]), 17)).toBeNull()
    expect(matchAutolink(t('https://a.example', [{ type: 'code', start: 0, end: 17 }]), 17)).toBeNull()
  })

  it('links every address in pasted text', () => {
    expect(linkify(t('a https://a.example b www.b.example.')).formats).toEqual([
      link('https://a.example', 2, 19), link('https://www.b.example', 22, 35),
    ])
    expect(linkify(t('https://a.example https://b.example', [{ type: 'code', start: 0, end: 5 }])).formats).toEqual([
      { type: 'code', start: 0, end: 5 }, link('https://b.example', 18, 35),
    ])
  })

  it('stays linear on long lists of addresses and long punctuation runs', () => {
    const list = Array.from({ length: 4000 }, (_, i) => `https://a.example/${i}`).join('\n')
    let started = performance.now()
    expect(linkify(t(list)).formats).toHaveLength(4000)
    expect(performance.now() - started).toBeLessThan(500)
    const dots = `https://a.example/${'.'.repeat(50_000)}x`
    started = performance.now()
    matchAutolink(t(dots), dots.length)
    expect(performance.now() - started).toBeLessThan(100)
  })
})

describe('block rules', () => {
  const space = (text: string) => matchBlockRuleOnSpace(t(text), text.indexOf(' ') + 1)

  it('recognise the Markdown-like prefixes', () => {
    expect(space('## rest')).toEqual({ rule: { kind: 'heading', level: 2 }, rest: t('rest') })
    expect(space('- ')?.rule).toEqual({ kind: 'list', style: 'bullet' })
    expect(space('* ')?.rule).toEqual({ kind: 'list', style: 'bullet' })
    expect(space('3. ')?.rule).toEqual({ kind: 'list', style: 'number', start: 3 })
    expect(space('1) ')?.rule).toEqual({ kind: 'list', style: 'number', start: 1 })
    expect(space('[ ] ')).toBeNull() // the caret is after the first space here, inside the brackets
    expect(matchBlockRuleOnSpace(t('[ ] '), 4)?.rule).toEqual({ kind: 'list', style: 'check', checked: false })
    expect(matchBlockRuleOnSpace(t('[x] '), 4)?.rule).toEqual({ kind: 'list', style: 'check', checked: true })
    expect(space('> quoted')).toEqual({ rule: { kind: 'quote' }, rest: t('quoted') })
  })

  it('keep the formats of the rest', () => {
    expect(matchBlockRuleOnSpace(t('# ab', [{ type: 'bold', start: 2, end: 4 }]), 2)?.rest).toEqual(t('ab', [{ type: 'bold', start: 0, end: 2 }]))
  })

  it('fire only at the start, before a caret right after the space', () => {
    expect(matchBlockRuleOnSpace(t('a # b'), 4)).toBeNull()
    expect(matchBlockRuleOnSpace(t('####### x'), 8)).toBeNull()
    expect(matchBlockRuleOnSpace(t('#x'), 2)).toBeNull()
    expect(matchBlockRuleOnSpace(t('a\n# '), 4)).toBeNull()
  })

  it('on Enter: code fences and separators', () => {
    expect(matchBlockRuleOnEnter(t('```'))?.rule).toEqual({ kind: 'code', language: '' })
    expect(matchBlockRuleOnEnter(t('```ts'))?.rule).toEqual({ kind: 'code', language: 'ts' })
    expect(matchBlockRuleOnEnter(t('---'))?.rule).toEqual({ kind: 'separator' })
    expect(matchBlockRuleOnEnter(t('***'))?.rule).toEqual({ kind: 'separator' })
    expect(matchBlockRuleOnEnter(t('--'))).toBeNull()
    expect(matchBlockRuleOnEnter(t('``` x'))).toBeNull()
  })
})
