import { describe, expect, it } from 'vitest'
import { geoContains, geoPath } from 'd3-geo'
import type { FeatureCollection } from 'geojson'
import snapshot from './countyLungTreatment.json'
import rawGeography from '../../public/finland.geojson?raw'
import { careCenters, getCareCenters } from './careCenters'
import { fitGeography, MAP_HEIGHT, MAP_WIDTH, MAX_ZOOM, MIN_ZOOM, NATIONAL_POSITION, mapProjection, panPosition, zoomPosition } from './mapViewport'

const geography: FeatureCollection = JSON.parse(rawGeography)

describe('care-center directory', () => {
  it('lists one to three major centers for every mapped and reporting county', () => {
    expect(new Set(careCenters.map(center => center.id)).size).toBe(careCenters.length)
    for (const region of snapshot.regions) {
      expect(getCareCenters(region.regionId).length, region.regionName).toBeGreaterThanOrEqual(1)
      expect(getCareCenters(region.regionId).length, region.regionName).toBeLessThanOrEqual(3)
    }
    for (const feature of geography.features) {
      const regionId = `HVA${String(feature.properties?.hyvinvointialue).padStart(2, '0')}`
      expect(getCareCenters(regionId).length, regionId).toBeGreaterThanOrEqual(1)
    }
  })

  it('places each center inside its assigned county and includes source-backed contact details', () => {
    for (const center of careCenters) {
      const county = geography.features.find(feature => `HVA${feature.properties?.hyvinvointialue}` === center.regionId)
      expect(county, center.name).toBeDefined()
      expect(geoContains(county!, center.coordinates), center.name).toBe(true)
      for (const value of [center.name, center.city, center.address, center.provider, center.type]) expect(value.length).toBeGreaterThan(1)
      expect(center.sourceUrl).toMatch(/^https:\/\//)
      expect(center.locationSourceUrl).toMatch(/^https:\/\//)
    }
  })
})

describe('map viewport', () => {
  it('fits every county, including small metropolitan counties, inside the viewport', () => {
    const projection = mapProjection()
    for (const county of geography.features) {
      const position = fitGeography(county)
      expect(position.zoom).toBeGreaterThanOrEqual(MIN_ZOOM)
      expect(position.zoom).toBeLessThanOrEqual(MAX_ZOOM)
      const center = projection(position.coordinates)!
      const [[left, top], [right, bottom]] = geoPath(projection).bounds(county)
      expect((left - center[0]) * position.zoom + MAP_WIDTH / 2).toBeGreaterThanOrEqual(0)
      expect((right - center[0]) * position.zoom + MAP_WIDTH / 2).toBeLessThanOrEqual(MAP_WIDTH)
      expect((top - center[1]) * position.zoom + MAP_HEIGHT / 2).toBeGreaterThanOrEqual(0)
      expect((bottom - center[1]) * position.zoom + MAP_HEIGHT / 2).toBeLessThanOrEqual(MAP_HEIGHT)
    }
  })

  it('clamps zoom and pans by consistent screen distances at different zoom levels', () => {
    expect(zoomPosition(NATIONAL_POSITION, 0.001).zoom).toBe(MIN_ZOOM)
    expect(zoomPosition(NATIONAL_POSITION, 1000).zoom).toBe(MAX_ZOOM)
    const projection = mapProjection()
    for (const zoom of [1, 5, 40]) {
      const start = { ...NATIONAL_POSITION, zoom }
      const moved = panPosition(start, 48, -48)
      const from = projection(start.coordinates)!
      const to = projection(moved.coordinates)!
      expect((to[0] - from[0]) * zoom).toBeCloseTo(48)
      expect((to[1] - from[1]) * zoom).toBeCloseTo(-48)
      expect(panPosition(start, 1e10, -1e10).coordinates.every(Number.isFinite)).toBe(true)
    }
  })
})
