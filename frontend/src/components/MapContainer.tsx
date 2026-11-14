import { useEffect, useRef, useState } from 'react'
import { LocateFixed, Minus, Plus, X } from 'lucide-react'
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { getCoverageBand, percent, type CoverageBand } from '../data/regions'
import { useDashboard } from '../data/DashboardContext'
import { careCenters, getCareCenters, type CareCenter } from '../data/careCenters'
import { fitGeography, MAP_EXTENT, MAP_HEIGHT, MAP_WIDTH, MAX_ZOOM, MIN_ZOOM, NATIONAL_CENTER, NATIONAL_POSITION, panPosition, zoomPosition, type MapPosition } from '../data/mapViewport'
import { CoverageSwatch } from './CoverageSwatch'
import { coverageColors } from './coverageColors'
import { CareCenterMarkers } from './CareCenterMarkers'
import { asVerdict, formatValue, verdictColors, verdictLabels, verdictOrder } from '../data/pathway'
import { VerdictDot } from './VerdictBadge'

type Props = { selectedRegionId: string | null; onRegionSelect: (id: string) => void; onOpenBriefing: () => void; indicatorId?: string | null }
const bands = Object.keys(coverageColors) as CoverageBand[]
const controlClass = 'grid size-10 place-items-center rounded-lg border border-line bg-panel text-secondary hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40'
const featureId = (feature: Feature<Geometry>) => `HVA${String(feature.properties?.hyvinvointialue).padStart(2, '0')}`

