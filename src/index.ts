/**
 * The public entry point: `createEditor()` mounts an
 * editor into a shadow root on the target element.
 *
 * Safe to import on a server: nothing here touches `window` until called.
 */
import { createApp } from 'vue'
import type { DocumentRule } from './a11y-check'
import { coreBlocks, type PresetName, presets, tableCommands, textCommands } from './blocks/index'
import type { Command, KeyOverrides } from './editor/commands'
import type { BlockDefinition, Preset } from './editor/editing'
import { Autosave, type AutosaveOptions } from './editor/autosave'
import { Editor } from './editor/editor'
import type { RequestAttachment, UploadAdapter } from './editor/upload'
import type { EditorEvents } from './editor/editor'
import { en } from './editor/locale-en'
import type { Strings } from './editor/strings'
import type { FieldShortcut } from './richtext/field'
import contentCss from './render/content.css?inline'
import richtextCss from './richtext/richtext.css?inline'
import type { ClassMapping } from './import/inline'
import type { ImportSource } from './import/report'
import { type ColorPreset, type LinkSearch, type Pattern, type StyleVariant, defaultPalette, readable } from './ui/context'
import editorCss from './ui/editor.css?inline'
import type { ParseRule } from './import/rules'
import { type EmbedProvider, registerEmbedProvider } from './model/embeds'
import { type FormatSpec, defaultFormats } from './model/richtext'
import { ALLOWED } from './render/html'
import type { InspectorPanel, ToolbarItem } from './ui/context'
import { registerFonts } from './ui/fonts'
import { uiEn } from './ui/locale-en'
import { EditorRoot } from './ui/root'
import type { UiStrings } from './ui/strings'

export { Editor } from './editor/editor'
export type { BlocksChangeEvent, ChangeReason, CheckIssue, EditorEvents, EditorOptions, FormatTarget, ImportEvent, ImportOrigin } from './editor/editor'
export type { BlockUpdate, OrderChange, TreeChanges } from './model/changes'
export type { BlockRule, CheckContext, CheckGroup, CheckParams, DocumentRule, Finding, Severity } from './a11y-check'
export { declaresNewWindow, isAddress, isVague, linkName, looksLikeFileName } from './a11y-check'
export type { CheckText } from './editor/strings'
export type { ImportReport, ImportSource, ReportCode, ReportEntry } from './import/report'
export type { ClassMapping } from './import/inline'
export type { ParseContext, ParseMatch, ParseRule } from './import/rules'
export { type ImportResult, importHtml, importText } from './import/pipeline'
export type { EditorSelection } from './editor/selection'
export { Autosave, type AutosaveOptions, type FoundDraft } from './editor/autosave'

export type { ColorPreset, InspectorPanel, LinkSearch, LinkSuggestion, Pattern, StyleVariant, ToolbarItem } from './ui/context'
export type { FormatAttrRule, FormatSpec, Mark, RichTextValue } from './model/richtext'
export { type EmbedProvider, registerEmbedProvider } from './model/embeds'
export type { BlockDefinition, Preset } from './editor/editing'
export { ATTACHMENT_RESULT, type Attachment, type AttachmentRequest, type MediaKind, type RequestAttachment, type UploadAdapter, type UploadContext, type UploadEvent, type UploadResult, type UploadSource } from './editor/upload'
export { coreBlocks, coreRegistry, presets } from './blocks/index'
export { defineBlock } from './blocks/define'
export { defineSchema } from './blocks/define'
// Block authoring: the canvas pieces a block's edit component is built from.
export { BlockList, RichTextView, useEditor, type WrapperProps } from './ui/canvas'
export { newBlock } from './editor/structure'
export type { Block, BlockNode, Tree } from './model/tree'
export type { BlockEditing, Change, FieldSpec, InserterItem, StructureContext, Transform } from './editor/editing'
export type { Command, CommandHost, KeyBinding, UiRequest } from './editor/commands'
export { h, type Html } from './render/html'
export type { RenderContext, RenderableBlock } from './render/render'
export type { UiStrings } from './ui/strings'

/** Core and interface strings of one language. */
export interface Locale extends Strings { readonly ui: UiStrings }

/** Strings a plugin adds or replaces: any top-level string, or entries of a record (`blockNames`, `commands`, `ui.tips`). */
export type LocaleExtension = { readonly [K in keyof Strings]?: Strings[K] extends Readonly<Record<string, string>> ? Readonly<Record<string, string>> : Strings[K] } & {
  readonly ui?: { readonly [K in keyof UiStrings]?: UiStrings[K] extends Readonly<Record<string, string>> ? Readonly<Record<string, string>> : UiStrings[K] }
}

