// Adapted from thesysdev/open-intelligent-ui's defineComponent / createLibrary pattern.
// Copyright (c) 2026 Thesys Inc. MIT license is included in this directory.
// Structured, citation-validated content is compiled to an allowlisted OpenUI program.
import { createLibrary, defineComponent, Renderer } from '@openuidev/react-lang'
import { useState } from 'react'
import { z } from 'zod/v4'
import { answerProgram } from './answerProgram'
import type { AIResponse, Evidence } from '../../lib/api'

const Col = defineComponent({
  name: 'Col', description: 'Vertical stack of evidence-backed briefing sections',
  props: z.object({ children: z.array(z.any()) }),
  component: ({ props, renderNode }) => <div className="grid min-w-0 gap-4">{props.children.map((child, i) => <div key={i}>{renderNode(child)}</div>)}</div>,
})
const Text = defineComponent({
  name: 'Text', description: 'Briefing paragraph', props: z.object({ text: z.string() }),
  component: ({ props }) => <p className="whitespace-pre-wrap text-sm leading-relaxed text-secondary">{props.text}</p>,
})
const Card = defineComponent({
  name: 'Card', description: 'Finding or review proposal with its references',
  props: z.object({ title: z.string(), detail: z.string(), references: z.string(), owner: z.string(), measure: z.string() }),
  component: ({ props }) => <section className="rounded-lg border border-line p-4">
    <h4 className="text-sm font-medium">{props.title}</h4>
    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-secondary">{props.detail}</p>
    {props.owner && <p className="mt-3 text-xs text-secondary">Proposed owner · {props.owner}</p>}
    {props.measure && <p className="mt-2 text-xs text-secondary">Track · {props.measure}</p>}
    <p className="mt-3 break-words font-mono text-xs text-muted">Evidence · {props.references}</p>
  </section>,
})
const library = createLibrary({ components: [Col, Text, Card], root: 'Col' })


function Source({ evidence }: { evidence: Evidence }) {
  const url = typeof evidence.row.source_url === 'string' && /^https?:\/\//.test(evidence.row.source_url) ? evidence.row.source_url : undefined
  return <details className="rounded-lg border border-line p-3">
    <summary className="cursor-pointer break-words text-xs text-accent">{evidence.id} · {String(evidence.row.metric ?? evidence.row.metric_label ?? evidence.row.treatment_type_fi ?? evidence.row.cancer ?? evidence.dataset)}</summary>
    <dl className="mt-3 grid gap-2 text-xs">
      {Object.entries(evidence.row).filter(([key]) => !['source_url', 'id'].includes(key)).map(([key, value]) => <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
        <dt className="break-words text-muted">{key.replaceAll('_', ' ')}</dt>
        <dd className="break-words text-secondary">{value === null ? 'Missing / suppressed' : typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
      </div>)}
    </dl>
    {url && <a className="mt-3 inline-block text-xs text-accent underline" href={url} target="_blank" rel="noreferrer">Open original source</a>}
  </details>
}

export function AnswerView({ response }: { response: AIResponse }) {
  const [failed, setFailed] = useState(false)
  const cited = new Set([...response.answer.findings, ...response.answer.proposals].flatMap(item => item.evidence_ids))
  return <div className="mt-4 grid gap-4">
    {failed ? <div className="grid gap-3 text-sm text-secondary"><p>{response.answer.summary}</p>{[...response.answer.findings, ...response.answer.proposals].map((item, i) => <section key={i}><p><strong>{item.title}</strong> · {item.detail} ({item.evidence_ids.join(', ')})</p>{'owner' in item && <p className="mt-2">Proposed owner · {String(item.owner)}</p>}{'measure' in item && <p className="mt-2">Track · {String(item.measure)}</p>}</section>)}{response.answer.limitations.map((text, i) => <p key={i}>{text}</p>)}</div> : <Renderer response={answerProgram(response)} library={library} isStreaming={false} onError={errors => { if (errors.length) setFailed(true) }} />}
    <details className="rounded-lg border border-line p-3">
      <summary className="cursor-pointer text-sm">Sources and data quality · {cited.size} cited rows</summary>
      <p className="mt-3 text-xs text-muted">Imported {new Date(response.quality.imported_at + (response.quality.imported_at.endsWith('Z') ? '' : 'Z')).toLocaleDateString()} · Coverage describes the county dataset, not model confidence</p>
      {!response.quality.screening_mainland_coverage && <p className="mt-3 text-xs text-accent">This area is outside mainland screening coverage. Check source availability before interpreting screening rows.</p>}
      <div className="mt-3 grid gap-3">
        {response.quality.coverage.map(c => <p key={c.dataset} className="text-xs leading-relaxed text-secondary"><span className="font-medium text-ink">{c.dataset}</span> · {c.rows} rows available · {c.selected_rows} retrieved · {c.missing_values}/{c.numeric_cells} numeric cells missing{c.latest_year ? ` · latest year ${c.latest_year}` : ''}</p>)}
        {response.quality.limitations.map(text => <p key={text} className="text-xs leading-relaxed text-muted">{text}</p>)}
        {response.evidence.filter(e => cited.has(e.id)).map(e => <Source key={e.id} evidence={e} />)}
      </div>
    </details>
    <p className="text-xs text-muted">{response.model} · AI draft; requires local clinical validation</p>
  </div>
}
