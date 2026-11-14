type Point = { id: string; name: string; x: number; y: number }

function wrapName(name: string, maxCharacters: number) {
  const words = name.split(/\s+/).flatMap(word => {
    const parts = []
    for (let start = 0; start < word.length; start += maxCharacters) parts.push(word.slice(start, start + maxCharacters))
    return parts
  })
  const lines: string[] = []
  for (const word of words) {
    const last = lines.length - 1
    if (last >= 0 && lines[last].length + word.length + 1 <= maxCharacters) lines[last] += ` ${word}`
    else lines.push(word)
  }
  return lines
}

/** Two ordered callout columns keep full facility names readable in dense counties. */
export function layoutCareCenterLabels(points: Point[], width: number, height: number) {
  const labelWidth = Math.min(196, Math.max(80, (width - 40) / 2))
  const characters = Math.max(12, Math.floor(labelWidth / 6.5))
  const ordered = [...points].sort((a, b) => a.x - b.x)
  const split = Math.ceil(ordered.length / 2)
  return [ordered.slice(0, split), ordered.slice(split)].flatMap((column, side) => {
    const labels = column.sort((a, b) => a.y - b.y).map(point => {
      const lines = wrapName(point.name, characters)
      return { ...point, lines, labelWidth, labelHeight: lines.length * 16, labelX: side === 0 ? 12 : width - labelWidth - 12, labelY: 0, side }
    })
    let bottom = 4
    for (const label of labels) {
      label.labelY = Math.max(bottom + 8, Math.min(height - 12 - label.labelHeight, label.y - label.labelHeight / 2))
      bottom = label.labelY + label.labelHeight
    }
    let top = height - 4
    for (const label of [...labels].reverse()) {
      label.labelY = Math.min(label.labelY, top - 8 - label.labelHeight)
      top = label.labelY
    }
    // Keep marker dots outside every name box, including in dense city clusters.
    function place(index: number, minimumY: number): boolean {
      if (index >= labels.length) return true
      const label = labels[index]
      const remaining = labels.slice(index + 1).reduce((sum, next) => sum + next.labelHeight + 8, 0)
      const maximumY = height - 12 - label.labelHeight - remaining
      const candidates = []
      for (let y = minimumY; y <= maximumY; y += 4) candidates.push(y)
      candidates.sort((a, b) => Math.abs(a - (label.y - label.labelHeight / 2)) - Math.abs(b - (label.y - label.labelHeight / 2)))
      for (const y of candidates) {
        const coversMarker = points.some(point => point.x >= label.labelX - 8 && point.x <= label.labelX + label.labelWidth + 8
          && point.y >= y - 6 && point.y <= y + label.labelHeight + 6)
        if (!coversMarker && place(index + 1, y + label.labelHeight + 8)) { label.labelY = y; return true }
      }
      return false
    }
    place(0, 12)
    return labels
  })
}
