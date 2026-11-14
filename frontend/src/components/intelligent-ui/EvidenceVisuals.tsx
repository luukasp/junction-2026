import type { AIResponse, Evidence } from '../../lib/api'
import { labels, number, numeric, percentage, sourceId, visualEvidence } from './visualData'

function EvidenceLink({ evidence, sourcePrefix }: { evidence: Evidence; sourcePrefix: string }) {
  return <a href={`#${sourceId(sourcePrefix, evidence.id)}`} className="text-xs text-muted underline decoration-line underline-offset-4 hover:text-accent" onClick={event => {
    const target = document.getElementById(event.currentTarget.hash.slice(1))
    if (target instanceof HTMLDetailsElement) {
      for (let parent = target.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true
      target.open = true
    }
  }}>Source row</a>
}

function ScreeningMeasures({ evidence, sourcePrefix }: { evidence: Evidence[]; sourcePrefix: string }) {
  const measures = evidence.filter(item => item.dataset === 'screening'
    && (item.row.unit === 'percent' || String(item.row.metric).endsWith('| %'))
    && percentage(item.row.value)).slice(0, 4)
  if (!measures.length) return null
  return <figure className="rounded-xl border border-line bg-page p-4" aria-label="Screening measures from cited evidence">
    <figcaption className="text-sm font-medium">Screening measures</figcaption>
    <p className="mt-1 text-xs leading-relaxed text-muted">Each measure uses its source population and denominator</p>
    <div className="mt-4 grid gap-5">
      {measures.map(item => <div key={item.id}>
        <p className="mb-1 text-xs capitalize text-muted">{String(item.row.program)} screening · {String(item.row.year)}</p>
        <div className="mb-2 flex items-start justify-between gap-4"><span className="text-xs leading-relaxed text-secondary">{String(item.row.metric).replace(/\s*\|\s*%$/, '')}</span><span className="shrink-0 font-mono text-sm tabular-nums text-ink">{number(item.row.value as number)}%</span></div>
        <div role="img" aria-label={`${String(item.row.program)}: ${String(item.row.metric)}, ${number(item.row.value as number)} percent`} className="h-3 overflow-hidden rounded-sm bg-line"><div className="h-full bg-accent/80" style={{ width: `${item.row.value}%` }} /></div>
        {item.row.strata && Object.keys(item.row.strata as object).length > 0 ? <p className="mt-2 text-xs text-muted">Stratum · {JSON.stringify(item.row.strata)}</p> : null}
        <div className="mt-2"><EvidenceLink evidence={item} sourcePrefix={sourcePrefix} /></div>
      </div>)}
    </div>
    <div aria-hidden className="mt-3 flex justify-between font-mono text-xs text-muted"><span>0%</span><span>100%</span></div>
  </figure>
}

export function EvidenceVisuals({ response, sourcePrefix }: { response: AIResponse; sourcePrefix: string }) {
  const evidence = visualEvidence(response)
  const gap = evidence.find(item => item.dataset === 'treatments' && item.row.treatment_type_fi === 'Ei hoitotietoa'
    && percentage(item.row.share_pct) && numeric(item.row.patients_n) && item.row.patients_n > 0
    && numeric(item.row.treatment_n) && item.row.treatment_n >= 0 && item.row.treatment_n <= item.row.patients_n)
  const categories = gap ? evidence.filter(item => item.dataset === 'treatments'
    && item.row.area_code === gap.row.area_code && item.row.diagnosis_period === gap.row.diagnosis_period
    && item.row.patients_n === gap.row.patients_n && typeof item.row.treatment_type_fi === 'string'
    && labels[item.row.treatment_type_fi] && percentage(item.row.share_pct)).slice(0, 4) : []

  if (!gap) return <ScreeningMeasures evidence={evidence} sourcePrefix={sourcePrefix} />
  const share = gap.row.share_pct as number
  const patients = gap.row.patients_n as number
  const missing = gap.row.treatment_n as number
  const recorded = patients - missing
  const width = 100 * missing / patients

  return <section aria-label="Treatment documentation visual summary" className="overflow-hidden rounded-xl border border-line bg-page">
    <div className="grid grid-cols-[3fr_2fr] divide-x divide-line border-b border-line">
      <div className="p-4">
        <p className="text-xs text-muted">Without a treatment record</p>
        <p className="mt-2 font-mono text-3xl tabular-nums text-accent">{number(share)}<span className="text-lg">%</span></p>
      </div>
      <div className="p-4">
        <p className="text-xs text-muted">Patients to review</p>
        <p className="mt-2 font-mono text-2xl tabular-nums">{number(missing)}</p>
        <p className="mt-1 text-xs text-muted">of {number(patients)} patients</p>
      </div>
    </div>
    <figure className="p-4">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
        Treatment documentation <span className="font-mono text-xs font-normal text-muted">{String(gap.row.diagnosis_period ?? '')}</span>
      </figcaption>
      <div role="img" aria-label={`${number(missing)} patients without a treatment record; ${number(recorded)} with a record, of ${number(patients)} patients`} className="mt-4 flex h-8 overflow-hidden rounded-md bg-line">
        <div className="h-full bg-accent" style={{ width: `${width}%` }} />
        <div className="h-full bg-secondary/25" style={{ width: `${100 - width}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4 text-xs">
        <p className="text-secondary"><span className="mb-1 block font-mono tabular-nums text-ink">{number(missing)}</span><span className="mr-2 inline-block size-2 rounded-sm bg-accent" />No record</p>
        <p className="text-secondary"><span className="mb-1 block font-mono tabular-nums text-ink">{number(recorded)}</span><span className="mr-2 inline-block size-2 rounded-sm bg-secondary/40" />With a record</p>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-muted">A missing record does not mean treatment was not provided.</p>
      <div className="mt-2"><EvidenceLink evidence={gap} sourcePrefix={sourcePrefix} /></div>
    </figure>
    {categories.length > 0 && <details className="border-t border-line p-4">
      <summary className="cursor-pointer text-sm text-secondary">Compare recorded treatment categories</summary>
      <figure className="mt-4">
        <figcaption className="text-xs text-muted">Share of the same {number(patients)}-patient cohort · categories overlap</figcaption>
        <div className="mt-4 grid gap-4">
          {categories.map(item => <div key={item.id}>
            <div className="mb-2 flex justify-between gap-3 text-xs text-secondary"><span>{labels[String(item.row.treatment_type_fi)]}</span><span className="font-mono tabular-nums text-ink">{number(item.row.share_pct as number)}%</span></div>
            <div role="img" aria-label={`${labels[String(item.row.treatment_type_fi)]}: ${number(item.row.share_pct as number)} percent`} className="h-2 overflow-hidden rounded-sm bg-line"><div className="h-full bg-secondary" style={{ width: `${item.row.share_pct}%` }} /></div>
            <div className="mt-1"><EvidenceLink evidence={item} sourcePrefix={sourcePrefix} /></div>
          </div>)}
        </div>
        <div aria-hidden className="mt-3 flex justify-between font-mono text-xs text-muted"><span>0%</span><span>100%</span></div>
      </figure>
    </details>}
    {evidence.some(item => item.dataset === 'screening' && (item.row.unit === 'percent' || String(item.row.metric).endsWith('| %')) && percentage(item.row.value)) && <details className="border-t border-line p-4">
      <summary className="cursor-pointer text-sm text-secondary">Screening participation and follow-up</summary>
      <div className="mt-4"><ScreeningMeasures evidence={evidence} sourcePrefix={sourcePrefix} /></div>
    </details>}
  </section>
}

export function CompletenessChart({ response }: { response: AIResponse }) {
  return <figure className="mt-4 grid gap-3" aria-label="Missing numeric values by dataset">
    <figcaption className="text-xs text-secondary">Missing numeric values in county data</figcaption>
    {response.quality.coverage.map(item => <div key={item.dataset}>
      <div className="mb-1 flex justify-between gap-3 text-xs text-muted"><span>{item.dataset}</span><span className="font-mono tabular-nums">{item.numeric_cells ? `${number(100 * item.missing_values / item.numeric_cells)}% missing` : 'No data'}</span></div>
      {item.numeric_cells > 0 && <div className="h-2 overflow-hidden rounded-sm bg-line"><div className="h-full bg-secondary" style={{ width: `${Math.min(100, Math.max(0, 100 * item.missing_values / item.numeric_cells))}%` }} /></div>}
    </div>)}
  </figure>
}
