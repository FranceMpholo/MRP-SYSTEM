import React, { useEffect, useMemo, useState } from 'react';
import { SHIFTS } from '../planning/planningBoardUtils';
import { entryProductionLine } from '../production/productionLines';
import { getEffectivePlanQty, getOriginalPlanQty } from '../planning/planQuantities';
import { shiftMinutes, deriveOeeRun } from './deriveOee';
import { buildOeeSettingsFoundation, createLossEvent } from './oeeSettings';
import { finalizeOeeHistory } from './oeeHistory';

const defaultFilters = { date: '', machine: '', shift: '', product: '', status: '' };
const statusLabels = { PENDING: 'OEE Pending', INCOMPLETE: 'OEE Incomplete', COMPLETE: 'OEE Complete' };
const issueLabels = {
  MISSING_NICT: 'NICT configuration is missing.',
  MISSING_PLANNED_TIME: 'Planned time is missing.',
  MISSING_ACTUAL: 'Actual production is missing.',
  MISSING_QUALITY_INPUT: 'Enter Scrap Parts or provide legacy Good Parts.',
  SCRAP_EXCEEDS_TOTAL: 'Scrap Parts cannot exceed Total Produced.',
  INVALID_SCRAP: 'Scrap Parts must be a valid non-negative number.',
  INVALID_TIME_ALLOCATION: 'Planned breaks and downtime exceed Planned Time.',
  UNVERIFIED_SPECIAL_RULE: 'The selected special OEE rule is not yet verified.',
  GOOD_PARTS_EXCEED_TOTAL: 'Good Parts cannot exceed Total Produced.',
};
const numberOrBlank = (value) => value === null || value === undefined ? '' : value;
const formatValue = (value, suffix = '') => value === null || value === undefined ? '—' : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`;

function buildEngineInput(run, settings, draft = null) {
  const actual = run.actual ?? {};
  const legacy = actual.oee ?? {};
  const saved = actual.oeeInput ?? {};
  const input = draft ?? saved;
  const events = Array.isArray(input.lossEvents) ? input.lossEvents : [];
  const multiple = run.slotRuns?.length > 1;
  const configuredTime = shiftMinutes(settings?.[run.productionLine]?.[run.shift]);
  const plannedTimeMinutes = input.plannedTimeMinutes ?? input.plannedTime ?? (multiple ? null : configuredTime);
  return {
    ...run,
    planningEntryId: run.id,
    settings,
    stockCode: run.partNumber,
    plan: getOriginalPlanQty(run),
    effectivePlan: getEffectivePlanQty(run),
    plannedTimeMinutes,
    plannedBreakMinutes: input.plannedBreakMinutes ?? (events.length ? null : legacy.plannedBreaks),
    totalDowntimeMinutes: input.totalDowntimeMinutes ?? null,
    runTimeMinutes: input.runTimeMinutes ?? (events.length ? null : legacy.runTime),
    totalProduced: actual.actualMouldQty,
    goodParts: input.goodParts ?? legacy.goodParts,
    scrapParts: input.scrapParts,
    noTubsNoStillagesMinutes: input.noTubsNoStillagesMinutes ?? (events.length ? null : legacy.noTubs),
    lossEvents: events,
  };
}

function statusForRun(run, settings) {
  const saved = run.actual?.oeeInput ?? {};
  const legacy = run.actual?.oee ?? {};
  const hasCapture = Object.keys(saved).length > 0 || Object.values(legacy).some((value) => value !== null && value !== undefined && value !== '');
  const status = deriveOeeRun(buildEngineInput(run, settings)).status;
  return status === 'COMPLETE' ? 'COMPLETE' : hasCapture ? 'INCOMPLETE' : 'PENDING';
}

function Field({ label, children, hint }) {
  return <label style={{ display: 'grid', gap: 5, minWidth: 150 }}><span>{label}</span>{children}{hint && <small className="oee-caption">{hint}</small>}</label>;
}

function ReadonlyValue({ label, value }) {
  return <div style={{ display: 'grid', gap: 3 }}><span className="oee-caption">{label}</span><strong>{value ?? '—'}</strong></div>;
}

function LossEditor({ categories, event, onSave, onCancel }) {
  const [draft, setDraft] = useState({ ...event, durationMinutes: event?.durationMinutes ?? '' });
  const available = categories.filter((category) => category.active || category.id === event?.categoryId);
  const category = available.find((item) => item.id === draft.categoryId) ?? available[0];
  return <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) 160px minmax(180px, 2fr) auto', gap: 8, alignItems: 'end', padding: 10, border: '1px solid #e3dfd2', background: '#faf9f4' }}>
    <Field label="Category"><select value={draft.categoryId ?? category?.id ?? ''} onChange={(eventValue) => setDraft((current) => ({ ...current, categoryId: eventValue.target.value }))} disabled={!categories.length}><option value="">Select category</option>{available.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
    <Field label="Duration Minutes"><input type="number" min="0" step="any" value={draft.durationMinutes} onChange={(eventValue) => setDraft((current) => ({ ...current, durationMinutes: eventValue.target.value }))} /></Field>
    <Field label="Comment"><input value={draft.comment ?? ''} onChange={(eventValue) => setDraft((current) => ({ ...current, comment: eventValue.target.value }))} /></Field>
    <div style={{ display: 'flex', gap: 6 }}><button type="button" className="mrp-btn mrp-btn-primary" onClick={() => category && onSave({ ...draft, categoryId: category.id, categoryName: category.name, semanticKey: category.semanticKey ?? null, lossType: category.lossType, durationMinutes: Number(draft.durationMinutes) })}>Save</button><button type="button" className="mrp-btn mrp-btn-ghost" onClick={onCancel}>Cancel</button></div>
    {category && <small className="oee-caption" style={{ gridColumn: '1 / -1' }}>Type: {category.lossType === 'PLANNED_LOSS' ? 'Planned Loss' : 'Downtime'}</small>}
  </div>;
}

function Results({ result }) {
  const groups = [
    ['Plan', result.plan], ['Effective Plan', result.effectivePlan], ['Revised Plan', result.revisedPlanQty], ['Target', result.targetQty], ['Total Produced', result.totalProduced], ['Good Parts', result.goodParts], ['Scrap Parts', result.scrapParts],
    ['Planned Time', result.plannedTimeMinutes], ['Planned Breaks', result.plannedBreakMinutes], ['Total Downtime', result.totalDowntimeMinutes], ['Run Time', result.runTimeMinutes], ['Availability', result.availability], ['Performance', result.performance], ['Productivity', result.productivity], ['Quality', result.quality], ['External OEE', result.externalOee], ['Internal OEE', result.internalOee], ['Ideal OEE', result.idealOee],
  ];
  return <section className="oee-panel"><h3>Live Excel-style results</h3><div className="oee-kpi-grid">{groups.map(([label, value]) => <ReadonlyValue key={label} label={label} value={['Availability', 'Performance', 'Productivity', 'Quality', 'External OEE', 'Internal OEE', 'Ideal OEE'].includes(label) ? formatValue(value === null ? null : value * 100, '%') : formatValue(value)} />)}</div></section>;
}

export default function OeeInputView({ planningWeeks, actuals, setActuals, settings, productionLine, setProductionLine, editable, initialPlanningEntryId = null, currentUser, oeeHistory = [], setOeeHistory }) {
  const safeSettings = useMemo(() => buildOeeSettingsFoundation(settings ?? {}), [settings]);
  const [filters, setFilters] = useState(defaultFilters);
  const [selectedId, setSelectedId] = useState(initialPlanningEntryId);
  const [draft, setDraft] = useState(null);
  const [editingLossId, setEditingLossId] = useState(null);

  const entries = useMemo(() => Object.values(planningWeeks || {}).flatMap((week) => week.entries ?? []).filter((entry) => entryProductionLine(entry) === productionLine && entry.status !== 'OFF'), [planningWeeks, productionLine]);
  const runs = useMemo(() => {
    const slotGroups = new Map();
    entries.forEach((entry) => { const key = [entry.day, entry.machine, entry.shift].join('|'); slotGroups.set(key, [...(slotGroups.get(key) ?? []), entry]); });
    return entries.map((entry) => {
      const actual = (actuals || []).find((item) => item.planningEntryId === entry.id) ?? null;
      const slotRuns = slotGroups.get([entry.day, entry.machine, entry.shift].join('|')) ?? [];
      const run = { ...entry, id: entry.id, actual, slotRuns, productionLine };
      const status = statusForRun(run, safeSettings);
      return { ...run, status, statusLabel: statusLabels[status] };
    }).filter((run) => (!filters.date || run.day === filters.date) && (!filters.machine || run.machine === filters.machine) && (!filters.shift || run.shift === filters.shift) && (!filters.product || String(run.partNumber ?? '').toLowerCase().includes(filters.product.toLowerCase())) && (!filters.status || run.status === filters.status)).sort((a, b) => (a.day || '').localeCompare(b.day || '') || (a.machine || '').localeCompare(b.machine || '') || (a.id || '').localeCompare(b.id || ''));
  }, [entries, actuals, productionLine, safeSettings, filters]);

  const selectedRun = runs.find((run) => run.id === selectedId) ?? runs[0] ?? null;
  useEffect(() => { if (selectedRun) setSelectedId(selectedRun.id); }, [selectedRun?.id]);
  useEffect(() => { if (!selectedRun) { setDraft(null); return; } const saved = selectedRun.actual?.oeeInput ?? {}; setDraft({ ...saved, lossEvents: Array.isArray(saved.lossEvents) ? saved.lossEvents : [] }); setEditingLossId(null); }, [selectedRun?.id, selectedRun?.actual?.oeeInput]);

  const result = selectedRun && draft ? deriveOeeRun(buildEngineInput(selectedRun, safeSettings, draft)) : null;
  const machineOptions = [...new Set(entries.map((entry) => entry.machine).filter(Boolean))].sort();
  const categories = safeSettings.lossCategories ?? [];
  const allocationRequired = selectedRun?.slotRuns?.length > 1;
  const save = () => {
    if (!selectedRun || !draft || !editable) return;
    const now = new Date().toISOString();
    setActuals((current) => {
      const existing = current.find((actual) => actual.planningEntryId === selectedRun.id);
      const next = { ...existing, id: existing?.id ?? `actual_${Date.now()}`, planningEntryId: selectedRun.id, actualMouldQty: existing?.actualMouldQty ?? '', comment: existing?.comment ?? '', oee: existing?.oee ?? {}, oeeInput: { ...draft, status: result?.status ?? 'PENDING', updatedAt: now, updatedBy: currentUser?.id ?? null, createdAt: existing?.oeeInput?.createdAt ?? now, createdBy: existing?.oeeInput?.createdBy ?? currentUser?.id ?? null } };
      return existing ? current.map((actual) => actual.planningEntryId === selectedRun.id ? next : actual) : [...current, next];
    });
    if (result?.status === 'COMPLETE' && setOeeHistory) {
      const finalized = finalizeOeeHistory(oeeHistory, result, { originalPlan: getOriginalPlanQty(selectedRun), effectivePlan: getEffectivePlanQty(selectedRun), completedByUserId: currentUser?.id ?? null, updatedByUserId: currentUser?.id ?? null });
      if (finalized.created) setOeeHistory(finalized.history);
    }
  };
  const addLoss = () => setEditingLossId('new');
  const saveLoss = (event) => { setDraft((current) => ({ ...current, lossEvents: event.id ? current.lossEvents.map((item) => item.id === event.id ? event : item) : [...current.lossEvents, createLossEvent({ ...event, planningEntryId: selectedRun.id, createdBy: currentUser?.id ?? null })] })); setEditingLossId(null); };
  const removeLoss = (id) => setDraft((current) => ({ ...current, lossEvents: current.lossEvents.filter((event) => event.id !== id) }));

  return <div className="oee-dashboard" style={{ gap: 16 }}>
    <section className="oee-panel"><h3>OEE Input</h3><div className="oee-filters">
      <Field label="Date"><input type="date" value={filters.date} onChange={(event) => setFilters((current) => ({ ...current, date: event.target.value }))} /></Field>
      <Field label="Production Line"><select value={productionLine} onChange={(event) => setProductionLine(event.target.value)}><option value="blowMoulding">Blow Moulding</option><option value="thermoforming">Thermoforming</option></select></Field>
      <Field label="Machine"><select value={filters.machine} onChange={(event) => setFilters((current) => ({ ...current, machine: event.target.value }))}><option value="">All machines</option>{machineOptions.map((machine) => <option key={machine} value={machine}>{machine}</option>)}</select></Field>
      <Field label="Shift"><select value={filters.shift} onChange={(event) => setFilters((current) => ({ ...current, shift: event.target.value }))}><option value="">All shifts</option>{SHIFTS.map((shift) => <option key={shift} value={shift}>{shift}</option>)}</select></Field>
      <Field label="Product / Stock Code"><input value={filters.product} onChange={(event) => setFilters((current) => ({ ...current, product: event.target.value }))} /></Field>
      <Field label="Status"><select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">All statuses</option>{Object.keys(statusLabels).map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></Field>
    </div></section>
    <section className="oee-panel"><h3>Production runs</h3><div className="oee-table-scroll"><table className="mrp-table"><thead><tr><th>Date</th><th>Shift</th><th>Machine</th><th>Product</th><th>Effective Plan</th><th>Actual Produced</th><th>Status</th><th>Action</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id} onClick={() => setSelectedId(run.id)} style={{ cursor: 'pointer', background: selectedRun?.id === run.id ? '#f6f4ee' : 'transparent' }}><td>{run.day}</td><td>{run.shift}</td><td>{run.machine}</td><td>{run.partNumber}</td><td>{formatValue(getEffectivePlanQty(run))}</td><td>{formatValue(run.actual?.actualMouldQty)}</td><td>{run.statusLabel}</td><td><button type="button" className="mrp-btn mrp-btn-ghost" onClick={(event) => { event.stopPropagation(); setSelectedId(run.id); }}>{run.status === 'PENDING' ? 'Capture OEE' : run.status === 'INCOMPLETE' ? 'Continue OEE' : 'View OEE'}</button></td></tr>)}{!runs.length && <tr><td colSpan="8">No runs match the current filters.</td></tr>}</tbody></table></div></section>
    {selectedRun && draft && <>
      <section className="oee-panel"><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><h3>{selectedRun.partNumber}</h3><p className="oee-caption">Production context for this planning run</p></div><strong>{statusLabels[result?.status ?? 'PENDING']}</strong></div><div className="oee-kpi-grid">{[['Date', selectedRun.day], ['Production Line', productionLine], ['Machine', selectedRun.machine], ['Shift', selectedRun.shift], ['Process', selectedRun.process ?? productionLine], ['Product', selectedRun.partNumber], ['Variant', selectedRun.variant], ['Suffix', selectedRun.suffix], ['Original Plan', formatValue(getOriginalPlanQty(selectedRun))], ['Effective Plan', formatValue(getEffectivePlanQty(selectedRun))], ['Actual Produced', formatValue(selectedRun.actual?.actualMouldQty)]].map(([label, value]) => <ReadonlyValue key={label} label={label} value={value} />)}</div><details style={{ marginTop: 14 }}><summary>Technical details</summary><p className="plex-mono">planningEntryId: {selectedRun.id}</p></details></section>
      <section className="oee-panel"><h3>Configuration</h3><div className="oee-kpi-grid"><ReadonlyValue label="NICT" value={formatValue(result?.nictSeconds, ' seconds')} /><ReadonlyValue label="NICT Source" value={result?.nictSource} /><ReadonlyValue label="Cycle Time" value={formatValue(result?.cycleTimeMinutes, ' minutes')} /><ReadonlyValue label="Ideal OEE" value={formatValue((result?.idealOee ?? 0) * 100, '%')} /><ReadonlyValue label="Calculation Strategy" value={result?.strategy} /></div>{result?.issues?.includes('MISSING_NICT') && <div className="actual-data-warning" style={{ marginTop: 12 }}>Configuration Missing — NICT. Configure it in OEE &gt; Settings &gt; Cycle Times / NICT.</div>}</section>
      <section className="oee-panel"><h3>Quality capture</h3><div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}><ReadonlyValue label="Total Produced" value={formatValue(result?.totalProduced)} /><Field label="Scrap Parts" hint="Blank means not entered."><input type="number" min="0" step="any" disabled={!editable} value={numberOrBlank(draft.scrapParts)} onChange={(event) => setDraft((current) => ({ ...current, scrapParts: event.target.value === '' ? null : event.target.value }))} /></Field><ReadonlyValue label="Good Parts" value={formatValue(result?.goodParts)} /><ReadonlyValue label="Total Parts Produced" value={formatValue(result?.totalProduced)} /></div></section>
      <section className="oee-panel"><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><h3>Losses</h3><button type="button" className="mrp-btn mrp-btn-primary" disabled={!editable || !categories.some((category) => category.active)} onClick={addLoss}>+ Add Loss</button></div>{draft.lossEvents.map((event) => editingLossId === event.id ? <LossEditor key={event.id} categories={categories} event={event} onSave={saveLoss} onCancel={() => setEditingLossId(null)} /> : <div key={event.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) 130px 120px minmax(160px, 2fr) auto', gap: 8, alignItems: 'center', padding: '9px 0', borderBottom: '1px solid #e3dfd2' }}><span>{event.categoryName || event.semanticKey || 'Historical category'}</span><span>{event.lossType}</span><span>{formatValue(event.durationMinutes, ' min')}</span><span>{event.comment || '—'}</span><span style={{ display: 'flex', gap: 5 }}><button type="button" className="mrp-btn mrp-btn-ghost" disabled={!editable} onClick={() => setEditingLossId(event.id)}>Edit</button><button type="button" className="mrp-btn mrp-btn-ghost" disabled={!editable} onClick={() => removeLoss(event.id)}>Delete</button></span></div>)}{editingLossId === 'new' && <LossEditor categories={categories} event={null} onSave={saveLoss} onCancel={() => setEditingLossId(null)} />}{!draft.lossEvents.length && editingLossId !== 'new' && <p className="oee-caption">No loss events captured.</p>}</section>
      <section className="oee-panel"><h3>Time allocation and calculated time</h3>{allocationRequired && <Field label="Allocated Planned Time (minutes)" hint="Required per planningEntryId; allocations must reconcile across the slot."><input type="number" min="0" step="any" disabled={!editable} value={numberOrBlank(draft.plannedTimeMinutes)} onChange={(event) => setDraft((current) => ({ ...current, plannedTimeMinutes: event.target.value === '' ? null : event.target.value }))} /></Field>}<div className="oee-kpi-grid" style={{ marginTop: 12 }}><ReadonlyValue label="Planned Time" value={formatValue(result?.plannedTimeMinutes, ' minutes')} /><ReadonlyValue label="Planned Breaks" value={formatValue(result?.plannedBreakMinutes, ' minutes')} /><ReadonlyValue label="Total Downtime" value={formatValue(result?.totalDowntimeMinutes, ' minutes')} /><ReadonlyValue label="Run Time" value={formatValue(result?.runTimeMinutes, ' minutes')} /></div></section>
      <Results result={{ ...result, plan: getOriginalPlanQty(selectedRun), effectivePlan: getEffectivePlanQty(selectedRun) }} />
      {result?.issues?.length > 0 && <section className="oee-panel"><h3>Issues</h3><ul>{result.issues.map((issue) => <li key={issue}>{issueLabels[issue] ?? issue}</li>)}</ul></section>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button type="button" className="mrp-btn mrp-btn-ghost" onClick={() => setSelectedId(null)}>Back</button><button type="button" className="mrp-btn mrp-btn-primary" disabled={!editable} onClick={save}>Save OEE</button></div>
    </>}
  </div>;
}