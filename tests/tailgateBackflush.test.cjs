const test = require('node:test');
const assert = require('node:assert/strict');
const { configuredWindows } = require('../server/services/sheetAnalysisSystem');
const { applicableMapping, deriveTailgates, sql, catalogSql, coverageSql } = require('../server/services/tailgateBackflush');
const date = '2026-11-18';
const rules = [{ shift: 'morning', start: '06:00', end: '15:00' }, { shift: 'afternoon', start: '15:00', end: '22:00' }, { shift: 'night', start: '22:00', end: '06:00' }];
const windows = configuredWindows(date, rules);
const cj = 'N1WB-E40726-CJ', dc = 'N1WB-E40726-DC', rap = 'N1WB-E40726-CJ-RAP', cap = 'N1WB-E40726-CJ-CAP', svc = 'OTHER-TAILGATE-SERVICE';
const bom = (parentStockCode, componentStockCode, route = '0', extra = {}) => ({ parentStockCode, componentStockCode, route, qtyPer: 0.25,
  factorUnitsVerified: true, qtyPerBasis: 'stocking', parentReferenceExists: true, componentReferenceExists: true, ...extra });
const boms = [bom(cj, '120002'), bom(cj, rap, '2'), bom(dc, '120002'), bom(rap, '120003'), bom(svc, dc), bom(cap, '120013')];
const catalog = [cj, dc, rap, cap, svc].map((stockCode) => ({ stockCode, description: 'Tailgate test', stockUom: 'EA', finishedWarehouseExists: 1 }));
function receipt(stockCode, quantity, material = '120002', extra = {}) {
  const row = { stockCode, stockUom: 'EA', warehouse: 'B-FIN01', entryDate: date, trnTime: 14000000,
    trnYear: 2027, trnMonth: 8, journal: 123, journalEntry: 2, movementType: 'I', trnType: 'R',
    trnQty: quantity, journalType: 'R', journalQty: quantity, journalUom: 'EA',
    reference: 'Backflush by TEST', journalReference: 'Backflush by TEST', ...extra };
  const materialRow = { stockCode: material, stockUom: 'Pcs', journalUom: 'Pcs', warehouse: 'B-WIP01',
    trnType: 'I', movementTrnType: 'I', movementType: 'I', trnQty: quantity / 4, journalQty: quantity / 4,
    trnYear: row.trnYear, trnMonth: row.trnMonth, journal: row.journal, journalEntry: 1 };
  const output = { ...row };
  row.backflushesJson = [{ ...row, journalRowsJson: [materialRow, output] }];
  return row;
}
const run = (receipts = [], extra = {}) => deriveTailgates({ date, windows, receipts, boms, catalog, coverage: { earliestEntryDate: '2025-01-01' }, ...extra });
const sheet = (result, stockCode = '120002') => result.sheets.find((row) => row.stockCode === stockCode);

test('catalog checks complete stock codes and discovers additional BOM-confirmed tailgates without overrides', () => {
  assert.deepEqual(applicableMapping(cj, boms, date).candidateSheets, ['120002', '120003']);
  assert.equal(applicableMapping(cj, boms, date, { route: '0' }).status, 'verified');
  assert.deepEqual(applicableMapping(dc, boms, date).candidateSheets, ['120002']);
  assert.deepEqual(applicableMapping(rap, boms, date).candidateSheets, ['120003']);
  assert.deepEqual(applicableMapping(cap, boms, date).candidateSheets, []);
  assert.deepEqual(applicableMapping(' n1wb-e40726-cj-rap ', boms, date).candidateSheets, ['120003']);
  assert.ok(run().catalog.some((row) => row.stockCode === svc && row.candidateSheets[0] === '120002'));
});

test('direct backflush receipts count finished units, with actual materials confirming CJ route and exact RAP mapping', () => {
  const result = run([receipt(cj, 8), receipt(dc, 12), receipt(rap, 4, '120003'), receipt(svc, 3, dc)]);
  assert.equal(sheet(result).quantity, 23); assert.equal(sheet(result, '120003').quantity, 4);
  assert.deepEqual(result.rows.find((row) => row.stockCode === cj).confirmedRoutes, ['0']);
  assert.deepEqual(sheet(result).byStockCode.map((row) => [row.stockCode, row.quantity]), [[cj, 8], [dc, 12], [svc, 3]]);
});

test('the job-confirmed alternate CJ route overrides neither full stock code nor observed material', () => {
  const row = receipt(cj, 8, rap);
  row.backflushesJson[0].jobStockCode = cj; row.backflushesJson[0].jobRoute = '2';
  assert.equal(sheet(run([row]), '120003').quantity, 8);
  assert.equal(sheet(run([row])).quantity, 0);
  row.backflushesJson[0].jobRoute = '0';
  assert.equal(sheet(run([row])).status, 'incomplete');
  assert.equal(sheet(run([row]), '120003').status, 'incomplete');
});

