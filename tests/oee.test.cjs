const test = require('node:test');
const assert = require('node:assert/strict');
const derive = import('../mrp-planner/src/oee/deriveOee.js');
const fgModule = import('../mrp-planner/src/oee/finishedGoods.js');
const settings = { blowMoulding: { 'SHIFT 01': { start: '06:00', end: '15:00', breaks: 30 } } };
const plan = { id: 'p1', day: '2026-09-07', shift: 'SHIFT 01', machine: 'BM01', partNumber: 'N1WB_CAA_PAIR', buildQty: 100 };
const actual = { id: 'a1', planningEntryId: 'p1', actualMouldQty: 90, oee: { runTime: 400, noTubs: 20, goodParts: 80 } };
const filters = { startDate: '2026-09-07', endDate: '2026-09-07', machine: '', shift: '', product: '' };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
const standardNictWorkbookRows = require('./fixtures/oee-standard-nict-workbook.json');

test('Excel formulas, normal Internal OEE and exact zero fallback', async () => {
  const d = await derive;
  close(d.calculateAvailability(420, 480, 30), 420 / 450);
  close(d.calculateQuality(95, 100), 0.95);
  close(d.calculatePerformance(90, 100), 0.9);
  close(d.calculateProductivity(400, 20, 480, 30), 420 / 450);
  close(d.calculateExternalOee(0.8, 0.95, 0.9), 0.8 * 0.95 * 0.9);
  close(d.calculateInternalOee(0.8, 0.95, 0.9, 0.5, 0.5), 0.8 * 0.95 * 0.9);
  close(d.calculateInternalOee(0.8, 0, 0.9, 0.95, 0.9), 0.8 * 0.95 * 0.9);
  assert.equal(d.calculateInternalOee(0, 0, 0, 0.9, 0.9), 0);
  close(d.calculateInternalOee(0.8, 1e-10, 1, 0.9, 0.9) / 0.8e-10, 1);
});

test('division by zero, missing and non-finite inputs, explicit zero and decimals', async () => {
  const d = await derive;
  assert.equal(d.calculateAvailability(420, 30, 30), 0);
  assert.equal(d.calculateProductivity(400, 20, 30, 30), 0);
  assert.equal(d.calculateQuality(95, 0), 0);
  assert.equal(d.calculatePerformance(90, 0), 0);
  for (const value of [null, undefined, '', NaN, Infinity]) {
    assert.equal(d.numberOrNull(value), null);
    assert.equal(d.calculateAvailability(value, 480, 30), 0);
    assert.equal(d.calculateQuality(value, 100), 0);
    assert.equal(d.calculatePerformance(90, value), 0);
    assert.equal(d.calculateProductivity(400, value, 480, 30), 0);
  }
  assert.equal(d.numberOrNull(0), 0);
  close(d.calculateQuality(9.5, 10), 0.95);
  assert.equal(d.calculateAvailability(600, 480, 0), 1.25);
});

test('configured overnight shift and breaks; adjusted plan including adjusted zero', async () => {
  const d = await derive;
  assert.equal(d.shiftMinutes({ start: '06:00', end: '15:00' }), 540);
  assert.equal(d.shiftMinutes({ start: '15:00', end: '22:00' }), 420);
  assert.equal(d.shiftMinutes({ start: '22:00', end: '06:00' }), 480);
  assert.equal(d.shiftMinutes({ start: '24:00', end: '06:00' }), null);
  const rows = d.buildOeeRecords([{ ...plan, adjustedPlanQty: 80 }], [actual], settings, 'blowMoulding');
  assert.equal(rows[0].target, 80);
  assert.equal(rows[0].plannedTime, 540);
  assert.equal(rows[0].complete, true);
  assert.equal(d.deriveOeeSummary(rows).performance, 90 / 80);
  assert.equal(d.buildOeeRecords([{ ...plan, adjustedPlanQty: 0 }], [actual], settings, 'blowMoulding')[0].target, 0);
  const missing = d.buildOeeRecords([plan], [actual], {}, 'blowMoulding');
  assert.equal(missing[0].plannedBreaks, null);
  assert.equal(missing[0].complete, false);
  const blank = d.buildOeeRecords([plan], [{ ...actual, actualMouldQty: '' }], settings, 'blowMoulding');
  assert.equal(blank[0].totalProduced, null);
  const zero = d.buildOeeRecords([plan], [{ ...actual, actualMouldQty: 0, oee: { runTime: 0, noTubs: 0, goodParts: 0 } }], settings, 'blowMoulding');
  assert.equal(zero[0].complete, true);
  assert.equal(d.deriveOeeSummary(zero).count, 1);
});

