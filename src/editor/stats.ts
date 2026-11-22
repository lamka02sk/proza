/**
 * Word, character and part counts (TinyMCE `wordcount`).
 * Words and characters come from `Intl.Segmenter`, so Slovak, Japanese and
 * emoji with skin tones count as a reader would count them.
 */
import { OBJECT_CHAR } from '../model/richtext'
import { childrenOf } from '../model/tree'
import { type StructureContext, fieldValue, stops } from './editing'

export interface Counts {
  readonly words: number
  /** Characters as people see them (grapheme clusters), spaces included. */
  readonly characters: number
  readonly charactersNoSpaces: number
}

export interface DocumentCounts extends Counts {
  /** Parts of the page: top-level blocks. */
  readonly parts: number
}

const segmenters = new Map<string, { words: Intl.Segmenter; graphemes: Intl.Segmenter }>()

function segmenterFor(lang: string): { words: Intl.Segmenter; graphemes: Intl.Segmenter } {
  let s = segmenters.get(lang)
  if (!s) {
    s = { words: new Intl.Segmenter(lang, { granularity: 'word' }), graphemes: new Intl.Segmenter(lang, { granularity: 'grapheme' }) }
    segmenters.set(lang, s)
  }
  return s
}

/** Counts of one text. Inline pictures and footnote references (U+FFFC) are not characters of the text. */
export function countText(text: string, lang = 'en'): Counts {
  const clean = text.replaceAll(OBJECT_CHAR, '')
  const { words, graphemes } = segmenterFor(lang)
  let w = 0, c = 0, spaces = 0
  for (const s of words.segment(clean)) if (s.isWordLike) w++
  for (const g of graphemes.segment(clean)) { c++; if (/^\s+$/u.test(g.segment)) spaces++ }
  return { words: w, characters: c, charactersNoSpaces: c - spaces }
}

/** Counts of every field in the document; fields are separate, so words never run across parts. */
export function countDocument(ctx: Pick<StructureContext, 'tree' | 'editing' | 'current'>, lang = 'en'): DocumentCounts {
  let words = 0, characters = 0, charactersNoSpaces = 0
  for (const stop of stops(ctx)) {
    if (stop.field === null) continue
    const c = countText(fieldValue(ctx.tree.nodes.get(stop.blockId)!, stop.field).text, lang)
    words += c.words
    characters += c.characters
    charactersNoSpaces += c.charactersNoSpaces
  }
  return { words, characters, charactersNoSpaces, parts: childrenOf(ctx.tree, null).length }
}
