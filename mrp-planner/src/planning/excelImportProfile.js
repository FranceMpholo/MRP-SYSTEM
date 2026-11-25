import { createExcelPlanDraft, excelMappingKey, reviewExcelPlanImport } from './excelPlanReview.js';
import { SHIFT_CONFIG } from './shiftConfig.js';
import { addCalendarDays } from './planningBoardUtils.js';
import { weekdayFromDateOnly } from './planningApiMapper.js';

export const PROFILE_VERSION = 1;
const normalized = (value) => String(value || '').trim().toUpperCase();
const units = ['EA', 'SET', 'SHEET', 'KG'];
const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
export const excelProfileId = (document) => document.format;
export const emptyExcelProfile = (document) => ({ id: excelProfileId(document), version: PROFILE_VERSION, shifts: {}, overnightRule: '', codeMappings: {}, quantityRules: {} });
const targetSignature = (target) => JSON.stringify([target.planningCode, [...target.fullStockCodes].sort(), target.targetUnit, target.stockUom || 'EA']);
const shiftSignature = (target) => JSON.stringify(SHIFT_CONFIG[target] || null);
const scopedKey = (scope, token) => `${scope}|${normalized(token)}`;
const quantityToken = (target) => `${target.targetUnit}|${normalized(target.stockUom || 'EA')}`;
const fullDate = (year, group) => `${year}-${String(group.month).padStart(2, '0')}-${String(group.day).padStart(2, '0')}`;

export function datesForYear(document, year) {
  let runningYear = Number(year), previous = null;
  return Object.fromEntries(document.dateGroups.map((group) => {
    const monthDay = group.month * 100 + group.day;
    if (group.year) runningYear = Number(group.year);
    else if (previous !== null && previous >= 1201 && monthDay <= 131) runningYear++;
    previous = monthDay;
    return [group.id, fullDate(runningYear, group)];
  }));
}

export function resolveExcelDates(document, decision) {
  const filenameYears = [...new Set([...document.fileName.matchAll(/(?:^|\D)((?:19|20|21)\d{2})(?=\D|$)/g)].map((match) => match[1]))];
  const printedYears = document.dateGroups.map((group) => group.year).filter(Boolean);
  const missing = document.dateGroups.some((group) => !group.year);
  const year = printedYears[0] || (filenameYears.length === 1 ? filenameYears[0] : '');
  const dates = decision?.confirmed ? decision.dates : year ? datesForYear(document, year) : {};
  const valid = document.dateGroups.every((group) => {
    const date = dates[group.id];
    return /^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(date || '') && Boolean(weekdayFromDateOnly(date));
  });
  const weekdaysAgree = valid && document.dateGroups.every((group) => (!missing || group.weekday || decision?.confirmed) && (!group.weekday || weekdayFromDateOnly(dates[group.id]) === group.weekday));
  let issue = '';
  if (!valid) issue = year ? 'A printed date is invalid. Correct the workbook dates once below.' : 'The year is uncertain. Enter and confirm the workbook dates once.';
  else if (!weekdaysAgree && !(decision?.confirmed && decision.allowWeekdayMismatch && decision.explanation?.trim())) issue = 'Date conflict: the proposed dates do not agree with the printed weekdays. Correct or explicitly explain the workbook dates once.';
  else if (missing && !decision?.confirmed && (filenameYears.length !== 1 || (printedYears.length && printedYears[0] !== filenameYears[0]))) issue = 'The filename year is missing or conflicts with the printed dates. Confirm the workbook dates once.';
  return { dates, year: (Object.values(dates)[0] || '').slice(0, 4), issue, evidence: decision?.confirmed ? 'Planner-confirmed workbook dates' : missing ? `Filename year ${year}; every printed date and weekday agrees` : 'Full dates printed in the sheet' };
}

export function createAutomaticExcelDraft(document) {
  const draft = createExcelPlanDraft(document);
  return { ...draft, automatic: true, dateDecision: null, rows: draft.rows.map((row) => {
    const cell = document.cells.find((cell) => cell.id === row.cellId);
    return { ...row, include: Boolean(cell.machine && ['Production', 'OFF', 'Changeover'].includes(row.kind)), activityConfirmed: true, notesConfirmed: true };
  }) };
}

export function approveExcelShifts(profile, shifts, overnightRule, activeKeys = Object.keys(shifts)) {
  if (!['start-date', 'end-date'].includes(overnightRule)) throw new Error('Choose the overnight shift date rule.');
  const updated = { ...profile, shifts: { ...profile.shifts }, overnightRule };
  for (const [source, target] of Object.entries(shifts)) {
    if (!Object.hasOwn(SHIFT_CONFIG, target)) throw new Error('Choose a configured target for each new shift time.');
    updated.shifts[source] = { target, targetSignature: shiftSignature(target), approved: true };
  }
  const targets = activeKeys.map((key) => updated.shifts[key]?.target).filter(Boolean);
  if (targets.length !== new Set(targets).size) throw new Error('Each source shift must map to a different configured shift.');
  return updated;
}

