"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const app = require("../server/server");
const postgres = require("../server/postgres");
const syspro = require("../server/db");
const router = require("../server/routes/mrp");

const ID = "11111111-1111-4111-8111-111111111111";
const UNAVAILABLE = {
  success: false,
  code: "PLANNING_WRITES_UNAVAILABLE",
  error: "Planning writes are unavailable until server-side authentication and authorization are configured.",
};
const mutations = [
  ["POST", "/planning"],
  ["PATCH", `/planning/${ID}`],
  ["DELETE", `/planning/${ID}`],
];
const validBody = {
  department_id: ID,
  shift_id: ID,
  parent_item_id: ID,
  production_date: "2026-11-09",
  week_start: "2026-11-09",
  planned_qty: 10,
  status: "Planned",
};

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  const closed = new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  server.closeAllConnections();
  await closed;
});

function watchDatabase(t, readQuery) {
  const forbidden = async () => { throw new Error("Unexpected database access in containment test"); };
  return {
    query: t.mock.method(postgres, "query", readQuery || forbidden),
    poolQuery: t.mock.method(postgres.pool, "query", forbidden),
    connect: t.mock.method(postgres.pool, "connect", forbidden),
    sysproQuery: t.mock.method(syspro, "query", forbidden),
    sysproHealth: t.mock.method(syspro, "testConnection", forbidden),
  };
}

function assertNoDatabaseAccess(spies) {
  for (const [name, spy] of Object.entries(spies)) {
    assert.equal(spy.mock.callCount(), 0, `${name} must not be reached`);
  }
}

async function expectUnavailable(method, path, { headers = {}, body = validBody } = {}) {
  const response = await fetch(`${baseUrl}/api/mrp${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 503, `${method} ${path}`);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), UNAVAILABLE);
}

test("all registered planning mutation endpoints are covered by the restriction", () => {
  const registered = router.stack.flatMap((layer) => layer.route
    ? Object.keys(layer.route.methods)
      .filter((method) => !["get", "head", "options"].includes(method))
      .map((method) => `${method.toUpperCase()} ${layer.route.path}`)
    : []);
  assert.deepEqual(registered.sort(), [
    "POST /planning", "PATCH /planning/:id", "DELETE /planning/:id",
  ].sort());
});

for (const [method, path] of mutations) {
  test(`anonymous ${method} planning is unavailable before any database access`, async (t) => {
    const spies = watchDatabase(t);
    await expectUnavailable(method, path);
    assertNoDatabaseAccess(spies);
  });
}

const unsignedToken = [
  Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
  Buffer.from(JSON.stringify({ sub: ID, role: "ADMIN", exp: 4102444800 })).toString("base64url"),
  "",
].join(".");

const untrustedIdentities = [
  ["browser-supplied body identity and role", {
    body: { ...validBody, created_by: ID, supervisor_user_id: ID, user: { id: ID, role: "ADMIN" }, role: "ADMIN" },
  }],
  ["identity and administrator role headers", {
    headers: { "X-User-Id": ID, "X-User-Role": "ADMIN", "X-Role": "ADMIN", "X-Authenticated-User": ID, "X-Forwarded-User": ID },
  }],
  ["an unverified bearer token", {
    headers: { Authorization: "Bearer unverified-test-token" },
  }],
  ["an unsigned administrator JWT", {
    headers: { Authorization: `Bearer ${unsignedToken}` },
  }],
];

for (const [label, options] of untrustedIdentities) {
  test(`${label} cannot bypass any planning write restriction`, async (t) => {
    const spies = watchDatabase(t);
    for (const [method, path] of mutations) await expectUnavailable(method, path, options);
    assertNoDatabaseAccess(spies);
  });
}

test("invalid payloads and IDs cannot reach mutation validation or database code", async (t) => {
  const spies = watchDatabase(t);
  await expectUnavailable("POST", "/planning", { body: {} });
  await expectUnavailable("PATCH", "/planning/not-a-uuid", { body: {} });
  await expectUnavailable("DELETE", "/planning/not-a-uuid", { body: {} });
  assertNoDatabaseAccess(spies);
});

test("PUT, bulk, alternative paths, casing, and method overrides remain unavailable", async (t) => {
  const spies = watchDatabase(t);
  for (const [method, path] of [
    ["PUT", "/planning"],
    ["PUT", `/planning/${ID}`],
    ["POST", "/planning/bulk"],
    ["PATCH", "/planning/bulk"],
    ["DELETE", "/planning"],
    ["POST", "/planning-runs"],
    ["POST", "/PLANNING/"],
    ["POST", "/planning?_method=GET"],
  ]) {
    await expectUnavailable(method, path, { headers: { "X-HTTP-Method-Override": "GET" } });
  }
  assertNoDatabaseAccess(spies);
});

test("a later bulk or alternative mutation handler cannot bypass the router restriction", async (t) => {
  const spies = watchDatabase(t);
  const originalLength = router.stack.length;
  let handlerCalls = 0;
  const laterHandler = async (_request, response) => {
    handlerCalls += 1;
    await postgres.query("SELECT 1");
    response.json({ success: true });
  };
  try {
    router.post("/planning/bulk", laterHandler);
    router.post("/planning-runs", laterHandler);
    await expectUnavailable("POST", "/planning/bulk");
    await expectUnavailable("POST", "/planning-runs");
    assert.equal(handlerCalls, 0);
    assertNoDatabaseAccess(spies);
  } finally {
    router.stack.splice(originalLength);
  }
});

test("all existing MRP GET routes retain their successful response shapes and query parameters", async (t) => {
  const row = { id: ID, stock_code: "TEST-PARENT-001", planned_qty: "10" };
  const spies = watchDatabase(t, async () => [row]);
  for (const path of ["/departments", "/shifts", "/machines", "/planning"]) {
    const response = await fetch(`${baseUrl}/api/mrp${path}`);
    assert.equal(response.status, 200, path);
    assert.deepEqual(await response.json(), { success: true, data: [row] });
  }
  const detail = await fetch(`${baseUrl}/api/mrp/planning/${ID}`);
  assert.equal(detail.status, 200);
  assert.deepEqual(await detail.json(), { success: true, data: row });
  assert.deepEqual(spies.query.mock.calls.at(-1).arguments[1], [ID]);

  const items = await fetch(`${baseUrl}/api/mrp/items?stock_code=TEST-PARENT-001`);
  assert.equal(items.status, 200);
  assert.deepEqual(await items.json(), {
    success: true,
    data: { requested_codes: [row.stock_code], items: [row], unresolved_codes: [] },
  });
  assert.deepEqual(spies.query.mock.calls.at(-1).arguments[1], [[row.stock_code]]);

  const health = await fetch(`${baseUrl}/api/mrp/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { success: true, service: "mrp-postgres-api", database: row });
  assert.equal(spies.query.mock.callCount(), 7);
  for (const call of spies.query.mock.calls) assert.match(call.arguments[0].trim(), /^SELECT\b/i);
  assert.equal(spies.poolQuery.mock.callCount(), 0);
  assert.equal(spies.connect.mock.callCount(), 0);
  assert.equal(spies.sysproQuery.mock.callCount(), 0);
});

