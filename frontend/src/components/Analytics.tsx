import { useState } from 'react'
import { Download, ShieldCheck } from 'lucide-react'
import { useDashboard } from '../data/DashboardContext'
import { nationalSeries, nationalStatus } from '../data/analytics'
import { count } from '../data/regions'
import {
  downloadText, formatCount, formatInterval, formatValue, nationalPlanMarkdown,
  stageCounts, verdictColors, verdictLabels, verdictOrder, type PathwaySnapshot,
} from '../data/pathway'

const panel = 'min-w-0 rounded-xl border border-line bg-panel p-4 sm:p-5'
type Series = ReturnType<typeof nationalSeries>

export function Analytics() {
  const { pathway } = useDashboard()
  return <main id="dashboard-content" className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-8">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-2xl font-medium">Analytics</h2>
        <p className="mt-2 text-sm text-secondary">National 2026–2031 roadmap roll-up, screening equity beyond geography, county dispersion &amp; data provenance</p>
      </div>
      {pathway?.national_actions && pathway.national_actions.length > 0 && (
        <button type="button" onClick={() => downloadText('national-cancer-roadmap-2026-2031.md', nationalPlanMarkdown(pathway))}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm text-secondary hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent">
          <Download size={16} strokeWidth={1.5} aria-hidden />Export national roadmap (.md)
        </button>
      )}
    </div>
    {pathway ? <NationalAnalytics snapshot={pathway} /> : <p className={panel} role="status">National analytics are unavailable in this snapshot</p>}
  </main>
}

