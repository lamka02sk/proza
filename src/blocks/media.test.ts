import { describe, expect, it } from 'vitest'
import { validateDoc } from '../model/schema'
import { RenderError, h } from '../render/html'
import { render } from '../render/render'
import { coreRegistry } from './core'
import { imageSizes } from './media'

const MEASURE = { column: 720, wide: 1200 }

const doc = (...blocks: unknown[]) => ({ version: 1, blocks })
const html = (...blocks: unknown[]): string => render(doc(...blocks), coreRegistry)
const text = (t: string) => ({ text: t, formats: [] })

describe('picture', () => {
  it('renders size, lazy loading, srcset with sizes from the width preset, link and caption', () => {
    expect(html({ id: 'a', type: 'core/image', attrs: {
      src: '/a.jpg', alt: 'Two stalls', naturalWidth: 1600, naturalHeight: 900, width: 'm', align: 'center',
      srcset: '/a-480.jpg 480w, /a.jpg 1600w', href: 'https://example.com', caption: text('Market'),
    } })).toBe('<figure class="pz-image pz-width-m pz-align-center"><a href="https://example.com"><img src="/a.jpg" alt="Two stalls" width="1600" height="900" srcset="/a-480.jpg 480w, /a.jpg 1600w" sizes="(max-width: 480px) 100vw, (max-width: 720px) 72vw, 518px" loading="lazy" decoding="async"></a><figcaption>Market</figcaption></figure>')
  })

  it('a picture without a description and not decorative has no alternative at all, not an empty one', () => {
    expect(html({ id: 'a', type: 'core/image', attrs: { src: '/a.jpg' } })).toBe('<figure class="pz-image pz-width-l"><img src="/a.jpg" loading="lazy" decoding="async"></figure>')
  })

  it('a decorative picture has an empty alternative, whatever its description says', () => {
    expect(html({ id: 'a', type: 'core/image', attrs: { src: '/a.jpg', alt: 'kept', decorative: true } })).toContain('alt=""')
  })

  it('a picture without a file renders nothing', () => {
    expect(html({ id: 'a', type: 'core/image', attrs: { alt: 'x' } })).toBe('')
  })

  it('validation drops a srcset with an unsafe address and keeps the picture', () => {
    const { doc: d, issues } = validateDoc(doc({ id: 'a', type: 'core/image', attrs: { src: '/a.jpg', srcset: 'javascript:alert(1) 480w' } }), coreRegistry)
    expect(d.blocks[0]!.attrs.srcset).toBe('')
    expect(issues.map((i) => i.path)).toEqual(['blocks[0].attrs.srcset'])
  })

  it('h() drops a srcset with an unsafe candidate', () => {
    expect(h('img', { src: '/a.jpg', alt: '', srcset: '/a.jpg 1x' }).html).toBe('<img src="/a.jpg" alt="">')
  })
})

describe('sizes from the column context', () => {
  it('leaves out stages that say what the next one says', () => {
    expect(imageSizes('l', { wide: 1, narrow: 1 }, MEASURE, '')).toBe('(max-width: 720px) 100vw, 720px')
    expect(imageSizes('s', { wide: 1, narrow: 1 }, MEASURE, '')).toBe('(max-width: 480px) 100vw, (max-width: 720px) 45vw, 324px')
  })

  it('a picture in one of two columns is half the column until the columns stack', () => {
    expect(imageSizes('l', { wide: 0.5, narrow: 1 }, MEASURE, '')).toBe('(max-width: 600px) 100vw, (max-width: 720px) 50vw, 360px')
  })

  it('wide and full pictures go past the column', () => {
    expect(imageSizes('l', { wide: 1, narrow: 1 }, MEASURE, 'wide')).toBe('(max-width: 1200px) 100vw, 1200px')
    expect(imageSizes('m', { wide: 1, narrow: 1 }, MEASURE, 'full')).toBe('100vw')
  })

  it('the host sets the measure', () => {
    const out = render(doc({ id: 'a', type: 'core/image', attrs: { src: '/a.jpg', srcset: '/a.jpg 900w' } }), coreRegistry, { measure: { column: 900 } })
    expect(out).toContain('sizes="(max-width: 900px) 100vw, 900px"')
  })
})

