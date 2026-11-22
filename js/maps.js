import { mulberry32 } from './rng.js';

export const LAND = 0;
export const WATER = 1;
export const MOUNTAIN = 2;

export const MAPS = [
  { id: 'meadow', name: 'Meadowfield', blurb: 'Open farmland with a few ponds. A gentle start.' },
  { id: 'delta', name: 'Saltmarsh Delta', blurb: 'A winding river and its creek split the land. Bridges are precious.' },
  { id: 'ridge', name: 'Ironback Ridge', blurb: 'Two mountain ridges cut the valley. Tunnel through or find the pass.' },
  { id: 'lakes', name: 'Glasswater', blurb: 'Scattered lakes and rocky outcrops. Water and stone at once.' },
];

// Builds the terrain grid for a map. Obstacles are kept away from the centre,
// where the city starts.
export function generateTerrain(mapId, W, H, seed) {
  const rnd = mulberry32((seed * 7 + 13) >>> 0);
  const t = new Uint8Array(W * H);
  const cx = W / 2, cy = H / 2;
  const inMap = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const set = (x, y, v) => { if (inMap(x, y)) t[y * W + x] = v; };
  const get = (x, y) => (inMap(x, y) ? t[y * W + x] : -1);

  // Rivers and ridges run along the map's long axis or across it.
  const long = W >= H;
  const L = long ? W : H, S = long ? H : W;
  const put = (q, p, v) => (long ? set(q, p, v) : set(p, q, v));
  const at = (q, p) => (long ? get(q, p) : get(p, q));

  const blob = (bx, by, r, v) => {
    for (let y = Math.floor(by - r - 1); y <= Math.ceil(by + r + 1); y++)
      for (let x = Math.floor(bx - r - 1); x <= Math.ceil(bx + r + 1); x++)
        if (Math.hypot(x + 0.5 - bx, y + 0.5 - by) <= r + (rnd() - 0.5) * 0.8) set(x, y, v);
  };
  const awayFromCentre = (minD) => {
    for (let k = 0; k < 300; k++) {
      const x = 1 + rnd() * (W - 2), y = 1 + rnd() * (H - 2);
      if (Math.hypot(x - cx, y - cy) >= minD) return [x, y];
    }
    return [2, 2];
  };
  const side = () => (rnd() < 0.5 ? 0.24 + rnd() * 0.08 : 0.68 + rnd() * 0.08);

  if (mapId === 'meadow') {
    for (let k = 0; k < 3; k++) { const [x, y] = awayFromCentre(6); blob(x, y, 1 + rnd() * 0.9, WATER); }
    const [x, y] = awayFromCentre(8); blob(x, y, 1 + rnd() * 0.6, MOUNTAIN);
  }

  if (mapId === 'delta') {
    // Main river along the long axis, off-centre.
    let p = Math.floor(S * side());
    let wide = rnd() < 0.5;
    for (let q = 0; q < L; q++) {
      if (rnd() < 0.08) wide = !wide;
      const np = Math.max(1, Math.min(S - 3, p + (rnd() < 0.35 ? (rnd() < 0.5 ? -1 : 1) : 0)));
      for (let k = Math.min(p, np); k <= Math.max(p, np); k++) { put(q, k, WATER); if (wide) put(q, k + 1, WATER); }
      p = np;
    }
    // A creek from the far edge that runs until it meets the river.
    const riverLow = p < S / 2;
    let q = Math.floor(L * (rnd() < 0.5 ? 0.22 + rnd() * 0.1 : 0.68 + rnd() * 0.1));
    const dir = riverLow ? -1 : 1;
    for (let pp = riverLow ? S - 1 : 0; pp >= 0 && pp < S; pp += dir) {
      if (at(q, pp) === WATER) break;
      const nq = Math.max(1, Math.min(L - 2, q + (rnd() < 0.3 ? (rnd() < 0.5 ? -1 : 1) : 0)));
      for (let k = Math.min(q, nq); k <= Math.max(q, nq); k++) put(k, pp, WATER);
      q = nq;
    }
  }

  if (mapId === 'ridge') {
    for (const frac of [0.25 + rnd() * 0.06, 0.69 + rnd() * 0.06]) {
      let q = Math.floor(L * frac);
      const passAt = Math.floor(S * (0.3 + rnd() * 0.4));
      const passLen = 2 + Math.floor(rnd() * 2);
      for (let p = 0; p < S; p++) {
        const nq = Math.max(1, Math.min(L - 3, q + (rnd() < 0.3 ? (rnd() < 0.5 ? -1 : 1) : 0)));
        if (p < passAt || p >= passAt + passLen)
          for (let k = Math.min(q, nq); k <= Math.max(q, nq) + 1; k++) put(k, p, MOUNTAIN);
        q = nq;
      }
    }
    for (let k = 0; k < 3; k++) { const [x, y] = awayFromCentre(6); blob(x, y, 0.9 + rnd() * 0.8, MOUNTAIN); }
    const [x, y] = awayFromCentre(7); blob(x, y, 1.2, WATER);
  }

  if (mapId === 'lakes') {
    for (let k = 0; k < 5; k++) { const [x, y] = awayFromCentre(6); blob(x, y, 1.4 + rnd() * 1.6, WATER); }
    for (let k = 0; k < 2; k++) { const [x, y] = awayFromCentre(6); blob(x, y, 1.1 + rnd() * 0.9, MOUNTAIN); }
  }

  // Keep the starting area clear.
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < 2.6) t[y * W + x] = LAND;
  return t;
}
