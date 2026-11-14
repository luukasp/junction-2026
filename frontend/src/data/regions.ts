export type RegionData = { regionId: string; regionName: string; patients: number | null; missing: number | null; share: number | null }

export const percent = (value: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value) + '%'
export const count = (value: number) => new Intl.NumberFormat('en').format(value)

export function getCoverageBand(share: number | null) {
  if (share === null) return 'Unavailable'
  if (share >= 30) return '30% or more'
  if (share >= 25) return '25% to <30%'
  return 'Under 25%'
}

export type CoverageBand = ReturnType<typeof getCoverageBand>
