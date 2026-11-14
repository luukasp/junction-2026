import { api } from '../lib/api'

export type Program = 'breast' | 'cervix' | 'colorectal'
export type Dimension = 'education_level' | 'language' | 'age_group' | 'gender' | 'geographic_location'
export type CohortFilters = Record<Dimension, string>
export type EquitySelection = { program: Program; year: string; filters: CohortFilters; dimension: Dimension; selectedLabel: string }
export type EquityBriefingInput = { key: string; label: string; selection: EquitySelection; body: { observation_ids: number[]; question: string } }
export type FilterOptions = { available: boolean; values: string[]; description: string }
export type DemographicCatalog = { programs: Program[]; years: number[]; filters: Record<string, FilterOptions>; limitations: string[] }
export type Observation = {
  id: number; program: Program; year: number; metric: string; value: number | null
  table_id: string; source_row: number; source_url: string; dimensions: Record<string, string>
  demographics: Record<Dimension, string | null> & { geography_level: string; area_code: string | null }
}
export type ObservationPage = { items: Observation[]; total: number; limit: number; offset: number }
export type EquityGroup = { label: string; rate: Observation; attended?: Observation; invited?: Observation; rows: Observation[] }
export type FunnelStage = { label: string; metric: string; row?: Observation }

export const programs: Record<Program, string> = { colorectal: 'Colorectal', breast: 'Breast', cervix: 'Cervical' }
export const dimensions: Record<Dimension, string> = {
  education_level: 'Education', language: 'Native language', age_group: 'Age group', gender: 'Published sex', geographic_location: 'Geography',
}
export const defaultFilters: CohortFilters = { education_level: '', language: '', age_group: '', gender: '', geographic_location: 'Whole country' }
export const defaultEquitySelection: EquitySelection = { program: 'colorectal', year: '', filters: defaultFilters, dimension: 'education_level', selectedLabel: '' }
const sourceDimensions: Record<Dimension, string> = {
  education_level: 'Education', language: 'Native language', age_group: 'Age group', gender: 'Sex', geographic_location: 'Wellbeing service county',
}
const total = (value: string | null) => value?.toLowerCase() === 'total'
export const numeric = (row?: Observation): number | null => row?.value != null && Number.isFinite(row.value) ? row.value : null
export const number = (value: number | null) => value === null ? 'Unavailable' : value.toLocaleString('en-GB', { maximumFractionDigits: 0 })
export const percentage = (value: number | null) => value === null ? 'Unavailable' : `${value.toFixed(1)}%`
export const groupLabel = (value: string) => ({ male: 'Men', female: 'Women', total: 'Published total' })[value] ?? value

export function observationQuery(program: Program, year: number, filters: CohortFilters, dimension: Dimension) {
  const params = new URLSearchParams({ program, year: String(year) })
  for (const [key, value] of Object.entries(filters)) {
    if (value && !(dimension === 'geographic_location' && key === 'geographic_location' && value === 'Whole country')) params.set(key, value)
  }
  if (dimension === 'geographic_location') params.set('geography_level', 'county')
  return params
}

export async function loadObservations(params: URLSearchParams, signal: AbortSignal): Promise<Observation[]> {
  const items: Observation[] = []
  let offset = 0
  for (;;) {
    const query = new URLSearchParams(params)
    query.set('limit', '1000')
    query.set('offset', String(offset))
    const page = await api<ObservationPage>(`/demographics?${query}`, { signal })
    if (!Array.isArray(page.items)) throw new Error('The demographic API returned an invalid response.')
    items.push(...page.items)
    offset += page.items.length
    if (offset >= page.total) return items
    if (!page.items.length) throw new Error('The demographic API returned an incomplete page. Retry the request.')
  }
}

function familyKey(row: Observation, dimension: Dimension) {
  const varying = dimension === 'geographic_location' ? ['Wellbeing service county', 'Collaborative area'] : [sourceDimensions[dimension]]
  return JSON.stringify([row.table_id, Object.entries(row.dimensions).filter(([key]) => !varying.includes(key)).sort(([first], [second]) => first.localeCompare(second))])
}

function eligible(row: Observation, dimension: Dimension, filters: CohortFilters) {
  for (const key of Object.keys(dimensions) as Dimension[]) {
    if (key === dimension || key === 'geographic_location' || filters[key]) continue
    const value = row.demographics[key]
    if (value !== null && !total(value)) return false
  }
  return Object.entries(row.dimensions).every(([key, value]) =>
    Object.values(sourceDimensions).includes(key) || key === 'Collaborative area' || total(value))
}

