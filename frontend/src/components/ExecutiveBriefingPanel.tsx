import { Download, Maximize2, Minimize2, X } from 'lucide-react'
import { twMerge } from 'tailwind-merge'
import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { count, getCoverageBand, percent, type RegionData } from '../data/regions'
import { useDashboard } from '../data/DashboardContext'
import { asVerdict, downloadText, formatCount, formatValue, planMarkdown, verdictLabels, verdictRank, type PathwaySnapshot } from '../data/pathway'
import { ActionCard } from './ActionCard'
import { CoverageSwatch } from './CoverageSwatch'
import { VerdictBadge, VerdictDot } from './VerdictBadge'

const CountyAI = lazy(() => import('./CountyAI').then(module => ({ default: module.CountyAI })))
const link = 'text-accent underline decoration-accent/35 underline-offset-4 hover:decoration-accent focus-visible:outline-2 focus-visible:outline-accent'
const iconButton = 'grid size-10 shrink-0 place-items-center rounded-lg border border-line text-secondary transition-colors duration-150 ease-out hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none'

type Props = { regionData: RegionData | null; onClose: () => void }

export function ExecutiveBriefingPanel({ regionData, onClose }: Props) {
  const { pooledShare, sourceUrl, period, pathway, countiesById, offline } = useDashboard()
  const closeButton = useRef<HTMLButtonElement>(null)
  const fullscreenButton = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState(false)
  const open = regionData !== null
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    setExpanded(false)
  }
  const fullscreen = open && expanded
  const county = regionData ? countiesById.get(regionData.regionId) ?? null : null

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement
    closeButton.current?.focus()
    return () => {
      if (previousFocus instanceof HTMLElement || previousFocus instanceof SVGElement) previousFocus.focus()
    }
  }, [open])

  useEffect(() => {
    if (!fullscreen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [fullscreen])

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (fullscreen) {
        setExpanded(false)
        fullscreenButton.current?.focus()
      } else onClose()
    }
    if (fullscreen && event.key === 'Tab') {
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], textarea, input, select, summary, [tabindex="0"]'))
        .filter(element => !element.closest('[hidden], [inert]') && !element.matches(':disabled') && element.getClientRects().length > 0)
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
  }

  const share = regionData?.share ?? null
  const difference = share === null ? null : Math.round((share - pooledShare) * 10) / 10

  return (
    <aside
      aria-labelledby="briefing-title"
      aria-hidden={!open}
      inert={!open}
      onKeyDown={onKeyDown}
      className={twMerge(
        'fixed inset-y-0 right-0 z-30 flex h-dvh w-full max-w-xl flex-col border-l border-line bg-panel transition-transform duration-300 ease-out motion-reduce:transition-none',
        fullscreen && 'max-w-none border-l-0',
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-6 py-4 sm:px-8">
        <h2 id="briefing-title" className="text-sm font-medium text-secondary">Executive briefing</h2>
        <div className="flex items-center gap-2">
          <button ref={fullscreenButton} onClick={() => setExpanded(value => !value)} type="button" aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'} aria-pressed={fullscreen} title={fullscreen ? 'Exit full screen (Esc)' : 'Enter full screen'} className={iconButton}>
            {fullscreen ? <Minimize2 size={16} strokeWidth={1.5} aria-hidden /> : <Maximize2 size={16} strokeWidth={1.5} aria-hidden />}
          </button>
          <button ref={closeButton} onClick={onClose} type="button" aria-label="Close briefing" className={iconButton}><X size={16} strokeWidth={1.5} aria-hidden /></button>
        </div>
      </div>
      {regionData && (
        <div className={twMerge('min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6 sm:px-8 sm:pb-8', fullscreen && 'flex flex-col lg:overflow-hidden')}>
          <div className={twMerge('shrink-0', fullscreen && 'flex flex-wrap items-start justify-between gap-4')}>
            <div className="min-w-0">
              <p className="font-mono text-xs text-muted">{regionData.regionId}</p>
              <p className="mt-2 text-3xl font-medium text-ink">{regionData.regionName}</p>
              {county && pathway && <p className={twMerge('mt-4 text-base leading-relaxed text-ink', fullscreen && 'mt-2 max-w-4xl')}>{county.headline}</p>}
            </div>
            {county && pathway && <button type="button" onClick={() => downloadText(`action-plan-${county.code}.md`, planMarkdown(pathway, county))}
              className={twMerge('mt-4 inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-medium text-page transition-colors duration-150 ease-out hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none', fullscreen && 'mt-0')}>
              <Download size={16} strokeWidth={1.5} aria-hidden />Export action plan
            </button>}
          </div>
          <div className={twMerge(fullscreen && 'mt-6 grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-2 lg:overflow-hidden', fullscreen && county && pathway && 'xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1.15fr)]')}>
            <div className={twMerge('min-w-0', fullscreen && 'lg:overflow-y-auto lg:overscroll-contain lg:pr-2')}>
              {county && pathway ? <>
                <StageVerdicts snapshot={pathway} verdicts={county.stage_verdicts} fullscreen={fullscreen} />
                <Signals snapshot={pathway} code={county.code} />
              </> : <LungFinding regionData={regionData} share={share} difference={difference} pooledShare={pooledShare} period={period} />}
            </div>
            {county && pathway && <section aria-labelledby="actions-title" className={twMerge('mt-6 min-w-0', fullscreen && 'mt-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-2')}>
              <h3 id="actions-title" className="text-sm font-semibold">Actions</h3>
              {county.actions.length
                ? <ol className="mt-3 grid gap-4">{county.actions.map((action, index) => <ActionCard key={`${county.code}-${action.playbook_id}-${index}`} action={action} verdict={county.stage_verdicts[action.pathway_stage]} number={index + 1} stage={pathway.stages.find(s => s.id === action.pathway_stage)?.label ?? action.pathway_stage} />)}</ol>
                : <p className="mt-2 text-sm text-secondary">No action is triggered for this area in the snapshot. Keep monitoring the signals above.</p>}
            </section>}
            <div className={twMerge('min-w-0', fullscreen && 'lg:overflow-y-auto lg:overscroll-contain lg:pr-2 [&>section]:mt-0 [&>section]:border-t-0 [&>section]:pt-0', fullscreen && county && pathway && 'lg:col-span-2 xl:col-span-1')}>
              {offline
                ? <p className={twMerge('mt-6 border-t border-line pt-4 text-sm text-muted', fullscreen && 'mt-0 border-t-0 pt-0')}>AI review and chat need the backend. The action plan export works offline.</p>
                : <Suspense fallback={<p className="mt-4 text-sm text-muted">Loading review tools…</p>}><CountyAI key={regionData.regionId} areaCode={regionData.regionId} /></Suspense>}
            </div>
          </div>
          <footer className="shrink-0">
            <p className="mt-6 text-xs leading-relaxed text-muted">Figures are descriptive and not risk-adjusted. A missing treatment record does not mean treatment was not given. Local clinical review comes before action.</p>
            <a href={sourceUrl} className={`mt-2 inline-block text-xs ${link}`}>Finnish Cancer Registry source report</a>
          </footer>
        </div>
      )}
    </aside>
  )
}

function StageVerdicts({ snapshot, verdicts, fullscreen }: { snapshot: PathwaySnapshot; verdicts: Record<string, unknown>; fullscreen: boolean }) {
  return <section aria-labelledby="stage-verdicts-title" className={fullscreen ? '' : 'mt-6'}>
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
