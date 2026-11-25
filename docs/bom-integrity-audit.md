# BOM integrity investigation and correction

Investigated 17 November 2026 in the current, already modified workspace.
No applicable AGENTS.md files were found in the project or its ancestors.
Existing file hashes were captured before edits to distinguish this task from
unrelated uncommitted work. No real browser storage was opened or reset.

## Diagnosis before edits

The active flow was `BomStructure`/`InvMaster` → `/api/syspro/bom` → `App.jsx`
in-memory BOM state → BOM explorer, ledger adapter, Production MRP,
reconciliation and Sheet Analysis. FCSD had a separate BOM endpoint and mapper.
Saved browser planning items supplied IDs and planning parameters; BOM state
was loaded from SYSPRO, rather than restored from embedded BOM data.

Confirmed reproductions against the pre-edit code:

* A direct factor of `null` produced zero expected consumption and **Tied**
  when synthetic opening/closing stock was zero. The coercion was in
  `deriveMaterialReconciliation.js`, originally lines 34–37 and 67–68.
* Production MRP already made gross requirement and shortfall null for missing
  factors. However, its pack arithmetic converted the null shortfall into zero
  packs/request, and `storeRequests` filtered the unresolved material out.
  Original locations: `deriveProductionMRP.js:98–99,126`. The screen and PDF
  could consequently describe an incomplete request as no material required.
* The main ledger used `Number(qtyPer) || 0`, did not reject indirect cycles,
  and silently dropped BOM lines without local item IDs. Original locations:
  `App.jsx:147–235,705–706`.
* The standard BOM query omitted route, sequence, revision, effectivity and
  unit evidence. The mapper also collapsed missing, blank and invalid factors
  into the same null representation (`server/routes/inventory.js:22–45`).
* Inventory merging only updated existing local items, used case-sensitive
  code keys, and did not preserve live information for referenced items absent
  from the embedded item list (`src/api/sysproApi.js:15–22`).
* Sheet Analysis already rejected missing/negative factors, duplicate direct
  sheet mappings and nested sheet paths. Its remaining defect was accepting
  stock UOM names as proof of the factor's units. Existing protections remain.
* FCSD already detected cycles, missing references, nested policies and negative
  quantities. Its direct requirements loop could still sum duplicate/alternate
  rows and treated whitespace-only factors as numeric zero.
* BOM refreshes retained old rows after errors. Availability was not consistently
  passed into calculations, and competing refreshes lacked latest-request guards.

## Read-only live evidence

The running backend and SQL connection were healthy. Existing endpoints returned
27,543 BOM rows and 6,093 inventory rows; this was not an empty/unavailable BOM.
Live factors consisted of 27,194 positives, 10 explicit zeros and 339 negatives,
with no null factors. Missing/blank/invalid-factor failures were therefore
reproduced synthetically, not asserted to exist in this live snapshot.

The BOM referenced 1,766 distinct normalized stock codes. Of these, 1,694 were
absent from the **embedded 72-item seed**, but all were present in live inventory.
This comparison does not assert that the user's saved browser item list contains
only 72 items; real browser storage was deliberately not inspected.

For example, parent `308013` / component `120003` has seven source lines:

| Route | Sequence | QtyPer |
| --- | --- | ---: |
| 0 | 000000 | 0.75 |
| 1 | 000000 | 0.75 |
| 1 | 000001 | -0.230775 |
| 2 | 000000 | 1 |
| 2 | 000001 | -0.2667 |
| 6 | 000000 | 1 |
| 6 | 000001 | -0.2667 |

The expanded SELECT and mapper preserved all 27,543 source rows and every
QtyPer value. Every mapped line had parent/component stock units and matching
InvMaster references. The combined, **unselected** graph had 1,250 parents;
420 parents had structural alternative/cycle diagnostics, including 189 parents
on detected cycle paths. These are diagnostics of the union of retained source
structures, not proof that an individual selected ERP structure is invalid.

SYSPRO's [BOMSST reference](https://help.syspro.com/business-object-library/G_Objects/bom/bomsst/bomsst.htm)
distinguishes stocking quantities (`QtyPer`, with `UseStockingQuantities=Y`)
from entered quantities (`QtyPerEnt`, according to `UomFlag`). The API now exposes
that stocking basis alongside the joined stock units and retains entered-unit
metadata separately. The application does not invent or apply another conversion.

## Correction

* One server mapper now preserves quantity state/raw value, reference evidence,
  stock units, route/sequence, parent/component revision, effectivity and fixed-
  quantity fields for both BOM endpoints. Code joins normalize case/whitespace.
  Malformed source rows remain in the response for diagnosis.
* Shared frontend validation distinguishes missing, blank, invalid, zero,
  positive and negative factors; rejects ambiguous duplicate/alternate lines,
  cycles, unverified/mismatched unit bases, and unresolved dated/fixed rules.
  It retains every source row and never merges or deletes source BOM lines.
* Live inventory is overlaid in memory for BOM-referenced items, preserving saved
  IDs and business records. Missing local items receive live stock/UOM but no
  invented Make/Buy, planning balance, lead time or pack size. Live-only records
  never enter the saved item master. Saved unit information is retained so local
  balances and pack sizes cannot silently be reused in different live units.
