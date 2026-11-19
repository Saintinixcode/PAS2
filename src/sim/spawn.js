import { TS } from '../tiles.js';
import { MAX_ENEMIES, TUNING, dist2 } from './constants.js';

// ---------- spawning ----------
// Returns an enemy TYPE INDEX (into the compiled tables). Weights and unlock days come from data/enemies.json.
export function pickType(game) {
  const T = game.et, day = game.time.day;
  let total = 0;
  for (let i = 0; i < T.n; i++) if (T.minDay[i] <= day) total += T.weight[i];
  let r = game.rng() * total;
  for (let i = 0; i < T.n; i++) {
    if (T.minDay[i] > day) continue;
    r -= T.weight[i];
    if (r <= 0) return i;
  }
  return 0;
}

// `nest` is the owning nest object (nest-spawned) or falsy (ambient). Counters are kept incrementally, never recounted.
export function spawn(game, x, y, nest) {
  if (game.enemies.length >= MAX_ENEMIES) return null;
  const T = game.et, ti = game.pickType(), day = game.time.day;
  const hp = T.hp[ti] * (1 + (day - 1) * TUNING.hpScalePerDay);
  const e = {
    x, y, ti, type: T.names[ti], hp, maxHp: hp,
    speed: T.speed[ti] * (0.9 + game.rng() * 0.2), dmg: T.dmg[ti] * (1 + (day - 1) * TUNING.dmgScalePerDay),
    r: T.r[ti], xp: T.xp[ti], color: T.color[ti],
    nestRef: nest || null, hitCd: 0, bladeCd: 0, flash: 0, burn: false, bash: 0, kx: 0, ky: 0,
    shotCd: 0.8 + game.rng() * 1.2, dead: false, vanish: false,
  };
  game.enemies.push(e);
  if (nest) nest.live = (nest.live | 0) + 1; else game.nAmbient++;
  return e;
}

function aliveNests(world) {
  let a = 0;
  for (let i = 0; i < world.nests.length; i++) if (world.nests[i].alive) a++;
  return a;
}

export function spawnAmbient(game, dt) {
  const total = game.world.nests.length || 1, day = game.time.day;
  const intensity = 0.4 + 0.6 * (aliveNests(game.world) / total);
  const night = game.isNight;
  const rate = (night ? TUNING.ambientNightBase + day * TUNING.ambientNightPerDay : TUNING.ambientDay) * intensity;
  const cap = night ? Math.min(TUNING.ambientCapMax, TUNING.ambientCapNight + day * TUNING.ambientCapPerDay) : TUNING.ambientCapDay;
  game.spawnAcc += rate * dt;
  while (game.spawnAcc >= 1) {
    game.spawnAcc -= 1;
    if (game.nAmbient >= cap) continue;
    for (let tries = 0; tries < 8; tries++) {
      const a = game.rng() * Math.PI * 2, d = 520 + game.rng() * 160;
      const x = game.p.x + Math.cos(a) * d, y = game.p.y + Math.sin(a) * d;
      if (!game.blockedAt(x, y, 12) && !game.world.solidAt(Math.floor(x / TS), Math.floor(y / TS))) { game.spawn(x, y, false); break; }
    }
  }
}

export function nestSpawns(game, dt) {
  const day = game.time.day;
  const cap = Math.min(TUNING.nestCapMax, TUNING.nestCapBase + (day >> 1));
  for (const n of game.world.nests) {
    if (!n.alive) continue;
    const nx = (n.x + 0.5) * TS, ny = (n.y + 0.5) * TS;
    if (dist2(nx, ny, game.p.x, game.p.y) > 720 * 720) continue;
    n.cd -= dt * (game.isNight ? TUNING.nestNightSpeedup : 1);
    if (n.cd > 0) continue;
    n.cd = Math.max(TUNING.nestIntervalMin, TUNING.nestIntervalBase - day * TUNING.nestIntervalPerDay);
    if ((n.live | 0) < cap) {
      const a = game.rng() * Math.PI * 2;
      game.spawn(nx + Math.cos(a) * 40, ny + Math.sin(a) * 40, n);
    }
  }
}
