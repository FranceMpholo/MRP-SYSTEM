BEGIN;

-- Phase A rollback is deliberately data-safe. It refuses to remove populated
-- Phase A tables. DROP's default RESTRICT behavior also refuses removal when
-- later migration phases have introduced dependent database objects.
DO $$
DECLARE
  contains_rows boolean;
BEGIN
  IF to_regclass('public.planning_entry_run_mappings') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM planning_entry_run_mappings)'
      INTO contains_rows;
    IF contains_rows THEN
      RAISE EXCEPTION 'Rollback refused: planning_entry_run_mappings contains data';
    END IF;
  END IF;

  IF to_regclass('public.planning_run_outputs') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM planning_run_outputs)'
      INTO contains_rows;
    IF contains_rows THEN
      RAISE EXCEPTION 'Rollback refused: planning_run_outputs contains data';
    END IF;
  END IF;

  IF to_regclass('public.planning_runs') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM planning_runs)'
      INTO contains_rows;
    IF contains_rows THEN
      RAISE EXCEPTION 'Rollback refused: planning_runs contains data';
    END IF;
  END IF;
END;
$$;

DROP TABLE IF EXISTS planning_entry_run_mappings;
DROP TABLE IF EXISTS planning_run_outputs;
DROP TABLE IF EXISTS planning_runs;

DROP FUNCTION IF EXISTS enforce_planning_run_output_set();
DROP FUNCTION IF EXISTS validate_one_planning_run_output_set(uuid);

COMMIT;
