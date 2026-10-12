import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations.js';

export type SqlValue = string | number | bigint | null | Uint8Array;
type ParamValue = SqlValue | boolean | undefined;
export type Params = Record<string, ParamValue> | ParamValue[];

function bindValue(v: ParamValue): SqlValue {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

function bind(params?: Params): SqlValue[] | [Record<string, SqlValue>] {
  if (!params) return [];
  if (Array.isArray(params)) return params.map(bindValue);
  const out: Record<string, SqlValue> = {};
  for (const [k, v] of Object.entries(params)) out[k] = bindValue(v);
  return [out];
}

/** Thin synchronous wrapper around node:sqlite with statement caching and nested transactions. */
export class Database {
  readonly raw: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private depth = 0;

  constructor(readonly path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = OFF;
    `);
    this.migrate();
  }

  private statement(sql: string): StatementSync {
    let stmt = this.statements.get(sql);
    if (!stmt) {
      stmt = this.raw.prepare(sql);
      this.statements.set(sql, stmt);
    }
    return stmt;
  }

  run(sql: string, params?: Params): { changes: number; lastInsertRowid: number } {
    const result = this.statement(sql).run(...(bind(params) as SqlValue[]));
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
  }

  get<T = Record<string, SqlValue>>(sql: string, params?: Params): T | undefined {
    return this.statement(sql).get(...(bind(params) as SqlValue[])) as T | undefined;
  }

  all<T = Record<string, SqlValue>>(sql: string, params?: Params): T[] {
    return this.statement(sql).all(...(bind(params) as SqlValue[])) as T[];
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /** Runs `fn` atomically. Nested calls use savepoints. */
  tx<T>(fn: () => T): T {
    const name = `sp_${this.depth}`;
    this.raw.exec(this.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
    this.depth++;
    try {
      const result = fn();
      this.depth--;
      this.raw.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
      return result;
    } catch (err) {
      this.depth--;
      this.raw.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
      throw err;
    }
  }

  get inTransaction(): boolean {
    return this.depth > 0;
  }

  close(): void {
    this.statements.clear();
    this.raw.close();
  }

  private migrate(): void {
    this.raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
    const row = this.get<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations');
    const current = row?.v ?? 0;
    for (const [index, sql] of MIGRATIONS.entries()) {
      const version = index + 1;
      if (version <= current) continue;
      this.tx(() => {
        this.raw.exec(sql);
        this.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [version, Date.now()]);
      });
    }
  }
}
