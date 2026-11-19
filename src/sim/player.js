import { TS } from '../tiles.js';
import { dist2, AMMO_CAP } from './constants.js';
import { UPGRADES } from './upgrades.js';
import { getData, getTables } from '../core/data.js';

export function recalc(game) {
  const s = { rate: 0.55, damage: 10, count: 1, pierce: 0, range: 300, speed: 150, maxHp: 100, regen: 0, magnet: 70, harvest: 1, blades: 0 };
  for (const u of UPGRADES) for (let i = 0; i < (game.p.up[u.id] || 0); i++) u.apply(s);
  game.s = s;
  game.p.hp = Math.min(game.p.hp, s.maxHp);
}

// ---------- weapons: slot index into data/weapons.json key order (0 pistol, 1 bat) ----------
export function setWeapon(game, i) {
  const names = getTables().weaponNames;
  if (i < 0 || i >= names.length) return false;
  if (game.p.weapon === i && game.wdef) return true;
  game.p.weapon = i; game.wdef = getData().weapons[names[i]];
  game.p.reload = 0; // switching cancels a reload
  return true;
}

export function hurtPlayer(game, dmg) {
  game.p.hp -= dmg;
  game.events.push({ type: 'hurt' });
}

// TEMPORARY until the Crafting tab (Step 6): 5 scrap -> 5 rounds.
export function convertScrap(game) {
  const p = game.p;
  if (p.res.scrap < 5 || p.ammo >= AMMO_CAP) return false;
  p.res.scrap -= 5; p.ammo = Math.min(AMMO_CAP, p.ammo + 5);
  return true;
}

// ---------- death ----------
export function die(game) {
  game.dead = true; game.stats.deaths++;
  const r = game.p.res;
  for (const k in r) r[k] = Math.floor(r[k] / 2);
  game.p.ammo = Math.floor(game.p.ammo / 2); game.p.reload = 0;
  game.events.push({ type: 'death' });
}

export function respawn(game) {
  const h = game.world.home;
  game.p.x = (h.x + 0.5) * TS; game.p.y = (h.y + 2.5) * TS; game.p.hp = game.s.maxHp;
  const hx = (h.x + 0.5) * TS, hy = (h.y + 0.5) * TS;
  for (const e of game.enemies) if (dist2(e.x, e.y, hx, hy) <= 500 * 500) { e.dead = true; e.vanish = true; }
  game.reap();
  for (const b of game.bullets) game.bulletPool.push(b);
  game.bullets.length = 0; game.dead = false;
}
