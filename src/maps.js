import { T } from './tiles.js';
import { World } from './world.js';
import { mulberry32, makeNoise } from './rng.js';

export const WORLD_SIZE = 512; // tiles per side (32 x 32 chunks of 16)

// Small flat scratch grid the authored map is painted on; it becomes a stamp inside the big generated world.
class Flat {
  constructor(w, h) { this.w = w; this.h = h; this.tiles = new Uint8Array(w * h); this.nests = []; this.crates = []; this.zones = []; this.home = { x: 0, y: 0 }; }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y) { return this.inb(x, y) ? this.tiles[y * this.w + x] : T.WALL; }
  set(x, y, t) { if (this.inb(x, y)) this.tiles[y * this.w + x] = t; }
}

// ---------- helpers ----------
function fill(w, x0, y0, x1, y1, t) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.set(x, y, t);
}
function disc(w, cx, cy, r, t, only) {
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++)
      if (Math.hypot(x - cx, y - cy) <= r && (!only || only(w.get(x, y)))) w.set(x, y, t);
}
function building(w, rnd, x, y, bw, bh, door, crate = true) {
  for (let yy = y; yy < y + bh; yy++)
    for (let xx = x; xx < x + bw; xx++) {
      const edge = yy === y || yy === y + bh - 1 || xx === x || xx === x + bw - 1;
      w.set(xx, yy, edge ? T.WALL : T.FLOOR);
    }
  const mx = x + ((bw / 2) | 0), my = y + ((bh / 2) | 0);
  const gap = { n: [mx, y], s: [mx, y + bh - 1], w: [x, my], e: [x + bw - 1, my] }[door];
  w.set(gap[0], gap[1], T.FLOOR);
  if (rnd() < 0.5) { // broken wall segment
    const sides = [[mx + 1, y], [mx + 1, y + bh - 1], [x, my + 1], [x + bw - 1, my + 1]];
    const s = sides[(rnd() * 4) | 0];
    if (w.get(s[0], s[1]) === T.WALL) w.set(s[0], s[1], T.RUBBLE);
  }
  if (crate && rnd() < 0.85) {
    const cx = x + 1 + ((rnd() * (bw - 2)) | 0), cy = y + 1 + ((rnd() * (bh - 2)) | 0);
    w.crates.push([cx, cy]);
  }
}
function road(w, x0, y0, x1, y1) { fill(w, x0, y0, x1, y1, T.ROAD); }

function makeHome(w) {
  const { x, y } = w.home;
  disc(w, x, y, 6, T.GRASS);
  disc(w, x, y, 3, T.DIRT);
  w.set(x, y, T.BEACON);
}

// ---------- hand-authored world ----------
function buildFortHollowStamp() {
  const W = 96, w = new Flat(W, W);
  const rnd = mulberry32(1913);
  const n1 = makeNoise(77), n2 = makeNoise(78);

  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      const f = n1(x * 0.09, y * 0.09, 3);
      let t = T.GRASS;
      if (f > 0.55) t = rnd() < 0.6 ? T.TREE : T.GRASS;
      else if (rnd() < 0.02) t = T.TREE;
      else if (rnd() < 0.03) t = T.DIRT;
      w.tiles[y * W + x] = t;
    }

  // River (x~62) running north to south, lake in the north east.
  for (let y = 0; y < W; y++) {
    const cx = 62 + Math.round(3 * Math.sin(y * 0.12));
    fill(w, cx - 1, y, cx + 1, y, T.WATER);
  }
  disc(w, 80, 16, 8, T.WATER);

  // Quarry (south west): rocks and bare dirt.
  for (let y = 64; y < 92; y++)
    for (let x = 6; x < 34; x++) {
      const v = n2(x * 0.15, y * 0.15, 3);
      w.set(x, y, v > 0.5 ? T.ROCK : v > 0.38 ? T.DIRT : T.GRASS);
    }

  // Town of Fort Hollow: cleared ground and streets.
  fill(w, 26, 28, 58, 64, T.GRASS);
  w.home = { x: 43, y: 47 };
  road(w, 43, 24, 43, 70);        // north-south high street
  road(w, 18, 47, 70, 47);        // main street, crosses the river as a bridge
  road(w, 36, 36, 36, 58);        // side streets
  road(w, 50, 36, 50, 58);

  const B = [
    [30, 34, 5, 6, 's'], [53, 33, 8, 7, 's'], [28, 52, 7, 6, 'n'], [53, 52, 9, 6, 'n'],
    [38, 40, 4, 4, 'e'], [45, 40, 4, 4, 'w'],
    [12, 40, 7, 6, 'e'], [70, 60, 9, 7, 'w'], [10, 18, 6, 5, 's'], [34, 8, 6, 5, 's'],
    [76, 36, 7, 6, 'w'], [20, 70, 8, 6, 'n'], [58, 78, 7, 6, 'n'], [84, 68, 5, 5, 'w'],
    [68, 22, 6, 5, 'e'], [40, 76, 6, 5, 'n'],
  ];
  for (const [x, y, bw, bh, d] of B) building(w, rnd, x, y, bw, bh, d);

  makeHome(w);

  for (const [x, y] of [[10, 10], [86, 30], [90, 52], [84, 84], [12, 84], [46, 88], [28, 14], [74, 76], [6, 58], [88, 8]])
    { disc(w, x, y, 2, T.DIRT); w.nests.push([x, y]); }

  w.zones = [
    { name: 'Fort Hollow', x: 43, y: 47, r: 18 }, { name: 'Dead Woods', x: 20, y: 18, r: 18 },
    { name: 'The Quarry', x: 20, y: 78, r: 16 }, { name: 'Riverlands', x: 76, y: 52, r: 16 },
    { name: 'Lakeshore', x: 80, y: 16, r: 16 }, { name: 'The Flats', x: 60, y: 84, r: 18 },
  ];
  return { w: W, h: W, tiles: w.tiles, home: [w.home.x, w.home.y], nests: w.nests, crates: w.crates, zones: w.zones };
}

export function fortHollowStamp() {
  const st = buildFortHollowStamp();
  st.ox = st.oy = (WORLD_SIZE - st.w) >> 1;
  return st;
}

// kind: 'fort-hollow' (authored town stamped into a generated world) | 'seeded' (fully generated)
export function newWorld(kind, seed) {
  if (kind === 'fort-hollow') {
    return new World({ kind, seed: 'fort-hollow', name: 'Fort Hollow', size: WORLD_SIZE, stamp: fortHollowStamp(), stampBuilt: 'fort-hollow' });
  }
  seed = String(seed || (Math.random() * 1e9) | 0);
  return new World({ kind: 'seeded', seed, name: `Seed ${seed}`, size: WORLD_SIZE, stamp: null });
}