/**
 * A plugin: blocks, inline formats, commands, format bar
 * buttons, part options, import rules, strings and embed providers, in one object.
 */
export interface ProzaPlugin {
  readonly name: string
  readonly blocks?: readonly BlockDefinition[]
  /** Inline formats with their attribute rules. The tag must be one the renderer allows. */
  readonly formats?: readonly FormatSpec[]
  readonly commands?: readonly Command[]
  /** Buttons in the format bar's More menu. */
  readonly toolbar?: readonly ToolbarItem[]
  /** Rows in the part options. */
  readonly inspector?: readonly InspectorPanel[]
  /** More parse rules for block types already installed, by type. */
  readonly importRules?: Readonly<Record<string, readonly ParseRule[]>>
  /** Strings by language (`en`, `sk`, `cs`, …): the editor takes its language's, or English. */
  readonly locales?: Readonly<Record<string, LocaleExtension>>
  /** Embed providers the plugin allows (`registerEmbedProvider`). */
  readonly embeds?: readonly EmbedProvider[]
  /** Checker rules over the whole document; a block type's own rules go on its definition (`a11y`). Their words go in `checkRules`. */
  readonly checks?: readonly DocumentRule[]
  /** Called once the editor is mounted; may return a function that undoes it. */
  setup?(editor: Editor): (() => void) | undefined
}

/** One level deep: records of strings merge entry by entry, everything else is replaced. */
function extendLocale(base: Locale, ext: LocaleExtension | undefined): Locale {
  if (!ext) return base
  const merge = <T extends object>(a: T, b: object): T => {
    const out: Record<string, unknown> = { ...(a as Record<string, unknown>) }
    for (const [k, v] of Object.entries(b)) {
      const old = out[k]
      out[k] = typeof v === 'object' && v !== null && !Array.isArray(v) && typeof old === 'object' && old !== null && !Array.isArray(old) ? { ...old, ...v } : v
    }
    return out as T
  }
  const { ui, ...core } = ext
  return { ...merge(base, core), ui: ui ? merge(base.ui, ui) : base.ui }
}

/** The built-in locale. Other languages are their own entries (`@lamka02sk/proza/locales/sk`), so a host bundles only what it uses. */
export const locales: Readonly<Record<string, Locale>> = { en: { ...en, ui: uiEn } }

/** `sk-SK` takes `sk`. An unknown name throws: the other languages are imports, and English in their place would hide that. */
function resolveLocale(locale: string | Locale | undefined, languages: readonly Locale[]): Locale {
  if (typeof locale === 'object') return locale
  const name = (locale ?? 'en').toLowerCase()
  const primary = name.split('-')[0] ?? name
  const all = [...languages, locales.en!]
  const found = all.find((l) => l.lang.toLowerCase() === name) ?? all.find((l) => l.lang.toLowerCase().split('-')[0] === primary)
  if (!found) throw new Error(`Proza: no locale ${locale ?? ''}. Import it from @lamka02sk/proza/locales/${primary} and pass it as locale, or list it in languages.`)
  return found
}

/** What a form field holds: HTML, the stored JSON, or HTML with the JSON beside it as `<name>_json`. */
export type Output = 'json' | 'html' | 'both'

/**
 * Callbacks for the host, wired before the interface mounts, so they also see
 * the uploads of HTML content given at creation. A callback that throws is reported and does not
 * stop the edit or the other listeners.
 */
export interface EditorHooks {
  /** Once per committed transaction: what was added, removed and updated, and new child orders. */
  readonly blocksChange?: EditorEvents['blocksChange']
  /** Each upload attempt from start to `succeeded`, `failed` or `cancelled`. */
  readonly upload?: EditorEvents['upload']
  /**
   * The host's attachment manager: Image and File in the inserter, and Choose from the library on an
   * empty picture or file part, ask it for a stored file instead of uploading one.
   */
  readonly requestAttachment?: RequestAttachment
}

