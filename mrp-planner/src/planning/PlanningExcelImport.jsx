import React, { useMemo, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { readPlanExcel } from './readPlanExcel';
import { planningExcelCatalog } from './excelPlanReview.js';
import { approveExcelCode, approveExcelQuantity, approveExcelShifts, createAutomaticExcelDraft, datesForYear, emptyExcelProfile, excelProfileId, prepareExcelPlanReview, resolveExcelDates } from './excelImportProfile.js';
import { SHIFT_CONFIG } from './shiftConfig.js';
import { PRODUCTION_LINES } from '../production/productionLines.js';
import './planningExcelImport.css';

const lineName = (id) => PRODUCTION_LINES[id]?.name || id;
const shiftLabel = (key) => `${key}: ${SHIFT_CONFIG[key].start}-${SHIFT_CONFIG[key].end}`;

export default function PlanningExcelImport({ session, onSessionChange, items, boms, bomStatus, planningWeeks, profiles = {}, onImport, editable }) {
  const upload = useRef(null), importing = useRef(false);
  const [showDates, setShowDates] = useState(false);
  const catalog = useMemo(() => session?.document ? planningExcelCatalog(items, boms) : [], [Boolean(session?.document), items, boms]);
  const connected = Boolean(bomStatus?.connected && !bomStatus?.loading && !bomStatus?.error);
  const plan = useMemo(() => session?.draft ? prepareExcelPlanReview({ document: session.document, draft: session.draft, profile: session.profile, catalog, planningWeeks, bomConnected: connected }) : null,
    [session?.document, session?.draft, session?.profile, catalog, planningWeeks, connected]);
  if (!editable) return null;
  const saving = Boolean(session?.saving), source = session?.document;

  function update(patch) { onSessionChange((current) => current?.token === session.token ? { ...current, ...patch, error: '' } : current); }
  function changeRows(ids, patch) {
    update({ draft: { ...session.draft, rows: session.draft.rows.map((row) => ids.includes(row.id) ? { ...row, ...patch } : row) } });
  }
  function approve(action) {
    try { update({ profile: action() }); }
    catch (error) { onSessionChange((current) => ({ ...current, error: error.message })); }
  }
  function skipQuestion(question) { changeRows(question.rowIds, { include: false, excludedReason: `Planner skipped unresolved mapping: ${question.token}` }); }
  async function read(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || saving || importing.current) return;
    if (session?.draft && session.stage !== 'imported' && !window.confirm('Replace the current unsaved preview?')) return;
    const token = crypto.randomUUID(); setShowDates(false);
    onSessionChange({ token, stage: 'reading', fileName: file.name, error: '' });
    try {
      const document = await readPlanExcel(file), saved = profiles[excelProfileId(document)] || null;
      onSessionChange((current) => current?.token === token ? { token, stage: 'preview', document, draft: createAutomaticExcelDraft(document),
        profile: saved ? structuredClone(saved) : emptyExcelProfile(document), profileBaseKey: JSON.stringify(saved), reusedProfile: Boolean(saved), error: '' } : current);
    } catch (error) { onSessionChange((current) => current?.token === token ? { ...current, stage: 'error', error: error.message || 'Workbook could not be read. The plan is unchanged.' } : current); }
  }
  function close() {
    if (saving || importing.current) return;
    if (session?.draft && session.stage !== 'imported' && !window.confirm('Discard this preview and unsaved profile decisions? The plan is unchanged.')) return;
    onSessionChange(null);
  }
  async function confirmImport() {
    if (saving || importing.current || !plan?.canImport || showDates) return;
    importing.current = true; update({ saving: true });
    try {
      const result = await onImport({ document: source, draft: session.draft, profile: session.profile, profileBaseKey: session.profileBaseKey, expectedReviewKey: plan.key, batchToken: session.token });
      onSessionChange((current) => current?.token === session.token ? { ...current, stage: 'imported', result, saving: false, error: '' } : current);
    } catch (error) { onSessionChange((current) => current?.token === session.token ? { ...current, saving: false, error: error.message || 'Saving failed. The preview is retained for retry.' } : current); }
    finally { importing.current = false; }
  }
  const exceptions = new Map();
  for (const row of plan?.exceptions || []) {
    const list = exceptions.get(row.cellId) || []; list.push(row); exceptions.set(row.cellId, list);
  }
  const dates = plan ? Object.values(plan.dateResolution.dates).sort() : [];
  const machineNames = source ? [...new Set(source.cells.filter((cell) => cell.machine).map((cell) => cell.machine))] : [];
  return <section className="excel-plan-import" aria-labelledby="excel-import-title">
    <header><div><h2 id="excel-import-title">Upload production plan</h2><p>Keep the original Excel grid. Approve new mappings once, then confirm the ready rows.</p></div>
      <div className="excel-import-actions"><input ref={upload} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Upload production-plan Excel" onChange={read} hidden />
        <button type="button" onClick={() => upload.current?.click()} disabled={saving || session?.stage === 'reading'}><Upload size={14} />{session ? 'Choose another workbook' : 'Upload Excel (.xlsx)'}</button>
        {session && <button type="button" onClick={close} disabled={saving}>{session.stage === 'imported' ? 'Close import report' : 'Cancel preview'}</button>}</div></header>
    {session?.stage === 'reading' && <p role="status">Reading the schedule locally...</p>}
    {session?.error && <p className="excel-import-error" role="alert">{session.error}</p>}
    {source && plan && (session.stage === 'imported' ? <>
      <p className="excel-import-success" role="status">Saved {session.result.added.length} activities and the approved import profile. Existing plans and linked records were preserved.</p>
      <p>Continue editing in the normal Planning cells. Matching uploads reuse these approvals.</p>
      <ScheduleTable rows={session.result.added.map((entry) => ({ id: entry.id, entry, cell: { sourceCell: entry.importSource.sourceCell }, target: null }))} />
      <details><summary>Skipped source entries ({session.result.exclusions.length})</summary><Exclusions rows={session.result.exclusions} /></details>
    </> : <>
      <div className="excel-compact-summary" aria-label="Workbook summary">
        <div><b>{source.fileName}</b><p className="excel-recognition">{source.sheetName} · {source.dateGroups.length} days · {machineNames.length} machines · {source.cells.length} source cells</p>
          <p data-date-range>{dates[0] || 'Dates need review'}{dates.length > 1 ? ` to ${dates[dates.length - 1]}` : ''}</p><small>{machineNames.join(', ')}</small></div>
        <div className="excel-summary-counts"><span><b data-ready-count>{plan.review.readyRows.length}</b> ready</span><span><b data-duplicate-count>{plan.duplicates.length}</b> duplicates / split checks</span><span><b data-exception-count>{plan.exceptions.length}</b> exceptions</span></div>
      </div>
      <p className="excel-profile-status" role="status">{session.reusedProfile ? 'Saved profile loaded. ' : 'First upload: approve the recurring settings below. '}{plan.pendingCount ? `${plan.pendingCount} new or changed decisions.` : 'All recurring mappings are approved; no mapping questions.'} {!plan.dateResolution.issue && plan.dateResolution.evidence}</p>
      {(plan.dateResolution.issue || showDates) && <DateQuestion key={`${session.token}:${showDates}`} document={source} resolution={plan.dateResolution} decision={session.draft.dateDecision}
        onApprove={(decision) => { update({ draft: { ...session.draft, dateDecision: decision } }); setShowDates(false); }} onCancel={showDates && !plan.dateResolution.issue ? () => setShowDates(false) : null} />}
      {!connected && <p role="status" className="excel-import-error">A current SYSPRO BOM is required to validate stock codes. {bomStatus?.loading ? 'Loading...' : 'Refresh the BOM to continue.'}</p>}
      {connected && <div className="excel-profile-questions">
        {(plan.questions.shifts.length > 0 || plan.questions.overnight) && <ShiftQuestion key={plan.questions.shifts.map((shift) => shift.key).join('|') + plan.questions.overnight} questions={plan.questions} profile={session.profile}
          onApprove={(targets, rule) => approve(() => approveExcelShifts(session.profile, targets, rule, source.shifts.map((shift) => shift.key)))} />}
        {plan.questions.codes.map((question) => <CodeQuestion key={`${question.key}:${question.machines.join(',')}`} question={question} catalog={catalog}
          onApprove={(target, scope) => approve(() => approveExcelCode(session.profile, question, target, scope, catalog))} onSkip={() => skipQuestion(question)} />)}
        {plan.questions.quantities.map((question) => <QuantityQuestion key={`${question.key}:${question.machines.join(',')}`} question={question}
          onApprove={(unit, factor, scope) => approve(() => approveExcelQuantity(session.profile, question, unit, factor, scope))} onSkip={() => skipQuestion(question)} />)}
      </div>}
      {exceptions.size > 0 && <details className="excel-exceptions" open><summary>Correct exceptions ({plan.exceptions.length} rows in {exceptions.size} cells)</summary>
        <p>Only exceptions need attention. Unresolved rows are skipped; valid independent runs stay separate.</p>
        {[...exceptions].map(([id, rows]) => <div className="excel-exception-cell" data-exception-cell={id} key={id}><b>{rows[0].cell.sourceCell} · {rows[0].cell.sourceMachine}</b><pre>{rows[0].cell.rawText}</pre>
          {[...new Set(rows.flatMap((row) => row.errors))].map((error) => <p className="excel-import-error" key={error}>{error}</p>)}
          {rows.some((row) => row.existingCount > 0 || row.errors.some((error) => /Overlapping|Multiple blow|Likely duplicate/.test(error))) && <button type="button" aria-label={`Confirm separate runs ${id}`} onClick={() => changeRows(rows.map((row) => row.id), { appendConfirmed: true, independentConfirmed: true })}>Keep these as separate runs; preserve existing activities</button>}
          <button type="button" onClick={() => changeRows(rows.map((row) => row.id), { include: false, excludedReason: 'Planner skipped this exception in the compact preview.' })}>Skip this cell</button>
          <details><summary>Edit affected rows</summary>{rows.map((row) => <ExceptionEditor key={row.id} row={row} onChange={(patch) => changeRows([row.id], patch)} />)}</details>
        </div>)}
      </details>}
      {plan.notes.length > 0 && <details className="excel-source-notes" open><summary>Source notes ({plan.notes.length})</summary>{plan.notes.map((row) => <p key={row.id}><b>{row.cell.sourceCell}:</b> {row.cell.fragments[row.sourceFragment]?.sourceText}</p>)}<small>Notes are retained as source information. They do not change quantities, transfer work or invent durations.</small></details>}
      {plan.unsupported.filter((row) => row.kind !== 'Remark').length > 0 && <details><summary>Unsupported / blank entries ({plan.unsupported.filter((row) => row.kind !== 'Remark').length})</summary>{plan.unsupported.filter((row) => row.kind !== 'Remark').map((row) => <p key={row.id}><b>{row.cell?.sourceCell} · {row.cell?.sourceMachine}</b> {row.cell?.rawText || '[Blank]'} — {row.excludedReason}</p>)}</details>}
      <details className="excel-ready-details"><summary>Ready schedule in source order ({plan.review.readyRows.length})</summary><ScheduleTable rows={plan.review.readyRows} /></details>
      <details><summary>All skipped / unresolved source rows ({plan.review.excludedCount})</summary><Exclusions rows={plan.review.rows.filter((row) => !row.include || row.errors.length).map((row) => ({ rowId: row.id, sourceCell: row.cell?.sourceCell, sourceText: row.cell?.rawText, reason: row.errors.join(' ') || row.excludedReason }))} /></details>
      <details className="excel-saved-settings"><summary>Profile settings and date evidence</summary><p>{plan.dateResolution.evidence}</p><button type="button" onClick={() => setShowDates(true)}>Correct workbook dates</button>
        <p>Source shift times: {Object.entries(session.profile.shifts || {}).map(([key, rule]) => `${key} → ${rule.target}`).join('; ')}. Overnight rule: {session.profile.overnightRule || 'Not approved'}.</p>
        <button type="button" onClick={() => update({ profile: { ...session.profile, shifts: {}, overnightRule: '' } })}>Change shift / overnight approvals</button>
        {Object.entries(session.profile.codeMappings || {}).map(([key, rule]) => <p key={key}>{key}: {rule.target} <button type="button" aria-label={`Change code rule ${key}`} onClick={() => { const mappings = { ...session.profile.codeMappings }; delete mappings[key]; update({ profile: { ...session.profile, codeMappings: mappings } }); }}>Change</button></p>)}
        {Object.entries(session.profile.quantityRules || {}).map(([key, rule]) => <p key={key}>{key}: {rule.sourceUnit} × {rule.factor} <button type="button" aria-label={`Change quantity rule ${key}`} onClick={() => { const rules = { ...session.profile.quantityRules }; delete rules[key]; update({ profile: { ...session.profile, quantityRules: rules } }); }}>Change</button></p>)}
      </details>
      {!plan.pendingCount && !plan.dateResolution.issue && connected && plan.review.errors.length > 0 && plan.review.readyRows.length > 0 && <ul role="alert" className="excel-import-error">{plan.review.errors.map((error) => <li key={error}>{error}</li>)}</ul>}
      <div className="excel-final-confirm"><p>Confirming adds <b>{plan.review.readyRows.length} ready rows</b>, keeps existing plans and linked records, skips {plan.review.excludedCount} source rows, and saves these profile approvals.</p>
        <button type="button" className="primary" data-confirm-import disabled={saving || !plan.canImport || showDates} onClick={confirmImport}>{saving ? 'Saving...' : session.error ? 'Retry save' : `Confirm and import ${plan.review.readyRows.length} rows`}</button>
        {!plan.canImport && <small>{plan.dateResolution.issue ? 'Resolve the workbook date question.' : plan.pendingCount ? 'Approve or skip the new mapping questions above.' : !plan.review.readyRows.length ? 'No new valid rows are ready to add.' : 'Resolve the remaining workbook errors.'}</small>}
      </div>
    </>)}
  </section>;
}

