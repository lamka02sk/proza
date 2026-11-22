/**
 * Blocks as the import builds them, before ids and validation, and the pure
 * stages over them: size presets from font sizes (stage 6) and fitting the
 * tree to the schema's nesting rules. No DOM.
 */
import { type BlockSchema, type SchemaRegistry, attrSpecs } from '../model/schema'
import type { RichTextValue } from '../model/richtext'
import { type Reporter } from './report'
import { sizePreset } from './style'

export interface RawBlock {
  readonly type: string
  /** Stored-shape attributes; validation checks them later. */
  readonly attrs: Readonly<Record<string, unknown>>
  readonly children?: readonly RawBlock[]
  /** The font size every character of the block's text shares, in pixels. */
  readonly fontPx?: number
  /** Characters of text, which weighs the block when finding the body size. */
  readonly chars?: number
  /** A picture whose file must be uploaded: the key of its entry in the import's pending media. */
  readonly media?: number
}

/** The text size of the body: the size most characters have, unstyled text counting as 16 px. */
export function bodySize(blocks: readonly RawBlock[]): number {
  const weight = new Map<number, number>()
  const walk = (list: readonly RawBlock[]): void => {
    for (const b of list) {
      // Headings are large by nature; the body is everything else.
      const px = Math.round((b.fontPx ?? 16) * 2) / 2
      if (b.type !== 'core/heading') weight.set(px, (weight.get(px) ?? 0) + (b.chars ?? 0))
      if (b.children) walk(b.children)
    }
  }
  walk(blocks)
  let best = 16, most = -1
  for (const [px, w] of weight) if (w > most || (w === most && px === 16)) { best = px; most = w }
  return best
}

/**
 * Stage 6 for text sizes: a block whose text is all one size, clearly smaller
 * or larger than the body, gets the small or large preset if its type has one.
 */
export function applySizes(blocks: readonly RawBlock[], schemas: SchemaRegistry, report: Reporter): RawBlock[] {
  const base = bodySize(blocks)
  const walk = (list: readonly RawBlock[]): RawBlock[] => list.map((b) => {
    const children = b.children ? walk(b.children) : undefined
    let attrs = b.attrs
    if (b.fontPx !== undefined && (b.chars ?? 0) > 0) {
      const preset = sizePreset(b.fontPx, base)
      if (preset !== '') {
        if (schemas.get(b.type)?.supports?.size) attrs = { ...attrs, size: preset }
        else if (!/^core\/heading$/.test(b.type)) report.add('size', `${Math.round(b.fontPx)} px`)
      }
    }
    return children ? { ...b, attrs, children } : { ...b, attrs }
  })
  return walk(blocks)
}

// ---------------------------------------------------------------------------
// Fitting to the schema

export function isRichTextValue(v: unknown): v is RichTextValue {
  return typeof v === 'object' && v !== null && typeof (v as RichTextValue).text === 'string' && Array.isArray((v as RichTextValue).formats)
}

function allowedIn(child: BlockSchema, parent: BlockSchema | null): boolean {
  if (parent === null) return child.parent === undefined
  const kids = parent.children
  if (kids === undefined || kids === false) return false
  if (kids.allowed && !kids.allowed.includes(child.name)) return false
  return child.parent === undefined || child.parent.includes(parent.name)
}

function hasText(b: RawBlock): boolean {
  return Object.values(b.attrs).some((v) => isRichTextValue(v) && v.text !== '')
}

/**
 * Make the tree obey `children.allowed` and `parent`: text that a container
 * cannot hold becomes the type it can (a paragraph in a list becomes an item),
 * blocks that must have a parent get one (stray list items get a list), and
 * anything else moves out after its container, which splits there. A numbered
 * container that splits continues its numbering. Containers left empty go.
 */
export function fitTree(blocks: readonly RawBlock[], schemas: SchemaRegistry, report: Reporter): RawBlock[] {
  return fitList(blocks, null, schemas, report)
}

function fitList(list: readonly RawBlock[], parent: BlockSchema | null, schemas: SchemaRegistry, report: Reporter): RawBlock[] {
  const out: RawBlock[] = []
  let stray = null as { schema: BlockSchema; items: RawBlock[] } | null
  const flush = (): void => {
    if (!stray) return
    const wrapType = stray.schema.parent![0]!
    for (const b of fitBlock({ type: wrapType, attrs: {}, children: stray.items }, parent, schemas, report)) out.push(b)
    stray = null
  }
  for (const b of list) {
    const schema = schemas.get(b.type)
    if (!schema) continue
    const placed = fitBlock(b, parent, schemas, report)
    for (const p of placed) {
      const s = schemas.get(p.type)!
      // A block that needs a parent of a type this level is not: wrap it and its neighbours.
      if (s.parent && (parent === null || !s.parent.includes(parent.name)) && schemas.has(s.parent[0]!)) {
        if (stray?.schema !== s) { flush(); stray = { schema: s, items: [] } }
        stray.items.push(p)
        continue
      }
      flush()
      out.push(p)
    }
  }
  flush()
  return out
}

/** The block fitted inside `parent`: itself, or itself split around children it cannot hold, which come back to the caller. */
function fitBlock(b: RawBlock, parent: BlockSchema | null, schemas: SchemaRegistry, report: Reporter): RawBlock[] {
  const schema = schemas.get(b.type)!
  const container = schema.children !== undefined && schema.children !== false
  if (!container) return [b.children ? withChildren(b, undefined) : b]
  const fitted = fitList(b.children ?? [], schema, schemas, report)
  const out: RawBlock[] = []
  let segment: RawBlock[] = []
  let first = true
  let offset = 0
  const close = (): void => {
    const start = b.attrs.start
    const attrs = !first
      ? { ...b.attrs, anchor: '', ...(typeof start === 'number' ? { start: start + offset } : {}) }
      : b.attrs
    const part = withChildren({ ...b, attrs }, segment)
    // An empty container goes, unless it is itself text (a list item whose words are still to come).
    if (segment.length > 0 || (first && (hasText(b) || attrSpecs(schema).content?.type === 'richtext'))) {
      out.push(part)
      offset += segment.length
      first = false
    }
    segment = []
  }
  for (const c of fitted) {
    const cs = schemas.get(c.type)!
    if (allowedIn(cs, schema)) { segment.push(c); continue }
    const converted = convert(c, schema, schemas)
    if (converted) { segment.push(converted); continue }
    report.add('moved', c.type)
    close()
    out.push(c)
  }
  close()
  return out
}

/** Text the container cannot hold as it is, as a type it can hold that has the same main text. */
function convert(c: RawBlock, container: BlockSchema, schemas: SchemaRegistry): RawBlock | null {
  if (c.children && c.children.length > 0) return null
  const content = c.attrs.content
  if (!isRichTextValue(content)) return null
  const kids = container.children
  const allowed = kids && kids.allowed ? kids.allowed : []
  for (const t of allowed) {
    const s = schemas.get(t)
    if (s && attrSpecs(s).content?.type === 'richtext' && allowedIn(s, container)) {
      const keep = Object.fromEntries(Object.entries(c.attrs).filter(([k]) => k in attrSpecs(s)))
      return { type: t, attrs: keep }
    }
  }
  return null
}

function withChildren(b: RawBlock, children: readonly RawBlock[] | undefined): RawBlock {
  const out: { -readonly [K in keyof RawBlock]: RawBlock[K] } = { ...b }
  delete out.children
  if (children) out.children = children
  return out
}