export function MapContainer({ selectedRegionId, onRegionSelect, onOpenBriefing, indicatorId = null }: Props) {
  const { regions, regionsById, sourceUrl, pathway, countiesById } = useDashboard()
  const indicator = indicatorId ? pathway?.indicators.find(item => item.id === indicatorId) ?? null : null
  const [geography, setGeography] = useState<FeatureCollection | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [viewport, setViewport] = useState<{ regionId: string | null; position: MapPosition }>({ regionId: null, position: NATIONAL_POSITION })
  const [selectedCenterId, setSelectedCenterId] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const mapRef = useRef<SVGSVGElement>(null)
  const [markerScale, setMarkerScale] = useState(1)
  const focusedCounty = geography?.features.find(feature => featureId(feature) === selectedRegionId)
  const position = viewport.regionId === selectedRegionId ? viewport.position : focusedCounty ? fitGeography(focusedCounty) : NATIONAL_POSITION
  const selectedCenter = careCenters.find(center => center.id === selectedCenterId && center.regionId === selectedRegionId)
  const selectedRegion = regionsById.get(selectedRegionId ?? '')
  const countyCenters = selectedRegionId ? getCareCenters(selectedRegionId) : []

  // A county may also be selected in the review table. Adjust before rendering
  // children so returning to a county always fits it, even after manual panning.
  if (viewport.regionId !== selectedRegionId && (focusedCounty || selectedRegionId === null)) {
    setViewport({ regionId: selectedRegionId, position: focusedCounty ? fitGeography(focusedCounty) : NATIONAL_POSITION })
    setSelectedCenterId(null)
  }

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${import.meta.env.BASE_URL}finland.geojson`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('Map unavailable'); return response.json() })
      .then((data: FeatureCollection) => {
        if (data.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.features.length === 0) throw new Error('Invalid map')
        setGeography(data)
      })
      .catch(() => { if (!controller.signal.aborted) setLoadError(true) })
    return () => controller.abort()
  }, [attempt])

  useEffect(() => {
    const element = mapRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setMarkerScale(Math.max(1, 1 / Math.min(width / MAP_WIDTH, height / MAP_HEIGHT)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [geography])

  function moveTo(next: MapPosition) {
    setMoving(false)
    setViewport({ regionId: selectedRegionId, position: next })
  }

  function selectCounty(id: string) {
    setMoving(false)
    setSelectedCenterId(null)
    onRegionSelect(id)
    const county = geography?.features.find(feature => featureId(feature) === id)
    if (county) setViewport({ regionId: id, position: fitGeography(county) })
  }

  function selectCenter(center: CareCenter) {
    setMoving(false)
    setSelectedCenterId(center.id)
    if (center.regionId !== selectedRegionId) onRegionSelect(center.regionId)
    setViewport({ regionId: center.regionId, position: { coordinates: center.coordinates, zoom: Math.max(5, Math.min(position.zoom, 16)) } })
  }

  return (
    <section aria-labelledby="map-title" className="@container min-w-0 overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-4 py-4 sm:px-6">
        <div>
          <h2 id="map-title" className="text-lg font-semibold">{indicator ? 'Status by area' : 'Treatment records by area'}</h2>
          <p className="mt-1 text-sm text-secondary">{indicator ? `${indicator.label} · ${indicator.period}` : 'Share of lung cancer patients without a treatment record'}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-0 gap-1 text-xs text-muted">
            County
            <select value={selectedRegionId ?? ''} onChange={event => selectCounty(event.target.value)} className="h-10 max-w-full rounded-lg border border-line bg-raised px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent">
              <option value="" disabled>Select a county</option>
              {regions.map(region => <option key={region.regionId} value={region.regionId}>{region.regionName}</option>)}
            </select>
          </label>
          {selectedRegionId && <button type="button" onClick={onOpenBriefing} className="h-10 rounded-lg border border-line px-3 text-sm text-accent hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent">Open briefing</button>}
        </div>
      </div>
      <div className="grid bg-map @min-[560px]:grid-cols-[minmax(0,1fr)_224px]">
        <div className="relative min-w-0">
          <div role="group" aria-label="Map navigation" className="absolute top-4 left-4 z-10 flex gap-2">
            <button type="button" aria-label="Zoom in" title="Zoom in (+)" disabled={moving || position.zoom >= MAX_ZOOM} onClick={() => moveTo(zoomPosition(position, 1.5))} className={controlClass}><Plus size={16} strokeWidth={1.5} aria-hidden /></button>
            <button type="button" aria-label="Zoom out" title="Zoom out (−)" disabled={moving || position.zoom <= MIN_ZOOM} onClick={() => moveTo(zoomPosition(position, 1 / 1.5))} className={controlClass}><Minus size={16} strokeWidth={1.5} aria-hidden /></button>
            <button type="button" aria-label="Show all Finland" title="Show all Finland (Home)" onClick={() => { setSelectedCenterId(null); moveTo(NATIONAL_POSITION) }} className={controlClass}><LocateFixed size={16} strokeWidth={1.5} aria-hidden /></button>
          </div>
          <div className="absolute top-4 right-4 rounded-lg border border-line bg-panel px-3 py-2 font-mono text-xs text-muted" aria-label="Zoom level">{position.zoom.toFixed(1)}×</div>
          {geography ? <ComposableMap ref={mapRef} aria-label="Map of Finnish wellbeing services counties" aria-describedby="map-instructions" role="group" tabIndex={0}
            width={MAP_WIDTH} height={MAP_HEIGHT} projection="geoMercator" projectionConfig={{ center: NATIONAL_CENTER, scale: 1240 }}
            className="h-[440px] w-full cursor-grab outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:h-[600px]"
            style={{ touchAction: 'none' }}
            onKeyDown={event => {
              if (event.target !== event.currentTarget) return
              const directions: Record<string, [number, number]> = { ArrowLeft: [-48, 0], ArrowRight: [48, 0], ArrowUp: [0, -48], ArrowDown: [0, 48] }
              if (directions[event.key]) {
                event.preventDefault()
                moveTo(panPosition(position, ...directions[event.key]))
              } else if (['+', '=', '-', 'Home'].includes(event.key)) {
                event.preventDefault()
                moveTo(event.key === 'Home' ? NATIONAL_POSITION : zoomPosition(position, event.key === '-' ? 1 / 1.5 : 1.5))
              }
            }}>
            <ZoomableGroup center={position.coordinates} zoom={position.zoom} minZoom={MIN_ZOOM} maxZoom={MAX_ZOOM}
              translateExtent={MAP_EXTENT}
              filterZoomEvent={event => (!('ctrlKey' in event) || !event.ctrlKey || event.type === 'wheel') && (!('button' in event) || !event.button)}
              onMoveStart={() => setMoving(true)}
              onMoveEnd={({ coordinates, zoom }) => {
                setMoving(false)
                if (coordinates && zoom !== undefined) moveTo({ coordinates, zoom })
              }}>
              <Geographies geography={geography}>
                {({ geographies }) => geographies.map(county => {
                  const id = featureId(county)
                  const region = regionsById.get(id)
                  const share = region?.share ?? null
                  const value = indicator ? countiesById.get(id)?.values[indicator.id] : undefined
                  const verdict = asVerdict(value?.verdict)
                  const label = indicator ? `${region?.regionName}, ${formatValue(value?.v, indicator.unit)}, ${verdictLabels[verdict]}` : `${region?.regionName}, ${share === null ? 'data unavailable' : percent(share)}`
                  const selected = selectedRegionId === id
                  return <Geography key={county.rsmKey} geography={county}
                    role={region ? 'button' : undefined} tabIndex={region ? 0 : -1}
                    aria-label={region ? label : undefined}
                    aria-pressed={region ? selected : undefined} fill={indicator ? verdictColors[verdict] : coverageColors[getCoverageBand(share)]}
                    stroke={selected ? 'var(--color-ink)' : 'var(--color-map)'} strokeWidth={selected ? 2 : 1} vectorEffect="non-scaling-stroke"
                    className={region ? 'cursor-pointer outline-none [-webkit-tap-highlight-color:transparent] transition-[fill,stroke] duration-150 ease-out hover:fill-ink focus-visible:stroke-accent focus-visible:stroke-2 motion-reduce:transition-none' : undefined}
                    onClick={region ? () => selectCounty(id) : undefined}
                    onKeyDown={region ? event => {
                      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectCounty(id) }
                    } : undefined} />
                })}
              </Geographies>
              <CareCenterMarkers selectedRegionId={selectedRegionId} selectedCenterId={selectedCenter?.id ?? null} markerScale={markerScale} onSelect={selectCenter} />
            </ZoomableGroup>
          </ComposableMap> : <div className="grid h-[440px] place-items-center px-6 text-sm text-secondary sm:h-[600px]" role="status">
            {loadError ? <div className="text-center"><p>The map could not be loaded</p><button type="button" className="mt-3 rounded-lg border border-line px-4 py-2 focus-visible:outline-2 focus-visible:outline-accent" onClick={() => { setLoadError(false); setAttempt(value => value + 1) }}>Retry map</button></div> : 'Loading county boundaries…'}
          </div>}
          <p id="map-instructions" className="border-t border-line px-4 py-3 text-xs leading-relaxed text-muted">Drag to move · Scroll or pinch to zoom · Select a county to focus<br />Keyboard: arrow keys to move, + / − to zoom, Home to reset</p>
          <p className="px-4 pb-3 text-xs text-muted">Locations © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent">OpenStreetMap contributors</a></p>
        </div>
        <div className="flex min-w-0 flex-col gap-6 border-t border-line bg-panel p-4 @min-[560px]:border-t-0 @min-[560px]:border-l">
          <section aria-labelledby="care-centers-title">
            <h3 id="care-centers-title" className="text-sm font-medium">{selectedRegion ? `Care centers · ${selectedRegion.regionName}` : 'Care centers by county'}</h3>
            {!selectedRegion && <p className="mt-2 text-sm leading-relaxed text-secondary">Select a county to list its major care centers, or select a city marker to see hospital details</p>}
            {countyCenters.length > 0 && <ul className="mt-3 space-y-2" aria-label="County care centers">
              {countyCenters.map(center => <li key={center.id}><button type="button" aria-pressed={selectedCenter?.id === center.id} aria-controls="care-center-details" onClick={() => selectCenter(center)}
                className={`w-full rounded-lg border p-3 text-left focus-visible:outline-2 focus-visible:outline-accent ${selectedCenter?.id === center.id ? 'border-accent bg-raised' : 'border-line hover:bg-raised'}`}>
                <span className="block text-sm font-medium text-accent">{center.city}</span>
                <span className="mt-1 block text-xs leading-relaxed text-secondary">{center.name}</span>
              </button></li>)}
            </ul>}
            {selectedRegion && countyCenters.length === 0 && <p className="mt-2 text-sm text-muted">No care centers listed for this county</p>}
            <div id="care-center-details" aria-live="polite" aria-atomic="true">
              {selectedCenter && <section aria-labelledby="care-center-name" className="mt-4 border-t border-line pt-4">
                <div className="flex items-start justify-between gap-2">
                  <h4 id="care-center-name" className="text-sm font-medium">{selectedCenter.name}</h4>
                  <button type="button" aria-label="Close care-center details" onClick={() => setSelectedCenterId(null)} className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"><X size={16} strokeWidth={1.5} aria-hidden /></button>
                </div>
                <dl className="mt-3 space-y-3 text-xs leading-relaxed">
                  <div><dt className="text-muted">Visiting address</dt><dd className="mt-1 text-secondary">{selectedCenter.address}<br />{selectedCenter.postalCode} {selectedCenter.city}, Finland</dd></div>
                  <div><dt className="text-muted">Provider</dt><dd className="mt-1 text-secondary">{selectedCenter.provider}</dd></div>
                  <div><dt className="text-muted">Facility</dt><dd className="mt-1 text-secondary">{selectedCenter.type}</dd></div>
                </dl>
                <a href={selectedCenter.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent">Hospital information ↗</a>
                <a href={`https://www.openstreetmap.org/?mlat=${selectedCenter.coordinates[1]}&mlon=${selectedCenter.coordinates[0]}#map=16/${selectedCenter.coordinates[1]}/${selectedCenter.coordinates[0]}`} target="_blank" rel="noreferrer" className="mt-2 block text-xs text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent">Location on OpenStreetMap ↗</a>
              </section>}
            </div>
          </section>
          <div className="border-t border-line pt-4">
            <h3 className="text-sm font-medium">{indicator ? 'Status against national' : 'Missing record share'}</h3>
            {indicator ? <ul aria-label="Map legend" className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-secondary @min-[560px]:grid-cols-1">
              {verdictOrder.map(id => <li key={id} className="flex items-center gap-2" title={pathway?.verdicts[id]?.desc}><VerdictDot verdict={id} /><span className="text-xs">{verdictLabels[id]}</span></li>)}
            </ul> : <ul aria-label="Map legend" className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-secondary @min-[560px]:grid-cols-1">
              {bands.map(band => <li key={band} className="flex items-center gap-2"><CoverageSwatch band={band} /><span className="font-mono text-xs">{band}</span></li>)}
            </ul>}
            <p className="mt-2 text-xs text-muted">{indicator ? 'Each area is compared with the national value using its 95% interval' : 'Color bands group observed rates for display'}</p>
            <a href={indicator?.source_url || sourceUrl} className="mt-3 inline-block text-xs text-accent underline decoration-accent/35 underline-offset-4 hover:decoration-accent focus-visible:outline-2 focus-visible:outline-accent">{indicator ? 'Indicator source' : 'Finnish Cancer Registry'}</a>
          </div>
        </div>
      </div>
    </section>
  )
}
