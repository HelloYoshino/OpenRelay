import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import type { PagedResponse } from '../lib/apiTypes';
import type { Incident } from '@openrelay/types';
import { useDebouncedCallback, useInterval } from '../lib/hooks';
import { useDesktopNotifications } from '../lib/notifications';
import { href, useRoute } from '../lib/router';
import { useSession } from '../lib/session';
import { useStreamEvent, useStreamState } from '../lib/stream';
import { THEME_LABEL, useTheme } from '../lib/theme';
import { Icon, type IconName } from './Icon';
import { Logo } from './Logo';
import { OverviewPage } from '../pages/OverviewPage';
import { IncidentsPage } from '../pages/IncidentsPage';
import { IncidentDetailPage } from '../pages/IncidentDetailPage';
import { EventsPage } from '../pages/EventsPage';
import { RoutesPage } from '../pages/RoutesPage';
import { ChannelsPage } from '../pages/ChannelsPage';
import { EscalationPage } from '../pages/EscalationPage';
import { SilencesPage } from '../pages/SilencesPage';
import { TopologyPage } from '../pages/TopologyPage';
import { DeliveriesPage } from '../pages/DeliveriesPage';
import { SettingsPage } from '../pages/SettingsPage';
import { useToast } from './Toast';
import { EmptyState } from './ui';

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
}

const NAV: NavItem[] = [
  { path: '/', label: 'Übersicht', icon: 'overview' },
  { path: '/incidents', label: 'Vorfälle', icon: 'incident' },
  { path: '/events', label: 'Ereignisse', icon: 'events' },
  { path: '/routes', label: 'Routing', icon: 'routing' },
  { path: '/channels', label: 'Kanäle', icon: 'channels' },
  { path: '/escalation', label: 'Eskalation', icon: 'escalation' },
  { path: '/silences', label: 'Stummschaltungen', icon: 'silence' },
  { path: '/topology', label: 'Topologie', icon: 'topology' },
  { path: '/deliveries', label: 'Zustellungen', icon: 'deliveries' },
  { path: '/settings', label: 'Einstellungen', icon: 'settings' },
];

function useOpenIncidentCount(): number | null {
  const [count, setCount] = useState<number | null>(null);
  const load = () => {
    api
      .get<PagedResponse<Incident>>('/incidents', { status: 'open', limit: 1 })
      .then((res) => setCount(typeof res.total === 'number' ? res.total : (res.items?.length ?? 0)))
      .catch(() => {
        /* badge is best effort */
      });
  };
  const debounced = useDebouncedCallback(load, 1500);
  useEffect(load, []);
  useInterval(load, 60_000);
  useStreamEvent('incident', debounced);
  useStreamEvent('reconnected', debounced);
  return count;
}

function LiveIndicator() {
  const state = useStreamState();
  const label = state === 'open' ? 'Live' : state === 'connecting' ? 'Verbinde…' : 'Getrennt';
  const title =
    state === 'open'
      ? 'Live-Verbindung aktiv – Änderungen erscheinen sofort.'
      : state === 'connecting'
        ? 'Live-Verbindung wird aufgebaut…'
        : 'Live-Verbindung getrennt – neuer Versuch läuft automatisch.';
  return (
    <span className={`live ${state}`} title={title} role="status" aria-label={title}>
      <span className="live-dot" aria-hidden />
      <span className="live-label">{label}</span>
    </span>
  );
}

function isActive(item: NavItem, path: string): boolean {
  if (item.path === '/') return path === '/' || path === '/overview';
  return path === item.path || path.startsWith(`${item.path}/`);
}

function renderPage(segments: string[]): ReactNode {
  const [first, second] = segments;
  switch (first) {
    case undefined:
    case 'overview':
      return <OverviewPage />;
    case 'incidents':
      return second ? <IncidentDetailPage key={second} id={second} /> : <IncidentsPage />;
    case 'events':
      return <EventsPage />;
    case 'routes':
      return <RoutesPage />;
    case 'channels':
      return <ChannelsPage />;
    case 'escalation':
      return <EscalationPage />;
    case 'silences':
      return <SilencesPage />;
    case 'topology':
      return <TopologyPage />;
    case 'deliveries':
      return <DeliveriesPage />;
    case 'settings':
      return <SettingsPage tab={second} />;
    default:
      return (
        <EmptyState
          title="Seite nicht gefunden"
          icon="search"
          action={
            <a className="btn" href={href('/')}>
              Zur Übersicht
            </a>
          }
        >
          Die Adresse <code>{`#/${segments.join('/')}`}</code> existiert nicht.
        </EmptyState>
      );
  }
}

