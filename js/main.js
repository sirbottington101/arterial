import { Game, MODES, COLORS, COLOR_NAMES } from './game.js';
import { MAPS, LAND, WATER, MOUNTAIN, generateTerrain } from './maps.js';
import { Renderer, PALETTE } from './render.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#cv');
const R = new Renderer(canvas);

const ICONS = {
  road: '<path d="M7 21 11 3M17 21 13 3" /><path d="M12 7v2M12 12v2M12 17v2" />',
  erase: '<path d="M4 15 13 6l6 6-7 7H8z" /><path d="M9 19h11" />',
  motorway: '<path d="M3 18C8 6 16 6 21 18" /><path d="M7 18c3-7 7-7 10 0" opacity=".5" />',
  roundabout: '<circle cx="12" cy="12" r="5" /><path d="M12 2v5M12 17v5M2 12h5M17 12h5" />',
  lights: '<rect x="8" y="3" width="8" height="18" rx="3" /><circle cx="12" cy="8" r="1.4" /><circle cx="12" cy="13" r="1.4" /><circle cx="12" cy="18" r="0" />',
  bridge: '<path d="M2 16h20M4 16c2-6 14-6 16 0" /><path d="M8 16v-3M16 16v-3M12 16v-4" />',
  tunnel: '<path d="M3 20h18M6 20v-6a6 6 0 0 1 12 0v6" /><path d="M9 20v-5a3 3 0 0 1 6 0v5" opacity=".5" />',
};
const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;

const TOOLS = [
  { id: 'road', label: 'Road', key: '1', item: 'roads' },
  { id: 'erase', label: 'Erase', key: '2' },
  { id: 'motorway', label: 'Motorway', key: '3', item: 'motorway' },
  { id: 'roundabout', label: 'Roundabout', key: '4', item: 'roundabout' },
  { id: 'lights', label: 'Lights', key: '5', item: 'lights' },
];

let game = null;
let tool = 'road';
let paused = false;
let speed = 1;
const ui = { preview: null, hover: -1, hoverTool: false };
const sel = JSON.parse(localStorage.getItem('arterial.sel') || '{"map":"meadow","mode":"survival"}');

// ---------- best scores ----------
const bestKey = (m, mo) => `${m}:${mo}`;
const bests = () => JSON.parse(localStorage.getItem('arterial.best') || '{}');
function saveBest(g) {
  const b = bests(), k = bestKey(g.mapId, g.mode.id);
  const isNew = g.score > (b[k] || 0);
  if (isNew) { b[k] = g.score; localStorage.setItem('arterial.best', JSON.stringify(b)); }
  return isNew;
}

// ---------- menu ----------
function miniMap(mapId) {
  const W = 32, H = 22, t = generateTerrain(mapId, W, H, 4242);
  const c = document.createElement('canvas');
  c.width = W * 4; c.height = H * 4;
  const x = c.getContext('2d');
  x.fillStyle = PALETTE.land; x.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < W * H; i++) {
    if (t[i] === LAND) continue;
    x.fillStyle = t[i] === WATER ? '#1d5578' : '#3c4454';
    x.fillRect((i % W) * 4, ((i / W) | 0) * 4, 4, 4);
  }
  return c;
}

function buildMenu() {
  const maps = $('#maps');
  maps.innerHTML = '';
  for (const m of MAPS) {
    const b = document.createElement('button');
    b.className = 'card map' + (sel.map === m.id ? ' on' : '');
    b.append(miniMap(m.id));
    const best = bests()[bestKey(m.id, sel.mode)];
    b.insertAdjacentHTML('beforeend', `<b>${m.name}</b><span>${m.blurb}</span>${best ? `<em>Best ${best}</em>` : ''}`);
    b.onclick = () => { sel.map = m.id; persistSel(); buildMenu(); };
    maps.append(b);
  }
  const modes = $('#modes');
  modes.innerHTML = '';
  for (const m of Object.values(MODES)) {
    const b = document.createElement('button');
    b.className = 'card mode' + (sel.mode === m.id ? ' on' : '');
    b.innerHTML = `<b>${m.name}</b><span>${m.blurb}</span>`;
    b.onclick = () => { sel.mode = m.id; persistSel(); buildMenu(); };
    modes.append(b);
  }
}
function persistSel() { localStorage.setItem('arterial.sel', JSON.stringify(sel)); }

function show(id, on) { $(id).classList.toggle('hidden', !on); }

