// Headless check of the simulation: an auto-builder connects every house to a
// hub of its colour, then the game runs for several weeks. Run: node tests/sim.test.mjs
import { Game } from '../js/game.js';
import { LAND } from '../js/maps.js';

function autoConnect(g) {
  for (const h of g.houses) {
    const targets = new Set(g.dests.filter((d) => d.color === h.color).flatMap((d) => d.cells));
    if (g.findPath(h.cells[0], targets)) continue;
    // BFS over open land (and existing roads) from the house to a hub cell.
    const start = h.cells[0], prev = new Map([[start, -1]]), q = [start];
    let found = -1;
    while (q.length && found < 0) {
      const n = q.shift();
      const [x, y] = g.xy(n);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!g.inMap(nx, ny)) continue;
        const m = g.idx(nx, ny);
        if (prev.has(m) || !g.inBounds(m) || g.terrain[m] !== LAND || g.spanOf.has(m)) continue;
        if (targets.has(m)) { prev.set(m, n); found = m; break; }
        if (g.cellB[m] >= 0) continue;
        prev.set(m, n); q.push(m);
      }
    }
    if (found < 0) continue;
    const path = [];
    for (let p = found; p !== -1; p = prev.get(p)) path.push(p);
    path.reverse();
    for (let k = 0; k + 1 < path.length; k++) g.buildRoad(path[k], path[k + 1]);
  }
}

function invariants(g) {
  for (const [n, v] of g.nodeOcc) if (v <= 0) throw new Error('bad occupancy at ' + n);
  for (const d of g.dests) {
    if (d.assigned < 0 || d.assigned > d.pins) throw new Error(`hub ${d.id}: assigned ${d.assigned} > pins ${d.pins}`);
    const out = g.cars.filter((c) => c.state === 'out' && c.target === d).length;
    if (out !== d.assigned) throw new Error(`hub ${d.id}: ${out} cars out but ${d.assigned} assigned`);
  }
  for (const lane of g.lanes.values()) {
    if (!g.edges.has(lane.edge.a < lane.edge.b ? lane.edge.a + '|' + lane.edge.b : lane.edge.b + '|' + lane.edge.a)) throw new Error('lane on removed edge');
    for (let k = 1; k < lane.cars.length; k++)
      if (lane.cars[k].dist > lane.cars[k - 1].dist + 1e-6) throw new Error('lane out of order');
    for (const c of lane.cars) if (c.lane !== lane) throw new Error('car lane mismatch');
  }
  let road = 0;
  for (const [n, m] of g.adj) if (g.cellB[n] < 0 && m.size) road++;
  if (road !== g.roadCells) throw new Error(`roadCells ${g.roadCells} != ${road}`);
}

let failures = 0;
for (const mapId of ['meadow', 'delta', 'ridge', 'lakes']) {
  for (const portrait of [false, true]) {
    const g = new Game({ mode: 'creative', mapId, seed: 1234, portrait });
    g.on('upgrade', () => g.chooseUpgrade(0));
    const dt = 1 / 30;
    try {
      for (let t = 0; t < 8 * 60; t += dt) {
        if (Math.round(t / dt) % 30 === 0) autoConnect(g);
        // Occasionally rip out a road to exercise rerouting.
        if (Math.round(t / dt) % 900 === 450) {
          const roads = [...g.adj.keys()].filter((n) => g.isRoadCell(n));
          if (roads.length) g.eraseCell(roads[Math.floor(roads.length / 2)]);
        }
        g.step(dt);
        if (Math.round(t / dt) % 60 === 0) invariants(g);
      }
      invariants(g);
      const out = g.cars.filter((c) => c.state !== 'home').length;
      const line = `${mapId.padEnd(7)} ${portrait ? 'portrait ' : 'landscape'} journeys=${g.score} houses=${g.houses.length} hubs=${g.dests.length} cars-out=${out} roads=${g.roadCells} worst-demand=${Math.max(...g.dests.map((d) => d.pins))}`;
      if (g.score < 50) { failures++; console.log('FAIL ' + line); } else console.log('ok   ' + line);
    } catch (e) {
      failures++;
      console.log(`FAIL ${mapId} ${portrait}: ${e.stack}`);
    }
  }
}

// Budget and erase rules.
{
  const g = new Game({ mode: 'expert', mapId: 'meadow', seed: 7 });
  g.inv.roads = 3;
  const d = g.dests[0];
  const start = g.idx(d.x - 1, d.y);
  let built = 0, prev = start, x = d.x - 1;
  while (g.buildRoad(prev, g.idx(x - 1, d.y)).ok) { prev = g.idx(--x, d.y); built++; }
  if (g.roadCells !== g.inv.roads) { failures++; console.log(`FAIL budget: ${g.roadCells} cells, ${g.inv.roads} tiles`); }
  const before = g.inv.roads;
  g.eraseCell(prev);
  if (g.inv.roads !== before - 1) { failures++; console.log('FAIL expert erase should lose the tile'); }
  else console.log(`ok   budget: built ${built} cells with ${before} tiles; expert erase lost one`);
}

process.exit(failures ? 1 : 0);
