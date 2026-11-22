/**
 * The parity tools of the status line's More menu:
 * find and replace, special characters and emoji, date
 * and time, the non-breaking space, spaces and marks shown, outlines of
 * parts, word count and the page as published.
 */
import { type VNode, computed, defineComponent, h, nextTick, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue'
import {
  DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuItemIndicator, DropdownMenuRoot, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger, ToolbarButton,
} from 'reka-ui'
import { fieldValue, stops } from '../editor/editing'
import type { Match } from '../editor/find'
import { displayKeys } from '../richtext/keys'
import { useUi, track } from './context'
import { frame, useDialog } from './dialogs'
import { icon } from './icons'

const FIND = 'pz-find'
const FIND_CURRENT = 'pz-find-current'
const SPACE = 'pz-space'
const NBSP = 'pz-nbsp'

// ---------------------------------------------------------------------------
// More menu

export const MoreMenu = defineComponent({
  name: 'ProzaMoreMenu',
  setup() {
    const ui = useUi()
    const { editor, t } = ui
    const keys = (name: string): string | null => {
      const k = editor.keymap.keysFor(name)[0]
      return k ? displayKeys(k, editor.keymap.mac, editor.strings.keyNames) : null
    }
    const canType = computed(() => {
      track(editor.revision.value)
      const k = editor.selectionRef.value.kind
      return !editor.readOnly.value && (k === 'text' || k === 'range')
    })
    /** The ways a date or time is written, in the content's language, formatted when the menu opens. */
    const dates = (): string[] => {
      const now = new Date()
      const f = (o: Intl.DateTimeFormatOptions): string => new Intl.DateTimeFormat(editor.strings.lang, o).format(now)
      const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      return [...new Set([f({ dateStyle: 'long' }), f({ dateStyle: 'short' }), f({ timeStyle: 'short' }), f({ dateStyle: 'medium', timeStyle: 'short' }), iso])]
    }
    // A choice that typed something returns to the caret; one that opened a panel leaves the focus to it.
    let toText = true
    const item = (label: string, onSelect: () => void, extra: { disabled?: boolean; kbd?: string | null; id?: string } = {}): VNode =>
      h(DropdownMenuItem, {
        class: 'btn', disabled: extra.disabled === true, 'data-pz-tool': extra.id,
        onSelect: () => { onSelect() },
      }, () => [h('span', { class: 'menu-text' }, [label, extra.kbd ? h('span', { class: 'menu-meta' }, extra.kbd) : null])])
    const toggle = (label: string, model: { value: boolean }, id: string): VNode => h(DropdownMenuCheckboxItem, {
      class: 'btn', modelValue: model.value, 'data-pz-tool': id,
      'onUpdate:modelValue': (v: boolean) => { model.value = v; editor.announce(t.toggled(label, v)) },
    }, () => [h('span', { class: 'menu-text' }, label), h(DropdownMenuItemIndicator, { asChild: true }, () => icon('check'))])

    return () => h(DropdownMenuRoot, { modal: false, 'onUpdate:open': (v: boolean) => { if (v) toText = true } }, () => [
      // A button of the status line's toolbar: one Tab stop for all its tools, arrows between them.
      h(DropdownMenuTrigger, { asChild: true }, () => h(ToolbarButton, {
        class: 'btn btn-s btn-icon', 'aria-label': t.moreTools, title: t.moreTools, 'data-pz-more': '',
      }, () => icon('more'))),
      h(DropdownMenuContent, {
        class: 'pop pop-menu', side: 'top', align: 'end', sideOffset: 6, collisionPadding: 8,
        onCloseAutoFocus: (e: Event) => { if (toText) { e.preventDefault(); ui.focusText() } },
      }, () => [
        item(editor.readOnly.value ? t.find : t.findReplace, () => { toText = false; ui.findOpen.value = true }, { kbd: keys('find'), id: 'find' }),
        item(t.insertCharacter, () => { toText = false; ui.charactersOpen.value = true }, { disabled: !canType.value, id: 'characters' }),
        h(DropdownMenuSub, null, () => [
          h(DropdownMenuSubTrigger, { class: 'btn', disabled: !canType.value, 'data-pz-tool': 'date' }, () => [h('span', { class: 'menu-text' }, t.insertDate), icon('right')]),
          h(DropdownMenuSubContent, { class: 'pop pop-menu', sideOffset: 4, collisionPadding: 8 }, () => dates().map((d) => item(d, () => { editor.insertText(d) }))),
        ]),
        item(t.nonBreakingSpace, () => { editor.insertText('\u00A0') }, { disabled: !canType.value, kbd: keys('nonBreakingSpace'), id: 'nbsp' }),
        h(DropdownMenuSeparator, { class: 'menu-sep' }),
        toggle(t.showInvisibles, ui.invisibles, 'invisibles'),
        toggle(t.showOutlines, ui.outlines, 'outlines'),
        h(DropdownMenuSeparator, { class: 'menu-sep' }),
        item(t.wordCount, () => { toText = false; ui.countsOpen.value = true }, { id: 'counts' }),
        item(t.previewPage, () => { toText = false; ui.pageOpen.value = true }, { id: 'page' }),
      ]),
    ])
  },
})

// ---------------------------------------------------------------------------
// Find and replace

/**
 * A bar above the status line (TinyMCE `searchreplace`, find across parts).
 * Matches are painted with the Custom Highlight API, so the text DOM is never
 * touched; the current one is scrolled into view. Enter finds the next,
 * Shift+Enter the previous, Escape closes and selects the current match.
 */
export const FindBar = defineComponent({
  name: 'ProzaFindBar',
  setup() {
    const ui = useUi()
    const { editor, t } = ui
    const id = useId()
    const query = ref('')
    const replacement = ref('')
    const matchCase = ref(false)
    const wholeWords = ref(false)
    const index = ref(-1)
    const input = ref<HTMLInputElement>()
    const matches = shallowRef<Match[]>([])
    const options = (): { matchCase: boolean; wholeWords: boolean } => ({ matchCase: matchCase.value, wholeWords: wholeWords.value })

    /** Fields painted last time, so a field whose matches are gone is cleared. */
    let painted = new Set<string>()
    const paint = (): void => {
      const byField = new Map<string, { blockId: string; field: string; all: { start: number; end: number }[]; current: { start: number; end: number }[] }>()
      matches.value.forEach((m, i) => {
        const key = `${m.blockId}\u0000${m.field}`
        let e = byField.get(key)
        if (!e) byField.set(key, (e = { blockId: m.blockId, field: m.field, all: [], current: [] }))
        ;(i === index.value ? e.current : e.all).push({ start: m.start, end: m.end })
      })
      for (const key of painted) {
        if (byField.has(key)) continue
        const [b, f] = key.split('\u0000') as [string, string]
        const field = editor.field(b, f)
        field?.setHighlight(FIND, [])
        field?.setHighlight(FIND_CURRENT, [])
      }
      for (const e of byField.values()) {
        const field = editor.field(e.blockId, e.field)
        field?.setHighlight(FIND, e.all)
        field?.setHighlight(FIND_CURRENT, e.current)
      }
      painted = new Set(byField.keys())
    }

    const search = (keepIndex = false): void => {
      const found = ui.findOpen.value ? editor.find(query.value, options()) : []
      const before = matches.value[index.value]
      matches.value = found
      if (found.length === 0) index.value = -1
      else if (keepIndex && index.value >= 0) index.value = Math.min(index.value, found.length - 1)
      else {
        const at = before ? found.findIndex((m) => m.blockId === before.blockId && m.field === before.field && m.start >= before.start) : -1
        index.value = at >= 0 ? at : 0
      }
      paint()
    }

    const show = (): void => {
      const m = matches.value[index.value]
      if (!m) return
      editor.blockElement(m.blockId)?.scrollIntoView({ block: 'nearest' })
    }
    const step = (delta: 1 | -1): void => {
      refresh()
      const n = matches.value.length
      if (n === 0) { editor.announce(t.noMatches); return }
      index.value = (index.value + delta + n) % n
      paint()
      show()
      editor.announce(t.matchOf(index.value + 1, n))
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    watch([query, matchCase, wholeWords], () => {
      search()
      show()
      clearTimeout(timer)
      // The count, once typing pauses (results are announced).
      timer = setTimeout(() => {
        if (!ui.findOpen.value || query.value === '') return
        const n = matches.value.length
        editor.announce(n === 0 ? t.noMatches : t.matchOf(index.value + 1, n))
      }, 400)
    })
    // The text changed (typing, undo, a replacement): matches follow once the edits pause. A search walks
    // every field and repaints every match (2,000 parts), too much for each keystroke.
    let stale: ReturnType<typeof setTimeout> | undefined
    const refresh = (): void => {
      if (stale === undefined) return
      clearTimeout(stale)
      stale = undefined
      if (ui.findOpen.value && query.value !== '') search(true)
    }
    const offChange = editor.on('change', () => {
      if (!ui.findOpen.value || query.value === '') return
      clearTimeout(stale)
      stale = setTimeout(refresh, 150)
    })
    onBeforeUnmount(() => { offChange(); clearTimeout(timer); clearTimeout(stale) })

    const open = (): void => {
      const s = editor.selection
      // Words selected in one line are what the author wants to find.
      if (s.kind === 'text' && s.anchor !== s.focus) {
        const node = editor.tree.nodes.get(s.blockId)
        const text = node ? fieldValue(node, s.field).text.slice(Math.min(s.anchor, s.focus), Math.max(s.anchor, s.focus)) : ''
        if (text !== '' && !text.includes('\n') && text.length <= 200) query.value = text
      }
      search()
      void nextTick(() => { input.value?.focus(); input.value?.select() })
    }
    watch(ui.findOpen, (v) => {
      if (v) open()
      else { matches.value = []; index.value = -1; paint() }
    })
    onBeforeUnmount(editor.on('ui', (name) => {
      if (name !== 'find') return
      if (ui.findOpen.value) void nextTick(() => { input.value?.focus(); input.value?.select() })
      else ui.findOpen.value = true
    }))

    const close = (): void => {
      refresh()
      const m = matches.value[index.value]
      ui.findOpen.value = false
      if (m) editor.select({ kind: 'text', blockId: m.blockId, field: m.field, anchor: m.start, focus: m.end })
      else ui.focusText()
    }
    const replaceOne = (): void => {
      refresh()
      const m = matches.value[index.value]
      if (!m) return
      editor.replace([m], replacement.value, query.value, options())
    }
    const replaceAll = (): void => {
      refresh()
      if (matches.value.length === 0) { editor.announce(t.noMatches); return }
      editor.replace(matches.value, replacement.value, query.value, options())
    }

    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    }
    const iconButton = (name: Parameters<typeof icon>[0], label: string, onClick: () => void, extra: Record<string, unknown> = {}): VNode =>
      h('button', { type: 'button', class: 'btn btn-s btn-icon', 'aria-label': label, title: label, onClick, ...extra }, icon(name))
    const pressed = (label: string, text: string, model: { value: boolean }): VNode => h('button', {
      type: 'button', class: ['btn', 'btn-s', 'find-opt', model.value && 'is-on'], 'aria-pressed': model.value ? 'true' : 'false', title: label,
      onClick: () => { model.value = !model.value },
    }, [h('span', { 'aria-hidden': 'true' }, text), h('span', { class: 'vh' }, label)])

    return () => {
      if (!ui.findOpen.value) return null
      const n = matches.value.length
      const count = query.value === '' ? '' : n === 0 ? t.noMatches : t.matchOf(index.value + 1, n)
      const readOnly = editor.readOnly.value
      return h('div', { class: 'findbar', role: 'search', 'aria-label': readOnly ? t.find : t.findReplace, onKeydown }, [
        h('div', { class: 'find-row' }, [
          h('div', { class: 'search find-field' }, [
            icon('search'),
            h('input', {
              ref: input, id: `${id}-q`, class: 'field', type: 'search', 'aria-label': t.find, placeholder: t.find,
              'aria-describedby': `${id}-count`, value: query.value, autocomplete: 'off', spellcheck: 'false',
              onInput: (e: Event) => { query.value = (e.target as HTMLInputElement).value },
              onKeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1) } },
            }),
          ]),
          h('span', { class: 'find-count', id: `${id}-count` }, count),
          iconButton('up', t.previousMatch, () => { step(-1) }, { disabled: n === 0 }),
          iconButton('down', t.nextMatch, () => { step(1) }, { disabled: n === 0 }),
          pressed(t.matchCase, 'Aa', matchCase),
          pressed(t.wholeWords, '“ab”', wholeWords),
          iconButton('close', t.closeFind, close),
        ]),
        readOnly ? null : h('div', { class: 'find-row' }, [
          h('input', {
            class: 'field find-field', type: 'text', 'aria-label': t.replaceWith, placeholder: t.replaceWith, value: replacement.value,
            autocomplete: 'off', spellcheck: 'false',
            onInput: (e: Event) => { replacement.value = (e.target as HTMLInputElement).value },
            onKeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); replaceOne() } },
          }),
          h('button', { type: 'button', class: 'btn btn-s btn-line', disabled: n === 0, onClick: replaceOne }, t.replaceOne),
          h('button', { type: 'button', class: 'btn btn-s btn-line', disabled: n === 0, onClick: replaceAll }, t.replaceAll),
        ]),
      ])
    }
  },
})

