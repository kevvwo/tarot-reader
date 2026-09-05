/**
 * Procedural card art.
 *
 * Every face is drawn as SVG on a 60x96 canvas: a gold double frame, the rank
 * or roman numeral at the top, an emblem in the middle and the name along the
 * bottom. Majors get a hand-built glyph each; minors get their suit sigil laid
 * out in the classic pip arrangement, or a court emblem.
 *
 * Nothing here is loaded from the network, so the deck renders offline and
 * stays sharp at any size.
 */

const SUIT_INK = {
  wands:     { bg: '#241a12', bg2: '#3a2716', ink: '#e0a865', line: '#8a6134' },
  cups:      { bg: '#121e2a', bg2: '#193243', ink: '#7fbcd8', line: '#3c6a83' },
  swords:    { bg: '#191c26', bg2: '#262c3c', ink: '#b9c4d8', line: '#5d6784' },
  pentacles: { bg: '#131f18', bg2: '#1d3226', ink: '#87c095', line: '#3f6c4e' },
};

const MAJOR_INK = { bg: '#171630', bg2: '#241f45', ink: '#d9bb6c', line: '#7a6398' };

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ── small drawing helpers ───────────────────────────────────────────────── */

const S = (n) => Number(n.toFixed(2));

function starPath(cx, cy, r, points = 5, innerRatio = 0.42) {
  const step = Math.PI / points;
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 ? r * innerRatio : r;
    const a = i * step - Math.PI / 2;
    d += `${i ? 'L' : 'M'}${S(cx + Math.cos(a) * rad)} ${S(cy + Math.sin(a) * rad)}`;
  }
  return d + 'Z';
}

