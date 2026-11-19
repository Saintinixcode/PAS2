# PA Survivors: v0.2 plan (project name: pas2-v3)

Status key: [ ] todo · [~] in progress · [x] done. Update this file at the end of every step.

**Naming:** the project is **pas2-v3** (GitHub `Saintinixcode/PAS2`, Vercel project `pas2-v3`) until every milestone below is done. Steps 0-2 are done; next up is Step 3.

## Goals (from the brief)
1. Much bigger map, **chunk-based**, only the area around the player is loaded or simulated.
2. Mouse aiming, **finite ammo**, **fewer but tougher zombies**.
3. Bigger drop list. **Gems become zombie parts** (flesh, hand, eye, tooth, bone, heart...). Parts craft **potions** that grant **stat points**.
4. **Tarkov / Diablo / Zero Sievert style inventory**: tile grid, differently sized items, rotation, gear slots, containers (backpack, vest, crates).
5. Inventory popup docked to one side, **under half the screen**, with tabs: Gear/Inventory · Character · Skills · Crafting · Lore log. **Game pauses while any menu is open.**
6. Everything content-related is **data-driven JSON** (items, recipes, loot tables, enemies, skills, lore). The Vercel deploy also serves a **codex site** (item lists, drops, recipes, enemies) generated from the same JSON.

## Decisions (defaults; change any before the step that needs them)
| # | Decision | Default |
|---|---|---|
| D1 | World shape | Bounded, large: 64x64 chunks of 32x32 tiles (2048x2048 tiles). Difficulty rises with distance from the start. Infinite is possible later because generation is per-chunk from the seed. |
| D2 | Fort Hollow | Becomes the hand-authored **starting town stamped into every world** at the centre; the rest is generated from the seed. |
| D3 | Storage | **IndexedDB**, one record per *modified* chunk plus a small meta record. localStorage (5 MB) will not scale. Export/import = one .json bundle. Old v1 saves get a one-way migration. |
| D4 | Progression | **CONFIRMED.** XP is awarded **directly on each kill, in the background (no gems, no XP pickups)**. Levels give **skill points** (Skills tab). **Stat points come only from potions** (made from zombie parts, which drop as ground items). The level-up pick-1-of-3 popup is removed. |
| D5 | Aiming/firing | Aim at the cursor. **Hold LMB to fire**; optional toggle for auto-fire toward the cursor. Build mode moves to **B** (LMB = place while in build mode). |
| D6 | Ammo | Ammo is an inventory item per calibre. Magazines, **R to reload**, a melee weapon as fallback so you are never fully stuck. |
| D7 | Death | **CONFIRMED (grave/backpack).** Drops a persistent **grave stash** (or your backpack) at the death spot holding carried (non-equipped) items. Equipped gear stays. You respawn at the beacon and can go back for it. **Stretch (Zomboid-style):** your old character can rise as a named **revenant zombie** near the grave, guarding the loot; killing it frees the stash. Scheduled for Step 7+ once gear exists. |
| D8 | Zombie count | Active cap ~30-40 (was 220). Threat comes from variants, HP and affixes, not headcount. |
| D9 | Codex site | A static `/codex/` section built from `data/*.json` by a small node script, deployed with the game on Vercel. |

## Architecture target
    data/           items.json recipes.json loot.json enemies.json skills.json lore.json
    src/core/       rng, ids, data loader, event bus
    src/world/      chunk.js (32x32 tiles + features), gen.js (seeded, per chunk), stamps.js (Fort Hollow),
                    world.js (loaded-chunk window, LRU unload), store.js (IndexedDB)
    src/sim/        player.js enemies.js combat.js spawn.js build.js pickup.js (split out of game.js)
    src/items/      inventory.js (grid logic, no DOM), equipment.js, loot.js, craft.js, stats.js
    src/ui/         hud.js, panel.js (side popup shell), tab-gear.js, tab-character.js, tab-skills.js,
                    tab-crafting.js, tab-lore.js, menus.js
    tools/          build-codex.mjs
    test/           headless tests for everything under core/world/sim/items

