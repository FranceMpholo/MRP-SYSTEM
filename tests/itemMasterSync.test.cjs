"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  classifyItem,
  normalizeSourceRows,
  planItemChanges,
  synchronizeItemMaster,
} = require("../server/services/itemMasterSync");

function sourceRow(overrides = {}) {
  return {
    StockCode: "ITEM-1",
    MasterStockCode: "ITEM-1",
    Description: "Item one",
    StockUom: "EA",
    PartCategory: "M",
    ProductClass: "FG",
    StockOnHold: "N",
    StockOnHoldReason: "",
    SupercessionDate: null,
    DateStkAdded: "2020-01-01",
    IsBomParent: 1,
    IsBomComponent: 0,
    ...overrides,
  };
}

function readOnlyPostgres(existingRows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: existingRows };
    },
    pool: {
      async connect() {
        calls.push({ sql: "CONNECT" });
        throw new Error("A write connection must not be opened");
      },
    },
  };
}

test("classifies BOM parent, component, and dual-role items", () => {
  assert.equal(classifyItem(true, false), "BOM_PARENT");
  assert.equal(classifyItem(false, true), "BOM_COMPONENT");
  assert.equal(classifyItem(true, true), "BOM_PARENT_COMPONENT");
});

test("normalizes whitespace while preserving stock-code and UOM case", () => {
  const { items } = normalizeSourceRows([sourceRow({
    StockCode: "  MiXeD-1  ", MasterStockCode: " MiXeD-1 ", Description: "  A product  ", StockUom: "  Kg  ",
  })]);
  assert.equal(items[0].stockCode, "MiXeD-1");
  assert.equal(items[0].normalizedStockCode, "MIXED-1");
  assert.equal(items[0].description, "A product");
  assert.equal(items[0].uom, "Kg");
});

test("rejects blank BOM stock codes", () => {
  assert.throws(() => normalizeSourceRows([sourceRow({ StockCode: "   " })]), (error) => {
    assert.equal(error.code, "SOURCE_VALIDATION_FAILED");
    assert.equal(error.details.report.blankCodes, 1);
    return true;
  });
});

test("rejects a BOM code missing from InvMaster", () => {
  assert.throws(() => normalizeSourceRows([sourceRow({ MasterStockCode: null })]), (error) => {
    assert.equal(error.details.report.missingInvMasterRows, 1);
    return true;
  });
});

test("rejects normalized duplicate stock codes", () => {
  assert.throws(() => normalizeSourceRows([
    sourceRow({ StockCode: "item-1", MasterStockCode: "item-1" }),
    sourceRow({ StockCode: " ITEM-1 ", MasterStockCode: "ITEM-1" }),
  ]), (error) => {
    assert.equal(error.details.report.duplicateNormalizedCodes, 1);
    return true;
  });
});

test("rejects synthetic pair codes", () => {
  assert.throws(() => normalizeSourceRows([
    sourceRow({ StockCode: "N1WB_BAA_PAIR", MasterStockCode: "N1WB_BAA_PAIR" }),
  ]), /snapshot validation failed/i);
});

test("rejects collision with a TEST or local PostgreSQL item", () => {
  const { items } = normalizeSourceRows([sourceRow()]);
  assert.throws(() => planItemChanges(items, [{
    id: "local-id", stock_code: " item-1 ", source_system: "TEST",
  }]), (error) => error.code === "LOCAL_ITEM_COLLISION");
});

test("repeated planning is idempotent and preserves the existing SYSPRO UUID", () => {
  const { items } = normalizeSourceRows([sourceRow()]);
  const existing = [{
    id: "stable-uuid", stock_code: "ITEM-1", description: "Item one", uom: "EA",
    item_type: "BOM_PARENT", source_system: "SYSPRO", is_active: true,
  }];
  const options = { activityResolver: () => true };
  const first = planItemChanges(items, existing, options);
  const second = planItemChanges(items, existing, options);
  assert.equal(first.unchangedRows, 1);
  assert.equal(second.unchangedRows, 1);
  assert.equal(first.unchanged[0].existingId, "stable-uuid");
  assert.equal(first.proposedInserts, 0);
  assert.equal(first.proposedUpdates, 0);
});

test("detects a changed description as an update", () => {
  const { items } = normalizeSourceRows([sourceRow({ Description: "New description" })]);
  const plan = planItemChanges(items, [{
    id: "stable-uuid", stock_code: "ITEM-1", description: "Old description", uom: "EA",
    item_type: "BOM_PARENT", source_system: "SYSPRO", is_active: true,
  }], { activityResolver: () => true });
  assert.equal(plan.proposedUpdates, 1);
  assert.equal(plan.updates[0].existingId, "stable-uuid");
});

test("does not deactivate or otherwise plan changes for an item absent from the BOM snapshot", () => {
  const { items } = normalizeSourceRows([sourceRow()]);
  const plan = planItemChanges(items, [
    { id: "one", stock_code: "ITEM-1", description: "Item one", uom: "EA", item_type: "BOM_PARENT", source_system: "SYSPRO", is_active: true },
    { id: "historical", stock_code: "OLD-ITEM", description: "Old", uom: "EA", item_type: "BOM_PARENT", source_system: "SYSPRO", is_active: true },
  ], { activityResolver: () => true });
  assert.equal(plan.inserts.some((item) => item.stockCode === "OLD-ITEM"), false);
  assert.equal(plan.updates.some((item) => item.stockCode === "OLD-ITEM"), false);
});

test("dry-run calculates changes with PostgreSQL reads only", async () => {
  const postgres = readOnlyPostgres([]);
  const result = await synchronizeItemMaster({ sourceQuery: async () => [sourceRow()], postgres });
  assert.equal(result.applied, false);
  assert.equal(result.report.proposedInserts, 1);
  assert.equal(result.report.unresolvedRows, 1);
  assert.equal(postgres.calls.length, 1);
  assert.match(postgres.calls[0].sql, /^SELECT/i);
});

test("apply is refused before PostgreSQL access while activity policy is unresolved", async () => {
  const postgres = readOnlyPostgres([]);
  await assert.rejects(
    synchronizeItemMaster({ sourceQuery: async () => [sourceRow()], postgres, apply: true }),
    (error) => error.code === "ACTIVITY_POLICY_UNRESOLVED"
  );
  assert.equal(postgres.calls.length, 0);
});

test("source failure causes no PostgreSQL access or writes", async () => {
  const postgres = readOnlyPostgres([]);
  await assert.rejects(
    synchronizeItemMaster({ sourceQuery: async () => { throw new Error("offline"); }, postgres }),
    (error) => error.code === "SOURCE_UNAVAILABLE" && /no syspro item snapshot/i.test(error.message)
  );
  assert.equal(postgres.calls.length, 0);
});

test("SYSPRO SQL is SELECT-only and retains missing InvMaster rows with a left join", () => {
  const sqlPath = path.join(__dirname, "../server/queries/sysproItemMaster.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  const executable = sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(executable, /\bSELECT\b/i);
  assert.match(executable, /\bLEFT\s+JOIN\s+dbo\.InvMaster\b/i);
  assert.doesNotMatch(executable, /\b(?:INSERT|UPDATE|DELETE|MERGE)\b/i);
});
