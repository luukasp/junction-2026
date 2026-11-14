import { describe, expect, it } from 'vitest'
import { geoContains, geoMercator } from 'd3-geo'
import type { FeatureCollection } from 'geojson'
import rawGeography from '../../public/finland.geojson?raw'
import { careCenters, getCareCenters } from './careCenters'
import { getCountyCareCenters } from './countyCareCenters'
import { layoutCareCenterLabels } from './careCenterLabels'

const geography: FeatureCollection = JSON.parse(rawGeography)

describe('expanded county care centers', () => {
  it('keeps additions out of the national directory and assigns every location to its geographic county', () => {
    expect(careCenters).toHaveLength(26)
    expect(getCareCenters('HVA05')).toHaveLength(1)
    expect(getCountyCareCenters('HVA05').length).toBeGreaterThan(1)
    const ids: string[] = []
    for (const feature of geography.features) {
      const regionId = `HVA${String(feature.properties?.hyvinvointialue).padStart(2, '0')}`
      const centers = getCountyCareCenters(regionId)
      for (const center of centers) {
        expect(center.regionId).toBe(regionId)
        expect(geoContains(feature, center.coordinates), center.name).toBe(true)
        expect(center.sourceUrl).toMatch(/^https:\/\//)
        expect(center.locationSourceUrl).toMatch(/^https:\/\//)
        ids.push(center.id)
      }
    }
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThan(careCenters.length)
    expect(getCountyCareCenters('unknown')).toEqual([])
  })

  it('fits complete, nonoverlapping name labels at desktop and mobile widths', () => {
    for (const width of [246, 358, 640, 1000]) for (const feature of geography.features) {
      const regionId = `HVA${String(feature.properties?.hyvinvointialue).padStart(2, '0')}`
      const projection = geoMercator().fitExtent([[32, 32], [width - 32, 328]], feature)
      const centers = getCountyCareCenters(regionId)
      const labels = layoutCareCenterLabels(centers.map(center => {
        const [x, y] = projection(center.coordinates)!
        return { id: center.id, name: center.name, x, y }
      }), width, 360)
      expect(labels).toHaveLength(centers.length)
      for (const label of labels) {
        expect(label.lines.join('').replaceAll(' ', '')).toBe(label.name.replaceAll(' ', ''))
        expect(label.labelX).toBeGreaterThanOrEqual(0)
        expect(label.labelY, `${regionId}: ${label.name}`).toBeGreaterThanOrEqual(0)
        expect(label.labelX + label.labelWidth).toBeLessThanOrEqual(width)
        expect(label.labelY + label.labelHeight).toBeLessThanOrEqual(360)
        for (const point of labels) {
          const coversMarker = point.x >= label.labelX - 8 && point.x <= label.labelX + label.labelWidth + 8
            && point.y >= label.labelY - 6 && point.y <= label.labelY + label.labelHeight + 6
          expect(coversMarker, `${regionId}: ${label.name} covers ${point.name}`).toBe(false)
        }
        for (const other of labels.filter(other => other.id !== label.id)) {
          const overlaps = label.labelX < other.labelX + other.labelWidth && label.labelX + label.labelWidth > other.labelX
            && label.labelY < other.labelY + other.labelHeight && label.labelY + label.labelHeight > other.labelY
          expect(overlaps, `${regionId}: ${label.name} / ${other.name}`).toBe(false)
        }
      }
    }
  })
})
