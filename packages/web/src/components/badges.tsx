import type { ReactNode } from 'react';
import type { DeliveryStatus, EventAction, IncidentLinkKind, IncidentStatus, Severity } from '@openrelay/types';
import { DELIVERY_STATUS_LABEL, EVENT_ACTION_LABEL, LINK_KIND_LABEL, SEVERITY_LABEL, STATUS_LABEL, labelOf } from '../lib/labels';
import { Icon } from './Icon';

export type Tone = 'neutral' | 'critical' | 'high' | 'warning' | 'info' | 'debug' | 'ok' | 'accent';

export function Badge({
  tone = 'neutral',
  children,
  title,
  solid,
  dot,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
  solid?: boolean;
  dot?: boolean;
}) {
  return (
    <span className={`badge tone-${tone}${solid ? ' solid' : ''}${dot ? ' dotted' : ''}`} title={title}>
      {dot ? <span className="badge-dot" aria-hidden /> : null}
      {children}
    </span>
  );
}

export function SeverityBadge({ severity, compact }: { severity: Severity; compact?: boolean }) {
  return (
    <span className={`sev sev-${severity}${compact ? ' compact' : ''}`} title={`Schweregrad: ${SEVERITY_LABEL[severity]}`}>
      <span className="sev-mark" aria-hidden />
      {SEVERITY_LABEL[severity] ?? severity}
    </span>
  );
}

/** Small colored square used in dense lists. */
export function SeverityDot({ severity }: { severity: Severity }) {
  return <span className={`sev-dot sev-${severity}`} title={SEVERITY_LABEL[severity]} aria-label={SEVERITY_LABEL[severity]} />;
}

const STATUS_TONE: Record<IncidentStatus, Tone> = {
  open: 'critical',
  acknowledged: 'warning',
  resolved: 'ok',
};

export function StatusBadge({ status }: { status: IncidentStatus }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? 'neutral'} dot>
      {labelOf(STATUS_LABEL, status)}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: number }) {
  const p = Math.min(5, Math.max(1, Math.round(priority || 3)));
  return (
    <span className={`prio prio-${p}`} title={`Priorität ${p} (1 = höchste)`}>
      P{p}
    </span>
  );
}

const ACTION_TONE: Record<EventAction, Tone> = {
  created: 'accent',
  deduplicated: 'neutral',
  reopened: 'high',
  resolved: 'ok',
  ignored: 'debug',
  dropped: 'debug',
};

export function ActionBadge({ action }: { action: EventAction }) {
  return <Badge tone={ACTION_TONE[action] ?? 'neutral'}>{labelOf(EVENT_ACTION_LABEL, action)}</Badge>;
}

const DELIVERY_TONE: Record<DeliveryStatus, Tone> = {
  pending: 'info',
  sending: 'accent',
  sent: 'ok',
  failed: 'critical',
};

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  return (
    <Badge tone={DELIVERY_TONE[status] ?? 'neutral'} dot>
      {labelOf(DELIVERY_STATUS_LABEL, status)}
    </Badge>
  );
}

const LINK_TONE: Record<IncidentLinkKind, Tone> = {
  related: 'info',
  recurrence: 'warning',
  merged: 'accent',
};

export function LinkKindBadge({ kind }: { kind: IncidentLinkKind }) {
  return <Badge tone={LINK_TONE[kind] ?? 'neutral'}>{labelOf(LINK_KIND_LABEL, kind)}</Badge>;
}

export function StormBadge() {
  return (
    <Badge tone="high" title="Durch Alarm-Sturm-Erkennung gebündelt (viele Alarme gleichzeitig)">
      <Icon name="storm" size={12} />
      Sturm
    </Badge>
  );
}

export function RecurrenceBadge({ count }: { count: number }) {
  return (
    <Badge tone="warning" title={`Das gleiche Problem trat zuvor ${count}× auf`}>
      <Icon name="repeat" size={12} />
      wiederkehrend ×{count}
    </Badge>
  );
}

export function FlappingBadge() {
  return (
    <Badge tone="warning" title="Wechselt häufig zwischen aktiv und gelöst">
      <Icon name="wave" size={12} />
      flattert
    </Badge>
  );
}

export function Chip({ children, title, mono }: { children: ReactNode; title?: string; mono?: boolean }) {
  return (
    <span className={`chip${mono ? ' mono' : ''}`} title={title}>
      {children}
    </span>
  );
}
