# Sheet Analysis: Physical / System

Implemented locally on **23 November 2026**, then revised the same day. The existing Thermoforming Dashboard cards for `120002`, `121047` and `120003` now have **independent Physical / System footer buttons** and one shared production-date selector. The original shared switch, Show evidence and per-card Cycle Count / Production Actuals buttons have been removed. This changes reporting only; it does not edit plans, counts, Actuals, OEE, SYSPRO or PostgreSQL.

## Tailgate production-evidence correction - 25 November 2026

**Implemented locally; completed-day FG receipt journal comparison Live-verified.** Tailgates Built now has an independent backflush/FG endpoint and requires producing-journal/job identity as well as the FG receipt and applicable full-code BOM. The user corrected CJ-CAP to **CJ-RAP**. Route uncertainty after verified production is **Incomplete**; missing producing lineage or other required data is **Unavailable**. Signed verified reversals, duplicate suppression, per-code evidence, numeric verified zero and configured overnight boundaries are covered. Other System rows retain their contracts.

For 18 Nov 06:00 through 19 Nov 06:00 SAST, independent journals confirm **236 DC / 44 CJ / 0 CJ-RAP** FG receipt units. Their producing backflush identity is missing, so both sheet totals remain **Unavailable**, not a confirmed zero or a fabricated 280-unit production total. The new catalog also found 22 additional FG codes with sheet paths, all with no selected-day receipts. Full mappings, all additional codes/quantities, source links, tests, running-browser verification and remaining limitations: [Tailgates Built report](tailgate-backflush.md). D-013 supersedes only the earlier generic Tailgate transfer attribution rule and historical findings below remain dated evidence.

## Scrap route correction - 25 November 2026

**Implemented locally; Live-verified for one completed production day.** Per the user's confirmed mapping (D-012), Scrap & Defect Sheets now counts `B-WIP01 -> B-REG01` for `120002`/`120003` and `B-WIP01 -> B-SCR01` for `121047`. This supersedes the earlier REG classification restriction described in historical verification below. The tooltip names the mapped route; REG alone no longer triggers Classification unverified.

The daily sum uses all three configured shifts, including the next-morning portion of night, in SAST. Count the outgoing source leg once, subtract verified reverse-route returns and signed reversals, and exclude the companion incoming leg and other warehouse routes. Keep inventory issues separate. Missing/unreconciled journal evidence, transaction times, stock units, history coverage or complete shift metadata produces **Unavailable**; a covered, successful no-match day produces **0**. Duplicate copies are removed by movement identity, while conflicting copies make the affected route unavailable.

Read-only SYSPRO verification for **18 Nov 06:00 through 19 Nov 06:00 SAST**, using repository-default shifts:

| Sheet | Mapped destination | System / independent journal | Source legs |
| --- | --- | --- | --- |
| `120002` | `B-REG01` | **52 / 52 Pcs** | 6, including 3 overnight |
| `120003` | `B-REG01` | **2 / 2 Pcs** | 1 |
| `121047` | `B-SCR01` | **0 / 0 Ea** | 0 |

The running frontend `http://127.0.0.1:5173` and its existing API returned these same scrap figures and separate issued totals (356.25 / 56.5 / 51 respectively). Verification used a disposable Edge profile with synthetic plans/counts/settings; only the live acceptance phase's System movement endpoint used real API data. Other browser APIs, including SOH and BOM, were synthetic and are not a live verification claim. The actual operator profile and configured overrides remain uninspected. No services were restarted and no ERP/business records were written. There were no mapped returns/reversals in the selected live sample; those cases have unit/browser fixture coverage.

Validation: 266 tests passed in the serialized full suite; 15 targeted daily tests passed again after adding malformed-row handling. Production build passed with the existing chunk advisory. Eleven browser acceptance groups passed without runtime exceptions, including both routes, wrong-route exclusion, returns/reversals, duplicates, numeric zero, missing journal/time, custom 05:30 cutoff, preserved records and live card/journal comparison. Scripts: `scripts/verify-sheet-analysis-system.cjs 2026-11-18`; browser: set `SHEET_ANALYSIS_ORIGIN=http://127.0.0.1:5173` and `SHEET_ANALYSIS_LIVE=1`, then run `node scripts/smoke-sheet-analysis-system.cjs`. Ignored evidence: `diagnostics/sheet-analysis-system/{live-system-report.json,live-system-journal.json,browser-results.json,scrap-route-cards.png,live-scrap-route-cards.png}`.

