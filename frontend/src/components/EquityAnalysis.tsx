import { useEffect, useState } from 'react'
import { ArrowUpRight, SlidersHorizontal } from 'lucide-react'
import { api } from '../lib/api'
import { buildComparison, defaultEquitySelection, defaultFilters, dimensions, equityBriefingInput, evidenceRows, funnelStages, groupLabel, loadObservations, number, numeric, observationQuery, percentage, programs, type DemographicCatalog, type Dimension, type EquityGroup, type EquitySelection, type Observation, type Program } from '../data/equity'
import { EquityBriefing } from './EquityBriefing'

const panel = 'min-w-0 rounded-xl border border-line bg-panel p-4 sm:p-6'
const control = 'min-h-10 w-full min-w-0 rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:text-muted'
type Comparison = ReturnType<typeof buildComparison>

export function EquityAnalysis({ selection: controlledSelection, onSelectionChange, briefingOpen: controlledOpen, onBriefingOpenChange }: { selection?: EquitySelection; onSelectionChange?: (selection: EquitySelection) => void; briefingOpen?: boolean; onBriefingOpenChange?: (open: boolean) => void }) {
  const [localSelection, setLocalSelection] = useState(defaultEquitySelection)
  const [localOpen, setLocalOpen] = useState(false)
  const selection = { ...(controlledSelection ?? localSelection), filters: defaultFilters }
  const { program, year, filters, dimension, selectedLabel } = selection
  const briefingOpen = controlledOpen ?? localOpen
  function updateSelection(patch: Partial<EquitySelection>) { (onSelectionChange ?? setLocalSelection)({ ...selection, ...patch }) }
  function setBriefingOpen(open: boolean) { (onBriefingOpenChange ?? setLocalOpen)(open) }
  function setDimension(value: Dimension) { updateSelection({ dimension: value, selectedLabel: '' }) }
  const [catalogResult, setCatalogResult] = useState<{ program: Program; data?: DemographicCatalog; error?: string } | null>(null)
  const [result, setResult] = useState<{ key: string; rows?: Observation[]; error?: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const catalog = catalogResult?.program === program ? catalogResult.data : undefined
  const selectedYear = catalog?.years.includes(Number(year)) ? Number(year) : Math.max(...(catalog?.years ?? [0]))
  const query = selectedYear > 0 ? observationQuery(program, selectedYear, filters, dimension).toString() : ''
  const current = result?.key === query ? result : null

  useEffect(() => {
    const controller = new AbortController()
    api<DemographicCatalog>(`/demographics/filters?program=${program}`, { signal: controller.signal }).then(data => {
      if (!data.filters || !Array.isArray(data.years)) throw new Error('Demographic filters are unavailable from this API.')
      if (!controller.signal.aborted) setCatalogResult({ program, data })
    }).catch(error => {
      if (!controller.signal.aborted) setCatalogResult({ program, error: error instanceof Error ? error.message : 'Could not load demographic filters.' })
    })
    return () => controller.abort()
  }, [program, attempt])

  useEffect(() => {
    if (!query) return
    const controller = new AbortController()
    loadObservations(new URLSearchParams(query), controller.signal).then(rows => {
      if (!controller.signal.aborted) setResult({ key: query, rows })
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ key: query, error: error instanceof Error ? error.message : 'Could not load demographic observations.' })
    })
    return () => controller.abort()
  }, [query, attempt])

  const comparison = buildComparison(current?.rows ?? [], dimension, filters)
  const selected = comparison.groups.find(group => group.label === selectedLabel) ?? comparison.lowest ?? comparison.groups[0] ?? null
  const evidence = evidenceRows(comparison.groups, comparison.reference, selected)
  const error = (catalogResult?.program === program ? catalogResult.error : '') || current?.error
  const loading = !error && (!catalog || (!!query && !current))
  const scope = `${programs[program]} screening · ${selectedYear > 0 ? selectedYear : 'loading year'} · ${dimension === 'geographic_location' && filters.geographic_location === 'Whole country' ? 'Across counties' : filters.geographic_location}`

  const input = selected ? equityBriefingInput(evidence, { ...selection, year: String(selectedYear), selectedLabel: selected.label }, scope) : null

  return <><main id="dashboard-content" className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-8">
    <div className="flex flex-wrap items-start justify-between gap-4"><div>
      <h2 className="text-2xl font-medium">Equity Analysis</h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-secondary">Who is screening reaching, and where do gaps persist? Compare published population groups and follow the evidence downstream.</p>
    </div><button type="button" onClick={() => setBriefingOpen(true)} disabled={!input || loading || !!error} aria-controls="equity-briefing-panel" aria-expanded={briefingOpen} className="min-h-10 shrink-0 rounded-lg border border-line bg-panel px-4 py-2 text-sm text-accent hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50">Open AI briefing</button></div>
    <section aria-labelledby="equity-filters-title" className={panel}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="equity-filters-title" className="flex items-center gap-2 text-sm font-medium"><SlidersHorizontal size={16} strokeWidth={1.5} aria-hidden />Global demographic filters</h3>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-xs text-secondary">Screening programme
          <select className={control} value={program} onChange={event => updateSelection({ program: event.target.value as Program, year: '', filters: defaultFilters, dimension: 'education_level', selectedLabel: '' })}>
            {Object.entries(programs).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="grid gap-2 text-xs text-secondary">Reporting year
          <select className={control} value={selectedYear > 0 ? selectedYear : ''} disabled={!catalog?.years.length} onChange={event => updateSelection({ year: event.target.value })}>
            {!catalog?.years.length && <option value="">No published year</option>}
            {[...(catalog?.years ?? [])].sort((first, second) => second - first).map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-muted">Programme and year apply to both charts and the briefing. Use the comparison and cohort controls within each analytical tool to explore published demographic groups.</p>
    </section>
    <div aria-live="polite" aria-busy={loading}>
      {error ? <div role="alert" className={panel}><h3 className="font-medium">Equity evidence could not be loaded</h3><p className="mt-2 text-sm text-secondary">{error}</p><p className="mt-2 text-xs text-muted">Live demographic data is required. The national snapshot is not a demographic substitute.</p><button className="mt-4 rounded-lg border border-line px-4 py-2 text-sm text-accent focus-visible:outline-2 focus-visible:outline-accent" onClick={() => { setResult(null); setCatalogResult(null); setAttempt(previous => previous + 1) }}>Retry equity data</button></div>
        : loading ? <p role="status" className={panel}>Loading published demographic evidence…</p>
          : !comparison.groups.length ? <section className={panel}><h3 className="text-lg font-medium">No comparable published groups</h3><p className="mt-2 text-sm leading-relaxed text-secondary">This programme and year have no matching {dimensions[dimension].toLowerCase()} breakdown. Missing dimensions are not totals. Try another programme, year or comparison dimension.</p><ComparisonSelect dimension={dimension} catalog={catalog} onChange={setDimension} /></section>
            : <div className="grid items-start gap-6">
              <div className="grid min-w-0 gap-6">
                <section aria-label="Equity evidence summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <div className={panel}><p className="min-h-8 text-xs text-secondary">Observed participation gap</p><p className="mt-2 text-3xl font-medium tabular-nums">{comparison.gap === null ? 'Unavailable' : <>{comparison.gap.toFixed(1)}<span className="ml-2 text-base font-normal text-muted">pp</span></>}</p><p className="mt-2 text-xs leading-relaxed text-muted">{comparison.gap === null ? 'At least two numeric groups are required.' : 'Highest minus lowest published attendance; not risk-adjusted.'}</p></div>
                  <div className={panel}><p className="min-h-8 text-xs text-secondary">Lowest observed attendance</p><p className="mt-2 text-3xl font-medium tabular-nums text-accent">{percentage(numeric(comparison.lowest?.rate))}</p><p className="mt-2 text-xs leading-relaxed text-muted">{comparison.lowest ? groupLabel(comparison.lowest.label) : 'No numeric estimate available'}</p></div>
                  <div className={panel}><p className="min-h-8 text-xs text-secondary">Highest observed screening attendance</p><p className="mt-2 text-3xl font-medium tabular-nums">{percentage(numeric(comparison.highest?.rate))}</p><p className="mt-2 text-xs leading-relaxed text-muted">{comparison.highest ? groupLabel(comparison.highest.label) : 'No numeric estimate available'}</p></div>
                  <div className={panel}><p className="min-h-8 text-xs text-secondary">Average screening attendance</p><p className="mt-2 text-3xl font-medium tabular-nums">{percentage(comparison.average)}</p><p className="mt-2 text-xs leading-relaxed text-muted">Unweighted mean of {comparison.availableGroups} published groups; excludes totals and missing values.</p></div>
                </section>
                <section aria-labelledby="disparity-title" className={panel}>
                  <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 id="disparity-title" className="text-lg font-medium">Participation disparity</h3><p className="mt-1 text-xs leading-relaxed text-muted">{scope}</p></div><ComparisonSelect dimension={dimension} catalog={catalog} onChange={setDimension} /></div>
                  <DisparityChart comparison={comparison} />
                </section>
                <section aria-labelledby="funnel-title" className={panel}>
                  <h3 id="funnel-title" className="text-lg font-medium">Downstream impact funnel</h3>
                  <p className="mt-1 text-xs text-muted">One published cohort, followed through the screening pathway</p>
                  <label className="mt-4 grid max-w-sm gap-2 text-xs text-secondary">Funnel cohort<select className={control} value={selected?.label ?? ''} onChange={event => updateSelection({ selectedLabel: event.target.value })}>{comparison.groups.map(group => <option key={group.label} value={group.label}>{groupLabel(group.label)}</option>)}</select></label>
                  {selected && <ImpactFunnel group={selected} />}
                </section>
                <EvidenceTable rows={evidence} />
              </div>
            </div>}
    </div>
  </main>{input && !loading && !error && <EquityBriefing key={input.key} rows={evidence} comparison={comparison} selected={selected} input={input} limitations={catalog?.limitations ?? []} open={briefingOpen} onClose={() => setBriefingOpen(false)} />}</>
}

function ComparisonSelect({ dimension, catalog, onChange }: { dimension: Dimension; catalog?: DemographicCatalog; onChange: (value: Dimension) => void }) {
  return <label className="mt-2 grid gap-2 text-xs text-secondary">Compare by<select className={control} value={dimension} onChange={event => onChange(event.target.value as Dimension)}>{(Object.keys(dimensions) as Dimension[]).map(key => <option key={key} value={key} disabled={!catalog?.filters[key]?.available}>{dimensions[key]}</option>)}</select></label>
}

function DisparityChart({ comparison }: { comparison: Comparison }) {
  const reference = numeric(comparison.reference?.rate)
  return <figure aria-label="Screening attendance by demographic group" className="mt-6">
    <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-secondary"><span className="flex items-center gap-2"><span className="h-2 w-3 bg-accent" aria-hidden />Lowest attendance</span>{reference !== null && <span className="flex items-center gap-2"><span className="w-3 border-t border-dashed border-ink" aria-hidden />Published total {percentage(reference)}</span>}</div>
    <div className="grid gap-5">{comparison.groups.map(group => {
      const value = numeric(group.rate)
      return <div key={group.label} className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(8rem,1fr)_minmax(0,1.5fr)_4rem]">
        <div className="col-span-2 min-w-0 sm:col-span-1"><p className="text-sm leading-snug">{groupLabel(group.label)}</p><p className="mt-1 text-xs tabular-nums text-muted">{number(numeric(group.attended))} / {number(numeric(group.invited))}</p></div>
        <div role="img" aria-label={`${groupLabel(group.label)}: ${percentage(value)} attendance`} className="relative h-8 border-x border-line bg-raised">
          {value !== null && <div className={`h-full ${group === comparison.lowest ? 'bg-accent' : 'bg-muted/45'}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />}
          {reference !== null && <span className="absolute -top-1 -bottom-1 border-l border-dashed border-ink" style={{ left: `${reference}%` }} aria-hidden />}
        </div><span className="text-right text-sm font-medium tabular-nums">{percentage(value)}</span>
      </div>
    })}</div>
    <div className="mt-4 grid grid-cols-[minmax(0,1fr)_5rem] gap-3 sm:grid-cols-[minmax(8rem,1fr)_minmax(0,1.5fr)_4rem]"><span className="hidden sm:block" /><div className="flex justify-between text-xs tabular-nums text-muted"><span>0%</span><span>50%</span><span>100%</span></div></div>
    <figcaption className="mt-5 border-t border-line pt-4 text-xs leading-relaxed text-muted">Attendance as published; counts show attendees / screening population. Groups come from one source table with matching strata. Totals are benchmarks, not additional groups. {reference === null && 'No matching total is published for this selection. '}{comparison.lowest && comparison.highest && comparison.gap !== null && `${groupLabel(comparison.lowest.label)} (${percentage(numeric(comparison.lowest.rate))}) versus ${groupLabel(comparison.highest.label)} (${percentage(numeric(comparison.highest.rate))}).`}</figcaption>
  </figure>
}

function ImpactFunnel({ group }: { group: EquityGroup }) {
  const stages = funnelStages(group)
  const first = numeric(stages[0].row)
  const invited = numeric(group.invited)
  const attended = numeric(group.attended)
  return <figure aria-label="Published downstream screening counts" className="mt-5">
    <ol className="grid gap-4">{stages.map((stage, index) => {
      const value = numeric(stage.row)
      return <li key={stage.metric}><div className="mb-2 flex items-baseline justify-between gap-3"><span className="text-sm text-secondary">{stage.label}</span><span className="shrink-0 text-sm font-medium tabular-nums">{number(value)}</span></div><div className="flex h-7 justify-center bg-raised/60" aria-hidden>{value !== null && first !== null && first > 0 && <div className={index < 2 ? 'bg-accent/75' : 'bg-muted/45'} style={{ width: `${Math.max(0, Math.min(100, 100 * value / first))}%` }} />}</div></li>
    })}</ol>
    {invited !== null && attended !== null && invited >= attended && <p className="mt-5 border-l-2 border-accent py-1 pl-4 text-sm leading-relaxed"><span className="font-medium tabular-nums">{number(invited - attended)}</span> people in this cohort did not attend screening{invited > 0 ? ` (${percentage(100 * (invited - attended) / invited)} of the screening population)` : ''}.</p>}
    <figcaption className="mt-4 text-xs leading-relaxed text-muted">{group.rate.year} · {groupLabel(group.label)} · {group.rate.table_id}. Widths are proportional to the first stage. Positive tests, referral and treatment are clinical subsets, not successive care losses. An absent count is unavailable, not zero. These aggregate data cannot establish causal downstream harm.</figcaption>
  </figure>
}

function EvidenceTable({ rows }: { rows: Observation[] }) {
  return <details className="min-w-0 rounded-xl border border-line bg-panel"><summary className="cursor-pointer px-4 py-4 text-sm text-secondary sm:px-6">Source evidence · {rows.length} observations</summary><div className="overflow-x-auto border-t border-line"><table className="w-full text-left text-xs"><caption className="sr-only">Exact registry observations used in the charts and briefing</caption><thead className="bg-raised text-secondary"><tr>{['Row', 'Population / metric', 'Value', 'Source'].map(label => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-line">{rows.map(row => <tr id={`equity-evidence-${row.id}`} key={row.id}><td className="px-4 py-3 tabular-nums text-muted">{row.id}</td><td className="min-w-48 px-4 py-3"><p>{Object.values(row.dimensions).join(' · ')}</p><p className="mt-1 text-muted">{row.metric} · {row.year}</p></td><td className="whitespace-nowrap px-4 py-3 tabular-nums">{row.metric.endsWith('%') ? percentage(numeric(row)) : number(numeric(row))}</td><td className="px-4 py-3"><a className="inline-flex items-center gap-1 text-accent underline underline-offset-4" href={row.source_url} target="_blank" rel="noreferrer">{row.table_id}<ArrowUpRight size={12} aria-hidden /></a><p className="mt-1 text-muted">Source row {row.source_row}</p></td></tr>)}</tbody></table></div></details>
}
