# Cycle Count EOS stock on hand

The inventory endpoint returns current stock. Previously, Cycle Count copied that
stock into every shift's `expectedEosSoh`, including days created for past dates.
Those saved numbers cannot establish a historical balance.

`GET /api/syspro/cycle-count/eos?date=YYYY-MM-DD&stockCodes=120002,120003,121047`
now reconstructs B-WIP01 balances for the selected production date. Cutoffs are
15:00, 22:00, and 06:00 the following day, in Africa/Johannesburg (SAST).
Movements exactly at the cutoff belong to the next shift.

The SELECT-only query uses current `InvWarehouse.QtyOnHand`, up to twelve retained
financial-period opening balances, `InvControl.FinYear/FinMonth`, and
`InvMovements.EntryDate/TrnTime`. Financial periods are not calendar months.
`TrnTime` is decoded as HHMMSScc; the SQL driver's UTC-shaped representation of
plant-local timestamps is compared with plant-local cutoff times.

For inventory movements (`MovementType = I`), issues (`TrnType = I`) subtract their
signed quantities; transfers, receipts and adjustments (`T/R/A`) add their signed
quantities. Cost changes (`C`) repeat the balance and do not change quantity.
Each financial period must reconcile its opening balance plus net movements to
its closing balance before it can contribute to the reconstruction. An unknown
movement type, invalid timestamp, mismatch, missing warehouse balance, insufficient
retained history, or unclosed shift yields `expectedEosSoh: null` with a reason.
The twelve-period year assumption is conservative: other period configurations
are unsupported or fail reconciliation. No stock is substituted for unavailable EOS.

Count Entry and Daily Summary use only matching date/shift/code/warehouse results
and recalculate the displayed variance. Switching dates discards the previous
response; cancelled requests cannot overwrite the selected date. Existing physical
counts, recorder details and submitted history are preserved. Old saved EOS and
variance values are not used as a fallback. New physical count edits save the
reconstructed comparison's source, cutoff and fetch timestamp for audit.

These are reconstructed balances by SYSPRO entry date/time. They are not an
immutable record of what was visible at a past instant: later backdated postings
can revise the result. The screen states this and provides Refresh EOS.

Validation includes regression tests, an isolated browser smoke with synthetic
API data, and live read-only checks for all three sheet codes on 13 November
and 15 October 2026. November, October and September financial-period movement
totals reconcile to the retained warehouse balances for all three materials.
