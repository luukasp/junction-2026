import { ArrowUp, Check, Loader2, RotateCcw, Sparkles, Square } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { api, streamApi, type AIResponse, type SavedProposal, type StreamEvent } from '../lib/api'
import { AnswerView } from './intelligent-ui/AnswerView'
import { ChatText } from './intelligent-ui/ChatText'

type Step = { stage: string; message: string }
type Progress = { steps: Step[]; text: string }
type Message =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'assistant'; question: string; progress: Progress; response?: AIResponse; error?: string; stopped?: boolean }

const button = 'inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-accent hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent'
const suggestions = [
  'Where does our pathway lag Finland most?',
  'How does our screening uptake compare?',
  'What should we review first, and who owns it?',
  'Which data gaps limit this picture?',
]
const emptyProgress = (): Progress => ({ steps: [], text: '' })

function reduce(progress: Progress, event: StreamEvent): Progress {
  if (event.type === 'status') {
    // A repair attempt restarts the reply; drop the rejected draft.
    return { steps: [...progress.steps, { stage: event.stage, message: event.message }], text: event.stage === 'repairing' ? '' : progress.text }
  }
  if (event.type === 'delta') return { ...progress, text: event.text }
  return progress
}

function Steps({ steps, active }: { steps: Step[]; active: boolean }) {
  if (!steps.length) return active ? <StepLine message="Starting…" active /> : null
  return <ol className="grid gap-1" aria-label="Progress">
    {steps.map((step, i) => <StepLine key={i} message={step.message} active={active && i === steps.length - 1} />)}
  </ol>
}

function StepLine({ message, active }: { message: string; active: boolean }) {
  return <li className="flex list-none items-center gap-2 text-xs text-muted">
    {active
      ? <Loader2 size={12} strokeWidth={2} aria-hidden className="animate-spin text-accent motion-reduce:animate-none" />
      : <Check size={12} strokeWidth={2} aria-hidden className="text-muted" />}
    <span className={active ? 'text-secondary' : ''}>{message}{active ? '…' : ''}</span>
  </li>
}

