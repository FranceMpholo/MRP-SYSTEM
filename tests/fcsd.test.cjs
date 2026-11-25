const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const fs = require("node:fs");

const moduleUrl = (relative) => pathToFileURL(path.join(__dirname, "..", "mrp-planner", "src", "fcsd", relative)).href;
let classifyFcsdFinishedPartCode;
let calculateFcsdRequirements;
test.before(async () => {
  ({ classifyFcsdFinishedPartCode } = await import(moduleUrl("fcsdClassification.js")));
  ({ calculateFcsdRequirements } = await import(moduleUrl("fcsdRequirements.js")));
});

const candidates = [
  { stockCode: "N1WZ-17906-HU", description: "FCSD RSB", uom: "EA", isBomParent: true },
  { stockCode: "N1WZ-16451-H", description: "FCSD Side Step", uom: "EA", isBomParent: true },
  { stockCode: "COMP-1", description: "Shared component", uom: "EA" },
  { stockCode: "COMP-2", description: "Nested assembly", uom: "EA" },
  { stockCode: "RAW-1", description: "Raw material", uom: "KG" },
];

test("classifies supplied FCSD and OEM finished-part fixtures after trim and case normalization", () => {
  const fcsd = ["N1WZ-17906-HU", "JB3Z-2100038-A", "N1WZ-16451-H", "N1WZ-2640726-K", "N1WZ-17D942-G"];
  const oem = ["N1WB-16451-KA", "N1XB-17775-RGSMAS", "N1WB-E12606-SCP", "N1WB-E40726-CJ", "N1WB-17970-EC"];
  for (const code of fcsd) assert.equal(classifyFcsdFinishedPartCode(` ${code.toLowerCase()} `).status, "FCSD");
  for (const code of oem) assert.equal(classifyFcsdFinishedPartCode(code).status, "NOT_FCSD");
  assert.equal(classifyFcsdFinishedPartCode(" N1WZ-17906-HU ").normalizedCode, "N1WZ-17906-HU");
  assert.equal(classifyFcsdFinishedPartCode("N1WZ-17906-HU").commodity, "RSB");
  assert.equal(classifyFcsdFinishedPartCode("JB3Z-2100038-A").commodity, "Bedliner");
  assert.equal(classifyFcsdFinishedPartCode("N1WZ-16451-H").commodity, "Side Step");
  assert.equal(classifyFcsdFinishedPartCode("N1WZ-2640726-K").commodity, "Tailgate");
  assert.equal(classifyFcsdFinishedPartCode("N1WZ-17D942-G").commodity, "Bumper Frame");
  assert.equal(classifyFcsdFinishedPartCode("N1WZ-99999-X").commodity, "Unclassified");
  assert.equal(classifyFcsdFinishedPartCode("AB-123Z").status, "NOT_FCSD");
});

test("rejects blank and malformed codes rather than classifying a Z anywhere", () => {
  for (const code of ["", "  ", "-N1WZ", "N1WZ-", "N1WZ--HU", "N1WZ-17_942-G", "AB-123Z"]) {
    const result = classifyFcsdFinishedPartCode(code);
    assert.ok(result.status === "INVALID" || result.status === "NOT_FCSD", code);
    assert.equal(result.isFcsd, false);
  }
});

test("consolidates a shared component and retains finished-part contributions", () => {
  const result = calculateFcsdRequirements({
    candidates,
    finishedParts: [
      { stockCode: "N1WZ-17906-HU", quantity: 3 },
      { stockCode: "N1WZ-16451-H", quantity: 4 },
    ],
    bomRows: [
      { parentStockCode: "N1WZ-17906-HU", parentUom: "EA", componentStockCode: "COMP-1", componentUom: "EA", factorUnitsVerified: true, qtyPerBasis: "stocking", qtyPer: 2 },
      { parentStockCode: "N1WZ-16451-H", parentUom: "EA", componentStockCode: "COMP-1", componentUom: "EA", factorUnitsVerified: true, qtyPerBasis: "stocking", qtyPer: 5 },
    ],
  });
  assert.equal(result.complete, true);
  assert.equal(result.requirements.length, 1);
  assert.equal(result.requirements[0].grossRequirement, 26);
  assert.deepEqual(result.requirements[0].contributions.map((row) => row.quantity), [6, 20]);
});

