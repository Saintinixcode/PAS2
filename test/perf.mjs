// Performance budget check. Run with `npm run perf` (not part of `npm test`: timings vary by machine).
// 1) simulation cost per frame with N zombies and weapons off (pure AI + pathing)
// 2) canvas calls per rendered frame (proxy for draw cost; the browser's real cost scales with it)
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { newWorld } from '../src/maps.js';
import { loadData } from '../src/core/data.js';
import { mulberry32 } from '../src/rng.js';

await loadData();

// ---- simulation ----
function simCost(n, frames = 600) {
  const g = new Game(newWorld('fort-hollow')); g.rng = mulberry32(3);
  g.time.day = 8; g.time.clock = 0.7; g.p.hp = 1e12; g.s.maxHp = 1e12; g.p.fireCd = 1e9;
  for (let i = 0; i < n; i++) { const a = g.rng() * 6.28, d = 120 + g.rng() * 500; g.spawn(g.p.x + Math.cos(a) * d, g.p.y + Math.sin(a) * d, false); }
  g.spawnAmbient = () => {}; g.nestSpawns = () => {};
  for (let f = 0; f < 120; f++) g.update(1 / 60);           // warm up the JIT
  let tot = 0, worst = 0;
  for (let f = 0; f < frames; f++) {
    g.input.x = Math.cos(f / 50); g.input.y = Math.sin(f / 70);
    const t = performance.now(); g.update(1 / 60); const e = performance.now() - t; tot += e; worst = Math.max(worst, e);
    g.events.length = 0;
  }
  return { avg: tot / frames, worst, n: g.enemies.length };
}
for (const [n, budget] of [[40, 1], [220, 2]]) {
  const r = simCost(n);
  console.log(`sim  ${String(r.n).padStart(3)} zombies: avg ${r.avg.toFixed(2)} ms/frame, worst ${r.worst.toFixed(1)} ms (budget avg < ${budget} ms)`);
  assert.ok(r.avg < budget, `simulation too slow with ${n} zombies`);
}

// ---- render: count canvas calls with a stub context ----
const counts = {};
const mkCtx = () => new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : k === 'createImageData' ? (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
    : k === 'createRadialGradient' ? () => { counts[k] = (counts[k] || 0) + 1; return { addColorStop() {} }; }
    : (...a) => { counts[k] = (counts[k] || 0) + 1; }),
  set: (t, k, v) => ((t[k] = v), true),
});
const canvas = () => ({ width: 1280, height: 720, getContext: mkCtx });
globalThis.window = { innerWidth: 1280, innerHeight: 720 };
globalThis.document = { createElement: canvas };
const { Renderer } = await import('../src/render.js');

// Warm frame: ground and objects are baked per chunk, so a frame is drawImage per chunk + entities + night layer.
// (Before chunk baking this was ~2,160 calls; now ~600.)
const RENDER_BUDGET = 900;
for (const [label, clock] of [['day', 0.3], ['night', 0.8]]) {
  const g = new Game(newWorld('fort-hollow')); g.rng = mulberry32(5); g.time.clock = clock; g.time.day = 5;
  for (let i = 0; i < 40; i++) { const a = g.rng() * 6.28, d = 100 + g.rng() * 300; g.spawn(g.p.x + Math.cos(a) * d, g.p.y + Math.sin(a) * d, false); }
  const r = new Renderer(canvas(), { width: 160, height: 160, getContext: mkCtx });
  for (let i = 0; i < 40; i++) r.draw(g, { x: 500, y: 300 }, 0.016);   // warm: every visible chunk baked
  for (const k in counts) delete counts[k];
  r.draw(g, { x: 500, y: 300 }, 0.016);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`draw ${label.padEnd(5)} 1280x720, 40 zombies: ${total} canvas calls (budget < ${RENDER_BUDGET}) | ${top}`);
  assert.ok(total < RENDER_BUDGET, `too many canvas calls (${label})`);
}
console.log('perf ok');