function NationalAnalytics({ snapshot }: { snapshot: PathwaySnapshot }) {
  const status = nationalStatus(snapshot)
  const lung = nationalSeries(snapshot, id => id === 'lung_noinfo')[0]
  const screening = nationalSeries(snapshot, id => /^scr_.*_att$/.test(id))
  const available = nationalSeries(snapshot, () => true).length

  return <>
    <section aria-label="Overall national status">
      <p className="max-w-4xl text-xl leading-relaxed sm:text-2xl">{status.statement}</p>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-secondary">Act signals identify priorities for local care-pathway intervention. Verify signals call for auditing HILMO, clinical notifications or register feeds before drawing conclusions about care.</p>
    </section>
    <dl aria-label="National summary" className="grid divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel lg:grid-cols-3 lg:divide-x lg:divide-y-0">
      {[
        { label: 'Counties with Act signals', value: `${status.act} / ${status.total}`, detail: `${status.classified} counties have classified pathway data` },
        { label: 'Lung patients without a treatment record', value: lung ? formatValue(lung.value.v, lung.indicator.unit) : 'Unavailable', detail: lung ? [formatCount(lung.value), lung.indicator.period].filter(Boolean).join(' · ') : 'No published national estimate' },
        { label: 'National indicators available', value: `${available} / ${snapshot.indicators.length}`, detail: snapshot.validation ? `${count(snapshot.validation.source_integrity + snapshot.validation.analytical)} automated checks passed` : 'Reporting periods vary by indicator' },
      ].map(stat => <div key={stat.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 p-4 sm:p-5 lg:block">
        <dt className="text-sm text-secondary">{stat.label}</dt>
        <dd className="font-mono text-2xl tabular-nums lg:mt-2">{stat.value}</dd>
        <dd className="col-span-2 text-xs text-muted lg:mt-2">{stat.detail}</dd>
      </div>)}
    </dl>

    {snapshot.national_actions && snapshot.national_actions.length > 0 && (
      <NationalRoadmap snapshot={snapshot} />
    )}

    {snapshot.equity_strata && snapshot.equity_strata.length > 0 && (
      <EquityStrataSection snapshot={snapshot} />
    )}

    <CountyDispersion snapshot={snapshot} />

    <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className={panel} aria-labelledby="screening-chart-title">
        <h3 id="screening-chart-title" className="text-lg font-medium">Screening participation</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">Attended or returned a test · share of the programme cohort</p>
        <NationalBars series={screening} label="National screening participation" maximum={100} unit="%" />
        <SeriesSources series={screening} />
      </section>
      <section className={panel} aria-labelledby="records-chart-title">
        <h3 id="records-chart-title" className="text-lg font-medium">Lung treatment records</h3>
        {lung ? <>
          <p className="mt-1 text-xs text-muted">{lung.indicator.period} · within 12 months of diagnosis</p>
          <p className="mt-6 font-mono text-3xl tabular-nums">{formatValue(lung.value.v, lung.indicator.unit)}</p>
          <p className="mt-2 text-sm text-secondary">without a treatment record</p>
          <div className="mt-5 flex h-5 overflow-hidden rounded-sm bg-line" role="img" aria-label={`Lung treatment records: ${formatValue(100 - lung.value.v, '%')} with a record, ${formatValue(lung.value.v, '%')} without a record`}>
            <span className="h-full bg-secondary/50" style={{ width: `${Math.max(0, Math.min(100, 100 - lung.value.v))}%` }} />
            <span className="h-full" style={{ width: `${Math.max(0, Math.min(100, lung.value.v))}%`, backgroundColor: verdictColors.act }} />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-secondary">
            <span><span className="mr-2 inline-block size-2 bg-secondary/50" />With a record</span>
            <span><span className="mr-2 inline-block size-2" style={{ backgroundColor: verdictColors.act }} />No record</span>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-muted">Missing records may reflect incomplete reporting. They do not prove that treatment was not provided.</p>
          <SeriesSources series={[lung]} />
        </> : <p className="mt-6 text-sm text-muted">No national treatment-record estimate is available</p>}
      </section>
    </div>
    <div className="grid min-w-0 items-start gap-6 xl:grid-cols-2">
      <Outcomes snapshot={snapshot} />
      <PathwaySignals snapshot={snapshot} />
    </div>
    <ProvenanceSection snapshot={snapshot} />
    <p className="text-xs leading-relaxed text-muted">These figures describe different cohorts and reporting periods. Screening and treatment measures are not risk-adjusted; outcome rates are age-standardised where stated in the source. Signals support clinical review and are not a ranking of care quality.{snapshot.placeholder ? ' This snapshot contains lung treatment data only.' : ''}</p>
  </>
}

function NationalRoadmap({ snapshot }: { snapshot: PathwaySnapshot }) {
  const actions = snapshot.national_actions ?? []
  const stageLabel = (id: string) => snapshot.stages.find(s => s.id === id)?.label ?? id
  return (
    <section className={panel} aria-labelledby="national-roadmap-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 id="national-roadmap-title" className="text-lg font-medium">National implementation roadmap (2026–2031 roll-up)</h3>
          <p className="mt-1 text-xs text-muted">Aggregates all 53 county action plans into 5 national STM / THL / FICAN initiatives aligned with Goal 2 &amp; Goal 3</p>
        </div>
      </div>
      <ol className="mt-4 grid gap-3 lg:grid-cols-2">
        {actions.map((action, index) => (
          <li key={action.id} className="rounded-lg border border-line bg-page p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span className="font-mono">National {index + 1} · {stageLabel(action.pathway_stage)}</span>
              <span className="rounded-md bg-raised px-2 py-0.5 font-medium text-accent">Roadmap {action.strategy_actions.join(', ')}</span>
            </div>
            <h4 className="mt-2 text-sm font-medium text-ink">{action.title}</h4>
            <p className="mt-2 text-xs leading-relaxed text-secondary">{action.target}</p>
            <dl className="mt-3 grid gap-2 border-t border-line pt-3 text-xs sm:grid-cols-2">
              <div><dt className="text-muted">National owner</dt><dd className="mt-0.5 text-secondary">{action.owner}</dd></div>
              <div><dt className="text-muted">Scope &amp; annual volume</dt><dd className="mt-0.5 text-secondary">{action.annual_volume}</dd></div>
              <div className="sm:col-span-2"><dt className="text-muted">Aggregated planning envelope</dt><dd className="mt-0.5 font-mono text-ink">{action.cost_estimate} · ≈{count(action.staff_hours)} staff h/yr</dd></div>
            </dl>
          </li>
        ))}
      </ol>
    </section>
  )
}

function EquityStrataSection({ snapshot }: { snapshot: PathwaySnapshot }) {
  const strata = snapshot.equity_strata ?? []
  const dims = Array.from(new Set(strata.map(s => s.dimension)))
  const [dim, setDim] = useState<string>(dims[0] ?? 'Native language')
  const visible = strata.filter(s => s.dimension === dim)
  if (!visible.length) return null

  return (
    <section className={panel} aria-labelledby="equity-strata-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="equity-strata-title" className="text-lg font-medium">Equity beyond geography · national population strata (2024)</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">Key pathway finding: non-domestic language &amp; primary-education groups lag by 18–30 pp at Stage 01 Detection, whereas post-referral colposcopy attendance is equal (87.1% vs 84.8%).</p>
        </div>
        <fieldset className="flex flex-wrap gap-1 rounded-lg border border-line p-1">
          <legend className="sr-only">Population equity dimension</legend>
          {dims.map(d => (
            <label key={d} className="cursor-pointer rounded-md px-3 py-1 text-xs text-secondary has-checked:bg-raised has-checked:text-accent has-focus-visible:outline-2 has-focus-visible:outline-accent">
              <input className="sr-only" type="radio" name="equity-dimension" value={d} checked={dim === d} onChange={() => setDim(d)} />
              {d}
            </label>
          ))}
        </fieldset>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {visible.map(row => (
          <div key={`${row.program}-${row.label}-${row.dimension}`} className="rounded-lg border border-line bg-page p-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-ink">{row.label}</p>
              <span className="font-mono text-xs text-accent">Gap {row.gap_pp.toFixed(1)} pp</span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted">Stage: {row.stage === 'referral' ? '03 Referral follow-up' : '01 Detection'} · {row.year}</p>
            <ul className="mt-3 grid gap-2">
              {row.groups.map(g => (
                <li key={g.group}>
                  <div className="flex justify-between text-xs text-secondary">
                    <span>{g.group}</span>
                    <span className="font-mono tabular-nums text-ink">{g.v.toFixed(1)}%</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-xs bg-line">
                    <div className="h-full bg-accent/80" style={{ width: `${Math.max(0, Math.min(100, g.v))}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

function CountyDispersion({ snapshot }: { snapshot: PathwaySnapshot }) {
  const keyIds = ['scr_breast_att', 'scr_cervix_att', 'scr_crc_att', 'scr_crc_colo', 'lung_curative', 'lung_noinfo', 'surv_lung_male', 'surv_colorectal_both']
  const items = keyIds.flatMap(id => {
    const ind = snapshot.indicators.find(i => i.id === id)
    if (!ind || ind.unit !== '%') return []
    const vals = snapshot.counties.map(c => ({ name: c.name, v: c.values[id]?.v })).filter((x): x is { name: string; v: number } => x.v != null && Number.isFinite(x.v))
    if (vals.length < 3) return []
    vals.sort((a, b) => a.v - b.v)
    return [{ ind, min: vals[0], max: vals.at(-1)!, nat: snapshot.national[id]?.v ?? null }]
  })
  if (!items.length) return null

  return (
    <section className={panel} aria-labelledby="dispersion-title">
      <h3 id="dispersion-title" className="text-lg font-medium">Cross-county inequality range (min — Finland — max)</h3>
      <p className="mt-1 text-xs text-muted">Observed spread across Finnish wellbeing services counties on key Detection, Referral, Treatment and Goal 3 Outcome indicators</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {items.map(({ ind, min, max, nat }) => (
          <li key={ind.id} className="rounded-lg border border-line bg-page p-3">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium text-ink">{ind.short || ind.label}</span>
              <span className="font-mono text-muted">{min.v.toFixed(1)}% – {max.v.toFixed(1)}%</span>
            </div>
            <div className="relative mt-2.5 h-2 rounded-full bg-line/70" aria-hidden>
              <span className="absolute inset-y-0 rounded-full bg-accent/45" style={{ left: `${Math.max(0, min.v)}%`, width: `${Math.max(1, max.v - min.v)}%` }} />
              {nat != null && <span className="absolute -top-1 -bottom-1 w-0.5 bg-ink" style={{ left: `${Math.max(0, Math.min(100, nat))}%` }} />}
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-muted">
              <span>Low: {min.name} ({min.v.toFixed(1)}%)</span>
              {nat != null && <span>FI {nat.toFixed(1)}%</span>}
              <span>High: {max.name} ({max.v.toFixed(1)}%)</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ProvenanceSection({ snapshot }: { snapshot: PathwaySnapshot }) {
  if (!snapshot.validation && !snapshot.data_gaps?.length) return null
  return (
    <section className={panel} aria-labelledby="provenance-title">
      <div className="flex items-center gap-2">
        <ShieldCheck size={18} strokeWidth={1.5} className="text-accent" aria-hidden />
        <h3 id="provenance-title" className="text-lg font-medium">Data quality, validation &amp; acknowledged limitations</h3>
      </div>
      {snapshot.validation && (
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-page p-3">
            <dt className="text-xs text-muted">Source-integrity checks</dt>
            <dd className="mt-1 font-mono text-xl text-ink">{count(snapshot.validation.source_integrity)} passed</dd>
            <dd className="mt-0.5 text-[11px] text-muted">SHA-256 hashes, PDF magic bytes &amp; StatFin cube shapes</dd>
          </div>
          <div className="rounded-lg bg-page p-3">
            <dt className="text-xs text-muted">Analytical &amp; CI checks</dt>
            <dd className="mt-1 font-mono text-xl text-ink">{count(snapshot.validation.analytical)} passed</dd>
            <dd className="mt-0.5 text-[11px] text-muted">Leave-one-out comparators, Wilson/Katz CIs &amp; national sums</dd>
          </div>
          <div className="rounded-lg bg-page p-3">
            <dt className="text-xs text-muted">Page-verified policy citations</dt>
            <dd className="mt-1 font-mono text-xl text-ink">{snapshot.validation.citations_verified ?? 0} / {snapshot.validation.citations_total ?? 0}</dd>
            <dd className="mt-0.5 text-[11px] text-muted">Matched verbatim against archived FICAN &amp; Roadmap PDFs</dd>
          </div>
        </dl>
      )}
      {snapshot.data_gaps && snapshot.data_gaps.length > 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {snapshot.data_gaps.map((gap, i) => (
            <div key={i} className="rounded-lg border border-line bg-page p-3 text-xs">
              <p className="font-medium text-ink">Documented data gap ({gap.stage}): {gap.what}</p>
              <p className="mt-1 leading-relaxed text-muted">{gap.why}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function NationalBars({ series, label, maximum, unit }: { series: Series; label: string; maximum: number; unit: string }) {
  if (!series.length) return <p className="mt-6 text-sm text-muted">No published national values are available for this measure</p>
  return <figure aria-label={label} className="mt-6">
    <ul className="grid gap-5">
      {series.map(({ indicator, value }) => <li key={indicator.id}>
        <div className="mb-2 flex items-baseline justify-between gap-4 text-sm">
          <span className="min-w-0 text-secondary">{indicator.short || indicator.label}</span>
          <span className="shrink-0 font-mono tabular-nums">{formatValue(value.v, indicator.unit)}</span>
        </div>
        <div role="img" aria-label={`${indicator.label}: ${formatValue(value.v, indicator.unit)}, ${indicator.period}`} className="relative h-3 bg-line/50">
          <span aria-hidden className="absolute inset-y-0 left-1/2 border-l border-page" />
          <div className="relative h-full bg-accent/80" style={{ width: `${Math.max(0, Math.min(100, value.v / maximum * 100))}%` }} />
        </div>
        <p className="mt-1 text-xs text-muted">{indicator.period}</p>
      </li>)}
    </ul>
    <div aria-hidden className="mt-4 flex justify-between font-mono text-xs tabular-nums text-muted"><span>{formatValue(0, unit)}</span><span>{formatValue(maximum / 2, unit)}</span><span>{formatValue(maximum, unit)}</span></div>
  </figure>
}

function SeriesSources({ series }: { series: Series }) {
  if (!series.length) return null
  return <details className="mt-5 border-t border-line pt-4">
    <summary className="cursor-pointer text-xs text-muted hover:text-accent focus-visible:outline-2 focus-visible:outline-accent">Sources and definitions</summary>
    <ul className="mt-4 grid gap-4">
      {series.map(({ indicator, value }) => <li key={indicator.id} className="text-xs leading-relaxed text-secondary">
        <p className="font-medium text-ink">{indicator.label} · {indicator.period}</p>
        <p className="mt-1">{[formatInterval(value, indicator.unit), formatCount(value)].filter(Boolean).join(' · ')}</p>
        {indicator.desc && <p className="mt-2">{indicator.desc}</p>}
        {indicator.caveat && <p className="mt-2 text-muted">{indicator.caveat}</p>}
        {indicator.source_url && <a href={indicator.source_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent">Source report</a>}
      </li>)}
    </ul>
  </details>
}

function Outcomes({ snapshot }: { snapshot: PathwaySnapshot }) {
  const [measure, setMeasure] = useState<'survival' | 'mortality'>('survival')
  const series = nationalSeries(snapshot, id => id.startsWith(measure === 'survival' ? 'surv_' : 'mort_'))
  const maximum = measure === 'survival' ? 100 : Math.max(10, Math.ceil(Math.max(...series.map(row => row.value.v), 0) / 10) * 10)
  return <section className={panel} aria-labelledby="outcomes-chart-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 id="outcomes-chart-title" className="text-lg font-medium">Cancer outcomes</h3>
      <fieldset className="flex gap-1 rounded-lg border border-line p-1">
        <legend className="sr-only">Outcome measure</legend>
        {(['survival', 'mortality'] as const).map(value => <label key={value} className="cursor-pointer rounded-md px-3 py-1 text-xs text-secondary has-checked:bg-raised has-checked:text-accent has-focus-visible:outline-2 has-focus-visible:outline-accent">
          <input className="sr-only" type="radio" name="outcome-measure" value={value} checked={measure === value} onChange={() => setMeasure(value)} />{value === 'survival' ? 'Survival' : 'Mortality'}
        </label>)}
      </fieldset>
    </div>
    <p className="mt-2 text-xs leading-relaxed text-muted">{measure === 'survival' ? 'Five-year relative survival · higher is better' : 'Cancer deaths per 100,000 people · lower is better'}</p>
    <NationalBars series={series} label={measure === 'survival' ? 'National five-year relative survival' : 'National cancer mortality'} maximum={maximum} unit={measure === 'survival' ? '%' : '/100k'} />
    <SeriesSources key={measure} series={series} />
  </section>
}

function PathwaySignals({ snapshot }: { snapshot: PathwaySnapshot }) {
  const rows = snapshot.stages.map(stage => ({ stage, counts: stageCounts(snapshot, stage.id) }))
  return <section className={panel} aria-labelledby="signals-chart-title">
    <h3 id="signals-chart-title" className="text-lg font-medium">Where counties need review</h3>
    <p className="mt-2 text-xs text-muted">County classifications by pathway stage · {count(snapshot.counties.length)} counties</p>
    <ul aria-label="Pathway chart legend" className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
      {verdictOrder.map(id => <li key={id} className="flex items-center gap-2 text-xs text-secondary"><span className="size-2 rounded-sm" style={{ backgroundColor: verdictColors[id] }} />{verdictLabels[id]}</li>)}
    </ul>
    <figure aria-label="County classifications by care pathway stage" className="mt-6 grid gap-5">
      {rows.map(({ stage, counts }) => <div key={stage.id}>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
          <span className="text-secondary">{stage.label}</span>
          <span className="font-mono text-xs tabular-nums text-muted">{counts.act} act · {counts.verify} verify</span>
        </div>
        <div role="img" aria-label={`${stage.label}: ${verdictOrder.map(id => `${counts[id]} ${verdictLabels[id]}`).join(', ')}`} className="flex h-3 overflow-hidden rounded-sm bg-line">
          {verdictOrder.map(id => counts[id] > 0 && <span key={id} title={`${verdictLabels[id]}: ${counts[id]} counties`} style={{ width: `${100 * counts[id] / snapshot.counties.length}%`, backgroundColor: verdictColors[id] }} />)}
        </div>
      </div>)}
    </figure>
    <details className="mt-5 border-t border-line pt-4">
      <summary className="cursor-pointer text-xs text-muted hover:text-accent focus-visible:outline-2 focus-visible:outline-accent">Inspect classification counts</summary>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">County counts by stage and classification</caption>
          <thead className="text-muted"><tr><th scope="col" className="py-2 pr-3 font-normal">Stage</th>{verdictOrder.map(id => <th key={id} scope="col" className="px-2 py-2 text-right font-normal">{verdictLabels[id]}</th>)}</tr></thead>
          <tbody>{rows.map(({ stage, counts }) => <tr key={stage.id} className="border-t border-line text-secondary"><th scope="row" className="py-3 pr-3 font-normal">{stage.label}</th>{verdictOrder.map(id => <td key={id} className="px-2 py-3 text-right font-mono tabular-nums">{counts[id]}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  </section>
}
