import { useState } from 'react';
import type { ApiKey, ApiScope } from '@openrelay/types';
import { api, errorText } from '../../lib/api';
import type { ApiKeyCreated, ListResponse } from '../../lib/apiTypes';
import { useAction, useApi } from '../../lib/hooks';
import { SCOPE_LABEL } from '../../lib/labels';
import { NO_WRITE_TITLE, useSession } from '../../lib/session';
import { Chip } from '../../components/badges';
import { CheckboxList, Field, TextField } from '../../components/form';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { AsyncBlock, Card, CopyButton, EmptyState, FormError, RelTime } from '../../components/ui';

const SCOPES: ApiScope[] = ['ingest', 'read', 'admin'];

function curlExample(token: string): string {
  const origin = window.location.origin;
  return `curl -X POST ${origin}/api/v1/events -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '{"title":"Test","severity":"warning"}'`;
}

function CreateKeyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>(['ingest']);
  const [defaultSource, setDefaultSource] = useState('');
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const action = useAction();

  const create = async () => {
    if (!name.trim()) {
      action.setError('Bitte einen Namen angeben.');
      return;
    }
    if (scopes.length === 0) {
      action.setError('Mindestens ein Scope ist nötig.');
      return;
    }
    const res = await action.run(() =>
      api.post<ApiKeyCreated>('/api-keys', { name: name.trim(), scopes, defaultSource: defaultSource.trim() || null }),
    );
    if (res.ok) {
      setCreated(res.value);
      onCreated();
    }
  };

  if (created) {
    const curl = curlExample(created.token);
    return (
      <Modal
        title="API-Key erstellt"
        onClose={onClose}
        footer={
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Fertig
          </button>
        }
      >
        <div className="token-box">
          <div className="row" style={{ gap: 6 }}>
            <Icon name="key" size={15} />
            <strong>{created.apiKey?.name ?? name}</strong>
          </div>
          <div className="token-value">{created.token}</div>
          <div className="row">
            <CopyButton text={created.token} label="Token kopieren" />
          </div>
          <div className="alert-box tone-warning compact">
            <Icon name="alert" size={16} />
            <div className="alert-body">
              Das Token wird nur jetzt angezeigt. Bewahre es sicher auf – später ist nur noch das Präfix sichtbar.
            </div>
          </div>
        </div>
        <div className="stack-sm">
          <span className="section-title">Beispiel: Ereignis senden</span>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{curl}</pre>
          <div>
            <CopyButton text={curl} label="Befehl kopieren" />
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Neuer API-Key"
      onClose={onClose}
      size="sm"
      onSubmit={() => void create()}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn-primary" disabled={action.busy}>
            {action.busy ? 'Erstelle…' : 'Erstellen'}
          </button>
        </>
      }
    >
      <TextField label="Name" required value={name} onChange={setName} placeholder="z. B. Backup-Server" autoFocus />
      <Field label="Scopes">
        <CheckboxList options={SCOPES.map((s) => ({ value: s, label: SCOPE_LABEL[s] }))} value={scopes} onChange={setScopes} />
      </Field>
      <TextField
        label="Standard-Quelle"
        value={defaultSource}
        onChange={setDefaultSource}
        placeholder="z. B. backup"
        hint="Wird für Ereignisse ohne eigene „source“ verwendet."
      />
      <FormError error={action.error} />
    </Modal>
  );
}

export function ApiKeysTab() {
  const { canWrite } = useSession();
  const toast = useToast();
  const list = useApi<ListResponse<ApiKey>>('/api-keys');
  const [creating, setCreating] = useState(false);

  const remove = async (key: ApiKey) => {
    if (
      !window.confirm(`API-Key „${key.name}“ wirklich löschen?\nAnwendungen mit diesem Token können danach nichts mehr senden.`)
    )
      return;
    try {
      await api.del(`/api-keys/${encodeURIComponent(key.id)}`);
      toast.success('API-Key gelöscht.');
      void list.reload();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <>
      <Card
        flush
        title="API-Keys"
        actions={
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!canWrite}
            title={canWrite ? undefined : NO_WRITE_TITLE}
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" size={14} /> Neuer API-Key
          </button>
        }
      >
        <AsyncBlock
          data={list.data}
          error={list.error}
          loading={list.loading}
          onRetry={() => void list.reload()}
          isEmpty={(d) => d.items.length === 0}
          empty={
            <EmptyState title="Noch keine API-Keys" icon="key">
              Erstelle für jede Anwendung einen eigenen Key mit Scope „ingest“ – so lässt er sich einzeln widerrufen.
            </EmptyState>
          }
        >
          {(data) => (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Präfix</th>
                    <th>Scopes</th>
                    <th>Standard-Quelle</th>
                    <th>Erstellt</th>
                    <th>Zuletzt benutzt</th>
                    <th className="actions">
                      <span className="sr-only">Aktionen</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((k) => (
                    <tr key={k.id}>
                      <td className="cell-title">{k.name}</td>
                      <td className="mono">{k.prefix}…</td>
                      <td>
                        <span className="chips">
                          {k.scopes.map((s) => (
                            <Chip key={s}>{s}</Chip>
                          ))}
                        </span>
                      </td>
                      <td>{k.defaultSource ?? <span className="muted">–</span>}</td>
                      <td>
                        <RelTime ts={k.createdAt} />
                      </td>
                      <td>{k.lastUsedAt ? <RelTime ts={k.lastUsedAt} /> : <span className="muted">nie</span>}</td>
                      <td className="actions">
                        <button
                          type="button"
                          className="btn btn-sm btn-icon btn-danger"
                          disabled={!canWrite}
                          onClick={() => void remove(k)}
                          aria-label={`API-Key „${k.name}“ löschen`}
                          title="Löschen"
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AsyncBlock>
      </Card>
      {creating ? <CreateKeyDialog onClose={() => setCreating(false)} onCreated={() => void list.reload()} /> : null}
    </>
  );
}
