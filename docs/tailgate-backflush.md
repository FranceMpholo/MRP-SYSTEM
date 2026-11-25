# Tailgates Built: verified backflush receipts

Date / assistant / branch: **25 November 2026 / Codex / main**, HEAD `6dcab62`.

**Implemented locally.** The catalog and completed-day inventory journal comparison are **Live-verified** against the approved read-only SYSPRO connection. A qualifying live backflush-to-FG total was **not established** for the selected sample: its FG transfers have no producing-job/batch lineage. Neither card is presented as a confirmed zero.

The user corrected the third verification code from `N1WB-E40726-CJ-CAP` to **`N1WB-E40726-CJ-RAP`** during this task. These remain distinct full stock codes. CAP exists, but its inspected current BOM has no positive path to either required sheet; it is not an alias or override for RAP.

## Reporting contract

The Tailgates Built row has its own read-only `GET /api/syspro/sheet-analysis/tailgates` request. It does not reuse generic WIP-to-FG transfer totals, manual Actuals, or sheet-equivalent calculations. Scrap, issued/received sheets, physical counts, balances, Bedliners and TPO retain their separate contracts.

The server discovers tailgate master candidates by their Tailgate/Tlgt description or stock family, then checks complete stock codes against a fresh BOM snapshot. Catalog entries expose sheet paths, applicable route ambiguity and B-FIN01 warehouse existence. Codes without a finished-goods warehouse are retained as catalog evidence, not silently counted as finished output. An actual receipt into B-FIN01 still requires all posting and production checks.

Count **finished part units** received into `B-FIN01` in the three configured Thermoforming shifts, using SAST start-inclusive/end-exclusive windows. Night belongs to its start date; the exact next-morning cutoff is outside that production day. There is no posting-date-only fallback for Tailgates. The producing backflush's date determines BOM effectivity, including when it differs from the final receipt date. QtyPer establishes positive consumption paths; it never multiplies finished units.

Accepted production evidence:

1. A direct finished `R` receipt in the same inventory journal as its verified backflush material issues from `B-WIP01`.
2. A GTR-linked WIP-to-FG receipt with the same full stock code, reconciled source/receipt legs, and one exact job linking it to a unique producing backflush receipt. The producing journal must contain one output and verified signed material issues from `B-WIP01`.

The inspected source identifies these backflush journals with `Backflush ...` receipt references. The material and receipt journal joins use fiscal year/month, journal, entry, stock and warehouse. GTR proves the transfer through full code/reference/source/destination/flag/sign evidence; it does **not** by itself identify which backflush produced the WIP stock. Job identity must agree across the linked records. Equal quantities, nearby timestamps, successive journal numbers, operator names and a CJ suffix are not production lineage.

When alternate BOM routes reach different sheets, a matching job route or actual sheet-bearing components issued in the producing journal must establish the applicable route family. Multiple routes can qualify if they converge on the same sheet. Conflicting consumption, missing/revision-ambiguous BOM paths and unresolved routing produce **Incomplete** for affected sheets. Verified subtotals and per-code quantities remain in the tooltip and API evidence.

Count receipt copies once using the movement primary key; conflicting copies invalidate the result. Subtract signed, verified receipt reversals and their corresponding material reversals. A GTR reversal must retain its exact source/job/original-production proof. Split GTR quantities requiring allocation, multiple producing receipts/outputs, missing journal/UOM/time data, missing production lineage, uncovered history or missing master/BOM data produce **Unavailable**. Such evidence failures take precedence over attribution-only Incomplete. Successful covered reads with no qualifying receipts produce numeric **0**.

The current adapter deliberately leaves multi-output and ambiguous split/job allocations unavailable. No general allocation policy was invented. A job-linked transfer group exceeding its linked backflush quantity is unavailable.

## Live verification: production date 18 November 2026

Window: **18 Nov 06:00 through 19 Nov 06:00 SAST**, repository-default shifts 06:00-15:00, 15:00-22:00 and 22:00-06:00. Actual operator browser overrides were not inspected.

The new endpoint returned HTTP 200 in **6,231 ms** after lookup optimization. The independent `InvJournalDet`/`InvMovements` comparison agreed on every FG code's receipt quantity. The original nested lookup timed out; it was replaced with bounded receipt, GTR, job and journal-key lookups. No timeouts were hidden or converted to zero.

| Verification code | BOM evidence | FG receipt units: API candidates / independent journal | Units admitted as verified built |
| --- | --- | --- | --- |
| `N1WB-E40726-CJ` | Route 0 consumes `120002`; routes 2/9 can consume `120003` through CJ-RAP | 44 / 44, 11 receipts | None; producing-job/batch lineage missing |
| `N1WB-E40726-DC` | All inspected positive paths identify `120002` | 236 / 236, 58 receipts | None; producing-job/batch lineage missing |
| `N1WB-E40726-CJ-RAP` | Positive path identifies `120003` | 0 / 0 | 0; no selected-day FG receipt |

Both sheet cards return **Unavailable**, with a verified subtotal of 0 and unresolved receipts listed by code. This is not a claim that zero tailgates were built. The 280 transferred units cannot be promoted to backflush-verified production with the inspected evidence. Earlier backflush journals confirm that CJ route 0 is used, but their identities are not linked to these FG receipts.

