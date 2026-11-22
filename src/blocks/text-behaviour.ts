/**
 * Editing behaviour of the core text blocks:
 * fields, Enter and Backspace at their edges, list nesting, block input rules,
 * and the commands that change a block's type. No Vue here: the components
 * that draw them are in `text-edit.ts`.
 */
import type { BlockRuleMatch } from '../model/input-rules'
import { type Attrs, type Block, type BlockNode, parentOf } from '../model/tree'
import type { Command, CommandHost } from '../editor/commands'
import { type BlockEditing, type Change, type InserterItem, type StructureContext, fieldValue, offered } from '../editor/editing'
import { caret } from '../editor/selection'
import { Draft, canHold, newBlock, retype } from '../editor/structure'

export const PARAGRAPH = 'core/paragraph'
export const HEADING = 'core/heading'
export const LIST = 'core/list'
export const LIST_ITEM = 'core/list-item'
export const QUOTE = 'core/quote'
export const CODE = 'core/code'
export const PREFORMATTED = 'core/preformatted'
export const SEPARATOR = 'core/separator'

const TEXT_CARRY = ['textAlign', 'lang', 'dir', 'size', 'color'] as const

const name = (type: string) => (_node: BlockNode, s: { blockNames: Readonly<Record<string, string>> }): string => s.blockNames[type] ?? type

/** Offsets of a text selection in `id`, so an edit that moves the block keeps the caret where it was. */
function keepCaret(ctx: StructureContext, id: string, field = 'content'): ReturnType<typeof caret> {
  const s = ctx.selection
  return s.kind === 'text' && s.blockId === id ? { ...s, field } : caret(id, field, 0)
}

// ---------------------------------------------------------------------------
// Lists

/** How many lists contain the item: 1 for a top-level list. */
export function listLevel(ctx: Pick<StructureContext, 'tree'>, id: string): number {
  let level = 0
  for (let p = parentOf(ctx.tree, id); p !== null; p = parentOf(ctx.tree, p)) if (ctx.tree.nodes.get(p)?.type === LIST) level++
  return level
}

/** A list with the look of `like` (style and numbering), for new nesting levels and split halves. */
function listLike(ctx: StructureContext, like: BlockNode): Block {
  const { style, numbering } = like.attrs
  return newBlock(ctx, LIST, { style, numbering })
}

/** Tab: the item goes into the list of the item before it, with everything nested under it. */
export function indentItem(ctx: StructureContext, id: string): Change | null {
  const d = new Draft(ctx)
  const list = d.parent(id)
  if (list === null) return null
  const kids = d.kids(list)
  const i = kids.indexOf(id)
  const prev = kids[i - 1]
  if (prev === undefined) return null
  const prevKids = d.kids(prev)
  const last = prevKids.at(-1)
  if (last !== undefined && d.node(last).type === LIST) d.move([id], last, d.kids(last).length)
  else {
    const sub = listLike(ctx, d.node(list))
    d.insert(prev, prevKids.length, [sub])
    d.move([id], sub.id, 0)
  }
  return d.done(keepCaret(ctx, id), { announce: ctx.strings.level(listLevel(d.now(), id)) })
}

/**
 * Shift+Tab: a nested item moves up a level, taking the items after it as its
 * own children (they stay below it). A top-level item becomes text, splitting the list.
 */