function polyPath(pts) {
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${S(x)} ${S(y)}`).join('') + 'Z';
}

/** Waxing crescent: a disc with a second disc bitten out of it. */
function crescentPath(cx, cy, r, bite = 0.62) {
  return `M${S(cx)} ${S(cy - r)}A${S(r)} ${S(r)} 0 1 0 ${S(cx)} ${S(cy + r)}`
       + `A${S(r * bite)} ${S(r)} 0 1 1 ${S(cx)} ${S(cy - r)}Z`;
}

function rays(cx, cy, inner, outer, count) {
  let d = '';
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2;
    d += `M${S(cx + Math.cos(a) * inner)} ${S(cy + Math.sin(a) * inner)}`
       + `L${S(cx + Math.cos(a) * outer)} ${S(cy + Math.sin(a) * outer)}`;
  }
  return d;
}

/* ── suit sigils, drawn around a local origin ────────────────────────────── */

function sigil(suit, cx, cy, scale, ink) {
  const k = (n) => S(n * scale);
  const stroke = `stroke="${ink}" fill="none" stroke-width="${S(0.9 * scale)}"
                  stroke-linecap="round" stroke-linejoin="round"`;
  switch (suit) {
    case 'wands':
      return `<g transform="translate(${S(cx)} ${S(cy)})">
        <path d="M0 ${k(4.5)}V${k(-4.5)}" ${stroke}/>
        <path d="M0 ${k(-1.2)}q${k(2.6)} ${k(-0.6)} ${k(3.1)} ${k(-3.2)}
                 q${k(-2.8)} ${k(0.2)} ${k(-3.1)} ${k(3.2)}Z" fill="${ink}" opacity=".9"/>
        <path d="M0 ${k(0.8)}q${k(-2.6)} ${k(-0.6)} ${k(-3.1)} ${k(-3.2)}
                 q${k(2.8)} ${k(0.2)} ${k(3.1)} ${k(3.2)}Z" fill="${ink}" opacity=".9"/>
      </g>`;
    case 'cups':
      return `<g transform="translate(${S(cx)} ${S(cy)})">
        <path d="M${k(-3.2)} ${k(-3.6)}h${k(6.4)}a${k(3.2)} ${k(3.4)} 0 0 1 ${k(-6.4)} 0Z" ${stroke}/>
        <path d="M0 ${k(-0.2)}v${k(3)}M${k(-2.2)} ${k(4.2)}h${k(4.4)}" ${stroke}/>
      </g>`;
    case 'swords':
      return `<g transform="translate(${S(cx)} ${S(cy)})">
        <path d="M0 ${k(-4.6)}L${k(1.1)} ${k(-1.8)}V${k(2.4)}H${k(-1.1)}V${k(-1.8)}Z"
              fill="${ink}" opacity=".92"/>
        <path d="M${k(-2.8)} ${k(2.4)}h${k(5.6)}M0 ${k(2.4)}v${k(2.4)}" ${stroke}/>
      </g>`;
    default:
      return `<g transform="translate(${S(cx)} ${S(cy)})">
        <circle r="${k(4.2)}" ${stroke}/>
        <path d="${starPath(0, 0, k(3.2), 5, 0.5)}" ${stroke} stroke-width="${S(0.7 * scale)}"/>
      </g>`;
  }
}

/** Classic pip arrangements for ranks 1-10, in a 60x96 card's middle band. */
function pipLayout(rank) {
  const L = 20, R = 40, C = 30;
  const rows = [30, 38, 46, 54, 62];
  const P = (x, y) => [x, y];
  switch (rank) {
    case 1: return [P(C, 46)];
    case 2: return [P(C, 33), P(C, 59)];
    case 3: return [P(C, 31), P(C, 46), P(C, 61)];
    case 4: return [P(L, 34), P(R, 34), P(L, 58), P(R, 58)];
    case 5: return [P(L, 33), P(R, 33), P(C, 46), P(L, 59), P(R, 59)];
    case 6: return [P(L, 31), P(R, 31), P(L, 46), P(R, 46), P(L, 61), P(R, 61)];
    case 7: return [P(L, 31), P(R, 31), P(L, 46), P(R, 46), P(L, 61), P(R, 61), P(C, 38)];
    case 8: return [P(L, rows[0]), P(R, rows[0]), P(L, rows[1] + 2), P(R, rows[1] + 2),
                    P(L, rows[3] - 2), P(R, rows[3] - 2), P(L, rows[4]), P(R, rows[4])];
    case 9: return [P(L, 30), P(R, 30), P(L, 40), P(R, 40), P(C, 46),
                    P(L, 52), P(R, 52), P(L, 62), P(R, 62)];
    default: return [P(L, 29), P(R, 29), P(L, 38), P(R, 38), P(C, 33),
                     P(L, 54), P(R, 54), P(L, 63), P(R, 63), P(C, 59)];
  }
}

/* ── court emblems ───────────────────────────────────────────────────────── */

function courtEmblem(rank, suit, ink, line) {
  const stroke = `stroke="${ink}" fill="none" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"`;
  const seat = `<path d="M20 62h20M22 62v-4M38 62v-4" stroke="${line}" fill="none" stroke-width="0.9"/>`;
  switch (rank) {
    case 11: // Page — a youth with a raised sigil
      return `<g>${sigil(suit, 30, 36, 1.5, ink)}
        <path d="M30 44v10M24 56h12M27 54l3-4 3 4" ${stroke}/>${seat}</g>`;
    case 12: // Knight — a horse's arc and a pennant
      return `<g>
        <path d="M20 60q4-14 12-14t10 10" ${stroke}/>
        <path d="M42 56V32l8 4-8 4" ${stroke}/>
        ${sigil(suit, 24, 44, 1.2, ink)}${seat}</g>`;
    case 13: // Queen — a rounded crown
      return `<g>
        <path d="M20 44l3-9 7 7 7-7 3 9z" ${stroke}/>
        <circle cx="23" cy="33.5" r="1.5" fill="${ink}"/>
        <circle cx="37" cy="33.5" r="1.5" fill="${ink}"/>
        <circle cx="30" cy="30" r="1.8" fill="${ink}"/>
        ${sigil(suit, 30, 56, 1.5, ink)}${seat}</g>`;
    default: // King — a pointed crown
      return `<g>
        <path d="M19 45l2-13 5 6 4-8 4 8 5-6 2 13z" ${stroke}/>
        <path d="M19 45h22" stroke="${ink}" stroke-width="1.2"/>
        ${sigil(suit, 30, 57, 1.6, ink)}${seat}</g>`;
  }
}

/* ── major arcana glyphs ─────────────────────────────────────────────────── */

