# Accessibility

Proza aims at WCAG 2.2 AA for the editor and for its default output, and at ATAG 2.0 AA: the tool is accessible (Part A), and it helps authors write accessible content (Part B).

## For authors

- **Keyboard.** Everything works without a pointer. Alt+0 (Ctrl+Option+H on a Mac) lists every shortcut in the author's language. Alt+F10 reaches the formatting bar or the part's tools. Escape leaves a part for select mode, where the arrows move between parts and Alt+Shift+Up/Down move them. Alt+Shift+O opens the outline, Alt+Shift+A the accessibility check.
- **Screen readers.** The editor is a labelled group; each text field is a textbox named by its part ("Heading 2"); parts without text are groups with a name and their actions. Changes are announced: a new part, a move, an undo, an upload, a check result.
- **Prompts while writing.** A picture asks for a description or an explicit "decorative"; a file name is never used as one. Video and audio ask for captions and a transcript. Tables start with a header row. Only readable colours are offered.
- **The checker.** Five groups of rules (media, structure, tables, links, text). Errors are losses a reader cannot get around; warnings are judgement calls. Each finding goes to its place, and repairs that are certain are one undo step.
- **Visual.** 4.5:1 text and 3:1 interface contrast in light and dark, forced colours, reduced motion and right-to-left. At 320 pixels wide (400 % zoom) nothing scrolls sideways and buttons are 44 pixels.

## For hosts

- **Name the editor.** A `<label for>` on the textarea or `<proza-editor>`, or `label` in the options.
- **Decide what saving does.** `a11y.onSave: 'warn'` (default) saves and says how many errors are left; `'block'` keeps a form from submitting while the checker finds errors. `editor.validate()` gives the same problems in words for your own checks.
- **Keep your theme readable.** Custom colours must keep the contrast the defaults have (see [theming](theming.md)).
- **Set the page language.** The editor can mark passages in another language; the page's own `lang` is yours.
- **Do not trap the editor.** It is a form field: no modal around it, no `role="application"` on an ancestor, no keyboard shortcuts on the page that take its keys.

## How it is tested

Every interface state is scanned with axe-core in three engines; keyboard-only flows are end-to-end tests; forced colours, dark mode, right-to-left and 320 pixels are covered. Automated tests cannot cover screen readers, voice control, magnification or switch access. If something does not work with the assistive technology you use, please [open an issue](https://github.com/lamka02sk/proza/issues).