export function outdentItem(ctx: StructureContext, id: string): Change | null {
  const d = new Draft(ctx)
  const list = d.parent(id)
  if (list === null) return null
  const outer = d.parent(list)
  const kids = d.kids(list)
  const following = kids.slice(kids.indexOf(id) + 1)
  const item = d.node(id)

  if (outer !== null && d.node(outer).type === LIST_ITEM) {
    if (following.length > 0) {
      const own = d.kids(id)
      const last = own.at(-1)
      let target: string
      if (last !== undefined && d.node(last).type === LIST) target = last
      else {
        const sub = listLike(ctx, d.node(list))
        d.insert(id, own.length, [sub])
        target = sub.id
      }
      d.move(following, target, d.kids(target).length)
    }
    d.move([id], d.parent(outer), d.index(outer) + 1)
    if (d.kids(list).length === 0) d.remove([list])
    return d.done(keepCaret(ctx, id), { announce: ctx.strings.level(listLevel(d.now(), id)) })
  }

  // Top level: the item becomes text between two halves of the list.
  const up = d.parent(list)
  const nested = d.kids(id).flatMap((sub) => [...d.kids(sub)])
  const after = [...nested, ...following]
  const paragraph: Block = {
    ...newBlock(ctx, PARAGRAPH, { content: fieldValue(item, 'content'), lang: item.attrs.lang, dir: item.attrs.dir }),
    id,
  }
  if (!canHold(d, up, PARAGRAPH)) return null
  if (after.length > 0) {
    const rest = listLike(ctx, d.node(list))
    d.insert(up, d.index(list) + 1, [rest])
    d.move(after, rest.id, 0)
  }
  d.remove([id])
  d.insert(up, d.index(list) + 1, [paragraph])
  if (d.kids(list).length === 0) d.remove([list])
  return d.done(keepCaret(ctx, id), { announce: ctx.strings.changedTo(ctx.strings.blockNames[PARAGRAPH] ?? PARAGRAPH) })
}

/** A checklist item is done, or no longer done. The caret stays where it is. */
export function toggleCheck(ctx: StructureContext, id: string): Change | null {
  const node = ctx.tree.nodes.get(id)
  const list = node?.type === LIST_ITEM ? parentOf(ctx.tree, id) : null
  if (!node || list === null || ctx.tree.nodes.get(list)?.attrs.style !== 'check') return null
  const done = node.attrs.checked !== true
  return { ops: [{ type: 'setAttrs', id, patch: { checked: done } }], selection: ctx.selection, announce: done ? ctx.strings.checked : ctx.strings.unchecked }
}

// ---------------------------------------------------------------------------
// Block input rules: the paragraph becomes what its prefix asks for.

function paragraphRule(ctx: StructureContext, id: string, match: BlockRuleMatch): Change | null {
  const d = new Draft(ctx)
  const node = d.node(id)
  const parent = d.parent(id)
  const rest = match.rest
  const keep: Attrs = { lang: node.attrs.lang, dir: node.attrs.dir }
  const replaceWith = (blocks: Block[], at: { id: string }, type: string): Change | null => {
    if (!blocks.every((b) => canHold(d, parent, b.type))) return null
    d.apply({ type: 'replaceBlocks', ids: [id], blocks })
    return d.done(caret(at.id, 'content', 0), { announce: ctx.strings.changedTo(title(type, blocks[0]!, ctx)) })
  }
  const { rule } = match
  // The preset decides what typing may create: in `basic`, `> ` stays text.
  const item = rule.kind === 'list' ? (rule.style === 'bullet' ? LIST : `${LIST}/${rule.style}`) : ({ heading: HEADING, quote: QUOTE, code: CODE, separator: SEPARATOR } as const)[rule.kind]
  if (!offered(ctx, item)) return null
  switch (rule.kind) {
    case 'heading': {
      const b: Block = { ...newBlock(ctx, HEADING, { ...keep, textAlign: node.attrs.textAlign, level: rule.level, content: rest }), id }
      return replaceWith([b], b, HEADING)
    }
    case 'list': {
      const item: Block = { ...newBlock(ctx, LIST_ITEM, { ...keep, content: rest, checked: rule.style === 'check' && rule.checked }), id }
      const list = newBlock(ctx, LIST, { style: rule.style, start: rule.style === 'number' ? rule.start : 1 }, [item])
      return replaceWith([list], item, LIST)
    }
    case 'quote': {
      const p: Block = { ...newBlock(ctx, PARAGRAPH, { ...keep, content: rest }), id }
      return replaceWith([newBlock(ctx, QUOTE, keep, [p])], p, QUOTE)
    }
    case 'code': {
      const b: Block = { ...newBlock(ctx, CODE, { content: { text: rest.text, formats: [] }, language: rule.language }), id }
      return replaceWith([b], b, CODE)
    }
    case 'separator': {
      const p: Block = { ...newBlock(ctx, PARAGRAPH, { ...keep, content: rest }), id }
      return replaceWith([newBlock(ctx, SEPARATOR), p], p, SEPARATOR)
    }
  }
}

