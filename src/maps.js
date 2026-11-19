import { T, SOLID } from './tiles.js';
import { World } from './world.js';
import { mulberry32, hashSeed, makeNoise } from './rng.js';

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
    w.crates.push({ x: cx, y: cy, looted: false });
  }
}
function road(w, x0, y0, x1, y1) { fill(w, x0, y0, x1, y1, T.ROAD); }

function makeHome(w) {
  const { x, y } = w.home;
  disc(w, x, y, 6, T.GRASS);
  disc(w, x, y, 3, T.DIRT);
  w.set(x, y, T.BEACON);
}

function reachableFrom(w, sx, sy) {
  const seen = new Uint8Array(w.w * w.h);
  const q = [sy * w.w + sx]; seen[q[0]] = 1;
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % w.w, y = (i / w.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!w.inb(nx, ny)) continue;
      const ni = ny * w.w + nx;
      // Built tiles and trees count as passable for reachability: zombies chew
      // through barricades and players can harvest trees.
      if (seen[ni] || w.get(nx, ny) === T.WALL || w.get(nx, ny) === T.WATER || w.get(nx, ny) === T.ROCK) continue;
      seen[ni] = 1; q.push(ni);
    }
  }
  return seen;
}

function addNest(w, x, y) {
  disc(w, x, y, 2, T.DIRT);
  w.nests.push({ x, y, hp: 260, maxHp: 260, alive: true, cd: 2 });
}

function placeNests(w, rnd, count, minHome, minSep) {
  const reach = reachableFrom(w, w.home.x, w.home.y);
  let tries = 0;
  while (w.nests.length < count && tries++ < 4000) {
    const x = 4 + ((rnd() * (w.w - 8)) | 0), y = 4 + ((rnd() * (w.h - 8)) | 0);
    if (Math.hypot(x - w.home.x, y - w.home.y) < minHome) continue;
    if (!reach[y * w.w + x] || SOLID[w.get(x, y)]) continue;
    if (w.nests.some((n) => Math.hypot(n.x - x, n.y - y) < minSep)) continue;
    addNest(w, x, y);
  }
}

// ---------- seeded world ----------
export function generateWorld(seed, size = 128) {
  const w = new World(size, size);
  w.kind = 'seeded'; w.seed = String(seed);
  const s = hashSeed(w.seed);
  const rnd = mulberry32(s);
  const n1 = makeNoise(s), n2 = makeNoise(s ^ 0x9e3779b9), n3 = makeNoise(s ^ 0x85ebca6b);

  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const e = n1(x * 0.05, y * 0.05, 4);
      const f = n2(x * 0.08, y * 0.08, 3);
      const r = n3(x * 0.1, y * 0.1, 3);
      let t = T.GRASS;
      if (e < 0.34) t = T.WATER;
      else if (r > 0.66) t = rnd() < 0.7 ? T.ROCK : T.DIRT;
      else if (f > 0.56) t = rnd() < 0.55 ? T.TREE : T.GRASS;
      else if (rnd() < 0.025) t = T.TREE;
      else if (rnd() < 0.03) t = T.DIRT;
      w.tiles[y * size + x] = t;
    }

  // Roads (they also act as bridges over water).
  const cols = [], rows = [];
  for (let k = 20; k < size - 10; k += 34) { cols.push(k + ((rnd() * 10) | 0) - 5); rows.push(k + ((rnd() * 10) | 0) - 5); }
  w.home = { x: (size / 2) | 0, y: (size / 2) | 0 };
  cols.push(w.home.x); rows.push(w.home.y);
  for (const x of cols) road(w, x, 0, x, size - 1);
  for (const y of rows) road(w, 0, y, size - 1, y);

  // Ruins
  let placed = 0, tries = 0;
  while (placed < 38 && tries++ < 600) {
    const bw = 5 + ((rnd() * 5) | 0), bh = 5 + ((rnd() * 4) | 0);
    const x = 3 + ((rnd() * (size - bw - 6)) | 0), y = 3 + ((rnd() * (size - bh - 6)) | 0);
    if (Math.hypot(x - w.home.x, y - w.home.y) < 14) continue;
    let ok = true;
    for (let yy = y - 1; yy <= y + bh && ok; yy++)
      for (let xx = x - 1; xx <= x + bw && ok; xx++) {
        const t = w.get(xx, yy);
        if (t === T.WATER || t === T.ROAD || t === T.WALL || t === T.FLOOR) ok = false;
      }
    if (!ok) continue;
    building(w, rnd, x, y, bw, bh, 'nesw'[(rnd() * 4) | 0]);
    placed++;
  }

  makeHome(w);
  w.zones.push({ name: 'Home Ground', x: w.home.x, y: w.home.y, r: 10 });
  placeNests(w, rnd, 10, 30, 16);
  return w;
}

// ---------- hand-authored world ----------
export function fortHollow() {
  const W = 96, w = new World(W, W);
  w.kind = 'fort-hollow'; w.seed = 'fort-hollow'; w.name = 'Fort Hollow';
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
    addNest(w, x, y);

  w.zones = [
    { name: 'Fort Hollow', x: 43, y: 47, r: 18 }, { name: 'Dead Woods', x: 20, y: 18, r: 18 },
    { name: 'The Quarry', x: 20, y: 78, r: 16 }, { name: 'Riverlands', x: 76, y: 52, r: 16 },
    { name: 'Lakeshore', x: 80, y: 16, r: 16 }, { name: 'The Flats', x: 60, y: 84, r: 18 },
  ];
  return w;
}

export function newWorld(kind, seed) {
  if (kind === 'fort-hollow') return fortHollow();
  const w = generateWorld(seed || String((Math.random() * 1e9) | 0));
  w.name = `Seed ${w.seed}`;
  return w;
}

export { reachableFrom };
