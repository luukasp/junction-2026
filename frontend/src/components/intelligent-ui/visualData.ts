import type { AIResponse } from '../../lib/api'

export const number = (value: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value)
export const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
export const percentage = (value: unknown): value is number => numeric(value) && value >= 0 && value <= 100
export const labels: Record<string, string> = { Parantava: 'Curative', Jarruttava: 'Disease-modifying', Oireenmukainen: 'Symptom-directed', 'MDT-käsittely': 'MDT discussion' }
export const sourceId = (prefix: string, evidenceId: string) => `${prefix}-${evidenceId.replaceAll(':', '-')}`

export function visualEvidence(response: AIResponse) {
  const preferred = response.answer.visual_evidence_ids
  const cited = new Set(preferred?.length ? preferred : [...response.answer.findings, ...response.answer.proposals].flatMap(item => item.evidence_ids))
  return response.evidence.filter(item => cited.has(item.id))
}
