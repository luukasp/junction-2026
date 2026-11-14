import data from './careCenters.json'

export type CareCenter = {
  id: string
  regionId: string
  name: string
  city: string
  address: string
  postalCode: string
  provider: string
  type: string
  coordinates: [number, number]
  sourceUrl: string
  locationSourceUrl: string
}

export const careCenters: CareCenter[] = data.map(center => ({
  ...center,
  coordinates: [center.coordinates[0], center.coordinates[1]],
}))

export function getCareCenters(regionId: string) {
  return careCenters.filter(center => center.regionId === regionId)
}
