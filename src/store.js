// Save storage. A save is two kinds of records:
//   saves  : 'slot:N'      -> small JSON (meta, player, clock, world state: dead nests, looted crates, fog...)
//   chunks : 'N:<index>'   -> Uint8Array tiles of ONE modified chunk
// Only chunks changed since the last save are written. IndexedDB in the browser; a Map in Node/tests.
import { rle, unrle, World } from './world.js';
import { fortHollowStamp, WORLD_SIZE } from './maps.js';
import { newWorldFromV1 } from './migrate.js';

export const SLOTS = 3;

class MemAdapter {
  constructor() { this.s = new Map(); this.c = new Map(); }
  async get(store, key) { return (store === 'saves' ? this.s : this.c).get(key); }
  async put(store, key, val) { (store === 'saves' ? this.s : this.c).set(key, val); }
  async del(store, key) { (store === 'saves' ? this.s : this.c).delete(key); }
  async keys(store, prefix) { return [...(store === 'saves' ? this.s : this.c).keys()].filter((k) => k.startsWith(prefix)); }
}

class IdbAdapter {
  constructor(db) { this.db = db; }
  static open() {
    return new Promise((res, rej) => {
      const q = indexedDB.open('pas2', 1);
      q.onupgradeneeded = () => { q.result.createObjectStore('saves'); q.result.createObjectStore('chunks'); };
      q.onsuccess = () => res(new IdbAdapter(q.result)); q.onerror = () => rej(q.error);
    });
  }
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode), r = fn(t.objectStore(store));
      t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }
  get(store, key) { return this.tx(store, 'readonly', (o) => o.get(key)); }
  put(store, key, val) { return this.tx(store, 'readwrite', (o) => o.put(val, key)); }
  del(store, key) { return this.tx(store, 'readwrite', (o) => o.delete(key)); }
  async keys(store, prefix) {
    const all = await this.tx(store, 'readonly', (o) => o.getAllKeys());
    return all.filter((k) => k.startsWith(prefix));
  }
}

let adapter = null;
export async function openStore(forceMem = false) {
  if (adapter && !forceMem) return adapter;
  let a;
  try { a = forceMem || typeof indexedDB === 'undefined' ? new MemAdapter() : await IdbAdapter.open(); } catch { a = new MemAdapter(); }
  if (!forceMem) adapter = a;
  await migrateLegacy(a);
  return a;
}

// ---------- slots ----------
export async function slotMetas(a = adapter) {
  const out = [];
  for (let i = 0; i < SLOTS; i++) { const d = await a.get('saves', 'slot:' + i); out.push(d ? { slot: i, ...d.meta } : null); }
  return out;
}

let chain = Promise.resolve();   // saves run one after another so a slow write never overlaps the next
export function saveGame(slot, game, a = adapter) {
  const data = game.toSave(), dirty = game.world.takeDirty();   // snapshot now, write later
  chain = chain.then(async () => {
    for (const { idx, t } of dirty) await a.put('chunks', `${slot}:${idx}`, t);
    await a.put('saves', 'slot:' + slot, data);
    return true;
  }).catch((e) => { console.warn('save failed', e); for (const d of dirty) game.world.dirtyChunks.add(d.idx); return false; });
  return chain;
}

export async function loadGame(slot, a = adapter) {
  const data = await a.get('saves', 'slot:' + slot); if (!data) return null;
  const chunks = new Map();
  for (const k of await a.keys('chunks', slot + ':')) chunks.set(+k.split(':')[1], await a.get('chunks', k));
  return { data, chunks };
}

export async function deleteSlot(slot, a = adapter) {
  await a.del('saves', 'slot:' + slot);
  for (const k of await a.keys('chunks', slot + ':')) await a.del('chunks', k);
}

// ---------- files: one JSON bundle per world ----------
export async function exportBundle(slot, a = adapter) {
  const l = await loadGame(slot, a); if (!l) return null;
  const chunks = {};
  for (const [idx, t] of l.chunks) chunks[idx] = rle(t);
  return { v: 2, save: l.data, chunks };
}
export async function importBundle(b, a = adapter) {
  let bundle = b;
  if (b && b.v === 1 && b.world && b.player) bundle = v1ToBundle(b);
  if (!bundle || bundle.v !== 2 || !bundle.save) throw new Error('Not a PA Survivors save');
  const slots = await slotMetas(a), free = slots.findIndex((m) => !m);
  if (free < 0) throw new Error('All slots are full. Delete one first.');
  for (const [idx, r] of Object.entries(bundle.chunks || {})) await a.put('chunks', `${free}:${idx}`, unrle(r, 256));
  await a.put('saves', 'slot:' + free, bundle.save);
  return free;
}
export function downloadBundle(bundle) {
  const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
  const el = document.createElement('a');
  el.href = URL.createObjectURL(blob);
  el.download = `pas2-${(bundle.save.meta.name || 'world').replace(/\W+/g, '-')}-day${bundle.save.meta.day}.json`;
  el.click(); setTimeout(() => URL.revokeObjectURL(el.href), 1000);
}

// ---------- v1 (single flat world in localStorage / old export files) ----------
function v1ToBundle(old) {
  const { world, player, time, stats } = newWorldFromV1(old);
  const chunks = {};
  for (const [idx, t] of world.mod) chunks[idx] = rle(t);
  return { v: 2, chunks, save: buildSave(world, player, time, stats, old.meta && old.meta.name) };
}
export function buildSave(world, player, time, stats, name) {
  return {
    v: 2,
    meta: { name: name || world.name, kind: world.kind, seed: world.seed, day: time.day, level: player.level, kills: stats.kills || 0, nests: world.deadNests.size, nestTotal: world.nestTotal, savedAt: Date.now() },
    world: world.exportState(), player, time, stats,
  };
}
async function migrateLegacy(a) {
  try {
    const ls = globalThis.localStorage; if (!ls) return;
    for (let i = 0; i < SLOTS; i++) {
      const raw = ls.getItem(`pasurvivors.slot.${i}`); if (!raw) continue;
      if (await a.get('saves', 'slot:' + i)) continue;
      const b = v1ToBundle(JSON.parse(raw));
      for (const [idx, r] of Object.entries(b.chunks)) await a.put('chunks', `${i}:${idx}`, unrle(r, 256));
      await a.put('saves', 'slot:' + i, b.save);
      ls.setItem(`pasurvivors.slot.${i}.v1backup`, raw); ls.removeItem(`pasurvivors.slot.${i}`); // keep the old data, just out of the way
    }
  } catch (e) { console.warn('v1 migration failed', e); }
}
export { WORLD_SIZE, fortHollowStamp, World };