Rule: anything under `core/ world/ sim/ items/` has no DOM and is covered by `npm test`.

## Performance rules (measured on v0.1, Step 0 build)
Findings: the **simulation is not the bottleneck**. 220 zombies cost ~0.17 ms/frame, 40 cost ~0.06 ms (flow-field pathing is per-tile, not per-zombie). **Drawing is**: ~2,050 canvas calls per frame, ~1,360 of them per-tile `fillRect`, plus a full-screen night overlay with new gradients every frame, plus HUD text/`innerHTML` rewritten every frame. `npm run perf` reproduces these numbers and enforces budgets.

Rules for every later step:
1. **Bake, don't redraw.** Tiles are drawn once into per-chunk offscreen canvases and re-baked only when a tile in that chunk changes. A frame is then ~20 `drawImage` calls. Tall objects (trees, walls) go in a second baked layer drawn after entities. (Step 2)
2. **Cheap night.** Pre-render one light sprite and stamp it with `destination-out`, and/or draw the darkness layer at half resolution and scale it up. No `createRadialGradient` per frame. (Step 2)
3. **Lookup tables, compiled at load.** JSON stays the authoring format. `loadData()` compiles it into integer-indexed typed arrays (`Float32Array` stats per enemy type, `Uint8Array` flags per tile, item tables indexed by int with a string-id to index map). Per-frame code uses ints, never string keys or object lookups. Drop tables become cumulative-weight arrays built once. (Steps 1-3)
4. **No per-frame allocation in hot loops.** Reuse the enemy spatial grid (fixed `Int32Array` head/next lists, not a fresh `Map` of arrays each frame); no `Set` per bullet (use a small ring or last-hit id); pool bullets and hit effects; keep running counts instead of `enemies.filter(...)` in spawn code. Garbage collection pauses are what players feel as hitches. (Step 1)
5. **Touch the DOM only on change.** HUD caches last values, updates at ~10 Hz, never rewrites `innerHTML` per frame. Inventory is DOM but only live while the game is paused; drags move with `transform`, not re-render. (Steps 1, 5)
6. **Streaming budget.** Chunk generation is time-sliced (at most ~2 ms/frame, one chunk at a time) so crossing a chunk border never hitches; move to a Web Worker returning transferable `Uint8Array`s only if measurements say so. Entities in far chunks sleep. (Step 2)
7. **Saves don't block.** IndexedDB stores typed arrays directly (no giant `JSON.stringify` on the main thread); only dirty chunks are written; writes are debounced. (Step 2)
8. **Fixed timestep.** Simulate in fixed steps with an accumulator so behaviour is identical on 60 Hz and 144 Hz screens and tests stay deterministic. (Step 1) *(Step 1 shipped bounded substeps instead: n = ceil(dt/(1/60)), dt capped at 0.1 s. Tests drive `update(dt)` directly so they stay deterministic. Strict accumulator is still an option later.)*
9. **Guard it.** `npm run perf` budgets: sim avg < 1 ms at 40 zombies and < 2 ms at 220; canvas calls/frame < 900 (was 2,160 before chunk baking; ~600 now). Any step that blows a budget fixes it before shipping.

## Steps
Each step: small scope, ends with `npm test` green, an updated zip (or a commit if the repo is attached), a short playtest checklist, and a **stop for your feedback** before the next step. A step should touch about 4-6 files so it fits comfortably in context.

### Step 0: Split and prepare  [x]
- Done: `game.js` (22 KB) split into `src/sim/{collision,flow,spawn,enemies,combat,progression,gather,build,player,upgrades,constants}.js`. `Game` keeps constructor, save/load, `update` and thin delegating methods, so the public API (`g.update`, `g.placeBuild`, ...) is unchanged.
- Done: `src/core/data.js` loader (fetch in browser, fs in Node, validators per file) and `data/enemies.json` (first data file; enemy stats no longer in code). Boot awaits `loadData()`.
- Done: `vercel.json` (clean URLs), `.vercelignore`, `.gitignore`.
- Safety net: `test/golden.mjs` runs a seeded 400 s simulation (building, nest kill, levelling, death) and hashes the final state. Hash is `91c20ff3` before and after the split. `npm test` now runs logic tests, the golden check and the render smoke test. **Step 1 changes gameplay on purpose, so it must update `EXPECTED` in `test/golden.mjs` and say why.** *Step 1 done: hash is now `5ff15ed3` (mouse aim, finite ammo, cap 60, new enemy types, XP on kill, drops).*
- Bug caught by the golden test during the split: a local named `g` (gem) shadowed the injected game parameter; the parameter is now `game`.
- Not verified: browser boot (fetch path and top-level await). Node tests cannot cover it. First thing to check on the Vercel deploy: the menu shows slots rather than "Could not load game data".

