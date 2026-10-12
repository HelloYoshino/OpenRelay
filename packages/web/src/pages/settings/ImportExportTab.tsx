import { useRef, useState, type DragEvent } from 'react';
import { request } from '../../lib/api';
import { useAction } from '../../lib/hooks';
import { NO_WRITE_TITLE, useSession } from '../../lib/session';
import { channelCache, policyCache } from '../../lib/cache';
import { Checkbox } from '../../components/form';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { Card, FormError, Hint } from '../../components/ui';

function download(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/yaml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const IMPORT_LABELS: Record<string, string> = {
  channels: 'Kanäle',
  escalationPolicies: 'Eskalationsrichtlinien',
  routes: 'Routing-Regeln',
  silences: 'Stummschaltungen',
  dependencies: 'Abhängigkeiten',
  settings: 'Engine-Einstellungen',
};

/** Human readable import summary; falls back to the raw response. */
function summarize(result: unknown): string | null {
  if (result === undefined || result === null || result === '') return null;
  if (typeof result === 'string') return result;
  const imported = (result as { imported?: unknown }).imported;
  if (imported && typeof imported === 'object') {
    const lines = Object.entries(imported as Record<string, unknown>).map(([key, value]) => {
      const label = IMPORT_LABELS[key] ?? key;
      if (typeof value === 'boolean') return `${label}: ${value ? 'übernommen' : 'unverändert'}`;
      return `${label}: ${String(value)}`;
    });
    if (lines.length) return lines.join('\n');
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

export function ImportExportTab() {
  const { canWrite } = useSession();
  const toast = useToast();
  const exportAction = useAction();
  const importAction = useAction();
  const [text, setText] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [withSecrets, setWithSecrets] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    const res = await exportAction.run(() =>
      request<string>('/config/export', {
        asText: true,
        accept: 'application/yaml, text/yaml, */*',
        query: { secrets: withSecrets ? 'true' : undefined },
      }),
    );
    if (res.ok) {
      download(res.value, 'openrelay.yaml');
      toast.success('Konfiguration exportiert.');
    }
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      importAction.setError('Datei ist zu groß (max. 5 MB).');
      return;
    }
    setText(await file.text());
    setResult(null);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    void readFile(e.dataTransfer.files?.[0]);
  };

  const doImport = async () => {
    if (!text.trim()) {
      importAction.setError('Bitte YAML einfügen oder eine Datei wählen.');
      return;
    }
    if (
      !window.confirm('Konfiguration importieren?\nVorhandene Einträge mit gleichen IDs bzw. Namen können überschrieben werden.')
    )
      return;
    const res = await importAction.run(() =>
      request<unknown>('/config/import', { method: 'POST', rawBody: text, contentType: 'text/yaml' }),
    );
    if (res.ok) {
      setResult(summarize(res.value));
      toast.success('Konfiguration importiert.');
      channelCache.invalidate();
      policyCache.invalidate();
    }
  };

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <Card
        title={
          <>
            <Icon name="download" size={14} /> Export
          </>
        }
      >
        <div className="stack">
          <p className="muted">
            Lädt die Konfiguration (Kanäle, Routing, Eskalation, Topologie, Engine-Einstellungen) als <code>openrelay.yaml</code>{' '}
            herunter – ideal für Backups oder Versionsverwaltung. Beim Import lassen sich Platzhalter wie{' '}
            <code>{'${TELEGRAM_TOKEN}'}</code> aus der Umgebung auflösen.
          </p>
          <Checkbox
            checked={withSecrets}
            onChange={setWithSecrets}
            label="Geheime Werte einschließen"
            hint="Ohne diese Option werden Tokens und Passwörter maskiert exportiert."
          />
          {withSecrets ? (
            <Hint icon="key">Die Datei enthält dann Zugangsdaten im Klartext. Behandle sie vertraulich.</Hint>
          ) : null}
          <FormError error={exportAction.error} />
          <div>
            <button type="button" className="btn btn-primary" onClick={() => void doExport()} disabled={exportAction.busy}>
              <Icon name="download" size={14} /> {exportAction.busy ? 'Exportiere…' : 'openrelay.yaml herunterladen'}
            </button>
          </div>
        </div>
      </Card>
      <Card
        title={
          <>
            <Icon name="upload" size={14} /> Import
          </>
        }
      >
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void doImport();
          }}
        >
          <div
            className={`dropzone${over ? ' over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            <Icon name="upload" size={16} />
            <span>YAML- oder JSON-Datei hierher ziehen oder</span>
            <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={!canWrite}>
              Datei wählen
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".yaml,.yml,.json,text/yaml,application/json"
              hidden
              onChange={(e) => {
                void readFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          <textarea
            className="input code"
            placeholder={'channels:\n  - name: Telegram\n    type: telegram\n    …'}
            aria-label="Konfiguration (YAML)"
            value={text}
            spellCheck={false}
            disabled={!canWrite}
            onChange={(e) => {
              setText(e.target.value);
              setResult(null);
            }}
          />
          <FormError error={importAction.error} />
          {result ? (
            <div className="stack-sm">
              <span className="section-title">Antwort des Servers</span>
              <pre>{result}</pre>
            </div>
          ) : null}
          <div className="row">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!canWrite || importAction.busy || !text.trim()}
              title={canWrite ? undefined : NO_WRITE_TITLE}
            >
              <Icon name="upload" size={14} /> {importAction.busy ? 'Importiere…' : 'Importieren'}
            </button>
            {text ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setText('');
                  setResult(null);
                }}
              >
                Leeren
              </button>
            ) : null}
          </div>
        </form>
      </Card>
    </div>
  );
}
