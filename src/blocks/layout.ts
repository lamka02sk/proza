/**
 * Core layout blocks: columns, group, buttons,
 * details and spacer. Schema and rendering only: server-safe, no DOM, no Vue.
 * Their editing joins them in `layout-edit.ts`.
 *
 * Columns are a CSS grid from a ratio preset (classes, no inline widths) that
 * stacks below a container width in DOM order, so the reading order holds
 * (WCAG 1.3.2). Each column is a size container of its own, so what is inside
 * responds to the column, not the window (content.css).
 */
import { EMPTY_HTML, h } from '../render/html'
import { defineSchema } from './define'

export const COLUMNS = 'core/columns'
export const COLUMN = 'core/column'
export const GROUP = 'core/group'
export const DETAILS = 'core/details'
export const BUTTONS = 'core/buttons'
export const BUTTON = 'core/button'
export const SPACER = 'core/spacer'

/** Ratio presets: halves, thirds, 2:1, 1:2, quarters. Never free widths. */
export const RATIOS = ['1-1', '1-1-1', '2-1', '1-2', '1-1-1-1'] as const
export type Ratio = (typeof RATIOS)[number]

/** The parts of a ratio: `2-1` is [2, 1]. */
export function ratioParts(ratio: string): number[] {
  return ratio.split('-').map(Number)
}

/** The ratio for a number of equal columns, as imported layouts have them. */
export function ratioFor(count: number): Ratio {
  return count <= 2 ? '1-1' : count === 3 ? '1-1-1' : '1-1-1-1'
}

export const columns = defineSchema({
  name: COLUMNS,
  attrs: { ratio: { type: 'enum', values: RATIOS } },
  children: { allowed: [COLUMN] },
  supports: { anchor: true, bleed: true },
  childShare: (b, index) => {
    const parts = ratioParts(b.attrs.ratio)
    const total = parts.reduce((a, x) => a + x, 0)
    // Columns past the ratio (an imported layout) wrap to a new line of the same grid.
    return { wide: (parts[index % parts.length] ?? 1) / total, narrow: 1 }
  },
  render: (b, ctx) => h('div', ctx.wrapper({ class: `pz-columns pz-layout-${b.attrs.ratio}` }), ctx.children()),
})

export const column = defineSchema({
  name: COLUMN,
  attrs: {},
  parent: [COLUMNS],
  children: {},
  render: (_b, ctx) => h('div', ctx.wrapper({ class: 'pz-column' }), ctx.children()),
})

export const group = defineSchema({
  name: GROUP,
  attrs: {
    /** Plain, a tinted panel, or a ruled box. */
    look: { type: 'enum', values: ['', 'panel', 'line'] },
    /** `section` and `aside` give the group a meaning for assistive technology; `div` gives none. */
    tag: { type: 'enum', values: ['div', 'section', 'aside'] },
  },
  children: {},
  supports: { anchor: true, language: true, bleed: true },
  render: (b, ctx) => h(b.attrs.tag, ctx.wrapper({ class: b.attrs.look === '' ? 'pz-group' : `pz-group pz-look-${b.attrs.look}` }), ctx.children()),
})

export const details = defineSchema({
  name: DETAILS,
  attrs: {
    summary: { type: 'richtext', formats: ['bold', 'italic', 'underline', 'strikethrough', 'code', 'lang', 'abbr', 'kbd', 'subscript', 'superscript', 'color', 'highlight'] },
    /** Shown open when the page loads. */
    open: { type: 'boolean' },
  },
  children: {},
  supports: { anchor: true, language: true },
  render: (b, ctx) => h('details', ctx.wrapper({ class: 'pz-details', open: b.attrs.open }),
    h('summary', null, ctx.richText(b.attrs.summary)),
    h('div', { class: 'pz-details-body' }, ctx.children())),
})

export const buttons = defineSchema({
  name: BUTTONS,
  attrs: {},
  children: { allowed: [BUTTON] },
  supports: { anchor: true, textAlign: true },
  render: (b, ctx) => {
    const any = (b.children ?? []).some((c) => typeof c.attrs.href === 'string' && c.attrs.href !== '')
    return any ? h('div', ctx.wrapper({ class: 'pz-buttons' }), ctx.children()) : EMPTY_HTML
  },
})

export const button = defineSchema({
  name: BUTTON,
  attrs: {
    text: { type: 'richtext', formats: ['bold', 'italic', 'lang'] },
    href: { type: 'url' },
    /** Filled with the accent, or outlined. */
    look: { type: 'enum', values: ['fill', 'line'] },
    newWindow: { type: 'boolean' },
  },
  parent: [BUTTONS],
  supports: { language: true },
  render: (b, ctx) => {
    const a = b.attrs
    // A button that goes nowhere is not published; the editor asks for its address on the part.
    if (a.href === '' || a.text.text.trim() === '') return EMPTY_HTML
    return h('a', ctx.wrapper({ class: `pz-button pz-button-${a.look}`, href: a.href, target: a.newWindow ? '_blank' : null }), ctx.richText(a.text))
  },
})

export const SPACES = ['m', 's', 'l', 'xl'] as const

export const spacer = defineSchema({
  name: SPACER,
  attrs: { height: { type: 'enum', values: SPACES } },
  render: (b, ctx) => h('div', ctx.wrapper({ class: `pz-spacer pz-space-${b.attrs.height}`, 'aria-hidden': 'true' })),
})

export const layoutBlocks = [columns, column, group, details, buttons, button, spacer] as const
