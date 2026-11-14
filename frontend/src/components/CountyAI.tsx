import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, type AIResponse, type SavedProposal } from '../lib/api'
import { AnswerView } from './intelligent-ui/AnswerView'

type Turn = { question: string; response: AIResponse }
const button = 'rounded-lg border border-line px-3 py-2 text-sm text-accent hover:bg-raised disabled:cursor-wait disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent'

export function CountyAI({ areaCode }: { areaCode: string }) {
  const [proposal, setProposal] = useState<SavedProposal | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const controller = useRef<AbortController | null>(null)
  const path = `/counties/${encodeURIComponent(areaCode)}`
  useEffect(() => {
    const request = new AbortController()
    api<{ proposal: SavedProposal | null }>(`${path}/proposal`, { signal: request.signal })
      .then(result => setProposal(result.proposal))
      .catch(e => { if (!request.signal.aborted) setError(e.message) })
      .finally(() => { if (!request.signal.aborted) setLoading(false) })
    return () => { request.abort(); controller.current?.abort() }
  }, [path])

  async function generate() {
    setBusy(true); setError('')
    const request = new AbortController(); controller.current = request
    try {
      setProposal(await api<SavedProposal>(`${path}/proposal${proposal ? '?force=true' : ''}`, { method: 'POST', signal: request.signal }))
    } catch (e) { if (!request.signal.aborted) setError(e instanceof Error ? e.message : 'Generation failed') }
    finally { if (!request.signal.aborted) setBusy(false) }
  }
  async function send(event: FormEvent) {
    event.preventDefault()
    if (!question.trim() || busy) return
    const text = question.trim()
    setBusy(true); setError('')
    const request = new AbortController(); controller.current = request
    try {
      const history = turns.slice(-6).flatMap(turn => [{ role: 'user', content: turn.question }, { role: 'assistant', content: JSON.stringify(turn.response.answer).slice(0, 8000) }])
      const response = await api<AIResponse>(`${path}/chat`, { method: 'POST', signal: request.signal, body: JSON.stringify({ question: text, history }) })
      setTurns(previous => [...previous, { question: text, response }]); setQuestion('')
    } catch (e) { if (!request.signal.aborted) setError(e instanceof Error ? e.message : 'Chat request failed') }
    finally { if (!request.signal.aborted) setBusy(false) }
  }
  return <section className="mt-6 border-t border-line pt-4" aria-label="County review and chat">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-medium">Review proposals</h3>
      <button className={button} disabled={busy || loading} onClick={generate}>{proposal ? 'Regenerate' : 'Generate review'}</button>
    </div>
    {loading && <p className="mt-3 text-sm text-muted" role="status">Loading stored review…</p>}
    {!loading && !proposal && <p className="mt-3 text-sm text-muted">Generate a review from this county’s registry evidence. Proposals are saved for future visits.</p>}
    {proposal && <>
      <p className="mt-3 text-xs text-muted">Saved {new Date(proposal.created_at + 'Z').toLocaleString()}</p>
      {proposal.stale && <p className="mt-2 text-sm text-accent">Source data has changed. Regenerate this review before use.</p>}
      <AnswerView key={proposal.id} response={proposal} />
    </>}
    <div className="mt-6 border-t border-line pt-4">
      <h3 className="text-sm font-medium">Ask about this county</h3>
      <p className="mt-2 text-xs leading-relaxed text-muted">Explore relevant findings, review priorities, and evidence gaps. Chat is kept for this open briefing.</p>
      <div className="mt-4 grid gap-6" aria-live="polite">
        {turns.map((turn, i) => <div key={i}><p className="rounded-lg bg-raised p-3 text-sm">{turn.question}</p><AnswerView response={turn.response} /></div>)}
      </div>
      <form onSubmit={send} className="mt-4 grid gap-3">
        <label htmlFor={`question-${areaCode}`} className="text-xs text-secondary">Your question</label>
        <textarea id={`question-${areaCode}`} required maxLength={2000} rows={3} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Which data gaps should we review first?" className="w-full resize-y rounded-lg border border-line bg-page p-3 text-sm focus-visible:outline-2 focus-visible:outline-accent" />
        <button className={`${button} justify-self-start`} disabled={busy || !question.trim()}>Send question</button>
      </form>
    </div>
    {busy && <p className="mt-3 text-sm text-muted" role="status">Reviewing county evidence…</p>}
    {error && <p className="mt-3 text-sm text-accent" role="alert">{error}</p>}
  </section>
}
