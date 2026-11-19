# PA Survivors

A top-down, survivors-like zombie game with **persistent worlds**, inspired by Zed Zone.
Plain ES modules, no build step, no dependencies.

## Run
(Needs a static server because the game loads JSON and ES modules.)
    python3 -m http.server 8080      # or: npm start
    # open http://localhost:8080

(ES modules need http://, opening index.html via file:// will not work.)

## Play
- **WASD / arrows** move. **Mouse** aims, **hold left click** to fire. **R** reload, **1/2** or **Q** pistol/bat, **F** toggle auto-fire.
- Ammo is finite (12-round mags, 240 reserve). **V** turns 5 scrap into 5 rounds. Zombies drop ammo and scrap.
- **Hold E** near trees (wood), rocks (stone) and crates (scrap).
- **B** build mode: **1-3** pick a piece, **click** place, **right-click / X** remove (50% refund). Zombies chew through barricades and walls; turrets shoot.
- Every kill gives XP directly (no gems); level up, pick 1 of 3 upgrades.
- **Nests** (red on the minimap) keep spawning zombies until you destroy them. Destroyed nests stay destroyed.
- Night (60% of the clock onward) brings the horde; at dawn night-walkers burn off.
- Stand near the blue **beacon** to heal. Dying costs half your resources, nothing else.
- **Esc** pauses (and saves). **F3** shows a performance readout (fps, worst frame, sim and draw ms).

## Persistence
Everything about the world is saved: terrain, harvested trees (stumps regrow a little each dawn),
what you built, destroyed nests, looted crates, your level/upgrades/resources, the day clock.
3 slots in localStorage, autosave every 30 s + on dawn/nest kill/pause/close.
**Export / Import** moves a world to another browser as a .json file.

## Maps
- **Fort Hollow**: hand-authored 96x96 (town, river + bridge, quarry, lake, 10 nests, named zones).
- **Seeded**: procedural 128x128 from any seed; same seed, same starting world.

## Layout
    data/            JSON content (enemies so far; items, recipes, loot arrive in later steps)
    src/core/data.js JSON loader + validators (fetch in browser, fs in Node)
    src/tiles.js     tile ids, solidity, build costs, colours
    src/world.js     persistent World (tiles, nests, crates), RLE save format
    src/maps.js      Fort Hollow + seeded generator (nests verified reachable)
    src/game.js      Game state, update loop, save/load; delegates to src/sim/*
    src/sim/         collision, flow (zombie pathing), spawn, enemies, combat,
                     progression, gather, build, player, upgrades, constants (no DOM)
    src/render.js    canvas renderer, night lighting, minimap
    src/save.js      slots, export/import
    src/main.js      menus, HUD, input, loop
    test/            sim.mjs (logic + saves), golden.mjs (seeded regression hash), render-smoke.mjs
    PLAN.md          roadmap and per-step status; docs/ has design notes

## Test
    npm test        # logic tests, golden regression hash, renderer smoke test

## Deploy (Vercel)
Static site, no build step. `vercel.json` enables clean URLs; `.vercelignore` keeps tests and docs out of the deploy.
Dashboard: import the repo, framework preset "Other", no build command. CLI: run `vercel` in this folder.