// ---------------------------------------------------------------------------
// Spaces and marks shown (TinyMCE `visualchars`)

/**
 * Paints spaces and non-breaking spaces in every field while `ui.invisibles`
 * is on; paragraph ends are marked by CSS. Only fields whose value changed
 * are painted again, so typing stays cheap.
 */
export function useInvisibles(ui: ReturnType<typeof useUi>): () => void {
  const { editor } = ui
  // shortcut: zero-width spaces, word joiners and soft hyphens have no width to paint; they are listed in the character picker. Mark them beside their position if authors ask.
  const seen = new Map<string, unknown>()
  const ranges = (text: string, re: RegExp): { start: number; end: number }[] => [...text.matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length }))
  const paintAll = (): void => {
    const on = ui.invisibles.value
    for (const stop of stops(editor.context())) {
      if (stop.field === null) continue
      const key = `${stop.blockId}\u0000${stop.field}`
      const value = editor.tree.nodes.get(stop.blockId)?.attrs[stop.field]
      if (on && seen.get(key) === value) continue
      const field = editor.field(stop.blockId, stop.field)
      if (!field) continue
      const text = field.value.text
      field.setHighlight(SPACE, on ? ranges(text, / +/g) : [])
      field.setHighlight(NBSP, on ? ranges(text, /[\u00A0\u202F]+/g) : [])
      if (on) seen.set(key, value)
    }
    if (!on) seen.clear()
  }
  let frame = 0
  const stopWatch = watch(ui.invisibles, () => { void nextTick(paintAll) })
  // After the canvas has drawn new fields.
  const off = editor.on('change', () => {
    if (!ui.invisibles.value || frame) return
    frame = requestAnimationFrame(() => { frame = 0; paintAll() })
  })
  return () => { stopWatch(); off(); cancelAnimationFrame(frame) }
}

