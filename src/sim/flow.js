import { T, TS, BREAKABLE } from '../tiles.js';
import { FLOW_R, INF } from './constants.js';

// ---------- zombie flow field (so they path around walls, and bash barricades) ----------
export function passCost(game, t) {
  if (t === T.WATER || t === T.WALL || t === T.ROCK || t === T.TREE || t === T.BEACON) return -1;
  if (BREAKABLE[t]) return 9;
  return 1;
}

export function buildFlow(game) {
  const S = FLOW_R * 2 + 1, w = game.world;
  const ptx = Math.floor(game.p.x / TS), pty = Math.floor(game.p.y / TS);
  game.flowOx = ptx - FLOW_R; game.flowOy = pty - FLOW_R;
  const ff = game.flow; ff.fill(INF);
  const start = FLOW_R * S + FLOW_R;
  ff[start] = 0;
  const buckets = [[start]];
  for (let c = 0; c < buckets.length; c++) {
    const b = buckets[c]; if (!b) continue;
    for (let k = 0; k < b.length; k++) {
      const i = b[k]; if (ff[i] !== c) continue;
      const x = i % S, y = (i / S) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
        const cost = game.passCost(w.get(game.flowOx + nx, game.flowOy + ny));
        if (cost < 0) continue;
        if (dx && dy && (game.passCost(w.get(game.flowOx + x + dx, game.flowOy + y)) < 0 || game.passCost(w.get(game.flowOx + x, game.flowOy + y + dy)) < 0)) continue;
        const ni = ny * S + nx, nc = c + cost;
        if (nc < ff[ni]) { ff[ni] = nc; (buckets[nc] || (buckets[nc] = [])).push(ni); }
      }
    }
  }
}

function setDirect(out, px, py) { const d = Math.hypot(px, py) || 1; out.x = px / d; out.y = py / d; }

// Writes the unit direction a zombie at `e` should walk into game.dir (reused object: no per-zombie allocation).
export function flowDir(game, e) {
  const S = FLOW_R * 2 + 1, w = game.world, out = game.dir;
  const tx = Math.floor(e.x / TS) - game.flowOx, ty = Math.floor(e.y / TS) - game.flowOy;
  const px = game.p.x - e.x, py = game.p.y - e.y;
  if (tx < 1 || ty < 1 || tx >= S - 1 || ty >= S - 1) return setDirect(out, px, py);
  const here = game.flow[ty * S + tx];
  if (here >= INF || here <= 1) return setDirect(out, px, py);
  let best = here, bx = 0, by = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    if (dx && dy && (game.passCost(w.get(game.flowOx + tx + dx, game.flowOy + ty)) < 0 || game.passCost(w.get(game.flowOx + tx, game.flowOy + ty + dy)) < 0)) continue;
    const v = game.flow[(ty + dy) * S + tx + dx];
    if (v < best) { best = v; bx = dx; by = dy; }
  }
  if (!bx && !by) return setDirect(out, px, py);
  // aim at the centre of the chosen tile
  const cx = (game.flowOx + tx + bx + 0.5) * TS - e.x, cy = (game.flowOy + ty + by + 0.5) * TS - e.y;
  const d = Math.hypot(cx, cy) || 1;
  out.x = cx / d; out.y = cy / d;
}
