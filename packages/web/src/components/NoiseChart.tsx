import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { SeriesPoint } from '../lib/apiTypes';
import { clockTime, compact, dateOnly, num, percent, shortTime } from '../lib/format';

/**
 * Grouped column chart: incoming events vs. sent notifications per time bucket.
 * One shared y-axis (linear or logarithmic), hover/focus tooltip per bucket.
 */

interface Bucket {
  ts: number;
  events: number;
  notifications: number;
}

const HEIGHT = 230;
const MARGIN = { top: 14, right: 8, bottom: 30, left: 44 };

function mergeSeries(events: SeriesPoint[], notifications: SeriesPoint[]): Bucket[] {
  const map = new Map<number, Bucket>();
  for (const p of events) map.set(p.ts, { ts: p.ts, events: p.count, notifications: 0 });
  for (const p of notifications) {
    const b = map.get(p.ts);
    if (b) b.notifications = p.count;
    else map.set(p.ts, { ts: p.ts, events: 0, notifications: p.count });
  }
  return [...map.values()].sort((a, b) => a.ts - b.ts);
}

function bucketSize(buckets: Bucket[]): number {
  if (buckets.length < 2) return 3_600_000;
  const diffs: number[] = [];
  for (let i = 1; i < buckets.length; i++) diffs.push(buckets[i].ts - buckets[i - 1].ts);
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] || 3_600_000;
}

function niceStep(raw: number): number {
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  const f = raw / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return Math.max(1, nice * base);
}

function linearTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

function logTicks(max: number): number[] {
  const ticks = [0, 1];
  let v = 10;
  while (v / 10 < Math.max(1, max)) {
    ticks.push(v);
    v *= 10;
  }
  return ticks;
}

