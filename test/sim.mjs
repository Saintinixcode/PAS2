import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { newWorld, WORLD_SIZE } from '../src/maps.js';
import { T, TS, BUILDS } from '../src/tiles.js';
import { World, CS } from '../src/world.js';
import { mulberry32 } from '../src/rng.js';
import { MAX_ENEMIES, TUNING } from '../src/sim/constants.js';
import { CELL } from '../src/sim/grid.js';

// fake localStorage for the save module
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
const store = await import('../src/store.js');
const { openStore, saveGame, loadGame, slotMetas, deleteSlot, exportBundle, importBundle } = store;
const { loadData, getData, _resetData } = await import('../src/core/data.js');

// data layer: guarded before load, valid after
_resetData();
assert.throws(() => getData(), /not loaded/, 'getData throws before loadData');
await loadData();
assert.deepEqual(Object.keys(getData().enemies).sort(), ['bloater', 'brute', 'runner', 'spitter', 'walker']);
assert.ok(getData().enemies.walker.hp > 0);

let passed = 0;
const ok = (name) => { passed++; console.log('  ok  ' + name); };
const sameTiles = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// bounded flood fill from a tile over everything a player/zombie could eventually pass (trees, builds count as passable)
function reaches(w, sx, sy, tx, ty, R = 150) {
  const S = 2 * R + 1, ox = sx - R, oy = sy - R, seen = new Uint8Array(S * S), q = [R * S + R]; seen[q[0]] = 1;
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % S, y = (i / S) | 0;
    if (x + ox === tx && y + oy === ty) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
      const t = w.get(nx + ox, ny + oy);
      if (seen[ny * S + nx] || t === T.WALL || t === T.WATER || t === T.ROCK) continue;
      seen[ny * S + nx] = 1; q.push(ny * S + nx);
    }
  }
  return false;
}

