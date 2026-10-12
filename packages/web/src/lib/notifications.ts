import { useCallback, useEffect, useRef, useState } from 'react';
import type { Incident } from '@openrelay/types';
import { SEVERITY_LABEL } from './labels';
import { readStorage, writeStorage } from './hooks';
import { navigate } from './router';
import { useStreamEvent } from './stream';

const KEY = 'openrelay.notifications';

export type NotifyPermission = NotificationPermission | 'unsupported';

function currentPermission(): NotifyPermission {
  return typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported';
}

/**
 * Browser desktop notifications for newly opened high/critical incidents
 * arriving through the SSE stream.
 */
export function useDesktopNotifications() {
  const [enabled, setEnabled] = useState(() => readStorage(KEY) === '1');
  const [permission, setPermission] = useState<NotifyPermission>(currentPermission);
  const seen = useRef(new Set<string>());
  const startedAt = useRef(Date.now());

  useEffect(() => {
    writeStorage(KEY, enabled ? '1' : null);
  }, [enabled]);

  /** Toggles the setting; resolves to the resulting state for user feedback. */
  const toggle = useCallback(async (): Promise<'enabled' | 'disabled' | 'denied' | 'unsupported'> => {
    if (currentPermission() === 'unsupported') return 'unsupported';
    if (enabled && Notification.permission === 'granted') {
      setEnabled(false);
      return 'disabled';
    }
    let perm = Notification.permission;
    if (perm === 'default') {
      try {
        perm = await Notification.requestPermission();
      } catch {
        perm = Notification.permission;
      }
    }
    setPermission(perm);
    setEnabled(perm === 'granted');
    return perm === 'granted' ? 'enabled' : 'denied';
  }, [enabled]);

  useStreamEvent('incident', (incident: Incident) => {
    const firstSeen = !seen.current.has(incident.id);
    seen.current.add(incident.id);
    if (!firstSeen || incident.status !== 'open') return;
    // Only incidents opened while the dashboard is running (not old ones receiving updates).
    if (incident.createdAt < startedAt.current - 60_000) return;
    if (incident.severity !== 'critical' && incident.severity !== 'high') return;
    if (!enabled || currentPermission() !== 'granted') return;
    try {
      const parts = [`P${incident.priority} · ${SEVERITY_LABEL[incident.severity]}`];
      if (incident.services.length) parts.push(incident.services.join(', '));
      parts.push(`${incident.alertCount} ${incident.alertCount === 1 ? 'Alarm' : 'Alarme'}`);
      const n = new Notification(`#${incident.number} ${incident.title}`, {
        body: parts.join(' · '),
        tag: `openrelay-${incident.id}`,
        icon: '/favicon.svg',
        requireInteraction: incident.severity === 'critical',
      });
      n.onclick = () => {
        window.focus();
        navigate(`/incidents/${encodeURIComponent(incident.id)}`);
        n.close();
      };
    } catch (err) {
      console.warn('[notifications] failed', err);
    }
  });

  return { enabled: enabled && permission === 'granted', permission, toggle };
}