test("read validation, missing records, empty lists, and database failures retain their behavior", async (t) => {
  let unavailable = false;
  const spies = watchDatabase(t, async () => {
    if (unavailable) throw new Error("Synthetic read failure");
    return [];
  });
  t.mock.method(console, "error", () => {});
  for (const [path, error] of [
    ["/planning/not-a-uuid", "Invalid planning entry ID"],
    ["/items", "Provide at least one valid stock_code query parameter"],
  ]) {
    const response = await fetch(`${baseUrl}/api/mrp${path}`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { success: false, error });
  }
  assertNoDatabaseAccess(spies);

  const missing = await fetch(`${baseUrl}/api/mrp/planning/${ID}`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { success: false, error: "Planning entry not found" });
  const empty = await fetch(`${baseUrl}/api/mrp/planning`);
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { success: true, data: [] });

  unavailable = true;
  const failure = await fetch(`${baseUrl}/api/mrp/planning`);
  assert.equal(failure.status, 500);
  assert.deepEqual(await failure.json(), { success: false, error: "Failed to load planning entries" });
});

test("HEAD, OPTIONS, and unknown GET routes retain Express/CORS read-only behavior", async (t) => {
  const spies = watchDatabase(t, async () => []);
  const head = await fetch(`${baseUrl}/api/mrp/planning`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(spies.query.mock.callCount(), 1);

  const options = await fetch(`${baseUrl}/api/mrp/planning`, { method: "OPTIONS" });
  assert.equal(options.status, 204);
  assert.match(options.headers.get("access-control-allow-methods"), /GET/);
  assert.equal(await options.text(), "");

  const unknown = await fetch(`${baseUrl}/api/mrp/unknown`);
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).success, false);
  assert.equal(spies.query.mock.callCount(), 1);
  assert.equal(spies.connect.mock.callCount(), 0);
});

test("unrelated SYSPRO reads keep their behavior", async (t) => {
  const spies = watchDatabase(t);
  const rows = [{ StockCode: "TEST-SHEET-001", B_WIP01_SOH: 20 }];
  spies.sysproQuery.mock.mockImplementation(async () => rows);
  const response = await fetch(`${baseUrl}/api/syspro/inventory`);
  assert.equal(response.status, 200);
  const { source, fetchedAt, ...payload } = await response.json();
  assert.deepEqual(payload, { success: true, count: 1, data: rows });
  assert.equal(source, 'SYSPRO InvMaster / InvWarehouse');
  assert.ok(Number.isFinite(Date.parse(fetchedAt)));
  assert.equal(spies.sysproQuery.mock.callCount(), 1);
  assert.equal(spies.query.mock.callCount(), 0);
  assert.equal(spies.connect.mock.callCount(), 0);
});
