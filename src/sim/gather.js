import { T, TS } from '../tiles.js';
import { dist2 } from './constants.js';

// ---------- harvesting / looting ----------
export function findHarvest(game) {
  const p = game.p, w = game.world, tx = Math.floor(p.x / TS), ty = Math.floor(p.y / TS);
  let best = null, bd = (TS * 1.7) ** 2;
  for (let y = ty - 2; y <= ty + 2; y++) for (let x = tx - 2; x <= tx + 2; x++) {
    const t = w.get(x, y);
    if (t !== T.TREE && t !== T.ROCK) continue;
    const d = dist2((x + 0.5) * TS, (y + 0.5) * TS, p.x, p.y);
    if (d < bd) { bd = d; best = { kind: 'tile', x, y, t }; }
  }
  for (const c of w.crates) {
    if (c.looted) continue;
    const d = dist2((c.x + 0.5) * TS, (c.y + 0.5) * TS, p.x, p.y);
    if (d < bd) { bd = d; best = { kind: 'crate', c }; }
  }
  return best;
}

export function updateHarvest(game, dt) {
  game.harvestTarget = game.findHarvest();
  if (!game.input.harvest || !game.harvestTarget) { game.harvestT = 0; game.harvestKey = -1; game.harvestProgress = 0; return; }
  const h = game.harvestTarget;
  const key = h.kind === 'crate' ? 'c' + h.c.x + ',' + h.c.y : h.x + ',' + h.y;
  if (key !== game.harvestKey) { game.harvestKey = key; game.harvestT = 0; }
  const need = h.kind === 'crate' ? 0.5 : h.t === T.ROCK ? 1.5 : 0.9;
  game.harvestT += dt * game.s.harvest;
  game.harvestProgress = game.harvestT / need;
  if (game.harvestT < need) return;
  game.harvestT = 0; game.harvestKey = -1;
  const r = game.p.res;
  if (h.kind === 'crate') {
    h.c.looted = true;
    const n = 3 + ((game.rng() * 6) | 0); r.scrap += n;
    let extra = ''; if (game.rng() < 0.4) { const m = 2 + ((game.rng() * 4) | 0); r.wood += m; extra = `, ${m} wood`; }
    game.say(`Crate looted: ${n} scrap${extra}.`, 'good');
  } else if (h.t === T.TREE) {
    game.world.set(h.x, h.y, T.STUMP); r.wood += 2 + ((game.rng() * 2) | 0);
  } else {
    game.world.set(h.x, h.y, T.RUBBLE); r.stone += 2 + ((game.rng() * 2) | 0);
  }
}

// Woods slowly grow back, so the land is renewable but remembers what you did.
export function regrow(game) {
  const w = game.world, px = game.p.x / TS, py = game.p.y / TS;
  for (let i = 0; i < w.tiles.length; i++) {
    if (w.tiles[i] !== T.STUMP || game.rng() > 0.15) continue;
    const x = i % w.w, y = (i / w.w) | 0;
    if (Math.hypot(x - px, y - py) < 4) continue;
    w.tiles[i] = T.TREE; w.dirty = true;
  }
}
