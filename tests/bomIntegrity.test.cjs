const test = require('node:test');
const assert = require('node:assert/strict');
const { mapBomRow, quantityState: serverState } = require('../server/bomMapping');
let validation, production, reconciliation, ledger, engine, inventory, sheet, fcsd, exportGuard;
test.before(async () => {
  [validation, production, reconciliation, ledger, engine, inventory, sheet, fcsd, exportGuard] = await Promise.all([
    import('../mrp-planner/src/bom/bomValidation.js'), import('../mrp-planner/src/production/deriveProductionMRP.js'),
    import('../mrp-planner/src/reconciliation/deriveMaterialReconciliation.js'), import('../mrp-planner/src/bom/ledgerBom.js'),
    import('../mrp-planner/src/bom/mrpEngine.js'), import('../mrp-planner/src/api/sysproApi.js'),
    import('../mrp-planner/src/dashboard/deriveSheetAnalysis.js'), import('../mrp-planner/src/fcsd/fcsdRequirements.js'),
    import('../mrp-planner/src/production/storeRequestValidation.js'),
  ]);
});
const line = (changes = {}) => ({ parentStockCode: 'P', componentStockCode: 'C', qtyPer: 2,
  parentUom: 'EA', componentUom: 'EA', factorUnitsVerified: true, qtyPerBasis: 'stocking', route: '0', sequence: '000000', ...changes });
const items = [
  { id: 'parent-id', code: 'P', description: 'Parent', uom: 'EA', type: 'Make', onHand: 0, leadTimeDays: 0, lotSize: 1 },
  { id: 'child-id', code: 'C', description: 'Material', uom: 'EA', type: 'Buy', onHand: 0, bWip01Soh: 2, bRaw01Soh: 20, lotSize: 5 },
];
const planning = { entries: [{ id: 'plan', partNumber: 'P', productionLine: 'thermoforming', buildQty: 10 }] };
const prod = (boms, rest = {}) => production.deriveProductionMRP({ planning, items, boms, ...rest });
const recon = (boms, rest = {}) => reconciliation.deriveMaterialReconciliation({
  productionActuals: [{ id: 'actual', partNumber: 'P', productionLine: 'thermoforming', actualMouldQty: 10, day: '2026-11-13' }],
  items, boms, openingWipBalances: [{ stockCode: 'C', quantity: 0, asOf: '2026-11-13T00:00:00' }],
  closingWipBalances: [{ stockCode: 'C', quantity: 0, asOf: '2026-11-14T00:00:00' }],
  period: { dateFrom: '2026-11-13T00:00:00', dateTo: '2026-11-14T00:00:00' }, ...rest,
});

test('server and frontend distinguish missing, blank, invalid, zero, positive and negative factors', () => {
  for (const [raw, state] of [[null, 'missing'], [undefined, 'missing'], ['', 'blank'], [' \t', 'blank'], ['bad', 'invalid'], [false, 'invalid'], [Infinity, 'invalid'], [0, 'zero'], ['0', 'zero'], [2.5, 'positive'], [-0.5, 'negative']]) {
    assert.equal(serverState(raw), state);
    assert.equal(validation.quantityState(raw), state);
    const mapped = mapBomRow({ ParentPart: ' P ', Component: ' c ', QtyPer: raw, Route: ' 2 ', SequenceNum: ' 000001 ' });
    assert.equal(mapped.qtyPerState, state);
    assert.equal(validation.bomFactor(mapped).state, state);
    assert.equal(mapped.qtyPer, ['positive', 'zero', 'negative'].includes(state) ? Number(raw) : null);
    assert.equal(mapped.route, '2'); assert.equal(mapped.sequence, '000001');
  }
});

test('valid positive direct requirements preserve netting and pack rounding', () => {
  const result = prod([line()]);
  assert.equal(result.complete, true);
  assert.equal(result.childRequirements[0].grossRequirement, 20);
  assert.equal(result.childRequirements[0].productionShortfall, 18);
  assert.equal(result.storeRequests[0].storeRequestQty, 20);
  assert.equal(exportGuard.canExportStoreRequest(result), true);
});

