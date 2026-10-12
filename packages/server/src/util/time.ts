export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Parses "90", "30s", "15m", "2h", "7d" into milliseconds (bare numbers are seconds). */
export function parseDuration(input: string | number): number {
  if (typeof input === 'number') return input * SECOND;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?\s*$/i.exec(input);
  if (!m) throw new Error(`Ungültige Dauer: ${input}`);
  const n = Number(m[1]);
  switch ((m[2] ?? 's').toLowerCase()) {
    case 'ms':
      return n;
    case 's':
      return n * SECOND;
    case 'm':
      return n * MINUTE;
    case 'h':
      return n * HOUR;
    default:
      return n * DAY;
  }
}

/** Human readable duration in German/English, e.g. "12 min", "3 h 5 min". */
export function formatDuration(ms: number, locale: 'de' | 'en' = 'de'): string {
  const totalMinutes = Math.max(0, Math.round(ms / MINUTE));
  if (totalMinutes < 1) {
    const s = Math.max(0, Math.round(ms / SECOND));
    return `${s} s`;
  }
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days) parts.push(locale === 'de' ? `${days} ${days === 1 ? 'Tag' : 'Tage'}` : `${days} d`);
  if (hours) parts.push(`${hours} h`);
  if (minutes && !days) parts.push(`${minutes} min`);
  return parts.join(' ');
}

/** Minutes since local midnight in the given time zone. */
export function localMinutes(ts: number, timeZone?: string): { minutes: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(new Date(ts));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
  return { minutes: hour * 60 + minute, weekday };
}

export function parseClock(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error(`Ungültige Uhrzeit: ${hhmm} (erwartet HH:MM)`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Ungültige Uhrzeit: ${hhmm}`);
  return h * 60 + min;
}