test('multiple runs do not duplicate shift time; invalid allocations remain incomplete before filtering', async () => {
  const d = await derive, p2 = { ...plan, id: 'p2' }, a2 = { ...actual, id: 'a2', planningEntryId: 'p2' };
  assert.ok(d.buildOeeRecords([plan, p2], [actual, a2], settings, 'blowMoulding').every(row => !row.complete));
  const allocated = [actual, a2].map(row => ({ ...row, oee: { ...row.oee, plannedTime: 270, plannedBreaks: 15 } }));
  const rows = d.buildOeeRecords([plan, p2], allocated, settings, 'blowMoulding');
  assert.ok(rows.every(row => row.complete));
  assert.equal(d.deriveOeeSummary(rows).plannedTime, 540);
  assert.equal(d.deriveOeeSummary(rows).plannedBreaks, 30);
  allocated[1].oee.plannedTime = 300;
  assert.ok(d.buildOeeRecords([plan, p2], allocated, settings, 'blowMoulding').every(row => !row.complete));
});

test('aggregation sums inputs, fallback averages use only filtered complete rows including zeros', async () => {
  const d = await derive;
  const rows = [
    { complete: true, date: filters.startDate, machine: 'BM01', shift: 'SHIFT 01', product: 'A', target: 100, totalProduced: 100, goodParts: 90, runTime: 400, noTubs: 0, plannedTime: 480, plannedBreaks: 30 },
    { complete: true, date: filters.startDate, machine: 'BM02', shift: 'SHIFT 02', product: 'B', target: 10, totalProduced: 0, goodParts: 0, runTime: 100, noTubs: 20, plannedTime: 200, plannedBreaks: 0 },
    { complete: false, date: filters.startDate, machine: 'BM02', shift: 'SHIFT 02', product: 'C' },
  ];
  const av = d.oeeAverages(rows);
  assert.deepEqual(av, { quality: 0.45, performance: 0.5 });
  const summary = d.deriveOeeSummary(rows);
  close(summary.availability, 500 / 650);
  close(summary.performance, 100 / 110);
  close(summary.externalOee, (500 / 650) * 0.9 * (100 / 110));
  assert.equal(summary.incompleteCount, 1);
  const filtered = d.filterOeeRecords(rows, { ...filters, machine: 'BM02', shift: 'SHIFT 02', product: 'B' });
  assert.equal(filtered.length, 1);
  assert.deepEqual(d.oeeAverages(filtered), { quality: 0, performance: 0 });
  close(d.groupOee(rows, 'machine', av)[1].internalOee, (120 / 200) * 0.45 * 0.5);
  assert.equal(d.deriveOeeSummary([]).count, 0);
});

