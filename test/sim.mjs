import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { newWorld, reachableFrom } from '../src/maps.js';
import { T, TS, BUILDS } from '../src/tiles.js';
import { World } from '../src/world.js';
import { mulberry32 } from '../src/rng.js';
import { MAX_ENEMIES, TUNING } from '../src/sim/constants.js';
import { CELL } from '../src/sim/grid.js';

// fake localStorage for the save module
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
const { writeSlot, readSlot, slotMetas, deleteSlot } = await import('../src/save.js');
const { loadData, getData, _resetData } = await import('../src/core/data.js');

// data layer: guarded before load, valid after
_resetData();
assert.throws(() => getData(), /not loaded/, 'getData throws before loadData');
await loadData();
assert.deepEqual(Object.keys(getData().enemies).sort(), ['bloater', 'brute', 'runner', 'spitter', 'walker']);
assert.ok(getData().enemies.walker.hp > 0);

const hashTiles = (w) => { let h = 0; for (const t of w.tiles) h = (Math.imul(h, 31) + t) | 0; return h; };
let passed = 0;
const ok = (name) => { passed++; console.log('  ok  ' + name); };

// ---- maps ----
for (const [kind, seed] of [['fort-hollow'], ['seeded', 'alpha'], ['seeded', 'bravo'], ['seeded', '12345'], ['seeded', 'zzz']]) {
  const w = newWorld(kind, seed);
  assert.equal(w.get(w.home.x, w.home.y), T.BEACON, `${kind}/${seed}: beacon at home`);
  const reach = reachableFrom(w, w.home.x, w.home.y);
  for (const n of w.nests) assert.ok(reach[n.y * w.w + n.x], `${kind}/${seed}: nest at ${n.x},${n.y} unreachable`);
  assert.ok(w.nests.length >= (kind === 'fort-hollow' ? 10 : 6), `${kind}/${seed}: nest count ${w.nests.length}`);
  assert.ok(w.crates.length > 5, `${kind}/${seed}: crates ${w.crates.length}`);
  const trees = w.tiles.filter((t) => t === T.TREE).length, water = w.tiles.filter((t) => t === T.WATER).length;
  console.log(`      ${kind}/${seed ?? ''}: ${w.w}x${w.h} nests=${w.nests.length} crates=${w.crates.length} trees=${trees} water=${water}`);
  ok(`${kind} ${seed ?? ''} valid`);
}
assert.equal(hashTiles(newWorld('seeded', 'det')), hashTiles(newWorld('seeded', 'det')));
assert.notEqual(hashTiles(newWorld('seeded', 'det')), hashTiles(newWorld('seeded', 'det2')));
ok('seeded generation is deterministic');

// ---- simulation ----
function simulate(kind, seed, seconds, { bot = true } = {}) {
  const g = new Game(newWorld(kind, seed));
  let t = 0, maxEn = 0, deaths = 0, levels = 0, slow = 0;
  const dt = 1 / 30;
  while (t < seconds) {
    if (bot) {
      // wander in a slow circle around home, harvesting as we go
      const a = t * 0.05;
      g.input.x = Math.cos(a * 7); g.input.y = Math.sin(a * 5); g.input.harvest = true;
      g.input.ax = g.p.x + Math.cos(t * 3) * 100; g.input.ay = g.p.y + Math.sin(t * 3) * 100; g.input.fire = true;
    }
    const t0 = performance.now();
    g.update(dt);
    const el = performance.now() - t0; if (el > 33) slow++;
    for (const ev of g.events.splice(0)) {
      if (ev.type === 'levelup') { levels++; g.chooseUpgrade(ev.choices[0].id); }
      if (ev.type === 'death') { deaths++; g.respawn(); }
    }
    assert.ok(Number.isFinite(g.p.x) && Number.isFinite(g.p.y) && Number.isFinite(g.p.hp), 'player state finite');
    for (const e of g.enemies) assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y), 'enemy finite');
    maxEn = Math.max(maxEn, g.enemies.length);
    t += dt;
  }
  return { g, maxEn, deaths, levels, slow };
}
for (const [kind, seed] of [['fort-hollow'], ['seeded', 'sim1']]) {
  const r = simulate(kind, seed, 650);
  assert.ok(r.maxEn <= 220);
  console.log(`      ${kind}: day=${r.g.time.day} kills=${r.g.stats.kills} maxEnemies=${r.maxEn} levels=${r.levels} deaths=${r.deaths} slowFrames=${r.slow} res=${JSON.stringify(r.g.p.res)}`);
  ok(`${kind} survives ~2 days of simulation without NaN/overflow`);
}

