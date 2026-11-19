// Data-driven content. JSON files in /data are loaded once at boot (fetch in the browser,
// fs in Node tests), validated, and COMPILED into integer-indexed typed-array tables.
// Per-frame code reads the tables (getTables()), never string keys or JSON objects.
// Add new content files to FILES and give them a validator (+ a compiler if they are hot).

const num = (file, id, o, k, optional) => {
  if (o[k] === undefined && optional) return;
  if (typeof o[k] !== 'number') throw new Error(`${file}: "${id}.${k}" must be a number`);
};

const FILES = {
  enemies: (d) => {
    for (const [id, e] of Object.entries(d)) {
      for (const k of ['hp', 'speed', 'dmg', 'r', 'xp', 'minDay', 'weight']) num('enemies.json', id, e, k);
      for (const k of ['keepMin', 'keepMax', 'shotRate', 'shotDmg', 'shotSpeed', 'burstR', 'burstDmg', 'dropChance', 'dropScale']) num('enemies.json', id, e, k, true);
      if (typeof e.color !== 'string') throw new Error(`enemies.json: "${id}.color" must be a string`);
    }
    for (const id of ['walker', 'runner', 'brute']) if (!d[id]) throw new Error(`enemies.json: missing required enemy "${id}"`);
    if (d.walker.minDay !== 1) throw new Error('enemies.json: walker.minDay must be 1 so day 1 always has a spawn');
  },
  weapons: (d) => {
    for (const [id, w] of Object.entries(d)) {
      if (w.kind !== 'ranged' && w.kind !== 'melee') throw new Error(`weapons.json: "${id}.kind" must be ranged or melee`);
      for (const k of ['damage', 'rate']) num('weapons.json', id, w, k);
      if (w.kind === 'ranged') for (const k of ['mag', 'reload', 'range', 'speed', 'spread']) num('weapons.json', id, w, k);
      else for (const k of ['range', 'arc', 'knockback']) num('weapons.json', id, w, k);
    }
    if (!d.pistol || !d.bat) throw new Error('weapons.json: "pistol" and "bat" are required (starting loadout)');
  },
};

export const FLAG_RANGED = 1, FLAG_EXPLODES = 2;

function compileEnemies(d) {
  const names = Object.keys(d), n = names.length;
  const T = {
    n, names, index: {}, color: [],
    hp: new Float32Array(n), speed: new Float32Array(n), dmg: new Float32Array(n), r: new Float32Array(n), xp: new Float32Array(n),
    minDay: new Uint8Array(n), weight: new Float32Array(n), flags: new Uint8Array(n),
    keepMin: new Float32Array(n), keepMax: new Float32Array(n), shotRate: new Float32Array(n), shotDmg: new Float32Array(n), shotSpeed: new Float32Array(n),
    burstR: new Float32Array(n), burstDmg: new Float32Array(n), dropChance: new Float32Array(n), dropScale: new Float32Array(n),
  };
  names.forEach((id, i) => {
    const e = d[id]; T.index[id] = i; T.color.push(e.color);
    for (const k of ['hp', 'speed', 'dmg', 'r', 'xp', 'minDay', 'weight']) T[k][i] = e[k];
    for (const k of ['keepMin', 'keepMax', 'shotRate', 'shotDmg', 'shotSpeed', 'burstR', 'burstDmg', 'dropChance']) T[k][i] = e[k] || 0;
    T.dropScale[i] = e.dropScale || 1;
    if (e.shotRate) T.flags[i] |= FLAG_RANGED;
    if (e.burstR) T.flags[i] |= FLAG_EXPLODES;
  });
  return T;
}

let DATA = null;

export function getData() {
  if (!DATA) throw new Error('Game data not loaded. Call await loadData() before starting a Game.');
  return DATA;
}
export function getTables() { return getData().tables; }

const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node);

async function readJson(name) {
  const url = new URL(`../../data/${name}.json`, import.meta.url);
  if (isNode) {
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(url, 'utf8'));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load data/${name}.json (HTTP ${res.status})`);
  return res.json();
}

export async function loadData() {
  if (DATA) return DATA;
  const out = {};
  for (const [name, validate] of Object.entries(FILES)) {
    const d = await readJson(name);
    validate(d);
    out[name] = d;
  }
  out.tables = { enemies: compileEnemies(out.enemies), weaponNames: Object.keys(out.weapons) };
  DATA = out;
  return DATA;
}

// test helper
export function _resetData() { DATA = null; }
