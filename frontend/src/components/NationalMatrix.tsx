import { useState } from 'react'
import { asVerdict, verdictColors, verdictLabels, worstCountyVerdict, type PathwaySnapshot } from '../data/pathway'

type Props = {
  snapshot: PathwaySnapshot
  selectedRegionId: string | null
  onSelectCountyStage: (countyCode: string, stageId?: string) => void
}

export function NationalMatrix({ snapshot, selectedRegionId, onSelectCountyStage }: Props) {
  const [ytaFilter, setYtaFilter] = useState<string>('ALL')
  const ytas = Array.from(new Map(
    snapshot.counties.filter(c => c.yta_code && c.yta_name).map(c => [c.yta_code!, c.yta_name!] as const),
  ).entries())
  const filtered = snapshot.counties
    .filter(c => ytaFilter === 'ALL' || c.yta_code === ytaFilter)
    .sort((a, b) => {
      const wa = worstCountyVerdict(snapshot, a)
      const wb = worstCountyVerdict(snapshot, b)
      return (wa.verdict === wb.verdict ? 0 : ['act', 'verify', 'monitor', 'ok', 'nodata'].indexOf(wa.verdict) - ['act', 'verify', 'monitor', 'ok', 'nodata'].indexOf(wb.verdict))
        || wb.actStages - wa.actStages
        || a.name.localeCompare(b.name, 'en')
    })

  return (
    <section aria-labelledby="matrix-title" className="overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-4 py-4 sm:px-5">
        <div>
          <h2 id="matrix-title" className="text-lg font-semibold">Pathway bottleneck matrix · {filtered.length} areas × {snapshot.stages.length} stages</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">Scan across all six stages to spot regional clusters. Select any cell to inspect that county and stage.</p>
        </div>
        {ytas.length > 0 && (
          <label className="grid gap-1 text-xs text-muted">
            Collaboration area (YTA)
            <select value={ytaFilter} onChange={e => setYtaFilter(e.target.value)}
              className="h-9 rounded-lg border border-line bg-raised px-3 text-xs text-ink focus-visible:outline-2 focus-visible:outline-accent">
              <option value="ALL">All collaboration areas ({snapshot.counties.length})</option>
              {ytas.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="max-h-[460px] overflow-auto" role="group" aria-label="County by pathway stage matrix">
        <div className="min-w-[44rem]">
          <div className="sticky top-0 z-10 grid grid-cols-[minmax(10rem,1.4fr)_repeat(6,minmax(4.8rem,1fr))_3.5rem] items-center border-b border-line bg-panel px-4 py-2.5 text-xs font-medium text-muted" style={{ gridTemplateColumns: `minmax(10rem,1.5fr) repeat(${snapshot.stages.length}, minmax(4.8rem,1fr)) 3.5rem` }}>
            <span>County</span>
            {snapshot.stages.map(stage => (
              <span key={stage.id} className="px-1 text-center" title={stage.hint}>{stage.label}</span>
            ))}
            <span className="text-right">Actions</span>
          </div>
          <ul className="divide-y divide-line text-xs">
            {filtered.map(county => (
              <li key={county.code}
                className={`grid items-center px-4 py-1.5 ${county.code === selectedRegionId ? 'bg-raised' : 'hover:bg-raised/60'}`}
                style={{ gridTemplateColumns: `minmax(10rem,1.5fr) repeat(${snapshot.stages.length}, minmax(4.8rem,1fr)) 3.5rem` }}>
                <div className="min-w-0 pr-2">
                  <button type="button" onClick={() => onSelectCountyStage(county.code)}
                    className="block truncate text-left font-medium text-ink hover:text-accent focus-visible:outline-2 focus-visible:outline-accent">
                    {county.name}
                  </button>
                  {county.yta_name && <span className="block truncate text-[11px] text-muted">{county.yta_name.split(' (')[0]}</span>}
                </div>
                {snapshot.stages.map(stage => {
                  const v = asVerdict(county.stage_verdicts[stage.id])
                  return (
                    <div key={stage.id} className="p-1 text-center">
                      <button type="button"
                        onClick={() => onSelectCountyStage(county.code, stage.id)}
                        aria-label={`${county.name}, ${stage.label}: ${verdictLabels[v]}`}
                        title={`${county.name} · ${stage.label}: ${verdictLabels[v]}`}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-line/70 px-2 py-1 text-[11px] text-secondary hover:border-accent focus-visible:outline-2 focus-visible:outline-accent">
                        <span aria-hidden className="size-2.5 shrink-0 rounded-xs" style={{ backgroundColor: verdictColors[v] }} />
                        <span className="truncate">{verdictLabels[v]}</span>
                      </button>
                    </div>
                  )
                })}
                <span className="text-right font-mono tabular-nums text-secondary">{county.actions.length}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