// ---------------------------------------------------------------------------
// Word count

export const CountsDialog = defineComponent({
  name: 'ProzaCountsDialog',
  setup() {
    const ui = useUi()
    const { editor, t } = ui
    const { el, onClose } = useDialog(ui.countsOpen, () => ui.work.value?.parentElement?.querySelector<HTMLElement>('[data-pz-more]') ?? null)
    const fmt = (n: number): string => new Intl.NumberFormat(editor.strings.lang).format(n)
    return () => {
      const body: (VNode | null)[] = []
      if (ui.countsOpen.value) {
        const { document: d, selection: s } = editor.counts()
        const row = (label: string, a: number, b: number | null): VNode => h('tr', null, [
          h('th', { scope: 'row' }, label), h('td', null, fmt(a)), s ? h('td', null, b === null ? '' : fmt(b)) : null,
        ])
        body.push(h('table', { class: 'counts' }, [
          h('thead', null, h('tr', null, [h('td'), h('th', { scope: 'col' }, t.countsDocument), s ? h('th', { scope: 'col' }, t.countsSelection) : null])),
          h('tbody', null, [
            row(t.countWords, d.words, s?.words ?? null),
            row(t.countCharacters, d.characters, s?.characters ?? null),
            row(t.countNoSpaces, d.charactersNoSpaces, s?.charactersNoSpaces ?? null),
            row(t.countParts, d.parts, null),
          ]),
        ]))
        body.push(h('div', { class: 'dlg-actions' }, [h('button', { type: 'button', class: 'btn btn-add', onClick: () => { el.value?.close() } }, t.close)]))
      }
      return frame(el, onClose, 'pz-counts-title', t.wordCount, t.close, body)
    }
  },
})

