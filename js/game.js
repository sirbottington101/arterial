// Arterial: the simulation. No DOM here, so it runs in Node for tests.
import { mulberry32 } from './rng.js';
import { generateTerrain, LAND, WATER, MOUNTAIN } from './maps.js';

export const COLORS = ['#ff6b6b', '#2ec4b6', '#ffbe0b', '#b388ff', '#4cc9f0', '#9ee06b'];
export const COLOR_NAMES = ['coral', 'teal', 'amber', 'violet', 'sky', 'lime'];

export const MODES = {
  survival: {
    id: 'survival', name: 'Survival',
    blurb: 'Keep the city moving. A hub left overflowing too long ends the game.',
    startRoads: 30, overflowTime: 40, growth: 1, gameOver: true, unlimited: false, erasePenalty: false, upgrades: true,
  },
  endless: {
    id: 'endless', name: 'Endless',
    blurb: 'No overflow timers. Build and rebuild for as long as you like.',
    startRoads: 30, overflowTime: 40, growth: 1, gameOver: false, unlimited: false, erasePenalty: false, upgrades: true,
  },
  expert: {
    id: 'expert', name: 'Expert',
    blurb: 'Fewer tiles, faster growth, shorter timers, and every erased tile is lost for good.',
    startRoads: 20, overflowTime: 26, growth: 1.35, gameOver: true, unlimited: false, erasePenalty: true, upgrades: true,
  },
  creative: {
    id: 'creative', name: 'Creative',
    blurb: 'Unlimited roads and infrastructure. No timers, no pressure.',
    startRoads: 0, overflowTime: 40, growth: 1, gameOver: false, unlimited: true, erasePenalty: false, upgrades: false,
  },
};

export const WEEK = 60;            // seconds of game time per week
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const MAX_SPAN = 6;         // longest bridge or tunnel, in cells
export const MAX_PINS = 12;        // demand a hub can hold
export const OVER_AT = 8;          // demand at which the overflow timer runs
export const ROADS_PER_WEEK = 15;
export const DRIVE_LEFT = true;

const GAP = 0.55;                  // minimum distance between cars in a lane
const SPEED = 2.4;                 // cells per second on an ordinary road
const MOTORWAY_SPEED = 2.4;        // multiple of SPEED
const JUNCTIONS = {
  plain: { cap: 1, t: 0.45 },      // one car at a time through a busy junction
  roundabout: { cap: 3, t: 0.32 },
  lights: { cap: 3, t: 0.28 },     // but only for the direction that is green
};
const LIGHT_CYCLE = 7;

const ok = { ok: true };
const fail = (reason) => ({ ok: false, reason });
export const edgeKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(v, p) {
    const a = this.a; a.push([p, v]);
    let i = a.length - 1;
    while (i > 0) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
}

export class Game {
  constructor({ mode = 'survival', mapId = 'meadow', seed = 1, portrait = false } = {}) {
    this.mode = MODES[mode];
    this.mapId = mapId;
    this.seed = seed >>> 0;
    this.W = portrait ? 22 : 32;
    this.H = portrait ? 32 : 22;
    this.rng = mulberry32(this.seed ^ 0xa5a5a5);
    this.terrain = generateTerrain(mapId, this.W, this.H, this.seed);
    const N = this.W * this.H;
    this.cellB = new Int32Array(N).fill(-1);   // building id per cell
    this.spanOf = new Map();                   // bridge/tunnel interior cell -> edge key
    this.adj = new Map();                      // node -> Map(neighbour -> edge key)
    this.edges = new Map();                    // key -> {a, b, kind, len, speed, interior}
    this.features = new Map();                 // node -> 'roundabout' | 'lights'
    this.lanes = new Map();                    // 'a>b' -> {a, b, edge, cars}
    this.nodeOcc = new Map();                  // junction -> cars crossing it now
    this.roadCells = 0;
    this.buildings = [];
    this.cars = [];
    this.hasWater = this.terrain.includes(WATER);
    this.hasMountain = this.terrain.includes(MOUNTAIN);
    this.inv = {
      roads: this.mode.startRoads, motorway: 0, roundabout: 0, lights: 0,
      bridge: this.hasWater ? 2 : 0, tunnel: this.hasMountain ? 2 : 0,
    };
    if (this.mode.id === 'expert') { this.inv.bridge = Math.min(this.inv.bridge, 1); this.inv.tunnel = Math.min(this.inv.tunnel, 1); }
    const bw = portrait ? 8 : 12, bh = portrait ? 12 : 8;
    const x0 = Math.floor((this.W - bw) / 2), y0 = Math.floor((this.H - bh) / 2);
    this.bounds = { x0, y0, x1: x0 + bw, y1: y0 + bh };
    this.time = 0;
    this.score = 0;
    this.week = 1;
    this.nextWeek = WEEK;
    this.state = 'running';
    this.colorsUsed = 0;
    this.houseT = 5;
    this.destT = 35;
    this.dispatchT = 0;
    this.replanCursor = 0;
    this.choices = null;
    this.failed = null;
    this.listeners = {};
    this.graphVersion = 0;
    this.dt = 0;
    this.spawnDest(this.pickDestColor());
  }

