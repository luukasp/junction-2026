export function concise(text: string, limit = 180) {
  if (text.length <= limit) return text
  const candidate = text.slice(0, limit - 1)
  const boundary = candidate.lastIndexOf(' ')
  return `${candidate.slice(0, boundary > limit / 2 ? boundary : candidate.length)}…`
}

export function shortPoints(detail: string, bullets?: string[]) {
  if (bullets?.length) return bullets.slice(0, 3).map(text => concise(text))
  return detail.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean).slice(0, 2).map(text => concise(text))
}
