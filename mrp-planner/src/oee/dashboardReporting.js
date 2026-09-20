import { getEffectivePlanQty, getOriginalPlanQty } from '../planning/planQuantities.js';
import { entryProductionLine } from '../production/productionLines.js';
import { shiftMinutes, deriveOeeRun } from './deriveOee.js';

const numeric = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const slotKey = (entry) => [entry.day, entry.machine, entry.shift].join('|');
const average = (rows, key) => {
  const values = rows.map((row) => row[key]).filter((value) => Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
};
const sum = (rows, key) => rows.reduce((total, row) => total + (numeric(row[key]) ?? 0), 0);

function engineInput(entry, actual, settings, slotEntries) {
  const legacy = actual?.oee ?? {};
  const saved = actual?.oeeInput ?? {};
  const events = Array.isArray(saved.lossEvents) ? saved.lossEvents : [];
  const multiple = slotEntries.length > 1;
  const configuredTime = shiftMinutes(settings?.[entryProductionLine(entry)]?.[entry.shift]);
  return {
    planningEntryId: entry.id,
    date: entry.day,
    productionLine: entryProductionLine(entry),
    machine: entry.machine,
    shift: entry.shift,
    process: entry.process ?? entry.processCode ?? entryProductionLine(entry),
    stockCode: entry.partNumber,
    variant: entry.variant,
    suffix: entry.suffix,
    plan: getOriginalPlanQty(entry),
    effectivePlan: getEffectivePlanQty(entry),
    settings,
    plannedTimeMinutes: saved.plannedTimeMinutes ?? saved.plannedTime ?? (multiple ? null : configuredTime),
    plannedBreakMinutes: saved.plannedBreakMinutes ?? (events.length ? null : legacy.plannedBreaks),
    totalDowntimeMinutes: saved.totalDowntimeMinutes ?? null,
    runTimeMinutes: saved.runTimeMinutes ?? (events.length ? null : legacy.runTime),
    totalProduced: actual?.actualMouldQty,
    goodParts: saved.goodParts ?? legacy.goodParts,
    scrapParts: saved.scrapParts,
    noTubsNoStillagesMinutes: saved.noTubsNoStillagesMinutes ?? (events.length ? null : legacy.noTubs),
    lossEvents: events,
    strategy: saved.strategy ?? entry.oeeStrategy ?? null,
  };
}

export function deriveDashboardRows(planningWeeks = {}, actuals = [], settings = {}, productionLine) {
  const plans = [...new Map(Object.values(planningWeeks).flatMap((week) => week.entries ?? []).filter((entry) => entryProductionLine(entry) === productionLine && entry.status !== 'OFF').map((entry) => [entry.id, entry])).values()];
  const actualMap = new Map(actuals.map((actual) => [actual.planningEntryId, actual]));
  const slots = new Map();
  plans.forEach((entry) => slots.set(slotKey(entry), [...(slots.get(slotKey(entry)) ?? []), entry]));
  return plans.map((entry) => {
    const actual = actualMap.get(entry.id) ?? null;
    const result = deriveOeeRun(engineInput(entry, actual, settings, slots.get(slotKey(entry))));
    return {
      ...result,
      id: entry.id,
      actualId: actual?.id ?? null,
      date: entry.day,
      productionLine,
      machine: entry.machine,
      shift: entry.shift,
      process: entry.process ?? entry.processCode ?? productionLine,
      product: entry.partNumber,
      suffix: entry.suffix ?? '',
      plan: getOriginalPlanQty(entry),
      effectivePlan: getEffectivePlanQty(entry),
      revisedPlan: result.revisedPlanQty,
      target: result.targetQty,
      actual: result.totalProduced,
      good: result.goodParts,
      scrap: result.scrapParts,
      plannedTime: result.plannedTimeMinutes,
      plannedBreaks: result.plannedBreakMinutes,
      downtime: result.totalDowntimeMinutes,
      runTime: result.runTimeMinutes,
      complete: result.status === 'COMPLETE',
      slot: slotKey(entry),
    };
  });
}

export function filterDashboardRows(rows, filters = {}) {
  const product = String(filters.product ?? '').trim().toLowerCase();
  return rows.filter((row) => (!filters.startDate || row.date >= filters.startDate)
    && (!filters.endDate || row.date <= filters.endDate)
    && (!filters.productionLine || row.productionLine === filters.productionLine)
    && (!filters.machine || row.machine === filters.machine)
    && (!filters.shift || row.shift === filters.shift)
    && (!filters.process || row.process === filters.process)
    && (!filters.suffix || row.suffix === filters.suffix)
    && (!filters.status || row.status === filters.status)
    && (!product || [row.product, row.stockCode].some((value) => String(value ?? '').toLowerCase().includes(product))));
}

export function summarizeOeeRows(rows = []) {
  const complete = rows.filter((row) => row.status === 'COMPLETE' || row.complete);
  const percentages = ['availability', 'performance', 'productivity', 'quality', 'internalOee', 'externalOee'];
  const quantities = ['plan', 'effectivePlan', 'revisedPlan', 'target', 'actual', 'good', 'scrap', 'plannedTime', 'plannedBreaks', 'downtime', 'runTime'];
  return {
    count: complete.length,
    completeCount: complete.length,
    incompleteCount: rows.filter((row) => row.status === 'INCOMPLETE' || (!row.status && !row.complete)).length,
    pendingCount: rows.filter((row) => row.status === 'PENDING').length,
    ...Object.fromEntries(quantities.map((key) => [key, sum(complete, key)])),
    ...Object.fromEntries(percentages.map((key) => [key, average(complete, key)])),
  };
}

export function groupOeeRows(rows = [], key) {
  return [...new Set(rows.map((row) => row[key]).filter((value) => value !== null && value !== undefined))].sort().map((label) => ({ label, ...summarizeOeeRows(rows.filter((row) => row[key] === label)) }));
}

export function deriveOeeMtd(rows = [], reportingDate, filters = {}) {
  if (!reportingDate) return summarizeOeeRows([]);
  const monthStart = `${reportingDate.slice(0, 7)}-01`;
  return summarizeOeeRows(filterDashboardRows(rows, { ...filters, startDate: monthStart, endDate: reportingDate }));
}

export function deriveDowntimeByCategory(rows = []) {
  const totals = new Map();
  rows.forEach((row) => (row.lossEvents ?? []).forEach((event) => {
    if (event.lossType !== 'DOWNTIME') return;
    const label = event.categoryName || event.semanticKey || event.categoryId || 'Uncategorised downtime';
    totals.set(label, (totals.get(label) ?? 0) + Math.max(0, numeric(event.durationMinutes) ?? 0));
  }));
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([label, downtime]) => ({ label, downtime, count: 1 }));
}