  // ---------- events ----------
  on(name, fn) { (this.listeners[name] ||= []).push(fn); }
  emit(name, ...args) { for (const fn of this.listeners[name] || []) fn(...args); }

  // ---------- grid helpers ----------
  idx(x, y) { return y * this.W + x; }
  xy(i) { return [i % this.W, (i / this.W) | 0]; }
  inMap(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  inBounds(i) {
    const [x, y] = this.xy(i), b = this.bounds;
    return x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1;
  }
  deg(i) { const m = this.adj.get(i); return m ? m.size : 0; }
  isRoadCell(i) { return this.cellB[i] < 0 && this.deg(i) > 0; }
  isNode(i) { return i >= 0 && (this.cellB[i] >= 0 || this.deg(i) > 0); }
  canPlace(i) { return this.terrain[i] === LAND && this.cellB[i] < 0 && this.deg(i) === 0 && !this.spanOf.has(i); }
  building(i) { const b = this.cellB[i]; return b >= 0 ? this.buildings[b] : null; }
  get dests() { return this.buildings.filter((b) => b.kind === 'dest'); }
  get houses() { return this.buildings.filter((b) => b.kind === 'house'); }
  roadsLeft() { return this.mode.unlimited ? Infinity : this.inv.roads - this.roadCells; }
  has(item) { return this.mode.unlimited || this.inv[item] > 0; }
  take(item) { if (!this.mode.unlimited) this.inv[item]--; }
  give(item) { if (!this.mode.unlimited) this.inv[item]++; }

  newCellsNeeded(cells) {
    let n = 0;
    for (const c of new Set(cells)) if (this.cellB[c] < 0 && this.deg(c) === 0) n++;
    return n;
  }

  // ---------- graph edits ----------
  link(a, b, kind, len, speed, interior = []) {
    const key = edgeKey(a, b);
    for (const n of [a, b]) {
      if (this.deg(n) === 0) { this.adj.set(n, new Map()); if (this.cellB[n] < 0) this.roadCells++; }
    }
    this.adj.get(a).set(b, key);
    this.adj.get(b).set(a, key);
    this.edges.set(key, { a, b, kind, len, speed, interior });
    for (const c of interior) this.spanOf.set(c, key);
    return key;
  }

  removeEdge(key) {
    const e = this.edges.get(key);
    if (!e) return;
    for (const lk of [e.a + '>' + e.b, e.b + '>' + e.a]) {
      const lane = this.lanes.get(lk);
      if (lane) { for (const c of lane.cars.slice()) this.sendHome(c); this.lanes.delete(lk); }
    }
    this.edges.delete(key);
    for (const c of e.interior) this.spanOf.delete(c);
    if (e.kind !== 'road') this.give(e.kind);
    for (const [n, m] of [[e.a, e.b], [e.b, e.a]]) {
      const nb = this.adj.get(n);
      if (!nb) continue;
      nb.delete(m);
      if (nb.size === 0) {
        this.adj.delete(n);
        if (this.cellB[n] < 0) this.roadCells--;
        const f = this.features.get(n);
        if (f) { this.features.delete(n); this.give(f); }
      }
    }
  }

  changed() {
    this.graphVersion++;
    for (const c of this.cars) this.replanCar(c);
    this.emit('change');
  }

  // Road between two neighbouring cells (8 directions).
  buildRoad(a, b) {
    if (a === b) return ok;
    const [ax, ay] = this.xy(a), [bx, by] = this.xy(b);
    const dx = bx - ax, dy = by - ay;
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) return fail('Roads join neighbouring cells');
    if (!this.inBounds(a) || !this.inBounds(b)) return fail('Outside the city limits');
    if (this.terrain[a] !== LAND || this.terrain[b] !== LAND) return fail('Needs a bridge or tunnel');
    if (this.spanOf.has(a) || this.spanOf.has(b)) return fail('A bridge or tunnel is in the way');
    if (this.cellB[a] >= 0 && this.cellB[a] === this.cellB[b]) return ok;
    const key = edgeKey(a, b);
    if (this.edges.has(key)) return ok;
    if (dx && dy) {
      const c1 = this.idx(ax + dx, ay), c2 = this.idx(ax, ay + dy);
      if (this.terrain[c1] !== LAND && this.terrain[c2] !== LAND) return fail('Too tight to squeeze through');
      if (this.edges.has(edgeKey(c1, c2))) return fail('Roads cannot cross without a junction');
      if (this.cellB[c1] >= 0 && this.cellB[c1] === this.cellB[c2]) return fail('That cuts through a building');
    }
    if (this.newCellsNeeded([a, b]) > this.roadsLeft()) return fail('Out of road tiles');
    this.link(a, b, 'road', dx && dy ? Math.SQRT2 : 1, 1);
    this.changed();
    return ok;
  }

