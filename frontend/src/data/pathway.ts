import { count, percent } from './regions'

export type VerdictId = 'act' | 'verify' | 'monitor' | 'ok' | 'nodata'
export type PathwayStage = { id: string; label: string; hint: string }
export type PathwayIndicator = {
  id: string; label: string; short: string; stage: string; unit: string; polarity: string
  kind: string; period: string; source_url: string; is_proxy: boolean
  desc?: string; caveat?: string; periods?: string[]; group?: string; value_type?: string; proxy_for?: string | null
}
export type QualityCheck = { id: string; label: string; status: 'pass' | 'warn' | 'fail' | 'na'; detail: string }
export type SeriesPoint = { period: string; v: number | null; lo?: number | null; hi?: number | null; comparator?: number | null }
export type IndicatorValue = {
  v: number | null; lo?: number | null; hi?: number | null; n?: number | null; d?: number | null
  series?: SeriesPoint[]
}
export type CountyValue = IndicatorValue & {
  comparator?: number | null; comparator_kind?: string; verdict: VerdictId; period?: string; reason?: string
  score?: number | null; checks?: QualityCheck[]; direction?: string; distinct?: boolean
}
export type Citation = { label: string; url?: string | null }
export type EvidenceExcerpt = { label: string; url: string; text: string; chunk_id?: string; score?: number }
export type PathwayAction = {
  playbook_id: string; title: string; pathway_stage: string; owner: string; baseline: string; target: string
  annual_volume: string; timeline: string; first_90_days: string[]; concrete_steps: string[]; escalation: string; citations: Citation[]
  verdict?: string; reason?: string
  annual_volume_n?: number | null; primary_indicator?: string
  strategy_actions?: string[]; goal?: string; evidence_status?: string
  evidence_excerpts?: EvidenceExcerpt[]
  peer?: { code: string; name: string; v?: number | null }
  local_tailoring?: string | null
  staff_hours?: number; fte_estimate?: number; capacity_slots?: number; capacity_unit?: string
  cost_eur_lo?: number; cost_eur_hi?: number; resource_summary?: string; cost_estimate?: string; cost_basis?: string
  unit_hours?: number; fixed_hours?: number; unit_cost_lo?: number; unit_cost_hi?: number
  fixed_cost_lo?: number; fixed_cost_hi?: number; capacity_per_case?: number
}
export type PeerCounty = { code: string; name: string; distance: number }
export type MortalityTrendPoint = { year: number; deaths?: number; crude_rate?: number }
export type PathwayCounty = {
  code: string; name: string; name_fi?: string; headline: string
  yta_code?: string; yta_name?: string
  stage_verdicts: Record<string, VerdictId>
  values: Record<string, CountyValue>
  actions: PathwayAction[]
  peers?: PeerCounty[]
  context?: Record<string, number>
  context_rates?: Record<string, number>
  mortality_trend?: MortalityTrendPoint[]
}
export type EquityStratum = {
  program: string; label: string; dimension: string; year: string; unit: string
  groups: { group: string; v: number }[]; gap_pp: number; stage: string; source_url: string
}
export type NationalAction = {
  id: string; playbook_id: string; title: string; pathway_stage: string; owner: string
  counties_affected: number; county_names: string[]; annual_volume_n: number; annual_volume: string
  staff_hours: number; cost_estimate: string; target: string; timeline: string
  strategy_actions: string[]; goal: string; citations: Citation[]
}
export type DataGap = { stage: string; what: string; why: string; sources?: string[] }
export type PathwaySnapshot = {
  built: string
  national_headline: string
  placeholder?: boolean
  stages: PathwayStage[]
  indicators: PathwayIndicator[]
  national: Record<string, IndicatorValue>
  national_mortality_trend?: MortalityTrendPoint[]
  equity_strata?: EquityStratum[]
  national_actions?: NationalAction[]
  verdicts: Partial<Record<VerdictId, { label: string; desc: string }>>
  counties: PathwayCounty[]
  data_gaps?: DataGap[]
  limitations?: string[]
  stage_unknown?: { n: number; d: number; pct: number; period: string; table: string; url: string }
  validation?: { source_integrity: number; analytical: number; passed: boolean; citations_verified?: number; citations_total?: number }
  method?: Record<string, string | number>
}

export const OVERALL_PATHWAY_ID = '__overall__'
export const verdictOrder: VerdictId[] = ['act', 'verify', 'monitor', 'ok', 'nodata']
/** Short, plain labels; the snapshot supplies the longer descriptions. */
export const verdictLabels: Record<VerdictId, string> = { act: 'Act', verify: 'Verify data', monitor: 'Monitor', ok: 'In line', nodata: 'No data' }
export const verdictColors: Record<VerdictId, string> = { act: '#d9822b', verify: '#5b7bb2', monitor: '#94a69c', ok: '#2f856e', nodata: '#525b61' }