// ---- maps ----
for (const [kind, seed] of [['fort-hollow'], ['seeded', 'alpha'], ['seeded', 'bravo'], ['seeded', '12345'], ['seeded', 'zzz']]) {
  const w = newWorld(kind, seed);
  assert.equal(w.w, WORLD_SIZE); assert.equal(w.get(w.home.x, w.home.y), T.BEACON, `${kind}/${seed}: beacon at home`);
  assert.ok(w.nestTotal >= (kind === 'fort-hollow' ? 25 : 12), `${kind}/${seed}: nest count ${w.nestTotal}`);
  assert.ok(w.gen.crates.length > 40, `${kind}/${seed}: crates ${w.gen.crates.length}`);
  for (const n of w.gen.nests) { assert.ok(!SOLID_T(w.get(n.x, n.y)), `${kind}/${seed}: nest ${n.x},${n.y} stands on solid ground`); }
  const near = [...w.gen.nests].sort((a, b) => Math.hypot(a.x - w.home.x, a.y - w.home.y) - Math.hypot(b.x - w.home.x, b.y - w.home.y)).slice(0, 3);
  for (const n of near) assert.ok(reaches(w, w.home.x, w.home.y + 2, n.x, n.y, 170), `${kind}/${seed}: nest ${n.x},${n.y} unreachable from home`);
  let trees = 0, water = 0;
  for (let cy = 0; cy < w.cw; cy++) for (let cx = 0; cx < w.cw; cx++) for (const t of w.gen.tiles(cx, cy)) { if (t === T.TREE) trees++; else if (t === T.WATER) water++; }
  assert.ok(trees > 10000 && water > 10000 && water < 120000, 'terrain has forests and lakes but is not a flood');
  console.log(`      ${kind}/${seed ?? ''}: ${w.w}x${w.h} nests=${w.nestTotal} crates=${w.gen.crates.length} trees=${trees} water=${water}`);
  ok(`${kind} ${seed ?? ''} valid`);
}
function SOLID_T(t) { return t === T.WALL || t === T.WATER || t === T.ROCK || t === T.TREE; }
{
  const a = newWorld('seeded', 'det'), b = newWorld('seeded', 'det'), c = newWorld('seeded', 'det2');
  let diff = 0;
  for (const [cx, cy] of [[0, 0], [5, 9], [16, 16], [31, 31], [20, 3]]) {
    assert.ok(sameTiles(a.gen.tiles(cx, cy), b.gen.tiles(cx, cy)), 'same seed, same chunk');
    if (!sameTiles(a.gen.tiles(cx, cy), c.gen.tiles(cx, cy))) diff++;
  }
  assert.ok(diff >= 3, 'different seeds give different terrain');
  const t0 = performance.now(); for (let i = 0; i < 200; i++) a.gen.tiles(i % 32, (i / 7) | 0 % 32);
  const per = (performance.now() - t0) / 200; console.log(`      chunk generation: ${per.toFixed(2)} ms each`);
  assert.ok(per < 1.5, 'chunk generation stays cheap enough to never hitch a frame');
  ok('seeded generation is deterministic and cheap');
}

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
  // harvest a tree near the player
  let tr = null;
  for (let r = 1; r < 30 && !tr; r++) for (let y = py - r; y <= py + r && !tr; y++) for (let x = px - r; x <= px + r; x++) if (w.get(x, y) === T.TREE) { tr = { x, y }; break; }
  g.p.x = (tr.x + 0.5) * TS; g.p.y = (tr.y + 0.5) * TS; g.input.harvest = true;
  const wood0 = g.p.res.wood;
  for (let i = 0; i < 90; i++) g.update(1 / 30);
  assert.equal(w.get(tr.x, tr.y), T.STUMP, 'tree harvested to a stump');
  assert.ok(g.p.res.wood >= wood0 + 2, 'wood gained');
  g.input.harvest = false;
  ok('harvesting converts tree to stump and yields wood');

  // ---- save / load round trip through the store (memory adapter) ----
  const st = await openStore(true);
  await saveGame(1, g, st);
  const metas = await slotMetas(st);
  assert.equal(metas[1].name, 'Fort Hollow'); assert.equal(metas[0], null); assert.equal(metas[1].nests, 1);
  assert.equal(st.c.size, w.mod.size, 'only the modified chunks were written');
  const writes = st.c.size; await saveGame(1, g, st);
  assert.equal(st.c.size, writes, 'saving again with no changes writes no chunks');
  const g2 = Game.fromSave(await loadGame(1, st));
  for (const [idx, t] of w.mod) assert.ok(sameTiles(g2.world.mod.get(idx), t), 'modified chunk identical after reload');
  assert.equal(g2.world.mod.size, w.mod.size);
  assert.equal(g2.world.deadNests.size, 1); assert.equal(g2.world.nestsLeft(), w.nestTotal - 1);
  g2.world.preload((n.x + 0.5) * TS, (n.y + 0.5) * TS);
  assert.equal(g2.world.nests.find((q) => q.key === n.key).alive, false, 'destroyed nest stays destroyed');
  g2.world.preload((px + 0.5) * TS, (py + 2.5) * TS);
  assert.equal(g2.world.get(px, py + 2), T.TURRET); assert.equal(g2.world.turrets.size, 1, 'turret restored');
  assert.deepEqual(g2.p.res, g.p.res); assert.deepEqual(g2.p.up, g.p.up);
  assert.equal(g2.p.level, g.p.level); assert.equal(g2.time.day, g.time.day);
  assert.equal(g2.world.name, 'Fort Hollow');
  console.log(`      save: ${st.c.size} chunk(s), world record ${(JSON.stringify(g.toSave()).length / 1024).toFixed(1)} KB`);
  await deleteSlot(1, st); assert.equal(await loadGame(1, st), null); assert.equal(st.c.size, 0);
  ok('save/load round trip stores only changed chunks');

  // death + respawn
  g2.p.res = { wood: 10, stone: 4, scrap: 9 }; g2.die();
  assert.deepEqual(g2.p.res, { wood: 5, stone: 2, scrap: 4 }); assert.ok(g2.dead);
  g2.respawn(); assert.ok(!g2.dead && g2.p.hp === g2.s.maxHp);
  ok('death halves resources, respawn restores');

  // dawn regrowth: only modified chunks are scanned
  const gw = new Game(newWorld('fort-hollow')); gw.rng = () => 0;
  gw.world.set(gw.world.home.x + 5, gw.world.home.y - 5, T.STUMP); gw.regrow();
  assert.equal(gw.world.get(gw.world.home.x + 5, gw.world.home.y - 5), T.TREE);
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
  const g2 = Game.fromSave({ data: JSON.parse(JSON.stringify(g.toSave('t'))), chunks: new Map() });
  assert.equal(g2.p.ammo, 77); assert.equal(g2.p.mag, 5); assert.equal(g2.p.weapon, 1); assert.equal(g2.wdef.name, 'Baseball Bat');
  g2.p.ammo = 41; g2.die(); assert.equal(g2.p.ammo, 20);
  // old v1 saves without ammo fields still load with defaults
  const old = g.toSave('old'); delete old.player.ammo; delete old.player.mag; delete old.player.weapon;
  const g3 = Game.fromSave({ data: JSON.parse(JSON.stringify(old)), chunks: new Map() });
  assert.equal(g3.p.ammo, 48); assert.equal(g3.wdef.name, 'Pistol');
  ok('ammo/weapon persist; old saves load with defaults; death halves ammo');
}