// ---------------------------------------------------------------------------
// Special characters and emoji (TinyMCE `charmap`, `emoticons`)

interface Glyph { readonly ch: string; readonly name: string; readonly words: string; readonly names: readonly string[] }
interface GlyphGroup { readonly id: string; readonly kind: 'characters' | 'emoji'; readonly glyphs: readonly Glyph[] }

const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** The picker's data, parsed once: a lazy chunk, loaded when the picker first opens. */
let loading: Promise<readonly GlyphGroup[]> | null = null
function loadGlyphs(lang: string): Promise<readonly GlyphGroup[]> {
  loading ??= import('./characters-data').then(({ CHARACTERS, EMOJI }) => {
    const parse = (kind: GlyphGroup['kind'], data: Readonly<Record<string, readonly string[]>>): GlyphGroup[] =>
      Object.entries(data).map(([id, list]) => ({
        id, kind,
        glyphs: list.map((e) => {
          const [ch = '', en = '', sk = '', enWords = '', skWords = ''] = e.split('|')
          // Both languages search: an English name works in the Slovak interface too.
          return { ch, name: lang === 'sk' ? sk : en, words: fold(`${en} ${sk} ${enWords} ${skWords}`), names: [fold(en), fold(sk)] }
        }),
      }))
    return [...parse('characters', CHARACTERS), ...parse('emoji', EMOJI)]
  })
  return loading
}