The current System row order is exactly:

1. Opening Balance of Sheets
2. Received Sheets
3. SOH in WIP (Closing Balance)
4. Issued Sheets
5. Scrap & Defect Sheets
6. Bedliners Built
7. Tailgates Built

## Physical

The main figure is **3-shift count sum**, the sum of the Morning, Afternoon and Night closing stock snapshots for the selected production date. It is not used as a material balance or compared arithmetically with daily consumption.

Every contributing count must belong to Thermoforming, the selected date/shift, `B-WIP01` and the existing warehouse-level scope (no location). Its shift must be submitted and complete under the existing Cycle Count submission rules. All three shifts must qualify before a total is displayed. Missing/draft/legacy-incomplete shifts, invalid values, duplicate submissions/days/records or a different warehouse produce **Incomplete**. Valid zero is retained. Draft values remain visible in evidence but are excluded from the sum.

Night remains under its start date, even when its count is recorded the following morning. Detailed counts and manual actuals remain available through the application's Cycle Count and Production Actuals modules; the former card evidence drawer and navigation buttons are no longer rendered. These records remain browser-local `mrp-data`.

## Opening and closing historical SOH

Opening Balance of Sheets is the historical B-WIP01 SOH at the close of the **previous production date's night shift**. SOH in WIP (Closing Balance), immediately below Received Sheets, is the historical SOH at the close of the **selected production date's night shift**. Each night belongs to the date it starts, including when it closes the following morning. Both use the configured schedule in Africa/Johannesburg. Neither is the physical snapshot sum or an unadjusted live inventory value. Quantity notes remain hidden; units, source night start date and actual cutoffs remain in hover tooltips. Card view selections persist independently when the shared date changes.

`GET /api/syspro/sheet-analysis/closing-soh` validates the same three configured shift windows and selects Shift 3 (`night` / `SHIFT 03`) by identity, regardless of request array order. It supplies that shift's actual local end timestamp to the existing retained-period EOS SQL and reconciliation service. Only the dashboard's night cutoff is overridden; existing Cycle Count callers keep their original cutoffs. Source SQL is reused, with bound date, cutoff and the three fixed stock codes.

The balance reverses movements at/after the boundary from current SOH only after opening/net/closing financial periods reconcile. Transactions exactly at the cutoff belong to the next shift. Opening is read as soon as the prior night's cutoff passes. The closing row shows **Shift cycle in progress** until the selected night's cutoff, even if the source is unavailable; neither the client nor the API requests a future closing snapshot from SQL. At the cutoff, a timer releases the historical read automatically. Window focus also rechecks after sleep or a clock change. After the cutoff, insufficient or unreconciled history, unsupported movements, missing times/capture metadata, timeout or a response for another date/warehouse/cutoff produces **Historical SOH unavailable**. Verified zero stays **0**. The balance lookups remain independent of receipt/issue/scrap/FG reads, so failure cannot hide those totals. Later backdated postings can revise reconstructed history.

The opening lookup reuses the same closing-SOH endpoint with the previous production date. This makes close-of-19-Nov and opening-of-20-Nov the same stock, warehouse, shift and cutoff request rather than two different balance formulas. No new write endpoint or saved-balance substitution was introduced.

### Live opening / closing acceptance for 20 November 2026

On **23 Nov 2026**, live read-only SYSPRO checks confirmed the completed day and an independent reconstruction from fiscal opening balances plus earlier stock movements. All relevant periods reconciled to current stock, and both reconstruction methods agreed.

| Sheet | Unit | Close of night started 19 Nov = opening 20 Nov, cutoff 20 Nov 06:00 SAST | Close of night started 20 Nov, cutoff 21 Nov 06:00 SAST |
| --- | --- | --- | --- |
| `120002` | Pcs | **890.5** | **903.75** |
| `121047` | Ea | **98** | **98** |
| `120003` | Pcs | **119.25** | **119.25** |

The supplied `120002` example is confirmed, not hardcoded into the application. Additional checks using a 05:30 night close returned the same values for these two dates. Original 18 Nov acceptance below demonstrates a day where moving the configured cutoff does change the result.

Evidence: `diagnostics/sheet-analysis-soh/live-soh-verification-2026-11-19.json`, `live-soh-verification-2026-11-20.json`, and `opening-closing-continuity.json` (ignored local files). Reproduce with `node scripts/verify-sheet-analysis-soh.cjs 2026-11-19` and `node scripts/verify-sheet-analysis-soh.cjs 2026-11-20`. The runner still asserts its known fiscal-period baseline rather than silently using an incorrect period opening.

