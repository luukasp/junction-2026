import type { AIResponse } from '../../lib/api'

export function answerProgram(response: AIResponse) {
  const q = JSON.stringify
  const cards = response.answer.proposals.map((item, index) =>
    `Card(${q(item.title)}, ${q(item.detail)}, ${q(item.evidence_ids.join(', '))}, ${q(item.owner)}, ${q(item.measure)}, ${q(item.bullets ?? [])}, ${index + 1})`)
  const findings = response.answer.findings.map(item =>
    `Finding(${q(item.title)}, ${q(item.detail)}, ${q(item.evidence_ids.join(', '))}, ${q(item.bullets ?? [])})`)
  return `root = Col([${cards.length ? `Text("Recommended actions"), ${cards.join(', ')}, ` : ''}${findings.length ? `Text("What the data says"), ${findings.join(', ')}` : ''}])`
}