test('unknown factors cannot become zero, Tied, complete requests or no-material requests', () => {
  for (const qtyPer of [null, undefined, '', ' ', 'invalid']) {
    const result = prod([line({ qtyPer })]);
    assert.equal(result.childRequirements[0].grossRequirement, null);
    assert.equal(result.childRequirements[0].packsRequired, null);
    assert.equal(result.childRequirements[0].storeRequestQty, null);
    assert.equal(result.storeRequests.length, 1);
    assert.equal(exportGuard.canExportStoreRequest(result), false);
    const row = recon([line({ qtyPer })]).rows[0];
    assert.equal(row.expectedConsumptionQty, null);
    assert.equal(row.consumptionVarianceQty, null);
    assert.equal(row.consumptionWithinTolerance, null);
    assert.equal(row.status, 'Data incomplete');
    const resultLedger = engine.runMRP(items, ledger.adaptLedgerBoms(items, [line({ qtyPer })]), [], [], 1, new Date('2026-11-09'));
    assert.equal(resultLedger['child-id'].GR[0], null);
  }
});

test('explicit zero remains a valid zero with a warning; negative quantities are retained without credit', () => {
  const zero = prod([line({ qtyPer: 0 })]);
  assert.equal(zero.childRequirements[0].grossRequirement, 0);
  assert.equal(zero.complete, true);
  assert.ok(zero.dataWarnings.some((text) => /explicitly zero/i.test(text)));
  assert.equal(recon([line({ qtyPer: 0 })]).rows[0].status, 'Tied');
  const negative = prod([line({ qtyPer: -2 })]);
  assert.equal(negative.childRequirements[0].grossRequirement, null);
  assert.equal(negative.complete, false);
  assert.ok(negative.dataIssues.some((text) => /negative/i.test(text)));
  assert.equal(recon([line({ qtyPer: -2 })]).rows[0].expectedConsumptionQty, null);
});

test('stock codes match across case/whitespace and live-only BOM items keep live stock/UOM without saved policy invention', () => {
  const saved = [{ ...items[0], code: ' p ' }];
  const live = [{ StockCode: ' P ', StockUom: 'EA', B_WIP01_SOH: 0, B_RAW01_SOH: 0 },
    { StockCode: ' c ', Description: 'Live material', StockUom: 'EA', B_WIP01_SOH: 7, B_RAW01_SOH: 13 }];
  const before = JSON.stringify({ saved, live });
  const overlay = inventory.mergeSysproInventory(saved, live, ['P', 'C']);
  const child = overlay.find((item) => item.code === 'C');
  assert.equal(child.uom, 'EA'); assert.equal(child.bWip01Soh, 7); assert.equal(child.bRaw01Soh, 13);
  assert.equal(child.type, null); assert.equal(child.onHand, null);
  const result = prod([line({ parentStockCode: ' p ', componentStockCode: ' c ' })], { items: overlay });
  assert.equal(result.childRequirements[0].productionShortfall, 13);
  assert.equal(result.childRequirements[0].bRaw01Soh, 13);
  assert.equal(result.storeRequests[0].storeRequestQty, null); // No invented pack size.
  const adapted = ledger.adaptLedgerBoms(overlay, [line()]);
  assert.equal(adapted.length, 1); assert.equal(adapted[0].componentId, child.id);
  assert.equal(JSON.stringify({ saved, live }), before);
});

