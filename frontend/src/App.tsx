import { useEffect, useState } from 'react'
import { Activity, ClipboardList, MapPin, TriangleAlert, WifiOff } from 'lucide-react'
import { KPICard } from './components/KPICard'
import { MapContainer } from './components/MapContainer'
import { ExecutiveBriefingPanel } from './components/ExecutiveBriefingPanel'
import { AreaReviewList } from './components/AreaReviewList'
import { IndicatorAreaList } from './components/IndicatorAreaList'
import { PathwayExplorer } from './components/PathwayExplorer'
import { Sidebar } from './components/Sidebar'
import { CountyReview } from './components/CountyReview'
import { count, percent } from './data/regions'
import { DashboardProvider, useDashboard } from './data/DashboardContext'
import { defaultIndicatorId, fallbackHeadline } from './data/pathway'
import { loadData, type LoadedData } from './data/loadData'

const PRODUCT_NAME = 'Equal Care Finland'

export default function App() {
  const [loaded, setLoaded] = useState<LoadedData | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    loadData(controller.signal).then(setLoaded).catch(e => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Data could not be loaded')
    })
    return () => controller.abort()
  }, [attempt])
  if (!loaded) return <main className="mx-auto max-w-7xl p-8 text-secondary" aria-live="polite">
    <h1 className="text-lg text-ink">{PRODUCT_NAME}</h1>
    <p className="mt-4">{error || 'Loading cancer care data…'}</p>
    {error && <button className="mt-4 rounded-lg border border-line px-4 py-2 focus-visible:outline-2 focus-visible:outline-accent" onClick={() => { setError(''); setAttempt(a => a + 1) }}>Retry</button>}
  </main>
  return <DashboardProvider data={loaded.data} pathway={loaded.pathway} offline={loaded.offline}>
    <DashboardView notice={loaded.notice} onRetry={() => { setLoaded(null); setAttempt(a => a + 1) }} />
  </DashboardProvider>
}

function DashboardView({ notice, onRetry }: { notice: string; onRetry: () => void }) {
  const { period, pooledShare, regions, regionsById, reportingRegions, totalMissing, totalPatients, pathway, offline } = useDashboard()
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)
  const [briefingOpen, setBriefingOpen] = useState(false)
  const [view, setView] = useState<'national' | 'county'>('national')
  const [indicatorId, setIndicatorId] = useState<string | null>(() => pathway ? defaultIndicatorId(pathway) : null)
  const region = regionsById.get(selectedRegionId ?? '') ?? null
  const headline = pathway?.national_headline || fallbackHeadline(regions)
  const flagged = pathway?.counties.filter(c => Object.values(c.stage_verdicts).includes('act')).length ?? 0
  const pathwayIndicator = pathway && indicatorId && pathway.indicators.some(i => i.id === indicatorId) ? indicatorId : null

  function selectRegion(id: string) {
    setSelectedRegionId(id)
    setBriefingOpen(true)
  }

  return (
    <div className="min-h-dvh bg-page text-ink md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <a href="#dashboard-content" className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-ink focus:p-3 focus:text-page">Skip to dashboard</a>
      <Sidebar view={view} onNavigate={next => { setView(next); setBriefingOpen(false) }} />
      <div className="min-w-0">
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-7xl items-start gap-3 px-4 py-4 sm:px-8">
            <Activity size={16} strokeWidth={1.5} className="mt-1 shrink-0 text-accent" aria-hidden />
            <div>
              <h1 className="text-base font-semibold sm:text-lg">{PRODUCT_NAME}</h1>
              <p className="mt-1 text-xs text-muted">Where cancer care gaps emerge across Finland's wellbeing services counties, and what to do next{pathway?.built ? ` · data built ${pathway.built.slice(0, 10)}` : ''}</p>
            </div>
          </div>
        </header>
        {offline && notice && <div role="status" className="border-b border-line bg-raised">
          <p className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-2 text-sm text-secondary sm:px-8">
            <WifiOff size={16} strokeWidth={1.5} aria-hidden className="text-muted" />{notice}
            <button type="button" onClick={onRetry} className="ml-auto rounded-lg border border-line px-3 py-1 text-xs text-accent hover:bg-panel focus-visible:outline-2 focus-visible:outline-accent">Retry live data</button>
          </p>
        </div>}
        {view === 'county' ? <CountyReview selectedCountyId={selectedRegionId} onCountyChange={setSelectedRegionId} /> : <main id="dashboard-content" className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-8">
          <h2 className="text-2xl font-medium">National Overview</h2>
          {headline && <section aria-label="National headline" className="py-2">
            <p className="max-w-4xl text-xl leading-snug text-ink sm:text-2xl">{headline}</p>
          </section>}
          <section aria-label="Summary" className="grid divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel lg:grid-cols-3 lg:divide-x lg:divide-y-0">
            <KPICard title="Lung cancer patients without a treatment record" value={count(totalMissing)} detail={`${percent(pooledShare)} of ${count(totalPatients)} patients in ${reportingRegions.length} reporting areas, ${period.replace('-', '–')}`} icon={TriangleAlert} />
            {pathway
              ? <KPICard title="Areas with an Act signal" value={`${flagged} / ${pathway.counties.length}`} detail="At least one pathway stage clearly worse than national" icon={MapPin} />
              : <KPICard title="Areas with published data" value={`${reportingRegions.length} / ${regions.length}`} detail="Includes Helsinki" icon={MapPin} />}
            <KPICard title="Indicators tracked" value={String(pathway?.indicators.length ?? 1)} detail={pathway ? `Across ${pathway.stages.length} care pathway stages` : 'Lung treatment records'} icon={ClipboardList} />
          </section>
          {pathway && pathway.indicators.length > 0 && <PathwayExplorer snapshot={pathway} indicatorId={pathwayIndicator} onIndicatorChange={setIndicatorId} selectedCountyId={selectedRegionId} />}
          <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <MapContainer selectedRegionId={selectedRegionId} onRegionSelect={setSelectedRegionId} onOpenBriefing={() => setBriefingOpen(true)} indicatorId={pathwayIndicator} />
            {pathway && pathwayIndicator
              ? <IndicatorAreaList snapshot={pathway} indicatorId={pathwayIndicator} selectedRegionId={selectedRegionId} onRegionSelect={selectRegion} />
              : <AreaReviewList selectedRegionId={selectedRegionId} onRegionSelect={selectRegion} />}
          </div>
          <p className="text-xs leading-relaxed text-muted">Figures are descriptive and not risk-adjusted. Missing records can reflect incomplete reporting rather than missing treatment. Referral stages use proxies.{pathway?.placeholder ? ' This build bundles a lung-only placeholder snapshot.' : ''}</p>
        </main>}
      </div>
      {view === 'national' && <ExecutiveBriefingPanel regionData={briefingOpen ? region : null} onClose={() => setBriefingOpen(false)} />}
    </div>
  )
}
