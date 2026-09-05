#!/usr/bin/env node
/**
 * Generate the app icons with no image dependencies.
 *
 * macOS here has only `sips`, which cannot rasterize SVG, so the PNGs are
 * drawn pixel by pixel and encoded directly (zlib is in Node's stdlib).
 *
 *   node tools/make_icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'app', 'icons');

/* ── minimal PNG encoder ─────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** rgba: Uint8Array of size w*h*4 */
function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  // One filter byte (0 = None) in front of every scanline.
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    const src = y * w * 4;
    const dst = y * (w * 4 + 1);
    raw[dst] = 0;
    Buffer.from(rgba.buffer, src, w * 4).copy(raw, dst + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── the icon itself ─────────────────────────────────────────────────────── */

const GOLD = [216, 178, 92];
const STARS = [
  [0.24, 0.22, 0.020], [0.78, 0.28, 0.016], [0.19, 0.72, 0.014],
  [0.82, 0.70, 0.019], [0.66, 0.13, 0.012],
];

/**
 * Coverage of the icon's shapes at a point, in 0..1.
 * `full` fills the whole square (for maskable icons, where the launcher
 * applies its own mask and a rounded corner here would be clipped twice).
 */
function sample(u, v, full) {
  // Rounded-square background.
  let bg = 1;
  if (!full) {
    const r = 0.22;
    const dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0);
    const dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
    bg = Math.hypot(dx, dy) <= r ? 1 : 0;
  }
  if (!bg) return { bg: 0, gold: 0 };

  // Crescent: a disc with a second disc cut out of it.
  const inner = full ? 0.30 : 0.26;
  const d1 = Math.hypot(u - 0.5, v - 0.5);
  const d2 = Math.hypot(u - 0.63, v - 0.44);
  let gold = (d1 <= inner && d2 > inner * 0.95) ? 1 : 0;

  // A thin ring, and a scatter of stars.
  const ringR = full ? 0.42 : 0.38;
  if (Math.abs(d1 - ringR) < 0.006) gold = Math.max(gold, 0.55);
  for (const [sx, sy, sr] of STARS) {
    if (Math.hypot(u - sx, v - sy) < sr) gold = Math.max(gold, 0.8);
  }

  return { bg, gold };
}

function render(size, full = false) {
  const rgba = new Uint8Array(size * size * 4);
  const SS = 3; // supersample factor, for smooth edges

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgAcc = 0, goldAcc = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          const s = sample(u, v, full);
          bgAcc += s.bg;
          goldAcc += s.gold * s.bg;
        }
      }
      const n = SS * SS;
      const bg = bgAcc / n;
      const gold = goldAcc / n;

      // Vertical gradient for the ground, so the icon has some depth.
      const t = y / size;
      const base = [
        Math.round(18 + 12 * (1 - t)),
        Math.round(20 + 14 * (1 - t)),
        Math.round(38 + 18 * (1 - t)),
      ];

      const i = (y * size + x) * 4;
      rgba[i] = Math.round(base[0] * (1 - gold) + GOLD[0] * gold);
      rgba[i + 1] = Math.round(base[1] * (1 - gold) + GOLD[1] * gold);
      rgba[i + 2] = Math.round(base[2] * (1 - gold) + GOLD[2] * gold);
      rgba[i + 3] = Math.round(bg * 255);
    }
  }
  return encodePng(rgba, size, size);
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#1e2238"/><stop offset="1" stop-color="#0f1120"/>
  </linearGradient></defs>
  <rect width="100" height="100" rx="22" fill="url(#g)"/>
  <circle cx="50" cy="50" r="38" fill="none" stroke="#d8b25c" stroke-width="0.7" opacity=".55"/>
  <path d="M50 24a26 26 0 1 0 0 52 20 20 0 1 1 0-52Z" fill="#d8b25c"/>
  <circle cx="24" cy="22" r="2" fill="#d8b25c"/>
  <circle cx="78" cy="28" r="1.6" fill="#d8b25c" opacity=".85"/>
  <circle cx="19" cy="72" r="1.4" fill="#d8b25c" opacity=".8"/>
  <circle cx="82" cy="70" r="1.9" fill="#d8b25c" opacity=".9"/>
</svg>`;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'icon.svg'), SVG);
for (const size of [180, 192, 512]) {
  fs.writeFileSync(path.join(OUT, `icon-${size}.png`), render(size));
}
fs.writeFileSync(path.join(OUT, 'icon-maskable-512.png'), render(512, true));

for (const f of fs.readdirSync(OUT).sort()) {
  console.log(`  ${f}  ${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1)} KB`);
}
