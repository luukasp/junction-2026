import { useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { asVerdict, formatCount, formatValue, lowerIsBetter, verdictLabels, verdictRank, type PathwaySnapshot } from '../data/pathway'
import { VerdictDot } from './VerdictBadge'

type Props = { snapshot: PathwaySnapshot; indicatorId: string; selectedRegionId: string | null; onRegionSelect: (id: string) => void }

export function IndicatorAreaList({ snapshot, indicatorId, selectedRegionId, onRegionSelect }: Props) {
  const [sortBy, setSortBy] = useState<'priority' | 'volume'>('priority')
  const indicator = snapshot.indicators.find(i => i.id === indicatorId)
  if (!indicator) return null
  const worse = lowerIsBetter(indicator) ? 1 : -1
  const rows = snapshot.counties.map(county => ({ county, value: county.values[indicatorId] }))
  const ranked = rows.filter(r => r.value && r.value.v !== null).sort((a, b) => sortBy === 'volume'
    ? (b.value.n ?? -1) - (a.value.n ?? -1) || a.county.name.localeCompare(b.county.name)
    : verdictRank(a.value.verdict) - verdictRank(b.value.verdict) || worse * ((b.value.v ?? 0) - (a.value.v ?? 0)) || a.county.name.localeCompare(b.county.name))
  const missing = rows.filter(r => !r.value || r.value.v === null).map(r => r.county.name)
  const hasCounts = ranked.some(r => r.value.n !== null && r.value.n !== undefined)

  return (
    <section aria-labelledby="review-title" className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-panel">
      <div className="border-b border-line p-4 sm:p-5">
        <h2 id="review-title" className="text-lg font-semibold">Where to act first</h2>
        <p className="mt-1 text-sm leading-relaxed text-secondary">{indicator.short || indicator.label} · {indicator.period}. Select an area for its action plan.</p>
        {hasCounts && <fieldset className="mt-4 flex flex-wrap gap-2">
          <legend className="sr-only">Sort areas</legend>
          {(['priority', 'volume'] as const).map(key => <label key={key} className="cursor-pointer rounded-lg border border-line px-3 py-2 text-sm text-secondary has-checked:bg-raised has-checked:text-accent has-focus-visible:outline-2 has-focus-visible:outline-accent">
            <input className="sr-only" type="radio" name="area-sort" checked={sortBy === key} onChange={() => setSortBy(key)} />
            {key === 'priority' ? 'Status, then rate' : 'Patient count'}
          </label>)}
        </fieldset>}
      </div>
      <div className="max-h-[480px] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Areas ordered by {sortBy === 'priority' ? 'status and rate' : 'patient count'} for {indicator.label}</caption>
          <thead className="sticky top-0 z-10 border-b border-line bg-panel text-xs text-muted">
            <tr>
              <th scope="col" className="px-4 py-3 text-left font-medium">Area</th>
              <th scope="col" className="px-2 py-3 text-right font-medium">Value</th>
              <th scope="col" className="px-4 py-3 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ranked.map(({ county, value }) => <tr key={county.code} className={county.code === selectedRegionId ? 'bg-raised' : 'hover:bg-raised'}>
              <th scope="row" className="p-0 text-left font-medium">
                <button type="button" onClick={() => onRegionSelect(county.code)} className="flex w-full items-center gap-2 px-4 py-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
                  <span>{county.name}</span>
                  <ArrowUpRight size={14} aria-hidden className="ml-auto shrink-0 text-muted" />
                </button>
              </th>
              <td className="px-2 text-right">
                <span className="block font-mono tabular-nums">{formatValue(value.v, indicator.unit)}</span>
                {formatCount(value) && <span className="block font-mono text-xs tabular-nums text-muted">{formatCount(value)}</span>}
              </td>
              <td className="px-4"><span className="flex items-center gap-2 text-xs text-secondary"><VerdictDot verdict={value.verdict} />{verdictLabels[asVerdict(value.verdict)]}</span></td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {missing.length > 0 && <p className="mt-auto border-t border-line px-4 py-3 text-xs text-muted">No published estimate: {missing.join(', ')}</p>}
    </section>
  )
}
