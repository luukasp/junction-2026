// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CountyAI } from './CountyAI'
import { AIGenerationProvider } from '../data/AIGenerationContext'
import { openEventStream } from '../test/sse'

const sse = (events: unknown[]) => new Response(new ReadableStream({
  start(controller) {
    for (const event of events) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
    controller.close()
  },
}), { headers: { 'Content-Type': 'text/event-stream' } })

const response = {
  conversation_id: 'saved-chat', version: 1,
  answer: { reply: 'Screening uptake is **72%**, below Finland.', summary: 'Screening lags.', findings: [], proposals: [], limitations: ['Not risk-adjusted'] },
  evidence: [], model: 'test-model', provider: 'test',
  quality: { imported_at: '2026-01-01T00:00:00', screening_mainland_coverage: true, coverage: [], limitations: [] },
}

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

const newConversation = { id: 'saved-chat', area_code: 'HVA01', version: 0, turns: [] }
const renderSession = (ui: React.ReactElement) => render(ui, { wrapper: AIGenerationProvider })

describe('CountyAI chat', () => {
  it('streams the reply, then continues the saved conversation on follow-up', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => url.endsWith('/proposal')
      ? Response.json({ proposal: null })
      : url.endsWith('/conversations') ? Response.json(newConversation)
      : sse([
          { type: 'status', stage: 'retrieving', message: 'Searching county evidence' },
          { type: 'delta', text: 'Screening uptake' },
          { type: 'done', response },
        ]))
    vi.stubGlobal('fetch', fetchMock)
    renderSession(<CountyAI areaCode="HVA01" />)
    fireEvent.click(await screen.findByRole('button', { name: 'How does our screening uptake compare?' }))
    expect(await screen.findByText('72%')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Why?' } })
    fireEvent.keyDown(screen.getByLabelText('Your question'), { key: 'Enter' })
    await screen.findByText('Why?')
    const body = JSON.parse(String(fetchMock.mock.calls.at(-1)![1]!.body))
    expect(body).toEqual({ question: 'Why?', conversation_id: 'saved-chat', version: 1 })
  })

  it('shows stream errors with a retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, _init?: RequestInit) => url.endsWith('/proposal')
      ? Response.json({ proposal: null })
      : url.endsWith('/conversations') ? Response.json(newConversation)
      : sse([{ type: 'error', detail: 'AI provider rate limit reached; retry later' }])))
    renderSession(<CountyAI areaCode="HVA01" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Which data gaps limit this picture?' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'AI provider rate limit reached; retry later')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('restores saved answers after remounting and keeps counties separate', async () => {
    localStorage.setItem('equal-care:chat::HVA01', 'saved-chat')
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/saved-chat')
      ? Response.json({ ...newConversation, version: 1, turns: [{ question: 'Screening?', response }] })
      : Response.json({ proposal: null }))
    vi.stubGlobal('fetch', fetchMock)
    const view = renderSession(<CountyAI areaCode="HVA01" />)
    expect(await screen.findByText('72%')).toBeTruthy()
    expect(screen.getByText('Screening?')).toBeTruthy()
    view.rerender(<CountyAI areaCode="HVA90" />)
    await screen.findByText(/Follow-up questions keep context/)
    expect(screen.queryByText('72%')).toBeNull()
    view.rerender(<CountyAI areaCode="HVA01" />)
    expect(await screen.findByText('72%')).toBeTruthy()
  })

  it('clears the persisted chat before starting a fresh conversation', async () => {
    localStorage.setItem('equal-care:chat::HVA01', 'saved-chat')
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => url.endsWith('/saved-chat')
      ? Response.json({ ...newConversation, version: 1, turns: [{ question: 'Screening?', response }] })
      : url.endsWith('/clear') ? Response.json({ cleared: true })
        : Response.json({ proposal: null }))
    vi.stubGlobal('fetch', fetchMock)
    renderSession(<CountyAI areaCode="HVA01" />)
    await screen.findByText('72%')
    fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }))
    await waitFor(() => expect(screen.queryByText('72%')).toBeNull())
    expect(localStorage.getItem('equal-care:chat::HVA01')).toBeNull()
    expect(fetchMock.mock.calls.some(([url, init]) => url.endsWith('/clear') && init?.method === 'POST')).toBe(true)
  })

  it('makes a truncated generation retryable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/proposal')
      ? Response.json({ proposal: null })
      : url.endsWith('/conversations') ? Response.json(newConversation)
        : sse([{ type: 'delta', text: 'Incomplete' }])))
    renderSession(<CountyAI areaCode="HVA01" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Which data gaps limit this picture?' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Generation ended before completing. Please retry.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('reloads saved turns after a concurrent update is reported in the stream', async () => {
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/proposal')
      ? Response.json({ proposal: null })
      : url.endsWith('/conversations') ? Response.json(newConversation)
        : url.endsWith('/saved-chat') ? Response.json({ ...newConversation, version: 1, turns: [{ question: 'Another request', response }] })
          : sse([{ type: 'error', detail: 'Conversation changed', status: 409 }]))
    vi.stubGlobal('fetch', fetchMock)
    renderSession(<CountyAI areaCode="HVA01" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Which data gaps limit this picture?' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Conversation changed')
    fireEvent.click(screen.getByRole('button', { name: 'Reload chat' }))
    expect(await screen.findByText('Another request')).toBeTruthy()
    expect(await screen.findByText('72%')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('recovers when the remembered conversation has been deleted', async () => {
    localStorage.setItem('equal-care:chat::HVA01', 'deleted-chat')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/deleted-chat')
      ? Response.json({ detail: 'Conversation not found' }, { status: 404 })
      : Response.json({ proposal: null })))
    renderSession(<CountyAI areaCode="HVA01" />)
    await waitFor(() => expect(localStorage.getItem('equal-care:chat::HVA01')).toBeNull())
    expect(screen.getByRole('button', { name: 'How does our screening uptake compare?' }).hasAttribute('disabled')).toBe(false)
  })
})

