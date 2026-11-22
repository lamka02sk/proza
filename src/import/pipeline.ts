/**
 * The import pipeline: one path for stored TinyMCE HTML,
 * clipboard HTML, `.docx` and the HTML source view.
 *
 * 1. detect the source, 2. its normaliser, 3. generic cleanup, 4. block parse
 * rules, 5. inline formats, 6. presets, 7. validation, 8. the report.
 *
 * Foreign HTML is parsed with `DOMParser` into an inert document and never
 * assigned to live DOM. Nothing here throws on content.
 */
import { type FormatRegistry, defaultFormats } from '../model/richtext'
import { DOC_VERSION, validateDoc } from '../model/schema'
import { type Block, createId as defaultId } from '../model/tree'
import { cleanup, footnotes, inlineClassStyles, tablesToText } from './cleanup'
import { detectSource } from './detect'
import { type ClassMapping, type ImportState } from './inline'
import { BlockParser, type PendingFile } from './parser'
import { textToBlocks } from './plain-text'
import { type RawBlock, applySizes, fitTree } from './raw'
import { type ImportReport, type ImportSource, type ReportCode, Reporter } from './report'
import { rtfPictures } from './rtf'
import type { ImportBlock } from './rules'
import { normalizeSource } from './sources'
import type { PaletteEntry } from './style'

export interface ImportOptions {
  /** Skip detection: the caller knows (`tinymce` for stored records, `proza` for the source view). */
  readonly source?: ImportSource
  readonly formats?: FormatRegistry
  /** Named colours text colours map to (stage 6); others are dropped and reported. */
  readonly palette?: readonly PaletteEntry[]
  /** Host classes that stand for a format or block (TinyMCE). */
  readonly classes?: Readonly<Record<string, ClassMapping>>
  readonly createId?: () => string
  /** Word's RTF of the same clipboard content: the bytes of pictures its HTML only points at. */
  readonly rtf?: string
  /** Entries a stage before the pipeline found (mammoth's unknown styles). */
  readonly notes?: readonly ReportNote[]
  /** The host offers justified text: imported justified paragraphs keep it. */
  readonly justify?: boolean
}

export interface ReportNote { readonly code: ReportCode; readonly detail?: string }

/** A picture part waiting for its file: uploaded through the host's adapter, or asked of the author when `file` is null. */
export interface PendingMedia {
  readonly blockId: string
  readonly file: File | null
  readonly name: string
}

export interface ImportResult {
  /** Validated blocks with fresh ids, ready to insert. */
  readonly blocks: readonly Block[]
  readonly report: ImportReport
  readonly pending: readonly PendingMedia[]
}

/** Larger HTML is refused rather than parsed: no document is that large, and a paste of it is an accident or an attack. */
export const MAX_HTML = 30_000_000

function registry(blocks: readonly ImportBlock[] | ReadonlyMap<string, ImportBlock>): readonly ImportBlock[] {
  const isList = (b: typeof blocks): b is readonly ImportBlock[] => Array.isArray(b)
  return isList(blocks) ? blocks : [...blocks.values()]
}

export function importHtml(html: string, blocks: readonly ImportBlock[] | ReadonlyMap<string, ImportBlock>, options: ImportOptions = {}): ImportResult {
  const list = registry(blocks)
  const report = new Reporter()
  for (const n of options.notes ?? []) report.add(n.code, n.detail)
  // The size first: detecting the source scans the whole string.
  if (html.length > MAX_HTML) {
    report.add('truncated')
    return { blocks: [], report: report.report(options.source ?? 'html'), pending: [] }
  }
  const source = options.source ?? detectSource(html)
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const body = doc.body
  if (source !== 'proza') inlineClassStyles(doc)
  normalizeSource(body, source, report)
  cleanup(body)
  footnotes(body, report, source === 'proza')
  if (!list.some((b) => b.name === 'core/table')) tablesToText(body, report)
  else if (list.some((b) => b.name === 'core/table-cell')) tablesToText(body, report, 'table table')

  const state: ImportState = {
    source,
    formats: options.formats ?? defaultFormats,
    palette: options.palette ?? [],
    report,
    exact: source === 'proza',
    lang: source === 'proza' ? '' : dominantLanguage(doc),
    classes: options.classes ?? {},
    sizes: new Map(),
    fonts: new Set(),
    justify: options.justify === true,
  }
  const parser = new BlockParser(state, list, referencedIds(body))
  const raw = parser.parse(body)
  return finish(raw, list, state.formats, report, source, parser.pending, options)
}