function DateQuestion({ document, resolution, decision, onApprove, onCancel }) {
  const [year, setYear] = useState(resolution.year || ''), [dates, setDates] = useState(resolution.dates), [allow, setAllow] = useState(Boolean(decision?.allowWeekdayMismatch)), [explanation, setExplanation] = useState(decision?.explanation || ''), [error, setError] = useState('');
  function approve() {
    const value = { confirmed: true, dates, allowWeekdayMismatch: allow, explanation };
    const checked = resolveExcelDates(document, value);
    if (checked.issue) return setError(checked.issue);
    onApprove(value);
  }
  return <fieldset className="excel-profile-question" data-date-question><legend>Workbook dates — one decision</legend><p className="excel-import-error">{resolution.issue}</p>
    <div className="excel-import-fields"><label>Year<input aria-label="Workbook year" type="number" min="1900" max="2199" value={year} onChange={(event) => { setYear(event.target.value); setDates(datesForYear(document, event.target.value)); }} /></label>
      {document.dateGroups.map((group) => <label key={group.id}>{group.weekday} {group.label}<input type="date" aria-label={`Workbook date ${group.id}`} value={dates[group.id] || ''} onChange={(event) => setDates((current) => ({ ...current, [group.id]: event.target.value }))} /></label>)}</div>
    <label className="excel-check"><input type="checkbox" checked={allow} onChange={(event) => setAllow(event.target.checked)} />Use corrected dates despite a printed weekday mismatch</label>{allow && <label>Reason<input aria-label="Date correction explanation" value={explanation} onChange={(event) => setExplanation(event.target.value)} /></label>}
    {error && <p role="alert" className="excel-import-error">{error}</p>}<div className="excel-import-actions"><button type="button" onClick={approve}>Confirm workbook dates</button>{onCancel && <button type="button" onClick={onCancel}>Keep current dates</button>}</div>
  </fieldset>;
}

