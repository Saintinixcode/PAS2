export const DAY_LEN = 300;      // seconds per full day
export const NIGHT_START = 0.6;  // clock fraction where night begins
export const FLOW_R = 40;        // flow field radius (tiles)
export const INF = 32767;
export const MAX_ENEMIES = 60;   // hard cap (was 220): threat comes from variety and toughness, not headcount
export const BASE_RATE = 0.55;   // baseline fire-rate stat; upgrades scale weapon cooldowns by (rate / BASE_RATE)
export const AMMO_CAP = 240;     // reserve ammo cap

// Spawn / difficulty tuning in one place (Step 9 will rebalance these).
export const TUNING = {
  hpScalePerDay: 0.18, dmgScalePerDay: 0.06,
  ambientDay: 0.03, ambientCapDay: 4,                 // spawns/sec and live cap in daylight
  ambientNightBase: 0.15, ambientNightPerDay: 0.05,   // spawns/sec = base + perDay * day, times nest intensity
  ambientCapNight: 14, ambientCapPerDay: 2.5, ambientCapMax: 40,
  nestCapBase: 3, nestCapMax: 8,                      // live zombies per nest = base + floor(day / 2), capped
  nestIntervalBase: 6, nestIntervalPerDay: 0.25, nestIntervalMin: 2.5, nestNightSpeedup: 1.5,
  tierHp: 0.15, dropLifetime: 120,
};

export const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
