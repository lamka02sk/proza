/**
 * Canvas components and options of the layout blocks:
 * columns, group, fold-out, buttons and space. Each renders its block's root
 * element with the wrapper attributes from the canvas and the classes the
 * page gets, so the canvas lays out as the page will. Behaviour: `layout-behaviour.ts`.
 */
import { checksFor } from './checks'
import { type Component, type PropType, defineComponent, h, useId } from 'vue'
import type { BlockDefinition, BlockEditing } from '../editor/editing'
import { fieldValue } from '../editor/editing'
import { insertAfter, newBlock } from '../editor/structure'
import { type BlockNode, childrenOf } from '../model/tree'
import { safeUrl } from '../model/url'
import type { RenderableBlock } from '../render/render'
import { BlockList, RichTextView, type WrapperProps, useEditor } from '../ui/canvas'
import { track, useUi } from '../ui/context'
import { Seg, TextInput, checkbox, row } from '../ui/controls'
import { type IconName, icon } from '../ui/icons'
import { defineBlock } from './define'
import { BUTTON, RATIOS, SPACES, type Ratio, button, buttons, column, columns, details, group, spacer } from './layout'
import {
  buttonEditing, buttonsEditing, columnEditing, columnsEditing, detailsEditing, groupEditing, setRatio, spacerEditing, ungroup,
} from './layout-behaviour'
import { layoutParse } from './layout-parse'
import { columnsTransforms, groupTransforms } from './transforms'

const props = {
  id: { type: String, required: true },
  node: { type: Object as PropType<BlockNode>, required: true },
  wrapper: { type: Object as PropType<WrapperProps>, required: true },
} as const

const str = (node: BlockNode, k: string): string => (typeof node.attrs[k] === 'string' ? node.attrs[k] : '')

/** A container's root: a named group only while it is selected as a whole (its parts carry their own names). */
const frame = (w: WrapperProps, cls: string[]): Record<string, unknown> => ({ ...w, ...(w['aria-label'] ? { role: 'group' } : {}), class: [...w.class, ...cls] })

// ---------------------------------------------------------------------------
// Columns

const ColumnsEdit = defineComponent({
  name: 'ProzaColumns', props,
  setup: (p) => () => h('div', frame(p.wrapper, ['pz-columns', `pz-layout-${str(p.node, 'ratio') || '1-1'}`]), h(BlockList, { parent: p.id })),
})

const ColumnEdit = defineComponent({
  name: 'ProzaColumn', props,
  setup(p) {
    const ui = useUi()
    return () => {
      track(ui.editor.revision.value)
      const w = p.wrapper
      // Named by its place, so a screen reader knows which column it is in when it selects one.
      const parent = ui.editor.tree.parents.get(p.id) ?? null
      const siblings = parent === null ? [] : childrenOf(ui.editor.tree, parent)
      const named = w['aria-label'] ? { 'aria-label': ui.t.columnOf(siblings.indexOf(p.id) + 1, siblings.length) } : {}
      return h('div', { ...frame(w, ['pz-column']), ...named }, h(BlockList, { parent: p.id }))
    }
  },
})

const RATIO_ICONS: Readonly<Record<Ratio, IconName>> = { '1-1': 'cols2', '1-1-1': 'cols3', '2-1': 'cols21', '1-2': 'cols12', '1-1-1-1': 'cols4' }

const ColumnsInspector = defineComponent({
  name: 'ProzaColumnsInspector',
  props: { id: { type: String, required: true }, node: { type: Object as PropType<BlockNode>, required: true } },
  setup(p) {
    const ui = useUi()
    const { editor, t } = ui
    return () => h('div', { class: 'insp' }, [
      h('div', { class: 'row row-col' }, [
        h('span', { class: 'lab' }, t.layout.ratio),
        h(Seg, {
          label: t.layout.ratio,
          value: str(p.node, 'ratio'),
          options: RATIOS.map((r) => ({ value: r, label: t.layout.ratios[r], icon: RATIO_ICONS[r] })),
          onPick: (v: string | number) => { editor.apply(setRatio(editor.context(), p.id, v as Ratio), { keepFocus: true }) },
        }),
        h('p', { class: 'hint' }, t.layout.ratioHint),
      ]),
    ])
  },
})

// ---------------------------------------------------------------------------
// Group

const GroupEdit = defineComponent({
  name: 'ProzaGroup', props,
  // Always a div in the canvas: a section or aside here would add landmarks inside the editor.
  setup: (p) => () => h('div', frame(p.wrapper, ['pz-group', str(p.node, 'look') ? `pz-look-${str(p.node, 'look')}` : '']), h(BlockList, { parent: p.id })),
})

