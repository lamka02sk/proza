import { describe, expect, it } from 'vitest'
import { coreRegistry } from '../../src/blocks/core'
import { legacyFormats } from '../../src/model/richtext'
import type { LegacyPolicy } from '../../src/model/legacy'
import { h, withOutput } from '../../src/render/html'
import { render } from '../../src/render/render'
import { sanitizeElement, sanitizerPolicy } from '../../src/render/sanitize'

const formats = legacyFormats()
const policy: LegacyPolicy = { frames: ['maps.example.org'], palette: [{ name: 'blue', color: '#1D4ED8' }] }
const rich = (text: string, f: unknown[] = []) => ({ text, formats: f })
const doc = (...blocks: unknown[]) => ({ version: 1, blocks })
const out = (d: unknown, p: LegacyPolicy | true = policy) => render(d, coreRegistry, { formats, legacy: p })

describe('legacy output', () => {
  it('writes supports as inline styles, not classes', () => {
    const d = doc({ type: 'core/paragraph', attrs: { content: rich('A'), textAlign: 'end', size: 'l', color: 'blue' } })
    expect(out(d)).toBe('<p style="text-align: right; font-size: 1.176em; line-height: 1.45; color: #1D4ED8">A</p>')
    expect(render(d, coreRegistry, { formats })).toBe('<p class="pz-text-end pz-size-l pz-color-blue">A</p>')
  })

  it('end is left in right-to-left text', () => {
    expect(out(doc({ type: 'core/paragraph', attrs: { content: rich('A'), textAlign: 'end', dir: 'rtl' } }))).toBe('<p dir="rtl" style="text-align: left">A</p>')
  })

  it('keeps a colour without a palette value as a class for the host', () => {
    expect(out(doc({ type: 'core/paragraph', attrs: { content: rich('A'), color: 'green' } }))).toBe('<p class="pz-color-green">A</p>')
  })

  it('writes the part\'s own style and classes through the policy', () => {
    const d = doc({ type: 'core/paragraph', attrs: { content: rich('A'), htmlStyle: 'color: red; position: fixed', htmlClass: 'lead pz-text-center' } })
    expect(out(d)).toBe('<p class="lead" style="color: red">A</p>')
    expect(render(d, coreRegistry, { formats })).toBe('<p>A</p>')
  })

  it('writes spans, anchors, icons and link titles', () => {
    const d = doc({ type: 'core/paragraph', attrs: { content: rich('￼￼ Red link', [
      { type: 'anchor', start: 0, end: 1, attrs: { name: 'top' } },
      { type: 'icon', start: 1, end: 2, attrs: { class: 'fa fa-file' } },
      { type: 'span', start: 3, end: 6, attrs: { style: 'color: #a3001b', class: 'note' } },
      { type: 'link', start: 7, end: 11, attrs: { href: '/x', title: 'Go', class: 'btn' } },
    ]) } })
    expect(out(d)).toBe('<p><a name="top"></a><i class="fa fa-file"></i> <span class="note" style="color: #a3001b">Red</span> <a class="btn" href="/x" title="Go">link</a></p>')
    // Without the policy the same formats render without what only legacy output may contain.
    expect(render(d, coreRegistry, { formats })).toBe('<p><a></a><span data-pz-format="icon"></span> <span class="note">Red</span> <a class="btn" href="/x" title="Go">link</a></p>')
  })

  it('palette presets of text become colours', () => {
    const d = doc({ type: 'core/paragraph', attrs: { content: rich('Blue', [{ type: 'color', start: 0, end: 4, attrs: { color: 'blue' } }]) } })
    expect(out(d)).toBe('<p><span style="color: #1D4ED8">Blue</span></p>')
  })

  it('a table is the source\'s table', () => {
    const cell = { type: 'core/table-cell', attrs: { htmlStyle: 'width: 30%', textAlign: 'end' }, children: [{ type: 'core/paragraph', attrs: { content: rich('A') } }] }
    const d = doc({ type: 'core/table', attrs: { border: '1', cellPadding: '4', colWidths: '30% auto', htmlStyle: 'width: 100%' }, children: [{ type: 'core/table-row', attrs: {}, children: [cell] }] })
    expect(out(d)).toBe('<table border="1" cellpadding="4" style="width: 100%"><colgroup><col style="width: 30%"><col></colgroup><tbody><tr><td style="text-align: right; width: 30%">A</td></tr></tbody></table>')
    expect(render(d, coreRegistry, { formats })).toContain('<div class="pz-table"')
  })

  it('a group with the host\'s class is the host\'s box, its bare text without a paragraph', () => {
    const d = doc({ type: 'core/group', attrs: { tag: 'div', bare: true, htmlClass: 'slot', htmlStyle: 'padding: 10px' }, children: [{ type: 'core/paragraph', attrs: { content: rich('[W=1]') } }] })
    expect(out(d)).toBe('<div class="slot" style="padding: 10px">[W=1]</div>')
    expect(render(d, coreRegistry, { formats })).toBe('<div class="pz-group"><p>[W=1]</p></div>')
  })

  it('frames of listed sites keep the host\'s sandbox; others are links', () => {
    const d = doc({ type: 'core/frame', attrs: { src: 'https://maps.example.org/e', title: 'Map', width: '100%', height: '450' } }, { type: 'core/frame', attrs: { src: 'https://other.example/e', title: 'Other' } })
    expect(out(d)).toBe('<iframe src="https://maps.example.org/e" title="Map" width="100%" height="450" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"></iframe>\n<p><a href="https://other.example/e">Other</a></p>')
    expect(render(d, coreRegistry, { formats })).toBe('<p><a href="https://maps.example.org/e">Map</a></p>\n<p><a href="https://other.example/e">Other</a></p>')
  })

  it('drops Proza\'s classes that plain HTML reads back without', () => {
    const d = doc({ type: 'core/quote', attrs: { citation: rich('Me') }, children: [{ type: 'core/paragraph', attrs: { content: rich('Q') } }] },
      { type: 'core/image', attrs: { src: '/a.jpg', alt: 'A', width: 'm', imgStyle: 'float: left', htmlClass: 'image' } })
    const html = out(d)
    expect(html).not.toMatch(/pz-/)
    expect(html).toContain('<figure class="image"><img src="/a.jpg" alt="A" loading="lazy" decoding="async" style="float: left"></figure>')
  })

  it('h() refuses legacy markup outside a legacy render', () => {
    expect(() => h('p', { style: 'color: red' })).toThrow()
    expect(() => h('iframe', { src: 'https://maps.example.org/' })).toThrow()
    expect(withOutput({ style: (s) => s, dropClass: () => false, frame: () => null }, () => h('iframe', { src: 'https://maps.example.org/', sandbox: 'allow-scripts' }).html)).toBe('<iframe src="https://maps.example.org/"></iframe>')
  })
})

