/**
 * Blocks on the clipboard. Copy writes three formats: the
 * internal JSON, HTML from the renderer, and plain text. Paste reads the
 * internal JSON first. The clipboard is a trust boundary:
 * what comes back is validated like loaded JSON and gets fresh ids.
 */
import type { FormatRegistry } from '../model/richtext'
import { DOC_VERSION, type SchemaRegistry, serializeDoc, validateDoc } from '../model/schema'
import { type Block, type ParentId, type Tree, getBlock, parentOf } from '../model/tree'
import { escapeAttr } from '../render/html'
import { type RenderRegistry, renderBlocks } from '../render/render'
import { CLIP_ATTR, PROZA_MIME, clipFromHtml } from '../richtext/field'
import { isRichText } from './editing'

/** Above this the clipboard JSON is ignored rather than parsed: no editor document is this large. */
const MAX_JSON = 20_000_000

/**
 * The blocks to copy for sibling `ids`. Blocks that cannot stand alone (list
 * items) travel inside a copy of their parent holding only them, so they
 * validate and paste as a list.
 */
export function blocksToCopy(tree: Tree, schemas: SchemaRegistry, ids: readonly string[]): Block[] {
  return wrapForCopy(tree, schemas, ids[0] === undefined ? null : parentOf(tree, ids[0]), ids.map((id) => getBlock(tree, id)))
}

/** `blocks`, children of `parent`, inside copies of their ancestors until they can stand alone. */
export function wrapForCopy(tree: Tree, schemas: SchemaRegistry, from: ParentId, blocks: readonly Block[]): Block[] {
  let out = [...blocks]
  let parent = from
  while (parent !== null && out.some((b) => schemas.get(b.type)?.parent !== undefined)) {
    const node = tree.nodes.get(parent)!
    out = [{ id: node.id, type: node.type, attrs: node.attrs, children: out }]
    parent = parentOf(tree, parent)
  }
  return out
}

/**
 * `open`: the blocks are a slice of text across parts: pasted
 * at a caret, the first joins the text before it and the last the text after.
 */
export function writeBlocks(data: DataTransfer, blocks: readonly Block[], registry: RenderRegistry, formats: FormatRegistry, open = false): void {
  const json = JSON.stringify({ version: 1, ...(open ? { open: true } : {}), blocks: serializeDoc({ version: DOC_VERSION, blocks }, registry).blocks })
  data.setData('text/plain', plainText(blocks))
  data.setData(PROZA_MIME, json)
  // Firefox drops custom types on the system clipboard, so the JSON also rides in the HTML.
  data.setData('text/html', `<div ${CLIP_ATTR}="${escapeAttr(json)}">${renderBlocks(blocks, registry, { formats })}</div>`)
}

/** Text of every rich-text attribute in reading order, blocks separated by a blank line. */
export function plainText(blocks: readonly Block[]): string {
  const parts: string[] = []
  const walk = (list: readonly Block[]): void => {
    for (const b of list) {
      const text = Object.values(b.attrs).filter(isRichText).map((v) => v.text.replaceAll('￼', '')).filter((t) => t !== '')
      parts.push(...text)
      if (b.children) walk(b.children)
    }
  }
  walk(blocks)
  return parts.join('\n\n')
}

/**
 * Blocks from the internal format, validated against the schema, with fresh
 * ids. Null when the data holds no blocks (inline content or foreign data).
 */
/** `refuse`: block types a paste drops with their children (types that are off, such as raw HTML). */
export interface ClipReadOptions { formats: FormatRegistry; createId: () => string; anchors: ReadonlySet<string>; refuse?: ReadonlySet<string> }

export function readBlocks(data: DataTransfer, schemas: SchemaRegistry, options: ClipReadOptions): Block[] | null {
  return readClip(data, schemas, options)?.blocks ?? null
}

/** Blocks as readBlocks reads them, and whether they are an open slice (writeBlocks). */
export function readClip(data: DataTransfer, schemas: SchemaRegistry, options: ClipReadOptions): { blocks: Block[]; open: boolean } | null {
  const raw = clipJson(data)
  if (raw === null) return null
  const list = (raw as { blocks?: unknown }).blocks
  if (!Array.isArray(list) || list.length === 0) return null
  const { doc } = validateDoc({ version: DOC_VERSION, blocks: list }, schemas, { formats: options.formats, createId: options.createId })
  const fresh = (b: Block): Block => {
    // A pasted anchor that already exists in the document would make two elements with one id.
    const anchor = b.attrs.anchor
    const attrs = typeof anchor === 'string' && anchor !== '' && options.anchors.has(anchor) ? { ...b.attrs, anchor: '' } : b.attrs
    const base = { id: options.createId(), type: b.type, attrs }
    return b.children ? { ...base, children: keep(b.children).map(fresh) } : base
  }
  // Clipboard JSON can come from any page's copy handler: a type this editor has off does not come in that way.
  const keep = (blocks: readonly Block[]): readonly Block[] => (options.refuse?.size ? blocks.filter((b) => !options.refuse!.has(b.type)) : blocks)
  const blocks = keep(doc.blocks).map(fresh)
  return blocks.length === 0 ? null : { blocks, open: (raw as { open?: unknown }).open === true }
}

function clipJson(data: DataTransfer): object | null {
  const json = data.getData(PROZA_MIME) || clipFromHtml(data.getData('text/html'))
  if (!json || json.length > MAX_JSON) return null
  let raw: unknown
  try { raw = JSON.parse(json) } catch { return null }
  return typeof raw === 'object' && raw !== null && (raw as { version?: unknown }).version === 1 ? raw : null
}
