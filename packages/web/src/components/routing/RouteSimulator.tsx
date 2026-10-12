import { useState } from 'react';
import type { EventInput, Severity } from '@openrelay/types';
import { api } from '../../lib/api';
import type { SimulationResult } from '../../lib/apiTypes';
import { absTime, parseLabels } from '../../lib/format';
import { useAction } from '../../lib/hooks';
import { deliveryModeLabel } from '../../lib/labels';
import { useChannelMap } from '../../lib/cache';
import { Badge, Chip } from '../badges';
import { Field, SeveritySelect, TextField } from '../form';
import { Icon } from '../Icon';
import { Card, FormError, KeyValue } from '../ui';

export function RouteSimulator({ onResult }: { onResult: (result: SimulationResult | null) => void }) {
  const [title, setTitle] = useState('Datenbank nicht erreichbar');
  const [source, setSource] = useState('');
  const [severity, setSeverity] = useState<Severity>('critical');
  const [service, setService] = useState('');
  const [host, setHost] = useState('');
  const [labels, setLabels] = useState('env=prod');
  const [result, setResult] = useState<SimulationResult | null>(null);
  const action = useAction();

  const run = async () => {
    if (!title.trim()) {
      action.setError('Ein Titel ist Pflicht.');
      return;
    }
    const event: EventInput = { title: title.trim(), severity };
    if (source.trim()) event.source = source.trim();
    if (service.trim()) event.service = service.trim();
    if (host.trim()) event.host = host.trim();
    const parsed = parseLabels(labels);
    if (Object.keys(parsed).length) event.labels = parsed;
    const res = await action.run(() => api.post<SimulationResult>('/routes/simulate', { event }));
    if (res.ok) {
      setResult(res.value);
      onResult(res.value);
    }
  };

  return (
    <Card
      title={
        <>
          <Icon name="play" size={14} /> Routing-Simulator
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <p className="muted small">Teste, welche Regeln ein Ereignis treffen würde – ohne etwas zu versenden.</p>
        <TextField label="Titel" required value={title} onChange={setTitle} />
        <div className="grid-2">
          <TextField label="Quelle" value={source} onChange={setSource} placeholder="z. B. github" />
          <Field label="Schweregrad">
            <SeveritySelect
              value={severity}
              onChange={(v) => setSeverity((v || 'warning') as Severity)}
              ariaLabel="Schweregrad"
            />
          </Field>
          <TextField label="Service" value={service} onChange={setService} placeholder="z. B. api" />
          <TextField label="Host" value={host} onChange={setHost} placeholder="z. B. srv-01" />
        </div>
        <Field label="Labels" hint="Eine Zeile pro Label: schlüssel=wert" htmlFor="sim-labels">
          <textarea
            id="sim-labels"
            className="input mono"
            rows={3}
            value={labels}
            onChange={(e) => setLabels(e.target.value)}
            spellCheck={false}
          />
        </Field>
        <FormError error={action.error} />
        <button type="submit" className="btn btn-primary" disabled={action.busy}>
          <Icon name="play" size={14} /> {action.busy ? 'Simuliere…' : 'Simulieren'}
        </button>
      </form>
      {result ? <SimulationView result={result} /> : null}
    </Card>
  );
}

function SimulationView({ result }: { result: SimulationResult }) {
  const channels = useChannelMap();
  const matched = result.routes.filter((r) => r.matched);
  const silence = result.silencedBy;
  if (result.dropped) {
    return (
      <div className="sim-result" style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <div className="alert-box tone-warning">
          <Icon name="filter" size={16} />
          <div className="alert-body">
            <strong>Ereignis würde verworfen</strong>
            <span>Eine Ereignisregel (Einstellungen → Regeln) verwirft dieses Ereignis, bevor das Routing greift.</span>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="sim-result" style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
      <div className="row-between">
        <span className="section-title">Ergebnis</span>
        <span className="small muted">
          {matched.length === 0 ? 'Keine Regel trifft zu' : `${matched.length} von ${result.routes.length} Regeln treffen zu`}
        </span>
      </div>
      {silence ? (
        <div className="alert-box tone-warning">
          <Icon name="silence" size={16} />
          <div className="alert-body">
            <strong>Würde durch eine Stummschaltung unterdrückt</strong>
            {typeof silence === 'string' ? (
              <span className="mono small">{silence}</span>
            ) : (
              <>
                {silence.comment ? <span>{silence.comment}</span> : null}
                {silence.matchers?.length ? (
                  <span className="matchers">
                    {silence.matchers.map((m) => (
                      <code key={m} className="matcher">
                        {m}
                      </code>
                    ))}
                  </span>
                ) : null}
                {silence.endsAt ? <span className="small muted">bis {absTime(silence.endsAt)}</span> : null}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="small muted">
          <Icon name="checkCircle" size={12} /> Keine aktive Stummschaltung betroffen.
        </div>
      )}
      {matched.length === 0 && result.routes.length > 0 ? (
        <div className="alert-box tone-info compact">
          <Icon name="info" size={16} />
          <div className="alert-body">Ohne passende Regel wird kein Kanal benachrichtigt („Keine Route“ in der Zeitachse).</div>
        </div>
      ) : null}
      {result.routes.map((r) => {
        const conditionsMatch = r.conditions.every((c) => c.matched);
        const reason = r.matched
          ? null
          : r.enabled === false
            ? 'deaktiviert'
            : conditionsMatch
              ? 'übersprungen (vorherige Regel stoppt)'
              : 'trifft nicht zu';
        return (
          <div key={r.routeId} className={`sim-route ${r.matched ? 'matched' : 'unmatched'}`}>
            <div className="sim-route-head">
              <span className="row" style={{ gap: 6 }}>
                <Icon name={r.matched ? 'checkCircle' : 'x'} size={14} />
                {r.name}
              </span>
              {r.matched ? (
                <span className="row" style={{ gap: 4 }}>
                  <Badge tone="ok">{deliveryModeLabel(r.mode)}</Badge>
                  {r.quietHours ? (
                    <Badge tone="info" title="Ruhezeit aktiv – Zustellung wird bis zum Ende der Ruhezeit zurückgehalten">
                      <Icon name="moon" size={12} /> Ruhezeit
                    </Badge>
                  ) : null}
                </span>
              ) : (
                <Badge>{reason}</Badge>
              )}
            </div>
            {r.matched && r.channels?.length ? (
              <span className="chips">
                {r.channels.map((id) => (
                  <Chip key={id}>{channels.get(id)?.name ?? id}</Chip>
                ))}
              </span>
            ) : null}
            {r.conditions.length === 0 ? (
              <span className="small muted">Keine Bedingungen – trifft immer zu.</span>
            ) : (
              <ul className="conditions">
                {r.conditions.map((c, i) => (
                  <li key={i}>
                    <Icon name={c.matched ? 'check' : 'x'} size={13} className={`icon ${c.matched ? 'ok' : 'fail'}`} />
                    <code className={`matcher ${c.matched ? 'ok' : 'fail'}`}>{c.expr}</code>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {Object.keys(result.context ?? {}).length ? (
        <details>
          <summary className="small muted" style={{ cursor: 'pointer' }}>
            Ausgewerteter Kontext
          </summary>
          <div style={{ marginTop: 8 }}>
            <KeyValue
              items={Object.entries(result.context).map(([k, v]) => [
                <code key={k}>{k}</code>,
                <span className="mono small">{typeof v === 'string' ? v : JSON.stringify(v)}</span>,
              ])}
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}
