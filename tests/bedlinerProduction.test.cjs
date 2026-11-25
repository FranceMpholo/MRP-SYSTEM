const test = require('node:test'), assert = require('node:assert/strict');
const { configuredWindows } = require('../server/services/sheetAnalysisSystem');
const { deriveBedliners, readBedliners, receiptsSql, journalSql, catalogSql, coverageSql } = require('../server/services/bedlinerProduction');
const date = '2026-11-20', code = 'R1WZ-2600038-H';
const rules = [{ shift: 'morning', start: '06:00', end: '15:00' }, { shift: 'afternoon', start: '15:00', end: '22:00' }, { shift: 'night', start: '22:00', end: '06:00' }];
const windows = configuredWindows(date, rules);
const boms = [{ parentStockCode: code, componentStockCode: '120002', route: '0', qtyPer: 0.75, factorUnitsVerified: true, qtyPerBasis: 'stocking' }];
const catalog = [{ stockCode: code, description: 'Lnr P/U Box PHEV - EE', stockUom: 'EA' }];
function receipt(quantity, journal = 1, extra = {}) {
  const row = { stockCode: code, stockUom: 'EA', warehouse: 'B-WIP01', entryDate: date, trnTime: 15000000 + journal,
    trnYear: 2027, trnMonth: 8, journal, journalEntry: 8, movementType: 'I', trnType: 'R',
    trnQty: quantity, journalType: 'R', journalQty: quantity, journalUom: 'EA', reference: 'Backflush by TEST', journalReference: 'Backflush by TEST', ...extra };
  const material = { stockCode: '120002', stockUom: 'Pcs', journalUom: 'Pcs', warehouse: 'B-WIP01', trnType: 'I',
    movementTrnType: 'I', movementType: 'I', trnQty: quantity * 0.75, journalQty: quantity * 0.75,
    trnYear: row.trnYear, trnMonth: row.trnMonth, journal, journalEntry: 1 };
  row.backflushesJson = [{ ...row, journalRowsJson: [material, { ...row }] }];
  return row;
}
const run = (receipts = [], extra = {}) => deriveBedliners({ date, windows, receipts, catalog, boms, coverage: { earliestEntryDate: '2025-01-01' }, ...extra });

test('Bedliners counts signed backflush units at production time, including FCSD full codes, without multiplying QtyPer', () => {
  const quantities = [1, 4, 4, 8, 4, 4, 4, 4, 4, 4, 4, 4];
  const result = run(quantities.map((quantity, i) => receipt(quantity, i + 1)));
  assert.equal(result.sheets[0].quantity, 49); assert.equal(result.sheets[1].quantity, 0);
  assert.equal(result.rows.length, 12); assert.equal(result.sheets[0].byStockCode[0].stockCode, code);
  assert.match(result.sheets[0].reason, /production.*timestamp/);
  assert.equal(result.rows[0].warehouse, 'B-WIP01'); assert.equal(result.rows[0].trnType, 'R');
});

test('FG transfers cannot substitute for production; the query selects backflush R receipts in WIP', async () => {
  assert.match(receiptsSql, /m\.Warehouse='B-WIP01'/); assert.match(receiptsSql, /m\.TrnType='R'/); assert.match(receiptsSql, /Backflush%/);
  assert.doesNotMatch(receiptsSql, /m\.TrnType='T'/);
  const { dailySystemSheets } = await import('../mrp-planner/src/dashboard/deriveDailySheetAnalysis.js');
  const bedlinerData = { date, data: run([receipt(49)]).sheets };
  const payload = { postingData: { status: 'connected', rows: [{ stockCode: code, warehouse: 'B-FIN01', category: 'finishedGoods', quantity: 349, status: 'available' }] } };
  const row = dailySystemSheets({ date, payload, boms, bomAvailable: true, bedlinerData })[0];
  assert.equal(row.bedliners.quantity, 49);
  assert.equal(dailySystemSheets({ date, payload, boms, bomAvailable: true })[0].bedliners.status, 'unavailable');
  assert.equal(run([receipt(349, 1, { warehouse: 'B-FIN01', trnType: 'T', journalType: 'T' })]).sheets[0].status, 'unavailable');
});

