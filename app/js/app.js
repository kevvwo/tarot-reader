/** Tarot Reader — application controller. */

import { cardArt, cardBack } from './art.js';
import { draw } from './deck.js';
import * as store from './store.js';
import * as ollama from './ollama.js';
import {
  composeOffline, buildMessages, combineExcerpts, keywordTag, trimTo, BOOK_LABEL,
} from './reading.js';
import {
  $, $$, escapeHtml, renderMarkdown, renderProse, tick,
} from './ui.js';

const state = {
  corpus: null,
  byId: {},
  spreads: [],
  settings: store.loadSettings(),
  current: null,   // the draw being read right now
  abort: null,     // AbortController for an in-flight generation
  manual: null,    // cards being entered by hand: { spreadId, slots }
  pickIndex: -1,   // which manual slot the picker is filling
  searchKeys: {},  // card id -> lowercase haystack for the picker's search
  picking: null,   // the face-down fan being tapped through: { spreadId, pool, slots }
};

const BOOK_ORDER = ['waite', 'delaurence', 'thierens', 'papus'];

/* ── boot ────────────────────────────────────────────────────────────────── */

async function boot() {
  try {
    const res = await fetch('corpus.json');
    if (!res.ok) throw new Error(`corpus.json (${res.status})`);
    state.corpus = await res.json();
  } catch (err) {
    const boot = $('#boot');
    boot.classList.add('is-error');
    boot.innerHTML = `<div class="boot-mark">✕</div>
      <p class="boot-text">Could not load the deck.<br>${escapeHtml(err.message)}</p>`;
    return;
  }

  for (const card of state.corpus.cards) {
    state.byId[card.id] = card;
    state.searchKeys[card.id] = searchKey(card);
  }
  state.spreads = state.corpus.spreads;

  renderSpreadList();
  renderLibraryFilters();
  renderLibrary('all');
  wireEvents();
  applySettingsToUi();

  $('#boot').remove();
  $('#app').hidden = false;

  // Populate the model list in the background; the app works without it.
  refreshModels();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline cache is optional */ });
  }
}

/* ── navigation ──────────────────────────────────────────────────────────── */

