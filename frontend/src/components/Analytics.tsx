import { useState } from 'react'
import { useDashboard } from '../data/DashboardContext'
import { nationalSeries, nationalStatus } from '../data/analytics'
import { count } from '../data/regions'
import { formatCount, formatInterval, formatValue, stageCounts, verdictColors, verdictLabels, verdictOrder, type PathwaySnapshot } from '../data/pathway'

const panel = 'min-w-0 rounded-xl border border-line bg-panel p-4 sm:p-5'
type Series = ReturnType<typeof nationalSeries>

export function Analytics() {
  const { pathway } = useDashboard()
  return <main id="dashboard-content" className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-8">
    <div>
      <h2 className="text-2xl font-medium">Analytics</h2>
      <p className="mt-2 text-sm text-secondary">National cancer care · latest published statistics</p>
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
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-secondary">Act signals identify priorities for local review. Verify signals call for checking the evidence before drawing conclusions about care.</p>
    </section>
    <dl aria-label="National summary" className="grid divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel lg:grid-cols-3 lg:divide-x lg:divide-y-0">
      {[
        { label: 'Counties with Act signals', value: `${status.act} / ${status.total}`, detail: `${status.classified} counties have classified pathway data` },
        { label: 'Lung patients without a treatment record', value: lung ? formatValue(lung.value.v, lung.indicator.unit) : 'Unavailable', detail: lung ? [formatCount(lung.value), lung.indicator.period].filter(Boolean).join(' · ') : 'No published national estimate' },
        { label: 'National indicators available', value: `${available} / ${snapshot.indicators.length}`, detail: 'Reporting periods vary by indicator' },
      ].map(stat => <div key={stat.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 p-4 sm:p-5 lg:block">
        <dt className="text-sm text-secondary">{stat.label}</dt>
        <dd className="font-mono text-2xl tabular-nums lg:mt-2">{stat.value}</dd>
        <dd className="col-span-2 text-xs text-muted lg:mt-2">{stat.detail}</dd>
      </div>)}
    </dl>
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
    <p className="text-xs leading-relaxed text-muted">These figures describe different cohorts and reporting periods. Screening and treatment measures are not risk-adjusted; outcome rates are age-standardised where stated in the source. Signals support clinical review and are not a ranking of care quality.{snapshot.placeholder ? ' This snapshot contains lung treatment data only.' : ''}</p>
  </>
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
