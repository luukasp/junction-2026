import { api, ApiError, streamApi, type AIResponse, type Conversation, type SavedProposal, type StreamEvent } from './api'
import { EquityAISession } from './equityGeneration'
import type { EquityBriefingInput, EquitySelection } from '../data/equity'

export type Step = { stage: string; message: string }
export type Progress = { steps: Step[]; text: string }
export type Message =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'assistant'; question: string; progress: Progress; response?: AIResponse; error?: string; stopped?: boolean }
type Assistant = Extract<Message, { role: 'assistant' }>
export type GenerationActivity = { areaCode: string; kind: 'review' | 'chat'; message: string } | { kind: 'equity'; key: string; label: string; selection: EquitySelection; message: string }
type State = {
  proposal: SavedProposal | null; loading: boolean; review: Progress | null; reviewError: string
  messages: Message[]; chatBusy: boolean; chatReady: boolean; chatError: string; clearing: boolean
}

const emptyProgress = (): Progress => ({ steps: [], text: '' })
function reduce(progress: Progress, event: StreamEvent): Progress {
  if (event.type === 'status') return {
    steps: [...progress.steps, { stage: event.stage, message: event.message }],
    text: event.stage === 'repairing' ? '' : progress.text,
  }
  return event.type === 'delta' ? { ...progress, text: event.text } : progress
}
function storedConversation(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function rememberConversation(key: string, id: string | null) {
  try {
    if (id) localStorage.setItem(key, id)
    else localStorage.removeItem(key)
  } catch { /* The current session also works without browser storage. */ }
}
const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback

/** Owns requests independently of the panels observing them. Navigation only unsubscribes. */
export class CountyAISession {
  private state: State
  private listeners = new Set<() => void>()
  private initialized = false
  private conversation: { id: string; version: number } | null = null
  private reviewController: AbortController | null = null
  private chatController: AbortController | null = null
  private nextId = 0
  private path: string
  private storageKey: string
  private onChange: () => void

  constructor(areaCode: string, onChange: () => void) {
    this.path = `/counties/${encodeURIComponent(areaCode)}`
    this.storageKey = `equal-care:chat:${import.meta.env.VITE_API_BASE_URL ?? ''}:${areaCode}`
    this.onChange = onChange
    this.state = {
      proposal: null, loading: true, review: null, reviewError: '', messages: [],
      chatBusy: false, chatReady: !storedConversation(this.storageKey), chatError: '', clearing: false,
    }
  }

  getSnapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private patch(patch: Partial<State>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach(listener => listener())
    this.onChange()
  }
  private updateAssistant(id: number, update: (message: Assistant) => Partial<Assistant>) {
    this.patch({ messages: this.state.messages.map(message => message.id === id && message.role === 'assistant'
      ? { ...message, ...update(message) } : message) })
  }

  initialize = () => {
    if (this.initialized) return
    this.initialized = true
    void this.reloadChat()
    void this.loadProposal()
  }
  private async loadProposal() {
    try {
      const result = await api<{ proposal: SavedProposal | null }>(`${this.path}/proposal`)
      this.patch({ proposal: result.proposal })
    } catch (error) {
      this.patch({ reviewError: errorMessage(error, 'Could not load review') })
    } finally { this.patch({ loading: false }) }
  }

  reloadChat = async () => {
    if (this.state.chatBusy || this.state.clearing) return
    const id = storedConversation(this.storageKey)
    this.patch({ chatReady: !id, chatError: '' })
    if (!id) return
    try {
      const saved = await api<Conversation>(`${this.path}/chat/conversations/${encodeURIComponent(id)}`)
      this.conversation = { id: saved.id, version: saved.version }
      this.patch({ chatReady: true, messages: saved.turns.flatMap((turn): Message[] => [
        { id: this.nextId++, role: 'user', text: turn.question },
        { id: this.nextId++, role: 'assistant', question: turn.question, progress: emptyProgress(), response: turn.response },
      ]) })
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        rememberConversation(this.storageKey, null); this.conversation = null
        this.patch({ messages: [], chatReady: true })
      } else this.patch({ chatError: errorMessage(error, 'Could not restore chat') })
    }
  }

  generate = async () => {
    if (this.state.review || this.state.loading) return
    const request = new AbortController(); this.reviewController = request
    this.patch({ review: emptyProgress(), reviewError: '' })
    try {
      await streamApi(`${this.path}/proposal/stream${this.state.proposal ? '?force=true' : ''}`, { signal: request.signal }, event => {
        if (request.signal.aborted) return
        if (event.type === 'proposal') this.patch({ proposal: event.proposal })
        else if (this.state.review) this.patch({ review: reduce(this.state.review, event) })
      })
    } catch (error) {
      if (!request.signal.aborted) this.patch({ reviewError: errorMessage(error, 'Generation failed') })
    } finally {
      if (this.reviewController === request) { this.reviewController = null; this.patch({ review: null }) }
    }
  }

  ask = async (text: string, prior = this.state.messages) => {
    if (this.chatController || this.state.chatBusy || !this.state.chatReady || this.state.clearing) return
    const userId = this.nextId++
    const id = this.nextId++
    this.patch({ chatBusy: true, messages: [
      ...prior, { id: userId, role: 'user', text },
      { id, role: 'assistant', question: text, progress: emptyProgress() },
    ] })
    const request = new AbortController(); this.chatController = request
    try {
      if (!this.conversation) {
        const saved = await api<Conversation>(`${this.path}/chat/conversations`, { method: 'POST', signal: request.signal })
        if (request.signal.aborted) { this.updateAssistant(id, () => ({ stopped: true })); return }
        this.conversation = { id: saved.id, version: saved.version }
        rememberConversation(this.storageKey, saved.id)
      }
      await streamApi(`${this.path}/chat/stream`, {
        signal: request.signal,
        body: JSON.stringify({ question: text, conversation_id: this.conversation.id, version: this.conversation.version }),
      }, event => {
        if (request.signal.aborted) return
        if (event.type === 'done') {
          if (event.response.version !== undefined) this.conversation!.version = event.response.version
          this.updateAssistant(id, () => ({ response: event.response }))
        } else this.updateAssistant(id, message => ({ progress: reduce(message.progress, event) }))
      })
    } catch (error) {
      if (request.signal.aborted) this.updateAssistant(id, () => ({ stopped: true }))
      else if (error instanceof ApiError && (error.status === 409 || error.status === 404)) {
        this.patch({ chatReady: false, chatError: error.message })
        this.updateAssistant(id, () => ({ stopped: true }))
      } else this.updateAssistant(id, () => ({ error: errorMessage(error, 'Chat request failed') }))
    } finally {
      if (this.chatController === request) { this.chatController = null; this.patch({ chatBusy: false }) }
    }
  }

  stopChat = () => { this.chatController?.abort() }
  retry = (message: Assistant) => {
    const index = this.state.messages.findIndex(item => item.id === message.id)
    const prior = index === this.state.messages.length - 1 ? this.state.messages.slice(0, Math.max(0, index - 1)) : this.state.messages
    return this.ask(message.question, prior)
  }
  clearChat = async () => {
    if (this.state.chatBusy || this.state.clearing || !this.state.chatReady) return
    this.patch({ clearing: true })
    try {
      if (this.conversation) await api(`${this.path}/chat/conversations/${this.conversation.id}/clear`, { method: 'POST' })
      this.conversation = null; rememberConversation(this.storageKey, null)
      this.patch({ messages: [], chatError: '', chatReady: true })
    } catch (error) {
      this.patch({ chatReady: false, chatError: errorMessage(error, 'Could not clear chat') })
    } finally { this.patch({ clearing: false }) }
  }
}

