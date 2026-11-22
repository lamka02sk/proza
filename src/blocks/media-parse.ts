/**
 * Parse rules of the core media blocks: Proza's
 * own figures exactly, and pictures, players and frames as other editors and
 * word processors write them. Pictures stored in the text or out of reach
 * become pending uploads (`ctx.picture`); frames only become players for an
 * allowed provider, any other frame stays a link.
 */
import type { ParseContext, ParseRule } from '../import/rules'
import { embedFor, pageFor } from '../model/embeds'
import type { RichTextValue } from '../model/richtext'
import { RATIOS, decodeName } from './media'

const EMPTY: RichTextValue = { text: '', formats: [] }

const caption = (ctx: ParseContext, el: Element): RichTextValue => {
  const cap = el.querySelector(':scope > figcaption')
  return cap ? ctx.richText(cap) : EMPTY
}

const pixels = (el: Element, name: string): number => {
  const v = el.getAttribute(name)?.trim() ?? ''
  return /^\d{1,6}$/.test(v) ? Number(v) : 0
}

const cls = (el: Element, prefix: string): string | undefined => [...el.classList].find((c) => c.startsWith(prefix))?.slice(prefix.length)

/** Where a lazy-loading page keeps the real address, behind a placeholder in `src`. */
const LAZY = ['data-src', 'data-lazy-src', 'data-original']

/** The picture's address: `src`, unless it is empty or a tiny inline placeholder (a 1×1 GIF) and a lazy address exists. */
function pictureSource(img: Element): string | null {
  const src = img.getAttribute('src')
  if (src !== null && src.trim() !== '' && !(/^\s*data:/i.test(src) && src.length < 1024)) return src
  for (const name of LAZY) {
    const lazy = img.getAttribute(name)
    if (lazy !== null && lazy.trim() !== '') return lazy
  }
  return src
}

/** Attributes of a picture from its `<img>`, and the link around it. */
function picture(img: Element, ctx: ParseContext, extra: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const link = img.parentElement?.localName === 'a' ? img.parentElement : null
  const w = pixels(img, 'width'), h = pixels(img, 'height')
  return {
    src: ctx.picture(pictureSource(img)),
    alt: img.getAttribute('alt') ?? '',
    // Proza writes `alt=""` only for a decorative picture. Elsewhere it is as often an editor's default as a choice, so the author decides.
    decorative: ctx.source === 'proza' && img.getAttribute('alt') === '',
    // Both or neither: one dimension alone gives no shape.
    naturalWidth: w > 0 && h > 0 ? w : 0,
    naturalHeight: w > 0 && h > 0 ? h : 0,
    srcset: img.getAttribute('srcset') ?? '',
    href: link ? ctx.url(link.getAttribute('href')) : '',
    ...extra,
  }
}

const onlyChild = (el: Element, tag: string): Element | null => {
  const kids = [...el.childNodes].filter((n) => n.nodeType === 1 || (n.textContent ?? '').trim() !== '')
  return kids.length === 1 && kids[0]!.nodeType === 1 && (kids[0] as Element).localName === tag ? kids[0] as Element : null
}

/** The picture in a foreign figure: one `<img>`, perhaps in a link or a `<picture>`. */
function figureImage(el: Element): Element | null {
  const imgs = el.querySelectorAll('img')
  return imgs.length === 1 && !el.querySelector('video, audio, iframe') ? imgs[0]! : null
}

export const imageParse: readonly ParseRule[] = [
  {
    selector: 'figure.pz-image',
    priority: 100,
    parse: (el, ctx) => {
      const img = el.querySelector('img')
      if (!img) return null
      return { attrs: { ...ctx.supports(el), ...picture(img, ctx, { width: cls(el, 'pz-width-') ?? 'l', caption: caption(ctx, el) }) } }
    },
  },
  {
    selector: 'figure',
    priority: 60,
    parse: (el, ctx) => {
      const img = figureImage(el)
      if (!img) return null
      return { attrs: { ...ctx.supports(el), ...ctx.imageLayout(img), ...picture(img, ctx, { caption: caption(ctx, el) }) } }
    },
  },
  {
    // A linked picture standing on its own.
    selector: 'a',
    parse: (el, ctx) => {
      const img = onlyChild(el, 'img')
      return img ? { attrs: { ...ctx.supports(el), ...ctx.imageLayout(img), ...picture(img, ctx) } } : null
    },
  },
  { selector: 'img', parse: (el, ctx) => ({ attrs: { ...ctx.imageLayout(el), ...picture(el, ctx) } }) },
]

