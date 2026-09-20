import { getEffectivePlanQty } from '../planning/planQuantities.js';
import { entryProductionLine } from '../production/productionLines.js';
import { getParentPair } from '../planning/blowMouldingParentPairs.js';
import { SHIFT_CONFIG } from '../planning/shiftConfig.js';

export const numberOrNull = value => value === null || value === undefined || (typeof value === 'string' && value.trim() === '') || !Number.isFinite(Number(value)) ? null : Number(value);
const safe = value => Number.isFinite(value) ? value : 0;
const ratio = (a, b) => a === null || b === null || b === 0 ? 0 : safe(a / b);
const netTime = (time, breaks) => numberOrNull(time) === null || numberOrNull(breaks) === null ? null : Number(time) - Number(breaks);
const toFiniteNumber = (value, fallback = null) => numberOrNull(value) ?? fallback;
const createIssueSet = (issues = []) => [...new Set(issues.filter(Boolean))];

function safeDivide(numerator, denominator) {
  const left = toFiniteNumber(numerator, null);
  const right = toFiniteNumber(denominator, null);
  if (left === null || right === null) return null;
  if (right === 0) return left === 0 ? 0 : null;
  return left / right;
}

function resolveSpecialStrategy(settings = {}, explicitStrategy = null) {
  const rules = settings?.specialRules ?? {};
  const value = explicitStrategy || (rules.STANDARD_NICT ? 'STANDARD_NICT' : rules.CE_AGGREGATED ? 'CE_AGGREGATED' : rules.THERMO_ASSEMBLY_LINKED ? 'THERMO_ASSEMBLY_LINKED' : 'STANDARD_NICT');

  if (value === 'STANDARD_NICT') return 'STANDARD_NICT';
  if (value === 'CE_AGGREGATED' && rules.CE_AGGREGATED) return 'CE_AGGREGATED';
  if (value === 'THERMO_ASSEMBLY_LINKED' && rules.THERMO_ASSEMBLY_LINKED) return 'THERMO_ASSEMBLY_LINKED';
  return 'UNVERIFIED_SPECIAL_RULE';
}

function normaliseLossEvents(lossEvents = []) {
  if (!Array.isArray(lossEvents)) return [];
  return lossEvents.map((event) => ({
    ...event,
    durationMinutes: toFiniteNumber(event?.durationMinutes ?? event?.minutes ?? 0, 0),
    lossType: event?.lossType ?? event?.category?.lossType ?? '',
    semanticKey: event?.semanticKey ?? event?.category?.semanticKey ?? null,
    semanticCategory: event?.semanticKey ?? event?.semanticCategory ?? event?.category?.semanticKey ?? event?.category?.semanticCategory ?? event?.category?.id ?? null,
  }));
}

function resolveShiftBreakMinutes(settings = {}, lineName, shiftName) {
  const lineConfig = settings?.[lineName] ?? {};
  const shiftConfig = lineConfig[shiftName] ?? {};
  const value = toFiniteNumber(shiftConfig.breaks ?? shiftConfig.plannedBreakMinutes ?? shiftConfig.breakMinutes, null);
  return value === null ? toFiniteNumber(settings?.general?.defaultBreakMinutes, null) : value;
}

function resolveCycleTimeConfig(settings = {}, lookup = {}) {
  const rows = Array.isArray(settings?.cycleTimes) ? settings.cycleTimes : [];
  const candidates = rows.filter((row) => {
    if (row?.active === false) return false;
    if (lookup.stockCode && row.stockCode && String(row.stockCode).trim() !== String(lookup.stockCode).trim()) return false;
    if (lookup.variant && row.variant && String(row.variant).trim() !== String(lookup.variant).trim()) return false;
    if (lookup.suffix && row.suffix && String(row.suffix).trim() !== String(lookup.suffix).trim()) return false;
    if (lookup.process && row.process && String(row.process).trim() !== String(lookup.process).trim()) return false;
    return true;
  });

  const match = candidates[0] ?? null;
  if (!match) return { config: null, issue: 'MISSING_NICT' };

  const nictMethod = lookup.nictSource || match.nictSource || 'NICT_FORMING';
  const nictSeconds =
    nictMethod === 'NICT_ROBOT'
      ? toFiniteNumber(match.nictRobotSeconds ?? match.nictSeconds, null)
      : toFiniteNumber(match.nictFormingSeconds ?? match.nictSeconds, null);

  if (nictSeconds === null || nictSeconds <= 0) return { config: match, issue: 'MISSING_NICT' };
  return { config: match, issue: null, nictSeconds, nictSource: nictMethod };
}

