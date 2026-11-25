const test = require('node:test');
const assert = require('node:assert/strict');
const { shiftWindow } = require('../server/services/cycleCountMovements');
const { closingSohQuery, deriveSheetClosingSoh } = require('../server/services/sheetAnalysisSoh');
const codes = ['120002', '121047', '120003'];
const third = shiftWindow('2026-11-18', 'night', '22:00', '05:30');
const period = (stockCode = '120002', changes = {}) => ({ stockCode, currentSoh: 50, currentPeriod: 8, periodOffset: 0,
  openingQty: 100, closingQty: 50, netQty: -50, unsupportedCount: 0, invalidTimeCount: 0,
  earliestMovement: '2026-11-01T08:00:00Z', nightAfterQty: -5, nightAfterCount: 1,
  fetchedAt: '2026-11-23T08:00:00Z', ...changes });

test('historical SOH reconstructs at the configured overnight close rather than a fixed 06:00', () => {
  const row = deriveSheetClosingSoh('2026-11-18', third, [period()])[0];
  assert.equal(row.status, 'available'); assert.equal(row.quantity, 55);
  assert.equal(row.cutoffLocal, '2026-11-19T05:30:00'); assert.equal(row.cutoffAt, '2026-11-19T03:30:00.000Z');
  assert.equal(row.warehouse, 'B-WIP01'); assert.equal(row.productionDate, '2026-11-18');
  assert.ok(closingSohQuery.includes('m.movementAt >= @CutoffLocal'));
  assert.ok(!closingSohQuery.includes('DATEADD(hour, 30'));
});

test('same-day Shift 3 close and overnight year rollover use their actual closing dates', () => {
  const sameDay = shiftWindow('2026-11-18', 'night', '16:00', '22:45');
  assert.equal(deriveSheetClosingSoh('2026-11-18', sameDay, [period()])[0].cutoffAt, '2026-11-18T20:45:00.000Z');
  const nextYear = shiftWindow('2026-12-31', 'night', '22:00', '05:30');
  const row = deriveSheetClosingSoh('2026-12-31', nextYear, [period('120002', { fetchedAt: '2027-01-02T08:00:00Z', earliestMovement: '2026-12-01T00:00:00Z' })])[0];
  assert.equal(row.cutoffAt, '2027-01-01T03:30:00.000Z');
});

test('confirmed zero is retained but missing, stale or unreconciled history never falls back to current SOH', () => {
  assert.equal(deriveSheetClosingSoh('2026-11-18', third, [period('120002', { nightAfterQty: 50 })])[0].quantity, 0);
  for (const changes of [{ netQty: -49 }, { unsupportedCount: 1 }, { invalidTimeCount: 1 }, { fetchedAt: null }, { nightAfterQty: null }, { nightAfterCount: undefined }, { currentSoh: null }, { fetchedAt: '2026-11-18T22:00:00Z' }]) {
    const row = deriveSheetClosingSoh('2026-11-18', third, [period('120002', changes)])[0];
    assert.equal(row.status, 'unavailable', JSON.stringify(changes)); assert.equal(row.quantity, null);
  }
  assert.ok(deriveSheetClosingSoh('2026-11-18', third, []).every((row) => row.quantity === null));
});

test('prior financial periods and unsupported later history remain subject to reconciliation', () => {
  const older = period('120002', { periodOffset: 1, openingQty: 110, closingQty: 100, netQty: -10, nightAfterQty: 20, earliestMovement: '2026-10-01T08:00:00Z' });
  const close = shiftWindow('2026-10-15', 'night', '22:00', '05:30');
  assert.equal(deriveSheetClosingSoh('2026-10-15', close, [period('120002', { nightAfterQty: -50 }), older])[0].quantity, 80);
  assert.equal(deriveSheetClosingSoh('2026-10-15', close, [period(), { ...older, netQty: 999 }])[0].quantity, null);
});

test('opening uses the prior production date night close with continuity across year and leap-day boundaries', async () => {
  const { previousProductionDate, closingSohTarget, historicalSohValue } = await import('../mrp-planner/src/dashboard/useSheetClosingSoh.js');
  assert.equal(previousProductionDate('2026-11-20'), '2026-11-19');
  assert.equal(previousProductionDate('2026-01-01'), '2025-12-31');
  assert.equal(previousProductionDate('2024-03-01'), '2024-02-29');
  assert.equal(previousProductionDate('2026-02-30'), '');
  const rules = { 'SHIFT 01': { start: '06:00', end: '15:00' }, 'SHIFT 02': { start: '15:00', end: '22:00' }, 'SHIFT 03': { start: '22:00', end: '06:00' } };
  const previousDate = previousProductionDate('2026-11-20');
  const target = closingSohTarget(previousDate, rules);
  assert.equal(target.cutoffLocal, '2026-11-20T06:00:00');
  const source = codes.map((stockCode) => period(stockCode, { currentSoh: 900, openingQty: 1000, closingQty: 900, netQty: -100, nightAfterQty: 9.5 }));
  const previousClose = deriveSheetClosingSoh(previousDate, shiftWindow(previousDate, 'night', '22:00', '06:00'), source);
  for (const row of previousClose) {
    const opening = historicalSohValue({ status: 'connected', data: previousClose }, row.stockCode, previousDate, target, { kind: 'opening' });
    assert.equal(opening.quantity, row.quantity); assert.equal(opening.quantity, 890.5);
  }
});