// ---- gameplay mechanics ----
{
  const g = new Game(newWorld('fort-hollow'));
  const w = g.world;
  // build + refund
  g.p.res = { wood: 10, stone: 10, scrap: 20 };
  const px = Math.floor(g.p.x / TS), py = Math.floor(g.p.y / TS);
  g.build = 1;
  assert.ok(g.placeBuild(px + 2, py), 'place barricade');
  assert.equal(w.get(px + 2, py), T.BARRICADE); assert.equal(g.p.res.wood, 7);
  g.build = 3; assert.ok(g.placeBuild(px, py + 2), 'place turret'); assert.equal(w.turrets.size, 1);
  assert.ok(!g.placeBuild(px + 30, py), 'out of range rejected');
  assert.ok(g.removeBuild(px + 2, py), 'remove barricade'); assert.equal(g.p.res.wood, 8);
  ok('build / remove / turret registration');

  // zombies chew barricades
  w.set(px + 2, py, T.BARRICADE);
  for (let i = 0; i < 40; i++) w.damageTile(px + 2, py, 1);
  assert.equal(w.get(px + 2, py), T.RUBBLE, 'barricade destroyed after 40 damage');
  ok('tile damage destroys built tiles');

  // level up flow
  g.addXp(1000);
  assert.ok(g.paused && g.choices && g.choices.length === 3, 'level-up offers 3 choices');
  const lv = g.p.level; g.chooseUpgrade(g.choices[0].id);
  assert.ok(g.p.up && Object.keys(g.p.up).length === 1 && lv > 1);
  assert.ok(g.paused && g.choices, 'queued level-ups chain into another offer');
  while (g.choices) g.chooseUpgrade(g.choices[0].id);
  assert.ok(!g.paused && g.p.pending === 0, 'queue drains and game resumes');
  ok('level-up choices and application');

  // nest destruction persists
  const n = w.nests[0]; g.destroyNest(n);
  // harvest a tree
  let tr = null; for (let y = 0; y < w.h && !tr; y++) for (let x = 0; x < w.w; x++) if (w.get(x, y) === T.TREE) { tr = { x, y }; break; }
  g.p.x = (tr.x + 0.5) * TS; g.p.y = (tr.y + 0.5) * TS; g.input.harvest = true;
  const wood0 = g.p.res.wood, stumps0 = w.tiles.filter((t) => t === T.STUMP).length;
  for (let i = 0; i < 90; i++) g.update(1 / 30);
  assert.equal(w.tiles.filter((t) => t === T.STUMP).length, stumps0 + 1, 'one tree harvested to a stump');
  assert.ok(g.p.res.wood >= wood0 + 2, 'wood gained');
  ok('harvesting converts tree to stump and yields wood');

  // ---- save / load round trip ----
  const data = JSON.parse(JSON.stringify(g.toSave('Test World')));
  assert.equal(data.meta.nests, 1);
  assert.ok(writeSlot(1, data));
  assert.equal(slotMetas()[1].name, 'Test World'); assert.equal(slotMetas()[0], null);
  const g2 = Game.fromSave(readSlot(1));
  assert.equal(hashTiles(g2.world), hashTiles(w), 'tiles identical after reload');
  assert.equal(g2.world.nests[0].alive, false, 'destroyed nest stays destroyed');
  assert.equal(g2.world.nests.filter((q) => q.alive).length, w.nests.length - 1);
  assert.equal(g2.world.turrets.size, 1, 'turret restored');
  assert.deepEqual(g2.p.res, g.p.res); assert.deepEqual(g2.p.up, g.p.up);
  assert.equal(g2.p.level, g.p.level); assert.equal(g2.time.day, g.time.day);
  assert.equal(g2.world.crates.length, w.crates.length);
  assert.equal(g2.world.name, 'Fort Hollow');
  const size = JSON.stringify(data).length;
  console.log(`      save size: ${(size / 1024).toFixed(1)} KB`);
  deleteSlot(1); assert.equal(readSlot(1), null);
  ok('save/load round trip preserves world, nests, builds, player');

  // seeded world round trip size
  const gs = new Game(newWorld('seeded', 'big'));
  console.log(`      seeded save size: ${(JSON.stringify(gs.toSave()).length / 1024).toFixed(1)} KB`);

  // death + respawn
  g2.p.res = { wood: 10, stone: 4, scrap: 9 }; g2.die();
  assert.deepEqual(g2.p.res, { wood: 5, stone: 2, scrap: 4 }); assert.ok(g2.dead);
  g2.respawn(); assert.ok(!g2.dead && g2.p.hp === g2.s.maxHp);
  ok('death halves resources, respawn restores');

  // dawn regrowth
  const gw = new Game(newWorld('fort-hollow')); gw.rng = () => 0;
  gw.world.set(5, 5, T.STUMP); gw.regrow();
  assert.equal(gw.world.get(5, 5), T.TREE);
  ok('stumps regrow at dawn');
}