describe('CountyAI generation across views', () => {
  it('keeps review progress and the same request when a panel is closed or another county is opened', async () => {
    const stream = openEventStream()
    let signal: AbortSignal | null | undefined
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/proposal/stream')) { signal = init?.signal; return stream.response }
      return Response.json({ proposal: null })
    })
    vi.stubGlobal('fetch', fetchMock)
    const view = renderSession(<StrictMode><CountyAI areaCode="HVA01" /></StrictMode>)
    await waitFor(() => expect((screen.getByRole('button', { name: 'Generate review' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Generate review' }))
    await act(async () => {
      stream.push({ type: 'status', stage: 'drafting', message: 'Drafting review' })
      stream.push({ type: 'delta', text: 'First county draft' })
    })
    expect(await screen.findByText('First county draft')).toBeTruthy()
    view.rerender(<CountyAI areaCode="HVA90" />)
    expect(screen.queryByText('First county draft')).toBeNull()
    expect(signal?.aborted).toBe(false)
    await act(async () => {
      stream.push({ type: 'status', stage: 'checking', message: 'Checking citations' })
      stream.push({ type: 'delta', text: 'Draft progressed while away' })
    })
    view.rerender(<CountyAI areaCode="HVA01" />)
    expect(screen.getByText('Draft progressed while away')).toBeTruthy()
    expect(screen.getByText('Checking citations…')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Generating…' }) as HTMLButtonElement).disabled).toBe(true)
    view.rerender(<p>Another view</p>)
    await act(async () => {
      stream.push({ type: 'proposal', proposal: { ...response, id: 1, area_code: 'HVA01', created_at: '2026-11-14T12:00:00', stale: false } })
      stream.finish()
    })
    view.rerender(<CountyAI areaCode="HVA01" />)
    expect(await screen.findByText('72%')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeTruthy()
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/proposal/stream'))).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/v1/counties/HVA01/proposal')).toHaveLength(1)
  })

  it('preserves a chat stream across unmounts and still lets the user stop and retry it', async () => {
    const stream = openEventStream()
    let signal: AbortSignal | null | undefined
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/chat/stream')) {
        signal = init?.signal
        signal?.addEventListener('abort', () => stream.fail(new DOMException('Aborted', 'AbortError')), { once: true })
        return stream.response
      }
      return Response.json(url.endsWith('/conversations') ? newConversation : { proposal: null })
    })
    vi.stubGlobal('fetch', fetchMock)
    const view = renderSession(<CountyAI areaCode="HVA01" />)
    fireEvent.click(screen.getByRole('button', { name: 'How does our screening uptake compare?' }))
    await waitFor(() => expect(signal).toBeTruthy())
    await act(async () => {
      stream.push({ type: 'status', stage: 'drafting', message: 'Drafting answer' })
      stream.push({ type: 'delta', text: 'An answer in progress' })
    })
    view.rerender(<p>Another view</p>)
    expect(signal?.aborted).toBe(false)
    view.rerender(<CountyAI areaCode="HVA01" />)
    expect(screen.getByText('An answer in progress')).toBeTruthy()
    expect(screen.getByText('Drafting answer…')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stop generating' }))
    expect(await screen.findByText('Stopped.')).toBeTruthy()
    expect(signal?.aborted).toBe(true)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/chat/stream'))).toHaveLength(1)
  })

  it('retains a generation failure that arrives while its panel is closed', async () => {
    const stream = openEventStream()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/proposal/stream')
      ? stream.response : Response.json({ proposal: null })))
    const view = renderSession(<CountyAI areaCode="HVA01" />)
    await waitFor(() => expect((screen.getByRole('button', { name: 'Generate review' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Generate review' }))
    view.rerender(<p>Another view</p>)
    await act(async () => {
      stream.push({ type: 'error', detail: 'Provider unavailable' })
      stream.finish()
    })
    view.rerender(<CountyAI areaCode="HVA01" />)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Provider unavailable')
    expect((screen.getByRole('button', { name: 'Generate review' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
