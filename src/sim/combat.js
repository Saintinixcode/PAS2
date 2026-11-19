import { TS, BLOCKS_SHOT } from '../tiles.js';
import { dist2, BASE_RATE } from './constants.js';
import { hurt } from './enemies.js';

// ---------- bullet pool ----------
// Bullets are recycled objects. The per-bullet `hit` array is a small fixed list (replaces a Set per bullet)
// that stops a piercing shot from hitting the same zombie on consecutive frames.
export function addBullet(game, x, y, vx, vy, dmg, life, pierce, friendly, hostile) {
  const b = game.bulletPool.pop() || { x: 0, y: 0, vx: 0, vy: 0, dmg: 0, life: 0, pierce: 0, hit: [null, null, null, null, null, null, null, null], hn: 0, friendly: true, hostile: false };
  b.x = x; b.y = y; b.vx = vx; b.vy = vy; b.dmg = dmg; b.life = life; b.pierce = pierce; b.hn = 0; b.friendly = friendly; b.hostile = hostile;
  game.bullets.push(b);
  return b;
}

// ---------- aiming ----------
export function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// ---------- weapons ----------
export function reload(game) {
  const p = game.p, w = game.wdef;
  if (w.kind !== 'ranged' || p.reload > 0 || p.mag >= w.mag || p.ammo <= 0) return false;
  p.reload = w.reload;
  return true;
}

function finishReload(game) {
  const p = game.p, w = game.wdef;
  const take = Math.min(w.mag - p.mag, p.ammo);
  p.mag += take; p.ammo -= take;
}

export function updateWeapon(game, dt) {
  const p = game.p, s = game.s, inp = game.input, w = game.wdef;
  p.facing = Math.atan2(inp.ay - p.y, inp.ax - p.x); // always tracks the cursor
  p.fireCd -= dt; p.clickCd -= dt; if (p.swing > 0) p.swing -= dt; p.flash = Math.max(0, p.flash - dt);
  if (p.reload > 0) { p.reload -= dt; if (p.reload <= 0) { p.reload = 0; finishReload(game); } }
  if (game.build) return; // in build mode the mouse places tiles instead of firing
  if (!(inp.fire || game.autoFire) || p.fireCd > 0) return;
  const ratio = s.rate / BASE_RATE; // Rapid Fire upgrades shorten every weapon's cooldown
  if (w.kind === 'melee') { swing(game, w, ratio); return; }
  if (p.reload > 0) return;
  if (p.mag <= 0) {
    if (p.ammo > 0) game.reload();
    else if (p.clickCd <= 0) { p.clickCd = 1.5; game.say('Out of ammo. Press 2 for the bat. V turns 5 scrap into 5 rounds.', 'warn'); }
    return;
  }
  p.fireCd = w.rate * ratio; p.mag--; p.flash = 0.06;
  const n = s.count, dmg = w.damage * (s.damage / 10), life = (w.range * (s.range / 300)) / w.speed;
  for (let i = 0; i < n; i++) {
    const a = p.facing + (i - (n - 1) / 2) * 0.14 + (game.rng() - 0.5) * 2 * w.spread;
    const c = Math.cos(a), sn = Math.sin(a);
    game.addBullet(p.x + c * 14, p.y + sn * 14, c * w.speed, sn * w.speed, dmg, life, s.pierce, true, false);
  }
  if (p.mag <= 0 && p.ammo > 0) game.reload(); // auto-reload when the magazine empties
}

function swing(game, w, ratio) {
  const p = game.p, s = game.s, E = game.enemies, half = w.arc / 2;
  p.fireCd = w.rate * ratio; p.swing = 0.16; p.swingDir = -(p.swingDir || 1); // alternate sweep direction
  const dmg = w.damage * (s.damage / 10);
  for (let i = 0; i < E.length; i++) {
    const e = E[i];
    if (e.dead) continue;
    const dx = e.x - p.x, dy = e.y - p.y, reach = w.range + e.r;
    const d2 = dx * dx + dy * dy;
    if (d2 > reach * reach) continue;
    if (Math.abs(angleDiff(Math.atan2(dy, dx), p.facing)) > half) continue;
    const d = Math.sqrt(d2) || 1;
    e.kx += (dx / d) * w.knockback; e.ky += (dy / d) * w.knockback;
    hurt(game, e, dmg);
  }
  for (const n of game.world.nests) { // melee is the efficient way to take down a nest
    if (!n.alive) continue;
    const dx = (n.x + 0.5) * TS - p.x, dy = (n.y + 0.5) * TS - p.y;
    if (dx * dx + dy * dy > (w.range + 22) * (w.range + 22)) continue;
    if (Math.abs(angleDiff(Math.atan2(dy, dx), p.facing)) > half + 0.3) continue;
    n.hp -= dmg * 0.75;
    if (n.hp <= 0) game.destroyNest(n);
  }
  game.fx.push({ k: 'slash', x: p.x, y: p.y, a: p.facing, r: w.range, arc: w.arc, t: 0.16, T: 0.16 });
}

