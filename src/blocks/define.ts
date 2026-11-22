/**
 * Defining a block type. Types only, so a
 * server-safe schema module can use `defineSchema` without pulling in Vue.
 */
import type { BlockDefinition } from '../editor/editing'
import type { AttrSpecs } from '../model/schema'
import type { RenderableBlock } from '../render/render'

/** The server-safe half: schema and output. Attribute types flow from `attrs` into `render`. */
export function defineSchema<const A extends AttrSpecs>(def: RenderableBlock<A>): RenderableBlock<A> {
  return def
}

/** A whole block type: schema, output and editing, as `createEditor({ blocks })` takes it. */
export function defineBlock<const A extends AttrSpecs>(def: BlockDefinition<A>): BlockDefinition {
  return def
}
