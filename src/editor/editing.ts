/**
 * How a block type is edited in the canvas: which
 * rich-text attributes are typed into, in what order, and what Enter,
 * Backspace, Delete and Tab do at its edges. Behaviour lives here; the Vue
 * component that draws it is `edit`.
 */
import type { Component } from 'vue'
import type { BlockRule } from '../a11y-check'
import type { BlockRuleMatch } from '../model/input-rules'
import { type Mark, type FormatRegistry, type RichTextValue } from '../model/richtext'
import type { AttrSpecs, SchemaRegistry } from '../model/schema'
import type { Parseable } from '../import/rules'
import type { RenderableBlock } from '../render/render'
import type { Operation } from '../model/operations'
import { type Block, type BlockNode, type ParentId, type Tree, childrenOf, isSelfOrAncestor } from '../model/tree'
import type { EditorSelection } from './selection'
import type { MediaKind, ToPatch } from './upload'
import { type Strings, excerpt } from './strings'

export interface FieldSpec {
  /** A `richtext` attribute of the block. */
  readonly attr: string
  /** Shown after the children (a quote's citation). */
  readonly after?: boolean
  /** Hidden while empty unless the selection is in the block, and never a target of joining. */
  readonly optional?: boolean
  /** Enter adds a line break; Enter on two empty lines at the end leaves the block (code). */
  readonly multiline?: boolean
  /** Markdown-like input rules. Default true. */
  readonly inputRules?: boolean
}

/** What a structural edit does: operations, the selection after, and what to tell a screen reader. */
export interface Change {
  readonly ops: readonly Operation[]
  readonly selection: EditorSelection
  readonly announce?: string
  /** Pending marks for the next typed text at the new caret (formatting carried across Enter). */
  readonly marks?: readonly Mark[]
  /** Set when the change is typing (a line break in code), so it coalesces like typing. */
  readonly typed?: string
}

export interface StructureContext {
  readonly tree: Tree
  readonly schemas: SchemaRegistry
  readonly editing: EditingRegistry
  readonly formats: FormatRegistry
  readonly strings: Strings
  readonly createId: () => string
  /** The block that holds the selection: optional fields inside it are shown. */
  readonly current: string | null
  /** The selection when the edit starts, for edits that keep it (indenting). */
  readonly selection: EditorSelection
  /**
   * Whether the interface offers an inserter entry or format (the preset).
   * Edits that create a type (input rules, Show as) ask first. Omitted: everything.
   */
  readonly offers?: (id: string) => boolean
}

/** Whether the preset offers `id`: an inserter entry (`core/list/number`), a block type or a format. */
export function offered(ctx: Pick<StructureContext, 'offers'>, id: string): boolean {
  return ctx.offers?.(id) ?? true
}

/**
 * A line drawing for the add menu's tile, on a 96 by 48 grid: ink paths,
 * accent paths, and accent dots as [cx, cy, r].
 */
export interface Drawing {
  readonly ink?: readonly string[]
  readonly accent?: readonly string[]
  readonly dots?: readonly (readonly [number, number, number])[]
}

/** One entry of the inserter, the `/` menu and the starters. */
export interface InserterItem {
  /** Unique: the block type, or the type and a variation (`core/list/number`). */
  readonly id: string
  title(strings: Strings): string
  /** Search words that need no translation: the technical name. Localised words come from the interface strings. */
  readonly keywords?: readonly string[]
  /** `text`, `media`, `layout`, `data` or `utility`. */
  readonly category: string
  readonly drawing: Drawing
  /** The new blocks, with fresh ids. */
  create(ctx: Pick<StructureContext, 'schemas' | 'createId'>): Block[]
}

/**
 * Turning parts into this type: pictures into a gallery,
 * parts into a group or columns. Declared by the type made; offered for the selected parts.
 */
export interface Transform {
  /** Unique: the type made and what from (`core/gallery/from-images`). */
  readonly id: string
  /** The type it makes: the preset must offer it. */
  readonly type: string
  title(strings: Strings): string
  /** The change for these parts (siblings, in order), or null when it does not apply to them. */
  run(ctx: StructureContext, ids: readonly string[]): Change | null
}

