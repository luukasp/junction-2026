import { Download, X } from 'lucide-react'
import { twMerge } from 'tailwind-merge'
import { lazy, Suspense, useEffect, useRef } from 'react'
import { count, getCoverageBand, percent, type RegionData } from '../data/regions'
import { useDashboard } from '../data/DashboardContext'
import { asVerdict, downloadText, formatCount, formatValue, planMarkdown, verdictLabels, verdictRank, type PathwaySnapshot } from '../data/pathway'
import { ActionCard } from './ActionCard'
import { CoverageSwatch } from './CoverageSwatch'
import { VerdictBadge, VerdictDot } from './VerdictBadge'

const CountyAI = lazy(() => import('./CountyAI').then(module => ({ default: module.CountyAI })))
const link = 'text-accent underline decoration-accent/35 underline-offset-4 hover:decoration-accent focus-visible:outline-2 focus-visible:outline-accent'

type Props = { regionData: RegionData | null; onClose: () => void }

export function ExecutiveBriefingPanel({ regionData, onClose }: Props) {
  const { pooledShare, sourceUrl, period, pathway, countiesById, offline } = useDashboard()
  const closeButton = useRef<HTMLButtonElement>(null)
  const open = regionData !== null
  const county = regionData ? countiesById.get(regionData.regionId) ?? null : null

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement
    closeButton.current?.focus()
    return () => {
      if (previousFocus instanceof HTMLElement || previousFocus instanceof SVGElement) previousFocus.focus()
    }
  }, [open])

  const share = regionData?.share ?? null
  const difference = share === null ? null : Math.round((share - pooledShare) * 10) / 10

  return (
    <aside
      aria-labelledby="briefing-title"
      aria-hidden={!open}
      inert={!open}
      onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}
      className={twMerge(
        'fixed inset-y-0 right-0 z-30 h-dvh w-full max-w-xl overflow-y-auto border-l border-line bg-panel p-6 transition-transform duration-300 ease-out motion-reduce:transition-none sm:p-8',
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="briefing-title" className="text-sm font-medium text-secondary">Executive briefing</h2>
        <button ref={closeButton} onClick={onClose} type="button" aria-label="Close briefing" className="grid size-10 place-items-center rounded-lg border border-line text-secondary transition-colors duration-150 ease-out hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none"><X size={16} strokeWidth={1.5} aria-hidden /></button>
      </div>
      {regionData && (
        <>
          <p className="mt-8 font-mono text-xs text-muted">{regionData.regionId}</p>
          <p className="mt-2 text-3xl font-medium text-ink">{regionData.regionName}</p>
          {county && pathway ? <>
            <p className="mt-4 text-base leading-relaxed text-ink">{county.headline}</p>
            <button type="button" onClick={() => downloadText(`action-plan-${county.code}.md`, planMarkdown(pathway, county))}
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-medium text-page transition-colors duration-150 ease-out hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none">
              <Download size={16} strokeWidth={1.5} aria-hidden />Export action plan
            </button>
            <StageVerdicts snapshot={pathway} verdicts={county.stage_verdicts} />
            <Signals snapshot={pathway} code={county.code} />
            <section aria-labelledby="actions-title" className="mt-6">
              <h3 id="actions-title" className="text-sm font-semibold">Actions</h3>
              {county.actions.length
                ? <ol className="mt-3 grid gap-4">{county.actions.map((action, index) => <ActionCard key={`${county.code}-${action.playbook_id}-${index}`} action={action} verdict={county.stage_verdicts[action.pathway_stage]} number={index + 1} stage={pathway.stages.find(s => s.id === action.pathway_stage)?.label ?? action.pathway_stage} />)}</ol>
                : <p className="mt-2 text-sm text-secondary">No action is triggered for this area in the snapshot. Keep monitoring the signals above.</p>}
            </section>
          </> : <LungFinding regionData={regionData} share={share} difference={difference} pooledShare={pooledShare} period={period} />}
          {offline
            ? <p className="mt-6 border-t border-line pt-4 text-sm text-muted">AI review and chat need the backend. The action plan export works offline.</p>
            : <Suspense fallback={<p className="mt-4 text-sm text-muted">Loading review tools…</p>}><CountyAI key={regionData.regionId} areaCode={regionData.regionId} /></Suspense>}
          <p className="mt-6 text-xs leading-relaxed text-muted">Figures are descriptive and not risk-adjusted. A missing treatment record does not mean treatment was not given. Local clinical review comes before action.</p>
          <a href={sourceUrl} className={`mt-2 inline-block text-xs ${link}`}>Finnish Cancer Registry source report</a>
        </>
      )}
    </aside>
  )
}

