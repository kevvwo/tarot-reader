/** Headless checks for the app's pure modules. */
import fs from 'node:fs';
import { cardFace, cardArt, cardBack } from '../app/js/art.js';
import { draw, shuffle } from '../app/js/deck.js';
import { composeOffline, buildMessages, analyze, excerpt, BOOK_LABEL } from '../app/js/reading.js';
import { renderMarkdown, renderProse, escapeHtml } from '../app/js/ui.js';

const corpus = JSON.parse(fs.readFileSync(new URL('../app/corpus.json', import.meta.url)));
const byId = Object.fromEntries(corpus.cards.map((c) => [c.id, c]));
let fails = 0;
const check = (name, cond, extra = '') => {
  if (!cond) { fails++; console.log(`  FAIL  ${name} ${extra}`); }
  else console.log(`  ok    ${name}`);
};

console.log('\n— art —');
let artBad = [];
for (const card of corpus.cards) {
  const svg = cardFace(card);
  if (/undefined|NaN|>\s*<\/text>/.test(svg) || !svg.startsWith('<svg')) artBad.push(card.id);
}
check('all 78 faces render cleanly', artBad.length === 0, artBad.slice(0, 5).join(','));
check('card back renders', cardBack().includes('card-back'));

// cardArt layers the 1909 scan over the drawn face; both must be present, or a
// missing scan would leave an empty rectangle instead of falling back.
const artMissing = corpus.cards.filter((card) => {
  const html = cardArt(card);
  return !html.includes(`cards/${card.id}.webp`) || !html.includes('<svg');
});
check('all 78 cards layer a scan over a drawn fallback', artMissing.length === 0,
  artMissing.slice(0, 5).map((c) => c.id).join(','));

// The scans themselves: every card needs a file, or the deck renders unevenly
// with some cards photographic and others drawn.
const cardsDir = new URL('../app/cards/', import.meta.url);
const scans = fs.existsSync(cardsDir) ? new Set(fs.readdirSync(cardsDir)) : new Set();
const noScan = corpus.cards.filter((c) => !scans.has(`${c.id}.webp`));
check(`all 78 scans present in app/cards (${scans.size} files)`, noScan.length === 0,
  `missing ${noScan.length}: ${noScan.slice(0, 4).map((c) => c.id).join(',')}`);

console.log('\n— deck —');
const s = shuffle(corpus.cards);
check('shuffle preserves length', s.length === 78);
check('shuffle preserves membership', new Set(s.map((c) => c.id)).size === 78);
const ten = draw(corpus.cards, 10, true);
check('draw returns 10 distinct cards', new Set(ten.map((d) => d.id)).size === 10);
const noRev = draw(corpus.cards, 20, false);
check('allowReversed=false yields no reversals', noRev.every((d) => !d.reversed));
// Reversal should be roughly a coin flip.
const flips = Array.from({ length: 2000 }, () => draw(corpus.cards, 1, true)[0].reversed)
  .filter(Boolean).length;
check('reversal rate near 50%', flips > 850 && flips < 1150, `got ${flips}/2000`);
// Shuffle should not favour any position.
const firstIds = new Set(Array.from({ length: 300 }, () => draw(corpus.cards, 1, true)[0].id));
check('shuffle reaches many distinct first cards', firstIds.size > 50, `got ${firstIds.size}`);

console.log('\n— excerpting —');
const books = Object.keys(corpus.sources);
const gaps = [];
for (const card of corpus.cards) {
  for (const b of books) {
    if (!excerpt(card, b, false)) gaps.push(`${card.id}/${b}/up`);
    if (!excerpt(card, b, true)) gaps.push(`${card.id}/${b}/rev`);
  }
}
check('every card yields an excerpt from every book, both ways',
  gaps.length === 0, `${gaps.length} gaps: ${gaps.slice(0, 4).join(', ')}`);

console.log('\n— offline reading —');
for (const spread of corpus.spreads) {
  const drawn = draw(corpus.cards, spread.count, true);
  const html = composeOffline({
    spread, drawn, question: 'Should I take the new role?', byId, books,
  });
  // Floor set below the daily (1-card) spread's true minimum across all 78
  // cards (335, checked exhaustively) — the other five spreads run 1000+.
  const ok = html.length > 300 && !/undefined|\[object/.test(html)
    && spread.positions.every((p) => html.includes(escapeHtml(p.name)));
  check(`composeOffline: ${spread.id}`, ok, `${html.length} chars`);
}

console.log('\n— pattern analysis —');
const allMajors = corpus.cards.filter((c) => c.arcana === 'major').slice(0, 3)
  .map((c) => ({ id: c.id, reversed: false }));
check('detects a major-heavy spread',
  analyze(allMajors, byId).notes.some((n) => /Major Arcana/.test(n)));
const allRev = draw(corpus.cards, 3, false).map((d) => ({ ...d, reversed: true }));
check('detects an all-reversed spread',
  analyze(allRev, byId).notes.some((n) => /reversed/i.test(n)));
const cupsRun = ['two-of-cups', 'five-of-cups', 'nine-of-cups'].map((id) => ({ id, reversed: false }));
check('detects a dominant suit',
  analyze(cupsRun, byId).notes.some((n) => /Cups dominates/.test(n)));
const twos = ['two-of-cups', 'two-of-wands', 'ace-of-swords'].map((id) => ({ id, reversed: false }));
check('detects a repeated number',
  analyze(twos, byId).notes.some((n) => /share the number 2/.test(n)));

console.log('\n— prompt building —');
const spread = corpus.spreads.find((x) => x.id === 'past-present-future');
const drawn = [
  { id: 'the-tower', reversed: false },
  { id: 'three-of-swords', reversed: true },
  { id: 'the-star', reversed: false },
];
const msgs = buildMessages({ spread, drawn, question: 'Why does work feel so heavy?', byId, books });
check('two messages built', msgs.length === 2 && msgs[0].role === 'system');
check('prompt names every position',
  spread.positions.every((p) => msgs[1].content.includes(p.name)));
check('prompt marks the reversal', /THREE OF SWORDS|Three of Swords \(REVERSED\)/i.test(msgs[1].content));
check(`prompt cites all ${books.length} books`,
  books.every((b) => msgs[1].content.includes(BOOK_LABEL[b])));
check('prompt is a sane size',
  msgs[1].content.length > 1500 && msgs[1].content.length < 20000,
  `${msgs[1].content.length} chars`);

console.log('\n— markdown —');
check('escapes injected html',
  !renderMarkdown('<script>alert(1)</script>').includes('<script'));
check('renders headings/bold/lists',
  /<h4>|<strong>|<ul>/.test(renderMarkdown('## T\n\n**b**\n\n- x')));
check('renderProse makes bullets', renderProse('intro\n\n- one\n\n- two').includes('<li>'));

console.log(fails ? `\n${fails} FAILURES\n` : '\nall checks passed\n');
process.exit(fails ? 1 : 0);
