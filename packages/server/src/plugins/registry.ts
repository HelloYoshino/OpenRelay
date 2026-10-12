import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Logger } from '../logger.js';
import type { ChannelPlugin, EventProcessor, IngestAdapter, OpenRelayPlugin, PluginApi, PluginFactory } from './types.js';

export interface PluginInfo {
  name: string;
  version: string | null;
  builtin: boolean;
  file: string | null;
  channels: string[];
  adapters: string[];
  processors: string[];
}

export class PluginRegistry {
  readonly channels = new Map<string, ChannelPlugin>();
  readonly adapters = new Map<string, IngestAdapter>();
  readonly processors: EventProcessor[] = [];
  readonly plugins: PluginInfo[] = [];

  constructor(private readonly logger: Logger) {}

  register(plugin: OpenRelayPlugin, opts: { builtin?: boolean; file?: string } = {}): void {
    if (!plugin || typeof plugin.name !== 'string') throw new Error('Plugin ohne Namen');
    for (const channel of plugin.channels ?? []) {
      if (!channel.type || typeof channel.send !== 'function') throw new Error(`Ungültiger Kanal in Plugin ${plugin.name}`);
      if (this.channels.has(channel.type) && !opts.builtin) {
        this.logger.warn(`Plugin ${plugin.name} überschreibt Kanaltyp "${channel.type}"`);
      }
      this.channels.set(channel.type, channel as ChannelPlugin);
    }
    for (const adapter of plugin.adapters ?? []) {
      if (!adapter.name || typeof adapter.parse !== 'function') throw new Error(`Ungültiger Adapter in Plugin ${plugin.name}`);
      this.adapters.set(adapter.name, adapter);
    }
    for (const processor of plugin.processors ?? []) {
      if (typeof processor.process !== 'function') throw new Error(`Ungültiger Prozessor in Plugin ${plugin.name}`);
      this.processors.push(processor);
    }
    this.plugins.push({
      name: plugin.name,
      version: plugin.version ?? null,
      builtin: !!opts.builtin,
      file: opts.file ?? null,
      channels: (plugin.channels ?? []).map((c) => c.type),
      adapters: (plugin.adapters ?? []).map((a) => a.name),
      processors: (plugin.processors ?? []).map((p) => p.name),
    });
  }

  channel(type: string): ChannelPlugin | undefined {
    return this.channels.get(type);
  }

  adapter(name: string): IngestAdapter | undefined {
    return this.adapters.get(name);
  }

  /** Loads every `*.js` / `*.mjs` file and every package directory in `dir`. Failures are logged, not fatal. */
  async loadDirectory(dir: string, api: PluginApi): Promise<void> {
    const root = resolve(dir);
    if (!existsSync(root)) return;
    for (const entry of readdirSync(root).sort()) {
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      const full = join(root, entry);
      let file: string | null = null;
      if (statSync(full).isDirectory()) {
        const pkgPath = join(full, 'package.json');
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { main?: string; exports?: unknown };
          const main = typeof pkg.exports === 'string' ? pkg.exports : pkg.main ?? 'index.js';
          file = join(full, main);
        } else if (existsSync(join(full, 'index.js'))) {
          file = join(full, 'index.js');
        } else if (existsSync(join(full, 'index.mjs'))) {
          file = join(full, 'index.mjs');
        }
      } else if (/\.(m?js)$/.test(entry)) {
        file = full;
      }
      if (!file) continue;
      try {
        const mod = (await import(pathToFileURL(file).href)) as { default?: OpenRelayPlugin | PluginFactory };
        const exported = mod.default;
        if (!exported) throw new Error('kein default-Export');
        const plugin = typeof exported === 'function' ? await exported(api) : exported;
        this.register(plugin, { file });
        this.logger.info(`Plugin geladen: ${plugin.name}${plugin.version ? `@${plugin.version}` : ''} (${entry})`);
      } catch (err) {
        this.logger.error({ err: (err as Error).message, file }, `Plugin konnte nicht geladen werden: ${entry}`);
      }
    }
  }
}
