import { useEffect, useMemo, useRef, useState } from 'react'
import { geoMercator, geoPath } from 'd3-geo'
import type { FeatureCollection } from 'geojson'
import { useDashboard } from '../data/DashboardContext'
import { getCareCenters } from '../data/careCenters'

type Props = { countyId: string; countyName: string; onCountyChange: (id: string) => void }
const featureId = (code: unknown) => `HVA${String(code).padStart(2, '0')}`
const height = 320

export function CountyMap({ countyId, countyName, onCountyChange }: Props) {
  const { regionsById } = useDashboard()
  const [geography, setGeography] = useState<FeatureCollection | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [width, setWidth] = useState(640)
  const container = useRef<HTMLDivElement>(null)
  const centers = getCareCenters(countyId)

  useEffect(() => {
    const request = new AbortController()
    fetch(`${import.meta.env.BASE_URL}finland.geojson`, { signal: request.signal })
      .then(response => { if (!response.ok) throw new Error('Map unavailable'); return response.json() })
      .then((data: FeatureCollection) => {
        if (data.type !== 'FeatureCollection' || !Array.isArray(data.features) || !data.features.length) throw new Error('Invalid county boundaries')
        setGeography(data)
      })
      .catch(() => { if (!request.signal.aborted) setError(true) })
    return () => request.abort()
  }, [attempt])

  useEffect(() => {
    const element = container.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(Math.round(entry.contentRect.width))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const projection = useMemo(() => {
    const county = geography?.features.find(feature => featureId(feature.properties?.hyvinvointialue) === countyId)
    return county ? geoMercator().fitExtent([[32, 32], [Math.max(64, width - 32), height - 32]], county) : null
  }, [geography, countyId, width])
  const path = projection ? geoPath(projection) : null

  return <section aria-labelledby="county-map-title" className="overflow-hidden rounded-xl border border-line bg-panel">
    <div className="border-b border-line px-4 py-4">
      <h3 id="county-map-title" className="text-sm font-medium">County map</h3>
      <p className="mt-1 text-xs text-muted">{countyName} · select a neighbouring county to review it</p>
    </div>
    <div className="grid lg:grid-cols-[minmax(0,1fr)_15rem]">
      <div ref={container} className="min-w-0 overflow-hidden bg-map">
        {geography && projection && path ? <svg viewBox={`0 0 ${width} ${height}`} className="block h-80 w-full" role="group" aria-label={`County map of ${countyName}`}>
          {geography.features.map((feature, index) => {
            const id = featureId(feature.properties?.hyvinvointialue)
            const region = regionsById.get(id)
            const selected = id === countyId
            return <path key={`${id}-${index}`} d={path(feature) ?? undefined} role={region ? 'button' : undefined} tabIndex={region ? 0 : undefined}
              aria-label={region?.regionName} aria-pressed={region ? selected : undefined}
              onClick={region ? () => onCountyChange(id) : undefined}
              onKeyDown={region ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onCountyChange(id) } } : undefined}
              className={`outline-none ${selected ? 'fill-accent/25 stroke-accent' : 'fill-raised stroke-line'} ${region ? 'cursor-pointer hover:fill-accent/40 focus-visible:fill-accent/40 focus-visible:stroke-ink' : ''}`}
              strokeWidth={selected ? 1.5 : 1} vectorEffect="non-scaling-stroke"><title>{region?.regionName ?? id}</title></path>
          })}
          {centers.map(center => {
            const point = projection(center.coordinates)
            if (!point || point[0] < 8 || point[0] > width - 8 || point[1] < 8 || point[1] > height - 8) return null
            return <g key={center.id} transform={`translate(${point[0]},${point[1]})`} aria-label={`${center.city}: ${center.name}`}>
              <circle r={4} className="fill-ink stroke-map" strokeWidth={2} />
              <title>{center.city}: {center.name}</title>
            </g>
          })}
        </svg> : <div className="grid h-80 place-items-center p-4 text-center text-sm text-muted" role="status">
          {error ? <div><p>The county map could not be loaded</p><button type="button" onClick={() => { setError(false); setAttempt(value => value + 1) }} className="mt-3 rounded-lg border border-line px-3 py-2 text-accent focus-visible:outline-2 focus-visible:outline-accent">Retry map</button></div>
            : geography ? 'No boundary is available for this county' : 'Loading county boundaries…'}
        </div>}
      </div>
      <div className="border-t border-line p-4 lg:border-t-0 lg:border-l">
        <h4 className="text-sm font-medium">Care centers</h4>
        {centers.length ? <ul className="mt-3 grid gap-4" aria-label="County care centers">
          {centers.map(center => <li key={center.id}>
            <p className="text-xs text-muted">{center.city}</p>
            <a href={center.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm text-accent underline decoration-accent/35 underline-offset-4 hover:decoration-accent focus-visible:outline-2 focus-visible:outline-accent">{center.name}</a>
          </li>)}
        </ul> : <p className="mt-3 text-xs text-muted">No care centers listed for this county</p>}
        <p className="mt-4 text-xs leading-relaxed text-muted">Highlighted boundary: {countyName}<br />Dots mark listed care centers</p>
      </div>
    </div>
    <p className="border-t border-line px-4 py-3 text-xs text-muted">Locations © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent">OpenStreetMap contributors</a></p>
  </section>
}
