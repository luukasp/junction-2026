import { useState } from 'react'
import { Activity, ClipboardList, MapPin, TriangleAlert } from 'lucide-react'
import { KPICard } from './components/KPICard'
import { MapContainer } from './components/MapContainer'
import { ExecutiveBriefingPanel } from './components/ExecutiveBriefingPanel'
import { AreaReviewList } from './components/AreaReviewList'
import { count, percent, period, pooledShare, regions, regionsById, reportingRegions, totalMissing, totalPatients } from './data/regions'

export default function App() {
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
