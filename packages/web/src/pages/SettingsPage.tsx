import { navigate } from '../lib/router';
import { PageHeader, Tabs, type TabItem } from '../components/ui';
import { EngineSettingsTab } from './settings/EngineSettingsTab';
import { RulesTab } from './settings/RulesTab';
import { ApiKeysTab } from './settings/ApiKeysTab';
import { ImportExportTab } from './settings/ImportExportTab';

type TabKey = 'engine' | 'rules' | 'api-keys' | 'import-export';

const TABS: TabItem<TabKey>[] = [
  { key: 'engine', label: 'Engine' },
  { key: 'rules', label: 'Regeln' },
  { key: 'api-keys', label: 'API-Keys' },
  { key: 'import-export', label: 'Import/Export' },
];

export function SettingsPage({ tab }: { tab?: string }) {
  const active: TabKey = TABS.some((t) => t.key === tab) ? (tab as TabKey) : 'engine';
  return (
    <div className="page">
      <PageHeader title="Einstellungen" subtitle="Verhalten der Engine, Ereignisregeln, Zugänge und Konfigurationsdateien." />
      <Tabs
        label="Einstellungen"
        items={TABS}
        value={active}
        onChange={(key) => navigate(`/settings/${key}`, { replace: true })}
      />
      {active === 'engine' ? <EngineSettingsTab /> : null}
      {active === 'rules' ? <RulesTab /> : null}
      {active === 'api-keys' ? <ApiKeysTab /> : null}
      {active === 'import-export' ? <ImportExportTab /> : null}
    </div>
  );
}