test("invalid, zero, negative, and non-finite proposed quantities do not create gross totals", () => {
  for (const quantity of ["", "0", "-2", "nope", "Infinity"]) {
    const result = calculateFcsdRequirements({ candidates, finishedParts: [{ stockCode: "N1WZ-17906-HU", quantity }], bomRows: [{ parentStockCode: "N1WZ-17906-HU", parentUom: "EA", componentStockCode: "COMP-1", componentUom: "EA", factorUnitsVerified: true, qtyPerBasis: "stocking", qtyPer: 1 }] });
    assert.equal(result.complete, false);
    assert.ok(result.issues.some((issue) => issue.code === "INVALID_QUANTITY"));
    assert.equal(result.requirements.length, 0);
  }
});

test("detects an indirect BOM cycle and does not report a complete explosion", () => {
  const result = calculateFcsdRequirements({ candidates, finishedParts: [{ stockCode: "N1WZ-17906-HU", quantity: 1 }], bomRows: [
    { parentStockCode: "N1WZ-17906-HU", parentUom: "EA", componentStockCode: "COMP-2", componentUom: "EA", factorUnitsVerified: true, qtyPerBasis: "stocking", qtyPer: 1 },
    { parentStockCode: "COMP-2", componentStockCode: "COMP-1", componentUom: "EA", factorUnitsVerified: true, qtyPerBasis: "stocking", qtyPer: 1 },
    { parentStockCode: "COMP-1", componentStockCode: "N1WZ-17906-HU", componentUom: "EA", factorUnitsVerified: true, qtyPerBasis: "stocking", qtyPer: 1 },
  ] });
  assert.equal(result.complete, false);
  assert.ok(result.issues.some((issue) => issue.code === "BOM_CYCLE"));
  assert.ok(result.issues.some((issue) => issue.code === "NESTED_BOM_POLICY"));
});

test("flags missing finished BOMs and missing component references", () => {
  const missingBom = calculateFcsdRequirements({ candidates, finishedParts: [{ stockCode: "N1WZ-17906-HU", quantity: 1 }], bomRows: [] });
  assert.ok(missingBom.issues.some((issue) => issue.code === "MISSING_BOM"));
  const missingRef = calculateFcsdRequirements({ candidates, finishedParts: [{ stockCode: "N1WZ-17906-HU", quantity: 1 }], bomRows: [{ parentStockCode: "N1WZ-17906-HU", parentUom: "EA", componentStockCode: "UNKNOWN-1", componentUom: "EA", factorUnitsVerified: true, qtyPerBasis: "stocking", qtyPer: 2 }] });
  assert.ok(missingRef.issues.some((issue) => issue.code === "MISSING_COMPONENT_REFERENCE"));
  assert.equal(missingRef.requirements[0].grossRequirement, null);
});

test("does not consolidate incompatible UOMs and flags absent conversion", () => {
  const result = calculateFcsdRequirements({ candidates, finishedParts: [{ stockCode: "N1WZ-17906-HU", quantity: 1 }], bomRows: [
    { parentStockCode: "N1WZ-17906-HU", parentUom: "EA", componentStockCode: "COMP-1", componentUom: "EA", factorUnitsVerified: true, qtyPerBasis: "stocking", qtyPer: 2 },
    { parentStockCode: "N1WZ-17906-HU", parentUom: "EA", componentStockCode: "COMP-1", componentUom: "BOX", factorUnitsVerified: true, qtyPerBasis: "stocking", qtyPer: 1 },
  ] });
  assert.equal(result.complete, false);
  assert.ok(result.issues.some((issue) => issue.code === "MISSING_UOM_CONVERSION"));
  assert.deepEqual(result.requirements.map((row) => row.uom).sort(), ["EA"]);
});

