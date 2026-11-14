import { count, percent } from './regions'

export type VerdictId = 'act' | 'verify' | 'monitor' | 'ok' | 'nodata'
export type PathwayStage = { id: string; label: string; hint: string }
export type PathwayIndicator = {
  id: string; label: string; short: string; stage: string; unit: string; polarity: string
  kind: string; period: string; source_url: string; is_proxy: boolean
  desc?: string; caveat?: string
}
export type IndicatorValue = { v: number | null; lo?: number | null; hi?: number | null; n?: number | null; d?: number | null }
export type CountyValue = IndicatorValue & {
  comparator?: number | null; comparator_kind?: string; verdict: VerdictId; period?: string; reason?: string
}
export type Citation = { label: string; url?: string | null }
export type PathwayAction = {
  playbook_id: string; title: string; pathway_stage: string; owner: string; baseline: string; target: string
  annual_volume: string; timeline: string; first_90_days: string[]; concrete_steps: string[]; escalation: string; citations: Citation[]
  verdict?: string; reason?: string
}
export type PathwayCounty = {
  code: string; name: string; headline: string
  stage_verdicts: Record<string, VerdictId>
  values: Record<string, CountyValue>
  actions: PathwayAction[]
}
export type PathwaySnapshot = {
  built: string
  national_headline: string
  placeholder?: boolean
  stages: PathwayStage[]
  indicators: PathwayIndicator[]
  national: Record<string, IndicatorValue>
  verdicts: Partial<Record<VerdictId, { label: string; desc: string }>>
  counties: PathwayCounty[]
}

export const verdictOrder: VerdictId[] = ['act', 'verify', 'monitor', 'ok', 'nodata']
/** Short, plain labels; the snapshot supplies the longer descriptions. */
export const verdictLabels: Record<VerdictId, string> = { act: 'Act', verify: 'Verify data', monitor: 'Monitor', ok: 'In line', nodata: 'No data' }
export const verdictColors: Record<VerdictId, string> = { act: '#dbac78', verify: '#9aa6c4', monitor: '#b8c6bd', ok: '#7a9b91', nodata: '#505a5e' }

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

/** Markdown action plan that works without the backend or AI. */
export function planMarkdown(snapshot: PathwaySnapshot, county: PathwayCounty, date = new Date()) {
  const stageLabel = (id: string) => snapshot.stages.find(s => s.id === id)?.label ?? id
  const stages = snapshot.stages.map(s => `| ${s.label} | ${verdictLabels[asVerdict(county.stage_verdicts[s.id])]} |`).join('\n')
  const signals = snapshot.indicators.filter(i => county.values[i.id]).map(i => {
    const value = county.values[i.id]
    const comparator = value.comparator ?? snapshot.national[i.id]?.v
    const extra = [formatCount(value), formatInterval(value, i.unit)].filter(Boolean).join('; ')
    return `- ${i.label}${i.is_proxy ? ' (proxy)' : ''}: ${formatValue(value.v, i.unit)}${extra ? ` (${extra})` : ''} vs national ${formatValue(comparator, i.unit)}, ${i.period} — ${verdictLabels[asVerdict(value.verdict)]}`
  })
  const actions = county.actions.map((a, index) => [
    `## ${index + 1}. ${a.title}`,
    `Status: ${verdictLabels[asVerdict(a.verdict)]}${a.reason ? ` — ${a.reason}` : ''}  \nPathway stage: ${stageLabel(a.pathway_stage)}  \nOwner: ${a.owner}  \nTimeline: ${a.timeline}`,
    `- Baseline: ${a.baseline}\n- Target: ${a.target}\n- Annual volume: ${a.annual_volume}`,
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
    signals.length ? `## Signals\n\n${signals.join('\n')}` : '',
    actions.length ? actions.join('\n\n') : '## Actions\n\nNo snapshot action is triggered for this area. Keep monitoring the indicators above.',
    '## Interpretation\n\nFigures are descriptive and not risk-adjusted. A missing treatment record does not mean treatment was not given. Referral stages use proxies; no national referral-delay series is available.',
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
