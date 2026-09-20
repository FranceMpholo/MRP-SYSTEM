# OEE architecture and validation

The OEE module combines application Planning and Production Actuals with optional read-only finished-goods movement visibility. Operational OEE inputs and settings remain in the application's existing persistence layer; the module does not write to SYSPRO.

## Calculation model

Calculations are implemented as pure functions in `mrp-planner/src/oee/deriveOee.js`.

| Metric | Formula |
| --- | --- |
| Availability | Run Time / (Planned Time - Planned Breaks) |
| Quality | Good Parts / Total Parts Produced |
| Performance | Total Parts Produced / Target |
| Productivity | (Run Time + approved time addend) / (Planned Time - Planned Breaks) |
| External OEE | Availability x Quality x Performance |
| Internal OEE | Productivity x Quality x Performance, with the documented fallback when the direct product is exactly zero |

Missing operands and non-finite arithmetic are reported as incomplete inputs rather than fabricated production values. Explicit zero remains a valid observation. Ratios are not silently capped. Invalid conditions such as negative inputs, breaks exceeding planned time, or Good Parts exceeding Total Parts are surfaced as validation issues.

Target and revised-plan calculations can use an approved NICT/cycle-time configuration. Cycle standards must be configured deliberately; the application does not infer proprietary standards from item descriptions or identifiers.

## Shift and run allocation

Shared shift identifiers and clock configuration live in `mrp-planner/src/planning/shiftConfig.js`. Overnight shifts are supported. Planned breaks may be explicitly zero, while blank means unknown.

Multiple runs may occupy one machine/shift slot. Their planned-time and planned-break allocations must reconcile to the configured slot within the validation tolerance. Validation is performed before dashboard filtering so a filter cannot conceal an incomplete allocation or duplicate a denominator.

OFF entries are excluded from production calculations. Changeover records remain available for explicitly captured time and zero-output cases.

## Aggregation

Summary groups add quantities and time inputs before evaluating formulas. They do not average row-level OEE percentages. Fallback averages use only complete rows in the active filter scope, while observed zeros remain included.

Dashboard filters apply consistently to KPI cards, charts, and detail rows. Incomplete records remain visible but are excluded from complete-run aggregates.

## Finished-goods visibility

The backend exposes a read-only endpoint:

```text
GET /api/syspro/oee/finished-goods?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

The route uses bound date parameters and a bounded date range. It returns JSON validation errors for invalid ranges and an unavailable response for database failures. Its SQL is SELECT-only.

Finished-goods movements provide period-level reconciliation visibility. They are not assigned to a machine, shift, or planning entry without a reliable source link, and they are never substituted for Good Parts. Missing movements remain missing rather than becoming zero.

Synthetic examples use identifiers such as `TEST-OEE-PARENT-001`, `TEST-MACHINE-001`, and `TEST-WAREHOUSE-FIN`. Paired-output conversion is tested separately from live inventory data.

## Module responsibilities

- `deriveOee.js`: validation and formula engine.
- `oeeSettings.js`: normalized settings, loss categories, and defaults.
- `oeeHistory.js`: immutable completion snapshots and revisions.
- `dashboardReporting.js`: filter-first reporting aggregation.
- `finishedGoods.js`: optional read-only movement reconciliation.
- `OeeModuleShell.jsx`: navigation and shared module state.
- `OeeInputView.jsx` and `OeeInputs.jsx`: capture workflow.
- `OeeDashboard.jsx` and `OeeChart.jsx`: reporting presentation.
- `server/routes/oee.js`: validated HTTP boundary.
- `server/queries/oeeFinishedGoods.sql`: SELECT-only source query.

## Safety and testing

- SYSPRO access is read-only.
- Dates are parameterized; user input is never interpolated into SQL.
- Browser smoke tests intercept finished-goods requests with synthetic JSON and require no live database.
- Automated formula fixtures use constructed synthetic values, not workbook-derived production records.
- Tests cover normal calculations, both cycle-time sources, zero and missing inputs, overnight shifts, multi-run allocation, aggregation, history, and safe endpoint failures.

Before operational use, authorized business owners must approve shift breaks, cycle standards, loss categories, and the operational meaning of any time addend. The application must not invent these values.