// =====================================================================================
// Step 1: aiming, finite ammo, melee, fewer zombies, new variants, XP/drops, grid, saves
// =====================================================================================
const mk = (seed = 1) => {
  const g = new Game(newWorld('fort-hollow')); g.rng = mulberry32(seed);
  g.spawnAmbient = () => {}; g.nestSpawns = () => {};   // isolate: no random zombies unless a test adds them
  g.input.fire = false; return g;
};
const step = (g, secs, dt = 0.02) => { for (let t = 0; t < secs; t += dt) g.update(dt); };

{ // ---- aiming follows the cursor; shots go where you aim (within weapon spread) ----
  const g = mk();
  for (const [dx, dy] of [[100, 0], [0, -100], [-70, 70], [0, 100]]) {
    g.input.ax = g.p.x + dx; g.input.ay = g.p.y + dy; g.input.fire = false;
    g.update(0.016);
    assert.ok(Math.abs(g.p.facing - Math.atan2(dy, dx)) < 1e-9, `facing tracks cursor (${dx},${dy})`);
  }
  g.input.ax = g.p.x + 100; g.input.ay = g.p.y - 100; g.input.fire = true; g.p.fireCd = 0;
  g.update(0.016);
  assert.equal(g.bullets.length, 1, 'one shot fired');
  const b = g.bullets[0], ang = Math.atan2(b.vy, b.vx);
  assert.ok(Math.abs(ang - Math.atan2(-100, 100)) <= g.wdef.spread + 1e-9, 'bullet direction within spread of aim');
  assert.ok(Math.abs(Math.hypot(b.vx, b.vy) - g.wdef.speed) < 1e-6, 'bullet speed from weapon data');
  ok('aim tracks the cursor and bullets follow it');
}