/** Column with rounded data end (top) and a square baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(260, Math.floor(el.clientWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export function NoiseChart({
  events,
  notifications,
  log,
  loading,
  bucketMinutes,
}: {
  events: SeriesPoint[];
  notifications: SeriesPoint[];
  log: boolean;
  loading?: boolean;
  bucketMinutes?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const buckets = useMemo(() => mergeSeries(events, notifications), [events, notifications]);
  const size = useMemo(
    () => (bucketMinutes && bucketMinutes > 0 ? bucketMinutes * 60_000 : bucketSize(buckets)),
    [buckets, bucketMinutes],
  );

  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const maxValue = Math.max(0, ...buckets.map((b) => Math.max(b.events, b.notifications)));
  const ticks = log ? logTicks(maxValue) : linearTicks(maxValue);
  const top = ticks[ticks.length - 1] || 1;

  const scale = (v: number): number => {
    if (v <= 0) return 0;
    if (log) return (Math.log10(1 + v) / Math.log10(1 + top)) * innerH;
    return (v / top) * innerH;
  };

  const n = Math.max(1, buckets.length);
  const slot = innerW / n;
  const barW = Math.max(2, Math.min(14, (slot - 6) / 2));
  const gap = slot > 8 ? 2 : 1;
  const groupW = barW * 2 + gap;

  // Label every k-th bucket so labels keep enough distance (multi-day ranges need date + time).
  const spansDays = buckets.length > 1 && buckets[buckets.length - 1].ts - buckets[0].ts > 36 * 3_600_000;
  const labelEvery = Math.max(1, Math.ceil((spansDays ? 92 : 56) / slot));

  const onKey = (e: KeyboardEvent<SVGGElement>) => {
    if (!buckets.length) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      setActive((cur) => Math.min(buckets.length - 1, Math.max(0, (cur ?? buckets.length - 1) + (cur === null ? 0 : delta))));
    } else if (e.key === 'Escape') setActive(null);
  };

  const activeBucket = active !== null ? buckets[active] : null;
  // Tooltip sits beside the hovered column (right if there is room, else left) so it never hides the bars.
  const TOOLTIP_W = 210;
  const colLeft = active !== null ? MARGIN.left + slot * active : 0;
  const placeRight = colLeft + slot + 8 + TOOLTIP_W <= width;
  const tooltipStyle = placeRight
    ? { left: colLeft + slot + 8, top: MARGIN.top }
    : { right: Math.max(0, width - colLeft + 8), top: MARGIN.top };

  return (
    <div className={`chart${loading ? ' loading' : ''}`} ref={ref}>
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={`Säulendiagramm: Ereignisse und Benachrichtigungen je ${Math.round(size / 60000)} Minuten`}
      >
        <g className="chart-grid">
          {ticks.map((t) => {
            const y = MARGIN.top + innerH - scale(t);
            return <line key={t} x1={MARGIN.left} x2={width - MARGIN.right} y1={y} y2={y} />;
          })}
        </g>
        <g className="chart-axis">
          {ticks.map((t) => (
            <text key={t} x={MARGIN.left - 8} y={MARGIN.top + innerH - scale(t)} textAnchor="end" dominantBaseline="middle">
              {compact(t)}
            </text>
          ))}
          {buckets.map((b, i) => {
            if (i % labelEvery !== 0) return null;
            const label = !spansDays ? clockTime(b.ts) : size >= 86_400_000 ? dateOnly(b.ts) : shortTime(b.ts);
            return (
              <text key={b.ts} x={MARGIN.left + slot * i + slot / 2} y={HEIGHT - 10} textAnchor="middle">
                {label}
              </text>
            );
          })}
        </g>

        {activeBucket ? (
          <rect
            className="chart-hover-band"
            x={MARGIN.left + slot * (active ?? 0)}
            y={MARGIN.top}
            width={slot}
            height={innerH}
            rx={4}
          />
        ) : null}

        <g>
          {buckets.map((b, i) => {
            const x0 = MARGIN.left + slot * i + (slot - groupW) / 2;
            const he = scale(b.events);
            const hn = scale(b.notifications);
            const base = MARGIN.top + innerH;
            return (
              <g key={b.ts} className={`chart-col${active !== null && active !== i ? ' dim' : ''}`}>
                {he > 0 ? <path className="bar-events" d={columnPath(x0, base - he, barW, he)} /> : null}
                {hn > 0 ? (
                  <path
                    className="bar-notifs"
                    d={columnPath(x0 + barW + gap, base - Math.max(hn, 1.5), barW, Math.max(hn, 1.5))}
                  />
                ) : null}
              </g>
            );
          })}
        </g>
        <line
          className="chart-baseline"
          x1={MARGIN.left}
          x2={width - MARGIN.right}
          y1={MARGIN.top + innerH}
          y2={MARGIN.top + innerH}
        />

        <g
          tabIndex={0}
          role="group"
          aria-label="Datenpunkte – mit Pfeiltasten durchblättern"
          onKeyDown={onKey}
          onFocus={() => setActive((cur) => cur ?? (buckets.length ? buckets.length - 1 : null))}
          onBlur={() => setActive(null)}
          onPointerLeave={() => setActive(null)}
          className="chart-hits"
        >
          {buckets.map((b, i) => (
            <rect
              key={b.ts}
              className="chart-hit"
              x={MARGIN.left + slot * i}
              y={MARGIN.top}
              width={slot}
              height={innerH + MARGIN.bottom}
              onPointerEnter={() => setActive(i)}
              onPointerMove={() => setActive(i)}
            />
          ))}
        </g>
      </svg>

      {activeBucket ? (
        <div className="chart-tooltip" style={tooltipStyle}>
          <div className="tt-title">
            {shortTime(activeBucket.ts)} – {clockTime(activeBucket.ts + size)}
          </div>
          <div className="tt-row">
            <span className="tt-key" style={{ background: 'var(--chart-events)' }} />
            <span className="tt-value">{num(activeBucket.events)}</span>
            <span className="tt-name">Ereignisse</span>
          </div>
          <div className="tt-row">
            <span className="tt-key" style={{ background: 'var(--chart-notifs)' }} />
            <span className="tt-value">{num(activeBucket.notifications)}</span>
            <span className="tt-name">Benachrichtigungen</span>
          </div>
          {activeBucket.events > 0 ? (
            <div className="tt-foot">
              {percent(Math.max(0, 1 - activeBucket.notifications / activeBucket.events), 1)} weniger Benachrichtigungen
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function NoiseTable({ events, notifications }: { events: SeriesPoint[]; notifications: SeriesPoint[] }) {
  const buckets = useMemo(() => mergeSeries(events, notifications), [events, notifications]);
  return (
    <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            <th>Zeitraum ab</th>
            <th className="num">Ereignisse</th>
            <th className="num">Benachrichtigungen</th>
            <th className="num">Reduktion</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.ts}>
              <td>{shortTime(b.ts)}</td>
              <td className="num">{num(b.events)}</td>
              <td className="num">{num(b.notifications)}</td>
              <td className="num">{b.events > 0 ? percent(Math.max(0, 1 - b.notifications / b.events), 1) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
