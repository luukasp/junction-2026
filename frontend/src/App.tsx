import { useEffect, useState } from 'react'
import { Activity, ClipboardList, MapPin, TriangleAlert } from 'lucide-react'
import { KPICard } from './components/KPICard'
import { MapContainer } from './components/MapContainer'
import { ExecutiveBriefingPanel } from './components/ExecutiveBriefingPanel'
import { AreaReviewList } from './components/AreaReviewList'
import { count, percent } from './data/regions'
import { DashboardProvider, useDashboard, type Dashboard } from './data/DashboardContext'
import { api } from './lib/api'

export default function App() {
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    api<Dashboard>('/dashboard', { signal: controller.signal }).then(setData).catch(e => {
      if (!controller.signal.aborted) setError(e.message)
    })
    return () => controller.abort()
  }, [attempt])
  if (!data || !data.data_loaded) return <main className="mx-auto max-w-7xl p-8 text-secondary" aria-live="polite">
    <h1 className="text-lg text-ink">National Cancer Care Pathway</h1>
    <p className="mt-4">{error || (data ? 'The database has no imported registry data.' : 'Loading registry data…')}</p>
    <button className="mt-4 rounded-lg border border-line px-4 py-2 focus-visible:outline-2 focus-visible:outline-accent" onClick={() => { setError(''); setAttempt(a => a + 1) }}>Retry</button>
  </main>
  return <DashboardProvider data={data}><DashboardView /></DashboardProvider>
}

function DashboardView() {
  const { period, pooledShare, regions, regionsById, reportingRegions, totalMissing, totalPatients } = useDashboard()
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)
  const [briefingOpen, setBriefingOpen] = useState(false)
  const region = regionsById.get(selectedRegionId ?? '') ?? null

  function selectRegion(id: string) {
    setSelectedRegionId(id)
    setBriefingOpen(true)
  }

  return (
    <div className="min-h-dvh bg-page text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-7xl items-start gap-3 px-4 py-4 sm:px-8">
          <Activity size={16} strokeWidth={1.5} className="mt-1 shrink-0 text-accent" aria-hidden />
          <div>
            <h1 className="text-base font-semibold sm:text-lg">National Cancer Care Pathway</h1>
            <p className="mt-1 text-xs text-muted">Lung cancer documentation review · {period.replace('-', '–')}</p>
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-8">
        <section aria-label="Registry summary" className="grid divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <KPICard title="Patients without a treatment record" value={count(totalMissing)} detail={`${percent(pooledShare)} of the reporting cohort`} icon={TriangleAlert} />
          <KPICard title="Patients in the registry cohort" value={count(totalPatients)} detail="Across reporting areas" icon={ClipboardList} />
          <KPICard title="Areas with published data" value={`${reportingRegions.length} / ${regions.length}`} detail="Includes Helsinki" icon={MapPin} />
        </section>
        <p className="text-sm leading-relaxed text-secondary">Use these figures to prioritize a documentation review. Missing records can reflect incomplete reporting. Assess treatment delivery and delays with separate evidence.</p>
        <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <MapContainer selectedRegionId={selectedRegionId} onRegionSelect={selectRegion} onOpenBriefing={() => setBriefingOpen(true)} />
          <AreaReviewList selectedRegionId={selectedRegionId} onRegionSelect={selectRegion} />
        </div>
      </main>
      <ExecutiveBriefingPanel regionData={briefingOpen ? region : null} onClose={() => setBriefingOpen(false)} />
    </div>
  )
}
