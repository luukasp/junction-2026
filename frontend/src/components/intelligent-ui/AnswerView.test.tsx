import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AnswerView } from './AnswerView'
import { answerProgram } from './answerProgram'
import type { AIResponse } from '../../lib/api'
import { visualEvidence } from './visualData'
import { shortPoints } from './briefingText'

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
  it('renders a chart from source counts and keeps categories separate', () => {
    const chartResponse: AIResponse = { ...response, evidence: [
      { id: 'treatments:1', dataset: 'treatments', row: { treatment_type_fi: 'Ei hoitotietoa', patients_n: 710, treatment_n: 240, share_pct: 33.8, diagnosis_period: '2019–2023', area_code: 'HVA21' } },
      { id: 'treatments:2', dataset: 'treatments', row: { treatment_type_fi: 'Parantava', patients_n: 710, treatment_n: 131, share_pct: 18.5, diagnosis_period: '2019–2023', area_code: 'HVA21' } },
    ], answer: { ...response.answer, visual_evidence_ids: ['treatments:1', 'treatments:2'] } }
    const html = renderToStaticMarkup(<AnswerView response={chartResponse} />)
    expect(html).toContain('Treatment documentation visual summary')
    expect(html).toContain('240 patients without a treatment record; 470 with a record')
    expect(html).toContain('33.8')
    expect(html).toContain('categories overlap')
    expect(html).toContain('18.5%')
    expect(html).not.toContain('NaN')
  })
  it('uses AI-selected rows without inventing missing numeric values', () => {
    const selected = { ...response, answer: { ...response.answer, visual_evidence_ids: ['nonexistent'] } }
    expect(visualEvidence(selected)).toEqual([])
    const html = renderToStaticMarkup(<AnswerView response={response} />)
    expect(html).not.toContain('Without a treatment record')
    expect(html).toContain('Missing / suppressed')
  })
  it('turns old paragraphs into short points while retaining full context', () => {
    const longText = 'A registry finding with important details. '.repeat(30)
    const legacy = { ...response, answer: { ...response.answer, summary: longText, findings: [{ ...response.answer.findings[0], detail: longText }] } }
    const html = renderToStaticMarkup(<AnswerView response={legacy} />)
    expect(shortPoints(longText)).toHaveLength(2)
    expect(shortPoints(longText).every(text => text.length <= 180)).toBe(true)
    expect(html).toContain('Read full summary')
    expect(html).toContain('Full context and references')
    expect(html).toContain(longText)
  })
  it('renders concise proposal bullets and screening charts', () => {
    const structured: AIResponse = { ...response, answer: { ...response.answer,
      proposals: [{ title: 'Review follow-up records', detail: 'Additional local context.', bullets: ['Validate the referral records.', 'Check completion with the registry team.'], owner: 'Registry lead', measure: 'Referrals reconciled', evidence_ids: ['screening:1'] }],
      visual_evidence_ids: ['screening:1'],
    }, evidence: [{ id: 'screening:1', dataset: 'screening', row: { program: 'breast', year: 2024, metric: 'Attended (of invited) | %', unit: 'percent', value: 83.8, strata: {} } }] }
    const html = renderToStaticMarkup(<AnswerView response={structured} />)
    expect(html).toContain('Action 01')
    expect(html).toContain('Validate the referral records.')
    expect(html).toContain('Success measure')
    expect(html).toContain('Screening measures')
    expect(html).toContain('83.8%')
    expect(html).toContain('Attended (of invited)')
  })
  it('shows readable labels instead of Finnish codes, snake_case fields and raw JSON', () => {
    const readable: AIResponse = { ...response, answer: { ...response.answer, findings: [{ title: 'Records', detail: 'Review', evidence_ids: ['treatments:1', 'screening:1'] }], visual_evidence_ids: ['screening:1'] }, evidence: [
      { id: 'treatments:1', dataset: 'treatments', row: { treatment_type_fi: 'Ei hoitotietoa', patients_n: 710, share_pct: 33.8, collaboration_area_fi: 'Pohjois-Suomen yhteistyöalue' } },
      { id: 'screening:1', dataset: 'screening', row: { program: 'breast', year: 2024, metric: 'Attended (of invited) | %', unit: 'percent', value: 83.8, strata: { 'Age group': '50-69', sex_code: 'Naiset' } } },
    ] }
    const html = renderToStaticMarkup(<AnswerView response={readable} />)
    for (const text of ['No treatment record', 'Treatment category', 'Share (%)', 'Patients', 'Northern Finland collaborative area', 'Age group: 50-69', 'Sex code: Women']) expect(html).toContain(text)
    for (const text of ['Ei hoitotietoa', 'treatment_type_fi', 'share pct', 'collaboration area fi', '{&quot;']) expect(html).not.toContain(text)
  })
})
