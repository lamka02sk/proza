/**
 * Core media blocks: picture, gallery, video,
 * audio, embed and file. Schema and rendering only: server-safe, no DOM, no
 * Vue. Their editing joins them in `media-edit.ts`.
 *
 * Output: width and height on pictures (no layout shift), `srcset` with
 * `sizes` from the width preset, lazy loading; embeds only from the provider
 * allow-list, sandboxed, in an aspect-ratio box (classes, no inline styles).
 */
import { embedFor } from '../model/embeds'
import { LANG_PATTERN } from '../model/richtext'
import { EMPTY_HTML, type Html, cx, fragment, h } from '../render/html'
import { EMBED_FRAME } from '../render/sanitize'
import type { Measure, RenderContext, Share } from '../render/render'
import type { RichTextValue } from '../model/richtext'
import { defineSchema } from './define'

export const IMAGE = 'core/image'
export const GALLERY = 'core/gallery'
export const VIDEO = 'core/video'
export const AUDIO = 'core/audio'
export const EMBED = 'core/embed'
export const FILE = 'core/file'

const PIXELS = { type: 'number', integer: true, min: 0, max: 100_000 } as const

/**
 * `sizes` for a picture: its width preset times its share
 * of the text column, at the widths where the layout changes. Under 480 px a
 * small or medium picture takes the column; under 600 px columns stack; up to
 * the measure the column is the viewport; above it, a fixed width.
 */
export function imageSizes(width: string, share: Share, measure: Measure, bleed: string): string {
  if (bleed === 'full') return '100vw'
  if (bleed === 'wide') return `(max-width: ${measure.wide}px) 100vw, ${measure.wide}px`
  const w = width === 's' ? 0.45 : width === 'm' ? 0.72 : 1
  const vw = (n: number): string => `${Math.round(n * 100)}vw`
  const stages: [number, string][] = [[480, vw(share.narrow)], [600, vw(share.narrow * w)], [measure.column, vw(share.wide * w)]]
  const out: string[] = []
  stages.forEach(([at, size], i) => {
    // A stage that says what the next one says is left out.
    if (stages[i + 1]?.[1] === size) return
    if (at <= (stages[i - 1]?.[0] ?? 0)) return
    out.push(`(max-width: ${at}px) ${size}`)
  })
  out.push(`${Math.round(share.wide * w * measure.column)}px`)
  return out.join(', ')
}

/** An attribute a support adds, which the schema's own attribute types do not list. */
const supportAttr = (attrs: object, key: string): string => {
  const v = (attrs as Readonly<Record<string, unknown>>)[key]
  return typeof v === 'string' ? v : ''
}

const caption = (ctx: RenderContext, value: RichTextValue): Html | null => (value.text === '' ? null : h('figcaption', null, ctx.richText(value)))

/** A transcript after the player: closed by default, one click away (WCAG 1.2.1, 1.2.3). */
const transcript = (ctx: RenderContext, value: RichTextValue): Html | null => (value.text === ''
  ? null
  : h('details', { class: 'pz-transcript' }, h('summary', null, ctx.labels.transcript), h('p', null, ctx.richText(value))))

export const image = defineSchema({
  name: IMAGE,
  attrs: {
    src: { type: 'url' },
    /** The text alternative. Never taken from the file name (ATAG B.2.3). */
    alt: { type: 'string', maxLength: 1000 },
    /** Chosen by the author: the picture adds nothing a reader needs, so it gets an empty alternative. */
    decorative: { type: 'boolean' },
    /** Share of the column: small, medium, large (the whole column). */
    width: { type: 'enum', values: ['l', 'm', 's'] },
    naturalWidth: PIXELS,
    naturalHeight: PIXELS,
    srcset: { type: 'srcset' },
    href: { type: 'url' },
    caption: { type: 'richtext' },
  },
  supports: { anchor: true, align: true, bleed: true },
  render: (b, ctx) => {
    const a = b.attrs
    if (a.src === '') return EMPTY_HTML
    const inGallery = ctx.parent?.type === GALLERY
    const img = h('img', {
      src: a.src,
      // `alt=""` says "decorative" (HTML standard). A picture still waiting for its description has no `alt`,
      // so the page does not claim it is decorative, and a validator or the checker can find it.
      alt: a.decorative ? '' : a.alt === '' ? null : a.alt,
      width: a.naturalWidth > 0 ? a.naturalWidth : null,
      height: a.naturalHeight > 0 ? a.naturalHeight : null,
      srcset: a.srcset === '' ? null : a.srcset,
      sizes: a.srcset === '' ? null : imageSizes(inGallery ? 'l' : a.width, ctx.share, ctx.measure, ctx.parent === null ? supportAttr(b.attrs, 'bleed') : ''),
      loading: 'lazy',
      decoding: 'async',
    })
    return h('figure', ctx.wrapper({ class: cx('pz-image', !inGallery && `pz-width-${a.width}`) }),
      a.href === '' ? img : h('a', { href: a.href }, img),
      caption(ctx, a.caption))
  },
})

export const gallery = defineSchema({
  name: GALLERY,
  attrs: {
    columns: { type: 'enum', values: [3, 2, 4] },
    caption: { type: 'richtext' },
  },
  children: { allowed: [IMAGE] },
  supports: { anchor: true, bleed: true },
  // Two columns at most on a phone (content.css).
  childShare: (b) => ({ wide: 1 / b.attrs.columns, narrow: 1 / Math.min(2, b.attrs.columns) }),
  render: (b, ctx) => {
    const shown = (b.children ?? []).some((c) => typeof c.attrs.src === 'string' && c.attrs.src !== '')
    if (!shown) return EMPTY_HTML
    return h('figure', ctx.wrapper({ class: `pz-gallery pz-cols-${b.attrs.columns}` }),
      h('div', { class: 'pz-gallery-grid' }, ctx.children()),
      caption(ctx, b.attrs.caption))
  },
})

