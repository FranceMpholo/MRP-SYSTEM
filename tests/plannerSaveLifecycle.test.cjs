const test = require("node:test");
const assert = require("node:assert/strict");
const lifecycle = import("../mrp-planner/src/planning/plannerSaveLifecycle.js");
const storageModule = import("../mrp-planner/src/planning/plannerStorage.js");

const data = (quantity) => ({
  items: [], demands: [], openOrders: [],
  productionActuals: [{ id: "TEST-ACTUAL", planningEntryId: "TEST-PLAN", actualMouldQty: quantity }],
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function setup(quantity = 23) {
  const { createPlannerSaveLifecycle } = await lifecycle;
  const { writePlannerStorage } = await storageModule;
  const state = { snapshot: { loaded: true, data: data(quantity) }, stored: JSON.stringify(data(quantity)), fail: false, beforeWrite: null };
  const writes = [];
  const statuses = [];
  const storage = {
    async set(key, value, shared) {
      assert.equal(key, "mrp-data");
      assert.equal(shared, false);
      writes.push(JSON.parse(value));
      if (state.beforeWrite) await state.beforeWrite();
      if (state.fail) throw new Error("Synthetic storage failure");
      state.stored = value;
    },
  };
  const saver = createPlannerSaveLifecycle({
    getSnapshot: () => state.snapshot,
    write: (value) => writePlannerStorage(storage, "mrp-data", value),
    onSaveState: (status) => statuses.push(status),
  });
  return { saver, state, writes, statuses };
}

test("logout flush saves the latest edit before the debounce has written it", async () => {
  const { saver, state, writes } = await setup();
  await saver.saveLatest();
  state.snapshot = { loaded: true, data: data(31) };
  await saver.saveLatest();
  assert.equal(JSON.parse(state.stored).productionActuals[0].actualMouldQty, 31);
  assert.deepEqual(writes.map((row) => row.productionActuals[0].actualMouldQty), [23, 31]);
});

test("normal logout with already saved state does not issue another write", async () => {
  const { saver, writes } = await setup();
  await saver.saveLatest();
  await saver.saveLatest();
  assert.equal(writes.length, 1);
});

test("concurrent autosave and repeated logout flushes share one write", async () => {
  const { saver, state, writes } = await setup(31);
  const hold = deferred();
  state.beforeWrite = () => hold.promise;
  const first = saver.saveLatest();
  const second = saver.saveLatest();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(writes.length, 1);
  hold.resolve();
  await Promise.all([first, second]);
  await saver.saveLatest();
  assert.equal(writes.length, 1);
});

test("logout waits for an older autosave and then persists the newer snapshot serially", async () => {
  const { saver, state, writes } = await setup();
  const hold = deferred();
  state.beforeWrite = () => hold.promise;
  const autosave = saver.saveLatest();
  await Promise.resolve();
  state.snapshot = { loaded: true, data: data(31) };
  const logout = saver.saveLatest();
  assert.equal(autosave, logout);
  assert.equal(writes.length, 1);
  state.beforeWrite = null;
  hold.resolve();
  await logout;
  assert.deepEqual(writes.map((row) => row.productionActuals[0].actualMouldQty), [23, 31]);
  assert.equal(JSON.parse(state.stored).productionActuals[0].actualMouldQty, 31);
});

test("write failure rejects logout completion, preserves edits, and retry saves current data", async () => {
  const { saver, state, writes, statuses } = await setup();
  let signedIn = true;
  const logout = async () => { await saver.saveLatest(); signedIn = false; };
  state.snapshot = { loaded: true, data: data(31) };
  state.fail = true;
  await assert.rejects(logout(), /Synthetic storage failure/);
  assert.equal(signedIn, true);
  assert.equal(state.snapshot.data.productionActuals[0].actualMouldQty, 31);
  assert.equal(JSON.parse(state.stored).productionActuals[0].actualMouldQty, 23);
  assert.deepEqual(statuses, ["saving", "error"]);

  state.snapshot = { loaded: true, data: data(32) };
  state.fail = false;
  await logout();
  assert.equal(signedIn, false);
  assert.equal(JSON.parse(state.stored).productionActuals[0].actualMouldQty, 32);
  assert.deepEqual(writes.map((row) => row.productionActuals[0].actualMouldQty), [31, 32]);
});

test("a failed in-flight autosave keeps logout blocked until an explicit retry", async () => {
  const { saver, state, writes } = await setup();
  const hold = deferred();
  state.beforeWrite = () => hold.promise;
  const autosave = saver.saveLatest();
  await Promise.resolve();
  state.snapshot = { loaded: true, data: data(31) };
  const logout = saver.saveLatest();
  hold.reject(new Error("Synthetic offline"));
  await assert.rejects(autosave, /Synthetic offline/);
  await assert.rejects(logout, /Synthetic offline/);
  assert.equal(writes.length, 1);
  state.beforeWrite = null;
  await saver.saveLatest();
  assert.equal(JSON.parse(state.stored).productionActuals[0].actualMouldQty, 31);
});

test("blocked or incomplete loading never writes initial, seed, or invalid state", async () => {
  const { saver, state, writes, statuses } = await setup();
  for (const value of [null, {}, data(0), { items: "invalid" }]) {
    state.snapshot = { loaded: false, data: value };
    await saver.saveLatest();
  }
  assert.deepEqual(writes, []);
  assert.deepEqual(statuses, []);
  assert.equal(JSON.parse(state.stored).productionActuals[0].actualMouldQty, 23);
});

test("the existing load-validation failure leaves logout flushing disabled", async () => {
  const { readPlannerStorage } = await storageModule;
  const { saver, state, writes } = await setup();
  state.snapshot.loaded = false;
  for (const stored of ["{malformed", JSON.stringify({ items: {} })]) {
    await assert.rejects(readPlannerStorage({ get: async () => ({ value: stored }) }, "mrp-data"));
    await saver.saveLatest();
  }
  assert.deepEqual(writes, []);
});

test('prepared imports commit only after storage succeeds and failed saves can retry unchanged', async () => {
  const { saver, state, statuses } = await setup();
  const initial = state.snapshot.data;
  let committed = 0;
  const action = {
    prepare: (current) => ({ data: { ...current, planningWeeks: { '2026-11-09': { entries: [{ id: 'STABLE-IMPORT-ID' }] } } }, result: { added: ['STABLE-IMPORT-ID'] } }),
    commit: (prepared) => { committed++; state.snapshot = { loaded: true, data: prepared.data }; },
  };
  state.fail = true;
  await assert.rejects(saver.savePrepared(action), /Synthetic storage failure/);
  assert.equal(committed, 0);
  assert.strictEqual(state.snapshot.data, initial);
  assert.equal(JSON.parse(state.stored).planningWeeks, undefined);
  state.fail = false;
  assert.deepEqual(await saver.savePrepared(action), { added: ['STABLE-IMPORT-ID'] });
  assert.equal(committed, 1);
  assert.equal(JSON.parse(state.stored).planningWeeks['2026-11-09'].entries.length, 1);
  assert.deepEqual(statuses, ['saving', 'error', 'saving', 'saved']);
});

test('prepared imports wait behind older autosaves and prepare from the latest snapshot', async () => {
  const { saver, state, writes } = await setup();
  const hold = deferred(); state.beforeWrite = () => hold.promise;
  const oldSave = saver.saveLatest(); await Promise.resolve();
  const imported = saver.savePrepared({
    prepare: (current) => ({ data: { ...current, marker: 'IMPORTED' }, result: 'done' }),
    commit: ({ data: candidate }) => { state.snapshot = { loaded: true, data: candidate }; },
  });
  state.snapshot = { loaded: true, data: data(31) };
  state.beforeWrite = null; hold.resolve(); await oldSave; await imported;
  assert.equal(JSON.parse(state.stored).productionActuals[0].actualMouldQty, 31);
  assert.equal(JSON.parse(state.stored).marker, 'IMPORTED');
  assert.deepEqual(writes.map((value) => value.marker || value.productionActuals[0].actualMouldQty), [23, 31, 'IMPORTED']);
});

test('logout during a prepared import flushes unrelated edits made during its write', async () => {
  const { saver, state } = await setup();
  const hold = deferred(); state.beforeWrite = () => hold.promise;
  const importing = saver.savePrepared({
    prepare: (current) => ({ data: { ...current, marker: 'IMPORTED' } }),
    commit: () => { state.snapshot = { loaded: true, data: { ...state.snapshot.data, marker: 'IMPORTED' } }; },
  });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  state.snapshot = { loaded: true, data: data(41) };
  const logout = saver.saveLatest();
  state.beforeWrite = null; hold.resolve();
  await importing; await logout;
  assert.equal(JSON.parse(state.stored).productionActuals[0].actualMouldQty, 41);
  assert.equal(JSON.parse(state.stored).marker, 'IMPORTED');
});

test('an unrelated edit committed alongside the import is not marked saved before it reaches storage', async () => {
  const { saver, state, statuses } = await setup();
  await saver.savePrepared({
    prepare: (current) => ({ data: { ...current, marker: 'IMPORTED' } }),
    commit: () => { state.snapshot = { loaded: true, data: { ...data(44), marker: 'IMPORTED' } }; },
  });
  assert.equal(JSON.parse(state.stored).productionActuals[0].actualMouldQty, 23);
  assert.equal(statuses.at(-1), 'saving');
  await saver.saveLatest();
  assert.equal(JSON.parse(state.stored).productionActuals[0].actualMouldQty, 44);
  assert.equal(JSON.parse(state.stored).marker, 'IMPORTED');
  assert.equal(statuses.at(-1), 'saved');
});
