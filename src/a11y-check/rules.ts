/**
 * Rules that hold for every block type: links,
 * text and the shared attributes. Rules of one type (a picture's description,
 * a table's headers) live on its definition (`BlockDefinition.a11y`).
 */
import type { Operation } from '../model/operations'
import { type FormatRange, type RichTextValue, OBJECT_CHAR, applyFormat, removeFormat } from '../model/richtext'
import type { BlockNode } from '../model/tree'
import { type CheckContext, type DocumentRule, type Finding, richTextAttrs } from './check'

// ---------------------------------------------------------------------------
// Helpers block rules share

/** What a link says: its text, and the descriptions of pictures inside it. */
export function linkName(value: RichTextValue, start: number, end: number): string {
  const alts = value.formats.filter((f) => f.type === 'image' && f.start >= start && f.end <= end).map((f) => f.attrs?.alt ?? '')
  return [value.text.slice(start, end).replaceAll(OBJECT_CHAR, ''), ...alts].join(' ').replace(/\s+/g, ' ').trim()
}

const FILE_NAME = /^[^\s/\\]+\.(?:jpe?g|png|gif|webp|avif|svg|bmp|tiff?|heic|ico)$|^(?:img|dsc|dscn|dcim|pxl|screenshot|image|photo|scan)[-_ ]?\d[\w-]*$/i