export const asVerdict = (value: unknown): VerdictId => verdictOrder.includes(value as VerdictId) ? value as VerdictId : 'nodata'
export const verdictRank = (value: unknown) => verdictOrder.indexOf(asVerdict(value))
export const lowerIsBetter = (indicator: PathwayIndicator) => /low|neg|-1|down|less/i.test(indicator.polarity)
export const higherIsBetter = (indicator: PathwayIndicator) => !lowerIsBetter(indicator) && /high|pos|^\+?1$|up|more/i.test(indicator.polarity)
export const polarityText = (indicator: PathwayIndicator) => lowerIsBetter(indicator) ? 'lower is better' : higherIsBetter(indicator) ? 'higher is better' : ''

export function stageGroups(snapshot: PathwaySnapshot) {
  const known = new Set(snapshot.stages.map(s => s.id))
  const groups = snapshot.stages.map(stage => ({ stage, indicators: snapshot.indicators.filter(i => i.stage === stage.id) }))
  const other = snapshot.indicators.filter(i => !known.has(i.stage))
  if (other.length) groups.push({ stage: { id: '_context', label: 'Context', hint: 'Background indicators outside the care pathway' }, indicators: other })
  return groups
}

export function formatValue(value: number | null | undefined, unit: string) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const number = new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value)
  if (/%|percent|pct|share/i.test(unit)) return `${number}%`
  if (unit === 'ratio') return number
  return unit ? `${number} ${unit.replaceAll('_', ' ')}` : number
}

export function formatInterval(value: IndicatorValue | undefined, unit: string) {
  if (!value || value.lo === null || value.lo === undefined || value.hi === null || value.hi === undefined) return ''
  return `95% CI ${formatValue(value.lo, unit)} to ${formatValue(value.hi, unit)}`
}

export function formatCount(value: IndicatorValue | undefined) {
  if (!value || value.n === null || value.n === undefined || value.d === null || value.d === undefined) return ''
  return `${count(value.n)} of ${count(value.d)}`
}

/** The lung no-record view stays the default when the snapshot carries it. */
export function defaultIndicatorId(snapshot: PathwaySnapshot) {
  const preferred = snapshot.indicators.find(i => /noinfo|no_record|norecord/i.test(i.id))
  return (preferred ?? snapshot.indicators[0])?.id ?? null
}

export function stageCounts(snapshot: PathwaySnapshot, stageId: string) {
  const counts: Record<VerdictId, number> = { act: 0, verify: 0, monitor: 0, ok: 0, nodata: 0 }
  for (const county of snapshot.counties) counts[asVerdict(county.stage_verdicts[stageId])] += 1
  return counts
}

type LungRegion = { regionId: string; regionName: string; patients: number | null; missing: number | null; share: number | null }
export function fallbackHeadline(regions: LungRegion[]) {
  const reporting = regions.filter(r => r.patients && r.missing !== null && r.share !== null)
  if (!reporting.length) return ''
  const patients = reporting.reduce((sum, r) => sum + (r.patients ?? 0), 0)
  const missing = reporting.reduce((sum, r) => sum + (r.missing ?? 0), 0)
  const shares = reporting.map(r => r.share as number)
  return `${count(missing)} of ${count(patients)} lung cancer patients (${percent(100 * missing / patients)}) have no recorded treatment — ${percent(Math.min(...shares))} to ${percent(Math.max(...shares))} by county. Click a county for actions.`
}

const list = (items: string[]) => items.map(item => `- ${item}`).join('\n')

export function comparatorLabel(value: CountyValue | undefined, indicatorId?: string, capitalise = false) {
  let label = 'national'
  if (indicatorId === 'lung_mdt') label = 'other reporting counties'
  else if (value?.comparator != null && value.comparator_kind === 'leave_one_out') label = 'rest of Finland'
  return capitalise ? label.charAt(0).toUpperCase() + label.slice(1) : label
}

export function worstCountyVerdict(snapshot: PathwaySnapshot, county: PathwayCounty): { verdict: VerdictId; earliestStage: string | null; actStages: number; verifyStages: number } {
  let bestRank = verdictOrder.length - 1
  let earliestStage: string | null = null
  let actStages = 0
  let verifyStages = 0
  for (const stage of snapshot.stages) {
    const v = asVerdict(county.stage_verdicts[stage.id])
    if (v === 'act') actStages += 1
    if (v === 'verify') verifyStages += 1
    const r = verdictRank(v)
    if (r < bestRank) {
      bestRank = r
      earliestStage = stage.label
    }
  }
  return { verdict: verdictOrder[bestRank], earliestStage, actStages, verifyStages }
}

