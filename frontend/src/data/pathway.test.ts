import { describe, expect, it } from 'vitest'
import lung from './countyLungTreatment.json'
import bundled from './pathway_snapshot.json'
import { asVerdict, defaultIndicatorId, fallbackHeadline, formatValue, planMarkdown, stageCounts, stageGroups, verdictLabels, type PathwaySnapshot } from './pathway'
import { fixture } from '../test/pathwayFixture'

describe('pathway snapshot helpers', () => {
  it('formats values and simplifies verdicts', () => {
    expect(formatValue(43.14, '%')).toBe('43.1%')
    expect(formatValue(12, 'per_100k')).toBe('12 per 100k')
    expect(formatValue(null, '%')).toBe('—')
    expect(asVerdict('bogus')).toBe('nodata')
    expect(Object.values(verdictLabels)).toEqual(['Act', 'Verify data', 'Monitor', 'In line', 'No data'])
  })

  it('defaults to the lung no-record indicator and counts verdicts per stage', () => {
    expect(defaultIndicatorId(fixture)).toBe('lung_noinfo')
    expect(stageCounts(fixture, 'treatment')).toMatchObject({ act: 1, ok: 1 })
    expect(stageCounts(fixture, 'referral').nodata).toBe(2)
    expect(stageGroups(fixture).map(g => g.indicators.length)).toEqual([1, 0, 1])
  })

  it('builds a plain-English fallback headline from registry counts', () => {
    expect(fallbackHeadline(lung.regions)).toBe('4,049 of 14,774 lung cancer patients (27.4%) have no recorded treatment — 16.4% to 43.1% by county. Click a county for actions.')
  })

  it('exports a self-contained Markdown action plan', () => {
    const markdown = planMarkdown(fixture, fixture.counties[0], new Date('2026-11-15T09:00:00Z'))
    expect(markdown).toContain('# Cancer care action plan — Southwest Finland')
    expect(markdown).toContain('prepared 2026-11-15')
    expect(markdown).toContain('| Treatment | Act |')
    expect(markdown).toContain('| Referral | No data |')
    expect(markdown).toContain('Lung cancer patients without a treatment record: 43.1% (619 of 1,437; 95% CI 40.5% to 45.7%) vs national 26.8%')
    for (const text of ['Baseline: 43.1% without a record', 'Target: At or below 26.8%', 'Annual volume: About 287', '- Pull the unrecorded patient list', 'Escalation: Clinical pathway review', '[Lung quality report](https://example.org/lung)', '- Strategy roadmap 3.2.1']) expect(markdown).toContain(text)
    expect(planMarkdown(fixture, fixture.counties[1])).toContain('No snapshot action is triggered')
  })

  it('bundles a valid offline snapshot for every mapped area', () => {
    const snapshot = bundled as unknown as PathwaySnapshot
    expect(snapshot.national_headline.length).toBeGreaterThan(20)
    expect(snapshot.stages.length).toBeGreaterThan(0)
    expect(snapshot.indicators.length).toBeGreaterThan(0)
    const codes = new Set(snapshot.counties.map(c => c.code))
    for (const region of lung.regions) expect(codes.has(region.regionId), region.regionId).toBe(true)
    for (const county of snapshot.counties) {
      for (const value of Object.values(county.values)) expect(verdictLabels[asVerdict(value.verdict)]).toBeDefined()
      for (const action of county.actions) expect(action.title && action.owner && action.baseline && action.target).toBeTruthy()
    }
  })
})