const GroupInspector = defineComponent({
  name: 'ProzaGroupInspector',
  props: { id: { type: String, required: true }, node: { type: Object as PropType<BlockNode>, required: true } },
  setup(p) {
    const ui = useUi()
    const { editor, t } = ui
    const hint = useId()
    return () => h('div', { class: 'insp' }, [
      h('div', { class: 'row row-col' }, [
        h('span', { class: 'lab' }, t.layout.look),
        h(Seg, {
          label: t.layout.look, value: str(p.node, 'look') || 'plain',
          options: (['plain', 'panel', 'line'] as const).map((v) => ({ value: v, label: t.layout.looks[v] })),
          onPick: (v: string | number) => { editor.setAttrs(p.id, { look: v === 'plain' ? '' : v }) },
        }),
      ]),
      h('div', { class: 'row row-col' }, [
        h('span', { class: 'lab' }, t.layout.meaning),
        h(Seg, {
          label: t.layout.meaning, value: str(p.node, 'tag') || 'div',
          options: (['div', 'section', 'aside'] as const).map((v) => ({ value: v, label: t.layout.meanings[v], describedBy: hint })),
          onPick: (v: string | number) => { editor.setAttrs(p.id, { tag: v }) },
        }),
        h('p', { class: 'hint', id: hint }, t.layout.meaningHint),
      ]),
      h('button', { type: 'button', class: 'btn', onClick: () => { editor.apply(ungroup(editor.context(), p.id)) } }, [icon('split'), t.layout.ungroup]),
    ])
  },
})

// ---------------------------------------------------------------------------
// Fold-out

const DetailsEdit = defineComponent({
  name: 'ProzaDetails', props,
  setup(p) {
    const editor = useEditor()
    const ui = useUi()
    // Always open in the canvas: what is folded away is still edited. The marker shows how it starts on the page.
    return () => h('div', frame(p.wrapper, ['pz-details', p.node.attrs.open === true ? 'is-open' : '']), [
      h('div', { class: 'pz-summary' }, [
        h('span', { class: 'pz-summary-mark', 'aria-hidden': 'true' }, icon('chevron')),
        h(RichTextView, { blockId: p.id, attr: 'summary', tag: 'div', key: 'summary', classes: 'pz-summary-text', 'data-placeholder': editor.strings.fieldNames.summary ?? '' }),
      ]),
      h('div', { class: 'pz-details-body', 'aria-label': ui.t.layout.detailsBody }, h(BlockList, { parent: p.id })),
    ])
  },
})

const DetailsInspector = defineComponent({
  name: 'ProzaDetailsInspector',
  props: { id: { type: String, required: true }, node: { type: Object as PropType<BlockNode>, required: true } },
  setup(p) {
    const ui = useUi()
    const hint = useId()
    return () => h('div', { class: 'insp' }, [
      checkbox(ui.t.layout.openOnLoad, p.node.attrs.open === true, (v) => { ui.editor.setAttrs(p.id, { open: v }) }, ui.t.layout.openOnLoadHint, hint),
    ])
  },
})

// ---------------------------------------------------------------------------
// Buttons

const ButtonsEdit = defineComponent({
  name: 'ProzaButtons', props,
  setup(p) {
    const ui = useUi()
    const { editor, t } = ui
    const reach = (): 0 | -1 => (editor.isCurrent(p.id) || editor.isSelected(p.id) ? 0 : -1)
    return () => h('div', frame(p.wrapper, ['pz-buttons']), [
      h(BlockList, { parent: p.id }),
      h('button', {
        type: 'button', class: 'pz-add-button', tabindex: reach(), 'aria-label': t.layout.addButton, title: t.layout.addButton,
        onClick: () => {
          const kids = childrenOf(editor.tree, p.id)
          const last = kids.at(-1)
          const ctx = editor.context()
          if (last !== undefined) editor.apply(insertAfter(ctx, last, newBlock(ctx, BUTTON, { look: editor.tree.nodes.get(last)?.attrs.look })))
        },
      }, icon('plus')),
    ])
  },
})