export function buildComparison(rows: Observation[], dimension: Dimension, filters: CohortFilters) {
  const families = new Map<string, Observation[]>()
  for (const row of rows) {
    if (!eligible(row, dimension, filters)) continue
    const key = familyKey(row, dimension)
    const family = families.get(key) ?? []
    family.push(row)
    families.set(key, family)
  }
  const comparisons = [...families.values()].map(family => {
    const rateMetric = family[0].program === 'colorectal' ? 'Attended | %' : 'Attended (of invited) | %'
    const groups = family.filter(row => row.metric === rateMetric && row.demographics[dimension] !== null).map(rate => {
      const label = rate.demographics[dimension]!
      const cohort = family.filter(row => row.demographics[dimension] === label && row.source_row === rate.source_row)
      return { label, rate, rows: cohort, attended: cohort.find(row => row.metric === rateMetric.replace('%', 'N')),
        invited: cohort.find(row => row.metric === (row.program === 'colorectal' ? 'Picked | N' : 'Invited | N')) } satisfies EquityGroup
    })
    return { groups: groups.filter(group => !total(group.label)), reference: groups.find(group => total(group.label)) ?? null }
  }).filter(comparison => comparison.groups.length)
  comparisons.sort((first, second) => second.groups.filter(group => numeric(group.rate) !== null).length - first.groups.filter(group => numeric(group.rate) !== null).length || second.groups.length - first.groups.length)
  const comparison = comparisons[0] ?? { groups: [], reference: null }
  comparison.groups.sort((first, second) => (numeric(first.rate) ?? Infinity) - (numeric(second.rate) ?? Infinity) || first.label.localeCompare(second.label))
  const available = comparison.groups.filter(group => numeric(group.rate) !== null)
  const lowest = available[0] ?? null
  const highest = available.at(-1) ?? null
  return { ...comparison, lowest, highest, average: available.length ? available.reduce((sum, group) => sum + group.rate.value!, 0) / available.length : null, availableGroups: available.length, gap: available.length > 1 ? highest!.rate.value! - lowest!.rate.value! : null }
}

export function equityBriefingInput(rows: Observation[], selection: EquitySelection, scope: string): EquityBriefingInput {
  const body = {
    observation_ids: rows.map(row => row.id).sort((first, second) => first - second),
    question: `Brief the equity evidence for ${scope}. Compare by ${dimensions[selection.dimension]}. The downstream funnel cohort is ${selection.selectedLabel}. Describe source-matched attendance differences in percentage points, actual denominators and downstream counts. Keep published totals separate from subgroups. Suggest a concrete local review, not causal claims or projected impact. Preserve unknown categories and cite every finding.`,
  }
  return { key: JSON.stringify([body, [...rows].sort((first, second) => first.id - second.id)]), label: `${scope} · ${dimensions[selection.dimension]}: ${groupLabel(selection.selectedLabel)}`, selection, body }
}

export function funnelStages(group: EquityGroup): FunnelStage[] {
  const stages: [string, string][] = group.rate.program === 'colorectal' ? [
    ['Selected for screening', 'Picked | N'], ['Attended screening', 'Attended | N'], ['Positive screening test', 'Test positives | N'],
    ['Attended colonoscopy', 'Attended colonoscopy (of test positives) | N'],
    ['Surgical / neoadjuvant treatment', 'Surgical/neoadjuvant treatment (of those who had colonoscopy) | N'],
  ] : group.rate.program === 'breast' ? [
    ['Invited to screening', 'Invited | N'], ['Attended screening', 'Attended (of invited) | N'],
    ['Invited to diagnostic examinations', 'Invitation to diagnostic examinations (of attendees) | N'],
    ['Referred to specialist healthcare', 'Referral to specialized healthcare (of examined) | N'],
  ] : [
    ['Invited to screening', 'Invited | N'], ['Attended screening', 'Attended (of invited) | N'],
    ['Referred to colposcopy', 'Referral to colposcopy (of those who participated) | N'],
    ['Attended colposcopy', 'Attended colposcopy (of those referred) | N'],
    ['HSIL or worse detected', 'Histological HSIL or worse (of those who had colposcopy) | N'],
  ]
  return stages.map(([label, metric]) => ({ label, metric, row: group.rows.find(row => row.metric === metric) }))
}

export function evidenceRows(groups: EquityGroup[], reference: EquityGroup | null, selected: EquityGroup | null) {
  const rows = [...groups, ...(reference ? [reference] : [])].flatMap(group => [group.rate, group.attended, group.invited])
  rows.push(...(selected?.rows ?? []))
  return [...new Map(rows.filter((row): row is Observation => !!row).map(row => [row.id, row])).values()]
}
