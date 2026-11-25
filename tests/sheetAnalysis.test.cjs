const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const moduleUrl = pathToFileURL(path.join(__dirname, "..", "mrp-planner", "src", "dashboard", "deriveSheetAnalysis.js")).href;
let analysis;
test.before(async () => { analysis = await import(moduleUrl); });

const codes = ["120002", "121047", "120003"];
const countDay = (date, shift, values = {}) => ({
  date, productionLine: "thermoforming", warehouse: "B-WIP01",
  shifts: [{ shift, submittedAt: "2026-11-13T15:00:00.000Z" }],
  countRecords: codes.map((stockCode) => ({ stockCode, shift, warehouse: "B-WIP01", location: null, physicalCount: Object.hasOwn(values, stockCode) ? values[stockCode] : 0, countedAt: "2026-11-13T14:50:00.000Z" })),
});
const plan = (id, partNumber, shift = "SHIFT 01", day = "2026-11-13") => ({ id, partNumber, productionLine: "thermoforming", machine: "AR1", shift, day, status: "Planned", buildQty: 20 });
const actual = (id, planningEntryId, actualMouldQty, updatedAt) => ({ id, planningEntryId, actualMouldQty, updatedAt });
const boms = [
  { parentStockCode: "BED-1", parentDescription: "Bedliner", componentStockCode: "120002", componentDescription: "Sheet A", qtyPer: 2.5 },
  { parentStockCode: "TAIL-1", parentDescription: "Tailgate", componentStockCode: "120002", componentDescription: "Sheet A", qtyPer: 1.25 },
  { parentStockCode: "BED-1", parentDescription: "Bedliner", componentStockCode: "121047", componentDescription: "Sheet B", qtyPer: 0.5 },
].map((row) => ({ ...row, parentUom: "EA", componentUom: row.componentStockCode === "121047" ? "KG" : "SHEET", factorUnitsVerified: true, qtyPerBasis: "stocking" }));
const inventory = [
  { StockCode: "BED-1", StockUom: "EA" }, { StockCode: "TAIL-1", StockUom: "EA" },
  { StockCode: "120002", StockUom: "SHEET", B_WIP01_SOH: 40 },
  { StockCode: "121047", StockUom: "KG", B_WIP01_SOH: 0 },
  { StockCode: "120003", StockUom: "EA", B_WIP01_SOH: 7 },
];
const base = (overrides = {}) => ({
  date: "2026-11-13", shift: "morning", cycleCountDays: [countDay("2026-11-13", "morning", { "120002": 0 })],
  planningEntries: [plan("p1", "BED-1"), plan("p2", "TAIL-1")],
  productionActuals: [actual("a1", "p1", 8, "2026-11-13T13:00:00.000Z"), actual("a2", "p2", 4, "2026-11-13T13:10:00.000Z")],
  boms, bomAvailable: true, inventory, inventoryAvailable: true,
  inventoryCapturedAt: "2026-11-13T16:00:00.000Z", ...overrides,
});

test("uses only submitted end-of-shift counts and distinguishes explicit zero from missing", () => {
  let result = analysis.deriveSheetAnalysis(base());
  assert.equal(result.summaries[0].physical.quantity, 0);
  assert.equal(result.summaries[0].physical.status, "Submitted closing count");
  const missing = countDay("2026-11-13", "morning", { "121047": 2, "120003": 3 });
  result = analysis.deriveSheetAnalysis(base({ cycleCountDays: [{ ...missing, countRecords: missing.countRecords.filter((row) => row.stockCode !== "120002") }] }));
  assert.equal(result.summaries[0].physical.quantity, null);
  assert.match(result.summaries[0].physical.status, /incomplete|legacy/i);
  const draft = { ...countDay("2026-11-13", "morning", { "120002": 9 }), shifts: [{ shift: "morning", submittedAt: null }] };
  result = analysis.deriveSheetAnalysis(base({ cycleCountDays: [draft] }));
  assert.equal(result.summaries[0].physical.quantity, 9);
  assert.equal(result.summaries[0].physical.status, "Draft — not submitted");
});

test("keeps dates and shifts separate and follows the configured overnight sequence", () => {
  assert.deepEqual(analysis.priorShiftSlot("2026-11-13", "morning"), { date: "2026-11-12", shift: "night" });
  assert.deepEqual(analysis.priorShiftSlot("2026-11-13", "night"), { date: "2026-11-13", shift: "afternoon" });
  const result = analysis.deriveSheetAnalysis(base({ shift: "afternoon", planningEntries: [plan("p1", "BED-1", "SHIFT 02")], productionActuals: [actual("a1", "p1", 8, "2026-11-13T20:00:00Z")] }));
  assert.equal(result.summaries[0].physical.status, "No Cycle Count record");
  assert.equal(result.summaries[0].expectedConsumption, 20);
  const empty = analysis.deriveSheetAnalysis(base({ shift: "afternoon", planningEntries: [], productionActuals: [] }));
  assert.equal(empty.summaries[0].expectedConsumption, null);
  assert.match(empty.summaries[0].issues.join(" "), /No planned Thermoforming production entries/i);
});

test("uses direct BOM factors and consolidates shared-sheet requirements with evidence", () => {
  const result = analysis.deriveSheetAnalysis(base());
  const sheetA = result.summaries.find((row) => row.stockCode === "120002");
  assert.equal(sheetA.expectedConsumption, 25);
  assert.deepEqual(sheetA.contributions.map((row) => row.expectedQty), [20, 5]);
  assert.deepEqual(sheetA.contributions.map((row) => row.bomQtyPer), [2.5, 1.25]);
  assert.equal(sheetA.contributions[0].parentUom, "EA");
});

