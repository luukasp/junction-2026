export type Evidence = { id: string; dataset: string; row: Record<string, unknown> }
export type Finding = { title: string; detail: string; bullets?: string[]; evidence_ids: string[] }
export type Proposal = Finding & { owner: string; measure: string }
export type Answer = { reply?: string; summary: string; findings: Finding[]; proposals: Proposal[]; visual_evidence_ids?: string[]; limitations: string[] }
export type Quality = {
  imported_at: string
  screening_mainland_coverage: boolean
  coverage: { dataset: string; rows: number; selected_rows: number; missing_values: number; numeric_cells: number; latest_year: number | null }[]
  limitations: string[]
}
export type AIResponse = { answer: Answer; evidence: Evidence[]; quality: Quality; model: string; provider: string }
export type SavedProposal = AIResponse & { id: number; area_code: string; created_at: string; stale: boolean }

const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base}/api/v1${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(typeof body?.detail === 'string' ? body.detail : `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

export type StreamEvent =
  | { type: 'status'; stage: string; message: string }
  | { type: 'delta'; text: string }
  | { type: 'error'; detail: string }
  | { type: 'done'; response: AIResponse }
  | { type: 'proposal'; proposal: SavedProposal }

/** POST and read a Server-Sent Events stream. Rejects on HTTP or terminal `error` events. */
export async function streamApi(path: string, options: RequestInit, onEvent: (event: StreamEvent) => void): Promise<void> {
  const response = await fetch(`${base}/api/v1${path}`, {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...options.headers },
  })
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null)
    throw new Error(typeof body?.detail === 'string' ? body.detail : `Request failed (${response.status})`)
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''
    for (const block of blocks) {
      const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
      if (!data) continue
      const event = JSON.parse(data) as StreamEvent
      if (event.type === 'error') throw new Error(event.detail)
      onEvent(event)
    }
  }
}
