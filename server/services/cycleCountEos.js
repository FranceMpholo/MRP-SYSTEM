const SHIFTS = [
  { id: 'morning', hour: 15 },
  { id: 'afternoon', hour: 22 },
  { id: 'night', hour: 30 },
];
const finite = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
const round = (value) => Math.round(value * 10000) / 10000;

function deriveEosBalances(date, stockCodes, rows, cutoffWallTimes = {}) {
  return stockCodes.flatMap((stockCode) => {
    const periods = rows.filter((row) => row.stockCode === stockCode).sort((a, b) => a.periodOffset - b.periodOffset);
    const first = periods[0];
    const fetchedAt = first?.fetchedAt ? new Date(first.fetchedAt).toISOString() : null;
    const validated = [];
    for (const period of periods) {
      if (period.periodOffset !== validated.length || period.currentPeriod < 1 || period.currentPeriod > 12
          || ![period.openingQty, period.closingQty, period.netQty].every(finite)
          || period.unsupportedCount > 0 || period.invalidTimeCount > 0
          || Math.abs(Number(period.openingQty) + Number(period.netQty) - Number(period.closingQty)) > 0.00011) break;
      validated.push(period);
    }
    const earliest = validated.map((row) => row.earliestMovement && new Date(row.earliestMovement).getTime()).filter(Boolean);
    const coverageStart = earliest.length ? Math.min(...earliest) : null;
    return SHIFTS.map(({ id: shift, hour }) => {
      // EntryDate/TrnTime are plant-local wall times; the SQL driver represents
      // them as UTC-shaped dates. Compare coverage using that same wall clock.
      const cutoffWallTime = cutoffWallTimes[shift] ?? Date.parse(`${date}T00:00:00Z`) + hour * 3600000;
      const cutoffAt = new Date(cutoffWallTime - 2 * 3600000).toISOString();
      let reason = null;
      if (!first || !finite(first.currentSoh)) reason = 'No B-WIP01 balance exists for this stock code.';
      else if (Date.parse(cutoffAt) > Date.parse(fetchedAt)) reason = 'This shift has not closed yet.';
      else if (!validated.length) reason = 'Movement history does not reconcile to the SYSPRO opening and current balances.';
      else if (coverageStart === null || cutoffWallTime < coverageStart
          || periods.slice(validated.length).some((row) => row[`${shift}AfterCount`] > 0 || row.invalidTimeCount > 0)) {
        reason = 'Complete reconciled movement history is unavailable for this shift close.';
      }
      const afterQty = validated.reduce((sum, row) => sum + Number(row[`${shift}AfterQty`] || 0), 0);
      return {
        stockCode, warehouse: 'B-WIP01', productionDate: date, shift, cutoffAt,
        expectedEosSoh: reason ? null : round(Number(first.currentSoh) - afterQty),
        status: reason ? 'unavailable' : 'available', reason, fetchedAt,
        source: 'SYSPRO_RECONSTRUCTED_SHIFT_CLOSE',
      };
    });
  });
}

module.exports = { deriveEosBalances };
