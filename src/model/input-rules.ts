/**
 * Input rules: Markdown-like shortcuts recognised while
 * typing. Pure functions over a value and the caret; the field decides when
 * to ask and records each applied rule as its own undo step, so one undo
 * gives the literal characters back.
 */
import {
  applyFormat, defaultFormats, deleteRange, formatsAt, inheritedMarks, normalize, type FormatRange, type FormatRegistry, type Mark, type RichTextValue,
} from './richtext'
import { safeUrl } from './url'

export interface InlineRuleResult {
  readonly rule: string
  readonly value: RichTextValue
  readonly caret: number
  /** Marks for the text typed next: the rule's format ends at the caret. */
  readonly marks: readonly Mark[]
}

interface Delimited { readonly rule: string; readonly open: string; readonly close: string; readonly format: string }

// Longer delimiters first, so `**` wins over `*`.
const DELIMITED: readonly Delimited[] = [
  { rule: 'bold', open: '**', close: '**', format: 'bold' },
  { rule: 'bold', open: '__', close: '__', format: 'bold' },
  { rule: 'strikethrough', open: '~~', close: '~~', format: 'strikethrough' },
  { rule: 'code', open: '`', close: '`', format: 'code' },
  { rule: 'italic', open: '*', close: '*', format: 'italic' },
  { rule: 'italic', open: '_', close: '_', format: 'italic' },
]

const WORD = /[\p{L}\p{N}]/u

/**
 * After a character was typed and the caret is right after it: if the text
 * before the caret ends with a closing delimiter (`**bold**`, `` `code` ``,
 * `_italic_`, `~~struck~~`), the delimiters go and the format applies.
 *
 * Rules that do not fire: the opening delimiter inside a word (`snake_case_`,
 * `2*3*`), content that starts or ends with a space, text already in code,
 * and formats `allowed` refuses.
 */
export function matchInlineRule(
  value: RichTextValue, caret: number, allowed: (format: string) => boolean = () => true, registry: FormatRegistry = defaultFormats,
): InlineRuleResult | null {
  const text = value.text
  for (const d of DELIMITED) {
    if (!allowed(d.format) || !text.startsWith(d.close, caret - d.close.length)) continue
    const closeAt = caret - d.close.length
    const delimChar = d.open[0]!
    // `**bold*` must not become italic: the closing delimiter is not preceded by its own character.
    if (text[closeAt - 1] === delimChar) continue
    const openAt = text.lastIndexOf(d.open, closeAt - 1)
    if (openAt < 0) continue
    const contentStart = openAt + d.open.length
    if (contentStart >= closeAt) continue
    const content = text.slice(contentStart, closeAt)
    if (/^\s|\s$/.test(content) || content.includes('\n') || content.includes(delimChar)) continue
    const before = text[openAt - 1]
    if (before !== undefined && (WORD.test(before) || before === delimChar)) continue
    // Code is literal: nothing inside it or around its delimiters is a rule.
    const inCode = (o: number): boolean => formatsAt(value, o).some((f) => f.type === 'code')
    if (inCode(openAt) || inCode(closeAt)) continue

    let v = deleteRange(value, closeAt, caret, registry)
    v = deleteRange(v, openAt, contentStart, registry)
    const end = closeAt - d.open.length
    v = applyFormat(v, openAt, end, { type: d.format }, registry)
    const marks = inheritedMarks(v, end, registry).filter((m) => m.type !== d.format)
    return { rule: d.rule, value: v, caret: end, marks }
  }
  return null
}

/** Characters that end a URL typed in running text rather than belong to it. */
const TRAILING = new Set('.,;:!?\'")]}>')

