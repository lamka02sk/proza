/**
 * Interface strings of the editor core: announcements, accessible names, help.
 * Locales: `locale-en.ts`, `locale-sk.ts`. The interface
 * adds its own strings on top.
 */
import type { CheckParams } from '../a11y-check'
import type { DomLabels } from '../richtext/dom'

/** One checker rule in words: what is wrong, what to do, and the repair's name when it has one. */
export interface CheckText {
  title(params: CheckParams): string
  readonly hint: string
  readonly fix?: string
}

export interface Strings {
  /** BCP 47 tag of the interface language. */
  readonly lang: string
  /** Accessible name of the editor when the host gives none. */
  readonly editor: string
  /** Validation message of a required editor left empty. */
  readonly required: string
  /** A locked part: it stays in place, or nothing in it changes. */
  readonly lockedMove: string
  readonly lockedEdit: string
  /** Block type names in plain language, by type ("Text", "Heading"). Plugins add theirs. */
  readonly blockNames: Readonly<Record<string, string>>
  heading(level: number): string
  /** Accessible name of a block: its kind, then the start of its text. */
  blockLabel(name: string, text: string): string
  unsupported(type: string): string
  /** Textbox names of fields other than the block's main text. */
  readonly fieldNames: Readonly<Record<string, string>>
  /** Description of a focused block: what the keys do. */
  readonly blockActions: string

  blocksSelected(count: number): string
  removed(count: number): string
  duplicated(count: number): string
  copied(count: number): string
  cut(count: number): string
  /** Text selected from one part on into others. */
  selectedAcross(parts: number): string
  deletedAcross(parts: number): string
  readonly textCopied: string
  readonly textCut: string
  /** Name of the text area while a selection spans parts. */
  readonly acrossLabel: string
  pasted(count: number): string
  moved(position: number, total: number): string
  changedTo(name: string): string
  /** A group's parts took its place. */
  readonly ungrouped: string
  /** Names of transforms (Turn into), by id; plugins add theirs. */
  readonly transformNames: Readonly<Record<string, string>>
  /** Announced after a transform. */
  transformed(name: string): string
  level(level: number): string
  /** Name of a checklist item's box: the start of its text. */
  checkItem(text: string): string
  readonly checked: string
  readonly unchecked: string
  /** In a picture's name when it has no description yet, or is decorative. */
  readonly noDescription: string
  readonly decorativePicture: string
  readonly undone: string
  /** Find and replace: how many matches were replaced. */
  replaced(n: number): string
  readonly redone: string
  readonly nothingToUndo: string
  readonly nothingToRedo: string
  /** Arrow keys stepped into or out of a link or code. */
  entered(format: string): string
  left(format: string): string
  readonly formatNames: Readonly<Record<string, string>>
  /** Table edits and cell selections. */
  readonly table: {
    readonly rowAdded: string
    readonly rowRemoved: string
    readonly columnAdded: string
    readonly columnRemoved: string
    readonly merged: string
    readonly split: string
    readonly headerRowOn: string
    readonly headerRowOff: string
    readonly headerColumnOn: string
    readonly headerColumnOff: string
    cleared(count: number): string
    /** A cell selection of `rows` by `cols` cells. */
    cellsSelected(rows: number, cols: number): string
    /** Where the caret went: "Row 2, column 3". */
    position(row: number, col: number): string
  }

  /** Command titles for keyboard help, by command name. */
  readonly commands: Readonly<Record<string, string>>
  /** Keyboard help groups and the keys that are not commands. */
  readonly help: {
    readonly title: string
    readonly text: string
    readonly blocks: string
    readonly editor: string
    readonly navigation: readonly { readonly keys: string; readonly text: string }[]
  }
  /** Key names in shortcut text (`Ctrl`, `Shift`, arrows). */
  readonly keyNames: Readonly<Record<string, string>>
  /** Names inside fields (footnote markers). */
  readonly dom: DomLabels

  /** The content checker, by rule id; plugins add theirs. */
  readonly checkRules: Readonly<Record<string, CheckText>>
  /** Names of the checker's groups ("Images and media"). */
  readonly checkGroups: Readonly<Record<string, string>>
  /** A rule without words in this language (a plugin's). */
  checkUnknown(rule: string): string
  /** Announced after a repair; Undo takes it back. */
  checkFixed(what: string): string
  /** Saving while errors remain: `a11y.onSave` is `warn`, or `block` (nothing saved). */
  checkOnSave(errors: number): string
  checkBlocked(errors: number): string
}

/** The first words of a text, for accessible names: at most `max` characters, cut at a word. */
export function excerpt(text: string, max = 40): string {
  const flat = text.replace(/￼/g, '').replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}
