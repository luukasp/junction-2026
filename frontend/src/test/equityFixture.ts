import type { DemographicCatalog, Observation } from '../data/equity'
import type { SavedEquityBriefing } from '../lib/api'

export function equityObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: 1, program: 'colorectal', year: 2024, metric: 'Attended | %', value: 60,
    table_id: 'colorectal_t012', source_row: 0, source_url: 'https://stats.cancerregistry.fi/joukkistilastot/colorectal.html',
    dimensions: { Education: 'Primary education/unknown', Sex: 'Total' },
    demographics: { education_level: 'Primary education/unknown', gender: 'total', age_group: null, language: null, geographic_location: 'Whole country', geography_level: 'national', area_code: 'SSS' },
    ...overrides,
  }
}

export const equityRows: Observation[] = [
  ['Primary education/unknown', 60, 1000, 600, 40, 30],
  ['Tertiary/higher education', 80, 1500, 1200, 50, 45],
  ['Total', 72, 2500, 1800, 90, 75],
].flatMap(([education, rate, invited, attended, positive, colonoscopy], sourceRow) => {
  const base = equityObservation()
  return [
    ['Attended | %', rate], ['Picked | N', invited], ['Attended | N', attended],
    ['Test positives | N', positive], ['Attended colonoscopy (of test positives) | N', colonoscopy],
  ].map(([metric, value], index) => equityObservation({
    id: sourceRow * 10 + index + 1, metric: String(metric), value: Number(value), source_row: sourceRow,
    dimensions: { Education: String(education), Sex: 'Total' },
    demographics: { ...base.demographics, education_level: String(education) },
  }))
})

export const equityCatalog: DemographicCatalog = {
  programs: ['colorectal'], years: [2023, 2024],
  filters: {
    education_level: { available: true, values: ['Primary education/unknown', 'Tertiary/higher education', 'Total'], description: 'Published education' },
    gender: { available: true, values: ['female', 'male', 'total'], description: 'Published Sex' },
    age_group: { available: true, values: ['60', '62', 'Total'], description: 'Published age' },
    language: { available: true, values: ['Domestic', 'Other/missing', 'Total'], description: 'Published native language' },
    geographic_location: { available: true, values: ['Whole country', 'Central Finland'], description: 'Published location' },
    socioeconomic_status: { available: false, values: [], description: 'Not available' },
  },
  limitations: ['Separate published breakdowns must not be pooled.'],
}

export const savedEquityBriefing: SavedEquityBriefing = {
  id: 1, created_at: '2026-11-14T16:00:00Z', stale: false,
  answer: { summary: 'A cited equity review.', findings: [{ title: 'Check invitation reach', detail: 'Review the source-matched attendance gap.', evidence_ids: ['screening:1'] }], proposals: [], limitations: ['Not risk adjusted.'] },
  evidence: [{ id: 'screening:1', dataset: 'screening', row: { ...equityRows[0] } }],
  model: 'test-model', provider: 'test-provider',
  quality: { imported_at: '2026-11-14T12:00:00Z', screening_mainland_coverage: false, coverage: [], limitations: [] },
}
