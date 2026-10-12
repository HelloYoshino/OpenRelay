import { useCallback, useEffect, useState } from 'react';
import { readStorage, writeStorage } from './hooks';

export type ThemePreference = 'system' | 'light' | 'dark';
const KEY = 'openrelay.theme';

function readPreference(): ThemePreference {
  const v = readStorage(KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

function apply(pref: ThemePreference): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);

  useEffect(() => {
    apply(preference);
    writeStorage(KEY, preference === 'system' ? null : preference);
  }, [preference]);

  /** Cycles Automatisch → Hell → Dunkel. */
  const cycle = useCallback(() => {
    setPreference((p) => (p === 'system' ? 'light' : p === 'light' ? 'dark' : 'system'));
  }, []);

  return { preference, setPreference, cycle };
}

export const THEME_LABEL: Record<ThemePreference, string> = {
  system: 'Automatisch (System)',
  light: 'Hell',
  dark: 'Dunkel',
};
