import React from 'react';
import { SHIFTS } from '../planning/planningBoardUtils';
import { defaultLossCategories, defaultSpecialRules, buildOeeSettingsFoundation } from './oeeSettings';

export default function OeeSettingsView({ settings, setSettings, productionLine, editable }) {
  const safeSettings = buildOeeSettingsFoundation(settings ?? {});

  const updateGeneral = (field, value) => {
    setSettings((current) => buildOeeSettingsFoundation({ ...(current ?? {}), general: { ...(current?.general ?? {}), [field]: value } }));
  };

  const updateShift = (shift, field, value) => {
    setSettings((current) => {
      const next = buildOeeSettingsFoundation(current ?? {});
      next[productionLine] = {
        ...(next[productionLine] ?? {}),
        [shift]: {
          ...(next[productionLine]?.[shift] ?? {}),
          [field]: value,
        },
      };
      return next;
    });
  };

  const updateLossCategory = (categoryId, field, value) => {
    setSettings((current) => {
      const next = buildOeeSettingsFoundation(current ?? {});
      next.lossCategories = (next.lossCategories ?? defaultLossCategories()).map((category) =>
        category.id === categoryId ? { ...category, [field]: value } : category
      );
      return next;
    });
  };

  const updateSpecialRule = (field, checked) => {
    setSettings((current) => {
      const next = buildOeeSettingsFoundation(current ?? {});
      next.specialRules = { ...defaultSpecialRules(), ...(next.specialRules ?? {}), [field]: checked };
      return next;
    });
  };

  return (
    <div className="oee-dashboard" style={{ gap: 16 }}>
      <section className="oee-panel">
        <h3>OEE Settings</h3>
        <div className="oee-settings" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <fieldset disabled={!editable}>
            <legend>General</legend>
            <label>
              Ideal OEE
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={Number(safeSettings.general?.idealOee ?? 0.75)}
                onChange={(event) => updateGeneral('idealOee', Number(event.target.value || 0))}
              />
            </label>
          </fieldset>

          <fieldset disabled={!editable}>
            <legend>Special Rules</legend>
            {Object.entries(defaultSpecialRules()).map(([rule, enabled]) => (
              <label key={rule} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={Boolean(safeSettings.specialRules?.[rule] ?? enabled)}
                  onChange={(event) => updateSpecialRule(rule, event.target.checked)}
                />
                {rule}
              </label>
            ))}
          </fieldset>
        </div>
      </section>

      <section className="oee-panel">
        <h3>Shift Rules</h3>
        <div className="oee-settings">
          {SHIFTS.map((shift) => {
            const config = safeSettings[productionLine]?.[shift] ?? {};
            return (
              <fieldset key={shift} disabled={!editable}>
                <legend>{shift}</legend>
                <label>
                  Start
                  <input type="time" value={config.start ?? ''} onChange={(event) => updateShift(shift, 'start', event.target.value)} />
                </label>
                <label>
                  End
                  <input type="time" value={config.end ?? ''} onChange={(event) => updateShift(shift, 'end', event.target.value)} />
                </label>
                <label>
                  Planned Breaks (minutes)
                  <input type="number" min="0" step="0.1" value={config.breaks ?? ''} onChange={(event) => updateShift(shift, 'breaks', event.target.value === '' ? null : Number(event.target.value))} />
                </label>
                <label>
                  plannedTimeMinutes
                  <input type="number" min="0" step="0.1" value={config.plannedTimeMinutes ?? ''} onChange={(event) => updateShift(shift, 'plannedTimeMinutes', event.target.value === '' ? null : Number(event.target.value))} />
                </label>
              </fieldset>
            );
          })}
        </div>
      </section>

      <section className="oee-panel">
        <h3>Cycle Times / NICT</h3>
        <p className="oee-caption">Master data placeholder. Workbook-driven NICT values can be added here later.</p>
        <table className="mrp-table">
          <thead>
            <tr>
              <th>Stock Code</th>
              <th>Variant</th>
              <th>Suffix</th>
              <th>Process</th>
              <th>NICT Forming</th>
              <th>NICT Robot</th>
              <th>JPD</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {(safeSettings.cycleTimes ?? []).length === 0 && (
              <tr>
                <td colSpan="8">No cycle-time / NICT rows configured yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="oee-panel">
        <h3>Loss Categories</h3>
        <div className="oee-settings">
          {(safeSettings.lossCategories ?? defaultLossCategories()).map((category) => (
            <fieldset key={category.id} disabled={!editable}>
              <legend>{category.name}</legend>
              <label>
                Name
                <input type="text" value={category.name} onChange={(event) => updateLossCategory(category.id, 'name', event.target.value)} />
              </label>
              <label>
                Type
                <select value={category.lossType} onChange={(event) => updateLossCategory(category.id, 'lossType', event.target.value)}>
                  <option value="PLANNED_LOSS">PLANNED_LOSS</option>
                  <option value="DOWNTIME">DOWNTIME</option>
                </select>
              </label>
              <label>
                Description
                <input type="text" value={category.description} onChange={(event) => updateLossCategory(category.id, 'description', event.target.value)} />
              </label>
              <label>
                Active
                <input type="checkbox" checked={Boolean(category.active)} onChange={(event) => updateLossCategory(category.id, 'active', event.target.checked)} />
              </label>
            </fieldset>
          ))}
        </div>
      </section>
    </div>
  );
}
