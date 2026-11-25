const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const utilsUrl = pathToFileURL(path.join(__dirname, "..", "mrp-planner", "src", "cycleCount", "cycleCountUtils.js")).href;
let cycle;
test.before(async () => { cycle = await import(utilsUrl); });

const inventory = [
  { StockCode: "120002", Description: "Sheet A", StockUom: "EA", B_WIP01_SOH: 12.5 },
  { StockCode: "121047", Description: "Sheet B", StockUom: "KG", B_WIP01_SOH: 0 },
  { StockCode: "120003", Description: "Sheet C", StockUom: "EA", B_WIP01_SOH: 4 },
  { StockCode: "OPTIONAL-1", Description: "Optional material", StockUom: "EA", B_WIP01_SOH: 2 },
];
const newThermoDay = () => cycle.createCycleCountDay("2026-11-13", "thermoforming", "user-1", inventory);
const setRequiredCounts = (day, shift = "morning", value = 0) => ({
  ...day,
  countRecords: day.countRecords.map((record) => record.shift === shift && cycle.REQUIRED_THERMOFORMING_SHEETS.includes(record.stockCode)
    ? { ...record, physicalCount: value, countedByUserId: "counter-1", countedAt: "2026-11-13T10:00:00.000Z" }
    : record),
});

test("new Thermoforming count creates all mandatory sheet rows for every configured shift", () => {
  const day = newThermoDay();
  assert.deepEqual(day.items.map((item) => item.stockCode), ["120002", "121047", "120003"]);
  assert.ok(day.items.every((item) => item.requiredEachShift));
  assert.equal(day.countRecords.length, 3 * cycle.CYCLE_COUNT_SHIFTS.length);
  for (const shift of cycle.CYCLE_COUNT_SHIFTS) {
    assert.deepEqual(cycle.getCycleCountRecords(day, shift.id).map((record) => record.stockCode), cycle.REQUIRED_THERMOFORMING_SHEETS);
  }
  assert.equal(day.items[0].description, "Sheet A");
  assert.equal(day.items[1].uom, "KG");
  assert.equal(day.countRecords[0].warehouse, "B-WIP01");
  assert.equal(day.countRecords[0].location, null);
  assert.equal(day.countRecords[0].productionDate, day.date);
  assert.ok(day.countRecords.every((record) => record.expectedEosSoh === null));
});

test("legacy live-stock EOS and variance are ignored without a matching historical balance", () => {
  const record = { stockCode: '120002', physicalCount: 9, expectedEosSoh: 100, variance: -91, status: 'VARIANCE' };
  const unchanged = JSON.stringify(record);
  assert.deepEqual(cycle.getCycleCountComparison(record, null, '2026-11-13', 'morning'), { expectedEosSoh: null, variance: null, status: 'COUNTED' });
  const balance = { stockCode: '120002', warehouse: 'B-WIP01', productionDate: '2026-11-13', shift: 'morning', status: 'available', expectedEosSoh: 10 };
  assert.equal(cycle.getCycleCountComparison(record, balance, '2026-11-13', 'morning').variance, -1);
  assert.equal(cycle.getCycleCountComparison(record, balance, '2026-11-14', 'morning').expectedEosSoh, null);
  assert.equal(cycle.getCycleCountComparison(record, balance, '2026-11-13', 'night').expectedEosSoh, null);
  assert.equal(cycle.getCycleCountComparison(record, { ...balance, warehouse: 'B-RAW01' }, '2026-11-13', 'morning').expectedEosSoh, null);
  assert.equal(cycle.getCycleCountComparison(record, { ...balance, expectedEosSoh: 0 }, '2026-11-13', 'morning').variance, 9);
  assert.equal(JSON.stringify(record), unchanged);
});

test("mandatory rows cannot be removed and their stock-code list is immutable", () => {
  const day = newThermoDay();
  for (const stockCode of cycle.REQUIRED_THERMOFORMING_SHEETS) {
    assert.equal(cycle.removeDailyItem(day, stockCode, "user-1"), day);
  }
  assert.equal(Object.isFrozen(cycle.REQUIRED_THERMOFORMING_SHEETS), true);
  assert.deepEqual(day.items.map((item) => item.stockCode), ["120002", "121047", "120003"]);
});

test("blank required sheets block completion while explicit zero is accepted", () => {
  const day = newThermoDay();
  assert.equal(cycle.getRequiredSheetProgress(day, "morning").counted, 0);
  assert.equal(cycle.canSubmitCycleCountShift(day, "morning"), false);
  const zeroCounts = setRequiredCounts(day);
  assert.equal(cycle.getRequiredSheetProgress(zeroCounts, "morning").counted, 3);
  assert.equal(cycle.canSubmitCycleCountShift(zeroCounts, "morning"), true);
  assert.equal(cycle.automaticStatus(0, 0), "COUNTED");
});

test("physical quantities reject invalid and negative values and retain supported decimal precision", () => {
  for (const value of ["NaN", "Infinity", "-1", "0.12345", "not-a-number"]) assert.equal(cycle.isValidPhysicalQuantity(value), false, String(value));
  for (const value of [0, "0", 3.25, "0.0001", 1.2345]) assert.equal(cycle.isValidPhysicalQuantity(value), true, String(value));
});

test("optional stock codes can be added and removed without duplicating their scoped rows", () => {
  let day = cycle.createCycleCountDay("2026-11-13", "blowMoulding", "user-1", inventory);
  day = cycle.addDailyItem(day, inventory[3], "user-1");
  const once = day;
  day = cycle.addDailyItem(day, { ...inventory[3], StockCode: " optional-1 " }, "user-1");
  assert.equal(day, once);
  assert.equal(day.items.length, 1);
  assert.equal(day.countRecords.length, cycle.CYCLE_COUNT_SHIFTS.length);
  day = cycle.removeDailyItem(day, "OPTIONAL-1", "user-1");
  assert.equal(day.items.length, 0);
  assert.equal(day.countRecords.length, 0);
});

