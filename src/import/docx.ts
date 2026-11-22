/**
 * `.docx` files: mammoth.js turns the file into plain
 * HTML with pictures as data URIs, which then enters the pipeline like any
 * other HTML. Loaded on first use only.
 */
import type { ReportNote } from './pipeline'

/** Word styles to the HTML the pipeline reads; mammoth's defaults already cover headings and lists. */
const STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => p:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  "r[style-name='Strong'] => strong",
  "r[style-name='Emphasis'] => em",
  "r[style-name='Code'] => code",
  "p[style-name='Code'] => pre:separator('\\n')",
]

/** Above this a file is refused before reading: a text document this large is an archive of pictures. */
export const MAX_DOCX = 100_000_000

export interface DocxHtml {
  readonly html: string
  /** What mammoth could not map (a style it does not know), for the report. */
  readonly notes: readonly ReportNote[]
}

/**
 * Unpacked, a few kilobytes can be gigabytes (a zip bomb): the archive's directory is read first, and a file
 * whose parts would unpack past these is refused before mammoth inflates anything. Pictures are stored
 * nearly as they are; the text parts are what mammoth parses (20 MB of it already takes a gigabyte).
 */
export const MAX_DOCX_UNPACKED = 300_000_000
export const MAX_DOCX_TEXT = 50_000_000

/**
 * The unpacked sizes the archive's central directory declares: all parts, and those outside `word/media/`.
 * Null when there is no readable directory (not a zip, or a ZIP64 one: no Word document needs it).
 */
export function unpackedSizes(buffer: ArrayBuffer): { total: number; text: number } | null {
  const view = new DataView(buffer)
  const length = buffer.byteLength
  // The end record is the last 22 bytes, followed by a comment of at most 65,535.
  let end = -1
  for (let i = length - 22; i >= 0 && i >= length - 22 - 0xffff; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break }
  }
  if (end < 0) return null
  const entries = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  let total = 0, text = 0
  const decoder = new TextDecoder()
  for (let n = 0; n < entries; n++) {
    if (at + 46 > length || view.getUint32(at, true) !== 0x02014b50) return null
    const size = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    if (at + 46 + nameLength > length) return null
    total += size
    if (!decoder.decode(new Uint8Array(buffer, at + 46, nameLength)).startsWith('word/media/')) text += size
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
  return { total, text }
}

export async function docxToHtml(file: Blob): Promise<DocxHtml> {
  if (file.size > MAX_DOCX) throw new Error('The file is too large to import')
  const buffer = await file.arrayBuffer()
  // shortcut: trusts the sizes the directory declares; a forged directory is caught only when mammoth's zip reader compares them after inflating. Inflate with a byte budget (DecompressionStream) if that matters.
  const sizes = unpackedSizes(buffer)
  if (!sizes) throw new Error('The file is not a Word document')
  if (sizes.total > MAX_DOCX_UNPACKED || sizes.text > MAX_DOCX_TEXT) throw new Error('The file is too large to import')
  const mod = await import('mammoth')
  // CommonJS: bundlers hand it over as the default export or as the module itself.
  const mammoth = 'default' in mod ? mod.default : mod
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer }, { styleMap: STYLE_MAP })
  const notes: ReportNote[] = []
  for (const m of result.messages) {
    const style = /Unrecognised (?:paragraph|run) style: '([^']+)'/.exec(m.message)
    if (style) notes.push({ code: 'style', detail: style[1]! })
  }
  return { html: result.value, notes }
}