test('FG unavailable, present, paired physical-unit conversion and unsupported machine/shift attribution', async () => {
  const { deriveFinishedGoods } = await fgModule, d = await derive;
  const rows = d.buildOeeRecords([plan], [actual], settings, 'blowMoulding');
  const movements = ['N1WB-16450-CAA', 'N1WB-16451-CAA'].map(stockCode => ({ date: filters.startDate, stockCode, uom: 'EA', quantity: 80, direction: 'Into FG' }));
  assert.equal(deriveFinishedGoods(null, rows, filters, 'blowMoulding').available, false);
  const result = deriveFinishedGoods({ data: movements }, rows, filters, 'blowMoulding');
  assert.equal(result.comparison[0].goodParts, 160);
  assert.equal(result.comparison[0].fgTransferred, 160);
  assert.equal(result.comparison[0].pendingFg, 0);
  assert.match(result.comparison[0].normalization, /× 2/);
  assert.equal(deriveFinishedGoods({ data: movements.slice(0, 1) }, rows, filters, 'blowMoulding').comparison[0].valid, false);
  assert.equal(deriveFinishedGoods({ data: movements.map(row => ({ ...row, uom: 'KG' })) }, rows, filters, 'blowMoulding').comparison[0].valid, false);
  assert.equal(deriveFinishedGoods({ data: movements }, rows, { ...filters, machine: 'BM01' }, 'blowMoulding').available, false);
  assert.equal(deriveFinishedGoods({ data: movements }, rows, { ...filters, shift: 'SHIFT 01' }, 'blowMoulding').available, false);
  const returned = deriveFinishedGoods({ data: [...movements, { ...movements[0], quantity: 5, direction: 'FG to WIP' }] }, rows, filters, 'blowMoulding');
  assert.equal(returned.products[0].returned, 5);
  assert.equal(returned.comparison[0].fgTransferred, 160);
  const tfRows = [{ ...rows[0], product: 'N1WB-E13036-K', pair: null }];
  const tf = deriveFinishedGoods({ data: [{ ...movements[0], stockCode: 'N1WB-E13036-K' }] }, tfRows, filters, 'thermoforming');
  assert.equal(tf.comparison[0].goodParts, 80);
});

