/**
 * Stage 1 of the import pipeline: which application the
 * HTML came from, by the markers each one leaves. Pure string checks, so they
 * run before parsing and in Node tests.
 */
import type { ImportSource } from './report'

const LIBREOFFICE = /<meta\b[^<>]*content=["']?(?:LibreOffice|OpenOffice)/i

/**
 * Order matters: spreadsheets before word processors (Excel HTML carries Office markers too).
 * Every run stops at the next tag or attribute (`[^<>]`, `[^"'<>=]`) or has a bound, so a failed
 * attempt never scans past where the next one starts: foreign text costs its length, not its square.
 */
const MARKERS: readonly (readonly [ImportSource, RegExp])[] = [
  ['proza', /\bdata-pz-clip=|class="[^"]*\bpz-(?:image|gallery|video|audio|embed|file|quote|code|checklist|footnotes|text-|size-|color-)/],
  ['libreoffice-calc', /\bsd(?:val|num)=/i],
  ['google-sheets', /<google-sheets-html-origin|\bdata-sheets-(?:value|root|formula)=/i],
  ['excel', /urn:schemas-microsoft-com:office:excel|<meta\b[^<>]*content=["']?Excel\.Sheet|\bx:(?:num|str|fmla)\b/i],
  ['google-docs', /\bid=["']?docs-internal-guid-/i],
  ['word-web', /\bclass=["']?[^"'<>=]*\b(?:OutlineElement|TextRun|NormalTextRun|ListContainerWrapper|SCXW\d+)\b|\bparaeid=|\bdata-ccp-props=/i],
  ['word-desktop', /urn:schemas-microsoft-com:office:word|<meta\b[^<>]*content=["']?Microsoft Word|\bclass=["']?Mso[A-Z]|mso-[a-z-]{1,40}\s*:/i],
  ['libreoffice-writer', LIBREOFFICE],
  ['tinymce', /\bdata-mce-[a-z-]{1,40}=|\bclass=["']?[^"'<>=]*\bmce-[a-z]/i],
]

/** The source of `html`, or `html` when nothing marks it. `notProza`: Proza's own markers do not count (legacy output reads as plain HTML). */
export function detectSource(html: string, notProza = false): ImportSource {
  // Markers sit near the start (meta tags, the outer wrapper) or anywhere in the markup; the whole string is cheap enough to scan.
  for (const [source, pattern] of MARKERS) {
    if (notProza && source === 'proza') continue
    if (!pattern.test(html)) continue
    // Calc also writes data-sheets-value on text cells for compatibility.
    return source === 'google-sheets' && LIBREOFFICE.test(html) ? 'libreoffice-calc' : source
  }
  return 'html'
}

/** Sources whose markup is a table of cells, not a text. */
export function isSpreadsheet(source: ImportSource): boolean {
  return source === 'excel' || source === 'google-sheets' || source === 'libreoffice-calc'
}

/** Sources whose `<del>` and `<ins>` are tracked changes rather than struck or inserted text. */
export function tracksChanges(source: ImportSource): boolean {
  return source === 'word-desktop' || source === 'word-web' || source === 'docx'
}
