/**
 * Interface strings: labels, tips, menus and dialogs of
 * the editor's chrome, on top of the core strings (`src/editor/strings.ts`).
 * Plain language first; technical names are search keywords only.
 * Locales: `locale-en.ts`, `locale-sk.ts`.
 */

import type { ImportOrigin } from '../editor/editor'
import type { ImportSource, ReportCode, Severity } from '../import/report'

export interface UiStrings {
  /** Direction of the interface language. */
  readonly dir: 'ltr' | 'rtl'

  // Empty field
  readonly placeholder: string
  /** On an empty line that is not the only one. */
  readonly emptyLine: string
  readonly headingPlaceholder: string
  readonly startWith: string
  readonly starters: Readonly<Record<string, string>>

  // Part tools (gutter)
  readonly partTools: string
  readonly partSettings: string
  readonly partSettingsTitle: string
  readonly partHandle: string
  readonly partHandleTitle: string
  readonly addBelow: string
  readonly addBelowTitle: string
  readonly addSomething: string

  // Add menu
  readonly addMenu: string
  readonly addMenuEnd: string
  readonly search: string
  readonly searchPlaceholder: string
  readonly results: (n: number) => string
  readonly noResults: string
  readonly recent: string
  readonly patterns: string
  readonly categories: Readonly<Record<string, string>>
  /** Where the new part lands, under the tiles. */
  readonly addsBelow: (name: string) => string
  readonly addsAtEnd: string
  readonly replacesLine: string
  /** Search words for each inserter item, besides its title (its technical name is always one). */
  readonly keywords: Readonly<Record<string, string>>
  readonly added: (name: string) => string

  // Part options (inspector)
  readonly partOptions: string
  readonly showAs: string
  readonly showAsNames: { readonly text: string; readonly heading: string; readonly list: string; readonly quote: string }
  readonly level: string
  readonly levelName: (n: number) => string
  /** Under the level row: the heading before, and a warning on levels that skip one (ATAG B.2). */
  readonly headingBefore: (level: number, text: string) => string
  readonly noHeadingBefore: string
  readonly skipsLevel: (from: number, to: number) => string
  /** Description of a level button that would skip one. */
  readonly skipsLevelNote: string
  readonly listStyle: string
  readonly listStyles: { readonly bullet: string; readonly number: string; readonly check: string }
  readonly numbering: string
  readonly numberingNames: Readonly<Record<string, string>>
  readonly startAt: string
  readonly reversed: string
  readonly codeLanguage: string
  readonly codeLanguageHint: string
  readonly align: string
  readonly alignNames: { readonly start: string; readonly center: string; readonly end: string; readonly justify: string }
  readonly more: string
  readonly anchor: string
  readonly anchorHint: string
  readonly anchorInvalid: string
  readonly language: string
  readonly languageHint: string
  readonly languageInvalid: string
  readonly direction: string
  readonly directionNames: { readonly auto: string; readonly ltr: string; readonly rtl: string }
  readonly size: string
  readonly sizeNames: { readonly s: string; readonly normal: string; readonly l: string }
  readonly color: string
  readonly colorDefault: string
  /** Names of the default palette's colours. */
  readonly colorNames: { readonly grey: string; readonly orange: string; readonly blue: string }
  readonly moveUp: string
  readonly moveDown: string
  readonly duplicate: string
  readonly remove: string

  // Bubble and format bar
  readonly formatBar: string
  readonly bold: string
  readonly italic: string
  readonly link: string
  readonly moreFormats: string
  readonly formats: Readonly<Record<string, string>>
  readonly clearFormatting: string
  readonly linkAddress: string
  readonly linkPlaceholder: string
  readonly addLink: string
  readonly saveLink: string
  readonly removeLink: string
  readonly cancel: string
  readonly linkInvalid: string
  /** The link field searches pages (the host's `links`) and the parts with an anchor. */
  readonly linkSuggestions: string
  readonly linkSearchPlaceholder: string
  readonly linkSearching: string
  readonly linkResults: (n: number) => string
  readonly linkNoResults: string
  readonly linkAnchor: string
  readonly newWindow: string
  readonly newWindowHint: string