function startGame() {
  const portrait = window.innerHeight > window.innerWidth * 1.05;
  game = new Game({ mode: sel.mode, mapId: sel.map, seed: (Math.random() * 2 ** 32) >>> 0, portrait });
  game.on('upgrade', showUpgrade);
  game.on('over', showOver);
  R.fit = null; R.resetView();
  paused = false; speed = 1; tool = 'road';
  ui.preview = null; ui.hover = -1;
  show('#menu', false); show('#over', false); show('#upgrade', false); show('#pausemenu', false);
  show('#hud', true);
  buildToolbar();
  updateHud(true);
  toast(game.mode.id === 'creative' ? 'Creative: build freely' : 'Drag from a house to its matching hub');
}

function toMenu() {
  if (game && (game.mode.id === 'endless' || game.mode.id === 'creative') && game.score) saveBest(game);
  game = null;
  show('#hud', false); show('#over', false); show('#upgrade', false); show('#pausemenu', false);
  show('#menu', true);
  buildMenu();
}

// ---------- HUD ----------
function buildToolbar() {
  const bar = $('#toolbar');
  bar.innerHTML = '';
  for (const t of TOOLS) {
    const b = document.createElement('button');
    b.className = 'tool';
    b.dataset.tool = t.id;
    b.title = `${t.label} (${t.key})`;
    b.innerHTML = `${icon(t.id)}<span class="lbl">${t.label}</span>${t.item ? '<i class="n"></i>' : ''}`;
    b.onclick = () => setTool(t.id);
    bar.append(b);
  }
  for (const k of ['bridge', 'tunnel']) {
    if ((k === 'bridge' && !game.hasWater) || (k === 'tunnel' && !game.hasMountain)) continue;
    const b = document.createElement('div');
    b.className = 'tool passive';
    b.dataset.item = k;
    b.title = k === 'bridge' ? 'Bridges: draw a road straight across water' : 'Tunnels: draw a road straight through rock';
    b.innerHTML = `${icon(k)}<span class="lbl">${k === 'bridge' ? 'Bridges' : 'Tunnels'}</span><i class="n"></i>`;
    bar.append(b);
  }
  setTool(tool);
}

function setTool(t) {
  tool = t;
  for (const b of document.querySelectorAll('.tool[data-tool]')) b.classList.toggle('on', b.dataset.tool === t);
  ui.hoverTool = t === 'roundabout' || t === 'lights';
}

let hudT = 0;
function fmt(n) { return n === Infinity ? '∞' : String(Math.max(0, n)); }
function updateHud(force) {
  if (!game) return;
  hudT -= 1;
  if (!force && hudT > 0) return;
  hudT = 6;
  $('#score').textContent = game.score;
  $('#week').textContent = 'Week ' + game.week;
  $('#day').textContent = game.dayName;
  $('#weekfill').style.width = (game.weekProgress * 100).toFixed(1) + '%';
  const counts = {
    roads: game.roadsLeft(), motorway: game.mode.unlimited ? Infinity : game.inv.motorway,
    roundabout: game.mode.unlimited ? Infinity : game.inv.roundabout, lights: game.mode.unlimited ? Infinity : game.inv.lights,
    bridge: game.mode.unlimited ? Infinity : game.inv.bridge, tunnel: game.mode.unlimited ? Infinity : game.inv.tunnel,
  };
  for (const b of document.querySelectorAll('#toolbar .tool')) {
    const item = b.dataset.item || TOOLS.find((t) => t.id === b.dataset.tool)?.item;
    if (!item) continue;
    b.querySelector('.n').textContent = fmt(counts[item]);
    b.classList.toggle('empty', counts[item] <= 0);
  }
  $('#btn-pause').innerHTML = paused ? '&#9654;' : '&#10073;&#10073;';
  $('#btn-pause').classList.toggle('on', paused);
  $('#btn-speed').textContent = speed + '×';
  $('#btn-fit').classList.toggle('hidden', R.zoom <= 1.01);
  $('#paused-tag').classList.toggle('hidden', !paused);
}

