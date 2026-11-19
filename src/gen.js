// Deterministic world generator. Everything here is a pure function of (spec), so a chunk can be
// thrown away and regenerated identically, and a save only needs the chunks the player changed.
//
// spec = { kind, seed, size, stamp }  stamp = { ox, oy, w, h, home:[x,y], nests:[[x,y]], crates:[[x,y]], zones, tiles? }
// (stamp coordinates are relative to its (ox, oy) corner; tiles is absent for migrated saves, whose
// stamp area lives in the saved chunks instead.)
import { T } from './tiles.js';
import { hashSeed, makeNoise, mulberry32 } from './rng.js';

export const CS = 16;           // tiles per chunk side
export const CSH = 4;           // log2(CS)
export const NEST_HP = 260;

const WATER_LEVEL = 0.34;
const RUIN_CELL = 28, NEST_CELL = 64;

// hash of integers to [0, 1)
function h3(a, b, c) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function makeGen(spec) {
  const size = spec.size, seed = hashSeed(spec.seed), stamp = spec.stamp || null;
  const s32 = seed | 0;
  const n1 = makeNoise(seed), n2 = makeNoise(seed ^ 0x9e3779b9), n3 = makeNoise(seed ^ 0x85ebca6b);
  const home = stamp ? { x: stamp.ox + stamp.home[0], y: stamp.oy + stamp.home[1] } : { x: size >> 1, y: size >> 1 };
  const carveHome = !stamp; // generated worlds get a cleared beacon clearing; stamps bring their own
  const inStamp = (x, y, m = 0) => !!stamp && x >= stamp.ox - m && y >= stamp.oy - m && x < stamp.ox + stamp.w + m && y < stamp.oy + stamp.h + m;

  // roads: a sparse jittered grid that also bridges water; the home row/column always has one
  const rr = mulberry32(seed ^ 0x51ed270b);
  const roadCol = new Uint8Array(size), roadRow = new Uint8Array(size);
  for (let k = 40; k < size - 20; k += 64) {
    roadCol[Math.min(size - 1, k + ((rr() * 16) | 0) - 8)] = 1;
    roadRow[Math.min(size - 1, k + ((rr() * 16) | 0) - 8)] = 1;
  }
  roadCol[home.x] = 1; roadRow[home.y] = 1;

  const elev = (x, y) => n1(x * 0.05, y * 0.05, 4);

  function terrain(x, y) {
    const e = elev(x, y), d = Math.hypot(x - home.x, y - home.y);
    if (e < WATER_LEVEL && d > 22) return T.WATER;
    if (n3(x * 0.1, y * 0.1, 3) > 0.66) return h3(x, y, s32) < 0.7 ? T.ROCK : T.DIRT;
    if (n2(x * 0.08, y * 0.08, 3) > 0.56) return h3(x, y, s32) < 0.55 ? T.TREE : T.GRASS;
    const u = h3(x, y, s32);
    if (u < 0.025) return T.TREE;
    if (u > 0.97) return T.DIRT;
    return T.GRASS;
  }

  // ---- ruins: at most one per 28x28 cell, wholly inside it ----
  const ruinCache = new Map();
  function ruin(i, j) {
    const key = i * 4096 + j;
    if (ruinCache.has(key)) return ruinCache.get(key);
    let r = null;
    const rnd = mulberry32((seed ^ Math.imul(i + 1, 73856093) ^ Math.imul(j + 1, 19349663)) >>> 0);
    if (rnd() < 0.5) {
      const bw = 5 + ((rnd() * 5) | 0), bh = 5 + ((rnd() * 4) | 0);
      const x = i * RUIN_CELL + 2 + ((rnd() * (RUIN_CELL - bw - 4)) | 0), y = j * RUIN_CELL + 2 + ((rnd() * (RUIN_CELL - bh - 4)) | 0);
      const door = 'nesw'[(rnd() * 4) | 0], mx = x + (bw >> 1), my = y + (bh >> 1);
      const gap = { n: [mx, y], s: [mx, y + bh - 1], w: [x, my], e: [x + bw - 1, my] }[door];
      let broken = null;
      if (rnd() < 0.5) broken = [[mx + 1, y], [mx + 1, y + bh - 1], [x, my + 1], [x + bw - 1, my + 1]][(rnd() * 4) | 0];
      let crate = null;
      if (rnd() < 0.85) crate = [x + 1 + ((rnd() * (bw - 2)) | 0), y + 1 + ((rnd() * (bh - 2)) | 0)];
      const ok = x + bw < size - 2 && y + bh < size - 2 && Math.hypot(mx - home.x, my - home.y) >= 14 && !inStamp(x, y, 4) && !inStamp(x + bw, y + bh, 4)
        && elev(x, y) >= WATER_LEVEL && elev(x + bw, y + bh) >= WATER_LEVEL && elev(x, y + bh) >= WATER_LEVEL && elev(x + bw, y) >= WATER_LEVEL && elev(mx, my) >= WATER_LEVEL;
      if (ok) r = { x, y, bw, bh, gap, broken, crate };
    }
    ruinCache.set(key, r);
    return r;
  }

  // ---- global entity lists (positions only; live state is kept by the World) ----
  const nests = [], crates = [];
  if (stamp) {
    for (const [x, y] of stamp.nests) nests.push({ x: stamp.ox + x, y: stamp.oy + y });
    for (const [x, y] of stamp.crates) crates.push({ x: stamp.ox + x, y: stamp.oy + y });
  }
  for (let j = 0; j < size / NEST_CELL; j++) for (let i = 0; i < size / NEST_CELL; i++) {
    const rnd = mulberry32((seed ^ Math.imul(i + 7, 83492791) ^ Math.imul(j + 3, 2654435761)) >>> 0);
    if (rnd() >= 0.8) continue;
    const x = i * NEST_CELL + 6 + ((rnd() * (NEST_CELL - 12)) | 0), y = j * NEST_CELL + 6 + ((rnd() * (NEST_CELL - 12)) | 0);
    if (Math.hypot(x - home.x, y - home.y) < 48 || inStamp(x, y, 3) || elev(x, y) < WATER_LEVEL) continue;
    nests.push({ x, y });
  }
  for (let j = 0; j < size / RUIN_CELL; j++) for (let i = 0; i < size / RUIN_CELL; i++) {
    const r = ruin(i, j); if (r && r.crate) crates.push({ x: r.crate[0], y: r.crate[1] });
  }
  const byChunk = new Map(); // chunk index -> { nests: [], crates: [] }
  const cw = size >> CSH;
  const bucket = (x, y) => { const k = (y >> CSH) * cw + (x >> CSH); let b = byChunk.get(k); if (!b) byChunk.set(k, (b = { nests: [], crates: [] })); return b; };
  for (const n of nests) bucket(n.x, n.y).nests.push(n);
  for (const c of crates) bucket(c.x, c.y).crates.push(c);
  const EMPTY = { nests: [], crates: [] };

  const zones = stamp ? stamp.zones.map((z) => ({ name: z.name, x: stamp.ox + z.x, y: stamp.oy + z.y, r: z.r })) : [];

  // ---- one chunk of tiles ----
  function tiles(cx, cy) {
    const out = new Uint8Array(CS * CS), x0 = cx * CS, y0 = cy * CS, st = stamp && stamp.tiles;
    for (let ly = 0; ly < CS; ly++) for (let lx = 0; lx < CS; lx++) {
      const x = x0 + lx, y = y0 + ly;
      let t;
      if (st && inStamp(x, y)) t = st[(y - stamp.oy) * stamp.w + (x - stamp.ox)];
      else {
        t = terrain(x, y);
        if (roadCol[x] || roadRow[y]) t = T.ROAD;
        if (carveHome) {
          const d = Math.hypot(x - home.x, y - home.y);
          if (d <= 6) t = d <= 3 ? T.DIRT : T.GRASS;
          if (x === home.x && y === home.y) t = T.BEACON;
        }
      }
      out[ly * CS + lx] = t;
    }
    // ruins from the cells overlapping this chunk
    for (let j = Math.max(0, Math.floor(y0 / RUIN_CELL)); j <= Math.floor((y0 + CS - 1) / RUIN_CELL); j++)
      for (let i = Math.max(0, Math.floor(x0 / RUIN_CELL)); i <= Math.floor((x0 + CS - 1) / RUIN_CELL); i++) {
        const r = ruin(i, j); if (!r) continue;
        for (let yy = Math.max(r.y, y0); yy < Math.min(r.y + r.bh, y0 + CS); yy++)
          for (let xx = Math.max(r.x, x0); xx < Math.min(r.x + r.bw, x0 + CS); xx++) {
            const edge = yy === r.y || yy === r.y + r.bh - 1 || xx === r.x || xx === r.x + r.bw - 1;
            let t = edge ? T.WALL : T.FLOOR;
            if (xx === r.gap[0] && yy === r.gap[1]) t = T.FLOOR;
            else if (r.broken && xx === r.broken[0] && yy === r.broken[1]) t = T.RUBBLE;
            out[(yy - y0) * CS + (xx - x0)] = t;
          }
      }
    // nest clearings
    const b = byChunk.get(cy * cw + cx) || EMPTY;
    for (const n of b.nests) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = n.x + dx - x0, y = n.y + dy - y0;
      if (dx * dx + dy * dy <= 4 && x >= 0 && y >= 0 && x < CS && y < CS && !(st && inStamp(n.x + dx, n.y + dy))) out[y * CS + x] = T.DIRT;
    }
    return out;
  }

  const tier = (x, y) => { const d = Math.hypot(x - home.x, y - home.y); return d < 64 ? 0 : d < 120 ? 1 : d < 180 ? 2 : 3; };
  const TIER_NAMES = ['Outskirts', 'The Wilds', 'Deep Wilds', 'Dead Reach'];

  return {
    home, tiles, tier, zones, nests, crates,
    entities: (cx, cy) => byChunk.get(cy * cw + cx) || EMPTY,
    zoneName(x, y) {
      let best = null, bd = 1e9;
      for (const z of zones) { const d = Math.hypot(z.x - x, z.y - y); if (d <= z.r && d < bd) { best = z.name; bd = d; } }
      return best || TIER_NAMES[tier(x, y)];
    },
  };
}
