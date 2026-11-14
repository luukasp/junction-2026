import additionalCenters from './countyCareCenters.json'
import { careCenters, type CareCenter } from './careCenters'

export type CountyCareCenter = Pick<CareCenter, 'id' | 'regionId' | 'name' | 'coordinates' | 'sourceUrl' | 'locationSourceUrl'> & { city?: string }

// County Review has a wider directory; the national map keeps its original centers.
const countyCareCenters: CountyCareCenter[] = [
  ...careCenters,
  ...additionalCenters.map(center => ({ ...center, coordinates: [center.coordinates[0], center.coordinates[1]] as [number, number] })),
]

export function getCountyCareCenters(regionId: string) {
  return countyCareCenters.filter(center => center.regionId === regionId)
}