test('ambiguous route or mixed sheet consumption marks affected totals Incomplete with separate verified subtotals', () => {
  const row = receipt(cj, 8);
  row.backflushesJson[0].journalRowsJson.push({ ...row.backflushesJson[0].journalRowsJson[0], stockCode: '120003', journalEntry: 3 });
  const result = run([row, receipt(dc, 4)]);
  assert.equal(sheet(result).status, 'incomplete'); assert.equal(sheet(result).quantity, null);
  assert.equal(sheet(result).verifiedSubtotal, 4); assert.equal(sheet(result, '120003').status, 'incomplete');
  assert.deepEqual(sheet(result).unresolvedCodes, [cj]);
});

test('finished receipts and verified reversals count once, even with duplicate join copies', () => {
  const positive = receipt(dc, 8), reversal = receipt(dc, -2, '120002', { trnTime: 16000000, journal: 124 });
  assert.equal(sheet(run([positive, structuredClone(positive), reversal])).quantity, 6);
  const conflict = structuredClone(positive); conflict.trnQty = 99;
  assert.equal(sheet(run([positive, conflict])).status, 'unavailable');
  assert.equal(sheet(run([positive, { ...positive, journal: 999 }])).status, 'unavailable');
});

test('all three configured shifts use half-open SAST boundaries including the overnight cutoff', () => {
  for (const end of ['06:00', '05:30']) {
    const custom = configuredWindows(date, rules.map((row) => row.shift === 'night' ? { ...row, end } : row));
    const make = (quantity, trnTime, day = date) => receipt(dc, quantity, '120002', { trnTime, entryDate: day, journal: trnTime });
    const rows = [make(100, 5595999), make(1, 6000000), make(2, 15000000), make(3, 22000000),
      make(4, end === '06:00' ? 5595999 : 5295999, '2026-11-19'), make(100, end === '06:00' ? 6000000 : 5300000, '2026-11-19')];
    assert.equal(sheet(run(rows, { windows: custom })).quantity, 10);
  }
});

function transfer(quantity = 8) {
  const backflush = receipt(dc, 8).backflushesJson[0];
  backflush.warehouse = 'B-WIP01'; backflush.movementJob = backflush.journalJob = 'JOB-1';
  const row = receipt(dc, quantity, '120002', { trnType: 'T', journalType: 'T', transferFlag: 'I', gtrReference: 'GTR-1', journal: 200, movementJob: 'JOB-1' });
  row.sourceLegsJson = [{ ...row, warehouse: 'B-WIP01', newWarehouse: 'B-FIN01', transferToWh: 'B-FIN01', transferFlag: 'O', trnQty: -quantity, journalQty: quantity, journal: 199, journalType: 'T' }];
  row.backflushesJson = [backflush];
  return row;
}
test('GTR and exact job/full-code lineage link transfers to production; GTR alone or equal quantities cannot prove it', () => {
  const row = transfer(); assert.equal(sheet(run([row])).quantity, 8);
  for (const mutate of [
    (r) => { delete r.movementJob; delete r.sourceLegsJson[0].movementJob; },
    (r) => { r.backflushesJson = []; }, (r) => { r.sourceLegsJson = []; },
    (r) => { r.backflushesJson[0].journalJob = 'OTHER-JOB'; },
    (r) => { r.backflushesJson[0].stockCode = cj; },
    (r) => { r.backflushesJson[0].trnQty = r.backflushesJson[0].journalQty = -8; },
    (r) => { r.sourceLegsJson[0].gtrReference = 'OTHER-GTR'; },
  ]) {
    const changed = structuredClone(row); mutate(changed);
    assert.equal(sheet(run([changed])).status, 'unavailable');
  }
  const negative = transfer(-2); negative.trnTime = 17000000; negative.journal = 201;
  assert.equal(sheet(run([row, negative])).quantity, 6);
  const tooMany = transfer(); tooMany.journal = 202; tooMany.trnTime = 18000000;
  assert.equal(sheet(run([row, tooMany])).status, 'unavailable');
});

test('missing evidence cannot become zero; a covered successful no-match query is numeric zero', () => {
  assert.equal(sheet(run()).quantity, 0);
  assert.equal(sheet(run([], { coverage: null })).status, 'unavailable');
  assert.equal(sheet(run([], { boms: [] })).status, 'unavailable');
  for (const mutate of [(r) => { r.trnTime = null; }, (r) => { r.journalQty = null; }, (r) => { r.stockUom = 'KG'; },
    (r) => { r.backflushesJson[0].journalRowsJson[0].warehouse = 'OTHER'; },
    (r) => { r.backflushesJson[0].journalRowsJson[0].trnQty = 999; },
    (r) => { r.backflushesJson[0].journalRowsJson = null; },
    (r) => { r.backflushesJson[0].journalReference = 'Manual receipt'; }]) {
    const row = receipt(dc, 8); mutate(row); const result = sheet(run([row]));
    assert.equal(result.status, 'unavailable'); assert.equal(result.quantity, null);
  }
});

