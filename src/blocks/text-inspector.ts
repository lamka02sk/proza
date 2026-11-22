/**
 * Rows of the part options for the text blocks:
 * Show as, a heading's level with the outline around it (ATAG B.2: warn
 * before a level is skipped), a list's style and numbering, a code block's language.
 */
import { type PropType, type VNode, defineComponent, h, useId } from 'vue'
import { allBlocks } from '../editor/editor'
import type { BlockNode } from '../model/tree'
import { useUi } from '../ui/context'
import { Seg, TextInput, checkbox, row } from '../ui/controls'
import { excerpt } from '../editor/strings'
import { CODE, HEADING, LIST, SHOW_AS_TYPE, type ShowAs, showAs, shownAs } from './text-behaviour'

const KINDS: readonly ShowAs[] = ['text', 'heading', 'list', 'quote']
const LANGUAGE = /^[a-z0-9][a-z0-9+#.-]*$/i

export const TextInspector = defineComponent({
  name: 'ProzaTextInspector',
  props: {
    id: { type: String, required: true },
    node: { type: Object as PropType<BlockNode>, required: true },
  },
  setup(props) {
    const ui = useUi()
    const { editor, t } = ui
    const warnId = useId()

    /** The heading before this one in reading order, for the outline note. */
    const headingBefore = (): BlockNode | null => {
      const order = allBlocks(editor.tree)
      for (let i = order.indexOf(props.id) - 1; i >= 0; i--) {
        const n = editor.tree.nodes.get(order[i]!)
        if (n?.type === HEADING) return n
      }
      return null
    }

    return () => {
      const node = props.node
      const rows: (VNode | null)[] = []
      const ctx = editor.context()
      const now = shownAs(node)
      rows.push(h('div', { class: 'row row-col' }, [
        h('span', { class: 'lab' }, t.showAs),
        h(Seg, {
          label: t.showAs,
          value: now,
          options: KINDS.filter((k) => k === now || editor.offers(SHOW_AS_TYPE[k])).map((k) => ({ value: k, label: t.showAsNames[k], disabled: k !== now && showAs(ctx, props.id, k) === null })),
          onPick: (k: string | number) => { editor.apply(showAs(editor.context(), props.id, k as ShowAs), { keepFocus: true }) },
        }),
      ]))

      if (node.type === HEADING) {
        const level = node.attrs.level as number
        const before = headingBefore()
        const prev = before ? before.attrs.level as number : 1
        const skips = (l: number): boolean => l > prev + 1
        rows.push(h('div', { class: 'row row-col' }, [
          h('span', { class: 'lab' }, t.level),
          h(Seg, {
            label: t.level,
            value: level,
            options: [1, 2, 3, 4, 5, 6].map((l) => ({ value: l, label: String(l), ...(skips(l) ? { describedBy: warnId } : {}) })),
            onPick: (l: string | number) => { editor.setAttrs(props.id, { level: l }, editor.strings.changedTo(editor.strings.heading(l as number))) },
          }),
          h('p', { class: 'hint' }, before ? t.headingBefore(prev, excerpt((before.attrs.content as { text: string }).text, 30)) : t.noHeadingBefore),
          skips(level) ? h('p', { class: 'hint is-error' }, t.skipsLevel(prev, level)) : null,
          h('span', { class: 'vh', id: warnId }, t.skipsLevelNote),
        ]))
      }

      if (node.type === LIST) {
        const style = node.attrs.style as string
        rows.push(h('div', { class: 'row row-col' }, [
          h('span', { class: 'lab' }, t.listStyle),
          h(Seg, {
            label: t.listStyle,
            value: style,
            options: (['bullet', 'number', 'check'] as const).map((v) => ({ value: v, label: t.listStyles[v], disabled: v !== style && !editor.offers(v === 'bullet' ? LIST : `${LIST}/${v}`) })),
            onPick: (v: string | number) => { editor.setAttrs(props.id, { style: v }, editor.strings.changedTo(t.listStyles[v as 'bullet' | 'number' | 'check'])) },
          }),
        ]))
        if (style === 'number') {
          const selectId = `${warnId}-numbering`
          rows.push(row(t.numbering, h('select', {
            id: selectId, class: 'field field-select', value: node.attrs.numbering as string,
            onChange: (e: Event) => { editor.setAttrs(props.id, { numbering: (e.target as HTMLSelectElement).value }) },
          }, ['1', 'a', 'A', 'i', 'I'].map((n) => h('option', { value: n, selected: n === node.attrs.numbering }, t.numberingNames[n] ?? n))), { column: true, labelFor: selectId }))
          rows.push(h(TextInput, {
            label: t.startAt, value: String(node.attrs.start), inputmode: 'numeric',
            validate: (v: string) => (/^-?\d{1,6}$/.test(v) ? null : t.startAt),
            onCommit: (v: string) => { editor.setAttrs(props.id, { start: Number(v) }) },
          }))
          rows.push(checkbox(t.reversed, node.attrs.reversed === true, (v) => { editor.setAttrs(props.id, { reversed: v }) }))
        }
      }

      if (node.type === CODE) {
        rows.push(h(TextInput, {
          label: t.codeLanguage, hint: t.codeLanguageHint, value: node.attrs.language as string,
          validate: (v: string) => (v === '' || (LANGUAGE.test(v) && v.length <= 40) ? null : t.codeLanguageHint),
          onCommit: (v: string) => { editor.setAttrs(props.id, { language: v }) },
        }))
      }
      return h('div', { class: 'insp' }, rows)
    }
  },
})