* The ledger engine was extracted without changing valid netting/lead-time
  formulas. Unmapped lines are retained, affected dependency components are
  marked incomplete with null buckets, and disconnected valid demand still
  calculates. Saved planning balances are explicitly identified separately from
  current SYSPRO stock. Known nested ledger behavior remains available when
  saved item policies and all validation inputs are valid.
* Production MRP keeps planned parents and unresolved material rows visible.
  Unknown gross requirements, shortfalls, packs and requests remain null; missing
  live rows cannot fall back to saved stock. Direct nested consumption remains
  unresolved where stocked/phantom handling is unknown.
* Store-request export requires a complete calculation and finite request rows.
  The screen disables incomplete downloads, and the PDF function independently
  rejects incomplete input before fetching logos or creating/saving a PDF.
* Reconciliation uses null for unresolved expected consumption/variance, exposes
  diagnostics, and cannot report Tied or tolerance success for unknown factors.
  Zero remains a valid quantity rather than being confused with missing data.
* Sheet Analysis requires explicit factor-unit evidence and matching stock units;
  unverified contributions cannot become complete or partial numeric totals.
  Its existing negative/duplicate/nested/history protections are preserved.
* FCSD retains unresolved requirement rows rather than summing ambiguous lines,
  keeps negative quantities separately for review, and preserves valid shared-
  component consolidation across different finished parents.
* Refreshes abort superseded requests and ignore late results. Previous BOM rows
  may be inspected after an error, but are clearly identified and excluded from
  complete calculations. Connected-empty, loading and unavailable states differ.
  Dashboard material attention also retains unresolved requirements.

## Files changed in this task

Server contract:

* `server/bomMapping.js` (new)
* `server/routes/inventory.js`
* `server/routes/fcsd.js`

Shared adapters, ledger and BOM display:

* `mrp-planner/src/bom/bomValidation.js` (new)
* `mrp-planner/src/bom/ledgerBom.js` (new)
* `mrp-planner/src/bom/mrpEngine.js` (extracted engine, new file)
* `mrp-planner/src/bom/SysproBomExplorer.jsx`
* `mrp-planner/src/api/sysproApi.js`
* `mrp-planner/src/App.jsx`

Consumers and export:

* `mrp-planner/src/production/deriveProductionMRP.js`
* `mrp-planner/src/production/ProductionMRP.jsx`
* `mrp-planner/src/production/storeRequestValidation.js` (new)
* `mrp-planner/src/production/exportStoreRequestPdf.js`
* `mrp-planner/src/reconciliation/deriveMaterialReconciliation.js`
* `mrp-planner/src/reconciliation/tolerances.js`
* `mrp-planner/src/reconciliation/periodUtils.js`
* `mrp-planner/src/actuals/ProductionActuals.jsx`
* `mrp-planner/src/dashboard/deriveSheetAnalysis.js`
* `mrp-planner/src/dashboard/SheetAnalysis.jsx`
* `mrp-planner/src/dashboard/deriveDashboardSummary.js`
* `mrp-planner/src/dashboard/PlannerDashboard.jsx`
* `mrp-planner/src/fcsd/fcsdRequirements.js`
* `mrp-planner/src/fcsd/FCSDTracker.jsx`

Verification and documentation:

* `tests/bomIntegrity.test.cjs` (new)
* `tests/fcsd.test.cjs`
* `tests/sheetAnalysis.test.cjs`
* `scripts/smoke-bom-integrity.cjs` (new)
* `scripts/smoke-fcsd.cjs` (explicit unit evidence in synthetic fixtures)
* `scripts/smoke-sheet-analysis.cjs` (explicit unit evidence in synthetic fixtures)
* `docs/bom-integrity-audit.md` (this report)

## Verification and limitations

The full suite passes 189 tests, including 14 new BOM integrity regressions:

`node --test --test-isolation=none --test-concurrency=1 tests/*.test.cjs`

The final production build passes (with a non-blocking large-chunk warning).
`git diff --check` passes under the repository's existing line-ending settings;
new files were also checked separately for trailing whitespace.
The isolated browser regression covers all six
consumers, valid direct totals, live-only item overlays, missing factors,
unverified units, alternate/negative lines, empty/offline states, stale snapshot
exclusion, PDF gating, out-of-order FCSD refreshes and saved-record preservation.
Browser business records and API responses are synthetic; a new temporary
headless profile is used, with a guard refusing to replace existing planner data.

Live coverage was SELECT-only connectivity, schema/metadata inspection, the
complete source/mapping comparison and structural diagnostics. Live production
plans, actuals, historical reconciliation and store exports were not validated
against real business records or treated as approved calculations.

Route/revision/effectivity selection, the meaning of duplicate/negative lines,
stocked/phantom handling and missing unit/pack conversions still need established
business or source evidence. DC/CJ Tailgate pairing remains unresolved and was
not changed. No valid source BOM quantities were altered to force a balance.

No commit, deployment, migration, source BOM edit, SYSPRO write or real browser
storage reset was performed. The running API service was not restarted: it must
load the new server code before it can return the expanded BOM contract. Legacy
responses without unit evidence fail safely as incomplete in the new frontend.
The final hash comparison found no unexpected edits or deletions: all 126
pre-existing files outside the 22 deliberately modified files remained byte-
identical to the pre-task baseline. Existing changes in the touched files were
preserved through targeted edits; eight new files, including this report, were
added. OEE, cycle-count/EOS, planning migrations and other unrelated work were
left unchanged.
