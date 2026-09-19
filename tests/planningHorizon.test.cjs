const test = require('node:test');
const assert = require('node:assert/strict');
const horizon = import('../mrp-planner/src/planning/planningHorizon.js');

test('horizon supports 1/2/4/6 and defaults missing or obsolete preferences to one', async () => {
  const { PLANNING_HORIZONS, normalizePlanningHorizon } = await horizon;
  assert.deepEqual(PLANNING_HORIZONS, [1, 2, 4, 6]);
  for (const value of [undefined, null, '', 0, 10, 14, 20, -1, 1.5]) assert.equal(normalizePlanningHorizon(value), 1);
  for (const value of PLANNING_HORIZONS) assert.equal(normalizePlanningHorizon(String(value)), value);
});

test('one-week analysis uses the selected week boundary, retaining past due but excluding future orders', async () => {
  const { horizonOrders } = await horizon;
  const records = Object.freeze(['2025-12-21', '2025-12-22', '2025-12-28', '2025-12-29', '2026-01-04', '2026-01-05'].map(dueDate => Object.freeze({ dueDate })));
  const before = JSON.stringify(records);
  assert.deepEqual(horizonOrders(records, '2025-12-22', 1).map(row => row.dueDate), ['2025-12-21', '2025-12-22', '2025-12-28']);
  assert.equal(horizonOrders(records, '2025-12-22', 2).length, 5);
  assert.equal(horizonOrders(records, '2025-12-22', 4).length, 6);
  assert.equal(horizonOrders(records, '2025-12-22', 6).length, 6);
  assert.equal(JSON.stringify(records), before);
});