export function derivePlannedBreakMinutes(input = {}) {
  const events = normaliseLossEvents(input.lossEvents ?? input.events ?? []);
  const plannedLossMinutes = events
    .filter((event) => event.lossType === 'PLANNED_LOSS' || event.semanticCategory === 'PLANNED_LOSS')
    .reduce((sum, event) => sum + Math.max(0, event.durationMinutes), 0);

  if (plannedLossMinutes > 0) return plannedLossMinutes;

  const explicitBreaks = toFiniteNumber(input.plannedBreakMinutes ?? input.plannedBreaks ?? input.breakMinutes, null);
  if (explicitBreaks !== null) return explicitBreaks;

  const shiftBreaks = resolveShiftBreakMinutes(input.settings ?? {}, input.productionLine, input.shift);
  return shiftBreaks !== null ? shiftBreaks : 0;
}

export function deriveTotalDowntimeMinutes(input = {}) {
  const events = normaliseLossEvents(input.lossEvents ?? input.events ?? []);
  const downtimeMinutes = events
    .filter((event) => event.lossType === 'DOWNTIME' || event.semanticCategory === 'DOWNTIME')
    .reduce((sum, event) => sum + Math.max(0, event.durationMinutes), 0);

  if (downtimeMinutes > 0) return downtimeMinutes;
  return toFiniteNumber(input.totalDowntimeMinutes ?? input.totalDowntime ?? null, 0);
}

export function deriveRunTimeMinutes(input = {}) {
  const plannedTime = toFiniteNumber(input.plannedTimeMinutes ?? input.plannedTime ?? null, null);
  const plannedBreaks = derivePlannedBreakMinutes(input);
  const totalDowntimeMinutes = deriveTotalDowntimeMinutes(input);
  const explicitRunTime = toFiniteNumber(input.runTimeMinutes ?? input.runTime ?? null, null);

  if (explicitRunTime !== null) return explicitRunTime;
  if (plannedTime === null) return null;
  return Math.max(0, plannedTime - plannedBreaks - totalDowntimeMinutes);
}

export function deriveCycleTimeMinutes(input = {}) {
  const cycle = resolveCycleTimeConfig(input.settings ?? {}, {
    stockCode: input.stockCode ?? input.product ?? input.itemCode,
    variant: input.variant,
    suffix: input.suffix,
    process: input.process ?? input.productionLine,
    nictSource: input.nictSource,
  });

  if (cycle.issue || cycle.nictSeconds === undefined || cycle.nictSeconds === null || cycle.nictSeconds <= 0) return { nictSeconds: null, cycleTimeMinutes: null, nictSource: null, config: cycle.config, issue: cycle.issue || 'MISSING_NICT' };
  return { nictSeconds: cycle.nictSeconds, cycleTimeMinutes: cycle.nictSeconds / 60, nictSource: cycle.nictSource, config: cycle.config, issue: null };
}

export function deriveRevisedPlanQty(input = {}) {
  const runTime = deriveRunTimeMinutes(input);
  const totalDowntimeMinutes = deriveTotalDowntimeMinutes(input);
  const cycle = deriveCycleTimeMinutes(input);
  if (runTime === null || cycle.cycleTimeMinutes === null || cycle.cycleTimeMinutes <= 0 || cycle.issue) return null;
  const availableTime = runTime + totalDowntimeMinutes;
  return Math.ceil(availableTime / cycle.cycleTimeMinutes);
}

export function deriveTargetQty(input = {}) {
  const runTime = deriveRunTimeMinutes(input);
  const cycle = deriveCycleTimeMinutes(input);
  if (runTime === null || cycle.cycleTimeMinutes === null || cycle.cycleTimeMinutes <= 0 || cycle.issue) return null;
  return runTime / cycle.cycleTimeMinutes;
}

export function deriveAvailability(input = {}) {
  const plannedTime = toFiniteNumber(input.plannedTimeMinutes ?? input.plannedTime ?? null, null);
  const plannedBreaks = derivePlannedBreakMinutes(input);
  const runTime = deriveRunTimeMinutes(input);
  if (plannedTime === null || runTime === null) return null;
  const denominator = plannedTime - plannedBreaks;
  if (denominator <= 0) return null;
  return safeDivide(runTime, denominator);
}

