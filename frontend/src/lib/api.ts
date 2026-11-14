export type Evidence = { id: string; dataset: string; row: Record<string, unknown> }
export type Finding = { title: string; detail: string; bullets?: string[]; evidence_ids: string[] }
export type Proposal = Finding & { owner: string; measure: string }
export type Answer = { summary: string; findings: Finding[]; proposals: Proposal[]; visual_evidence_ids?: string[]; limitations: string[] }
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
