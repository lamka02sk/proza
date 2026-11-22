import { describe, expect, it } from 'vitest'
import { coreRegistry } from '../../src/blocks/core'
import { render, renderLabels } from '../../src/render/render'

const table = { version: 1, blocks: [{ type: 'core/table', attrs: {}, children: [{ type: 'core/table-row', attrs: {}, children: [{ type: 'core/table-cell', attrs: {}, children: [] }] }] }] }

describe('words of the published page', () => {
  it('follow the content language, by its primary tag', () => {
    expect(render(table, coreRegistry, { labels: renderLabels('sk-SK') })).toContain('aria-label="Tabuľka"')
    expect(render(table, coreRegistry, { labels: renderLabels('ja') })).toContain('aria-label="Table"')
    expect(renderLabels('sk').fileMeta('PDF', 1_200_000)).toBe('PDF, 1,2 MB')
  })
})
