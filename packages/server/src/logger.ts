export interface Logger {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

export function consoleLogger(prefix = 'openrelay'): Logger {
  const log =
    (level: string) =>
    (obj: unknown, msg?: string): void => {
      const text = typeof obj === 'string' ? obj : msg ?? '';
      const extra = typeof obj === 'string' ? '' : ` ${JSON.stringify(obj)}`;
      console.log(`[${prefix}] ${level} ${text}${extra}`);
    };
  return { debug: () => {}, info: log('INFO'), warn: log('WARN'), error: log('ERROR') };
}