export interface BlockEditing {
  readonly name: string
  /** Ways to turn selected parts into this type. */
  readonly transforms?: readonly Transform[]
  /** Rich-text attributes typed into, in reading order. The first one not `after` is the main text. */
  readonly fields: readonly FieldSpec[]
  /** The canvas component. Receives the prop `id`. */
  readonly edit?: Component
  /** Rows of its own in the part options. Receives the props `id` and `node`. */
  readonly inspector?: Component
  /**
   * Tools drawn over the canvas beside the part while the selection is inside it (a table's
   * cell tools). Receives the prop `id`. One Tab stop of its own after the text; Alt+F10 reaches it first.
   */
  readonly tools?: Component
  /** The kind of block in plain language ("Text", "Heading 2"). */
  title(node: BlockNode, strings: Strings): string
  /** Accessible name. Default: the title and the start of the main text ("Text: Proza is a block editor"). */
  label?(node: BlockNode, strings: Strings): string
  /** Textbox name of a field ("Heading 2", "Citation"). */
  fieldLabel?(node: BlockNode, attr: string, strings: Strings): string
  /** What Enter at the end of the main text creates: `same` keeps the type, otherwise a type name. Default `core/paragraph`. */
  readonly enterCreates?: string
  /** Attributes copied to the new block when Enter splits this one into two of the same type. */
  readonly carry?: readonly string[]
  /** Removed when its last child and all its text are gone (a list, a quote). */
  readonly removeWhenEmpty?: boolean
  /** Enter in an empty last child moves that child out after this container (a quote). */
  readonly exitOnEmptyEnter?: boolean
  /** Enter at the end of the main text starts the first child, not a block after (a details summary). */
  readonly enterInside?: boolean
  /** Never left without children: an empty paragraph takes the last one's place (a table cell, a column). */
  readonly keepsChild?: boolean
  /**
   * Edits never cross its edge: Backspace and Delete do not join text across it, and blocks
   * that do not fit inside go after the outermost isolating block around it, which is never split
   * (a table and its rows and cells, columns and their columns).
   */
  readonly isolating?: boolean
  /**
   * A fixed part of its container's structure (a table row or cell): block commands do not
   * move or duplicate it, and removing it empties it instead. Its container's own commands change the structure.
   */
  readonly fixed?: boolean
  /** After a child was removed or moved away, put the container right (columns follow their count). Null: nothing to do. */
  tidy?(tree: Tree, id: string): readonly Operation[] | null
  /**
   * The options open on the part inside rather than on this one (columns, a group): it frames
   * other parts. The options name the path from it to the caret, so each level stays reachable.
   */
  readonly frame?: boolean
  /** Enter in the empty main text, before the default (a list item outdents). Null falls through. */
  enterEmpty?(ctx: StructureContext, id: string): Change | null
  /** Backspace at the start of the main text, before the default (a list item outdents). Null falls through. */
  backspaceAtStart?(ctx: StructureContext, id: string): Change | null
  /** Tab and Shift+Tab in the main text. Null: not possible here (the key is still taken). */
  indent?(ctx: StructureContext, id: string): Change | null
  outdent?(ctx: StructureContext, id: string): Change | null
  /** Entries in the inserter. None: the block is not offered (a list item, which lives in a list). */
  readonly inserter?: readonly InserterItem[]
  /** Always a named group, selected as a whole (a picture): it has no main text, only optional fields. */
  readonly group?: boolean
  /**
   * The block holds an uploaded file of this kind. A pasted or dropped file of
   * the kind becomes one such block; `patch` turns the upload into its attributes.
   */
  readonly media?: { readonly kind: MediaKind; readonly patch: ToPatch }
  /**
   * Not offered unless the host switches it on (`EditorOptions.enable`): raw HTML.
   * Content of the type still loads and renders.
   */
  readonly offByDefault?: boolean
  /** A block input rule was typed in the main text (`# `, `- `, ...). Null leaves the typed text alone. */
  blockRule?(ctx: StructureContext, id: string, match: BlockRuleMatch): Change | null
  /** Checker rules of this type: a picture's description, a table's headers. Their words go in `Strings.checkRules`. */
  readonly a11y?: readonly BlockRule[]
}

export type EditingRegistry = ReadonlyMap<string, BlockEditing>

/**
 * One block type as the editor takes it:
 * schema and output (`RenderableBlock`, server-safe), editing, and the parse
 * rules that recognise it in imported HTML, in one object.
 */