test('before the overnight cutoff closing is in progress; at and after it verified values or unavailable are shown', async () => {
  const { closingSohTarget, historicalSohValue } = await import('../mrp-planner/src/dashboard/useSheetClosingSoh.js');
  const rules = { 'SHIFT 01': { start: '06:00', end: '15:00' }, 'SHIFT 02': { start: '15:00', end: '22:00' }, 'SHIFT 03': { start: '22:00', end: '06:00' } };
  const target = closingSohTarget('2026-11-20', rules), cutoff = Date.parse(target.cutoffAt);
  const rows = codes.map((stockCode) => ({ stockCode, productionDate: '2026-11-20', warehouse: 'B-WIP01', shift: 'night', cutoffAt: target.cutoffAt, status: 'available', quantity: 0 }));
  const value = (now, state = { status: 'connected', data: rows }) => historicalSohValue(state, '120002', '2026-11-20', target, { now });
  assert.equal(value(cutoff - 1).status, 'cycle_in_progress');
  assert.equal(value(cutoff - 1, { status: 'unavailable' }).status, 'cycle_in_progress');
  assert.equal(value(cutoff).quantity, 0); assert.equal(value(cutoff + 1).quantity, 0);
  assert.equal(value(cutoff + 1, { status: 'unavailable' }).status, 'historical_unavailable');
  assert.equal(historicalSohValue({}, '120002', '2026-11-20', target, { now: cutoff - 1, kind: 'opening' }).status, 'historical_unavailable');
  const window = shiftWindow('2026-11-20', 'night', '22:00', '06:00');
  assert.ok(deriveSheetClosingSoh('2026-11-20', window, [], cutoff - 1).every((row) => row.status === 'in_progress' && row.quantity === null));
});

test('display verifies stock, date, warehouse and exact close, including zero and outage states', async () => {
  const { closingSohTarget, historicalSohValue } = await import('../mrp-planner/src/dashboard/useSheetClosingSoh.js');
  const rules = { 'SHIFT 01': { start: '06:00', end: '15:00' }, 'SHIFT 02': { start: '15:00', end: '22:00' }, 'SHIFT 03': { start: '22:00', end: '05:30' } };
  const target = closingSohTarget('2026-11-18', rules);
  assert.equal(target.cutoffLocal, '2026-11-19T05:30:00');
  const row = { stockCode: '120002', productionDate: '2026-11-18', warehouse: 'B-WIP01', shift: 'night', cutoffAt: target.cutoffAt, quantity: 0, status: 'available' };
  const display = (changes = {}) => historicalSohValue({ status: 'connected', data: [{ ...row, ...changes }] }, '120002', '2026-11-18', target);
  assert.equal(display().quantity, 0);
  for (const changes of [{ quantity: null }, { status: 'unavailable' }, { productionDate: '2026-11-19' }, { warehouse: 'B-RAW01' }, { cutoffAt: '2026-11-19T04:00:00.000Z' }]) assert.equal(display(changes).status, 'historical_unavailable');
  assert.equal(historicalSohValue({ status: 'unavailable', error: 'Offline' }, '120002', '2026-11-18', target).status, 'historical_unavailable');
  assert.equal(closingSohTarget('', rules), null);
});

test('closing-SOH endpoint binds the selected cutoff and isolates failures from System postings', async () => {
  const db = require('../server/db'), original = db.query; const calls = [];
  db.query = async (query, parameters) => { calls.push({ query, parameters }); return codes.map((stockCode) => period(stockCode)); };
  const app = require('express')(); app.use(require('../server/routes/sheetAnalysis'));
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/sheet-analysis/closing-soh`;
  const shifts = [{ shift: 'night', start: '22:00', end: '05:30' }, { shift: 'morning', start: '06:00', end: '15:00' }, { shift: 'afternoon', start: '15:00', end: '22:00' }];
  const query = new URLSearchParams({ date: '2026-11-18', shifts: JSON.stringify(shifts) });
  try {
    assert.equal((await fetch(`${base}?date=2026-02-30&shifts=[]`)).status, 400); assert.equal(calls.length, 0);
    const future = await (await fetch(`${base}?${new URLSearchParams({ date: '2099-11-20', shifts: JSON.stringify(shifts) })}`)).json();
    assert.ok(future.data.every((row) => row.status === 'in_progress' && row.quantity === null)); assert.equal(calls.length, 0);
    const response = await fetch(`${base}?${query}`); const payload = await response.json();
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(payload.data.map((row) => row.stockCode), codes); assert.ok(payload.data.every((row) => row.quantity === 55));
    assert.equal(calls[0].parameters.find((parameter) => parameter.name === 'CutoffLocal').value.toISOString(), '2026-11-19T05:30:00.000Z');
    assert.ok(calls[0].parameters.some((parameter) => parameter.name === 'StockCode0' && parameter.value === '120002'));
    assert.doesNotMatch(calls[0].query, /\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i);
    db.query = async () => { throw Object.assign(new Error('Private SQL details'), { code: 'ETIMEOUT' }); };
    const failed = await fetch(`${base}?${query}`); assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /Private/);
  } finally { db.query = original; await new Promise((resolve) => server.close(resolve)); }
});