export const galleryParse: readonly ParseRule[] = [
  {
    selector: 'figure.pz-gallery',
    priority: 100,
    parse: (el, ctx) => {
      const grid = el.querySelector(':scope > .pz-gallery-grid')
      return { attrs: { ...ctx.supports(el), columns: Number(cls(el, 'pz-cols-') ?? 3), caption: caption(ctx, el) }, children: grid?.childNodes ?? [] }
    },
  },
  {
    // WordPress's gallery block, which TinyMCE content written in WordPress carries.
    selector: 'figure.wp-block-gallery',
    parse: (el, ctx) => {
      const n = Number(cls(el, 'columns-') ?? 3)
      return { attrs: { ...ctx.supports(el), columns: n >= 2 && n <= 4 ? n : 3, caption: caption(ctx, el) }, children: [...el.childNodes].filter((c) => (c as Element).localName !== 'figcaption') }
    },
  },
]

function captionsTrack(video: Element): { captions: string; captionsLang: string } {
  const track = video.querySelector('track[kind="captions"], track[kind="subtitles"]')
  return { captions: track?.getAttribute('src') ?? '', captionsLang: track?.getAttribute('srclang') ?? '' }
}

const mediaSrc = (el: Element): string | null => el.getAttribute('src') ?? el.querySelector('source[src]')?.getAttribute('src') ?? null

function transcript(el: Element, ctx: ParseContext): RichTextValue {
  const next = ctx.takeNext(el, 'details.pz-transcript')
  const p = next?.querySelector(':scope > p')
  return p ? ctx.richText(p) : EMPTY
}

export const videoParse: readonly ParseRule[] = [
  {
    selector: 'figure.pz-video',
    priority: 100,
    parse: (el, ctx) => {
      const v = el.querySelector('video')
      if (!v) return null
      return {
        attrs: {
          ...ctx.supports(el), src: ctx.url(mediaSrc(v)), poster: ctx.url(v.getAttribute('poster')), ...captionsTrack(v),
          naturalWidth: pixels(v, 'width'), naturalHeight: pixels(v, 'height'), caption: caption(ctx, el), transcript: transcript(el, ctx),
        },
      }
    },
  },
  {
    selector: 'figure',
    priority: 59,
    parse: (el, ctx) => {
      const v = el.querySelectorAll('video')
      if (v.length !== 1) return null
      return { attrs: { ...ctx.supports(el), ...videoAttrs(v[0]!, ctx), caption: caption(ctx, el) } }
    },
  },
  { selector: 'video', parse: (el, ctx) => ({ attrs: videoAttrs(el, ctx) }) },
]

function videoAttrs(v: Element, ctx: ParseContext): Record<string, unknown> {
  return { src: ctx.url(mediaSrc(v)), poster: ctx.url(v.getAttribute('poster')), ...captionsTrack(v), naturalWidth: pixels(v, 'width'), naturalHeight: pixels(v, 'height') }
}

export const audioParse: readonly ParseRule[] = [
  {
    selector: 'figure.pz-audio',
    priority: 100,
    parse: (el, ctx) => {
      const a = el.querySelector('audio')
      if (!a) return null
      return { attrs: { ...ctx.supports(el), src: ctx.url(mediaSrc(a)), caption: caption(ctx, el), transcript: transcript(el, ctx) } }
    },
  },
  {
    selector: 'figure',
    priority: 58,
    parse: (el, ctx) => {
      const a = el.querySelectorAll('audio')
      return a.length === 1 ? { attrs: { ...ctx.supports(el), src: ctx.url(mediaSrc(a[0]!)), caption: caption(ctx, el) } } : null
    },
  },
  { selector: 'audio', parse: (el, ctx) => ({ attrs: { src: ctx.url(mediaSrc(el)) } }) },
]

