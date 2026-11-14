import { ArrowUp, Check, ClipboardList, Loader2, RotateCcw, Square } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useCountyAI } from '../data/AIGenerationContext'
import type { Message, Step } from '../lib/aiGeneration'
import { AnswerView } from './intelligent-ui/AnswerView'
import { ChatText } from './intelligent-ui/ChatText'

const button = 'inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-accent hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent'
const suggestions = [
  'Where does our pathway lag Finland most?',
  'How does our screening uptake compare?',
  'What should we review first, and who owns it?',
  'Which data gaps limit this picture?',
]
function Steps({ steps, active }: { steps: Step[]; active: boolean }) {
  if (!steps.length) return active ? <StepLine message="Starting" active /> : null
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
  return <CountyAISession key={areaCode} areaCode={areaCode} />
}

function CountyAISession({ areaCode }: { areaCode: string }) {
  const { proposal, loading, review, reviewError, messages, chatBusy, chatReady, chatError, clearing, session } = useCountyAI(areaCode)
  const [question, setQuestion] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  const last = messages.at(-1)
  const lastText = last?.role === 'assistant' ? last.progress.text.length : 0
  useEffect(() => { bottom.current?.scrollIntoView?.({ block: 'nearest' }) }, [messages.length, lastText])

  function send(event?: FormEvent) {
    event?.preventDefault()
    const text = question.trim()
    if (!text || chatBusy || !chatReady || clearing) return
    setQuestion('')
    void session.ask(text)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() }
  }

  const reviewBusy = review !== null
  const overview = proposal?.answer.reply
  return <section className="mt-6 border-t border-line pt-4" aria-label="County review and chat">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-medium">Review proposals</h3>
      <button type="button" className={button} disabled={reviewBusy || loading} onClick={() => void session.generate()}>
        {reviewBusy ? <Loader2 size={14} aria-hidden className="animate-spin motion-reduce:animate-none" /> : <ClipboardList size={14} aria-hidden />}
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
        {messages.length > 0 && <button type="button" onClick={() => void session.clearChat()} disabled={!chatReady || chatBusy || clearing} className="text-xs text-muted hover:text-accent focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">Clear chat</button>}
      </div>
      {!chatReady && !chatError && <p className="mt-3 text-xs text-muted" role="status">Restoring saved chat…</p>}
      {chatError && <div className="mt-3 text-sm"><p role="alert" className="text-accent">{chatError}</p><button type="button" onClick={() => void session.reloadChat()} className="mt-2 text-xs text-accent hover:underline">Reload chat</button></div>}
      {messages.length === 0 && <>
        <p className="mt-2 text-xs leading-relaxed text-muted">Ask in plain language. Answers use this county’s registry data and cite their sources. Follow-up questions keep context.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {suggestions.map(text => <button key={text} type="button" disabled={chatBusy || !chatReady || clearing} onClick={() => void session.ask(text)}
            className="rounded-full border border-line px-3 py-1.5 text-left text-xs text-secondary hover:border-accent/50 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent">{text}</button>)}
        </div>
      </>}
      <div className="mt-4 grid gap-4" aria-live="polite">
        {messages.map(message => message.role === 'user'
          ? <p key={message.id} className="max-w-[85%] justify-self-end whitespace-pre-wrap rounded-2xl rounded-br-sm bg-raised px-4 py-2.5 text-sm text-ink">{message.text}</p>
          : <AssistantMessage key={message.id} message={message} onRetry={() => void session.retry(message)} canRetry={!chatBusy && chatReady && !clearing} />)}
        <div ref={bottom} />
      </div>
      <form onSubmit={send} className="mt-4">
        <label htmlFor={`question-${areaCode}`} className="sr-only">Your question</label>
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-page p-2 focus-within:outline-2 focus-within:outline-accent">
          <textarea id={`question-${areaCode}`} maxLength={2000} rows={1} value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={onKeyDown}
            placeholder={messages.length ? 'Ask a follow-up…' : 'Ask about this county’s cancer pathway…'}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none [field-sizing:content]" />
          {chatBusy
            ? <button type="button" onClick={() => session.stopChat()} aria-label="Stop generating" className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-page hover:bg-secondary focus-visible:outline-2 focus-visible:outline-accent"><Square size={12} fill="currentColor" aria-hidden /></button>
            : <button type="submit" disabled={!question.trim() || !chatReady || clearing} aria-label="Send question" className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-page hover:bg-secondary disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-accent"><ArrowUp size={16} aria-hidden /></button>}
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