function ShiftQuestion({ questions, profile, onApprove }) {
  const [targets, setTargets] = useState(Object.fromEntries(questions.shifts.map((shift) => [shift.key, '']))), [rule, setRule] = useState(profile.overnightRule || '');
  return <fieldset className="excel-profile-question" data-shift-question><legend>Approve new or changed shift times</legend><div className="excel-import-fields">
    {questions.shifts.map((shift) => <label key={shift.key}>{shift.label}<select aria-label={`Shift mapping ${shift.key}`} value={targets[shift.key]} onChange={(event) => setTargets((current) => ({ ...current, [shift.key]: event.target.value }))}><option value="">Choose application shift...</option>{Object.keys(SHIFT_CONFIG).map((key) => <option value={key} key={key}>{shiftLabel(key)}</option>)}</select></label>)}
    <label>Printed date for an overnight shift<select aria-label="Overnight date rule" value={rule} onChange={(event) => setRule(event.target.value)}><option value="">Choose date rule...</option><option value="start-date">Date the shift starts</option><option value="end-date">Date the shift ends (start on previous day)</option></select></label></div>
    <p>Applies to every matching shift column, including future uploads. Application shift settings stay unchanged.</p><button type="button" onClick={() => onApprove(targets, rule)}>Approve shift profile</button>
  </fieldset>;
}

