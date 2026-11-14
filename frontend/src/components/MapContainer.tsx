import { ComposableMap, Geographies, Geography } from 'react-simple-maps'
import { getCoverageBand, percent, type CoverageBand } from '../data/regions'
import { useDashboard } from '../data/DashboardContext'
import { CoverageSwatch } from './CoverageSwatch'
import { coverageColors } from './coverageColors'

type Props = { selectedRegionId: string | null; onRegionSelect: (id: string) => void; onOpenBriefing: () => void }

const bands = Object.keys(coverageColors) as CoverageBand[]

export function MapContainer({ selectedRegionId, onRegionSelect, onOpenBriefing }: Props) {
  const { regions, regionsById, sourceUrl } = useDashboard()
  return (
    <section aria-labelledby="map-title" className="@container min-w-0 overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-4 py-4 sm:px-6">
        <div>
          <h2 id="map-title" className="text-lg font-semibold">Treatment records by area</h2>
          <p className="mt-1 text-sm text-secondary">Share of lung cancer patients without a treatment record</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
        <label className="grid min-w-0 gap-1 text-xs text-muted">
          Area briefing
          <select value={selectedRegionId ?? ''} onChange={(event) => onRegionSelect(event.target.value)} className="h-10 max-w-full rounded-lg border border-line bg-raised px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent">
            <option value="" disabled>Select an area</option>
            {regions.map((region) => <option key={region.regionId} value={region.regionId}>{region.regionName}</option>)}
          </select>
        </label>
        {selectedRegionId && <button type="button" onClick={onOpenBriefing} className="h-10 rounded-lg border border-line px-3 text-sm text-accent hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent">Open briefing</button>}
        </div>
      </div>
      <div className="grid bg-map @min-[760px]:grid-cols-[minmax(0,1fr)_248px]">
        <ComposableMap aria-label="Map of Finnish wellbeing services counties" width={420} height={570} projection="geoMercator" projectionConfig={{ center: [26.2, 65.15], scale: 1240 }} className="h-[400px] w-full sm:h-[544px]">
          <Geographies geography={`${import.meta.env.BASE_URL}finland.geojson`}>
            {({ geographies }) => geographies.map((geography) => {
              const id = `HVA${geography.properties?.hyvinvointialue}`
              const region = regionsById.get(id)
              const share = region?.share ?? null
              const band = getCoverageBand(share)
              const selected = selectedRegionId === id
              return (
                <Geography
                  key={geography.rsmKey}
                  geography={geography}
                  role={region ? 'button' : undefined}
                  tabIndex={region ? 0 : undefined}
                  aria-label={region ? `${region.regionName}, ${share === null ? 'data unavailable' : percent(share)}` : undefined}
                  aria-pressed={region ? selected : undefined}
                  fill={coverageColors[band]}
                  stroke={selected ? '#f1f2ef' : '#191c1e'}
                  strokeWidth={selected ? 2 : 1}
                  className={region ? 'cursor-pointer transition-[fill,stroke] duration-150 ease-out hover:fill-ink focus-visible:stroke-2 focus-visible:outline-none motion-reduce:transition-none' : undefined}
                  onClick={region ? () => onRegionSelect(id) : undefined}
                  onKeyDown={region ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onRegionSelect(id)
                    }
                  } : undefined}
                />
              )
            })}
          </Geographies>
        </ComposableMap>
        <div className="flex flex-col gap-4 border-t border-line bg-panel p-4 sm:p-6 @min-[760px]:border-t-0 @min-[760px]:border-l">
          <div>
            <h3 className="text-sm font-medium">Missing record share</h3>
            <ul aria-label="Map legend" className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-secondary @min-[760px]:grid-cols-1">
              {bands.map((band) => <li key={band} className="flex items-center gap-2"><CoverageSwatch band={band} /><span className="font-mono text-xs">{band}</span></li>)}
            </ul>
            <p className="mt-2 text-xs text-muted">Color bands group observed rates for display.</p>
          </div>
          <a href={sourceUrl} className="w-fit text-xs text-accent underline decoration-accent/35 underline-offset-4 hover:decoration-accent focus-visible:outline-2 focus-visible:outline-accent">Finnish Cancer Registry</a>
        </div>
      </div>
    </section>
  )
}