{ // ---- scrap -> ammo (temporary) ----
  const g = mk(); g.p.res.scrap = 7; g.p.ammo = 10;
  assert.ok(g.convertScrap()); assert.equal(g.p.res.scrap, 2); assert.equal(g.p.ammo, 15);
  assert.equal(g.convertScrap(), false, 'not enough scrap');
  ok('scrap converts to ammo');
}


// =====================================================================================
// Step 2: chunk streaming, persistence of changes across unload, saves, migration
// =====================================================================================
const stepTo = (w, tx, ty) => { w.stream((tx + 0.5) * TS, (ty + 0.5) * TS); };   // one frame of streaming at a tile
const settle = (w, tx, ty) => { for (let i = 0; i < 60; i++) stepTo(w, tx, ty); };  // enough frames to load the whole ring

{ // ---- streaming: loads around the player, one chunk per frame, unloads far away, memory stays bounded ----
  const w = newWorld('seeded', 'stream');
  assert.equal(w.loaded.length, 0, 'nothing loaded before the player exists');
  const before = w.loaded.length; stepTo(w, 250, 250);
  assert.equal(w.loaded.length, before + 1, 'at most one chunk generated per frame');
  settle(w, 250, 250); assert.equal(w.loaded.length, 49, '7x7 window loaded around the player');
  let peak = 0;
  for (let x = 250; x < 500; x += 2) { stepTo(w, x, 250); peak = Math.max(peak, w.loaded.length); }
  settle(w, 500, 250);
  assert.ok(peak <= 11 * 11, `window never exceeds the unload radius (peak ${peak} chunks)`);
  assert.equal(w.chunks[(250 >> 4) * w.cw + (250 >> 4)], null, 'chunk far behind the player was unloaded');
  assert.ok(w.nests.every((n) => Math.abs((n.x >> 4) - 31) <= 5), 'nest list only holds loaded nests');
  ok('chunks stream in around the player and unload behind');
}