/** Markdown action plan that works without the backend or AI. */
export function planMarkdown(snapshot: PathwaySnapshot, county: PathwayCounty, date = new Date()) {
  const stageLabel = (id: string) => snapshot.stages.find(s => s.id === id)?.label ?? id
  const stages = snapshot.stages.map(s => `| ${s.label} | ${verdictLabels[asVerdict(county.stage_verdicts[s.id])]} |`).join('\n')
  const signals = snapshot.indicators.filter(i => county.values[i.id]).map(i => {
    const value = county.values[i.id]
    const comparator = value.comparator ?? snapshot.national[i.id]?.v
    const compName = comparatorLabel(value, i.id)
    const extra = [formatCount(value), formatInterval(value, i.unit)].filter(Boolean).join('; ')
    return `- ${i.label}${i.is_proxy ? ' (proxy)' : ''}: ${formatValue(value.v, i.unit)}${extra ? ` (${extra})` : ''} vs ${compName} ${formatValue(comparator, i.unit)}, ${i.period} — ${verdictLabels[asVerdict(value.verdict)]}`
  })
  const peers = county.peers?.length
    ? `## Demographic peers\n\n${county.yta_name ? `Collaboration area: ${county.yta_name}\n\n` : ''}${list(county.peers.map(p => `${p.name} (${p.code}) — StatFin demographic distance ${p.distance}`))}`
    : ''
  const actions = county.actions.map((a, index) => [
    `## ${index + 1}. ${a.title}`,
    `Status: ${verdictLabels[asVerdict(a.verdict)]}${a.reason ? ` — ${a.reason}` : ''}  \nPathway stage: ${stageLabel(a.pathway_stage)}  \nOwner: ${a.owner}  \nTimeline: ${a.timeline}${a.strategy_actions?.length ? `  \nNational Cancer Strategy Roadmap: ${a.strategy_actions.join(', ')}` : ''}`,
    [
      `- Baseline: ${a.baseline}`,
      `- Target: ${a.target}`,
      `- Annual volume: ${a.annual_volume}`,
      a.resource_summary ? `- Operational resourcing: ${a.resource_summary}` : '',
      a.cost_estimate ? `- Indicative annual budget: ${a.cost_estimate}` : '',
      a.local_tailoring ? `- Local demographic tailoring: ${a.local_tailoring}` : '',
    ].filter(Boolean).join('\n'),
    a.first_90_days.length ? `### First 90 days\n\n${list(a.first_90_days)}` : '',
    a.concrete_steps.length ? `### Steps\n\n${list(a.concrete_steps)}` : '',
    `Escalation: ${a.escalation}`,
    a.citations.length ? `Sources:\n${list(a.citations.map(c => c.url ? `[${c.label}](${c.url})` : c.label))}` : '',
  ].filter(Boolean).join('\n\n'))
  return [
    `# Cancer care action plan — ${county.name}`,
    `Equal Care Finland · prepared ${date.toISOString().slice(0, 10)} from the snapshot built ${snapshot.built.slice(0, 10)}. Draft for local clinical review.`,
    county.headline,
    `## Where the gap emerges\n\n| Pathway stage | Status |\n| --- | --- |\n${stages}`,
    peers,
    signals.length ? `## Signals\n\n${signals.join('\n')}` : '',
    actions.length ? actions.join('\n\n') : '## Actions\n\nNo snapshot action is triggered for this area. Keep monitoring the indicators above.',
    '## Interpretation\n\nFigures are descriptive and not risk-adjusted. A missing treatment record does not mean treatment was not given. Resource and cost figures are operational planning estimates based on public unit benchmarks, not observed expenditure. Referral stages use proxies; no national referral-delay series is available.',
  ].filter(Boolean).join('\n\n') + '\n'
}

export function nationalPlanMarkdown(snapshot: PathwaySnapshot, date = new Date()) {
  const actions = (snapshot.national_actions ?? []).map((a, idx) => [
    `## ${idx + 1}. ${a.title}`,
    `Pathway stage: ${a.pathway_stage} · Roadmap actions: ${a.strategy_actions.join(', ')} (${a.goal})`,
    `- National owner: ${a.owner}\n- Scope: ${a.counties_affected} areas (${a.county_names.join(', ')})\n- National annual volume: ${a.annual_volume}\n- Aggregated planning envelope: ${a.cost_estimate} (~${count(a.staff_hours)} staff h/yr)\n- Target: ${a.target}\n- Timeline: ${a.timeline}`,
    a.citations.length ? `Sources:\n${list(a.citations.map(c => c.url ? `[${c.label}](${c.url})` : c.label))}` : '',
  ].filter(Boolean).join('\n\n'))
  return [
    '# National Cancer Care Implementation Roadmap (2026–2031 Roll-up)',
    `Equal Care Finland · prepared ${date.toISOString().slice(0, 10)} from snapshot ${snapshot.built.slice(0, 10)}.`,
    snapshot.national_headline,
    actions.join('\n\n'),
  ].filter(Boolean).join('\n\n') + '\n'
}

export function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