export interface CreateEditorOptions {
  /**
   * The element (or a selector for it) the editor goes into; its shadow root holds the editor.
   * A `<textarea>` is enhanced: the editor takes its place and keeps its value.
   */
  readonly target: HTMLElement | string
  /**
   * Stored JSON (validated), or HTML: legacy content goes through the import
   * pipeline in memory; nothing is stored until the host
   * saves, and the host keeps its original HTML. The report: `editor.lastImport`
   * and the `import` event.
   */
  readonly content?: unknown
  /** Where HTML content comes from when its markup does not say: `tinymce` for stored TinyMCE records. */
  readonly contentSource?: ImportSource
  /**
   * How imported content maps to this site: host classes
   * that stand for a format or a block, and whether pictures on other sites are
   * stored through `upload` (re-hosting; the other site must allow it).
   */
  readonly import?: { readonly classes?: Readonly<Record<string, ClassMapping>>; readonly rehostImages?: boolean }
  /**
   * The interface language: `en` (built in), a `Locale` imported from
   * `@lamka02sk/proza/locales/<lang>` (`sk`, `cs`, `es`, `fr`), or the `lang` of one in `languages`.
   */
  readonly locale?: string | Locale
  /** Locales `locale` can name, for the `locale` attribute of `<proza-editor>`: `defineEditorElement({ languages: [sk, cs] })`. */
  readonly languages?: readonly Locale[]
  /** Accessible name of the editor; normally the host form's label text. */
  readonly label?: string
  /** `auto` follows the system (default). Colours themselves come from the `--pz-*` custom properties. */
  readonly colorScheme?: 'light' | 'dark' | 'auto'
  /** Interface direction when it differs from the locale's. */
  readonly dir?: 'ltr' | 'rtl'
  /** `bubble` (default): formatting above selected words. `docked`: a bar at the top of the field. */
  readonly toolbar?: 'bubble' | 'docked'
  /** Ready-made layouts in the inserter. */
  readonly patterns?: readonly Pattern[]
  /** Register the self-hosted fonts on the document (default). False when the host serves them. */
  readonly fonts?: boolean
  /** Shortcut overrides by command name; null switches a command's keys off (WCAG 2.1.4). */
  readonly keys?: KeyOverrides
  readonly fieldShortcuts?: readonly FieldShortcut[]
  /** What the interface offers: `basic`, `standard`, `full` (default) or an adjusted preset. */
  readonly preset?: PresetName | Preset
  /** Stores files and returns their address. Without it, media come from web addresses. */
  readonly upload?: UploadAdapter
  /** Pages to link to, for the link field's search. */
  readonly links?: LinkSearch
  /**
   * Named text colours (hosts style `.pz-color-<name>` in their published CSS to match), and style
   * variants per block type (TinyMCE `importcss`; the class `pz-style-<name>`). `css` is the host's
   * stylesheet for those classes, so the text shows in the editor as it will on the page.
   */
  readonly theme?: { readonly palette?: readonly ColorPreset[]; readonly styles?: Readonly<Record<string, readonly StyleVariant[]>>; readonly css?: string }
  /** Authors may lock and unlock parts. Locks in loaded content hold either way. */
  readonly locking?: boolean
  readonly plugins?: readonly ProzaPlugin[]
  /** Offer justified text (off by default, because it harms readability). */
  readonly justify?: boolean
  /** Extra block types (plugins) and commands. */
  readonly blocks?: readonly BlockDefinition[]
  readonly commands?: readonly Command[]
  /** Read, select and copy only (TinyMCE's read-only mode); `editor.setReadOnly()` switches it later. */
  readonly readOnly?: boolean
  /**
   * Draft recovery (TinyMCE `autosave`): the text is kept in the browser while the author writes
   * and offered back after a crash. A key names the instance; `true` derives one from the page
   * address and the textarea's name. Off by default: drafts stay on a shared computer.
   */
  readonly draft?: boolean | string | AutosaveOptions
  /** What an enhanced `<textarea>` holds. Default `both`. */
  readonly output?: Output
  /**
   * The raw HTML part, off by default. `true` offers it, and `getHTML()` carries
   * its markup as written: the server must sanitise it. A function sanitises it in the browser too.
   */
  readonly rawHtml?: boolean | ((html: string) => string | null)
  /** A fixed height (any CSS length) with the text scrolling inside; by default the field grows with its text (TinyMCE `autoresize`). */
  readonly height?: string
  /**
   * The accessibility checker on save (Mod+S, a form submit): `warn` (default) saves and says how many
   * problems are left; `block` keeps the text from saving until the errors are fixed, and shows them.
   */
  readonly a11y?: { readonly onSave?: 'warn' | 'block' }
  readonly hooks?: EditorHooks
  /** Language of the content (BCP 47), when it differs from the interface's: the published page's words and the checker's. */
  readonly contentLanguage?: string
}