Eight isolated browser acceptance groups passed, verifying the exact seven-row order, close-19/open-20 continuity for all cards, the example values, opening available while closing is in progress, automatic post-cutoff refresh, confirmed zero, historical unavailability, mixed independent views and preserved records. The browser uses synthetic APIs and a controlled clock; the live values above are separately verified SQL data. Before/exactly-at/after cutoff and year/leap-day boundaries also have unit tests. The production build passed with its existing large-chunk advisory. The complete suite passed **263 tests / 0 failures** with `node --test --test-concurrency=1 tests/*.test.cjs`. Default parallel suite runs hit timing failures in existing dev-startup fixtures; their code was not changed, and they passed in the serialized run. No operator services or live business records were changed.

### Live historical SOH verification

On **23 Nov 2026**, the new read-only endpoint was checked for production date **18 Nov 2026** at two next-morning closing times. An independent SELECT reconstructed each result from the current fiscal period's opening balance plus earlier signed movements. It also reconciled the complete period to current stock. Both methods agreed for every sheet:

| Sheet | UOM | Close 19 Nov 06:00 SAST | Close 19 Nov 05:30 SAST |
| --- | --- | --- | --- |
| `120002` | Pcs | 938 | 939 |
| `121047` | Ea | 98 | 98 |
| `120003` | Pcs | 132 | 132 |

The changed `120002` balance proves the configured cutoff is used instead of a fixed 06:00. HTTP 200 timings were 895 ms and 225 ms. Both are reconstructed historical SYSPRO balances, not archived snapshots or a live operator screen verification.

Earlier independent-card revision validation: **261 automated tests passed**, production build passed (existing chunk advisory), and **6 isolated browser acceptance groups passed** with no runtime errors. Browser coverage included independent mixed views and highlighting, removed controls, SOH row order, confirmed zero, next-day close/date switching, stale responses, historical-only outage/mismatch and retry, preserved posted calculations, and unchanged browser business records. The latest opening/closing acceptance above supersedes these test totals.

Files: `server/services/sheetAnalysisSoh.js` and the existing `cycleCountEos.js` optional cutoff argument; closing route in `server/routes/sheetAnalysis.js`; `mrp-planner/src/dashboard/useSheetClosingSoh.js`; updated card/CSS and API helper; `tests/sheetAnalysisSoh.test.cjs`. Live runner: `node scripts/verify-sheet-analysis-soh.cjs` (fixed November/current-fiscal-period acceptance, asserts the expected period). Evidence: ignored `diagnostics/sheet-analysis-soh/live-soh-verification.json` and `diagnostics/sheet-analysis-system/mixed-card-views.png`. No operator backend was restarted; it must load the new closing-SOH route on its next authorized restart.

Revision preservation check: 202 pre-existing files captured; 9 intended files changed and the other 193 remained byte-identical. Four task files were added. Git diff, UTF-8/whitespace and 24 local documentation-link checks passed.

## System

The dashboard receives actual configured Thermoforming OEE shift times from `App.jsx`. The server validates three distinct, non-overlapping shift windows. All comparisons use plant-local EntryDate/TrnTime, SAST, start inclusive/end exclusive. Overnight belongs to its start date; gaps between configured shifts are excluded.

| Card measure | Rule / unit |
| --- | --- |
| Received sheets | Sum of the three existing Cycle Count movement results: incoming `B-WIP01` transfer legs, with `B-RAW01` origin verified by GTR-linked outgoing journal/movement legs. Sheet stock units. |
| Issued sheets | Signed `MovementType=I`, `TrnType=I` issues from `B-WIP01`, matched to journal quantity/type/UOM. Ordinary outward issues positive; negative issues reduce the total. Transfers, including SCR/REG transfers, are excluded. Sheet stock units. |
| Scrap & defect sheets | `120002`/`120003`: signed `B-WIP01 -> B-REG01` source legs. `121047`: signed `B-WIP01 -> B-SCR01` source legs. Subtract verified returns/reversals; count once across all configured shifts. Other routes are excluded. Journal transfer flag/sign/type/UOM must reconcile. See D-012 and the 25 Nov correction above. |
| Bedliners built | Verified incoming **`B-WIP01 → B-FIN01` receipts**, counted at their FG receipt timestamp and attributed through the positive BOM graph. Finished-part stock units; labelled **posted to finished goods**. |
| Tailgates built | Independent verified backflush-to-FG production rule, applicable full-code BOM and job/material-confirmed route; signed finished-unit receipts in configured shifts. Incomplete for unresolved attribution, Unavailable for missing production evidence, covered no-match 0. See [D-013 report](tailgate-backflush.md). |

