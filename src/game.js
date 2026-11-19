import { World } from './world.js';
import { buildSave } from './store.js';
import { TS, BUILDS } from './tiles.js';
import { DAY_LEN, NIGHT_START, FLOW_R, INF, MAX_ENEMIES, dist2 } from './sim/constants.js';
import { getTables } from './core/data.js';
import { Grid } from './sim/grid.js';
import * as collision from './sim/collision.js';
import * as flow from './sim/flow.js';
import * as spawn from './sim/spawn.js';
import * as enemies from './sim/enemies.js';
import * as combat from './sim/combat.js';
import * as progression from './sim/progression.js';
import * as gather from './sim/gather.js';
import * as build from './sim/build.js';
import * as player from './sim/player.js';

export { DAY_LEN, NIGHT_START } from './sim/constants.js';
export { UPGRADES } from './sim/upgrades.js';

export class Game {
  constructor(world, saved) {
    this.world = world;
    this.rng = Math.random;
    this.et = getTables().enemies;             // compiled enemy lookup tables
    this.enemies = []; this.bullets = []; this.bulletPool = []; this.drops = []; this.fx = [];
    this.grid = new Grid(MAX_ENEMIES + 8);     // reusable spatial hash
    this.dir = { x: 0, y: 0 };                 // scratch output for flowDir
    this.nAmbient = 0;                         // live ambient (non-nest) zombies, maintained incrementally
    this.events = [];       // consumed by the UI: {type, ...}
    // aim (ax, ay) is in WORLD coordinates; fire = mouse held
    this.input = { x: 0, y: 0, harvest: false, fire: false, ax: 0, ay: 0 };
    this.autoFire = false;
    this.paused = false; this.dead = false;
    this.time = { day: 1, clock: 0.05 };
    this.stats = { kills: 0, nests: 0, deaths: 0, playTime: 0 };
    this.build = 0; // 0 = not building, 1.. = BUILDS index + 1 (build mode)
    this.lastBuild = 1;
    this.flow = new Int16Array((FLOW_R * 2 + 1) ** 2).fill(INF);
    this.flowT = 0; this.flowOx = 0; this.flowOy = 0;
    this.spawnAcc = 0; this.bladeAng = 0; this.harvestT = 0; this.harvestKey = -1;
    this.p = {
      x: (world.home.x + 0.5) * TS, y: (world.home.y + 2.5) * TS, hp: 100, xp: 0, level: 1,
      res: { wood: 0, stone: 0, scrap: 0 }, up: {}, fireCd: 0, facing: 0, pending: 0,
      ammo: 48, mag: 12, reload: 0, weapon: 0, clickCd: 0, flash: 0,
    };
    if (saved) this.loadSaved(saved);
    world.preload(this.p.x, this.p.y);         // load the chunks around the player before the first frame
    this.wdef = null; const wi = this.p.weapon | 0; this.p.weapon = -1; this.setWeapon(wi);
    if (this.wdef.kind === 'ranged') this.p.mag = Math.min(this.p.mag, this.wdef.mag);
    this.input.ax = this.p.x + 100; this.input.ay = this.p.y;
    this.recalc();
    if (!saved) this.p.hp = this.s.maxHp;
  }

  get isNight() { return this.time.clock >= NIGHT_START; }

  xpNeeded() { return 5 + this.p.level * 5; }


  // ---------- persistence ----------

  toSave(name) {
    const p = this.p;
    return buildSave(this.world, { x: p.x, y: p.y, hp: p.hp, xp: p.xp, level: p.level, res: p.res, up: p.up, pending: p.pending, build: this.build, ammo: p.ammo, mag: p.mag, weapon: p.weapon }, this.time, this.stats, name);
  }

  loadSaved(d) {
    Object.assign(this.p, d.player);
    this.build = d.player.build || 0;
    if (this.build) this.lastBuild = this.build;
    this.time = { ...d.time }; this.stats = { ...this.stats, ...d.stats };
  }

  // `loaded` = { data, chunks } as returned by store.loadGame
  static fromSave(loaded) { return new Game(World.fromState(loaded.data.world, loaded.chunks), loaded.data); }

  say(text, kind = 'info') { this.events.push({ type: 'msg', text, kind }); }

  // Toggle build mode (B). Keeps the last selected piece.
  toggleBuild() {
    if (this.build) { this.lastBuild = this.build; this.build = 0; } else this.build = this.lastBuild || 1;
    return this.build;
  }

  // ---------- main update ----------

