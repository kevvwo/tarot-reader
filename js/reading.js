/**
 * Turning a draw into a reading.
 *
 * Two paths, both anchored to the same book passages:
 *
 *   composeOffline()  assembles the reading directly from the corpus, so a
 *                     reading always exists with no model and no network.
 *   buildMessages()   packs those same passages into a grounded prompt, so a
 *                     generated reading paraphrases the books rather than
 *                     inventing meanings from whatever the model recalls.
 */

const SUIT_THEME = {
  wands: { element: 'Fire', theme: 'drive, work and what you are building' },
  cups: { element: 'Water', theme: 'feeling, love and what you are attached to' },
  swords: { element: 'Air', theme: 'thought, conflict and what you are telling yourself' },
  pentacles: { element: 'Earth', theme: 'money, body and the practical ground under you' },
};

const RANK_ARC = {
  1: 'beginnings — a seed offered',
  2: 'a choice or a pairing',
  3: 'first growth, something taking form',
  4: 'consolidation, a pause that can turn into a rut',
  5: 'friction, loss, the awkward middle',
  6: 'a turn toward relief and exchange',
  7: 'testing, holding your position',
  8: 'movement and mastery through repetition',
  9: 'nearly there, and the cost of getting here',
  10: 'completion, and the weight that comes with it',
};

export const BOOK_LABEL = {
  darkforest: 'The Dark Forest Guide',
  waite: 'Waite, Pictorial Key (1910)',
  delaurence: 'De Laurence, Illustrated Key (1918)',
  thierens: 'Thierens, General Book of the Tarot (1930)',
  papus: 'Papus, Tarot of the Bohemians (1889)',
};

/* ── text helpers ────────────────────────────────────────────────────────── */