function StageVerdicts({ snapshot, verdicts }: { snapshot: PathwaySnapshot; verdicts: Record<string, unknown> }) {
  return <section aria-labelledby="stage-verdicts-title" className="mt-6">
    <h3 id="stage-verdicts-title" className="text-sm font-semibold">Pathway status</h3>
    <ol className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
      {snapshot.stages.map(stage => <li key={stage.id} className="bg-panel p-3" title={stage.hint}>
        <p className="text-xs text-muted">{stage.label}</p>
        <p className="mt-1"><VerdictBadge verdict={verdicts[stage.id]} title={snapshot.verdicts[asVerdict(verdicts[stage.id])]?.desc} /></p>
      </li>)}
    </ol>
  </section>
}

function Signals({ snapshot, code }: { snapshot: PathwaySnapshot; code: string }) {
  const county = snapshot.counties.find(c => c.code === code)
  const rows = snapshot.indicators.filter(i => county?.values[i.id] && county.values[i.id].v !== null)
    .sort((a, b) => verdictRank(county!.values[a.id].verdict) - verdictRank(county!.values[b.id].verdict))
  if (!county || !rows.length) return null
  return <details className="mt-4 rounded-lg border border-line" open={rows.length <= 4}>
    <summary className="cursor-pointer px-3 py-3 text-sm text-secondary">Signals · {rows.length} indicators</summary>
    <ul className="divide-y divide-line border-t border-line">
      {rows.map(indicator => {
        const value = county.values[indicator.id]
        const national = value.comparator ?? snapshot.national[indicator.id]?.v
        return <li key={indicator.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-3 py-3 text-sm">
          <span className="text-secondary">{indicator.label}{indicator.is_proxy ? ' (proxy)' : ''}</span>
          <span className="text-right font-mono tabular-nums text-ink">{formatValue(value.v, indicator.unit)}</span>
          <span className="flex items-center gap-2 text-xs text-muted"><VerdictDot verdict={value.verdict} />{verdictLabels[asVerdict(value.verdict)]} · national {formatValue(national, indicator.unit)} · {indicator.period}</span>
          <span className="text-right font-mono text-xs tabular-nums text-muted">{formatCount(value)}</span>
        </li>
      })}
    </ul>
  </details>
}

function LungFinding({ regionData, share, difference, pooledShare, period }: { regionData: RegionData; share: number | null; difference: number | null; pooledShare: number; period: string }) {
  return <>
    <p className="mt-4 flex items-center gap-2 text-sm text-secondary">
      <CoverageSwatch band={getCoverageBand(share)} />
      {share === null ? 'Data unavailable' : <><span className="font-mono tabular-nums text-ink">{percent(share)}</span> without a treatment record</>}
    </p>
    {difference !== null && <div className="mt-4 rounded-lg border border-line bg-raised px-3 py-3 text-sm text-secondary">
      <p><span className="font-mono text-ink">{percent(pooledShare)}</span> across all reporting areas</p>
      <p className="mt-1 text-xs text-muted">{difference === 0 ? 'Matches the pooled share at this precision' : `${Math.abs(difference).toFixed(1)} percentage points ${difference > 0 ? 'above' : 'below'} the pooled share`} · {period} diagnoses</p>
    </div>}
    <p className="mt-4 text-sm leading-relaxed text-secondary">{regionData.missing === null || regionData.patients === null ? 'The source dataset has no estimate for this area.' : `${count(regionData.missing)} of ${count(regionData.patients)} patients had no treatment record in the observation window.`}</p>
  </>
}
