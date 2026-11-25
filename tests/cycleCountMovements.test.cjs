const test = require('node:test');
const assert = require('node:assert/strict');
const { STOCK_CODES, shiftWindow, movementLocal, deriveMovementTotals } = require('../server/services/cycleCountMovements');
const morning = shiftWindow('2026-11-18', 'morning', '06:00', '15:00');
const metadata = (stockCode) => ({ stockCode, warehouseExists: 1, earliestEntryDate: '2025-01-01', stockUom: 'Pcs' });
const movement = (overrides = {}) => ({ ...metadata('120002'), warehouse: 'B-WIP01', entryDate: '2026-11-18', trnTime: 8000000,
  trnYear: 2027, trnMonth: 8, journal: 100, journalEntry: 1, movementType: 'I', trnType: 'I', trnQty: 10,
  journalType: 'I', journalQty: 10, journalUom: 'Pcs', transferFlag: '', ...overrides });
const receipt = (overrides = {}) => movement({ trnType: 'T', journalType: 'T', transferFlag: 'I', sourceWarehouseMin: 'B-RAW01', sourceWarehouseMax: 'B-RAW01', ...overrides });
const derive = (rows, window = morning) => deriveMovementTotals(window, [...STOCK_CODES.map(metadata), ...rows]);

test('SAST shift windows use configured times, overnight start dates and year rollover', () => {
  const window = shiftWindow('2026-12-31', 'night', '21:37', '05:42');
  assert.equal(window.productionDate, '2026-12-31');
  assert.equal(window.startAt, '2026-12-31T21:37:00+02:00');
  assert.equal(window.endAt, '2027-01-01T05:42:00+02:00');
  assert.equal(window.endDayExclusive, '2027-01-02');
  for (const [start, end] of [['06:00', '06:00'], ['25:00', '06:00'], ['6:00', '15:00'], ['06:60', '15:00']]) assert.throws(() => shiftWindow('2026-11-18', 'morning', start, end));
});

test('assigns every shift boundary once, including hundredths and the next morning', () => {
  const rows = [movement({ trnTime: 5595999, trnQty: 1, journalQty: 1 }), movement({ trnTime: 6000000 }),
    movement({ trnTime: 14595999 }), movement({ trnTime: 15000000 }), movement({ trnTime: 22000000 }),
    movement({ entryDate: '2026-11-19', trnTime: 0 }), movement({ entryDate: '2026-11-19', trnTime: 5595999 }),
    movement({ entryDate: '2026-11-19', trnTime: 6000000 })];
  assert.equal(derive(rows)[0].totalIssue.quantity, 20);
  assert.equal(derive(rows, shiftWindow('2026-11-18', 'afternoon', '15:00', '22:00'))[0].totalIssue.quantity, 10);
  assert.equal(derive(rows, shiftWindow('2026-11-18', 'night', '22:00', '06:00'))[0].totalIssue.quantity, 30);
  assert.equal(derive(rows, shiftWindow('2026-11-19', 'morning', '06:00', '15:00'))[0].totalIssue.quantity, 10);
  assert.equal(movementLocal(movement({ trnTime: 9351619 })), '2026-11-18T09:35:16.190');
});

test('counts receipt once, excluding outgoing leg, while preserving legitimate split receipts', () => {
  const row = receipt();
  const rows = [row, { ...row }, movement({ warehouse: 'B-RAW01', trnType: 'T', transferFlag: 'O', trnQty: -10 }),
    receipt({ trnTime: 8000001, journalEntry: 2 }), receipt({ trnTime: 8000002, journalEntry: 3, newWarehouse: 'B-REG01', sourceWarehouseMin: 'B-REG01', sourceWarehouseMax: 'B-REG01' }),
    receipt({ trnTime: 8000003, transferFlag: 'O', trnQty: -8, journalQty: 8 })];
  assert.equal(derive(rows)[0].qtyReceived.quantity, 20);
  assert.equal(derive(rows)[0].totalIssue.quantity, 0);
});

test('keeps outward issues positive, nets negative issues and receipt reversals without absolute values', () => {
  const result = derive([movement(), movement({ trnTime: 8100000, trnQty: -3, journalQty: -3 }),
    receipt({ trnTime: 8200000, trnQty: 100, journalQty: 100 }), receipt({ trnTime: 8300000, trnQty: -10, journalQty: -10 })])[0];
  assert.equal(result.totalIssue.quantity, 7);
  assert.equal(result.qtyReceived.quantity, 90);
  assert.equal(derive([movement({ trnQty: -3, journalQty: -3 })])[0].totalIssue.quantity, -3);
});

test('flags unverified or ambiguous transfer sources instead of guessing zero', () => {
  for (const change of [{ sourceWarehouseMin: null, sourceWarehouseMax: null }, { sourceWarehouseMax: 'OTHER' }, { transferFlag: '' }, { journalQty: 11 }]) {
    assert.equal(derive([receipt(change)])[0].qtyReceived.status, 'unavailable', JSON.stringify(change));
  }
  assert.equal(derive([receipt({ newWarehouse: 'B-RAW01', sourceWarehouseMin: null, sourceWarehouseMax: null })])[0].qtyReceived.status, 'unavailable');
});

