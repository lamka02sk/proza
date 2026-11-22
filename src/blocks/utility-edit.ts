/**
 * Canvas components, options, behaviour and parse rules of the utility blocks
 * page break, table of contents and raw HTML. Each has no
 * text of its own: a named group selected as a whole, like a separator.
 */
import { type Component, type ComputedRef, type PropType, computed, defineComponent, h, ref, watch } from 'vue'
import type { BlockDefinition, BlockEditing, InserterItem } from '../editor/editing'
import { newBlock } from '../editor/structure'
import type { ParseRule } from '../import/rules'
import type { AttrSpecs } from '../model/schema'
import type { BlockNode } from '../model/tree'
import type { OutlineEntry, RenderBlock, RenderableBlock } from '../render/render'
import { type WrapperProps, useEditor } from '../ui/canvas'
import { track, useUi } from '../ui/context'
import { Seg, row } from '../ui/controls'
import { defineBlock } from './define'
import { PAGE_BREAK, RAW_HTML, TOC, type TocNode, pageBreak, rawHtml, toc, tocTree } from './utility'

const props = {
  id: { type: String, required: true },
  node: { type: Object as PropType<BlockNode>, required: true },
  wrapper: { type: Object as PropType<WrapperProps>, required: true },
} as const

const name = (type: string) => (_n: BlockNode, s: { blockNames: Readonly<Record<string, string>> }): string => s.blockNames[type] ?? type
const item = (type: string, drawing: InserterItem['drawing'], keywords: readonly string[]): InserterItem => ({
  id: type, category: 'utility', drawing, keywords: [type.replace('core/', ''), ...keywords],
  title: (s) => s.blockNames[type] ?? type,
  create: (ctx) => [newBlock(ctx, type)],
})

// ---------------------------------------------------------------------------
// Page break

const PageBreakEdit = defineComponent({
  name: 'ProzaPageBreak', props,
  setup(p) {
    const ui = useUi()
    return () => h('div', { ...p.wrapper, role: 'group', class: [...p.wrapper.class, 'pz-page-break-part'] },
      h('span', { class: 'pz-page-break-label', 'aria-hidden': 'true' }, ui.t.pageBreakLabel))
  },
})

const pageBreakEditing: BlockEditing = {
  name: PAGE_BREAK,
  fields: [],
  title: name(PAGE_BREAK),
  inserter: [item(PAGE_BREAK, { ink: ['M6 6h84v12M6 6v12', 'M6 42h84V30M6 42V30'], accent: ['M6 24h10M24 24h10M42 24h10M60 24h10M78 24h12'] }, ['pagebreak', 'print', 'page', 'break'])],
}

// TinyMCE writes `<!-- pagebreak -->` (cleanup turns it into this element); Word and LibreOffice an empty element with a page-break style.
const pageBreakParse: readonly ParseRule[] = [
  { selector: '.pz-page-break', priority: 100, block: true, parse: () => ({ attrs: {} }) },
  {
    selector: 'br[style*="page-break"], br[style*="break-before"], div[style*="page-break"], p[style*="page-break"]',
    block: true,
    parse: (el) => (el.textContent.trim() === '' && el.querySelector('img, iframe, table') === null ? { attrs: {} } : null),
  },
]

// ---------------------------------------------------------------------------
// Table of contents

/**
 * The headings of the document as the page will list them, read from the tree while the author writes.
 * The same list as before is the same value, so typing that leaves the headings alone renders nothing.
 */
function useOutline(): ComputedRef<OutlineEntry[]> {
  const editor = useEditor()
  let last: OutlineEntry[] = []
  let lastKey = '[]'
  return computed(() => {
    track(editor.revision.value)
    const out: OutlineEntry[] = []
    const walk = (ids: readonly string[]): void => {
      for (const id of ids) {
        const n = editor.tree.nodes.get(id)!
        const head = editor.registry.get(n.type)?.heading?.(n as RenderBlock<AttrSpecs>)
        if (head && head.text.trim() !== '') out.push({ ...head, text: head.text.trim(), anchor: id })
        walk(editor.tree.children.get(id) ?? [])
      }
    }
    walk(editor.tree.children.get(null) ?? [])
    const key = JSON.stringify(out)
    if (key !== lastKey) { lastKey = key; last = out }
    return last
  })
}

const TocEdit = defineComponent({
  name: 'ProzaToc', props,
  setup(p) {
    const ui = useUi()
    const outline = useOutline()
    const depth = computed(() => (typeof p.node.attrs.depth === 'number' ? p.node.attrs.depth : 3))
    const list = (nodes: readonly TocNode[]): ReturnType<typeof h> => h('ol', null, nodes.map((n) =>
      h('li', null, [h('span', { class: 'pz-toc-entry' }, n.entry.text), n.children.length > 0 ? list(n.children) : null])))
    return () => {
      const entries = outline.value.filter((e) => e.level <= depth.value)
      // In the canvas the entries are not links: following one would leave the text being written.
      return h('div', { ...p.wrapper, role: 'group', class: [...p.wrapper.class, 'pz-toc', 'pz-toc-part'] }, [
        h('strong', { class: 'pz-toc-title' }, ui.editor.strings.blockNames[TOC] ?? TOC),
        entries.length > 0 ? list(tocTree(entries)) : h('p', { class: 'pz-toc-empty' }, ui.t.tocEmpty),
      ])
    }
  },
})