  spanCells(a, b) {
    const [ax, ay] = this.xy(a), [bx, by] = this.xy(b);
    const k = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
    const sx = Math.sign(bx - ax), sy = Math.sign(by - ay);
    if (k < 2 || bx - ax !== sx * k || by - ay !== sy * k) return null;
    const cells = [];
    for (let j = 1; j < k; j++) cells.push(this.idx(ax + sx * j, ay + sy * j));
    return cells;
  }

  // Bridge over water or tunnel through rock, in a straight line.
  buildSpan(a, b) {
    const interior = this.spanCells(a, b);
    if (!interior) return fail('Bridges and tunnels run in a straight line');
    if (interior.length > MAX_SPAN) return fail(`Too long: at most ${MAX_SPAN} cells`);
    if (this.terrain[a] !== LAND || this.terrain[b] !== LAND) return fail('Both ends need dry, open ground');
    if (this.spanOf.has(a) || this.spanOf.has(b)) return fail('Both ends need dry, open ground');
    if (![a, b, ...interior].every((c) => this.inBounds(c))) return fail('Outside the city limits');
    const type = this.terrain[interior[0]];
    if (type === LAND) return fail('Nothing to cross');
    if (!interior.every((c) => this.terrain[c] === type && !this.spanOf.has(c) && this.cellB[c] < 0))
      return fail('A crossing must span one kind of obstacle');
    const kind = type === WATER ? 'bridge' : 'tunnel';
    if (!this.has(kind)) return fail(kind === 'bridge' ? 'No bridges left' : 'No tunnels left');
    const key = edgeKey(a, b);
    if (this.edges.has(key)) return ok;
    if (this.newCellsNeeded([a, b]) > this.roadsLeft()) return fail('Out of road tiles');
    const [ax, ay] = this.xy(a), [bx, by] = this.xy(b);
    this.take(kind);
    this.link(a, b, kind, Math.hypot(bx - ax, by - ay), 1, interior);
    this.changed();
    return ok;
  }

  canMotorway(a, b) {
    if (a === b || a < 0 || b < 0) return fail('Drag from one road to another');
    if (!this.isNode(a) || !this.isNode(b)) return fail('Motorways join existing roads or buildings');
    if (!this.inBounds(a) || !this.inBounds(b)) return fail('Outside the city limits');
    const [ax, ay] = this.xy(a), [bx, by] = this.xy(b);
    if (Math.hypot(bx - ax, by - ay) < 3) return fail('Too short for a motorway');
    if (this.edges.has(edgeKey(a, b))) return fail('Already joined');
    if (!this.has('motorway')) return fail('No motorways left');
    return ok;
  }