function title(type: string, block: Block, ctx: StructureContext): string {
  if (type === HEADING) return ctx.strings.heading(block.attrs.level as number)
  return ctx.strings.blockNames[type] ?? type
}

// ---------------------------------------------------------------------------
// Show as (the part options): text, heading, list or quote.

export type ShowAs = 'text' | 'heading' | 'list' | 'quote'

/** What a part shows as now (the pressed button), or null for other blocks. */
export function shownAs(node: BlockNode): ShowAs | null {
  switch (node.type) {
    case PARAGRAPH: return 'text'
    case HEADING: return 'heading'
    case LIST: return 'list'
    case QUOTE: return 'quote'
    default: return null
  }
}

/** Blocks with one text and no children: paragraph, heading, code, preformatted. */
const SINGLE = new Set([PARAGRAPH, HEADING, CODE, PREFORMATTED])

/**
 * Change how a part shows, keeping every character in reading order: text
 * and headings swap, become a list of one item or go into a quote; a list
 * becomes paragraphs; a quote lets its children out. Null when it cannot.
 */
/** The inserter entry a Show as choice stands for, which the preset must offer. */
export const SHOW_AS_TYPE: Readonly<Record<ShowAs, string>> = { text: PARAGRAPH, heading: HEADING, list: LIST, quote: QUOTE }

