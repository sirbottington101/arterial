// Draws the game onto a canvas. World units are cells; cell (x, y) spans
// [x, x+1) and its centre is (x+0.5, y+0.5).
import { COLORS, MAX_PINS, OVER_AT, DRIVE_LEFT } from './game.js';
import { LAND, WATER, MOUNTAIN } from './maps.js';
import { hash2 } from './rng.js';

export const PALETTE = {
  bg: '#0a1017', landOut: '#0e151d', land: '#141d27', dot: '#223040',
  water: '#123247', waterOut: '#0d2030', wave: '#1f4c68',
  rock: '#242a35', rockOut: '#151a22', rockGlyph: '#3a4252', rockGlyphOut: '#222833',
  road: '#4a5a6e', rail: '#8ea3b8', motor: '#f2b134', border: '#2b3d52',
};
const P = PALETTE;

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.fit = null;
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.insets = { top: 72, bottom: 100, left: 14, right: 14 };
    this.s = 30; this.ox = 0; this.oy = 0;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.dpr = dpr;
    this.vw = window.innerWidth;
    this.vh = window.innerHeight;
    this.cv.width = Math.round(this.vw * dpr);
    this.cv.height = Math.round(this.vh * dpr);
    this.cv.style.width = this.vw + 'px';
    this.cv.style.height = this.vh + 'px';
  }

  area() {
    const I = this.insets;
    return { aw: Math.max(60, this.vw - I.left - I.right), ah: Math.max(60, this.vh - I.top - I.bottom) };
  }

  targetFit(g) {
    const b = g.bounds, { aw, ah } = this.area();
    const bw = b.x1 - b.x0 + 0.6, bh = b.y1 - b.y0 + 0.6;
    return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, s: Math.min(aw / bw, ah / bh) };
  }

  update(g, dt) {
    const t = this.targetFit(g);
    if (!this.fit) this.fit = { ...t };
    else {
      const k = 1 - Math.exp(-dt * 3.5);
      this.fit.x += (t.x - this.fit.x) * k;
      this.fit.y += (t.y - this.fit.y) * k;
      this.fit.s += (t.s - this.fit.s) * k;
    }
    this.layout(g);
  }

  layout(g) {
    const I = this.insets, { aw, ah } = this.area();
    this.s = this.fit.s * this.zoom;
    if (this.zoom <= 1.0001) { this.pan.x = 0; this.pan.y = 0; }
    else if (g) {
      this.pan.x = Math.max(-g.W / 2, Math.min(g.W / 2, this.pan.x));
      this.pan.y = Math.max(-g.H / 2, Math.min(g.H / 2, this.pan.y));
    }
    const cx = this.fit.x + this.pan.x, cy = this.fit.y + this.pan.y;
    this.ox = I.left + aw / 2 - cx * this.s;
    this.oy = I.top + ah / 2 - cy * this.s;
  }

  toWorld(px, py) { return [(px - this.ox) / this.s, (py - this.oy) / this.s]; }

  cellAt(g, px, py) {
    const [wx, wy] = this.toWorld(px, py);
    const x = Math.floor(wx), y = Math.floor(wy);
    return g.inMap(x, y) ? g.idx(x, y) : -1;
  }

  // Zoom so that world point (wx, wy) sits under screen point (px, py).
  setView(g, zoom, wx, wy, px, py) {
    if (!this.fit) return;
    const I = this.insets, { aw, ah } = this.area();
    this.zoom = Math.max(1, Math.min(5, zoom));
    const s = this.fit.s * this.zoom;
    const ox = px - wx * s, oy = py - wy * s;
    this.pan.x = (I.left + aw / 2 - ox) / s - this.fit.x;
    this.pan.y = (I.top + ah / 2 - oy) / s - this.fit.y;
    this.layout(g);
  }

  zoomAt(g, px, py, factor) {
    const [wx, wy] = this.toWorld(px, py);
    this.setView(g, this.zoom * factor, wx, wy, px, py);
  }

  resetView() { this.zoom = 1; this.pan = { x: 0, y: 0 }; }

  center(g, i) { return [(i % g.W) + 0.5, ((i / g.W) | 0) + 0.5]; }

  carPose(g, c) {
    const l = c.lane;
    const [ax, ay] = this.center(g, l.a), [bx, by] = this.center(g, l.b);
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    const t = Math.min(1, c.dist / l.edge.len);
    const ux = dx / L, uy = dy / L, off = l.edge.kind === 'motorway' ? 0.11 : 0.14;
    const side = DRIVE_LEFT ? 1 : -1;
    return { x: ax + dx * t + uy * off * side, y: ay + dy * t - ux * off * side, ang: Math.atan2(dy, dx) };
  }

  draw(g, ui, dt) {
    const ctx = this.ctx, dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = P.bg;
    ctx.fillRect(0, 0, this.vw, this.vh);
    ctx.setTransform(dpr * this.s, 0, 0, dpr * this.s, dpr * this.ox, dpr * this.oy);
    this.lw = 1 / this.s; // one screen pixel, in cells

    this.drawTerrain(g);
    this.drawRoads(g);
    this.drawPreview(g, ui);
    this.drawBuildings(g, dt);
    this.drawCars(g);
    this.drawAlerts(g);
    if (ui.hover >= 0 && ui.hoverTool) this.drawHover(g, ui);
  }

  drawTerrain(g) {
    const ctx = this.ctx, b = g.bounds, W = g.W, H = g.H;
    ctx.fillStyle = P.landOut;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = P.land;
    ctx.beginPath();
    ctx.roundRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 0.35);
    ctx.fill();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = g.terrain[y * W + x];
      if (t === LAND) continue;
      const inb = x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1;
      if (t === WATER) {
        ctx.fillStyle = inb ? P.water : P.waterOut;
        ctx.fillRect(x - 0.01, y - 0.01, 1.02, 1.02);
        const h = hash2(x, y);
        if (h < 0.4) {
          ctx.strokeStyle = P.wave; ctx.lineWidth = 0.06;
          const wx = x + 0.25 + h * 0.6, wy = y + 0.35 + hash2(y, x) * 0.4;
          ctx.beginPath(); ctx.moveTo(wx - 0.18, wy);
          ctx.quadraticCurveTo(wx - 0.09, wy - 0.09, wx, wy); ctx.quadraticCurveTo(wx + 0.09, wy + 0.09, wx + 0.18, wy);
          ctx.stroke();
        }
      } else if (t === MOUNTAIN) {
        ctx.fillStyle = inb ? P.rock : P.rockOut;
        ctx.fillRect(x - 0.01, y - 0.01, 1.02, 1.02);
        ctx.fillStyle = inb ? P.rockGlyph : P.rockGlyphOut;
        const h = hash2(x, y), s = 0.5 + h * 0.25, px = x + 0.5 + (h - 0.5) * 0.3;
        ctx.beginPath();
        ctx.moveTo(px - s / 2, y + 0.78); ctx.lineTo(px, y + 0.78 - s * 0.95); ctx.lineTo(px + s / 2, y + 0.78);
        ctx.fill();
      }
    }
    // dot grid on open ground
    ctx.fillStyle = P.dot;
    for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) {
      const i = y * W + x;
      if (g.terrain[i] === LAND && g.cellB[i] < 0 && !g.adj.has(i)) ctx.fillRect(x + 0.46, y + 0.46, 0.08, 0.08);
    }
    ctx.strokeStyle = P.border; ctx.lineWidth = Math.max(0.04, this.lw * 1.5);
    ctx.setLineDash([0.25, 0.2]);
    ctx.beginPath(); ctx.roundRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 0.35); ctx.stroke();
    ctx.setLineDash([]);
  }

  drawRoads(g) {
    const ctx = this.ctx;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const ground = new Path2D(), rails = new Path2D(), tunnels = new Path2D(), portals = [];
    const motors = [];
    for (const e of g.edges.values()) {
      const [ax, ay] = this.center(g, e.a), [bx, by] = this.center(g, e.b);
      if (e.kind === 'road') { ground.moveTo(ax, ay); ground.lineTo(bx, by); }
      else if (e.kind === 'bridge') {
        rails.moveTo(ax, ay); rails.lineTo(bx, by);
        ground.moveTo(ax, ay); ground.lineTo(bx, by);
      } else if (e.kind === 'tunnel') {
        const L = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / L, uy = (by - ay) / L;
        ground.moveTo(ax, ay); ground.lineTo(ax + ux * 0.6, ay + uy * 0.6);
        ground.moveTo(bx, by); ground.lineTo(bx - ux * 0.6, by - uy * 0.6);
        tunnels.moveTo(ax + ux * 0.6, ay + uy * 0.6); tunnels.lineTo(bx - ux * 0.6, by - uy * 0.6);
        portals.push([ax + ux * 0.62, ay + uy * 0.62, ux, uy], [bx - ux * 0.62, by - uy * 0.62, ux, uy]);
      } else motors.push([ax, ay, bx, by]);
    }
    ctx.strokeStyle = P.rail; ctx.lineWidth = 0.8; ctx.stroke(rails);
    ctx.strokeStyle = P.road; ctx.lineWidth = 0.56; ctx.stroke(ground);
    ctx.setLineDash([0.18, 0.16]); ctx.strokeStyle = '#5e6a7c'; ctx.lineWidth = 0.14; ctx.stroke(tunnels); ctx.setLineDash([]);
    ctx.strokeStyle = '#05080c'; ctx.lineWidth = 0.18; ctx.lineCap = 'butt';
    for (const [px, py, ux, uy] of portals) {
      ctx.beginPath(); ctx.moveTo(px - uy * 0.38, py + ux * 0.38); ctx.lineTo(px + uy * 0.38, py - ux * 0.38); ctx.stroke();
    }
    ctx.lineCap = 'round';

    for (const [n, f] of g.features) {
      const [x, y] = this.center(g, n);
      if (f === 'roundabout') {
        ctx.fillStyle = P.road; ctx.beginPath(); ctx.arc(x, y, 0.48, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = P.land; ctx.beginPath(); ctx.arc(x, y, 0.2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#7f93a9'; ctx.lineWidth = 0.04; ctx.setLineDash([0.12, 0.1]);
        ctx.beginPath(); ctx.arc(x, y, 0.34, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      } else {
        const ph = g.lightPhase(n);
        ctx.fillStyle = '#05080c'; ctx.beginPath(); ctx.arc(x, y, 0.24, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 0.09;
        ctx.strokeStyle = ph === 0 ? '#5dff9a' : '#ff5a5a';
        ctx.beginPath(); ctx.moveTo(x - 0.15, y); ctx.lineTo(x + 0.15, y); ctx.stroke();
        ctx.strokeStyle = ph === 1 ? '#5dff9a' : '#ff5a5a';
        ctx.beginPath(); ctx.moveTo(x, y - 0.15); ctx.lineTo(x, y + 0.15); ctx.stroke();
      }
    }

    for (const [ax, ay, bx, by] of motors) {
      ctx.strokeStyle = 'rgba(5,8,12,0.75)'; ctx.lineWidth = 0.66;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.strokeStyle = P.motor; ctx.lineWidth = 0.44; ctx.stroke();
      ctx.strokeStyle = 'rgba(10,16,23,0.55)'; ctx.lineWidth = 0.05; ctx.setLineDash([0.2, 0.18]); ctx.stroke(); ctx.setLineDash([]);
      for (const [x, y] of [[ax, ay], [bx, by]]) { ctx.fillStyle = P.motor; ctx.beginPath(); ctx.arc(x, y, 0.3, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  drawBuildings(g, dt) {
    const ctx = this.ctx;
    for (const b of g.buildings) {
      const col = COLORS[b.color];
      const age = g.time - b.born;
      const pop = Math.min(1, age / 0.35), sc = pop < 1 ? 0.6 + 0.4 * (1 - Math.pow(1 - pop, 3)) + Math.sin(pop * Math.PI) * 0.12 : 1;
      if (age < 2.5) { // attention ring for new arrivals
        const r = (b.kind === 'dest' ? 1.3 : 0.5) + age * 0.9;
        ctx.strokeStyle = col; ctx.globalAlpha = Math.max(0, 0.6 * (1 - age / 2.5)); ctx.lineWidth = 0.06;
        ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y + b.h / 2, r, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.save();
      ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
      ctx.scale(sc, sc);
      if (b.kind === 'house') {
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, 0.32, 0, Math.PI * 2); ctx.fill();
        const home = b.cars.filter((c) => c.state === 'home').length;
        ctx.fillStyle = 'rgba(10,16,23,0.8)';
        for (let k = 0; k < home; k++) { ctx.beginPath(); ctx.arc((k - (home - 1) / 2) * 0.2, 0, 0.065, 0, Math.PI * 2); ctx.fill(); }
      } else {
        if (b.flash > 0) {
          b.flash = Math.max(0, b.flash - dt * 2.5);
          ctx.fillStyle = col; ctx.globalAlpha = b.flash * 0.35;
          ctx.beginPath(); ctx.roundRect(-1.0, -1.0, 2.0, 2.0, 0.4); ctx.fill(); ctx.globalAlpha = 1;
        }
        ctx.fillStyle = P.bg; ctx.beginPath(); ctx.roundRect(-0.9, -0.9, 1.8, 1.8, 0.32); ctx.fill();
        ctx.fillStyle = col; ctx.globalAlpha = 0.16; ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = col; ctx.lineWidth = 0.09; ctx.stroke();
        for (let k = 0; k < MAX_PINS; k++) {
          const cx = -0.54 + (k % 4) * 0.36, cy = -0.42 + Math.floor(k / 4) * 0.42;
          ctx.fillStyle = col;
          ctx.globalAlpha = k < b.pins ? 1 : 0.13;
          ctx.beginPath(); ctx.arc(cx, cy, k < b.pins ? 0.11 : 0.07, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }

  drawCars(g) {
    const ctx = this.ctx;
    for (const c of g.cars) {
      if (!c.lane) continue;
      const p = this.carPose(g, c);
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.ang);
      ctx.fillStyle = COLORS[c.color];
      ctx.beginPath(); ctx.roundRect(-0.19, -0.105, 0.38, 0.21, 0.07); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(0.1, -0.075, 0.05, 0.15);
      if (!c.moving) { ctx.fillStyle = '#ff3b3b'; ctx.fillRect(-0.19, -0.09, 0.05, 0.05); ctx.fillRect(-0.19, 0.04, 0.05, 0.05); }
      ctx.restore();
    }
  }

  drawAlerts(g) {
    const ctx = this.ctx;
    for (const d of g.dests) {
      if (d.over <= 0 && g.failed !== d) continue;
      const p = g.failed === d ? 1 : d.over / g.mode.overflowTime;
      const cx = d.x + 1, cy = d.y + 1;
      const pulse = 0.65 + 0.35 * Math.sin(performance.now() / (p > 0.6 ? 110 : 220));
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,77,77,0.18)'; ctx.lineWidth = 0.16;
      ctx.beginPath(); ctx.arc(cx, cy, 1.3, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = `rgba(255,77,77,${pulse})`;
      ctx.beginPath(); ctx.arc(cx, cy, 1.3, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); ctx.stroke();
      if (g.failed === d) {
        const r = 1.6 + (performance.now() % 1200) / 1200 * 1.5;
        ctx.strokeStyle = `rgba(255,77,77,${0.7 * (1 - (r - 1.6) / 1.5)})`; ctx.lineWidth = 0.1;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  drawPreview(g, ui) {
    const pv = ui.preview;
    if (!pv) return;
    const ctx = this.ctx;
    if (pv.type === 'motor') {
      const [ax, ay] = this.center(g, pv.a);
      const [bx, by] = pv.pt;
      ctx.strokeStyle = pv.ok ? P.motor : '#ff6b6b'; ctx.globalAlpha = 0.75; ctx.lineWidth = 0.3;
      ctx.setLineDash([0.3, 0.22]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    } else if (pv.type === 'span') {
      const [fx, fy] = g.xy(pv.from);
      ctx.fillStyle = pv.kind === 'bridge' ? 'rgba(142,163,184,0.35)' : 'rgba(160,140,110,0.35)';
      for (let k = 1; k <= pv.len; k++) {
        const x = fx + pv.dx * k, y = fy + pv.dy * k;
        if (!g.inMap(x, y)) break;
        ctx.beginPath(); ctx.roundRect(x + 0.12, y + 0.12, 0.76, 0.76, 0.2); ctx.fill();
      }
    }
  }

  drawHover(g, ui) {
    const ctx = this.ctx, [x, y] = g.xy(ui.hover);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 0.06;
    ctx.beginPath(); ctx.roundRect(x + 0.05, y + 0.05, 0.9, 0.9, 0.2); ctx.stroke();
  }
}
