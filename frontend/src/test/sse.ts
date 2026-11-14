/** A stream that stays open until a test drives its progress, completion, or failure. */
export function openEventStream() {
  let controller: ReadableStreamDefaultController<Uint8Array>
  const response = new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value } }), {
    headers: { 'Content-Type': 'text/event-stream' },
  })
  return {
    response,
    push: (event: unknown) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)),
    finish: () => controller.close(),
    fail: (error: Error) => controller.error(error),
  }
}
