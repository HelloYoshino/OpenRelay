const LOCALE = 'de-DE';

const absFormatter = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'medium' });
const shortFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const timeFormatter = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });
const dateFormatter = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' });
const numberFormatter = new Intl.NumberFormat(LOCALE);
const compactFormatter = new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 });

export function absTime(ts: number | null | undefined): string {
  if (ts === null || ts === undefined) return '–';
  return absFormatter.format(new Date(ts));
}

export function shortTime(ts: number): string {
  return shortFormatter.format(new Date(ts));
}

export function clockTime(ts: number): string {
  return timeFormatter.format(new Date(ts));
}

export function dateOnly(ts: number): string {
  return dateFormatter.format(new Date(ts));
}

/** "vor 5 min", "in 3 h", "gerade eben". */
export function relTime(ts: number, now: number = Date.now()): string {
  const diff = ts - now;
  const abs = Math.abs(diff);
  const future = diff > 0;
  const sec = Math.round(abs / 1000);
  if (sec < 45) return future ? 'gleich' : 'gerade eben';
  const min = Math.round(sec / 60);
  let text: string;
  if (min < 60) text = `${min} min`;
  else {
    const h = Math.round(min / 60);
    if (h < 24) text = `${h} h`;
    else {
      const d = Math.round(h / 24);
      if (d < 30) text = d === 1 ? '1 Tag' : `${d} Tagen`;
      else return dateOnly(ts);
    }
  }
  return future ? `in ${text}` : `vor ${text}`;
}

/** Human duration from minutes: "12 min", "3 h 5 min", "2 T 4 h". */
export function durationMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '–';
  if (minutes < 1) return `${Math.max(0, Math.round(minutes * 60))} s`;
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d} T ${rh} h` : `${d} T`;
}

export function durationMs(ms: number): string {
  return durationMinutes(ms / 60_000);
}

export function num(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return numberFormatter.format(n);
}

export function compact(n: number): string {
  return n >= 1000 ? compactFormatter.format(n) : numberFormatter.format(n);
}

export function percent(fraction: number | null | undefined, digits = 0): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return '–';
  return `${(fraction * 100).toLocaleString(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: 0 })} %`;
}

export function plural(n: number, one: string, many: string): string {
  return `${num(n)} ${n === 1 ? one : many}`;
}

/** Value for `<input type="datetime-local">` in local time. */
export function toLocalInput(ts: number): string {
  const d = new Date(ts);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

/** Parses `k=v` lines (or comma separated) into a label map. */
export function parseLabels(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(/[\n,]/)) {
    const line = part.trim();
    if (!line) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

export function formatLabels(labels: Record<string, string> | null | undefined): string {
  if (!labels) return '';
  return Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

export function splitList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
