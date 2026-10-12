import type { ServiceDependency } from '../types.js';

const MAX_DEPTH = 6;

/**
 * Service dependency graph ("api depends on postgres").
 * Used to correlate alerts of dependent services and to infer the probable root cause of an incident.
 */
export class Topology {
  private readonly deps = new Map<string, Set<string>>();
  private readonly distanceCache = new Map<string, number | null>();

  constructor(edges: ServiceDependency[] = []) {
    for (const edge of edges) {
      const from = edge.service.trim().toLowerCase();
      const to = edge.dependsOn.trim().toLowerCase();
      if (!from || !to || from === to) continue;
      if (!this.deps.has(from)) this.deps.set(from, new Set());
      this.deps.get(from)!.add(to);
    }
  }

  get size(): number {
    return this.deps.size;
  }

  /** Hops from `from` to `to` along "depends on" edges (1 = direct dependency), or null. */
  distance(from: string, to: string): number | null {
    const a = from.toLowerCase();
    const b = to.toLowerCase();
    if (a === b || this.deps.size === 0) return null;
    const key = `${a}\u0000${b}`;
    if (this.distanceCache.has(key)) return this.distanceCache.get(key)!;

    let result: number | null = null;
    const seen = new Set<string>([a]);
    let frontier = [a];
    for (let depth = 1; depth <= MAX_DEPTH && frontier.length > 0 && result === null; depth++) {
      const next: string[] = [];
      for (const node of frontier) {
        for (const dep of this.deps.get(node) ?? []) {
          if (dep === b) {
            result = depth;
            break;
          }
          if (!seen.has(dep)) {
            seen.add(dep);
            next.push(dep);
          }
        }
        if (result !== null) break;
      }
      frontier = next;
    }
    this.distanceCache.set(key, result);
    return result;
  }

  /** Describes how two services relate: `downstream` depends (transitively) on `upstream`. */
  relation(a: string, b: string): { upstream: string; downstream: string; distance: number } | null {
    const ab = this.distance(a, b);
    if (ab !== null) return { upstream: b, downstream: a, distance: ab };
    const ba = this.distance(b, a);
    if (ba !== null) return { upstream: a, downstream: b, distance: ba };
    return null;
  }

  /** All (transitive) dependencies of a service with their distance. */
  dependenciesOf(service: string): Map<string, number> {
    const out = new Map<string, number>();
    let frontier = [service.toLowerCase()];
    for (let depth = 1; depth <= MAX_DEPTH && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const node of frontier) {
        for (const dep of this.deps.get(node) ?? []) {
          if (!out.has(dep)) {
            out.set(dep, depth);
            next.push(dep);
          }
        }
      }
      frontier = next;
    }
    return out;
  }

  /** Closest dependency shared by two services ("api and worker both depend on postgres"). */
  commonDependency(a: string, b: string): string | null {
    const da = this.dependenciesOf(a);
    const db = this.dependenciesOf(b);
    let best: { service: string; distance: number } | null = null;
    for (const [service, distance] of da) {
      const other = db.get(service);
      if (other === undefined) continue;
      const total = distance + other;
      if (!best || total < best.distance) best = { service, distance: total };
    }
    return best?.service ?? null;
  }

  /** Services from `among` that (transitively) depend on `service`. */
  dependentsAmong(service: string, among: string[]): string[] {
    return among.filter((other) => other.toLowerCase() !== service.toLowerCase() && this.distance(other, service) !== null);
  }
}
