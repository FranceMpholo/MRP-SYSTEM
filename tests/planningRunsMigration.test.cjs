const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const forward = fs.readFileSync(path.join(root, "server/migrations/001_planning_runs.sql"), "utf8");
const rollback = fs.readFileSync(path.join(root, "server/migrations/001_planning_runs.rollback.sql"), "utf8");

test("forward migration creates only the Phase A tables transactionally", () => {
  assert.match(forward, /^BEGIN;/);
  assert.match(forward, /COMMIT;\s*$/);
  const created = [...forward.matchAll(/CREATE TABLE\s+([a-z_]+)/gi)].map((match) => match[1]);
  assert.deepEqual(created, ["planning_runs", "planning_run_outputs", "planning_entry_run_mappings"]);
  assert.doesNotMatch(forward, /\b(?:ALTER|DROP|TRUNCATE)\s+TABLE\b/i);
  assert.doesNotMatch(forward, /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM)?\s*(?:planning_entries|production_actuals|material_requirements|material_reconciliations|oee_runs)\b/i);
});

test("planning run values and activity semantics are constrained", () => {
  assert.match(forward, /activity_type IN \('PRODUCTION', 'CHANGEOVER', 'OFF'\)/);
  assert.match(forward, /status IN \('Planned', 'In progress', 'Completed', 'Blocked'\)/);
  assert.match(forward, /planned_qty >= 0/);
  assert.match(forward, /quantity_uom IS NULL OR quantity_uom IN \('EA', 'SET'\)/);
  assert.match(forward, /EXTRACT\(ISODOW FROM week_start\) = 1/);
  assert.match(forward, /production_date < week_start \+ 7/);
  assert.match(forward, /activity_type = 'PRODUCTION'[\s\S]*planned_qty > 0[\s\S]*quantity_uom IS NOT NULL[\s\S]*changeover_target_item_id IS NULL/);
  assert.match(forward, /activity_type = 'OFF'[\s\S]*planned_qty = 0[\s\S]*quantity_uom IS NULL[\s\S]*changeover_target_item_id IS NULL/);
});

test("foreign-key delete behavior preserves master and legacy data", () => {
  assert.match(forward, /planning_run_id\) REFERENCES planning_runs\(id\) ON DELETE CASCADE/);
  assert.match(forward, /item_id\) REFERENCES items\(id\) ON DELETE NO ACTION/);
  assert.match(forward, /department_id\) REFERENCES departments\(id\) ON DELETE NO ACTION/);
  assert.match(forward, /machine_id\) REFERENCES machines\(id\) ON DELETE NO ACTION/);
  assert.match(forward, /shift_id\) REFERENCES shifts\(id\) ON DELETE NO ACTION/);
  assert.match(forward, /changeover_target_item_id\) REFERENCES items\(id\) ON DELETE NO ACTION/);
  assert.match(forward, /supervisor_user_id\) REFERENCES users\(id\) ON DELETE SET NULL/);
  assert.match(forward, /created_by\) REFERENCES users\(id\) ON DELETE SET NULL/);
  assert.match(forward, /planning_entry_id\) REFERENCES planning_entries\(id\) ON DELETE NO ACTION/);
});

test("output values, roles, and uniqueness are constrained", () => {
  assert.match(forward, /CHECK \(quantity_multiplier > 0\)/);
  assert.match(forward, /CHECK \(sequence_no > 0\)/);
  assert.match(forward, /CHECK \(output_role ~ '\^\[A-Z\]\[A-Z0-9_\]\{0,31\}\$'\)/);
  assert.match(forward, /UNIQUE \(planning_run_id, item_id\)/);
  assert.match(forward, /UNIQUE \(planning_run_id, output_role\)/);
  assert.match(forward, /UNIQUE \(planning_run_id, sequence_no\)/);
});

test("deferred triggers cover header changes and every output mutation", () => {
  assert.equal((forward.match(/DEFERRABLE INITIALLY DEFERRED/g) || []).length, 2);
  assert.match(forward, /AFTER INSERT OR UPDATE OF activity_type ON planning_runs/);
  assert.match(forward, /AFTER INSERT OR UPDATE OR DELETE ON planning_run_outputs/);
  assert.match(forward, /PRODUCTION planning run % must have at least one output/);
  assert.match(forward, /IN \('OFF', 'CHANGEOVER'\) AND output_count <> 0/);
  assert.match(forward, /OLD\.planning_run_id/);
  assert.match(forward, /NEW\.planning_run_id IS DISTINCT FROM OLD\.planning_run_id/);
  assert.match(forward, /validate_one_planning_run_output_set\(NEW\.planning_run_id\)/);
});

test("legacy mapping permits many entries per run but one run per entry", () => {
  const mapping = forward.slice(forward.indexOf("CREATE TABLE planning_entry_run_mappings"), forward.indexOf("CREATE INDEX planning_runs_production_date_idx"));
  assert.match(mapping, /planning_entry_id uuid PRIMARY KEY/);
  assert.match(mapping, /planning_run_id uuid NOT NULL/);
  assert.doesNotMatch(mapping, /UNIQUE \(planning_run_id\)/);
  assert.doesNotMatch(mapping, /planning_run_id uuid UNIQUE/);
});

test("rollback is guarded and scoped to new Phase A objects", () => {
  assert.match(rollback, /^BEGIN;/);
  assert.match(rollback, /COMMIT;\s*$/);
  assert.equal((rollback.match(/Rollback refused:/g) || []).length, 3);
  const dropped = [...rollback.matchAll(/DROP TABLE IF EXISTS\s+([a-z_]+)/gi)].map((match) => match[1]);
  assert.deepEqual(dropped, ["planning_entry_run_mappings", "planning_run_outputs", "planning_runs"]);
  assert.doesNotMatch(rollback, /DROP TABLE IF EXISTS\s+(?:planning_entries|production_actuals|material_requirements|material_reconciliations|oee_runs)/i);
  assert.doesNotMatch(rollback, /\bCASCADE\b/i);
});