Product scope is the existing OEM/FCSD Bedliner and Tailgate stock families (`12606`, `2600038`, `40726`, `2640726`), with master descriptions establishing Bedliner/Lnr versus Tailgate. A code containing `CJ` alone does not establish a Tailgate: for example `N1WB-E12606-SCJ` is a Bedliner. Unclassified posted products stay visible and cannot become a false zero category.

FG and material receipts often have blank incoming `NewWarehouse`. Source is proved by outgoing InvMovements plus InvJournalDet GTR/reference/stock/destination and signed-quantity evidence; source and receipt can have different journals and posting times. Count only the destination receipt for received/output metrics. Outgoing B-FIN01 deliveries/returns are excluded from incoming output; a signed negative receipt reduces the receipt total. No absolute-value summing is applied.

Journal matching uses fiscal year/month, journal, entry, stock and warehouse. Duplicate copies use the full movement primary key; equal quantities or a shared reference do not merge legitimate split receipts. Date-only evidence uses journal identity to preserve separate postings when the time-based key is unavailable. Conflicting copies are unavailable.

### Attribution versus material calculation

Use a fresh complete BOM snapshot. Follow all retained positive consuming paths; zero and negative recovery/by-product lines do not establish consumption. If paths identify different required sheets, references/units are unverified, relevant factors are unknown, or dated/revision selection is unresolved, show **Mapping unverified**. Do not arbitrarily choose route 0 or the first parent/line.

Identity attribution does not calculate consumption: posted part quantity is never multiplied by QtyPer. If a positive cycle revisits an ancestor, retain its warning and continue the other branches. One unique sheet across the complete reachable graph can establish identity despite a quantity-calculation cycle; exceeding traversal depth remains unverified. Production MRP's existing cycle, freshness and incomplete-calculation/export guards are unchanged.

### Availability and posting-date-only sources

- Loading, confirmed zero, incomplete physical counts, unavailable system data and unverified mapping/classification are separate states.
- Zero requires a successful read and, for sheet movement/scrap coverage, a known warehouse and retained history covering the date. One missing shift result cannot become a three-shift zero.
- If FG records lack valid transaction times, show their calendar-date total explicitly **by posting date** and **Unavailable by shift**. Do not assign midnight or mix that calendar total with shift-aligned output. SCR/issue/receipt totals requiring a shift remain unavailable by shift when time evidence is missing.
- `TrnTime` is HHMMSScc. A genuine zero is midnight; SQL rowversion `TimeStamp` and journal posting date alone are not transaction clocks.
- Date/configuration changes clear the old request identity; aborts, late responses, malformed/mismatched results and finite timeouts cannot substitute old figures for the selected day. Physical mode remains usable without any system request.

## Live verification on 23 November 2026

Used the existing approved **live read-only SYSPRO connection**, an isolated Express instance of the new route, and an independent journal-led SELECT. No operator services were restarted. Baseline date: **18 November 2026**, repository-default shifts **06:00–15:00, 15:00–22:00, 22:00–next-day 06:00 SAST**. Operator browser overrides were not accessible. Endpoint HTTP 200; final measured read **6,807 ms**.

| Sheet | Stock UOM | Received: API / journal | Issued: API / journal | Confirmed B-SCR01 | Separate WIP→REG |
| --- | --- | --- | --- | --- | --- |
| `120002` | Pcs | 560 / 560 | 356.25 / 356.25 | 0 | 52 Pcs in 6 postings; defect classification unverified |
| `121047` | Ea | 0 / 0 | 51 / 51 | 0 | None returned |
| `120003` | Pcs | 70 / 70 | 56.5 / 56.5 | 0 | 2 Pcs in 1 posting; defect classification unverified |

Fifty journal-linked postings after midnight on 19 Nov fell inside the 18 Nov overnight window. Example issue times include `19 Nov 00:02:31.470` for `120002` and `00:03:43.100` for `120003`. The independent check excluded 528 records outside the configured windows from its broad two-calendar-day cohort. Exact 15:00/22:00/next-day 06:00 boundaries also have synthetic tests.

