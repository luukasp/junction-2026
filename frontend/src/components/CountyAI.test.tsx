// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CountyAI } from './CountyAI'

const sse = (events: unknown[]) => new Response(new ReadableStream({
  start(controller) {
    for (const event of events) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
    controller.close()
  },
}), { headers: { 'Content-Type': 'text/event-stream' } })

const response = {
  answer: { reply: 'Screening uptake is **72%**, below Finland.', summary: 'Screening lags.', findings: [], proposals: [], limitations: ['Not risk-adjusted'] },
  evidence: [], model: 'test-model', provider: 'test',
  quality: { imported_at: '2026-01-01T00:00:00', screening_mainland_coverage: true, coverage: [], limitations: [] },
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('CountyAI chat', () => {
  it('streams progress and the reply, then sends history on follow-up', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => url.endsWith('/proposal')
      ? Response.json({ proposal: null })
      : sse([
          { type: 'status', stage: 'retrieving', message: 'Searching county evidence' },
          { type: 'delta', text: 'Screening uptake' },
          { type: 'done', response },
        ]))
    vi.stubGlobal('fetch', fetchMock)
    render(<CountyAI areaCode="HVA01" />)
    fireEvent.click(await screen.findByRole('button', { name: 'How does our screening uptake compare?' }))
    expect(await screen.findByText('72%')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Why?' } })
    fireEvent.keyDown(screen.getByLabelText('Your question'), { key: 'Enter' })
    await screen.findByText('Why?')
    const body = JSON.parse(String(fetchMock.mock.calls.at(-1)![1]!.body))
    expect(body.history).toEqual([
      { role: 'user', content: 'How does our screening uptake compare?' },
      { role: 'assistant', content: response.answer.reply },
    ])
  })

  it('shows stream errors with a retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, _init?: RequestInit) => url.endsWith('/proposal')
      ? Response.json({ proposal: null })
      : sse([{ type: 'error', detail: 'AI provider rate limit reached; retry later' }])))
    render(<CountyAI areaCode="HVA01" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Which data gaps limit this picture?' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'AI provider rate limit reached; retry later')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})