function sentences(text) {
  return String(text || '')
    // A closing quote or apostrophe can sit between the terminator and the
    // space ("...the 'unwise man.' To us...") without that being any less
    // of a sentence boundary.
    .split(/(?<=[.!?]['"’”]?)\s+(?=[A-Z“"'])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function firstSentences(text, n) {
  return sentences(text).slice(0, n).join(' ');
}

export function trimTo(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  if (stop > max * 0.5) return cut.slice(0, stop + 1);
  // No sentence break in budget — fall back to the last whole word rather
  // than slicing through the middle of one.
  const wordStop = cut.lastIndexOf(' ');
  return `${(wordStop > max * 0.5 ? cut.slice(0, wordStop) : cut).trimEnd()}…`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ── per-book excerpting ─────────────────────────────────────────────────── */

/** Pull the passage a given book offers for this card in this orientation. */
export function excerpt(card, book, reversed) {
  const src = card.sources?.[book];
  if (!src) return '';
  const key = reversed ? 'reversed' : 'upright';

  switch (book) {
    case 'darkforest':
      return src[key] || src.upright || '';
    case 'waite':
    case 'delaurence': {
      const main = src[key] || src.upright || '';
      const extra = !reversed && src.additional ? ` ${src.additional}` : '';
      return (main + extra).trim();
    }
    case 'thierens':
      if (reversed && src.reversed) return src.reversed;
      return src.conclusion || src.tradition || firstSentences(src.commentary, 3);
    case 'papus':
      return src.divinatory || firstSentences(src.symbolism, 2);
    default:
      return '';
  }
}

/**
 * Merge what the selected books say for a card into one unattributed
 * passage, rather than picking a single book's quote. Waite and De Laurence
 * cover almost every card in near-identical Edwardian register, so only one
 * of them leads; Thierens, when selected, adds one clean sentence rather
 * than a full second quote. Cuts land on sentence boundaries, not a raw
 * character count, so nothing trails off mid-word.
 */
export function combineExcerpts(card, reversed, books) {
  const chosen = new Set(books);
  const bits = [];

  const primaryBook = chosen.has('waite') ? 'waite' : chosen.has('delaurence') ? 'delaurence' : null;
  if (primaryBook) {
    const text = excerpt(card, primaryBook, reversed);
    // firstSentences keeps the cut on a sentence boundary; trimTo is still
    // applied after as a hard cap, in case a passage never hits one.
    if (text) bits.push(trimTo(firstSentences(text, 2) || text, 420));
  }
  if (chosen.has('thierens')) {
    const text = excerpt(card, 'thierens', reversed);
    if (text) bits.push(trimTo(firstSentences(text, 1) || text, 220));
  }

  return bits.join(' ');
}

/**
 * Papus's "divinatory meaning" isn't prose — it's a short block-capital tag
 * (e.g. "LOVE", "INCONSIDERATE ACTIONS. MADNESS"). Spliced into a flowing
 * paragraph it reads as a broken sentence, so it's kept separate — a short
 * tag line alongside the meaning rather than folded into it.
 */
export function keywordTag(card, reversed, books) {
  if (!books.includes('papus')) return '';
  const text = excerpt(card, 'papus', reversed);
  if (!text) return '';
  // Some entries carry more than the tag itself (a parsing gap upstream),
  // so this stays capped rather than trusting the source to be short.
  return trimTo(firstSentences(text, 1) || text, 140);
}

/* ── pattern reading across the whole spread ─────────────────────────────── */

export function analyze(drawn, byId) {
  const cards = drawn.map((d) => byId[d.id]).filter(Boolean);
  const total = cards.length || 1;
  const majors = cards.filter((c) => c.arcana === 'major');
  const reversals = drawn.filter((d) => d.reversed);
  const courts = cards.filter((c) => c.court);

  const suitCounts = {};
  for (const card of cards) if (card.suit) suitCounts[card.suit] = (suitCounts[card.suit] || 0) + 1;
  const [topSuit, topCount] = Object.entries(suitCounts)
    .sort((a, b) => b[1] - a[1])[0] || [null, 0];

  const rankCounts = {};
  for (const card of cards) {
    if (card.arcana === 'minor') rankCounts[card.rank] = (rankCounts[card.rank] || 0) + 1;
  }
  const repeated = Object.entries(rankCounts)
    .filter(([, n]) => n > 1)
    .map(([rank, n]) => ({ rank: Number(rank), count: n }));

  const notes = [];

  if (majors.length && majors.length / total >= 0.5 && total > 1) {
    notes.push(`${majors.length} of ${total} cards are Major Arcana. The matter is `
      + `larger than day-to-day choosing — this is a chapter, not an errand.`);
  } else if (!majors.length && total > 2) {
    notes.push('No Major Arcana here. This is everyday ground: workable, '
      + 'in your hands, not fate.');
  }

  if (topSuit && topCount > 1 && topCount / total >= 0.5) {
    const s = SUIT_THEME[topSuit];
    notes.push(`${topSuit[0].toUpperCase()}${topSuit.slice(1)} dominates (${topCount} cards), `
      + `so ${s.element} runs through this: ${s.theme}.`);
  }

  if (reversals.length && total > 1) {
    const share = reversals.length / total;
    if (share >= 0.6) {
      notes.push('Most of the spread is reversed. The energy is real but turned '
        + 'inward, delayed, or being held back rather than absent.');
    } else if (reversals.length === 1) {
      const card = byId[reversals[0].id];
      notes.push(`Only ${card.name} is reversed — the one place where the current `
        + 'is running against you, or inward.');
    }
  }

  for (const { rank, count } of repeated) {
    if (RANK_ARC[rank]) {
      notes.push(`${count} cards share the number ${rank}: ${RANK_ARC[rank]}. `
        + 'A repeated number is the deck saying the same thing twice.');
    }
  }

  if (courts.length > 1) {
    notes.push(`${courts.length} court cards — other people are genuinely part of `
      + 'this, not just background.');
  }

  return { majors, reversals, courts, topSuit, topCount, repeated, notes };
}

/* ── offline reading ─────────────────────────────────────────────────────── */

export function composeOffline({ spread, drawn, byId, books }) {
  const usable = books.filter((b) => b !== 'darkforest');
  const parts = [];

  parts.push(`<h3>${esc(spread.name)}</h3>`);
  parts.push(`<p>${esc(spread.blurb)}</p>`);
  parts.push('<hr class="divider">');

  drawn.forEach((slot, i) => {
    const card = byId[slot.id];
    if (!card) return;
    const position = spread.positions[i] || { name: `Card ${i + 1}`, prompt: '' };

    parts.push(`<h4>${esc(position.name)}</h4>`);
    parts.push(`<p><strong>${esc(card.name)}</strong>`
      + `${slot.reversed ? ' <em>· reversed</em>' : ''}`
      + `${position.prompt ? ` — <em>${esc(position.prompt)}</em>` : ''}</p>`);

    const meaning = combineExcerpts(card, slot.reversed, usable);
    if (meaning) parts.push(`<blockquote>${esc(meaning)}</blockquote>`);

    const tag = keywordTag(card, slot.reversed, usable);
    if (tag) parts.push(`<p><em>${esc(tag)}</em></p>`);
  });

  const patterns = analyze(drawn, byId);
  if (patterns.notes.length) {
    parts.push('<hr class="divider">');
    parts.push('<h4>How the cards talk to each other</h4>');
    parts.push(`<ul>${patterns.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`);
  }

  return parts.join('\n');
}

/* ── grounded prompt for the model ───────────────────────────────────────── */

const VOICE = {
  warm: {
    label: 'warm and plain',
    style: 'Write warmly and plainly, like a thoughtful friend who knows the cards. '
      + 'Short paragraphs. No mysticism for its own sake, no purple prose. '
      + 'Be honest about difficult cards rather than softening them into nothing.',
  },
  classical: {
    label: 'classical',
    style: 'Write in the measured, slightly formal register of the older divinatory '
      + 'manuals — Waite\'s register — without becoming archaic or unreadable. '
      + 'Favour the traditional divinatory vocabulary given in the sources.',
  },
  esoteric: {
    label: 'esoteric',
    style: 'Foreground the esoteric layer: element, number, and the astrological '
      + 'attributions given in the sources. Explain what those correspondences '
      + 'imply for the question, but stay concrete and avoid vague cosmic filler.',
  },
};

export function buildMessages({ spread, drawn, byId, books, voice = 'warm' }) {
  const v = VOICE[voice] || VOICE.warm;
  const patterns = analyze(drawn, byId);

  const system = [
    'You are a tarot reader. You interpret a spread using ONLY the source',
    'passages supplied with each card. Those passages come from four books and',
    'are the authority: do not substitute meanings you remember from elsewhere,',
    'and do not invent correspondences that are not given.',
    '',
    v.style,
    '',
    'Structure your reading:',
    '- Open with one or two sentences naming what the spread is about as a whole.',
    '- Take each position in order. Give the position a heading. Say what the card',
    '  means THERE — the position changes the meaning, so use its prompt.',
    '- Then a short section on how the cards relate to each other.',
    '- Close with a concrete, actionable paragraph, and nothing fortune-telling',
    '  about fixed outcomes: the cards describe a current, not a verdict.',
    '',
    'Rules:',
    '- Honour reversals. A reversed card is the same energy turned inward,',
    '  delayed or blocked, not simply its opposite.',
    '- When you lean on a specific book, name it inline, e.g. "(Waite)".',
    '- Use Markdown: ## for the opening, ### for each position, ** for emphasis.',
    '- Do not list keywords back at the reader; write prose.',
    '- Around 400-600 words total.',
  ].join('\n');

  const lines = [];
  lines.push(`SPREAD: ${spread.name} — ${spread.blurb}`);
  lines.push('QUESTION: none given; read it as a general "what should I be looking at now".');
  lines.push('');

  drawn.forEach((slot, i) => {
    const card = byId[slot.id];
    if (!card) return;
    const position = spread.positions[i] || { name: `Card ${i + 1}`, prompt: '' };

    lines.push(`--- POSITION ${i + 1}: ${position.name} (${position.prompt}) ---`);
    lines.push(`CARD: ${card.name}${slot.reversed ? ' (REVERSED)' : ' (upright)'}`);

    const facts = [card.arcana === 'major' ? `Major Arcana ${card.roman}` : null,
      card.suit ? `${card.rankName} of ${card.suit}` : null,
      card.element ? `element ${card.element}` : null,
      card.attribution ? `attribution ${card.attribution}` : null,
    ].filter(Boolean);
    if (facts.length) lines.push(`FACTS: ${facts.join('; ')}`);

    for (const book of books) {
      const text = excerpt(card, book, slot.reversed);
      if (text) lines.push(`${BOOK_LABEL[book]}: ${trimTo(text, 700)}`);
    }
    lines.push('');
  });

  if (patterns.notes.length) {
    lines.push('PATTERNS ACROSS THE SPREAD (computed, use what is useful):');
    for (const note of patterns.notes) lines.push(`- ${note}`);
    lines.push('');
  }

  lines.push('Write the reading now.');

  return [
    { role: 'system', content: system },
    { role: 'user', content: lines.join('\n') },
  ];
}