  // Status line
  readonly editorTools: string
  readonly undo: string
  readonly redo: string
  readonly outline: string
  readonly outlineTitle: string
  /** Device preview (`preview`). */
  readonly preview: string
  readonly previewTitle: string
  readonly previewNone: string
  readonly devices: { readonly tablet: string; readonly phone: string }
  previewOn(device: string, px: number): string
  readonly previewOff: string
  readonly source: string
  readonly sourceTitle: string
  readonly expand: string
  readonly expandTitle: string
  readonly collapse: string
  readonly help: string
  readonly nothingSelected: string
  readonly nothingSelectedTip: string
  /** Bold name and hint for the part with the caret, by block type. */
  readonly tips: Readonly<Record<string, string>>
  readonly tipDefault: string
  readonly blocksSelectedTip: string
  readonly cellsSelectedTip: string
  readonly acrossTip: string
  /** A column's name in its columns: "Column 2 of 3". */
  columnOf(n: number, total: number): string
  /** Rows of the part options for a part wider than the column. */
  readonly bleed: string
  readonly bleedNames: { readonly none: string; readonly wide: string; readonly full: string }
  readonly bleedHint: string
  /** The path from a framing part (columns) to the part the options act on. */
  readonly optionsPath: string
  readonly table: {
    readonly tools: string
    readonly row: string
    readonly column: string
    readonly rowAbove: string
    readonly rowBelow: string
    readonly removeRow: string
    readonly columnLeft: string
    readonly columnRight: string
    readonly removeColumn: string
    alignColumn(align: string): string
    alignedColumn(align: string): string
    readonly merge: string
    readonly split: string
    readonly addRow: string
    readonly addColumn: string
    readonly captionPlaceholder: string
    readonly headerRow: string
    readonly headerRowHint: string
    readonly headerColumn: string
    readonly narrow: string
    readonly scroll: string
    readonly stack: string
    readonly scrollHint: string
    readonly stackHint: string
    readonly stackMerged: string
  }
  readonly layout: {
    readonly ratio: string
    readonly ratios: Readonly<Record<'1-1' | '1-1-1' | '2-1' | '1-2' | '1-1-1-1', string>>
    readonly ratioHint: string
    readonly look: string
    readonly looks: { readonly plain: string; readonly panel: string; readonly line: string }
    readonly meaning: string
    readonly meanings: { readonly div: string; readonly section: string; readonly aside: string }
    readonly meaningHint: string
    readonly ungroup: string
    readonly detailsBody: string
    readonly openOnLoad: string
    readonly openOnLoadHint: string
    readonly addButton: string
    readonly buttonPlaceholder: string
    readonly needsLink: string
    readonly buttonLink: string
    readonly buttonLinkHint: string
    readonly buttonLinkInvalid: string
    readonly buttonNeedsText: string
    readonly linkSet: string
    readonly buttonLook: string
    readonly buttonLooks: { readonly fill: string; readonly line: string }
    readonly height: string
    readonly heights: Readonly<Record<'s' | 'm' | 'l' | 'xl', string>>
  }

  // Help
  readonly helpTitle: string
  readonly helpPoints: readonly string[]
  readonly allShortcuts: string
  readonly close: string

  // Outline (list view)
  readonly outlineHint: string
  readonly outlineEmpty: string
  // The accessibility checker
  readonly check: string
  /** The status line button's name with the number of problems as digits, as its badge shows it (WCAG 2.5.3); 0: none found. */
  checkCount(n: number): string
  checkSummary(errors: number, warnings: number): string
  /** Announced when the panel opens. */
  checkFound(n: number): string
  readonly checkHint: string
  readonly checkNone: string
  readonly checkNoneHint: string
  readonly checkGoTo: string
  /** Before a problem's words for screen readers, and as its mark's title. */
  readonly checkError: string
  readonly checkWarning: string
  /** The status line's button after a save that found problems. */
  readonly checkShow: string
  readonly rowActions: (name: string) => string
  readonly moveTo: string
  readonly moving: (name: string) => string
  readonly moveHere: string
  readonly toStart: string
  readonly cannotMoveHere: string
  readonly movingCancelled: string

  // Source view
  readonly sourceJson: string
  readonly sourceJsonHint: string
  readonly sourceHtml: string
  readonly sourceHtmlHint: string
  readonly apply: string
  readonly copy: string
  readonly copied: string
  readonly sourceApplied: string
  readonly sourceInvalid: (message: string) => string
  readonly sourceRepaired: (n: number) => string

  readonly unsupportedHint: string

  // Import
  /** The starter that reads a Word file. */
  readonly fromWord: string
  readonly applyHtml: string
  readonly reading: (name: string) => string
  readonly unreadable: (name: string) => string
  /** What a paste, a load or a file brought in, and how much changed: the status line's words. */
  readonly imported: (origin: ImportOrigin, source: string, changes: number) => string
  /** Opens the report from the status line. */
  readonly importDetails: string
  /** The report dialog's title and the status line button. */
  readonly importReport: string
  readonly importSummary: (origin: ImportOrigin, source: string, lost: number, changed: number) => string
  /** Where content came from, in plain words ("Word", "a web page"). */
  readonly importSources: Readonly<Record<ImportSource, string>>
  readonly importGroups: Readonly<Record<Severity, string>>
  /** One line per kind of change; `samples` lists examples ("Arial, Calibri") or is empty. */
  readonly importEntries: Readonly<Record<ReportCode, (count: number, samples: string) => string>>
  readonly importKeep: string