export function approveExcelCode(profile, question, targetCode, scope, catalog) {
  const selectedMachines = scope.startsWith('machine:') ? question.machines.filter((machine) => scope === `machine:${machine}`) : scope === `line:${question.productionLine}` ? question.machines : [];
  const targets = selectedMachines.map((machine) => catalog.find((item) => item.machine === machine && item.planningCode === targetCode));
  if (!targets.length || targets.some((target) => !target) || new Set(targets.map(targetSignature)).size !== 1) throw new Error('Choose a valid full-code mapping for every machine in the selected scope.');
  return { ...profile, codeMappings: { ...profile.codeMappings, [scopedKey(scope, question.token)]: { target: targetCode, signature: targetSignature(targets[0]), approved: true, explanation: `Planner-approved ${scope} shorthand ${question.token}` } } };
}

export function approveExcelQuantity(profile, question, sourceUnit, factor, scope) {
  if (!units.includes(sourceUnit) || !positive(factor)) throw new Error('Choose the quantity unit and a positive conversion factor, including 1 for unchanged quantities.');
  if (scope !== `line:${question.productionLine}` && !question.machines.some((machine) => scope === `machine:${machine}`)) throw new Error('Choose a scope represented by these quantities.');
  return { ...profile, quantityRules: { ...profile.quantityRules, [scopedKey(scope, question.token)]: { sourceUnit, factor: String(factor), approved: true, explanation: `Planner-approved ${scope} quantity basis: ${sourceUnit} x ${factor} to ${question.targetUnit}` } } };
}

function mappedTarget(row, cell, profile, catalog) {
  const available = catalog.filter((item) => item.machine === cell.machine && item.productionLine === cell.productionLine);
  const exact = available.find((item) => !item.isPair && item.planningCode === normalized(row.productText));
  if (exact) return { target: exact, exact: true };
  const rule = profile.codeMappings?.[scopedKey(`machine:${cell.machine}`, row.productText)] || profile.codeMappings?.[scopedKey(`line:${cell.productionLine}`, row.productText)];
  const target = available.find((item) => item.planningCode === rule?.target);
  return rule?.approved && target && rule.signature === targetSignature(target) ? { target, rule } : { changed: Boolean(rule) };
}

