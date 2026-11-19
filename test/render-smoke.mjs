// Runs the renderer against a stub 2D context to catch runtime errors (typos, bad refs).
const ctxStub = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'createImageData' ? (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => ((t[k] = v), true) });
const canvasStub = () => ({ width: 800, height: 600, getContext: ctxStub });
globalThis.window = { innerWidth: 800, innerHeight: 600 };
globalThis.document = { createElement: canvasStub };
const { loadData } = await import('../src/core/data.js');
await loadData();
const { Renderer } = await import('../src/render.js');
const { Game } = await import('../src/game.js');
const { newWorld } = await import('../src/maps.js');
for (const kind of ['fort-hollow', 'seeded']) {
  const g = new Game(newWorld(kind, 'smoke'));
  const r = new Renderer(canvasStub(), { width: 160, height: 160, getContext: ctxStub });
  g.p.res = { wood: 20, stone: 20, scrap: 20 }; g.build = 3;
  for (let i = 0; i < 2700; i++) {                       // spans a dusk
    g.input.x = Math.cos(i / 40); g.input.y = Math.sin(i / 55); g.input.harvest = true;
    g.update(0.1); g.events.length = 0;
    if (g.choices) g.chooseUpgrade(g.choices[0].id);
    if (g.dead) g.respawn();
    r.draw(g, { x: 400, y: 300 }, 0.1);
  }
  console.log(`render smoke ok: ${kind} (day ${g.time.day}, enemies ${g.enemies.length})`);
}
