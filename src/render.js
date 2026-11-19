import { T, TS, COLORS, MINI, BUILDS, BREAKABLE } from './tiles.js';
import { NIGHT_START } from './game.js';
import { CS } from './gen.js';

const CPX = CS * TS; // chunk size in pixels (baked canvas size)

const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177; return (h ^ (h >> 16)) >>> 0; };

// precomputed slightly varied ground colours
function shades(hex) {
  const n = parseInt(hex.slice(1), 16), out = [];
  for (let k = -1; k <= 2; k++) {
    const f = 1 + k * 0.045;
    const r = Math.min(255, (n >> 16) * f) | 0, g = Math.min(255, ((n >> 8) & 255) * f) | 0, b = Math.min(255, (n & 255) * f) | 0;
    out.push(`rgb(${r},${g},${b})`);
  }
  return out;
}
const SHADES = {};
for (const k in COLORS) SHADES[k] = shades(COLORS[k]);

export class Renderer {
  constructor(canvas, mini) {
    this.c = canvas; this.ctx = canvas.getContext('2d');
    this.mini = mini; this.mctx = mini.getContext('2d');
    this.dark = document.createElement('canvas'); this.dctx = this.dark.getContext('2d');
    // one pre-rendered soft light sprite, stamped with drawImage instead of building a gradient per light per frame
    this.lightSpr = document.createElement('canvas'); this.lightSpr.width = this.lightSpr.height = 128;
    { const l = this.lightSpr.getContext('2d'), g = l.createRadialGradient(64, 64, 19, 64, 64, 64); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); l.fillStyle = g; l.fillRect(0, 0, 128, 128); }
    this.mm = document.createElement('canvas'); this.mmImg = null; this.mmDone = null; this.mmQ = [];
    this.baked = new Map();   // chunk index -> { cv, ver, seen } baked ground+object canvas
    this.spare = [];          // recycled chunk canvases
    this.frame = 0; this.cam = { x: 0, y: 0 }; this.t = 0;
    this.resize();
  }
  resize() {
    this.c.width = window.innerWidth; this.c.height = window.innerHeight;
    this.dark.width = (this.c.width >> 1) + 1; this.dark.height = (this.c.height >> 1) + 1; // night layer runs at half resolution (light is soft anyway)
    this.ctx.imageSmoothingEnabled = false;
  }
  screenToTile(sx, sy) { return [Math.floor((sx + this.cam.x) / TS), Math.floor((sy + this.cam.y) / TS)]; }

  nightAlpha(clock) {
    if (clock < NIGHT_START - 0.05) return 0;
    if (clock < NIGHT_START + 0.05) return (clock - (NIGHT_START - 0.05)) / 0.1;
    if (clock > 0.95) return (1 - clock) / 0.05;
    return 1;
  }

  draw(game, mouse, dt) {
    this.t += dt;
    const { ctx, c } = this, w = game.world, p = game.p;
    this.cam.x = Math.round(p.x - c.width / 2); this.cam.y = Math.round(p.y - c.height / 2);
    const cx = this.cam.x, cy = this.cam.y;
    ctx.fillStyle = '#0c0d10'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.save(); ctx.translate(-cx, -cy);

    const x0 = Math.max(0, Math.floor(cx / TS)), y0 = Math.max(0, Math.floor(cy / TS));
    const x1 = Math.min(w.w - 1, Math.floor((cx + c.width) / TS)), y1 = Math.min(w.h - 1, Math.floor((cy + c.height) / TS));

    // ground + objects: one drawImage per visible chunk (baked once, re-baked only when a tile in it changes)
    this.frame++;
    const gx0 = x0 >> 4, gy0 = y0 >> 4, gx1 = x1 >> 4, gy1 = y1 >> 4;
    let spareBakes = 1; // pre-bake one ring-neighbour per frame so walking never hits a cold chunk
    for (let gy = Math.max(0, gy0 - 1); gy <= Math.min(w.cw - 1, gy1 + 1); gy++) for (let gx = Math.max(0, gx0 - 1); gx <= Math.min(w.cw - 1, gx1 + 1); gx++) {
      const ch = w.chunks[gy * w.cw + gx]; if (!ch) continue;
      const inView = gx >= gx0 && gx <= gx1 && gy >= gy0 && gy <= gy1;
      let bk = this.baked.get(ch.idx);
      if (!bk || bk.ver !== ch.ver) {
        if (!inView && (spareBakes <= 0 || bk)) continue;
        if (!inView) spareBakes--;
        bk = this.bake(ch, bk);
      }
      bk.seen = this.frame;
      if (inView) ctx.drawImage(bk.cv, gx * CPX, gy * CPX);
    }
    if (this.frame % 60 === 0) this.evict(w);
    // animated bits drawn on top of the baked layer: beacon glow and damage bars on built tiles
    { const hx = w.home.x * TS, hy = w.home.y * TS;
      if (w.get(w.home.x, w.home.y) === T.BEACON) { ctx.fillStyle = '#5ad0ff'; ctx.beginPath(); ctx.arc(hx + 16, hy + 14, 8 + Math.sin(this.t * 3) * 1.5, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hx + 16, hy + 14, 3, 0, 7); ctx.fill(); } }
    for (const [i, d] of w.tileHp) {
      const x = i % w.w, y = (i / w.w) | 0;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      this.bar(x * TS + 2, y * TS - 4, 28, 1 - d / BREAKABLE[w.get(x, y)], '#ffb04a');
    }
    // crates
    for (const cr of w.crates) {
      if (cr.looted || cr.x < x0 || cr.x > x1 || cr.y < y0 || cr.y > y1) continue;
      ctx.fillStyle = '#8a6a30'; ctx.fillRect(cr.x * TS + 6, cr.y * TS + 8, 20, 17);
      ctx.fillStyle = '#d9b44a'; ctx.fillRect(cr.x * TS + 6, cr.y * TS + 8, 20, 3); ctx.fillRect(cr.x * TS + 14, cr.y * TS + 8, 4, 17);
    }
    // nests
    for (const n of w.nests) {
      const px = (n.x + 0.5) * TS, py = (n.y + 0.5) * TS;
      if (px < cx - 60 || px > cx + c.width + 60 || py < cy - 60 || py > cy + c.height + 60) continue;
      if (!n.alive) { ctx.fillStyle = '#3a2f2a'; ctx.beginPath(); ctx.arc(px, py, 14, 0, 7); ctx.fill(); continue; }
      const pulse = 1 + Math.sin(this.t * 3 + n.x) * 0.06;
      ctx.fillStyle = '#2a1a30'; ctx.beginPath(); ctx.arc(px, py, 22 * pulse, 0, 7); ctx.fill();
      ctx.fillStyle = '#7a2438'; ctx.beginPath(); ctx.arc(px, py, 13 * pulse, 0, 7); ctx.fill();
      ctx.fillStyle = '#ff5a6a'; ctx.beginPath(); ctx.arc(px, py, 5, 0, 7); ctx.fill();
      this.bar(px - 20, py - 32, 40, n.hp / n.maxHp, '#ff5a6a');
    }
    // ground drops: ammo box (yellow) and scrap (grey gear)
    for (const d of game.drops) {
      if (d.x < cx - 20 || d.x > cx + c.width + 20 || d.y < cy - 20 || d.y > cy + c.height + 20) continue;
      if (d.life < 5 && ((d.life * 6) | 0) % 2) continue; // blink before vanishing
      if (d.kind === 0) { ctx.fillStyle = '#6b5a2a'; ctx.fillRect(d.x - 6, d.y - 4, 12, 8); ctx.fillStyle = '#ffd24a'; ctx.fillRect(d.x - 4, d.y - 2, 8, 2); ctx.fillRect(d.x - 4, d.y + 1, 8, 2); }
      else { ctx.fillStyle = '#9aa0ae'; ctx.beginPath(); ctx.arc(d.x, d.y, 5, 0, 7); ctx.fill(); ctx.fillStyle = '#4a4d58'; ctx.beginPath(); ctx.arc(d.x, d.y, 2, 0, 7); ctx.fill(); }
    }
    // enemies
    for (const e of game.enemies) {
      if (e.x < cx - 40 || e.x > cx + c.width + 40 || e.y < cy - 40 || e.y > cy + c.height + 40) continue;
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(e.x, e.y + e.r * 0.7, e.r, e.r * 0.45, 0, 0, 7); ctx.fill();
      ctx.fillStyle = e.flash > 0 ? '#fff' : e.burn ? '#d98a3a' : e.color;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, 7); ctx.fill();
      const a = Math.atan2(p.y - e.y, p.x - e.x);
      ctx.fillStyle = '#1a0f0f'; ctx.beginPath(); ctx.arc(e.x + Math.cos(a - 0.5) * e.r * 0.5, e.y + Math.sin(a - 0.5) * e.r * 0.5, 2, 0, 7); ctx.arc(e.x + Math.cos(a + 0.5) * e.r * 0.5, e.y + Math.sin(a + 0.5) * e.r * 0.5, 2, 0, 7); ctx.fill();
      if (e.type === 'brute') { ctx.strokeStyle = '#2a0c0c'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, 7); ctx.stroke(); ctx.fillStyle = '#6a1c1c'; ctx.beginPath(); ctx.arc(e.x + Math.cos(a + 1.9) * e.r * 0.85, e.y + Math.sin(a + 1.9) * e.r * 0.85, 5, 0, 7); ctx.arc(e.x + Math.cos(a - 1.9) * e.r * 0.85, e.y + Math.sin(a - 1.9) * e.r * 0.85, 5, 0, 7); ctx.fill(); }
      else if (e.type === 'runner') { ctx.fillStyle = '#fff6a0'; ctx.beginPath(); ctx.moveTo(e.x + Math.cos(a) * (e.r + 5), e.y + Math.sin(a) * (e.r + 5)); ctx.lineTo(e.x + Math.cos(a + 2.4) * e.r, e.y + Math.sin(a + 2.4) * e.r); ctx.lineTo(e.x + Math.cos(a - 2.4) * e.r, e.y + Math.sin(a - 2.4) * e.r); ctx.fill(); }
      else if (e.type === 'bloater') { ctx.strokeStyle = `rgba(210,255,90,${0.35 + 0.25 * Math.sin(this.t * 6)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 3 + Math.sin(this.t * 6) * 1.5, 0, 7); ctx.stroke(); }
      else if (e.type === 'spitter') { ctx.fillStyle = '#b6ff7a'; ctx.beginPath(); ctx.arc(e.x + Math.cos(a) * e.r * 0.9, e.y + Math.sin(a) * e.r * 0.9, 4, 0, 7); ctx.fill(); ctx.strokeStyle = '#b6ff7a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 2, 0, 7); ctx.stroke(); }
      if (e.hp < e.maxHp) this.bar(e.x - e.r, e.y - e.r - 6, e.r * 2, e.hp / e.maxHp, '#7fff7f');
    }
    // blades
    if (game.s.blades) {
      ctx.fillStyle = '#d8d8e8';
      for (let b = 0; b < game.s.blades; b++) {
        const a = game.bladeAng + (b * Math.PI * 2) / game.s.blades;
        ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * 52, p.y + Math.sin(a) * 52, 7, 0, 7); ctx.fill();
      }
    }
    // player
    if (!game.dead) {
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(p.x, p.y + 7, 10, 5, 0, 0, 7); ctx.fill();
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.facing);
      if (game.wdef.kind === 'melee') { // bat pivots from the player through the swing arc
        const k = p.swing > 0 ? p.swing / 0.16 : 0, half = game.wdef.arc / 2;
        ctx.rotate((p.swingDir || 1) * half * (2 * k - 1) * (k > 0 ? 1 : 0));
        ctx.fillStyle = '#8a6a3a'; ctx.fillRect(6, -2, 26, 4); ctx.fillStyle = '#b08a4a'; ctx.fillRect(22, -3, 10, 6); }
      else { ctx.fillStyle = '#222'; ctx.fillRect(4, -2, 14, 4); if (p.flash > 0) { ctx.fillStyle = '#fff3a0'; ctx.beginPath(); ctx.arc(20, 0, 5, 0, 7); ctx.fill(); } }
      ctx.restore();
      if (p.reload > 0) { // reload progress ring
        ctx.strokeStyle = '#ffe36a'; ctx.lineWidth = 3; ctx.beginPath();
        ctx.arc(p.x, p.y, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - p.reload / game.wdef.reload)); ctx.stroke();
      }
      ctx.fillStyle = '#4aa8ff'; ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, 7); ctx.fill();
      ctx.fillStyle = '#d8ecff'; ctx.beginPath(); ctx.arc(p.x + Math.cos(p.facing) * 3, p.y + Math.sin(p.facing) * 3, 4, 0, 7); ctx.fill();
    }
    // bullets
    for (const b of game.bullets) {
      ctx.fillStyle = b.hostile ? '#9dff5a' : b.friendly ? '#ffe36a' : '#ffa04a';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.hostile ? 4 : 3, 0, 7); ctx.fill();
    }
    // effects: melee slash arcs and bloater bursts
    for (const f of game.fx) {
      const k = f.t / f.T;
      if (f.k === 'slash') { ctx.strokeStyle = `rgba(255,255,255,${0.8 * k})`; ctx.lineWidth = 5 * k + 1; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * 0.8, f.a - f.arc / 2, f.a + f.arc / 2); ctx.stroke(); }
      else if (f.k === 'burst') { ctx.strokeStyle = `rgba(200,255,80,${0.9 * k})`; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1 - k * 0.6), 0, 7); ctx.stroke(); ctx.fillStyle = `rgba(160,220,60,${0.25 * k})`; ctx.fill(); }
    }

    // harvest indicator
    const h = game.harvestTarget;
    if (h) {
      const hx = h.kind === 'crate' ? (h.c.x + 0.5) * TS : (h.x + 0.5) * TS, hy = h.kind === 'crate' ? (h.c.y + 0.5) * TS : (h.y + 0.5) * TS;
      ctx.strokeStyle = '#ffffff90'; ctx.lineWidth = 2; ctx.strokeRect(hx - 16, hy - 16, 32, 32);
      if (game.input.harvest && game.harvestT > 0) this.bar(hx - 16, hy - 24, 32, Math.min(1, game.harvestProgress || 0), '#ffe36a');
    }
    // build ghost
    if (game.build && mouse) {
      const [tx, ty] = this.screenToTile(mouse.x, mouse.y);
      const ok = game.canBuildAt(tx, ty);
      ctx.fillStyle = ok ? 'rgba(90,255,120,.35)' : 'rgba(255,80,80,.35)'; ctx.fillRect(tx * TS, ty * TS, TS, TS);
      ctx.strokeStyle = ok ? '#5aff78' : '#ff5050'; ctx.lineWidth = 2; ctx.strokeRect(tx * TS + 1, ty * TS + 1, TS - 2, TS - 2);
    }
    ctx.restore();

    // night: dark layer with light cut-outs
    const na = this.nightAlpha(game.time.clock);
    if (na > 0) {
      const d = this.dctx, dw = this.dark.width, dh = this.dark.height; d.globalCompositeOperation = 'source-over'; d.globalAlpha = 1;
      d.clearRect(0, 0, dw, dh);
      d.fillStyle = `rgba(4,6,22,${0.86 * na})`; d.fillRect(0, 0, dw, dh);
      d.globalCompositeOperation = 'destination-out';
      const spr = this.lightSpr;
      const light = (x, y, r, k = 1) => {
        const sx = (x - cx) * 0.5, sy = (y - cy) * 0.5, h = r * 0.5;
        if (sx < -h || sy < -h || sx > dw + h || sy > dh + h) return;
        d.globalAlpha = k; d.drawImage(spr, sx - h, sy - h, h * 2, h * 2);
      };
      light(p.x, p.y, 230);
      light((w.home.x + 0.5) * TS, (w.home.y + 0.5) * TS, 260);
      for (const idx of w.turrets.keys()) light((idx % w.w + 0.5) * TS, ((idx / w.w | 0) + 0.5) * TS, 130, 0.8);
      for (const n of w.nests) if (n.alive) light((n.x + 0.5) * TS, (n.y + 0.5) * TS, 90, 0.35);
      d.globalAlpha = 1;
      ctx.drawImage(this.dark, 0, 0, c.width, c.height);
    }
    this.drawReticle(game, mouse);
    this.drawMini(game, dt);
  }

  // Custom cursor: the real one is hidden over the game canvas (CSS).
  drawReticle(game, mouse) {
    if (!mouse || game.paused || game.dead) return;
    const { ctx } = this, x = mouse.x, y = mouse.y;
    ctx.strokeStyle = game.build ? '#5ad0ff' : '#ffffffcc'; ctx.lineWidth = 2;
    if (game.build) { ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y); ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6); ctx.stroke(); return; }
    ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.moveTo(x - 13, y); ctx.lineTo(x - 5, y); ctx.moveTo(x + 5, y); ctx.lineTo(x + 13, y);
    ctx.moveTo(x, y - 13); ctx.lineTo(x, y - 5); ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 13); ctx.stroke();
  }

  bar(x, y, w, f, col) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x - 1, y - 1, w + 2, 5);
    ctx.fillStyle = col; ctx.fillRect(x, y, w * Math.max(0, Math.min(1, f)), 3);
  }
  // Paint one chunk's ground and static objects into a canvas.
  bake(ch, prev) {
    const bk = prev || { cv: this.spare.pop() || Object.assign(document.createElement('canvas'), { width: CPX, height: CPX }), ver: 0, seen: 0 };
    const ctx = bk.cv.getContext('2d'), t = ch.t, bx = ch.cx * CS, by = ch.cy * CS;
    for (let ly = 0; ly < CS; ly++) for (let lx = 0; lx < CS; lx++) {
      const tt = t[ly * CS + lx], x = bx + lx, y = by + ly, h = hash(x, y), px = lx * TS, py = ly * TS;
      ctx.fillStyle = SHADES[tt][h & 3]; ctx.fillRect(px, py, TS, TS);
      if (tt === T.WATER) { ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fillRect(px + ((h >> 4) % 20), py + ((h >> 9) % 24), 10, 2); }
      else if (tt === T.ROAD && (h & 15) === 0) { ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(px + 14, py + 14, 4, 4); }
      else if (tt === T.GRASS && (h & 7) === 0) { ctx.fillStyle = 'rgba(0,0,0,.15)'; ctx.fillRect(px + ((h >> 5) & 15) + 4, py + ((h >> 9) & 15) + 4, 2, 5); }
    }
    for (let ly = 0; ly < CS; ly++) for (let lx = 0; lx < CS; lx++) {
      const tt = t[ly * CS + lx], px = lx * TS, py = ly * TS;
      switch (tt) {
        case T.TREE: ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(px + 16, py + 27, 12, 5, 0, 0, 7); ctx.fill();
          ctx.fillStyle = '#4a3322'; ctx.fillRect(px + 14, py + 18, 5, 10);
          ctx.fillStyle = '#1f4a22'; ctx.beginPath(); ctx.arc(px + 16, py + 13, 13, 0, 7); ctx.fill();
          ctx.fillStyle = '#2e6a30'; ctx.beginPath(); ctx.arc(px + 13, py + 10, 7, 0, 7); ctx.fill(); break;
        case T.ROCK: ctx.fillStyle = '#5b5b66'; ctx.beginPath(); ctx.moveTo(px + 3, py + 28); ctx.lineTo(px + 8, py + 8); ctx.lineTo(px + 22, py + 4); ctx.lineTo(px + 30, py + 26); ctx.fill();
          ctx.fillStyle = '#7b7b88'; ctx.beginPath(); ctx.moveTo(px + 8, py + 8); ctx.lineTo(px + 22, py + 4); ctx.lineTo(px + 18, py + 16); ctx.fill(); break;
        case T.WALL: ctx.fillStyle = '#4a4252'; ctx.fillRect(px, py, TS, TS); ctx.fillStyle = '#5c5366'; ctx.fillRect(px, py, TS, 6); ctx.fillStyle = '#2b2630'; ctx.fillRect(px, py + TS - 4, TS, 4); break;
        case T.STUMP: ctx.fillStyle = '#4a3322'; ctx.fillRect(px + 11, py + 18, 10, 7); ctx.fillStyle = '#6a4a30'; ctx.fillRect(px + 11, py + 18, 10, 3); break;
        case T.RUBBLE: ctx.fillStyle = '#5b5348'; ctx.fillRect(px + 6, py + 20, 8, 6); ctx.fillRect(px + 18, py + 12, 7, 6); break;
        case T.BARRICADE: ctx.fillStyle = '#8a5a30'; for (let k = 0; k < 3; k++) ctx.fillRect(px + 2, py + 5 + k * 9, 28, 6);
          ctx.fillStyle = '#5a3a1e'; ctx.fillRect(px + 6, py + 2, 4, 28); ctx.fillRect(px + 22, py + 2, 4, 28); break;
        case T.STONEWALL: ctx.fillStyle = '#8a8a96'; ctx.fillRect(px + 1, py + 1, 30, 30); ctx.fillStyle = '#a5a5b2'; ctx.fillRect(px + 1, py + 1, 30, 5); ctx.fillStyle = '#6a6a76'; ctx.fillRect(px + 15, py + 8, 2, 22); break;
        case T.TURRET: ctx.fillStyle = '#34343c'; ctx.fillRect(px + 3, py + 3, 26, 26); ctx.fillStyle = '#d9b44a'; ctx.beginPath(); ctx.arc(px + 16, py + 16, 8, 0, 7); ctx.fill();
          ctx.fillStyle = '#222'; ctx.fillRect(px + 16, py + 14, 14, 4); break;
        case T.BEACON: ctx.fillStyle = '#34343c'; ctx.fillRect(px + 6, py + 20, 20, 8); break; // the glow is animated on top
      }
    }
    bk.ver = ch.ver; this.baked.set(ch.idx, bk);
    return bk;
  }
  // Return canvases of unloaded / long-unseen chunks to the spare pool.
  evict(w) {
    for (const [idx, bk] of this.baked) if (!w.chunks[idx] || this.frame - bk.seen > 600) { this.baked.delete(idx); if (this.spare.length < 24) this.spare.push(bk.cv); }
  }

  // Minimap: a 160x160-tile window around the player. Terrain is painted into one world-sized canvas
  // chunk by chunk (only chunks the player has revealed), so fog of war is simply "not painted yet".
  mmChunk(w, ch, t) {
    const x = this.mm.getContext('2d'), img = this.mmImg || (this.mmImg = x.createImageData(CS, CS)), d = img.data;
    for (let i = 0; i < CS * CS; i++) { const col = MINI[t[i]]; d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2]; d[i * 4 + 3] = 255; }
    x.putImageData(img, ch.cx * CS, ch.cy * CS);
  }
  drawMini(game, dt) {
    const w = game.world, m = this.mini, mc = this.mctx;
    if (this.mm.width !== w.w) { this.mm.width = w.w; this.mm.height = w.h; this.mmDone = new Int32Array(w.cw * w.cw); this.mmQ = []; for (let i = 0; i < w.explored.length; i++) if (w.explored[i]) this.mmQ.push(i); }
    for (const ch of w.loaded) if (w.explored[ch.idx] && this.mmDone[ch.idx] !== ch.ver) { this.mmChunk(w, ch, ch.t); this.mmDone[ch.idx] = ch.ver; }
    // revealed chunks from a loaded save are repainted one per frame from their saved/generated tiles
    for (let k = 0; k < 2 && this.mmQ.length; k++) {
      const idx = this.mmQ.pop();
      if (this.mmDone[idx] || w.chunks[idx]) continue;
      const cx = idx % w.cw, cy = (idx / w.cw) | 0;
      this.mmChunk(w, { cx, cy }, w.mod.get(idx) || w.gen.tiles(cx, cy)); this.mmDone[idx] = -1;
    }
    const V = m.width, ptx = Math.floor(game.p.x / TS), pty = Math.floor(game.p.y / TS), ox = ptx - (V >> 1), oy = pty - (V >> 1);
    mc.imageSmoothingEnabled = false;
    mc.fillStyle = '#05060a'; mc.fillRect(0, 0, V, V);
    mc.drawImage(this.mm, ox, oy, V, V, 0, 0, V, V);
    const seen = (x, y) => w.explored[(y >> 4) * w.cw + (x >> 4)] === 1;
    for (const cr of w.crates) if (!cr.looted) { mc.fillStyle = '#ffd24a'; mc.fillRect(cr.x - ox, cr.y - oy, 2, 2); }
    for (const n of w.gen.nests) {
      if (n.x < ox || n.y < oy || n.x >= ox + V || n.y >= oy + V || !seen(n.x, n.y)) continue;
      mc.fillStyle = w.deadNests.has(n.y * w.w + n.x) ? '#555' : '#ff4a5a'; mc.fillRect(n.x - ox - 2, n.y - oy - 2, 5, 5);
    }
    mc.fillStyle = '#5ad0ff'; mc.fillRect(w.home.x - ox - 2, w.home.y - oy - 2, 5, 5);
    mc.fillStyle = '#fff'; mc.beginPath(); mc.arc(V >> 1, V >> 1, 3, 0, 7); mc.fill();
  }
}
