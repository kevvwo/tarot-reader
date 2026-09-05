#!/usr/bin/env node
/**
 * Download the 1909 Rider-Waite-Smith scans from Wikimedia Commons and write
 * them into app/cards/ as WebP, one file per corpus card id.
 *
 * The source is Commons category "Rider-Waite tarot deck (Roses & Lilies)" —
 * the first edition, William Rider & Son 1909, drawn by Pamela Colman Smith.
 * Public domain: published 1909, and Smith died in 1951. The later US Games
 * recolouring is *not* public domain, so this deliberately takes the 1909
 * scans and nothing else.
 *
 * Filenames in that category are perfectly regular, which is why this can map
 * them onto card ids without a hand-written table:
 *
 *   RWS1909 - 00 Fool.jpeg      -> major, number 0     -> the-fool
 *   RWS1909 - Cups 01.jpeg      -> cups, rank 1        -> ace-of-cups
 *   RWS1909 - Pentacles 13.jpeg -> pentacles, rank 13  -> queen-of-pentacles
 *
 * Originals are cached in .cards-src/, so re-tuning the output size or quality
 * costs nothing — only the first run talks to Commons.
 *
 *   node tools/fetch_cards.mjs [--width 560] [--quality 80] [--force]
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'app', 'cards');
const TMP = path.join(ROOT, '.cards-src');

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
// What we ask Commons for. Generous enough to re-encode from without going
// back to the network, small enough not to pull 8 MP scans 78 times over.
const SRC_WIDTH = 800;
// What actually ships. The largest a card is ever drawn is ~190 CSS px, so
// this is still over 2x on a 3x phone screen.
const WIDTH = Number(argOf('--width', 560));
const QUALITY = Number(argOf('--quality', 80));
const FORCE = args.includes('--force');

const CATEGORY = 'Category:Rider-Waite tarot deck (Roses & Lilies)';
const API = 'https://commons.wikimedia.org/w/api.php';
// Wikimedia asks every client to identify itself and refuses generic agents.
const UA = 'TarotReader/1.0 (personal offline tarot app; card-art fetch script)';

/** The card back: the Roses & Lilies pattern this edition is named for. */
const BACK_FILE = 'Waite–Smith Tarot Roses and Lilies cropped.jpg';

async function listCategory() {
  const url = new URL(API);
  url.search = new URLSearchParams({
    action: 'query',
    list: 'categorymembers',
    cmtitle: CATEGORY,
    cmtype: 'file',
    cmlimit: '500',
    format: 'json',
  });
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`Commons category listing failed (${res.status})`);
  const data = await res.json();
  // Titles arrive as "File:RWS1909 - 00 Fool.jpeg".
  return data.query.categorymembers.map((m) => m.title.replace(/^File:/, ''));
}

/**
 * Build filename -> card id from the corpus itself, so a card the corpus does
 * not know about is reported rather than silently written to a stray path.
 */
function buildIndex(cards) {
  const byNumber = new Map();
  const bySuitRank = new Map();
  for (const card of cards) {
    if (card.arcana === 'major') byNumber.set(card.number, card.id);
    else bySuitRank.set(`${card.suit}:${card.rank}`, card.id);
  }
  return (file) => {
    const major = file.match(/^RWS1909 - (\d{2}) .+\.jpe?g$/i);
    if (major) return byNumber.get(Number(major[1]));
    const minor = file.match(/^RWS1909 - (Cups|Wands|Swords|Pentacles) (\d{2})\.jpe?g$/i);
    if (minor) return bySuitRank.get(`${minor[1].toLowerCase()}:${Number(minor[2])}`);
    return undefined;
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve files to CDN thumbnail URLs, 50 at a time.
 *
 * Special:FilePath?width= works but is served by the thumbnailer, which
 * rate-limits a run of 79 requests almost immediately. Asking the API for
 * `thumburl` instead hands back upload.wikimedia.org URLs — the same images
 * from the CDN, which does not throttle a job this size.
 */
async function thumbUrls(files) {
  const out = new Map();
  for (let i = 0; i < files.length; i += 50) {
    const batch = files.slice(i, i + 50);
    const url = new URL(API);
    url.search = new URLSearchParams({
      action: 'query',
      prop: 'imageinfo',
      iiprop: 'url',
      iiurlwidth: String(SRC_WIDTH),
      titles: batch.map((f) => `File:${f}`).join('|'),
      format: 'json',
    });
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    if (!res.ok) throw new Error(`imageinfo lookup failed (${res.status})`);
    const data = await res.json();
    for (const page of Object.values(data.query.pages)) {
      const info = page.imageinfo?.[0];
      // thumburl is absent when the file is already narrower than the request.
      if (info) out.set(page.title.replace(/^File:/, ''), info.thumburl || info.url);
    }
  }
  return out;
}

/**
 * Fetch one scan, waiting out a rate limit rather than giving up on it.
 *
 * Wikimedia answers a burst from a datacenter IP with 429 and `retry-after:
 * 600`, so honouring that header is the only thing that gets a run of 79 files
 * through. Originals are cached, so an interrupted run resumes where it left
 * off instead of starting over.
 */
async function download(url, dest, label) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    if (res.ok) {
      await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
      return;
    }
    if (res.status !== 429 && res.status !== 503) {
      throw new Error(`${label}: download failed (${res.status})`);
    }
    const wait = Math.min(Number(res.headers.get('retry-after')) || 60, 900);
    process.stdout.write(`\r  rate-limited, waiting ${wait}s`.padEnd(46));
    await sleep(wait * 1000);
  }
  throw new Error(`${label}: still rate-limited after 8 attempts`);
}

