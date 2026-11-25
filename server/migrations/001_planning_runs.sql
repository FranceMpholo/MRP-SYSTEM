BEGIN;

CREATE TABLE planning_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL,
  machine_id uuid,
  shift_id uuid NOT NULL,
  production_date date NOT NULL,
  week_start date NOT NULL,
  activity_type text NOT NULL,
  status text NOT NULL DEFAULT 'Planned',
  planned_qty numeric(18, 6) NOT NULL DEFAULT 0,
  quantity_uom text,
  changeover_target_item_id uuid,
  supervisor_user_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT planning_runs_department_fk
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE NO ACTION,
  CONSTRAINT planning_runs_machine_fk
    FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE NO ACTION,
  CONSTRAINT planning_runs_shift_fk
    FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE NO ACTION,
  CONSTRAINT planning_runs_changeover_target_item_fk
    FOREIGN KEY (changeover_target_item_id) REFERENCES items(id) ON DELETE NO ACTION,
  CONSTRAINT planning_runs_supervisor_user_fk
    FOREIGN KEY (supervisor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT planning_runs_created_by_fk
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,

  CONSTRAINT planning_runs_activity_type_check
    CHECK (activity_type IN ('PRODUCTION', 'CHANGEOVER', 'OFF')),
  CONSTRAINT planning_runs_status_check
    CHECK (status IN ('Planned', 'In progress', 'Completed', 'Blocked')),
  CONSTRAINT planning_runs_planned_qty_check
    CHECK (planned_qty >= 0),
  CONSTRAINT planning_runs_quantity_uom_check
    CHECK (quantity_uom IS NULL OR quantity_uom IN ('EA', 'SET')),
  CONSTRAINT planning_runs_week_start_monday_check
    CHECK (EXTRACT(ISODOW FROM week_start) = 1),
  CONSTRAINT planning_runs_production_date_in_week_check
    CHECK (
      production_date >= week_start
      AND production_date < week_start + 7
    ),
  CONSTRAINT planning_runs_activity_values_check
    CHECK (
      (
        activity_type = 'PRODUCTION'
        AND planned_qty > 0
        AND quantity_uom IS NOT NULL
        AND changeover_target_item_id IS NULL
      )
      OR (
        activity_type = 'CHANGEOVER'
        AND planned_qty = 0
        AND quantity_uom IS NULL
      )
      OR (
        activity_type = 'OFF'
        AND planned_qty = 0
        AND quantity_uom IS NULL
        AND changeover_target_item_id IS NULL
      )
    )
);

CREATE TABLE planning_run_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  planning_run_id uuid NOT NULL,
  item_id uuid NOT NULL,
  output_role text NOT NULL DEFAULT 'PRIMARY',
  quantity_multiplier numeric(18, 6) NOT NULL DEFAULT 1,
  sequence_no smallint NOT NULL DEFAULT 1,

  CONSTRAINT planning_run_outputs_run_fk
    FOREIGN KEY (planning_run_id) REFERENCES planning_runs(id) ON DELETE CASCADE,
  CONSTRAINT planning_run_outputs_item_fk
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE NO ACTION,
  CONSTRAINT planning_run_outputs_multiplier_check
    CHECK (quantity_multiplier > 0),
  CONSTRAINT planning_run_outputs_sequence_check
    CHECK (sequence_no > 0),
  CONSTRAINT planning_run_outputs_role_check
    CHECK (output_role ~ '^[A-Z][A-Z0-9_]{0,31}$'),
  CONSTRAINT planning_run_outputs_run_item_unique
    UNIQUE (planning_run_id, item_id),
  CONSTRAINT planning_run_outputs_run_role_unique
    UNIQUE (planning_run_id, output_role),
  CONSTRAINT planning_run_outputs_run_sequence_unique
    UNIQUE (planning_run_id, sequence_no)
);

CREATE TABLE planning_entry_run_mappings (
  planning_entry_id uuid PRIMARY KEY,
  planning_run_id uuid NOT NULL,
  migration_classification text NOT NULL,
  migrated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT planning_entry_run_mappings_entry_fk
    FOREIGN KEY (planning_entry_id) REFERENCES planning_entries(id) ON DELETE NO ACTION,
  CONSTRAINT planning_entry_run_mappings_run_fk
    FOREIGN KEY (planning_run_id) REFERENCES planning_runs(id) ON DELETE NO ACTION,
  CONSTRAINT planning_entry_run_mappings_classification_check
    CHECK (btrim(migration_classification) <> '')
);

CREATE INDEX planning_runs_production_date_idx
  ON planning_runs (production_date);
CREATE INDEX planning_runs_week_start_idx
  ON planning_runs (week_start);
CREATE INDEX planning_runs_department_date_idx
  ON planning_runs (department_id, production_date);
CREATE INDEX planning_runs_machine_date_idx
  ON planning_runs (machine_id, production_date)
  WHERE machine_id IS NOT NULL;
CREATE INDEX planning_runs_shift_date_idx
  ON planning_runs (shift_id, production_date);
CREATE INDEX planning_run_outputs_item_idx
  ON planning_run_outputs (item_id);
CREATE INDEX planning_entry_run_mappings_run_idx
  ON planning_entry_run_mappings (planning_run_id);

-- The UNIQUE constraints beginning with planning_run_id also provide indexes
-- for direct output lookup by planning_run_id.

CREATE FUNCTION validate_one_planning_run_output_set(run_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  run_activity_type text;
  output_count bigint;
BEGIN
  SELECT activity_type
  INTO run_activity_type
  FROM planning_runs
  WHERE id = run_id;

  -- A deleted run needs no validation; its owned outputs are cascaded.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*)
  INTO output_count
  FROM planning_run_outputs
  WHERE planning_run_id = run_id;

  IF run_activity_type = 'PRODUCTION' AND output_count < 1 THEN
    RAISE EXCEPTION 'PRODUCTION planning run % must have at least one output', run_id
      USING ERRCODE = '23514';
  END IF;

  IF run_activity_type IN ('OFF', 'CHANGEOVER') AND output_count <> 0 THEN
    RAISE EXCEPTION '% planning run % must not have production outputs', run_activity_type, run_id
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION enforce_planning_run_output_set()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'planning_runs' THEN
    PERFORM validate_one_planning_run_output_set(NEW.id);
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM validate_one_planning_run_output_set(NEW.planning_run_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM validate_one_planning_run_output_set(OLD.planning_run_id);
  ELSE
    PERFORM validate_one_planning_run_output_set(OLD.planning_run_id);
    IF NEW.planning_run_id IS DISTINCT FROM OLD.planning_run_id THEN
      PERFORM validate_one_planning_run_output_set(NEW.planning_run_id);
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER planning_runs_output_set_constraint
AFTER INSERT OR UPDATE OF activity_type ON planning_runs
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_planning_run_output_set();

CREATE CONSTRAINT TRIGGER planning_run_outputs_set_constraint
AFTER INSERT OR UPDATE OR DELETE ON planning_run_outputs
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_planning_run_output_set();

COMMIT;
