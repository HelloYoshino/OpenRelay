import { sha256 } from '../util/hash.js';

/**
 * Replaces volatile parts of a message (ids, numbers, timestamps, addresses) with placeholders so that
 * "Request 8f3a… failed after 3021ms" and "Request 77b1… failed after 12ms" become the same template.
 */
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<uuid>')
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[t ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:z|[+-]\d{2}:?\d{2})?)?\b/g, '<ts>')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, '<time>')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, '<ip>')
    .replace(/\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b/g, '<ip>')
    .replace(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, '<email>')
    .replace(/\b0x[0-9a-f]+\b/g, '<hex>')
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,}\b/g, '<hex>')
    .replace(/\d+(?:[.,]\d+)?/g, '<n>')
    .replace(/(["'`]).{1,80}?\1/g, '<str>')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface FingerprintParts {
  source: string;
  service: string | null;
  host: string | null;
  type: string | null;
  title: string;
}

export function computeFingerprint(parts: FingerprintParts): string {
  const key = [parts.source, parts.service ?? '', parts.host ?? '', parts.type ?? '', normalizeText(parts.title)]
    .map((p) => p.toLowerCase())
    .join('\u001f');
  return sha256(key).slice(0, 20);
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'is', 'and', 'or', 'at', 'by', 'with', 'from', 'was', 'has',
  'der', 'die', 'das', 'ein', 'eine', 'und', 'oder', 'ist', 'im', 'in', 'am', 'an', 'auf', 'für', 'mit', 'von', 'zu', 'bei', 'nicht',
]);

/** Tokens used for similarity comparison. Placeholders are dropped, they carry no meaning. */
export function tokenize(input: string): Set<string> {
  const tokens = normalizeText(input)
    .replace(/<[a-z]+>/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return new Set(tokens);
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
