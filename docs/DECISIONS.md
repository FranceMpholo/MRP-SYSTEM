# MRP Planner decisions

Recorded **19 November 2026** from inspected working-tree code, existing feature documentation and prior verification artifacts. These entries capture existing boundaries unless marked as a new decision. They are not deployment or business-approval claims. Update [PROJECT_STATUS.md](PROJECT_STATUS.md) for current results and follow [../AGENTS.md](../AGENTS.md) for handover rules.

## D-001 — One repository handover for all assistants

**Status: Implemented locally. New documentation decision in this task.**

Codex, Antigravity and VS Code Chat share root `AGENTS.md`, `docs/PROJECT_STATUS.md` and this file. Read them and inspect Git status at task start. At task end, record changes and file locations, actual tests/results, remaining verification, branch/uncommitted work and next action. Record lasting decisions here; explicitly supersede old entries when their rationale changes.

Use Proposed / Implemented locally / Live-verified with scope and dates. A client that does not automatically load AGENTS must be directed to open it. Existing feature documents remain detailed references rather than being replaced. Git-ignored diagnostics are supplementary; summarize essential evidence in shared documentation so it survives a checkout transfer.

## D-002 — Preserve the dirty worktree and business records

**Status: Implemented locally as the shared workflow rule; follows existing preservation requirements.**

Existing tracked edits and untracked files are part of the project state. Inspect before editing; do not reset or discard work to simplify a task. Shared worktree editors must coordinate overlapping files. Preserve saved plan IDs, linked Actuals/OEE, physical counts, manual editing and existing exports. An isolated test approval/import is not permission to change an operator's real plan.

## D-003 — Active planner persistence remains browser-local

**Status: Implemented locally; verified with synthetic storage/browser tests, not shared production data.**

The active UI uses `mrp-data` through `App.jsx`'s localStorage shim, `plannerStorage.js` and `plannerSaveLifecycle.js`. Save errors retain in-memory work; the serialized import/save path avoids exposing a successful import before storage succeeds. This is one browser origin/profile and one mounted planner's save queue, not shared multi-user storage or cross-tab locking.

Rationale: retain existing local records and editing while backend migration is incomplete. Do not infer PostgreSQL synchronization from the presence of a PostgreSQL route or migration. A future shared persistence transition needs explicit data migration, conflict/identity handling and linked-record preservation. See [PROJECT_STATUS.md](PROJECT_STATUS.md) and [production-plan-excel-import.md](production-plan-excel-import.md).

## D-004 — PostgreSQL planning mutations fail closed

**Status: Implemented locally and HTTP fixture-tested. Authenticated shared writes: Proposed.**

Keep the leading `/api/mrp` middleware allowing only GET/HEAD/OPTIONS. Other methods return 503 `PLANNING_WRITES_UNAVAILABLE` before route/database mutation work, including alternate/future write paths. Existing handlers remain preserved behind that restriction.

Rationale: browser identity/roles or the mere presence of a bearer token are not verified server authentication. Replace the gate only in a separately scoped server authentication/authorization implementation with operation/resource checks and verified actor attribution. The current gate is containment, not completed authentication. See [planning-write-restriction.md](planning-write-restriction.md).

The Phase A run/output migration is implemented as SQL files with constraint/rollback tests. Its live execution is not established by this handover. No migration, backfill, frontend switch or enabled write API follows automatically from those files. See [planning-runs-migration.md](planning-runs-migration.md).

## D-005 — Fresh BOM availability precedes parent absence and calculations

**Status: Implemented locally; scoped read-only live verification on 19 Nov 2026.**

Assess parent absence only after a successful complete BOM read: connected, not loading, no error. Retained stale rows may be displayed with provenance but cannot approve calculations/export. Keep still-loading, feed-unavailable, fresh-but-parent-absent and fresh-but-validation-incomplete distinct. Stock-code normalization is trim plus uppercase; preserve source lines and diagnostics rather than inventing replacements.

Rationale: outage/latency is not proof of a missing parent. The three reported parents survived live SQL → API → frontend tracing. Their original selected-plan symptom was not reproduced; the actual operator-selected entries remain unverified. Do not present an older tab/build or `parentStockCode` override as a confirmed root cause. Route/revision/effectivity, duplicate/negative-line and nested/phantom policies remain unresolved business/source questions. See [bom-integrity-audit.md](bom-integrity-audit.md) and the scoped evidence in [PROJECT_STATUS.md](PROJECT_STATUS.md).