function majorGlyph(number, ink, line) {
  const s = `stroke="${ink}" fill="none" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round"`;
  const thin = `stroke="${line}" fill="none" stroke-width="0.8" stroke-linecap="round"`;
  const G = (inner) => `<g transform="translate(0 -2)">${inner}</g>`;

  switch (number) {
    case 0: return G(`<circle cx="30" cy="44" r="11" ${s}/>
      <path d="${starPath(30, 44, 5.4, 5, 0.45)}" fill="${ink}" opacity=".9"/>
      <path d="M18 58l24-24" ${thin}/>`);
    case 1: return G(`<path d="M22 36a4 4 0 1 1 8 0 4 4 0 1 0 8 0 4 4 0 1 1-8 0 4 4 0 1 0-8 0Z" ${s}/>
      <path d="M30 44v14M22 58h16" ${s}/>
      <circle cx="24" cy="54" r="1.2" fill="${ink}"/><circle cx="36" cy="54" r="1.2" fill="${ink}"/>`);
    case 2: return G(`<path d="M21 28v32M39 28v32" ${s}/>
      <path d="${crescentPath(30, 44, 7)}" fill="${ink}" opacity=".92"/>
      <path d="M21 30h18" ${thin}/>`);
    case 3: return G(`<circle cx="30" cy="40" r="8" ${s}/><path d="M30 48v12M25 55h10" ${s}/>
      ${[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        return `<circle cx="${S(30 + Math.cos(a) * 12)}" cy="${S(40 + Math.sin(a) * 12)}" r="1.1" fill="${ink}" opacity=".8"/>`;
      }).join('')}`);
    case 4: return G(`<path d="M21 58V40l9-8 9 8v18z" ${s}/>
      <path d="M24 40a4 4 0 0 1 0-7M36 40a4 4 0 0 0 0-7" ${s}/>
      <path d="M27 58v-9h6v9" ${thin}/>`);
    case 5: return G(`<path d="M30 28v30M23 36h14M25 46h10" ${s}/>
      <circle cx="24" cy="57" r="2.6" ${thin}/><circle cx="36" cy="57" r="2.6" ${thin}/>`);
    case 6: return G(`<circle cx="25" cy="47" r="7.5" ${s}/><circle cx="35" cy="47" r="7.5" ${s}/>
      <path d="${starPath(30, 31, 5, 8, 0.4)}" fill="${ink}" opacity=".85"/>`);
    case 7: return G(`<path d="M19 52h22v8H19z" ${s}/><path d="M22 52V40h16v12" ${s}/>
      <path d="${starPath(30, 33, 4.2, 8, 0.4)}" fill="${ink}" opacity=".85"/>
      <circle cx="23" cy="62" r="2.4" ${thin}/><circle cx="37" cy="62" r="2.4" ${thin}/>`);
    case 8: return G(`<path d="M22 34a4 4 0 1 1 8 0 4 4 0 1 0 8 0 4 4 0 1 1-8 0 4 4 0 1 0-8 0Z" ${s}/>
      <circle cx="30" cy="52" r="8" ${s}/>
      <path d="${rays(30, 52, 8.5, 12, 10)}" ${thin}/>`);
    case 9: return G(`<path d="M26 34h8l2 12H24z" ${s}/>
      <path d="${starPath(30, 40, 3.4, 6, 0.5)}" fill="${ink}" opacity=".9"/>
      <path d="M30 46v14" ${thin}/><path d="M40 32v28" ${s}/>`);
    case 10: return G(`<circle cx="30" cy="45" r="13" ${s}/><circle cx="30" cy="45" r="4.5" ${s}/>
      <path d="${rays(30, 45, 4.5, 13, 8)}" ${thin}/>`);
    case 11: return G(`<path d="M30 30v30M18 60h24" ${s}/><path d="M18 38h24" ${s}/>
      <path d="M18 38l-4 8h8zM42 38l-4 8h8z" ${s}/>`);
    case 12: return G(`<path d="M18 30h24M30 30v10" ${s}/><circle cx="30" cy="45" r="5" ${s}/>
      <path d="M30 50v6l-5 5M30 56l5 5" ${s}/>`);
    case 13: return G(`<path d="M22 60q0-14 8-14t8 14z" ${s}/>
      <circle cx="26.5" cy="52" r="1.6" fill="${ink}"/><circle cx="33.5" cy="52" r="1.6" fill="${ink}"/>
      <path d="M18 36q12-8 24 0" ${s}/><path d="M42 36v10" ${thin}/>`);
    case 14: return G(`<path d="M20 34h9l-1.5 7a3 3 0 0 1-6 0z" ${s}/>
      <path d="M31 52h9l-1.5 7a3 3 0 0 1-6 0z" ${s}/>
      <path d="M25 43q6 3 10 8" ${thin}/>`);
    case 15: return G(`<path d="${starPath(30, 46, 11, 5, 0.45)}" ${s} transform="rotate(180 30 46)"/>
      <path d="M22 30a6 6 0 0 1 4 6M38 30a6 6 0 0 0-4 6" ${s}/>`);
    case 16: return G(`<path d="M22 62V38h16v24z" ${s}/><path d="M22 38l8-8 8 8" ${s}/>
      <path d="M33 30l-6 12h6l-5 10" stroke="${ink}" fill="none" stroke-width="1.4" stroke-linejoin="round"/>
      <circle cx="27" cy="50" r="1" fill="${ink}"/>`);
    case 17: return G(`<path d="${starPath(30, 42, 11, 8, 0.4)}" fill="${ink}" opacity=".92"/>
      ${[[17, 30], [43, 30], [16, 52], [44, 52], [22, 60], [38, 60], [30, 62]]
        .map(([x, y]) => `<path d="${starPath(x, y, 2.6, 5, 0.42)}" fill="${line}" opacity=".85"/>`).join('')}`);
    case 18: return G(`<path d="${crescentPath(30, 42, 10)}" fill="${ink}" opacity=".9"/>
      <path d="M18 62V50l4-5 4 5v12zM34 62V50l4-5 4 5v12z" ${thin}/>
      <path d="${rays(30, 42, 12, 15, 12)}" ${thin}/>`);
    case 19: return G(`<circle cx="30" cy="44" r="9.5" fill="${ink}" opacity=".9"/>
      <path d="${rays(30, 44, 11.5, 16, 12)}" stroke="${ink}" fill="none" stroke-width="1"/>`);
    case 20: return G(`<path d="M20 40l16-8v16z" ${s}/><path d="M20 40v18" ${s}/>
      <path d="M26 58h16" ${s}/><path d="M34 58V46" ${thin}/>
      <path d="${starPath(44, 34, 3, 5, 0.42)}" fill="${ink}" opacity=".85"/>`);
    default: return G(`<ellipse cx="30" cy="45" rx="11" ry="15" ${s}/>
      <path d="${starPath(30, 45, 5.4, 4, 0.35)}" fill="${ink}" opacity=".9"/>
      ${[[18, 30], [42, 30], [18, 60], [42, 60]]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.7" fill="${line}"/>`).join('')}`);
  }
}

/* ── public API ──────────────────────────────────────────────────────────── */

/** Fit a card name onto one or two lines at the foot of the card. */
function nameLines(name) {
  if (name.length <= 15) return [name];
  const words = name.split(' ');
  if (words.length < 2) return [name];
  // Break as close to the middle as the words allow.
  let best = 1, bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ').length;
    const b = words.slice(i).join(' ').length;
    if (Math.abs(a - b) < bestDiff) { bestDiff = Math.abs(a - b); best = i; }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

export function cardFace(card) {
  const major = card.arcana === 'major';
  const ink = major ? MAJOR_INK : (SUIT_INK[card.suit] || MAJOR_INK);
  const id = `g${card.id.replace(/[^a-z0-9]/g, '')}`;

  const top = major ? (ROMAN[card.number] || '') : (card.rankName || '').toUpperCase();
  const emblem = major
    ? majorGlyph(card.number, ink.ink, ink.line)
    : (card.court
      ? courtEmblem(card.rank, card.suit, ink.ink, ink.line)
      : pipLayout(card.rank).map(([x, y]) => sigil(card.suit, x, y, 1, ink.ink)).join(''));

  const lines = nameLines(card.name);
  const nameY = lines.length > 1 ? 80 : 83;

  return `<svg viewBox="0 0 60 96" xmlns="http://www.w3.org/2000/svg" role="img"
       aria-label="${esc(card.name)}">
  <defs>
    <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${ink.bg2}"/>
      <stop offset="1" stop-color="${ink.bg}"/>
    </linearGradient>
  </defs>
  <rect width="60" height="96" rx="5" fill="url(#${id})"/>
  <rect x="1.6" y="1.6" width="56.8" height="92.8" rx="4"
        fill="none" stroke="${ink.ink}" stroke-width="0.7" opacity=".55"/>
  <rect x="3.6" y="3.6" width="52.8" height="88.8" rx="3"
        fill="none" stroke="${ink.line}" stroke-width="0.4" opacity=".7"/>
  <text x="30" y="15" text-anchor="middle" fill="${ink.ink}"
        font-family="Georgia, serif" font-size="8" letter-spacing="0.6"
        opacity=".95">${esc(top)}</text>
  <path d="M14 19h32" stroke="${ink.line}" stroke-width="0.5" opacity=".8"/>
  ${emblem}
  <path d="M14 72h32" stroke="${ink.line}" stroke-width="0.5" opacity=".8"/>
  ${lines.map((l, i) => `<text x="30" y="${nameY + i * 7}" text-anchor="middle"
        fill="${ink.ink}" font-family="Georgia, serif" font-size="${l.length > 13 ? 5.4 : 6.2}"
        letter-spacing="0.3">${esc(l)}</text>`).join('')}
</svg>`;
}

export function cardBack() {
  return `<svg viewBox="0 0 60 96" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <use href="#card-back"/></svg>`;
}

/**
 * The card as the UI shows it: the 1909 Rider-Waite-Smith scan, with the drawn
 * face from `cardFace` underneath it.
 *
 * Layering rather than replacing means a scan that is missing, still arriving,
 * or blocked falls back to the drawn card on its own — no JavaScript, no error
 * handler, and no flash of an empty rectangle. The <img> is alt="" because the
 * SVG beneath it already carries the card's name for screen readers.
 */
export function cardArt(card) {
  return `<span class="tcard-art">${cardFace(card)}<img class="tcard-scan"
    src="cards/${esc(card.id)}.webp" alt="" loading="lazy" decoding="async"></span>`;
}
