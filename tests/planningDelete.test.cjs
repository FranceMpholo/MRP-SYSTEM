const test = require("node:test");
const assert = require("node:assert/strict");

const postgres = require("../server/postgres");
const router = require("../server/routes/mrp");

const VALID_ID = "11111111-1111-4111-8111-111111111111";
const deleteHandler = router.stack.find(
  (layer) => layer.route?.path === "/planning/:id" && layer.route.methods.delete
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

function installClient({ existingRows = [], hasDependencies = false, deleteError } = {}) {
  const calls = [];
  let released = false;

  const client = {
    async query(sql, params) {
      const text = String(sql).trim();
      calls.push({ text, params });

      if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
        return { rows: [] };
      }
      if (text.startsWith("SELECT") && text.includes("FROM planning_entries")) {
        return { rows: existingRows };
      }
      if (text.startsWith("SELECT EXISTS")) {
        return { rows: [{ has_dependencies: hasDependencies }] };
      }
      if (text.startsWith("DELETE FROM planning_entries")) {
        if (deleteError) throw deleteError;
        return { rows: [existingRows[0]] };
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
    release() {
      calls.push({ text: "release", params: undefined });
      released = true;
    },
  };

  postgres.pool.connect = async () => client;
  return { calls, wasReleased: () => released };
}

function operationSequence(calls) {
  return calls.map(({ text }) => {
    if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK" || text === "release") {
      return text;
    }
    if (text.startsWith("SELECT") && text.includes("FROM planning_entries")) {
      assert.match(text, /FOR UPDATE/);
      return "SELECT planning entry FOR UPDATE";
    }
    if (text.startsWith("SELECT EXISTS")) return "dependency check";
    if (text.startsWith("DELETE FROM planning_entries")) return "DELETE";
    return text;
  });
}

async function invoke(id = VALID_ID) {
  const response = createResponse();
  await deleteHandler({ params: { id } }, response);
  return response;
}

test("DELETE planning rejects an invalid UUID with 400", async () => {
  const originalConnect = postgres.pool.connect;
  let connected = false;
  postgres.pool.connect = async () => {
    connected = true;
    throw new Error("should not connect");
  };

  try {
    const response = await invoke("not-a-uuid");
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.error, "Invalid planning entry ID");
    assert.equal(connected, false);
  } finally {
    postgres.pool.connect = originalConnect;
  }
});

test("DELETE planning returns 404 when the entry does not exist", async () => {
  const originalConnect = postgres.pool.connect;
  const mock = installClient();

  try {
    const response = await invoke();
    assert.equal(response.statusCode, 404);
    assert.equal(response.body.error, "Planning entry not found");
    assert.deepEqual(operationSequence(mock.calls), [
      "BEGIN",
      "SELECT planning entry FOR UPDATE",
      "ROLLBACK",
      "release",
    ]);
    assert.equal(mock.wasReleased(), true);
  } finally {
    postgres.pool.connect = originalConnect;
  }
});

test("DELETE planning rejects a non-Planned entry with 409", async () => {
  const originalConnect = postgres.pool.connect;
  const mock = installClient({ existingRows: [{ id: VALID_ID, status: "Completed" }] });

  try {
    const response = await invoke();
    assert.equal(response.statusCode, 409);
    assert.match(response.body.error, /only untouched Planned entries/i);
    assert.deepEqual(operationSequence(mock.calls), [
      "BEGIN",
      "SELECT planning entry FOR UPDATE",
      "ROLLBACK",
      "release",
    ]);
    assert.equal(mock.wasReleased(), true);
  } finally {
    postgres.pool.connect = originalConnect;
  }
});

test("DELETE planning checks all dependency tables and rejects operational history", async () => {
  const originalConnect = postgres.pool.connect;
  const mock = installClient({
    existingRows: [{ id: VALID_ID, status: "Planned" }],
    hasDependencies: true,
  });

  try {
    const response = await invoke();
    assert.equal(response.statusCode, 409);
    assert.match(response.body.error, /operational history/i);

    const dependencyQuery = mock.calls.find(({ text }) => text.startsWith("SELECT EXISTS"));
    assert.ok(dependencyQuery);
    for (const table of [
      "production_actuals",
      "material_requirements",
      "material_reconciliations",
      "oee_runs",
    ]) {
      assert.ok(dependencyQuery.text.includes(`FROM ${table}`));
      assert.ok(dependencyQuery.text.includes(`FROM ${table}\n        WHERE planning_entry_id = $1`));
    }
    assert.deepEqual(dependencyQuery.params, [VALID_ID]);
    assert.deepEqual(operationSequence(mock.calls), [
      "BEGIN",
      "SELECT planning entry FOR UPDATE",
      "dependency check",
      "ROLLBACK",
      "release",
    ]);
    assert.equal(mock.wasReleased(), true);
  } finally {
    postgres.pool.connect = originalConnect;
  }
});

test("DELETE planning permits deletion of an untouched Planned entry", async () => {
  const originalConnect = postgres.pool.connect;
  const row = { id: VALID_ID, status: "Planned", planned_qty: "10" };
  const mock = installClient({ existingRows: [row] });

  try {
    const response = await invoke();
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, true);
    assert.deepEqual(response.body.data, row);
    assert.deepEqual(operationSequence(mock.calls), [
      "BEGIN",
      "SELECT planning entry FOR UPDATE",
      "dependency check",
      "DELETE",
      "COMMIT",
      "release",
    ]);
    assert.equal(mock.wasReleased(), true);
  } finally {
    postgres.pool.connect = originalConnect;
  }
});

test("DELETE planning maps PostgreSQL FK violation 23503 to 409", async () => {
  const originalConnect = postgres.pool.connect;
  const error = Object.assign(new Error("foreign key violation"), { code: "23503" });
  const mock = installClient({
    existingRows: [{ id: VALID_ID, status: "Planned" }],
    deleteError: error,
  });

  try {
    const response = await invoke();
    assert.equal(response.statusCode, 409);
    assert.match(response.body.error, /operational history/i);
    assert.deepEqual(operationSequence(mock.calls), [
      "BEGIN",
      "SELECT planning entry FOR UPDATE",
      "dependency check",
      "DELETE",
      "ROLLBACK",
      "release",
    ]);
    assert.equal(mock.wasReleased(), true);
  } finally {
    postgres.pool.connect = originalConnect;
  }
});

test("DELETE planning maps an unexpected database error to 500 and cleans up", async () => {
  const originalConnect = postgres.pool.connect;
  const originalConsoleError = console.error;
  const error = Object.assign(new Error("database unavailable"), { code: "XX000" });
  const mock = installClient({
    existingRows: [{ id: VALID_ID, status: "Planned" }],
    deleteError: error,
  });
  console.error = () => {};

  try {
    const response = await invoke();
    assert.equal(response.statusCode, 500);
    assert.equal(response.body.error, "Failed to delete planning entry");
    assert.notEqual(response.statusCode, 409);
    assert.deepEqual(operationSequence(mock.calls), [
      "BEGIN",
      "SELECT planning entry FOR UPDATE",
      "dependency check",
      "DELETE",
      "ROLLBACK",
      "release",
    ]);
    assert.equal(mock.wasReleased(), true);
  } finally {
    console.error = originalConsoleError;
    postgres.pool.connect = originalConnect;
  }
});
