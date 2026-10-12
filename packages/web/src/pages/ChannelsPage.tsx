import { useState } from 'react';
import type { Channel } from '@openrelay/types';
import { api, errorText } from '../lib/api';
import type { ListResponse, PluginsInfo } from '../lib/apiTypes';
import { channelCache } from '../lib/cache';
import { clockTime, shortTime } from '../lib/format';
import { useApi } from '../lib/hooks';
import { NO_WRITE_TITLE, useSession } from '../lib/session';
import { Toggle } from '../components/form';
import { ChannelEditor } from '../components/channels/ChannelEditor';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { AsyncBlock, Card, EmptyState, PageHeader, RelTime } from '../components/ui';

interface TestResponse {
  ok?: boolean;
  error?: string;
  message?: string;
}

function Health({ channel }: { channel: Channel }) {
  const now = Date.now();
  if (channel.circuitOpenUntil && channel.circuitOpenUntil > now) {
    const sameDay = new Date(channel.circuitOpenUntil).toDateString() === new Date(now).toDateString();
    return (
      <span className="health bad" title={channel.lastError ?? undefined}>
        <span className="health-dot" />
        Unterbrochen bis {sameDay ? clockTime(channel.circuitOpenUntil) : shortTime(channel.circuitOpenUntil)}
      </span>
    );
  }
  if (channel.consecutiveFailures > 0) {
    return (
      <span className="health warn" title={channel.lastError ?? undefined}>
        <span className="health-dot" />
        {channel.consecutiveFailures} {channel.consecutiveFailures === 1 ? 'Fehler' : 'Fehler in Folge'}
      </span>
    );
  }
  if (channel.lastSuccessAt) {
    return (
      <span className="health ok">
        <span className="health-dot" />
        OK
      </span>
    );
  }
  return (
    <span className="health">
      <span className="health-dot" />
      Noch nicht verwendet
    </span>
  );
}