test('effective BOM dates and revisions are checked on the applicable full-code route', () => {
  assert.deepEqual(applicableMapping(dc, [...boms, bom(dc, '120003', '3', { structureOnDate: '2026-12-01' })], date).candidateSheets, ['120002']);
  assert.equal(applicableMapping(dc, [bom(dc, '120002', '0', { version: 'A' })], date).status, 'incomplete');
  assert.equal(applicableMapping(dc, [bom(dc, '120002', '0', { version: 'A' })], date, { route: '0', version: 'A' }).status, 'verified');
  const overnight = receipt(dc, 8, '120002', { entryDate: '2026-11-19', trnTime: 2000000 });
  assert.equal(sheet(run([overnight], { boms: [bom(dc, '120002', '0', { structureOnDate: '2026-11-19' })] })).quantity, 8);
});

test('the bounded lookup reader attaches exact GTR/job/journal evidence with bound full-code parameters', async () => {
  const { readTailgates } = require('../server/services/tailgateBackflush');
  const { BOM_SQL } = require('../server/routes/inventory');
  const linked = transfer(), source = linked.sourceLegsJson[0], backflush = linked.backflushesJson[0];
  const calls = [];
  const rawBoms = boms.map((row) => ({ ParentPart: row.parentStockCode, Component: row.componentStockCode, Route: row.route, QtyPer: row.qtyPer,
    ParentMasterCode: row.parentStockCode, ComponentMasterCode: row.componentStockCode, ParentUom: 'EA', ComponentUom: 'Pcs' }));
  const fake = { query: async (query, parameters) => {
    calls.push({ query, parameters });
    if (query === sql) { const { sourceLegsJson, backflushesJson, ...row } = linked; return [row]; }
    if (query === catalogSql) return catalog;
    if (query === coverageSql) return [{ earliestEntryDate: '2025-01-01' }];
    if (query === BOM_SQL) return rawBoms;
    if (query.includes('WHERE b.TrnType')) { const { journalRowsJson, ...row } = backflush; return [row]; }
    if (query.includes("WHERE d.TrnType IN ('I','R')")) return backflush.journalRowsJson;
    if (query.includes("WHERE m.NewWarehouse='B-FIN01'")) return [source];
    throw new Error('Unexpected read');
  } };
  const result = await readTailgates(fake, date, windows, []);
  assert.equal(sheet(result).quantity, 8); assert.equal(calls.length, 7);
  assert.ok(calls.every((call) => !call.query.includes(dc)));
  assert.ok(calls.some((call) => call.parameters?.some((parameter) => parameter.name === 'JobCode0' && parameter.value === dc)));
});

test('verified transfers from another warehouse are excluded; missing origins still make the required total unavailable', () => {
  const other = transfer(); other.sourceLegsJson[0].warehouse = 'F-FIN01';
  const result = run([other]);
  assert.equal(sheet(result).quantity, 0); assert.equal(result.rows[0].status, 'excluded');
  assert.match(result.rows[0].reason, /F-FIN01/);
  other.sourceLegsJson = [];
  assert.equal(sheet(run([other])).status, 'unavailable');
});

test('read-only endpoint validates scope, isolates database failures and never exposes connection details', async () => {
  const db = require('../server/db'), original = db.query, calls = [];
  db.query = async (query, parameters) => { calls.push({ query, parameters }); if (query === sql) return []; if (query === catalogSql) return catalog; if (query === coverageSql) return [{ earliestEntryDate: date }]; return []; };
  const app = require('express')(); app.use(require('../server/routes/sheetAnalysis'));
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/sheet-analysis/tailgates`;
  try {
    assert.equal((await fetch(base + '?date=2026-02-30&shifts=[]')).status, 400); assert.equal(calls.length, 0);
    const response = await fetch(base + '?' + new URLSearchParams({ date, shifts: JSON.stringify(rules) }));
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).data.length, 2);
    assert.ok(calls.every((call) => !/\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i.test(call.query)));
    assert.equal(calls[0].parameters[1].value.toISOString(), '2026-11-20T00:00:00.000Z');
    db.query = async () => { throw Object.assign(new Error('Private connection details'), { code: 'ETIMEOUT' }); };
    const failed = await fetch(base + '?' + new URLSearchParams({ date, shifts: JSON.stringify(rules) }));
    assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /Private/);
  } finally { db.query = original; await new Promise((resolve) => server.close(resolve)); }
});