  // Media
  /** Per kind of file: the empty part's words, the announcement, the part options. */
  readonly media: Readonly<Record<'image' | 'video' | 'audio' | 'captions' | 'file', {
    readonly drop: string
    readonly noUpload: string
    readonly choose: string
    readonly address: string
    readonly added: string
    readonly empty: string
    readonly replace: string
  }>>
  readonly useAddress: string
  readonly addressPlaceholder: string
  readonly addAddress: string
  readonly addressInvalid: string
  readonly uploading: (name: string) => string
  readonly uploaded: (name: string) => string
  readonly uploadFailed: (name: string) => string
  readonly uploadCancelled: string
  /** The host's attachment manager (`hooks.requestAttachment`). */
  readonly fromLibrary: string
  /** The device's file chooser, beside the library. */
  readonly fromDevice: string
  readonly attachmentInvalid: string
  readonly attachmentStale: string
  readonly attachmentFailed: string
  readonly wrongType: Readonly<Record<'image' | 'video' | 'audio' | 'captions' | 'file', string>>
  readonly tryAgain: string
  readonly captionPlaceholder: string
  readonly transcriptPlaceholder: string
  readonly captions: string
  readonly needsDescription: string
  readonly needsCaptions: string
  readonly needsTranscript: string
  readonly needsTitle: string
  readonly width: string
  readonly pictureWidth: string
  readonly widthNames: { readonly s: string; readonly m: string; readonly l: string }
  readonly description: string
  readonly descriptionOf: (n: number, total: number) => string
  readonly descriptionHint: string
  readonly descriptionPlaceholder: string
  readonly described: string
  readonly decorative: string
  readonly decorativeHint: string
  readonly linkTo: string
  readonly linkToHint: string
  readonly columns: string
  readonly captionsNote: string
  readonly captionsFile: string
  readonly captionsHint: string
  readonly uploadCaptions: string
  readonly captionsLanguage: string
  readonly poster: string
  readonly posterHint: string
  readonly transcriptNote: string
  readonly embedAddress: string
  /** `names`: the providers allowed, joined ("YouTube or Vimeo"). */
  readonly embedProviders: (names: string) => string
  readonly embedUnsupported: (names: string) => string
  /** "A, B or C" in the interface language. */
  readonly either: (names: readonly string[]) => string
  readonly embedTitle: string
  readonly embedTitleHint: string
  readonly embedTitlePlaceholder: string
  readonly embedSubmit: string
  readonly embedAdded: string
  readonly embedUntitled: string
  readonly embedPreview: (provider: string) => string
  readonly shape: string
  readonly ratioNames: Readonly<Record<'16-9' | '4-3' | '1-1' | '9-16', string>>
  readonly facade: string
  readonly facadeHint: string
  readonly fileName: string
  readonly fileNameHint: string
  readonly fileAddress: string
  // Draft recovery (TinyMCE `autosave`)
  /** `when` is a time today, or a date and time. */
  readonly draftFound: (when: string) => string
  readonly draftRestore: string
  readonly draftDiscard: string
  readonly draftRestored: string
  readonly draftDiscarded: string
  /** The tip in read-only mode. */
  readonly readOnly: string
  readonly readOnlyTip: string
  // More tools
  readonly moreTools: string
  readonly findReplace: string
  readonly insertCharacter: string
  readonly insertDate: string
  readonly nonBreakingSpace: string
  readonly showInvisibles: string
  readonly showOutlines: string
  readonly toggled: (name: string, on: boolean) => string
  readonly wordCount: string
  readonly previewPage: string
  // Find and replace
  readonly find: string
  readonly replaceWith: string
  readonly matchCase: string
  readonly wholeWords: string
  readonly previousMatch: string
  readonly nextMatch: string
  readonly replaceOne: string
  readonly replaceAll: string
  readonly closeFind: string
  readonly matchOf: (i: number, n: number) => string
  readonly noMatches: string
  // Counts
  readonly countsDocument: string
  readonly countsSelection: string
  readonly countWords: string
  readonly countCharacters: string
  readonly countNoSpaces: string
  readonly countParts: string
  // Characters and emoji
  readonly charactersTitle: string
  readonly characterSearch: string
  readonly characterKinds: { readonly characters: string; readonly emoji: string }
  readonly characterGroups: Readonly<Record<string, string>>
  readonly characterInserted: (name: string) => string
  readonly charactersLoading: string
  // Rendered preview
  readonly previewHint: string
  // Utility parts
  readonly pageBreakLabel: string
  readonly tocEmpty: string
  readonly tocDepth: string
  readonly tocDepthSet: (level: number) => string
  readonly rawHtmlCode: string
  readonly rawHtmlPreview: string
  readonly rawHtmlPreviewTitle: string
  readonly rawHtmlSaved: string
  readonly rawHtmlOff: string
  // Styles and locks
  readonly style: string
  readonly styleDefault: string
  readonly styleSet: (name: string) => string
  readonly lock: string
  readonly lockNames: { readonly none: string; readonly move: string; readonly all: string }
  readonly lockHint: string
  readonly lockSet: (name: string) => string
  readonly lockedInPlace: string
  readonly lockedAll: string
  readonly turnInto: string
}
