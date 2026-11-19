import { T, TS, BUILDABLE_ON, BUILDS } from '../tiles.js';
import { dist2 } from './constants.js';

// ---------- building ----------
export function canBuildAt(game, tx, ty) {
  const p = game.p, w = game.world;
  if (!game.build) return false;
  const b = BUILDS[game.build - 1];
  if (dist2((tx + 0.5) * TS, (ty + 0.5) * TS, p.x, p.y) > (TS * 5) ** 2) return false;
  if (!BUILDABLE_ON[w.get(tx, ty)]) return false;
  if (Math.floor(p.x / TS) === tx && Math.floor(p.y / TS) === ty) return false;
  for (const k in b.cost) if (p.res[k] < b.cost[k]) return false;
  return true;
}

export function placeBuild(game, tx, ty) {
  if (!game.canBuildAt(tx, ty)) return false;
  const b = BUILDS[game.build - 1];
  for (const k in b.cost) game.p.res[k] -= b.cost[k];
  game.world.set(tx, ty, b.id);
  return true;
}

export function removeBuild(game, tx, ty) {
  const w = game.world, t = w.get(tx, ty);
  const b = BUILDS.find((q) => q.id === t);
  if (!b || dist2((tx + 0.5) * TS, (ty + 0.5) * TS, game.p.x, game.p.y) > (TS * 5) ** 2) return false;
  for (const k in b.cost) game.p.res[k] += Math.floor(b.cost[k] / 2);
  w.set(tx, ty, T.RUBBLE);
  return true;
}