const TocInspector = defineComponent({
  name: 'ProzaTocInspector',
  props: { id: { type: String, required: true }, node: { type: Object as PropType<BlockNode>, required: true } },
  setup(p) {
    const ui = useUi()
    return () => h('div', { class: 'insp' }, [row(ui.t.tocDepth, h(Seg, {
      label: ui.t.tocDepth, value: typeof p.node.attrs.depth === 'number' ? p.node.attrs.depth : 3,
      options: [2, 3, 4, 5, 6].map((v) => ({ value: v, label: ui.t.levelName(v) })),
      onPick: (v: string | number) => { ui.editor.setAttrs(p.id, { depth: v }, ui.t.tocDepthSet(Number(v))) },
    }), { column: true })])
  },
})

const tocEditing: BlockEditing = {
  name: TOC,
  fields: [],
  title: name(TOC),
  inserter: [item(TOC, { ink: ['M6 8h40M14 20h40M14 32h32M6 44h40'], accent: ['M78 8h12M78 20h12M78 32h12M78 44h12'] }, ['toc', 'contents', 'index', 'outline', 'headings'])],
}

const tocParse: readonly ParseRule[] = [
  {
    selector: 'nav.pz-toc', priority: 100, block: true,
    parse: (el) => ({ attrs: { depth: Number(el.getAttribute('data-pz-depth') ?? 3) } }),
  },
]

// ---------------------------------------------------------------------------
// Raw HTML

/**
 * The markup as text, and a preview in a frame that runs no script and reaches
 * nothing of this page (`sandbox` with no permissions). Off by default: when
 * the host has not switched raw HTML on, the part only shows that it is there.
 */
const RawHtmlEdit = defineComponent({
  name: 'ProzaRawHtml', props,
  setup(p) {
    const ui = useUi()
    const { editor, t } = ui
    const draft = ref(typeof p.node.attrs.html === 'string' ? p.node.attrs.html : '')
    const preview = ref(false)
    watch(() => p.node.attrs.html, (v) => { if (typeof v === 'string') draft.value = v })
    const save = (): void => { editor.setAttrs(p.id, { html: draft.value }, t.rawHtmlSaved) }
    return () => {
      const on = editor.offers(RAW_HTML) && !editor.readOnly.value
      const html = typeof p.node.attrs.html === 'string' ? p.node.attrs.html : ''
      return h('div', { ...p.wrapper, role: 'group', class: [...p.wrapper.class, 'pz-html-part'] }, [
        h('div', { class: 'pz-html-head' }, [
          h('strong', null, editor.strings.blockNames[RAW_HTML] ?? RAW_HTML),
          on ? h('button', {
            type: 'button', class: ['btn', 'btn-s', 'btn-line', preview.value && 'is-on'], 'aria-pressed': preview.value ? 'true' : 'false',
            onClick: () => { if (!preview.value) save(); preview.value = !preview.value },
          }, t.rawHtmlPreview) : null,
        ]),
        !on ? h('p', { class: 'hint' }, t.rawHtmlOff)
          : preview.value
            ? h('iframe', { class: 'pz-html-preview', sandbox: '', srcdoc: html, title: t.rawHtmlPreviewTitle, referrerpolicy: 'no-referrer' })
            : h('textarea', {
              class: 'field code pz-html-code', rows: 6, spellcheck: 'false', 'aria-label': t.rawHtmlCode, value: draft.value,
              onInput: (e: Event) => { draft.value = (e.target as HTMLTextAreaElement).value },
              // One undo step for an edit of the markup, when the author leaves it.
              onChange: save,
            }),
      ])
    }
  },
})

const rawHtmlEditing: BlockEditing = {
  name: RAW_HTML,
  offByDefault: true,
  fields: [],
  title: name(RAW_HTML),
  inserter: [item(RAW_HTML, { ink: ['M30 12 12 24l18 12M66 12l18 12-18 12'], accent: ['M54 8 42 40'] }, ['html', 'code', 'embed', 'markup', 'custom'])],
}

// ---------------------------------------------------------------------------

const join = (schema: RenderableBlock, def: BlockEditing, edit: Component, parse: readonly ParseRule[], inspector?: Component): BlockDefinition =>
  defineBlock({ ...schema, ...def, edit, parse, ...(inspector ? { inspector } : {}) })

export const utilityBlockDefinitions: readonly BlockDefinition[] = [
  join(pageBreak, pageBreakEditing, PageBreakEdit, pageBreakParse),
  join(toc, tocEditing, TocEdit, tocParse, TocInspector),
  // Imported HTML never becomes raw HTML: foreign markup is converted to parts or dropped.
  join(rawHtml, rawHtmlEditing, RawHtmlEdit, []),
]
