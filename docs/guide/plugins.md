# Plugins

A plugin is one object with the parts it adds. Pass it in `createEditor({ plugins: [myPlugin] })`. Every extension point below is used by the playground's demo plugin (`playground/editor/plugin.ts`) and tested in `tests/e2e/plugins.spec.ts`.

```ts
import type { ProzaPlugin } from '@lamka02sk/proza'

export const myPlugin: ProzaPlugin = {
  name: 'acme',
  blocks: [calloutBlock],            // block types (see blocks.md)
  formats: [smallCaps],              // inline formats
  commands: [signature],             // commands with shortcuts
  toolbar: [smallCapsButton],        // buttons in the format bar's More menu
  inspector: [wordsPanel],           // rows in the part options
  importRules: { 'core/paragraph': [legacyNote] },  // more parse rules for existing types
  checks: [noTodo],                  // checker rules over the whole document
  embeds: [exampleVideo],            // embed providers
  locales: { en: { /* strings */ }, sk: { /* strings */ } },
  setup(editor) { /* after mount */ return () => { /* on destroy */ } },
}
```

## Inline formats

```ts
const smallCaps: FormatSpec = { type: 'smallcaps', tag: 'span', className: 'pz-smallcaps', priority: 60, inclusive: true }
```

The tag must be one the output allows; registering a format whose tag is not is an error at creation, as is a type registered twice. `priority` fixes nesting (lower renders further out), so one value always has one HTML string. `inclusive`: typing at the end of the range extends it. `attrs` declares attributes with rules (a URL, a preset from a list); values that fail their rule never reach the document. Formats come from the model: the editor never reads formatting back from the browser's markup.

## Commands

```ts
const signature: Command = {
  name: 'acmeSignature', group: 'text', when: 'text',
  keys: [{ keys: 'Mod+Shift+9' }],
  run: (host) => host.insertText('— Acme'),
}
```

`Mod` is Ctrl, or Cmd on Apple platforms. Do not bind Ctrl+Alt outside Apple platforms: it is AltGr on Windows keyboards. Hosts can rebind or switch off any command's keys (`keys` option, WCAG 2.1.4). The command's name in `locales.<lang>.commands` puts it in keyboard help. `run` gets a `CommandHost`: the selection, `context()` for structural edits, `apply(change)` to commit one undo step, `insertText`, `undo`, `redo`, `save`.

## Format bar buttons

```ts
const smallCapsButton: ToolbarItem = { id: 'smallcaps', format: 'smallcaps', title: (lang) => (lang === 'sk' ? 'Kapitálky' : 'Small capitals') }
```

With `format`, the button toggles that format. With `run(target, editor)`, it acts on the selected text (`target` is the field, or text across parts).

## Part options

```ts
const wordsPanel: InspectorPanel = { types: ['core/paragraph'], component: WordsPanel }
```

The component gets `id` and `node`. Label every control; announce what changes.

## Import rules

`importRules` adds parse rules to block types that already exist, by type. See [block types](blocks.md#import) for how a rule reads an element.

## Checker rules

```ts
const noTodo: DocumentRule = (ctx) => ctx.order.flatMap((id) => {
  const text = (ctx.tree.nodes.get(id)?.attrs.content as { text?: string } | undefined)?.text ?? ''
  const at = text.indexOf('TODO')
  return at < 0 ? [] : [{ rule: 'acme/todo', group: 'house', severity: 'error', blockId: id, attr: 'content', start: at, end: at + 4 }]
})
```

A rule reads the tree and returns findings: an `error` counts toward `a11y.onSave: 'block'`, a `warning` never blocks. `attr`, `start` and `end` mark the text in the editor. `fix` (operations on the tree the finding came from) makes it repairable in one undo step. Give each rule its words in `locales.<lang>.checkRules[rule]` (`title`, `hint`) and name a new group in `checkGroups`. A block type's own rules go on its definition (`a11y`).

## Embed providers

```ts
const exampleVideo: EmbedProvider = {
  name: 'Example Video',
  player: (url) => { /* page address → player address, or null */ },
  src: /^https:\/\/player\.example\.com\/v\/\d{1,9}$/,   // anchored: what the frame may load
  page: (player) => `https://video.example.com/watch/${player.slice(player.lastIndexOf('/') + 1)}`,
}
```

There are no arbitrary frames: `h()` refuses a frame whose address no provider's `src` matches. Build the player address from parts you checked (an id that matches a pattern), never by copying the page address. On a server, register the same providers before rendering (`registerEmbedProvider` from `@lamka02sk/proza/render`), and add the player's origin to the published page's `frame-src`.

## Strings

`locales` holds strings per language, merged over the editor's: any top-level string, or entries of a record (`blockNames`, `commands`, `checkRules`, `checkGroups`, `ui.tips`). The editor takes the plugin's strings for its language, or the plugin's English.

## Reference

Every type the plugin API uses is in [the public API report](../api/report.md).
