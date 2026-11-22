/**
 * The content checker (ATAG B.3): rules that find
 * accessibility problems in a document and, where one exists, a repair.
 *
 * Model only: a rule reads the tree and returns findings; a repair is a list
 * of operations the editor applies as one undo step. Messages are not here:
 * the editor's strings name each rule (`checkRules`), so a finding is data.
 */
import type { Operation } from '../model/operations'
import { type FormatRegistry, type RichTextValue, defaultFormats } from '../model/richtext'
import { type SchemaRegistry, attrSpecs } from '../model/schema'
import { type BlockNode, type Tree, childrenOf, parentOf } from '../model/tree'

/** `error`: a reader loses something (a picture without a description). `warning`: likely a problem, worth a look. */
export type Severity = 'error' | 'warning'

/** The checker's groups; plugins may use their own. */
export type CheckGroup = 'media' | 'structure' | 'tables' | 'links' | 'text' | (string & Record<never, never>)

export type CheckParams = Readonly<Record<string, string | number>>

export interface Finding {
  /** Names the rule and its message (`alt-missing`). */
  readonly rule: string
  readonly group: CheckGroup
  readonly severity: Severity
  readonly blockId: string
  /** Where in the block: a rich-text attribute, and a range of its text. */
  readonly attr?: string
  readonly start?: number
  readonly end?: number
  /** Values the message names: the heading levels, the link text. */
  readonly params?: CheckParams
  /** An automatic repair as operations on the tree the finding came from. */
  readonly fix?: () => readonly Operation[]
}

export interface CheckContext {
  readonly tree: Tree
  readonly schemas: SchemaRegistry
  readonly formats: FormatRegistry
  /** Every block id in reading order. */
  readonly order: readonly string[]
  /** BCP 47 tag of the content's language. */
  readonly lang: string
  /** Colour presets readable on the page; null when not known, which turns the colour rule off. */
  readonly colors: ReadonlySet<string> | null
  /** The block with the caret: rules about empty parts leave it alone while the author writes in it. */
  readonly current: string | null
  readonly createId: () => string
  /** The closest block of `type` before `id` in reading order, or null. */
  previous(id: string, type: string): string | null
  /** Position of a block among its siblings. */
  index(id: string): number
  /** The block's language, from itself or the closest block around it that sets one; '' for the content's. */
  langOf(id: string): string
}

/** A rule of one block type (`BlockDefinition.a11y`), called for every block of that type. */
export type BlockRule = (node: BlockNode, ctx: CheckContext) => readonly Finding[]
/** A rule over the whole document (generic rules, plugins). */
export type DocumentRule = (ctx: CheckContext) => readonly Finding[]

export interface CheckOptions {
  readonly tree: Tree
  readonly schemas: SchemaRegistry
  readonly formats?: FormatRegistry
  readonly lang?: string
  readonly colors?: ReadonlySet<string> | null
  readonly current?: string | null
  readonly createId?: () => string
  /** Rules by block type. */
  readonly blockRules?: (type: string) => readonly BlockRule[] | undefined
  readonly documentRules?: readonly DocumentRule[]
}

/** The block ids of a tree in reading order. */
export function readingOrder(tree: Tree): string[] {
  const out: string[] = []
  const walk = (ids: readonly string[]): void => {
    for (const id of ids) { out.push(id); const kids = tree.children.get(id); if (kids) walk(kids) }
  }
  walk(childrenOf(tree, null))
  return out
}

export function checkContext(options: CheckOptions): CheckContext {
  const { tree } = options
  const order = readingOrder(tree)
  // Siblings are looked up by position: one pass over each child list instead of one search per block.
  const indexes = new Map<string, number>()
  for (const list of tree.children.values()) list.forEach((id, i) => indexes.set(id, i))
  const previousByType = new Map<string, Map<string, string | null>>()
  const langs = new Map<string, string>()
  const ctx: CheckContext = {
    tree,
    schemas: options.schemas,
    formats: options.formats ?? defaultFormats,
    order,
    lang: options.lang ?? '',
    colors: options.colors ?? null,
    current: options.current ?? null,
    createId: options.createId ?? (() => Math.random().toString(36).slice(2, 14)),
    previous(id, type) {
      let map = previousByType.get(type)
      if (!map) {
        map = new Map()
        let last: string | null = null
        for (const b of order) { map.set(b, last); if (tree.nodes.get(b)?.type === type) last = b }
        previousByType.set(type, map)
      }
      return map.get(id) ?? null
    },
    index(id) {
      return indexes.get(id) ?? -1
    },
    langOf(id) {
      const known = langs.get(id)
      if (known !== undefined) return known
      const own = tree.nodes.get(id)?.attrs.lang
      const parent = parentOf(tree, id)
      const lang = typeof own === 'string' && own !== '' ? own : parent === null ? '' : ctx.langOf(parent)
      langs.set(id, lang)
      return lang
    },
  }
  return ctx
}

/** Every finding of a document, in reading order (and by position inside a block). */
export function check(options: CheckOptions): Finding[] {
  const ctx = checkContext(options)
  const out: Finding[] = []
  for (const id of ctx.order) {
    const node = ctx.tree.nodes.get(id)
    if (!node) continue
    for (const rule of options.blockRules?.(node.type) ?? []) out.push(...rule(node, ctx))
  }
  for (const rule of options.documentRules ?? []) out.push(...rule(ctx))
  const at = new Map(ctx.order.map((id, i) => [id, i]))
  return out
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (at.get(a.f.blockId) ?? 0) - (at.get(b.f.blockId) ?? 0) || (a.f.start ?? -1) - (b.f.start ?? -1) || a.i - b.i)
    .map(({ f }) => f)
}

/** The rich-text attributes of a block, in the order its schema lists them. */
export function richTextAttrs(node: BlockNode, schemas: SchemaRegistry): { attr: string; value: RichTextValue }[] {
  const schema = schemas.get(node.type)
  if (!schema) return []
  let names = richNames.get(schema)
  if (!names) {
    names = Object.entries(attrSpecs(schema)).filter(([, spec]) => spec.type === 'richtext').map(([attr]) => attr)
    richNames.set(schema, names)
  }
  return names.flatMap((attr) => {
    const v = node.attrs[attr]
    return typeof v === 'object' && v !== null && typeof (v as RichTextValue).text === 'string' ? [{ attr, value: v as RichTextValue }] : []
  })
}

/** The rich-text attribute names of each schema, worked out once: the checker asks for every block. */
const richNames = new WeakMap<object, readonly string[]>()