async function toWebp(src, dest) {
  // -resize W 0 keeps the aspect ratio; the scans are already close to WIDTH,
  // so this mostly just guards against an oversized original.
  await run('cwebp', ['-quiet', '-q', String(QUALITY), '-resize', String(WIDTH), '0',
    '-metadata', 'none', src, '-o', dest]);
}

async function main() {
  const corpus = JSON.parse(await fs.readFile(path.join(ROOT, 'app', 'corpus.json'), 'utf8'));
  const idFor = buildIndex(corpus.cards);

  await fs.mkdir(OUT, { recursive: true });
  await fs.mkdir(TMP, { recursive: true });

  const files = await listCategory();
  const jobs = [];
  for (const file of files) {
    const id = idFor(file);
    if (id) jobs.push({ file, id });
  }
  if (files.includes(BACK_FILE)) jobs.push({ file: BACK_FILE, id: '_back' });

  const seen = new Set(jobs.filter((j) => j.id !== '_back').map((j) => j.id));
  const missing = corpus.cards.filter((c) => !seen.has(c.id)).map((c) => c.id);
  if (missing.length) {
    throw new Error(`no Commons file matched: ${missing.join(', ')}`);
  }

  // Work out which originals are still missing before asking for any URLs.
  const needed = [];
  for (const { file, id } of jobs) {
    const src = path.join(TMP, file.replace(/[^\w.-]/g, '_'));
    if (FORCE) { needed.push(file); continue; }
    try {
      if ((await fs.stat(src)).size === 0) needed.push(file);
    } catch { needed.push(file); }
  }
  const urls = needed.length ? await thumbUrls(needed) : new Map();

  let done = 0;
  let fetched = 0;
  for (const { file, id } of jobs) {
    const src = path.join(TMP, file.replace(/[^\w.-]/g, '_'));

    if (urls.has(file)) {
      await download(urls.get(file), src, file);
      fetched++;
      // Deliberately unhurried: a tight loop is what earns the 429.
      await sleep(1200);
    }

    // Always re-encode: it is local and cheap, so --width and --quality take
    // effect without another trip to Commons.
    await toWebp(src, path.join(OUT, `${id}.webp`));
    done++;
    process.stdout.write(`\r  ${done}/${jobs.length}  ${id}`.padEnd(46));
  }

  const written = await fs.readdir(OUT);
  const bytes = (await Promise.all(written.map(async (f) => (await fs.stat(path.join(OUT, f))).size)))
    .reduce((a, b) => a + b, 0);

  console.log(`\n  ${written.length} files in app/cards/ `
    + `at ${WIDTH}px q${QUALITY} (${(bytes / 1e6).toFixed(1)} MB)`);
  console.log(`  ${fetched} downloaded, ${jobs.length - fetched} re-encoded from .cards-src/`);
  console.log('  source: Rider-Waite-Smith, 1909, via Wikimedia Commons (public domain)');
}

main().catch((err) => {
  console.error(`\n  ${err.message}`);
  process.exit(1);
});
