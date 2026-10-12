import { parseSeverity, severityRank, isSeverity } from './severity.js';

/**
 * Tiny condition language used by routes, silences, event rules and volume rules.
 *
 *   severity >= high
 *   labels.env = prod
 *   service =~ ^api-
 *   source in [github, gitlab]
 *   host = web-*
 *   labels.team exists
 */

export type MatchValue = string | number | null | undefined | string[];
export type MatchContext = Record<string, MatchValue>;

type Operator = '=' | '!=' | '=~' | '!~' | '>=' | '>' | '<=' | '<' | 'in' | 'not in' | 'exists' | 'missing';

export interface Condition {
  expr: string;
  field: string;
  op: Operator;
  value: string;
  list: string[];
  regex: RegExp | null;
}

export class MatcherError extends Error {}

const OPERATORS: Array<[string, Operator]> = [
  ['>=', '>='],
  ['<=', '<='],
  ['!=', '!='],
  ['=~', '=~'],
  ['!~', '!~'],
  ['==', '='],
  ['=', '='],
  ['>', '>'],
  ['<', '<'],
];

const cache = new Map<string, Condition>();

function unquote(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

function parseList(raw: string): string[] {
  let v = raw.trim();
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  return v
    .split(',')
    .map((s) => unquote(s))
    .filter((s) => s.length > 0);
}

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

export function parseCondition(expr: string): Condition {
  const cached = cache.get(expr);
  if (cached) return cached;

  const m = /^\s*([A-Za-z_][\w.\-/]*)\s*(.*)$/s.exec(expr);
  if (!m) throw new MatcherError(`Ungültige Bedingung: "${expr}"`);
  const field = m[1];
  const rest = m[2].trim();
  let op: Operator | null = null;
  let value = '';

  const lower = rest.toLowerCase();
  if (lower === 'exists') op = 'exists';
  else if (lower === 'missing' || lower === '!exists') op = 'missing';
  else if (lower.startsWith('not in ') || lower.startsWith('not in[')) {
    op = 'not in';
    value = rest.slice(6);
  } else if (lower.startsWith('in ') || lower.startsWith('in[')) {
    op = 'in';
    value = rest.slice(2);
  } else {
    for (const [token, operator] of OPERATORS) {
      if (rest.startsWith(token)) {
        op = operator;
        value = rest.slice(token.length);
        break;
      }
    }
  }
  if (!op) throw new MatcherError(`Unbekannter Operator in "${expr}" (erlaubt: = != =~ !~ >= > <= < in, not in, exists, missing)`);

  value = unquote(value);
  const list = op === 'in' || op === 'not in' ? parseList(value) : [];
  if ((op === 'in' || op === 'not in') && list.length === 0) {
    throw new MatcherError(`Leere Liste in "${expr}"`);
  }
  if (op !== 'exists' && op !== 'missing' && op !== 'in' && op !== 'not in' && value === '' && op !== '=' && op !== '!=') {
    throw new MatcherError(`Wert fehlt in "${expr}"`);
  }

  let regex: RegExp | null = null;
  if (op === '=~' || op === '!~') {
    try {
      regex = new RegExp(value, 'i');
    } catch (err) {
      throw new MatcherError(`Ungültiger regulärer Ausdruck in "${expr}": ${(err as Error).message}`);
    }
  } else if ((op === '=' || op === '!=') && value.includes('*')) {
    regex = globToRegex(value);
  }

  if (field === 'severity' && ['>=', '>', '<=', '<'].includes(op)) {
    // An unknown value would silently fall back to a default level; reject it instead.
    if (!isSeverity(value.toLowerCase()) && parseSeverity(value, 'debug') !== parseSeverity(value, 'critical')) {
      throw new MatcherError(`Unbekannter Schweregrad in "${expr}"`);
    }
  }

  const condition: Condition = { expr, field, op, value, list, regex };
  if (cache.size > 5000) cache.clear();
  cache.set(expr, condition);
  return condition;
}

function isEmpty(v: MatchValue): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

function compareOrdered(field: string, actual: string | number, expected: string, op: Operator): boolean {
  let a: number;
  let b: number;
  if (field === 'severity') {
    a = severityRank(parseSeverity(String(actual), 'warning'));
    b = severityRank(parseSeverity(expected, 'warning'));
  } else {
    a = Number(actual);
    b = Number(expected);
    if (Number.isNaN(a) || Number.isNaN(b)) {
      const cmp = String(actual).localeCompare(expected);
      a = cmp;
      b = 0;
    }
  }
  switch (op) {
    case '>=':
      return a >= b;
    case '>':
      return a > b;
    case '<=':
      return a <= b;
    default:
      return a < b;
  }
}

function matchScalar(c: Condition, actual: string | number): boolean {
  const text = String(actual);
  switch (c.op) {
    case '=':
      return c.regex ? c.regex.test(text) : text.toLowerCase() === c.value.toLowerCase();
    case '=~':
      return c.regex!.test(text);
    case 'in':
      return c.list.some((v) => v.toLowerCase() === text.toLowerCase());
    case '>=':
    case '>':
    case '<=':
    case '<':
      return compareOrdered(c.field, actual, c.value, c.op);
    default:
      return false;
  }
}

export function evaluateCondition(c: Condition, ctx: MatchContext): boolean {
  const actual = ctx[c.field];
  if (c.op === 'exists') return !isEmpty(actual);
  if (c.op === 'missing') return isEmpty(actual);

  const negated = c.op === '!=' || c.op === '!~' || c.op === 'not in';
  const positive: Condition = negated
    ? { ...c, op: c.op === '!=' ? '=' : c.op === '!~' ? '=~' : 'in' }
    : c;

  if (isEmpty(actual)) {
    // An empty value never equals anything, except an explicit empty comparison (`field = ""`).
    if (positive.op === '=' && c.value === '') return !negated;
    return negated;
  }
  const values = Array.isArray(actual) ? actual : [actual as string | number];
  const any = values.some((v) => matchScalar(positive, v));
  return negated ? !any : any;
}

export function matchesAll(exprs: string[], ctx: MatchContext): boolean {
  for (const expr of exprs) {
    if (!evaluateCondition(parseCondition(expr), ctx)) return false;
  }
  return true;
}

export function explainMatch(exprs: string[], ctx: MatchContext): Array<{ expr: string; matched: boolean }> {
  return exprs.map((expr) => ({ expr, matched: evaluateCondition(parseCondition(expr), ctx) }));
}

/** Returns a list of human readable errors (empty when all conditions are valid). */
export function validateMatchers(exprs: unknown): string[] {
  if (!Array.isArray(exprs)) return ['Bedingungen müssen eine Liste sein'];
  const errors: string[] = [];
  for (const expr of exprs) {
    if (typeof expr !== 'string') {
      errors.push(`Bedingung muss ein Text sein: ${JSON.stringify(expr)}`);
      continue;
    }
    try {
      parseCondition(expr);
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  return errors;
}

export function flattenLabels(labels: Record<string, string>, prefix = 'labels.'): MatchContext {
  const out: MatchContext = {};
  for (const [k, v] of Object.entries(labels)) out[`${prefix}${k}`] = v;
  return out;
}