## D-006 — Cycle Count movements are read-only, shift-scoped and evidence-based

**Status: Implemented locally; totals Live-verified for 18 Nov 2026 Morning on the three required sheets.**

Use the existing approved read-only SYSPRO connection. The new movement query is restricted to `120002`, `121047`, `120003` and WIP receipt/issue reporting. Use configured Thermoforming OEE shift times in SAST, assign overnight shifts to their start date, and use start-inclusive/end-exclusive windows. Do not infer a shift from a posting date alone.

Qty Received counts signed incoming `B-WIP01` transfer legs once, proving `B-RAW01` origin via matching GTR source journal legs. Total Issue counts signed verified inventory issues; outward issues are positive, negative issues reduce the net total, and outward transfers are excluded. Duplicate query copies are distinguished from legitimate split postings by the full movement primary key. Journal types, quantities and stock units must reconcile.

Use Loading / Unavailable / Unavailable by shift for their respective states. A successful, covered no-match query may return zero. Unverified expense-issue `E` signs produce Unavailable; negative incoming receipt handling has synthetic tests but no observed live example. Keep physical entry/submission independent of lookup failure, and do not persist these transient totals as manual count data. The separate EOS reconstruction has its own fixed-cutoff contract. See [cycle-count-movements.md](cycle-count-movements.md) and [cycle-count-eos.md](cycle-count-eos.md).

## D-007 — MES integration remains an explicit future scope

**Status: Proposed; no implementation or live connection evidence found.**

Do not label existing manual Actuals/OEE screens, browser-local records, PostgreSQL schema files or read-only SYSPRO feeds as MES integration. No MES product/endpoint, source contract or machine ingestion implementation was established by this inspection.

Before implementation, establish source ownership, identifiers for stock/machine/plan/run, event timestamps/shift rules, duplicate and correction semantics, authentication and data direction. This records prerequisites, not a chosen MES architecture or authorization to connect/write to another system.

## D-008 — Daily Sheet Analysis keeps physical snapshots and system postings distinct

**Status: Implemented locally on 23 Nov 2026. Daily SYSPRO figures Live-verified for 18 Nov using repository-default shifts; actual operator Cycle Count acceptance remains pending.**

The initial shared Physical / System control is superseded by D-009 below. Physical remains a **3-shift count sum** of submitted, complete B-WIP01 snapshots; missing/draft/duplicate data suppresses the full sum, while zero remains valid. This sum is not substituted for day-end inventory or consumed sheets.

System uses all three configured OEE shifts in SAST, overnight under its start date. Count source-proven incoming RAW→WIP receipts and signed WIP inventory issues separately from SCR/REG transfers. REG is mixed recovery/regrind activity and cannot establish an unqualified Scrap & defect total. Finished quantities use verified WIP→FIN receipt timestamps and remain in part units, explicitly labelled **posted to finished goods**. Date-only figures are labelled **by posting date**, with shift alignment unavailable.

Finished-to-sheet attribution follows the complete positive current BOM graph without multiplying by QtyPer. One unique reachable sheet can establish identity despite a cycle warning; this does not approve consumption arithmetic or weaken Production MRP's cycle/freshness guards. Distinct sheet paths, unknown references/factors, dated/revision ambiguity, an unclassified finished product or incomplete traversal remain Mapping unverified. Current mapping is not claimed as historical route proof.

Live finding: `N1WB-E40726-CJ-RAP` consumes `120003`. Regular `N1WB-E40726-CJ` has a direct `120002` path and alternatives through CJ-RAP, so it cannot be assigned by the `CJ` suffix or the first/direct BOM row. DC resolves to `120002`. See [sheet-analysis-physical-system.md](sheet-analysis-physical-system.md) for exact codes, journals, tests and remaining business verification. Browser-local counts, Actuals, OEE and existing OEE posting-date API behavior are preserved.

## D-009 — Independent card views and configured Shift 3 historical SOH

**Status: Implemented locally on 23 Nov 2026; historical SOH Live-verified against SYSPRO for 18 Nov at next-day 06:00 and 05:30 closes.**