export interface ProzaEditor {
  readonly editor: Editor
  /** The element whose shadow root holds the editor (for a textarea, the element put after it). */
  readonly host: HTMLElement
  /** Draft recovery, when switched on. Call `draft.saved()` once the host has stored the text. */
  readonly draft: Autosave | null
  /** Write the form value now (an enhanced textarea syncs itself after changes, on blur and on submit). */
  sync(): void
  destroy(): void
}

/** The form value for `output`: a string, or the two entries of `both`. */
export function formEntries(editor: Editor, name: string, output: Output): [string, string][] {
  // An empty field submits nothing, so `required` and server checks see it is empty.
  if (editor.isEmpty()) return output === 'both' ? [[name, ''], [`${name}_json`, '']] : [[name, '']]
  if (output === 'json') return [[name, JSON.stringify(editor.getJSON())]]
  const html = editor.getHTML()
  return output === 'html' ? [[name, html]] : [[name, html], [`${name}_json`, JSON.stringify(editor.getJSON())]]
}

/**
 * A form does not submit while `a11y.onSave` is `block` and the checker finds errors.
 * Listens in the capture phase, so the host's own submit handlers never see a refused submit.
 */
export function guardSubmit(form: HTMLFormElement | null, editor: Editor, alreadyChecked: () => boolean = () => false): () => void {
  if (!form) return () => { /* no form */ }
  const onSubmit = (e: SubmitEvent): void => {
    if (alreadyChecked() || editor.mayStore()) return
    e.preventDefault()
    e.stopImmediatePropagation()
  }
  form.addEventListener('submit', onSubmit, { capture: true })
  return () => { form.removeEventListener('submit', onSubmit, { capture: true }) }
}

/** Stored JSON when the text parses as a document, HTML otherwise (legacy content through the import pipeline). */
export function readContent(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  if (trimmed.startsWith('{')) {
    try {
      const data: unknown = JSON.parse(trimmed)
      if (typeof data === 'object' && data !== null && Array.isArray((data as { blocks?: unknown }).blocks)) return data
    } catch { /* not JSON: HTML that starts with a brace */ }
  }
  return text
}

function draftOptions(draft: CreateEditorOptions['draft'], fallbackKey: string): AutosaveOptions | null {
  if (!draft) return null
  if (draft === true) return { key: fallbackKey }
  return typeof draft === 'string' ? { key: draft } : draft
}

let sheet: CSSStyleSheet | null = null

/** The host's colour presets as classes in the canvas, built with the CSSOM (no inline style under a strict CSP). */
function paletteSheet(palette: readonly ColorPreset[]): CSSStyleSheet {
  const out = new CSSStyleSheet()
  const name = /^[a-z][a-z0-9-]{0,39}$/
  const hex = /^#[0-9a-f]{3,6}$/i
  for (const c of readable(palette)) {
    if (!name.test(c.name) || !hex.test(c.color) || (c.dark !== undefined && !hex.test(c.dark))) continue
    out.insertRule(`.pz .pz-color-${c.name} { color: ${c.color}; }`, out.cssRules.length)
    out.insertRule(`.pz.dark .pz-color-${c.name} { color: ${c.dark ?? c.color}; }`, out.cssRules.length)
    out.insertRule(`@media (prefers-color-scheme: dark) { .pz:not(.light) .pz-color-${c.name} { color: ${c.dark ?? c.color}; } }`, out.cssRules.length)
  }
  return out
}

export function createEditor(options: CreateEditorOptions): ProzaEditor {
  const target = typeof options.target === 'string' ? document.querySelector<HTMLElement>(options.target) : options.target
  if (!target) throw new Error(`Proza: no element ${typeof options.target === 'string' ? options.target : 'given'}`)
  if (target instanceof HTMLTextAreaElement) return enhanceTextarea(target, options)
  return mount(target, options)
}

