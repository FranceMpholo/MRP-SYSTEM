import React, { useEffect, useState } from 'react';
import OeeDashboard from './OeeDashboard';
import OeeInputView from './OeeInputView';
import OeeHistoryView from './OeeHistoryView';
import OeeSettingsView from './OeeSettingsView';

const views = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'input', label: 'Input' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' },
];

export default function OeeModuleShell({ planningWeeks, actuals, setActuals, settings, setSettings, productionLine, setProductionLine, editable, weekStart, currentUser, initialPlanningEntryId = null, oeeHistory, setOeeHistory }) {
  const [view, setView] = useState('dashboard');
  useEffect(() => { if (initialPlanningEntryId) setView('input'); }, [initialPlanningEntryId]);

  return (
    <div className="oee-module-shell" style={{ display: 'grid', gap: 18 }}>
      <div className="oee-shell-tabs" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {views.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setView(item.id)}
            style={{
              padding: '8px 12px',
              border: view === item.id ? '1px solid #0868b2' : '1px solid #c9c2ae',
              borderRadius: 4,
              background: view === item.id ? '#dceeff' : '#fff',
              color: '#232323',
              cursor: 'pointer',
              fontWeight: view === item.id ? 600 : 500,
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {view === 'dashboard' && (
        <OeeDashboard
          planningWeeks={planningWeeks}
          actuals={actuals}
          settings={settings}
          setSettings={setSettings}
          productionLine={productionLine}
          setProductionLine={setProductionLine}
          editable={editable}
          weekStart={weekStart}
        />
      )}

      {view === 'input' && (
        <OeeInputView
          planningWeeks={planningWeeks}
          actuals={actuals}
          setActuals={setActuals}
          settings={settings}
          productionLine={productionLine}
          setProductionLine={setProductionLine}
          editable={editable}
          currentUser={currentUser}
          initialPlanningEntryId={initialPlanningEntryId}
          oeeHistory={oeeHistory}
          setOeeHistory={setOeeHistory}
        />
      )}

      {view === 'history' && <OeeHistoryView history={oeeHistory ?? []} />}

      {view === 'settings' && (
        <OeeSettingsView
          settings={settings}
          setSettings={setSettings}
          productionLine={productionLine}
          editable={editable}
        />
      )}
    </div>
  );
}
