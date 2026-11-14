import snapshot from './countyLungTreatment.json'

export type RegionData = (typeof snapshot.regions)[number]
export const { regions, period, observationWindow, recommendation, sourceUrl } = snapshot
export const regionsById = new Map(regions.map((region) => [region.regionId, region]))
export const percent = (value: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value) + '%'
export const count = (value: number) => new Intl.NumberFormat('en').format(value)

type ReportingRegion = RegionData & { patients: number; missing: number; share: number }
export const reportingRegions = regions.filter((region): region is ReportingRegion =>
  region.patients !== null && region.patients > 0 && region.missing !== null && region.share !== null,
)
export const totalPatients = reportingRegions.reduce((total, region) => total + region.patients, 0)
export const totalMissing = reportingRegions.reduce((total, region) => total + region.missing, 0)
export const pooledShare = 100 * totalMissing / totalPatients

export function getCoverageBand(share: number | null) {
  if (share === null) return 'Unavailable'
  if (share >= 30) return '30% or more'
  if (share >= 25) return '25% to <30%'
  return 'Under 25%'
}

export type CoverageBand = ReturnType<typeof getCoverageBand>