export interface BlockDefinition<A extends AttrSpecs = AttrSpecs> extends RenderableBlock<A>, BlockEditing, Parseable {}

/** A preset: the inserter entries, block types and formats the interface offers. */
export interface Preset {
  readonly blocks: readonly string[]
  readonly formats: readonly string[]
}

export function editingRegistry(defs: readonly BlockEditing[]): EditingRegistry {
  const map = new Map<string, BlockEditing>()
  for (const d of defs) {
    if (map.has(d.name)) throw new Error(`Editing for ${d.name} is registered twice`)
    map.set(d.name, d)
  }
  return map
}

/** The main text field: the first that is not shown after the children. */
export function mainField(def: BlockEditing | undefined): FieldSpec | undefined {
  return def?.fields.find((f) => !f.after)
}

/** Accessible name of a block, for its wrapper in select mode, the list view and announcements. */
export function blockLabel(def: BlockEditing | undefined, node: BlockNode, strings: Strings): string {
  if (!def) return strings.unsupported(node.type)
  if (def.label) return def.label(node, strings)
  const main = mainField(def)
  return strings.blockLabel(def.title(node, strings), main ? excerpt(fieldValue(node, main.attr).text) : '')
}

export function fieldValue(node: BlockNode, attr: string): RichTextValue {
  const v = node.attrs[attr]
  return isRichText(v) ? v : { text: '', formats: [] }
}

export function isRichText(v: unknown): v is RichTextValue {
  return typeof v === 'object' && v !== null && typeof (v as RichTextValue).text === 'string' && Array.isArray((v as RichTextValue).formats)
}

// ---------------------------------------------------------------------------
// Stops: the places the caret and the arrow keys visit, in reading order.

/** A field to type into, or (field null) a block without text that is selected as a whole. */
export interface Stop {
  readonly blockId: string
  readonly field: string | null
}

export function sameStop(a: Stop, b: Stop): boolean {
  return a.blockId === b.blockId && a.field === b.field
}

/** Whether an optional field is shown: it has text, or the selection is in its block. */
export function fieldVisible(ctx: Pick<StructureContext, 'tree' | 'current'>, node: BlockNode, spec: FieldSpec): boolean {
  if (!spec.optional || fieldValue(node, spec.attr).text !== '') return true
  return ctx.current !== null && ctx.tree.nodes.has(ctx.current) && isSelfOrAncestor(ctx.tree, node.id, ctx.current)
}

/** Every stop under `parent`, in reading order. */
export function stops(ctx: Pick<StructureContext, 'tree' | 'editing' | 'current'>, parent: ParentId = null): Stop[] {
  return stopsOf(ctx, childrenOf(ctx.tree, parent))
}

/** Stops inside the subtree of `id`, itself included. Walks only that subtree: callers ask once per selected part. */
export function stopsIn(ctx: Pick<StructureContext, 'tree' | 'editing' | 'current'>, id: string): Stop[] {
  return ctx.tree.nodes.has(id) ? stopsOf(ctx, [id]) : []
}

function stopsOf(ctx: Pick<StructureContext, 'tree' | 'editing' | 'current'>, ids: readonly string[]): Stop[] {
  const out: Stop[] = []
  const walk = (list: readonly string[]): void => {
    for (const id of list) {
      const node = ctx.tree.nodes.get(id)!
      const def = ctx.editing.get(node.type)
      const kids = ctx.tree.children.get(id)
      const visible = (def?.fields ?? []).filter((f) => fieldVisible(ctx, node, f))
      const before = visible.filter((f) => !f.after), after = visible.filter((f) => f.after)
      for (const f of before) out.push({ blockId: id, field: f.attr })
      // A block with no text of its own and nothing inside is visited as a whole (a separator, an empty quote).
      if (visible.length === 0 && (!kids || kids.length === 0)) out.push({ blockId: id, field: null })
      if (kids) walk(kids)
      for (const f of after) out.push({ blockId: id, field: f.attr })
    }
  }
  walk(ids)
  return out
}

/** The stop before (-1) or after (1) `from`. `from` may be a field that is not visible. */
export function neighbourStop(ctx: Pick<StructureContext, 'tree' | 'editing' | 'current'>, from: Stop, dir: -1 | 1): Stop | null {
  const list = stops(ctx)
  const i = list.findIndex((s) => sameStop(s, from))
  if (i < 0) return null
  return list[i + dir] ?? null
}