/** A description that is a file name ("IMG_2041.jpg", "DSC0042"), which says nothing about the picture. */
export function looksLikeFileName(alt: string, src = ''): boolean {
  const text = alt.trim()
  if (text === '') return false
  if (FILE_NAME.test(text)) return true
  const file = decodeURIComponentSafe(src.split(/[?#]/)[0]!.split('/').at(-1) ?? '')
  return file !== '' && (text === file || text === file.replace(/\.[a-z0-9]{1,5}$/i, ''))
}

function decodeURIComponentSafe(s: string): string {
  try { return decodeURIComponent(s) } catch { return s }
}

// Link text that does not say where it goes (WCAG 2.4.4), in the languages Proza ships and their neighbours.
const VAGUE = new Set([
  'click', 'click here', 'here', 'this', 'this link', 'link', 'more', 'read more', 'learn more', 'see more', 'more info', 'more information', 'details', 'continue', 'go', 'info',
  'tu', 'sem', 'tuto', 'kliknite', 'kliknite sem', 'kliknite tu', 'klikni sem', 'klikni tu', 'viac', 'čítať viac', 'čítajte viac', 'čítať ďalej', 'viac informácií', 'odkaz', 'tento odkaz', 'pokračovať', 'ďalej', 'podrobnosti',
  'zde', 'klikněte zde', 'klikni zde', 'více', 'číst dále', 'hier', 'klicken sie hier', 'mehr', 'weiterlesen',
])

/** Link text such as "click here" or "read more". */
export function isVague(text: string): boolean {
  return VAGUE.has(text.toLocaleLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim())
}

/** Link text that is an address. */
export function isAddress(text: string): boolean {
  return /^(?:https?:\/\/|www\.)\S+$/i.test(text.trim())
}

const NEW_WINDOW = /new (?:window|tab)|nov[éoá]\w* (?:okn|kart)|neue[sm]? (?:fenster|tab)|nov[éá]\w* (?:okn|panel)/i

/** The link text tells the reader it opens a new window (WCAG 3.2.5, G201). */
export function declaresNewWindow(text: string): boolean {
  return NEW_WINDOW.test(text)
}

// ---------------------------------------------------------------------------
// Text rules: every rich-text attribute of every block

/** Capitals over at least four words and twenty letters: hard to read, and some screen readers spell them. */
const CAPS = /\p{Lu}[\p{Lu}\p{N}'’-]*(?:[^\p{L}\n]+\p{Lu}[\p{Lu}\p{N}'’-]*)+/gu

function capsRuns(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  if (!/\p{Lu}[^\p{Ll}]*\p{Lu}[^\p{Ll}]*\p{Lu}/u.test(text)) return out
  for (const m of text.matchAll(CAPS)) {
    const words = m[0].split(/[^\p{L}\p{N}]+/u).filter((w) => /\p{L}/u.test(w))
    const letters = m[0].replace(/[^\p{L}]/gu, '').length
    if (words.length >= 4 && letters >= 20) out.push({ start: m.index, end: m.index + m[0].length })
  }
  return out
}

/** Scripts by the primary language subtag; anything else is written in Latin letters. */
const SCRIPTS: Readonly<Record<string, readonly string[]>> = {
  ru: ['Cyrillic'], uk: ['Cyrillic'], be: ['Cyrillic'], bg: ['Cyrillic'], mk: ['Cyrillic'], kk: ['Cyrillic'], ky: ['Cyrillic'], mn: ['Cyrillic'], tg: ['Cyrillic'],
  sr: ['Cyrillic', 'Latin'], el: ['Greek'], ar: ['Arabic'], fa: ['Arabic'], ur: ['Arabic'], ps: ['Arabic'], he: ['Hebrew'], yi: ['Hebrew'],
  zh: ['Han'], ja: ['Han', 'Hiragana', 'Katakana'], ko: ['Hangul', 'Han'], hi: ['Devanagari'], mr: ['Devanagari'], ne: ['Devanagari'], th: ['Thai'], ka: ['Georgian'], hy: ['Armenian'],
}
const DETECTED = ['Latin', 'Cyrillic', 'Greek', 'Arabic', 'Hebrew', 'Han', 'Hiragana', 'Katakana', 'Hangul', 'Devanagari', 'Thai', 'Georgian', 'Armenian']
const runPattern = new Map(DETECTED.map((s) => [s, new RegExp(`\\p{Script=${s}}+(?:[\\s\\p{P}\\p{N}]+\\p{Script=${s}}+)*`, 'gu')]))
const IDEOGRAPHIC = new Set(['Han', 'Hiragana', 'Katakana', 'Hangul'])
const otherLetter = new Map<readonly string[], RegExp>()
/** Latin letters with their accents, punctuation, digits, spaces and the object character: nothing to look at. */
const LATIN_ONLY = /^[\t\n\u0020-\u024F\u1E00-\u1EFF\u2000-\u206F\u20AC\uFFFC]*$/

function scriptsOf(lang: string): readonly string[] {
  return SCRIPTS[lang.split('-')[0]!.toLowerCase()] ?? ['Latin']
}

/** Passages in a script the language around them is not written in, and not marked with a language (WCAG 3.1.2). */
function foreignRuns(value: RichTextValue, lang: string): { start: number; end: number; script: string }[] {
  const expected = scriptsOf(lang)
  // Latin text, the usual case, is decided without Unicode properties: they cost most of a check of a long text.
  if (expected.includes('Latin') && LATIN_ONLY.test(value.text)) return []
  // Most text has no letter outside its own script: one pass decides, the scans per script run only when it has.
  let other = otherLetter.get(expected)
  if (!other) { other = new RegExp(`(?=\\p{L})[^${expected.map((x) => `\\p{Script=${x}}`).join('')}]`, 'u'); otherLetter.set(expected, other) }
  if (!other.test(value.text)) return []
  const marked = value.formats.filter((f) => f.type === 'lang' || f.type === 'code' || f.type === 'kbd')
  const out: { start: number; end: number; script: string }[] = []
  for (const script of DETECTED) {
    if (expected.includes(script)) continue
    for (const m of value.text.matchAll(runPattern.get(script)!)) {
      const start = m.index, end = start + m[0].length
      if (marked.some((f) => f.start <= start && f.end >= end)) continue
      const letters = m[0].replace(/[^\p{L}]/gu, '').length
      const words = m[0].split(/\s+/).length
      // Latin words in another script are often names and products; a passage is three words or more.
      const long = IDEOGRAPHIC.has(script) ? letters >= 2 : script === 'Latin' ? words >= 3 : letters >= 3
      if (long) out.push({ start, end, script })
    }
  }
  return out
}

function textFindings(node: BlockNode, attr: string, value: RichTextValue, ctx: CheckContext): Finding[] {
  const out: Finding[] = []
  const set = (v: RichTextValue): readonly Operation[] => [{ type: 'setAttrs', id: node.id, patch: { [attr]: v } }]
  const at = (f: Pick<FormatRange, 'start' | 'end'>): Pick<Finding, 'blockId' | 'attr' | 'start' | 'end'> => ({ blockId: node.id, attr, start: f.start, end: f.end })
  const links = value.formats.filter((f) => f.type === 'link')
  for (const link of links) {
    const name = linkName(value, link.start, link.end)
    const without = (): readonly Operation[] => set(removeFormat(value, link.start, link.end, 'link', ctx.formats))
    if (name === '') { out.push({ rule: 'link-empty', group: 'links', severity: 'error', ...at(link), fix: without }); continue }
    if (isAddress(name)) out.push({ rule: 'link-url', group: 'links', severity: 'warning', ...at(link), params: { text: name } })
    else if (isVague(name)) out.push({ rule: 'link-vague', group: 'links', severity: 'warning', ...at(link), params: { text: name } })
    if (link.attrs?.target === '_blank' && !declaresNewWindow(name)) {
      const href = link.attrs.href ?? ''
      out.push({
        rule: 'link-new-window', group: 'links', severity: 'warning', ...at(link), params: { text: name },
        fix: () => set(applyFormat(removeFormat(value, link.start, link.end, 'link', ctx.formats), link.start, link.end, { type: 'link', attrs: { href } }, ctx.formats)),
      })
    }
  }
  for (const u of value.formats.filter((f) => f.type === 'underline')) {
    // Underlined words read as a link that does nothing (WCAG 1.4.1 and the conventions readers rely on).
    if (links.some((l) => l.start <= u.start && l.end >= u.end)) continue
    out.push({ rule: 'underline', group: 'text', severity: 'warning', ...at(u), fix: () => set(removeFormat(value, u.start, u.end, 'underline', ctx.formats)) })
  }
  for (const img of value.formats.filter((f) => f.type === 'image')) {
    if (looksLikeFileName(img.attrs?.alt ?? '', img.attrs?.src)) out.push({ rule: 'alt-filename', group: 'media', severity: 'warning', ...at(img), params: { text: img.attrs?.alt ?? '' } })
  }
  if (ctx.colors) {
    for (const c of value.formats.filter((f) => f.type === 'color')) {
      const name = c.attrs?.color ?? ''
      if (ctx.colors.has(name)) continue
      out.push({ rule: 'contrast', group: 'text', severity: 'warning', ...at(c), params: { color: name }, fix: () => set(removeFormat(value, c.start, c.end, 'color', ctx.formats)) })
    }
  }
  for (const r of capsRuns(value.text)) out.push({ rule: 'caps', group: 'text', severity: 'warning', ...at(r) })
  return out
}

/** Whether a rich-text attribute takes the format: the author can act on a finding only where it does. */
function allows(ctx: CheckContext, node: BlockNode, attr: string, format: string): boolean {
  const spec = ctx.schemas.get(node.type)?.attrs[attr]
  return ctx.formats.has(format) && (spec?.type !== 'richtext' || spec.formats === undefined || spec.formats.includes(format))
}

const textRule: DocumentRule = (ctx) => {
  const out: Finding[] = []
  for (const id of ctx.order) {
    const node = ctx.tree.nodes.get(id)!
    for (const { attr, value } of richTextAttrs(node, ctx.schemas)) {
      if (value.text === '') continue
      out.push(...textFindings(node, attr, value, ctx))
      if (!allows(ctx, node, attr, 'lang')) continue
      const lang = ctx.langOf(id) || ctx.lang
      for (const r of foreignRuns(value, lang)) out.push({ rule: 'language', group: 'text', severity: 'warning', blockId: id, attr, start: r.start, end: r.end, params: { text: value.text.slice(r.start, r.end) } })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Shared attributes

const attrRule: DocumentRule = (ctx) => {
  const out: Finding[] = []
  const anchors = new Map<string, number>()
  const used = new Set<string>()
  for (const id of ctx.order) { const a = ctx.tree.nodes.get(id)!.attrs.anchor; if (typeof a === 'string' && a !== '') used.add(a) }
  for (const id of ctx.order) {
    const node = ctx.tree.nodes.get(id)!
    const a = node.attrs
    if (a.textAlign === 'justify') {
      // Uneven gaps between words make lines hard to follow (WCAG 1.4.8).
      out.push({ rule: 'justified', group: 'text', severity: 'warning', blockId: id, fix: () => [{ type: 'setAttrs', id, patch: { textAlign: '' } }] })
    }
    if (ctx.colors && typeof a.color === 'string' && a.color !== '' && !ctx.colors.has(a.color)) {
      out.push({ rule: 'contrast', group: 'text', severity: 'warning', blockId: id, params: { color: a.color }, fix: () => [{ type: 'setAttrs', id, patch: { color: '' } }] })
    }
    if (typeof a.anchor === 'string' && a.anchor !== '') {
      const seen = anchors.get(a.anchor) ?? 0
      anchors.set(a.anchor, seen + 1)
      if (seen > 0) {
        const base = a.anchor
        out.push({
          rule: 'anchor-duplicate', group: 'structure', severity: 'error', blockId: id, params: { anchor: base },
          fix: () => {
            let n = seen + 1
            while (used.has(`${base}-${String(n)}`)) n++
            return [{ type: 'setAttrs', id, patch: { anchor: `${base}-${String(n)}` } }]
          },
        })
      }
    }
  }
  return out
}

/** The rules of every document. */
export const genericRules: readonly DocumentRule[] = [textRule, attrRule]