function ScopeSelect({ question, value, onChange }) {
  return <label>Apply to<select aria-label={`Scope ${question.key}`} value={value} onChange={(event) => onChange(event.target.value)}><option value={`line:${question.productionLine}`}>{lineName(question.productionLine)} — all matching machines</option>{question.machines.map((machine) => <option key={machine} value={`machine:${machine}`}>{machine} only</option>)}</select></label>;
}
function CodeQuestion({ question, catalog, onApprove, onSkip }) {
  const [scope, setScope] = useState(`line:${question.productionLine}`), [target, setTarget] = useState(''), [query, setQuery] = useState(question.token);
  const machines = scope.startsWith('machine:') ? [scope.slice(8)] : question.machines;
  const available = catalog.filter((item) => item.machine === machines[0] && machines.every((machine) => catalog.some((other) => other.machine === machine && other.planningCode === item.planningCode)));
  const matches = available.filter((item) => item.planningCode === target || [item.planningCode, item.description, item.alias, ...item.fullStockCodes].some((text) => String(text || '').toLowerCase().includes(query.toLowerCase()))).slice(0, 80);
  return <fieldset className="excel-profile-question" data-code-question={question.key}><legend>{question.changed ? 'Changed mapping' : 'New shorthand / unrecognized code'}: {question.token}</legend><p>{question.rowIds.length} rows · {question.machines.join(', ')} · {lineName(question.productionLine)}</p>
    <div className="excel-import-fields"><ScopeSelect question={question} value={scope} onChange={(value) => { setScope(value); setTarget(''); }} /><label>Find full stock code<input aria-label={`Find code ${question.key}`} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label>Verified full stock codes<select aria-label={`Code mapping ${question.key}`} value={target} onChange={(event) => setTarget(event.target.value)}><option value="">Choose verified product...</option>{matches.map((item) => <option key={item.planningCode} value={item.planningCode}>{item.fullStockCodes.join(' + ')} ({item.alias || item.planningCode}; {item.targetUnit})</option>)}</select></label></div>
    <div className="excel-import-actions"><button type="button" disabled={!target} onClick={() => onApprove(target, scope)}>Approve code mapping</button><button type="button" onClick={onSkip}>Skip these rows</button></div>
  </fieldset>;
}
function QuantityQuestion({ question, onApprove, onSkip }) {
  const [scope, setScope] = useState(`line:${question.productionLine}`), [unit, setUnit] = useState(''), [factor, setFactor] = useState('1');
  return <fieldset className="excel-profile-question" data-quantity-question={question.key}><legend>Quantity basis: {lineName(question.productionLine)} → {question.targetUnit}</legend><p>{question.rowIds.length} matching rows · stock unit {question.stockUom}. Approve once for all quantities in this scope.</p>
    <div className="excel-import-fields"><ScopeSelect question={question} value={scope} onChange={setScope} /><label>Workbook quantity means<select aria-label={`Quantity unit ${question.key}`} value={unit} onChange={(event) => setUnit(event.target.value)}><option value="">Unconfirmed...</option>{['EA', 'SET', 'SHEET', 'KG'].map((value) => <option key={value}>{value}</option>)}</select></label><label>Multiply by<input aria-label={`Quantity factor ${question.key}`} type="number" min="0" step="any" value={factor} onChange={(event) => setFactor(event.target.value)} /></label></div>
    <div className="excel-import-actions"><button type="button" onClick={() => onApprove(unit, factor, scope)}>Approve quantity rule</button><button type="button" onClick={onSkip}>Skip these rows</button></div>
  </fieldset>;
}