export function prepareExcelPlanReview({ document, draft, profile, catalog, planningWeeks = {}, bomConnected }) {
  const approved = profile?.version === PROFILE_VERSION && profile.id === excelProfileId(document) ? profile : emptyExcelProfile(document);
  const dateResolution = resolveExcelDates(document, draft.dateDecision);
  const materialized = { ...draft, year: dateResolution.year, yearConfirmed: !dateResolution.issue, filenameReviewed: true, sourceReviewed: true,
    nightDateReviewed: ['start-date', 'end-date'].includes(approved.overnightRule), dates: Object.fromEntries(document.dateGroups.map((group) => [group.id, { date: dateResolution.dates[group.id] || '', confirmed: !dateResolution.issue }])), shifts: {}, mappings: {} };
  const pendingShifts = document.shifts.filter((shift) => {
    const rule = approved.shifts?.[shift.key];
    const valid = rule?.approved && Object.hasOwn(SHIFT_CONFIG, rule.target) && rule.targetSignature === shiftSignature(rule.target);
    materialized.shifts[shift.key] = { target: valid ? rule.target : '', confirmed: Boolean(valid) };
    return !valid;
  });
  const sourceRecords = Object.values(planningWeeks).flatMap((week) => [
    ...(week.entries || []).map((entry) => entry.importSource),
    ...(Array.isArray(week.excelPlanImports) ? week.excelPlanImports : []).flatMap((report) => report.importedSources || []),
  ]).filter(Boolean);
  const cellMap = new Map(document.cells.map((cell) => [cell.id, cell]));
  const codeQuestions = new Map(), quantityQuestions = new Map();
  const duplicateRows = [];
  materialized.rows = draft.rows.map((base) => {
    const cell = cellMap.get(base.cellId), row = { ...base };
    if (!cell) return row;
    const groupDate = dateResolution.dates[cell.dateGroupId];
    if (!row.dateOverride && approved.overnightRule === 'end-date' && cell.shiftKey && cell.shiftKey.split('-')[0] > cell.shiftKey.split('-')[1] && weekdayFromDateOnly(groupDate)) {
      row.dateOverride = addCalendarDays(groupDate, -1); row.dateOverrideConfirmed = true;
    }
    const date = row.dateOverride || groupDate;
    if (sourceRecords.some((source) => source.documentHash === document.fingerprint && source.rowId === row.id && source.targetDate === date)) {
      row.include = false; row.excludedReason = 'Already imported source fragment for this date; preserved existing entry.'; duplicateRows.push(row.id);
    }
    if (!row.include || row.kind !== 'Production' || !cell.machine) return row;
    const effectiveCell = row.machineOverride ? { ...cell, machine: row.machineOverride, productionLine: catalog.find((item) => item.machine === row.machineOverride)?.productionLine } : cell;
    const result = mappedTarget(row, effectiveCell, approved, catalog);
    if (!result.target) {
      const key = `${effectiveCell.productionLine}|${normalized(row.productText)}`;
      const question = codeQuestions.get(key) || { key, token: normalized(row.productText), productionLine: effectiveCell.productionLine, machines: [], rowIds: [], changed: result.changed };
      question.machines = [...new Set([...question.machines, effectiveCell.machine])]; question.rowIds.push(row.id); question.changed ||= result.changed;
      codeQuestions.set(key, question); return row;
    }
    const target = result.target, token = quantityToken(target);
    const quantityRule = approved.quantityRules?.[scopedKey(`machine:${effectiveCell.machine}`, token)] || approved.quantityRules?.[scopedKey(`line:${effectiveCell.productionLine}`, token)];
    const quantityApproved = quantityRule?.approved && units.includes(quantityRule.sourceUnit) && positive(quantityRule.factor);
    materialized.mappings[excelMappingKey(row, effectiveCell)] = { target: target.planningCode, sourceUnit: quantityApproved ? quantityRule.sourceUnit : '', factor: quantityApproved ? quantityRule.factor : '', reviewed: Boolean(quantityApproved), explanation: [result.rule?.explanation, quantityRule?.explanation].filter(Boolean).join('; ') };
    if (!quantityApproved) {
      const key = `${effectiveCell.productionLine}|${token}`;
      const question = quantityQuestions.get(key) || { key, token, productionLine: effectiveCell.productionLine, targetUnit: target.targetUnit, stockUom: target.stockUom || 'EA', machines: [], rowIds: [] };
      question.machines = [...new Set([...question.machines, effectiveCell.machine])]; question.rowIds.push(row.id); quantityQuestions.set(key, question);
    }
    return row;
  });
  const review = reviewExcelPlanImport({ document, draft: materialized, catalog, planningWeeks, bomConnected });
  const codePendingIds = new Set([...codeQuestions.values()].flatMap((question) => question.rowIds));
  const quantityPendingIds = new Set([...quantityQuestions.values()].flatMap((question) => question.rowIds));
  // Setup decisions are grouped above the preview. Do not repeat the same
  // missing unit/shift/year question as an exception on every affected row.
  const exceptions = review.rows.filter((row) => row.include).map((row) => ({ ...row, errors: row.errors.filter((error) => {
    if (dateResolution.issue && error.startsWith('A valid production date')) return false;
    if (pendingShifts.some((shift) => shift.key === row.cell?.shiftKey) && !row.shiftOverride && error.startsWith('Map this activity')) return false;
    if (codePendingIds.has(row.id) && error.startsWith('Choose a valid full-stock-code')) return false;
    if ((codePendingIds.has(row.id) || quantityPendingIds.has(row.id)) && (/^Confirm quantity meaning|^The converted quantity|^Explain the shorthand/.test(error))) return false;
    return true;
  }) })).filter((row) => row.errors.length);
  const notes = review.rows.filter((row) => row.kind === 'Remark');
  const unsupported = review.rows.filter((row) => !row.cell?.machine || row.kind === 'Unresolved');
  const duplicates = review.rows.filter((row) => duplicateRows.includes(row.id) || row.errors.some((error) => /duplicate|already imported|Overlapping|Multiple blow-moulding outputs/i.test(error)));
  const questions = { shifts: pendingShifts, overnight: !materialized.nightDateReviewed, codes: [...codeQuestions.values()], quantities: [...quantityQuestions.values()] };
  const pendingCount = questions.shifts.length + Number(questions.overnight) + questions.codes.length + questions.quantities.length;
  const key = JSON.stringify({ review: review.key, profile: approved });
  return { key, profile: approved, draft: materialized, review, dateResolution, questions, pendingCount, exceptions, notes, unsupported, duplicates, canImport: review.canImport && !dateResolution.issue && !pendingCount };
}