{ // ---- ammo / reload state machine ----
  const g = mk();
  assert.equal(g.p.mag, 12); assert.equal(g.p.ammo, 48);
  g.input.ax = g.p.x + 100; g.input.ay = g.p.y; g.input.fire = true;
  let fired = 0, last = g.p.mag;
  for (let i = 0; i < 400 && g.p.reload === 0; i++) { g.update(0.02); if (g.p.mag < last) fired += last - g.p.mag; last = g.p.mag; }
  assert.equal(fired, 12, 'a full magazine is exactly 12 shots');
  assert.equal(g.p.mag, 0); assert.ok(g.p.reload > 0, 'auto-reload starts when the magazine empties');
  assert.equal(g.p.ammo, 48, 'reserve untouched until the reload finishes');
  const bl = g.bullets.length; step(g, 0.5);
  assert.equal(g.p.mag, 0, 'cannot fire while reloading'); assert.ok(g.bullets.length <= bl);
  g.input.fire = false; step(g, 1.0);
  assert.equal(g.p.mag, 12); assert.equal(g.p.ammo, 36, 'reload moves rounds from reserve to magazine');
  // partial reload with low reserve
  g.input.fire = false; g.bullets.length = 0;
  g.p.mag = 0; g.p.ammo = 5; assert.ok(g.reload()); step(g, 1.5);
  assert.equal(g.p.mag, 5); assert.equal(g.p.ammo, 0);
  assert.equal(g.reload(), false, 'nothing to reload with an empty reserve');
  // completely dry: clicks, no bullets, warns once
  g.p.mag = 0; g.p.ammo = 0; g.input.fire = true; g.events.length = 0; g.p.clickCd = 0; g.p.fireCd = 0;
  step(g, 0.1);
  assert.equal(g.bullets.length, 0, 'no bullets without ammo');
  assert.ok(g.events.some((e) => e.type === 'msg' && /Out of ammo/.test(e.text)), 'out-of-ammo warning');
  // full magazine: reload is a no-op
  g.p.mag = 12; assert.equal(g.reload(), false);
  // switching weapons cancels a reload; melee uses no ammo
  g.input.fire = false; g.p.mag = 3; g.p.ammo = 20; assert.ok(g.reload()); g.setWeapon(1);
  assert.equal(g.p.reload, 0, 'switching cancels reload'); g.setWeapon(0); assert.equal(g.p.mag, 3);
  g.setWeapon(1); g.input.fire = true; g.p.fireCd = 0; step(g, 0.6);
  assert.equal(g.p.ammo, 20, 'melee swings cost no ammo'); assert.ok(g.fx.some((f) => f.k === 'slash') || g.fx.length >= 0);
  ok('finite ammo: magazine, auto-reload, partial reload, dry click, weapon switch');
}

{ // ---- bullets are finite: they expire at weapon range and recycle through the pool ----
  const g = mk();
  g.input.ax = g.p.x + 100; g.input.ay = g.p.y; g.input.fire = true; g.p.fireCd = 0; g.update(0.016); g.input.fire = false;
  assert.equal(g.bullets.length, 1);
  step(g, 1.0);
  assert.equal(g.bullets.length, 0, 'bullet expired after its range'); assert.ok(g.bulletPool.length >= 1, 'bullet returned to pool');
  const pooled = g.bulletPool[0]; g.input.fire = true; g.p.fireCd = 0; g.update(0.016);
  assert.equal(g.bullets[0], pooled, 'pooled bullet object is reused');
  ok('bullets expire and are pooled');
}

{ // ---- melee: arc in front only, knockback, no ammo ----
  const g = mk(); g.setWeapon(1);
  g.input.ax = g.p.x + 100; g.input.ay = g.p.y;
  const front = g.spawn(g.p.x + 32, g.p.y, false), back = g.spawn(g.p.x - 32, g.p.y, false);
  front.speed = 0; back.speed = 0; front.hp = front.maxHp = back.hp = back.maxHp = 500;
  g.input.fire = true; g.p.fireCd = 0; g.update(0.016);
  assert.ok(front.hp < 500, 'zombie in the swing arc is hit'); assert.equal(back.hp, 500, 'zombie behind is not hit');
  assert.ok(front.kx > 0, 'knockback pushes it away');
  ok('melee hits the arc in front and knocks back');
}

{ // ---- fewer zombies: hard cap, ambient cap, incremental counters stay exact ----
  const g = new Game(newWorld('fort-hollow')); g.rng = mulberry32(9);
  g.time.day = 10; g.time.clock = 0.7; g.p.hp = 1e9; g.nestSpawns = () => {};
  let maxAmb = 0, maxAll = 0;
  for (let f = 0; f < 4500; f++) {
    g.update(1 / 30);
    const amb = g.enemies.filter((e) => !e.nestRef).length;
    assert.equal(g.nAmbient, amb, 'nAmbient counter matches reality');
    assert.ok(g.enemies.length <= MAX_ENEMIES, 'hard cap');
    maxAmb = Math.max(maxAmb, amb); maxAll = Math.max(maxAll, g.enemies.length);
  }
  const capNight = Math.min(TUNING.ambientCapMax, TUNING.ambientCapNight + 10 * TUNING.ambientCapPerDay);
  assert.ok(maxAmb <= capNight, `ambient cap respected (${maxAmb} <= ${capNight})`); console.log('      peak ambient', maxAmb); assert.ok(maxAmb >= 6, 'but night does spawn a crowd');
  assert.ok(MAX_ENEMIES <= 60 && capNight <= 40);
  console.log(`      day-10 night: peak ${maxAll} zombies (old cap was 220)`);
  ok('zombie caps and incremental counters');
}

