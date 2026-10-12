import { useId, useMemo, useState } from 'react';
import type { ServiceDependency } from '@openrelay/types';

/**
 * Layered dependency graph: services on top, the things they depend on below.
 * Layer = longest dependency path down to a service without dependencies.
 */

interface NodePos {
  name: string;
  x: number;
  y: number;
  w: number;
  depth: number;
}

const NODE_H = 32;
const ROW_GAP = 48;
const COL_GAP = 20;
const PAD = 16;

function nodeWidth(name: string): number {
  return Math.max(72, Math.round(name.length * 7.4 + 26));
}

export function computeLayout(deps: ServiceDependency[]) {
  const out = new Map<string, Set<string>>();
  const add = (n: string) => {
    if (!out.has(n)) out.set(n, new Set());
  };
  for (const d of deps) {
    add(d.service);
    add(d.dependsOn);
    if (d.service !== d.dependsOn) out.get(d.service)?.add(d.dependsOn);
  }

  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (n: string): number => {
    const known = depth.get(n);
    if (known !== undefined) return known;
    if (visiting.has(n)) return 0; // cycle: break here
    visiting.add(n);
    let d = 0;
    for (const dep of out.get(n) ?? []) d = Math.max(d, depthOf(dep) + 1);
    visiting.delete(n);
    depth.set(n, d);
    return d;
  };
  for (const n of out.keys()) depthOf(n);

  const maxDepth = Math.max(0, ...depth.values());
  const layers: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const [n, d] of depth) layers[d].push(n);

  const pos = new Map<string, NodePos>();
  const layerWidth = (names: string[]) =>
    names.reduce((sum, n) => sum + nodeWidth(n), 0) + Math.max(0, names.length - 1) * COL_GAP;
  const width = Math.max(240, ...layers.map(layerWidth)) + PAD * 2;

  for (let d = 0; d <= maxDepth; d++) {
    let names = layers[d];
    if (d === 0) names = [...names].sort((a, b) => a.localeCompare(b));
    else {
      const bary = (n: string) => {
        const xs = [...(out.get(n) ?? [])]
          .map((dep) => pos.get(dep))
          .filter((p): p is NodePos => !!p)
          .map((p) => p.x + p.w / 2);
        return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : width / 2;
      };
      names = [...names].sort((a, b) => bary(a) - bary(b) || a.localeCompare(b));
    }
    layers[d] = names;
    const row = maxDepth - d;
    let x = (width - layerWidth(names)) / 2;
    for (const n of names) {
      const w = nodeWidth(n);
      pos.set(n, { name: n, x, y: PAD + row * (NODE_H + ROW_GAP), w, depth: d });
      x += w + COL_GAP;
    }
  }

  const height = PAD * 2 + (maxDepth + 1) * NODE_H + maxDepth * ROW_GAP;
  const edges: { from: NodePos; to: NodePos }[] = [];
  for (const [n, targets] of out) {
    const from = pos.get(n);
    for (const t of targets) {
      const to = pos.get(t);
      if (from && to) edges.push({ from, to });
    }
  }
  return { nodes: [...pos.values()], edges, width, height, maxDepth };
}

function edgePath(from: NodePos, to: NodePos): string {
  const x1 = from.x + from.w / 2;
  const x2 = to.x + to.w / 2;
  if (to.y > from.y) {
    const y1 = from.y + NODE_H;
    const y2 = to.y - 2;
    const my = (y1 + y2) / 2;
    return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
  }
  // Same layer or upwards (cycle): curve around the side.
  const y1 = from.y + NODE_H / 2;
  const y2 = to.y + NODE_H / 2;
  const dir = x2 >= x1 ? 1 : -1;
  return `M${from.x + (dir > 0 ? from.w : 0)},${y1} C${x1 + dir * 60},${y1 - 40} ${x2 - dir * 60},${y2 - 40} ${to.x + (dir > 0 ? 0 : to.w)},${y2}`;
}

export function TopologyGraph({ deps }: { deps: ServiceDependency[] }) {
  const markerId = useId().replace(/:/g, '');
  const layout = useMemo(() => computeLayout(deps), [deps]);
  const [hover, setHover] = useState<string | null>(null);

  if (layout.nodes.length === 0) return null;

  const related = (e: { from: NodePos; to: NodePos }) => hover !== null && (e.from.name === hover || e.to.name === hover);

  return (
    <div className="graph-wrap">
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label={`Abhängigkeitsgraph mit ${layout.nodes.length} Services und ${layout.edges.length} Abhängigkeiten`}
      >
        <defs>
          <marker
            id={`${markerId}-a`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" className="graph-arrow" />
          </marker>
          <marker
            id={`${markerId}-b`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" className="graph-arrow-active" />
          </marker>
        </defs>
        <g>
          {layout.edges.map((e) => {
            const active = related(e);
            return (
              <path
                key={`${e.from.name}->${e.to.name}`}
                d={edgePath(e.from, e.to)}
                className={`graph-edge${active ? ' active' : hover ? ' dim' : ''}`}
                markerEnd={`url(#${markerId}-${active ? 'b' : 'a'})`}
              >
                <title>
                  {e.from.name} hängt ab von {e.to.name}
                </title>
              </path>
            );
          })}
        </g>
        <g>
          {layout.nodes.map((n) => (
            <g
              key={n.name}
              className={`graph-node${n.depth === 0 ? ' root' : ''}${hover === n.name ? ' active' : ''}`}
              transform={`translate(${n.x},${n.y})`}
              onPointerEnter={() => setHover(n.name)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(n.name)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={n.name}
            >
              <rect width={n.w} height={NODE_H} rx={7} />
              <text x={n.w / 2} y={NODE_H / 2} textAnchor="middle" dominantBaseline="central">
                {n.name}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
