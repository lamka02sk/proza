/**
 * A demo plugin (`?plugin`): one of each extension point of the plugin API,
 * the target of tests/e2e/plugins.spec.ts.
 */
import { type PropType, defineComponent, h } from 'vue'
import { type DocumentRule, type ProzaPlugin, type WrapperProps, RichTextView, defineBlock, h as html, newBlock } from '../../src/index'
import type { BlockNode } from '../../src/model/tree'

/**
 * A block type from outside the core, written only against the public API
 * (docs/guide/blocks.md): a callout with one text field and a tone.
 */
const CalloutEdit = defineComponent({
  name: 'DemoCallout',
  props: { id: { type: String, required: true }, node: { type: Object as PropType<BlockNode>, required: true }, wrapper: { type: Object as PropType<WrapperProps>, required: true } },
  setup: (p) => () => h('aside', { ...p.wrapper, class: [...p.wrapper.class, 'demo-callout', `demo-callout-${String(p.node.attrs.tone)}`] },
    h(RichTextView, { blockId: p.id, attr: 'content', tag: 'div' })),
})

const callout = defineBlock({
  name: 'demo/callout',
  attrs: { content: { type: 'richtext' }, tone: { type: 'enum', values: ['info', 'warning'] } },
  // Text straight in the element: an element with blocks inside imports as those blocks.
  render: (b, ctx) => html('aside', ctx.wrapper({ class: `demo-callout demo-callout-${b.attrs.tone}` }), ctx.richText(b.attrs.content)),
  fields: [{ attr: 'content' }],
  edit: CalloutEdit,
  title: (_n, s) => s.blockNames['demo/callout'] ?? 'Callout',
  inserter: [{
    id: 'demo/callout', category: 'text', keywords: ['callout', 'note'],
    title: (s) => s.blockNames['demo/callout'] ?? 'Callout',
    drawing: { ink: ['M6 6h84v36H6z'], accent: ['M14 18h50M14 28h36'] },
    create: (ctx) => [newBlock(ctx, 'demo/callout')],
  }],
  parse: [{ selector: 'aside.demo-callout', priority: 90, parse: (el, ctx) => ({ attrs: { content: ctx.richText(el.childNodes), tone: el.classList.contains('demo-callout-warning') ? 'warning' : 'info' } }) }],
})

const WordsPanel = defineComponent({
  name: 'DemoWordsPanel',
  props: { id: { type: String, required: true }, node: { type: Object as PropType<BlockNode>, required: true } },
  setup: (p) => () => {
    const text = (p.node.attrs.content as { text?: string } | undefined)?.text ?? ''
    return h('p', { class: 'hint', 'data-demo-panel': '' }, `Words in this part: ${text.split(/\s+/).filter(Boolean).length}`)
  },
})

/** A house rule: notes left for later ("TODO") must not be published. */
const todo: DocumentRule = (ctx) => ctx.order.flatMap((id) => {
  const text = (ctx.tree.nodes.get(id)?.attrs.content as { text?: string } | undefined)?.text ?? ''
  const at = text.indexOf('TODO')
  return at < 0 ? [] : [{ rule: 'demo/todo', group: 'house', severity: 'error' as const, blockId: id, attr: 'content', start: at, end: at + 4 }]
})

export const demoPlugin: ProzaPlugin = {
  name: 'demo',
  blocks: [callout],
  formats: [{ type: 'smallcaps', tag: 'span', className: 'pz-smallcaps', priority: 60, inclusive: true }],
  toolbar: [
    { id: 'smallcaps', format: 'smallcaps', title: (lang) => (lang === 'sk' ? 'Kapitálky' : 'Small capitals') },
    { id: 'shout', title: () => 'Upper case', run: (target) => { target.clearFormatting() } },
  ],
  commands: [{ name: 'demoSignature', group: 'text', when: 'text', keys: [{ keys: 'Mod+Shift+9' }], run: (host) => host.insertText('— Proza') }],
  inspector: [{ types: ['core/paragraph'], component: WordsPanel }],
  importRules: {
    'core/paragraph': [{ selector: 'div.legacy-note', priority: 80, parse: (el, ctx) => ({ attrs: { content: ctx.richText(el.childNodes), variant: 'note' } }) }],
  },
  checks: [todo],
  locales: {
    en: { blockNames: { 'demo/callout': 'Callout' }, commands: { demoSignature: 'Sign the text' }, checkRules: { 'demo/todo': { title: () => 'A note left for later', hint: 'Finish the text or remove the note.' } }, checkGroups: { house: 'House rules' } },
    sk: { blockNames: { 'demo/callout': 'Upozornenie' }, commands: { demoSignature: 'Podpísať text' }, checkRules: { 'demo/todo': { title: () => 'Poznámka na neskôr', hint: 'Dopíšte text alebo poznámku odstráňte.' } }, checkGroups: { house: 'Pravidlá redakcie' } },
  },
  embeds: [{
    name: 'Example Video',
    player: (url) => {
      const id = url.hostname === 'video.example.com' ? /^\/watch\/(\d{1,9})$/.exec(url.pathname)?.[1] : undefined
      return id ? `https://player.example.com/v/${id}` : null
    },
    src: /^https:\/\/player\.example\.com\/v\/\d{1,9}$/,
    page: (player) => `https://video.example.com/watch/${player.slice(player.lastIndexOf('/') + 1)}`,
  }],
}