export const video = defineSchema({
  name: VIDEO,
  attrs: {
    src: { type: 'url' },
    poster: { type: 'url' },
    /** A WebVTT file of captions (WCAG 1.2.2). */
    captions: { type: 'url' },
    captionsLang: { type: 'string', pattern: LANG_PATTERN, maxLength: 35 },
    naturalWidth: PIXELS,
    naturalHeight: PIXELS,
    caption: { type: 'richtext' },
    transcript: { type: 'richtext' },
  },
  supports: { anchor: true },
  render: (b, ctx) => {
    const a = b.attrs
    if (a.src === '') return EMPTY_HTML
    const track = a.captions === '' ? null : h('track', { kind: 'captions', src: a.captions, srclang: a.captionsLang === '' ? null : a.captionsLang, label: ctx.labels.captions, default: true })
    return fragment(
      h('figure', ctx.wrapper({ class: 'pz-video' }),
        h('video', {
          src: a.src, poster: a.poster === '' ? null : a.poster, controls: true, preload: 'metadata', playsinline: true,
          width: a.naturalWidth > 0 ? a.naturalWidth : null, height: a.naturalHeight > 0 ? a.naturalHeight : null,
        }, track),
        caption(ctx, a.caption)),
      transcript(ctx, a.transcript))
  },
})

export const audio = defineSchema({
  name: AUDIO,
  attrs: {
    src: { type: 'url' },
    caption: { type: 'richtext' },
    transcript: { type: 'richtext' },
  },
  supports: { anchor: true },
  render: (b, ctx) => {
    const a = b.attrs
    if (a.src === '') return EMPTY_HTML
    return fragment(
      h('figure', ctx.wrapper({ class: 'pz-audio' }), h('audio', { src: a.src, controls: true, preload: 'metadata' }), caption(ctx, a.caption)),
      transcript(ctx, a.transcript))
  },
})

export const RATIOS = ['16-9', '4-3', '1-1', '9-16'] as const

export const embed = defineSchema({
  name: EMBED,
  attrs: {
    /** The page address the author pasted (a YouTube watch page), not the player's. */
    url: { type: 'url' },
    /** Accessible name of the frame (WCAG 4.1.2): what it shows. */
    title: { type: 'string', maxLength: 300 },
    ratio: { type: 'enum', values: RATIOS },
    /** Load the provider only when the visitor opens it, so nothing reaches the provider before (privacy). */
    facade: { type: 'boolean' },
    caption: { type: 'richtext' },
  },
  supports: { anchor: true },
  render: (b, ctx) => {
    const a = b.attrs
    if (a.url === '') return EMPTY_HTML
    const found = embedFor(a.url)
    // Not from an allowed provider (or no longer): a plain link, never an arbitrary frame.
    if (!found) return h('p', ctx.wrapper({ class: 'pz-embed-link' }), h('a', { href: a.url }, a.title === '' ? a.url : a.title))
    const name = a.title === '' ? found.provider.name : a.title
    const frame = h('div', { class: `pz-embed-frame pz-ratio-${a.ratio}` }, h('iframe', {
      src: found.player,
      title: name,
      loading: 'lazy',
      sandbox: EMBED_FRAME.sandbox,
      allow: EMBED_FRAME.allow,
      allowfullscreen: true,
      referrerpolicy: EMBED_FRAME.referrerpolicy,
    }))
    // shortcut: the facade relies on engines not loading a lazy frame inside closed <details>; a scripted facade needs a host script.
    const body = a.facade ? h('details', { class: 'pz-embed-facade' }, h('summary', null, ctx.labels.loadEmbed(found.provider.name, name)), frame) : frame
    return h('figure', ctx.wrapper({ class: 'pz-embed' }), body, caption(ctx, a.caption))
  },
})

/** "PDF" from `report.pdf`, or "" when the name has no extension. */
export function fileType(name: string): string {
  // The query and fragment cut off first: a pattern spanning them backtracked over long addresses.
  const end = name.search(/[?#]/)
  const m = /\.([a-z0-9]{1,8})$/i.exec(end < 0 ? name : name.slice(0, end))
  return m ? m[1]!.toUpperCase() : ''
}

export const file = defineSchema({
  name: FILE,
  attrs: {
    href: { type: 'url' },
    /** What the link says; the file name by default. */
    name: { type: 'string', maxLength: 300 },
    bytes: { type: 'number', integer: true, min: 0 },
  },
  supports: { anchor: true },
  render: (b, ctx) => {
    const a = b.attrs
    if (a.href === '') return EMPTY_HTML
    const name = a.name === '' ? decodeName(a.href) : a.name
    const meta = ctx.labels.fileMeta(fileType(name) || fileType(a.href), a.bytes)
    return h('p', ctx.wrapper({ class: 'pz-file' }),
      h('a', { href: a.href, download: true }, name),
      meta === '' ? null : [' ', h('span', { class: 'pz-file-meta' }, `(${meta})`)])
  },
})

/** The last path segment of an address, for a file without a name. */
export function decodeName(href: string): string {
  const last = href.split(/[?#]/)[0]!.split('/').filter(Boolean).at(-1) ?? href
  try { return decodeURIComponent(last) } catch { return last }
}

export const mediaBlocks = [image, gallery, video, audio, embed, file] as const