  buildMotorway(a, b) {
    const r = this.canMotorway(a, b);
    if (!r.ok) return r;
    const [ax, ay] = this.xy(a), [bx, by] = this.xy(b);
    this.take('motorway');
    this.link(a, b, 'motorway', Math.hypot(bx - ax, by - ay), MOTORWAY_SPEED);
    this.changed();
    return ok;
  }

  toggleFeature(i, kind) {
    if (i < 0 || !this.isRoadCell(i)) return fail(kind === 'lights' ? 'Lights go on a road junction' : 'Roundabouts go on a road junction');
    const cur = this.features.get(i);
    if (cur === kind) { this.features.delete(i); this.give(kind); this.changed(); return ok; }
    if (cur) return fail('That junction already has ' + (cur === 'lights' ? 'traffic lights' : 'a roundabout'));
    if (!this.has(kind)) return fail(kind === 'lights' ? 'No traffic lights left' : 'No roundabouts left');
    this.take(kind);
    this.features.set(i, kind);
    this.changed();
    return ok;
  }

  // Remove everything built on a cell. Returns true if anything changed.
  eraseCell(i) {
    if (i < 0) return false;
    if (this.spanOf.has(i)) { this.removeEdge(this.spanOf.get(i)); this.changed(); return true; }
    const nb = this.adj.get(i);
    if (!nb) return false;
    const wasRoad = this.cellB[i] < 0;
    for (const key of [...nb.values()]) this.removeEdge(key);
    if (wasRoad && this.mode.erasePenalty) this.inv.roads = Math.max(0, this.inv.roads - 1);
    this.changed();
    return true;
  }

  // ---------- routing ----------
  edgeCost(e, laneKey, to) {
    const lane = this.lanes.get(laneKey);
    let w = e.len / e.speed + 0.45 * (lane ? lane.cars.length : 0);
    if (this.deg(to) >= 3 && !this.features.has(to)) w += 0.25;
    return w;
  }

  // Cheapest route from start to any of the target cells. Never passes
  // through a building on the way.
  findPath(start, targets) {
    if (targets.has(start)) return [start];
    const dist = new Map([[start, 0]]), prev = new Map(), heap = new Heap();
    heap.push(start, 0);
    while (heap.size) {
      const [d, n] = heap.pop();
      if (d > dist.get(n)) continue;
      if (targets.has(n)) {
        const path = [n];
        let p = n;
        while (prev.has(p)) { p = prev.get(p); path.push(p); }
        return path.reverse();
      }
      if (n !== start && this.cellB[n] >= 0) continue;
      const nb = this.adj.get(n);
      if (!nb) continue;
      for (const [m, key] of nb) {
        const nd = d + this.edgeCost(this.edges.get(key), n + '>' + m, m);
        if (nd < (dist.get(m) ?? Infinity)) { dist.set(m, nd); prev.set(m, n); heap.push(m, nd); }
      }
    }
    return null;
  }

  // Travel cost from every reachable node to the sources (cars drive toward them).
  distancesTo(sources) {
    const dist = new Map(), heap = new Heap();
    for (const s of sources) { dist.set(s, 0); heap.push(s, 0); }
    while (heap.size) {
      const [d, n] = heap.pop();
      if (d > dist.get(n)) continue;
      if (!sources.has(n) && this.cellB[n] >= 0) continue;
      const nb = this.adj.get(n);
      if (!nb) continue;
      for (const [m, key] of nb) {
        const nd = d + this.edgeCost(this.edges.get(key), m + '>' + n, n);
        if (nd < (dist.get(m) ?? Infinity)) { dist.set(m, nd); heap.push(m, nd); }
      }
    }
    return dist;
  }

  // ---------- spawning ----------
  pickDestColor() {
    const want = Math.min(COLORS.length, 2 + Math.floor(this.time / 150));
    if (this.colorsUsed < want) return this.colorsUsed;
    let best = 0, bestV = -1;
    for (let c = 0; c < this.colorsUsed; c++) {
      const d = this.dests.filter((b) => b.color === c).length || 1;
      const h = this.houses.filter((b) => b.color === c).length;
      const v = (h + 1) / d + this.rng() * 0.5;
      if (v > bestV) { bestV = v; best = c; }
    }
    return best;
  }

