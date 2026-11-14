import { lazy, Suspense } from 'react'
import { Download } from 'lucide-react'
import { useDashboard } from '../data/DashboardContext'
import { asVerdict, downloadText, formatCount, formatInterval, formatValue, planMarkdown, polarityText, verdictRank, type PathwayCounty, type PathwaySnapshot } from '../data/pathway'
import { ActionCard } from './ActionCard'
import { VerdictBadge } from './VerdictBadge'
import { CountyMap } from './CountyMap'

const CountyAI = lazy(() => import('./CountyAI').then(module => ({ default: module.CountyAI })))
type Props = { selectedCountyId: string | null; onCountyChange: (id: string) => void }

export function CountyReview({ selectedCountyId, onCountyChange }: Props) {
  const { pathway, regions } = useDashboard()
  const counties = Array.from(new Map([
    ...regions.map(region => [region.regionId, { code: region.regionId, name: region.regionName }] as const),
    ...(pathway?.counties ?? []).map(county => [county.code, county] as const),
  ]).values()).sort((a, b) => a.name.localeCompare(b.name, 'en'))
  const selected = counties.find(county => county.code === selectedCountyId) ?? counties[0]
  const county = pathway?.counties.find(county => county.code === selected?.code)

  return <main id="dashboard-content" className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-8">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-2xl font-medium">County Review</h2>
        <p className="mt-2 text-sm text-secondary">Local care gaps and practical next steps</p>
      </div>
      <div className="grid w-full gap-2 sm:w-64">
        <label htmlFor="review-county" className="text-xs text-muted">County</label>
        <select id="review-county" value={selected?.code ?? ''} disabled={!counties.length} onChange={event => onCountyChange(event.target.value)}
          className="min-h-10 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent">
          {counties.map(county => <option key={county.code} value={county.code}>{county.name}</option>)}
        </select>
      </div>
    </div>
    {county && pathway
      ? <CountyContent key={county.code} county={county} snapshot={pathway} onCountyChange={onCountyChange} />
      : <><section className="rounded-xl border border-line bg-panel p-6" role="status">
        <h3 className="text-lg font-medium">{selected?.name ?? 'No counties available'}</h3>
        <p className="mt-2 text-sm text-secondary">No pathway review is available for this county in the current snapshot. Choose another county to review its signals and actions.</p>
      </section>{selected && <CountyMap countyId={selected.code} countyName={selected.name} onCountyChange={onCountyChange} />}</>}
  </main>
}

function CountyContent({ county, snapshot, onCountyChange }: { county: PathwayCounty; snapshot: PathwaySnapshot; onCountyChange: (id: string) => void }) {
  const { offline } = useDashboard()
  const flagged = snapshot.stages.filter(stage => ['act', 'verify'].includes(asVerdict(county.stage_verdicts[stage.id]))).length
  const available = snapshot.indicators.filter(indicator => county.values[indicator.id]?.v != null).length

  return <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_24rem]">
    <div className="grid min-w-0 gap-6">
      <section aria-label="County summary">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-xl font-medium">{county.name}</h3>
          <button type="button" onClick={() => downloadText(`action-plan-${county.code}.md`, planMarkdown(snapshot, county))}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-secondary hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent">
            <Download size={16} strokeWidth={1.5} aria-hidden />Export action plan
          </button>
        </div>
        <p className="mt-3 max-w-4xl text-base leading-relaxed text-secondary">{county.headline}</p>
        <dl className="mt-6 grid divide-y divide-line rounded-xl border border-line bg-panel lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          {[
            { label: 'Stages to review', value: `${flagged} / ${snapshot.stages.length}`, detail: 'Act or verify data' },
            { label: 'Recommended actions', value: String(county.actions.length), detail: 'Expand an action for its plan' },
            { label: 'Indicators available', value: `${available} / ${snapshot.indicators.length}`, detail: 'Reported in this snapshot' },
          ].map(stat => <div key={stat.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 px-4 py-3 lg:block lg:p-5">
            <dt className="text-sm text-secondary">{stat.label}</dt>
            <dd className="font-mono text-2xl tabular-nums lg:mt-2">{stat.value}</dd>
            <dd className="mt-2 hidden text-xs text-muted lg:block">{stat.detail}</dd>
          </div>)}
        </dl>
      </section>
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
        <section aria-labelledby="county-actions-title" className="min-w-0">
          <h3 id="county-actions-title" className="text-lg font-medium">Recommended actions</h3>
          <p className="mt-1 text-xs text-muted">Owners, targets and first steps are inside each action</p>
          {county.actions.length
            ? <ol className="mt-4 grid gap-3">{county.actions.map((action, index) => <ActionCard key={`${action.playbook_id}-${index}`} action={action} number={index + 1} verdict={county.stage_verdicts[action.pathway_stage]} stage={snapshot.stages.find(stage => stage.id === action.pathway_stage)?.label ?? action.pathway_stage} />)}</ol>
            : <p className="mt-4 rounded-xl border border-line bg-panel p-4 text-sm leading-relaxed text-secondary">No action is triggered for this county. Continue monitoring the pathway and review any data gaps below.</p>}
        </section>
        <section aria-labelledby="county-pathway-title" className="rounded-xl border border-line bg-panel">
          <h3 id="county-pathway-title" className="border-b border-line p-4 text-sm font-medium">Pathway status</h3>
          <ul className="divide-y divide-line">
            {snapshot.stages.map(stage => <li key={stage.id} className="flex items-center justify-between gap-4 px-4 py-3" title={stage.hint}>
              <span className="text-sm text-secondary">{stage.label}</span>
              <span className="shrink-0"><VerdictBadge verdict={county.stage_verdicts[stage.id]} title={snapshot.verdicts[asVerdict(county.stage_verdicts[stage.id])]?.desc} /></span>
            </li>)}
          </ul>
        </section>
      </div>
      <CountyMap countyId={county.code} countyName={county.name} onCountyChange={onCountyChange} />
      <CountyIndicators county={county} snapshot={snapshot} />
      <p className="text-xs leading-relaxed text-muted">Figures are descriptive and not risk-adjusted. Missing records can reflect incomplete reporting rather than missing treatment. Referral stages use proxies.{snapshot.placeholder ? ' This build bundles a lung-only placeholder snapshot.' : ''}</p>
    </div>
    <aside aria-labelledby="county-review-tools-title" className="min-w-0 overflow-hidden rounded-xl border border-line bg-panel xl:sticky xl:top-6 xl:max-h-[calc(100dvh-3rem)] xl:overflow-y-auto">
      <h3 id="county-review-tools-title" className="sticky top-0 z-10 border-b border-line bg-panel p-4 text-sm font-medium">Review tools and county questions</h3>
      <div className="min-w-0 p-4 [&>section]:mt-0 [&>section]:border-t-0 [&>section]:pt-0 [&_textarea]:min-w-0">
        {offline
          ? <p className="text-sm text-muted">AI review and chat need the backend. The action plan export works offline.</p>
          : <Suspense fallback={<p className="text-sm text-muted">Loading review tools…</p>}><CountyAI areaCode={county.code} /></Suspense>}
      </div>
    </aside>
  </div>
}

