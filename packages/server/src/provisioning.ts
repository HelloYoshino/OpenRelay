import { readFileSync } from 'node:fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { ConfigError, SECRET_MASK, type ConfigService } from './config-service.js';
import type { OpenRelay } from './relay.js';
import { isPlainObject } from './util/json.js';
import { slugify } from './util/ids.js';

/**
 * Declarative configuration ("GitOps"): channels, escalation policies, routes, topology, silences and
 * settings in one YAML/JSON document. Entities are upserted by id; `${ENV_VAR}` / `${ENV_VAR:-default}`
 * placeholders are resolved from the environment so secrets can stay out of the file.
 */

export interface ImportSummary {
  channels: number;
  escalationPolicies: number;
  routes: number;
  silences: number;
  dependencies: number;
  settings: boolean;
}

type Doc = Record<string, unknown>;

export function interpolate<T>(value: T, env: Record<string, string | undefined>): T {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_m, name: string, fallback?: string) => {
      const v = env[name];
      if (v !== undefined && v !== '') return v;
      if (fallback !== undefined) return fallback;
      throw new ConfigError(`Umgebungsvariable ${name} ist nicht gesetzt`);
    }) as T;
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v, env)) as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = interpolate(v, env);
    return out as T;
  }
  return value;
}

function list(doc: Doc, key: string): Doc[] {
  const value = doc[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ConfigError(`"${key}" muss eine Liste sein`);
  return value.map((v, i) => {
    if (!isPlainObject(v)) throw new ConfigError(`${key}[${i}] muss ein Objekt sein`);
    return v;
  });
}

function withId(entry: Doc, prefix: string): Doc {
  if (entry.id) return entry;
  if (typeof entry.name !== 'string') throw new ConfigError(`${prefix}: "id" oder "name" erforderlich`);
  return { ...entry, id: slugify(entry.name) || undefined };
}

export function parseConfigText(text: string): Doc {
  const trimmed = text.trim();
  if (!trimmed) return {};
  let doc: unknown;
  try {
    doc = trimmed.startsWith('{') ? JSON.parse(trimmed) : parseYaml(trimmed);
  } catch (err) {
    throw new ConfigError(`Konfiguration nicht lesbar: ${(err as Error).message}`);
  }
  if (doc === null || doc === undefined) return {};
  if (!isPlainObject(doc)) throw new ConfigError('Konfiguration muss ein Objekt sein');
  return doc;
}

export function importConfig(
  relay: OpenRelay,
  config: ConfigService,
  raw: Doc,
  env: Record<string, string | undefined> = process.env,
): ImportSummary {
  const doc = interpolate(raw, env);
  const summary: ImportSummary = { channels: 0, escalationPolicies: 0, routes: 0, silences: 0, dependencies: 0, settings: false };
  relay.store.tx(() => {
    if (doc.settings !== undefined) {
      relay.updateSettings(doc.settings);
      summary.settings = true;
    }
    for (const entry of list(doc, 'channels')) {
      const e = withId(entry, 'channels');
      const existing = relay.store.getChannel(String(e.id));
      config.saveChannel(e, existing ? existing.id : undefined);
      summary.channels++;
    }
    for (const entry of list(doc, 'escalationPolicies')) {
      const e = withId(entry, 'escalationPolicies');
      const existing = relay.store.getPolicy(String(e.id));
      config.savePolicy(e, existing ? existing.id : undefined);
      summary.escalationPolicies++;
    }
    list(doc, 'routes').forEach((entry, index) => {
      const e = withId(entry, 'routes');
      const normalized: Doc = { position: index, ...e };
      if (normalized.escalationPolicy !== undefined && normalized.escalationPolicyId === undefined) {
        normalized.escalationPolicyId = normalized.escalationPolicy;
      }
      delete normalized.escalationPolicy;
      if (typeof normalized.matchers === 'string') normalized.matchers = [normalized.matchers];
      const existing = relay.store.getRoute(String(normalized.id));
      config.saveRoute(normalized, existing ? existing.id : undefined);
      summary.routes++;
    });
    for (const entry of list(doc, 'silences')) {
      const existing = entry.id ? relay.store.getSilence(String(entry.id)) : undefined;
      config.saveSilence(entry, 'provisioning', existing?.id);
      summary.silences++;
    }
    if (doc.topology !== undefined) {
      const items: Array<{ service: string; dependsOn: string }> = [];
      for (const entry of list(doc, 'topology')) {
        const deps = Array.isArray(entry.dependsOn) ? entry.dependsOn : [entry.dependsOn];
        for (const dep of deps) items.push({ service: String(entry.service), dependsOn: String(dep) });
      }
      summary.dependencies = config.setDependencies(items).length;
    }
  });
  return summary;
}

export function importConfigFile(relay: OpenRelay, config: ConfigService, path: string): ImportSummary {
  return importConfig(relay, config, parseConfigText(readFileSync(path, 'utf8')));
}

/** Current configuration as YAML. Secrets are masked unless `includeSecrets` is set. */
export function exportConfig(relay: OpenRelay, config: ConfigService, includeSecrets = false): string {
  const channels = relay.store.listChannels().map((c) => {
    const ch = includeSecrets ? c : config.maskChannel(c);
    return { id: ch.id, name: ch.name, type: ch.type, enabled: ch.enabled, config: ch.config };
  });
  const escalationPolicies = relay.store.listPolicies().map((p) => ({ id: p.id, name: p.name, repeat: p.repeat, steps: p.steps }));
  const routes = relay.store.listRoutes().map((r) => {
    const out: Doc = {
      id: r.id,
      name: r.name,
      enabled: r.enabled,
      matchers: r.matchers,
      channels: r.channels,
      delivery: r.delivery,
    };
    if (r.digestMinutes !== null) out.digestMinutes = r.digestMinutes;
    if (r.escalationPolicyId) out.escalationPolicy = r.escalationPolicyId;
    if (r.quietHours) out.quietHours = r.quietHours;
    if (!r.notifyResolved) out.notifyResolved = false;
    if (r.stop) out.stop = true;
    return out;
  });
  const grouped = new Map<string, string[]>();
  for (const d of relay.store.listDependencies()) {
    if (!grouped.has(d.service)) grouped.set(d.service, []);
    grouped.get(d.service)!.push(d.dependsOn);
  }
  const topology = [...grouped].map(([service, dependsOn]) => ({ service, dependsOn }));
  const doc = { settings: relay.settings(), channels, escalationPolicies, routes, topology };
  const header = includeSecrets
    ? '# OpenRelay-Konfiguration (enthält Geheimnisse!)\n'
    : `# OpenRelay-Konfiguration – Geheimnisse sind als "${SECRET_MASK}" maskiert und bleiben beim Import erhalten.\n`;
  return header + stringifyYaml(doc, { lineWidth: 120 });
}