  pickHouseColor() {
    const w = [];
    let total = 0;
    for (let c = 0; c < this.colorsUsed; c++) {
      const d = this.dests.filter((b) => b.color === c).length;
      const h = this.houses.filter((b) => b.color === c).length;
      const v = (d * 3) / (h + 1);
      w.push(v); total += v;
    }
    let r = this.rng() * total;
    for (let c = 0; c < w.length; c++) { r -= w[c]; if (r <= 0) return c; }
    return 0;
  }

  rectDist(x, y, b) {
    const dx = Math.max(b.x - x, 0, x - (b.x + b.w - 1));
    const dy = Math.max(b.y - y, 0, y - (b.y + b.h - 1));
    return Math.max(dx, dy);
  }

  addBuilding(kind, color, x, y, w, h) {
    const b = { id: this.buildings.length, kind, color, x, y, w, h, cells: [], born: this.time };
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const c = this.idx(x + i, y + j); b.cells.push(c); this.cellB[c] = b.id; }
    this.buildings.push(b);
    return b;
  }

  spawnHouse(color, maxD = 8) {
    const dests = this.dests.filter((b) => b.color === color);
    if (!dests.length) return null;
    const houses = this.houses;
    const B = this.bounds;
    const cand = [], weight = [];
    let total = 0;
    for (let y = B.y0; y < B.y1; y++) for (let x = B.x0; x < B.x1; x++) {
      const i = this.idx(x, y);
      if (!this.canPlace(i)) continue;
      let open = 0;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + ox, ny = y + oy;
        if (!this.inMap(nx, ny)) continue;
        const j = this.idx(nx, ny);
        if (this.inBounds(j) && (this.canPlace(j) || this.isRoadCell(j))) open++;
      }
      if (open < 2) continue;
      let dmin = Infinity, tooClose = false;
      for (const d of this.dests) {
        const r = this.rectDist(x, y, d);
        if (r < 2) tooClose = true;
        if (d.color === color) dmin = Math.min(dmin, r);
      }
      if (tooClose || dmin > maxD) continue;
      let near = 0, other = 0;
      for (const h of houses) {
        const r = Math.max(Math.abs(h.x - x), Math.abs(h.y - y));
        if (r <= 2 && h.color === color) near++;
        if (r <= 1 && h.color !== color) other++;
      }
      let v = 1 + 2 * Math.min(near, 3) - (other ? 0.8 : 0);
      if (dmin <= 5) v *= 1.5;
      cand.push([x, y]); weight.push(v); total += v;
    }
    if (!cand.length) return maxD < 14 ? this.spawnHouse(color, maxD + 3) : null;
    let r = this.rng() * total, k = 0;
    while (k < cand.length - 1 && (r -= weight[k]) > 0) k++;
    const [x, y] = cand[k];
    const h = this.addBuilding('house', color, x, y, 1, 1);
    h.cars = [];
    for (let n = 0; n < 2; n++) {
      const car = { id: this.cars.length, house: h, color, state: 'home', path: null, i: 0, atNode: false, lane: null, dist: 0, wait: 0, crossNode: null, stuck: 0, target: null, parkT: 0, node: -1, lost: 0, moving: false };
      h.cars.push(car); this.cars.push(car);
    }
    this.emit('spawn', h);
    return h;
  }

  spawnDest(color, minGap = 6) {
    const B = this.bounds;
    const first = this.buildings.length === 0;
    const cx = (B.x0 + B.x1) / 2, cy = (B.y0 + B.y1) / 2;
    const cand = [];
    for (let y = B.y0 + 1; y < B.y1 - 2; y++) for (let x = B.x0 + 1; x < B.x1 - 2; x++) {
      const cells = [this.idx(x, y), this.idx(x + 1, y), this.idx(x, y + 1), this.idx(x + 1, y + 1)];
      if (!cells.every((c) => this.canPlace(c))) continue;
      let okSpot = true;
      for (const d of this.dests) if (Math.hypot(d.x - x, d.y - y) < minGap) { okSpot = false; break; }
      for (const h of this.houses) if (this.rectDist(h.x, h.y, { x, y, w: 2, h: 2 }) < 2) { okSpot = false; break; }
      if (!okSpot) continue;
      const score = first ? -Math.hypot(x + 1 - cx, y + 1 - cy) + this.rng() * 1.5 : this.rng();
      cand.push([score, x, y]);
    }
    if (!cand.length) return minGap > 4 ? this.spawnDest(color, minGap - 1) : null;
    cand.sort((p, q) => q[0] - p[0]);
    const [, x, y] = cand[0];
    const d = this.addBuilding('dest', color, x, y, 2, 2);
    if (color >= this.colorsUsed) this.colorsUsed = color + 1;
    d.pins = 0; d.assigned = 0; d.over = 0; d.pinT = 0.6; d.flash = 0;
    this.emit('spawn', d);
    for (let n = 0; n < 2; n++) this.spawnHouse(color);
    return d;
  }

  demandRate(d) {
    const minutes = this.time / 60;
    const interval = Math.max(3, 11 - minutes * 0.55) / this.mode.growth;
    const ds = this.dests.filter((b) => b.color === d.color).length || 1;
    const hs = this.houses.filter((b) => b.color === d.color).length;
    const factor = Math.min(1.5, Math.max(0.6, 0.5 + 0.15 * (hs / ds)));
    return factor / interval;
  }

  expandBounds() {
    const b = this.bounds;
    b.x0 = Math.max(0, b.x0 - 2); b.y0 = Math.max(0, b.y0 - 2);
    b.x1 = Math.min(this.W, b.x1 + 2); b.y1 = Math.min(this.H, b.y1 + 2);
  }

  makeChoices() {
    const pool = [
      { item: 'roads', n: 20, label: 'Road crew', desc: '+20 road tiles' },
      { item: 'motorway', n: 1, label: 'Motorway', desc: 'A fast link between any two roads' },
      { item: 'roundabout', n: 2, label: 'Roundabouts', desc: '2 roundabouts: busy junctions flow' },
      { item: 'lights', n: 2, label: 'Traffic lights', desc: '2 sets of lights: take turns, in bulk' },
    ];
    if (this.hasWater) pool.push({ item: 'bridge', n: 2, label: 'Bridges', desc: '2 bridges over water' });
    if (this.hasMountain) pool.push({ item: 'tunnel', n: 2, label: 'Tunnels', desc: '2 tunnels through rock' });
    const picks = [];
    while (picks.length < 2) {
      const p = pool[Math.floor(this.rng() * pool.length)];
      if (!picks.includes(p)) picks.push(p);
    }
    return picks;
  }

  chooseUpgrade(k) {
    const c = this.choices && this.choices[k];
    if (!c) return;
    this.inv[c.item] += c.n;
    this.choices = null;
    this.state = 'running';
    this.emit('change');
  }

  endWeek() {
    this.week++;
    this.nextWeek += WEEK;
    this.expandBounds();
    if (!this.mode.upgrades) { this.emit('week'); return; }
    this.inv.roads += ROADS_PER_WEEK;
    this.choices = this.makeChoices();
    this.state = 'upgrade';
    this.emit('upgrade', this.choices);
  }

  // ---------- simulation ----------
  lightPhase(n) {
    const t = (this.time + (n * 0.37) % LIGHT_CYCLE) % LIGHT_CYCLE, half = LIGHT_CYCLE / 2;
    if (t < half - 0.5) return 0;
    if (t < half) return -1;
    if (t < LIGHT_CYCLE - 0.5) return 1;
    return -1;
  }

  // Returns null (no control), false (must wait) or the junction spec.
  junctionSpec(n, from) {
    if (this.cellB[n] >= 0) return null;
    const f = this.features.get(n);
    if (!f && this.deg(n) < 3) return null;
    const spec = JUNCTIONS[f || 'plain'];
    if (f === 'lights') {
      const [nx, ny] = this.xy(n), [fx, fy] = this.xy(from);
      const axis = Math.abs(nx - fx) >= Math.abs(ny - fy) ? 0 : 1;
      if (this.lightPhase(n) !== axis) return false;
    }
    return (this.nodeOcc.get(n) || 0) < spec.cap ? spec : false;
  }

  getLane(a, b) {
    const k = a + '>' + b;
    let l = this.lanes.get(k);
    if (!l) { l = { a, b, edge: this.edges.get(edgeKey(a, b)), cars: [] }; this.lanes.set(k, l); }
    return l;
  }

  releaseNode(c) {
    if (c.crossNode == null) return;
    const v = (this.nodeOcc.get(c.crossNode) || 1) - 1;
    if (v > 0) this.nodeOcc.set(c.crossNode, v); else this.nodeOcc.delete(c.crossNode);
    c.crossNode = null;
    c.wait = 0;
  }

  leaveLane(c) {
    if (!c.lane) return;
    const arr = c.lane.cars, k = arr.indexOf(c);
    if (k >= 0) arr.splice(k, 1);
    c.lane = null;
  }

  sendHome(c) {
    this.leaveLane(c);
    this.releaseNode(c);
    if (c.state === 'out' && c.target) c.target.assigned = Math.max(0, c.target.assigned - 1);
    c.state = 'home'; c.path = null; c.atNode = false; c.target = null; c.stuck = 0;
  }

  replanCar(c) {
    if (c.state !== 'out' && c.state !== 'back') return;
    const homeSet = () => new Set(c.house.cells);
    const targets = c.state === 'out' ? new Set(c.target.cells) : homeSet();
    if (c.atNode) {
      const n = c.path[c.i];
      const p = this.findPath(n, targets);
      if (p) { c.path = p; c.i = 0; return; }
      if (c.state === 'out') {
        if (this.cellB[n] === c.house.id) { this.sendHome(c); return; }
        c.target.assigned = Math.max(0, c.target.assigned - 1);
        c.state = 'back'; c.target = null;
        const q = this.findPath(n, homeSet());
        if (q) { c.path = q; c.i = 0; return; }
      }
      if (this.cellB[n] >= 0) { c.atNode = false; c.state = 'park'; c.parkT = 1; c.node = n; return; }
      this.sendHome(c);
      return;
    }
    if (!c.lane) return;
    const head = c.path[c.i], next = c.path[c.i + 1];
    let tail = this.findPath(next, targets);
    if (!tail && c.state === 'out') {
      c.target.assigned = Math.max(0, c.target.assigned - 1);
      c.state = 'back'; c.target = null;
      tail = this.findPath(next, homeSet());
    }
    if (!tail) { this.sendHome(c); return; }
    c.path = [head, ...tail];
    c.i = 0;
  }

  dispatch() {
    const dests = this.dests.filter((d) => d.pins - d.assigned > 0)
      .sort((p, q) => (q.pins - q.assigned) - (p.pins - p.assigned));
    for (const d of dests) {
      let need = d.pins - d.assigned;
      const homes = this.houses.filter((h) => h.color === d.color && h.cars.some((c) => c.state === 'home'));
      if (!homes.length) continue;
      const targets = new Set(d.cells);
      const dist = this.distancesTo(targets);
      const reach = homes.filter((h) => dist.has(h.cells[0])).sort((p, q) => dist.get(p.cells[0]) - dist.get(q.cells[0]));
      for (const h of reach) {
        if (need <= 0) break;
        for (const c of h.cars) {
          if (need <= 0 || c.state !== 'home') continue;
          const path = this.findPath(h.cells[0], targets);
          if (!path) break;
          c.state = 'out'; c.target = d; c.path = path; c.i = 0; c.atNode = true; c.stuck = 0;
          d.assigned++; need--;
        }
      }
    }
  }

  // Move car c from node path[i] onto the lane path[i] > path[i+1].
  tryEnter(c, i, from) {
    const n = c.path[i], m = c.path[i + 1];
    if (m === undefined) { this.arrive(c); return true; }
    if (!this.edges.has(edgeKey(n, m))) { this.replanCar(c); return false; }
    const lane = this.getLane(n, m);
    const last = lane.cars[lane.cars.length - 1];
    if (last && last !== c && last.dist < GAP && c.stuck < 12) { c.stuck += this.dt; return false; }
    let spec = null;
    if (from != null) {
      spec = this.junctionSpec(n, from);
      if (spec === false) { c.stuck += this.dt; return false; }
    }
    this.leaveLane(c);
    this.releaseNode(c);
    c.lane = lane; c.dist = 0; c.i = i; c.atNode = false; c.stuck = 0;
    lane.cars.push(c);
    if (spec) { c.wait = spec.t; c.crossNode = n; this.nodeOcc.set(n, (this.nodeOcc.get(n) || 0) + 1); }
    return true;
  }

  arrive(c) {
    const node = c.path[c.path.length - 1];
    this.leaveLane(c);
    this.releaseNode(c);
    c.atNode = false; c.node = node; c.stuck = 0;
    if (c.state === 'out') {
      const d = c.target;
      d.pins = Math.max(0, d.pins - 1);
      d.assigned = Math.max(0, d.assigned - 1);
      d.flash = 1;
      this.score++;
      this.emit('delivered', d);
      c.state = 'park'; c.parkT = 0.9; c.lost = 0; c.target = null;
    } else {
      c.state = 'home'; c.path = null;
    }
  }

  leavePark(c) {
    const p = this.findPath(c.node, new Set(c.house.cells));
    if (p) { c.state = 'back'; c.path = p; c.i = 0; c.atNode = true; return; }
    c.parkT = 1; c.lost++;
    if (c.lost > 8) this.sendHome(c);
  }

  moveCars(dt) {
    for (const lane of this.lanes.values()) {
      if (!lane.cars.length) continue;
      const len = lane.edge.len, step = SPEED * lane.edge.speed * dt;
      let ahead = null;
      for (const c of lane.cars.slice()) {
        if (c.lane !== lane) continue;
        c.moving = false;
        if (c.wait > 0) {
          c.wait -= dt;
          if (c.wait <= 0) this.releaseNode(c);
          ahead = c;
          continue;
        }
        const limit = ahead ? ahead.dist - GAP : len;
        if (c.dist < limit) { c.dist = Math.min(limit, c.dist + step); c.moving = true; }
        if (!ahead && c.dist >= len - 1e-6) {
          const i = c.i + 1;
          const done = i === c.path.length - 1 ? (this.arrive(c), true) : this.tryEnter(c, i, c.path[c.i]);
          if (done) continue;
        }
        ahead = c;
      }
    }
    for (const c of this.cars) {
      if (c.state === 'park') { c.parkT -= dt; if (c.parkT <= 0) this.leavePark(c); }
      else if (c.atNode && (c.state === 'out' || c.state === 'back')) this.tryEnter(c, c.i, null);
    }
    // Reroute a few cars each tick so traffic spreads onto quieter roads.
    const moving = this.cars.length;
    for (let k = 0; k < 3 && moving; k++) {
      this.replanCursor = (this.replanCursor + 1) % moving;
      const c = this.cars[this.replanCursor];
      if (c.lane && c.wait <= 0 && c.dist < c.lane.edge.len * 0.6) this.replanCar(c);
    }
  }

  step(dt) {
    if (this.state !== 'running') return;
    this.dt = dt;
    this.time += dt;
    const minutes = this.time / 60, g = this.mode.growth;

    this.houseT -= dt * g;
    if (this.houseT <= 0) {
      const c = this.pickHouseColor();
      const hs = this.houses.filter((b) => b.color === c).length;
      const ds = this.dests.filter((b) => b.color === c).length;
      if (hs < ds * 7) this.spawnHouse(c);
      this.houseT = Math.max(4.5, 10 - minutes * 0.45) * (0.7 + this.rng() * 0.6);
    }
    this.destT -= dt * g;
    if (this.destT <= 0) {
      const placed = this.spawnDest(this.pickDestColor());
      this.destT = placed ? Math.max(40, 70 - minutes * 2) * (0.8 + this.rng() * 0.4) : 5;
    }

    for (const d of this.dests) {
      d.pinT -= dt * this.demandRate(d);
      if (d.pinT <= 0) { d.pinT += 1; if (d.pins < MAX_PINS) d.pins++; }
      if (this.mode.gameOver) {
        if (d.pins >= OVER_AT) d.over += dt; else d.over = Math.max(0, d.over - dt * 0.6);
        if (d.over >= this.mode.overflowTime) { this.state = 'over'; this.failed = d; this.emit('over', d); return; }
      }
    }

    this.dispatchT -= dt;
    if (this.dispatchT <= 0) { this.dispatch(); this.dispatchT = 0.4; }
    this.moveCars(dt);

    if (this.time >= this.nextWeek) this.endWeek();
  }

  get dayName() { return DAYS[Math.min(6, Math.floor(((this.time % WEEK) / WEEK) * 7))]; }
  get weekProgress() { return (this.time % WEEK) / WEEK; }
}
