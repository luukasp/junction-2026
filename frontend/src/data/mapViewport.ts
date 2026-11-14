import { geoMercator, geoPath, type GeoProjection } from 'd3-geo'
import type { GeoPermissibleObjects } from 'd3-geo'

export const MAP_WIDTH = 420
export const MAP_HEIGHT = 570
export const MIN_ZOOM = 1
export const MAX_ZOOM = 40
export const MAP_EXTENT: [[number, number], [number, number]] = [[-80, -80], [MAP_WIDTH + 80, MAP_HEIGHT + 80]]
export const NATIONAL_CENTER: [number, number] = [26.2, 65.15]
export type MapPosition = { coordinates: [number, number]; zoom: number }
export const NATIONAL_POSITION: MapPosition = { coordinates: NATIONAL_CENTER, zoom: MIN_ZOOM }

export function mapProjection() {
  return geoMercator().center(NATIONAL_CENTER).scale(1240).translate([MAP_WIDTH / 2, MAP_HEIGHT / 2])
}

export function fitGeography(geometry: GeoPermissibleObjects, projection: GeoProjection = mapProjection()): MapPosition {
  const [[left, top], [right, bottom]] = geoPath(projection).bounds(geometry)
  const coordinates = projection.invert?.([(left + right) / 2, (top + bottom) / 2])
  if (!coordinates || ![left, top, right, bottom, ...coordinates].every(Number.isFinite)) return NATIONAL_POSITION
  const zoom = Math.min((MAP_WIDTH - 96) / Math.max(right - left, 1), (MAP_HEIGHT - 128) / Math.max(bottom - top, 1))
  return { coordinates, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)) }
}

export function zoomPosition(position: MapPosition, multiplier: number): MapPosition {
  return { ...position, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, position.zoom * multiplier)) }
}

export function panPosition(position: MapPosition, dx: number, dy: number): MapPosition {
  const projection = mapProjection()
  const point = projection(position.coordinates)
  const coordinates = point && projection.invert?.([
    Math.max(MAP_EXTENT[0][0] + MAP_WIDTH / (2 * position.zoom), Math.min(MAP_EXTENT[1][0] - MAP_WIDTH / (2 * position.zoom), point[0] + dx / position.zoom)),
    Math.max(MAP_EXTENT[0][1] + MAP_HEIGHT / (2 * position.zoom), Math.min(MAP_EXTENT[1][1] - MAP_HEIGHT / (2 * position.zoom), point[1] + dy / position.zoom)),
  ])
  return coordinates ? { ...position, coordinates } : position
}
