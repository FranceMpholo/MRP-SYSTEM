"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const postgres = require("../server/postgres");
const syspro = require("../server/db");
const router = require("../server/routes/mrp");

const MAX_BATCH_SIZE = 50;
const itemHandler = router.stack.find(
  (layer) => layer.route?.path === "/items" && layer.route.methods.get
).route.stack[0].handle;

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function invoke(stockCode) {
  const response = createResponse();
  await itemHandler({ query: stockCode === undefined ? {} : { stock_code: stockCode } }, response);
  return response;
}

function item(stockCode, overrides = {}) {
  return {
    id: `${stockCode}-uuid`,
    stock_code: stockCode,
    description: `${stockCode} description`,
    uom: "EA",
    item_type: "BOM_PARENT",
    source_system: "SYSPRO",
    is_active: true,
    syspro_last_synced_at: "2026-09-16T10:00:00.000Z",
    ...overrides,
  };
}

function installPostgresRows(rows) {
  const originalQuery = postgres.query;
  const calls = [];
  postgres.query = async (sql, params) => {
    calls.push({ sql: String(sql), params });
    return rows;
  };
  return { calls, restore: () => { postgres.query = originalQuery; } };
}

test("resolves one exact stock code with identity fields", async () => {
  const row = item("N1WB-E12606-SAH");
  const mock = installPostgresRows([row]);
  try {
    const response = await invoke(row.stock_code);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      success: true,
      data: { requested_codes: [row.stock_code], items: [row], unresolved_codes: [] },
    });
  } finally {
    mock.restore();
  }
});

test("resolves two requested stock codes in one parameterized query", async () => {
  const codes = ["N1WB-16450-BAA", "N1WB-16451-BAA"];
  const mock = installPostgresRows(codes.map((code) => item(code)));
  try {
    const response = await invoke(codes);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.data.requested_codes, codes);
    assert.deepEqual(response.body.data.items.map((row) => row.stock_code), codes);
    assert.deepEqual(response.body.data.unresolved_codes, []);
    assert.equal(mock.calls.length, 1);
    assert.match(mock.calls[0].sql, /stock_code = ANY\(\$1::text\[\]\)/);
    assert.deepEqual(mock.calls[0].params, [codes]);
    assert.equal(mock.calls[0].sql.includes(codes[0]), false);
    assert.equal(mock.calls[0].sql.includes(codes[1]), false);
  } finally {
    mock.restore();
  }
});

test("reports mixed resolved and unresolved stock codes", async () => {
  const mock = installPostgresRows([item("KNOWN")]);
  try {
    const response = await invoke(["KNOWN", "UNKNOWN"]);
    assert.deepEqual(response.body.data.items.map((row) => row.stock_code), ["KNOWN"]);
    assert.deepEqual(response.body.data.unresolved_codes, ["UNKNOWN"]);
  } finally {
    mock.restore();
  }
});

test("reports a fully unresolved request without creating or fabricating items", async () => {
  const mock = installPostgresRows([]);
  try {
    const response = await invoke(["UNKNOWN-1", "UNKNOWN-2"]);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.data.items, []);
    assert.deepEqual(response.body.data.unresolved_codes, ["UNKNOWN-1", "UNKNOWN-2"]);
    assert.match(mock.calls[0].sql, /^SELECT/i);
  } finally {
    mock.restore();
  }
});

test("trims surrounding whitespace before lookup", async () => {
  const mock = installPostgresRows([item("ITEM-1")]);
  try {
    const response = await invoke("  ITEM-1  ");
    assert.deepEqual(response.body.data.requested_codes, ["ITEM-1"]);
    assert.deepEqual(mock.calls[0].params, [["ITEM-1"]]);
  } finally {
    mock.restore();
  }
});

test("rejects missing, blank, and malformed stock-code input without querying PostgreSQL", async () => {
  const mock = installPostgresRows([]);
  try {
    for (const input of [undefined, "   ", ["VALID", ""], { unexpected: true }, ["VALID", 42]]) {
      const response = await invoke(input);
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.success, false);
    }
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test("de-duplicates identical normalized requests in first-requested order", async () => {
  const mock = installPostgresRows([item("ITEM-1"), item("ITEM-2")]);
  try {
    const response = await invoke([" ITEM-1 ", "ITEM-2", "ITEM-1"]);
    assert.deepEqual(response.body.data.requested_codes, ["ITEM-1", "ITEM-2"]);
    assert.deepEqual(mock.calls[0].params, [["ITEM-1", "ITEM-2"]]);
  } finally {
    mock.restore();
  }
});

test("accepts at most 50 raw codes and rejects a larger batch", async () => {
  const mock = installPostgresRows([]);
  try {
    const response = await invoke(Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, index) => `ITEM-${index}`));
    assert.equal(response.statusCode, 400);
    assert.match(response.body.error, /maximum of 50/i);
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test("rejects synthetic pair codes without database lookup", async () => {
  const mock = installPostgresRows([]);
  try {
    const response = await invoke(["REAL-ITEM", "N1WB_BAA_PAIR"]);
    assert.equal(response.statusCode, 400);
    assert.match(response.body.error, /synthetic pair/i);
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test("returns a safe 500 response for PostgreSQL errors", async () => {
  const originalQuery = postgres.query;
  const originalConsoleError = console.error;
  postgres.query = async () => { throw new Error("sensitive connection detail"); };
  console.error = () => {};
  try {
    const response = await invoke("ITEM-1");
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, { success: false, error: "Failed to resolve items" });
    assert.equal(JSON.stringify(response.body).includes("sensitive"), false);
  } finally {
    console.error = originalConsoleError;
    postgres.query = originalQuery;
  }
});

test("does not call the SYSPRO query collaborator", async () => {
  const postgresMock = installPostgresRows([]);
  const originalSysproQuery = syspro.query;
  let sysproCalls = 0;
  syspro.query = async () => {
    sysproCalls += 1;
    throw new Error("SYSPRO must not be queried");
  };
  try {
    const response = await invoke("UNKNOWN");
    assert.equal(response.statusCode, 200);
    assert.equal(sysproCalls, 0);
    assert.equal(postgresMock.calls.length, 1);
  } finally {
    syspro.query = originalSysproQuery;
    postgresMock.restore();
  }
});
