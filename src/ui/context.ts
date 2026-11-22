/**
 * Interface state shared by the chrome around the canvas:
 * which part the tools belong to, which menu is open, the inserter's items.
 * The document itself is only ever changed through the editor.
 */
import { type Component, type ComputedRef, type InjectionKey, type Ref, computed, inject, nextTick, ref, shallowRef } from 'vue'
import type { Autosave } from '../editor/autosave'
import type { Editor, FormatTarget, ImportEvent } from '../editor/editor'
import type { InserterItem } from '../editor/editing'
import { focusBlock } from '../editor/selection'
import { type InsertAt, insertBlocks, newBlock } from '../editor/structure'
import { contrastRatio } from '../model/color'
import { DOC_VERSION, validateDoc } from '../model/schema'
import { type Block, type Tree, childrenOf, parentOf } from '../model/tree'
import { animateNew } from './motion'
import type { UiStrings } from './strings'
import { type UploadAdapter, Uploads, accepts } from './upload'
import { Attachments } from './attachments'
import type { RequestAttachment } from '../editor/upload'

/** A ready-made multi-block layout in the inserter. Hosts pass these. */
export interface Pattern {
  readonly id: string
  readonly title: string
  readonly keywords?: readonly string[]
  /** Stored blocks; validated on insert, with fresh ids. */
  readonly blocks: readonly unknown[]
}

/** Device widths the preview offers, in CSS pixels of the text column. */
export const DEVICES = { tablet: 768, phone: 390 } as const
export type Preview = '' | keyof typeof DEVICES

/** Where the add menu puts its choice. */
export type AddTarget =
  | { readonly kind: 'part'; readonly id: string }
  | { readonly kind: 'end' }
  | { readonly kind: 'slash'; readonly id: string }

/** A page or anchor the link field offers (`links`). */
export interface LinkSuggestion {
  readonly title: string
  readonly url: string
  /** What it is, in the host's words ("Page", "Article"). */
  readonly kind?: string
}

export type LinkSearch = (query: string, options: { readonly signal: AbortSignal }) => Promise<readonly LinkSuggestion[]>

/**
 * A named text colour of the host theme (presets instead of
 * values). The canvas shows it through the class `pz-color-<name>`; the host's
 * published stylesheet gives that class the same colour.
 */
export interface ColorPreset {
  /** Class name part: lowercase letters, digits and `-`. */
  readonly name: string
  /** In the interface language. */
  readonly label: string
  /** `#rrggbb` on the light page. */
  readonly color: string
  /** `#rrggbb` on the dark page; default `color`. */
  readonly dark?: string
}

/** The page colours colour presets are measured against, light and dark (`--page`). */
export const PAGE = { light: '#FFFFFF', dark: '#1A1A1E' } as const

/** Presets readable as body text on both page colours (4.5:1, WCAG 1.4.3). Others are not offered. */
export function readable(palette: readonly ColorPreset[]): ColorPreset[] {
  return palette.filter((c) => (contrastRatio(c.color, PAGE.light) ?? 0) >= 4.5 && (contrastRatio(c.dark ?? c.color, PAGE.dark) ?? 0) >= 4.5)
}

/** The text colours offered when the host names none. */
export function defaultPalette(t: Pick<UiStrings, 'colorNames'>): ColorPreset[] {
  return [
    { name: 'grey', label: t.colorNames.grey, color: '#4B4C56', dark: '#B9B6AF' },
    { name: 'orange', label: t.colorNames.orange, color: '#B93E0C', dark: '#FF8E5C' },
    { name: 'blue', label: t.colorNames.blue, color: '#1D4ED8', dark: '#8AB4FF' },
  ]
}

/** A button a plugin adds to the format bar's More menu (plugin API). */
export interface ToolbarItem {
  readonly id: string
  /** In the interface language: `lang` is the interface's. */
  title(lang: string): string
  /** Toggles this inline format; or `run` acts on the selected text itself. */
  readonly format?: string
  run?(target: FormatTarget, editor: Editor): void
}

/** Rows a plugin adds to the part options of some block types. Receives the props `id` and `node`. */
export interface InspectorPanel {
  /** Block types it is for; `*` for every type. */
  readonly types: readonly string[] | '*'
  readonly component: Component
}

