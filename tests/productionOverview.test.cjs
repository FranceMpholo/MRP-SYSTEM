const test = require("node:test");
const assert = require("node:assert/strict");
let derive;
test.before(async () => { ({ deriveProductionOverview: derive } = await import("../mrp-planner/src/dashboard/deriveProductionOverview.js")); });
const weekStart = "2026-11-09";
const plan = (overrides = {}) => ({ id: "thermo", productionLine: "thermoforming", machine: "AR1", day: "2026-11-10", partNumber: "N1WB-E12606-SCP", status: "Planned", buildQty: 10, ...overrides });
const actual = (qty, overrides = {}) => ({ id: "capture", planningEntryId: "thermo", actualMouldQty: qty, ...overrides });
const summary = (entries, productionActuals = [], extra = {}) => derive({ weekStart, planningWeeks: { [weekStart]: { entries } }, productionActuals, ...extra });

test("scopes lines and active week without adding mould sets to individual parts", () => {
  const result = summary([plan({ adjustedPlanQty: 8 }), plan({ id: "blow", productionLine: undefined, machine: "BM01", partNumber: "N1WB_BAA_PAIR", buildQty: 20 })], [actual(4), actual(10, { planningEntryId: "blow" }), actual(100, { planningEntryId: "other-week" })], {
    planningWeeks: { [weekStart]: { entries: [plan({ adjustedPlanQty: 8 }), plan({ id: "blow", productionLine: undefined, machine: "BM01", partNumber: "N1WB_BAA_PAIR", buildQty: 20 })] }, "2026-11-16": { entries: [plan({ id: "other-week", day: "2026-11-17", buildQty: 999 })] } },
  });
  assert.equal(result.thermoforming.planned, 8);
  assert.equal(result.thermoforming.actual, 4);
  assert.equal(result.thermoforming.achievementPct, 50);
  assert.equal(result.thermoforming.unit, "assembly-completed parts");
  assert.equal(result.blowMoulding.planned, 20);
  assert.equal(result.blowMoulding.actual, 10);
  assert.equal(result.blowMoulding.unit, "mould sets");
  assert.deepEqual(Object.keys(result).sort(), ["blowMoulding", "thermoforming"]);
});
test("missing and blank captures differ from confirmed numeric zero", () => {
  for (const rows of [[], [actual("")], [actual("  ")], [actual(null)]]) {
    const r = summary([plan()], rows).thermoforming;
    assert.equal(r.state, "incomplete"); assert.equal(r.actual, null); assert.equal(r.achievementPct, null); assert.equal(r.missing, 1);
  }
  const zero = summary([plan()], [actual(0)]).thermoforming;
  assert.equal(zero.state, "complete"); assert.equal(zero.actual, 0); assert.equal(zero.achievementPct, 0);
});
test("partial captures never imply a complete weekly actual or achievement", () => {
  const r = summary([plan(), plan({ id: "second" })], [actual(6)]).thermoforming;
  assert.equal(r.captured, 1); assert.equal(r.missing, 1); assert.equal(r.planned, 20); assert.equal(r.actual, null); assert.equal(r.achievementPct, null);
});
test("duplicate actuals remain unresolved regardless of timestamps, order or equal values", () => {
  const rows = [actual(5, { updatedAt: "2026-11-10T10:00:00Z" }), actual(7, { id: "correction", updatedAt: "2026-11-10T12:00:00Z" })];
  for (const captures of [rows, [...rows].reverse(), [actual(5), actual(5)]]) {
    const r = summary([plan()], captures).thermoforming;
    assert.equal(r.duplicate, 1); assert.equal(r.actual, null); assert.equal(r.achievementPct, null);
  }
});
test("unverified product units, invalid scope and duplicate plan identity suppress comparisons", () => {
  for (const entry of [plan({ partNumber: "UNKNOWN" }), plan({ machine: "BM01" }), plan({ day: "2026-11-18" }), plan({ buildQty: "" }), plan({ adjustedPlanQty: -1 }), plan({ id: undefined }), plan({ productionLine: "blowMoulding", machine: "BM01", partNumber: "N1WB-16450-BAA" })]) {
    const r = summary([entry], [actual(2)]); const line = r[entry.productionLine];
    assert.equal(line.planned, null); assert.equal(line.actual, null); assert.equal(line.state, "incomplete");
  }
  const duplicate = summary([plan(), plan()], [actual(2)]).thermoforming;
  assert.equal(duplicate.planned, null); assert.ok(duplicate.issues.some((issue) => issue.includes("identity")));
  const crossWeek = summary([plan()], [actual(2)], { planningWeeks: { [weekStart]: { entries: [plan()] }, "2026-11-16": { entries: [plan({ day: "2026-11-17" })] } } }).thermoforming;
  assert.equal(crossWeek.actual, null);
});
test("invalid actual values and mismatched explicit line are not zeroes", () => {
  for (const capture of [actual(-1), actual("NaN"), actual(true), actual(4, { productionLine: "blowMoulding" })]) {
    const r = summary([plan()], [capture]).thermoforming;
    assert.equal(r.invalid, 1); assert.equal(r.actual, null); assert.equal(r.achievementPct, null);
  }
});
test("OFF and changeover are excluded, zero plans have no achievement, empty weeks are unavailable", () => {
  const r = summary([plan({ buildQty: 0 }), plan({ id: "off", status: "OFF" }), plan({ id: "change", status: "Changeover" })], [actual(0)]).thermoforming;
  assert.equal(r.runCount, 1); assert.equal(r.actual, 0); assert.equal(r.achievementPct, null);
  const empty = summary([]).thermoforming;
  assert.equal(empty.planned, null); assert.equal(empty.actual, null); assert.equal(empty.state, "unavailable");
});
test("selector is read-only and never expands expected tailgates into actual output", () => {
  const input = { weekStart, planningWeeks: { [weekStart]: { entries: [plan()] } }, productionActuals: [actual(3)] };
  const before = JSON.stringify(input);
  assert.equal(derive(input).thermoforming.actual, 3);
  assert.equal(JSON.stringify(input), before);
});
test("Thermoforming uses the existing machine family restrictions and includes FCSD assembly completions without a separate additive total", () => {
  const tpo = plan({ partNumber: "N1WB-J13036-B", machine: "AR3" });
  const completed = summary([tpo], [actual(4)]).thermoforming;
  assert.equal(completed.actual, 4);
  assert.equal(summary([{ ...tpo, machine: "AR1" }], [actual(4)]).thermoforming.actual, null);
  const fcsd = summary([plan({ partNumber: "JB3Z-2600038-A" })], [actual(3)]);
  assert.equal(fcsd.thermoforming.actual, 3);
  assert.equal(fcsd.fcsd, undefined);
  assert.equal(fcsd.total, undefined);
});
