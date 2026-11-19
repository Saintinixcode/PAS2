import { T, TS, SOLID, BREAKABLE } from './tiles.js';

// A World is the persistent part of the game: terrain, what players built,
// which nests are dead, which crates are looted. Everything here is saved.
export class World {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.tiles = new Uint8Array(w * h);
    this.nests = [];   // {x,y (tiles), hp, maxHp, alive, cd}
    this.crates = [];  // {x,y (tiles), looted}
    this.zones = [];   // {name,x,y,r (tiles)}
    this.tileHp = new Map(); // tile index -> damage taken (built tiles only)
    this.turrets = new Map(); // tile index -> {cd} (derived, not saved)
    this.home = { x: (w / 2) | 0, y: (h / 2) | 0 };
    this.kind = 'seeded'; this.seed = '0'; this.name = '';
    this.dirty = true;
  }

  inb(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y) { return this.inb(x, y) ? this.tiles[y * this.w + x] : T.WALL; }
  set(x, y, t) {
    if (!this.inb(x, y)) return;
    const i = y * this.w + x;
    this.tiles[i] = t;
    this.tileHp.delete(i);
    if (t === T.TURRET) this.turrets.set(i, { cd: 0 }); else this.turrets.delete(i);
    this.dirty = true;
  }
  solidAt(x, y) { return SOLID[this.get(x, y)] === 1; }
  worldSolid(px, py) { return this.solidAt(Math.floor(px / TS), Math.floor(py / TS)); }

  // Hit a player-built tile. Returns true if it was destroyed.
  damageTile(x, y, amt) {
    const t = this.get(x, y);
    const max = BREAKABLE[t];
    if (!max) return false;
    const i = y * this.w + x;
    const d = (this.tileHp.get(i) || 0) + amt;
    if (d >= max) { this.set(x, y, T.RUBBLE); return true; }
    this.tileHp.set(i, d);
    return false;
  }

  zoneAt(x, y) {
    let best = null, bd = 1e9;
    for (const z of this.zones) {
      const d = Math.hypot(z.x - x, z.y - y);
      if (d <= z.r && d < bd) { best = z; bd = d; }
    }
    return best ? best.name : null;
  }

  rebuildDerived() {
    this.turrets.clear();
    for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i] === T.TURRET) this.turrets.set(i, { cd: 0 });
    this.dirty = true;
  }

  serialize() {
    const rle = [];
    let p = this.tiles[0], c = 1;
    for (let i = 1; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      if (t === p) c++; else { rle.push(p, c); p = t; c = 1; }
    }
    rle.push(p, c);
    return {
      w: this.w, h: this.h, rle,
      nests: this.nests.map((n) => ({ x: n.x, y: n.y, hp: n.hp, maxHp: n.maxHp, alive: n.alive })),
      crates: this.crates.map((c) => ({ x: c.x, y: c.y, looted: c.looted })),
      zones: this.zones, tileHp: [...this.tileHp.entries()], home: this.home,
      kind: this.kind, seed: this.seed, name: this.name,
    };
  }

  static deserialize(d) {
    const w = new World(d.w, d.h);
    let i = 0;
    for (let k = 0; k < d.rle.length; k += 2) {
      w.tiles.fill(d.rle[k], i, i + d.rle[k + 1]);
      i += d.rle[k + 1];
    }
    w.nests = d.nests.map((n) => ({ ...n, cd: 1 + Math.random() * 2 }));
    w.crates = d.crates.map((c) => ({ ...c }));
    w.zones = d.zones || [];
    w.tileHp = new Map(d.tileHp || []);
    w.home = d.home; w.kind = d.kind; w.seed = d.seed; w.name = d.name;
    w.rebuildDerived();
    return w;
  }
}