test("records with the same code are separated by warehouse/location but duplicates within B-WIP01 block submit", () => {
  const day = setRequiredCounts(newThermoDay());
  const duplicate = { ...day.countRecords[0], id: "duplicate", updatedAt: "2026-11-13T11:00:00.000Z" };
  const otherWarehouse = { ...day.countRecords[0], id: "other-warehouse", warehouse: "B-RAW01" };
  const otherLocation = { ...day.countRecords[0], id: "other-location", location: "BIN-2" };
  const withOtherScopes = { ...day, countRecords: [...day.countRecords, otherWarehouse, otherLocation] };
  assert.equal(cycle.getCycleCountRecords(withOtherScopes, "morning").length, 3);
  assert.equal(cycle.hasDuplicateCycleCountRecords(withOtherScopes, "morning"), false);
  const withDuplicate = { ...day, countRecords: [...day.countRecords, duplicate] };
  assert.equal(cycle.hasDuplicateCycleCountRecords(withDuplicate, "morning"), true);
  assert.equal(cycle.canSubmitCycleCountShift(withDuplicate, "morning"), false);
});

test("saved counts reopen with recorder and timestamp intact and do not create duplicate rows", () => {
  const source = setRequiredCounts(newThermoDay(), "morning", 12.3456);
  const reopened = JSON.parse(JSON.stringify(source));
  assert.equal(cycle.getCycleCountRecords(reopened, "morning").find((record) => record.stockCode === "120002").physicalCount, 12.3456);
  assert.equal(cycle.getCycleCountRecords(reopened, "morning").find((record) => record.stockCode === "120002").countedByUserId, "counter-1");
  assert.equal(cycle.getCycleCountRecords(reopened, "morning").find((record) => record.stockCode === "120002").countedAt, "2026-11-13T10:00:00.000Z");
  assert.equal(cycle.getCycleCountRecords(reopened, "afternoon").find((record) => record.stockCode === "120002").physicalCount, null);
  const differentDate = cycle.createCycleCountDay("2026-11-14", "thermoforming", "user-1", inventory);
  assert.equal(cycle.getCycleCountRecords(differentDate, "morning").find((record) => record.stockCode === "120002").physicalCount, null);
  assert.equal(cycle.prepareCycleCountShift(reopened, "morning", inventory, "user-1").countRecords.length, reopened.countRecords.length);
});

test("legacy records load without destructive backfill and report required-sheet incompleteness", () => {
  const legacy = {
    id: "legacy-day",
    date: "2026-10-01",
    productionLine: "thermoforming",
    items: [{ stockCode: "OPTIONAL-1", description: "Old sheet", uom: "EA" }],
    countRecords: [{ id: "old-count", stockCode: "OPTIONAL-1", shift: "morning", physicalCount: 2, countedByUserId: "old-counter", countedAt: "2026-10-01T09:00:00Z" }],
    shifts: [{ shift: "morning", supervisorUserId: "old-supervisor", teamLeaderUserId: "old-leader", submittedByUserId: "old-counter", submittedAt: "2026-10-01T10:00:00Z" }],
  };
  const before = JSON.stringify(legacy);
  const progress = cycle.getRequiredSheetProgress(legacy, "morning");
  assert.equal(progress.legacyIncomplete, true);
  assert.equal(progress.counted, 0);
  const displayItems = cycle.getCycleCountDisplayItems(legacy, inventory);
  assert.deepEqual(displayItems.slice(0, 3).map((item) => item.stockCode), cycle.REQUIRED_THERMOFORMING_SHEETS);
  assert.equal(displayItems[0].description, "Sheet A");
  assert.equal(displayItems[0].requiredEachShift, true);
  assert.equal(JSON.stringify(legacy), before);
  assert.equal(cycle.prepareCycleCountShift(legacy, "morning", inventory, "user-1"), legacy);
  assert.equal(JSON.stringify(legacy), before);
});

test("preparing a legacy draft adds blank required rows only for the active shift", () => {
  const legacy = { ...newThermoDay(), items: [], countRecords: [] };
  const prepared = cycle.prepareCycleCountShift(legacy, "afternoon", inventory, "user-1");
  assert.equal(prepared.items.length, 3);
  assert.equal(prepared.countRecords.length, 3);
  assert.ok(prepared.countRecords.every((record) => record.shift === "afternoon" && record.physicalCount === null));
  assert.equal(cycle.getRequiredSheetProgress(prepared, "afternoon").counted, 0);
  assert.equal(cycle.getRequiredSheetProgress(prepared, "morning").missingRows.length, 3);
});

test("non-Thermoforming lines do not receive mandatory sheets and retain optional-list behavior", () => {
  let day = cycle.createCycleCountDay("2026-11-13", "blowMoulding", "user-1", inventory);
  assert.equal(day.items.length, 0);
  assert.equal(cycle.getRequiredSheetProgress(day, "morning").required, 0);
  day = cycle.addDailyItem(day, inventory[3], "user-1");
  const record = { ...day.countRecords.find((entry) => entry.shift === "morning"), physicalCount: 0 };
  day = { ...day, countRecords: day.countRecords.map((entry) => entry.id === record.id ? record : entry) };
  assert.equal(cycle.canSubmitCycleCountShift(day, "morning"), true);
  const submitted = cycle.submitCycleCountShift(day, "morning", "counter-1", "2026-11-13T12:00:00.000Z");
  assert.equal(submitted.shifts.find((entry) => entry.shift === "morning").submittedByUserId, "counter-1");
});
