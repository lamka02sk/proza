/**
 * Block parse rules (`parse`, stage 4 of the import pipeline): how a
 * block type recognises itself in HTML, its own output and foreign markup
 * alike. Rules read an inert element and return attributes in stored form;
 * validation checks them afterwards, so a rule never needs to be defensive
 * about values, only about what it reads.
 */
import type { RichTextValue } from '../model/richtext'
import type { BlockSchema } from '../model/schema'
import type { ReportCode, ImportSource } from './report'

export interface ParseRule {
  /** CSS selector the element must match. */
  readonly selector: string
  /** Higher runs first; default 50. Rules for the exact output of `render` use 100, so foreign shapes come after. */
  readonly priority?: number
  /** A matching element is a block even when its tag is inline (a button's link in a row of buttons). */
  readonly block?: boolean
  /** Attributes for this element, or null when the rule does not apply after all. */
  parse(el: Element, ctx: ParseContext): ParseMatch | null
}

export interface ParseMatch {
  /** Stored-shape attributes. Unknown ones are ignored; invalid ones are repaired and reported by validation. */
  readonly attrs: Readonly<Record<string, unknown>>
  /** For a container: the nodes its children are parsed from (a quote's content, a list's items). */
  readonly children?: Iterable<Node>
}

export interface ParseContext {
  readonly source: ImportSource
  /**
   * Inline content as rich text: formats from elements and styles, block
   * boundaries inside as line breaks, whitespace collapsed as a browser shows
   * it (kept as is for preformatted text and for Proza's own output).
   */
  richText(nodes: Node | Iterable<Node>, options?: { readonly preformatted?: boolean }): RichTextValue
  /**
   * The shared supports read from the element and what it inherits from
   * unwrapped ancestors: `anchor`, `textAlign`, `lang`, `dir`, `align`,
   * `size`, `color` and `bleed` (Proza's classes). Only those the block's schema has are kept.
   */
  supports(el: Element): Record<string, unknown>
  /** An address through the protocol allow-list; `''` (and a report entry) when it fails. */
  url(raw: string | null | undefined): string
  /**
   * A picture address: allowed addresses stay; a picture stored in the
   * document (a data URI) or out of reach (a Word `file://` path) becomes a
   * pending upload, and `src` is empty until it is done.
   */
  picture(raw: string | null | undefined): string
  /** Image width preset and alignment from the element's size, float and the like. */
  imageLayout(img: Element): { readonly width?: 's' | 'm' | 'l'; readonly align?: 'start' | 'center' | 'end' }
  /** Whether the node is a block in the flow (a paragraph, a list, a picture that leaves the text), not inline content. */
  blockish(node: Node): boolean
  /** The next element sibling when it matches `selector`; it then belongs to this block and is not parsed again. */
  takeNext(el: Element, selector: string): Element | null
  report(code: ReportCode, detail?: string): void
}

/** A block type as the import pipeline sees it: schema plus parse rules. */
export interface ImportBlock extends BlockSchema {
  readonly parse?: readonly ParseRule[]
}

/** What block definitions carry for the import (one definition per type). */
export interface Parseable {
  readonly parse?: readonly ParseRule[]
}
