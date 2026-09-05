/** Shuffling and drawing. */

/** Fisher-Yates, using the crypto RNG so the shuffle isn't Math.random-flat. */
export function shuffle(items) {
  const out = items.slice();
  const rand = (n) => {
    if (globalThis.crypto?.getRandomValues) {
      // Rejection-sample to keep the distribution uniform.
      const limit = Math.floor(0xffffffff / n) * n;
      const buf = new Uint32Array(1);
      let v;
      do { crypto.getRandomValues(buf); v = buf[0]; } while (v >= limit);
      return v % n;
    }
    return Math.floor(Math.random() * n);
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Draw `count` distinct cards.
 * Each is flipped independently, the way cards land when a shuffled deck is
 * cut and dealt, so reversal is per-card rather than a property of the pile.
 */
export function draw(cards, count, allowReversed = true) {
  const picked = shuffle(cards).slice(0, count);
  return picked.map((card) => ({
    id: card.id,
    reversed: allowReversed ? Math.random() < 0.5 : false,
  }));
}
