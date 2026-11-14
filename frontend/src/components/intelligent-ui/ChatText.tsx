import type { ReactNode } from 'react'

// Minimal, safe Markdown subset for streamed chat replies: paragraphs, "- " bullets and **bold**.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <strong key={i} className="font-semibold text-ink">{part.slice(2, -2)}</strong>
      : part.replace(/\*\*/g, ''))
}

export function ChatText({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const blocks: ReactNode[] = []
  let bullets: string[] = []
  const flush = () => {
    if (bullets.length) blocks.push(<ul key={blocks.length} className="grid list-disc gap-1 pl-5">{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>)
    bullets = []
  }
  for (const line of text.split('\n')) {
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/)
    if (bullet) { bullets.push(bullet[1]); continue }
    flush()
    if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line.trim())}</p>)
  }
  flush()
  return <div className="grid gap-2 text-sm leading-relaxed text-secondary">
    {blocks}
    {streaming && <span aria-hidden className="inline-block h-4 w-1.5 animate-pulse rounded-sm bg-accent/70 align-middle motion-reduce:animate-none" />}
  </div>
}