export function derivePerformance(input = {}) {
  const totalProduced = toFiniteNumber(input.totalProduced ?? input.actualMouldQty ?? null, null);
  const target = deriveTargetQty(input);
  if (totalProduced === null || target === null) return null;
  if (target === 0) return totalProduced === 0 ? 0 : null;
  return safeDivide(totalProduced, target);
}

export function deriveQuality(input = {}) {
  const totalProduced = toFiniteNumber(input.totalProduced ?? input.actualMouldQty ?? null, null);
  const goodParts = toFiniteNumber(input.goodParts ?? null, null);
  if (totalProduced === null) return null;
  if (goodParts === null && input.scrapParts !== null) {
    const scrapParts = toFiniteNumber(input.scrapParts, 0);
    if (totalProduced >= scrapParts) return safeDivide(totalProduced - scrapParts, totalProduced);
  }
  if (goodParts === null) return null;
  if (totalProduced === 0) return goodParts === 0 ? 0 : null;
  return safeDivide(goodParts, totalProduced);
}

export function deriveProductivity(input = {}) {
  const plannedTime = toFiniteNumber(input.plannedTimeMinutes ?? input.plannedTime ?? null, null);
  const plannedBreaks = derivePlannedBreakMinutes(input);
  const runTime = deriveRunTimeMinutes(input);
  const noTubs = toFiniteNumber(input.noTubsNoStillagesMinutes ?? input.noTubs ?? 0, 0);
  if (plannedTime === null || runTime === null) return null;
  const denominator = plannedTime - plannedBreaks;
  if (denominator <= 0) return null;
  return safeDivide(runTime + noTubs, denominator);
}

export function deriveExternalOee(input = {}) {
  const availability = deriveAvailability(input);
  const quality = deriveQuality(input);
  const performance = derivePerformance(input);
  if ([availability, quality, performance].some((value) => value === null)) return null;
  return availability * quality * performance;
}

export function deriveInternalOee(input = {}) {
  const productivity = deriveProductivity(input);
  const quality = deriveQuality(input);
  const performance = derivePerformance(input);
  if ([productivity, quality, performance].some((value) => value === null)) return null;
  return productivity * quality * performance;
}

