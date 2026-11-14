import type { AIResponse } from '../../lib/api'

export function answerProgram(response: AIResponse) {
  const q = JSON.stringify
  const cards = [...response.answer.findings, ...response.answer.proposals].map(item =>
    `Card(${q(item.title)}, ${q(item.detail)}, ${q(item.evidence_ids.join(', '))}, ${q('owner' in item ? item.owner : '')}, ${q('measure' in item ? item.measure : '')})`)
  return `root = Col([Text(${q(response.answer.summary)}), ${cards.concat(response.answer.limitations.map(text => `Text(${q(text)})`)).join(', ')}])`
}

