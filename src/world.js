import { T, TS, SOLID, BREAKABLE } from './tiles.js';
import { makeGen, CS, CSH, NEST_HP } from './gen.js';
import { fortHollowStamp } from './maps.js';

export { CS, CSH };
const LOAD_R = 3, UNLOAD_R = 5;   // chunk radius kept loaded / dropped beyond (a 7x7 window of 16x16-tile chunks)
const RING = [];                  // load order: nearest chunks first
for (let dy = -LOAD_R; dy <= LOAD_R; dy++) for (let dx = -LOAD_R; dx <= LOAD_R; dx++) RING.push([dx, dy, dx * dx + dy * dy]);
RING.sort((a, b) => a[2] - b[2]);

// The persistent part of the game, held as chunks. Chunks are generated on demand from the seed
// (see gen.js) and dropped again when the player walks away. Only chunks the player has changed
// ("modified") are ever saved; everything else regenerates identically.
export class World {
  constructor(spec) {
    this.spec = spec; this.kind = spec.kind; this.seed = spec.seed; this.name = spec.name;
    this.w = this.h = spec.size; this.cw = spec.size >> CSH;
    this.gen = makeGen(spec);
    this.home = this.gen.home;
    this.chunks = new Array(this.cw * this.cw).fill(null);
    this.loaded = [];                  // currently loaded chunk objects
    this.mod = new Map();              // chunk index -> tiles, for every chunk the player changed (loaded or not)
    this.dirtyChunks = new Set();      // modified chunks not yet written to the store
    this.nests = [];                   // nests in LOADED chunks: {x,y,key,hp,maxHp,alive,cd,chunk}
    this.crates = [];                  // crates in loaded chunks: {x,y,key,looted,chunk}
    this.turrets = new Map();          // tile index -> {cd}, loaded chunks only (derived)
    this.tileHp = new Map();           // tile index -> damage taken (built tiles only)
    this.deadNests = new Set(); this.nestHp = new Map(); this.looted = new Set();
    this.explored = new Uint8Array(this.cw * this.cw);
    this.nestTotal = this.gen.nests.length;
    this.scx = -99; this.scy = -99; this.moved = true;
  }

  // ---------- tiles ----------
  inb(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return T.WALL;
    const ch = this.chunks[(y >> CSH) * this.cw + (x >> CSH)] || this.load(x >> CSH, y >> CSH);
    return ch.t[((y & 15) << 4) | (x & 15)];
  }
  set(x, y, t) {
    if (!this.inb(x, y)) return;
    const ch = this.chunks[(y >> CSH) * this.cw + (x >> CSH)] || this.load(x >> CSH, y >> CSH);
    const i = y * this.w + x;
    this.touch(ch);
    ch.t[((y & 15) << 4) | (x & 15)] = t; ch.ver++;
    this.tileHp.delete(i);
    if (t === T.TURRET) this.turrets.set(i, { cd: 0 }); else this.turrets.delete(i);
  }
  touch(ch) { if (!ch.mod) { ch.mod = true; this.mod.set(ch.idx, ch.t); } this.dirtyChunks.add(ch.idx); }
  solidAt(x, y) { return SOLID[this.get(x, y)] === 1; }
  worldSolid(px, py) { return this.solidAt(Math.floor(px / TS), Math.floor(py / TS)); }

  damageTile(x, y, amt) {
    const t = this.get(x, y), max = BREAKABLE[t];
    if (!max) return false;
    const i = y * this.w + x, d = (this.tileHp.get(i) || 0) + amt;
    if (d >= max) { this.set(x, y, T.RUBBLE); return true; }
    this.tileHp.set(i, d);
    return false;
  }

  // ---------- chunk lifecycle ----------
  load(cx, cy) {
    const idx = cy * this.cw + cx;
    let ch = this.chunks[idx]; if (ch) return ch;
    const saved = this.mod.get(idx);
    ch = { idx, cx, cy, t: saved || this.gen.tiles(cx, cy), ver: 1, mmVer: 0, mod: !!saved };
    this.chunks[idx] = ch; this.loaded.push(ch);
    const ents = this.gen.entities(cx, cy);
    for (const n of ents.nests) {
      const key = n.y * this.w + n.x, dead = this.deadNests.has(key);
      this.nests.push({ x: n.x, y: n.y, key, chunk: idx, hp: dead ? 0 : this.nestHp.get(key) ?? NEST_HP, maxHp: NEST_HP, alive: !dead, cd: 1 + (key % 200) / 100 });
    }
    for (const c of ents.crates) { const key = c.y * this.w + c.x; this.crates.push({ x: c.x, y: c.y, key, chunk: idx, looted: this.looted.has(key) }); }
    if (saved) for (let i = 0; i < saved.length; i++) if (saved[i] === T.TURRET) this.turrets.set((cy * CS + (i >> 4)) * this.w + cx * CS + (i & 15), { cd: 0 });
    if (Math.abs(cx - this.scx) <= LOAD_R && Math.abs(cy - this.scy) <= LOAD_R) this.explored[idx] = 1;
    return ch;
  }
  unload(ch) {
    this.chunks[ch.idx] = null;
    this.loaded.splice(this.loaded.indexOf(ch), 1);
    for (const n of this.nests) if (n.chunk === ch.idx && n.alive && n.hp < n.maxHp) this.nestHp.set(n.key, n.hp);
    this.nests = this.nests.filter((n) => n.chunk !== ch.idx);
    this.crates = this.crates.filter((c) => c.chunk !== ch.idx);
    if (ch.mod) for (const k of this.turrets.keys()) if ((k / this.w >> CSH) === ch.cy && ((k % this.w) >> CSH) === ch.cx) this.turrets.delete(k);
  }