Verified negative issue examples from 14 Nov: `120002 -0.75` (journal `993284/17`) and `120003 -6` (`993284/9`), each with the same signed journal quantity. Expense-issue `E` signs remain unverified and unavailable under the existing movement rule. Negative incoming FG/sheet receipt reversal paths and SCR reverse-route handling have synthetic coverage; this completed day's sample does not supply live negative-receipt or SCR-return examples. A broader optional reversal diagnostic encountered a connection reset; it is not treated as evidence of absent reversals. The subsequent narrow issue check and final daily comparison succeeded.

### Finished output and exact DC / CJ findings

All figures below are **EA posted to finished goods**, not recorded forming time or sheet equivalents. Each API quantity matched the independently joined journal quantities.

| Stock code | Posted quantity, selected shifts | Sheet identity |
| --- | --- | --- |
| `N1WB-E12606-SCP` | 224 | `120002`; positive graph cycle warning retained, without calculating consumption |
| `R1WB-E12606-AF` | 60 | `120002` |
| `R1WB-E12606-EE` | 1 | `120002` |
| `N1WB-E40726-DC` | 236 | `120002`; direct route 0 QtyPer 0.25, other consuming paths also identify `120002` |
| `N1WB-E40726-CJ` | 44 | **Mapping unverified**: route 0 directly consumes `120002` at 0.25; routes 2 and 9 use `N1WB-E40726-CJ-RAP`, which consumes `120003` |
| `N1WB-E40726-CJ-RAP` | No receipt in this selected day | Verified `120003` link, route 0 QtyPer 0.25. This is a qualifying CJ code consuming `120003`. |

The Bedliner figure on `120002` is **285 EA**. Tailgate totals on `120002` and `120003` remain **Mapping unverified** because the 44 CJ parts cannot be assigned without the production route. The known 236 DC parts and the 44 unresolved CJ parts remain separate in evidence; neither is duplicated across sheets. No qualifying Bedliner/Tailgate receipt is assigned to `121047` in this sample.

Also verified service aliases: `N1WZ-2640726-K` (DC) has consuming paths to `120002`; `N1WZ-2640726-M` (CJ) has both the direct `120002` path and a nested CJ→CJ-RAP→`120003` path, so is unverified without route selection.

## Tailgate mapping investigation - 23 November 2026

**Live-verified using approved read-only SYSPRO access; application code and business data unchanged.** The warning is reproducible with a fresh, successful feed. An isolated instance of the existing BOM endpoint returned HTTP 200, **27,553 rows in 4,236 ms**. System posting reads returned HTTP 200 with connected posting data for 18 Nov (**6,416 ms**) and 20 Nov (**1,897 ms**). These checks use repository-default SAST shifts, including next-day 06:00; operator browser overrides and the exact currently selected screen were not accessible.

| Production date | DC receipts, verified to `120002` | CJ receipts, sheet unresolved | Tailgate card states |
| --- | --- | --- | --- |
| 18 Nov 2026 | 236 EA | 44 EA | `120002` / `120003`: Mapping unverified; `121047`: 0 |
| 20 Nov 2026 | 291 EA | 36 EA | `120002` / `120003`: Mapping unverified; `121047`: 0 |

All listed receipt rows passed the existing source/journal/type/sign/UOM checks. The blocker is the attribution of **`N1WB-E40726-CJ`**, whose current positive BOM paths are route 0 directly to `120002` (QtyPer 0.25), and routes 2/9 through `N1WB-E40726-CJ-RAP` to `120003` (CJ-RAP route 0 QtyPer 0.25). DC (`N1WB-E40726-DC`) resolves to `120002`. CJ-RAP itself resolves to `120003`; it must not inherit a blanket CJ-to-120002 override.

The BOM API deliberately returns all routes and reports `structureSelection: unresolved`. `sheetMapping` in `mrp-planner/src/dashboard/deriveDailySheetAnalysis.js` rejects different reachable sheets; `dailySystemSheets` then suppresses the entire per-sheet Tailgates total if any relevant posted code is unresolved. Consequently the verified DC subtotal is hidden along with the unresolved CJ quantity. `SheetAnalysis.jsx` displays the returned status; refreshing a healthy feed cannot resolve a missing route decision.

