/**
 * Plain text to blocks: blank lines split
 * paragraphs, single line breaks stay soft breaks, and lines that start with
 * `- `, `* `, `• ` or `1. ` become lists, nested by indentation. Pure.
 */
import { type FormatRegistry, createValue, defaultFormats } from '../model/richtext'
import { linkify } from '../model/input-rules'
import type { RawBlock } from './raw'

const BULLET = /^([ \t]*)[-*•‣◦▪–](?:[ \t]+)(.*)$/
const NUMBER = /^([ \t]*)(\d{1,9})[.)](?:[ \t]+)(.*)$/

interface Item { readonly indent: number; readonly ordered: boolean; readonly start: number; readonly text: string }

function item(line: string): Item | null {
  const b = BULLET.exec(line)
  if (b) return { indent: width(b[1]!), ordered: false, start: 1, text: b[2]! }
  const n = NUMBER.exec(line)
  if (n) return { indent: width(n[1]!), ordered: true, start: Number(n[2]), text: n[3]! }
  return null
}

const width = (s: string): number => s.replaceAll('\t', '    ').length

/** Spaces and tabs off the end, counted back: /[ \t]+$/ retries at every space of a long run. */
function trimEndSpaces(line: string): string {
  let end = line.length
  while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t')) end--
  return line.slice(0, end)
}

/** Lists nested deeper than this keep their items at the deepest level: a document has a depth limit (128 parts). */
const MAX_LIST_DEPTH = 40

export function textToBlocks(input: string, options: { formats?: FormatRegistry; links?: boolean } = {}): RawBlock[] {
  const formats = options.formats ?? defaultFormats
  const value = (text: string) => {
    const v = createValue(text, [], formats)
    return options.links === false ? v : linkify(v, formats)
  }
  // Characters a document cannot hold go here; the rest of validation runs later.
  // eslint-disable-next-line no-control-regex
  const text = input.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F￼]/g, '')
  const out: RawBlock[] = []
  for (const para of text.split(/\n[ \t]*\n+/)) {
    const lines = para.split('\n').filter((l, i, all) => !(l.trim() === '' && (i === 0 || i === all.length - 1)))
    if (lines.length === 0) continue
    const items = lines.map(item)
    // A paragraph is a list when every line is an item, or continues the item above it with more indentation.
    if (items[0] && items.every((it, i) => it !== null || (i > 0 && /^[ \t]+\S/.test(lines[i]!)))) {
      for (const b of list(lines, items, value)) out.push(b)
      continue
    }
    const joined = lines.map(trimEndSpaces).join('\n').replace(/^[ \t]+/, '')
    if (joined.trim() !== '') out.push({ type: 'core/paragraph', attrs: { content: value(joined) } })
  }
  return out
}

function list(lines: readonly string[], items: readonly (Item | null)[], value: (t: string) => unknown): RawBlock[] {
  type Level = { indent: number; block: { type: string; attrs: Record<string, unknown>; children: RawBlock[] }; last: { attrs: Record<string, unknown>; children: RawBlock[]; text: string } | null }
  const roots: RawBlock[] = []
  const stack: Level[] = []
  const newList = (it: Item) => ({ type: 'core/list', attrs: { style: it.ordered ? 'number' : 'bullet', start: it.start }, children: [] as RawBlock[] })
  const finish = (l: Level): void => { if (l.last) l.last.attrs.content = value(l.last.text) }
  lines.forEach((line, i) => {
    const it = items[i]
    if (!it) {
      // A continuation line: a soft break in the item above.
      const top = stack.at(-1)
      if (top?.last) top.last.text += `\n${line.trim()}`
      return
    }
    while (stack.length > 0 && it.indent < stack.at(-1)!.indent) finish(stack.pop()!)
    let top = stack.at(-1)
    if (top && it.indent > top.indent && top.last && stack.length < MAX_LIST_DEPTH) {
      const nested = newList(it)
      top.last.children.push(nested)
      stack.push((top = { indent: it.indent, block: nested, last: null }))
    } else if (!top || top.block.attrs.style !== (it.ordered ? 'number' : 'bullet')) {
      if (top) finish(stack.pop()!)
      const fresh = newList(it)
      const parent = stack.at(-1)
      if (parent?.last) parent.last.children.push(fresh)
      else roots.push(fresh)
      stack.push((top = { indent: it.indent, block: fresh, last: null }))
    }
    finish(top)
    const li = { type: 'core/list-item', attrs: {} as Record<string, unknown>, children: [] as RawBlock[], text: it.text }
    top.block.children.push(li)
    top.last = li
  })
  while (stack.length > 0) finish(stack.pop()!)
  return roots.map(strip)
}

/** The working fields of a list item are not attributes. */
function strip(b: RawBlock): RawBlock {
  const { type, attrs } = b
  const children = b.children?.map(strip)
  return children && children.length > 0 ? { type, attrs, children } : { type, attrs }
}