export function deriveOeeRun(input = {}) {
  const settings = input.settings ?? {};
  const strategy = resolveSpecialStrategy(settings, input.strategy ?? null);
  const issues = [];

  const lossEvents = normaliseLossEvents(input.lossEvents ?? []);
  const normalised = { ...input };
  const totalProducedSource = toFiniteNumber(normalised.totalProduced ?? normalised.actualMouldQty ?? null, null);
  const explicitGoodParts = toFiniteNumber(normalised.goodParts ?? normalised.oee?.goodParts ?? null, null);
  const rawScrap = normalised.scrapParts;
  const explicitScrapSupplied = rawScrap !== null && rawScrap !== undefined && !(typeof rawScrap === 'string' && rawScrap.trim() === '');
  const explicitScrap = toFiniteNumber(rawScrap, null);

  if (totalProducedSource === null) {
    issues.push('MISSING_ACTUAL');
  }

  const legacyGoodParts = toFiniteNumber(normalised.oee?.goodParts ?? null, null);
  let goodParts = explicitGoodParts;
  if (goodParts === null && legacyGoodParts !== null && totalProducedSource !== null) {
    goodParts = legacyGoodParts;
  }

  let scrapParts = explicitScrap;
  if (explicitScrapSupplied && explicitScrap === null) {
    issues.push('INVALID_SCRAP');
  }
  if (!explicitScrapSupplied && goodParts !== null && totalProducedSource !== null) {
    const derivedScrap = totalProducedSource - goodParts;
    if (derivedScrap >= 0 && derivedScrap <= totalProducedSource) {
      scrapParts = derivedScrap;
    }
  }

  if (!explicitScrapSupplied && goodParts === null && totalProducedSource !== null && scrapParts !== null) {
    goodParts = totalProducedSource - scrapParts;
  }

  if (goodParts === null && totalProducedSource !== null && scrapParts === null) {
    issues.push('MISSING_QUALITY_INPUT');
  }

  if (totalProducedSource !== null && scrapParts !== null && scrapParts < 0) {
    issues.push('SCRAP_EXCEEDS_TOTAL');
  }
  if (totalProducedSource !== null && scrapParts !== null && scrapParts > totalProducedSource) {
    issues.push('SCRAP_EXCEEDS_TOTAL');
  }
  if (goodParts !== null && totalProducedSource !== null && goodParts > totalProducedSource) {
    issues.push('GOOD_PARTS_EXCEED_TOTAL');
  }

  const plannedTimeMinutes = toFiniteNumber(normalised.plannedTimeMinutes ?? normalised.plannedTime ?? null, null);
  const plannedBreakMinutes = derivePlannedBreakMinutes({ ...normalised, lossEvents });
  const totalDowntimeMinutes = deriveTotalDowntimeMinutes({ ...normalised, lossEvents });
  const runTimeMinutes = deriveRunTimeMinutes({ ...normalised, plannedBreakMinutes, totalDowntimeMinutes, lossEvents });

  if (plannedTimeMinutes === null) {
    issues.push('MISSING_PLANNED_TIME');
  }

  if (plannedTimeMinutes !== null && plannedBreakMinutes + totalDowntimeMinutes > plannedTimeMinutes) {
    issues.push('INVALID_TIME_ALLOCATION');
  }

  if (runTimeMinutes !== null && runTimeMinutes < 0) {
    issues.push('INVALID_TIME_ALLOCATION');
  }

  const cycle = deriveCycleTimeMinutes({ ...normalised, settings, lossEvents });
  if (cycle.issue) {
    issues.push(cycle.issue);
  }

  const noTubsNoStillagesMinutes = toFiniteNumber(
    normalised.noTubsNoStillagesMinutes ?? normalised.noTubs ??
    lossEvents.filter((event) => event.semanticCategory === 'NO_TUBS_NO_STILLAGES' || event.lossType === 'NO_TUBS_NO_STILLAGES')
      .reduce((sum, event) => sum + Math.max(0, event.durationMinutes), 0),
    0,
  );

  const revisedPlanQty = cycle.issue ? null : deriveRevisedPlanQty({ ...normalised, plannedBreakMinutes, totalDowntimeMinutes, runTimeMinutes, settings, lossEvents });
  const targetQty = cycle.issue ? null : deriveTargetQty({ ...normalised, plannedBreakMinutes, totalDowntimeMinutes, runTimeMinutes, settings, lossEvents });
  const availability = plannedTimeMinutes === null || runTimeMinutes === null ? null : deriveAvailability({ ...normalised, plannedTimeMinutes, plannedBreakMinutes, runTimeMinutes, settings, lossEvents });
  const performance = totalProducedSource === null || targetQty === null ? null : derivePerformance({ ...normalised, totalProduced: totalProducedSource, targetQty, settings, lossEvents, plannedTimeMinutes, plannedBreakMinutes, runTimeMinutes });
  const quality = totalProducedSource === null || goodParts === null ? null : deriveQuality({ ...normalised, totalProduced: totalProducedSource, goodParts, scrapParts, settings, lossEvents });
  const productivity = plannedTimeMinutes === null || runTimeMinutes === null ? null : deriveProductivity({ ...normalised, plannedTimeMinutes, plannedBreakMinutes, runTimeMinutes, noTubsNoStillagesMinutes, settings, lossEvents });
  const externalOee = availability === null || quality === null || performance === null ? null : deriveExternalOee({ ...normalised, availability, quality, performance, settings, lossEvents });
  const internalOee = productivity === null || quality === null || performance === null ? null : deriveInternalOee({ ...normalised, productivity, quality, performance, settings, lossEvents });

  if (strategy === 'UNVERIFIED_SPECIAL_RULE') {
    issues.push('UNVERIFIED_SPECIAL_RULE');
  }

  if (strategy === 'STANDARD_NICT' && (cycle.issue || cycle.nictSeconds === undefined || cycle.nictSeconds === null)) {
    issues.push('MISSING_NICT');
  }

  const finalIssues = createIssueSet(issues);
  const hasOperationalData = [totalProducedSource, goodParts, scrapParts, runTimeMinutes, plannedTimeMinutes, plannedBreakMinutes, totalDowntimeMinutes, noTubsNoStillagesMinutes].some((value) => value !== null && value !== undefined);
  const status = !hasOperationalData ? 'PENDING' : finalIssues.length > 0 ? 'INCOMPLETE' : 'COMPLETE';
  const shiftConfig = settings?.[normalised.productionLine]?.[normalised.shift] ?? {};

  return {
    planningEntryId: normalised.planningEntryId ?? null,
    date: normalised.date ?? null,
    productionLine: normalised.productionLine ?? null,
    process: normalised.process ?? normalised.productionLine ?? null,
    stockCode: normalised.stockCode ?? normalised.product ?? null,
    variant: normalised.variant ?? null,
    suffix: normalised.suffix ?? null,
    strategy,
    idealOee: settings?.general?.idealOee ?? 0.75,
    plannedTimeMinutes,
    plannedBreakMinutes,
    totalDowntimeMinutes,
    runTimeMinutes,
    noTubsNoStillagesMinutes,
    totalProduced: totalProducedSource,
    goodParts,
    scrapParts,
    nictSeconds: cycle.nictSeconds ?? null,
    nictSource: cycle.nictSource ?? null,
    cycleTimeMinutes: cycle.cycleTimeMinutes ?? null,
    revisedPlanQty,
    targetQty,
    availability,
    performance,
    productivity,
    quality,
    externalOee,
    internalOee,
    status,
    issues: finalIssues,
    lossEvents,
    configurationSnapshot: {
      nictSeconds: cycle.nictSeconds ?? null,
      nictSource: cycle.nictSource ?? null,
      nictFormingSeconds: cycle.config?.nictFormingSeconds ?? cycle.config?.nictSeconds ?? null,
      nictRobotSeconds: cycle.config?.nictRobotSeconds ?? cycle.config?.nictSeconds ?? null,
      jpd: cycle.config?.jpd ?? null,
      cycleTimeMinutes: cycle.cycleTimeMinutes ?? null,
      plannedTimeRule: plannedTimeMinutes !== null ? 'configured-shift-or-input' : 'missing',
      shiftRule: normalised.shift ?? null,
      shiftStart: shiftConfig.start ?? null,
      shiftEnd: shiftConfig.end ?? null,
      plannedBreakSource: lossEvents.length ? 'loss-events' : 'legacy-or-shift-settings',
      idealOee: settings?.general?.idealOee ?? 0.75,
      strategy,
      calculationVersion: 'excel-style-v1',
    },
    valid: finalIssues.length === 0,
  };
}
export const calculateAvailability = (runTime, plannedTime, plannedBreaks) => ratio(numberOrNull(runTime), netTime(plannedTime, plannedBreaks));
export const calculateQuality = (goodParts, totalProduced) => ratio(numberOrNull(goodParts), numberOrNull(totalProduced));
export const calculatePerformance = (totalProduced, target) => ratio(numberOrNull(totalProduced), numberOrNull(target));
export const calculateProductivity = (runTime, noTubs, plannedTime, plannedBreaks) => ratio(numberOrNull(runTime) === null || numberOrNull(noTubs) === null ? null : Number(runTime) + Number(noTubs), netTime(plannedTime, plannedBreaks));
const multiply = (...values) => values.some(value => numberOrNull(value) === null) ? 0 : safe(values.reduce((product, value) => product * Number(value), 1));
export const calculateExternalOee = (availability, quality, performance) => multiply(availability, quality, performance);
export function calculateInternalOee(productivity, quality, performance, averageQuality, averagePerformance) {
  const result = multiply(productivity, quality, performance);
  return result !== 0 ? result : multiply(productivity, averageQuality, averagePerformance);
}
export function shiftMinutes(config) {
  if (!/^\d{2}:\d{2}$/.test(config?.start ?? '') || !/^\d{2}:\d{2}$/.test(config?.end ?? '')) return null;
  const parse = value => { const [h, m] = value.split(':').map(Number); return h < 24 && m < 60 ? h * 60 + m : null; };
  const start = parse(config.start), end = parse(config.end);
  if (start === null || end === null || start === end) return null;
  return (end - start + 1440) % 1440;
}
export function deriveOeeRecord(input, averages = { quality: 0, performance: 0 }) {
  const availability = calculateAvailability(input.runTime, input.plannedTime, input.plannedBreaks);
  const quality = calculateQuality(input.goodParts, input.totalProduced);
  const performance = calculatePerformance(input.totalProduced, input.target);
  const productivity = calculateProductivity(input.runTime, input.noTubs, input.plannedTime, input.plannedBreaks);
  return { ...input, availability, quality, performance, productivity,
    externalOee: calculateExternalOee(availability, quality, performance),
    internalOee: calculateInternalOee(productivity, quality, performance, averages.quality, averages.performance) };
}
export function buildOeeRecords(plans, actuals, settings, productionLine) {
  const actualMap = new Map(actuals.map(actual => [actual.planningEntryId, actual]));
  const active = plans.filter(plan => entryProductionLine(plan) === productionLine && plan.status !== 'OFF');
  const slotKey = plan => [plan.day, plan.machine, plan.shift].join('|');
  const slots = new Map();
  for (const plan of active) slots.set(slotKey(plan), [...(slots.get(slotKey(plan)) ?? []), plan]);
  const records = active.map(plan => {
    const actual = actualMap.get(plan.id), oee = actual?.oee ?? {}, config = settings?.[productionLine]?.[plan.shift] ?? SHIFT_CONFIG[plan.shift];
    const multiple = slots.get(slotKey(plan)).length > 1;
    const plannedTime = multiple ? numberOrNull(oee.plannedTime) : shiftMinutes(config);
    const plannedBreaks = multiple ? numberOrNull(oee.plannedBreaks) : numberOrNull(config?.breaks);
    const input = { id: plan.id, actualId: actual?.id, date: plan.day, shift: plan.shift, machine: plan.machine, product: plan.partNumber,
      productionLine, target: getEffectivePlanQty(plan), totalProduced: numberOrNull(actual?.actualMouldQty), goodParts: numberOrNull(oee.goodParts),
      runTime: numberOrNull(oee.runTime), noTubs: numberOrNull(oee.noTubs), plannedTime, plannedBreaks,
      unit: productionLine === 'thermoforming' ? 'parts' : 'mould sets', pair: getParentPair(plan.partNumber) };
    const issues = ['totalProduced', 'goodParts', 'runTime', 'noTubs', 'plannedTime', 'plannedBreaks'].filter(key => input[key] === null).map(key => `Missing ${key}`);
    if (Object.values(input).some(value => typeof value === 'number' && value < 0)) issues.push('Negative input');
    if (input.goodParts !== null && input.totalProduced !== null && input.goodParts > input.totalProduced) issues.push('Good Parts exceeds Actual');
    if (plannedTime !== null && plannedBreaks !== null && plannedBreaks > plannedTime) issues.push('Breaks exceed planned time');
    return { ...input, issues, complete: issues.length === 0, slot: slotKey(plan) };
  });
  // Multi-run allocations must reconcile to the configured shift before filtering.
  for (const [key, plansInSlot] of slots) {
    if (plansInSlot.length < 2) continue;
    const rows = records.filter(row => row.slot === key), config = settings?.[productionLine]?.[rows[0].shift] ?? SHIFT_CONFIG[rows[0].shift];
    const duration = shiftMinutes(config), breaks = numberOrNull(config?.breaks);
    if (duration === null || breaks === null || rows.some(row => row.plannedTime === null || row.plannedBreaks === null)
      || Math.abs(rows.reduce((sum, row) => sum + row.plannedTime, 0) - duration) > 0.001
      || Math.abs(rows.reduce((sum, row) => sum + row.plannedBreaks, 0) - breaks) > 0.001) {
      rows.forEach(row => { row.issues.push('Allocate shift time and breaks across all runs to match settings'); row.complete = false; });
    }
  }
  return records;
}
export function filterOeeRecords(rows, filters) {
  const query = (filters.product ?? '').trim().toLowerCase();
  return rows.filter(row => row.date >= filters.startDate && row.date <= filters.endDate
    && (filters.machine === '' || row.machine === filters.machine) && (filters.shift === '' || row.shift === filters.shift)
    && [row.product, row.pair?.displayCode, ...(row.pair?.parents ?? [])].some(code => (code ?? '').toLowerCase().includes(query)));
}
export function oeeAverages(rows) {
  const complete = rows.filter(row => row.complete).map(row => deriveOeeRecord(row));
  return { quality: ratio(complete.reduce((sum, row) => sum + row.quality, 0), complete.length), performance: ratio(complete.reduce((sum, row) => sum + row.performance, 0), complete.length) };
}
export function deriveOeeSummary(rows, averages = oeeAverages(rows)) {
  const complete = rows.filter(row => row.complete);
  const totals = Object.fromEntries(['runTime', 'noTubs', 'plannedTime', 'plannedBreaks', 'goodParts', 'totalProduced', 'target'].map(key => [key, complete.reduce((sum, row) => sum + row[key], 0)]));
  return { ...deriveOeeRecord(totals, averages), count: complete.length, incompleteCount: rows.length - complete.length };
}
export function groupOee(rows, key, averages) {
  return [...new Set(rows.map(row => row[key]))].sort().map(label => ({ label, ...deriveOeeSummary(rows.filter(row => row[key] === label), averages) }));
}
