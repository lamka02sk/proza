# Block types

A block type is one `BlockDefinition`: what it stores, how it renders, how it is edited, and how imported HTML is recognised as it. The server needs only the first two, so keep them in a module of their own.

## The server-safe half

```ts
// blocks/callout.ts: no DOM, no Vue. Runs in Node through @lamka02sk/proza/render.
import { defineSchema, h } from '@lamka02sk/proza/render'

export const callout = defineSchema({
  name: 'acme/callout',                 // namespace/name; `core/` is Proza's
  attrs: {
    content: { type: 'richtext' },
    tone: { type: 'enum', values: ['info', 'warning'] },
  },
  render: (b, ctx) => h('aside', ctx.wrapper({ class: `acme-callout acme-callout-${b.attrs.tone}` }), ctx.richText(b.attrs.content)),
})
```

**Attributes.** Each has a type, and validation enforces it on load: `string` (`maxLength`, `pattern`), `number` (`min`, `max`, `integer`), `boolean`, `enum` (`values`), `url` (the protocol allow-list), `srcset`, `richtext` (`formats` limits which). The first value or `default` is the default. Every loaded block has every attribute set, so `render` never checks for missing ones.

**Rendering.** Build markup only with `h(tag, attrs, ...children)`. It escapes text and attributes, checks addresses, and throws on a tag or attribute outside the output allow-list: that keeps your block safe to publish and safe for the sanitiser. `ctx.wrapper(extra)` adds the attributes every block shares (anchor, alignment, language, style variant); `ctx.richText(value)` renders a text field; `ctx.children()` renders a container's children.

**Containers.** `children: { allowed: ['core/paragraph'], max: 100 }` makes a container. Children of other types load as placeholders.

**Versions.** When the stored shape must change, raise `version` and give `migrate(attrs, fromVersion)`, which returns the attributes in the current shape. Stored blocks carry their version; old documents always load. A block from a newer version than the code knows loads as a placeholder and is saved back unchanged.

## Editing

```ts
// blocks/callout-edit.ts: the browser half.
import { defineComponent, h, type PropType } from 'vue'
import { defineBlock, newBlock, RichTextView, type BlockNode, type WrapperProps } from '@lamka02sk/proza'
import { callout } from './callout'

const CalloutEdit = defineComponent({
  props: {
    id: { type: String, required: true },
    node: { type: Object as PropType<BlockNode>, required: true },
    wrapper: { type: Object as PropType<WrapperProps>, required: true },
  },
  setup: (p) => () => h('aside', { ...p.wrapper, class: [...p.wrapper.class, 'acme-callout'] },
    h(RichTextView, { blockId: p.id, attr: 'content', tag: 'div' })),
})

export const calloutBlock = defineBlock({
  ...callout,
  fields: [{ attr: 'content' }],
  edit: CalloutEdit,
  title: (_node, strings) => strings.blockNames['acme/callout'] ?? 'Callout',
  inserter: [{
    id: 'acme/callout', category: 'text', keywords: ['callout', 'note'],
    title: (strings) => strings.blockNames['acme/callout'] ?? 'Callout',
    drawing: { ink: ['M6 6h84v36H6z'], accent: ['M14 18h50M14 28h36'] },
    create: (ctx) => [newBlock(ctx, 'acme/callout')],
  }],
  parse: [{ selector: 'aside.acme-callout', parse: (el, ctx) => ({ attrs: { content: ctx.richText(el.childNodes), tone: 'info' } }) }],
})
```

Register it with `createEditor({ blocks: [calloutBlock] })` or in a plugin. A working copy of this block is the playground's demo plugin (`playground/editor/plugin.ts`), tested in `tests/e2e/plugins.spec.ts`.

**The edit component** gets `id`, `node` and `wrapper`. Put `wrapper` on its root element: it carries the block's identity, focus and accessible name. Text goes in a `RichTextView` per field. The field owns its element: put nothing else inside it, and never bind `class` on it. A container renders `h(BlockList, { parent: id })` where its children go.

**Fields** list the block's text attributes in reading order. `optional` fields hide while empty unless the caret is in the block; `multiline` makes Enter add a line break; `after` puts the field after the children (a quote's citation).

**Behaviour** is declared, not coded against the DOM. The `BlockEditing` options cover Enter (`enterCreates`, `carry`, `enterInside`, `exitOnEmptyEnter`), removal (`removeWhenEmpty`, `keepsChild`), edges (`isolating`, `fixed`), nesting (`indent`, `outdent`), and hooks that return a `Change` (`enterEmpty`, `backspaceAtStart`, `blockRule`). A `Change` is operations plus the selection after; the editor applies it as one undo step and announces it. Structural edits are pure: read the tree from the context, return operations, never touch the DOM.

**Options and tools.** `inspector` is a component for the block's rows in the part options; `tools` draws controls beside the part while the caret is in it. Both get `id`; give every control a label.

**Accessibility.** A block is done when it works by keyboard alone, every control has a name, its state changes are announced, and its output passes the checker. `label(node, strings)` names the part; `a11y` adds checker rules for its content (see [plugins](plugins.md#checker-rules)).

## Import

`parse` rules recognise the block in imported and pasted HTML. `selector` picks elements; `parse(el, ctx)` returns stored attributes (and `children` for a container), or `null` to let another rule try. Higher `priority` runs first (Proza's own output uses 100). `ctx.richText(nodes)` reads text with its formats; `ctx.supports(el)` reads the shared attributes. Imported HTML is parsed inert (`DOMParser`); a rule reads it and never puts it in the page. An element with blocks inside imports as those blocks, so render a text block's text straight into its element, as above.

## Presets

Presets limit what the interface offers, never what loads or renders: a document with a block outside the preset still shows and saves it. Add your block's inserter id to a preset's `blocks` to offer it there.
