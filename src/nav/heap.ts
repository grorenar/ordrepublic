/** Tas binaire min (priorité flottante) avec suppression paresseuse : insertions répétées tolérées. */
export class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  clear(): void {
    this.keys.length = 0;
    this.vals.length = 0;
  }
  peekKey(): number {
    return this.keys[0] ?? Infinity;
  }
  push(key: number, val: number): void {
    let i = this.keys.length;
    this.keys.push(key);
    this.vals.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.keys[p] as number) <= key) break;
      this.keys[i] = this.keys[p] as number;
      this.vals[i] = this.vals[p] as number;
      i = p;
    }
    this.keys[i] = key;
    this.vals[i] = val;
  }
  /** Retire et retourne la valeur de plus petite clé ; la clé est lisible via `lastKey`. */
  lastKey = 0;
  pop(): number {
    const topV = this.vals[0] as number;
    this.lastKey = this.keys[0] as number;
    const k = this.keys.pop() as number;
    const v = this.vals.pop() as number;
    const n = this.keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && (this.keys[c + 1] as number) < (this.keys[c] as number)) c++;
        if ((this.keys[c] as number) >= k) break;
        this.keys[i] = this.keys[c] as number;
        this.vals[i] = this.vals[c] as number;
        i = c;
      }
      this.keys[i] = k;
      this.vals[i] = v;
    }
    return topV;
  }
}
