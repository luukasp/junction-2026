import { api, streamApi, type SavedEquityBriefing } from './api'
import type { EquityBriefingInput } from '../data/equity'
import type { Progress } from './aiGeneration'

type State = { briefing: SavedEquityBriefing | null; loading: boolean; progress: Progress | null; draft: Progress | null; error: string; stopped: boolean }

export class EquityAISession {
  private state: State = { briefing: null, loading: true, progress: null, draft: null, error: '', stopped: false }
  private listeners = new Set<() => void>()
  private initialized = false
  private controller: AbortController | null = null
  readonly input: EquityBriefingInput
  private onChange: () => void

  constructor(input: EquityBriefingInput, onChange: () => void) { this.input = input; this.onChange = onChange }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private patch(patch: Partial<State>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach(listener => listener())
    this.onChange()
  }
  initialize = () => {
    if (this.initialized) return
    this.initialized = true
    void this.restore()
  }
  restore = async () => {
    if (this.controller) return
    this.patch({ loading: true, error: '' })
    try {
      const result = await api<{ briefing: SavedEquityBriefing | null }>('/demographics/briefing/lookup', { method: 'POST', body: JSON.stringify(this.input.body) })
      this.patch({ briefing: result.briefing })
    } catch (error) {
      this.patch({ error: error instanceof Error ? error.message : 'Could not restore the saved equity briefing.' })
    } finally { this.patch({ loading: false }) }
  }
  generate = async () => {
    if (this.controller || this.state.loading) return
    const controller = new AbortController()
    this.controller = controller
    this.patch({ progress: { steps: [], text: '' }, draft: null, error: '', stopped: false })
    try {
      await streamApi(`/demographics/briefing/stream${this.state.briefing ? '?force=true' : ''}`, { signal: controller.signal, body: JSON.stringify(this.input.body) }, event => {
        if (controller.signal.aborted) return
        if (event.type === 'briefing') this.patch({ briefing: event.briefing })
        else if (event.type === 'status' && this.state.progress) this.patch({ progress: { steps: [...this.state.progress.steps, { stage: event.stage, message: event.message }], text: event.stage === 'repairing' ? '' : this.state.progress.text } })
        else if (event.type === 'delta' && this.state.progress) this.patch({ progress: { ...this.state.progress, text: event.text } })
      })
    } catch (error) {
      this.patch(controller.signal.aborted ? { stopped: true, draft: this.state.progress } : { error: error instanceof Error ? error.message : 'Equity generation failed.', draft: this.state.progress })
    } finally {
      if (this.controller === controller) { this.controller = null; this.patch({ progress: null }) }
    }
  }
  stop = () => { this.controller?.abort() }
}