/** A style variant of a block type: the class `pz-style-<name>`, which the host's stylesheet defines. */
export interface StyleVariant {
  /** Lowercase letters, digits and `-`. */
  readonly name: string
  /** In the interface language. */
  readonly label: string
}

export interface UiOptions {
  /** `bubble` (default): formatting above selected words. `docked`: a bar at the top of the field. */
  readonly toolbar?: 'bubble' | 'docked'
  readonly patterns?: readonly Pattern[]
  /** The host's upload adapter; without it media come from web addresses only. */
  readonly upload?: UploadAdapter | null
  /** The host's search for pages to link to. */
  readonly links?: LinkSearch | null
  /** Text colours; the default palette when omitted. */
  readonly palette?: readonly ColorPreset[]
  /**
   * Pictures an import found on other sites are fetched and stored through the
   * upload adapter (re-hosting is a host option). Needs
   * the other site to allow it (CORS); a picture it refuses keeps its address.
   */
  readonly rehostImages?: boolean
  /** A fixed height (a CSS length): the text scrolls inside. Default: the field grows with its text. */
  readonly height?: string
  /** Styles the host defines per block type (TinyMCE `importcss`): offered as Style in the part options. */
  readonly styles?: Readonly<Record<string, readonly StyleVariant[]>>
  /** Authors may lock and unlock parts. Locks in loaded content hold either way. */
  readonly locking?: boolean
  readonly toolbarItems?: readonly ToolbarItem[]
  readonly inspectorPanels?: readonly InspectorPanel[]
  /** Justified text is offered in Align (off by default: it harms readability). */
  readonly justify?: boolean
  /** Draft recovery: a draft from an earlier visit is offered back at the top of the field. */
  readonly draft?: Autosave | null
  /** The host's attachment manager, and where its answers arrive (the editor's host element). */
  readonly requestAttachment?: RequestAttachment | null
  readonly replyTarget?: EventTarget | null
}

export interface Ui {
  readonly editor: Editor
  readonly t: UiStrings
  readonly toolbar: 'bubble' | 'docked'
  /** Everything the inserter offers: block entries the preset allows, then patterns. */
  readonly items: readonly InserterItem[]
  readonly uploads: Uploads
  /** The host's attachment manager; `available` false without `hooks.requestAttachment`. */
  readonly attachments: Attachments
  readonly links: LinkSearch | null
  /** Text colours readable on the page in both schemes. */
  readonly palette: readonly ColorPreset[]
  /** Focus is somewhere in the editor (field, tools, menus). */
  readonly focused: Ref<boolean>
  /** The top-level part holding the selection: its tools show. */
  readonly part: ComputedRef<string | null>
  /** The top-level part under the pointer. */
  readonly hover: Ref<string | null>
  readonly add: Ref<AddTarget | null>
  /** The part whose options are open. */
  readonly options: Ref<string | null>
  /** The settings button rendered beside the active part. */
  readonly settingsButton: Ref<HTMLElement | null>
  /** The format bar shows the link field. */
  readonly linking: Ref<boolean>
  /** Device preview (`preview`): the canvas narrowed to a device's width. */
  readonly preview: Ref<Preview>
  /** The part inside the open options' part that they act on (a text in a column); null: the default. */
  readonly optionsFor: Ref<string | null>
  readonly full: Ref<boolean>
  readonly recent: Ref<readonly string[]>
  /** A coarse pointer: the format bar docks above the on-screen keyboard. */
  readonly coarse: Ref<boolean>
  /** A part is being dragged by its stems. */
  readonly dragging: Ref<string | null>
  readonly work: Ref<HTMLElement | null>
  readonly helpOpen: Ref<boolean>
  readonly sourceOpen: Ref<boolean>
  /** The last import that changed or lost something: the status line offers its report. */
  readonly report: Ref<ImportEvent | null>
  readonly reportOpen: Ref<boolean>
  readonly outlineOpen: Ref<boolean>
  /** The accessibility checker's panel. */
  readonly checkOpen: Ref<boolean>
  /** A pointer is down in the canvas (a selection being dragged): the bubble waits. */
  readonly pointerDown: Ref<boolean>
  /** Attributes the `/` menu puts on the field it reads from (aria-activedescendant and friends). */
  readonly fieldAria: Ref<{ readonly blockId: string; readonly attrs: Readonly<Record<string, string>> } | null>
  readonly draft: Autosave | null
  readonly height: string | null
  readonly styles: Readonly<Record<string, readonly StyleVariant[]>>
  readonly locking: boolean
  readonly toolbarItems: readonly ToolbarItem[]
  readonly inspectorPanels: readonly InspectorPanel[]
  readonly justify: boolean
  // More tools
  readonly findOpen: Ref<boolean>
  /** Spaces, non-breaking spaces and paragraph ends shown (TinyMCE `visualchars`). */
  readonly invisibles: Ref<boolean>
  /** Every part outlined (TinyMCE `visualblocks`). */
  readonly outlines: Ref<boolean>
  readonly charactersOpen: Ref<boolean>
  /** Characters inserted lately, newest first, offered first in the picker. */
  readonly recentCharacters: Ref<readonly string[]>
  readonly countsOpen: Ref<boolean>
  readonly pageOpen: Ref<boolean>
  /** The draft from an earlier visit while it waits for the author's answer. */
  readonly draftFound: Ref<boolean>
  insert(item: InserterItem, target: AddTarget): boolean
  /** Back to the caret (or the selected part) in the canvas, as Escape does from a toolbar. */
  focusText(): void
}