export function Layout() {
  const route = useRoute();
  const session = useSession();
  const theme = useTheme();
  const notifications = useDesktopNotifications();
  const openCount = useOpenIncidentCount();
  const toast = useToast();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
    window.scrollTo(0, 0);
  }, [route.path]);

  useEffect(() => {
    document.title = openCount ? `(${openCount}) OpenRelay` : 'OpenRelay';
  }, [openCount]);

  const themeIcon: IconName = theme.preference === 'dark' ? 'moon' : theme.preference === 'light' ? 'sun' : 'monitor';
  const notifyTitle =
    notifications.permission === 'unsupported'
      ? 'Desktop-Benachrichtigungen werden von diesem Browser nicht unterstützt'
      : notifications.permission === 'denied'
        ? 'Desktop-Benachrichtigungen sind im Browser blockiert'
        : notifications.enabled
          ? 'Desktop-Benachrichtigungen aktiv (neue Vorfälle ab „Hoch“) – klicken zum Deaktivieren'
          : 'Desktop-Benachrichtigungen für neue Vorfälle ab „Hoch“ aktivieren';

  return (
    <div className="app">
      <aside className={`sidebar${navOpen ? ' open' : ''}`} id="sidebar">
        <a className="brand" href={href('/')}>
          <Logo />
          OpenRelay
        </a>
        <nav className="nav" aria-label="Hauptnavigation">
          {NAV.map((item) => {
            const active = isActive(item, route.path);
            return (
              <a
                key={item.path}
                href={href(item.path)}
                className={`nav-link${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon name={item.icon} size={17} />
                <span>{item.label}</span>
                {item.path === '/incidents' && openCount !== null ? (
                  <span
                    className={`nav-count${openCount === 0 ? ' zero' : ''}`}
                    title={`${openCount} offene (unbestätigte) Vorfälle`}
                  >
                    {openCount > 999 ? '999+' : openCount}
                  </span>
                ) : null}
              </a>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <span className="truncate" title={`Angemeldet als ${session.me.name}`}>
            <Icon name="user" size={12} /> {session.me.name}
            {!session.canWrite ? ' · nur lesen' : ''}
          </span>
          {session.me.version ? <span>OpenRelay v{session.me.version}</span> : null}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="btn btn-icon btn-ghost topbar-menu"
            aria-label={navOpen ? 'Menü schließen' : 'Menü öffnen'}
            aria-expanded={navOpen}
            aria-controls="sidebar"
            onClick={() => setNavOpen((o) => !o)}
          >
            <Icon name={navOpen ? 'x' : 'menu'} size={18} />
          </button>
          <a className="brand" href={href('/')}>
            <Logo size={22} />
            OpenRelay
          </a>
          <div className="spacer" />
          <LiveIndicator />
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            onClick={async () => {
              const result = await notifications.toggle();
              if (result === 'enabled') toast.success('Desktop-Benachrichtigungen aktiviert (neue Vorfälle ab „Hoch“).');
              else if (result === 'disabled') toast.info('Desktop-Benachrichtigungen deaktiviert.');
              else if (result === 'denied')
                toast.error('Benachrichtigungen sind im Browser blockiert. Erlaube sie in den Website-Einstellungen.');
            }}
            disabled={notifications.permission === 'unsupported'}
            title={notifyTitle}
            aria-label={notifyTitle}
            aria-pressed={notifications.enabled}
          >
            <Icon name={notifications.enabled ? 'bell' : 'bellOff'} size={17} />
          </button>
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            onClick={theme.cycle}
            title={`Design: ${THEME_LABEL[theme.preference]} – klicken zum Wechseln`}
            aria-label={`Design wechseln (aktuell: ${THEME_LABEL[theme.preference]})`}
          >
            <Icon name={themeIcon} size={17} />
          </button>
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            onClick={() => {
              if (window.confirm('Wirklich abmelden?')) session.logout();
            }}
            title="Abmelden"
            aria-label="Abmelden"
          >
            <Icon name="logout" size={17} />
          </button>
        </header>
        <main className="content" id="content">
          {renderPage(route.segments)}
        </main>
      </div>
    </div>
  );
}