export function updateTurrets(game, dt) {
  const w = game.world, E = game.enemies;
  for (const [idx, t] of w.turrets) {
    t.cd -= dt;
    if (t.cd > 0) continue;
    const tx = (idx % w.w + 0.5) * TS, ty = ((idx / w.w | 0) + 0.5) * TS;
    let best = null, bd = 240 * 240;
    for (let i = 0; i < E.length; i++) { const e = E[i]; if (e.dead) continue; const d = dist2(e.x, e.y, tx, ty); if (d < bd) { bd = d; best = e; } }
    if (!best) continue;
    t.cd = 0.5;
    const a = Math.atan2(best.y - ty, best.x - tx);
    game.addBullet(tx, ty, Math.cos(a) * 520, Math.sin(a) * 520, 9 + game.time.day, 0.6, 0, false, false);
  }
}

export function updateBlades(game, dt) {
  const n = game.s.blades; if (!n) return;
  game.bladeAng += dt * 3.2;
  const p = game.p, E = game.enemies;
  for (let b = 0; b < n; b++) {
    const a = game.bladeAng + (b * Math.PI * 2) / n;
    const bx = p.x + Math.cos(a) * 52, by = p.y + Math.sin(a) * 52;
    for (let i = 0; i < E.length; i++) {
      const e = E[i];
      if (e.dead || e.bladeCd > 0) continue;
      if (dist2(e.x, e.y, bx, by) < (e.r + 9) * (e.r + 9)) { e.bladeCd = 0.35; hurt(game, e, 9 + game.time.day); }
    }
  }
}

export function updateBullets(game, dt) {
  const w = game.world, list = game.bullets, grid = game.grid, p = game.p, E = game.enemies;
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    let dead = b.life <= 0;
    if (!dead && BLOCKS_SHOT[w.get(Math.floor(b.x / TS), Math.floor(b.y / TS))]) dead = true;
    if (!dead && b.hostile) {
      if (dist2(p.x, p.y, b.x, b.y) < 13 * 13) { game.hurtPlayer(b.dmg); dead = true; }
    } else if (!dead) {
      const nb = grid.query(b.x, b.y);
      outer:
      for (let q = 0; q < nb; q++) {
        for (let j = grid.head[grid.near[q]]; j !== -1; j = grid.next[j]) {
          const e = E[j];
          if (e.dead) continue;
          let seen = false;
          for (let k = 0; k < b.hn; k++) if (b.hit[k] === e) { seen = true; break; }
          if (seen) continue;
          if (dist2(e.x, e.y, b.x, b.y) < (e.r + 4) * (e.r + 4)) {
            if (b.hn < 8) b.hit[b.hn++] = e;
            hurt(game, e, b.dmg);
            if (b.pierce-- <= 0) { dead = true; break outer; }
          }
        }
      }
      if (!dead) {
        for (const n of w.nests) {
          if (!n.alive) continue;
          if (dist2((n.x + 0.5) * TS, (n.y + 0.5) * TS, b.x, b.y) < 20 * 20) {
            n.hp -= b.dmg; dead = true;
            if (n.hp <= 0) game.destroyNest(n);
            break;
          }
        }
      }
    }
    if (dead) { list[i] = list[list.length - 1]; list.pop(); game.bulletPool.push(b); }
  }
}

export function destroyNest(game, n) {
  if (!n.alive) return;
  n.alive = false; game.stats.nests++;
  const nx = (n.x + 0.5) * TS, ny = (n.y + 0.5) * TS;
  for (let k = 0; k < 4; k++) game.drops.push({ x: nx + (game.rng() - 0.5) * 70, y: ny + (game.rng() - 0.5) * 70, kind: 0, n: 8, life: 180 });
  for (let k = 0; k < 6; k++) game.drops.push({ x: nx + (game.rng() - 0.5) * 70, y: ny + (game.rng() - 0.5) * 70, kind: 1, n: 3 + (game.time.day >> 1), life: 180 });
  game.addXp(30 + game.time.day * 2);
  let left = 0;
  for (const q of game.world.nests) if (q.alive) left++;
  game.say(left ? `Nest destroyed! Loot dropped. ${left} remain.` : 'The last nest is destroyed. This land is yours.', 'good');
  game.events.push({ type: 'nest' });
  game.save_needed = true;
}
