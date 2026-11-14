import { useEquityAI } from '../data/AIGenerationContext'
import { groupLabel, number, numeric, percentage, type buildComparison, type EquityBriefingInput, type EquityGroup, type Observation } from '../data/equity'
import { ChatText } from './intelligent-ui/ChatText'
import { BriefingDrawer } from './BriefingDrawer'
import { GenerationSteps } from './GenerationSteps'

type Props = { rows: Observation[]; comparison: ReturnType<typeof buildComparison>; selected: EquityGroup | null; input: EquityBriefingInput; limitations: string[]; open: boolean; onClose: () => void }

export function EquityBriefing({ rows, comparison, selected, input, limitations, open, onClose }: Props) {
  const { briefing: response, progress, draft, loading, error, stopped, session } = useEquityAI(input)
  const pending = progress !== null
  const sources = [...new Set(rows.map(row => row.source_url))]
  const invited = numeric(selected?.invited)
  const attended = numeric(selected?.attended)

  function citations(ids: string[]) {
    return <div className="mt-2 flex flex-wrap gap-2">{ids.map(id => {
      const evidence = response?.evidence.find(item => item.id === id)
      const source = evidence?.row.source_url
      return typeof source === 'string' && (source.startsWith('https://') || source.startsWith('http://')) ? <a key={id} href={source} target="_blank" rel="noreferrer" className="text-xs text-accent underline underline-offset-4">{id}</a> : <span key={id} className="text-xs text-muted">{id}</span>
    })}</div>
  }

  return <BriefingDrawer id="equity-briefing-panel" title="AI briefing" open={open} onClose={onClose}>
    <div className="border-b border-line px-6 py-5 sm:px-8"><h3 className="text-lg font-medium">{input.label}</h3><p className="mt-2 text-xs leading-relaxed text-muted">From the same observations as the charts. Generation continues when this panel closes or you switch dashboards. Each filter combination keeps its own saved briefing.</p></div>
    <div className="grid gap-6 px-6 py-6 sm:px-8">
      <section aria-label="Evidence at a glance"><h4 className="text-sm font-medium">Evidence at a glance</h4><p className="mt-2 text-xs leading-relaxed text-muted">Calculated directly from published data, not AI-generated.</p>
        <ul className="mt-4 grid gap-4 text-sm leading-relaxed text-secondary">
          {comparison.gap !== null && comparison.lowest && comparison.highest && <li><span className="font-medium tabular-nums text-ink">{comparison.gap.toFixed(1)} pp</span> separate {groupLabel(comparison.lowest.label)} ({percentage(numeric(comparison.lowest.rate))}) and {groupLabel(comparison.highest.label)} ({percentage(numeric(comparison.highest.rate))}).</li>}
          {selected && <li><span className="font-medium text-ink">{groupLabel(selected.label)}</span>: {number(attended)} attended out of {number(invited)} in the published screening population.</li>}
          {invited !== null && attended !== null && invited >= attended && <li><span className="font-medium tabular-nums text-ink">{number(invited - attended)}</span> did not attend. This is an observed participation count, not an estimate of missed cancers.</li>}
        </ul>
      </section>
      <section aria-label="Generated equity briefing" className="border-t border-line pt-5">
        <button type="button" onClick={() => void session.generate()} disabled={pending || loading || !rows.length} className="min-h-10 w-full rounded-lg border border-accent bg-accent px-3 py-2 text-sm font-medium text-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60 dark:bg-ink dark:text-page">{pending ? 'Generating briefing…' : response ? 'Regenerate AI briefing' : 'Generate AI briefing'}</button>
        <p className="mt-2 text-xs leading-relaxed text-muted">Uses {rows.length} source observations. Requires a configured AI provider.</p>
        {loading && <p className="mt-4 text-xs text-muted" role="status">Restoring saved briefing…</p>}
        {response && <p className="mt-3 text-xs text-muted">Saved {new Date(response.created_at).toLocaleString('en-GB')}{response.stale ? ' · Source data or model changed; regenerate before use.' : ''}</p>}
        {progress && <div className="mt-4 grid gap-3"><div role="status"><GenerationSteps steps={progress.steps} active /></div><button type="button" onClick={session.stop} className="justify-self-start text-xs text-accent underline underline-offset-4">Stop generating briefing</button></div>}
        {(progress?.text || draft?.text) && <div className="mt-4"><ChatText text={progress?.text || draft?.text || ''} streaming={pending} /></div>}
        {stopped && <p className="mt-3 text-xs text-muted">Stopped. Generate again to retry.</p>}
        {error && <p className="mt-4 text-sm text-secondary" role="alert">{error} The source evidence remains available; retry generation when the service is ready.</p>}
        {response && !pending && <div className="mt-5 grid gap-5"><ChatText text={response.answer.summary} />
          {response.answer.findings.map((finding, index) => <section key={index}><h4 className="text-sm font-medium">{finding.title}</h4><div className="mt-2"><ChatText text={finding.detail} /></div>{finding.bullets?.length ? <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-secondary">{finding.bullets.map(bullet => <li key={bullet}>{bullet}</li>)}</ul> : null}{citations(finding.evidence_ids)}</section>)}
          {response.answer.proposals.map((proposal, index) => <section key={index} className="border-l-2 border-accent pl-3"><h4 className="text-sm font-medium">{proposal.title}</h4><p className="mt-2 text-sm leading-relaxed text-secondary">{proposal.detail}</p><p className="mt-2 text-xs leading-relaxed text-muted">Owner: {proposal.owner} · Measure: {proposal.measure}</p>{citations(proposal.evidence_ids)}</section>)}
          <p className="text-xs text-muted">Generated by {response.model} · {response.provider}</p>
        </div>}
      </section>
      <section className="border-t border-line pt-5"><h4 className="text-sm font-medium">Read with care</h4><ul className="mt-3 grid gap-2 text-xs leading-relaxed text-muted"><li>Descriptive, unadjusted differences are not proof of causation or statistical significance.</li><li>Downstream diagnoses and treatment cannot be inferred from non-attendance. Local clinical review comes before action.</li>{[...new Set([...limitations, ...(response?.answer.limitations ?? [])])].map(limitation => <li key={limitation}>{limitation}</li>)}</ul></section>
      <footer className="border-t border-line pt-5"><p className="text-xs text-muted">Finnish Cancer Registry · {selected?.rate.year}</p>{sources.map(source => <a key={source} href={source} target="_blank" rel="noreferrer" className="mt-2 block text-xs text-accent underline underline-offset-4">Published screening report</a>)}</footer>
    </div>
  </BriefingDrawer>
}