test('saved balances and pack sizes are not silently reused across different live units or missing inventory rows', () => {
  const live = [{ StockCode: 'P', StockUom: 'EA', B_WIP01_SOH: 0, B_RAW01_SOH: 0 },
    { StockCode: 'C', StockUom: 'KG', B_WIP01_SOH: 2, B_RAW01_SOH: 20 }];
  const overlay = inventory.mergeSysproInventory(items, live);
  const rows = [line({ componentUom: 'KG' })];
  const result = prod(rows, { items: overlay });
  assert.equal(result.childRequirements[0].grossRequirement, 20);
  assert.equal(result.childRequirements[0].storeRequestQty, null);
  assert.equal(result.complete, false);
  assert.ok(result.dataIssues.some((issue) => /pack-size UOM/i.test(issue)));
  const computed = engine.runMRP(overlay, ledger.adaptLedgerBoms(overlay, rows), [], [], 1, new Date('2026-11-09'));
  assert.equal(computed['child-id'].GR[0], null);
  assert.ok(computed['child-id'].issues.some((issue) => /balance UOM/i.test(issue)));
  const missing = inventory.mergeSysproInventory(items, [live[0]]);
  assert.equal(prod([line()], { items: missing }).childRequirements[0].productionShortfall, null);
});

test('missing references, duplicate lines, alternatives, dates and nested assemblies remain unresolved', () => {
  const cases = [
    [line(), line({ sequence: '000001' })],
    [line(), line({ route: '1', componentStockCode: 'P' })],
    [line({ componentStockCode: 'MISSING' })],
    [line({ structureOffDate: '2026-01-01' })],
    [line({ fixedQtyPerFlag: 'Y' })],
    [line(), line({ parentStockCode: 'C', componentStockCode: 'P' })],
  ];
  for (const rows of cases) {
    const before = JSON.stringify(rows);
    assert.equal(prod(rows).complete, false);
    assert.ok(recon(rows).rows.every((row) => row.status !== 'Tied'));
    assert.equal(JSON.stringify(rows), before);
  }
  const cycle = ledger.adaptLedgerBoms(items, [line(), line({ parentStockCode: 'C', componentStockCode: 'P' })]);
  const result = engine.runMRP(items, cycle, [{ itemId: 'parent-id', dueDate: '2026-11-13', qty: 10 }], [], 1, new Date('2026-11-09'));
  assert.equal(result['parent-id'].GR[0], null);
  assert.ok(result['parent-id'].issues.some((text) => /cycle/i.test(text)));
});

test('valid nested ledger explosion remains supported with saved item policies', () => {
  const allItems = [...items, { id: 'leaf', code: 'L', type: 'Buy', uom: 'EA', onHand: 0, lotSize: 1 }];
  const rows = [line(), line({ parentStockCode: 'C', componentStockCode: 'L', qtyPer: 3 })];
  const result = engine.runMRP(allItems, ledger.adaptLedgerBoms(allItems, rows), [{ itemId: 'parent-id', dueDate: '2026-11-13', qty: 10 }], [], 1, new Date('2026-11-09'));
  assert.equal(result['child-id'].GR[0], 20); assert.equal(result.leaf.GR[0], 60);
});

test('ledger rejects a cycle below the selected parent and protects disconnected valid demand', () => {
  const allItems = [...items, { id: 'assembly', code: 'A', type: 'Make', uom: 'EA', onHand: 0 },
    { id: 'independent', code: 'INDEPENDENT', type: 'Buy', uom: 'EA', onHand: 0 }];
  const rows = [line(), line({ parentStockCode: 'C', componentStockCode: 'A' }), line({ parentStockCode: 'A', componentStockCode: 'C' })];
  const result = engine.runMRP(allItems, ledger.adaptLedgerBoms(allItems, rows),
    [{ itemId: 'independent', qty: 4, dueDate: '2026-11-13' }], [], 1, new Date('2026-11-09'));
  assert.equal(result['parent-id'].incomplete, true);
  assert.equal(result['parent-id'].GR[0], null);
  assert.equal(result.independent.GR[0], 4);
});