  // Called every frame with the player position: loads at most one chunk, unloads far ones.
  stream(px, py) {
    const cx = Math.floor(px / (TS * CS)), cy = Math.floor(py / (TS * CS));
    if (cx !== this.scx || cy !== this.scy) {
      this.scx = cx; this.scy = cy; this.moved = true;
      for (let y = Math.max(0, cy - LOAD_R); y <= Math.min(this.cw - 1, cy + LOAD_R); y++)
        for (let x = Math.max(0, cx - LOAD_R); x <= Math.min(this.cw - 1, cx + LOAD_R); x++) this.explored[y * this.cw + x] = 1;
    }
    for (let k = 0; k < RING.length; k++) {
      const x = cx + RING[k][0], y = cy + RING[k][1];
      if (x < 0 || y < 0 || x >= this.cw || y >= this.cw || this.chunks[y * this.cw + x]) continue;
      this.load(x, y); break;
    }
    if (this.moved) {
      this.moved = false;
      for (const ch of this.loaded.slice()) if (Math.abs(ch.cx - cx) > UNLOAD_R || Math.abs(ch.cy - cy) > UNLOAD_R) this.unload(ch);
    }
  }
  // Load everything around a point right now (new game, respawn, teleport).
  preload(px, py, r = 2) {
    const cx = Math.floor(px / (TS * CS)), cy = Math.floor(py / (TS * CS));
    for (let y = Math.max(0, cy - r); y <= Math.min(this.cw - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(this.cw - 1, cx + r); x++) this.load(x, y);
    this.stream(px, py);
  }

  // ---------- state changes that must persist ----------
  loot(c) { c.looted = true; this.looted.add(c.key); }
  killNest(n) { n.alive = false; n.hp = 0; this.deadNests.add(n.key); this.nestHp.delete(n.key); }
  nestsLeft() { return this.nestTotal - this.deadNests.size; }
  zoneAt(x, y) { return this.gen.zoneName(x, y); }
  tier(x, y) { return this.gen.tier(x, y); }

  // Regrow stumps. Stumps only exist in modified chunks, so only those are scanned.
  regrow(rng, px, py) {
    for (const [idx, t] of this.mod) {
      const cx = idx % this.cw, cy = (idx / this.cw) | 0;
      let changed = false;
      for (let i = 0; i < t.length; i++) {
        if (t[i] !== T.STUMP || rng() > 0.15) continue;
        if (Math.hypot(cx * CS + (i & 15) - px, cy * CS + (i >> 4) - py) < 4) continue;
        t[i] = T.TREE; changed = true;
      }
      if (changed) { this.dirtyChunks.add(idx); const ch = this.chunks[idx]; if (ch) ch.ver++; }
    }
  }

  // ---------- persistence ----------
  // Returns [{idx, t}] copies of modified chunks not yet stored, and clears the dirty set.
  takeDirty() {
    const out = [];
    for (const idx of this.dirtyChunks) out.push({ idx, t: this.mod.get(idx).slice() });
    this.dirtyChunks.clear();
    return out;
  }
  exportState() {
    for (const n of this.nests) if (n.alive && n.hp < n.maxHp) this.nestHp.set(n.key, n.hp); else this.nestHp.delete(n.key);
    const { tiles, ...stamp } = this.spec.stamp || {};
    return {
      spec: { kind: this.kind, seed: this.seed, name: this.name, size: this.w, stamp: this.spec.stamp ? stamp : null, stampBuilt: this.spec.stampBuilt || null },
      dead: [...this.deadNests], looted: [...this.looted], nestHp: [...this.nestHp], tileHp: [...this.tileHp],
      explored: rle(this.explored), modIdx: [...this.mod.keys()],
    };
  }
  static fromState(st, chunks) {
    const spec = { ...st.spec };
    if (spec.stampBuilt === 'fort-hollow') spec.stamp = fortHollowStamp();
    const w = new World(spec);
    w.deadNests = new Set(st.dead); w.looted = new Set(st.looted); w.nestHp = new Map(st.nestHp); w.tileHp = new Map(st.tileHp);
    w.explored = unrle(st.explored, w.explored.length);
    for (const [idx, t] of chunks) w.mod.set(idx, t);
    return w;
  }
}

export function rle(a) {
  const out = []; let p = a[0], c = 1;
  for (let i = 1; i < a.length; i++) { if (a[i] === p) c++; else { out.push(p, c); p = a[i]; c = 1; } }
  out.push(p, c); return out;
}
export function unrle(r, n) {
  const a = new Uint8Array(n); let i = 0;
  for (let k = 0; k < r.length; k += 2) { a.fill(r[k], i, i + r[k + 1]); i += r[k + 1]; }
  return a;
}
