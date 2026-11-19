import { TS, BREAKABLE } from '../tiles.js';
import { dist2 } from './constants.js';
import { FLAG_RANGED, FLAG_EXPLODES } from '../core/data.js';

// Enemies are never spliced mid-frame. They are flagged `dead`, skipped by every system, and compacted
// once at the end of the frame by reap(). That keeps spatial-grid indices valid for the whole frame.

export function hurt(game, e, dmg) {
  if (e.dead) return;
  e.hp -= dmg; e.flash = 0.1;
  if (e.hp <= 0) kill(game, e);
}

function kill(game, e) {
  if (e.dead) return;
  e.dead = true;
  killEnemy(game, e);
}

export function updateEnemies(game, dt) {
  const p = game.p, w = game.world, T = game.et, list = game.enemies, grid = game.grid, dir = game.dir;
  grid.clear();
  for (let i = 0; i < list.length; i++) if (!list[i].dead) grid.add(i, list[i].x, list[i].y);

  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.dead) continue;
    if (e.burn) { e.hp -= 30 * dt; if (e.hp <= 0) { kill(game, e); continue; } }
    e.flash = Math.max(0, e.flash - dt); e.hitCd -= dt; e.bladeCd -= dt;
    const ti = e.ti, dpx = p.x - e.x, dpy = p.y - e.y, dp2 = dpx * dpx + dpy * dpy;
    // despawn strays that are very far away (no kill credit, no drops)
    if (dp2 > 1400 * 1400) { e.dead = true; e.vanish = true; continue; }

    let vx, vy;
    if (T.flags[ti] & FLAG_RANGED) {
      // spitters keep their distance and lob acid
      const dp = Math.sqrt(dp2) || 1;
      if (dp < T.keepMin[ti]) { vx = (-dpx / dp) * e.speed; vy = (-dpy / dp) * e.speed; }
      else if (dp < T.keepMax[ti]) { vx = 0; vy = 0; }
      else { game.flowDir(e); vx = dir.x * e.speed; vy = dir.y * e.speed; }
      e.shotCd -= dt;
      if (e.shotCd <= 0 && dp < T.keepMax[ti] + 80) {
        e.shotCd = T.shotRate[ti];
        const sp = T.shotSpeed[ti], dmg = T.shotDmg[ti] * (e.dmg / T.dmg[ti]);
        game.addBullet(e.x, e.y, (dpx / dp) * sp, (dpy / dp) * sp, dmg, 1.8, 0, false, true);
      }
    } else {
      game.flowDir(e); vx = dir.x * e.speed; vy = dir.y * e.speed;
    }

    // soft separation from neighbours (spatial grid, no allocation)
    const nb = grid.query(e.x, e.y);
    for (let q = 0; q < nb; q++) {
      for (let j = grid.head[grid.near[q]]; j !== -1; j = grid.next[j]) {
        if (j === i) continue;
        const o = list[j];
        const ox = e.x - o.x, oy = e.y - o.y, d2 = ox * ox + oy * oy, rr = e.r + o.r;
        if (d2 > 0 && d2 < rr * rr) { const d = Math.sqrt(d2); vx += (ox / d) * 40; vy += (oy / d) * 40; }
      }
    }
    // knockback impulse decays quickly
    vx += e.kx; vy += e.ky;
    const decay = Math.max(0, 1 - 9 * dt); e.kx *= decay; e.ky *= decay;

    const hit = game.move(e, vx * dt, vy * dt, e.r * 0.8);
    if (hit && BREAKABLE[w.get(hit.x, hit.y)]) {
      e.bash += dt;
      if (e.bash >= 0.5) { e.bash = 0; if (w.damageTile(hit.x, hit.y, e.dmg * 1.5)) game.say('A defence was torn down!', 'warn'); }
    }
    if (dp2 < (e.r + 9) * (e.r + 9) && e.hitCd <= 0) { e.hitCd = 0.7; game.hurtPlayer(e.dmg); }
  }
}

// Called once when an enemy dies from damage. XP is awarded directly (no gems); loot lands on the ground as drops.
export function killEnemy(game, e) {
  const T = game.et, ti = e.ti, rng = game.rng;
  game.stats.kills++;
  game.addXp(e.xp);
  if (rng() < T.dropChance[ti]) {
    const scale = T.dropScale[ti];
    if (rng() < 0.65) game.drops.push({ x: e.x, y: e.y, kind: 0, n: Math.round((3 + ((rng() * 4) | 0)) * scale), life: 120 });
    else game.drops.push({ x: e.x, y: e.y, kind: 1, n: Math.round((1 + ((rng() * 3) | 0)) * scale), life: 120 });
  }
  if (T.flags[ti] & FLAG_EXPLODES) burst(game, e);
}

// Bloater pop: hurts the player and chews built defences nearby.
function burst(game, e) {
  const T = game.et, ti = e.ti, p = game.p, w = game.world;
  const r = T.burstR[ti], dmg = T.burstDmg[ti] * (e.dmg / T.dmg[ti]);
  if (dist2(e.x, e.y, p.x, p.y) < r * r) game.hurtPlayer(dmg);
  const tr = Math.ceil(r / TS), tx0 = Math.floor(e.x / TS), ty0 = Math.floor(e.y / TS);
  for (let ty = ty0 - tr; ty <= ty0 + tr; ty++) for (let tx = tx0 - tr; tx <= tx0 + tr; tx++) {
    if (BREAKABLE[w.get(tx, ty)] && dist2((tx + 0.5) * TS, (ty + 0.5) * TS, e.x, e.y) < r * r) w.damageTile(tx, ty, dmg * 1.5);
  }
  game.fx.push({ k: 'burst', x: e.x, y: e.y, r, t: 0.4, T: 0.4 });
}

// Compact the enemy list once per frame and update the incremental counters.
export function reap(game) {
  const list = game.enemies;
  let j = 0;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.dead) { if (e.nestRef) e.nestRef.live--; else game.nAmbient--; continue; }
    list[j++] = e;
  }
  list.length = j;
}