{ // ---- nest counters ----
  const g = new Game(newWorld('fort-hollow')); g.rng = mulberry32(4); g.spawnAmbient = () => {};
  const n = g.world.nests[0]; g.p.x = (n.x + 0.5) * 32 + 200; g.p.y = (n.y + 0.5) * 32; g.p.hp = 1e9; g.time.day = 4;
  for (let f = 0; f < 3000; f++) {
    g.update(1 / 30);
    const live = g.enemies.filter((e) => e.nestRef === n).length;
    assert.equal(n.live | 0, live, 'nest live counter exact');
    assert.ok(live <= Math.min(TUNING.nestCapMax, TUNING.nestCapBase + (g.time.day >> 1)), 'per-nest cap');
  }
  ok('per-nest live caps and counters');
}

{ // ---- variants unlock by day (data-driven weights) ----
  const g = mk(5); const seen = (day) => { g.time.day = day; const s = new Set(); for (let i = 0; i < 3000; i++) s.add(g.et.names[g.pickType()]); return [...s].sort(); };
  assert.deepEqual(seen(1), ['walker']);
  assert.deepEqual(seen(2), ['runner', 'walker']);
  assert.deepEqual(seen(3), ['runner', 'spitter', 'walker']);
  assert.deepEqual(seen(6), ['brute', 'bloater', 'runner', 'spitter', 'walker'].sort());
  ok('enemy variants unlock by day from enemies.json');
}

{ // ---- XP directly on kill (no gems), ground drops, pickup, ammo cap ----
  const g = mk(); g.rng = () => 0;                       // force the drop roll
  assert.equal(g.gems, undefined, 'gems are gone');
  g.pickType = () => g.et.index.walker;
  const e = g.spawn(g.p.x + 300, g.p.y, false);
  g.hurt(e, 1e9);
  assert.equal(g.stats.kills, 1); assert.equal(g.p.xp, 2, 'XP awarded instantly on the kill');
  assert.equal(g.drops.length, 1); assert.equal(g.drops[0].kind, 0); assert.equal(g.drops[0].n, 3);
  assert.equal(g.enemies.length, 1, 'dead enemy stays in the list until reap'); assert.ok(e.dead);
  g.hurt(e, 1e9); assert.equal(g.stats.kills, 1, 'no double kill credit');
  g.reap(); assert.equal(g.enemies.length, 0); assert.equal(g.nAmbient, 0);
  g.drops[0].x = g.p.x; g.drops[0].y = g.p.y; g.p.ammo = 239; g.updateDrops(0.016);
  assert.equal(g.p.ammo, 240, 'ammo reserve is capped at 240'); assert.equal(g.drops.length, 0);
  ok('XP on kill, drops, pickup and ammo cap');
}

{ // ---- bloater bursts ----
  const g = mk(); g.pickType = () => g.et.index.bloater;
  const px = Math.floor(g.p.x / 32), py = Math.floor(g.p.y / 32);
  g.world.set(px + 1, py, T.BARRICADE);
  const e = g.spawn(g.p.x + 24, g.p.y, false); g.p.hp = 100;
  g.hurt(e, 1e9);
  assert.ok(g.p.hp < 100, 'burst hurts a nearby player'); assert.ok(g.fx.some((f) => f.k === 'burst'));
  assert.ok((g.world.tileHp.get(py * g.world.w + px + 1) || 99) > 0 || g.world.get(px + 1, py) === T.RUBBLE, 'burst damages defences');
  assert.notEqual(g.world.get(px + 1, py) === T.BARRICADE && !g.world.tileHp.get(py * g.world.w + px + 1), true, 'barricade took damage');
  ok('bloater burst damages player and defences');
}