function goto(view) {
  for (const section of $$('.view')) section.hidden = section.dataset.view !== view;
  for (const tab of $$('.tab')) {
    tab.classList.toggle('is-active', tab.dataset.goto === view);
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function openSheet(id) {
  $(`#${id}`).hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeSheet(id) {
  $(`#${id}`).hidden = true;
  document.body.style.overflow = '';
}

/* ── draw view ───────────────────────────────────────────────────────────── */

function renderSpreadList() {
  const list = $('#spread-list');
  list.innerHTML = state.spreads.map((s) => `
    <button class="spread-opt" role="radio" data-spread="${escapeHtml(s.id)}"
            aria-checked="${s.id === state.settings.spread}">
      <strong>${escapeHtml(s.name)}<span class="count">${s.count} card${s.count > 1 ? 's' : ''}</span></strong>
      <span>${escapeHtml(s.blurb)}</span>
    </button>`).join('');

  list.onclick = (e) => {
    const btn = e.target.closest('[data-spread]');
    if (!btn) return;
    state.settings = store.saveSettings({ spread: btn.dataset.spread });
    for (const opt of $$('[data-spread]', list)) {
      opt.setAttribute('aria-checked', String(opt === btn));
    }
    updateDeckHint();
    tick();
  };
  updateDeckHint();
}

function currentSpread() {
  return state.spreads.find((s) => s.id === state.settings.spread) || state.spreads[0];
}

function updateDeckHint() {
  const spread = currentSpread();
  $('#deck-hint').textContent =
    `Tap the deck, then choose ${spread.count} card${spread.count > 1 ? 's' : ''}`;
}

function doDraw() {
  const deck = $('#deck');
  deck.classList.add('is-shuffling');
  tick(14);
  setTimeout(() => deck.classList.remove('is-shuffling'), 520);
  // Let the shuffle animation land before the fan replaces the deck view.
  setTimeout(beginPicking, 430);
}

/* ── choosing your cards ─────────────────────────────────────────────────── */

/**
 * A face-down fan of the whole shuffled deck, tapped through one card at a
 * time — drawing is something you do, not something the app does for you.
 * Orientation is decided per card at shuffle time, the way it would be from a
 * real cut, and stays hidden until that card is actually tapped.
 */
function beginPicking() {
  const spread = currentSpread();
  state.picking = {
    spreadId: spread.id,
    pool: draw(state.corpus.cards, state.corpus.cards.length, state.settings.allowReversed),
    slots: Array.from({ length: spread.count }, () => null),
  };
  renderPicking();
  goto('picking');
}

function pickingSpread() {
  return state.spreads.find((s) => s.id === state.picking?.spreadId) || currentSpread();
}

function renderPicking() {
  const picking = state.picking;
  const spread = pickingSpread();
  const filled = picking.slots.filter(Boolean).length;

  $('#picking-sub').textContent = filled < picking.slots.length
    ? `${spread.name} · tap a card for “${spread.positions[filled]?.name || `card ${filled + 1}`}”`
    : `${spread.name} · all ${picking.slots.length} chosen`;

  $('#picking-slots').innerHTML = picking.slots.map((slot, i) => {
    const card = slot ? state.byId[slot.id] : null;
    return `<div class="picking-slot${card ? ' is-set' : ''}">
      <div class="picking-thumb${slot?.reversed ? ' is-reversed' : ''}">${
  card ? cardArt(card) : '<span class="picking-thumb-mark" aria-hidden="true">?</span>'}</div>
      <div class="picking-slot-label">${escapeHtml(spread.positions[i]?.name || `Card ${i + 1}`)}</div>
    </div>`;
  }).join('');

  // A full re-render replaces every node, which would otherwise snap the
  // strip back to its start on every tap.
  const fan = $('#picking-fan');
  const prevScroll = fan.scrollLeft;
  fan.innerHTML = picking.pool.map((_slot, i) => `
    <button class="tcard picking-card" data-poolidx="${i}"
            aria-label="Face-down card, ${i + 1} of ${picking.pool.length} left">
      ${cardBack()}
    </button>`).join('');
  fan.scrollLeft = prevScroll;
}

function pickFromPool(poolIndex) {
  const picking = state.picking;
  if (!picking) return;
  const openSlot = picking.slots.findIndex((s) => !s);
  if (openSlot === -1) return;

  const [card] = picking.pool.splice(poolIndex, 1);
  picking.slots[openSlot] = card;
  tick();
  renderPicking();

  // Carry this exact session into the timeout rather than reading
  // state.picking when it fires: cancel-then-redraw within the 550ms window
  // would otherwise let a stale finish complete the *new* (still-empty)
  // session instead of doing nothing.
  if (picking.slots.every(Boolean)) setTimeout(() => finishPicking(picking), 550);
}

function cancelPicking() {
  state.picking = null;
  goto('draw');
}

/** Hand the chosen cards to the reading view, exactly as a one-tap draw would. */
function finishPicking(picking) {
  // Stale if this session was cancelled, or cancelled-then-redrawn, since
  // the timeout was scheduled.
  if (!picking || state.picking !== picking) return;
  const spread = state.spreads.find((s) => s.id === picking.spreadId) || currentSpread();

  state.current = {
    spreadId: spread.id,
    spreadName: spread.name,
    drawn: picking.slots,
  };
  state.picking = null;

  renderReading();
  goto('reading');
}

/* ── cards dealt by hand ─────────────────────────────────────────────────── */

/**
 * Everything one card can be searched by, lowercased into a single string.
 *
 * Includes both the written and numeric forms of the rank so the shorthand a
 * reader actually types — "7 cups", "iv", "page pent" — finds the card without
 * having to spell "Seven of Pentacles" on a phone keyboard.
 */
function searchKey(card) {
  return [
    card.name, card.arcana, card.suit, card.rankName,
    card.arcana === 'major' ? `${card.number} ${card.roman}` : card.rank,
    card.court ? 'court' : '',
    ...(card.keywords?.upright || []),
  ].filter(Boolean).join(' ').toLowerCase();
}

/** Start (or resume) entering a hand-dealt spread. */
function openManual() {
  const spread = currentSpread();
  // Keep what is already entered unless the spread itself changed.
  if (!state.manual || state.manual.spreadId !== spread.id) {
    state.manual = {
      spreadId: spread.id,
      slots: Array.from({ length: spread.count }, () => ({ id: null, reversed: false })),
    };
  }
  renderManual();
  goto('manual');
}

function manualSpread() {
  return state.spreads.find((s) => s.id === state.manual?.spreadId) || currentSpread();
}

function manualSlotMarkup(slot, position, index) {
  const card = slot.id ? state.byId[slot.id] : null;
  return `<div class="manual-slot${card ? ' is-set' : ''}">
    <div class="manual-slot-label">${escapeHtml(position?.name || `Card ${index + 1}`)}</div>
    <div class="manual-slot-row">
      <button class="manual-pick" data-pick="${index}">
        <span class="manual-thumb${slot.reversed ? ' is-reversed' : ''}">${
  card ? cardArt(card) : '<span class="manual-thumb-empty" aria-hidden="true">+</span>'}</span>
        <span class="manual-name${card ? '' : ' is-empty'}">${
  card ? escapeHtml(card.name) : 'Choose a card'}</span>
      </button>
      <button class="chip manual-rev" data-rev="${index}"
              aria-pressed="${slot.reversed ? 'true' : 'false'}"
              ${card ? '' : 'disabled'}>Reversed</button>
    </div>
  </div>`;
}

function renderManual() {
  const spread = manualSpread();
  const slots = state.manual.slots;
  const filled = slots.filter((s) => s.id).length;

  $('#manual-sub').textContent =
    `${spread.name} · ${filled} of ${slots.length} entered`;
  $('#manual-slots').innerHTML = slots
    .map((slot, i) => manualSlotMarkup(slot, spread.positions[i], i))
    .join('');
  $('#btn-manual-read').disabled = filled !== slots.length;
}

/* ── card picker ─────────────────────────────────────────────────────────── */

function openPicker(index) {
  state.pickIndex = index;
  const search = $('#picker-search');
  search.value = '';
  renderPicker('');
  openSheet('picker');
  // A phone keyboard covering the list is worse than an extra tap, so the
  // field is focused only where there is a pointer to type with.
  if (window.matchMedia('(pointer: fine)').matches) search.focus();
}

function renderPicker(query) {
  // A card already placed in another slot cannot be placed twice.
  const used = new Set(state.manual.slots
    .filter((s, i) => s.id && i !== state.pickIndex).map((s) => s.id));
  const chosen = state.manual.slots[state.pickIndex]?.id;

  const tokens = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const matches = state.corpus.cards.filter((card) =>
    tokens.every((t) => state.searchKeys[card.id].includes(t)));

  if (!matches.length) {
    $('#picker-list').innerHTML = '<p class="empty">No card matches that.</p>';
    return;
  }

  $('#picker-list').innerHTML = matches.map((card) => {
    const meta = card.arcana === 'major'
      ? `Major Arcana · ${card.roman}`
      : `${card.rankName} of ${card.suit}`;
    const isUsed = used.has(card.id);
    return `<button class="picker-item" data-choose="${escapeHtml(card.id)}"
            ${isUsed ? 'disabled' : ''} ${card.id === chosen ? 'aria-current="true"' : ''}>
      <span class="picker-thumb">${cardArt(card)}</span>
      <span class="picker-label">
        <span class="picker-name">${escapeHtml(card.name)}</span>
        <span class="picker-meta">${escapeHtml(meta)}${
  isUsed ? ' · already in this spread' : ''}</span>
      </span>
    </button>`;
  }).join('');
}

function chooseCard(cardId) {
  const slot = state.manual?.slots[state.pickIndex];
  if (!slot) return;
  slot.id = cardId;
  closeSheet('picker');
  renderManual();
  tick();
}

/** Hand the entered cards to the reading view, exactly as a draw would. */
function readManual() {
  const slots = state.manual?.slots || [];
  if (!slots.length || slots.some((s) => !s.id)) return;
  const spread = manualSpread();

  state.current = {
    spreadId: spread.id,
    spreadName: spread.name,
    drawn: slots.map((s) => ({ id: s.id, reversed: s.reversed })),
    source: 'manual',
  };

  renderReading();
  goto('reading');
}

/* ── reading view ────────────────────────────────────────────────────────── */

function slotMarkup(slot, position, index) {
  const card = state.byId[slot.id];
  if (!card) return '';
  return `<div class="slot">
    <div class="slot-label">${escapeHtml(position?.name || `Card ${index + 1}`)}</div>
    <button class="tcard slot-card ${slot.reversed ? 'is-reversed' : ''}"
            style="animation-delay:${index * 90}ms"
            data-card="${escapeHtml(card.id)}" data-reversed="${slot.reversed ? '1' : ''}">
      ${cardArt(card)}
    </button>
    <div class="slot-name">${escapeHtml(card.name)}
      ${slot.reversed ? '<span class="rev">reversed</span>' : ''}</div>
  </div>`;
}

function renderReading() {
  const cur = state.current;
  const spread = state.spreads.find((s) => s.id === cur.spreadId) || currentSpread();

  const title = $('#reading-spread');
  title.textContent = spread.name;
  if (cur.source === 'manual') {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = 'dealt by hand';
    title.append(tag);
  }
  const canvas = $('#spread-canvas');
  canvas.className = `spread-canvas layout-${spread.layout}`;
  canvas.innerHTML = cur.drawn
    .map((slot, i) => slotMarkup(slot, spread.positions[i], i))
    .join('');

  const prose = $('#reading-prose');
  prose.innerHTML = '';
  prose.classList.remove('streaming');

  const btn = $('#btn-interpret');
  btn.disabled = false;
  btn.textContent = state.settings.useModel ? 'Read the spread' : 'Compose the reading';
}

async function interpret() {
  const cur = state.current;
  if (!cur) return;
  const spread = state.spreads.find((s) => s.id === cur.spreadId) || currentSpread();
  const prose = $('#reading-prose');
  const btn = $('#btn-interpret');
  const books = orderedBooks();

  // Offline: assemble straight from the corpus.
  if (!state.settings.useModel) {
    prose.innerHTML = composeOffline({ spread, drawn: cur.drawn, byId: state.byId, books });
    return;
  }

  // Generated: stream, but keep the offline reading as the fallback.
  state.abort?.abort();
  state.abort = new AbortController();

  btn.disabled = true;
  btn.textContent = 'Reading…';
  prose.classList.add('streaming');
  prose.innerHTML = '<p><em>Consulting the books…</em></p>';

  const messages = buildMessages({
    spread, drawn: cur.drawn, byId: state.byId, books, voice: state.settings.voice,
  });

  try {
    let first = true;
    const text = await ollama.chat({
      model: state.settings.model,
      messages,
      signal: state.abort.signal,
    }, (_piece, full) => {
      if (first) { prose.innerHTML = ''; first = false; }
      prose.innerHTML = renderMarkdown(full);
    });

    prose.innerHTML = renderMarkdown(text);
  } catch (err) {
    if (err.name === 'AbortError') return;
    const fallback = composeOffline({ spread, drawn: cur.drawn, byId: state.byId, books });
    prose.innerHTML =
      `<p class="cite">${escapeHtml(err.message)} — composed from the books instead.</p>`
      + fallback;
  } finally {
    prose.classList.remove('streaming');
    btn.disabled = false;
    btn.textContent = 'Read again';
  }
}

function orderedBooks() {
  const chosen = new Set(state.settings.books);
  return BOOK_ORDER.filter((b) => chosen.has(b));
}

/* ── card detail sheet ───────────────────────────────────────────────────── */

function detailSection(title, body) {
  return body ? `<h3>${escapeHtml(title)}</h3>${body}` : '';
}

// One combined description per card, drawn from all four books rather than
// letting the reader page through four near-duplicate quotes.
function guideBody(card, reversed) {
  const picture = trimTo(card.picture, 320);
  const meaning = combineExcerpts(card, reversed, BOOK_ORDER);
  const tag = keywordTag(card, reversed, BOOK_ORDER);
  return [
    detailSection('In the picture', renderProse(picture)),
    detailSection(reversed ? 'Reversed' : 'Upright',
      renderProse(meaning) + (tag ? `<p><em>${escapeHtml(tag)}</em></p>` : '')),
  ].join('');
}

function showCard(cardId, reversed = false) {
  const card = state.byId[cardId];
  if (!card) return;

  const meta = [
    card.arcana === 'major' ? `Major Arcana · ${card.roman}` : `${card.rankName} of ${card.suit}`,
    card.element,
    card.attribution,
  ].filter(Boolean).join(' · ');

  $('#sheet-scroll').innerHTML = `
    <div class="detail-head">
      <div class="tcard ${reversed ? 'is-reversed' : ''}">${cardArt(card)}</div>
      <div class="detail-title">
        <h2 id="sheet-title">${escapeHtml(card.name)}</h2>
        <div class="detail-meta">${escapeHtml(meta)}</div>
        ${reversed ? '<div><span class="detail-badge">Reversed</span></div>' : ''}
      </div>
    </div>
    <div id="detail-body">${guideBody(card, reversed)}</div>`;

  openSheet('sheet');
}

/* ── library ─────────────────────────────────────────────────────────────── */

function renderLibraryFilters() {
  const filters = [
    ['all', 'All 78'], ['major', 'Majors'],
    ['wands', 'Wands'], ['cups', 'Cups'], ['swords', 'Swords'], ['pentacles', 'Pentacles'],
  ];
  const box = $('#library-filters');
  box.innerHTML = filters.map(([key, label], i) =>
    `<button class="chip" data-filter="${key}" aria-pressed="${i === 0}">${label}</button>`).join('');

  box.onclick = (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    for (const chip of $$('[data-filter]', box)) {
      chip.setAttribute('aria-pressed', String(chip === btn));
    }
    renderLibrary(btn.dataset.filter);
  };
}

function renderLibrary(filter) {
  const cards = state.corpus.cards.filter((c) => (
    filter === 'all' ? true : filter === 'major' ? c.arcana === 'major' : c.suit === filter));

  $('#library-grid').innerHTML = cards.map((card) => `
    <div class="grid-item">
      <button class="tcard" data-card="${escapeHtml(card.id)}">${cardArt(card)}</button>
      <div class="name">${escapeHtml(card.name)}</div>
    </div>`).join('');
}

/* ── settings ────────────────────────────────────────────────────────────── */

function applySettingsToUi() {
  const s = state.settings;
  $('#allow-reversed').checked = s.allowReversed;
  $('#use-model').checked = s.useModel;
  $('#voice-select').value = s.voice;

  $('#book-toggles').innerHTML = BOOK_ORDER.map((book) => `
    <label class="toggle">
      <input type="checkbox" data-book-toggle="${book}" ${s.books.includes(book) ? 'checked' : ''}>
      <span>${escapeHtml(BOOK_LABEL[book])}${book === 'darkforest'
    ? '<em>Commercial guidebook — personal use only.</em>' : ''}</span>
    </label>`).join('');

  const meta = state.corpus.sources;
  const commercial = Object.values(meta).filter((s) => s.rights === 'commercial').length;
  const rightsNote = commercial
    ? ` ${commercial} of them ${commercial === 1 ? 'is' : 'are'} a commercial product `
      + 'included here for personal use — strip it before sharing this app.'
    : ' All of them are public domain.';
  $('#about-text').innerHTML =
    `Readings are drawn from ${Object.keys(meta).length} books, parsed into `
    + `${state.corpus.cards.length} cards.${rightsNote}<br><br>Corpus built ${escapeHtml(
      (state.corpus.generated || '').slice(0, 10))}.`;
}

async function refreshModels() {
  const select = $('#model-select');
  const status = $('#model-status');
  select.innerHTML = `<option value="${escapeHtml(state.settings.model)}">${
    escapeHtml(state.settings.model)}</option>`;

  try {
    const models = await ollama.listModels();
    if (!models.length) throw new Error('no models installed');
    if (!models.includes(state.settings.model)) models.unshift(state.settings.model);
    select.innerHTML = models.map((m) =>
      `<option value="${escapeHtml(m)}" ${m === state.settings.model ? 'selected' : ''}
        >${escapeHtml(m)}</option>`).join('');
    status.className = 'status ok';
    status.textContent = `Connected · ${models.length} models available`;
  } catch (err) {
    status.className = 'status err';
    status.textContent = `Ollama unreachable (${err.message}). `
      + 'Readings will be composed from the books instead.';
  }
}

/* ── events ──────────────────────────────────────────────────────────────── */

function wireEvents() {
  $('#deck').addEventListener('click', doDraw);
  $('#reading-back').addEventListener('click', () => goto('draw'));

  // Choosing your cards: a face-down fan you tap through.
  $('#picking-back').addEventListener('click', cancelPicking);
  $('#picking-fan').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-poolidx]');
    if (btn) pickFromPool(Number(btn.dataset.poolidx));
  });

  // Cards dealt by hand.
  $('#btn-manual').addEventListener('click', openManual);
  $('#manual-back').addEventListener('click', () => goto('draw'));
  $('#btn-manual-read').addEventListener('click', readManual);
  $('#btn-manual-clear').addEventListener('click', () => {
    if (!state.manual) return;
    for (const slot of state.manual.slots) { slot.id = null; slot.reversed = false; }
    renderManual();
  });

  $('#manual-slots').addEventListener('click', (e) => {
    if (!state.manual) return;
    const pick = e.target.closest('[data-pick]');
    if (pick) { openPicker(Number(pick.dataset.pick)); return; }
    const rev = e.target.closest('[data-rev]');
    if (rev) {
      const slot = state.manual.slots[Number(rev.dataset.rev)];
      slot.reversed = !slot.reversed;
      renderManual();
      tick();
    }
  });

  $('#picker-search').addEventListener('input', (e) => renderPicker(e.target.value));
  $('#picker-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-choose]');
    if (btn) chooseCard(btn.dataset.choose);
  });
  $('#btn-interpret').addEventListener('click', interpret);

  $('#allow-reversed').addEventListener('change', (e) => {
    state.settings = store.saveSettings({ allowReversed: e.target.checked });
  });

  $('#tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-goto]');
    if (!btn) return;
    if (btn.dataset.goto === 'settings') { openSheet('settings'); return; }
    goto(btn.dataset.goto);
  });

  // Any card face anywhere opens the detail sheet.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-card]');
    if (!btn) return;
    showCard(btn.dataset.card, btn.dataset.reversed === '1');
  });

  for (const el of $$('[data-close-sheet]')) {
    el.addEventListener('click', () => closeSheet('sheet'));
  }
  for (const el of $$('[data-close-settings]')) {
    el.addEventListener('click', () => closeSheet('settings'));
  }
  for (const el of $$('[data-close-picker]')) {
    el.addEventListener('click', () => closeSheet('picker'));
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeSheet('sheet');
    closeSheet('settings');
    closeSheet('picker');
  });

  $('#use-model').addEventListener('change', (e) => {
    state.settings = store.saveSettings({ useModel: e.target.checked });
    if (state.current) {
      $('#btn-interpret').textContent =
        state.settings.useModel ? 'Read the spread' : 'Compose the reading';
    }
  });
  $('#model-select').addEventListener('change', (e) => {
    state.settings = store.saveSettings({ model: e.target.value });
  });
  $('#voice-select').addEventListener('change', (e) => {
    state.settings = store.saveSettings({ voice: e.target.value });
  });
  $('#book-toggles').addEventListener('change', (e) => {
    const box = e.target.closest('[data-book-toggle]');
    if (!box) return;
    const chosen = $$('[data-book-toggle]').filter((b) => b.checked).map((b) => b.dataset.bookToggle);
    // At least one book must stay selected or there is nothing to read from.
    if (!chosen.length) { box.checked = true; return; }
    state.settings = store.saveSettings({ books: chosen });
  });
}

boot();
