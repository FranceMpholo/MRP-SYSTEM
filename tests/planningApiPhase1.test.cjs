const test = require("node:test");
const assert = require("node:assert/strict");

const apiClientModule = import("../mrp-planner/src/api/apiClient.js");
const planningApiModule = import("../mrp-planner/src/api/planningApi.js");
const mapperModule = import("../mrp-planner/src/planning/planningApiMapper.js");

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

test("apiClient performs a successful JSON GET without an Authorization header", async () => {
  const { apiGet, resetAccessTokenProvider } = await apiClientModule;
  const originalFetch = global.fetch;
  let captured;
  global.fetch = async (path, init) => {
    captured = { path, init };
    return jsonResponse({ success: true, data: [{ id: "one" }] });
  };

  try {
    resetAccessTokenProvider();
    const payload = await apiGet("/api/mrp/planning", {
      headers: { Authorization: "Bearer caller-supplied-token" },
    });
    assert.deepEqual(payload, { success: true, data: [{ id: "one" }] });
    assert.equal(captured.path, "/api/mrp/planning");
    assert.equal(captured.init.method, "GET");
    assert.equal(captured.init.headers.get("Accept"), "application/json");
    assert.equal(captured.init.headers.has("Authorization"), false);
  } finally {
    resetAccessTokenProvider();
    global.fetch = originalFetch;
  }
});

test("apiClient exposes safe non-2xx status and API validation details", async () => {
  const { ApiError, apiGet, resetAccessTokenProvider } = await apiClientModule;
  const originalFetch = global.fetch;
  global.fetch = async () => jsonResponse({
    success: false,
    error: "Validation failed",
    details: ["planned_qty is required"],
  }, 400);

  try {
    resetAccessTokenProvider();
    await assert.rejects(
      apiGet("/api/mrp/planning"),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 400);
        assert.equal(error.message, "Validation failed");
        assert.deepEqual(error.details, ["planned_qty is required"]);
        return true;
      }
    );
  } finally {
    resetAccessTokenProvider();
    global.fetch = originalFetch;
  }
});

test("apiClient attaches a configured asynchronous Bearer token", async () => {
  const { apiGet, resetAccessTokenProvider, setAccessTokenProvider } = await apiClientModule;
  const originalFetch = global.fetch;
  let authorization;
  global.fetch = async (_path, init) => {
    authorization = init.headers.get("Authorization");
    return jsonResponse({ success: true });
  };

  try {
    setAccessTokenProvider(async () => "entra-access-token");
    await apiGet("/api/mrp/departments");
    assert.equal(authorization, "Bearer entra-access-token");
  } finally {
    resetAccessTokenProvider();
    global.fetch = originalFetch;
  }
});

test("apiClient forwards AbortSignal unchanged", async () => {
  const { apiGet, resetAccessTokenProvider } = await apiClientModule;
  const originalFetch = global.fetch;
  const controller = new AbortController();
  let forwardedSignal;
  global.fetch = async (_path, init) => {
    forwardedSignal = init.signal;
    return jsonResponse({ success: true });
  };

  try {
    resetAccessTokenProvider();
    await apiGet("/api/mrp/machines", { signal: controller.signal });
    assert.equal(forwardedSignal, controller.signal);
  } finally {
    resetAccessTokenProvider();
    global.fetch = originalFetch;
  }
});

test("apiClient generic POST, PATCH and DELETE methods serialize JSON correctly", async () => {
  const { apiDelete, apiPatch, apiPost, resetAccessTokenProvider } = await apiClientModule;
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (path, init) => {
    requests.push({ path, init });
    return jsonResponse({ success: true });
  };

  try {
    resetAccessTokenProvider();
    await apiPost("/api/example", { value: 1 });
    await apiPatch("/api/example/id", { value: 2 });
    await apiDelete("/api/example/id");

    assert.deepEqual(requests.map(({ init }) => init.method), ["POST", "PATCH", "DELETE"]);
    assert.deepEqual(requests.slice(0, 2).map(({ init }) => init.body), [
      JSON.stringify({ value: 1 }),
      JSON.stringify({ value: 2 }),
    ]);
    assert.equal(requests[0].init.headers.get("Content-Type"), "application/json");
    assert.equal(requests[2].init.body, undefined);
  } finally {
    resetAccessTokenProvider();
    global.fetch = originalFetch;
  }
});

