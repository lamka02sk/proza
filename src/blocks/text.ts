/**
 * Core text blocks: schema and rendering. Server-safe: no
 * DOM, no Vue. Their editing joins them in `text-edit.ts`.
 */
import { blockRegistry } from '../model/schema'
import { h } from '../render/html'
import type { RenderableBlock, RenderRegistry } from '../render/render'
import { defineSchema as defineBlock } from './define'

const TEXT_SUPPORTS = { anchor: true, textAlign: true, language: true } as const

export const paragraph = defineBlock({
  name: 'core/paragraph',
  attrs: { content: { type: 'richtext' } },
  supports: { ...TEXT_SUPPORTS, size: true, color: true },
  render: (b, ctx) => h('p', ctx.wrapper(), ctx.richText(b.attrs.content)),
})

export const heading = defineBlock({
  name: 'core/heading',
  attrs: {
    content: { type: 'richtext' },
    level: { type: 'enum', values: [1, 2, 3, 4, 5, 6], default: 2 },
  },
  supports: { ...TEXT_SUPPORTS, color: true },
  render: (b, ctx) => h(`h${b.attrs.level}`, ctx.wrapper(), ctx.richText(b.attrs.content)),
  heading: (b) => ({ level: b.attrs.level, text: b.attrs.content.text.replaceAll('\uFFFC', '') }),
})

/** HTML `type` values of `<ol>`, which carry the numbering style without inline CSS. */
const NUMBERING = ['1', 'a', 'A', 'i', 'I'] as const

export const list = defineBlock({
  name: 'core/list',
  attrs: {
    style: { type: 'enum', values: ['bullet', 'number', 'check'] },
    numbering: { type: 'enum', values: NUMBERING },
    start: { type: 'number', integer: true, default: 1 },
    reversed: { type: 'boolean' },
  },
  children: { allowed: ['core/list-item'] },
  supports: { anchor: true, language: true, size: true, color: true },
  render: (b, ctx) => {
    const { style, numbering, start, reversed } = b.attrs
    if (style !== 'number') return h('ul', ctx.wrapper({ class: style === 'check' ? 'pz-checklist' : null }), ctx.children())
    return h('ol', ctx.wrapper({
      start: start === 1 ? null : start,
      reversed,
      type: numbering === '1' ? null : numbering,
    }), ctx.children())
  },
})

export const listItem = defineBlock({
  name: 'core/list-item',
  attrs: {
    content: { type: 'richtext' },
    /** Meaningful in a checklist only. */
    checked: { type: 'boolean' },
  },
  children: { allowed: ['core/list'] },
  parent: ['core/list'],
  supports: { language: true },
  render: (b, ctx) => {
    const check = ctx.parent?.attrs.style === 'check'
    // A disabled checkbox inside a label: screen readers announce the state, and the item text is its name.
    const content = check
      ? h('label', null, h('input', { type: 'checkbox', disabled: true, checked: b.attrs.checked }), ' ', ctx.richText(b.attrs.content))
      : ctx.richText(b.attrs.content)
    return h('li', ctx.wrapper(), content, ctx.children())
  },
})

export const quote = defineBlock({
  name: 'core/quote',
  attrs: { citation: { type: 'richtext' } },
  children: {},
  supports: { anchor: true, language: true, size: true, color: true },
  render: (b, ctx) => {
    if (b.attrs.citation.text === '') return h('blockquote', ctx.wrapper({ class: 'pz-quote' }), ctx.children())
    // Attribution outside the quotation, as the HTML standard recommends.
    return h('figure', ctx.wrapper({ class: 'pz-quote' }),
      h('blockquote', null, ctx.children()),
      h('figcaption', null, ctx.richText(b.attrs.citation)))
  },
})

export const code = defineBlock({
  name: 'core/code',
  attrs: {
    content: { type: 'richtext', formats: [] },
    language: { type: 'string', pattern: /^[a-z0-9][a-z0-9+#.-]*$/i, maxLength: 40 },
  },
  supports: { anchor: true },
  // `language-*` is the class the HTML standard suggests and highlighters read.
  render: (b, ctx) => h('pre', ctx.wrapper({ class: 'pz-code' }),
    h('code', { class: b.attrs.language === '' ? null : `language-${b.attrs.language}` }, ctx.code(b.attrs.content.text, b.attrs.language))),
})

export const preformatted = defineBlock({
  name: 'core/preformatted',
  attrs: { content: { type: 'richtext' } },
  supports: { anchor: true, language: true },
  render: (b, ctx) => {
    const { content } = b.attrs
    // The HTML parser drops one newline right after <pre>; double it so a leading empty line survives.
    return h('pre', ctx.wrapper(), content.text.startsWith('\n') ? '\n' : null, ctx.richText(content, { preformatted: true }))
  },
})

export const separator = defineBlock({
  name: 'core/separator',
  attrs: {},
  supports: { anchor: true },
  render: (_b, ctx) => h('hr', ctx.wrapper()),
})

export const textBlocks: readonly RenderableBlock[] = [paragraph, heading, list, listItem, quote, code, preformatted, separator]

export const textRegistry: RenderRegistry = blockRegistry(textBlocks)