Additional SELECTs checked CJ movements/journals for **18 Nov inclusive through 22 Nov exclusive**, scoped to WIP/FIN receipts and relevant transfers. All **70** matched rows had blank movement/journal Job, LotSerial and additional references. No matching current `WipMaster` jobs for regular CJ or CJ-RAP were returned. Thus adding a simple Job-to-WipMaster.Route join does not resolve these samples. Their GTR references verify WIP-to-FIN transfer legs, but do not identify the originating production/backflush batch.

There is useful supporting evidence: **18 CJ-containing backflush journals**, representing **103 EA** of regular-CJ WIP receipts across that calendar cohort, include `120002` issues and no `120003` issue lines. Example fiscal year/month 2027/8, journal **1008664**: `120002` issue 1 and regular CJ receipt 4. This supports the regular-CJ/120002 path for observed backflush activity. It does **not** establish a unique link from each selected-day FG receipt to its producing batch; FG transfers can draw earlier WIP stock. It therefore cannot by itself verify the selected-day sheet split.

**Smallest recommended follow-up (Proposed):** obtain an ERP/Production-approved, effective-dated rule distinguishing regular CJ from CJ-RAP, including whether regular-CJ routes 2/9 can actually be used. If regular CJ can come from both sheets, use a verified batch/lot/job lineage source before attributing ambiguous FG receipts. Independently, display the verified tailgate subtotal and a separately labelled unassigned quantity, keeping the full total unverified until attribution is resolved. Do not pick route 0 automatically, assign all CJ-suffix codes to one sheet, or infer a batch from matching quantities/timestamps.

Existing targeted mapping tests were rerun: **12 passed, 0 failed**. No new application behavior was introduced, so a build/full regression/browser suite was not repeated. Evidence is in ignored `diagnostics/tailgate-mapping/live-report.json`, `payload-2026-11-18.json`, `payload-2026-11-20.json`, `job-links.json` and `lot-summary.json`; local SELECT-only reproduction scripts are in that same folder. No credentials are included.

## Physical verification limitation

**The operator's actual submitted Cycle Counts and configured override times were not accessible.** No connected document/browser session exposed that localStorage. An asynchronous request for the completed date and nine submitted counts was sent; no values were available when this report was prepared. Therefore this is not a claim of live physical-versus-journal reconciliation. Physical aggregation was verified against submitted synthetic records, including confirmed zeros, all three shifts, draft/missing/duplicate cases and unchanged saved records. The actual nine counts and shift settings are still needed to complete the requested business-day acceptance.

## Initial implementation tests and locations (before the independent-card revision)

- `npm test`: **255 passed, 0 failed** (12 new daily Sheet Analysis tests).
- `npm run build`: passed; existing Vite large-chunk advisory remains.
- `node scripts/smoke-sheet-analysis-system.cjs`: **5 browser acceptance groups passed**, no runtime exceptions. Disposable Edge profile, synthetic APIs, custom configured shifts, Physical/System/evidence, zero/draft/unavailable states, CJ ambiguity, date-only output, retry/late/mismatched responses, retained navigation and saved plan/count/Actual/OEE preservation. No live records were seeded or submitted.
- Live runner: `node scripts/verify-sheet-analysis-system.cjs 2026-11-18`. Credentials are never included in the report. Ignored artifacts: `diagnostics/sheet-analysis-system/live-system-report.json`, `live-system-payload.json`, `live-system-journal.json`, `live-bom.json`, `negative-issues-verified.json`, `browser-results.json` and `system-cards.png`.
- UI/model: `mrp-planner/src/dashboard/SheetAnalysis.jsx`, `deriveDailySheetAnalysis.js`, `useSheetAnalysisSystem.js`, `sheetAnalysis.css`; configuration passed in `App.jsx`; API helper in `src/api/sysproApi.js`.
- API: `server/routes/sheetAnalysis.js`, `server/services/sheetAnalysisSystem.js`, `server/queries/sheetAnalysisPostings.sql`; reuses existing Cycle Count movement service/SQL. The existing SQL gained reference fields for evidence only. Registered in `server/server.js`; existing OEE finished-goods API retains its posting-date-only contract.

No commit, deployment, migration, database write, operator browser reset or operator service restart was performed. The operator's backend must load the new route on its next authorized restart before this dashboard request can work there.

Preservation check: captured 193 pre-existing files; only the 8 intended source/document files changed, with the other 185 byte-identical. Nine task files were added. Git diff checks, UTF-8/trailing-whitespace validation and 23 local documentation links passed. Shared handover status and decisions were updated.
