# Planning runs migration

## Purpose

`planning_runs` separates a scheduled manufacturing activity from the physical inventory items it produces. A run owns zero or more `planning_run_outputs` rows. Normal production has one output, while multi-output production can have more than one.

Synthetic planning aliases are UI and business vocabulary, not inventory master records. They must never be inserted into `items` or synchronized to SYSPRO.

For example, the synthetic alias `TEST-PAIR-001` can represent a run for 80 complete sets:

- Run quantity: `80 SET`
- `TEST-LH-PARENT-001`, role `LH`, multiplier `1`: derived output `80 EA`
- `TEST-RH-PARENT-001`, role `RH`, multiplier `1`: derived output `80 EA`

The two output items are real inventory identities. The alias is not.

## Activity semantics

- `PRODUCTION` has a positive planned quantity, a quantity unit, and at least one physical output.
- `OFF` has quantity zero, no quantity unit, no target item, and no output.
- `CHANGEOVER` has quantity zero and no production output. It may reference a real destination item separately through `changeover_target_item_id`.

Output quantity is derived as `planned_qty × quantity_multiplier`; it is not stored redundantly in Phase A.

Database CHECK constraints validate row-local rules. Deferred constraint triggers validate output membership at transaction commit, allowing a transaction to insert a run before inserting its outputs while preventing committed invalid states.

## Staged transition

- **Phase A:** Add `planning_runs`, `planning_run_outputs`, and migration mapping structures only.
- **Phase B:** Classify and backfill unambiguous legacy records, retaining an explicit ID mapping.
- **Phase C:** Add read-only API support for nested planning runs.
- **Phase D:** Move frontend reads after projection and regression validation.
- **Phase E:** Add transactional run and output writes.
- **Phase F:** Move actuals, material, reconciliation, and OEE relationships in independently validated steps.
- **Phase G:** Retire the legacy model only after all consumers and historical references have been reconciled.

Phase A does not replace, alter, backfill, or remove `planning_entries`. Existing Planning API behavior remains unchanged.

## Rollback safety

The Phase A rollback applies only to newly introduced objects. It refuses to remove any Phase A table containing data. PostgreSQL's default dependency restriction also prevents rollback when later migration phases introduce dependent objects. No rollback uses `CASCADE`.