  update(dt) {
    if (this.paused || this.dead) return;
    const p = this.p, s = this.s, w = this.world;
    this.stats.playTime += dt;

    // clock
    this.time.clock += dt / DAY_LEN;
    if (this.time.clock >= 1) {
      this.time.clock -= 1; this.time.day++;
      for (const e of this.enemies) if (!e.nestRef) e.burn = true;
      this.regrow();
      this.say(`Dawn of day ${this.time.day}. The night-walkers burn away.`);
      this.events.push({ type: 'dawn' });
    } else if (this.time.clock >= NIGHT_START && this.time.clock - dt / DAY_LEN < NIGHT_START) {
      this.say('Night falls. The horde is coming.', 'warn');
    }

    // player movement
    let ix = this.input.x, iy = this.input.y;
    const il = Math.hypot(ix, iy);
    if (il > 0) { ix /= il; iy /= il; this.move(p, ix * s.speed * dt, iy * s.speed * dt, 9); }
    p.hp = Math.min(s.maxHp, p.hp + s.regen * dt);
    const hx = w.home.x * TS + TS / 2, hy = w.home.y * TS + TS / 2;
    if (dist2(p.x, p.y, hx, hy) < 90 * 90) p.hp = Math.min(s.maxHp, p.hp + 8 * dt);

    w.stream(p.x, p.y);
    this.flowT -= dt;
    if (this.flowT <= 0) { this.flowT = 0.4; this.buildFlow(); }

    this.nestSpawns(dt);
    this.spawnAmbient(dt);
    this.updateEnemies(dt);
    this.updateWeapon(dt);
    this.updateTurrets(dt);
    this.updateBlades(dt);
    this.updateBullets(dt);
    this.updateDrops(dt);
    this.updateHarvest(dt);
    this.updateFx(dt);
    this.reap();   // compact dead enemies once per frame (keeps grid indices valid all frame)

    if (p.hp <= 0) this.die();
  }

  updateFx(dt) {
    const f = this.fx;
    for (let i = f.length - 1; i >= 0; i--) {
      f[i].t -= dt;
      if (f[i].t <= 0) { f[i] = f[f.length - 1]; f.pop(); }
    }
  }

  // ---- delegated to src/sim/* ----
  blockedAt(...a) { return collision.blockedAt(this, ...a); }
  move(...a) { return collision.move(this, ...a); }
  passCost(...a) { return flow.passCost(this, ...a); }
  buildFlow(...a) { return flow.buildFlow(this, ...a); }
  flowDir(...a) { return flow.flowDir(this, ...a); }
  pickType(...a) { return spawn.pickType(this, ...a); }
  spawn(...a) { return spawn.spawn(this, ...a); }
  spawnAmbient(...a) { return spawn.spawnAmbient(this, ...a); }
  nestSpawns(...a) { return spawn.nestSpawns(this, ...a); }
  updateEnemies(...a) { return enemies.updateEnemies(this, ...a); }
  killEnemy(...a) { return enemies.killEnemy(this, ...a); }
  hurt(...a) { return enemies.hurt(this, ...a); }
  reap(...a) { return enemies.reap(this, ...a); }
  addBullet(...a) { return combat.addBullet(this, ...a); }
  reload(...a) { return combat.reload(this, ...a); }
  updateWeapon(...a) { return combat.updateWeapon(this, ...a); }
  updateTurrets(...a) { return combat.updateTurrets(this, ...a); }
  updateBlades(...a) { return combat.updateBlades(this, ...a); }
  updateBullets(...a) { return combat.updateBullets(this, ...a); }
  destroyNest(...a) { return combat.destroyNest(this, ...a); }
  updateDrops(...a) { return progression.updateDrops(this, ...a); }
  addXp(...a) { return progression.addXp(this, ...a); }
  offerUpgrades(...a) { return progression.offerUpgrades(this, ...a); }
  chooseUpgrade(...a) { return progression.chooseUpgrade(this, ...a); }
  findHarvest(...a) { return gather.findHarvest(this, ...a); }
  updateHarvest(...a) { return gather.updateHarvest(this, ...a); }
  regrow(...a) { return gather.regrow(this, ...a); }
  canBuildAt(...a) { return build.canBuildAt(this, ...a); }
  placeBuild(...a) { return build.placeBuild(this, ...a); }
  removeBuild(...a) { return build.removeBuild(this, ...a); }
  recalc(...a) { return player.recalc(this, ...a); }
  setWeapon(...a) { return player.setWeapon(this, ...a); }
  hurtPlayer(...a) { return player.hurtPlayer(this, ...a); }
  convertScrap(...a) { return player.convertScrap(this, ...a); }
  die(...a) { return player.die(this, ...a); }
  respawn(...a) { return player.respawn(this, ...a); }
}
