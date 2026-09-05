/** End-to-end: real draw -> grounded prompt -> Ollama proxy -> reading. */
import fs from 'node:fs';
import { buildMessages } from '../app/js/reading.js';

const PORT = process.env.PORT || 8123;
const corpus = JSON.parse(fs.readFileSync(new URL('../app/corpus.json', import.meta.url)));
const byId = Object.fromEntries(corpus.cards.map((c) => [c.id, c]));

const spread = corpus.spreads.find((s) => s.id === 'past-present-future');
const drawn = [
  { id: 'the-tower', reversed: false },
  { id: 'three-of-swords', reversed: true },
  { id: 'the-star', reversed: false },
];

const messages = buildMessages({
  spread, drawn,
  question: 'My team reorganised and I lost the project I cared about. What now?',
  byId,
  books: ['waite', 'thierens', 'papus'],
  voice: 'warm',
});

console.log(`prompt: ${messages[1].content.length} chars, `
  + `system ${messages[0].content.length} chars`);
console.log('streaming from gemma4:31b-cloud …\n');

const t0 = Date.now();
const res = await fetch(`http://localhost:${PORT}/api/chat`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    model: 'gemma4:31b-cloud', messages, stream: true,
    options: { temperature: 0.8, top_p: 0.9 },
  }),
});

if (!res.ok) { console.error('HTTP', res.status, await res.text()); process.exit(1); }

const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = '', out = '', chunks = 0, firstToken = 0;

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  const lines = buf.split('\n');
  buf = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const p = JSON.parse(line);
    if (p.error) { console.error('ollama error:', p.error); process.exit(1); }
    const piece = p.message?.content || '';
    if (piece) { if (!chunks) firstToken = Date.now() - t0; out += piece; chunks++; }
  }
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(out);
console.log('\n' + '─'.repeat(64));
console.log(`${out.split(/\s+/).length} words · ${chunks} chunks · `
  + `first token ${firstToken}ms · total ${secs}s`);

// The reading must actually be about the cards drawn, not generic tarot talk.
const checks = [
  ['names The Tower', /tower/i.test(out)],
  ['names Three of Swords', /three of swords/i.test(out)],
  ['names The Star', /star/i.test(out)],
  ['honours the reversal', /revers/i.test(out)],
  ['uses the position names', spread.positions.some((p) => new RegExp(p.name, 'i').test(out))],
  ['cites a book', /waite|thierens|papus|dark forest/i.test(out)],
  ['reasonable length', out.split(/\s+/).length > 250],
];
let bad = 0;
for (const [name, ok] of checks) { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`); }
process.exit(bad ? 1 : 0);
