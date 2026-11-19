// Converts a v1 save (one flat 96x96 or 128x128 world) into a v2 world: the old map becomes a "stamp"
// at the centre of a new generated world, stored as modified chunks, so nothing the player built is lost.
import { World } from './world.js';
import { WORLD_SIZE } from './maps.js';
import { CS } from './gen.js';
import { TS } from './tiles.js';

export function newWorldFromV1(old) {
  const ow = old.world, W = ow.w, H = ow.h;
  const tiles = new Uint8Array(W * H); let i = 0;
  for (let k = 0; k < ow.rle.length; k += 2) { tiles.fill(ow.rle[k], i, i + ow.rle[k + 1]); i += ow.rle[k + 1]; }
  const ox = (WORLD_SIZE - W) >> 1, oy = (WORLD_SIZE - H) >> 1;
  const stamp = { ox, oy, w: W, h: H, home: [ow.home.x, ow.home.y], nests: ow.nests.map((n) => [n.x, n.y]), crates: ow.crates.map((c) => [c.x, c.y]), zones: ow.zones || [] };
  const world = new World({ kind: 'migrated', seed: `v1-${ow.seed}`, name: ow.name || old.meta.name, size: WORLD_SIZE, stamp });
  // bake the old map (over fresh terrain) into the chunks it covers
  for (let cy = oy >> 4; cy <= (oy + H - 1) >> 4; cy++) for (let cx = ox >> 4; cx <= (ox + W - 1) >> 4; cx++) {
    const t = world.gen.tiles(cx, cy);
    for (let ly = 0; ly < CS; ly++) for (let lx = 0; lx < CS; lx++) {
      const x = cx * CS + lx - ox, y = cy * CS + ly - oy;
      if (x >= 0 && y >= 0 && x < W && y < H) t[ly * CS + lx] = tiles[y * W + x];
    }
    world.mod.set(cy * world.cw + cx, t);
  }
  ow.nests.forEach((n) => { const key = (n.y + oy) * WORLD_SIZE + n.x + ox; if (!n.alive) world.deadNests.add(key); else if (n.hp < n.maxHp) world.nestHp.set(key, n.hp); });
  ow.crates.forEach((c) => { if (c.looted) world.looted.add((c.y + oy) * WORLD_SIZE + c.x + ox); });
  world.tileHp = new Map((ow.tileHp || []).map(([k, v]) => [(((k / W) | 0) + oy) * WORLD_SIZE + (k % W) + ox, v]));
  const player = { ...old.player, x: old.player.x + ox * TS, y: old.player.y + oy * TS };
  // reveal the old map on the minimap
  for (const idx of world.mod.keys()) world.explored[idx] = 1;
  return { world, player, time: old.time, stats: old.stats };
}