/** The address in the word that ends at `end`: where it is and its link, or null. */
function addressBefore(text: string, end: number): { start: number; end: number; href: string } | null {
  let start = end
  while (start > 0 && !/\s/.test(text[start - 1]!)) start--
  // An address in parentheses or quotes: the opening mark is not part of it.
  while (start < end && /[(<["'«„“]/.test(text[start]!)) start++
  let word = text.slice(start, end)
  // Counted from the end, not with a pattern: /[…]+$/ retries at every character of a long run.
  let cut = 0
  while (cut < word.length && TRAILING.has(word[word.length - 1 - cut]!)) cut++
  // Keep a closing parenthesis that has its opening one inside the URL (Wikipedia links).
  if (cut > 0 && word[word.length - cut] === ')' && word.slice(0, -cut).includes('(')) cut--
  word = word.slice(0, word.length - cut)
  if (!/^(?:https?:\/\/\S+|www\.[^\s.]+\.\S+)$/i.test(word)) return null
  const href = safeUrl(/^www\./i.test(word) ? `https://${word}` : word)
  return href === null ? null : { start, end: start + word.length, href }
}

const linkOrCode = (f: FormatRange): boolean => f.type === 'link' || f.type === 'code'

/**
 * Autolink (TinyMCE `autolink`): the word that ends at `end` (just before a
 * typed space or Enter) becomes a link when it is an http, https or `www.` address.
 */
export function matchAutolink(value: RichTextValue, end: number, registry: FormatRegistry = defaultFormats): RichTextValue | null {
  const found = addressBefore(value.text, end)
  if (!found || value.formats.some((f) => linkOrCode(f) && f.start < found.end && f.end > found.start)) return null
  return applyFormat(value, found.start, found.end, { type: 'link', attrs: { href: found.href } }, registry)
}

/** Paste rule (TinyMCE `autolink`): every address in pasted text that is not linked yet becomes a link. */
export function linkify(value: RichTextValue, registry: FormatRegistry = defaultFormats): RichTextValue {
  const len = value.text.length
  // Characters in a link or code before each offset, so each word is checked at once, and all links
  // are added in one normalize: the text never changes, and words never overlap.
  const depth = new Int32Array(len + 1)
  for (const f of value.formats) {
    if (!linkOrCode(f)) continue
    const a = Math.max(0, Math.min(len, f.start)), b = Math.max(0, Math.min(len, f.end))
    depth[a] = depth[a]! + 1
    depth[b] = depth[b]! - 1
  }
  const covered = new Int32Array(len + 1)
  for (let i = 0, d = 0; i < len; i++) { d += depth[i]!; covered[i + 1] = covered[i]! + (d > 0 ? 1 : 0) }
  const links: FormatRange[] = []
  for (const m of value.text.matchAll(/\S+/g)) {
    const found = addressBefore(value.text, m.index + m[0].length)
    if (found && covered[found.end] === covered[found.start]) links.push({ type: 'link', start: found.start, end: found.end, attrs: { href: found.href } })
  }
  return links.length === 0 ? value : normalize({ text: value.text, formats: [...value.formats, ...links] }, registry)
}

/** A block transform the text at the start of a block asks for. The block decides what it means. */
export type BlockRule =
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { readonly kind: 'list'; readonly style: 'bullet' }
  | { readonly kind: 'list'; readonly style: 'number'; readonly start: number }
  | { readonly kind: 'list'; readonly style: 'check'; readonly checked: boolean }
  | { readonly kind: 'quote' }
  | { readonly kind: 'code'; readonly language: string }
  | { readonly kind: 'separator' }

export interface BlockRuleMatch {
  readonly rule: BlockRule
  /** The content without the typed prefix. */
  readonly rest: RichTextValue
}

/**
 * After a space typed at the start of a block: `# ` to `###### `, `- `, `* `,
 * `+ `, `1. ` or `1) `, `[ ] ` or `[x] `, `> `. The caret must be right after
 * the space, so the rule fires only while the author is typing the prefix.
 */
export function matchBlockRuleOnSpace(value: RichTextValue, caret: number, registry: FormatRegistry = defaultFormats): BlockRuleMatch | null {
  const prefix = value.text.slice(0, caret)
  if (!prefix.endsWith(' ') || prefix.includes('\n')) return null
  const rest = (): RichTextValue => deleteRange(value, 0, caret, registry)
  let m: RegExpExecArray | null
  if ((m = /^(#{1,6}) $/.exec(prefix))) return { rule: { kind: 'heading', level: m[1]!.length as 1 | 2 | 3 | 4 | 5 | 6 }, rest: rest() }
  if (/^[-*+] $/.test(prefix)) return { rule: { kind: 'list', style: 'bullet' }, rest: rest() }
  if ((m = /^(\d{1,9})[.)] $/.exec(prefix))) return { rule: { kind: 'list', style: 'number', start: Number(m[1]) }, rest: rest() }
  if ((m = /^\[( ?|x|X)\] $/.exec(prefix))) return { rule: { kind: 'list', style: 'check', checked: m[1]!.toLowerCase() === 'x' }, rest: rest() }
  if (prefix === '> ') return { rule: { kind: 'quote' }, rest: rest() }
  return null
}

/** On Enter in a block whose whole text is three backticks (with a language) or a rule line (`---`, `***`, `___`). */
export function matchBlockRuleOnEnter(value: RichTextValue): BlockRuleMatch | null {
  const text = value.text.trim()
  const empty: RichTextValue = { text: '', formats: [] }
  const fence = /^```([a-z0-9][a-z0-9+#.-]{0,39})?$/i.exec(text)
  if (fence) return { rule: { kind: 'code', language: fence[1] ?? '' }, rest: empty }
  if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(text)) return { rule: { kind: 'separator' }, rest: empty }
  return null
}