test("does not apply a BOM quantity when its parent UOM cannot be reconciled", () => {
  const result = calculateFcsdRequirements({ candidates, finishedParts: [{ stockCode: "N1WZ-17906-HU", quantity: 2 }], bomRows: [
    { parentStockCode: "N1WZ-17906-HU", parentUom: "SET", componentStockCode: "COMP-1", componentUom: "EA", factorUnitsVerified: true, qtyPerBasis: "stocking", qtyPer: 2 },
  ] });
  assert.equal(result.complete, false);
  assert.equal(result.requirements[0].grossRequirement, null);
  assert.ok(result.issues.some((issue) => issue.code === "MISSING_UOM_CONVERSION"));
});

test("keeps negative BOM quantities in a separate review list without net credit", () => {
  const result = calculateFcsdRequirements({ candidates, finishedParts: [{ stockCode: "N1WZ-17906-HU", quantity: 10 }], bomRows: [
    { parentStockCode: "N1WZ-17906-HU", parentUom: "EA", componentStockCode: "RAW-1", componentUom: "KG", factorUnitsVerified: true, qtyPerBasis: "stocking", qtyPer: 2 },
    { parentStockCode: "N1WZ-17906-HU", parentUom: "EA", componentStockCode: "RAW-1", componentUom: "KG", factorUnitsVerified: true, qtyPerBasis: "stocking", qtyPer: -0.5 },
  ] });
  assert.equal(result.requirements[0].grossRequirement, null); // Duplicate positive/negative meaning is unresolved.
  assert.equal(result.negativeQuantities[0].quantity, -5);
  assert.ok(result.issues.some((issue) => issue.code === "NEGATIVE_BOM_QUANTITY"));
});

test("stops at nested BOM parents where stocked/phantom policy is unknown", () => {
  const result = calculateFcsdRequirements({ candidates, finishedParts: [{ stockCode: "N1WZ-17906-HU", quantity: 2 }], bomRows: [
    { parentStockCode: "N1WZ-17906-HU", parentUom: "EA", componentStockCode: "COMP-2", componentUom: "EA", factorUnitsVerified: true, qtyPerBasis: "stocking", qtyPer: 3 },
    { parentStockCode: "COMP-2", componentStockCode: "RAW-1", componentUom: "KG", factorUnitsVerified: true, qtyPerBasis: "stocking", qtyPer: 2 },
  ] });
  assert.equal(result.requirements.length, 1);
  assert.equal(result.requirements[0].grossRequirement, 6);
  assert.equal(result.requirements[0].nestedBom, true);
  assert.equal(result.complete, false);
  assert.ok(result.issues.some((issue) => issue.code === "NESTED_BOM_POLICY"));
});

test("FCSD SYSPRO endpoints are read-only and expose candidate roles and BOM UOM fields", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server", "routes", "fcsd.js"), "utf8");
  const partsSql = source.match(/const PARTS_SQL = `([\s\S]*?)`;/)?.[1] || "";
  const bomSql = require("../server/routes/fcsd").BOM_SQL;
  for (const sql of [partsSql, bomSql]) {
    assert.match(sql, /^\s*(?:WITH|SELECT)\b/i);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|MERGE|EXEC|TRUNCATE|ALTER|DROP)\b/i);
  }
  assert.match(partsSql, /FROM\s+dbo\.InvMaster/i);
  assert.match(partsSql, /IsBomParent/i);
  assert.match(partsSql, /IsBomComponent/i);
  assert.match(bomSql, /ComponentUom/i);
  assert.match(bomSql, /QtyPer/i);
  assert.match(source, /revisionMetadataAvailable:\s*false/);
});