export function showAs(ctx: StructureContext, id: string, kind: ShowAs): Change | null {
  if (!offered(ctx, SHOW_AS_TYPE[kind])) return null
  const d = new Draft(ctx)
  if (!d.has(id)) return null
  const node = d.node(id)
  if (shownAs(node) === kind) return null
  const parent = d.parent(id)
  const keep: Attrs = { lang: node.attrs.lang, dir: node.attrs.dir }
  const name = ctx.strings.blockNames[kind === 'text' ? PARAGRAPH : kind === 'heading' ? HEADING : kind === 'list' ? LIST : QUOTE] ?? kind
  const finish = (fallback: string): Change => {
    const s = ctx.selection
    const kept = (s.kind === 'text' && d.has(s.blockId) && s.field in d.node(s.blockId).attrs) || (s.kind === 'blocks' && d.has(s.anchorId) && d.has(s.focusId))
    return d.done(kept ? s : caret(fallback, 'content', 0), { announce: ctx.strings.changedTo(name) })
  }
  const single = SINGLE.has(node.type)
  switch (kind) {
    case 'text':
    case 'heading': {
      if (single) return retype(ctx, [id], kind === 'text' ? PARAGRAPH : HEADING, kind === 'heading' ? { level: 2 } : {}, ctx.selection.kind === 'text' ? ctx.selection : undefined)
      if (kind === 'heading') return null
      if (node.type === LIST) {
        // Every item, nested ones too, becomes a paragraph in reading order; items keep their ids, so the caret stays.
        const items: Block[] = []
        const walk = (list: string): void => {
          for (const item of d.kids(list)) {
            const n = d.node(item)
            items.push({ ...newBlock(ctx, PARAGRAPH, { content: fieldValue(n, 'content'), lang: n.attrs.lang, dir: n.attrs.dir }), id: item })
            for (const sub of d.kids(item)) walk(sub)
          }
        }
        walk(id)
        if (!canHold(d, parent, PARAGRAPH)) return null
        d.apply({ type: 'replaceBlocks', ids: [id], blocks: items })
        return finish(items[0]!.id)
      }
      if (node.type === QUOTE) {
        const kids = [...d.kids(id)]
        if (!kids.every((k) => canHold(d, parent, d.node(k).type))) return null
        const citation = fieldValue(node, 'citation')
        const at = d.index(id)
        d.move(kids, parent, at)
        // The citation is text too: it stays, as a paragraph after the quotation.
        if (citation.text !== '') d.insert(parent, at + kids.length, [newBlock(ctx, PARAGRAPH, { ...keep, content: citation })])
        d.remove([id])
        return finish(kids[0] ?? id)
      }
      return null
    }
    case 'list': {
      const asItem = (n: BlockNode): Block => ({ ...newBlock(ctx, LIST_ITEM, { content: fieldValue(n, 'content'), lang: n.attrs.lang, dir: n.attrs.dir }), id: n.id })
      if (!canHold(d, parent, LIST)) return null
      if (single) {
        d.apply({ type: 'replaceBlocks', ids: [id], blocks: [newBlock(ctx, LIST, { style: 'bullet' }, [asItem(node)])] })
        return finish(id)
      }
      if (node.type === QUOTE) {
        const kids = d.kids(id)
        if (kids.length === 0 || !kids.every((k) => d.node(k).type === PARAGRAPH)) return null
        const items = kids.map((k) => asItem(d.node(k)))
        const citation = fieldValue(node, 'citation')
        if (citation.text !== '') items.push(newBlock(ctx, LIST_ITEM, { content: citation }))
        d.apply({ type: 'replaceBlocks', ids: [id], blocks: [newBlock(ctx, LIST, { style: 'bullet' }, items)] })
        return finish(items[0]!.id)
      }
      return null
    }
    case 'quote': {
      if (!canHold(d, parent, QUOTE)) return null
      d.apply({ type: 'replaceBlocks', ids: [id], blocks: [newBlock(ctx, QUOTE, keep, [d.block(id)])] })
      return finish(id)
    }
  }
}

// ---------------------------------------------------------------------------
// Inserter entries.

const item = (id: string, type: string, drawing: InserterItem['drawing'], create: InserterItem['create'], keywords: readonly string[] = []): InserterItem => ({
  id, category: 'text', drawing, create, keywords: [type.replace('core/', ''), ...keywords],
  title: (s) => s.blockNames[id] ?? s.blockNames[type] ?? type,
})

