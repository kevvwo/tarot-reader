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
    .split(/(?<=[.!?])\s+(?=[A-Z“"'])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function firstSentences(text, n) {
  return sentences(text).slice(0, n).join(' ');
}

function trimTo(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return (stop > max * 0.5 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`);
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

export function composeOffline({ spread, drawn, question, byId, books }) {
  const usable = books.filter((b) => b !== 'darkforest');
  const parts = [];

  parts.push(`<h3>${esc(spread.name)}</h3>`);
  if (question) {
    parts.push(`<p><em>You asked:</em> ${esc(question)}</p>`);
  }
  parts.push(`<p>${esc(spread.blurb)}</p>`);
  parts.push('<hr class="divider">');

  drawn.forEach((slot, i) => {
    const card = byId[slot.id];
    if (!card) return;
    const position = spread.positions[i] || { name: `Card ${i + 1}`, prompt: '' };
    const orientation = slot.reversed ? 'reversed' : 'upright';

    parts.push(`<h4>${esc(position.name)}</h4>`);
    parts.push(`<p><strong>${esc(card.name)}</strong>`
      + `${slot.reversed ? ' <em>· reversed</em>' : ''}`
      + `${position.prompt ? ` — <em>${esc(position.prompt)}</em>` : ''}</p>`);

    // The guidebook's own prose carries the reading.
    const lead = card.sources?.darkforest?.[orientation] || card[orientation];
    if (lead && books.includes('darkforest')) {
      parts.push(`<p>${esc(trimTo(lead, 480))}</p>`);
    }

    // Then one short corroborating quote from an older book.
    for (const book of usable) {
      const text = excerpt(card, book, slot.reversed);
      if (!text) continue;
      parts.push(`<blockquote>${esc(trimTo(text, 260))}`
        + `<span class="cite">${esc(BOOK_LABEL[book])}</span></blockquote>`);
      break;
    }

    const keys = slot.reversed ? card.keywords?.reversed : card.keywords?.upright;
    if (keys?.length) {
      parts.push(`<p><em>${esc(keys.slice(0, 5).join(' · '))}</em></p>`);
    }
  });

  const patterns = analyze(drawn, byId);
  if (patterns.notes.length) {
    parts.push('<hr class="divider">');
    parts.push('<h4>How the cards talk to each other</h4>');
    parts.push(`<ul>${patterns.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`);
  }

  // Close on the last card, which in every spread here is the outcome-ish slot.
  const last = byId[drawn[drawn.length - 1]?.id];
  if (last?.advice) {
    parts.push('<h4>Where that leaves you</h4>');
    parts.push(`<p>${esc(trimTo(last.advice, 320))}</p>`);
    if (last.affirmation) {
      parts.push(`<blockquote>${esc(last.affirmation)}`
        + `<span class="cite">${esc(last.name)} · affirmation</span></blockquote>`);
    }
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

export function buildMessages({ spread, drawn, question, byId, books, voice = 'warm' }) {
  const v = VOICE[voice] || VOICE.warm;
  const patterns = analyze(drawn, byId);

  const system = [
    'You are a tarot reader. You interpret a spread using ONLY the source',
    'passages supplied with each card. Those passages come from five books and',
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
  lines.push(question
    ? `QUESTION: ${question}`
    : 'QUESTION: none given; read it as a general "what should I be looking at now".');
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
    if (books.includes('darkforest') && card.advice) {
      lines.push(`ADVICE (Dark Forest): ${trimTo(card.advice, 260)}`);
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