Supersedes only D-008's shared view control and the former card evidence/navigation UI. Each required sheet has Physical / System buttons at its footer, with its own active state. The date selector remains shared. Changing a card or date does not reset the other card views. Show evidence, Cycle Count and Production Actuals buttons are removed from the cards; those application modules and their saved records remain intact.

System adds SOH in WIP (end of Shift 3) immediately after Received sheets. Use the actual configured SHIFT 03 end date/time, including next-day closes. Reuse retained-period EOS reconciliation with an explicit dashboard cutoff, preserving existing Cycle Count default cutoffs. Never substitute current inventory or a physical count when history cannot be verified; display Historical SOH unavailable. Keep verified zero numeric.

The SOH request is independent of existing movement/output requests. Receipt, issue, scrap/REG, finished-goods and physical aggregation rules remain as in D-008. The live comparison reconstructed historical SOH both backwards from current stock and forwards from the reconciled fiscal opening; results agreed. See the [updated feature report](sheet-analysis-physical-system.md).

Presentation refinement, 23 Nov 2026: remove secondary notes beneath all System quantities on the three cards. Units, warehouse/closing-time context and posting-date/classification details remain in quantity hover tooltips; primary quantities and unavailable/unverified states are unchanged. Physical rendering and all calculations remain unchanged.

## D-010 — Opening is the previous night's historical close; closing waits for the current cycle

**Status: Implemented locally on 23 Nov 2026; completed-day balances and close-to-opening continuity Live-verified for all three sheets for 19/20 Nov.**

Supersedes D-009's single-balance row label/order. System now renders Opening Balance of Sheets, Received Sheets, SOH in WIP (Closing Balance), Issued Sheets, Scrap & Defect Sheets, Bedliners Built and Tailgates Built, in that order. Independent card buttons and the shared date remain unchanged; quantity notes remain in hover tooltips.

Opening is the verified B-WIP01 balance at the end of the previous production date's configured night shift. Closing is the balance at the end of the selected production date's night shift. Each night is assigned to its start date in Africa/Johannesburg. The opening query is the exact same closing-SOH read used for the previous date, preserving continuity without another balance formula.

Before its cutoff, closing displays Shift cycle in progress. A timer (and focus recheck after sleep/clock changes) starts the read when the cutoff passes; the backend also refuses to query a future close. Opening becomes readable when its own previous-night cutoff passes. After a passed cutoff, only verified historical values or reconciled complete-movement reconstructions are displayed; failure is Historical SOH unavailable and verified zero is 0. No unadjusted current SOH is substituted.

Live acceptance confirmed `120002` 20 Nov opening **890.5 Pcs**, closing **903.75 Pcs**; `121047` **98 → 98 Ea**, `120003` **119.25 → 119.25 Pcs**. Each opening equals the previous date's close. Prior physical, posted movement, product attribution and stale-data safeguards remain unchanged. See [feature report](sheet-analysis-physical-system.md).

## D-011 — Sheet 121047 is TPO Sheet; displays TPO Built instead of Bedliners and Tailgates

**Status: Implemented locally on 23 Nov 2026; verified with unit tests (264/264 passing).**

Rationale:
Stock code `121047` is `Sheet TPO Smooth B260 JA6 Black 2.0mmx189x277cm` (TPO Sheet). It is consumed by thermoformed TPO floor parts (such as `N1WB-E13036-K` and `N1WB-E13036-N`), not by Bedliners (`12606`/`2600038`) or Tailgates (`40726`/`2640726`), which consume HDPE sheets (`120002` and `120003`). Displaying "Bedliners Built" and "Tailgates Built" on card `121047` was incorrect.

Changes:
- **Frontend Card (`SheetAnalysis.jsx`):** Card `121047` displays `TPO Sheet` in the header subtitle and renders `<Metric label="TPO Built" ...>` instead of `Bedliners Built` and `Tailgates Built`. Cards `120002` and `120003` retain `Bedliners Built` and `Tailgates Built`.
- **Classification & Attribution (`deriveDailySheetAnalysis.js`):** `finishedProductRole` identifies TPO parts (`13036` and descriptions containing `TPO`) with role `'tpo'`. `dailySystemSheets` calculates `tpo` built output alongside `bedliners` and `tailgates`.
- **SQL Query (`server/queries/sheetAnalysisPostings.sql`):** Added `OR m.StockCode LIKE '%13036%'` to B-FIN01 finished goods selection so TPO finished postings are retrieved.

