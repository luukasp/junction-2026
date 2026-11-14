// Adapted from thesysdev/open-intelligent-ui's defineComponent / createLibrary pattern.
// Copyright (c) 2026 Thesys Inc. MIT license is included in this directory.
// Structured, citation-validated content is compiled to an allowlisted OpenUI program.
import { createLibrary, defineComponent, Renderer } from '@openuidev/react-lang'
import { useId, useState } from 'react'
import { z } from 'zod/v4'
import { answerProgram } from './answerProgram'
import { concise, shortPoints } from './briefingText'
import { CompletenessChart, EvidenceVisuals } from './EvidenceVisuals'
import { fieldLabel, readableValue, sourceId, visualEvidence } from './visualData'
import type { AIResponse, Evidence } from '../../lib/api'

const Col = defineComponent({
  name: 'Col', description: 'Vertical stack of evidence-backed briefing sections',
  props: z.object({ children: z.array(z.any()) }),
  component: ({ props, renderNode }) => <div className="grid min-w-0 gap-4">{props.children.map((child, i) => <div key={i}>{renderNode(child)}</div>)}</div>,
})
const Text = defineComponent({
  name: 'Text', description: 'Briefing paragraph', props: z.object({ text: z.string() }),
  component: ({ props }) => <h4 className="text-sm font-medium text-ink">{props.text}</h4>,
})
const Card = defineComponent({
  name: 'Card', description: 'Finding or review proposal with its references',
  props: z.object({ title: z.string(), detail: z.string(), references: z.string(), owner: z.string(), measure: z.string(), bullets: z.array(z.string()), number: z.number(), meta: z.array(z.string()).optional() }),
  component: ({ props }) => <section className="border-l-2 border-accent/50 py-1 pl-4">
    <p className="mb-2 font-mono text-xs text-muted">Action {props.number.toString().padStart(2, '0')}</p>
    <h5 className="text-sm font-medium leading-relaxed">{concise(props.title, 110)}</h5>
    <ul className="mt-3 grid list-disc gap-2 pl-4 text-sm leading-relaxed text-secondary">{shortPoints(props.detail, props.bullets).map((text, index) => <li key={index}>{text}</li>)}</ul>
    <dl className="mt-3 grid gap-2 border-t border-line pt-3 text-xs">
      <div><dt className="text-muted">Proposed owner</dt><dd className="mt-1 text-secondary">{concise(props.owner, 100)}</dd></div>
      <div><dt className="text-muted">Success measure</dt><dd className="mt-1 text-secondary">{concise(props.measure)}</dd></div>
    </dl>
    {props.meta && props.meta.length > 0 && <ul className="mt-2 grid gap-1 border-t border-line pt-2 text-xs text-secondary">{props.meta.map((line, i) => <li key={i}>{line}</li>)}</ul>}
    <details className="mt-3 text-xs text-muted"><summary className="cursor-pointer hover:text-accent">Rationale and evidence</summary><p className="mt-3 text-sm leading-relaxed text-secondary">{props.detail}</p><p className="mt-2">{props.title}</p><p className="mt-2">Proposed owner · {props.owner}</p><p className="mt-2">Track · {props.measure}</p><p className="mt-2 break-words font-mono">{props.references}</p></details>
  </section>,
})
const Finding = defineComponent({
  name: 'Finding', description: 'Expandable evidence finding with concise bullet points',
  props: z.object({ title: z.string(), detail: z.string(), references: z.string(), bullets: z.array(z.string()) }),
  component: ({ props }) => <details className="rounded-lg border border-line p-4">
    <summary className="cursor-pointer text-sm leading-relaxed text-secondary">{concise(props.title, 110)}</summary>
    <ul className="mt-3 grid list-disc gap-2 pl-4 text-sm leading-relaxed text-secondary">{shortPoints(props.detail, props.bullets).map((text, index) => <li key={index}>{text}</li>)}</ul>
    <details className="mt-3 text-xs text-muted"><summary className="cursor-pointer">Full context and references</summary><p className="mt-3 text-sm leading-relaxed text-secondary">{props.detail}</p><p className="mt-2">{props.title}</p><p className="mt-2 break-words font-mono">{props.references}</p></details>
  </details>,
})
const library = createLibrary({ components: [Col, Text, Card, Finding], root: 'Col' })


