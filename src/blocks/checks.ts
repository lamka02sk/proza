/**
 * Checker rules of the core block types: what each type
 * needs to be accessible. Server-safe, like the schemas: model and checker
 * only. Each `*-edit.ts` joins its types' rules into their definitions.
 */
import { type BlockRule, type Finding, linkName, declaresNewWindow, isVague, looksLikeFileName } from '../a11y-check'
import { type RichTextValue, slice } from '../model/richtext'
import { defaultAttrs } from '../model/schema'
import { type Block, type BlockNode, childrenOf, parentOf } from '../model/tree'

const str = (n: BlockNode, k: string): string => (typeof n.attrs[k] === 'string' ? n.attrs[k] : '')
const rich = (n: BlockNode, k: string): RichTextValue => {
  const v = n.attrs[k]
  return typeof v === 'object' && v !== null && typeof (v as RichTextValue).text === 'string' ? v as RichTextValue : { text: '', formats: [] }
}
const words = (v: RichTextValue): string => v.text.replaceAll('￼', '').trim()

// ---------------------------------------------------------------------------
// Images and media

export const imageRules: readonly BlockRule[] = [(n) => {
  const src = str(n, 'src')
  if (src === '') return []
  const out: Finding[] = []
  const alt = str(n, 'alt')
  if (n.attrs.decorative === true) {
    // A decorative picture has no name; as the only thing in a link, it leaves the link without one.
    if (str(n, 'href') !== '') out.push({ rule: 'link-empty', group: 'links', severity: 'error', blockId: n.id })
    return out
  }
  if (alt.trim() === '') out.push({ rule: 'alt-missing', group: 'media', severity: 'error', blockId: n.id })
  else if (looksLikeFileName(alt, src)) out.push({ rule: 'alt-filename', group: 'media', severity: 'warning', blockId: n.id, params: { text: alt } })
  return out
}]

export const videoRules: readonly BlockRule[] = [(n) =>
  str(n, 'src') !== '' && str(n, 'captions') === '' ? [{ rule: 'captions-missing', group: 'media', severity: 'error', blockId: n.id }] : []]

export const audioRules: readonly BlockRule[] = [(n) =>
  str(n, 'src') !== '' && words(rich(n, 'transcript')) === '' ? [{ rule: 'transcript-missing', group: 'media', severity: 'error', blockId: n.id }] : []]

export const embedRules: readonly BlockRule[] = [(n) =>
  str(n, 'url') !== '' && str(n, 'title').trim() === '' ? [{ rule: 'embed-title', group: 'media', severity: 'warning', blockId: n.id }] : []]

/** A frame is named by its title (WCAG 4.1.2). */
export const frameRules: readonly BlockRule[] = [(n) =>
  str(n, 'src') !== '' && str(n, 'title').trim() === '' ? [{ rule: 'frame-title', group: 'media', severity: 'warning', blockId: n.id }] : []]

// ---------------------------------------------------------------------------
// Structure

const HEADING = 'core/heading'
const PARAGRAPH = 'core/paragraph'

/** Removing the block leaves its container with something in it. */
const removable = (ctx: Parameters<BlockRule>[1], id: string): boolean => {
  const parent = parentOf(ctx.tree, id)
  return parent === null || childrenOf(ctx.tree, parent).length > 1
}

export const headingRules: readonly BlockRule[] = [(n, ctx) => {
  const out: Finding[] = []
  const level = typeof n.attrs.level === 'number' ? n.attrs.level : 2
  if (words(rich(n, 'content')) === '') {
    if (n.id !== ctx.current) {
      out.push({
        rule: 'heading-empty', group: 'structure', severity: 'error', blockId: n.id,
        ...(removable(ctx, n.id) ? { fix: () => [{ type: 'removeBlocks', ids: [n.id] }] } : {}),
      })
    }
    return out
  }
  // The page's own title is the first level; content starts below it.
  const prev = ctx.previous(n.id, HEADING)
  const before = prev === null ? 1 : (ctx.tree.nodes.get(prev)!.attrs.level as number)
  if (level > before + 1) {
    out.push({
      rule: 'heading-skip', group: 'structure', severity: 'warning', blockId: n.id, params: { from: before, to: level },
      fix: () => [{ type: 'setAttrs', id: n.id, patch: { level: before + 1 } }],
    })
  }
  return out
}]

/** "- ", "* ", "• ", "1. ", "2) ", "a) " at the start of a line of text. */
const MARK = /^\s*(?:([-*•·–])|(\d{1,3}|[a-z])[.)])\s+/

function listMark(n: BlockNode | undefined): { kind: 'bullet' | 'number'; length: number } | null {
  if (n?.type !== PARAGRAPH) return null
  const m = MARK.exec(rich(n, 'content').text)
  return m ? { kind: m[1] ? 'bullet' : 'number', length: m[0].length } : null
}

