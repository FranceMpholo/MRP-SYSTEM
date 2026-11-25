const test = require("node:test");
const assert = require("node:assert/strict");
const plannerStorage = import("../mrp-planner/src/planning/plannerStorage.js");

function memoryStorage(initialValue = null) {
  let value = initialValue;
  let readError = null;
  let writeError = null;
  const writes = [];
  return {
    writes,
    get value() { return value; },
    setReadError(error) { readError = error; },
    setWriteError(error) { writeError = error; },
    async get(key) {
      if (readError) throw readError;
      return value === null ? null : { key, value, shared: false };
    },
    async set(key, nextValue) {
      writes.push({ key, value: nextValue });
      if (writeError) throw writeError;
      value = nextValue;
      return { key, value: nextValue, shared: false };
    },
  };
}

test("missing storage is distinguished for normal first-use initialization", async () => {
  const { readPlannerStorage } = await plannerStorage;
  const storage = memoryStorage();

  assert.deepEqual(await readPlannerStorage(storage, "mrp-data"), { status: "missing" });
  assert.deepEqual(storage.writes, []);
});

test("valid saved planner data loads without changing its stored value", async () => {
  const { readPlannerStorage } = await plannerStorage;
  const saved = JSON.stringify({ items: [{ id: "item-1" }], demands: [], openOrders: [] });
  const storage = memoryStorage(saved);

  assert.deepEqual(await readPlannerStorage(storage, "mrp-data"), {
    status: "saved",
    data: { items: [{ id: "item-1" }], demands: [], openOrders: [] },
  });
  assert.equal(storage.value, saved);
  assert.deepEqual(storage.writes, []);
});

test("malformed JSON remains untouched and is never written over", async () => {
  const { readPlannerStorage } = await plannerStorage;
  const malformed = "{saved planning data";
  const storage = memoryStorage(malformed);

  await assert.rejects(readPlannerStorage(storage, "mrp-data"), /malformed or has an unsupported structure/);
  assert.equal(storage.value, malformed);
  assert.deepEqual(storage.writes, []);
});

test("a storage read failure is reported and does not write planner data", async () => {
  const { readPlannerStorage } = await plannerStorage;
  const storage = memoryStorage("existing-value");
  storage.setReadError(new Error("storage unavailable"));

  await assert.rejects(readPlannerStorage(storage, "mrp-data"), /could not be read/);
  assert.equal(storage.value, "existing-value");
  assert.deepEqual(storage.writes, []);
});

test("a successful retry after a read failure restores load and save operation", async () => {
  const { readPlannerStorage, writePlannerStorage } = await plannerStorage;
  const saved = JSON.stringify({ items: [{ id: "item-1" }], demands: [], openOrders: [] });
  const storage = memoryStorage(saved);
  storage.setReadError(new Error("temporary read failure"));

  await assert.rejects(readPlannerStorage(storage, "mrp-data"), /could not be read/);
  assert.equal(storage.writes.length, 0);

  storage.setReadError(null);
  const result = await readPlannerStorage(storage, "mrp-data");
  assert.equal(result.status, "saved");
  const nextData = { ...result.data, demands: [{ id: "demand-1", qty: 4 }] };
  await writePlannerStorage(storage, "mrp-data", nextData);
  assert.deepEqual(JSON.parse(storage.value), nextData);
});

test("a failed write preserves in-memory work and exposes explicit retry guidance", async () => {
  const { PLANNER_SAVE_ERROR_MESSAGE, writePlannerStorage } = await plannerStorage;
  const work = { items: [{ id: "item-1" }], demands: [{ id: "demand-1", qty: 7 }] };
  const before = JSON.stringify(work);
  const storage = memoryStorage("previously saved value");
  storage.setWriteError(new Error("quota exceeded"));

  await assert.rejects(writePlannerStorage(storage, "mrp-data", work), /quota exceeded/);
  assert.equal(JSON.stringify(work), before);
  assert.equal(storage.value, "previously saved value");
  assert.match(PLANNER_SAVE_ERROR_MESSAGE, /could not be saved/i);
  assert.match(PLANNER_SAVE_ERROR_MESSAGE, /Retry saving/i);
});

test("unreadable saved structures are rejected before the app can use them", async () => {
  const { readPlannerStorage } = await plannerStorage;
  const storage = memoryStorage(JSON.stringify({ items: {}, planningWeeks: [] }));

  await assert.rejects(readPlannerStorage(storage, "mrp-data"), /malformed or has an unsupported structure/);
  assert.deepEqual(storage.writes, []);
});
