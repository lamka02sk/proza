/**
 * Utility blocks: page break, table of contents with
 * generated anchors, raw HTML only through the host's sanitiser, and code
 * highlighting at render time.
 */
import { describe, expect, it } from 'vitest'
import { tokenize } from '../render/highlight'
import { type RenderOptions, render } from '../render/render'
import { coreRegistry } from './core'

const rich = (text: string) => ({ text, formats: [] })
const html = (blocks: unknown[], options: RenderOptions = {}): string => render({ version: 1, blocks }, coreRegistry, options)
const h = (level: number, text: string, anchor = '') => ({ type: 'core/heading', attrs: { level, content: rich(text), anchor } })

describe('page break', () => {
  it('is an empty element that print styles break after', () => {
    expect(html([{ type: 'core/page-break', attrs: {} }])).toBe('<div class="pz-page-break" aria-hidden="true"></div>')
  })
})

describe('table of contents', () => {
  it('lists headings down to its depth as nested links; headings get anchors from their text, unique and stable', () => {
    const out = html([
      { type: 'core/toc', attrs: { depth: 3 } },
      h(2, 'Čo je nové?'), h(3, 'Details', 'own'), h(4, 'Too deep'), h(2, 'Čo je nové?'), h(2, '2026'),
    ])
    expect(out).toBe([
      '<nav class="pz-toc" aria-label="Contents" data-pz-depth="3"><ol>'
        + '<li><a href="#co-je-nove">Čo je nové?</a><ol><li><a href="#own">Details</a></li></ol></li>'
        + '<li><a href="#co-je-nove-2">Čo je nové?</a></li><li><a href="#h-2026">2026</a></li></ol></nav>',
      '<h2 id="co-je-nove">Čo je nové?</h2>',
      '<h3 id="own">Details</h3>',
      '<h4 id="too-deep">Too deep</h4>',
      '<h2 id="co-je-nove-2">Čo je nové?</h2>',
      '<h2 id="h-2026">2026</h2>',
    ].join('\n'))
  })

  it('without one, headings get no generated ids; with no headings it renders nothing', () => {
    expect(html([h(2, 'Plain')])).toBe('<h2>Plain</h2>')
    expect(html([{ type: 'core/toc', attrs: {} }])).toBe('')
  })

  it('never reuses an anchor another part already has', () => {
    expect(html([{ type: 'core/toc', attrs: {} }, { type: 'core/paragraph', attrs: { content: rich('x'), anchor: 'intro' } }, h(2, 'Intro')]))
      .toContain('<h2 id="intro-2">Intro</h2>')
  })
})

describe('raw HTML', () => {
  const block = { type: 'core/html', attrs: { html: '<b onclick="x()">Hi</b><script>evil()</script>' } }
  it('renders nothing without the host sanitiser', () => {
    expect(html([block])).toBe('')
  })
  it('renders what the host sanitiser returns', () => {
    expect(html([block], { rawHtml: (s) => s.replace(/<script[\s\S]*?<\/script>/g, '').replace(/ on\w+="[^"]*"/g, '') })).toBe('<div class="pz-html"><b>Hi</b></div>')
    expect(html([block], { rawHtml: () => null })).toBe('')
  })
})

describe('code highlighting at render time', () => {
  const code = { type: 'core/code', attrs: { language: 'js', content: rich('const a = "<b>" // x') } }
  it('wraps tokens in pz-tok spans, text still escaped', () => {
    expect(html([code], { highlight: tokenize })).toBe(
      '<pre class="pz-code"><code class="language-js"><span class="pz-tok-keyword">const</span> a = <span class="pz-tok-string">"&lt;b&gt;"</span> <span class="pz-tok-comment">// x</span></code></pre>')
  })
  it('is plain code without a highlighter', () => {
    expect(html([code])).toBe('<pre class="pz-code"><code class="language-js">const a = "&lt;b&gt;" // x</code></pre>')
  })
})
