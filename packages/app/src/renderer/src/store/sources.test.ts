/**
 * Test suite for mergeSourcesPreservingOrder
 *
 * Coverage:
 * - Preserves existing order of current sources
 * - Updates properties from fresh data
 * - Appends new sources at end
 * - Removes sources not present in fresh
 * - Empty current returns fresh order
 * - Both empty returns empty
 */

import { describe, it, expect } from 'vitest'
import { mergeSourcesPreservingOrder, type SourceInfo } from './sources'

function makeSource(id: number, overrides?: Partial<SourceInfo>): SourceInfo {
  return { id, name: `Source ${id}`, width: 1920, height: 1080, isActive: true, ...overrides }
}

describe('mergeSourcesPreservingOrder', () => {
  // ==================== Order Preservation ====================

  it('should preserve existing order from current when all sources remain', () => {
    // Arrange
    const current = [makeSource(2), makeSource(1)]
    const fresh = [makeSource(1), makeSource(2)]

    // Act
    const result = mergeSourcesPreservingOrder(current, fresh)

    // Assert
    expect(result.map((s) => s.id)).toEqual([2, 1])
  })

  // ==================== Property Updates ====================

  it('should update properties from fresh data', () => {
    // Arrange
    const current = [makeSource(1, { name: 'old', width: 1280, height: 720 })]
    const fresh = [makeSource(1, { name: 'new', width: 1920, height: 1080 })]

    // Act
    const result = mergeSourcesPreservingOrder(current, fresh)

    // Assert
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('new')
    expect(result[0].width).toBe(1920)
    expect(result[0].height).toBe(1080)
  })

  // ==================== New Source Appending ====================

  it('should append new sources at the end', () => {
    // Arrange
    const current = [makeSource(1)]
    const fresh = [makeSource(1), makeSource(2)]

    // Act
    const result = mergeSourcesPreservingOrder(current, fresh)

    // Assert
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe(1)
    expect(result[1].id).toBe(2)
  })

  // ==================== Removal of Stale Sources ====================

  it('should remove sources not present in fresh', () => {
    // Arrange
    const current = [makeSource(1), makeSource(2)]
    const fresh = [makeSource(1)]

    // Act
    const result = mergeSourcesPreservingOrder(current, fresh)

    // Assert
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(1)
  })

  // ==================== Edge Cases ====================

  it('should return fresh order when current is empty', () => {
    // Arrange
    const current: SourceInfo[] = []
    const fresh = [makeSource(1), makeSource(2)]

    // Act
    const result = mergeSourcesPreservingOrder(current, fresh)

    // Assert
    expect(result).toEqual(fresh)
  })

  it('should return empty array when both current and fresh are empty', () => {
    // Arrange
    const current: SourceInfo[] = []
    const fresh: SourceInfo[] = []

    // Act
    const result = mergeSourcesPreservingOrder(current, fresh)

    // Assert
    expect(result).toEqual([])
  })

  // ==================== Insertion Order ====================

  it('should preserve insertion order for multiple new sources', () => {
    const current = [makeSource(1)]
    const fresh = [makeSource(1), makeSource(3), makeSource(2)]
    const result = mergeSourcesPreservingOrder(current, fresh)
    expect(result.map((s) => s.id)).toEqual([1, 3, 2])
  })

  // ==================== Combined Scenario ====================

  it('should handle combined reorder, update, add, and remove', () => {
    // User reordered: [3, 1, 2], backend returns fresh with 2 removed and 4 added
    const current = [
      makeSource(3, { name: 'Old Three' }),
      makeSource(1, { name: 'Old One' }),
      makeSource(2, { name: 'Old Two' }),
    ]
    const fresh = [
      makeSource(1, { name: 'New One' }),
      makeSource(3, { name: 'New Three' }),
      makeSource(4, { name: 'Brand New' }),
    ]
    const result = mergeSourcesPreservingOrder(current, fresh)
    // Order: 3 (kept), 1 (kept), 2 (removed), 4 (new at end)
    expect(result.map((s) => s.id)).toEqual([3, 1, 4])
    expect(result[0].name).toBe('New Three')
    expect(result[1].name).toBe('New One')
    expect(result[2].name).toBe('Brand New')
  })
})