let toastTimer = 0;
function toast(msg) {
  if (!msg) return;
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

// ---------- modals ----------
function showUpgrade(choices) {
  $('#up-week').textContent = `Week ${game.week}`;
  $('#up-sub').textContent = `The city limits grow. +15 road tiles arrive. Choose one more:`;
  const box = $('#up-cards');
  box.innerHTML = '';
  choices.forEach((c, k) => {
    const b = document.createElement('button');
    b.className = 'card upgrade';
    const ic = c.item === 'roads' ? 'road' : c.item;
    b.innerHTML = `${icon(ic)}<b>${c.label}</b><span>${c.desc}</span>`;
    b.onclick = () => { game.chooseUpgrade(k); show('#upgrade', false); updateHud(true); };
    box.append(b);
  });
  show('#upgrade', true);
}

function showOver(d) {
  const isNew = saveBest(game);
  $('#over-title').textContent = `Gridlock at the ${COLOR_NAMES[d.color]} hub`;
  $('#over-title').style.color = COLORS[d.color];
  $('#over-score').textContent = game.score;
  $('#over-best').textContent = isNew ? 'New best!' : `Best: ${bests()[bestKey(game.mapId, game.mode.id)] || 0}`;
  $('#over-sub').textContent = `${MAPS.find((m) => m.id === game.mapId).name} · ${game.mode.name} · week ${game.week}`;
  setTimeout(() => game && game.state === 'over' && show('#over', true), 1400);
}

// ---------- input ----------
const pointers = new Map();
let gesture = null;
let stroke = null;

const xy = (i) => game.xy(i);
const sign = Math.sign;

function lineCells(a, b) {
  let [x, y] = xy(a);
  const [tx, ty] = xy(b), out = [];
  while ((x !== tx || y !== ty) && out.length < 200) {
    const dx = tx - x, dy = ty - y;
    if (Math.abs(dx) > 2 * Math.abs(dy)) x += sign(dx);
    else if (Math.abs(dy) > 2 * Math.abs(dx)) y += sign(dy);
    else { x += sign(dx); y += sign(dy); }
    out.push(game.idx(x, y));
  }
  return out;
}

// The cell under the pointer, but only once the pointer is near its centre,
// so dragging corner to corner makes a clean diagonal.
function strokeCell(px, py) {
  const [wx, wy] = R.toWorld(px, py);
  const x = Math.floor(wx), y = Math.floor(wy);
  if (!game.inMap(x, y)) return -1;
  const i = game.idx(x, y);
  if (stroke && stroke.last >= 0) {
    const [lx, ly] = xy(stroke.last);
    const far = Math.max(Math.abs(lx - x), Math.abs(ly - y)) > 1;
    if (!far && Math.hypot(wx - x - 0.5, wy - y - 0.5) > 0.46) return stroke.last;
  }
  return i;
}

function beginStroke(e, kind) {
  const c = R.cellAt(game, e.clientX, e.clientY);
  stroke = { kind, last: -1, pending: null, x0: e.clientX, y0: e.clientY, dead: false, cell: c };
  if (kind === 'road') { if (c >= 0 && game.terrain[c] === LAND) stroke.last = c; }
  else if (kind === 'erase') { if (game.eraseCell(c)) {} stroke.last = c; }
  else if (kind === 'motorway') {
    if (c >= 0 && game.isNode(c)) { stroke.a = c; ui.preview = { type: 'motor', a: c, pt: R.toWorld(e.clientX, e.clientY), ok: false }; }
    else { toast('Start a motorway on a road or building'); stroke = null; }
  } else if (kind === 'pan') { stroke.px = e.clientX; stroke.py = e.clientY; }
}

function moveStroke(e) {
  if (!stroke) return;
  const k = stroke.kind;
  if (k === 'pan') { R.pan.x -= (e.clientX - stroke.px) / R.s; R.pan.y -= (e.clientY - stroke.py) / R.s; stroke.px = e.clientX; stroke.py = e.clientY; R.layout(game); return; }
  if (k === 'road') { const c = strokeCell(e.clientX, e.clientY); if (c >= 0) roadTo(c); return; }
  const c = R.cellAt(game, e.clientX, e.clientY);
  if (c < 0) return;
  if (k === 'erase') {
    if (c === stroke.last) return;
    for (const n of stroke.last >= 0 ? lineCells(stroke.last, c) : [c]) game.eraseCell(n);
    stroke.last = c;
  } else if (k === 'motorway') {
    ui.preview.pt = R.toWorld(e.clientX, e.clientY);
    ui.preview.ok = game.canMotorway(stroke.a, c).ok;
  } else { ui.hover = c; stroke.cell = c; }
}

function endStroke(e) {
  if (!stroke) return;
  const c = R.cellAt(game, e.clientX, e.clientY);
  if (stroke.kind === 'motorway') {
    const r = game.buildMotorway(stroke.a, c);
    if (!r.ok && c !== stroke.a) toast(r.reason);
  } else if (stroke.kind === 'roundabout' || stroke.kind === 'lights') {
    const r = game.toggleFeature(c, stroke.kind);
    if (!r.ok) toast(r.reason);
  }
  stroke = null;
  ui.preview = null;
}

function roadTo(c) {
  if (stroke.dead) return;
  if (stroke.pending) { handlePending(c); return; }
  if (stroke.last < 0) { if (game.terrain[c] === LAND) stroke.last = c; return; }
  if (c === stroke.last) return;
  for (const n of lineCells(stroke.last, c)) {
    if (!stepTo(n) || stroke.pending) break;
  }
}

function stepTo(n) {
  const t = game.terrain[n];
  if (t === LAND) {
    const r = game.buildRoad(stroke.last, n);
    if (r.ok) { stroke.last = n; return true; }
    toast(r.reason);
    if (r.reason === 'Out of road tiles' || r.reason === 'Outside the city limits') stroke.dead = true;
    return false;
  }
  const [lx, ly] = xy(stroke.last), [nx, ny] = xy(n);
  const kind = t === WATER ? 'bridge' : 'tunnel';
  stroke.pending = { from: stroke.last, dx: sign(nx - lx), dy: sign(ny - ly), kind };
  ui.preview = { type: 'span', from: stroke.last, dx: stroke.pending.dx, dy: stroke.pending.dy, len: 1, kind };
  return false;
}

function handlePending(c) {
  const p = stroke.pending;
  if (c === p.from) return;
  const [fx, fy] = xy(p.from), [cx, cy] = xy(c);
  const ddx = cx - fx, ddy = cy - fy, k = Math.max(Math.abs(ddx), Math.abs(ddy));
  if (ddx === p.dx * k && ddy === p.dy * k) {
    ui.preview.len = k;
    if (game.terrain[c] === LAND) {
      const r = game.buildSpan(p.from, c);
      stroke.pending = null; ui.preview = null;
      if (r.ok) stroke.last = c;
      else { toast(r.reason); stroke.dead = true; }
    }
    return;
  }
  stroke.pending = null; ui.preview = null;
  stroke.last = p.from;
  roadTo(c);
}

function pinchState() {
  const [a, b] = [...pointers.values()];
  return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
}

canvas.addEventListener('pointerdown', (e) => {
  if (!game) return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    stroke = null; ui.preview = null;
    const s = pinchState();
    gesture = { ...s, zoom: R.zoom, w: R.toWorld(s.mx, s.my) };
    return;
  }
  if (pointers.size > 2 || game.state === 'over') return;
  if (e.button === 1) { beginStroke(e, 'pan'); return; }
  beginStroke(e, e.button === 2 ? 'erase' : tool);
});
canvas.addEventListener('pointermove', (e) => {
  if (!game) return;
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gesture && pointers.size >= 2) {
    const s = pinchState();
    R.setView(game, gesture.zoom * (s.d / gesture.d), gesture.w[0], gesture.w[1], s.mx, s.my);
    return;
  }
  if (stroke) moveStroke(e);
  else if (ui.hoverTool && e.pointerType === 'mouse') ui.hover = R.cellAt(game, e.clientX, e.clientY);
});
const up = (e) => {
  pointers.delete(e.pointerId);
  if (gesture) { if (pointers.size < 2) gesture = null; return; }
  if (game && stroke) endStroke(e);
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); gesture = null; stroke = null; ui.preview = null; });
canvas.addEventListener('pointerleave', () => { if (!stroke) ui.hover = -1; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  if (!game) return;
  e.preventDefault();
  R.zoomAt(game, e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (!game) return;
  const t = TOOLS.find((x) => x.key === e.key);
  if (t) setTool(t.id);
  else if (e.key === ' ') { togglePause(); e.preventDefault(); }
  else if (e.key === 'f') R.resetView();
  else if (e.key === 'Escape') openPauseMenu();
});

function togglePause() { paused = !paused; updateHud(true); }
function openPauseMenu() {
  if (!game || game.state === 'over') return;
  paused = true; updateHud(true);
  show('#pausemenu', true);
}

$('#btn-pause').onclick = togglePause;
$('#btn-speed').onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 3 : 1; updateHud(true); };
$('#btn-fit').onclick = () => { R.resetView(); updateHud(true); };
$('#btn-menu').onclick = openPauseMenu;
$('#btn-play').onclick = startGame;
$('#pm-resume').onclick = () => { show('#pausemenu', false); paused = false; updateHud(true); };
$('#pm-restart').onclick = startGame;
$('#pm-quit').onclick = toMenu;
$('#over-retry').onclick = startGame;
$('#over-menu').onclick = toMenu;
$('#btn-help').onclick = () => show('#help', true);
$('#help-close').onclick = () => show('#help', false);

document.addEventListener('visibilitychange', () => { if (document.hidden && game && game.state === 'running') { paused = true; updateHud(true); } });
window.addEventListener('resize', () => { R.resize(); updateHud(true); });

// ---------- loop ----------
let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game) {
    if (!paused && game.state === 'running') {
      acc += dt * speed;
      const h = 1 / 60;
      let n = 0;
      while (acc >= h && n < 12) { game.step(h); acc -= h; n++; }
      if (n >= 12) acc = 0;
    }
    R.update(game, dt);
    R.draw(game, ui, dt);
    updateHud();
  } else {
    const ctx = R.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(frame);
}

buildMenu();
requestAnimationFrame(frame);
window.arterial = { get game() { return game; }, R, startGame, setTool, sel, toMenu };

if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !location.hostname.match(/^(localhost|127\.)/)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