function mount(host: HTMLElement, options: CreateEditorOptions): ProzaEditor {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
  // Constructed stylesheets need no inline <style>, so a strict CSP holds.
  if (!sheet) {
    sheet = new CSSStyleSheet()
    sheet.replaceSync(`${contentCss}\n${richtextCss}\n${editorCss}`)
  }
  const palette = options.theme?.palette
  const hostCss = options.theme?.css
  let hostSheet: CSSStyleSheet | null = null
  if (hostCss) { hostSheet = new CSSStyleSheet(); hostSheet.replaceSync(hostCss) }
  shadow.adoptedStyleSheets = [sheet, ...(palette ? [paletteSheet(palette)] : []), ...(hostSheet ? [hostSheet] : [])]
  const plugins = options.plugins ?? []
  const base = resolveLocale(options.locale, options.languages ?? [])
  const locale = plugins.reduce((l, p) => extendLocale(l, p.locales?.[l.lang] ?? p.locales?.en), base)
  const { ui, ...strings } = locale
  for (const p of plugins) for (const e of p.embeds ?? []) registerEmbedProvider(e)
  const formats = new Map(defaultFormats)
  for (const p of plugins) {
    for (const f of p.formats ?? []) {
      if (!ALLOWED.has(f.tag)) throw new Error(`Plugin ${p.name}: format ${f.type} renders as <${f.tag}>, which output may not contain`)
      if (formats.has(f.type)) throw new Error(`Plugin ${p.name}: format ${f.type} is registered twice`)
      formats.set(f.type, f)
    }
  }
  // Import rules join the parse rules of the type they read.
  const rules = new Map<string, ParseRule[]>()
  for (const p of plugins) for (const [type, list] of Object.entries(p.importRules ?? {})) rules.set(type, [...(rules.get(type) ?? []), ...list])
  const allBlocks = [...coreBlocks, ...(options.blocks ?? []), ...plugins.flatMap((p) => p.blocks ?? [])]
    .map((b) => (rules.has(b.name) ? { ...b, parse: [...(b.parse ?? []), ...rules.get(b.name)!] } : b))
  if (options.fonts !== false) registerFonts(document)
  const preset = typeof options.preset === 'string' ? (options.preset === 'full' ? undefined : presets[options.preset]) : options.preset
  const editor = new Editor({
    blocks: allBlocks,
    formats,
    ...(preset ? { preset } : {}),
    commands: [...textCommands, ...tableCommands, ...(options.commands ?? []), ...plugins.flatMap((p) => p.commands ?? [])],
    strings,
    ...(options.keys ? { keys: options.keys } : {}),
    ...(options.fieldShortcuts ? { fieldShortcuts: options.fieldShortcuts } : {}),
    ...(options.content !== undefined ? { content: options.content } : {}),
    ...(options.contentSource ? { contentSource: options.contentSource } : {}),
    // Imported colours map to the palette the author is offered.
    import: { palette: readable(palette ?? defaultPalette(ui)), ...(options.import?.classes ? { classes: options.import.classes } : {}), ...(options.justify ? { justify: true } : {}) },
    ...(options.readOnly ? { readOnly: true } : {}),
    ...(options.rawHtml ? { enable: ['core/html'] } : {}),
    ...(typeof options.rawHtml === 'function' ? { rawHtml: options.rawHtml } : {}),
    checks: plugins.flatMap((p) => p.checks ?? []),
    ...(options.a11y?.onSave ? { onSave: options.a11y.onSave } : {}),
    ...(options.contentLanguage ? { contentLanguage: options.contentLanguage } : {}),
  })
  const hooks = options.hooks ?? {}
  const offHooks = [
    hooks.blocksChange ? editor.on('blocksChange', hooks.blocksChange) : null,
    hooks.upload ? editor.on('upload', hooks.upload) : null,
  ]
  const draftOpts = draftOptions(options.draft, `${location.pathname}#${host.id}`)
  const draft = draftOpts ? new Autosave(editor, draftOpts) : null
  const mount = document.createElement('div')
  shadow.replaceChildren(mount)
  const app = createApp(EditorRoot, {
    editor,
    ui,
    label: options.label ?? '',
    colorScheme: options.colorScheme ?? 'auto',
    dir: options.dir ?? '',
    options: {
      toolbar: options.toolbar ?? 'bubble', patterns: options.patterns ?? [],
      upload: options.upload ?? null, links: options.links ?? null, ...(palette ? { palette } : {}),
      ...(options.import?.rehostImages ? { rehostImages: true } : {}),
      ...(options.height && CSS.supports('height', options.height) ? { height: options.height } : {}),
      ...(options.theme?.styles ? { styles: options.theme.styles } : {}),
      ...(options.locking ? { locking: true } : {}),
      toolbarItems: plugins.flatMap((p) => p.toolbar ?? []),
      ...(options.justify ? { justify: true } : {}),
      inspectorPanels: plugins.flatMap((p) => p.inspector ?? []),
      draft,
      ...(hooks.requestAttachment ? { requestAttachment: hooks.requestAttachment, replyTarget: host } : {}),
    },
  })
  app.mount(mount)
  const teardown = plugins.map((p) => p.setup?.(editor))
  return {
    editor,
    host,
    draft,
    sync() { /* a plain element holds no form value */ },
    destroy() {
      for (const off of teardown) off?.()
      draft?.destroy()
      app.unmount()
      for (const off of offHooks) off?.()
      editor.destroy()
      shadow.replaceChildren()
    },
  }
}

