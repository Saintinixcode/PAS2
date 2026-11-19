export const TS = 32; // tile size in pixels

export const T = {
  GRASS: 0, DIRT: 1, ROAD: 2, FLOOR: 3, WALL: 4, TREE: 5, ROCK: 6, WATER: 7,
  STUMP: 8, BARRICADE: 9, TURRET: 10, BEACON: 11, RUBBLE: 12, STONEWALL: 13,
};

export const SOLID = new Uint8Array(32);
[T.WALL, T.TREE, T.ROCK, T.WATER, T.BARRICADE, T.TURRET, T.BEACON, T.STONEWALL]
  .forEach((t) => (SOLID[t] = 1));

// Tiles bullets cannot cross.
export const BLOCKS_SHOT = new Uint8Array(32);
[T.WALL, T.ROCK, T.STONEWALL, T.BEACON].forEach((t) => (BLOCKS_SHOT[t] = 1));

// Player-built tiles: zombies will chew through them. Value = max HP.
export const BREAKABLE = { [T.BARRICADE]: 40, [T.STONEWALL]: 140, [T.TURRET]: 80 };

// Tiles the player may build on.
export const BUILDABLE_ON = new Uint8Array(32);
[T.GRASS, T.DIRT, T.ROAD, T.FLOOR, T.STUMP, T.RUBBLE].forEach((t) => (BUILDABLE_ON[t] = 1));

export const BUILDS = [
  { id: T.BARRICADE, name: 'Barricade', cost: { wood: 3 } },
  { id: T.STONEWALL, name: 'Stone Wall', cost: { stone: 4 } },
  { id: T.TURRET, name: 'Turret', cost: { scrap: 8, stone: 4 } },
];

// [base color, minimap color]
export const COLORS = {
  [T.GRASS]: '#3d5a2e', [T.DIRT]: '#6b5a3e', [T.ROAD]: '#4a4a50', [T.FLOOR]: '#7a6a55',
  [T.WALL]: '#2b2630', [T.TREE]: '#3d5a2e', [T.ROCK]: '#6b5a3e', [T.WATER]: '#24506e',
  [T.STUMP]: '#3d5a2e', [T.BARRICADE]: '#6b5a3e', [T.TURRET]: '#4a4a50', [T.BEACON]: '#6b5a3e',
  [T.RUBBLE]: '#6b5a3e', [T.STONEWALL]: '#6b5a3e',
};

export const MINI = {
  [T.GRASS]: [52, 80, 38], [T.DIRT]: [107, 90, 62], [T.ROAD]: [90, 90, 98], [T.FLOOR]: [140, 120, 95],
  [T.WALL]: [30, 26, 36], [T.TREE]: [28, 56, 28], [T.ROCK]: [120, 120, 128], [T.WATER]: [36, 80, 110],
  [T.STUMP]: [52, 80, 38], [T.BARRICADE]: [180, 130, 70], [T.TURRET]: [230, 200, 80], [T.BEACON]: [80, 200, 255],
  [T.RUBBLE]: [107, 90, 62], [T.STONEWALL]: [170, 170, 180],
};
