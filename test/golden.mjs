// Golden-state regression: a fully seeded 400 s simulation (building, fighting, levelling, dying).
// The final-state hash must not change during pure refactors. Print with `node test/golden.mjs`.
import { Game } from '../src/game.js';
import { newWorld } from '../src/maps.js';
import { mulberry32 } from '../src/rng.js';
import { T, TS } from '../src/tiles.js';

import { loadData } from '../src/core/data.js';
await loadData();

// Refactors must not change this. A deliberate gameplay change updates it (see Step notes in PLAN.md).
// Updated in Step 1 (91c20ff3 -> 5ff15ed3 -> 6beaf091 after playtest tweaks: bat 24->17 dmg, 5 scrap = 5 ammo) on purpose: mouse-aimed finite-ammo combat, cap 220 -> 60,
// new spawn tuning, spitter/bloater types, XP on kill, ground drops. Any other change here is a regression.
export const EXPECTED = '6beaf091';

export function runGolden() {
  const g = new Game(newWorld('fort-hollow'));
  g.rng = mulberry32(42);
  const dt = 1 / 30;
  let deaths = 0;
  for (let f = 0; f < 12000; f++) {
    const t = f * dt;
    g.input.x = Math.cos(t * 0.35); g.input.y = Math.sin(t * 0.27); g.input.harvest = f % 90 < 60;
    // aim at the nearest live enemy (else sweep), hold fire, swap weapons and reload on a schedule
    let best = null, bd = 1e12;
    for (const e of g.enemies) { if (e.dead) continue; const d = (e.x - g.p.x) ** 2 + (e.y - g.p.y) ** 2; if (d < bd) { bd = d; best = e; } }
    g.input.ax = best ? best.x : g.p.x + Math.cos(t); g.input.ay = best ? best.y : g.p.y + Math.sin(t);
    g.input.fire = f % 240 < 200;
    if (f % 1500 === 700) g.setWeapon(1); if (f % 1500 === 0) g.setWeapon(0); if (f % 500 === 250) g.reload();
    if (f % 800 === 400) g.convertScrap();
    if (f === 100) { // exercise building + turrets + walls
      g.p.res = { wood: 40, stone: 40, scrap: 40 };
      const px = Math.floor(g.p.x / TS), py = Math.floor(g.p.y / TS);
      g.build = 1; g.placeBuild(px + 2, py); g.placeBuild(px + 2, py + 1);
      g.build = 2; g.placeBuild(px - 2, py); g.build = 3; g.placeBuild(px, py + 2);
      g.build = 0;
    }
    if (f === 4000) { const n = g.world.nests[0]; n.hp = 0; g.destroyNest(n); }
    g.update(dt);
    for (const ev of g.events.splice(0)) {
      if (ev.type === 'levelup') g.chooseUpgrade(ev.choices[0].id);
      if (ev.type === 'death') { deaths++; g.respawn(); }
    }
  }
  const r = (v) => Math.round(v * 100);
  const state = {
    p: [r(g.p.x), r(g.p.y), r(g.p.hp), g.p.xp, g.p.level, g.p.res, g.p.up],
    time: [g.time.day, r(g.time.clock)], stats: g.stats, deaths,
    enemies: g.enemies.map((e) => [e.type, r(e.x), r(e.y), r(e.hp)]),
    bullets: g.bullets.length, drops: g.drops.map((d) => [d.kind, d.n, r(d.x), r(d.y)]), ammo: [g.p.ammo, g.p.mag, g.p.weapon], nAmbient: g.nAmbient,
    nests: g.world.nests.map((n) => [n.alive, r(n.hp)]),
    crates: g.world.crates.filter((c) => c.looted).length,
    tiles: [...g.world.tiles].reduce((h, t) => (Math.imul(h, 31) + t) | 0, 0),
    tileHp: [...g.world.tileHp.entries()], turrets: g.world.turrets.size,
  };
  const s = JSON.stringify(state);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return { hash: (h >>> 0).toString(16), kills: g.stats.kills, day: g.time.day, level: g.p.level, deaths, enemies: g.enemies.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runGolden();
  console.log(JSON.stringify(r));
  if (process.argv.includes('--check')) {
    if (r.hash !== EXPECTED) { console.error(`GOLDEN MISMATCH: got ${r.hash}, expected ${EXPECTED}`); process.exit(1); }
    console.log('golden ok');
  }
}
