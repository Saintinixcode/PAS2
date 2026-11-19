import { Game, UPGRADES, DAY_LEN, NIGHT_START } from './game.js';
import { loadData } from './core/data.js';
import { newWorld } from './maps.js';
import { Renderer } from './render.js';
import { BUILDS, TS } from './tiles.js';
import { SLOTS, slotMetas, readSlot, writeSlot, deleteSlot, exportSlot, importFile } from './save.js';

const $ = (id) => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);
const renderer = new Renderer($('game'), $('mini'));
window.addEventListener('resize', () => renderer.resize());

let game = null, slot = -1, running = false, last = 0, autosaveT = 0, hudT = 0;
const mouse = { x: 0, y: 0 };
const keys = new Set();

// ---------- menu ----------
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}
function renderMenu() {
  const box = $('slots'); box.innerHTML = '';
  slotMetas().forEach((m, i) => {
    const el = document.createElement('div'); el.className = 'slot';
    if (m) {
      el.innerHTML = `<h3>${esc(m.name)}</h3><div class="meta">Day ${m.day} · Level ${m.level}<br>${m.nests}/${m.nestTotal} nests cleared<br>${m.kills} kills<br>Saved ${ago(m.savedAt)}</div>
        <div class="row"><button data-a="play">Play</button><button data-a="export">Export</button><button data-a="del">Delete</button></div>`;
    } else {
      el.innerHTML = `<h3>Empty slot ${i + 1}</h3><div class="meta">No world here yet.</div><div class="row"><button data-a="new" class="primary">New world</button></div>`;
    }
    el.onclick = (ev) => {
      const a = ev.target.dataset.a; if (!a) return;
      if (a === 'play') startFromSlot(i);
      if (a === 'new') { slot = i; show('newworld'); }
      if (a === 'export') exportSlot(i);
      if (a === 'del' && confirm('Delete this world permanently?')) { deleteSlot(i); renderMenu(); }
    };
    box.appendChild(el);
  });
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

$('nwkind').onchange = () => show('seedrow', $('nwkind').value === 'seeded');
show('seedrow', false);
$('nwcancel').onclick = () => show('newworld', false);
$('nwgo').onclick = () => {
  show('newworld', false);
  const w = newWorld($('nwkind').value, $('nwseed').value.trim());
  begin(new Game(w));
  save();
};
$('import').onclick = () => $('file').click();
$('file').onchange = async (e) => {
  try { await importFile(e.target.files[0]); $('menumsg').textContent = 'Imported.'; renderMenu(); }
  catch (err) { $('menumsg').textContent = err.message; }
  e.target.value = '';
};

function startFromSlot(i) {
  const d = readSlot(i); if (!d) return;
  slot = i; begin(Game.fromSave(d));
}

// ---------- game session ----------
function begin(g) {
  game = g; show('menu', false); show('hud'); buildToolbar();
  game.say(game.time.day === 1 && game.stats.kills === 0 ? 'Hold E near trees, rocks and crates. Nests (red) spawn the horde.' : `Welcome back. Day ${game.time.day}.`);
  running = true; last = performance.now(); hudT = 0; game.input.fire = false;
}
function save() {
  if (!game || slot < 0) return false;
  return writeSlot(slot, game.toSave());
}
function toMenu() {
  save(); running = false; game = null; show('hud', false); show('pause', false); show('menu'); renderMenu();
}

// ---------- HUD ----------
function buildToolbar() {
  const tb = $('toolbar'); tb.innerHTML = '';
  BUILDS.forEach((b, i) => {
    const el = document.createElement('button'); el.dataset.i = i + 1;
    el.textContent = `${i + 1} ${b.name} (${Object.entries(b.cost).map(([k, v]) => v + ' ' + k).join(', ')})`;
    el.onclick = () => { game.build = i + 1; game.lastBuild = i + 1; };
    tb.appendChild(el);
  });
}

// HUD writes only when a value changed, and runs at ~10 Hz (see loop). No per-frame DOM churn.
const hudCache = Object.create(null);
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function setWidth(id, pct) { const v = Math.round(pct) + '%'; const k = 'w' + id; if (hudCache[k] !== v) { hudCache[k] = v; $(id).style.width = v; } }
function setClass(el, key, name, on) { const k = key + name; if (hudCache[k] !== on) { hudCache[k] = on; el.classList.toggle(name, on); } }

function hud() {
  const p = game.p, s = game.s, t = game.time, w = game.wdef;
  setWidth('hpbar', 100 * Math.max(0, p.hp) / s.maxHp); setText('hptxt', `${Math.max(0, Math.ceil(p.hp))} / ${s.maxHp}`);
  setWidth('xpbar', 100 * p.xp / game.xpNeeded()); setText('lvltxt', `Lv ${p.level}`);
  setText('rWood', `🪵 ${p.res.wood}`); setText('rStone', `🪨 ${p.res.stone}`); setText('rScrap', `⚙️ ${p.res.scrap}`);
  const mins = Math.floor(t.clock * 24);
  setText('clock', `Day ${t.day} · ${game.isNight ? '🌙 night' : '☀️ day'} (${String(mins).padStart(2, '0')}:00)`);
  const z = game.world.zoneAt(Math.floor(p.x / TS), Math.floor(p.y / TS));
  let left = 0; for (const n of game.world.nests) if (n.alive) left++;
  setText('zone', `${z || 'Wilds'} · ${left} nests left`);

  // weapon panel
  setText('wname', w.name);
  if (w.kind === 'ranged') {
    setText('wtxt', p.reload > 0 ? 'reloading…' : `${p.mag} / ${p.ammo}`);
    setWidth('wbar', p.reload > 0 ? 100 * (1 - p.reload / w.reload) : 100 * p.mag / w.mag);
    setClass($('wbar').parentElement, 'wb', 'empty', p.mag === 0 && p.reload <= 0);
  } else { setText('wtxt', 'melee'); setWidth('wbar', 100); setClass($('wbar').parentElement, 'wb', 'empty', false); }
  setText('wmode', game.build ? 'BUILD MODE: click place, B to exit' : game.autoFire ? 'AUTO-FIRE ON (F)' : 'Hold LMB to fire · R reload');

  const tb = $('toolbar');
  setClass(tb, 'tb', 'hidden', !game.build);
  if (game.build) [...tb.children].forEach((el) => {
    const i = +el.dataset.i, b = BUILDS[i - 1];
    setClass(el, 'sel' + i, 'sel', game.build === i);
    setClass(el, 'no' + i, 'no', !Object.entries(b.cost).every(([k, v]) => p.res[k] >= v));
  });
}
function toast(text, kind) {
  const el = document.createElement('div'); el.className = 'toast ' + (kind || ''); el.textContent = text;
  $('toasts').appendChild(el); setTimeout(() => el.remove(), 4000);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
}
function handleEvents() {
  for (const ev of game.events.splice(0)) {
    if (ev.type === 'msg') toast(ev.text, ev.kind);
    else if (ev.type === 'levelup') {
      const box = $('choices'); box.innerHTML = '';
      for (const u of ev.choices) {
        const lv = game.p.up[u.id] || 0, b = document.createElement('button'); b.className = 'choice';
        b.innerHTML = `<b>${u.name}</b><span>${u.desc}</span><em>${lv ? `level ${lv} → ${lv + 1}` : 'new'}</em>`;
        b.onclick = () => { game.chooseUpgrade(u.id); show('levelup', false); };
        box.appendChild(b);
      }
      show('levelup');
    } else if (ev.type === 'death') { show('death'); save(); }
    else if (ev.type === 'dawn' || ev.type === 'nest') save();
  }
}
$('respawn').onclick = () => { game.respawn(); show('death', false); };

// ---------- pause ----------
let userPaused = false;
function setPause(on) {
  if (!game || game.dead || game.choices) return;
  userPaused = on; game.paused = on; show('pause', on); if (on) game.input.fire = false;
  if (on) {
    save();
    $('pausestats').textContent = `Day ${game.time.day} · ${game.stats.kills} kills · ${game.stats.nests} nests cleared · ${game.stats.deaths} deaths · ${Math.round(game.stats.playTime / 60)} min played`;
  }
}
$('resume').onclick = () => setPause(false);
$('savenow').onclick = () => { toast(save() ? 'Saved.' : 'Save failed (storage full?). Try Export.', 'good'); };
$('export').onclick = () => { save(); exportSlot(slot); };
$('quit').onclick = toMenu;

// ---------- input ----------
const MOVE = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
function readInput() {
  let x = 0, y = 0;
  for (const k of keys) if (MOVE[k]) { x += MOVE[k][0]; y += MOVE[k][1]; }
  game.input.x = x; game.input.y = y; game.input.harvest = keys.has('KeyE');
  game.input.ax = mouse.x + renderer.cam.x; game.input.ay = mouse.y + renderer.cam.y; // aim in world coordinates
}
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Escape') { if (game) setPause(!userPaused); return; }
  keys.add(e.code);
  if (!game || !running) return;
  if (e.code >= 'Digit1' && e.code <= 'Digit9') {
    const n = +e.code.slice(5);
    if (game.build) { if (n <= BUILDS.length) { game.build = n; game.lastBuild = n; } } // build mode: pick a piece
    else game.setWeapon(n - 1);                                                       // otherwise: pick a weapon
  }
  if (!e.repeat) {
    if (e.code === 'KeyB') game.toggleBuild();
    if (e.code === 'KeyR') game.reload();
    if (e.code === 'KeyQ' && !game.build) game.setWeapon(game.p.weapon === 0 ? 1 : 0);
    if (e.code === 'KeyF') { game.autoFire = !game.autoFire; toast(game.autoFire ? 'Auto-fire on (fires toward the cursor)' : 'Auto-fire off'); }
    if (e.code === 'KeyV') { const ok = game.convertScrap(); toast(ok ? '5 scrap → 5 rounds' : 'Need 5 scrap (and room for ammo)', ok ? 'good' : 'warn'); }
  }
  if (e.code === 'KeyX') { const [tx, ty] = renderer.screenToTile(mouse.x, mouse.y); game.removeBuild(tx, ty); }
  if (MOVE[e.code] || e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); if (game) game.input.fire = false; });