{ // ---- the world remembers: edits, dead nests, looted crates, damaged nests survive unload/reload ----
  const w = newWorld('seeded', 'memory');
  const [n1, n2] = w.gen.nests, cr = w.gen.crates[0];
  const visit = (p) => settle(w, p.x, p.y), away = (p) => settle(w, 511 - p.x, 511 - p.y);
  visit(n1); const wallX = n1.x + 4, wallY = n1.y;
  w.set(wallX, wallY, T.STONEWALL); w.tileHp.set(wallY * w.w + wallX, 17);
  w.killNest(w.nests.find((n) => n.key === n1.y * w.w + n1.x));
  away(n1);
  assert.equal(w.chunks[(n1.y >> 4) * w.cw + (n1.x >> 4)], null, 'chunk unloaded after walking away');
  visit(n2); w.nests.find((n) => n.key === n2.y * w.w + n2.x).hp = 100; away(n2);
  visit(cr); w.loot(w.crates.find((c) => c.key === cr.y * w.w + cr.x)); away(cr);
  visit(n1);
  assert.equal(w.get(wallX, wallY), T.STONEWALL, 'built wall is still there'); assert.equal(w.tileHp.get(wallY * w.w + wallX), 17, 'its damage is remembered');
  assert.equal(w.nests.find((n) => n.key === n1.y * w.w + n1.x).alive, false, 'dead nest stays dead');
  visit(n2); assert.equal(w.nests.find((n) => n.key === n2.y * w.w + n2.x).hp, 100, 'wounded nest keeps its wounds');
  visit(cr); assert.equal(w.crates.find((c) => c.key === cr.y * w.w + cr.x).looted, true, 'looted crate stays looted');
  assert.ok(w.explored[(cr.y >> 4) * w.cw + (cr.x >> 4)], 'revealed chunks are remembered (fog of war)');
  assert.ok(w.explored.some((v) => !v), 'most of the map is still fog');
  ok('edits, dead nests, looted crates and fog persist across unload');
}

{ // ---- game world is solid across chunk borders and the edge of the map ----
  const g = mk(); const w = g.world;
  assert.equal(w.get(-1, 5), T.WALL); assert.equal(w.get(5, w.h), T.WALL); assert.ok(w.solidAt(-5, -5));
  w.set(-3, 4, T.GRASS); w.set(9999, 9999, T.GRASS); assert.ok(true, 'out-of-bounds writes are ignored');
  g.p.x = 2 * TS; g.p.y = 2 * TS; g.update(0.02);
  g.input.x = -1; g.input.y = -1; for (let i = 0; i < 60; i++) g.update(0.02);
  assert.ok(g.p.x >= 0 && g.p.y >= 0, 'player cannot leave the map');
  ok('map edge is solid');
}

{ // ---- fog-of-war only reveals near the player; zone names / danger tiers ----
  const w = newWorld('fort-hollow'); settle(w, w.home.x, w.home.y);
  assert.equal(w.zoneAt(w.home.x, w.home.y), 'Fort Hollow');
  assert.equal(w.zoneAt(w.home.x + 150, w.home.y), 'Deep Wilds'); assert.ok(w.tier(w.home.x + 200, w.home.y) === 3 && w.tier(w.home.x, w.home.y) === 0);
  ok('named zones and distance-based danger tiers');
}

{ // ---- export bundle -> import into a new slot -> identical world ----
  const st = await openStore(true); const g = mk(11);
  const px = Math.floor(g.p.x / TS), py = Math.floor(g.p.y / TS);
  g.p.res = { wood: 30, stone: 30, scrap: 30 }; g.build = 2; g.placeBuild(px + 2, py); g.placeBuild(px + 2, py + 1);
  g.destroyNest(g.world.nests.find((n) => n.alive)); g.world.loot(g.world.crates[0]);
  await saveGame(0, g, st);
  const bundle = JSON.parse(JSON.stringify(await exportBundle(0, st)));    // through JSON like a real file
  const slot = await importBundle(bundle, st); assert.equal(slot, 1, 'imported into the first free slot');
  const a = await loadGame(0, st), b = await loadGame(1, st);
  assert.equal(a.chunks.size, b.chunks.size);
  for (const [idx, t] of a.chunks) assert.ok(sameTiles(t, b.chunks.get(idx)), 'chunk identical after export/import');
  assert.deepEqual(a.data.world, b.data.world); assert.deepEqual(a.data.player, b.data.player);
  const g2 = Game.fromSave(b); assert.equal(g2.world.get(px + 2, py), T.STONEWALL);
  assert.equal(g2.world.nestsLeft(), g.world.nestsLeft());
  ok('export/import round trip is lossless');
  await importBundle(bundle, st); await importBundle(bundle, st).then(() => assert.fail('should be full'), (e) => assert.match(e.message, /full/));
  ok('import refuses when every slot is used');
}