function CountyIndicators({ county, snapshot }: { county: PathwayCounty; snapshot: PathwaySnapshot }) {
  const indicators = [...snapshot.indicators].sort((a, b) => verdictRank(county.values[a.id]?.verdict) - verdictRank(county.values[b.id]?.verdict))

  return <details className="overflow-hidden rounded-xl border border-line bg-panel">
    <summary className="cursor-pointer p-4 text-sm font-medium hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">Inspect indicators · {indicators.length}</summary>
    <p className="border-t border-line px-4 py-3 text-xs text-muted">Priority signals first. Expand a signal for its comparison, period and source.</p>
    <ul className="divide-y divide-line border-t border-line">
      {indicators.map(indicator => {
        const value = county.values[indicator.id]
        const comparator = value?.comparator ?? snapshot.national[indicator.id]?.v
        const comparatorLabel = value?.comparator != null && value.comparator_kind === 'leave_one_out' ? 'Rest of Finland' : 'National'
        const source = indicator.source_url
        return <li key={indicator.id}>
          <details>
            <summary className="cursor-pointer px-4 py-3 hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
              <span className="ml-1 inline-grid w-[calc(100%-2rem)] grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-2 align-middle text-sm">
                <span className="text-secondary">{indicator.label}{indicator.is_proxy ? ' (proxy)' : ''}</span>
                <span className="text-right font-mono tabular-nums">{formatValue(value?.v, indicator.unit)}</span>
                <span className="text-xs text-muted">{value?.period ?? indicator.period}</span>
                <span className="text-right"><VerdictBadge verdict={value?.v == null ? 'nodata' : value.verdict} /></span>
              </span>
            </summary>
            <div className="grid gap-3 border-t border-line bg-page p-4 text-sm text-secondary">
              {value?.v == null ? <p>No published value for this county in this period</p> : <>
                <p>{comparatorLabel}: <span className="font-mono tabular-nums text-ink">{formatValue(comparator, indicator.unit)}</span>{polarityText(indicator) ? ` · ${polarityText(indicator)}` : ''}</p>
                {value.reason && <p className="leading-relaxed">{value.reason}</p>}
                {[formatInterval(value, indicator.unit), formatCount(value)].filter(Boolean).length > 0 && <p className="text-xs text-muted">{[formatInterval(value, indicator.unit), formatCount(value)].filter(Boolean).join(' · ')}</p>}
              </>}
              {indicator.desc && <p className="text-xs leading-relaxed text-muted">{indicator.desc}</p>}
              {indicator.caveat && <p className="text-xs leading-relaxed text-muted">{indicator.caveat}</p>}
              {source && <a href={source} target="_blank" rel="noreferrer" className="justify-self-start text-xs text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent">Source report</a>}
            </div>
          </details>
        </li>
      })}
    </ul>
  </details>
}
