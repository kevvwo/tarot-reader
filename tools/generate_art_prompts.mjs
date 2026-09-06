#!/usr/bin/env node
/**
 * Generate one AI-image prompt per card, for redoing the deck art in a
 * chosen style. The subject for each prompt comes straight from the
 * corpus's own imagery description (Waite/De Laurence's "In the picture"
 * text) so the traditional RWS symbolism survives a style change — only
 * the rendering changes, not what each card depicts.
 *
 * Usage:
 *   node tools/generate_art_prompts.mjs > tools/art-prompts/van-gogh.md
 *   node tools/generate_art_prompts.mjs --style impressionist > ...
 *
 * Add new styles to the STYLES map below.
 */

import fs from 'node:fs';
import { trimTo } from '../app/js/reading.js';

const STYLES = {
  'van-gogh': {
    label: 'Van Gogh',
    block: [
      'Post-impressionist oil painting in the style of Vincent van Gogh:',
      'thick swirling impasto brushstrokes, visible canvas texture, bold',
      'saturated color (chrome yellow, cobalt blue, emerald green), rhythmic',
      'curling linework in the sky and background, warm dramatic lighting,',
      'expressive and emotionally intense.',
    ].join(' '),
  },
};

const COMPOSITION = [
  'Full-bleed illustration filling the entire frame edge to edge, portrait',
  'orientation (roughly 4:7, tarot card proportions), single clear focal',
  'subject centred in frame.',
  'No text, no lettering, no signature, no watermark, no border, no card frame —',
  'illustration only, the title and frame are added afterward.',
].join(' ');

function parseArgs(argv) {
  const args = { style: 'van-gogh' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--style') args.style = argv[i + 1];
  }
  return args;
}

function main() {
  const { style: styleKey } = parseArgs(process.argv.slice(2));
  const style = STYLES[styleKey];
  if (!style) {
    console.error(`Unknown style "${styleKey}". Known styles: ${Object.keys(STYLES).join(', ')}`);
    process.exit(1);
  }

  const corpus = JSON.parse(fs.readFileSync(new URL('../app/corpus.json', import.meta.url)));

  const out = [];
  out.push(`# Card art prompts — ${style.label} style`);
  out.push('');
  out.push(`Generated from \`app/corpus.json\` (${corpus.generated?.slice(0, 10) || 'unknown'}).`);
  out.push('One prompt per card — reversed cards reuse the same art, rotated in CSS.');
  out.push('');

  let currentGroup = null;
  for (const card of corpus.cards) {
    const group = card.arcana === 'major' ? 'Major Arcana' : capitalize(card.suit);
    if (group !== currentGroup) {
      out.push(`## ${group}`);
      out.push('');
      currentGroup = group;
    }

    const subject = trimTo(card.picture, 280) || card.name;
    const prompt = `${style.block} ${COMPOSITION} Subject: ${subject}`;

    out.push(`### ${card.name}`);
    out.push('');
    out.push('```');
    out.push(prompt);
    out.push('```');
    out.push('');
  }

  process.stdout.write(out.join('\n'));
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

main();
