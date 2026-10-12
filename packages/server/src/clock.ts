export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/** Manually advanced clock for tests and simulations. */
export class ManualClock implements Clock {
  constructor(private current = Date.UTC(2026, 0, 1, 12, 0, 0)) {}
  now(): number {
    return this.current;
  }
  set(ts: number): void {
    this.current = ts;
  }
  advance(ms: number): number {
    this.current += ms;
    return this.current;
  }
}
