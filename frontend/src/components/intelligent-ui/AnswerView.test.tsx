import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AnswerView } from './AnswerView'
import { answerProgram } from './answerProgram'
import type { AIResponse } from '../../lib/api'

const response: AIResponse = {
  answer: { summary: 'County review', findings: [{ title: 'Documentation', detail: 'Review records', evidence_ids: ['treatments:1'] }], proposals: [], limitations: ['Not risk-adjusted'] },
  evidence: [{ id: 'treatments:1', dataset: 'treatments', row: { source_url: 'https://example.org/report', value: null } }],
  quality: { screening_mainland_coverage: true, imported_at: '2026-11-14T10:00:00', coverage: [{ dataset: 'treatments', rows: 1, selected_rows: 1, missing_values: 1, numeric_cells: 3, latest_year: null }], limitations: ['Missing is not zero'] },
  model: 'gemini-4-carbon', provider: 'gemini',
}

describe('evidence-backed OpenUI answers', () => {
  it('compiles valid programs and escapes model text as data', () => {
    const unsafe = { ...response, answer: { ...response.answer, summary: 'Quotes " and \\ newline\n<script>alert(1)</script>' } }
    expect(answerProgram(unsafe)).toContain('root = Col(')
    const html = renderToStaticMarkup(<AnswerView response={unsafe} />)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })
  it('renders cards, evidence and quality without model HTML execution', () => {
    const html = renderToStaticMarkup(<AnswerView response={response} />)
    expect(html).toContain('County review')
    expect(html).toContain('Review records')
    expect(html).toContain('treatments:1')
    expect(html).toContain('Missing / suppressed')
    expect(html).toContain('https://example.org/report')
    expect(html).toContain('1/3 numeric cells missing')
  })
  it('does not render unsafe source protocols', () => {
    const html = renderToStaticMarkup(<AnswerView response={{ ...response, evidence: [{ ...response.evidence[0], row: { source_url: 'javascript:alert(1)' } }] }} />)
    expect(html).not.toContain('javascript:')
  })
})