/**
 * The picker: a search field over a listbox of characters (combobox, as the
 * add menu), grouped, with the characters used lately first. Arrows move the
 * active character (Up and Down by a row), Enter inserts it at the caret.
 */
export const CharactersDialog = defineComponent({
  name: 'ProzaCharactersDialog',
  setup() {
    const ui = useUi()
    const { editor, t } = ui
    const { el, onClose, closeToText } = useDialog(ui.charactersOpen, () => null, () => { ui.focusText() })
    const id = useId()
    const groups = shallowRef<readonly GlyphGroup[]>([])
    const kind = ref<GlyphGroup['kind']>('characters')
    const query = ref('')
    const active = ref(0)
    const list = ref<HTMLElement>()

    watch(ui.charactersOpen, (v) => {
      if (!v) return
      query.value = ''
      active.value = 0
      if (groups.value.length === 0) void loadGlyphs(editor.strings.lang).then((g) => { groups.value = g })
    })

    const shown = computed((): { id: string; label: string; glyphs: readonly Glyph[] }[] => {
      const all = groups.value
      const q = fold(query.value).split(/\s+/).filter(Boolean)
      if (q.length > 0) {
        const whole = q.join(' ')
        // The character named exactly what was typed comes first ("euro" is €, not the banknote).
        const score = (g: Glyph): number => (g.names.includes(whole) ? 0 : g.names.some((n) => n.startsWith(whole)) ? 1 : 2)
        const found = all.flatMap((g) => g.glyphs).filter((g) => q.every((w) => g.words.split(/\s+/).some((x) => x.startsWith(w))))
        return [{ id: 'results', label: '', glyphs: found.map((g, i) => ({ g, i, s: score(g) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.g).slice(0, 400) }]
      }
      const byChar = new Map(all.flatMap((g) => g.glyphs).map((g) => [g.ch, g]))
      const recent = ui.recentCharacters.value.map((c) => byChar.get(c)).filter((g): g is Glyph => g !== undefined)
      return [
        ...(recent.length > 0 ? [{ id: 'recent', label: t.recent, glyphs: recent }] : []),
        ...all.filter((g) => g.kind === kind.value).map((g) => ({ id: g.id, label: t.characterGroups[g.id] ?? g.id, glyphs: g.glyphs })),
      ]
    })
    const flat = computed(() => shown.value.flatMap((g) => g.glyphs.map((glyph) => ({ group: g.id, glyph }))))
    const optionId = (group: string, i: number): string => `${id}-${group}-${i}`
    const activeId = computed(() => {
      const a = flat.value[active.value]
      if (!a) return ''
      const g = shown.value.find((x) => x.id === a.group)!
      return optionId(a.group, g.glyphs.indexOf(a.glyph))
    })
    watch([query, kind], () => { active.value = 0 })

    const insert = (g: Glyph | undefined): void => {
      if (!g) return
      ui.recentCharacters.value = [g.ch, ...ui.recentCharacters.value.filter((c) => c !== g.ch)].slice(0, 8)
      closeToText()
      // After the dialog has given the focus back, so the field takes the text where the caret was.
      void nextTick(() => {
        if (editor.insertText(g.ch)) editor.announce(t.characterInserted(g.name))
      })
    }

    /** How many tiles a row holds, measured from the grid. */
    const perRow = (): number => {
      const tiles = list.value?.querySelectorAll<HTMLElement>('.glyph')
      if (!tiles || tiles.length < 2) return 1
      const top = tiles[0]!.offsetTop
      let n = 0
      while (n < tiles.length && tiles[n]!.offsetTop === top) n++
      return Math.max(1, n)
    }
    const onKeydown = (e: KeyboardEvent): void => {
      const n = flat.value.length
      if (e.key === 'Enter') { e.preventDefault(); insert(flat.value[active.value]?.glyph); return }
      // Firefox keeps Escape in a search field: the first clears the search, the next closes.
      if (e.key === 'Escape') { e.preventDefault(); if (query.value !== '') query.value = ''; else el.value?.close(); return }
      const rtl = t.dir === 'rtl'
      const delta = e.key === 'ArrowRight' ? (rtl ? -1 : 1) : e.key === 'ArrowLeft' ? (rtl ? 1 : -1) : e.key === 'ArrowDown' ? perRow() : e.key === 'ArrowUp' ? -perRow() : 0
      // Left and Right move the caret in the search text once something is typed.
      if (n === 0 || delta === 0 || ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && query.value !== '')) return
      e.preventDefault()
      active.value = Math.max(0, Math.min(n - 1, active.value + delta))
      void nextTick(() => { list.value?.querySelector(`#${CSS.escape(activeId.value)}`)?.scrollIntoView({ block: 'nearest' }) })
    }

    return () => {
      const body: (VNode | null)[] = []
      if (ui.charactersOpen.value) {
        const a = flat.value[active.value]
        body.push(
          h('div', { class: 'seg', role: 'group', 'aria-label': t.charactersTitle }, (['characters', 'emoji'] as const).map((k) => h('button', {
            type: 'button', class: ['btn', kind.value === k && query.value === '' && 'is-on'], 'aria-pressed': kind.value === k ? 'true' : 'false',
            onClick: () => { kind.value = k; query.value = '' },
          }, t.characterKinds[k]))),
          h('div', { class: 'search' }, [
            icon('search'),
            h('input', {
              class: 'field', type: 'search', role: 'combobox', 'aria-label': t.characterSearch, placeholder: t.characterSearch,
              'aria-autocomplete': 'list', 'aria-expanded': 'true', 'aria-controls': `${id}-list`, 'aria-activedescendant': activeId.value || undefined,
              value: query.value, autocomplete: 'off', spellcheck: 'false', autofocus: true,
              onInput: (e: Event) => { query.value = (e.target as HTMLInputElement).value },
              onKeydown,
            }),
          ]),
          groups.value.length === 0 ? h('p', { class: 'hint', role: 'status' }, t.charactersLoading) : null,
          h('div', { ref: list, id: `${id}-list`, role: 'listbox', class: 'glyphs', 'aria-label': t.charactersTitle },
            shown.value.map((g) => {
              const tiles = g.glyphs.map((glyph, i) => {
                const on = a?.group === g.id && a.glyph === glyph
                return h('div', {
                  id: optionId(g.id, i), role: 'option', tabindex: -1, class: ['glyph', on && 'is-active'], 'aria-selected': on ? 'true' : 'false',
                  'aria-label': glyph.name || glyph.ch, title: glyph.name, lang: editor.strings.lang,
                  onMousedown: (e: MouseEvent) => { e.preventDefault() },
                  onClick: () => { insert(glyph) },
                }, h('span', { 'aria-hidden': 'true' }, /^\s|^[\u200B\u2060\u00AD]$/u.test(glyph.ch) ? '·' : glyph.ch))
              })
              if (!g.label) return h('div', { class: 'glyph-tiles', role: 'presentation' }, tiles)
              return h('div', { role: 'group', 'aria-labelledby': `${id}-g-${g.id}` }, [
                h('span', { class: 'lab pop-lab', id: `${id}-g-${g.id}` }, g.label),
                h('div', { class: 'glyph-tiles', role: 'presentation' }, tiles),
              ])
            })),
          groups.value.length > 0 && flat.value.length === 0 ? h('p', { class: 'hint' }, t.noResults) : null,
          h('p', { class: 'hint glyph-name', 'aria-hidden': 'true' }, a ? `${a.glyph.ch.trim() || '·'}  ${a.glyph.name}` : ''),
        )
      }
      return frame(el, onClose, 'pz-chars-title', t.charactersTitle, t.close, body)
    }
  },
})

// ---------------------------------------------------------------------------
// The page as published (TinyMCE `preview`)

/**
 * The rendered HTML in a shadow root of its own, with the canvas's
 * stylesheets: the page as readers get it, without the editing chrome.
 * The HTML is the renderer's own output, built through `h()` and its
 * allow-list, so it may go into the live DOM. Raw HTML is the exception:
 * without the host's sanitiser each raw part shows in a frame that may do
 * nothing (`sandbox` with no permissions), as on the canvas.
 */
export const PageDialog = defineComponent({
  name: 'ProzaPageDialog',
  setup() {
    const ui = useUi()
    const { editor, t } = ui
    const { el, onClose } = useDialog(ui.pageOpen, () => ui.work.value?.parentElement?.querySelector<HTMLElement>('[data-pz-more]') ?? null)
    const host = ref<HTMLElement>()
    watch(ui.pageOpen, (v) => {
      if (!v) return
      void nextTick(() => {
        const box = host.value
        if (!box) return
        let shadow = box.shadowRoot
        if (!shadow) {
          const root = (shadow = box.attachShadow({ mode: 'open' }))
          // A link here must not navigate the host page away from unsaved edits: an anchor scrolls the preview, others open a new window.
          root.addEventListener('click', (e) => {
            const a = e.target instanceof Element ? e.target.closest('a[href]') : null
            if (!(a instanceof HTMLAnchorElement)) return
            e.preventDefault()
            const href = a.getAttribute('href') ?? ''
            if (href.startsWith('#')) root.getElementById(href.slice(1))?.scrollIntoView({ block: 'nearest' })
            else window.open(a.href, '_blank', 'noopener')
          })
        }
        const own = editor.canvas?.getRootNode()
        if (own instanceof ShadowRoot) shadow.adoptedStyleSheets = own.adoptedStyleSheets
        const scheme = ui.work.value?.closest('.pz')?.classList
        shadow.innerHTML = ''
        const page = document.createElement('div')
        page.className = `pz pz-page${scheme?.contains('dark') ? ' dark' : scheme?.contains('light') ? ' light' : ''}`
        const content = document.createElement('div')
        content.className = 'pz-content'
        const { html, frames } = editor.previewHTML()
        content.innerHTML = html
        // The renderer calls the raw HTML hook in document order, and each call made one empty .pz-html box.
        content.querySelectorAll('.pz-html').forEach((box, i) => {
          const markup = frames[i]
          if (markup === undefined) return
          const f = document.createElement('iframe')
          f.className = 'pz-html-preview'
          f.setAttribute('sandbox', '')
          f.setAttribute('referrerpolicy', 'no-referrer')
          f.title = t.rawHtmlPreviewTitle
          f.srcdoc = markup
          box.append(f)
        })
        page.append(content)
        shadow.append(page)
      })
    })
    return () => frame(el, onClose, 'pz-page-title', t.previewPage, t.close, ui.pageOpen.value ? [
      h('p', { class: 'hint' }, t.previewHint),
      h('div', { ref: host, class: 'page-host', role: 'document', 'aria-label': t.previewPage }),
    ] : [], true)
  },
})