test('BOM API distinguishes connected empty data from unavailable data and retains malformed source rows', async () => {
  const db = require('../server/db');
  const original = db.query;
  const app = require('express')(); app.use(require('../server/routes/inventory'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    db.query = async (sql) => { assert.match(sql.trim(), /^SELECT\b/i); return []; };
    let response = await fetch(`${base}/bom`);
    assert.equal(response.status, 200); assert.equal((await response.json()).count, 0);
    db.query = async () => [{ ParentPart: ' P ', Component: ' ', QtyPer: ' ', Route: '1', SequenceNum: '1' }];
    response = await fetch(`${base}/bom`);
    const data = (await response.json()).data;
    assert.equal(data.length, 1); assert.equal(data[0].componentStockCode, ''); assert.equal(data[0].qtyPerState, 'blank');
    db.query = async () => { throw Error('Synthetic BOM SQL outage'); };
    response = await fetch(`${base}/bom`);
    assert.equal(response.status, 503); assert.equal((await response.json()).success, false);
    assert.equal((await fetch(`${base}/bom`, { method: 'POST' })).status, 404);
  } finally {
    db.query = original;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('source outage, empty BOM, and missing stock are distinct from zero material required', () => {
  assert.equal(prod([line()], { bomAvailable: false }).childRequirements[0].grossRequirement, null);
  assert.equal(prod([line()], { inventoryAvailable: false }).childRequirements[0].productionShortfall, null);
  const empty = prod([]);
  assert.equal(empty.productionPlan.length, 1); assert.equal(empty.complete, false);
  assert.ok(empty.dataIssues.some((issue) => /missing/i.test(issue)));
  assert.equal(recon([line()], { bomAvailable: false }).rows[0].status, 'Data incomplete');
  for (const state of [{ connected: true, loading: true }, { connected: true, error: 'offline' }, { connected: false }]) assert.equal(validation.bomSourceReady(state), false);
  assert.equal(validation.bomSourceReady({ connected: true, loading: false, error: null }), true);
});

test('Sheet Analysis does not claim completeness from stock UOM names without factor-unit evidence', () => {
  const args = { date: '2026-11-13', shift: 'morning', bomAvailable: true,
    planningEntries: [{ id: 'plan', day: '2026-11-13', partNumber: 'P', productionLine: 'thermoforming', shift: 'SHIFT 01' }],
    productionActuals: [{ id: 'actual', planningEntryId: 'plan', actualMouldQty: 10 }],
    inventory: [{ StockCode: 'P', StockUom: 'EA' }, { StockCode: '120002', StockUom: 'SHEET' }],
    boms: [line({ componentStockCode: '120002', componentUom: 'SHEET', factorUnitsVerified: undefined })] };
  let row = sheet.deriveSheetAnalysis(args).summaries[0];
  assert.equal(row.expectedConsumption, null); assert.equal(row.partialExpectedConsumption, null);
  assert.equal(row.calculationComplete, false); assert.ok(row.issues.some((text) => /factor units.*unverified/i.test(text)));
  row = sheet.deriveSheetAnalysis({ ...args, boms: [line({ componentStockCode: '120002', componentUom: 'SHEET' })] }).summaries[0];
  assert.equal(row.expectedConsumption, 20);
});

test('FCSD blank factors, duplicates and alternatives cannot produce complete consolidated totals', () => {
  const parent = 'N1WZ-17906-HU';
  const args = { finishedParts: [{ stockCode: parent, quantity: 10 }], candidates: [{ stockCode: parent, uom: 'EA' }, { stockCode: 'C', uom: 'EA' }] };
  for (const bomRows of [[line({ parentStockCode: parent, qtyPer: ' ' })],
    [line({ parentStockCode: parent }), line({ parentStockCode: parent, sequence: '000001' })],
    [line({ parentStockCode: parent }), line({ parentStockCode: parent, route: '1' })]]) {
    const result = fcsd.calculateFcsdRequirements({ ...args, bomRows });
    assert.equal(result.complete, false); assert.equal(result.requirements[0].grossRequirement, null);
  }
});

test('PDF export independently rejects incomplete input before fetching images or saving a file', async () => {
  const { exportStoreRequestPdf } = await import('../mrp-planner/src/production/exportStoreRequestPdf.js');
  await assert.rejects(exportStoreRequestPdf({ storeRequests: [], complete: false }), /incomplete/i);
  await assert.rejects(exportStoreRequestPdf({ storeRequests: prod([line({ qtyPer: null })]).storeRequests, complete: true }), /incomplete/i);
});
