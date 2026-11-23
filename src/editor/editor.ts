/**
 * The editor core: the document store, the selection,
 * history, the fields, keyboard navigation between blocks, block selection,
 * clipboard and announcements. The interface draws the canvas from the
 * reactive state here (`src/ui/canvas.ts`) and never changes the document itself.
 *
 * Storage: the model's flat Tree, plus one shallowRef per
 * block and per child list, so an edit re-renders only the blocks it touched.
 */
import { nextTick, reactive, shallowReactive, shallowRef, type ShallowRef } from 'vue'
import { type DocumentRule, type Finding, type Severity, check as checkDocument, genericRules } from '../a11y-check'

export type { Finding } from '../a11y-check'
import type { ClassMapping } from '../import/inline'
import { type ImportOptions, type ImportResult, type PendingMedia, importHtml, importText } from '../import/pipeline'
import { type ImportReport, type ImportSource } from '../import/report'
import type { ImportBlock } from '../import/rules'
import type { PaletteEntry } from '../import/style'
import { type TreeChanges, treeChanges } from '../model/changes'
import { embedFor, isPlayerUrl } from '../model/embeds'
import { type LegacyPolicy, type LegacyRules, legacyRules } from '../model/legacy'
import { type History, emptyHistory, record, redo as redoHistory, transact, undo as undoHistory, type Origin, type Typing } from '../model/history'
import { type Operation, applyOperations } from '../model/operations'
import { type FormatRegistry, type Mark, type RichTextValue, defaultFormats, findChange, slice, deleteRange, replace as replaceText } from '../model/richtext'
import { DOC_VERSION, attrSpecs, blockRegistry, serializeDoc, validateDoc, type StoredDoc, type ValidationIssue } from '../model/schema'
import { type Block, type BlockNode, type ParentId, type Tree, EMPTY_TREE, blocksFromTree, childrenOf, createId as defaultCreateId, parentOf, subtreeIds, treeFromBlocks } from '../model/tree'
import { type RenderRegistry, renderBlocks, renderLabels } from '../render/render'
import { FIELD_SHORTCUTS, RichTextField, type ChangeOrigin, type FieldDrop, type FieldShortcut, matchesShortcut } from '../richtext/field'
import { type TextSelection, domPointToOffset, offsetToDomPoint } from '../richtext/dom'
import { activeElementFor, hasFocusWithin, selectionSourceFor } from '../richtext/selection'
import { Announcer, type Politeness } from './announcer'
import { type ClipReadOptions, blocksToCopy, readBlocks, readClip, writeBlocks } from './clipboard'
import { CORE_COMMANDS, type Command, type CommandHost, type CommandRegistry, type KeyOverrides, Keymap, type UiRequest, commandRegistry, keyboardHelp, type HelpGroup } from './commands'
import {
  type BlockDefinition, type BlockEditing, type Change, type EditingRegistry, type Preset, type Stop, type StructureContext, type Transform,
  blockLabel, editingRegistry, fieldValue, isRichText, mainField, neighbourStop, stops, stopsIn,
} from './editing'
import { type FindOptions, type Match, findMatches, findPattern, replaceMatches } from './find'
import { frozen, lockViolation } from './locks'
import { type Counts, type DocumentCounts, countDocument, countText } from './stats'
import { en } from './locale-en'
import { type FormatEdit, type RangeSelection, copyAcross, coveredBlocks, deleteAcross, formatAcross, marksAcross, normalizeRange, partCount, pieces, rangeBlocks, rangeEnds, replaceAcross, splitAcross, andThen } from './range'
import { type EditorSelection, type TextPoint, NO_SELECTION, blocks as blockSelection, caret, cells as cellSelection, focusBlock, liftToSiblings, selectedBlocks, selectionsEqual } from './selection'
import type { Strings } from './strings'
import type { UploadEvent } from './upload'
import { Draft, canHold, fitValue, insertAfter, mergeBackward, mergeForward, newBlock, pasteBlocks, pasteInline, removeBlocks, splitBlock, stopEdge } from './structure'
import { CELL, TABLE, type CellDirection, cellIn, cellToward, cellsToCopy, clearCells, enclosing, fillCells, selectedCells, selectionRect, tableGrid } from './table'

export interface EditorOptions {
  /** Block types: schema, output and editing. */
  readonly blocks: readonly BlockDefinition[]
  /** What the interface offers; omitted offers everything. Content of other types still loads and renders. */
  readonly preset?: Preset
  /** Commands beyond the core ones (block libraries add theirs). */
  readonly commands?: readonly Command[]
  readonly formats?: FormatRegistry
  readonly strings?: Strings
  /** Replace or switch off command shortcuts (WCAG 2.1.4). */
  readonly keys?: KeyOverrides
  /** Replace the field's formatting shortcuts. */
  readonly fieldShortcuts?: readonly FieldShortcut[]
  /** Stored JSON to start with (validated), or HTML, which goes through the import pipeline. */
  readonly content?: unknown
  /** Where HTML content comes from when its markup does not say (`tinymce` for stored TinyMCE records). */
  readonly contentSource?: ImportSource
  /** How imported content maps to this site: its colours and the classes that mean something. */
  readonly import?: ImportSettings
  readonly createId?: () => string
  /** Shown read-only (TinyMCE's read-only mode): read, select and copy, nothing changes. `setReadOnly()` switches it. */
  readonly readOnly?: boolean
  /** Block types that are off unless switched on (`offByDefault`, raw HTML), switched on. */
  readonly enable?: readonly string[]
  /**
   * The raw HTML block's markup in `getHTML()`: the host's sanitiser. Without it raw HTML
   * goes out as written when the block is switched on, for the server to sanitise, and not at all otherwise.
   */
  readonly rawHtml?: (html: string) => string | null
  /** Checker rules over the whole document beyond the built-in ones (plugins); rules of one type go on its definition. */
  readonly checks?: readonly DocumentRule[]
  /** Language of the content (BCP 47): the published page's words and the checker's. Default: the interface's (`strings.lang`). */
  readonly contentLanguage?: string
  /**
   * What saving does while the checker finds errors (`a11y.onSave`): `warn` (default)
   * saves and says how many are left; `block` does not save, and the interface shows them.
   */
  readonly onSave?: 'warn' | 'block'
  /**
   * Keep legacy HTML (decision 0020): HTML content and the source view import with its styles,
   * classes and frames as the policy says, and `getHTML()` writes them back. Pasted content is
   * still converted to clean parts. `formats` must include `legacyFormats()`.
   */
  readonly legacy?: LegacyPolicy | true
}

/** A checker finding in words, as `validate()` returns it to the host. */
export interface CheckIssue {
  readonly rule: string
  readonly group: string
  readonly severity: Severity
  readonly blockId: string
  /** What is wrong, in the interface language. */
  readonly message: string
  /** What to do about it. */
  readonly hint: string
  /** The accessible name of the part it is in. */
  readonly part: string
  /** The checker can repair it (`Editor.fix`). */
  readonly fixable: boolean
  readonly finding: Finding
}

export interface ImportSettings {
  /** Named colours imported text colours map to; the rest are dropped and reported. */
  readonly palette?: readonly PaletteEntry[]
  /** Host classes that stand for a format or a block (TinyMCE). */
  readonly classes?: Readonly<Record<string, ClassMapping>>
  /** Justified text is offered, so imports keep it. */
  readonly justify?: boolean
}

/** Where imported content entered: a paste or drop, HTML content on load, the source view, a Word file. */
export type ImportOrigin = 'paste' | 'drop' | 'load' | 'source' | 'docx'

/** What an import did, for the author (the report) and the host. */
export interface ImportEvent {
  readonly origin: ImportOrigin
  readonly report: ImportReport
  /** Picture parts waiting for their file; the interface uploads those it has, and asks for the rest. */
  readonly pending: readonly PendingMedia[]
}

/**
 * Why the document changed: the origin of the edit (typing, paste, a command,
 * an import), Undo or Redo, or `reset` when the host replaced the content (`setContent`).
 */
export type ChangeReason = Origin | 'undo' | 'redo' | 'reset'

/**
 * One committed transaction (`blocksChange`). Blocks are in the editor's form
 * (validated attributes, no `version`). A conversion that keeps its id is an update; an insertion
 * moves its siblings, which `order` shows. A reset carries no changes: read `getJSON()`.
 */
export interface BlocksChangeEvent extends TreeChanges {
  /** The document revision after the change; it only grows. */
  readonly revision: number
  readonly reason: ChangeReason
}

export interface EditorEvents {
  change: () => void
  /** Once per committed transaction, after the editor applied it, in edit order. */
  blocksChange: (event: BlocksChangeEvent) => void
  /** An upload attempt started, progressed, or ended (`succeeded`, `failed`, `cancelled`). */
  upload: (event: UploadEvent) => void
  selection: (selection: EditorSelection) => void
  focus: () => void
  blur: () => void
  /** A command asks the interface for keyboard help (Alt+0), the toolbar (Alt+F10) or the outline. */
  ui: (name: UiRequest) => void
  /** Mod+K in a field (or on text across parts, null): the interface opens its link dialog. */
  requestLink: (field: RichTextField | null) => void
  /** Just before operations change the document: the interface measures what is about to move. */
  willChange: (ops: readonly Operation[]) => void
  /** `undoable`: the words describe a change Undo takes back (the status line offers it). */
  announce: (text: string, politeness: Politeness, undoable: boolean) => void
  /** Foreign content came in through the import pipeline. */
  import: (event: ImportEvent) => void
  /** The author asked to save (Mod+S). The host stores `getJSON()`; a form field submits its form. */
  save: () => void
}

/**
 * A key the interface takes before the field and the editor do (the `/` menu
 * takes arrows and Enter). True when taken; it must call preventDefault itself.
 */
export type KeyHook = (e: KeyboardEvent, where: { readonly blockId: string; readonly attr: string } | null) => boolean

/**
 * Files pasted or dropped into the canvas (pictures from the clipboard). The
 * interface uploads them (the host's adapter) and places blocks at `at`. True when taken.
 */
export type FileHook = (files: readonly File[], at: EditorSelection, source: 'paste' | 'drop') => boolean

/**
 * What the format bar acts on: the field with the selection, or text across
 * parts. A RichTextField is one.
 */
export interface FormatTarget {
  readonly element: HTMLElement
  allows(type: string): boolean
  activeMarks(): Mark[]
  formatAt(type: string): Mark | null
  toggleFormat(mark: Mark): void
  setLink(href: string | null, options?: { newWindow?: boolean }): void
  clearFormatting(): void
  selectionRects(): DOMRect[]
}

type Mode = 'edit' | 'select'
/** What a copy event writes, and what a cut then removes. */
interface PendingCopy { readonly blocks: Block[]; readonly count: number; readonly cut: (() => void) | null }
const FORM_CONTROL = 'input, textarea, select, button'
const PARAGRAPH = 'core/paragraph'

/** The key of a field in the registry of mounted fields. */
export const fieldKey = (blockId: string, attr: string): string => `${blockId}:${attr}`

function reportListenerError(e: unknown): void {
  // reportError shows the error as uncaught (the console, window.onerror) without throwing it here.
  if (typeof reportError === 'function') reportError(e)
  else console.error(e)
}

export class Editor implements CommandHost {
  readonly strings: Strings
  readonly registry: RenderRegistry
  /** @internal */
  readonly editing: EditingRegistry
  readonly formats: FormatRegistry
  readonly commands: CommandRegistry
  /** @internal */
  readonly keymap: Keymap
  /** @internal */
  readonly announcer: Announcer
  /** @internal */
  readonly fieldShortcuts: readonly FieldShortcut[]

  #tree: Tree = EMPTY_TREE
  #history: History<EditorSelection> = emptyHistory()
  #selection: EditorSelection = NO_SELECTION
  #mode: Mode = 'edit'
  #createId: () => string
  /** Vertical arrow keys keep the column they started from. */
  #goalX: number | null = null

  // Reactive state the canvas reads. Per-key collections, so a change of
  // selection re-renders only the blocks whose state changed.
  readonly #nodes = new Map<string, ShallowRef<BlockNode | undefined>>()
  readonly #kids = new Map<ParentId, ShallowRef<readonly string[]>>()
  readonly #selected = reactive(new Set<string>())
  readonly #current = reactive(new Set<string>())
  readonly #tabStop = reactive(new Set<string>())
  /** The mounted root element of each block, reported by the canvas. Reactive by key, so the interface follows a remount. */
  readonly #elements = shallowReactive(new Map<string, HTMLElement>())
  /** @internal */
  readonly selectionRef = shallowRef<EditorSelection>(NO_SELECTION)
  /** Counts changes to the document, for interface state that reads the tree (undo available, outline). */
  /** @internal */
  readonly revision = shallowRef(0)
  /** Counts `setContent` calls: work started for one document (an upload) must not land in the next, whose ids may repeat. */
  /** @internal */
  generation = 0
  /** Change events wait here while a listener's own edit is being reported, so hosts see them in edit order. */
  readonly #changeQueue: BlocksChangeEvent[] = []
  #reporting = false
  readonly #keyHooks = new Set<KeyHook>()
  readonly #fileHooks = new Set<FileHook>()
  readonly #offered: ReadonlySet<string> | null
  readonly #enabled: ReadonlySet<string>
  readonly #rawHtml: ((html: string) => string | null) | null
  readonly #legacy: LegacyPolicy | true | null
  /** The legacy policy compiled, when the host keeps legacy HTML. */
  /** @internal */
  readonly legacy: LegacyRules | null
  /** The code highlighter once loaded (lazy), for `getHTML()` and the canvas. */
  /** @internal */
  readonly highlighter = shallowRef<typeof import('../render/highlight') | null>(null)

