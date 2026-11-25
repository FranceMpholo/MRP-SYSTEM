# Thermoforming Cycle Count: read-only shift movements

Implemented 19 November 2026. `Qty Received` and `Total Issue` appear immediately after Physical Count in Count Entry and each shift of Daily Summary. Lookups cover only `120002`, `121047`, and `120003` in `B-WIP01`; optional materials display a dash.

## Data and transaction rules

- New `GET /api/syspro/cycle-count/movements?date=YYYY-MM-DD&shift=morning|afternoon|night&start=HH:mm&end=HH:mm`. The existing EOS API reconstructs balances and lacks transfer-source attribution, so it could not provide these totals.
- Uses the existing approved SQL connection and SELECT statements only. Stock codes and target warehouse are fixed in SQL; all dates/times are bound parameters. SQL returns only the chosen shift's movements, plus relevant postings with invalid times so they cannot silently become zero. Source-leg lookup necessarily includes earlier dates, since a transfer can be received after its outgoing leg's shift.
- The UI supplies the app's configured Thermoforming OEE shift start/end times. Times are plant wall clock, Africa/Johannesburg (UTC+02:00), independent of browser/server timezone. Overnight shifts belong to their starting production date. Windows include their start and exclude their end. Missing, invalid, equal start/end, or overlapping shift settings produce `Unavailable by shift`.
- Timestamps come from `InvMovements.EntryDate` plus `TrnTime` (`HHMMSScc`, hundredths of a second). `InvJournalCtl.JnlDate` alone is not used to infer a shift. SQL `TimeStamp` is a rowversion, not an event time. A real midnight `TrnTime=0` remains valid; null/invalid transaction times produce `Unavailable by shift` for the affected metric.
- **Qty Received:** sum signed WIP transfer receipt legs (`MovementType=I`, `TrnType=T`, journal `TransferFlag=I`). The movement quantity must equal its journal quantity. Source attribution joins the receipt's `GtrReference` to outgoing transfer journal/movement legs, matching stock, reference, destination `B-WIP01`, and sign (`journal.TrnQty=-sourceMovement.TrnQty`). Every matching source warehouse must agree on `B-RAW01`. Incoming `NewWarehouse` is not assumed to be its source: live receipt examples leave it blank. WIP outward transfers, including returns to RAW, are excluded. Source legs are proof of origin, never quantities added to receipts. An unlinked or ambiguous incoming transfer makes Qty Received unavailable rather than understating it.
- **Total Issue:** signed `InvMovements.TrnQty` for inventory issue `MovementType=I`, `TrnType=I`, reconciled to the matching `InvJournalDet` entry. Positive ordinary issues display positive. Negative issue quantities reduce the selected shift total; they are never converted to absolute values. Transfers, receipts, adjustments and cost changes are excluded. Unknown types cannot silently become a zero issue total.
- The journal join uses fiscal year/month, journal, entry number, stock and warehouse. Deduplication uses the complete InvMovements primary key: stock, warehouse, fiscal year/month, entry date and transaction time. It does not merge equal quantities or shared references, preserving legitimate split receipts/issues. Conflicting copies make the affected total unavailable.
- Quantities are in stock UOM. Journal and stock UOM must be present and agree, as must transaction types and signed quantities. A failed reconciliation produces `Unavailable`, without guessing a conversion.

## Availability and preservation

`Loading` means the selected request is pending. `0` requires a successful result, a known stock warehouse and retained history covering the selected date. A failed query, absent warehouse/history, unknown source or unverified transaction semantics produces `Unavailable`. Missing event timing produces `Unavailable by shift`. Cell tooltips explain the cause or show the interval/UOM.

Date, shift, mode and configured-time changes invalidate the old result immediately. Obsolete requests are aborted and cannot overwrite the new selection. Requests have a finite timeout; Refresh movements retries a failed lookup. Daily Summary fetches each configured shift separately.

These totals remain in memory. They do not change physical counts, saved variances, submissions, linked plans/Actuals/OEE, or SYSPRO data. Physical counts and submission are independent of all SYSPRO lookup states.

## Live acceptance evidence

Used the approved **live SYSPRO read-only connection**, not test data, for the following comparison. The new API was mounted in an isolated Express instance, without restarting the operator's running backend. It returned HTTP 200 in 1,064 ms. An independent journal-led SELECT used InvJournalDet quantities and InvMovements timestamps; every incoming receipt was separately checked against its outgoing source journal legs.

**18 November 2026, Morning, 06:00 inclusive to 15:00 exclusive SAST:**

| Sheet | UOM | Qty Received: API / journal | Total Issue: API / journal |
| --- | --- | --- | --- |
| 120002 | Pcs | 280 / 280 | 128.25 / 128.25 |
| 121047 | Ea | 0 / 0 | 51 / 51 |
| 120003 | Pcs | 0 / 0 | 0 / 0 |

Also verified a live 19 November transfer with an outgoing RAW posting at 07:56:51.51 and WIP receipt at 09:35:16.19, both for 140 units and the same GTR reference. Their journals are different; joining by the same journal number would lose this receipt. Verified negative issue examples in the journal, including 120002 `-0.75`, 120003 `-6`, and 121047 `-20`.

Evidence is in ignored local diagnostics: `diagnostics/cycle-count-movements/live-comparison.json` and `browser-results.json`. These contain no credentials. Re-run the SELECT-only live check with `node scripts/verify-cycle-count-movements.cjs`.

## Verification

- `npm test`: **243 passed, 0 failed**, including ten new movement tests. Coverage includes configured times, year rollover, all half-open boundaries, next-day overnight postings, duplicate transfer legs, legitimate split receipts, signed issues and receipt reversals, ambiguous sources, missing times, genuine midnight, invalid units/types, successful zero results, HTTP input validation, SELECT-only SQL and sanitized outages.
- `node scripts/smoke-cycle-count-movements.cjs`: isolated Edge profile and synthetic API data; adjacent read-only columns, Loading/zero/unavailable states, configured times, date/shift switching, late-response isolation, retry, daily summary, physical zero/decimal entry and submission during outage, and persistence after reload. No live application storage or business data is used.
- `npm run build`: succeeded. Vite reports its existing large-chunk advisory.

## Rules still requiring live examples

- No expense-issue (`E`) transactions were found in retained WIP movements for these three sheets. Their sign conventions have not been verified live. Encountering one produces `Unavailable` for Total Issue, requiring journal review before enabling that type. SYSPRO documents `I` as an inventory issue and `E` as an expense issue in its [Inventory Journal Report](https://help.syspro.com/syspro-8-2025/g_programs/imp/imp010/imp010.htm).
- No negative **incoming** transfer legs were found for these sheets. Signed negative receipt-leg handling is covered by synthetic tests, not a live receipt-reversal example. An ordinary outward WIP-to-RAW transfer is a distinct activity and is excluded from Qty Received.
- Transfer sources that cannot be traced through the verified GTR/reference route remain unavailable; alternate journal-link conventions or missing historical source legs are not guessed.

Restart the existing development backend (normally stop and rerun `npm run dev`) to load the added Express endpoint. Verification used isolated servers and did not stop the operator's existing processes.