function ExceptionEditor({ row, onChange }) {
  return <div className="excel-exception-editor" data-source-row={row.id}><span>{row.id}</span><div className="excel-import-fields">
    <label>Machine<select aria-label={`Machine ${row.id}`} value={row.machineOverride || row.cell.machine || ''} onChange={(event) => onChange({ machineOverride: event.target.value, machineOverrideConfirmed: true })}>{Object.values(PRODUCTION_LINES).flatMap((line) => Object.keys(line.machines).map((machine) => <option key={machine}>{machine}</option>))}</select></label>
    <label>Date<input aria-label={`Date ${row.id}`} type="date" value={row.entry?.day || ''} onChange={(event) => onChange({ dateOverride: event.target.value, dateOverrideConfirmed: true })} /></label>
    <label>Shift<select aria-label={`Shift ${row.id}`} value={row.entry?.shift || ''} onChange={(event) => onChange({ shiftOverride: event.target.value, shiftOverrideConfirmed: true })}><option value="">Choose shift...</option>{Object.keys(SHIFT_CONFIG).map((key) => <option key={key}>{key}</option>)}</select></label>
    <label>Activity<select aria-label={`Activity ${row.id}`} value={row.kind} onChange={(event) => onChange({ kind: event.target.value, activityConfirmed: true, quantity: event.target.value === 'Production' ? row.quantity : '', correctionNote: 'Activity corrected by planner in Excel preview.' })}>{['Production', 'OFF', 'Changeover'].map((kind) => <option key={kind}>{kind}</option>)}</select></label>
    {row.kind === 'Production' && <><label>Stock code / shorthand<input aria-label={`Product ${row.id}`} value={row.productText} onChange={(event) => onChange({ productText: event.target.value })} /></label><label>Quantity<input aria-label={`Quantity ${row.id}`} type="number" step="any" value={row.quantity} onChange={(event) => onChange({ quantity: event.target.value })} /></label></>}
    <label>Correction note<input aria-label={`Correction note ${row.id}`} value={row.correctionNote} onChange={(event) => onChange({ correctionNote: event.target.value })} /></label>
  </div></div>;
}
function ScheduleTable({ rows }) {
  return <div className="excel-review-table-wrap"><table className="excel-compact-table excel-additions-table"><thead><tr><th>Machine</th><th>Date / shift</th><th>Activity</th><th>Stock code</th><th>Quantity</th><th>Source</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} data-ready-row={row.id}><td>{row.entry.machine}</td><td>{row.entry.day}<br />{row.entry.shift}</td><td>{row.entry.status}</td><td>{row.target?.fullStockCodes.join(' + ') || row.entry.partNumber || '—'}</td><td>{row.entry.status === 'Planned' ? `${row.entry.buildQty} ${row.entry.quantityUom || ''}` : '—'}</td><td>{row.cell.sourceCell}</td></tr>)}</tbody></table></div>;
}
function Exclusions({ rows }) { return <div className="excel-exclusions">{rows.map((row) => <p key={row.rowId}><b>{row.sourceCell}</b> {row.reason}<br /><small>{row.fragmentText || row.sourceText}</small></p>)}</div>; }

export function PlanningExcelImportHistory({ planningWeeks = {} }) {
  const reports = useMemo(() => [...new Map(Object.values(planningWeeks).flatMap((week) => [...(Array.isArray(week.excelPlanImports) ? week.excelPlanImports : []), ...(Array.isArray(week.pdfPlanImports) ? week.pdfPlanImports : [])]).map((report) => [report.id, report])).values()].sort((a, b) => b.importedAt.localeCompare(a.importedAt)), [planningWeeks]);
  if (!reports.length) return null;
  const download = (report) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'production-plan-source-report.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <details className="excel-import-history"><summary>Imported plan source / exclusion reports ({reports.length})</summary>{reports.map((report) => <details key={report.id}><summary>{report.fileName} · {new Date(report.importedAt).toLocaleString()} · {report.addedEntryIds.length} activities</summary><p>Source and exclusions retained at import. Current manual edits may differ.</p><button type="button" onClick={() => download(report)}>Download retained source report</button><Exclusions rows={report.exclusions} /></details>)}</details>;
}