  readonly #fields = new Map<string, RichTextField>()
  readonly #fieldKeys = new WeakMap<RichTextField, { blockId: string; attr: string }>()
  readonly #listeners = new Map<keyof EditorEvents, Set<(...args: never[]) => void>>()
  #canvas: HTMLElement | null = null
  #bin: HTMLElement | null = null
  #abort = new AbortController()
  /** Blocks being copied through execCommand('copy'), which fires a copy event outside the canvas. */
  #pendingCopy: PendingCopy | null = null
  /** The column Up and Down keep while moving through table rows. */
  #goalCol: number | null = null
  /** The block where a pointer drag started, for turning a drag across blocks into a block selection. */
  #dragFrom: string | null = null
  /** Where in the text a pointer drag started, and whether it has left that field (the editor then drives the selection). */
  #dragPoint: TextPoint | null = null
  #dragAcross = false
  /**
   * The canvas is editable while text is selected across parts: the
   * native selection can then span fields. Every input at that level is cancelled and
   * done on the model. Blocks without text read this to stay out of the editing.
   */
  /** @internal */
  readonly spanning = shallowRef(false)
  /** Nothing changes the document while set, except the host (`setContent`). The interface hides its editing tools. */
  readonly readOnly = shallowRef(false)
  #focused = false
  /** Set while announcing a change that Undo takes back. */
  #undoable = false
  readonly #importBlocks: readonly ImportBlock[]
  readonly #importSettings: ImportSettings
  readonly #contentSource: ImportSource | undefined
  /** The last import, so an interface mounted after HTML content loaded can still show its report. */
  lastImport: ImportEvent | null = null

  readonly #checks: readonly DocumentRule[]
  /** `a11y.onSave`. */
  readonly onSave: 'warn' | 'block'
  /** Language of the content (BCP 47). */
  readonly contentLanguage: string
  /** The words of the last save that found problems, so the status line can offer them. */
  /** @internal */
  checkNotice = ''

