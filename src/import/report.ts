/**
 * The import report (stage 8): everything changed or
 * dropped, grouped by what happened, so the author sees what the conversion
 * did and the host gets it back. Codes, counts and samples only; the
 * interface words them in the author's language.
 */

/** Where the content came from (stage 1). */
export type ImportSource =
  | 'proza' | 'word-desktop' | 'word-web' | 'google-docs' | 'libreoffice-writer'
  | 'excel' | 'google-sheets' | 'libreoffice-calc' | 'tinymce' | 'docx' | 'html' | 'text'

export const REPORT_CODES = {
  // Lost: content or meaning the document no longer has.
  element: 'lost', link: 'lost', 'image-dropped': 'lost', 'image-missing': 'lost', color: 'lost', comment: 'lost', truncated: 'lost',
  // Changed: kept, in a different form.
  style: 'changed', font: 'changed', size: 'changed', justify: 'changed', indent: 'changed', table: 'changed', structure: 'changed',
  embed: 'changed', moved: 'changed', tracked: 'changed', repaired: 'changed', 'color-matched': 'changed', 'image-remote': 'changed',
  // Done for the author: worth knowing, nothing lost.
  empty: 'info', list: 'info', footnote: 'info', 'image-upload': 'info', 'image-recovered': 'info',
} as const satisfies Record<string, 'lost' | 'changed' | 'info'>

export type ReportCode = keyof typeof REPORT_CODES
export type Severity = (typeof REPORT_CODES)[ReportCode]

export interface ReportEntry {
  readonly code: ReportCode
  readonly severity: Severity
  /** How many times it happened. */
  readonly count: number
  /** Distinct details (a font name, a colour, an element), at most `MAX_SAMPLES`. */
  readonly samples: readonly string[]
}

export interface ImportReport {
  readonly source: ImportSource
  /** Lost first, then changed, then info; by first occurrence within a severity. */
  readonly entries: readonly ReportEntry[]
}

export const MAX_SAMPLES = 5

const ORDER: Readonly<Record<Severity, number>> = { lost: 0, changed: 1, info: 2 }

/** Collects entries while an import runs. */
export class Reporter {
  readonly #entries = new Map<ReportCode, { count: number; samples: string[] }>()

  add(code: ReportCode, detail?: string, count = 1): void {
    let e = this.#entries.get(code)
    if (!e) this.#entries.set(code, (e = { count: 0, samples: [] }))
    e.count += count
    const d = detail?.trim().slice(0, 80)
    if (d && e.samples.length < MAX_SAMPLES && !e.samples.includes(d)) e.samples.push(d)
  }

  has(code: ReportCode): boolean { return this.#entries.has(code) }

  report(source: ImportSource): ImportReport {
    const entries = [...this.#entries].map(([code, e]): ReportEntry => ({ code, severity: REPORT_CODES[code], count: e.count, samples: e.samples }))
    entries.sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
    return { source, entries }
  }
}

/** Whether the author should look: something was lost or changed. */
export function needsReview(report: ImportReport): boolean {
  return report.entries.some((e) => e.severity !== 'info')
}