The inspected FG/source records have blank jobs and lot/reference fields capable of identifying their producing batch. GTR transactions identify source and receipt transfer journals but no backflush journal. A narrowly scoped read of the discovered `MesProduction` table returned no matching known-code rows for the inspected dates; no MES connection or alternative authoritative lineage was established.

## Additional FG codes discovered

There are **22 additional codes** with a current positive BOM path to either sheet and a B-FIN01 warehouse entry. **Every code below had 0 independent-journal FG receipt units and 0 admitted built units in the selected window.** Codes marked route required remain conditional when they do have postings; their zero activity in this sample does not approve a default route.

| Full stock code | Sheet identity / required evidence | FG receipt units | Counted units |
| --- | --- | --- | --- |
| `120051` | `120003` | 0 | 0 |
| `120052` | `120002` | 0 | 0 |
| `308020` | `120003` | 0 | 0 |
| `308021` | `120002` | 0 | 0 |
| `308022` | `120002` | 0 | 0 |
| `KB3Z-2640726-A` | `120002` | 0 | 0 |
| `KB3Z-2640726-B` | `120002` | 0 | 0 |
| `N1WB-E40726-CD` | `120003` | 0 | 0 |
| `N1WB-E40726-CE` | `120002` | 0 | 0 |
| `N1WB-E40726-CF` | `120002` | 0 | 0 |
| `N1WB-E40726-CG` | `120002` | 0 | 0 |
| `N1WB-E40726-CH` | `120002` / `120003`: route required | 0 | 0 |
| `N1WB-E40726-CH-RAP` | `120003` | 0 | 0 |
| `N1WB-E40726-DA` | `120002` | 0 | 0 |
| `N1WB-E40726-DB` | `120002` | 0 | 0 |
| `N1WZ-2640726-D` | `120002` | 0 | 0 |
| `N1WZ-2640726-F` | `120002` | 0 | 0 |
| `N1WZ-2640726-G` | `120002` | 0 | 0 |
| `N1WZ-2640726-H` | `120002` | 0 | 0 |
| `N1WZ-2640726-K` | `120002` | 0 | 0 |
| `N1WZ-2640726-L` | `120002` / `120003`: route required | 0 | 0 |
| `N1WZ-2640726-M` | `120002` / `120003`: route required | 0 | 0 |

Ten additional sheet-consuming master entries are formed/cooled/precut intermediates without B-FIN01 warehouse entries. They remain catalog evidence and were not reported as extra finished output. The complete catalog is in the ignored payload artifact.

## Validation and reproduction

- Final serialized regression suite: **277 passed / 0 failed**. An earlier 276-test run alongside the build/browser workload hit the existing 2-second development-readiness fixture; the subsequent isolated serialized run passed. Startup code was not changed.
- Final targeted tests after receipt-scope/reversal hardening: **26 passed / 0 failed**, including 11 tailgate tests. Coverage includes full CJ/RAP/CAP identity, extra codes, material/job-confirmed routes, mixed/unknown attribution, finished units, duplicates/conflicts, signed reversals, missing data, effective dates/revisions, overnight/default/custom cutoffs, bound-key lookup wiring and SELECT-only/safe-error routes.
- Production build passed with the existing Vite chunk advisory.
- **13 browser acceptance groups passed, no runtime errors**, against the running frontend `http://127.0.0.1:5173` in a disposable Edge profile. Synthetic cases verify numeric totals, reversals/duplicates, Incomplete/subtotal, zero, missing time, isolated endpoint outages and preservation of saved synthetic plan/count/Actual/OEE records. The live phase used a new isolated read-only API instance for Tailgates; the existing operator backend was not restarted. Other browser BOM/SOH/inventory data was synthetic. Live Tailgate cards correctly displayed Unavailable and retained separate Scrap & Defect/Issued totals.

Run `node scripts/verify-tailgate-backflush.cjs 2026-11-18` for the live SELECT-only catalog/journal comparison. For browser acceptance, first also refresh the existing scrap baseline with `node scripts/verify-sheet-analysis-system.cjs 2026-11-18`, then set `SHEET_ANALYSIS_ORIGIN=http://127.0.0.1:5173` and `SHEET_ANALYSIS_LIVE=1` and run `node scripts/smoke-sheet-analysis-system.cjs`.

Ignored artifacts under `diagnostics/tailgate-backflush/`: `live-report.json`, `live-payload.json`, `independent-journal.json`, `live-cards.png`, schema/linkage inspections and `full-test.log`. The report is summarized here because ignored artifacts are not transferred by a checkout. No credentials are recorded.

Implementation: `server/queries/tailgateBackflush.sql`, `server/services/tailgateBackflush.js`, the new route in `server/routes/sheetAnalysis.js`, frontend `useSheetTailgates.js` and API helper, `deriveDailySheetAnalysis.js`, `SheetAnalysis.jsx`; tests in `tests/tailgateBackflush.test.cjs` and the updated daily/browser acceptance scripts.

Next action: obtain an authoritative GTR/FG-receipt-to-producing-backflush batch/job identity or an approved allocation source from ERP ownership. Load the new endpoint on the operator backend's next authorized restart, then review the actual configured shifts. No ERP/PostgreSQL writes, real browser business-record changes, deployment, migration, commit or operator service restart occurred. See [PROJECT_STATUS.md](PROJECT_STATUS.md) and [DECISIONS.md](DECISIONS.md) D-013.