export function CountyAI({ areaCode }: { areaCode: string }) {
  const [proposal, setProposal] = useState<SavedProposal | null>(null)
  const [loading, setLoading] = useState(true)
  const [review, setReview] = useState<Progress | null>(null)
  const [reviewError, setReviewError] = useState('')
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [chatBusy, setChatBusy] = useState(false)
  const reviewController = useRef<AbortController | null>(null)
  const chatController = useRef<AbortController | null>(null)
  const nextId = useRef(0)
  const bottom = useRef<HTMLDivElement>(null)
  const path = `/counties/${encodeURIComponent(areaCode)}`

  useEffect(() => {
    const request = new AbortController()
    api<{ proposal: SavedProposal | null }>(`${path}/proposal`, { signal: request.signal })
      .then(result => setProposal(result.proposal))
      .catch(e => { if (!request.signal.aborted) setReviewError(e.message) })
      .finally(() => { if (!request.signal.aborted) setLoading(false) })
    return () => { request.abort(); reviewController.current?.abort(); chatController.current?.abort() }
  }, [path])

  const last = messages.at(-1)
  const lastText = last?.role === 'assistant' ? last.progress.text.length : 0
  useEffect(() => { bottom.current?.scrollIntoView?.({ block: 'nearest' }) }, [messages.length, lastText])

  async function generate() {
    reviewController.current?.abort()
    const request = new AbortController(); reviewController.current = request
    setReview(emptyProgress()); setReviewError('')
    try {
      await streamApi(`${path}/proposal/stream${proposal ? '?force=true' : ''}`, { signal: request.signal }, event => {
        if (event.type === 'proposal') setProposal(event.proposal)
        else setReview(previous => previous && reduce(previous, event))
      })
    } catch (e) {
      if (!request.signal.aborted) setReviewError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      if (!request.signal.aborted) setReview(null)
    }
  }

  function updateAssistant(id: number, update: (message: Extract<Message, { role: 'assistant' }>) => Partial<Extract<Message, { role: 'assistant' }>>) {
    setMessages(previous => previous.map(m => m.id === id && m.role === 'assistant' ? { ...m, ...update(m) } : m))
  }

  async function ask(text: string, prior: Message[]) {
    const history = prior.flatMap((m): { role: 'user' | 'assistant'; content: string }[] => m.role === 'user'
      ? [{ role: 'user', content: m.text }]
      : m.response ? [{ role: 'assistant', content: (m.response.answer.reply || m.response.answer.summary).slice(0, 8000) }] : [])
    const userMessage: Message = { id: nextId.current++, role: 'user', text }
    const id = nextId.current++
    setMessages([...prior, userMessage, { id, role: 'assistant', question: text, progress: emptyProgress() }])
    setChatBusy(true)
    const request = new AbortController(); chatController.current = request
    try {
      await streamApi(`${path}/chat/stream`, { signal: request.signal, body: JSON.stringify({ question: text, history: history.slice(-12) }) }, event => {
        if (event.type === 'done') updateAssistant(id, () => ({ response: event.response }))
        else updateAssistant(id, m => ({ progress: reduce(m.progress, event) }))
      })
    } catch (e) {
      if (request.signal.aborted) updateAssistant(id, () => ({ stopped: true }))
      else updateAssistant(id, () => ({ error: e instanceof Error ? e.message : 'Chat request failed' }))
    } finally {
      if (chatController.current === request) { chatController.current = null; setChatBusy(false) }
    }
  }

  function send(event?: FormEvent) {
    event?.preventDefault()
    const text = question.trim()
    if (!text || chatBusy) return
    setQuestion('')
    void ask(text, messages)
  }

  function retry(message: Extract<Message, { role: 'assistant' }>) {
    if (chatBusy) return
    const index = messages.findIndex(m => m.id === message.id)
    void ask(message.question, messages.slice(0, Math.max(0, index - 1)))
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() }
  }

  const reviewBusy = review !== null
  const overview = proposal?.answer.reply
  return <section className="mt-6 border-t border-line pt-4" aria-label="County review and chat">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-medium">Review proposals</h3>
      <button type="button" className={button} disabled={reviewBusy || loading} onClick={generate}>
        {reviewBusy ? <Loader2 size={14} aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Sparkles size={14} aria-hidden />}
        {reviewBusy ? 'Generating…' : proposal ? 'Regenerate' : 'Generate review'}
      </button>
    </div>
    {loading && <p className="mt-3 text-sm text-muted" role="status">Loading stored review…</p>}
    {!loading && !proposal && !reviewBusy && <p className="mt-3 text-sm text-muted">Generate a review from this county’s registry evidence. Proposals are saved for future visits.</p>}
    {reviewBusy && <div className="mt-3 grid gap-3 rounded-lg border border-line p-4" role="status" aria-live="polite">
      <Steps steps={review.steps} active />
      {review.text && <ChatText text={review.text} streaming />}
    </div>}
    {reviewError && <p className="mt-3 text-sm text-accent" role="alert">{reviewError}</p>}
    {proposal && !reviewBusy && <>
      <p className="mt-3 text-xs text-muted">Saved {new Date(proposal.created_at + 'Z').toLocaleString()}</p>
      {proposal.stale && <p className="mt-2 text-sm text-accent">Source data has changed. Regenerate this review before use.</p>}
      {overview && <div className="mt-3"><ChatText text={overview} /></div>}
      <AnswerView key={proposal.id} response={proposal} />
    </>}

    <div className="mt-6 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Ask about this county</h3>
        {messages.length > 0 && <button type="button" onClick={() => { chatController.current?.abort(); setMessages([]) }} className="text-xs text-muted hover:text-accent focus-visible:outline-2 focus-visible:outline-accent">Clear chat</button>}
      </div>
      {messages.length === 0 && <>
        <p className="mt-2 text-xs leading-relaxed text-muted">Ask in plain language. Answers use this county’s registry data and cite their sources. Follow-up questions keep context.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {suggestions.map(text => <button key={text} type="button" disabled={chatBusy} onClick={() => void ask(text, messages)}
            className="rounded-full border border-line px-3 py-1.5 text-left text-xs text-secondary hover:border-accent/50 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent">{text}</button>)}
        </div>
      </>}
      <div className="mt-4 grid gap-4" aria-live="polite">
        {messages.map(message => message.role === 'user'
          ? <p key={message.id} className="max-w-[85%] justify-self-end whitespace-pre-wrap rounded-2xl rounded-br-sm bg-raised px-4 py-2.5 text-sm text-ink">{message.text}</p>
          : <AssistantMessage key={message.id} message={message} onRetry={() => retry(message)} canRetry={!chatBusy} />)}
        <div ref={bottom} />
      </div>
      <form onSubmit={send} className="mt-4">
        <label htmlFor={`question-${areaCode}`} className="sr-only">Your question</label>
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-page p-2 focus-within:outline-2 focus-within:outline-accent">
          <textarea id={`question-${areaCode}`} maxLength={2000} rows={1} value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={onKeyDown}
            placeholder={messages.length ? 'Ask a follow-up…' : 'Ask about this county’s cancer pathway…'}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none [field-sizing:content]" />
          {chatBusy
            ? <button type="button" onClick={() => chatController.current?.abort()} aria-label="Stop generating" className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-page hover:bg-secondary focus-visible:outline-2 focus-visible:outline-accent"><Square size={12} fill="currentColor" aria-hidden /></button>
            : <button type="submit" disabled={!question.trim()} aria-label="Send question" className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-page hover:bg-secondary disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-accent"><ArrowUp size={16} aria-hidden /></button>}
        </div>
        <p className="mt-1.5 px-2 text-[11px] text-muted">Enter to send · Shift+Enter for a new line · AI drafts require local clinical validation</p>
      </form>
    </div>
  </section>
}

function AssistantMessage({ message, onRetry, canRetry }: { message: Extract<Message, { role: 'assistant' }>; onRetry: () => void; canRetry: boolean }) {
  const { progress, response, error, stopped } = message
  const working = !response && !error && !stopped
  const text = response ? (response.answer.reply || response.answer.summary) : progress.text
  const details = response && (response.answer.findings.length + response.answer.proposals.length + (response.answer.visual_evidence_ids?.length ?? 0)) > 0
  return <div className="grid max-w-full gap-2">
    {working && <div role="status"><Steps steps={progress.steps} active /></div>}
    {text && <ChatText text={text} streaming={working} />}
    {response && <details className="group rounded-lg border border-line">
      <summary className="cursor-pointer px-3 py-2 text-xs text-secondary hover:text-accent">
        {details ? 'Findings, charts and sources' : 'Sources and limitations'}
      </summary>
      <div className="border-t border-line px-3 pb-3"><AnswerView response={response} showSummary={false} /></div>
    </details>}
    {stopped && <p className="text-xs text-muted">Stopped.</p>}
    {error && <p className="text-sm text-accent" role="alert">{error}</p>}
    {(error || stopped) && <button type="button" onClick={onRetry} disabled={!canRetry} className="inline-flex items-center gap-1.5 justify-self-start text-xs text-accent hover:underline disabled:opacity-50"><RotateCcw size={12} aria-hidden />Retry</button>}
  </div>
}