test("flags missing, nested, cyclic, duplicate, and UOM-incomplete BOM mappings", () => {
  let result = analysis.deriveSheetAnalysis(base({ planningEntries: [plan("p1", "MISSING")], productionActuals: [actual("a1", "p1", 1, "2026-11-13T10:00:00Z")] }));
  assert.equal(result.summaries[0].expectedConsumption, null);
  assert.match(result.summaries[0].issues.join(" "), /BOM is missing/i);
  const nestedBoms = [{ parentStockCode: "BED-1", componentStockCode: "SUB-1", qtyPer: 1 }, { parentStockCode: "SUB-1", componentStockCode: "120002", qtyPer: 2 }];
  result = analysis.deriveSheetAnalysis(base({ boms: nestedBoms }));
  assert.match(result.summaries[0].issues.join(" "), /below a BOM subassembly/i);
  const cycleBoms = [{ parentStockCode: "BED-1", componentStockCode: "SUB-1", qtyPer: 1 }, { parentStockCode: "SUB-1", componentStockCode: "BED-1", qtyPer: 1 }, { parentStockCode: "SUB-1", componentStockCode: "120002", qtyPer: 2 }];
  result = analysis.deriveSheetAnalysis(base({ boms: cycleBoms }));
  assert.match(result.summaries[0].issues.join(" "), /cycle detected/i);
  result = analysis.deriveSheetAnalysis(base({ boms: [boms[0], boms[0]], inventory: inventory.filter((row) => row.StockCode !== "BED-1") }));
  assert.match(result.summaries[0].issues.join(" "), /multiple direct/i);
  result = analysis.deriveSheetAnalysis(base({ boms: [boms[0]], inventory: inventory.filter((row) => row.StockCode !== "BED-1") }));
  assert.match(result.summaries[0].issues.join(" "), /UOM is missing/i);
});

test("selects corrected latest actual per plan without double-counting older duplicates", () => {
  const result = analysis.deriveSheetAnalysis(base({ productionActuals: [
    actual("old", "p1", 100, "2026-11-13T11:00:00Z"),
    actual("new", "p1", 8, "2026-11-13T13:00:00Z"),
    actual("a2", "p2", 4, "2026-11-13T13:10:00Z"),
  ] }));
  assert.equal(result.summaries[0].expectedConsumption, 25);
  assert.equal(result.summaries[0].contributions[0].actualMouldQty, 8);
  assert.equal(result.summaries[0].contributions[0].replacedActualRows, 1);
  const tied = analysis.deriveSheetAnalysis(base({ productionActuals: [
    actual("one", "p1", 8, "2026-11-13T13:00:00Z"), actual("two", "p1", 9, "2026-11-13T13:00:00Z"),
    actual("a2", "p2", 4, "2026-11-13T13:10:00Z"),
  ] }));
  assert.equal(tied.summaries[0].expectedConsumption, null);
  assert.match(tied.summaries[0].issues.join(" "), /ordering is ambiguous/i);
});

test("never compares current inventory with a historical shift close", () => {
  const row = analysis.deriveSheetAnalysis(base()).summaries[0];
  assert.equal(row.currentSystemBalance, 40);
  assert.equal(row.historicalSystemBalance, null);
  assert.match(row.currentSystemBalanceStatus, /timing not aligned/i);
  assert.match(row.historicalSystemBalanceStatus, /unavailable/i);
});

test("does not combine direct BOM requirements across incompatible parent stock units", () => {
  const result = analysis.deriveSheetAnalysis(base({ boms: boms.map((row) => row.parentStockCode === "TAIL-1" ? { ...row, parentUom: "KG" } : row), inventory: inventory.map((item) => item.StockCode === "TAIL-1" ? { ...item, StockUom: "KG" } : item) }));
  const row = result.summaries.find((item) => item.stockCode === "120002");
  assert.equal(row.expectedConsumption, null);
  assert.match(row.issues.join(" "), /incompatible parent stock units/i);
  assert.equal(row.partialExpectedConsumption, 25);
});

test("does not bridge missing prior counts without complete movement coverage", () => {
  const result = analysis.deriveSheetAnalysis(base());
  assert.equal(result.priorSlot.date, "2026-11-12");
  assert.equal(result.priorShiftCount.exists, false);
  assert.match(result.movementCoverage, /cannot be rolled forward/i);
  assert.equal(result.summaries[0].historicalSystemBalance, null);
});

test("keeps FG posting comparison separate and labels posting-date versus shift timing", () => {
  const outputs = [{ parentStockCode: "BED-1", actualQuantity: 8 }];
  const rows = analysis.compareFgPostings({ productionOutputs: outputs, date: "2026-11-13", movements: [
    { date: "2026-11-13", stockCode: "BED-1", uom: "EA", direction: "Into FG", quantity: 5 },
    { date: "2026-11-13", stockCode: "BED-1", uom: "EA", direction: "FG to WIP", quantity: 1 },
  ] });
  assert.equal(rows[0].productionActual, 8);
  assert.equal(rows[0].intoFg, 5);
  assert.equal(rows[0].fgToWip, 1);
  assert.match(rows[0].status, /no shift allocation/i);
  assert.equal(analysis.compareFgPostings({ productionOutputs: outputs, movements: [], date: "2026-11-13" })[0].status, "No FG posting in selected posting-date range");
});
