import { expect, it } from 'vitest'
import { contrastRatio } from './color'

it('contrast ratios follow WCAG 2.2', () => {
  expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5)
  expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
  expect(contrastRatio('#B93E0C', '#FFFFFF')!).toBeGreaterThan(4.5)
  expect(contrastRatio('red', '#fff')).toBeNull()
})
