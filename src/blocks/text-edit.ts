/**
 * Canvas components of the core text blocks. Each renders its block's root
 * element with the wrapper attributes from the canvas, so lists stay `ul > li`
 * in the editor as in the output. Behaviour: `text-behaviour.ts`.
 */
import { checksFor } from './checks'
import { type Component, type PropType, defineComponent, h, nextTick, onMounted, watch } from 'vue'
import { type BlockDefinition, type BlockEditing, fieldValue } from '../editor/editing'
import { excerpt } from '../editor/strings'
import { parentOf, type BlockNode } from '../model/tree'
import type { RenderableBlock } from '../render/render'
import { BlockList, RichTextView, type WrapperProps, useEditor } from '../ui/canvas'
import { defineBlock } from './define'
import { textParse } from './text-parse'
import { code, heading, list, listItem, paragraph, preformatted, quote, separator } from './text'
import { TextInspector } from './text-inspector'
import {
  LIST as LIST_TYPE, codeEditing, headingEditing, listEditing, listItemEditing, paragraphEditing, preformattedEditing, quoteEditing, separatorEditing, toggleCheck,
} from './text-behaviour'

const props = {
  id: { type: String, required: true },
  node: { type: Object as PropType<BlockNode>, required: true },
  wrapper: { type: Object as PropType<WrapperProps>, required: true },
} as const

/** A div root takes the group role only while it is named (selected): a text block is otherwise just its textbox. */
const group = (w: WrapperProps): Record<string, unknown> => (w['aria-label'] ? { ...w, role: 'group' } : { ...w })

/** A field takes its language and direction when it mounts: a change of either mounts a new one. */
const fieldKey = (node: BlockNode, tag: string): string => `${tag}|${typeof node.attrs.lang === 'string' ? node.attrs.lang : ''}|${typeof node.attrs.dir === 'string' ? node.attrs.dir : ''}`
const field = (node: BlockNode, attr: string, tag: string) => h(RichTextView, { blockId: node.id, attr, tag, key: fieldKey(node, tag) })

const ParagraphEdit = defineComponent({
  name: 'ProzaParagraph',
  props,
  setup: (p) => () => h('div', group(p.wrapper), field(p.node, 'content', 'p')),
})

const HeadingEdit = defineComponent({
  name: 'ProzaHeading',
  props,
  // A div, not h2: a heading element may not take the textbox role (ARIA in HTML). The field's name says the level.
  setup: (p) => () => h('div', group(p.wrapper), h(RichTextView, { blockId: p.id, attr: 'content', tag: 'div', key: fieldKey(p.node, String(p.node.attrs.level)), classes: `pz-h pz-h${String(p.node.attrs.level)}` })),
})

const ListEdit = defineComponent({
  name: 'ProzaList',
  props,
  setup: (p) => () => {
    const { style, start, reversed, numbering } = p.node.attrs
    const w = p.wrapper
    if (style !== 'number') return h('ul', { ...w, class: [...w.class, style === 'check' && 'pz-checklist'] }, h(BlockList, { parent: p.id }))
    return h('ol', { ...w, start: start === 1 ? undefined : start, reversed: reversed === true ? true : undefined, type: numbering === '1' ? undefined : numbering }, h(BlockList, { parent: p.id }))
  },
})

const ListItemEdit = defineComponent({
  name: 'ProzaListItem',
  props,
  setup: (p) => {
    const editor = useEditor()
    return () => {
      const listId = parentOf(editor.tree, p.id)
      const check = listId !== null && editor.nodeRef(listId).value?.attrs.style === 'check'
      const done = p.node.attrs.checked === true
      // One Tab stop per canvas: the box is not in the Tab order; Mod+Enter toggles it from the text (keyboard help).
      const box = check ? h('input', {
        type: 'checkbox', class: 'pz-check', tabindex: -1, checked: done,
        'aria-label': editor.strings.checkItem(excerpt(fieldValue(p.node, 'content').text, 30)),
        onChange: () => { editor.apply(toggleCheck(editor.context(), p.id), { keepFocus: true }) },
      }) : null
      return h('li', { ...p.wrapper, class: [...p.wrapper.class, check && 'pz-check-item', check && done && 'is-done'] }, [box, field(p.node, 'content', 'div'), h(BlockList, { parent: p.id })])
    }
  },
})

const QuoteEdit = defineComponent({
  name: 'ProzaQuote',
  props,
  setup: (p) => {
    const editor = useEditor()
    return () => {
      const w = p.wrapper
      const citation = editor.fieldShown(p.node, 'citation')
      return h('figure', { ...w, class: [...w.class, 'pz-quote'] }, [
        h('blockquote', null, h(BlockList, { parent: p.id })),
        // A div in the figure: figcaption may not take the textbox role.
        citation ? h(RichTextView, { blockId: p.id, attr: 'citation', tag: 'div', key: 'citation', classes: 'pz-cite', 'data-placeholder': editor.strings.fieldNames.citation }) : null,
      ])
    }
  },
})

const TOKEN_TYPES = ['comment', 'string', 'number', 'keyword', 'literal', 'tag', 'attr', 'property', 'variable', 'function', 'meta'] as const

/**
 * Code with its language highlighted as it is typed: the tokens are painted
 * with the Custom Highlight API, so the field's DOM stays its own.
 */
const CodeEdit = defineComponent({
  name: 'ProzaCode',
  props,
  setup(p) {
    const editor = useEditor()
    const paint = (): void => {
      const language = typeof p.node.attrs.language === 'string' ? p.node.attrs.language : ''
      const field = editor.field(p.id, 'content')
      if (!field) return
      const hl = editor.highlighter.value
      if (language !== '' && !hl) { void editor.loadHighlighter().then(paint); return }
      const tokens = hl && language !== '' ? hl.tokenize(field.value.text, language) : []
      for (const type of TOKEN_TYPES) field.setHighlight(`pz-tok-${type}`, tokens.filter((x) => x.type === type))
    }
    onMounted(paint)
    watch(() => p.node, () => { void nextTick(paint) })
    return () => h('div', group(p.wrapper), h('pre', { class: 'pz-code' }, field(p.node, 'content', 'code')))
  },
})

const PreformattedEdit = defineComponent({
  name: 'ProzaPreformatted',
  props,
  setup: (p) => () => h('div', group(p.wrapper), field(p.node, 'content', 'pre')),
})

const SeparatorEdit = defineComponent({
  name: 'ProzaSeparator',
  props,
  // Always a named group: it has no text, so it is selected as a whole.
  setup: (p) => () => h('div', { ...p.wrapper, role: 'group' }, h('hr')),
})

/** Schema, output, behaviour and canvas component in one definition. */
const join = (schema: RenderableBlock, def: BlockEditing, edit: Component): BlockDefinition =>
  defineBlock({ ...schema, ...def, edit, a11y: checksFor(schema.name), parse: textParse[schema.name] ?? [], ...(def.fields.length > 0 || def.name === LIST_TYPE ? { inspector: TextInspector } : {}) })

/** The core text blocks. */
export const textBlockDefinitions: readonly BlockDefinition[] = [
  join(paragraph, paragraphEditing, ParagraphEdit),
  join(heading, headingEditing, HeadingEdit),
  join(list, listEditing, ListEdit),
  join(listItem, listItemEditing, ListItemEdit),
  join(quote, quoteEditing, QuoteEdit),
  join(code, codeEditing, CodeEdit),
  join(preformatted, preformattedEditing, PreformattedEdit),
  join(separator, separatorEditing, SeparatorEdit),
]
