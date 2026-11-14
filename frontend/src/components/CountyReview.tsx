import { lazy, Suspense, useState } from 'react'
import { Download, Printer, SlidersHorizontal, ShieldCheck, Users } from 'lucide-react'
import { useDashboard } from '../data/DashboardContext'
import { getCareCenters } from '../data/careCenters'
import { count } from '../data/regions'
import {
  asVerdict, comparatorLabel, downloadText, formatCount, formatInterval, formatValue,
  planMarkdown, polarityText, verdictColors, verdictRank, worstCountyVerdict,
  type PathwayCounty, type PathwaySnapshot,
} from '../data/pathway'
import { ActionCard } from './ActionCard'
import { VerdictBadge } from './VerdictBadge'
import { CountyMap } from './CountyMap'

const CountyAI = lazy(() => import('./CountyAI').then(module => ({ default: module.CountyAI })))
type Props = { selectedCountyId: string | null; onCountyChange: (id: string) => void }

const checkStyles: Record<string, string> = {
  pass: 'border-emerald-600/40 bg-emerald-600/10 text-ink',
  warn: 'border-amber-600/40 bg-amber-600/10 text-ink',
  fail: 'border-rose-600/50 bg-rose-600/10 text-ink',
  na: 'border-line bg-raised text-muted',
}

export function CountyReview({ selectedCountyId, onCountyChange }: Props) {
  const { pathway, regions } = useDashboard()
  const counties = Array.from(new Map([
    ...regions.map(region => [region.regionId, { code: region.regionId, name: region.regionName }] as const),
    ...(pathway?.counties ?? []).map(county => [county.code, county] as const),
  ]).values()).sort((a, b) => a.name.localeCompare(b.name, 'en'))
  const selected = counties.find(county => county.code === selectedCountyId) ?? counties[0]
  const county = pathway?.counties.find(county => county.code === selected?.code)

  return <main id="dashboard-content" className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-8">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-2xl font-medium">County Review</h2>
        <p className="mt-2 text-sm text-secondary">Local care gaps, 90-day costed playbooks, capacity simulator and peer benchmarks</p>
      </div>
      <div className="grid w-full gap-2 sm:w-64">
        <label htmlFor="review-county" className="text-xs text-muted">County</label>
        <select id="review-county" value={selected?.code ?? ''} disabled={!counties.length} onChange={event => onCountyChange(event.target.value)}
          className="min-h-10 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent">
          {counties.map(county => <option key={county.code} value={county.code}>{county.name}</option>)}
        </select>
      </div>
    </div>
    {county && pathway
      ? <CountyContent key={county.code} county={county} snapshot={pathway} onCountyChange={onCountyChange} />
      : <><section className="rounded-xl border border-line bg-panel p-6" role="status">
        <h3 className="text-lg font-medium">{selected?.name ?? 'No counties available'}</h3>
        <p className="mt-2 text-sm text-secondary">No pathway review is available for this county in the current snapshot. Choose another county to review its signals and actions.</p>
      </section>{selected && <CountyMap countyId={selected.code} countyName={selected.name} onCountyChange={onCountyChange} />}</>}
  </main>
}