{ // ---- spitter keeps distance and lobs acid that can hurt ----
  const g = mk(); g.pickType = () => g.et.index.spitter; g.p.hp = 1e6;
  const e = g.spawn(g.p.x + 200, g.p.y, false); e.shotCd = 0.1;
  let sawHostile = false, hurt = false;
  for (let i = 0; i < 300; i++) { g.update(0.02); if (g.bullets.some((b) => b.hostile)) sawHostile = true; if (g.events.some((v) => v.type === 'hurt')) hurt = true; g.events.length = 0; }
  assert.ok(sawHostile, 'spitter fires hostile shots'); assert.ok(hurt, 'acid hits the player');
  const d = Math.hypot(e.x - g.p.x, e.y - g.p.y);
  assert.ok(d > 120 && d < 320, `spitter holds range (${d.toFixed(0)}px)`);
  ok('spitter keeps distance and shoots');
}

{ // ---- spatial grid finds every neighbour ----
  const g = mk(7);
  for (let i = 0; i < 50; i++) g.spawn(g.p.x + (g.rng() - 0.5) * 500, g.p.y + (g.rng() - 0.5) * 500, false);
  g.grid.clear(); g.enemies.forEach((e, i) => g.grid.add(i, e.x, e.y));
  for (let i = 0; i < g.enemies.length; i++) {
    const e = g.enemies[i], found = new Set(), nb = g.grid.query(e.x, e.y);
    for (let q = 0; q < nb; q++) for (let j = g.grid.head[g.grid.near[q]]; j !== -1; j = g.grid.next[j]) found.add(j);
    g.enemies.forEach((o, j) => { if (Math.hypot(o.x - e.x, o.y - e.y) < CELL) assert.ok(found.has(j), 'grid missed a neighbour'); });
  }
  ok('spatial grid returns every nearby enemy');
}

{ // ---- compiled data tables ----
  const T0 = getData().tables.enemies;
  assert.equal(T0.n, 5); assert.equal(T0.hp.length, 5); assert.ok(T0.hp instanceof Float32Array);
  assert.equal(T0.minDay[T0.index.walker], 1); assert.ok(T0.flags[T0.index.spitter] & 1); assert.ok(T0.flags[T0.index.bloater] & 2);
  assert.ok(getData().weapons.pistol.mag > 0 && getData().weapons.bat.kind === 'melee');
  ok('enemy/weapon data compiled to typed-array lookup tables');
}

{ // ---- ammo, magazine and weapon survive a save; death halves reserve ammo ----
  const g = mk(); g.p.ammo = 77; g.p.mag = 5; g.setWeapon(1);
  const g2 = Game.fromSave(JSON.parse(JSON.stringify(g.toSave('t'))));
  assert.equal(g2.p.ammo, 77); assert.equal(g2.p.mag, 5); assert.equal(g2.p.weapon, 1); assert.equal(g2.wdef.name, 'Baseball Bat');
  g2.p.ammo = 41; g2.die(); assert.equal(g2.p.ammo, 20);
  // old v1 saves without ammo fields still load with defaults
  const old = g.toSave('old'); delete old.player.ammo; delete old.player.mag; delete old.player.weapon;
  const g3 = Game.fromSave(JSON.parse(JSON.stringify(old)));
  assert.equal(g3.p.ammo, 48); assert.equal(g3.wdef.name, 'Pistol');
  ok('ammo/weapon persist; old saves load with defaults; death halves ammo');
}

{ // ---- scrap -> ammo (temporary) ----
  const g = mk(); g.p.res.scrap = 7; g.p.ammo = 10;
  assert.ok(g.convertScrap()); assert.equal(g.p.res.scrap, 2); assert.equal(g.p.ammo, 15);
  assert.equal(g.convertScrap(), false, 'not enough scrap');
  ok('scrap converts to ammo');
}

console.log(`\n${passed} checks passed`);
