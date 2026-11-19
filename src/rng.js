// Seeded RNG + value noise. Everything procedural in the game flows from these,
// so a (kind, seed) pair always rebuilds the same starting world.

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str) {
  let h = 2166136261;
  for (const c of String(str)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeNoise(seed) {
  const rnd = mulberry32(seed);
  const g = new Float32Array(256 * 256);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const sm = (t) => t * t * (3 - 2 * t);
  const at = (x, y) => g[((y & 255) << 8) | (x & 255)];
  function value(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = sm(x - xi), yf = sm(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  }
  return function fbm(x, y, oct = 4) {
    let amp = 0.5, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += value(x * f, y * f) * amp;
      norm += amp; amp *= 0.5; f *= 2;
    }
    return sum / norm;
  };
}