test('posting dates without verified times remain unavailable by shift; midnight is a valid timestamp', () => {
  for (const trnTime of [null, undefined, '', 24600000, 12600000, 12596000, -1, 100000.5]) {
    const result = derive([movement({ trnTime })])[0];
    assert.equal(result.totalIssue.status, 'unavailable_by_shift', String(trnTime));
    assert.equal(result.totalIssue.quantity, null);
    assert.equal(result.qtyReceived.quantity, 0);
  }
  assert.equal(movementLocal(movement({ trnTime: 0 })), '2026-11-18T00:00:00.000');
});

test('requires journal agreement, supported issue semantics and stock units', () => {
  for (const change of [{ journalQty: null }, { journalQty: -10 }, { journalType: 'R' }, { movementType: 'S' }, { journalUom: 'KG' }, { journalUom: '' }, { stockUom: '' },
    { trnType: 'E', journalType: 'E' }, { trnType: '?' }]) assert.equal(derive([movement(change)])[0].totalIssue.status, 'unavailable');
  assert.equal(derive([movement({ trnType: 'A', journalType: 'A' }), movement({ trnType: 'R', journalType: 'R', trnTime: 8100000 })])[0].totalIssue.quantity, 0);
  assert.equal(derive([movement(), movement({ trnQty: 20, journalQty: 20 })])[0].totalIssue.status, 'unavailable');
});

test('successful zero queries differ from missing warehouse/history and sheets are scoped', () => {
  assert.ok(derive([]).every((row) => row.qtyReceived.quantity === 0 && row.totalIssue.quantity === 0));
  assert.ok(deriveMovementTotals(morning, []).every((row) => row.totalIssue.quantity === null));
  assert.equal(deriveMovementTotals(morning, [metadata('120002'), movement({ stockCode: 'UNRELATED' })]).length, 3);
  for (const change of [{ warehouseExists: 0 }, { earliestEntryDate: null }, { earliestEntryDate: '2026-11-19' }]) {
    assert.equal(deriveMovementTotals(morning, [{ ...metadata('120002'), ...change }])[0].qtyReceived.status, 'unavailable');
  }
});

test('movement route is SELECT-only, binds dates, restricts codes and sanitizes outages', async () => {
  const db = require('../server/db'), original = db.query, calls = [];
  db.query = async (query, parameters) => { calls.push({ query, parameters }); return [...STOCK_CODES.map(metadata), receipt(), movement({ trnTime: 8100000 })]; };
  const app = require('express')(); app.use(require('../server/routes/cycleCount'));
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/cycle-count/movements`;
  const query = '?date=2026-11-18&shift=morning&start=06:00&end=15:00';
  try {
    for (const suffix of ['?date=2026-02-30&shift=morning&start=06:00&end=15:00', '?date=2026-11-18&shift=unknown&start=06:00&end=15:00', '?date=2026-11-18&shift=morning', '?date=2026-11-18&shift=night&start=22:00&end=22:00']) assert.equal((await fetch(base + suffix)).status, 400);
    assert.equal(calls.length, 0);
    const response = await fetch(base + query + '&stockCodes=OTHER');
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const payload = await response.json();
    assert.deepEqual(payload.data.map((row) => row.stockCode), STOCK_CODES);
    assert.equal(payload.data[0].qtyReceived.quantity, 10);
    assert.equal(payload.data[0].totalIssue.quantity, 10);
    assert.ok(calls[0].query.includes('@StartDay')); assert.equal(calls[0].parameters[0].value.toISOString(), '2026-11-18T00:00:00.000Z');
    assert.doesNotMatch(calls[0].query, /\b(UPDATE|DELETE|INSERT|MERGE|EXEC)\b/i);
    db.query = async () => { throw Object.assign(new Error('Secret connection details'), { code: 'ETIMEOUT' }); };
    const outage = await fetch(base + query); assert.equal(outage.status, 503); assert.doesNotMatch(await outage.text(), /Secret/);
    db.query = async () => { throw Object.assign(new Error("Invalid column name 'TrnTime'"), { number: 207 }); };
    const noTime = await (await fetch(base + query)).json();
    assert.ok(noTime.data.every((row) => row.totalIssue.status === 'unavailable_by_shift'));
  } finally { db.query = original; await new Promise((resolve) => server.close(resolve)); }
});

test('frontend request scopes reflect configured times; overlap is not silently double-counted', async () => {
  const { movementRequests, movementDisplay } = await import('../mrp-planner/src/cycleCount/cycleCountMovements.js');
  const rules = { 'SHIFT 01': { start: '05:30', end: '14:00' }, 'SHIFT 02': { start: '14:00', end: '21:00' }, 'SHIFT 03': { start: '21:00', end: '05:30' } };
  assert.deepEqual(movementRequests('2026-11-18', rules, 'night'), [{ date: '2026-11-18', shift: 'night', start: '21:00', end: '05:30' }]);
  assert.equal(movementRequests('2026-11-18', rules, 'night', true).length, 3);
  assert.equal(movementRequests('2026-11-18', { ...rules, 'SHIFT 01': { start: '05:30', end: '14:01' } }, 'morning'), null);
  assert.equal(movementDisplay(null, '120002', 'qtyReceived').text, 'Loading');
  assert.equal(movementDisplay({ status: 'offline' }, '120002', 'qtyReceived').text, 'Unavailable');
  assert.equal(movementDisplay({ status: 'unavailable_by_shift' }, '120002', 'qtyReceived').text, 'Unavailable by shift');
  assert.equal(movementDisplay({ status: 'connected', data: derive([]) }, '120002', 'qtyReceived').quantity, 0);
  assert.equal(movementDisplay({ status: 'connected', data: [] }, '120002', 'qtyReceived').text, 'Unavailable');
});
