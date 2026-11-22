# Theming and languages

## The published page

`@lamka02sk/proza/content.css` styles rendered content inside `.pz-content`. Hosts set the layout with custom properties on `.pz-content` or an ancestor:

| Property | Default | What it is |
|---|---|---|
| `--pz-measure` | `100%` | Width of the text column. |
| `--pz-wide` | the measure | Width of wide parts (`alignwide`). Full-width parts span the container. |
| `--pz-space-s`, `--pz-space-m`, `--pz-space-l` | fluid | Heights of the Space part's presets. |
| `--pz-column-gap` | fluid | Gap between columns. |
| `--pz-color-<name>` | | Text colour of the palette entry `<name>` (see below). |
| `--pz-tok-<type>` | | Code highlighting: `keyword`, `string`, `number`, `comment`, `literal`, `tag`, `attr`, `property`, `variable`, `function`, `meta`. |

`.pz-content` is a size container, so columns and tables respond to the column they sit in, not to the window. Pass the same widths to `render()` (`measure`) so pictures get the right `sizes`.

## The editor

The editor's colours are custom properties on its host element; they pass into the shadow root:

```css
#content {
  --pz-accent: #0B5FFF;      /* buttons, selection, focus */
  --pz-accent-text: #0848BF; /* accent as text: keep 4.5:1 on --pz-page */
  --pz-page: #FFFFFF;        /* the writing surface */
  --pz-ink: #121214;         /* text */
}
```

Also `--pz-desk`, `--pz-panel`, `--pz-ink-2`, `--pz-line`, `--pz-edge`, `--pz-hover`, `--pz-accent-hi`, `--pz-accent-deep`, `--pz-wash`, `--pz-on`, `--pz-on-ink`, `--pz-on-hover`, `--pz-blue`, `--pz-danger`, `--pz-shadow`. Check the contrast of your values: the defaults meet WCAG 2.2 AA, yours must too. `colorScheme: 'dark'` (or `auto` on a dark system) switches to the built-in dark set. To theme dark mode yourself, set your dark values on the host element under your own dark-mode rule (`@media (prefers-color-scheme: dark)`, or the class your site switches). Forced colours (Windows high contrast) use system colours and ignore these.

## Text colours

```ts
createEditor({
  target: '#content',
  theme: {
    palette: [
      { name: 'brand', label: 'Brand', color: '#B93E0C', dark: '#FF9A6B' },
      { name: 'muted', label: 'Muted', color: '#4B4C56', dark: '#B5B6C0' },
    ],
  },
})
```

Authors pick colours by name; the document stores the name (`pz-color-brand`), never a value, so a redesign changes every page. Colours below 4.5:1 against the light page (`color`) or the dark page (`dark`, or `color` when it has none) are not offered, and the checker flags text that ends up unreadable. Style `.pz-color-<name>` on the published page to match.

## Style variants

```ts
theme: {
  styles: { 'core/paragraph': [{ name: 'lead', label: 'Lead' }], 'core/group': [{ name: 'callout', label: 'Callout' }] },
  css: '.pz-style-lead { font-size: 1.2em } .pz-style-callout { padding: 12px; background: #FFF0E8 }',
}
```

A variant is a class, `pz-style-<name>`, offered as Style in the part's options (TinyMCE's `importcss`). `css` goes into the editor as a constructed stylesheet, so the canvas shows what the page will.

## Languages

The interface ships English (`en`) and Slovak (`sk`). Pass `locale: 'sk'`, or a full `Locale` for another language: start from the exported `locales.en` and translate every string; TypeScript lists what is missing. Plugins add their own strings per language (see [plugins](plugins.md)).

The interface follows the locale's direction; `dir: 'rtl'` sets it. Each text field takes its direction from its first strong character, and authors can mark the language of a passage.
