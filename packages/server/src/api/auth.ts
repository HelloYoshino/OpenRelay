import type { FastifyRequest } from 'fastify';
import type { OpenRelay } from '../relay.js';
import type { ApiKey, ApiScope } from '../types.js';
import { newId, newToken } from '../util/ids.js';
import { safeEqual, sha256 } from '../util/hash.js';

export interface Principal {
  name: string;
  scopes: ApiScope[];
  apiKeyId: string | null;
  defaultSource: string | null;
}

/** `any` = every valid token, `public` = no token needed. */
export type RequiredScope = ApiScope | 'any' | 'public';

const ADMIN_HASH_KEY = 'admin_token_hash';

export function hasScope(principal: Principal, required: ApiScope): boolean {
  if (principal.scopes.includes('admin')) return true;
  return principal.scopes.includes(required);
}

export function tokenFromRequest(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (auth) {
    const m = /^(?:Bearer|Token)\s+(.+)$/i.exec(auth);
    if (m) return m[1].trim();
    const basic = /^Basic\s+(.+)$/i.exec(auth);
    if (basic) {
      // Allows `https://token@host/...` or user:token for tools that only support basic auth.
      const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      const user = idx >= 0 ? decoded.slice(0, idx) : decoded;
      const pass = idx >= 0 ? decoded.slice(idx + 1) : '';
      return (pass || user).trim() || null;
    }
  }
  const header = req.headers['x-openrelay-token'];
  if (typeof header === 'string' && header) return header.trim();
  const query = (req.query as Record<string, unknown> | undefined)?.token;
  if (typeof query === 'string' && query) return query.trim();
  return null;
}

export class Authenticator {
  private adminHash: string;
  private readonly touched = new Map<string, number>();

  constructor(
    private readonly relay: OpenRelay,
    adminToken: string | null,
  ) {
    if (adminToken) {
      this.adminHash = sha256(adminToken);
    } else {
      this.adminHash = relay.store.getSetting<string>(ADMIN_HASH_KEY) ?? '';
    }
  }

  /** Generates an admin token on first start (when none is configured). Returns it once. */
  ensureAdminToken(): string | null {
    if (this.adminHash) return null;
    return this.rotateAdminToken();
  }

  rotateAdminToken(): string {
    const token = newToken('ora', 24);
    this.adminHash = sha256(token);
    this.relay.store.setSetting(ADMIN_HASH_KEY, this.adminHash);
    return token;
  }

  resolve(token: string | null): Principal | null {
    if (!token) return null;
    const hash = sha256(token);
    if (this.adminHash && safeEqual(hash, this.adminHash)) {
      return { name: 'admin', scopes: ['admin'], apiKeyId: null, defaultSource: null };
    }
    const key = this.relay.store.apiKeyByHash(hash);
    if (!key) return null;
    const now = this.relay.clock.now();
    if ((this.touched.get(key.id) ?? 0) < now - 60_000) {
      this.touched.set(key.id, now);
      this.relay.store.touchApiKey(key.id, now);
    }
    return { name: key.name, scopes: key.scopes, apiKeyId: key.id, defaultSource: key.defaultSource };
  }

  createApiKey(input: { name: string; scopes: ApiScope[]; defaultSource?: string | null }): { apiKey: ApiKey; token: string } {
    const token = newToken('or', 24);
    const now = this.relay.clock.now();
    const apiKey: ApiKey = {
      id: newId('key', now),
      name: input.name,
      prefix: token.slice(0, 8),
      scopes: [...new Set(input.scopes)],
      defaultSource: input.defaultSource || null,
      createdAt: now,
      lastUsedAt: null,
    };
    this.relay.store.insertApiKey({ ...apiKey, keyHash: sha256(token) });
    return { apiKey, token };
  }
}