test('backflush duplicate joins count once, verified reversals subtract, and conflicting copies are unavailable', () => {
  const positive = receipt(8), reversal = receipt(-1, 2);
  assert.equal(run([positive, structuredClone(positive), reversal]).sheets[0].quantity, 7);
  assert.equal(run([positive, { ...positive, journalQty: 99 }]).sheets[0].status, 'unavailable');
});

test('production timestamps honor all configured shift boundaries, including overnight default and custom cutoffs', () => {
  for (const end of ['06:00', '05:30']) {
    const custom = configuredWindows(date, rules.map((row) => row.shift === 'night' ? { ...row, end } : row));
    const rows = [receipt(100, 1, { trnTime: 5595999 }), receipt(1, 2, { trnTime: 6000000 }), receipt(2, 3, { trnTime: 15000000 }),
      receipt(3, 4, { trnTime: 22000000 }), receipt(4, 5, { entryDate: '2026-11-21', trnTime: end === '06:00' ? 5595999 : 5295999 }),
      receipt(100, 6, { entryDate: '2026-11-21', trnTime: end === '06:00' ? 6000000 : 5300000 })];
    assert.equal(run(rows, { windows: custom }).sheets[0].quantity, 10);
  }
});

test('successful covered zero, missing journal/time/history and ambiguous sheet attribution remain distinct', () => {
  assert.equal(run().sheets[0].quantity, 0);
  assert.equal(run([], { coverage: null }).sheets[0].status, 'unavailable');
  for (const mutate of [(r) => { r.trnTime = null; }, (r) => { r.journalQty = null; },
    (r) => { r.backflushesJson[0].journalRowsJson[0].trnQty = null; }]) {
    const row = receipt(8); mutate(row); assert.equal(run([row]).sheets[0].status, 'unavailable');
  }
  const row = receipt(8); row.backflushesJson[0].journalRowsJson.push({ ...row.backflushesJson[0].journalRowsJson[0], stockCode: '120003', journalEntry: 2 });
  assert.equal(run([row]).sheets[0].status, 'incomplete'); assert.equal(run([row]).sheets[1].status, 'incomplete');
});

test('reader attaches full journal material evidence and uses SELECT-only bound date parameters', async () => {
  const raw = receipt(49), calls = [];
  const { BOM_SQL } = require('../server/routes/inventory');
  const fake = { query: async (query, parameters) => {
    calls.push({ query, parameters });
    if (query === receiptsSql) { const { backflushesJson, ...row } = raw; return [row]; }
    if (query === journalSql) return raw.backflushesJson[0].journalRowsJson;
    if (query === catalogSql) return catalog;
    if (query === coverageSql) return [{ earliestEntryDate: '2025-01-01' }];
    if (query === BOM_SQL) return [{ ParentPart: code, Component: '120002', Route: '0', QtyPer: 0.75, ParentMasterCode: code, ComponentMasterCode: '120002', ParentUom: 'EA', ComponentUom: 'Pcs' }];
    throw new Error('Unexpected query');
  } };
  const result = await readBedliners(fake, date, windows, []);
  assert.equal(result.sheets[0].quantity, 49); assert.equal(calls.length, 5);
  assert.ok(calls.every((call) => !/\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i.test(call.query)));
});

test('Bedliner endpoint validates dates/shifts, returns both sheet results and sanitizes source outages', async () => {
  const db = require('../server/db'), original = db.query; let calls = 0;
  db.query = async (query) => { calls++; if (query === catalogSql) return catalog; if (query === coverageSql) return [{ earliestEntryDate: date }]; return []; };
  const app = require('express')(); app.use(require('../server/routes/sheetAnalysis'));
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/sheet-analysis/bedliners`;
  try {
    assert.equal((await fetch(base + '?date=2026-02-30&shifts=[]')).status, 400); assert.equal(calls, 0);
    const response = await fetch(base + '?' + new URLSearchParams({ date, shifts: JSON.stringify(rules) }));
    assert.equal(response.status, 200); assert.equal((await response.json()).data.length, 2);
    db.query = async () => { throw Object.assign(new Error('Private connection details'), { code: 'ETIMEOUT' }); };
    const failed = await fetch(base + '?' + new URLSearchParams({ date, shifts: JSON.stringify(rules) }));
    assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /Private/);
  } finally { db.query = original; await new Promise((resolve) => server.close(resolve)); }
});