describe('gallery', () => {
  it('renders its columns and gives each picture sizes for its column', () => {
    const out = html({ id: 'g', type: 'core/gallery', attrs: { columns: 2, caption: text('Spring') }, children: [
      { id: 'a', type: 'core/image', attrs: { src: '/a.jpg', alt: 'A', srcset: '/a-1.jpg 400w', width: 's' } },
      { id: 'b', type: 'core/image', attrs: { src: '/b.jpg', alt: 'B' } },
    ] })
    expect(out).toBe('<figure class="pz-gallery pz-cols-2"><div class="pz-gallery-grid">'
      + `<figure class="pz-image"><img src="/a.jpg" alt="A" srcset="/a-1.jpg 400w" sizes="(max-width: 720px) 50vw, 360px" loading="lazy" decoding="async"></figure>`
      + '<figure class="pz-image"><img src="/b.jpg" alt="B" loading="lazy" decoding="async"></figure>'
      + '</div><figcaption>Spring</figcaption></figure>')
  })

  it('an empty gallery renders nothing; only pictures may be inside', () => {
    expect(html({ id: 'g', type: 'core/gallery', attrs: {}, children: [{ id: 'a', type: 'core/image', attrs: {} }] })).toBe('')
    const { issues } = validateDoc(doc({ id: 'g', type: 'core/gallery', attrs: {}, children: [{ id: 'p', type: 'core/paragraph', attrs: {} }] }), coreRegistry)
    expect(issues[0]!.message).toMatch(/not allowed inside core\/gallery/)
  })
})

describe('video and audio', () => {
  it('a video has controls, its captions track and a transcript after the figure', () => {
    expect(html({ id: 'v', type: 'core/video', attrs: { src: '/v.mp4', poster: '/p.jpg', captions: '/v.vtt', captionsLang: 'sk', transcript: text('Hello') } }))
      .toBe('<figure class="pz-video"><video src="/v.mp4" poster="/p.jpg" controls preload="metadata" playsinline><track kind="captions" src="/v.vtt" srclang="sk" label="Captions" default></video></figure>'
        + '<details class="pz-transcript"><summary>Transcript</summary><p>Hello</p></details>')
  })

  it('audio renders its player and caption; labels come in the content language', () => {
    expect(render(doc({ id: 'a', type: 'core/audio', attrs: { src: '/a.mp3', caption: text('Episode 1'), transcript: text('Hi') } }), coreRegistry, { labels: { transcript: 'Prepis' } }))
      .toBe('<figure class="pz-audio"><audio src="/a.mp3" controls preload="metadata"></audio><figcaption>Episode 1</figcaption></figure><details class="pz-transcript"><summary>Prepis</summary><p>Hi</p></details>')
  })
})

describe('embed', () => {
  it('a YouTube address becomes a sandboxed privacy-enhanced player in a ratio box', () => {
    expect(html({ id: 'e', type: 'core/embed', attrs: { url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Song', ratio: '4-3' } }))
      .toBe('<figure class="pz-embed"><div class="pz-embed-frame pz-ratio-4-3"><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" title="Song" loading="lazy" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox" allow="fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div></figure>')
  })

  it('the facade loads the player only when opened', () => {
    const out = html({ id: 'e', type: 'core/embed', attrs: { url: 'https://vimeo.com/76979871', facade: true } })
    expect(out).toMatch(/^<figure class="pz-embed"><details class="pz-embed-facade"><summary>Play “Vimeo” from Vimeo<\/summary><div class="pz-embed-frame pz-ratio-16-9"><iframe src="https:\/\/player\.vimeo\.com\/video\/76979871\?dnt=1"/)
  })

  it('an address of no allowed provider stays a link, never a frame', () => {
    expect(html({ id: 'e', type: 'core/embed', attrs: { url: 'https://evil.example/frame', title: 'X' } })).toBe('<p class="pz-embed-link"><a href="https://evil.example/frame">X</a></p>')
  })

  it('h() refuses an iframe that is not a provider player', () => {
    expect(() => h('iframe', { src: 'https://evil.example/' })).toThrow(RenderError)
    expect(() => h('iframe', {})).toThrow(RenderError)
  })
})

describe('file', () => {
  it('links the file for download with its type and size', () => {
    expect(html({ id: 'f', type: 'core/file', attrs: { href: '/files/Annual%20report.pdf', bytes: 1_234_567 } }))
      .toBe('<p class="pz-file"><a href="/files/Annual%20report.pdf" download>Annual report.pdf</a> <span class="pz-file-meta">(PDF, 1.2 MB)</span></p>')
  })
})

describe('supports', () => {
  it('size and colour render as preset classes; unknown colour names are invalid', () => {
    expect(html({ id: 'p', type: 'core/paragraph', attrs: { content: text('x'), size: 'l', color: 'blue' } })).toBe('<p class="pz-size-l pz-color-blue">x</p>')
    const { doc: d } = validateDoc(doc({ id: 'p', type: 'core/paragraph', attrs: { content: text('x'), color: 'red; x:y' } }), coreRegistry)
    expect(d.blocks[0]!.attrs.color).toBe('')
  })
})