function CountyContent({ county, snapshot, onCountyChange }: { county: PathwayCounty; snapshot: PathwaySnapshot; onCountyChange: (id: string) => void }) {
  const { offline } = useDashboard()
  const flagged = snapshot.stages.filter(stage => ['act', 'verify'].includes(asVerdict(county.stage_verdicts[stage.id]))).length
  const available = snapshot.indicators.filter(indicator => county.values[indicator.id]?.v != null).length
  const loSum = county.actions.reduce((s, a) => s + (a.cost_eur_lo ?? 0), 0)
  const hiSum = county.actions.reduce((s, a) => s + (a.cost_eur_hi ?? 0), 0)

  return <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_24rem]">
    <div className="grid min-w-0 gap-6">
      <section aria-label="County summary">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-xl font-medium">{county.name}</h3>
            {county.yta_name && <p className="mt-1 text-xs text-muted">{county.code} · {county.yta_name}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => downloadText(`action-plan-${county.code}.md`, planMarkdown(snapshot, county))}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-secondary hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent">
              <Download size={16} strokeWidth={1.5} aria-hidden />Export action plan
            </button>
            <button type="button" onClick={() => window.print()}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-secondary hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent">
              <Printer size={16} strokeWidth={1.5} aria-hidden />Print / PDF
            </button>
          </div>
        </div>
        <p className="mt-3 max-w-4xl text-base leading-relaxed text-secondary">{county.headline}</p>
        <dl className="mt-6 grid divide-y divide-line rounded-xl border border-line bg-panel lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          {[
            { label: 'Stages to review', value: `${flagged} / ${snapshot.stages.length}`, detail: 'Act or verify data' },
            { label: 'Recommended actions', value: String(county.actions.length), detail: hiSum > 0 ? `Indicative €${Math.round(loSum / 1000)}k–€${Math.round(hiSum / 1000)}k / yr` : 'Priority action expanded below' },
            { label: 'Indicators available', value: `${available} / ${snapshot.indicators.length}`, detail: 'Reported in this snapshot' },
          ].map(stat => <div key={stat.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 px-4 py-3 lg:block lg:p-5">
            <dt className="text-sm text-secondary">{stat.label}</dt>
            <dd className="font-mono text-2xl tabular-nums lg:mt-2">{stat.value}</dd>
            <dd className="mt-2 hidden text-xs text-muted lg:block">{stat.detail}</dd>
          </div>)}
        </dl>
      </section>
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
        <section aria-labelledby="county-actions-title" className="min-w-0">
          <h3 id="county-actions-title" className="text-lg font-medium">Recommended actions</h3>
          <p className="mt-1 text-xs text-muted">Priority action opened first · includes owner, 90-day milestones, FTE/costing and verified policy citations</p>
          {county.actions.length
            ? <ol className="mt-4 grid gap-3">{county.actions.map((action, index) => <ActionCard key={`${action.playbook_id}-${index}`} action={action} number={index + 1} verdict={county.stage_verdicts[action.pathway_stage]} stage={snapshot.stages.find(stage => stage.id === action.pathway_stage)?.label ?? action.pathway_stage} onSelectPeer={onCountyChange} />)}</ol>
            : <p className="mt-4 rounded-xl border border-line bg-panel p-4 text-sm leading-relaxed text-secondary">No action is triggered for this county. Continue monitoring the pathway and review any data gaps below.</p>}
        </section>
        <div className="grid gap-6">
          <section aria-labelledby="county-pathway-title" className="rounded-xl border border-line bg-panel">
            <h3 id="county-pathway-title" className="border-b border-line p-4 text-sm font-medium">Pathway status</h3>
            <ul className="divide-y divide-line">
              {snapshot.stages.map(stage => <li key={stage.id} className="flex items-center justify-between gap-4 px-4 py-3" title={stage.hint}>
                <span className="text-sm text-secondary">{stage.label}</span>
                <span className="shrink-0"><VerdictBadge verdict={county.stage_verdicts[stage.id]} title={snapshot.verdicts[asVerdict(county.stage_verdicts[stage.id])]?.desc} /></span>
              </li>)}
            </ul>
          </section>
          <PeersAndContext county={county} snapshot={snapshot} onCountyChange={onCountyChange} />
        </div>
      </div>
      {county.actions.some(a => a.cost_eur_hi != null || a.annual_volume_n != null) && (
        <WorkloadSimulator county={county} />
      )}
      <CountyMap countyId={county.code} countyName={county.name} onCountyChange={onCountyChange} />
      <CountyIndicators county={county} snapshot={snapshot} />
      <DataQualityDrawer snapshot={snapshot} />
      <p className="text-xs leading-relaxed text-muted">Figures are descriptive and not risk-adjusted. Missing records can reflect incomplete reporting rather than missing treatment. Cost and FTE figures are operational planning estimates. Referral stages use proxies.{snapshot.placeholder ? ' This build bundles a lung-only placeholder snapshot.' : ''}</p>
    </div>
    <aside aria-labelledby="county-review-tools-title" className="min-w-0 overflow-hidden rounded-xl border border-line bg-panel xl:sticky xl:top-6 xl:max-h-[calc(100dvh-3rem)] xl:overflow-y-auto">
      <h3 id="county-review-tools-title" className="sticky top-0 z-10 border-b border-line bg-panel p-4 text-sm font-medium">Review tools and county questions</h3>
      <div className="min-w-0 p-4 [&>section]:mt-0 [&>section]:border-t-0 [&>section]:pt-0 [&_textarea]:min-w-0">
        {offline
          ? <p className="text-sm text-muted">AI review and chat need the backend. The action plan export works offline.</p>
          : <Suspense fallback={<p className="text-sm text-muted">Loading review tools…</p>}><CountyAI areaCode={county.code} /></Suspense>}
      </div>
    </aside>
  </div>
}

