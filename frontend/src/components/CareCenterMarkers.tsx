import { Marker, useMapContext, useZoomPanContext } from 'react-simple-maps'
import { careCenters, type CareCenter } from '../data/careCenters'
import { MAP_HEIGHT, MAP_WIDTH } from '../data/mapViewport'

type Props = {
  selectedRegionId: string | null
  selectedCenterId: string | null
  markerScale: number
  onSelect: (center: CareCenter) => void
}

export function CareCenterMarkers({ selectedRegionId, selectedCenterId, markerScale, onSelect }: Props) {
  const { projection } = useMapContext()
  const { x, y, k } = useZoomPanContext()
  const occupied: { left: number; right: number; top: number; bottom: number }[] = []
  // Place the selected county first, and keep labels at a readable size while zooming.
  const ordered = [...careCenters].sort((a, b) => Number(b.regionId === selectedRegionId) - Number(a.regionId === selectedRegionId))
  const markers = ordered.flatMap(center => {
    const point = projection(center.coordinates)
    if (!point) return []
    const px = point[0] * k + x
    const py = point[1] * k + y
    if (px < -16 || px > MAP_WIDTH + 16 || py < -16 || py > MAP_HEIGHT + 16) return []
    const width = center.city.length * 7.5 + 8
    const candidates = [
      [12, -8], [-width - 12, -8], [12, 16], [-width - 12, 16],
      [12, -28], [-width - 12, -28], [12, 36], [-width - 12, 36],
      [12, -48], [-width - 12, -48], [12, 56], [-width - 12, 56],
    ]
    const [dx, dy] = candidates.find(([dx, dy]) => {
      const box = { left: px + dx * markerScale, right: px + (dx + width) * markerScale, top: py + (dy - 14) * markerScale, bottom: py + (dy + 4) * markerScale }
      return box.left >= 4 && box.right <= MAP_WIDTH - 4 && box.top >= 4 && box.bottom <= MAP_HEIGHT - 4
        && !occupied.some(other => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)
    }) ?? candidates[0]
    occupied.push({ left: px + dx * markerScale, right: px + (dx + width) * markerScale, top: py + (dy - 14) * markerScale, bottom: py + (dy + 4) * markerScale })
    return [{ center, dx, dy }]
  })

  return <g aria-label="Care centers">
    {markers.map(({ center, dx, dy }) => {
      const selected = center.id === selectedCenterId
      return <Marker key={center.id} coordinates={center.coordinates} role="button" tabIndex={0}
        aria-label={`${center.city}: ${center.name}`} aria-pressed={selected} aria-controls="care-center-details"
        className="group cursor-pointer outline-none [-webkit-tap-highlight-color:transparent]"
        onClick={event => { event.stopPropagation(); onSelect(center) }}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onSelect(center) }
        }}>
        <title>{center.name} · {center.city}</title>
        <g transform={`scale(${markerScale / k})`}>
          <circle r={14} fill="transparent" />
          <path d={`M0,0 L${dx < 0 ? dx + center.city.length * 7.5 : dx},${dy - 5}`} stroke="var(--color-muted)" strokeWidth={0.75} opacity={0.7} pointerEvents="none" />
          <circle r={selected ? 6 : 4} fill={selected ? 'var(--color-accent)' : 'var(--color-ink)'} stroke="var(--color-map)" strokeWidth={2} />
          <circle r={9} fill="none" stroke="var(--color-accent)" strokeWidth={2} className={selected ? '' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'} />
          <text x={dx} y={dy} fontSize={14} fontWeight={selected || center.regionId === selectedRegionId ? 600 : 400}
            fill={selected ? 'var(--color-accent)' : 'var(--color-ink)'} stroke="var(--color-map)" strokeWidth={4} paintOrder="stroke" strokeLinejoin="round">{center.city}</text>
        </g>
      </Marker>
    })}
  </g>
}