export const paragraphRules: readonly BlockRule[] = [(n, ctx) => {
  const out: Finding[] = []
  const parent = parentOf(ctx.tree, n.id)
  const siblings = childrenOf(ctx.tree, parent)
  const i = ctx.index(n.id)
  const text = rich(n, 'content').text
  if (text === '') {
    // Empty lines used as space: screen readers say "blank" for each. The last line is where the author writes next.
    if (n.id !== ctx.current && i < siblings.length - 1) out.push({ rule: 'empty', group: 'structure', severity: 'warning', blockId: n.id, fix: () => [{ type: 'removeBlocks', ids: [n.id] }] })
    return out
  }
  const mark = listMark(n)
  if (!mark || listMark(ctx.tree.nodes.get(siblings[i - 1] ?? ''))?.kind === mark.kind) return out
  const run: { node: BlockNode; length: number }[] = []
  for (let j = i; j < siblings.length; j++) {
    const s = ctx.tree.nodes.get(siblings[j]!)!
    const m = listMark(s)
    if (m?.kind !== mark.kind) break
    run.push({ node: s, length: m.length })
  }
  if (run.length < 2) return out
  const list = ctx.schemas.get('core/list'), item = ctx.schemas.get('core/list-item')
  const holder = parent === null ? undefined : ctx.schemas.get(ctx.tree.nodes.get(parent)!.type)
  const allowed = holder?.children ? holder.children.allowed : undefined
  const fits = list !== undefined && item !== undefined && (allowed === undefined || allowed.includes('core/list'))
  out.push({
    rule: 'fake-list', group: 'structure', severity: 'warning', blockId: n.id, params: { count: run.length },
    ...(fits ? {
      fix: () => {
        const items: Block[] = run.map((r) => ({
          id: ctx.createId(), type: 'core/list-item',
          attrs: { ...defaultAttrs(item), content: slice(rich(r.node, 'content'), r.length) },
        }))
        return [{ type: 'replaceBlocks', ids: run.map((r) => r.node.id), blocks: [{ id: ctx.createId(), type: 'core/list', attrs: { ...defaultAttrs(list), style: mark.kind }, children: items }] }]
      },
    } : {}),
  })
  return out
}]

// ---------------------------------------------------------------------------
// Tables

export const tableRules: readonly BlockRule[] = [(n, ctx) => {
  const rows = childrenOf(ctx.tree, n.id)
  const cells = rows.flatMap((r) => childrenOf(ctx.tree, r))
  if (cells.length === 0) return []
  const node = (id: string): BlockNode => ctx.tree.nodes.get(id)!
  const withPictures = cells.filter((c) => childrenOf(ctx.tree, c).some((k) => node(k).type === 'core/image')).length
  // One row of parts side by side, or pictures in many cells: a table used to place things (WCAG 1.3.1).
  if ((rows.length === 1 && cells.length > 1) || withPictures * 2 >= cells.length) {
    return [{ rule: 'table-layout', group: 'tables', severity: 'warning', blockId: n.id }]
  }
  const out: Finding[] = []
  if (!cells.some((c) => node(c).attrs.header === true)) {
    const first = childrenOf(ctx.tree, rows[0]!)
    out.push({
      rule: 'table-headers', group: 'tables', severity: 'error', blockId: n.id,
      fix: () => first.map((c) => ({ type: 'setAttrs', id: c, patch: { header: true, scope: 'col' } })),
    })
  }
  if (words(rich(n, 'caption')) === '') out.push({ rule: 'table-caption', group: 'tables', severity: 'warning', blockId: n.id, attr: 'caption' })
  return out
}]

// ---------------------------------------------------------------------------
// Links

export const buttonRules: readonly BlockRule[] = [(n) => {
  const text = rich(n, 'text')
  const name = linkName(text, 0, text.text.length)
  if (str(n, 'href') === '' || name === '') return []
  const out: Finding[] = []
  if (isVague(name)) out.push({ rule: 'link-vague', group: 'links', severity: 'warning', blockId: n.id, attr: 'text', params: { text: name } })
  if (n.attrs.newWindow === true && !declaresNewWindow(name)) {
    out.push({ rule: 'link-new-window', group: 'links', severity: 'warning', blockId: n.id, attr: 'text', params: { text: name }, fix: () => [{ type: 'setAttrs', id: n.id, patch: { newWindow: false } }] })
  }
  return out
}]

/** The rules of each core type, for the definitions to join. */
const CORE: Readonly<Record<string, readonly BlockRule[]>> = {
  'core/image': imageRules, 'core/video': videoRules, 'core/audio': audioRules, 'core/embed': embedRules, 'core/frame': frameRules,
  [HEADING]: headingRules, [PARAGRAPH]: paragraphRules, 'core/table': tableRules, 'core/button': buttonRules,
}

export const checksFor = (type: string): readonly BlockRule[] => CORE[type] ?? []