const cv = $('game');
cv.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('mousedown', (e) => {
  if (!game || game.paused || game.dead) return;
  mouse.x = e.clientX; mouse.y = e.clientY;
  if (game.build) { // build mode: mouse places / removes
    const [tx, ty] = renderer.screenToTile(e.clientX, e.clientY);
    if (e.button === 0) game.placeBuild(tx, ty); else if (e.button === 2) game.removeBuild(tx, ty);
  } else if (e.button === 0) game.input.fire = true;
});
window.addEventListener('mouseup', (e) => { if (game && e.button === 0) game.input.fire = false; });
window.addEventListener('beforeunload', () => { if (game) save(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && game) { setPause(true); } });

// ---------- F3 perf overlay: fps, worst frame, sim and draw cost over the last second ----------
const perf = { on: false, t: 0, n: 0, sum: 0, worst: 0, sim: 0, draw: 0 };
function perfTick(dt, sim, draw) {
  if (!perf.on) return;
  perf.t += dt; perf.n++; perf.sum += dt; perf.worst = Math.max(perf.worst, dt); perf.sim += sim; perf.draw += draw;
  if (perf.t >= 1) {
    const f = (x) => x.toFixed(1);
    $('perf').textContent = `${Math.round(perf.n / perf.t)} fps · worst frame ${f(perf.worst * 1000)} ms · sim ${f(perf.sim / perf.n)} ms · draw ${f(perf.draw / perf.n)} ms · ${game.enemies.length} zombies`;
    perf.t = perf.n = perf.sum = perf.worst = perf.sim = perf.draw = 0;
  }
}
window.addEventListener('keydown', (e) => { if (e.code === 'F3') { e.preventDefault(); perf.on = !perf.on; $('perf').classList.toggle('hidden', !perf.on); } });

// ---------- loop ----------
function frame(now) {
  requestAnimationFrame(frame);
  if (!running || !game) return;
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  readInput();
  // Bounded substeps (each <= 1/30 s) keep the simulation stable on slow frames while staying smooth at any refresh rate.
  const n = Math.max(1, Math.ceil(dt / (1 / 30))), step = dt / n;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) game.update(step);
  handleEvents();
  autosaveT += dt; if (autosaveT > 30) { autosaveT = 0; save(); }
  const t1 = performance.now();
  renderer.draw(game, mouse, dt);
  const t2 = performance.now();
  hudT -= dt; if (hudT <= 0) { hudT = 0.1; hud(); }
  perfTick(dt, t1 - t0, t2 - t1);
}
requestAnimationFrame(frame);

// Load JSON content before the menu becomes usable. Fails loudly on file:// or a missing file.
try {
  await loadData();
  renderMenu();
} catch (err) {
  console.error(err);
  $('slots').innerHTML = '';
  $('menumsg').textContent = `Could not load game data: ${err.message}. Serve the folder over http:// (see README).`;
}

// handy for debugging in the console
window.__pas = { get game() { return game; }, UPGRADES, DAY_LEN, NIGHT_START };
