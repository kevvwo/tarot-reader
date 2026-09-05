/**
 * Persistence. Everything lives in localStorage on this device only.
 *
 * Private browsing and "block cookies" both make storage throw rather than
 * return null, so every access is guarded and the app stays usable (just
 * forgetful) when it fails.
 */

const SETTINGS_KEY = 'tarot.settings.v1';
const JOURNAL_KEY = 'tarot.journal.v1';

const DEFAULTS = {
  useModel: false,
  model: 'gemma4:31b-cloud',
  voice: 'warm',
  allowReversed: true,
  spread: 'past-present-future',
  books: ['waite', 'thierens', 'papus'],
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadSettings() {
  return { ...DEFAULTS, ...read(SETTINGS_KEY, {}) };
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  write(SETTINGS_KEY, next);
  return next;
}

export function loadJournal() {
  const entries = read(JOURNAL_KEY, []);
  return Array.isArray(entries) ? entries : [];
}

export function saveEntry(entry) {
  const entries = loadJournal();
  entries.unshift(entry);
  // Keep the journal from growing without bound on a phone.
  write(JOURNAL_KEY, entries.slice(0, 300));
}

export function updateEntry(id, patch) {
  const entries = loadJournal().map((e) => (e.id === id ? { ...e, ...patch } : e));
  write(JOURNAL_KEY, entries);
}

export function deleteEntry(id) {
  write(JOURNAL_KEY, loadJournal().filter((e) => e.id !== id));
}

export function clearJournal() {
  write(JOURNAL_KEY, []);
}
