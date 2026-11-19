// Reusable spatial hash for enemies. Fixed-size typed arrays, rebuilt every frame with zero allocation.
// Cells hash into a small bucket table, so it works for any coordinates (unbounded / chunked worlds).
// Collisions only add a few extra candidates; callers always re-check real distances.

const BUCKETS = 4096; // power of two
export const CELL = 48;

export class Grid {
  constructor(maxItems) {
    this.head = new Int32Array(BUCKETS).fill(-1);
    this.next = new Int32Array(maxItems);
    this.near = new Int32Array(9); // scratch: unique bucket ids around a point
  }
  clear() { this.head.fill(-1); }
  add(i, x, y) {
    const b = (((Math.floor(x / CELL) * 73856093) ^ (Math.floor(y / CELL) * 19349663)) & (BUCKETS - 1));
    this.next[i] = this.head[b]; this.head[b] = i;
  }
  // Fills this.near with the unique buckets of the 3x3 cells around (x, y); returns how many.
  query(x, y) {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    let n = 0;
    for (let ax = -1; ax <= 1; ax++) for (let ay = -1; ay <= 1; ay++) {
      const b = (((cx + ax) * 73856093) ^ ((cy + ay) * 19349663)) & (BUCKETS - 1);
      let dup = false;
      for (let k = 0; k < n; k++) if (this.near[k] === b) { dup = true; break; }
      if (!dup) this.near[n++] = b;
    }
    return n;
  }
}
