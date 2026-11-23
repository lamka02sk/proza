import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { CLASS_LIST, FRAME_SANDBOX, STYLE_PATTERN, cleanStyle, httpsHost, keepClasses, legacyRules, safeStyleValue } from './legacy'
import { checkFormatAttr, legacyFormats, normalize } from './richtext'

describe('cleanStyle', () => {
  it('keeps allowed declarations in source order, written one way', () => {
    expect(cleanStyle('COLOR: Red !important;font-size:14pt ; position: fixed', (p) => p !== 'position')).toBe('color: Red; font-size: 14pt')
  })

  it('drops values that load, script or leave the attribute', () => {
    for (const v of ['url(x.png)', 'URL (x)', 'expression(alert(1))', 'javascript:x', 'a\\62 c', '"</style>"', 'image-set("a" 1x)', '-moz-binding: x', 'a /* b */']) {
      expect(cleanStyle(`background: ${v}`), v).toBe('')
    }
    expect(safeStyleValue('arial, "Helvetica Neue", sans-serif')).toBe(true)
  })

  it('what it writes always matches the stored pattern', () => {
    fc.assert(fc.property(fc.string({ maxLength: 200 }), (t) => STYLE_PATTERN.test(cleanStyle(t))))
  })

  it('the stored pattern stays linear on long hostile input', () => {
    const t = performance.now()
    STYLE_PATTERN.test(`${'u'.repeat(100_000)}rl (`)
    STYLE_PATTERN.test(`color: ${' '.repeat(100_000)}x`)
    expect(performance.now() - t).toBeLessThan(200)
  })
})

describe('legacyRules', () => {
  const rules = legacyRules({
    styles: ['color', 'border*'], classes: ['btn', 'icon-*'],
    frames: ['maps.example.org', { host: '*.forms.example.org', sandbox: false }, { host: 'cal.example.org', sandbox: 'allow-scripts' }],
    palette: [{ name: 'red', color: '#a3001b' }, { name: 'bad', color: 'url(x)' }],
  })

  it('matches properties and classes exactly or by prefix', () => {
    expect([rules.style('color'), rules.style('border-left'), rules.style('font-size')]).toEqual([true, true, false])
    expect(rules.published('text-align')).toBe(true)
    expect([rules.className('btn'), rules.className('icon-file'), rules.className('other')]).toEqual([true, true, false])
  })

  it('never keeps editors\' own classes as the host\'s', () => {
    const all = legacyRules({ classes: ['*'] })
    expect(['pz-text-center', 'mce-item-table', 'MsoNormal', 'Apple-tab-span', 'note'].map(all.className)).toEqual([false, false, false, false, true])
  })

  it('gives each listed site its sandbox, and nothing to others', () => {
    expect(rules.frame('https://maps.example.org/embed?q=1')).toBe(FRAME_SANDBOX)
    expect(rules.frame('https://a.forms.example.org/f')).toBeNull()
    expect(rules.frame('https://forms.example.org/f')).toBeUndefined()
    expect(rules.frame('https://cal.example.org/')).toBe('allow-scripts')
    expect(rules.frame('http://maps.example.org/')).toBeUndefined()
    expect(rules.frame('https://maps.example.org.evil.test/')).toBeUndefined()
    expect(rules.frame('javascript:alert(1)')).toBeUndefined()
  })

  it('reads palette colours only when they are safe', () => {
    expect([rules.color('red'), rules.color('bad'), rules.color('none')]).toEqual(['#a3001b', undefined, undefined])
  })

  it('compiles each policy once', () => {
    const p = {}
    expect(legacyRules(p)).toBe(legacyRules(p))
  })
})

describe('classes and hosts', () => {
  it('keeps class tokens the policy admits and that are names', () => {
    expect(keepClasses(' btn  md:px-5 [&.active]:bg-a !text-white x"y ', () => true)).toBe('btn md:px-5 [&.active]:bg-a !text-white')
    expect(CLASS_LIST.test('a b')).toBe(true)
    expect(CLASS_LIST.test('a  b')).toBe(false)
  })

  it('reads the host of https addresses only', () => {
    expect(httpsHost('https://Maps.Example.org:8443/x')).toBe('maps.example.org')
    expect(httpsHost('http://example.org')).toBeNull()
  })
})

describe('legacy formats', () => {
  const formats = legacyFormats()

  it('check style and class attributes', () => {
    expect(checkFormatAttr({ kind: 'style' }, 'color: red; background: url(x)')).toBe('color: red')
    expect(checkFormatAttr({ kind: 'style' }, 'background: url(x)')).toBeNull()
    expect(checkFormatAttr({ kind: 'classes' }, 'a "b')).toBeNull()
    expect(checkFormatAttr({ kind: 'name' }, 'top')).toBe('top')
  })

  it('a named anchor is not cut out of itself as a link would be', () => {
    const v = normalize({ text: '￼a', formats: [{ type: 'anchor', start: 0, end: 1, attrs: { name: 'top' } }, { type: 'link', start: 0, end: 2, attrs: { href: '/x' } }] }, formats)
    expect(v.formats).toEqual([{ type: 'anchor', start: 0, end: 1, attrs: { name: 'top' } }, { type: 'link', start: 1, end: 2, attrs: { href: '/x' } }])
  })

  it('extend links and pictures with titles and classes', () => {
    expect(Object.keys(formats.get('link')!.attrs!)).toEqual(['href', 'target', 'title', 'class'])
    expect(formats.get('span')?.tag).toBe('span')
  })
})