/**
 * Textarea enhancement: the editor goes into an element
 * after the textarea, which is hidden and keeps the value, so a form and the
 * scripts around it work as with TinyMCE. The textarea's label names the
 * editor; `input`, `change` and a cancelable `save` are dispatched on it.
 */
function enhanceTextarea(area: HTMLTextAreaElement, options: CreateEditorOptions): ProzaEditor {
  const host = document.createElement('div')
  host.className = 'proza-host'
  area.after(host)
  const label = options.label ?? [...area.labels].map((l) => l.textContent.trim()).join(' ')
  const output = options.output ?? 'both'
  const name = area.name
  const proza = mount(host, {
    ...options,
    target: host,
    content: options.content ?? readContent(area.value),
    label,
    readOnly: options.readOnly ?? (area.readOnly || area.disabled),
    draft: options.draft === true ? `${location.pathname}#${name || area.id}` : options.draft ?? false,
  })
  const { editor } = proza
  area.hidden = true
  // A hidden control cannot take the focus a label click or a failed `required` check sends it.
  const onFocus = (): void => { host.shadowRoot?.querySelector<HTMLElement>('[data-field][tabindex="0"], [data-block][tabindex="0"]')?.focus() }
  // The browser cannot point at a hidden control that fails its check: the editor takes the focus and says why.
  const onInvalid = (e: Event): void => {
    e.preventDefault()
    onFocus()
    editor.announce(area.validity.valueMissing ? editor.strings.required : area.validationMessage, 'assertive')
  }
  const labels = [...area.labels]
  // A label around the editor also hears clicks made inside it, which already put the caret where they belong.
  const onLabel = (e: Event): void => { if (!e.composedPath().includes(host)) onFocus() }
  area.addEventListener('focus', onFocus)
  area.addEventListener('invalid', onInvalid)
  for (const l of labels) l.addEventListener('click', onLabel)

  let timer: ReturnType<typeof setTimeout> | undefined
  let dirty = false
  // Changed since the last `input`: the event goes out with the value it announces.
  let changed = false
  const sync = (): void => {
    clearTimeout(timer)
    timer = undefined
    area.value = formEntries(editor, name, output === 'json' ? 'json' : 'html')[0]![1]
    if (changed) { changed = false; area.dispatchEvent(new Event('input', { bubbles: true })) }
  }
  const offs = [
    editor.on('change', () => {
      dirty = true
      changed = true
      clearTimeout(timer)
      // A keystroke must not render the whole document: the value, and `input` with it, follow after a pause.
      timer = setTimeout(sync, 250)
    }),
    editor.on('blur', () => {
      sync()
      if (dirty) { dirty = false; area.dispatchEvent(new Event('change', { bubbles: true })) }
    }),
    editor.on('save', () => {
      sync()
      // Mod+S asked the checker already.
      checked = true
      if (area.dispatchEvent(new Event('save', { bubbles: true, cancelable: true }))) area.form?.requestSubmit()
      checked = false
    }),
  ]
  let checked = false
  const form = area.form
  const offGuard = guardSubmit(form, editor, () => checked)
  const onFormData = (e: FormDataEvent): void => {
    sync()
    if (output !== 'both' || !name) return
    for (const [k, v] of formEntries(editor, name, output).slice(1)) e.formData.set(k, v)
  }
  const onSubmit = (): void => { proza.draft?.saved() }
  // The reset event comes before the form resets its controls: the content it goes back to is the default value.
  const onReset = (): void => { editor.setContent(readContent(area.defaultValue) ?? { version: 1, blocks: [] }); dirty = false }
  form?.addEventListener('formdata', onFormData)
  form?.addEventListener('submit', onSubmit)
  form?.addEventListener('reset', onReset)
  return {
    ...proza,
    sync,
    destroy() {
      sync()
      for (const off of offs) off()
      form?.removeEventListener('formdata', onFormData)
      form?.removeEventListener('submit', onSubmit)
      form?.removeEventListener('reset', onReset)
      offGuard()
      area.removeEventListener('focus', onFocus)
      area.removeEventListener('invalid', onInvalid)
      for (const l of labels) l.removeEventListener('click', onLabel)
      proza.destroy()
      host.remove()
      area.hidden = false
    },
  }
}