test('FG endpoint is SELECT-only, bound dates, JSON on success/errors and no write methods', async () => {
  const db = require('../server/db'), original = db.query, calls = [];
  db.query = async (query, parameters) => { calls.push({ query, parameters }); return [{ stockCode: 'N1WB-16450-CAA', quantity: 80 }]; };
  const server = require('../server/server').listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/syspro/oee/finished-goods`;
  try {
    const response = await fetch(url + '?startDate=2026-09-01&endDate=2026-09-07');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    const payload = await response.json();
    assert.equal(payload.data[0].quantity, 80);
    assert.equal(payload.shiftAllocation, false);
    assert.equal(calls.length, 1);
    assert.ok(!/\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i.test(calls[0].query));
    assert.match(calls[0].query, /m.NewWarehouse='B-FIN01'/);
    assert.match(calls[0].query, /-m.TrnQty AS quantity/);
    assert.equal(calls[0].parameters[0].value.toISOString(), '2026-09-01T00:00:00.000Z');
    for (const query of ['', '?startDate=2026-02-30&endDate=2026-03-01', '?startDate=2025-01-01&endDate=2026-09-07']) assert.equal((await fetch(url + query)).status, 400);
    assert.equal((await fetch(url, { method: 'POST' })).status, 404);
    db.query = async () => { throw new Error('Test offline'); };
    const offline = await fetch(url + '?startDate=2026-09-01&endDate=2026-09-07');
    assert.equal(offline.status, 503);
    assert.equal((await offline.json()).success, false);
  } finally { db.query = original; await new Promise(resolve => server.close(resolve)); }
});

test('OEE settings foundation preserves legacy shift data and default ideal OEE', async () => {
  const settingsModule = await import('../mrp-planner/src/oee/oeeSettings.js');
  const foundation = settingsModule.buildOeeSettingsFoundation({
    blowMoulding: {
      'SHIFT 01': { start: '06:00', end: '15:00', breaks: 30, plannedTimeMinutes: 540 },
    },
  });

  assert.equal(foundation.general.idealOee, 0.75);
  assert.equal(foundation.blowMoulding['SHIFT 01'].breaks, 30);
  assert.equal(foundation.blowMoulding['SHIFT 01'].plannedTimeMinutes, 540);
  assert.equal(foundation.lossCategories.length, 2);
  assert.equal(foundation.lossCategories[0].lossType, 'PLANNED_LOSS');
  assert.equal(foundation.specialRules.STANDARD_NICT, true);
});

test('OEE loss categories and records preserve planningEntryId and legacy actual.oee compatibility', async () => {
  const settingsModule = await import('../mrp-planner/src/oee/oeeSettings.js');
  const category = settingsModule.createLossCategory({ id: 'planned-bkt', name: 'Break', lossType: 'PLANNED_LOSS' });
  const event = settingsModule.createLossEvent({ planningEntryId: 'p-1', categoryId: category.id, categoryName: category.name, lossType: category.lossType, durationMinutes: 15 });
  const record = settingsModule.createDefaultOeeRecord({ planningEntryId: 'p-1', date: '2026-09-07', productionLine: 'blowMoulding', machine: 'BM01', shift: 'SHIFT 01', product: 'N1WB-16450-CAA', lossEvents: [event] });
  const actual = settingsModule.normalizeLegacyActualOee({ id: 'a-1', planningEntryId: 'p-1', actualMouldQty: 70, oee: { runTime: 360, noTubs: 10, goodParts: 60, plannedTime: 540, plannedBreaks: 30 } });

  assert.equal(category.lossType, 'PLANNED_LOSS');
  assert.equal(event.planningEntryId, 'p-1');
  assert.equal(record.planningEntryId, 'p-1');
  assert.equal(actual.oee.runTime, 360);
  assert.equal(actual.oee.plannedBreaks, 30);
  assert.deepEqual(record.lossEvents[0].categoryName, category.name);
});

test('Excel-style OEE engine resolves NICT, revised plan, target, status and loss events', async () => {
  const d = await derive;
  const settingsWithNict = {
    cycleTimes: [
      { stockCode: 'N1WB-16450-CAA', variant: 'PAIR', suffix: 'A', process: 'blowMoulding', active: true, nictFormingSeconds: 60, nictRobotSeconds: 90 },
    ],
    specialRules: { STANDARD_NICT: true, CE_AGGREGATED: false, THERMO_ASSEMBLY_LINKED: false },
  };

  const result = d.deriveOeeRun({
    planningEntryId: 'p-excel',
    date: '2026-09-07',
    productionLine: 'blowMoulding',
    process: 'blowMoulding',
    stockCode: 'N1WB-16450-CAA',
    variant: 'PAIR',
    suffix: 'A',
    plannedTimeMinutes: 360,
    plannedBreakMinutes: 35,
    totalDowntimeMinutes: 24,
    totalProduced: 42,
    goodParts: 34,
    scrapParts: 8,
    runTimeMinutes: 301,
    noTubsNoStillagesMinutes: 10,
    settings: settingsWithNict,
    lossEvents: [
      { lossType: 'PLANNED_LOSS', durationMinutes: 35 },
      { lossType: 'DOWNTIME', durationMinutes: 24 },
      { semanticCategory: 'NO_TUBS_NO_STILLAGES', durationMinutes: 10 },
    ],
  });

  assert.equal(result.strategy, 'STANDARD_NICT');
  close(result.nictSeconds, 60);
  close(result.cycleTimeMinutes, 1);
  close(result.revisedPlanQty, 325);
  close(result.targetQty, 301 / 1);
  close(result.availability, 301 / (360 - 35));
  close(result.performance, 42 / (301 / 1));
  close(result.quality, 34 / 42);
  close(result.productivity, (301 + 10) / (360 - 35));
  close(result.externalOee, result.availability * result.quality * result.performance);
  close(result.internalOee, result.productivity * result.quality * result.performance);
  assert.equal(result.status, 'COMPLETE');
  assert.deepEqual(result.issues, []);
});

test('STANDARD_NICT reproduces selected MainData Table rows at workbook precision', async () => {
  const d = await derive;

  for (const row of standardNictWorkbookRows) {
    const result = d.deriveOeeRun({
      planningEntryId: `workbook-row-${row.sourceRow}`,
      date: row.date,
      productionLine: row.line,
      process: row.process,
      variant: row.variant,
      suffix: row.suffix,
      plannedTimeMinutes: row.plannedTime,
      plannedBreakMinutes: row.plannedBreaks,
      totalDowntimeMinutes: row.totalDowntime,
      runTimeMinutes: row.runTime,
      totalProduced: row.totalPartsProduced,
      goodParts: row.goodParts,
      scrapParts: row.scrapParts,
      noTubsNoStillagesMinutes: row.noTubsNoStillages,
      nictSource: row.baseline.excelNictSource,
      settings: {
        cycleTimes: [{
          variant: row.variant,
          suffix: row.suffix,
          process: row.process,
          active: true,
          nictFormingSeconds: row.baseline.nictFormingSeconds,
          nictRobotSeconds: row.baseline.nictRobotSeconds,
          jpd: row.baseline.jpd,
        }],
        specialRules: { STANDARD_NICT: true, CE_AGGREGATED: false, THERMO_ASSEMBLY_LINKED: false },
      },
    });

    assert.equal(result.strategy, 'STANDARD_NICT', `MainData Table row ${row.sourceRow}`);
    assert.equal(result.status, 'COMPLETE', `MainData Table row ${row.sourceRow}`);
    assert.equal(result.nictSource, 'NICT_ROBOT', `MainData Table row ${row.sourceRow}`);
    close(result.nictSeconds, row.baseline.nictRobotSeconds);
    close(result.runTimeMinutes, row.runTime);
    close(result.revisedPlanQty, row.revisedPlan);
    close(result.targetQty, row.target);
    close(result.availability, row.availability);
    close(result.performance, row.performance);
    close(result.productivity, row.productivity);
    close(result.quality, row.quality);
    close(result.externalOee, row.externalOeeFormula);
    close(result.internalOee, row.internalOee);
  }
});

test('STANDARD_NICT retains the clean formula result instead of MainData Table X2 manual override', async () => {
  const row = standardNictWorkbookRows.find((candidate) => candidate.sourceRow === 2);
  assert.notEqual(row.externalOeeWorkbookCached, row.externalOeeFormula);
  close(row.externalOeeFormula, row.availability * row.quality * row.performance);
});

test('Excel-style OEE engine reports missing NICT and invalid scrap/time issues without zeroing out', async () => {
  const d = await derive;
  const missingNict = d.deriveOeeRun({
    planningEntryId: 'p-missing',
    productionLine: 'blowMoulding',
    process: 'blowMoulding',
    plannedTimeMinutes: 360,
    plannedBreakMinutes: 30,
    totalDowntimeMinutes: 10,
    totalProduced: 100,
    goodParts: 80,
    scrapParts: 20,
    runTimeMinutes: 320,
    settings: { cycleTimes: [], specialRules: { STANDARD_NICT: true } },
  });

  assert.equal(missingNict.status, 'INCOMPLETE');
  assert.ok(missingNict.issues.includes('MISSING_NICT'));
  assert.equal(missingNict.nictSeconds, null);

  const invalidTime = d.deriveOeeRun({
    planningEntryId: 'p-invalid',
    productionLine: 'blowMoulding',
    process: 'blowMoulding',
    stockCode: 'N1WB-16450-CAA',
    plannedTimeMinutes: 120,
    plannedBreakMinutes: 30,
    totalDowntimeMinutes: 100,
    totalProduced: 100,
    goodParts: 80,
    scrapParts: 121,
    runTimeMinutes: 0,
    settings: { cycleTimes: [{ stockCode: 'N1WB-16450-CAA', active: true, nictFormingSeconds: 120 }], specialRules: { STANDARD_NICT: true } },
  });

  assert.ok(invalidTime.issues.includes('INVALID_TIME_ALLOCATION'));
  assert.ok(invalidTime.issues.includes('SCRAP_EXCEEDS_TOTAL'));
  assert.equal(invalidTime.status, 'INCOMPLETE');
});

test('Excel-style OEE engine preserves legacy goodParts and derives scrapParts compatibly', async () => {
  const d = await derive;
  const legacy = d.deriveOeeRun({
    planningEntryId: 'p-legacy',
    productionLine: 'blowMoulding',
    process: 'blowMoulding',
    stockCode: 'N1WB-16450-CAA',
    plannedTimeMinutes: 480,
    plannedBreakMinutes: 30,
    totalDowntimeMinutes: 10,
    runTimeMinutes: 440,
    totalProduced: 100,
    goodParts: 90,
    settings: { cycleTimes: [{ stockCode: 'N1WB-16450-CAA', active: true, nictFormingSeconds: 120 }], specialRules: { STANDARD_NICT: true } },
  });

  assert.equal(legacy.scrapParts, 10);
  assert.equal(legacy.goodParts, 90);
  assert.equal(legacy.status, 'COMPLETE');
});

test('Excel-style OEE engine supports incremental no-tubs minutes and special rule states', async () => {
  const d = await derive;
  const result = d.deriveOeeRun({
    planningEntryId: 'p-no-tubs',
    productionLine: 'blowMoulding',
    process: 'blowMoulding',
    stockCode: 'N1WB-16450-CAA',
    plannedTimeMinutes: 240,
    plannedBreakMinutes: 10,
    totalDowntimeMinutes: 5,
    totalProduced: 12,
    goodParts: 10,
    scrapParts: 2,
    runTimeMinutes: 225,
    noTubsNoStillagesMinutes: 12,
    settings: { cycleTimes: [{ stockCode: 'N1WB-16450-CAA', active: true, nictFormingSeconds: 60 }], specialRules: { STANDARD_NICT: true } },
    lossEvents: [{ semanticCategory: 'NO_TUBS_NO_STILLAGES', durationMinutes: 12 }],
  });

  assert.equal(result.noTubsNoStillagesMinutes, 12);
  assert.equal(result.status, 'COMPLETE');

  const unverified = d.deriveOeeRun({
    planningEntryId: 'p-special',
    productionLine: 'blowMoulding',
    process: 'blowMoulding',
    stockCode: 'N1WB-16450-CAA',
    plannedTimeMinutes: 240,
    plannedBreakMinutes: 10,
    totalDowntimeMinutes: 5,
    totalProduced: 12,
    goodParts: 10,
    scrapParts: 2,
    runTimeMinutes: 225,
    strategy: 'CE_AGGREGATED',
    settings: { cycleTimes: [{ stockCode: 'N1WB-16450-CAA', active: true, nictFormingSeconds: 60 }], specialRules: { STANDARD_NICT: true, CE_AGGREGATED: false } },
  });

  assert.equal(unverified.strategy, 'UNVERIFIED_SPECIAL_RULE');
  assert.equal(unverified.status, 'INCOMPLETE');
});

test('dashboard reporting filters before Excel-parity aggregation and averages complete row percentages', async () => {
  const reporting = await import('../mrp-planner/src/oee/dashboardReporting.js');
  const rows = [
    { planningEntryId: 'p-1', date: '2026-09-01', machine: 'BM01', status: 'COMPLETE', plan: 100, effectivePlan: 90, revisedPlan: 80, target: 70, actual: 60, good: 0, scrap: 60, plannedTime: 100, plannedBreaks: 10, downtime: 5, runTime: 85, availability: 0, performance: 0.8, productivity: 0.7, quality: 0, internalOee: 0, externalOee: 0, process: 'STANDARD_NICT', suffix: 'A', product: 'A' },
    { planningEntryId: 'p-2', date: '2026-09-02', machine: 'BM01', status: 'COMPLETE', plan: 20, effectivePlan: 20, revisedPlan: 18, target: 16, actual: 15, good: 10, scrap: 5, plannedTime: 50, plannedBreaks: 5, downtime: 2, runTime: 43, availability: 0.8, performance: 0.6, productivity: 0.5, quality: 2 / 3, internalOee: 0.4, externalOee: 0.32, process: 'STANDARD_NICT', suffix: 'A', product: 'B' },
    { planningEntryId: 'p-3', date: '2026-09-03', machine: 'BM02', status: 'INCOMPLETE', plan: 40, effectivePlan: 40, revisedPlan: null, target: null, actual: 5, good: null, scrap: null, plannedTime: 50, plannedBreaks: 5, downtime: 2, runTime: null, availability: null, performance: null, productivity: null, quality: null, internalOee: null, externalOee: null, process: 'STANDARD_NICT', suffix: 'B', product: 'C' },
    { planningEntryId: 'p-4', date: '2026-09-04', machine: 'BM03', status: 'PENDING', plan: 40, effectivePlan: 40, revisedPlan: null, target: null, actual: null, good: null, scrap: null, plannedTime: null, plannedBreaks: null, downtime: null, runTime: null, process: 'STANDARD_NICT', suffix: 'C', product: 'D' },
  ];
  const selected = reporting.filterDashboardRows(rows, { startDate: '2026-09-01', endDate: '2026-09-02', machine: 'BM01' });
  const summary = reporting.summarizeOeeRows(selected);
  assert.equal(summary.completeCount, 2);
  assert.equal(summary.incompleteCount, 0);
  assert.equal(summary.pendingCount, 0);
  assert.equal(summary.revisedPlan, 98);
  assert.equal(summary.target, 86);
  assert.equal(summary.actual, 75);
  assert.equal(summary.downtime, 7);
  assert.equal(summary.quality, (0 + 2 / 3) / 2);
  assert.equal(summary.externalOee, (0 + 0.32) / 2);
  assert.equal(reporting.summarizeOeeRows(rows).incompleteCount, 1);
  assert.equal(reporting.summarizeOeeRows(rows).pendingCount, 1);
});

test('dashboard reporting derives true month-to-date and downtime by historical category snapshot', async () => {
  const reporting = await import('../mrp-planner/src/oee/dashboardReporting.js');
  const rows = [
    { planningEntryId: 'p-1', date: '2026-09-01', status: 'COMPLETE', plan: 1, lossEvents: [{ lossType: 'DOWNTIME', categoryName: 'Old Machine Fault', durationMinutes: 12 }] },
    { planningEntryId: 'p-2', date: '2026-09-08', status: 'COMPLETE', plan: 2, lossEvents: [{ lossType: 'DOWNTIME', categoryName: 'Old Machine Fault', durationMinutes: 8 }, { lossType: 'DOWNTIME', semanticKey: 'NO_TUBS_NO_STILLAGES', durationMinutes: 4 }] },
    { planningEntryId: 'p-3', date: '2026-08-31', status: 'COMPLETE', plan: 100, lossEvents: [{ lossType: 'DOWNTIME', categoryName: 'Prior Month', durationMinutes: 99 }] },
  ];
  const mtd = reporting.deriveOeeMtd(rows, '2026-09-08');
  assert.equal(mtd.plan, 3);
  const downtime = reporting.deriveDowntimeByCategory(rows);
  assert.deepEqual([...downtime].sort((a, b) => a.label.localeCompare(b.label)), [{ label: 'NO_TUBS_NO_STILLAGES', downtime: 4, count: 1 }, { label: 'Old Machine Fault', downtime: 20, count: 1 }, { label: 'Prior Month', downtime: 99, count: 1 }]);
});

test('history snapshots finalize complete runs without duplicate saves and preserve captured values', async () => {
  const d = await derive;
  const history = await import('../mrp-planner/src/oee/oeeHistory.js');
  const result = d.deriveOeeRun({
    planningEntryId: 'p-history', date: '2026-09-08', productionLine: 'blowMoulding', machine: 'BM01', shift: 'SHIFT 01', process: 'STANDARD_NICT', stockCode: 'N1',
    plannedTimeMinutes: 360, plannedBreakMinutes: 35, totalDowntimeMinutes: 24, runTimeMinutes: 301, totalProduced: 42, goodParts: 34, scrapParts: 8,
    settings: { cycleTimes: [{ stockCode: 'N1', active: true, nictFormingSeconds: 430, nictRobotSeconds: 410 }], general: { idealOee: 0.8 }, specialRules: { STANDARD_NICT: true } },
    lossEvents: [{ categoryId: 'old', categoryName: 'No Tubs / No Stillages', semanticKey: 'NO_TUBS_NO_STILLAGES', lossType: 'DOWNTIME', durationMinutes: 24, comment: 'Captured' }],
  });
  const first = history.finalizeOeeHistory([], result, { originalPlan: 50, effectivePlan: 45, completedByUserId: 'u1', completedAt: '2026-09-08T10:00:00.000Z' });
  const duplicate = history.finalizeOeeHistory(first.history, result, { originalPlan: 50, effectivePlan: 45, completedByUserId: 'u1', completedAt: '2026-09-08T10:01:00.000Z' });
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(first.snapshot.revision, 1);
  assert.equal(first.snapshot.configurationSnapshot.nictSeconds, 430);
  assert.equal(first.snapshot.configurationSnapshot.nictFormingSeconds, 430);
  assert.equal(first.snapshot.configurationSnapshot.nictRobotSeconds, 410);
  assert.equal(first.snapshot.configurationSnapshot.plannedBreakSource, 'loss-events');
  assert.equal(first.snapshot.configurationSnapshot.idealOee, 0.8);
  assert.equal(first.snapshot.lossEventsSnapshot[0].categoryName, 'No Tubs / No Stillages');
  assert.equal(first.snapshot.lossEventsSnapshot[0].semanticKey, 'NO_TUBS_NO_STILLAGES');
  assert.equal(history.finalizeOeeHistory([], { ...result, status: 'INCOMPLETE' }).created, false);
  assert.equal(history.finalizeOeeHistory([], { ...result, status: 'PENDING' }).created, false);
});

test('history revisions preserve revision one and latest filtering does not recalculate snapshots', async () => {
  const d = await derive;
  const history = await import('../mrp-planner/src/oee/oeeHistory.js');
  const base = d.deriveOeeRun({ planningEntryId: 'p-revision', date: '2026-09-08', productionLine: 'blowMoulding', stockCode: 'N1', plannedTimeMinutes: 100, plannedBreakMinutes: 10, totalDowntimeMinutes: 5, runTimeMinutes: 85, totalProduced: 10, goodParts: 10, scrapParts: 0, settings: { cycleTimes: [{ stockCode: 'N1', active: true, nictFormingSeconds: 60 }], specialRules: { STANDARD_NICT: true } } });
  const first = history.finalizeOeeHistory([], base, { originalPlan: 10, effectivePlan: 10, completedByUserId: 'u1' });
  const revised = history.finalizeOeeHistory(first.history, { ...base, scrapParts: 2, goodParts: 8 }, { originalPlan: 10, effectivePlan: 9, completedByUserId: 'u2' });
  assert.equal(revised.snapshot.revision, 2);
  assert.equal(revised.history.length, 2);
  assert.equal(revised.history[0].revision, 1);
  assert.equal(revised.history[0].scrapParts, 0);
  assert.equal(history.latestOeeHistory(revised.history).length, 1);
  assert.equal(history.latestOeeHistory(revised.history)[0].revision, 2);
  assert.equal(history.filterOeeHistory(revised.history, { product: 'N1' }).length, 2);
});