const paragraphItem = item(PARAGRAPH, PARAGRAPH, { ink: ['M6 9h84M6 19h84M6 29h84M6 39h50'] }, (ctx) => [newBlock(ctx, PARAGRAPH)], ['paragraph'])
const headingItem = item(HEADING, HEADING, { accent: ['M6 11h54M6 20h36'], ink: ['M6 33h84M6 42h62'] }, (ctx) => [newBlock(ctx, HEADING, { level: 2 })], ['h2'])
const listItems = [
  item(LIST, LIST, { dots: [[9, 10, 3.5], [9, 24, 3.5], [9, 38, 3.5]], ink: ['M22 10h68M22 24h68M22 38h44'] },
    (ctx) => [newBlock(ctx, LIST, { style: 'bullet' }, [newBlock(ctx, LIST_ITEM)])], ['ul', 'bullet']),
  item(`${LIST}/number`, LIST, { accent: ['M7 6v8M6 19.5h4l-4 6h4M6 33h4l-2 3.2a2.4 2.4 0 1 1-2 3.6'], ink: ['M22 10h68M22 24h68M22 38h44'] },
    (ctx) => [newBlock(ctx, LIST, { style: 'number' }, [newBlock(ctx, LIST_ITEM)])], ['ol', 'number']),
  item(`${LIST}/check`, LIST, { ink: ['M6 5h9v9H6zM6 20h9v9H6zM6 35h9v9H6z', 'M24 10h66M24 25h66M24 40h44'], accent: ['m7.5 9.5 2 2 4-4M7.5 24.5l2 2 4-4'] },
    (ctx) => [newBlock(ctx, LIST, { style: 'check' }, [newBlock(ctx, LIST_ITEM)])], ['todo', 'checkbox', 'task']),
]
const quoteItem = item(QUOTE, QUOTE, { accent: ['M8 8v32'], ink: ['M22 13h66M22 24h66M22 35h40'] }, (ctx) => [newBlock(ctx, QUOTE, {}, [newBlock(ctx, PARAGRAPH)])], ['blockquote'])
const codeItem = item(CODE, CODE, { ink: ['M32 13 20 24l12 11M64 13l12 11-12 11'], accent: ['M53 9 43 39'] }, (ctx) => [newBlock(ctx, CODE)])
const preformattedItem = item(PREFORMATTED, PREFORMATTED, { ink: ['M6 9h40M16 19h50M16 29h30M6 39h60'] }, (ctx) => [newBlock(ctx, PREFORMATTED)], ['pre'])
const separatorItem = item(SEPARATOR, SEPARATOR, { ink: ['M6 9h60M6 39h44'], accent: ['M6 24h84'] }, (ctx) => [newBlock(ctx, SEPARATOR)], ['hr'])

// ---------------------------------------------------------------------------
// Definitions

export const paragraphEditing: BlockEditing = {
  inserter: [paragraphItem],
  name: PARAGRAPH,
  fields: [{ attr: 'content' }],
  title: name(PARAGRAPH),
  enterCreates: 'same',
  carry: TEXT_CARRY,
  blockRule: paragraphRule,
}

export const headingEditing: BlockEditing = {
  inserter: [headingItem],
  name: HEADING,
  fields: [{ attr: 'content' }],
  title: (node, s) => s.heading(node.attrs.level as number),
  carry: TEXT_CARRY,
}

export const listEditing: BlockEditing = {
  inserter: listItems,
  name: LIST,
  fields: [],
  title: name(LIST),
  removeWhenEmpty: true,
}

export const listItemEditing: BlockEditing = {
  name: LIST_ITEM,
  fields: [{ attr: 'content' }],
  title: name(LIST_ITEM),
  enterCreates: 'same',
  carry: ['lang', 'dir'],
  // Enter in an empty item, and Backspace at the start of a first item, step out a level.
  enterEmpty: outdentItem,
  backspaceAtStart: (ctx, id) => {
    const list = parentOf(ctx.tree, id)
    return list !== null && ctx.tree.children.get(list)?.[0] === id ? outdentItem(ctx, id) : null
  },
  indent: indentItem,
  outdent: outdentItem,
}

export const quoteEditing: BlockEditing = {
  inserter: [quoteItem],
  name: QUOTE,
  fields: [{ attr: 'citation', after: true, optional: true }],
  title: name(QUOTE),
  fieldLabel: (_n, attr, s) => s.fieldNames[attr] ?? attr,
  removeWhenEmpty: true,
  exitOnEmptyEnter: true,
}

export const codeEditing: BlockEditing = {
  inserter: [codeItem],
  name: CODE,
  fields: [{ attr: 'content', multiline: true, inputRules: false }],
  title: name(CODE),
}

export const preformattedEditing: BlockEditing = {
  inserter: [preformattedItem],
  name: PREFORMATTED,
  fields: [{ attr: 'content', multiline: true, inputRules: false }],
  title: name(PREFORMATTED),
}

export const separatorEditing: BlockEditing = {
  inserter: [separatorItem],
  name: SEPARATOR,
  fields: [],
  title: name(SEPARATOR),
}

export const textEditing: readonly BlockEditing[] = [
  paragraphEditing, headingEditing, listEditing, listItemEditing, quoteEditing, codeEditing, preformattedEditing, separatorEditing,
]

