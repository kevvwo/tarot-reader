/**
 * Client for the local server's Ollama proxy.
 *
 * The page never talks to ollama.com directly: it sends no CORS headers, and
 * routing through the daemon means the cloud credential stays on the Mac.
 */

export async function listModels() {
  const res = await fetch('/api/models');
  if (!res.ok) throw new Error(`models request failed (${res.status})`);
  const data = await res.json();
  return (data.models || []).map((m) => m.name).sort();
}

/**
 * Stream a chat completion, calling onToken with each chunk of text.
 * Ollama replies with NDJSON, one JSON object per line.
 */
export async function chat({ model, messages, temperature = 0.8, signal }, onToken) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal,
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      options: { temperature, top_p: 0.9 },
    }),
  });

  if (!res.ok) {
    let detail = `request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body.error) detail = body.error;
    } catch { /* keep the status-code message */ }
    throw new Error(detail);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // A chunk can split a line, so keep the trailing partial in the buffer.
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let payload;
      try { payload = JSON.parse(trimmed); } catch { continue; }
      if (payload.error) throw new Error(payload.error);
      const piece = payload.message?.content || '';
      if (piece) { full += piece; onToken?.(piece, full); }
      if (payload.done) return full;
    }
  }
  return full;
}
