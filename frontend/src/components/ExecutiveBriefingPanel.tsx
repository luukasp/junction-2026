import { X } from 'lucide-react'
import { twMerge } from 'tailwind-merge'
import { lazy, Suspense, useEffect, useRef } from 'react'
import { count, getCoverageBand, percent, type RegionData } from '../data/regions'
import { useDashboard } from '../data/DashboardContext'
import { CoverageSwatch } from './CoverageSwatch'

const CountyAI = lazy(() => import('./CountyAI').then(module => ({ default: module.CountyAI })))

type Props = { regionData: RegionData | null; onClose: () => void }

export function ExecutiveBriefingPanel({ regionData, onClose }: Props) {
  const { observationWindow, pooledShare, sourceUrl, period } = useDashboard()
  const closeButton = useRef<HTMLButtonElement>(null)
  const open = regionData !== null

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement
    closeButton.current?.focus()
    return () => {
      if (previousFocus instanceof HTMLElement || previousFocus instanceof SVGElement) previousFocus.focus()
    }
  }, [open])

  const share = regionData?.share ?? null
  const band = getCoverageBand(share)
  const difference = share === null ? null : Math.round((share - pooledShare) * 10) / 10

  return (
    <aside
      aria-labelledby="briefing-title"
      aria-hidden={!open}
      inert={!open}
      onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}
      className={twMerge(
        'fixed inset-y-0 right-0 z-30 h-dvh w-full max-w-md overflow-y-auto border-l border-line bg-panel p-6 transition-transform duration-300 ease-out motion-reduce:transition-none sm:p-8',
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
          <p className="mt-4 flex items-center gap-2 text-sm text-secondary">
            <CoverageSwatch band={band} />
            {share === null ? 'Data unavailable' : <><span className="font-mono tabular-nums text-ink">{percent(share)}</span> without a treatment record</>}
          </p>
          {difference !== null && (
            <div className="mt-4 rounded-lg border border-line bg-raised px-3 py-3 text-sm text-secondary">
              <p><span className="font-mono text-ink">{percent(pooledShare)}</span> across all reporting areas</p>
              <p className="mt-1 text-xs text-muted">{difference === 0 ? 'Matches the pooled share at this precision' : `${Math.abs(difference).toFixed(1)} percentage points ${difference > 0 ? 'above' : 'below'} the pooled share`} · {period} diagnoses</p>
            </div>
          )}
          <div className="mt-6 divide-y divide-line border-y border-line">
            <section className="py-4">
              <h3 className="text-sm font-semibold">Registry finding</h3>
              <p className="mt-2 text-sm leading-relaxed text-secondary">{regionData.missing === null || regionData.patients === null ? 'The source dataset has no estimate for this area.' : `${count(regionData.missing)} of ${count(regionData.patients)} patients had no treatment record in the observation window.`}</p>
              {share !== null && <p className="mt-2 text-sm leading-relaxed text-muted">Missing records may reflect incomplete reporting. Area comparisons use unadjusted rates.</p>}
            </section>
            <section className="py-4">
              <h3 className="text-sm font-semibold">Treatment documentation</h3>
              <p className="mt-2 text-sm text-secondary">{observationWindow}</p>
            </section>

          </div>
          <Suspense fallback={<p className="mt-4 text-sm text-muted">Loading review tools…</p>}><CountyAI key={regionData.regionId} areaCode={regionData.regionId} /></Suspense>
          <a href={sourceUrl} className="mt-4 inline-block text-sm text-accent underline decoration-accent/35 underline-offset-4 hover:decoration-accent focus-visible:outline-2 focus-visible:outline-accent">Finnish Cancer Registry source report</a>
        </>
      )}
    </aside>
  )
}
