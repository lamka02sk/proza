/**
 * Every core block type, schema and output only: what a server needs to
 * validate and render stored documents.
 */
import { blockRegistry } from '../model/schema'
import type { RenderableBlock, RenderRegistry } from '../render/render'
import { layoutBlocks } from './layout'
import { mediaBlocks } from './media'
import { textBlocks } from './text'
import { table, tableRow, tableCell } from './table'
import { utilityBlocks } from './utility'

export const coreSchemas: readonly RenderableBlock[] = [...textBlocks, ...mediaBlocks, ...layoutBlocks, table, tableRow, tableCell, ...utilityBlocks]

export const coreRegistry: RenderRegistry = blockRegistry(coreSchemas)