test("planningApi read methods use the expected /api/mrp endpoints", async () => {
  const { resetAccessTokenProvider } = await apiClientModule;
  const {
    getDepartments,
    getMachines,
    getPlanning,
    getPlanningById,
    getShifts,
  } = await planningApiModule;
  const originalFetch = global.fetch;
  const paths = [];
  global.fetch = async (path) => {
    paths.push(path);
    return jsonResponse({ success: true, data: [] });
  };

  try {
    resetAccessTokenProvider();
    await getPlanning();
    await getPlanningById("id/with separator");
    await getDepartments();
    await getShifts();
    await getMachines();
    assert.deepEqual(paths, [
      "/api/mrp/planning",
      "/api/mrp/planning/id%2Fwith%20separator",
      "/api/mrp/departments",
      "/api/mrp/shifts",
      "/api/mrp/machines",
    ]);
  } finally {
    resetAccessTokenProvider();
    global.fetch = originalFetch;
  }
});

test("planning mapper strictly converts finite PostgreSQL numeric values", async () => {
  const { parsePostgresNumber } = await mapperModule;
  assert.equal(parsePostgresNumber("125.50"), 125.5);
  assert.equal(parsePostgresNumber(" 1e3 "), 1000);
  assert.equal(parsePostgresNumber(0), 0);

  for (const value of ["", "NaN", "Infinity", "12 units", null, undefined, Infinity, NaN]) {
    assert.equal(parsePostgresNumber(value), null);
  }
});

test("planning mapper derives weekday from date-only components without timezone shifting", async () => {
  const { weekdayFromDateOnly } = await mapperModule;
  assert.equal(weekdayFromDateOnly("2026-09-16"), "Wednesday");
  assert.equal(weekdayFromDateOnly("2024-02-29"), "Thursday");
  assert.equal(weekdayFromDateOnly("2025-02-29"), null);
  assert.equal(weekdayFromDateOnly("2026-09-16T00:00:00Z"), null);
});

test("planning mapper maps joined snake_case fields and preserves UUIDs", async () => {
  const { mapPlanningRecord } = await mapperModule;
  const record = mapPlanningRecord({
    id: "11111111-1111-4111-8111-111111111111",
    production_date: "2026-09-16",
    week_start: "2026-09-14",
    planned_qty: "42.75",
    status: "Planned",
    machine_code: "BM01",
    shift_code: "SHIFT 01",
    parent_stock_code: "N1WB-16450-BAA",
    department_code: "BM",
    parent_item_id: "22222222-2222-4222-8222-222222222222",
    created_by: "33333333-3333-4333-8333-333333333333",
  });

  assert.deepEqual(record, {
    id: "11111111-1111-4111-8111-111111111111",
    day: "2026-09-16",
    weekday: "Wednesday",
    weekStart: "2026-09-14",
    buildQty: 42.75,
    status: "Planned",
    machine: "BM01",
    shift: "SHIFT 01",
    partNumber: "N1WB-16450-BAA",
    productionLine: "blowMoulding",
    parentItemId: "22222222-2222-4222-8222-222222222222",
    createdByUserId: "33333333-3333-4333-8333-333333333333",
  });
});

test("department mapping recognizes only explicit production departments", async () => {
  const { mapDepartmentCodeToProductionLine } = await mapperModule;
  assert.equal(mapDepartmentCodeToProductionLine("BM"), "blowMoulding");
  assert.equal(mapDepartmentCodeToProductionLine(" tf "), "thermoforming");
  assert.equal(mapDepartmentCodeToProductionLine("SS"), null);
  assert.equal(mapDepartmentCodeToProductionLine("UNKNOWN"), null);
  assert.equal(mapDepartmentCodeToProductionLine(null), null);
});

test("planning mapper does not fabricate missing optional joined fields", async () => {
  const { mapPlanningRecord, mapPlanningRecords } = await mapperModule;
  assert.deepEqual(mapPlanningRecord({
    id: "11111111-1111-4111-8111-111111111111",
    production_date: "2026-09-16",
    planned_qty: "not-a-number",
    department_code: "UNMAPPED",
  }), {
    id: "11111111-1111-4111-8111-111111111111",
    day: "2026-09-16",
    weekday: "Wednesday",
    weekStart: null,
    buildQty: null,
    status: null,
    machine: null,
    shift: null,
    partNumber: null,
    productionLine: null,
    parentItemId: null,
    createdByUserId: null,
  });
  assert.equal(mapPlanningRecord(null), null);
  assert.deepEqual(mapPlanningRecords(null), []);
});
