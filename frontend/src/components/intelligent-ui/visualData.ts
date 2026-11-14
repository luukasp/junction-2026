import type { AIResponse } from '../../lib/api'

export const number = (value: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value)
export const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
export const percentage = (value: unknown): value is number => numeric(value) && value >= 0 && value <= 100
export const labels: Record<string, string> = { Parantava: 'Curative', Jarruttava: 'Life-prolonging', Oireenmukainen: 'Symptom-directed', 'MDT-käsittely': 'MDT discussion' }
/** Finnish source labels shown to English readers. */
const finnish: Record<string, string> = {
  ...labels, 'Ei hoitotietoa': 'No treatment record', 'Elinaikaa pidentävä': 'Life-prolonging',
  Kaikki: 'All', Yhteensä: 'Total', Miehet: 'Men', Naiset: 'Women', Molemmat: 'Both sexes', 'Koko maa': 'Whole country',
  'Etelä-Suomen yhteistyöalue': 'Southern Finland collaborative area', 'Itä-Suomen yhteistyöalue': 'Eastern Finland collaborative area',
  'Länsi-Suomen yhteistyöalue': 'Western Finland collaborative area', 'Pohjois-Suomen yhteistyöalue': 'Northern Finland collaborative area',
  'Sisä-Suomen yhteistyöalue': 'Inland Finland collaborative area',
}
const fields: Record<string, string> = {
  area_code: 'Area code', area_fi: 'Area (Finnish name)', area: 'Area', area_level: 'Area level', collaboration_area_fi: 'Collaborative area',
  collaboration_area: 'Collaborative area', treatment_type_fi: 'Treatment category', treatment_n: 'Patients in category', patients_n: 'Patients',
  share_pct: 'Share (%)', diagnosis_period: 'Diagnosis period', observation_window: 'Observation window', table_id: 'Source table',
  source_row: 'Source row', incidence_rate: 'Incidence rate', mortality_rate: 'Mortality rate', relative_survival_5y_pct: '5-year relative survival (%)',
  incidence_n: 'New cases', prevalence_n: 'Living patients', mortality_n: 'Deaths', value_raw: 'Value as published', metric_code: 'Metric code',
  sex_code: 'Sex code', cause_code: 'Cause code', strata: 'Group', imported_at: 'Imported',
}
export const fieldLabel = (key: string) => fields[key] ?? (key.replaceAll('_', ' ').replace(/\bpct\b/, '(%)').replace(/\bn$/, 'count').replace(/^./, c => c.toUpperCase()))
export const translate = (value: string) => finnish[value] ?? value
/** Turns structured strata such as {"age":"50-69"} into readable chips. */
export function strataChips(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== null && v !== '').map(([k, v]) => `${fieldLabel(k)}: ${translate(typeof v === 'object' ? Object.values(v as object).join(', ') : String(v))}`)
}
export function readableValue(value: unknown): string {
  if (value === null || value === undefined) return 'Missing / suppressed'
  if (Array.isArray(value)) return value.map(readableValue).join(', ')
  if (typeof value === 'object') return strataChips(value).join(' · ') || 'None'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return translate(String(value))
}
export const sourceId = (prefix: string, evidenceId: string) => `${prefix}-${evidenceId.replaceAll(':', '-')}`

export function visualEvidence(response: AIResponse) {
  const preferred = response.answer.visual_evidence_ids
  const cited = new Set(preferred?.length ? preferred : [...response.answer.findings, ...response.answer.proposals].flatMap(item => item.evidence_ids))
  return response.evidence.filter(item => cited.has(item.id))
}