function WorkloadSimulator({ county }: { county: PathwayCounty }) {
  const [ambition, setAmbition] = useState<'0.5' | '1' | '1.25'>('1')
  const scale = Number(ambition)
  const centers = getCareCenters(county.code)
  const totals = county.actions.reduce((acc, a) => {
    const cases = Math.round((a.annual_volume_n ?? 0) * scale)
    const hours = Math.round((a.fixed_hours ?? 0) + cases * (a.unit_hours ?? 0))
    const lo = Math.round((a.fixed_cost_lo ?? 0) + cases * (a.unit_cost_lo ?? 0))
    const hi = Math.round((a.fixed_cost_hi ?? 0) + cases * (a.unit_cost_hi ?? 0))
    const slots = Math.round(cases * (a.capacity_per_case ?? 0))
    return {
      cases: acc.cases + cases,
      hours: acc.hours + hours,
      lo: acc.lo + lo,
      hi: acc.hi + hi,
      slots: acc.slots + slots,
    }
  }, { cases: 0, hours: 0, lo: 0, hi: 0, slots: 0 })
  const fte = (totals.hours / 1600).toFixed(2)
  const monthlyPerHospital = centers.length > 0 ? Math.max(1, Math.round(totals.cases / 12 / centers.length)) : null

  return (
    <section aria-labelledby="simulator-title" className="rounded-xl border border-line bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={16} strokeWidth={1.5} className="text-accent" aria-hidden />
          <h3 id="simulator-title" className="text-base font-medium">What-if ambition &amp; capacity simulator</h3>
        </div>
        <fieldset className="flex flex-wrap gap-1 rounded-lg border border-line p-1">
          <legend className="sr-only">Target ambition level</legend>
          {([
            { id: '0.5', label: '50% gap (Year 1)' },
            { id: '1', label: '100% match rest of Finland' },
            { id: '1.25', label: 'Strategy 2030 stretch' },
          ] as const).map(opt => (
            <label key={opt.id} className="cursor-pointer rounded-md px-2.5 py-1 text-xs text-secondary has-checked:bg-raised has-checked:font-medium has-checked:text-accent has-focus-visible:outline-2 has-focus-visible:outline-accent">
              <input className="sr-only" type="radio" name={`ambition-${county.code}`} value={opt.id} checked={ambition === opt.id} onChange={() => setAmbition(opt.id)} />
              {opt.label}
            </label>
          ))}
        </fieldset>
      </div>
      <p className="mt-2 text-xs text-muted">Operational workload sizing across {county.name}’s {county.actions.length} triggered {county.actions.length === 1 ? 'action' : 'actions'} (models clinical/audit capacity, not causal survival claims).</p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg bg-page p-3">
          <dt className="text-xs text-muted">Annual cases / outreach in scope</dt>
          <dd className="mt-1 font-mono text-lg tabular-nums text-ink">{count(totals.cases)} / yr</dd>
          <dd className="mt-0.5 text-[11px] text-muted">≈{count(Math.ceil(totals.cases / 12))} / month</dd>
        </div>
        <div className="rounded-lg bg-page p-3">
          <dt className="text-xs text-muted">Staffing requirement</dt>
          <dd className="mt-1 font-mono text-lg tabular-nums text-ink">{fte} FTE</dd>
          <dd className="mt-0.5 text-[11px] text-muted">≈{count(totals.hours)} clinician/coder/nurse h/yr</dd>
        </div>
        <div className="rounded-lg bg-page p-3">
          <dt className="text-xs text-muted">Specialist / audit slots</dt>
          <dd className="mt-1 font-mono text-lg tabular-nums text-ink">{count(totals.slots)} / yr</dd>
          <dd className="mt-0.5 text-[11px] text-muted">{monthlyPerHospital && centers.length ? `≈${monthlyPerHospital}/mo across ${centers.length} care ${centers.length === 1 ? 'unit' : 'units'}` : 'Endoscopy, CT/MDT & chart audits'}</dd>
        </div>
        <div className="rounded-lg bg-page p-3">
          <dt className="text-xs text-muted">Indicative planning budget</dt>
          <dd className="mt-1 font-mono text-lg tabular-nums text-ink">€{count(Math.round(totals.lo / 100) * 100)}–€{count(Math.round(totals.hi / 100) * 100)}</dd>
          <dd className="mt-0.5 text-[11px] text-muted">Public unit-cost benchmark / yr</dd>
        </div>
      </dl>
      {centers.length > 0 && (
        <p className="mt-3 text-xs text-muted">Local delivery units in {county.name}: <span className="text-secondary">{centers.map(c => c.name).join(' · ')}</span></p>
      )}
    </section>
  )
}