/** Plain text: paragraphs and lists, addresses linked. */
export function importText(text: string, blocks: readonly ImportBlock[] | ReadonlyMap<string, ImportBlock>, options: ImportOptions = {}): ImportResult {
  const list = registry(blocks)
  const formats = options.formats ?? defaultFormats
  const report = new Reporter()
  const raw = textToBlocks(text, { formats, links: formats.has('link') })
  return finish(raw, list, formats, report, 'text', [], options)
}

function finish(
  raw: readonly RawBlock[], list: readonly ImportBlock[], formats: FormatRegistry, report: Reporter,
  source: ImportSource, files: readonly PendingFile[], options: ImportOptions,
): ImportResult {
  const schemas = new Map(list.map((b) => [b.name, b]))
  const sized = applySizes(raw, schemas, report)
  const fitted = fitTree(sized, schemas, report)
  const createId = options.createId ?? defaultId
  const ids = new Set<string>()
  const fresh = (): string => { let id: string; do id = createId(); while (ids.has(id)); ids.add(id); return id }
  const media = new Map<number, string>()
  const toStored = (b: RawBlock): Block => {
    const id = fresh()
    if (b.media !== undefined) media.set(b.media, id)
    const base = { id, type: b.type, attrs: b.attrs }
    return b.children ? { ...base, children: b.children.map(toStored) } : base
  }
  const stored = fitted.map(toStored)
  const { doc, issues } = validateDoc({ version: DOC_VERSION, blocks: stored }, schemas, { formats, createId: fresh })
  // Attribute repairs are the import's own business (a value that did not fit); the author sees the count.
  if (issues.length > 0) report.add('repaired', undefined, issues.length)

  const present = new Set<string>()
  const walk = (bs: readonly Block[]): void => { for (const b of bs) { present.add(b.id); if (b.children) walk(b.children) } }
  walk(doc.blocks)
  let pending = files.map((f, i) => ({ blockId: media.get(i) ?? '', file: f.file, name: f.name })).filter((p) => present.has(p.blockId))
  pending = recoverFromRtf(pending, options.rtf, report)
  const uploads = pending.filter((p) => p.file !== null).length
  const missing = pending.length - uploads
  if (uploads > 0 && !report.has('image-recovered')) report.add('image-upload', undefined, uploads)
  if (missing > 0) report.add('image-missing', pending.find((p) => p.file === null)?.name, missing)
  return { blocks: doc.blocks, report: report.report(source), pending }
}

/**
 * Word's `file://` pictures matched with the pictures in its RTF, in order.
 * Only when the counts agree: a wrong picture in the wrong place is worse than a placeholder.
 */
function recoverFromRtf(pending: PendingMedia[], rtf: string | undefined, report: Reporter): PendingMedia[] {
  const missing = pending.filter((p) => p.file === null)
  if (!rtf || missing.length === 0) return pending
  const pictures = rtfPictures(rtf)
  if (pictures.length !== missing.length) return pending
  let n = 0, recovered = 0
  const out = pending.map((p) => {
    if (p.file !== null) return p
    const pic = pictures[n++]!
    if (pic.type === null) return p
    recovered++
    const ext = pic.type === 'image/png' ? 'png' : 'jpg'
    const name = p.name.replace(/\.[a-z0-9]{1,5}$/i, '') || 'picture'
    return { ...p, file: new File([pic.bytes as Uint8Array<ArrayBuffer>], `${name}.${ext}`, { type: pic.type }) }
  })
  if (recovered > 0) report.add('image-recovered', undefined, recovered)
  return out
}

/** The language most of the text is written in, lowercased; '' when nothing says. */
function dominantLanguage(doc: Document): string {
  const weight = new Map<string, number>()
  const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = (n.nodeValue ?? '').trim().length
    if (len === 0) continue
    const lang = n.parentElement?.closest('[lang]')?.getAttribute('lang')?.trim().toLowerCase() ?? ''
    weight.set(lang, (weight.get(lang) ?? 0) + len)
  }
  let best = '', most = 0
  for (const [lang, w] of weight) if (w > most) { best = lang; most = w }
  return best
}

/** Ids that internal links point at: only those become anchors (Word and Google ids that nothing links to stay out). */
function referencedIds(body: Element): Set<string> {
  const out = new Set<string>()
  for (const a of body.querySelectorAll('a[href^="#"]')) {
    const id = a.getAttribute('href')!.slice(1)
    if (id) { try { out.add(decodeURIComponent(id)) } catch { out.add(id) } }
  }
  return out
}
