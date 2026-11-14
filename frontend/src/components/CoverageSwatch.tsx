import type { CoverageBand } from '../data/regions'
import { coverageColors } from './coverageColors'

export function CoverageSwatch({ band }: { band: CoverageBand }) {
  return <span aria-hidden className="inline-block size-3 shrink-0 rounded-sm" style={{ backgroundColor: coverageColors[band] }} />
}
