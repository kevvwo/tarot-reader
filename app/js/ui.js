/** Small DOM and text helpers. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * A deliberately small Markdown subset for model output.
 *
 * Everything is HTML-escaped first and only known patterns are re-introduced,
 * so generated text can never inject markup.
 */
export function renderMarkdown(md) {
  const source = String(md || '').replace(/\r\n/g, '\n').trim();
  if (!source) return '';

  const blocks = source.split(/\n{2,}/);
  const html = [];

  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;

    const heading = block.match(/^(#{1,6})\s+(.*)$/s);
    if (heading && !heading[2].includes('\n')) {
      const level = Math.min(heading[1].length + 2, 5); // ## -> h4 in our scale
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const lines = block.split('\n');
    if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l))) {
      const ordered = /^\s*\d+\./.test(lines[0]);
      const items = lines
        .map((l) => `<li>${inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ''))}</li>`)
        .join('');
      html.push(ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`);
      continue;
    }

    if (lines.every((l) => /^\s*>/.test(l))) {
      html.push(`<blockquote>${inline(lines.map((l) => l.replace(/^\s*>\s?/, '')).join(' '))}</blockquote>`);
      continue;
    }

    html.push(`<p>${inline(block.replace(/\n/g, ' '))}</p>`);
  }

  return html.join('\n');
}

function inline(text) {
  return escapeHtml(text)
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*(?!\s)([^*]+?)\*(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_(?!\s)([^_]+?)_(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/** Render source text that uses blank lines and "- " bullets. */
export function renderProse(text) {
  const source = String(text || '').trim();
  if (!source) return '';
  return source.split(/\n{2,}/).map((block) => {
    const trimmed = block.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('- ')) {
      return `<ul><li>${escapeHtml(trimmed.slice(2).replace(/\n/g, ' '))}</li></ul>`;
    }
    return `<p>${escapeHtml(trimmed.replace(/\n/g, ' '))}</p>`;
  }).join('');
}

export function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    + ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** A short haptic tick where the platform supports it. */
export function tick(ms = 8) {
  try { navigator.vibrate?.(ms); } catch { /* not supported */ }
}