### Step 1: Combat feel  [x]
- Mouse aim, hold-LMB fire, auto-fire toggle (D5). Build mode on **B**.
- Finite ammo as a simple counter for now (becomes items in Step 5): magazine, reload, empty-click, melee fallback.
- Cut zombie counts (D8); retune spawn rates, HP scaling, nest caps; add 1-2 new variants (e.g. spitter, bloater) so fewer zombies still feels varied.
- Performance work that rides along (rules 3, 4, 5, 8): enemy stats compiled to typed-array tables; reusable fixed-grid spatial hash instead of a per-frame `Map`; bullet pool with no per-bullet `Set`; running enemy counters; HUD diffing at ~10 Hz; fixed-timestep loop.
- Tests: ammo/reload state machine, spawn cap, aim vector math; `npm run perf` stays within budget. Golden hash is **expected to change** here; update `EXPECTED` and note why.
- Playtest: one night, is it tense rather than a swarm?

### Step 2: Chunk world engine  [x]
- 2a: `chunk.js`, per-chunk deterministic generation (`gen.js`), loaded-window manager with unload. Renderer draws **baked per-chunk canvases (ground layer + tall-object layer)**, cheap night lighting (perf rules 1, 2, 6). Flow field and collision read through the window.
- 2b: `store.js` IndexedDB: save only modified chunks (tile deltas, nest/crate state, built tiles, graves); meta record for player and clock; export/import bundle; v1 migration.
- 2c: Fort Hollow stamp at the centre; nests and ruins from a jittered region grid; biomes and distance-based danger; minimap fog-of-war stored per chunk.
- Tests: same seed gives the same chunk; edit, unload, reload round trip; world is identical after export/import; chunk load cost budget.
- Playtest: walk far, build, come back, nothing lost; no hitching on chunk borders.

**Step 2 as built** (branch `step-2-chunks`)
- World is 512x512 tiles = 32x32 chunks of 16x16 (`CS = 16`). `gen.js` is a pure function of the seed: terrain noise, a sparse road grid that bridges water, ruins (one per 28-tile cell), nests (one per 64-tile cell, none within 48 tiles of home), crates inside ruins. About 0.07 ms per chunk, so generation never needs slicing or a worker; the window loads one chunk per frame, nearest first (7x7 loaded, dropped beyond 11x11).
- Fort Hollow is the authored 96x96 map stamped at the centre (roads continue outward). Entities in the stamp are added to the global lists with an offset.
- `World` keeps `mod` (every chunk the player changed), `deadNests`, `nestHp`, `looted`, `tileHp`, `explored` (fog). `world.nests/crates/turrets` only hold what is in loaded chunks. Counts (`nestTotal`, `nestsLeft()`) are global.
- Renderer: one baked canvas per visible chunk (ground + static objects together; beacon glow and damage bars are drawn on top), re-baked only when that chunk changes, recycled when unloaded. Minimap is a 160x160-tile window painted per chunk, fogged until explored. Warm frame: ~600 canvas calls and ~0.1 ms of draw in headless Chromium.
- Storage: `store.js` writes `saves` (small JSON) and `chunks` (one Uint8Array per modified chunk) to IndexedDB; unchanged chunks are never rewritten. Export bundle = save + RLE chunks. v1 saves migrate to a `migrated` world (old map stamped at the centre, nothing lost).
- Perf riders: minimap rebuild-per-second removed (harvest hitch), zombie flow buckets pooled (no allocation each rebuild).
- Danger tiers by distance from home add +15% zombie HP per tier (`TUNING.tierHp`). Zone names: Outskirts, The Wilds, Deep Wilds, Dead Reach.
- Golden hash is now `2c656f20` (new world, new nest layout). Not done / deferred: Web Worker generation (not needed), per-chunk entity sleep (zombies far from the player are not simulated anyway), grave chunks (Step 7).

