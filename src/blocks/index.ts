/**
 * The standard block library: every core block type as
 * the editor takes it. Servers render with `coreRegistry`
 * (`core.ts`), which needs no Vue.
 */
import type { BlockDefinition } from '../editor/editing'
import { mediaBlockDefinitions } from './media-edit'
import { textBlockDefinitions } from './text-edit'
import { layoutBlockDefinitions } from './layout-edit'
import { tableBlockDefinitions } from './table-edit'
import { utilityBlockDefinitions } from './utility-edit'

export const coreBlocks: readonly BlockDefinition[] = [...textBlockDefinitions, ...mediaBlockDefinitions, ...layoutBlockDefinitions, ...tableBlockDefinitions, ...utilityBlockDefinitions]

export { coreRegistry, coreSchemas } from './core'
export { type PresetName, presets } from './presets'
export { textCommands } from './text-behaviour'
export { tableCommands } from './table-behaviour'