const ButtonEdit = defineComponent({
  name: 'ProzaButton', props,
  setup(p) {
    const ui = useUi()
    const { editor, t } = ui
    const reach = (): 0 | -1 => (editor.isCurrent(p.id) ? 0 : -1)
    return () => {
      const w = p.wrapper
      const href = str(p.node, 'href')
      return h('div', { ...w, ...(w['aria-label'] ? { role: 'group' } : {}), class: [...w.class, 'pz-button-part'] }, [
        h('div', { class: ['pz-button', `pz-button-${str(p.node, 'look') || 'fill'}`] },
          h(RichTextView, { blockId: p.id, attr: 'text', tag: 'div', key: 'text', classes: 'pz-button-text', 'data-placeholder': t.layout.buttonPlaceholder })),
        // The address is asked for on the part itself, as a picture asks for its description.
        href === '' ? h('button', {
          type: 'button', class: 'pz-notice pz-notice-inline', tabindex: reach(),
          onClick: () => { ui.add.value = null; ui.optionsFor.value = p.id; ui.options.value = topOf(p.id) },
        }, t.layout.needsLink) : null,
      ])
    }

    function topOf(id: string): string {
      let cur = id
      for (let up = editor.tree.parents.get(cur) ?? null; up !== null; up = editor.tree.parents.get(up) ?? null) cur = up
      return cur
    }
  },
})

const ButtonInspector = defineComponent({
  name: 'ProzaButtonInspector',
  props: { id: { type: String, required: true }, node: { type: Object as PropType<BlockNode>, required: true } },
  setup(p) {
    const ui = useUi()
    const { editor, t } = ui
    return () => h('div', { class: 'insp' }, [
      h(TextInput, {
        label: t.layout.buttonLink, hint: t.layout.buttonLinkHint, value: str(p.node, 'href'), type: 'url', placeholder: 'https://',
        validate: (v: string) => (v === '' || safeUrl(v) !== null ? null : t.layout.buttonLinkInvalid),
        onCommit: (v: string) => { editor.setAttrs(p.id, { href: v === '' ? '' : safeUrl(v) ?? '' }, v === '' ? '' : t.layout.linkSet) },
      }),
      fieldValue(p.node, 'text').text === '' ? h('p', { class: 'hint is-error' }, t.layout.buttonNeedsText) : null,
      row(t.layout.buttonLook, h(Seg, {
        label: t.layout.buttonLook, value: str(p.node, 'look') || 'fill',
        options: (['fill', 'line'] as const).map((v) => ({ value: v, label: t.layout.buttonLooks[v] })),
        onPick: (v: string | number) => { editor.setAttrs(p.id, { look: v }) },
      })),
      checkbox(t.newWindow, p.node.attrs.newWindow === true, (v) => { editor.setAttrs(p.id, { newWindow: v }) }),
    ])
  },
})

// ---------------------------------------------------------------------------
// Space

const SpacerEdit = defineComponent({
  name: 'ProzaSpacer', props,
  // Always a named group: it has no text, so it is selected as a whole, like a divider.
  setup: (p) => () => h('div', { ...p.wrapper, role: 'group', class: [...p.wrapper.class, 'pz-spacer', `pz-space-${str(p.node, 'height') || 'm'}`] }),
})

const SpacerInspector = defineComponent({
  name: 'ProzaSpacerInspector',
  props: { id: { type: String, required: true }, node: { type: Object as PropType<BlockNode>, required: true } },
  setup(p) {
    const ui = useUi()
    return () => h('div', { class: 'insp' }, [row(ui.t.layout.height, h(Seg, {
      label: ui.t.layout.height, value: str(p.node, 'height') || 'm',
      options: SPACES.map((v) => ({ value: v, label: ui.t.layout.heights[v] })),
      onPick: (v: string | number) => { ui.editor.setAttrs(p.id, { height: v }) },
    }), { column: true })])
  },
})

// ---------------------------------------------------------------------------

const join = (schema: RenderableBlock, def: BlockEditing, edit: Component, inspector?: Component): BlockDefinition =>
  defineBlock({ ...schema, ...def, edit, ...(inspector ? { inspector } : {}), a11y: checksFor(schema.name), parse: layoutParse[schema.name] ?? [] })

/** The core layout blocks. */
export const layoutBlockDefinitions: readonly BlockDefinition[] = [
  join(columns, { ...columnsEditing, transforms: columnsTransforms }, ColumnsEdit, ColumnsInspector),
  join(column, columnEditing, ColumnEdit),
  join(group, { ...groupEditing, transforms: groupTransforms }, GroupEdit, GroupInspector),
  join(details, detailsEditing, DetailsEdit, DetailsInspector),
  join(buttons, buttonsEditing, ButtonsEdit),
  join(button, buttonEditing, ButtonEdit, ButtonInspector),
  join(spacer, spacerEditing, SpacerEdit, SpacerInspector),
]