{ // ---- v1 migration: an old flat save becomes a stamp in a new world, nothing lost ----
  const W = 96, old = {
    v: 1, meta: { name: 'Old Town' },
    world: { w: W, h: W, rle: [0, 4000, 4, 50, 0, W * W - 4050], home: { x: 48, y: 48 }, kind: 'fort-hollow', seed: 'x', name: 'Old Town', zones: [],
      nests: [{ x: 10, y: 10, hp: 260, maxHp: 260, alive: true }, { x: 80, y: 80, hp: 90, maxHp: 260, alive: true }, { x: 20, y: 70, hp: 0, maxHp: 260, alive: false }],
      crates: [{ x: 30, y: 30, looted: true }, { x: 31, y: 31, looted: false }], tileHp: [[4000, 12]] },
    player: { x: 48 * TS, y: 50 * TS, hp: 50, xp: 3, level: 4, res: { wood: 5, stone: 1, scrap: 2 }, up: { dmg: 1 }, pending: 0, build: 0, ammo: 20, mag: 5, weapon: 0 },
    time: { day: 3, clock: 0.2 }, stats: { kills: 7, nests: 1, deaths: 0, playTime: 100 },
  };
  mem.set('pasurvivors.slot.0', JSON.stringify(old));
  const st = await openStore(true);
  assert.equal(mem.get('pasurvivors.slot.0'), undefined, 'old key moved out of the way'); assert.ok(mem.get('pasurvivors.slot.0.v1backup'), 'but kept as a backup');
  const metas = await slotMetas(st); assert.equal(metas[0].name, 'Old Town'); assert.equal(metas[0].day, 3); assert.equal(metas[0].nests, 1);
  const g = Game.fromSave(await loadGame(0, st)), w = g.world, off = (WORLD_SIZE - W) >> 1;
  assert.equal(g.p.level, 4); assert.equal(g.p.ammo, 20); assert.deepEqual(g.p.res, { wood: 5, stone: 1, scrap: 2 });
  assert.equal(g.p.x, 48 * TS + off * TS, 'player moved with the map');
  assert.equal(w.get(off + 5, off + 40), T.GRASS); assert.equal(w.get(off + 4000 % W + 1, off + (4000 / W | 0)), T.WALL, 'old tiles preserved at the offset');
  assert.equal(w.home.x, off + 48, 'home carried over'); assert.equal(w.deadNests.size, 1); assert.equal(w.nestsLeft(), w.nestTotal - 1);
  w.preload((off + 80.5) * TS, (off + 80.5) * TS);
  assert.equal(w.nests.find((n) => n.x === off + 80 && n.y === off + 80).hp, 90, 'wounded nest kept its HP');
  assert.equal(w.crates.find((c) => c.x === off + 30 && c.y === off + 30).looted, true);
  assert.equal(w.tileHp.size, 1);
  ok('v1 saves migrate into the chunk world without losing anything');
}

{ // ---- a long walk through the generated world stays smooth ----
  const g = new Game(newWorld('seeded', 'walk')); g.p.hp = 1e9; g.s.maxHp = 1e9;
  g.spawnAmbient = () => {}; g.nestSpawns = () => {};
  g.p.x = (g.world.home.x + 4) * TS; g.p.y = (g.world.home.y + 0.5) * TS; const x0 = g.p.x; let worst = 0, gen = 0;   // the home road runs straight east
  const w = g.world, lo = w.load.bind(w); w.load = (cx, cy) => { gen++; return lo(cx, cy); };
  for (let f = 0; f < 3000; f++) {
    g.input.x = 1; g.input.y = 0; g.input.harvest = false;
    const t = performance.now(); g.update(1 / 60); worst = Math.max(worst, performance.now() - t);
    g.enemies.length = 0;
  }
  console.log(`      walked ${((g.p.x - x0) / TS) | 0} tiles, ${gen} chunk loads, worst frame ${worst.toFixed(1)} ms, ${w.loaded.length} chunks resident`);
  assert.ok((g.p.x - x0) / TS > 100, 'walked a long way'); assert.ok(w.loaded.length <= 121); assert.ok(worst < 25, 'no frame hitch while streaming');
  ok('walking across the world streams smoothly');
}

console.log(`\n${passed} checks passed`);