// ---------------------------------------------------------------------------
// Commands

const toText = (type: string, attrs: Attrs = {}) => (h: CommandHost): boolean => {
  const ctx = h.context()
  if (!offered(ctx, type)) return false
  const ids = h.targets()
  const sel = h.selection
  return h.apply(retype(ctx, ids, type, attrs, sel.kind === 'text' ? sel : undefined))
}

/** Paragraphs into a new list (siblings become its items), or a list item's list changes style. */
const toList = (style: 'bullet' | 'number') => (h: CommandHost): boolean => {
  const ctx = h.context()
  if (!offered(ctx, style === 'bullet' ? LIST : `${LIST}/number`)) return false
  const ids = h.targets()
  const first = ids[0]
  if (first === undefined) return false
  const node = ctx.tree.nodes.get(first)!
  if (node.type === LIST_ITEM) {
    const list = parentOf(ctx.tree, first)!
    if (ctx.tree.nodes.get(list)!.attrs.style === style) return false
    return h.apply({ ops: [{ type: 'setAttrs', id: list, patch: { style } }], selection: h.selection, announce: ctx.strings.changedTo(ctx.strings.blockNames[LIST] ?? LIST) })
  }
  if (!ids.every((id) => ctx.tree.nodes.get(id)?.type === PARAGRAPH)) return false
  const d = new Draft(ctx)
  const items = ids.map((id): Block => {
    const p = d.node(id)
    return { ...newBlock(ctx, LIST_ITEM, { content: fieldValue(p, 'content'), lang: p.attrs.lang, dir: p.attrs.dir }), id }
  })
  const parent = d.parent(first)
  if (!canHold(d, parent, LIST)) return false
  const list = newBlock(ctx, LIST, { style }, items)
  d.apply({ type: 'replaceBlocks', ids, blocks: [list] })
  return h.apply(d.done(h.selection, { announce: ctx.strings.changedTo(ctx.strings.blockNames[LIST] ?? LIST) }))
}

const inItem = (h: CommandHost): string | null => {
  const s = h.selection
  if (s.kind !== 'text') return null
  const node = h.context().tree.nodes.get(s.blockId)
  return node?.type === LIST_ITEM && s.field === 'content' ? s.blockId : null
}

const headingKeys = (n: number) => [{ keys: `Alt+Shift+${n}`, mac: false }, { keys: `Ctrl+Alt+${n}`, mac: true }]

export const textCommands: readonly Command[] = [
  { name: 'toParagraph', keys: headingKeys(0), run: toText(PARAGRAPH) },
  ...[1, 2, 3, 4, 5, 6].map((level): Command => ({ name: `toHeading${level}`, keys: headingKeys(level), run: toText(HEADING, { level }) })),
  { name: 'toBulletList', keys: [{ keys: 'Mod+Shift+8' }], run: toList('bullet') },
  { name: 'toNumberList', keys: [{ keys: 'Mod+Shift+7' }], run: toList('number') },
  {
    name: 'toggleCheck',
    group: 'text',
    when: 'text',
    keys: [{ keys: 'Mod+Enter' }],
    run: (h) => { const id = inItem(h); return id !== null && h.apply(toggleCheck(h.context(), id)) },
  },
  {
    name: 'indent',
    group: 'text',
    when: 'text',
    keys: [{ keys: 'Tab' }],
    // In a list item Tab always stays in the editor, even when it cannot indent; Escape then Tab leaves.
    run: (h) => { const id = inItem(h); if (id === null) return false; h.apply(indentItem(h.context(), id)); return true },
  },
  {
    name: 'outdent',
    group: 'text',
    when: 'text',
    keys: [{ keys: 'Shift+Tab' }],
    run: (h) => { const id = inItem(h); if (id === null) return false; h.apply(outdentItem(h.context(), id)); return true },
  },
]