## D-012 - Scrap & Defect uses the stock-specific warehouse route

**Status: Implemented locally on 25 Nov 2026; Live-verified for production date 18 Nov using default configured shifts and the running localhost app in a disposable profile.**

Supersedes D-008's REG classification restriction and the scrap rule inherited by D-009/D-010. The user explicitly confirmed this mapping: `120002` and `120003` count `B-WIP01 -> B-REG01`; `121047` counts `B-WIP01 -> B-SCR01`. Other destinations do not contribute to that sheet's Scrap & Defect total and do not trigger a classification warning.

Use posted transfer source legs once, across all three configured Thermoforming shifts in SAST, with overnight assigned to its start date. Windows are start-inclusive/end-exclusive; the exact night cutoff belongs outside the selected production day. Subtract verified reverse-route returns and signed reversals on the original route. Journal type, source-leg flag, signed quantity and stock units must agree; duplicate copies count once, conflicting copies make affected routes unavailable. Companion incoming legs are excluded. Inventory issues remain a separate metric excluding transfers.

A successful complete read with warehouse/history coverage and consistent stock units permits numeric zero. Missing posting rows, incomplete shift metadata, missing/unreconciled journal data, inconsistent units or missing transaction times produce **Unavailable** for Scrap & Defect, with the reason retained in its tooltip. Posting-date-only FG behavior and all physical/closing-SOH/BOM safeguards remain unchanged.

Evidence: 18 Nov 06:00 through 19 Nov 06:00 SAST, independent SELECT-only journal comparison and the running System cards agreed on `120002` **52 Pcs** (6 source legs), `120003` **2 Pcs** (1 leg), `121047` **0 Ea** (no SCR legs). Three `120002` legs were overnight. No mapped returns/reversals occurred in that selected live sample; both paths are covered synthetically. The operator's browser-local shift overrides and business records were not inspected or changed. See [feature report](sheet-analysis-physical-system.md) and [current handover](PROJECT_STATUS.md).

## D-013 - Tailgates Built requires production evidence as well as FG receipt evidence

**Status: Implemented locally on 25 Nov 2026. Catalog and inventory-journal receipt comparison Live-verified; a qualifying live production total is not established for the selected sample.**

Supersedes D-008's generic FG transfer/BOM-only rule for **Tailgates Built only**. The user clarified that the third known code is `N1WB-E40726-CJ-RAP`, not CJ-CAP. All full codes remain distinct; neither CJ's default route nor any suffix is hardcoded as a sheet override.

Discover tailgate master/BOM candidates, retain all positive applicable paths, and count finished units only when the B-FIN01 receipt is linked to a verified producing backflush with B-WIP01 material consumption. A direct backflush receipt uses its own journal; a GTR receipt additionally requires exact full-code/source/receipt/job lineage to a unique producing receipt. A matching job route or actual sheet-bearing components in that journal must resolve alternate routes. QtyPer is never multiplied into finished units. Use configured SAST shifts at the FG receipt timestamp; BOM effectivity follows the producing backflush date. Deduplicate movement copies, reject conflicts, and subtract signed verified reversals.

Route/BOM attribution still unresolved after production verification means **Incomplete**, with a separately labelled verified subtotal and per-code evidence. Missing production identity, time, journal agreement, stock units, history, fresh master/BOM or allocation evidence means **Unavailable**, which takes precedence over attribution-only uncertainty. A covered successful no-match query permits **0**. No calendar-date fallback applies to Tailgates. Split quantities or multiple producing receipts/outputs requiring an allocation remain unavailable pending an approved source. Other System rows retain their existing contracts.

Evidence and constraint: the 18 Nov default-shift journal has **236 DC** and **44 CJ** units received into FG, but blank producing-job/batch lineage. GTR source legs establish transfers, not a link to the backflush that produced their WIP stock. Both Tailgates Built totals therefore remain Unavailable; this must not be described as zero production. CJ route 0 -> `120002`, DC -> `120002` and CJ-RAP -> `120003` are verified BOM cases; CJ's routes 2/9 still reach `120003`. Twenty-two additional FG master/BOM candidates had no selected-day receipts. See [tailgate report and full code list](tailgate-backflush.md).