export function ChannelsPage() {
  const { canWrite } = useSession();
  const toast = useToast();
  const list = useApi<ListResponse<Channel>>('/channels');
  const plugins = useApi<PluginsInfo>('/plugins');
  const [editing, setEditing] = useState<Channel | 'new' | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({});

  const types = plugins.data?.channels ?? [];
  const typeName = (type: string) => types.find((t) => t.type === type)?.displayName ?? type;

  const afterChange = () => {
    void list.reload();
    channelCache.invalidate();
  };

  const toggleEnabled = async (ch: Channel, enabled: boolean) => {
    list.setData((prev) => (prev ? { ...prev, items: prev.items.map((c) => (c.id === ch.id ? { ...c, enabled } : c)) } : prev));
    try {
      await api.put<{ channel: Channel }>(`/channels/${encodeURIComponent(ch.id)}`, {
        name: ch.name,
        type: ch.type,
        enabled,
        config: ch.config,
      });
      toast.success(`„${ch.name}“ ${enabled ? 'aktiviert' : 'deaktiviert'}.`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      afterChange();
    }
  };

  const test = async (ch: Channel) => {
    setTesting(ch.id);
    try {
      const res = await api.post<TestResponse | undefined>(`/channels/${encodeURIComponent(ch.id)}/test`);
      const failed = res?.ok === false || (typeof res?.error === 'string' && res.error.length > 0);
      const text = failed ? (res?.error ?? res?.message ?? 'Test fehlgeschlagen') : (res?.message ?? 'Testnachricht gesendet');
      setResults((r) => ({ ...r, [ch.id]: { ok: !failed, text } }));
      if (failed) toast.error(`${ch.name}: ${text}`);
      else toast.success(`${ch.name}: ${text}`);
    } catch (err) {
      const text = errorText(err);
      setResults((r) => ({ ...r, [ch.id]: { ok: false, text } }));
      toast.error(`${ch.name}: ${text}`);
    } finally {
      setTesting(null);
      void list.reload();
    }
  };

  const remove = async (ch: Channel) => {
    if (!window.confirm(`Kanal „${ch.name}“ wirklich löschen?\nRouting-Regeln und Eskalationsstufen verlieren diesen Kanal.`))
      return;
    try {
      await api.del(`/channels/${encodeURIComponent(ch.id)}`);
      toast.success('Kanal gelöscht.');
      afterChange();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Kanäle"
        subtitle="Ziele für Benachrichtigungen: Chat, E-Mail, Push, Webhooks – inklusive Zustand und Testversand."
        actions={
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canWrite || types.length === 0}
            title={!canWrite ? NO_WRITE_TITLE : types.length === 0 ? 'Kanaltypen werden geladen…' : undefined}
            onClick={() => setEditing('new')}
          >
            <Icon name="plus" size={15} /> Neuer Kanal
          </button>
        }
      />
      <Card flush>
        <AsyncBlock
          data={list.data}
          error={list.error}
          loading={list.loading}
          onRetry={() => void list.reload()}
          isEmpty={(d) => d.items.length === 0}
          empty={
            <EmptyState
              title="Noch keine Kanäle"
              icon="channels"
              action={
                canWrite && types.length ? (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
                    <Icon name="plus" size={14} /> Kanal anlegen
                  </button>
                ) : undefined
              }
            >
              Lege einen Kanal an (z. B. Telegram, Discord, E-Mail) und verknüpfe ihn in einer Routing-Regel.
            </EmptyState>
          }
        >
          {(data) => (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Typ</th>
                    <th>Aktiv</th>
                    <th>Zustand</th>
                    <th>Zuletzt erfolgreich</th>
                    <th>Letzter Fehler</th>
                    <th className="actions">
                      <span className="sr-only">Aktionen</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((ch) => {
                    const result = results[ch.id];
                    return (
                      <tr key={ch.id}>
                        <td>
                          <span className="cell-title">{ch.name}</span>
                        </td>
                        <td>
                          <span className="type-pill" title={ch.type}>
                            {typeName(ch.type)}
                          </span>
                        </td>
                        <td>
                          <Toggle
                            checked={ch.enabled}
                            disabled={!canWrite}
                            onChange={(v) => void toggleEnabled(ch, v)}
                            title={ch.enabled ? 'Kanal deaktivieren' : 'Kanal aktivieren'}
                          />
                        </td>
                        <td>
                          <Health channel={ch} />
                        </td>
                        <td>
                          <RelTime ts={ch.lastSuccessAt} />
                        </td>
                        <td>
                          {ch.lastError ? (
                            <span className="stack-sm" style={{ gap: 0 }}>
                              <span className="error-text" title={ch.lastError}>
                                {ch.lastError}
                              </span>
                              <span className="muted small">
                                <RelTime ts={ch.lastErrorAt} />
                              </span>
                            </span>
                          ) : (
                            <span className="muted">–</span>
                          )}
                        </td>
                        <td className="actions">
                          <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                            {result ? (
                              <span className={`test-result ${result.ok ? 'ok' : 'fail'}`} title={result.text}>
                                <Icon name={result.ok ? 'check' : 'alert'} size={13} /> {result.ok ? 'Gesendet' : 'Fehler'}
                              </span>
                            ) : null}
                            <button
                              type="button"
                              className="btn btn-sm"
                              disabled={!canWrite || testing !== null}
                              onClick={() => void test(ch)}
                              title={canWrite ? 'Testnachricht senden' : NO_WRITE_TITLE}
                            >
                              <Icon name="send" size={13} /> {testing === ch.id ? 'Sende…' : 'Test senden'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-icon"
                              disabled={!canWrite || types.length === 0}
                              onClick={() => setEditing(ch)}
                              aria-label={`„${ch.name}“ bearbeiten`}
                              title="Bearbeiten"
                            >
                              <Icon name="edit" size={14} />
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-icon btn-danger"
                              disabled={!canWrite}
                              onClick={() => void remove(ch)}
                              aria-label={`„${ch.name}“ löschen`}
                              title="Löschen"
                            >
                              <Icon name="trash" size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </AsyncBlock>
      </Card>
      {plugins.error ? <p className="muted small">Kanaltypen konnten nicht geladen werden: {plugins.error.message}</p> : null}

      {editing ? (
        <ChannelEditor
          channel={editing === 'new' ? null : editing}
          types={types}
          onClose={() => setEditing(null)}
          onSaved={(ch) => {
            setEditing(null);
            toast.success(`Kanal „${ch?.name ?? ''}“ gespeichert.`);
            afterChange();
          }}
        />
      ) : null}
    </div>
  );
}
