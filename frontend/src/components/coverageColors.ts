import type { CoverageBand } from '../data/regions'

export const coverageColors = {
  'Under 25%': '#7a9b91',
  '25% to <30%': '#b8c6bd',
  '30% or more': '#dbac78',
  Unavailable: '#505a5e',
} satisfies Record<CoverageBand, string>