const UI: InjectionKey<Ui> = Symbol('proza-ui')
export const uiKey = UI

/** Read reactive values only for their dependency: a computed that reads the tree re-runs when they change. */
export function track(...values: unknown[]): number {
  return values.length
}

export function useUi(): Ui {
  const ui = inject(UI)
  if (!ui) throw new Error('Proza interface component outside an editor')
  return ui
}

/** The top-level block that holds `id`. */
export function topLevel(tree: Tree, id: string | null): string | null {
  let cur = id
  if (cur === null || !tree.nodes.has(cur)) return null
  for (let p = parentOf(tree, cur); p !== null; p = parentOf(tree, p)) cur = p
  return cur
}

function emptyParagraph(tree: Tree, id: string): boolean {
  const n = tree.nodes.get(id)
  return n?.type === 'core/paragraph' && (n.attrs.content as { text?: string } | undefined)?.text === ''
}

export function createUi(editor: Editor, t: UiStrings, options: UiOptions = {}): Ui {
  const patterns: InserterItem[] = (options.patterns ?? []).map((p) => ({
    id: `pattern:${p.id}`,
    title: () => p.title,
    keywords: p.keywords ?? [],
    category: 'patterns',
    drawing: { ink: ['M6 6h84v14H6z', 'M6 28h40M6 36h40M6 44h28'], accent: ['M54 28h36v16H54z'] },
    create: (ctx) => {
      const { doc } = validateDoc({ version: DOC_VERSION, blocks: p.blocks }, ctx.schemas, { formats: editor.formats, createId: ctx.createId })
      const fresh = (b: Block): Block => ({ id: ctx.createId(), type: b.type, attrs: b.attrs, ...(b.children ? { children: b.children.map(fresh) } : {}) })
      return doc.blocks.map(fresh)
    },
  }))
  const items = [...[...editor.editing.values()].flatMap((d) => d.inserter ?? []).filter((i) => editor.offers(i.id)), ...patterns]
  const uploads = new Uploads(editor, options.upload ?? null, {
    uploading: t.uploading, uploaded: t.uploaded, failed: t.uploadFailed, cancelled: t.uploadCancelled, wrongType: (k) => t.wrongType[k],
  })
  const attachments = new Attachments(editor, options.requestAttachment ?? null, options.replyTarget ?? null, { invalid: t.attachmentInvalid, failed: t.attachmentFailed })
  const palette = readable(options.palette ?? defaultPalette(t))

  /** Image or File from the inserter, with the host's library: the block comes once a file is picked. */
  const pickThenInsert = (item: InserterItem, target: AddTarget, kind: 'image' | 'file'): void => {
    const patchFor = editor.editing.get(item.id)?.media?.patch
    if (!patchFor) return
    // A paragraph the insertion replaces (slash text, an empty line) must still be as it was.
    const replaces = target.kind === 'slash' || (target.kind === 'part' && emptyParagraph(editor.tree, target.id))
    const was = target.kind === 'end' ? undefined : editor.tree.nodes.get(target.id)
    const generation = editor.generation
    attachments.request(kind, (picked) => {
      if (!picked) { ui.focusText(); return }
      void (async () => {
        let patch: Readonly<Record<string, unknown>>
        try { patch = await patchFor(picked.result, picked.file) } catch { editor.announce(t.attachmentInvalid, 'assertive'); ui.focusText(); return }
        const now = target.kind === 'end' ? undefined : editor.tree.nodes.get(target.id)
        if (editor.generation !== generation || (target.kind !== 'end' && (!now || (replaces && now !== was)))) {
          editor.announce(t.attachmentStale, 'assertive')
          ui.focusText()
          return
        }
        place({ ...item, create: (ctx) => item.create(ctx).map((b, i) => (i === 0 ? { ...b, attrs: { ...b.attrs, ...patch } } : b)) }, target)
      })()
    })
  }

  const place = (item: InserterItem, target: AddTarget): boolean => {
    const ctx = editor.context()
    const tree = editor.tree
    let at: InsertAt
    if (target.kind === 'slash') at = { replace: target.id }
    else if (target.kind === 'part') at = emptyParagraph(tree, target.id) ? { replace: target.id } : { after: target.id }
    else {
      // Forgiving: an empty last line is used rather than left behind.
      const last = childrenOf(tree, null).at(-1)
      at = last !== undefined && emptyParagraph(tree, last) ? { replace: last } : 'end'
    }
    const blocks = item.create(ctx)
    const ok = editor.apply(insertBlocks(ctx, at, blocks, t.added(item.title(editor.strings))))
    if (!ok) return false
    ui.recent.value = [item.id, ...ui.recent.value.filter((r) => r !== item.id)].slice(0, 4)
    void nextTick(() => { for (const b of blocks) animateNew(editor.blockElement(b.id)) })
    return true
  }

  const coarse = ref(false)
  if (typeof matchMedia === 'function') {
    const mq = matchMedia('(pointer: coarse)')
    coarse.value = mq.matches
    mq.addEventListener('change', (e) => { coarse.value = e.matches })
  }

  // Pasted or dropped files become parts that take them (a picture for an image file), then upload.
  editor.onFiles((files, at, source) => {
    if (!uploads.available) return false
    const defs = [...editor.editing.values()].filter((d) => d.media && d.media.kind !== 'captions' && editor.offers(d.name))
    const taken = files.map((file) => ({ file, def: defs.find((d) => d.media!.kind !== 'file' && accepts(d.media!.kind, file)) ?? defs.find((d) => d.media!.kind === 'file') }))
      .filter((x): x is { file: File; def: (typeof defs)[number] } => x.def !== undefined)
    if (taken.length === 0) return false
    const ctx = editor.context()
    const blocks = taken.map(({ def }) => newBlock(ctx, def.name))
    const id = focusBlock(at)
    const where: InsertAt = id === null ? 'end' : emptyParagraph(editor.tree, id) ? { replace: id } : { after: id }
    if (!editor.apply(insertBlocks(ctx, where, blocks, t.added(taken.map(({ def }) => def.title({ id: '', type: def.name, attrs: {} }, editor.strings)).join(', '))))) return false
    taken.forEach(({ file, def }, i) => { uploads.start(blocks[i]!.id, def.media!.kind, file, def.media!.patch, source) })
    return true
  })

  // Imported pictures go up through the same uploads as chosen ones; those without a file keep their place for the author.
  const onImport = (e: ImportEvent): void => {
    if (e.report.entries.some((x) => x.severity !== 'info')) ui.report.value = e
    const image = [...editor.editing.values()].find((d) => d.media?.kind === 'image')
    if (!image?.media || !uploads.available) return
    for (const p of e.pending) if (p.file) uploads.start(p.blockId, 'image', p.file, image.media.patch, 'import')
    // A paste re-hosts only the parts it brought; loaded content is all imported.
    if (options.rehostImages) void rehost(e, e.origin === 'load' ? null : (justChanged ?? new Set()))
  }
  // Parts the transactions of the current task added or re-addressed: an import commits before its event, in the same task.
  let justChanged: Set<string> | null = null
  // Addresses the adapter returned are already the host's: a picture copied within the document is not stored twice.
  const stored = new Set<string>()
  if (options.rehostImages) {
    editor.on('blocksChange', (c) => {
      if (!justChanged) { justChanged = new Set(); queueMicrotask(() => { justChanged = null }) }
      for (const n of c.added) justChanged.add(n.id)
      for (const u of c.updated) if (u.before.attrs.src !== u.after.attrs.src) justChanged.add(u.id)
    })
    editor.on('upload', (u) => { if (u.status === 'succeeded' && u.result) stored.add(u.result.url) })
  }
  // shortcut: loaded HTML whose pictures already live on the host's storage at another origin is re-hosted at each load; upgrade with a host option naming its storage origins.
  const rehost = async (e: ImportEvent, only: ReadonlySet<string> | null): Promise<void> => {
    const image = [...editor.editing.values()].find((d) => d.media?.kind === 'image')
    const own = typeof location === 'undefined' ? '' : location.origin
    const waiting = new Set(e.pending.map((p) => p.blockId))
    const nodes = only ? [...only].map((id) => editor.tree.nodes.get(id)) : [...editor.tree.nodes.values()]
    for (const node of nodes) {
      const src = node?.attrs.src
      if (!node || node.type !== image?.name || waiting.has(node.id) || typeof src !== 'string' || !/^https?:\/\//i.test(src) || src.startsWith(own) || stored.has(src)) continue
      try {
        const res = await fetch(src, { mode: 'cors', credentials: 'omit' })
        const blob = res.ok ? await res.blob() : null
        if (!blob?.type.startsWith('image/')) continue
        const name = decodeURIComponent(src.split(/[?#]/)[0]!.split('/').at(-1) ?? '') || 'picture'
        uploads.start(node.id, 'image', new File([blob], name, { type: blob.type }), image.media!.patch, 'rehost')
      } catch { /* the other site refused: the picture keeps its address */ }
    }
  }

  const ui: Ui = {
    editor,
    t,
    toolbar: options.toolbar ?? 'bubble',
    items,
    uploads,
    attachments,
    links: options.links ?? null,
    palette,
    focused: ref(false),
    part: computed(() => {
      track(editor.revision.value)
      return topLevel(editor.tree, focusBlock(editor.selectionRef.value))
    }),
    hover: ref(null),
    add: ref(null),
    options: ref(null),
    settingsButton: shallowRef(null),
    linking: ref(false),
    preview: ref<Preview>(''),
    optionsFor: ref(null),
    full: ref(false),
    recent: ref([]),
    coarse,
    dragging: ref(null),
    work: ref(null),
    helpOpen: ref(false),
    sourceOpen: ref(false),
    report: ref(null),
    reportOpen: ref(false),
    outlineOpen: ref(false),
    checkOpen: ref(false),
    pointerDown: ref(false),
    fieldAria: ref(null),
    draft: options.draft ?? null,
    height: options.height ?? null,
    styles: options.styles ?? {},
    locking: options.locking === true,
    toolbarItems: options.toolbarItems ?? [],
    inspectorPanels: options.inspectorPanels ?? [],
    justify: options.justify === true,
    findOpen: ref(false),
    invisibles: ref(false),
    outlines: ref(false),
    charactersOpen: ref(false),
    recentCharacters: ref([]),
    countsOpen: ref(false),
    pageOpen: ref(false),
    draftFound: ref((options.draft?.found ?? null) !== null),
    insert(item, target) {
      const kind = editor.editing.get(item.id)?.media?.kind
      if (attachments.available && (kind === 'image' || kind === 'file')) { pickThenInsert(item, target, kind); return true }
      return place(item, target)
    },
    focusText() {
      editor.select(editor.selection)
    },
  }
  editor.on('import', onImport)
  if (editor.lastImport) onImport(editor.lastImport)
  return ui
}
