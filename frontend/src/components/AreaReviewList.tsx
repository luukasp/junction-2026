import { useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { count, getCoverageBand, percent } from '../data/regions'
import { useDashboard } from '../data/DashboardContext'
import { CoverageSwatch } from './CoverageSwatch'

type Props = { selectedRegionId: string | null; onRegionSelect: (id: string) => void }

export function AreaReviewList({ selectedRegionId, onRegionSelect }: Props) {
  const { reportingRegions } = useDashboard()
  const [sortBy, setSortBy] = useState<'missing' | 'share'>('missing')
  const ranked = [...reportingRegions].sort((a, b) =>
    b[sortBy] - a[sortBy] || a.regionName.localeCompare(b.regionName),
  )

  return (
    <section aria-labelledby="review-title" className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-panel">
      <div className="border-b border-line p-4 sm:p-5">
        <h2 id="review-title" className="text-lg font-semibold">Where to review records</h2>
        <p className="mt-1 text-sm leading-relaxed text-secondary">Sort by count to plan audit workload, or by share to find where gaps are most concentrated.</p>
        <fieldset className="mt-4 flex flex-wrap gap-2">
          <legend className="sr-only">Sort reporting areas</legend>
          {(['missing', 'share'] as const).map((key) => (
            <label key={key} className="cursor-pointer rounded-lg border border-line px-3 py-2 text-sm text-secondary has-checked:bg-raised has-checked:text-accent has-focus-visible:outline-2 has-focus-visible:outline-accent">
              <input className="sr-only" type="radio" name="area-sort" checked={sortBy === key} onChange={() => setSortBy(key)} />
              {key === 'missing' ? 'Missing count' : 'Missing share'}
            </label>
          ))}
        </fieldset>
      </div>
      <div className="max-h-[480px] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Reporting areas ordered by {sortBy === 'missing' ? 'missing record count' : 'missing record share'}, highest first</caption>
          <thead className="sticky top-0 z-10 border-b border-line bg-panel text-xs text-muted">
            <tr>
              <th scope="col" className="px-4 py-3 text-left font-medium">Area</th>
              <th scope="col" aria-sort={sortBy === 'missing' ? 'descending' : undefined} className="px-2 py-3 text-right font-medium">Missing</th>
              <th scope="col" aria-sort={sortBy === 'share' ? 'descending' : undefined} className="px-4 py-3 text-right font-medium">Share</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ranked.map((region) => (
              <tr key={region.regionId} className={region.regionId === selectedRegionId ? 'bg-raised' : 'hover:bg-raised'}>
                <th scope="row" className="p-0 text-left font-medium">
                  <button type="button" onClick={() => onRegionSelect(region.regionId)} className="flex w-full items-center gap-2 px-4 py-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
                    <CoverageSwatch band={getCoverageBand(region.share)} />
                    <span>{region.regionName}</span>
                    <ArrowUpRight size={14} aria-hidden className="ml-auto shrink-0 text-muted" />
                  </button>
                </th>
                <td className="px-2 text-right font-mono tabular-nums">{count(region.missing)}</td>
                <td className="px-4 text-right font-mono tabular-nums text-secondary">{percent(region.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-auto border-t border-line px-4 py-3 text-xs text-muted">Åland has no published estimate in this dataset.</p>
    </section>
  )
}
