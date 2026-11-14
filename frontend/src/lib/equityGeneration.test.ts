import { afterEach, describe, expect, it, vi } from 'vitest'
import { AIGenerationStore } from './aiGeneration'
import { defaultEquitySelection, equityBriefingInput } from '../data/equity'
import { equityRows, savedEquityBriefing } from '../test/equityFixture'
import { openEventStream } from '../test/sse'

afterEach(() => vi.unstubAllGlobals())
const input = equityBriefingInput(equityRows, { ...defaultEquitySelection, year: '2024', selectedLabel: 'Primary education/unknown' }, 'Colorectal screening · 2024 · Whole country')
const json = (body: unknown) => ({ ok: true, json: async () => body }) as Response

describe('persistent equity generation sessions', () => {
  it('deduplicates initialization and generation and retains state without panel subscribers', async () => {
    const stream = openEventStream()
    let signal: AbortSignal | null | undefined
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/lookup')) return json({ briefing: null })
      signal = init?.signal
      return stream.response
    })
    vi.stubGlobal('fetch', fetchMock)
    const store = new AIGenerationStore()
    const session = store.forEquity(input)
    const unsubscribe = session.subscribe(() => {})
    session.initialize()
    session.initialize()
    await vi.waitFor(() => expect(session.getSnapshot().loading).toBe(false))
    const generation = session.generate()
    await session.generate()
    stream.push({ type: 'status', stage: 'drafting', message: 'Drafting equity evidence' })
    stream.push({ type: 'delta', text: 'Retained draft' })
    await vi.waitFor(() => expect(session.getSnapshot().progress?.text).toBe('Retained draft'))
    unsubscribe()
    expect(signal?.aborted).toBe(false)
    expect(store.forEquity(input)).toBe(session)
    expect(store.getSnapshot()[0]).toMatchObject({ kind: 'equity', selection: input.selection, message: 'Drafting equity evidence' })
    stream.push({ type: 'briefing', briefing: savedEquityBriefing })
    stream.finish()
    await generation
    expect(session.getSnapshot().briefing?.id).toBe(1)
    expect(store.getSnapshot()).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps a stopped draft available and permits an explicit retry', async () => {
    const stream = openEventStream()
    const complete = openEventStream()
    complete.push({ type: 'briefing', briefing: savedEquityBriefing })
    complete.finish()
    let attempts = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/lookup')) return json({ briefing: null })
      attempts += 1
      if (attempts > 1) return complete.response
      init?.signal?.addEventListener('abort', () => stream.fail(new Error('Aborted')))
      return stream.response
    }))
    const session = new AIGenerationStore().forEquity(input)
    session.initialize()
    await vi.waitFor(() => expect(session.getSnapshot().loading).toBe(false))
    const generation = session.generate()
    stream.push({ type: 'delta', text: 'Draft before stop' })
    await vi.waitFor(() => expect(session.getSnapshot().progress?.text).toBe('Draft before stop'))
    session.stop()
    await generation
    expect(session.getSnapshot()).toMatchObject({ progress: null, stopped: true, draft: { text: 'Draft before stop' } })
    await session.generate()
    expect(session.getSnapshot()).toMatchObject({ stopped: false, draft: null, briefing: { id: 1 } })
  })
})