/** The ratio preset closest to a frame's width and height. */
function ratio(frame: Element): string {
  const w = pixels(frame, 'width'), h = pixels(frame, 'height')
  if (w === 0 || h === 0) return '16-9'
  const target = w / h
  const value = (r: string): number => { const [a, b] = r.split('-').map(Number) as [number, number]; return a / b }
  return [...RATIOS].sort((a, b) => Math.abs(value(a) - target) - Math.abs(value(b) - target))[0]!
}

function frameAttrs(frame: Element, ctx: ParseContext, exact: boolean): Record<string, unknown> | null {
  let src = frame.getAttribute('src')?.trim() ?? ''
  if (src.startsWith('//')) src = `https:${src}`
  const found = embedFor(src)
  const title = frame.getAttribute('title') ?? ''
  if (found) {
    return { url: pageFor(src) ?? '', title: exact && title === found.provider.name ? '' : title, ...(exact ? {} : { ratio: ratio(frame) }) }
  }
  // Not an allowed provider: never a frame. The address stays, as a link.
  if (!/^https?:\/\//i.test(src)) { ctx.report('element', 'iframe'); return null }
  ctx.report('embed', /^https?:\/\/([^/?#]+)/i.exec(src)?.[1] ?? src)
  return { url: ctx.url(src), title }
}

export const embedParse: readonly ParseRule[] = [
  {
    selector: 'figure.pz-embed',
    priority: 100,
    parse: (el, ctx) => {
      const frame = el.querySelector('iframe')
      const attrs = frame ? frameAttrs(frame, ctx, true) : null
      if (!attrs) return null
      const box = el.querySelector('.pz-embed-frame')
      return {
        attrs: {
          ...ctx.supports(el), ...attrs, ratio: (box && cls(box, 'pz-ratio-')) ?? '16-9',
          facade: el.querySelector(':scope > details.pz-embed-facade') !== null, caption: caption(ctx, el),
        },
      }
    },
  },
  {
    selector: 'p.pz-embed-link',
    priority: 100,
    parse: (el, ctx) => {
      const a = el.querySelector('a')
      if (!a) return null
      const url = ctx.url(a.getAttribute('href'))
      const text = a.textContent
      return { attrs: { ...ctx.supports(el), url, title: text === url ? '' : text } }
    },
  },
  {
    selector: 'figure',
    priority: 57,
    parse: (el, ctx) => {
      const frames = el.querySelectorAll('iframe')
      const attrs = frames.length === 1 ? frameAttrs(frames[0]!, ctx, false) : null
      return attrs ? { attrs: { ...ctx.supports(el), ...attrs, caption: caption(ctx, el) } } : null
    },
  },
  {
    selector: 'iframe',
    parse: (el, ctx) => {
      const attrs = frameAttrs(el, ctx, false)
      return attrs ? { attrs } : null
    },
  },
]

const UNITS: Readonly<Record<string, number>> = { B: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9 }

export const fileParse: readonly ParseRule[] = [
  {
    selector: 'p.pz-file',
    priority: 100,
    parse: (el, ctx) => {
      const a = el.querySelector('a')
      if (!a) return null
      const href = ctx.url(a.getAttribute('href'))
      const name = a.textContent
      // Only the end of the text, where the size is: the unanchored pattern would retry at every digit of a long run.
      const meta = /([\d.]+)\s*(B|kB|KB|MB|GB)\)?\s*$/.exec((el.querySelector('.pz-file-meta')?.textContent ?? '').slice(-64))
      return {
        attrs: {
          ...ctx.supports(el), href, name: name === decodeName(href) ? '' : name,
          bytes: meta ? Math.round(Number(meta[1]) * UNITS[meta[2]!]!) : 0,
        },
      }
    },
  },
]

export const mediaParse: Readonly<Record<string, readonly ParseRule[]>> = {
  'core/image': imageParse,
  'core/gallery': galleryParse,
  'core/video': videoParse,
  'core/audio': audioParse,
  'core/embed': embedParse,
  'core/file': fileParse,
}
