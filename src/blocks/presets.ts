/**
 * Presets: what the interface offers.
 * A host picks one and may adjust it: `{ ...presets.basic, blocks: [...presets.basic.blocks, 'core/quote'] }`.
 * A preset never stops content from loading or rendering; it only decides
 * what can be added (inserter, `/`, Show as, input rules, formats).
 */
import type { Preset } from '../editor/editing'
import { defaultFormats } from '../model/richtext'

export type PresetName = 'basic' | 'standard' | 'full'

const basicBlocks = ['core/paragraph', 'core/heading', 'core/list', 'core/list/number', 'core/image']
const basicFormats = ['bold', 'italic', 'link']
const standardBlocks = [...basicBlocks, 'core/list/check', 'core/quote', 'core/separator', 'core/gallery', 'core/video', 'core/audio', 'core/embed', 'core/file']
const standardFormats = [...basicFormats, 'underline', 'strikethrough', 'superscript', 'subscript', 'code']

export const presets: Readonly<Record<PresetName, Preset>> = {
  /** Text, headings, lists, links and pictures. */
  basic: { blocks: basicBlocks, formats: basicFormats },
  /** Adds quotes, checklists, dividers, media, embeds and files. */
  standard: { blocks: standardBlocks, formats: standardFormats },
  /** Everything installed, code and preformatted text included. */
  full: { blocks: [...standardBlocks, 'core/code', 'core/preformatted'], formats: [...defaultFormats.keys()] },
}
