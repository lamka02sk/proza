/**
 * Part options: the inspector as a popover beside the part's tools.
 * The block type adds its own rows (`inspector`);
 * the rows every part shares are here: alignment, the rare settings behind
 * More, moving, duplicating and removing.
 */
import { type VNode, computed, defineComponent, h, ref, useId, watch } from 'vue'
import { PopoverContent, PopoverRoot } from 'reka-ui'
import { blocks as blockSelection, focusBlock } from '../editor/selection'
import { duplicateBlocks, isFixed, moveBlocks, removeBlocks } from '../editor/structure'
import { childrenOf, isSelfOrAncestor, parentOf } from '../model/tree'
import { useUi, track } from './context'
import { frozen, lockOf } from '../editor/locks'
import { Seg, TextInput } from './controls'
import { icon } from './icons'

const ANCHOR = /^[A-Za-z][\w-]*$/
/** BCP 47, loosely: a language, then subtags. */
const LANG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

export const PartOptions = defineComponent({
  name: 'ProzaPartOptions',
  setup() {
    const ui = useUi()
    const { editor, t } = ui
    const moreId = useId()
    const more = ref(false)
    let acted = false

    const id = computed(() => ui.options.value)
    // The part may go away under the open menu (undo, removal elsewhere).
    watch([id, editor.revision], () => {
      if (id.value !== null && !editor.tree.nodes.has(id.value)) ui.options.value = null
      if (ui.optionsFor.value !== null && !editor.tree.nodes.has(ui.optionsFor.value)) ui.optionsFor.value = null
    })
    watch(id, (now, before) => {
      if (now === null) { ui.optionsFor.value = null; return }
      more.value = false
      acted = false
      if (before !== null && before !== now) ui.optionsFor.value = null
      if (ui.part.value !== now && editor.tree.nodes.has(now)) editor.select(blockSelection(now), 'edit', { keepFocus: true })
    })

    /**
     * The blocks from the part down to the selection that have options of their
     * own, and the one the options act on: inside parts that frame others
     * (columns, a group) the part within, so each level stays one choice away.
     */
    const path = computed((): { chain: string[]; target: string } | null => {
      track(editor.revision.value)
      const part = id.value
      if (part === null || !editor.tree.nodes.has(part)) return null
      const chain: string[] = []
      const focus = focusBlock(editor.selectionRef.value)
      if (focus !== null && editor.tree.nodes.has(focus) && isSelfOrAncestor(editor.tree, part, focus)) {
        for (let cur: string | null = focus; cur !== null; cur = parentOf(editor.tree, cur)) {
          // Rows and cells are the table's; its own options and cell tools change them.
          if (!isFixed(editor.context(), cur)) chain.unshift(cur)
          if (cur === part) break
        }
      } else chain.push(part)
      const frames = (b: string): boolean => editor.editingFor(editor.tree.nodes.get(b)!.type)?.frame === true
      // Past the first part that frames nothing (a quote stays one part with its text inside).
      const end = chain.findIndex((b) => !frames(b))
      const shown = end < 0 ? chain : chain.slice(0, end + 1)
      const chosen = ui.optionsFor.value
      const target = chosen !== null && shown.includes(chosen) ? chosen : shown.at(-1)!
      return { chain: shown, target }
    })

    const settingsFor = (partId: string): HTMLElement | undefined => {
      const button = ui.settingsButton.value
      return button?.dataset.pzCfg === partId ? button : undefined
    }

    const close = (): void => { ui.options.value = null }
    /** An action that puts the caret somewhere new: the menu closes without taking the focus back. */
    const act = (fn: () => boolean): void => { if (fn()) { acted = true; close() } }

    const body = (top: string): (VNode | null)[] => {
      track(editor.revision.value)
      const p = path.value
      const partId = p?.target ?? top
      const node = editor.nodeRef(partId).value
      if (!node) return []
      const def = editor.editingFor(node.type)
      const parent = parentOf(editor.tree, partId)
      const kids = childrenOf(editor.tree, parent)
      const i = kids.indexOf(partId)
      const attrs = node.attrs
      const rows: (VNode | null)[] = []
      const last = i === kids.length - 1
      if (p && p.chain.length > 1) {
        rows.push(h('div', { class: 'opt-path', role: 'group', 'aria-label': t.optionsPath }, p.chain.map((b) => h('button', {
          type: 'button', class: ['btn', 'btn-s', b === partId && 'is-on'], 'aria-pressed': b === partId ? 'true' : 'false',
          onClick: () => { ui.optionsFor.value = b },
        }, editor.editingFor(editor.tree.nodes.get(b)!.type)?.title(editor.tree.nodes.get(b)!, editor.strings) ?? b))))
      }
      // On a narrow field the plus moves in here.
      rows.push(last || parent !== null ? null : h('button', {
        type: 'button', class: 'btn only-s',
        onClick: () => { close(); ui.add.value = { kind: 'part', id: partId } },
      }, [h('span', { class: 'plus-chip', 'aria-hidden': 'true' }), t.addBelow]))
      const lock = lockOf(editor.tree, partId)
      const stuck = lock !== '' || frozen(editor.tree, parent)
      // Said first, so the rows that follow are not a surprise when they do nothing.
      if (lock !== '' || frozen(editor.tree, partId)) rows.push(h('p', { class: 'hint opt-locked' }, [icon('lock'), frozen(editor.tree, partId) ? t.lockedAll : t.lockedInPlace]))
      if (def?.inspector) rows.push(h(def.inspector, { id: partId, node, key: `${partId}:${node.type}` }))
      for (const [i, panel] of ui.inspectorPanels.entries()) {
        if (panel.types === '*' || panel.types.includes(node.type)) rows.push(h(panel.component, { id: partId, node, key: `${partId}:plugin:${i}` }))
      }
      // Turn into (`transforms`): the selected parts when several are, otherwise this one.
      const sel = editor.selection
      const ids = (sel.kind === 'blocks' || sel.kind === 'range') && editor.targets().length > 1 ? editor.targets() : [partId]
      const turns = editor.transformsFor(ids)
      if (turns.length > 0) {
        rows.push(h('div', { class: 'row row-col' }, [
          h('span', { class: 'lab', id: `${moreId}-turn` }, t.turnInto),
          h('div', { class: 'turns', role: 'group', 'aria-labelledby': `${moreId}-turn` }, turns.map(({ transform, change }) => h('button', {
            type: 'button', class: 'btn btn-s btn-line', 'data-pz-turn': transform.id,
            onClick: () => { act(() => editor.apply(change)) },
          }, transform.title(editor.strings)))),
        ]))
      }
      const variants = ui.styles[node.type] ?? []
      if (variants.length > 0) {
        rows.push(h('div', { class: 'row row-col' }, [
          h('span', { class: 'lab' }, t.style),
          h(Seg, {
            label: t.style, value: typeof attrs.variant === 'string' && attrs.variant !== '' ? attrs.variant : '-',
            options: [{ value: '-', label: t.styleDefault }, ...variants.map((v) => ({ value: v.name, label: v.label }))],
            onPick: (v: string | number) => { editor.setAttrs(partId, { variant: v === '-' ? '' : v }, t.styleSet(v === '-' ? t.styleDefault : variants.find((x) => x.name === v)?.label ?? String(v))) },
          }),
        ]))
      }
      if ('size' in attrs) {
        rows.push(h('div', { class: 'row' }, [
          h('span', { class: 'lab' }, t.size),
          h(Seg, {
            label: t.size,
            value: attrs.size === '' ? 'normal' : attrs.size as string,
            options: [{ value: 's', label: t.sizeNames.s }, { value: 'normal', label: t.sizeNames.normal }, { value: 'l', label: t.sizeNames.l }],
            onPick: (v: string | number) => { editor.setAttrs(partId, { size: v === 'normal' ? '' : v }) },
          }),
        ]))
      }
      if ('color' in attrs && ui.palette.length > 0) {
        const now = attrs.color as string
        const swatch = (value: string, label: string, cls: string): VNode => h('button', {
          type: 'button', class: ['sw', cls, now === value && 'is-on'], 'aria-label': label, title: label, 'aria-pressed': now === value ? 'true' : 'false',
          onClick: () => { editor.setAttrs(partId, { color: value }) },
        })
        rows.push(h('div', { class: 'row' }, [
          h('span', { class: 'lab', id: `${moreId}-color` }, t.color),
          h('div', { class: 'sws', role: 'group', 'aria-labelledby': `${moreId}-color` }, [
            swatch('', t.colorDefault, 'sw-default'),
            // Each swatch shows its colour through the same class the text gets, so the canvas and the swatch agree.
            ...ui.palette.map((c) => swatch(c.name, c.label, `pz-color-${c.name}`)),
          ]),
        ]))
      }
      const alignAttr = 'textAlign' in attrs ? 'textAlign' : 'align' in attrs ? 'align' : null
      if (alignAttr) {
        rows.push(h('div', { class: 'row' }, [
          h('span', { class: 'lab' }, t.align),
          h(Seg, {
            label: t.align,
            value: attrs[alignAttr] === '' ? 'start' : attrs[alignAttr] as string,
            options: [
              { value: 'start', label: t.alignNames.start, icon: t.dir === 'rtl' ? 'alignEnd' : 'alignStart' },
              { value: 'center', label: t.alignNames.center, icon: 'alignCenter' },
              { value: 'end', label: t.alignNames.end, icon: t.dir === 'rtl' ? 'alignStart' : 'alignEnd' },
              // Shown where the host offers it, and on text that already is justified, so it can be switched off.
              ...(alignAttr === 'textAlign' && (ui.justify || attrs.textAlign === 'justify') ? [{ value: 'justify', label: t.alignNames.justify, icon: 'alignJustify' as const }] : []),
            ],
            onPick: (v: string | number) => { editor.setAttrs(partId, { [alignAttr]: v === 'start' ? '' : v }) },
          }),
        ]))
      }
      if ('bleed' in attrs && parent === null) {
        const bleedHint = `${moreId}-bleed`
        rows.push(h('div', { class: 'row row-col' }, [
          h('span', { class: 'lab' }, t.bleed),
          h(Seg, {
            label: t.bleed,
            value: attrs.bleed === '' ? 'none' : attrs.bleed as string,
            options: (['none', 'wide', 'full'] as const).map((v) => ({ value: v, label: t.bleedNames[v], describedBy: bleedHint })),
            // A wide picture is a large one past the column.
            onPick: (v: string | number) => { editor.setAttrs(partId, { bleed: v === 'none' ? '' : v, ...(v !== 'none' && 'width' in attrs && typeof attrs.width === 'string' ? { width: 'l' } : {}) }) },
          }),
          h('p', { class: 'hint', id: bleedHint }, t.bleedHint),
        ]))
      }
      const rare = 'anchor' in attrs || 'lang' in attrs || ui.locking
      if (rare) {
        rows.push(h('button', {
          type: 'button', class: 'btn btn-more', 'aria-expanded': more.value ? 'true' : 'false', 'aria-controls': moreId,
          onClick: () => { more.value = !more.value },
        }, [t.more, icon('chevron')]))
        rows.push(more.value ? h('div', { id: moreId, class: 'more' }, [
          'anchor' in attrs ? h(TextInput, {
            label: t.anchor, hint: t.anchorHint, value: attrs.anchor as string,
            validate: (v: string) => (v === '' || ANCHOR.test(v) ? null : t.anchorInvalid),
            onCommit: (v: string) => { editor.setAttrs(partId, { anchor: v }) },
          }) : null,
          'lang' in attrs ? h(TextInput, {
            label: t.language, hint: t.languageHint, value: attrs.lang as string,
            validate: (v: string) => (v === '' || LANG.test(v) ? null : t.languageInvalid),
            onCommit: (v: string) => { editor.setAttrs(partId, { lang: v }) },
          }) : null,
          'dir' in attrs ? h('div', { class: 'row row-col' }, [
            h('span', { class: 'lab' }, t.direction),
            h(Seg, {
              label: t.direction,
              value: attrs.dir === '' ? 'auto' : attrs.dir as string,
              options: [
                { value: 'auto', label: t.directionNames.auto },
                { value: 'ltr', label: t.directionNames.ltr },
                { value: 'rtl', label: t.directionNames.rtl },
              ],
              onPick: (v: string | number) => { editor.setAttrs(partId, { dir: v === 'auto' ? '' : v }) },
            }),
          ]) : null,
          ui.locking ? h('div', { class: 'row row-col' }, [
            h('span', { class: 'lab' }, t.lock),
            h(Seg, {
              label: t.lock, value: lock === '' ? 'none' : lock,
              options: (['none', 'move', 'all'] as const).map((v) => ({ value: v, label: t.lockNames[v], describedBy: `${moreId}-lock` })),
              onPick: (v: string | number) => { editor.setAttrs(partId, { lock: v === 'none' ? '' : v }, t.lockSet(t.lockNames[v as 'none' | 'move' | 'all'])) },
            }),
            h('p', { class: 'hint', id: `${moreId}-lock` }, t.lockHint),
          ]) : null,
        ]) : null)
      }
      rows.push(h('div', { class: 'rule' }))
      rows.push(h('div', { class: 'pair' }, [
        h('button', { type: 'button', class: 'btn', disabled: i <= 0 || stuck, onClick: () => { editor.apply(moveBlocks(editor.context(), [partId], -1, editor.selection), { keepFocus: true }) } }, [icon('up'), t.moveUp]),
        h('button', { type: 'button', class: 'btn', disabled: last || stuck, onClick: () => { editor.apply(moveBlocks(editor.context(), [partId], 1, editor.selection), { keepFocus: true }) } }, [icon('down'), t.moveDown]),
      ]))
      rows.push(h('button', { type: 'button', class: 'btn', onClick: () => { act(() => editor.apply(duplicateBlocks(editor.context(), [partId], editor.selection))) } }, [icon('copy'), t.duplicate]))
      rows.push(h('button', { type: 'button', class: 'btn', disabled: stuck, onClick: () => { act(() => editor.apply(removeBlocks(editor.context(), [partId]))) } }, [icon('trash'), t.remove]))
      return rows
    }

    return () => {
      const partId = id.value
      const reference = partId === null ? null : settingsFor(partId) ?? editor.blockElement(partId)
      return h(PopoverRoot, { open: partId !== null, 'onUpdate:open': (v: boolean) => { if (!v) close() } }, () => partId === null ? null : h(PopoverContent, {
        ...(reference ? { reference } : {}),
        side: 'bottom',
        align: 'start',
        sideOffset: 6,
        collisionPadding: 8,
        class: 'pop pop-blk',
        role: 'dialog',
        'aria-label': `${t.partOptions}: ${editor.labelFor(editor.tree.nodes.get(path.value?.target ?? partId) ?? { id: partId, type: '', attrs: {} })}`,
        dir: t.dir,
        onCloseAutoFocus: (e: Event) => {
          e.preventDefault()
          if (acted || id.value !== null) return
          const opener = settingsFor(partId)
          if (opener?.isConnected) opener.focus()
          else ui.focusText()
        },
      }, () => body(partId)))
    }
  },
})
