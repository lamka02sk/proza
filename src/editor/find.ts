/**
 * Find and replace across parts (TinyMCE `searchreplace`).
 * Pure: matches are text offsets in the fields, in reading order, and
 * replacing returns one change the editor applies as a single undo step.
 */
import { type FormatRegistry, type Mark, type RichTextValue, OBJECT_CHAR, defaultFormats, marked, replace } from '../model/richtext'
import { type Change, type StructureContext, fieldValue, stops } from './editing'
import type { EditorSelection } from './selection'

export interface FindOptions {
  /** `A` finds only `A`. Default off: case is ignored, accents are not (`e` does not find `é`). */
  readonly matchCase?: boolean
  /** Only whole words: `art` does not find `party`. */
  readonly wholeWords?: boolean
}

export interface Match {
  readonly blockId: string
  readonly field: string
  readonly start: number
  readonly end: number
}

const MAX_MATCHES = 10_000

/** The pattern for `query`, or null when there is nothing to find. Letters, digits and `_` make up words. */
export function findPattern(query: string, options: FindOptions = {}): RegExp | null {
  if (query === '' || query.includes(OBJECT_CHAR)) return null
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const body = options.wholeWords ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])` : escaped
  return new RegExp(body, options.matchCase ? 'gu' : 'giu')
}

/** Every match in `text`. Matches never overlap. */
export function matchesIn(text: string, pattern: RegExp): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  pattern.lastIndex = 0
  for (let m = pattern.exec(text); m !== null && out.length < MAX_MATCHES; m = pattern.exec(text)) {
    out.push({ start: m.index, end: m.index + m[0].length })
  }
  return out
}

/** Every match in the document's fields, in reading order. Capped, so a one-letter search stays responsive. */
export function findMatches(ctx: Pick<StructureContext, 'tree' | 'editing' | 'current'>, query: string, options: FindOptions = {}): Match[] {
  const pattern = findPattern(query, options)
  if (!pattern) return []
  const out: Match[] = []
  for (const stop of stops(ctx)) {
    if (stop.field === null) continue
    const node = ctx.tree.nodes.get(stop.blockId)!
    for (const m of matchesIn(fieldValue(node, stop.field).text, pattern)) {
      out.push({ blockId: stop.blockId, field: stop.field, ...m })
      if (out.length >= MAX_MATCHES) return out
    }
  }
  return out
}

/** The first match at or after the selection, so finding starts where the author is. */
export function matchAfter(ctx: Pick<StructureContext, 'tree' | 'editing' | 'current'>, matches: readonly Match[], selection: EditorSelection): number {
  if (matches.length === 0) return -1
  if (selection.kind !== 'text') return 0
  const order = new Map(stops(ctx).map((s, i) => [`${s.blockId}:${s.field ?? ''}`, i]))
  const here = order.get(`${selection.blockId}:${selection.field}`) ?? 0
  const at = Math.min(selection.anchor, selection.focus)
  const i = matches.findIndex((m) => {
    const o = order.get(`${m.blockId}:${m.field}`) ?? 0
    return o > here || (o === here && m.start >= at)
  })
  return i < 0 ? 0 : i
}

/** The replacement takes the formats of the first character it replaces, as typing over a selection does. */
function replacementFor(value: RichTextValue, m: { start: number; end: number }, text: string, formats: FormatRegistry): RichTextValue {
  const marks: Mark[] = value.formats
    .filter((f) => f.start <= m.start && m.start < f.end && formats.get(f.type)?.object !== true)
    .map((f) => (f.attrs ? { type: f.type, attrs: f.attrs } : { type: f.type }))
  return marked(text.replaceAll(OBJECT_CHAR, ''), marks)
}

/**
 * Replace `matches` with `text` as one change. The caret goes after the last
 * replacement. Matches whose text changed since they were found are skipped.
 */
export function replaceMatches(ctx: Pick<StructureContext, 'tree' | 'strings'> & { readonly formats?: FormatRegistry }, matches: readonly Match[], text: string, expected: (found: string) => boolean): Change | null {
  const formats = ctx.formats ?? defaultFormats
  const byField = new Map<string, Match[]>()
  for (const m of matches) {
    const key = `${m.blockId}\u0000${m.field}`
    byField.set(key, [...(byField.get(key) ?? []), m])
  }
  const ops: Change['ops'][number][] = []
  let done = 0
  let last: { blockId: string; field: string; offset: number } | null = null
  for (const list of byField.values()) {
    const { blockId, field } = list[0]!
    const node = ctx.tree.nodes.get(blockId)
    if (!node) continue
    const before = fieldValue(node, field)
    let value = before
    // From the end, so earlier offsets stay right.
    const sorted = [...list].sort((a, b) => b.start - a.start)
    let shift = 0
    for (const m of sorted) {
      if (m.end > value.text.length || !expected(value.text.slice(m.start, m.end))) continue
      value = replace(value, m.start, m.end, replacementFor(value, m, text, formats), formats)
      shift += text.length - (m.end - m.start)
      done++
    }
    if (value === before) continue
    ops.push({ type: 'setAttrs', id: blockId, patch: { [field]: value } })
    const end = sorted[0]!
    last = { blockId, field, offset: end.start + text.length + shift - (text.length - (end.end - end.start)) }
  }
  if (done === 0 || !last) return null
  const selection: EditorSelection = { kind: 'text', blockId: last.blockId, field: last.field, anchor: last.offset, focus: last.offset }
  return { ops, selection, announce: ctx.strings.replaced(done) }
}
