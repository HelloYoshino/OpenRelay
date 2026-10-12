import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/** Time-sortable, URL-safe id with a type prefix, e.g. `inc_0m5x2k9q3h7r4b8n`. */
export function newId(prefix: string, now = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 9; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(8);
  let rand = '';
  for (const b of bytes) rand += ALPHABET[b % 32];
  return `${prefix}_${time}${rand}`;
}

/** Random secret token, e.g. for API keys. */
export function newToken(prefix = 'or', bytes = 24): string {
  return `${prefix}_${randomBytes(bytes).toString('base64url')}`;
}

/** Lowercase slug usable as id for provisioned entities. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
