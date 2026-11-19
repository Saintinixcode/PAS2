import { TS } from '../tiles.js';

// ---------- collision ----------
export function blockedAt(game, px, py, r) {
  const w = game.world;
  const x0 = Math.floor((px - r) / TS), x1 = Math.floor((px + r) / TS);
  const y0 = Math.floor((py - r) / TS), y1 = Math.floor((py + r) / TS);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (w.solidAt(x, y)) return { x, y };
  return null;
}

// Moves with axis-separated sliding. Returns the first tile hit (or null).
export function move(game, e, dx, dy, r) {
  let hit = null;
  let b = game.blockedAt(e.x + dx, e.y, r);
  if (!b) e.x += dx; else hit = b;
  b = game.blockedAt(e.x, e.y + dy, r);
  if (!b) e.y += dy; else hit = hit || b;
  return hit;
}