function Source({ evidence, sourcePrefix }: { evidence: Evidence; sourcePrefix: string }) {
  const url = typeof evidence.row.source_url === 'string' && /^https?:\/\//.test(evidence.row.source_url) ? evidence.row.source_url : undefined
  return <details id={sourceId(sourcePrefix, evidence.id)} className="scroll-mt-4 rounded-lg border border-line p-3">
    <summary className="cursor-pointer break-words text-xs text-accent">{evidence.id} · {readableValue(evidence.row.metric ?? evidence.row.metric_label ?? evidence.row.treatment_type_fi ?? evidence.row.cancer ?? evidence.dataset)}</summary>
    <dl className="mt-3 grid gap-2 text-xs">
      {Object.entries(evidence.row).filter(([key]) => !['source_url', 'id'].includes(key)).map(([key, value]) => <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
        <dt className="break-words text-muted">{fieldLabel(key)}</dt>
        <dd className="break-words text-secondary">{readableValue(value)}</dd>
      </div>)}
    </dl>
    {url && <a className="mt-3 inline-block text-xs text-accent underline" href={url} target="_blank" rel="noreferrer">Open original source</a>}
  </details>
}

export function AnswerView({ response, showSummary = true }: { response: AIResponse; showSummary?: boolean }) {
  const [failed, setFailed] = useState(false)
  const sourcePrefix = `evidence-${useId().replaceAll(':', '')}`
  const cited = new Set([...response.answer.findings, ...response.answer.proposals].flatMap(item => item.evidence_ids).concat(visualEvidence(response).map(item => item.id)))
  return <div className="mt-4 grid gap-5">
    {showSummary && <div>
      <h4 className="text-sm font-medium">At a glance</h4>
      <p className="mt-2 text-sm leading-relaxed text-secondary">{concise(response.answer.summary, 280)}</p>
      {response.answer.summary.length > 280 && <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer hover:text-accent">Read full summary</summary><p className="mt-3 text-sm leading-relaxed text-secondary">{response.answer.summary}</p></details>}
    </div>}
    <EvidenceVisuals response={response} sourcePrefix={sourcePrefix} />
    {failed ? <div className="grid gap-3 text-sm text-secondary">{[...response.answer.proposals, ...response.answer.findings].map((item, index) => <details key={index}><summary className="cursor-pointer">{concise(item.title, 110)}</summary><ul className="mt-3 grid list-disc gap-2 pl-4">{shortPoints(item.detail, item.bullets).map((text, i) => <li key={i}>{text}</li>)}</ul><p className="mt-3">{item.detail}</p>{'owner' in item && <p>Proposed owner · {String(item.owner)}</p>}{'measure' in item && <p>Track · {String(item.measure)}</p>}<p className="mt-2 text-xs">{item.evidence_ids.join(', ')}</p></details>)}</div> : <Renderer response={answerProgram(response)} library={library} isStreaming={false} onError={errors => { if (errors.length) setFailed(true) }} />}
    <details className="rounded-lg bg-raised p-4">
      <summary className="cursor-pointer text-xs text-secondary">Interpretation limits · {response.answer.limitations.length}</summary>
      <ul className="mt-3 grid list-disc gap-2 pl-4 text-xs leading-relaxed text-muted">{response.answer.limitations.map((text, index) => <li key={index}>{text}</li>)}</ul>
    </details>
    <details className="rounded-lg border border-line p-3">
      <summary className="cursor-pointer text-sm">Sources and data quality · {cited.size} cited rows</summary>
      <p className="mt-3 text-xs text-muted">Imported {new Date(response.quality.imported_at + (response.quality.imported_at.endsWith('Z') ? '' : 'Z')).toLocaleDateString()} · Coverage describes the county dataset, not model confidence</p>
      {!response.quality.screening_mainland_coverage && <p className="mt-3 text-xs text-accent">This area is outside mainland screening coverage. Check source availability before interpreting screening rows.</p>}
      <CompletenessChart response={response} />
      <div className="mt-3 grid gap-3">
        {response.quality.coverage.map(c => <p key={c.dataset} className="text-xs leading-relaxed text-secondary"><span className="font-medium capitalize text-ink">{c.dataset}</span> · {c.rows} rows available · {c.selected_rows} retrieved · {c.missing_values}/{c.numeric_cells} numeric cells missing{c.latest_year ? ` · latest year ${c.latest_year}` : ''}</p>)}
        {response.quality.limitations.map(text => <p key={text} className="text-xs leading-relaxed text-muted">{text}</p>)}
        {response.evidence.filter(e => cited.has(e.id)).map(e => <Source key={e.id} evidence={e} sourcePrefix={sourcePrefix} />)}
      </div>
    </details>
    <p className="text-xs text-muted">{response.model} · AI draft; requires local clinical validation</p>
  </div>
}
