import { ChevronRight } from 'lucide-react'
import { asVerdict, formatValue, OVERALL_PATHWAY_ID, polarityText, stageCounts, stageGroups, verdictLabels, worstCountyVerdict, type PathwayIndicator, type PathwaySnapshot } from '../data/pathway'
import { VerdictDot } from './VerdictBadge'

type Props = { snapshot: PathwaySnapshot; indicatorId: string | null; onIndicatorChange: (id: string) => void; selectedCountyId: string | null }

export function PathwayExplorer({ snapshot, indicatorId, onIndicatorChange, selectedCountyId }: Props) {
  const groups = stageGroups(snapshot)
  const isOverall = indicatorId === OVERALL_PATHWAY_ID
  const indicator = !isOverall ? snapshot.indicators.find(i => i.id === indicatorId) ?? null : null
  const activeStage = !isOverall ? groups.find(g => g.indicators.some(i => i.id === indicatorId))?.stage.id ?? null : null
  const county = snapshot.counties.find(c => c.code === selectedCountyId) ?? null
  const active = groups.find(g => g.stage.id === activeStage)
  const overallAct = snapshot.counties.filter(c => worstCountyVerdict(snapshot, c).verdict === 'act').length
  const overallVerify = snapshot.counties.filter(c => worstCountyVerdict(snapshot, c).verdict === 'verify').length

  return (
    <section aria-labelledby="pathway-title" className="rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
        <div>
          <h2 id="pathway-title" className="text-lg font-semibold">Where in the pathway the gap emerges</h2>
          <p className="mt-0.5 text-xs text-muted">{county ? `Status for ${county.name}` : isOverall ? 'Composite view across all 6 stages · select a stage to drill into an indicator' : 'Counties flagged per stage'}</p>
        </div>
        <button type="button" aria-pressed={isOverall} onClick={() => onIndicatorChange(OVERALL_PATHWAY_ID)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent ${isOverall ? 'border-accent bg-raised text-accent' : 'border-line text-secondary hover:bg-raised hover:text-ink'}`}>
          All 6 stages ({overallAct} Act · {overallVerify} Verify)
        </button>
      </div>
      <ol aria-label="Care pathway stages" className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 xl:grid-cols-6">
        {groups.map(({ stage, indicators }, index) => {
          const counts = stageCounts(snapshot, stage.id)
          const countyVerdict = county ? asVerdict(county.stage_verdicts[stage.id]) : null
          const selected = stage.id === activeStage
          return <li key={stage.id} className="bg-panel">
            <button type="button" disabled={!indicators.length} aria-pressed={selected} title={stage.hint}
              onClick={() => indicators[0] && onIndicatorChange(indicators[0].id)}
              className={`flex h-full w-full flex-col gap-2 p-4 text-left transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed motion-reduce:transition-none ${selected ? 'bg-raised shadow-[inset_0_-2px_0_var(--color-accent)]' : 'hover:bg-raised'}`}>
              <span className="flex items-center gap-1 font-mono text-xs text-muted">{String(index + 1).padStart(2, '0')}{index < groups.length - 1 && <ChevronRight size={12} strokeWidth={1.5} aria-hidden />}</span>
              <span className="text-sm font-medium text-ink">{stage.label}</span>
              {countyVerdict
                ? <span className="flex items-center gap-2 text-xs text-secondary"><VerdictDot verdict={countyVerdict} />{verdictLabels[countyVerdict]}</span>
                : indicators.length
                  ? <span className="text-xs text-secondary"><span className="font-mono tabular-nums text-ink">{counts.act}</span> act · <span className="font-mono tabular-nums text-ink">{counts.verify}</span> verify</span>
                  : <span className="text-xs text-muted">No indicator yet</span>}
            </button>
          </li>
        })}
      </ol>
      {active && <div className="grid gap-3 border-t border-line px-4 py-4 sm:px-5">
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Indicator in {active.stage.label}</legend>
          {active.indicators.map(item => <label key={item.id} className="cursor-pointer rounded-lg border border-line px-3 py-2 text-sm text-secondary has-checked:bg-raised has-checked:text-accent has-focus-visible:outline-2 has-focus-visible:outline-accent">
            <input className="sr-only" type="radio" name="pathway-indicator" checked={item.id === indicatorId} onChange={() => onIndicatorChange(item.id)} />
            {item.short || item.label}{item.is_proxy ? ' · proxy' : ''}
          </label>)}
        </fieldset>
        {indicator && <IndicatorNote indicator={indicator} national={snapshot.national[indicator.id]?.v ?? null} hint={active.stage.hint} />}
      </div>}
    </section>
  )
}

function IndicatorNote({ indicator, national, hint }: { indicator: PathwayIndicator; national: number | null; hint: string }) {
  return <p className="text-sm leading-relaxed text-secondary">
    <span className="text-ink">{indicator.label}</span> · national {formatValue(national, indicator.unit)} · {indicator.period}{polarityText(indicator) && ` · ${polarityText(indicator)}`}
    {indicator.is_proxy && <> · proxy measure</>}
    <span className="block text-xs text-muted">{hint}{indicator.source_url && <> · <a href={indicator.source_url} target="_blank" rel="noreferrer" className="text-accent underline decoration-accent/35 underline-offset-4 hover:decoration-accent focus-visible:outline-2 focus-visible:outline-accent">Source</a></>}</span>
  </p>
}