  constructor(options: EditorOptions) {
    this.registry = blockRegistry(options.blocks)
    this.editing = editingRegistry(options.blocks)
    this.#offered = options.preset ? new Set([...options.preset.blocks, ...options.preset.formats]) : null
    this.#enabled = new Set(options.enable ?? [])
    this.#rawHtml = options.rawHtml ?? null
    this.#legacy = options.legacy ?? null
    this.legacy = options.legacy ? legacyRules(options.legacy) : null
    this.formats = options.formats ?? defaultFormats
    this.strings = options.strings ?? en
    this.commands = commandRegistry([...CORE_COMMANDS, ...(options.commands ?? [])])
    this.keymap = new Keymap(this.commands, options.keys)
    this.fieldShortcuts = options.fieldShortcuts ?? FIELD_SHORTCUTS
    this.#createId = options.createId ?? defaultCreateId
    this.#importBlocks = options.blocks
    this.#importSettings = options.import ?? {}
    this.#contentSource = options.contentSource
    this.#checks = options.checks ?? []
    this.onSave = options.onSave ?? 'warn'
    this.contentLanguage = options.contentLanguage ?? this.strings.lang
    this.announcer = new Announcer(document)
    this.announcer.onAnnounce((t, p) => { this.#emit('announce', t, p, this.#undoable); this.#undoable = false })
    this.readOnly.value = options.readOnly === true
    this.setContent(options.content ?? { version: DOC_VERSION, blocks: [] })
  }

  /** Read-only on or off (a disabled form field, a page shown before the author may edit). */
  setReadOnly(on: boolean): void {
    if (this.readOnly.value === on) return
    this.readOnly.value = on
    if (on) this.#span(false)
    this.#refreshEditable()
  }

  /** Fields follow read-only and locks: a part locked whole, and everything inside it, is not typed into. */
  #refreshEditable(): void {
    for (const [field, key] of this.#fieldEntries()) field.setEditable(!this.readOnly.value && !frozen(this.#tree, key.blockId))
  }

  *#fieldEntries(): Generator<[RichTextField, { blockId: string; attr: string }]> {
    for (const f of this.#fields.values()) { const k = this.#fieldKeys.get(f); if (k) yield [f, k] }
  }

  // -------------------------------------------------------------------------
  // Public API

  /** The document as stored JSON. */
  getJSON(): StoredDoc {
    return serializeDoc({ version: DOC_VERSION, blocks: blocksFromTree(this.#tree) }, this.registry)
  }

  /** Nothing written: one empty text part, as a new document starts (a `required` field is missing its value). */
  isEmpty(): boolean {
    const top = childrenOf(this.#tree, null)
    const n = top.length === 1 ? this.#tree.nodes.get(top[0]!) : undefined
    return n?.type === PARAGRAPH && fieldValue(n, 'content').text === ''
  }

  getHTML(): string {
    const hl = this.highlighter.value
    const raw = this.#rawHtml ?? ([...this.editing.values()].some((d) => d.offByDefault && this.#enabled.has(d.name)) ? (s: string) => s : null)
    return renderBlocks(blocksFromTree(this.#tree), this.registry, {
      formats: this.formats, labels: renderLabels(this.contentLanguage), ...(hl ? { highlight: hl.tokenize } : {}), ...(raw ? { rawHtml: raw } : {}),
      ...(this.#legacy ? { legacy: this.#legacy } : {}),
    })
  }

  /**
   * The page as published, for the editor's own preview. Raw HTML goes into
   * the page only through the host's sanitiser; without one, `frames` holds the markup of each
   * raw part with text, in document order, for a sandboxed frame where its empty box is.
   */
  /** @internal */
  previewHTML(): { readonly html: string; readonly frames: readonly string[] } {
    const hl = this.highlighter.value
    const on = [...this.editing.values()].some((d) => d.offByDefault && this.#enabled.has(d.name))
    const frames: string[] = []
    const raw = this.#rawHtml ?? (on ? (s: string) => { frames.push(s); return '' } : null)
    const html = renderBlocks(blocksFromTree(this.#tree), this.registry, {
      formats: this.formats, labels: renderLabels(this.contentLanguage), ...(hl ? { highlight: hl.tokenize } : {}), ...(raw ? { rawHtml: raw } : {}),
      ...(this.#legacy ? { legacy: this.#legacy } : {}),
    })
    return { html, frames }
  }

  /** A frame from `src` is published as a frame: an embed provider's player, or a site the legacy policy lists. */
  /** @internal */
  frameAllowed(src: string): boolean {
    return (this.legacy !== null && (this.legacy.frame(src) !== undefined || (embedFor(src) !== null && /^https:/i.test(src.trim())))) || isPlayerUrl(src)
  }

  /** Load the code highlighter, once; the code blocks ask for it when they have a language. */
  /** @internal */
  loadHighlighter(): Promise<typeof import('../render/highlight')> {
    this.#highlighting ??= import('../render/highlight').then((m) => { this.highlighter.value = m; return m })
    return this.#highlighting
  }
  #highlighting: Promise<typeof import('../render/highlight')> | null = null

  /**
   * Replace the document with stored JSON (validated), or with HTML through
   * the import pipeline (legacy content: converted in memory, nothing is
   * stored until the host saves). Clears history. Returns what validation repaired.
   */
  setContent(content: unknown): readonly ValidationIssue[] {
    let json = content
    let imported: ImportResult | null = null
    if (typeof content === 'string') {
      imported = this.importHtml(content, { ...(this.#contentSource ? { source: this.#contentSource } : {}), ...(this.#legacy ? { legacy: this.#legacy } : {}) })
      json = serializeDoc({ version: DOC_VERSION, blocks: imported.blocks }, this.registry)
    }
    const { doc, issues } = validateDoc(json, this.registry, { formats: this.formats, createId: this.#createId })
    let tree = treeFromBlocks(doc.blocks)
    // The document is never empty, so there is always somewhere to type.
    if (childrenOf(tree, null).length === 0) tree = treeFromBlocks([newBlock(this.#ctx(), PARAGRAPH)])
    this.#history = emptyHistory()
    const first = this.generation === 0
    this.generation++
    this.#setTree(tree, null)
    this.#setSelection(NO_SELECTION)
    this.#emit('change')
    // The first content is the baseline, not a change.
    if (!first) this.#reportChange('reset', null)
    // After the new tree is in place, so the pictures waiting for upload find their parts.
    if (imported) this.#imported('load', imported)
    return issues
  }

  /**
   * Replace the document with stored JSON (validated) as one undo step: the
   * source view applies its JSON this way. Returns what validation repaired.
   */
  replaceContent(json: unknown, announce = ''): readonly ValidationIssue[] {
    const { doc, issues } = validateDoc(json, this.registry, { formats: this.formats, createId: this.#createId })
    this.#replaceAll(doc.blocks.map((b) => this.#fresh(b)), announce)
    return issues
  }

  /** Every top-level part replaced by `blocks` as they are (an import's ids, which its pending uploads name), one undo step. */
  #replaceAll(given: readonly Block[], announce: string): void {
    const blocks = given.length > 0 ? given : [newBlock(this.#ctx(), PARAGRAPH)]
    const top = childrenOf(this.#tree, null)
    const first = blocks[0]!
    const firstStop = stopsIn({ ...this.#ctx(), tree: treeFromBlocks([first]) }, first.id)[0]
    this.apply({
      ops: [{ type: 'replaceBlocks', ids: top, blocks }],
      selection: firstStop?.field ? caret(first.id, firstStop.field, 0) : blockSelection(first.id),
      ...(announce ? { announce } : {}),
    })
  }

  // -------------------------------------------------------------------------
  // Import

  /** Foreign HTML as blocks, with the report and the pictures still to upload. Changes nothing. */
  importHtml(html: string, options: Pick<ImportOptions, 'source' | 'rtf' | 'notes' | 'legacy'> = {}): ImportResult {
    return importHtml(html, this.#importBlocks, { formats: this.formats, createId: this.#createId, ...this.#importSettings, ...options })
  }

  /** Plain text as blocks: paragraphs at blank lines, lists, links. Changes nothing. */
  importText(text: string): ImportResult {
    return importText(text, this.#importBlocks, { formats: this.formats, createId: this.#createId })
  }

  /** Replace the document with HTML (the source view) as one undo step, and report what the import did. */
  replaceHtml(html: string, announce = ''): ImportResult {
    const result = this.importHtml(html, this.#legacy ? { legacy: this.#legacy } : {})
    this.#replaceAll(result.blocks, announce)
    this.#imported('source', result)
    return result
  }

  /**
   * A Word file (`.docx`): converted by mammoth.js, loaded
   * on first use, then imported at the selection, or in place of an empty
   * document. Rejects when the file cannot be read.
   */
  async importDocx(file: Blob): Promise<ImportResult> {
    const generation = this.generation
    const { docxToHtml } = await import('../import/docx')
    const { html, notes } = await docxToHtml(file)
    const result = this.importHtml(html, { source: 'docx', notes })
    // Replaced, destroyed or made read-only while the file was read: the content lands in no other document.
    if (this.generation !== generation || this.#abort.signal.aborted || this.readOnly.value) return result
    const blocks = this.#withoutKnownAnchors(result.blocks)
    if (blocks.length > 0) {
      const top = childrenOf(this.#tree, null)
      const empty = top.length === 1 && this.#isEmptyText(top[0]!)
      if (empty) this.#replaceAll(blocks, this.strings.pasted(blocks.length))
      else this.apply(pasteBlocks(this.#ctx(), this.#selection.kind === 'none' ? blockSelection(top.at(-1)!) : this.#selection, blocks))
    }
    this.#imported('docx', result)
    return result
  }

  #imported(origin: ImportOrigin, result: ImportResult): void {
    const event: ImportEvent = { origin, report: result.report, pending: result.pending }
    this.lastImport = event
    this.#emit('import', event)
  }

  #isEmptyText(id: string): boolean {
    const node = this.#tree.nodes.get(id)
    const main = node ? mainField(this.editing.get(node.type)) : undefined
    return node !== undefined && main !== undefined && fieldValue(node, main.attr).text === '' && !this.#tree.children.get(id)?.length
  }

  /** Imported anchors that already name a part of this document would make two elements with one id. */
  #withoutKnownAnchors(blocks: readonly Block[]): Block[] {
    const known = this.#anchors()
    const walk = (list: readonly Block[]): Block[] => list.map((b) => {
      const a = b.attrs.anchor
      const attrs = typeof a === 'string' && a !== '' && known.has(a) ? { ...b.attrs, anchor: '' } : b.attrs
      return b.children ? { ...b, attrs, children: walk(b.children) } : { ...b, attrs }
    })
    return walk(blocks)
  }

  /**
   * Foreign clipboard content as blocks: HTML through the pipeline (with
   * Word's RTF for its pictures), else plain text with paragraphs or lists.
   * Null for text the field pastes inline itself (one paragraph of words).
   */
  #foreign(data: DataTransfer, alwaysText = false): ImportResult | null {
    const html = data.getData('text/html')
    if (html.trim() !== '') {
      const rtf = data.getData('text/rtf')
      const result = this.importHtml(html, rtf ? { rtf } : {})
      // HTML that yields nothing (only a script, only an unreadable frame) falls back to its plain text.
      if (result.blocks.length > 0) return result
    }
    const text = data.getData('text/plain').replace(/\r\n?/g, '\n')
    if (text.trim() === '') return null
    if (!alwaysText && !/\n[ \t]*\n/.test(text.trim()) && !/^[ \t]*(?:[-*•]|\d{1,9}[.)])[ \t]/m.test(text)) return null
    return this.importText(text)
  }

  /** Imported blocks at `at`: one paragraph's worth goes inline, like typed words; the rest as parts. */
  #placeImported(origin: ImportOrigin, at: EditorSelection, result: ImportResult): boolean {
    const blocks = this.#withoutKnownAnchors(result.blocks)
    if (blocks.length === 0) { this.#imported(origin, result); return true }
    const one = blocks.length === 1 ? blocks[0]! : null
    const def = one ? this.editing.get(one.type) : undefined
    const main = mainField(def)
    const ok = at.kind === 'text' && one && main && !one.children?.length && def?.fields.length === 1 && one.type === PARAGRAPH
      ? this.apply(pasteInline(this.#ctx(), at, fieldValue(one, main.attr)))
      : this.apply(pasteBlocks(this.#ctx(), at, blocks))
    this.#imported(origin, result)
    return ok
  }

  /** An online video's address pasted alone on an empty line becomes the video (`autolink` and embeds). */
  #pasteEmbed(blockId: string, data: DataTransfer): boolean {
    const url = data.getData('text/plain').trim()
    const embed = this.registry.get('core/embed')
    if (!embed || !this.offers('core/embed') || !/^https?:\/\/\S+$/.test(url) || !embedFor(url)) return false
    const node = this.#tree.nodes.get(blockId)
    if (node?.type !== PARAGRAPH || !this.#isEmptyText(blockId)) return false
    const ctx = this.#ctx()
    return this.apply(pasteBlocks(ctx, blockSelection(blockId), [newBlock(ctx, 'core/embed', { url })]))
  }

  /** Insert stored blocks at the selection, or at the end. */
  insert(blocks: unknown): boolean {
    const { doc } = validateDoc({ version: DOC_VERSION, blocks }, this.registry, { formats: this.formats, createId: this.#createId })
    return this.apply(pasteBlocks(this.context(), this.#selection, doc.blocks.map((b) => this.#fresh(b))))
  }

  /**
   * Accessibility problems of the content (the checker), in reading order.
   * `current` leaves alone the empty part the author is writing in; the checker panel passes it.
   */
  check(options: { readonly current?: boolean } = {}): Finding[] {
    const palette = this.#importSettings.palette
    return checkDocument({
      tree: this.#tree, schemas: this.registry, formats: this.formats, lang: this.contentLanguage,
      colors: palette ? new Set(palette.map((c) => c.name)) : null,
      current: options.current ? focusBlock(this.#selection) : null,
      createId: this.#createId,
      blockRules: (type) => this.editing.get(type)?.a11y,
      documentRules: [...genericRules, ...this.#checks],
    })
  }

  /** A finding in words: what is wrong, what to do, the part it is in. */
  describe(finding: Finding): CheckIssue {
    const text = this.strings.checkRules[finding.rule]
    const node = this.#tree.nodes.get(finding.blockId)
    return {
      rule: finding.rule, group: finding.group, severity: finding.severity, blockId: finding.blockId,
      message: text ? text.title(finding.params ?? {}) : this.strings.checkUnknown(finding.rule),
      hint: text?.hint ?? '',
      part: node ? this.labelFor(node) : '',
      fixable: finding.fix !== undefined,
      finding,
    }
  }

  /** The checker's problems in words, so a host can warn or refuse on save. */
  validate(): readonly CheckIssue[] {
    return this.check().map((f) => this.describe(f))
  }

  /** Repair a finding of the current document as one undo step; false when it has no repair or no longer applies. */
  fix(finding: Finding): boolean {
    // A repair is computed from the tree it was found in: take the same finding of the document as it is now.
    const same = (f: Finding): boolean => f.rule === finding.rule && f.blockId === finding.blockId && f.attr === finding.attr && f.start === finding.start && f.end === finding.end
    const now = this.check().find(same) ?? this.check({ current: true }).find(same)
    if (!now?.fix) return false
    const ops = now.fix()
    let tree: Tree
    try { tree = applyOperations(this.#tree, ops).tree } catch { return false }
    // The selection stays where it was unless the repair removed what it was in.
    const s = this.#selection
    const ids = s.kind === 'text' ? [s.blockId] : s.kind === 'blocks' || s.kind === 'cells' ? [s.anchorId, s.focusId] : s.kind === 'range' ? [s.anchor.blockId, s.focus.blockId] : []
    const after = ids.every((id) => tree.nodes.has(id)) ? s : NO_SELECTION
    const text = this.strings.checkRules[finding.rule]
    return this.apply({ ops, selection: after, announce: this.strings.checkFixed(text?.fix ?? text?.title(finding.params ?? {}) ?? finding.rule) }, { keepFocus: true })
  }

  on<K extends keyof EditorEvents>(event: K, fn: EditorEvents[K]): () => void {
    let set = this.#listeners.get(event)
    if (!set) { set = new Set(); this.#listeners.set(event, set) }
    const s = set
    s.add(fn)
    return () => { s.delete(fn) }
  }

  get selection(): EditorSelection { return this.#selection }
  get tree(): Tree { return this.#tree }
  /** @internal */
  get history(): History<EditorSelection> { return this.#history }
  /** @internal */
  get mode(): Mode { return this.#mode }

  /** Keyboard help, generated from the commands and field shortcuts. */
  keyboardHelp(): HelpGroup[] {
    return keyboardHelp(this.keymap, this.commands, this.strings, this.fieldShortcuts)
  }

  /** The mounted field of a block attribute, if it is on screen. */
  /** @internal */
  field(blockId: string, attr: string): RichTextField | undefined {
    return this.#fields.get(fieldKey(blockId, attr))
  }

  /** How many parts text selected across parts reaches into (0 for other selections). */
  /** @internal */
  acrossParts(): number {
    const ends = this.#ends()
    return ends ? partCount(this.#ctx(), ends) : 0
  }

  /** Whether `type` may be added to a field: the attribute's own list and the preset. */
  /** @internal */
  allowsFormat(blockId: string, attr: string, type: string): boolean {
    const node = this.#tree.nodes.get(blockId)
    const schema = node ? this.registry.get(node.type) : undefined
    const spec = schema ? attrSpecs(schema)[attr] : undefined
    if (spec?.type !== 'richtext' || !this.formats.has(type)) return false
    return (spec.formats?.includes(type) ?? true) && this.offers(type)
  }

  /** A format over text selected across parts, as one undo step. */
  /** @internal */
  formatAcross(edit: FormatEdit): boolean {
    const s = this.#selection
    if (s.kind !== 'range') return false
    return this.apply(formatAcross(this.#ctx(), s, edit, (b, a, t) => this.allowsFormat(b, a, t)))
  }

  /** What the format bar acts on: the field with the selection, or the text across parts. */
  /** @internal */
  formatTarget(): FormatTarget | undefined {
    const s = this.#selection
    if (s.kind === 'text') return this.field(s.blockId, s.field)
    if (s.kind !== 'range' || !this.#canvas) return undefined
    const allows = (b: string, a: string, t: string): boolean => this.allowsFormat(b, a, t)
    const marks = (): Mark[] => (this.#selection.kind === 'range' ? marksAcross(this.#ctx(), this.#selection, allows) : [])
    const ends = this.#ends()
    return {
      element: this.#canvas,
      allows: (type) => (ends ? pieces(this.#ctx(), ends).some((p) => allows(p.blockId, p.field, type)) : false),
      activeMarks: marks,
      formatAt: (type) => marks().find((m) => m.type === type) ?? null,
      toggleFormat: (mark) => { this.formatAcross({ toggle: mark }) },
      setLink: (href, options = {}) => {
        this.formatAcross(href === null ? { remove: 'link' } : { set: { type: 'link', attrs: options.newWindow ? { href, target: '_blank' } : { href } } })
      },
      clearFormatting: () => { this.formatAcross('clear') },
      selectionRects: () => this.#acrossRects(),
    }
  }

  /** Run a command by name, as a toolbar button would. */
  run(name: string): boolean {
    const c = this.commands.get(name)
    return c ? (c.isEnabled?.(this) ?? true) && c.run(this) : false
  }

  /** Select blocks, or put the caret somewhere, and show it in the DOM. */
  select(selection: EditorSelection, mode: Mode = selection.kind === 'blocks' ? 'select' : 'edit', options: { readonly keepFocus?: boolean } = {}): void {
    // A selection made anew ends a run of Up and Down: they no longer keep the old column.
    this.#goalX = null
    this.#goalCol = null
    this.#mode = mode
    this.#setSelection(this.#valid(selection))
    if (!options.keepFocus) void nextTick(() => { this.#syncDom() })
  }

  destroy(): void {
    this.#abort.abort()
    this.announcer.destroy()
    this.#bin?.remove()
    for (const f of this.#fields.values()) f.destroy()
    this.#fields.clear()
  }

  // -------------------------------------------------------------------------
  // CommandHost

  context(): StructureContext {
    return this.#ctx()
  }

  targets(): string[] {
    const s = this.#selection
    if (s.kind === 'blocks') return selectedBlocks(this.#tree, s)
    if (s.kind === 'cells') return selectedCells(this.#tree, s)
    if (s.kind === 'range') { const ends = this.#ends(); return ends ? rangeBlocks(this.#ctx(), ends) : [] }
    return s.kind === 'text' && this.#tree.nodes.has(s.blockId) ? [s.blockId] : []
  }

  /**
   * Apply a structural change as one undo step, then move the caret. With
   * `keepFocus` the DOM focus stays where it is (a control in the part options).
   */
  apply(change: Change | null, options: { readonly keepFocus?: boolean } = {}): boolean {
    if (!change || (change.ops.length > 0 && this.readOnly.value)) return false
    const typed = change.typed
    const key = this.#selection.kind === 'text' ? fieldKey(this.#selection.blockId, this.#selection.field) : ''
    const typing: Typing | undefined = typed !== undefined && key ? { key, inserted: typed } : undefined
    const mode: Mode = change.selection.kind === 'blocks' ? this.#mode : change.selection.kind === 'cells' ? 'select' : 'edit'
    if (change.ops.length > 0) { if (!this.#commit(change.ops, typing ? 'typing' : 'command', change.selection, typing)) return false } else this.#setSelection(change.selection)
    this.#mode = mode
    if (change.announce) this.announce(change.announce, 'polite', change.ops.length > 0)
    const marks = change.marks
    if (options.keepFocus) return true
    void nextTick(() => {
      this.#syncDom()
      if (marks && marks.length > 0) this.#focusedField()?.setPendingMarks(marks)
    })
    return true
  }

  undo(): boolean {
    if (this.readOnly.value) return false
    const r = undoHistory(this.#history, this.#tree)
    if (!r) { this.announce(this.strings.nothingToUndo); return false }
    this.#emit('willChange', [])
    const before = this.#tree
    const ops = this.#history.done.at(-1)!.inverse
    this.#history = r.history
    this.#restore(r.tree, r.selection)
    this.#reportChange('undo', { before, ops })
    this.announce(this.strings.undone)
    return true
  }

  redo(): boolean {
    if (this.readOnly.value) return false
    const r = redoHistory(this.#history, this.#tree)
    if (!r) { this.announce(this.strings.nothingToRedo); return false }
    this.#emit('willChange', [])
    const before = this.#tree
    const ops = this.#history.undone.at(-1)!.ops
    this.#history = r.history
    this.#restore(r.tree, r.selection)
    this.#reportChange('redo', { before, ops })
    this.announce(this.strings.redone)
    return true
  }

  selectBlock(): boolean {
    const id = focusBlock(this.#selection)
    if (id === null) return false
    this.select(blockSelection(id), 'select')
    this.announce(this.strings.blocksSelected(1))
    return true
  }

  selectAll(): boolean {
    const s = this.#selection
    if (s.kind === 'text') {
      // First press: the field's own select-all. Second (or in an empty field): every block.
      const len = this.field(s.blockId, s.field)?.value.text.length ?? 0
      const all = Math.min(s.anchor, s.focus) === 0 && Math.max(s.anchor, s.focus) === len
      if (!all && len > 0) return false
    }
    const top = childrenOf(this.#tree, null)
    if (top.length === 0) return false
    this.select(blockSelection(top[0]!, top.at(-1)), 'select')
    this.announce(this.strings.blocksSelected(top.length))
    return true
  }

  requestUi(name: UiRequest): void {
    this.#emit('ui', name)
  }

  insertText(text: string): boolean {
    const s = this.#selection
    if (this.readOnly.value || text === '') return false
    if (s.kind === 'range') return this.apply(replaceAcross(this.#ctx(), s, text))
    const field = s.kind === 'text' ? this.field(s.blockId, s.field) : undefined
    if (!field || s.kind !== 'text') return false
    // The field's own selection: a picker that took the focus left it where the author was.
    field.setSelection({ anchor: s.anchor, focus: s.focus })
    field.insertText(text)
    return true
  }

  /** What `ids` can be turned into (`transforms`), each with its change; the preset decides what is offered. */
  transformsFor(ids: readonly string[]): { readonly transform: Transform; readonly change: Change }[] {
    const ctx = this.#ctx()
    return [...this.editing.values()].flatMap((d) => d.transforms ?? []).filter((t) => this.offers(t.type))
      .flatMap((transform) => { const change = transform.run(ctx, ids); return change ? [{ transform, change }] : [] })
  }

  /** Find across parts: matches in reading order. */
  find(query: string, options: FindOptions = {}): Match[] {
    return findMatches(this.#ctx(), query, options)
  }

  /** Replace matches found by `find` as one undo step; matches whose text no longer fits `query` are skipped. */
  replace(matches: readonly Match[], text: string, query: string, options: FindOptions = {}): boolean {
    const pattern = findPattern(query, options)
    if (!pattern) return false
    const exact = new RegExp(`^(?:${pattern.source})$`, pattern.flags.replace('g', ''))
    // The find bar keeps the focus while replacing, so the next match is one Enter away.
    return this.apply(replaceMatches({ ...this.#ctx(), formats: this.formats }, matches, text, (s) => exact.test(s)), { keepFocus: true })
  }

  /** Word, character and part counts of the document, and of the selection when there is one (TinyMCE `wordcount`). */
  counts(): { readonly document: DocumentCounts; readonly selection: Counts | null } {
    const ctx = this.#ctx()
    const lang = this.strings.lang
    const sum = (list: readonly { blockId: string; field: string; start: number; end: number }[]): Counts => list
      .map((p) => countText(fieldValue(this.#tree.nodes.get(p.blockId)!, p.field).text.slice(p.start, p.end), lang))
      .reduce((a, b) => ({ words: a.words + b.words, characters: a.characters + b.characters, charactersNoSpaces: a.charactersNoSpaces + b.charactersNoSpaces }), { words: 0, characters: 0, charactersNoSpaces: 0 })
    const s = this.#selection
    let selection: Counts | null = null
    if (s.kind === 'text' && s.anchor !== s.focus) selection = sum([{ blockId: s.blockId, field: s.field, start: Math.min(s.anchor, s.focus), end: Math.max(s.anchor, s.focus) }])
    else if (s.kind === 'range') { const ends = this.#ends(); if (ends) selection = sum(pieces(ctx, ends)) }
    else if (s.kind === 'blocks' || s.kind === 'cells') {
      selection = sum(this.targets().flatMap((id) => stopsIn(ctx, id)).filter((p): p is { blockId: string; field: string } => p.field !== null)
        .map((p) => ({ ...p, start: 0, end: Infinity })))
    }
    return { document: countDocument(ctx, lang), selection }
  }

  /** Taken even with no listener: the browser's own Save page would save the editor's page, not the text. */
  save(): boolean {
    if (this.mayStore()) this.#emit('save')
    return true
  }

  /**
   * Whether the text may be stored now (`a11y.onSave`). With checker errors it says
   * how many; with `block` it also shows them and answers false. Form fields ask it before submitting.
   */
  mayStore(): boolean {
    const errors = this.check().filter((f) => f.severity === 'error').length
    if (errors === 0) return true
    const block = this.onSave === 'block'
    this.checkNotice = block ? this.strings.checkBlocked(errors) : this.strings.checkOnSave(errors)
    this.announce(this.checkNotice, block ? 'assertive' : 'polite')
    // Refused: the problems are shown, so the author sees what keeps the text from saving.
    if (block) this.#emit('ui', 'check')
    return !block
  }

  announce(text: string, politeness: Politeness = 'polite', undoable = false): void {
    this.#undoable = undoable
    this.announcer.announce(text, politeness)
    this.#undoable = false
  }

  /** Whether the preset offers an inserter entry, block type or format. */
  offers(id: string): boolean {
    const type = this.editing.get(id) ?? this.editing.get(id.split('/').slice(0, 2).join('/'))
    if (type?.offByDefault && !this.#enabled.has(type.name)) return false
    return this.#offered?.has(id) ?? true
  }

  /** Take pasted and dropped files (the interface uploads them). Returns the function that removes the hook. */
  /** @internal */
  onFiles(hook: FileHook): () => void {
    this.#fileHooks.add(hook)
    return () => { this.#fileHooks.delete(hook) }
  }

  #takeFiles(data: DataTransfer, at: EditorSelection, source: 'paste' | 'drop' = 'paste'): boolean {
    const files = [...data.files]
    if (files.length === 0) return false
    // Word and others put a picture of the copied text beside its HTML: the text is what was copied.
    // Files win only when the HTML holds nothing but pictures (a picture copied in a browser).
    const html = data.getData('text/html')
    if (html.trim() !== '' && !onlyPictures(html)) return false
    for (const hook of this.#fileHooks) if (hook(files, at, source)) return true
    return false
  }

  /** Take keys before the field and the editor (the `/` menu). Returns the function that removes the hook. */
  /** @internal */
  onKey(hook: KeyHook): () => void {
    this.#keyHooks.add(hook)
    return () => { this.#keyHooks.delete(hook) }
  }

  /** Change attributes of one block as one undo step (the part options). */
  setAttrs(id: string, patch: Readonly<Record<string, unknown>>, announce = ''): boolean {
    const node = this.#tree.nodes.get(id)
    if (!node || Object.entries(patch).every(([k, v]) => node.attrs[k] === v)) return false
    return this.apply({ ops: [{ type: 'setAttrs', id, patch }], selection: this.#selection, ...(announce ? { announce } : {}) }, { keepFocus: true })
  }

  /** The mounted element of a block, for the interface to place controls beside it. Reactive. */
  blockElement(id: string): HTMLElement | null {
    return this.#elements.get(id) ?? null
  }

  /** The canvas reports a block's root element when it mounts or changes (a list becomes numbered), and null when it goes. */
  /** @internal */
  setBlockElement(id: string, el: HTMLElement | null): void {
    if (el) { if (this.#elements.get(id) !== el) this.#elements.set(id, el) } else this.#elements.delete(id)
  }

  /** The canvas element once mounted. */
  /** @internal */
  get canvas(): HTMLElement | null { return this.#canvas }

  // -------------------------------------------------------------------------
  // Reactive state for the canvas

  /** The block as a ref: the canvas re-renders a block when its ref changes. */
  /** @internal */
  nodeRef(id: string): ShallowRef<BlockNode | undefined> {
    let r = this.#nodes.get(id)
    if (!r) { r = shallowRef(this.#tree.nodes.get(id)); this.#nodes.set(id, r) }
    return r
  }

  /** @internal */
  kidsRef(parent: ParentId): ShallowRef<readonly string[]> {
    let r = this.#kids.get(parent)
    if (!r) { r = shallowRef(this.#tree.children.get(parent) ?? []); this.#kids.set(parent, r) }
    return r
  }

  /** @internal */
  isSelected(id: string): boolean { return this.#selected.has(id) }
  /** The block holding the selection, or one of its ancestors' optional fields being shown. */
  /** @internal */
  isCurrent(id: string): boolean { return this.#current.has(id) }
  /** The one element of the canvas in the Tab order. */
  /** @internal */
  isTabStop(key: string): boolean { return this.#tabStop.has(key) }

  /** @internal */
  editingFor(type: string): BlockEditing | undefined { return this.editing.get(type) }

  /** @internal */
  labelFor(node: BlockNode): string {
    return blockLabel(this.editing.get(node.type), node, this.strings)
  }

  /** @internal */
  fieldLabel(node: BlockNode, attr: string): string {
    const def = this.editing.get(node.type)
    if (def?.fieldLabel) return def.fieldLabel(node, attr, this.strings)
    return mainField(def)?.attr === attr && def ? def.title(node, this.strings) : this.strings.fieldNames[attr] ?? attr
  }

  /** Whether an optional field is shown (a citation with text, or in the current block). */
  /** @internal */
  fieldShown(node: BlockNode, attr: string): boolean {
    const spec = this.editing.get(node.type)?.fields.find((f) => f.attr === attr)
    if (!spec?.optional || fieldValue(node, attr).text !== '') return true
    return this.#current.has(node.id)
  }

  // -------------------------------------------------------------------------
  // Fields: the canvas mounts one per rich-text attribute on screen.

  /** @internal */
  mountField(element: HTMLElement, blockId: string, attr: string): RichTextField {
    const node = this.#tree.nodes.get(blockId)!
    const def = this.editing.get(node.type)
    const spec = def?.fields.find((f) => f.attr === attr)
    const schema = this.registry.get(node.type)
    const attrSpec = schema ? attrSpecs(schema)[attr] : undefined
    const own = attrSpec?.type === 'richtext' ? attrSpec.formats : undefined
    // The preset narrows what can be added; formats already in loaded content stay (they are only not offered).
    const allowed = this.#offered ? [...this.formats.keys()].filter((f) => this.#offered!.has(f) && (own?.includes(f) ?? true)) : own
    const lang = typeof node.attrs.lang === 'string' && node.attrs.lang !== '' ? node.attrs.lang : undefined
    const dir = node.attrs.dir === 'ltr' || node.attrs.dir === 'rtl' ? node.attrs.dir : 'auto'
    const field = new RichTextField(element, {
      value: fieldValue(node, attr),
      formats: this.formats,
      ...(allowed ? { allowedFormats: allowed } : {}),
      inputRules: spec?.inputRules !== false,
      ...(lang ? { lang } : {}),
      dir,
      editable: !this.readOnly.value && !frozen(this.#tree, blockId),
      labels: this.strings.dom,
      shortcuts: this.fieldShortcuts,
      onChange: (value, sel, origin) => { this.#fieldChanged(blockId, attr, value, sel, origin) },
      onSelectionChange: (sel) => { if (sel) this.#fieldSelected(blockId, attr, sel) },
      onSplit: (before, after) => { this.#split(blockId, attr, before, after) },
      onMergeBackward: () => { this.apply(mergeBackward(this.#ctx(), blockId, attr)) },
      onMergeForward: () => { this.apply(mergeForward(this.#ctx(), blockId, attr)) },
      onUndo: () => { this.undo() },
      onRedo: () => { this.redo() },
      onBlockRule: (match) => {
        const def = this.editing.get(this.#tree.nodes.get(blockId)?.type ?? '')
        return def?.blockRule ? this.apply(def.blockRule(this.#ctx(), blockId, match)) : false
      },
      onRequestLink: () => { this.#emit('requestLink', field) },
      onKeyDown: (e) => this.#fieldKey(blockId, attr, e),
      onPaste: (data, sel) => this.#pasteIntoField(blockId, attr, data, sel),
      onDrop: (drop) => this.#dropIntoField(blockId, attr, drop),
      onBoundaryChange: ({ entered, left }) => {
        const names = (marks: readonly Mark[]): string => marks.map((m) => this.strings.formatNames[m.type] ?? m.type).join(', ')
        this.announce(entered.length > 0 ? this.strings.entered(names(entered)) : this.strings.left(names(left)))
      },
    })
    this.#fields.set(fieldKey(blockId, attr), field)
    this.#fieldKeys.set(field, { blockId, attr })
    return field
  }

  /** @internal */
  unmountField(field: RichTextField): void {
    const key = this.#fieldKeys.get(field)
    if (key && this.#fields.get(fieldKey(key.blockId, key.attr)) === field) this.#fields.delete(fieldKey(key.blockId, key.attr))
    field.destroy()
  }

  /** The canvas element: keyboard and pointer handling for block selection, clipboard on selected blocks. */
  /** @internal */
  attachCanvas(canvas: HTMLElement): void {
    this.#canvas = canvas
    const signal = this.#abort.signal
    canvas.addEventListener('keydown', (e) => { this.#canvasKey(e) }, { signal })
    canvas.addEventListener('mousedown', (e) => { this.#mouseDown(e) }, { signal })
    canvas.addEventListener('pointermove', (e) => { this.#pointerMove(e) }, { signal })
    canvas.addEventListener('focusin', (e) => { this.#focusIn(e) }, { signal })
    canvas.addEventListener('focusout', (e) => { this.#focusOut(e) }, { signal })
    // Text across parts: the canvas is the editing host, so its events come here first.
    const spanning = (): boolean => this.spanning.value && this.#selection.kind === 'range'
    canvas.addEventListener('beforeinput', (e) => { if (spanning()) this.#rangeInput(e) }, { signal, capture: true })
    for (const type of ['copy', 'cut', 'paste'] as const) {
      canvas.addEventListener(type, (e) => { if (spanning()) { e.stopPropagation(); this.#rangeClipboard(e) } }, { signal, capture: true })
    }
    canvas.addEventListener('compositionstart', () => { if (spanning()) this.#collapseForInput() }, { signal, capture: true })
    canvas.addEventListener('compositionend', (e) => { if (e.target === canvas) this.#compositionInCanvas(e) }, { signal })
    // shortcut: a selection across parts is not dragged to move it; it is cut and pasted. Upgrade when authors ask for it.
    canvas.addEventListener('dragstart', (e) => { if (spanning()) e.preventDefault() }, { signal, capture: true })
    canvas.addEventListener('keyup', () => { this.#readAcross() }, { signal })
    const doc = canvas.ownerDocument
    doc.addEventListener('selectionchange', () => { this.#readAcross() }, { signal })
    doc.addEventListener('pointerup', () => { this.#pointerUp() }, { signal })
    // execCommand('copy') with nothing selected fires at the body (or the shadow host), not in the canvas.
    doc.addEventListener('copy', (e) => { this.#copyEvent(e) }, { signal, capture: true })
    // A paste bin: an editable element that takes Mod+V while blocks are selected, because no engine
    // pastes into a focused element that is not editable (WebKit fires no paste event at all).
    const bin = doc.createElement('div')
    bin.className = 'pz-paste-bin'
    bin.contentEditable = 'true'
    bin.tabIndex = -1
    bin.setAttribute('aria-hidden', 'true')
    bin.addEventListener('paste', (e) => { this.#binPaste(e) }, { signal })
    bin.addEventListener('beforeinput', (e) => { e.preventDefault() }, { signal })
    canvas.after(bin)
    this.#bin = bin
    const root = canvas.getRootNode()
    if (root instanceof ShadowRoot || root instanceof Document) {
      // Live regions next to the canvas, present before the first announcement.
      canvas.after(this.announcer.polite, this.announcer.assertive)
    }
  }

  // -------------------------------------------------------------------------
  // Internals: state

  #ctx(): StructureContext {
    return {
      tree: this.#tree,
      schemas: this.registry,
      editing: this.editing,
      formats: this.formats,
      strings: this.strings,
      createId: this.#createId,
      current: focusBlock(this.#selection),
      selection: this.#selection,
      offers: (id) => this.offers(id),
    }
  }

  #emit<K extends keyof EditorEvents>(event: K, ...args: Parameters<EditorEvents[K]>): void {
    if (event === 'change') this.revision.value++
    for (const fn of this.#listeners.get(event) ?? []) {
      // A failing listener (the host's) must not stop the edit, history, form sync or the other listeners.
      try { (fn as (...a: Parameters<EditorEvents[K]>) => void)(...args) } catch (e) { reportListenerError(e) }
    }
  }

  /** The upload manager reports attempts here, so hosts follow them through `on('upload')`. */
  /** @internal */
  reportUpload(event: UploadEvent): void {
    this.#emit('upload', event)
  }

  /** `blocksChange` for what `ops` did since `before`; nothing to compute while nobody listens. */
  #reportChange(reason: ChangeReason, step: { readonly before: Tree; readonly ops: readonly Operation[] } | null): void {
    if (!this.#listeners.get('blocksChange')?.size) return
    const changes: TreeChanges = step ? treeChanges(step.before, this.#tree, step.ops) : { added: [], removed: [], updated: [], order: [] }
    this.#changeQueue.push({ ...changes, revision: this.revision.value, reason })
    if (this.#reporting) return
    this.#reporting = true
    try {
      for (let e = this.#changeQueue.shift(); e; e = this.#changeQueue.shift()) this.#emit('blocksChange', e)
    } finally { this.#reporting = false }
  }

  /** False when nothing was applied: read-only, or a locked part in the way. */
  #commit(ops: readonly Operation[], origin: Origin, after: EditorSelection, typing?: Typing, fromField?: string): boolean {
    // One guard for every edit: commands, the part options, paste, drop and the range all commit here.
    if (this.readOnly.value) return false
    const locked = lockViolation(this.#tree, ops)
    if (locked) { this.announce(locked === 'move' ? this.strings.lockedMove : this.strings.lockedEdit, 'assertive'); return false }
    if (!typing) this.#emit('willChange', ops)
    const before = this.#tree
    const { tree, transaction } = transact(this.#tree, ops, {
      origin, before: this.#selection, after, time: performance.now(), ...(typing ? { typing } : {}),
    })
    this.#history = record(this.#history, transaction)
    this.#setTree(tree, ops, fromField)
    this.#setSelection(after)
    this.#emit('change')
    this.#reportChange(origin, { before, ops })
    return true
  }

  /** New tree: update the refs of what changed and push new values into mounted fields. */
  #setTree(tree: Tree, ops: readonly Operation[] | null, fromField?: string): void {
    const prev = this.#tree
    this.#tree = tree
    // A lock changed (or everything did): which fields take typing may have too.
    if (!ops || ops.some((op) => op.type === 'setAttrs' && 'lock' in op.patch)) queueMicrotask(() => { this.#refreshEditable() })
    const onlyAttrs = ops?.every((op) => op.type === 'setAttrs') ?? false
    const changed: string[] = []
    if (onlyAttrs) {
      for (const op of ops!) if (op.type === 'setAttrs' && prev.nodes.get(op.id) !== tree.nodes.get(op.id)) changed.push(op.id)
    } else {
      for (const [id, ref] of this.#nodes) {
        const n = tree.nodes.get(id)
        if (ref.value !== n) { changed.push(id); }
      }
      for (const [parent, ref] of this.#kids) {
        const k = parent === null || tree.nodes.has(parent) ? tree.children.get(parent) ?? [] : []
        if (ref.value !== k) ref.value = k
      }
    }
    for (const id of changed) {
      const n = tree.nodes.get(id)
      const ref = this.#nodes.get(id)
      if (ref) ref.value = n
      if (!n) { this.#nodes.delete(id); continue }
      for (const [attr, v] of Object.entries(n.attrs)) {
        if (!isRichText(v)) continue
        const key = fieldKey(id, attr)
        if (key === fromField) continue
        const f = this.#fields.get(key)
        if (f && f.value !== v) f.setValue(v)
      }
    }
  }

  #setSelection(sel: EditorSelection): void {
    const s = this.#valid(sel)
    const same = selectionsEqual(s, this.#selection)
    this.#selection = s
    this.selectionRef.value = s
    const ids = s.kind === 'cells' ? selectedCells(this.#tree, s) : s.kind === 'range' ? this.#wholeInRange() : selectedBlocks(this.#tree, s)
    for (const id of [...this.#selected]) if (!ids.includes(id)) this.#selected.delete(id)
    for (const id of ids) this.#selected.add(id)
    if (s.kind !== 'blocks' && s.kind !== 'cells') this.#mode = 'edit'
    const cur = focusBlock(s) ?? childrenOf(this.#tree, null)[0] ?? null
    // Current: the block and its ancestors, so a quote shows its citation while a paragraph inside it is edited.
    const chain: string[] = []
    for (let p: ParentId = cur; p !== null && this.#tree.nodes.has(p); p = parentOf(this.#tree, p)) chain.push(p)
    for (const id of [...this.#current]) if (!chain.includes(id)) this.#current.delete(id)
    for (const id of chain) this.#current.add(id)
    const stop = s.kind === 'text' ? fieldKey(s.blockId, s.field) : s.kind === 'range' ? fieldKey(s.focus.blockId, s.focus.field)
      : s.kind === 'blocks' || s.kind === 'cells' ? s.focusId : this.#firstStopKey()
    if (!this.#tabStop.has(stop)) {
      // One by one, never clear(): clearing a reactive Set re-renders every view that asked about any key (2,000 parts).
      for (const k of [...this.#tabStop]) this.#tabStop.delete(k)
      this.#tabStop.add(stop)
    }
    this.#span(s.kind === 'range' || this.#dragAcross)
    if (!same) this.#emit('selection', s)
  }

  /** Make the canvas editable while text is selected across parts, so the native selection spans fields. */
  #span(on: boolean): void {
    const c = this.#canvas
    // Read-only text is not editable, so the native selection already spans fields.
    if (this.spanning.value === on || !c || (on && this.readOnly.value)) return
    this.spanning.value = on
    if (on) {
      c.contentEditable = 'true'
      // One Tab stop stays the field: the editable canvas is not another.
      c.tabIndex = -1
      c.setAttribute('role', 'textbox')
      c.setAttribute('aria-multiline', 'true')
      c.setAttribute('aria-label', this.strings.acrossLabel)
      c.spellcheck = false
    } else {
      for (const a of ['contenteditable', 'tabindex', 'role', 'aria-multiline', 'aria-label', 'spellcheck']) c.removeAttribute(a)
    }
  }

  #ends(): ReturnType<typeof rangeEnds> {
    const s = this.#selection
    return s.kind === 'range' ? rangeEnds(this.#ctx(), s) : null
  }

  /** Parts without text inside a range (a picture, a separator, a table): they are shown selected as a whole. */
  #wholeInRange(): string[] {
    const ends = this.#ends()
    if (!ends) return []
    const out: string[] = []
    const walk = (id: string): void => {
      const def = this.editing.get(this.#tree.nodes.get(id)!.type)
      if (def?.group || this.#hasNoText(id)) { out.push(id); return }
      for (const k of this.#tree.children.get(id) ?? []) walk(k)
    }
    for (const id of coveredBlocks(this.#ctx(), ends)) walk(id)
    return out
  }

  #firstStopKey(): string {
    const first = stops(this.#ctx())[0]
    return !first ? '' : first.field === null ? first.blockId : fieldKey(first.blockId, first.field)
  }

  /** A selection that points at something that exists; otherwise the start of the document. */
  #valid(sel: EditorSelection): EditorSelection {
    if (sel.kind === 'text' && this.#tree.nodes.has(sel.blockId)) {
      const len = fieldValue(this.#tree.nodes.get(sel.blockId)!, sel.field).text.length
      const clamp = (n: number): number => Math.max(0, Math.min(len, n))
      return { ...sel, anchor: clamp(sel.anchor), focus: clamp(sel.focus) }
    }
    if (sel.kind === 'blocks' && this.#tree.nodes.has(sel.anchorId) && this.#tree.nodes.has(sel.focusId)) return sel
    if (sel.kind === 'cells' && selectionRect(this.#tree, sel)) return sel
    if (sel.kind === 'range') {
      const ok = (p: TextPoint): boolean => this.#tree.nodes.has(p.blockId) && isRichText(this.#tree.nodes.get(p.blockId)!.attrs[p.field])
      if (!ok(sel.anchor) || !ok(sel.focus)) return NO_SELECTION
      const n = normalizeRange(this.#ctx(), sel.anchor, sel.focus)
      return n.kind === 'range' || n.kind === 'none' ? n : this.#valid(n)
    }
    return NO_SELECTION
  }

  #restore(tree: Tree, selection: EditorSelection): void {
    this.#setTree(tree, null)
    this.#mode = selection.kind === 'blocks' ? 'select' : 'edit'
    this.#setSelection(selection)
    this.#emit('change')
    void nextTick(() => { this.#syncDom() })
  }

  /** Put the DOM focus and selection where the editor selection is. */
  #syncDom(): void {
    const s = this.#selection
    if (s.kind === 'text') {
      const f = this.field(s.blockId, s.field)
      if (!f) return
      f.setSelection({ anchor: s.anchor, focus: s.focus })
      revealIfHidden(f.element)
    } else if (s.kind === 'range') {
      this.#showAcross(s, true)
    } else if (s.kind === 'blocks' || s.kind === 'cells') {
      const el = this.#wrapper(s.focusId)
      if (!el) return
      // A text caret left behind would keep typing going into the old field.
      el.ownerDocument.getSelection()?.removeAllRanges()
      el.focus({ preventScroll: true })
      revealIfHidden(el)
    }
  }

  #wrapper(id: string): HTMLElement | null {
    return this.#elements.get(id) ?? null
  }

  /** The DOM place of a text point: in its field, or at the start of its block when the field is not shown. */
  #domPoint(p: TextPoint): { node: Node; offset: number } | null {
    const f = this.field(p.blockId, p.field)
    if (f) return offsetToDomPoint(f.element, p.offset)
    const el = this.#wrapper(p.blockId)
    return el ? { node: el, offset: 0 } : null
  }

  /** Put the native selection over a range, the canvas editable and focused. */
  #showAcross(s: RangeSelection, focus: boolean): void {
    const c = this.#canvas
    if (!c) return
    this.#span(true)
    const a = this.#domPoint(s.anchor), f = this.#domPoint(s.focus)
    if (!a || !f) return
    if (focus && activeElementFor(c) !== c) c.focus({ preventScroll: true })
    const sel = selectionSourceFor(c)()
    if (sel && !(sel.anchorNode === a.node && sel.anchorOffset === a.offset && sel.focusNode === f.node && sel.focusOffset === f.offset)) {
      sel.setBaseAndExtent(a.node, a.offset, f.node, f.offset)
    }
    const fe = this.field(s.focus.blockId, s.focus.field)?.element
    if (fe) revealIfHidden(fe)
  }

  /**
   * A DOM place as a text point: in a field, its offset; elsewhere in the canvas
   * (between parts, on a picture), the start of the next field or the end of the last.
   */
  #pointAt(node: Node | null, offset: number): TextPoint | null {
    const c = this.#canvas
    if (!node || !c || !c.contains(node)) return null
    const el = node instanceof Element ? node : node.parentElement
    const fieldEl = el?.closest<HTMLElement>('[data-field]')
    if (fieldEl) {
      const blockId = fieldEl.closest<HTMLElement>('[data-block]')?.dataset.block
      const attr = fieldEl.dataset.field
      const f = blockId && attr ? this.field(blockId, attr) : undefined
      const at = f?.element === fieldEl ? domPointToOffset(fieldEl, node, offset) : null
      if (blockId && attr && at !== null) return { blockId, field: attr, offset: at }
    }
    const probe = c.ownerDocument.createRange()
    probe.setStart(node, offset)
    let last: TextPoint | null = null
    for (const fe of c.querySelectorAll<HTMLElement>('[data-field]')) {
      const blockId = fe.closest<HTMLElement>('[data-block]')?.dataset.block
      const attr = fe.dataset.field
      const f = blockId && attr ? this.field(blockId, attr) : undefined
      if (!f || !blockId || !attr) continue
      if (probe.comparePoint(fe, 0) >= 0) return { blockId, field: attr, offset: 0 }
      last = { blockId, field: attr, offset: f.value.text.length }
    }
    return last
  }

  /** The native selection read back while the canvas spans fields: a range, or a selection in one field. */
  #readAcross(): void {
    const c = this.#canvas
    if (!c || !this.spanning.value || this.#dragAcross) return
    const sel = selectionSourceFor(c)()
    if (!sel || sel.rangeCount === 0) return
    const a = this.#pointAt(sel.anchorNode, sel.anchorOffset), f = this.#pointAt(sel.focusNode, sel.focusOffset)
    if (!a || !f) return
    const next = this.#valid(normalizeRange(this.#ctx(), a, f))
    if (next.kind === 'none' || selectionsEqual(next, this.#selection)) return
    const before = this.#selection
    this.#mode = next.kind === 'cells' ? 'select' : 'edit'
    this.#setSelection(next)
    if (next.kind === 'range') {
      // An end moved out of a table or column: show where the range really ends.
      if (!(next.anchor.offset === a.offset && next.anchor.blockId === a.blockId && next.focus.blockId === f.blockId && next.focus.offset === f.offset)) this.#showAcross(next, false)
      if (before.kind !== 'range') this.announce(this.strings.selectedAcross(this.acrossParts()))
    } else {
      // Back in one field (or on cells): the field takes the selection and the focus again.
      this.#syncDom()
      if (next.kind === 'cells') this.#announceCells()
    }
  }

  /** Viewport rectangles of the selected text at both ends of a range (the format bar sits above the first). */
  #acrossRects(): DOMRect[] {
    const ends = this.#ends()
    if (!ends) return []
    const list = pieces(this.#ctx(), ends).filter((p) => p.start < p.end)
    const out: DOMRect[] = []
    for (const p of [list[0], list.at(-1)]) {
      const f = p ? this.field(p.blockId, p.field) : undefined
      if (!p || !f) continue
      const r = f.element.ownerDocument.createRange()
      const a = offsetToDomPoint(f.element, p.start), b = offsetToDomPoint(f.element, p.end)
      r.setStart(a.node, a.offset)
      r.setEnd(b.node, b.offset)
      out.push(...[...r.getClientRects()].filter((x) => x.width > 0 || x.height > 0))
    }
    return out
  }


  #focusedField(): RichTextField | undefined {
    const s = this.#selection
    return s.kind === 'text' ? this.field(s.blockId, s.field) : undefined
  }

  #fresh(b: Block): Block {
    const base = { id: this.#createId(), type: b.type, attrs: b.attrs }
    return b.children ? { ...base, children: b.children.map((c) => this.#fresh(c)) } : base
  }

  /** A block with no text of its own to type into, nested or optional fields aside (a separator, a picture). */
  #hasNoText(id: string): boolean {
    if (!this.#tree.nodes.has(id)) return false
    return subtreeIds(this.#tree, id).every((b) => (this.editing.get(this.#tree.nodes.get(b)!.type)?.fields ?? []).every((f) => f.optional === true))
  }

  #clipOptions(): ClipReadOptions {
    const refuse = new Set([...this.editing.values()].filter((d) => d.offByDefault && !this.#enabled.has(d.name)).map((d) => d.name))
    return { formats: this.formats, createId: this.#createId, anchors: this.#anchors(), refuse }
  }

  #anchors(): Set<string> {
    const out = new Set<string>()
    for (const n of this.#tree.nodes.values()) if (typeof n.attrs.anchor === 'string' && n.attrs.anchor !== '') out.add(n.attrs.anchor)
    return out
  }

  // -------------------------------------------------------------------------
  // Internals: field events

  #fieldChanged(blockId: string, attr: string, value: RichTextValue, sel: TextSelection, origin: ChangeOrigin): void {
    const node = this.#tree.nodes.get(blockId)
    if (!node) return
    const old = fieldValue(node, attr)
    if (old === value) return
    const typed = origin === 'typing' || origin === 'composition'
    const change = typed ? findChange(old.text, value.text, sel.focus) : null
    const typing: Typing | undefined = typed ? { key: fieldKey(blockId, attr), inserted: change ? value.text.slice(change.start, change.newEnd) : '' } : undefined
    const after: EditorSelection = { kind: 'text', blockId, field: attr, anchor: sel.anchor, focus: sel.focus }
    // Before the first keystroke the editor may not have heard the caret yet (selectionchange is async).
    if (this.#selection.kind !== 'text' || this.#selection.blockId !== blockId) this.#setSelection(after)
    const histOrigin: Origin = typed ? 'typing' : origin === 'paste' || origin === 'drop' || origin === 'cut' ? 'paste' : 'command'
    // Refused (a locked part): the field shows the text it had.
    if (!this.#commit([{ type: 'setAttrs', id: blockId, patch: { [attr]: value } }], histOrigin, after, typing, fieldKey(blockId, attr))) this.field(blockId, attr)?.setValue(old)
  }

  #fieldSelected(blockId: string, attr: string, sel: TextSelection): void {
    const next: EditorSelection = { kind: 'text', blockId, field: attr, anchor: sel.anchor, focus: sel.focus }
    if (selectionsEqual(next, this.#selection)) return
    // A drag across blocks became a block selection; the field under the pointer still reports its text.
    if (this.#dragFrom !== null && (this.#dragAcross || this.#canvas?.classList.contains('is-selecting'))) return
    if (this.spanning.value && this.#selection.kind === 'range') return
    this.#mode = 'edit'
    this.#setSelection(next)
  }

  #split(blockId: string, attr: string, before: RichTextValue, after: RichTextValue): void {
    // Character formatting carries across Enter, as in word processors; links and code do not.
    const marks = (this.field(blockId, attr)?.activeMarks() ?? []).filter((m) => this.formats.get(m.type)?.inclusive === true)
    this.apply(splitBlock(this.#ctx(), blockId, attr, before, after, marks))
  }

  /** Keys the field does not handle itself: commands, then moving between blocks. */
  #fieldKey(blockId: string, attr: string, e: KeyboardEvent): boolean {
    for (const hook of this.#keyHooks) if (hook(e, { blockId, attr })) return true
    const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown'
    if (!vertical) { this.#goalX = null; this.#goalCol = null }
    if (this.keymap.run(e, 'text', this)) { e.preventDefault(); return true }
    const field = this.field(blockId, attr)
    const s = field?.selection
    if (!field || !s) return false
    const here: Stop = { blockId, field: attr }
    const len = field.value.text.length
    const plain = !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey
    const shiftOnly = e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey
    const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight'
    if (!vertical && !horizontal) return false
    const back = vertical ? e.key === 'ArrowUp' : (e.key === 'ArrowLeft') !== (field.direction() === 'rtl')
    const ctx = this.#ctx()

    if (shiftOnly) {
      // Extending past the edge of the field goes on into the next parts.
      const atEdge = vertical ? (back ? field.isCaretOnFirstLine() : field.isCaretOnLastLine()) : s.focus === (back ? 0 : len)
      if (!atEdge) return false
      const next = neighbourStop(ctx, here, back ? -1 : 1)
      if (!next || next.blockId === blockId) return false
      // Out of a table cell into the next one: cells are selected instead.
      const cell = enclosing(this.#tree, blockId, CELL)
      if (cell !== null && enclosing(this.#tree, next.blockId, CELL) !== cell) {
        const table = enclosing(this.#tree, cell, TABLE)!
        const dir = vertical ? (back ? 'up' : 'down') : this.#cellDirection(e.key, cell)!
        const to = cellToward(this.#tree, table, cell, dir)
        if (to !== null) {
          e.preventDefault()
          this.select(cellSelection(table, cell, to), 'select')
          this.#announceCells()
          return true
        }
      }
      // The canvas becomes editable before the key's default action, which then extends the
      // native selection across the field's edge in all three engines; #readAcross reads it back.
      this.#span(true)
      this.#canvas?.focus({ preventScroll: true })
      const sel = this.#canvas ? selectionSourceFor(this.#canvas)() : null
      // Focusing the canvas can drop the selection (WebKit): put the field's back.
      if (sel && sel.anchorNode === null) { const a = offsetToDomPoint(field.element, s.anchor), f = offsetToDomPoint(field.element, s.focus); sel.setBaseAndExtent(a.node, a.offset, f.node, f.offset) }
      return true
    }
    if (!plain || s.anchor !== s.focus) return false
    if (vertical ? !(back ? field.isCaretOnFirstLine() : field.isCaretOnLastLine()) : s.focus !== (back ? 0 : len)) return false
    // In a table, Up and Down keep to the column; into a table, they go to the cell under the caret.
    const inTable = vertical ? this.#tableStop(blockId, back, here) : null
    let next = inTable ? inTable.stop : neighbourStop(ctx, here, back ? -1 : 1)
    const x = this.#goalX ?? field.caretX()
    if (vertical && !inTable && next && x !== null) next = this.#intoTable(next, back, x) ?? next
    if (!next) return false
    e.preventDefault()
    if (vertical) this.#goalX ??= field.caretX()
    this.#enterStop(next, back, vertical)
    return true
  }

  /** Move into a stop from the one before (`back` false) or after it. */
  #enterStop(stop: Stop, back: boolean, vertical: boolean): void {
    if (stop.field === null) { this.select(blockSelection(stop.blockId), 'edit'); return }
    // The field may only appear now (an optional citation): render first.
    this.#mode = 'edit'
    const target = caret(stop.blockId, stop.field, 0)
    this.#setSelection(target)
    void nextTick(() => {
      const f = this.field(stop.blockId, stop.field!)
      if (!f) return
      if (vertical && this.#goalX !== null) f.placeCaretAtX(this.#goalX, back ? 'last' : 'first')
      else f.focus(back ? 'end' : 'start')
      const placed = f.selection
      if (placed) this.#setSelection({ kind: 'text', blockId: stop.blockId, field: stop.field!, anchor: placed.anchor, focus: placed.focus })
      revealIfHidden(f.element)
    })
  }

  #pasteIntoField(blockId: string, attr: string, data: DataTransfer, sel: TextSelection, origin: ImportOrigin = 'paste'): boolean {
    if (this.#takeFiles(data, { kind: 'text', blockId, field: attr, anchor: sel.anchor, focus: sel.focus }, origin === 'drop' ? 'drop' : 'paste')) return true
    const clip = readClip(data, this.registry, this.#clipOptions())
    const pasted = clip?.blocks ?? null
    const at: EditorSelection = { kind: 'text', blockId, field: attr, anchor: sel.anchor, focus: sel.focus }
    if (!pasted) {
      // An address pasted onto selected words links them; the field does that.
      if (sel.anchor !== sel.focus && /^(?:https?:\/\/|mailto:)\S+$/i.test(data.getData('text/plain').trim())) return false
      if (this.#pasteEmbed(blockId, data)) return true
      const foreign = this.#foreign(data)
      if (!foreign) return false
      this.#setSelection(at)
      // A spreadsheet range pasted in a cell fills the cells from there.
      if (this.#fillAtCaret(blockId, foreign.blocks)) { this.#imported(origin, foreign); return true }
      return this.#placeImported(origin, at, foreign)
    }
    this.#setSelection(at)
    if (this.#fillAtCaret(blockId, pasted)) return true
    const one = pasted.length === 1 ? pasted[0]! : null
    const def = one ? this.editing.get(one.type) : undefined
    const main = mainField(def)
    // One text block pastes as its text, like copying words.
    if (one && main && !one.children?.length && def?.fields.length === 1) {
      return this.apply(pasteInline(this.#ctx(), at, fieldValue(one, main.attr)))
    }
    return this.apply(pasteBlocks(this.#ctx(), at, pasted, clip?.open))
  }

  /** A drop from another field moves the text in one undo step; the field handles drops inside itself. */
  #dropIntoField(blockId: string, attr: string, drop: FieldDrop): boolean {
    const target = this.field(blockId, attr)
    if (!target) return false
    if (this.#takeFiles(drop.data, { kind: 'text', blockId, field: attr, anchor: drop.offset, focus: drop.offset }, 'drop')) return true
    const pasted = readBlocks(drop.data, this.registry, this.#clipOptions())
    if (pasted) return this.#pasteIntoField(blockId, attr, drop.data, { anchor: drop.offset, focus: drop.offset })
    // Dropped from another application: the same pipeline as a paste.
    if (!drop.source) return this.#pasteIntoField(blockId, attr, drop.data, { anchor: drop.offset, focus: drop.offset }, 'drop')
    const src = this.#fieldKeys.get(drop.source.field)
    if (!src || drop.source.field === target || drop.copy) return false
    const sourceNode = this.#tree.nodes.get(src.blockId)
    const node = this.#tree.nodes.get(blockId)
    if (!sourceNode || !node) return false
    // Only the formats the target field allows: a link dragged into a button's text or a code block loses them, as on paste.
    const moved = fitValue(this.#ctx(), node.type, attr, slice(fieldValue(sourceNode, src.attr), drop.source.start, drop.source.end))
    const ops: Operation[] = [
      { type: 'setAttrs', id: src.blockId, patch: { [src.attr]: deleteRange(fieldValue(sourceNode, src.attr), drop.source.start, drop.source.end, this.formats) } },
      { type: 'setAttrs', id: blockId, patch: { [attr]: replaceText(fieldValue(node, attr), drop.offset, drop.offset, moved, this.formats) } },
    ]
    if (!this.#commit(ops, 'paste', { kind: 'text', blockId, field: attr, anchor: drop.offset, focus: drop.offset + moved.text.length })) return true
    void nextTick(() => { this.#syncDom() })
    return true
  }

  // -------------------------------------------------------------------------
  // Internals: selected blocks (select mode and blocks without text)

  #canvasKey(e: KeyboardEvent): void {
    // Keys inside a field were handled by the field; controls inside a block (a picture's address field) keep theirs.
    if (e.defaultPrevented || (e.target instanceof Element && e.target.closest(`.pz-richtext, ${FORM_CONTROL}`))) return
    if (e.target === this.#bin) return
    const s = this.#selection
    if (s.kind === 'range') { this.#rangeKey(e, s); return }
    if (s.kind === 'cells') { this.#cellsKey(e, s); return }
    if (s.kind !== 'blocks') return
    if (this.keymap.run(e, 'blocks', this)) { e.preventDefault(); return }
    const mod = e.ctrlKey || e.metaKey
    if (mod && !e.altKey && !e.shiftKey && (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'x' || e.code === 'KeyC' || e.code === 'KeyX')) {
      e.preventDefault()
      this.#copyBlocks(e.code === 'KeyX' || e.key.toLowerCase() === 'x')
      return
    }
    if (mod && !e.altKey && !e.shiftKey && (e.key.toLowerCase() === 'v' || e.code === 'KeyV')) {
      // Let the browser paste, into the bin.
      this.#bin?.focus({ preventScroll: true })
      return
    }
    const plain = !e.altKey && !mod
    const ids = selectedBlocks(this.#tree, s)
    const ctx = this.#ctx()
    if (plain && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault()
      const back = e.key === 'ArrowUp' || e.key === 'ArrowLeft'
      if (e.shiftKey) { this.#extendBlocks(back); return }
      if (this.#mode === 'select') {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return
        const order = allBlocks(this.#tree)
        const from = back ? s.focusId : s.focusId
        const i = order.indexOf(from)
        const next = order[i + (back ? -1 : 1)]
        if (next !== undefined) this.select(blockSelection(next), 'select')
        return
      }
      // Arrived by arrow keys on a block without text: keep flowing through the document.
      const edge = back ? stopsIn(ctx, ids[0]!)[0] : stopsIn(ctx, ids.at(-1)!).at(-1)
      const next = edge ? neighbourStop(ctx, edge, back ? -1 : 1) : null
      if (next) this.#enterStop(next, back, e.key === 'ArrowUp' || e.key === 'ArrowDown')
      return
    }
    if (e.key === 'Enter' && plain && !e.shiftKey) {
      e.preventDefault()
      const last = ids.at(-1)!
      const own = stopsIn(ctx, last).filter((st) => st.field !== null)
      // Back to editing in the block; a block without text gets a new text after it.
      if (own.length > 0) { this.#enterStop(own[0]!, true, false); return }
      this.apply(insertAfter(ctx, last, newBlock(ctx, PARAGRAPH)))
      return
    }
    if (plain && e.key.length === 1 && !e.isComposing) {
      // Typing on selected blocks: a lone block without text gets a new text after it; otherwise the text replaces the selection.
      e.preventDefault()
      const p = newBlock(ctx, PARAGRAPH, { content: { text: e.key, formats: [] } })
      // Optional fields (a picture's caption) do not count: typing on a picture adds text after it, never replaces it.
      const lone = ids.length === 1 && this.#hasNoText(ids[0]!)
      this.apply(lone ? insertAfter(ctx, ids[0]!, p) : pasteBlocks(ctx, s, [p]))
    }
  }

  /**
   * Keys on text selected across parts. Shift with arrows,
   * Home, End and Page keys extend natively; copy, cut and paste come as
   * clipboard events; everything that edits is done on the model.
   */
  #rangeKey(e: KeyboardEvent, s: RangeSelection): void {
    for (const hook of this.#keyHooks) if (hook(e, null)) return
    // An input method starts: the text goes first, and composition happens in the field (no DOM change across fields).
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- keyCode 229 is the only signal on Android
    if (e.isComposing || e.keyCode === 229 || e.key === 'Process' || e.key === 'Dead') { this.#collapseForInput(); return }
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (mod && !e.altKey && !e.shiftKey && ['c', 'x', 'v'].includes(key)) return
    const shortcut = this.fieldShortcuts.find((sc) => matchesShortcut(sc, e, this.keymap.mac))
    if (shortcut) {
      e.preventDefault()
      const c = shortcut.command
      if (c === 'undo') this.undo()
      else if (c === 'redo') this.redo()
      else if (c === 'link') this.#emit('requestLink', null)
      else if (c === 'clearFormatting') this.formatAcross('clear')
      else this.formatAcross({ toggle: { type: c.format } })
      return
    }
    if (this.keymap.run(e, 'range', this)) { e.preventDefault(); return }
    const ctx = this.#ctx()
    const ends = rangeEnds(ctx, s)
    if (!ends) return
    if (e.key === 'Escape' && !mod && !e.altKey && !e.shiftKey) {
      e.preventDefault()
      const ids = rangeBlocks(ctx, ends)
      this.select(blockSelection(ids[0]!, ids.at(-1)), 'select')
      this.announce(this.strings.blocksSelected(ids.length))
      return
    }
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); this.apply(deleteAcross(ctx, s)); return }
    if (e.key === 'Enter' && !mod && !e.altKey) {
      e.preventDefault()
      this.apply(e.shiftKey ? replaceAcross(ctx, s, '\n') : splitAcross(ctx, s))
      return
    }
    if (e.shiftKey || e.altKey || mod) return
    const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']
    if (arrows.includes(e.key)) {
      // A plain arrow ends the selection at its start or end, as in a word processor.
      e.preventDefault()
      const rtl = this.field(ends.start.blockId, ends.start.field)?.direction() === 'rtl'
      const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight'
      const toStart = horizontal ? (e.key === 'ArrowLeft') !== rtl : e.key === 'ArrowUp'
      const p = !horizontal && e.key !== 'ArrowUp' && e.key !== 'ArrowDown' ? s.focus : toStart ? ends.start : ends.end
      this.select(caret(p.blockId, p.field, p.offset))
      return
    }
    if (e.key.length === 1) { e.preventDefault(); this.apply(replaceAcross(ctx, s, e.key)) }
  }

  /** beforeinput on the canvas while it spans fields: never the browser's edit, always the model's. */
  #rangeInput(e: InputEvent): void {
    const s = this.#selection
    if (s.kind !== 'range') return
    if (e.inputType === 'insertCompositionText') return
    e.preventDefault()
    const ctx = this.#ctx()
    const text = e.data ?? e.dataTransfer?.getData('text/plain') ?? ''
    switch (e.inputType) {
      case 'insertText':
      case 'insertReplacementText':
        if (text !== '') this.apply(replaceAcross(ctx, s, text))
        return
      case 'insertParagraph': this.apply(splitAcross(ctx, s)); return
      case 'insertLineBreak': this.apply(replaceAcross(ctx, s, '\n')); return
      case 'historyUndo': this.undo(); return
      case 'historyRedo': this.redo(); return
      case 'formatBold': this.formatAcross({ toggle: { type: 'bold' } }); return
      case 'formatItalic': this.formatAcross({ toggle: { type: 'italic' } }); return
      case 'formatUnderline': this.formatAcross({ toggle: { type: 'underline' } }); return
      default:
        if (e.inputType.startsWith('delete') && e.inputType !== 'deleteByCut' && e.inputType !== 'deleteByDrag') this.apply(deleteAcross(ctx, s))
    }
  }

  /**
   * Before an input method writes: the range's text goes and the caret lands in
   * its field now, synchronously, so the composition happens there
   * (no DOM change across fields during composition).
   */
  #collapseForInput(): void {
    const s = this.#selection
    if (s.kind !== 'range') return
    const change = deleteAcross(this.#ctx(), s)
    if (!change) return
    this.apply(change, { keepFocus: true })
    this.#span(false)
    this.#syncDom()
  }

  /** Keys on selected cells: extend, collapse, empty, copy, paste, type over. */
  #cellsKey(e: KeyboardEvent, s: Extract<EditorSelection, { kind: 'cells' }>): void {
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (mod && !e.altKey && !e.shiftKey && (key === 'c' || key === 'x' || e.code === 'KeyC' || e.code === 'KeyX')) {
      e.preventDefault()
      this.#copyBlocks(key === 'x' || e.code === 'KeyX')
      return
    }
    if (mod && !e.altKey && !e.shiftKey && (key === 'v' || e.code === 'KeyV')) { this.#bin?.focus({ preventScroll: true }); return }
    // Delete and Backspace empty the cells below; the block commands refuse a table's cells.
    if (this.keymap.run(e, 'blocks', this, (c) => c.name === 'remove')) { e.preventDefault(); return }
    const plain = !e.altKey && !mod
    if (!plain) return
    const ctx = this.#ctx()
    const ids = selectedCells(this.#tree, s)
    const dir = this.#cellDirection(e.key, s.focusId)
    if (dir) {
      e.preventDefault()
      if (e.shiftKey) {
        const next = cellToward(this.#tree, s.tableId, s.focusId, dir)
        if (next) { this.select(cellSelection(s.tableId, s.anchorId, next), 'select'); this.#announceCells() }
        return
      }
      // A plain arrow goes back to text, in the cell the selection ended on.
      const own = stopsIn(ctx, s.focusId)
      const back = dir === 'up' || dir === 'left'
      const stop = back ? own[0] : own.at(-1)
      if (stop) this.select(stopEdge(new Draft(ctx), stop, back ? 'start' : 'end'))
      return
    }
    if (e.shiftKey) return
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.apply(clearCells(ctx, ids)); return }
    if (e.key === 'Escape') { e.preventDefault(); this.select(blockSelection(s.tableId), 'select'); this.announce(this.strings.blocksSelected(1)); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      const end = stopsIn(ctx, s.focusId).at(-1)
      if (end) this.select(stopEdge(new Draft(ctx), end, 'end'))
      return
    }
    if (e.key.length === 1 && !e.isComposing) {
      // Typing over selected cells empties them; the text goes into the first, as in a spreadsheet.
      e.preventDefault()
      const d = new Draft(ctx)
      for (const id of ids) { d.remove(d.kids(id)); d.insert(id, 0, [newBlock(ctx, PARAGRAPH)]) }
      const first = d.kids(ids[0]!)[0]!
      d.set(first, { content: { text: e.key, formats: [] } })
      this.apply(d.done(caret(first, 'content', 1)))
    }
  }

  /** An arrow key as a direction in a table: left and right follow the cell's writing direction. */
  #cellDirection(key: string, cellId: string): CellDirection | null {
    if (key === 'ArrowUp') return 'up'
    if (key === 'ArrowDown') return 'down'
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null
    const el = this.#wrapper(cellId)
    const rtl = el ? getComputedStyle(el).direction === 'rtl' : false
    return (key === 'ArrowLeft') !== rtl ? 'left' : 'right'
  }

  #announceCells(): void {
    const s = this.#selection
    const r = s.kind === 'cells' ? selectionRect(this.#tree, s) : null
    if (r) this.announce(this.strings.table.cellsSelected(r.rect.bottom - r.rect.top + 1, r.rect.right - r.rect.left + 1))
  }

  /**
   * Up or Down out of a cell's first or last line: the cell above or below in
   * the same column (kept across presses), or out of the table at its edge.
   * Null when the move stays inside the cell.
   */
  #tableStop(blockId: string, back: boolean, here: Stop): { stop: Stop | null } | null {
    const cell = enclosing(this.#tree, blockId, CELL)
    if (cell === null) return null
    const ctx = this.#ctx()
    const next = neighbourStop(ctx, here, back ? -1 : 1)
    if (next && enclosing(this.#tree, next.blockId, CELL) === cell) return null
    const table = enclosing(this.#tree, cell, TABLE)!
    this.#goalCol ??= cellIn(tableGrid(this.#tree, table), cell)?.col ?? 0
    const target = cellToward(this.#tree, table, cell, back ? 'up' : 'down', this.#goalCol)
    if (target !== null) {
      const own = stopsIn(ctx, target)
      return { stop: (back ? own.at(-1) : own[0]) ?? null }
    }
    const inside = stopsIn(ctx, table).filter((st) => enclosing(this.#tree, st.blockId, CELL) !== null)
    const edge = back ? inside[0] : inside.at(-1)
    return { stop: edge ? neighbourStop(ctx, edge, back ? -1 : 1) : null }
  }

  /**
   * Up or Down into a table from outside: the cell of its last (or first) row
   * under the caret's horizontal position, not the last cell in reading order.
   */
  #intoTable(next: Stop, back: boolean, x: number): Stop | null {
    const cell = enclosing(this.#tree, next.blockId, CELL)
    const table = cell === null ? null : enclosing(this.#tree, cell, TABLE)
    if (table === null) return null
    const grid = tableGrid(this.#tree, table)
    const row = back ? grid.rows - 1 : 0
    const inRow = [...new Set(grid.slots[row] ?? [])].filter((i) => i >= 0).map((i) => grid.cells[i]!)
    let best: string | null = null, distance = Infinity
    for (const c of inRow) {
      const r = this.#wrapper(c.item)?.getBoundingClientRect()
      if (!r) continue
      const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0
      if (d < distance) { distance = d; best = c.item }
    }
    if (best === null) return null
    this.#goalCol = cellIn(grid, best)?.col ?? null
    const own = stopsIn(this.#ctx(), best)
    return (back ? own.at(-1) : own[0]) ?? null
  }

  /** Shift+arrow on selected blocks: the focus end moves to the sibling before or after. */
  #extendBlocks(back: boolean): void {
    const s = this.#selection
    if (s.kind !== 'blocks') return
    const { parent, anchor, focus } = liftToSiblings(this.#tree, s.anchorId, s.focusId)
    const kids = childrenOf(this.#tree, parent)
    const next = kids[kids.indexOf(focus) + (back ? -1 : 1)]
    if (next === undefined) {
      // At the end of a container: grow to the container itself.
      if (parent === null) return
      this.select(blockSelection(parent), 'select')
    } else this.select(blockSelection(anchor, next), 'select')
    this.announce(this.strings.blocksSelected(selectedBlocks(this.#tree, this.#selection).length))
  }

  /** Copy, cut and paste on text across parts: an open slice of blocks. */
  #rangeClipboard(e: ClipboardEvent): void {
    const s = this.#selection
    const data = e.clipboardData
    if (s.kind !== 'range' || !data) return
    e.preventDefault()
    const ctx = this.#ctx()
    if (e.type === 'paste') { this.#pasteAcross(s, data); return }
    writeBlocks(data, copyAcross(ctx, this.registry, s), this.registry, this.formats, true)
    if (e.type === 'cut') {
      const change = deleteAcross(ctx, s)
      this.apply(change ? { ...change, announce: this.strings.textCut } : null)
    } else this.announce(this.strings.textCopied)
  }

  /** A paste onto text across parts replaces it, as one undo step. */
  #pasteAcross(s: RangeSelection, data: DataTransfer): void {
    const ctx = this.#ctx()
    const removed = deleteAcross(ctx, s)
    if (!removed) return
    const at = removed.selection
    if (at.kind !== 'text') { this.apply(removed); return }
    if (data.files.length > 0 && this.#takeFilesAfter(removed, data)) return
    const clip = readClip(data, this.registry, this.#clipOptions())
    const inline = (blocks: readonly Block[]): RichTextValue | null => {
      const one = blocks.length === 1 ? blocks[0]! : null
      const def = one ? this.editing.get(one.type) : undefined
      const main = mainField(def)
      return one && main && !one.children?.length && def?.fields.length === 1 ? fieldValue(one, main.attr) : null
    }
    if (clip) {
      const value = inline(clip.blocks)
      this.apply(andThen(ctx, removed, (next) => (value ? pasteInline(next, at, value) : pasteBlocks(next, at, clip.blocks, clip.open))))
      return
    }
    const foreign = this.#foreign(data)
    if (!foreign) {
      const text = data.getData('text/plain').replace(/\r\n?/g, '\n')
      this.apply(text === '' ? removed : andThen(ctx, removed, (next) => pasteInline(next, at, { text, formats: [] })))
      return
    }
    const blocks = this.#withoutKnownAnchors(foreign.blocks)
    const value = blocks[0]?.type === PARAGRAPH ? inline(blocks) : null
    this.apply(blocks.length === 0 ? removed : andThen(ctx, removed, (next) => (value ? pasteInline(next, at, value) : pasteBlocks(next, at, blocks))))
    this.#imported('paste', foreign)
  }

  /** Pictures pasted onto a range: the text goes, then the interface uploads them at the caret. */
  #takeFilesAfter(removed: Change, data: DataTransfer): boolean {
    const html = data.getData('text/html')
    if (html.trim() !== '' && !onlyPictures(html)) return false
    this.apply(removed)
    return this.#takeFiles(data, this.#selection)
  }

  /**
   * An input method that wrote into the canvas anyway (it started before the
   * range could collapse): every field is put back to its value, and the
   * composed text goes in at the caret through the model.
   */
  #compositionInCanvas(e: CompositionEvent): void {
    for (const f of this.#fields.values()) if (!f.isCanonical()) f.setValue(f.value)
    const s = this.#selection
    if (s.kind === 'range') this.apply(replaceAcross(this.#ctx(), s, e.data))
    else if (s.kind === 'text' && e.data) this.field(s.blockId, s.field)?.insertText(e.data, 'composition')
  }

  #copyBlocks(cut: boolean): void {
    if (!this.#canvas) return
    const s = this.#selection
    let pending: PendingCopy
    if (s.kind === 'cells') {
      const r = selectionRect(this.#tree, s)
      if (!r) return
      // The cells travel as a table of their own; cutting empties them, the grid stays.
      const ids = selectedCells(this.#tree, s)
      pending = { blocks: [cellsToCopy(this.#tree, s.tableId, r.rect)], count: ids.length, cut: cut ? () => { this.apply(clearCells(this.#ctx(), ids)) } : null }
    } else {
      const ids = this.targets()
      if (ids.length === 0) return
      pending = {
        blocks: blocksToCopy(this.#tree, this.registry, ids),
        count: ids.length,
        cut: cut ? () => {
          const change = removeBlocks(this.#ctx(), ids)
          this.apply(change ? { ...change, announce: this.strings.cut(ids.length) } : null)
        } : null,
      }
    }
    this.#pendingCopy = pending
    // Fires a copy event synchronously, which #copyEvent fills (WebKit returns false but still fires it).
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only way to fire a copy event from a key press with nothing selected
    this.#canvas.ownerDocument.execCommand('copy')
    this.#pendingCopy = null
  }

  #copyEvent(e: ClipboardEvent): void {
    const pending = this.#pendingCopy
    if (!pending || !e.clipboardData) return
    this.#pendingCopy = null
    e.preventDefault()
    e.stopPropagation()
    writeBlocks(e.clipboardData, pending.blocks, this.registry, this.formats)
    if (pending.cut) pending.cut()
    else this.announce(this.strings.copied(pending.count))
  }

  #binPaste(e: ClipboardEvent): void {
    e.preventDefault()
    const data = e.clipboardData
    const s = this.#selection
    const back = (): void => { void nextTick(() => { this.#syncDom() }) }
    if (!data || (s.kind !== 'blocks' && s.kind !== 'cells')) { back(); return }
    if (s.kind === 'cells') { if (!this.#pasteIntoCells(s, data)) back(); return }
    if (this.#takeFiles(data, s)) return
    const pasted = readBlocks(data, this.registry, this.#clipOptions())
    if (pasted) { if (!this.apply(pasteBlocks(this.#ctx(), s, pasted))) back(); return }
    // Selected parts are replaced by whatever came: HTML through the pipeline, any text as paragraphs.
    const foreign = this.#foreign(data, true)
    if (!foreign || !this.#placeImported('paste', s, foreign)) back()
  }

  /**
   * A paste onto selected cells: a table fills the cells from the first one on,
   * as in a spreadsheet; other content replaces the first cell's.
   */
  #pasteIntoCells(s: Extract<EditorSelection, { kind: 'cells' }>, data: DataTransfer): boolean {
    const blocks = readBlocks(data, this.registry, this.#clipOptions())
      ?? this.#foreign(data, true)?.blocks
    if (!blocks || blocks.length === 0) return false
    const first = selectedCells(this.#tree, s)[0]
    if (first === undefined) return false
    return this.#fillFrom(s.tableId, first, blocks)
  }

  /** A table pasted with the caret in a table cell fills the cells from that one. */
  #fillAtCaret(blockId: string, blocks: readonly Block[]): boolean {
    if (blocks.length !== 1 || blocks[0]!.type !== TABLE) return false
    const cell = enclosing(this.#tree, blockId, CELL)
    const table = cell === null ? null : enclosing(this.#tree, cell, TABLE)
    return cell !== null && table !== null && this.apply(fillCells(this.#ctx(), table, cell, blocks[0]!))
  }

  /** Pasted blocks into the cell `cellId`: a table fills cells; the rest replaces the cell's content. */
  #fillFrom(tableId: string, cellId: string, blocks: readonly Block[]): boolean {
    const table = blocks.length === 1 && blocks[0]!.type === TABLE ? blocks[0]! : null
    const ctx = this.#ctx()
    if (table) return this.apply(fillCells(ctx, tableId, cellId, table))
    const d = new Draft(ctx)
    const fits = blocks.filter((b) => canHold(d, cellId, b.type))
    if (fits.length === 0) return false
    d.remove(d.kids(cellId))
    d.insert(cellId, 0, fits)
    const end = stopsIn(d.now(null), cellId).at(-1)
    return this.apply(d.done(end ? stopEdge(d, end, 'end') : caret(cellId, 'content', 0), { announce: this.strings.pasted(fits.length) }))
  }

  /** Two places in different cells of one table: the cells between them. */
  #cellsBetween(from: string, to: string): EditorSelection | null {
    if (!this.#tree.nodes.has(from) || !this.#tree.nodes.has(to)) return null
    const a = enclosing(this.#tree, from, CELL), b = enclosing(this.#tree, to, CELL)
    if (a === null || b === null || a === b) return null
    const table = enclosing(this.#tree, a, TABLE)
    return table !== null && table === enclosing(this.#tree, b, TABLE) ? cellSelection(table, a, b) : null
  }

  #mouseDown(e: MouseEvent): void {
    if (e.button !== 0) return
    this.#goalX = null
    this.#goalCol = null
    const target = blockAt(e.target)
    if (!target) return
    const s = this.#selection
    if (e.shiftKey && s.kind !== 'none') {
      const from = s.kind === 'text' ? s.blockId : s.kind === 'range' ? s.anchor.blockId : s.anchorId
      const cells = this.#cellsBetween(from, target)
      if (cells) {
        e.preventDefault()
        this.select(cells, 'select')
        this.#announceCells()
        return
      }
      // Shift+click in other text selects the text up to there.
      const anchor = s.kind === 'text' ? { blockId: s.blockId, field: s.field, offset: s.anchor } : s.kind === 'range' ? s.anchor : null
      const inText = e.target instanceof Element && e.target.closest('.pz-richtext') !== null
      const to = anchor && inText ? this.#pointAtXY(e) : null
      if (anchor && to && (to.blockId !== anchor.blockId || to.field !== anchor.field || s.kind === 'range')) {
        e.preventDefault()
        const next = this.#valid(normalizeRange(this.#ctx(), anchor, to))
        this.select(next, next.kind === 'cells' ? 'select' : 'edit')
        if (next.kind === 'range') this.announce(this.strings.selectedAcross(this.acrossParts()))
        return
      }
      // Shift+click on a part without text selects whole parts up to it.
      if (from !== target && this.#tree.nodes.has(from)) {
        e.preventDefault()
        const { anchor, focus } = liftToSiblings(this.#tree, from, target)
        this.select(blockSelection(anchor, focus), 'select')
        this.announce(this.strings.blocksSelected(selectedBlocks(this.#tree, this.#selection).length))
        return
      }
    }
    const onField = e.target instanceof Element && e.target.closest('.pz-richtext') !== null
    if (!onField) {
      // Some browsers do not focus buttons on click. Activate the block without taking focus from the control.
      if (e.target instanceof Element && e.target.closest(FORM_CONTROL)) { this.#activateBlock(target); return }
      if (e.target instanceof Element && e.target.closest('label, a[href]')) return
      // A click on a block without text (a separator) selects it.
      if (this.#hasNoText(target) && this.#tree.children.get(target) === undefined) {
        e.preventDefault()
        this.select(blockSelection(target), 'edit')
      }
      return
    }
    this.#dragFrom = target
    this.#dragPoint = this.#pointAtXY(e)
    this.#dragAcross = false
  }

  /** The text point under the pointer: in the field there, or the nearest field (above or below a gap, beside a picture). */
  #pointAtXY(e: MouseEvent): TextPoint | null {
    const t = e.target instanceof Element ? e.target : null
    const root = this.#canvas?.getRootNode()
    const under = root instanceof ShadowRoot || root instanceof Document ? root.elementFromPoint(e.clientX, e.clientY) : t
    const fe = (under ?? t)?.closest<HTMLElement>('[data-field]')
    const id = fe?.closest<HTMLElement>('[data-block]')?.dataset.block
    const attr = fe?.dataset.field
    let field = id && attr ? this.field(id, attr) : undefined
    if (!field || field.element !== fe) {
      // Not over text: the field nearest the pointer, above or below.
      let best = Infinity
      field = undefined
      for (const f of this.#fields.values()) {
        const r = f.element.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        const dy = e.clientY < r.top ? r.top - e.clientY : e.clientY > r.bottom ? e.clientY - r.bottom : 0
        const dx = e.clientX < r.left ? r.left - e.clientX : e.clientX > r.right ? e.clientX - r.right : 0
        const d = dy * 4 + dx
        if (d < best) { best = d; field = f }
      }
    }
    const key = field ? this.#fieldKeys.get(field) : undefined
    if (!field || !key) return null
    const r = field.element.getBoundingClientRect()
    const offset = e.clientY < r.top ? 0 : e.clientY > r.bottom ? field.value.text.length : field.offsetAtPoint(e.clientX, e.clientY)
    return { blockId: key.blockId, field: key.attr, offset }
  }

  #pointerMove(e: PointerEvent): void {
    if (this.#dragFrom === null || (e.buttons & 1) === 0) return
    const over = blockAt(e.target)
    if (!this.#tree.nodes.has(this.#dragFrom)) return
    const s = this.#selection
    // A drag from one cell into another selects cells.
    const cells = over && this.#tree.nodes.has(over) ? this.#cellsBetween(this.#dragFrom, over) : null
    if (cells || (this.#canvas?.classList.contains('is-selecting') ?? false)) {
      if (!cells || selectionsEqual(cells, s)) return
      this.#canvas?.classList.add('is-selecting')
      this.#canvas?.ownerDocument.getSelection()?.removeAllRanges()
      this.#mode = 'select'
      this.#setSelection(cells)
      return
    }
    // From one field into another, text across parts. The editor drives the
    // selection from here on: Firefox keeps a native drag inside the field it started in.
    const from = this.#dragPoint
    const to = from ? this.#pointAtXY(e) : null
    if (!from || !to) return
    if (!this.#dragAcross && to.blockId === from.blockId && to.field === from.field) return
    const next = this.#valid(normalizeRange(this.#ctx(), from, to))
    this.#dragAcross = true
    if (next.kind === 'none' || selectionsEqual(next, s)) return
    this.#mode = next.kind === 'cells' ? 'select' : 'edit'
    this.#setSelection(next)
    const c = this.#canvas
    const sel = c ? selectionSourceFor(c)() : null
    const a = next.kind === 'range' ? this.#domPoint(next.anchor) : next.kind === 'text' ? this.#domPoint({ blockId: next.blockId, field: next.field, offset: next.anchor }) : null
    const f = next.kind === 'range' ? this.#domPoint(next.focus) : next.kind === 'text' ? this.#domPoint({ blockId: next.blockId, field: next.field, offset: next.focus }) : null
    if (sel && a && f) sel.setBaseAndExtent(a.node, a.offset, f.node, f.offset)
  }

  #pointerUp(): void {
    const dragged = this.#canvas?.classList.contains('is-selecting') ?? false
    const across = this.#dragAcross
    this.#dragFrom = null
    this.#dragPoint = null
    this.#dragAcross = false
    if (across) {
      this.#span(this.#selection.kind === 'range')
      if (this.#selection.kind === 'range') this.announce(this.strings.selectedAcross(this.acrossParts()))
      void nextTick(() => { this.#syncDom() })
      return
    }
    if (!dragged) return
    this.#canvas?.classList.remove('is-selecting')
    if (this.#selection.kind === 'cells') this.#announceCells()
    else this.announce(this.strings.blocksSelected(selectedBlocks(this.#tree, this.#selection).length))
    void nextTick(() => { this.#syncDom() })
  }

  #focusIn(e: FocusEvent): void {
    if (!this.#focused) { this.#focused = true; this.#emit('focus') }
    // A block wrapper or one of its form fields can receive focus directly.
    const t = e.target
    if (!(t instanceof HTMLElement) || t.closest('.pz-richtext')) return
    this.#activateBlock(t.dataset.block ?? (t.matches(FORM_CONTROL) ? blockAt(t) : null))
  }

  #activateBlock(id: string | null): void {
    const s = this.#selection
    if (id && this.#tree.nodes.has(id) && !((s.kind === 'blocks' || s.kind === 'cells') && s.focusId === id)) {
      this.#mode = 'edit'
      this.#setSelection(blockSelection(id))
    }
  }

  #focusOut(e: FocusEvent): void {
    const next = e.relatedTarget
    if (next instanceof Node && (this.#canvas?.contains(next) || next === this.#bin)) return
    // The paste bin takes focus for a moment during Mod+V; that is not leaving.
    queueMicrotask(() => {
      if (this.#canvas && (hasFocusWithin(this.#canvas) || (this.#bin && hasFocusWithin(this.#bin)))) return
      if (this.#focused) { this.#focused = false; this.#emit('blur') }
    })
  }
}

/** Every block in reading order, containers before their children (select mode moves through these). */
export function allBlocks(tree: Tree): string[] {
  const out: string[] = []
  const walk = (ids: readonly string[]): void => { for (const id of ids) { out.push(id); walk(tree.children.get(id) ?? []) } }
  walk(childrenOf(tree, null))
  return out
}

/**
 * Scroll an element into view only when it is outside the viewport.
 * scrollIntoView always lays out the whole canvas (15 ms at 2,000 blocks in Chromium).
 */
function revealIfHidden(el: HTMLElement): void {
  const r = el.getBoundingClientRect()
  const view = el.ownerDocument.defaultView
  const h = view?.innerHeight ?? 0
  if (r.top < 0 || r.bottom > h) el.scrollIntoView({ block: 'nearest' })
}

function blockAt(target: EventTarget | null): string | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-block]')?.dataset.block ?? null : null
}

/** HTML with no words in it, only pictures: what a browser puts beside a copied picture's file. */
function onlyPictures(html: string): boolean {
  // Parsed inert, not matched with patterns: those backtracked over foreign markup with many unclosed tags.
  const body = new DOMParser().parseFromString(html, 'text/html').body
  for (const el of body.querySelectorAll('script, style, template')) el.remove()
  return body.querySelector('img') !== null && !/\S/.test(body.textContent)
}
