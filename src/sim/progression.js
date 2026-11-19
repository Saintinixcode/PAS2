import { dist2, AMMO_CAP } from './constants.js';
import { UPGRADES } from './upgrades.js';

// Ground drops (ammo, scrap). Step 3 generalises these into item drops (zombie parts etc.).
export function updateDrops(game, dt) {
  const p = game.p, mg = game.s.magnet, list = game.drops;
  for (let i = list.length - 1; i >= 0; i--) {
    const d = list[i], d2 = dist2(d.x, d.y, p.x, p.y);
    d.life -= dt;
    if (d2 < mg * mg) {
      const dd = Math.sqrt(d2) || 1, sp = 340;
      d.x += ((p.x - d.x) / dd) * sp * dt; d.y += ((p.y - d.y) / dd) * sp * dt;
    }
    if (d2 < 14 * 14) {
      if (d.kind === 0) p.ammo = Math.min(AMMO_CAP, p.ammo + d.n); else p.res.scrap += d.n;
      list[i] = list[list.length - 1]; list.pop();
    } else if (d.life <= 0) { list[i] = list[list.length - 1]; list.pop(); }
  }
}

export function addXp(game, v) {
  const p = game.p; p.xp += v;
  while (p.xp >= game.xpNeeded()) { p.xp -= game.xpNeeded(); p.level++; p.pending++; }
  if (p.pending > 0 && !game.choices) game.offerUpgrades();
}

export function offerUpgrades(game) {
  const pool = UPGRADES.filter((u) => (game.p.up[u.id] || 0) < u.max);
  const picks = [];
  while (picks.length < 3 && pool.length) picks.push(pool.splice((game.rng() * pool.length) | 0, 1)[0]);
  if (!picks.length) { game.p.pending = 0; return; }
  game.choices = picks; game.paused = true;
  game.events.push({ type: 'levelup', choices: picks });
}

export function chooseUpgrade(game, id) {
  game.p.up[id] = (game.p.up[id] || 0) + 1;
  game.p.pending--; game.choices = null;
  const old = game.s.maxHp; game.recalc();
  if (game.s.maxHp > old) game.p.hp += game.s.maxHp - old;
  game.paused = false;
  if (game.p.pending > 0) game.offerUpgrades();
}