function PeersAndContext({ county, snapshot, onCountyChange }: { county: PathwayCounty; snapshot: PathwaySnapshot; onCountyChange: (id: string) => void }) {
  const ctx = county.context ?? {}
  const peers = county.peers ?? []
  const mort = county.mortality_trend ?? []
  if (!peers.length && !Object.keys(ctx).length) return null

  return (
    <section aria-labelledby="peers-title" className="rounded-xl border border-line bg-panel p-4">
      <div className="flex items-center gap-2">
        <Users size={15} strokeWidth={1.5} className="text-accent" aria-hidden />
        <h3 id="peers-title" className="text-sm font-medium">Demographic peers &amp; context</h3>
      </div>
      {Object.keys(ctx).length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-page p-2.5 text-xs">
          {ctx.ctx_65 != null && <div><dt className="text-muted">Aged 65+</dt><dd className="font-mono text-ink">{ctx.ctx_65.toFixed(1)}%</dd></div>}
          {ctx.ctx_rural != null && <div><dt className="text-muted">Rural share</dt><dd className="font-mono text-ink">{ctx.ctx_rural.toFixed(1)}%</dd></div>}
          {ctx.ctx_foreign != null && <div><dt className="text-muted">Foreign language</dt><dd className="font-mono text-ink">{ctx.ctx_foreign.toFixed(1)}%</dd></div>}
          {ctx.ctx_swedish != null && <div><dt className="text-muted">Swedish speaking</dt><dd className="font-mono text-ink">{ctx.ctx_swedish.toFixed(1)}%</dd></div>}
        </dl>
      )}
      {peers.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-muted">Nearest StatFin 11ra peers (click to compare):</p>
          <ul className="mt-2 grid gap-1.5">
            {peers.map(peer => {
              const peerEntry = snapshot.counties.find(c => c.code === peer.code)
              const w = peerEntry ? worstCountyVerdict(snapshot, peerEntry) : null
              return (
                <li key={peer.code}>
                  <button type="button" onClick={() => onCountyChange(peer.code)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-line px-2.5 py-2 text-left text-xs hover:border-accent hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent">
                    <span className="font-medium text-ink">{peer.name}</span>
                    {w && <VerdictBadge verdict={w.verdict} />}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {mort.length >= 2 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-xs text-muted">Crude cancer death rate /100k ({mort[0].year}–{mort.at(-1)!.year}, StatFin 13u5):</p>
          <div className="mt-1.5 flex items-end gap-1.5">
            {mort.map(pt => {
              const maxRate = Math.max(...mort.map(m => m.crude_rate ?? 0), 1)
              const h = Math.max(6, Math.round(((pt.crude_rate ?? 0) / maxRate) * 28))
              return (
                <div key={pt.year} className="flex flex-1 flex-col items-center gap-1" title={`${pt.year}: ${pt.crude_rate ?? '—'} /100k (${pt.deaths ?? '—'} deaths)`}>
                  <span className="w-full rounded-xs bg-accent/65" style={{ height: `${h}px` }} />
                  <span className="font-mono text-[10px] text-muted">{String(pt.year).slice(-2)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}

function CountyIndicators({ county, snapshot }: { county: PathwayCounty; snapshot: PathwaySnapshot }) {
  const indicators = [...snapshot.indicators].sort((a, b) => verdictRank(county.values[a.id]?.verdict) - verdictRank(county.values[b.id]?.verdict))

  return <details className="overflow-hidden rounded-xl border border-line bg-panel">
    <summary className="cursor-pointer p-4 text-sm font-medium hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">Inspect indicators · {indicators.length}</summary>
    <p className="border-t border-line px-4 py-3 text-xs text-muted">Priority signals first. Expand a signal for its 95% CI bar, 2020–2024 trend, 7 automated evidence checks and source.</p>
    <ul className="divide-y divide-line border-t border-line">
      {indicators.map(indicator => {
        const value = county.values[indicator.id]
        const comparator = value?.comparator ?? snapshot.national[indicator.id]?.v
        const compLabel = comparatorLabel(value, indicator.id, true)
        const source = indicator.source_url
        const isPct = indicator.unit === '%' && value?.v != null
        return <li key={indicator.id}>
          <details>
            <summary className="cursor-pointer px-4 py-3 hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
              <span className="ml-1 inline-grid w-[calc(100%-2rem)] grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-2 align-middle text-sm">
                <span className="text-secondary">{indicator.label}{indicator.is_proxy ? ' (proxy)' : ''}</span>
                <span className="text-right font-mono tabular-nums">{formatValue(value?.v, indicator.unit)}</span>
                <span className="text-xs text-muted">{value?.period ?? indicator.period}{value?.score != null ? ` · evidence score ${value.score}%` : ''}</span>
                <span className="text-right"><VerdictBadge verdict={value?.v == null ? 'nodata' : value.verdict} /></span>
              </span>
            </summary>
            <div className="grid gap-3 border-t border-line bg-page p-4 text-sm text-secondary">
              {value?.v == null ? <p>No published value for this county in this period</p> : <>
                <p>{compLabel}: <span className="font-mono tabular-nums text-ink">{formatValue(comparator, indicator.unit)}</span>{polarityText(indicator) ? ` · ${polarityText(indicator)}` : ''}</p>
                {isPct && (
                  <div className="grid gap-1">
                    <div className="relative h-2.5 rounded-full bg-line/70" role="img" aria-label={`${indicator.label}: county ${formatValue(value.v, '%')} vs ${compLabel.toLowerCase()} ${formatValue(comparator, '%')}`}>
                      {value.lo != null && value.hi != null && (
                        <span className="absolute inset-y-0 rounded-full bg-secondary/30" style={{ left: `${Math.max(0, Math.min(100, value.lo))}%`, width: `${Math.max(1, Math.min(100, value.hi) - Math.max(0, value.lo))}%` }} />
                      )}
                      <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-page" style={{ left: `${Math.max(0, Math.min(100, value.v))}%`, backgroundColor: verdictColors[asVerdict(value.verdict)] }} />
                      {comparator != null && <span className="absolute -top-1 -bottom-1 w-0.5 bg-ink" style={{ left: `${Math.max(0, Math.min(100, comparator))}%` }} />}
                    </div>
                    <p className="text-[11px] text-muted">Dot = county · shaded band = 95% CI · vertical tick = {compLabel.toLowerCase()}</p>
                  </div>
                )}
                {value.reason && <p className="leading-relaxed">{value.reason}</p>}
                {[formatInterval(value, indicator.unit), formatCount(value)].filter(Boolean).length > 0 && <p className="text-xs text-muted">{[formatInterval(value, indicator.unit), formatCount(value)].filter(Boolean).join(' · ')}</p>}
                {value.series && value.series.length > 1 && (
                  <div className="rounded-lg border border-line bg-panel p-3">
                    <p className="text-xs font-medium text-ink">Multi-year trajectory ({value.series[0].period}–{value.series.at(-1)!.period})</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                      {value.series.map(pt => (
                        <div key={pt.period} className="rounded-md bg-page px-2.5 py-1.5 text-xs">
                          <span className="block font-mono text-[11px] text-muted">{pt.period}</span>
                          <span className="font-mono font-medium text-ink">{formatValue(pt.v, indicator.unit)}</span>
                          {pt.comparator != null && <span className="block text-[10px] text-muted">vs {formatValue(pt.comparator, indicator.unit)}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {value.checks && value.checks.length > 0 && (
                  <div className="rounded-lg border border-line bg-panel p-3">
                    <p className="text-xs font-medium text-ink">7-point automated evidence check{value.score != null ? ` (${value.score}% score)` : ''}</p>
                    <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                      {value.checks.map(chk => (
                        <li key={chk.id} title={chk.detail} className={`rounded-md border px-2.5 py-1.5 text-xs ${checkStyles[chk.status] ?? checkStyles.na}`}>
                          <span className="font-medium uppercase">{chk.status}</span> · {chk.label}
                          <span className="mt-0.5 block text-[11px] text-muted">{chk.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>}
              {indicator.desc && <p className="text-xs leading-relaxed text-muted">{indicator.desc}</p>}
              {indicator.caveat && <p className="text-xs leading-relaxed text-muted">{indicator.caveat}</p>}
              {source && <a href={source} target="_blank" rel="noreferrer" className="justify-self-start text-xs text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent">Source report</a>}
            </div>
          </details>
        </li>
      })}
    </ul>
  </details>
}

function DataQualityDrawer({ snapshot }: { snapshot: PathwaySnapshot }) {
  if (!snapshot.validation && !snapshot.data_gaps?.length) return null
  const totalChecks = snapshot.validation ? snapshot.validation.source_integrity + snapshot.validation.analytical : 0
  return (
    <details className="overflow-hidden rounded-xl border border-line bg-panel">
      <summary className="flex cursor-pointer items-center gap-2 p-4 text-sm font-medium hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
        <ShieldCheck size={16} strokeWidth={1.5} className="text-accent" aria-hidden />
        <span>Why Verify data vs. Act? · {totalChecks > 0 ? `${count(totalChecks)} automated checks & ` : ''}known structural data gaps</span>
      </summary>
      <div className="grid gap-3 border-t border-line p-4 text-xs leading-relaxed text-secondary">
        {snapshot.validation && (
          <p>
            <span className="font-medium text-ink">Provenance &amp; validation:</span> {count(snapshot.validation.source_integrity)} source-integrity checks (SHA-256 hashes, PDF signatures, StatFin cube dimensions) and {count(snapshot.validation.analytical)} analytical checks (leave-one-out comparator arithmetic, 95% Wilson/Katz intervals, county-to-national sums), plus {snapshot.validation.citations_verified}/{snapshot.validation.citations_total} verbatim page-verified policy quotes.
          </p>
        )}
        {snapshot.data_gaps?.map((gap, i) => (
          <div key={i} className="rounded-lg bg-page p-3">
            <p className="font-medium text-ink">Data gap ({gap.stage}): {gap.what}</p>
            <p className="mt-1 text-muted">{gap.why}</p>
          </div>
        ))}
      </div>
    </details>
  )
}