export class AIGenerationStore {
  private counties = new Map<string, CountyAISession>()
  private equity = new Map<string, EquityAISession>()
  private listeners = new Set<() => void>()
  private activity: GenerationActivity[] = []

  forCounty = (areaCode: string) => {
    let session = this.counties.get(areaCode)
    if (!session) { session = new CountyAISession(areaCode, this.updateActivity); this.counties.set(areaCode, session) }
    return session
  }
  forEquity = (input: EquityBriefingInput) => {
    let session = this.equity.get(input.key)
    if (!session) { session = new EquityAISession(input, this.updateActivity); this.equity.set(input.key, session) }
    return session
  }
  getSnapshot = () => this.activity
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private updateActivity = () => {
    const activity: GenerationActivity[] = []
    for (const [areaCode, session] of this.counties) {
      const state = session.getSnapshot()
      if (state.review) activity.push({ areaCode, kind: 'review', message: state.review.steps.at(-1)?.message ?? 'Starting review' })
      if (state.chatBusy) {
        const last = state.messages.at(-1)
        activity.push({ areaCode, kind: 'chat', message: last?.role === 'assistant' ? last.progress.steps.at(-1)?.message ?? 'Starting answer' : 'Starting answer' })
      }
    }
    for (const [key, session] of this.equity) {
      const progress = session.getSnapshot().progress
      if (progress) activity.push({ kind: 'equity', key, label: session.input.label, selection: session.input.selection, message: progress.steps.at(-1)?.message ?? 'Starting equity briefing' })
    }
    if (JSON.stringify(activity) === JSON.stringify(this.activity)) return
    this.activity = activity
    this.listeners.forEach(listener => listener())
  }
}