### Step 3: Items, drops, parts, stats (logic only)  [ ]
- **Legacy catalogue import:** port the PAS1 ladder, names and legendaries into `items.json` per `docs/LEGACY_CATALOGUE.md` (sizes, rarity, rescaled stats, legendary uniques/procs, Tier 5 Kevlar set, ammo types, containers, parts and potions). Ratios from PAS1 are kept, raw numbers are rescaled.
- `items.json` schema: id, name, size (w,h), stack, rarity, tags, slot, stats, description.
- Zombie parts replace gems: per-enemy loot tables, rarity, crate and nest tables, pickups on the ground with auto-pickup.
- Stats model (D4): STR, AGI, END, PER, WIT, derived from base + potions + gear. Potions recipes consume parts; `stats.js` applies them.
- Tests: loot table distributions, stat derivation, potion consumption.
- Temporary debug list UI only (no grid yet).

### Step 4: Inventory grid model (logic only)  [ ]
- `inventory.js`: grids with items of w x h, rotation, place/move/stack/split, find-first-fit, containers within containers (backpack, vest).
- `equipment.js`: slots: head, body, weapon 1, weapon 2, vest, backpack, belt/quick slots.
- Ammo and magazines become real items; Step 1's counter is migrated.
- Tests: collision, rotation fit, stacking, equip/unequip effects, save/load of grids.

### Step 5: Inventory popup  [ ]
- Side panel, under half the screen, opens on **Tab/I**; game pauses while any menu is open.
- Gear tab: paper-doll slots plus grid(s); drag and drop, R to rotate, right-click menu (use, equip, drop, split), shift-click quick move; tooltip.
- Open a crate or grave in a second grid beside yours (Take All).
- HUD: hotbar of quick slots, ammo/mag counter, equipped weapon, simple status icons.

### Step 6: Character and Crafting tabs  [ ]
- Character: stats, derived numbers, unspent stat points from potions, equipped summary.
- Crafting: recipes from `recipes.json` (potions, ammo, medical, barricade kits), shows ingredients you have, crafts into the grid, "can't fit" handling.

### Step 7: Skills and Lore log tabs  [ ]
- Skills: XP to skill points to small trees (e.g. Marksman, Scavenger, Builder, Alchemist), data-driven.
- Lore log: entries unlocked by notes you find, landmarks you visit, nests you clear; filterable, read-only.
- Notes and documents as a loot item type.

### Step 8: Codex site on Vercel  [ ]
- `tools/build-codex.mjs` generates static pages from `data/*.json`: item list (size, rarity, where it drops), enemy list, recipes, lore index, patch notes. Linked from the game menu.
- Same data is also shown in-game (a Codex section in the Lore tab).

### Step 9: Balance and polish pass  [ ]
- Tune drop rates, potion yields, ammo scarcity, night difficulty, chunk streaming, performance; fix what playtesting found.

## Working agreements
- One step per session. I will not start the next step until you confirm.
- Before each step I re-read this file and only the files listed for that step.
- Every step ends with: what changed in one paragraph, test output, the playtest checklist, and any decisions I need.
- If the repo is attached to the session with push access, each step lands as one commit (Vercel auto-deploys it); otherwise I hand you the zip.

## Open items
- **Legacy item data:** received 6 PAS1 data files (accessories, armor, weapons, consumables, legendary, materials) and summarised them in `docs/LEGACY_CATALOGUE.md`. Still unseen (optional): `itemIds.ts`, recipes, loot tables, enemy drop data. Send them if you want more callbacks; the plan does not depend on them.
- Trader/shop? Melee durability? See `docs/LEGACY_CATALOGUE.md` §8.
- Does the codex site match what you meant by "item lists, all kinds of information"?
