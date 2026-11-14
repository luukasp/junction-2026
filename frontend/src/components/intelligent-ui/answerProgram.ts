import type { AIResponse } from '../../lib/api'

export function answerProgram(response: AIResponse) {
  const q = JSON.stringify
  const cards = response.answer.proposals.map((item, index) => {
    const steps = item.concrete_steps?.length ? item.concrete_steps : (item.bullets ?? [])
    const meta = [
      item.pathway_stage ? `Stage: ${item.pathway_stage}` : '',
      item.baseline ? `Baseline: ${item.baseline}` : '',
      item.target ? `Target: ${item.target}` : '',
      item.timeline ? `Timeline: ${item.timeline}` : '',
      item.estimated_annual_volume != null ? `Est. annual volume: ${Math.round(item.estimated_annual_volume).toLocaleString('en')}` : '',
      item.resource_summary ? `Resources: ${item.resource_summary}` : '',
      item.cost_estimate ? `Cost: ${item.cost_estimate}` : '',
    ].filter(Boolean)
    return `Card(${q(item.title)}, ${q(item.detail)}, ${q(item.evidence_ids.join(', '))}, ${q(item.owner)}, ${q(item.measure)}, ${q(steps)}, ${index + 1}, ${q(meta)})`
  })
  const findings = response.answer.findings.map(item =>
    `Finding(${q(item.title)}, ${q(item.detail)}, ${q(item.evidence_ids.join(', '))}, ${q(item.bullets ?? [])})`)
  return `root = Col([${cards.length ? `Text("Recommended actions"), ${cards.join(', ')}, ` : ''}${findings.length ? `Text("What the data says"), ${findings.join(', ')}` : ''}])`
}