describe('legacy sanitiser', () => {
  it('keeps what the policy keeps and nothing else', () => {
    expect(sanitizeElement('p', { style: 'color: red; background: url(x)', class: 'lead pz-text-center' })).toEqual({ class: 'lead pz-text-center' })
    expect(sanitizeElement('p', { style: 'color: red; background: url(x)', class: 'lead pz-text-center' }, { legacy: { classes: ['other'] } })).toEqual({ style: 'color: red', class: 'pz-text-center' })
    expect(sanitizeElement('iframe', { src: 'https://maps.example.org/', frameborder: '0' }, { legacy: { frames: [{ host: 'maps.example.org', sandbox: false }] } })).toEqual({ src: 'https://maps.example.org/', frameborder: '0' })
    expect(sanitizeElement('iframe', { src: 'https://maps.example.org/' })).toBeNull()
    expect(sanitizeElement('colgroup', {}, { legacy: true })).toEqual({})
  })

  it('carries the legacy rules as data', () => {
    const p = sanitizerPolicy({ legacy: policy })
    expect(p.legacy?.frames).toEqual([{ host: 'maps.example.org', sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation' }])
    expect(p.legacy?.style.properties).toContain('text-align')
    expect(new RegExp(p.legacy!.style.forbiddenValue, 'i').test('url(x)')).toBe(true)
    expect(sanitizerPolicy().legacy).toBeUndefined()
  })
})
