import { afterEach, describe, expect, it, vi } from 'vitest'
import { equityObservation, equityRows } from '../test/equityFixture'
import { buildComparison, defaultFilters, evidenceRows, funnelStages, loadObservations, numeric, observationQuery } from './equity'

afterEach(() => vi.unstubAllGlobals())

describe('equity evidence', () => {
  it('compares published subgroups without counting the total as another population', () => {
    const comparison = buildComparison(equityRows, 'education_level', defaultFilters)
    expect(comparison.groups.map(group => group.label)).toEqual(['Primary education/unknown', 'Tertiary/higher education'])
    expect(comparison.gap).toBe(20)
    expect(comparison.average).toBe(70)
    expect(comparison.availableGroups).toBe(2)
    expect(comparison.reference?.rate.value).toBe(72)
    expect(comparison.lowest?.attended?.value).toBe(600)
    expect(comparison.lowest?.invited?.value).toBe(1000)
    expect(evidenceRows(comparison.groups, comparison.reference, comparison.lowest)).toHaveLength(11)
  })

  it('keeps published zero distinct from suppressed and missing values', () => {
    const rows = structuredClone(equityRows)
    rows[0].value = 0
    rows[5].value = null
    const comparison = buildComparison(rows, 'education_level', defaultFilters)
    expect(comparison.lowest?.rate.value).toBe(0)
    expect(comparison.groups).toHaveLength(2)
    expect(comparison.gap).toBeNull()
    expect(comparison.average).toBe(0)
    expect(buildComparison([], 'education_level', defaultFilters).average).toBeNull()
    expect(numeric(undefined)).toBeNull()
    expect(numeric(equityObservation({ value: NaN }))).toBeNull()
    expect(funnelStages(comparison.lowest!)[4].row).toBeUndefined()
  })

  it('never mixes source tables, sex-specific breakdowns or unrelated dimensions', () => {
    const noise = equityRows.slice(0, 5).map(row => ({ ...row, id: row.id + 100, table_id: 'another_table', value: 99 }))
    const men = equityRows.map(row => ({ ...row, id: row.id + 200, dimensions: { ...row.dimensions, Sex: 'Men' }, demographics: { ...row.demographics, gender: 'male' } }))
    const previous = equityRows.map(row => ({ ...row, id: row.id + 300, dimensions: { ...row.dimensions, 'Previous result': 'Negative' } }))
    const comparison = buildComparison([...noise, ...men, ...previous, ...equityRows], 'education_level', defaultFilters)
    expect(comparison.gap).toBe(20)
    expect(comparison.groups.every(group => group.rows.every(row => row.table_id === 'colorectal_t012' && row.dimensions.Sex === 'Total' && !row.dimensions['Previous result']))).toBe(true)
  })

  it('sends every global filter and compares counties at one geographic level', () => {
    const query = observationQuery('colorectal', 2024, { ...defaultFilters, gender: 'male', age_group: '60', language: 'Other/missing' }, 'geographic_location')
    expect(Object.fromEntries(query)).toEqual({ program: 'colorectal', year: '2024', gender: 'male', age_group: '60', language: 'Other/missing', geography_level: 'county' })
  })

  it('reads every page instead of silently truncating the comparison', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ items: equityRows.slice(0, 5), total: 15 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: equityRows.slice(5), total: 15 }) })
    vi.stubGlobal('fetch', fetchMock)
    const rows = await loadObservations(new URLSearchParams({ program: 'colorectal' }), new AbortController().signal)
    expect(rows).toHaveLength(15)
    expect(fetchMock.mock.calls[1][0]).toContain('offset=5')
  })
})
