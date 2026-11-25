const { STOCK_CODES, shiftWindow, movementLocal } = require('./cycleCountMovements');
const clean = (value) => String(value ?? '').trim();
const numeric = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const dateText = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : clean(value).slice(0, 10);

function configuredWindows(date, rules) {
  if (!Array.isArray(rules) || rules.length !== 3 || new Set(rules.map((rule) => rule?.shift)).size !== 3) throw new Error('Three shifts required');
  const occupied = new Set();
  return rules.map(({ shift, start, end }) => {
    const window = shiftWindow(date, shift, start, end);
    const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const first = minutes(start), duration = (minutes(end) - first + 1440) % 1440;
    for (let n = 0; n < duration; n++) {
      const minute = (first + n) % 1440;
      if (occupied.has(minute)) throw new Error('Overlapping shifts');
      occupied.add(minute);
    }
    return window;
  });
}

function normalizePostings(rows, windows) {
  const seen = new Map(), result = [];
  for (const row of rows) {
    const warehouse = clean(row.warehouse), destination = clean(row.newWarehouse), type = clean(row.trnType), flag = clean(row.transferFlag);
    const isFg = warehouse === 'B-FIN01';
    if (isFg && type === 'T' && flag === 'O') continue; // delivery/transfer out is not output posted to FG
    if (!isFg && !STOCK_CODES.includes(clean(row.stockCode))) continue;
    // SCR/REG totals use the source leg for both the outward route and returns.
    // Ignore companion incoming legs, even if a feed supplies both sides.
    if (!isFg && type === 'T' && flag === 'I') continue;
    const category = isFg ? 'finishedGoods' : [warehouse, destination].includes('B-SCR01') ? 'scrap' : 'regActivity';
    const at = movementLocal(row), shift = at ? windows.find((window) => at >= window.startLocal && at < window.endLocal)?.shift : null;
    // Keep date-only postings for explicitly labelled calendar posting-date evidence.
    if (at && !shift) continue;
    if (numeric(row.trnQty) && Number(row.trnQty) === 0) continue;
    // A date-only feed cannot expose the time-based movement primary key. Its
    // journal identity still preserves distinct receipts on the same day.
    const id = JSON.stringify([row.stockCode, warehouse, row.trnYear, row.trnMonth, dateText(row.entryDate),
      at ? row.trnTime : ['journal', row.journal, row.journalEntry]]);
    const item = { ...row, stockCode: clean(row.stockCode), warehouse, newWarehouse: destination,
      entryDate: dateText(row.entryDate), postingLocal: at, shift, category, id, status: 'available', reason: '', quantity: null,
      basis: at ? 'entry timestamp' : 'by posting date', shiftStatus: at ? 'available' : 'unavailable_by_shift' };
    const expectedJournalQty = isFg ? Number(row.trnQty) : -Number(row.trnQty);
    if (clean(row.movementType) !== 'I' || type !== 'T' || clean(row.journalType) !== 'T'
        || !numeric(row.trnQty) || !numeric(row.journalQty) || Math.abs(expectedJournalQty - Number(row.journalQty)) > 1e-7
        || !clean(row.stockUom) || !clean(row.journalUom) || clean(row.stockUom).toUpperCase() !== clean(row.journalUom).toUpperCase()
        || flag !== (isFg ? 'I' : 'O')) {
      item.status = 'unavailable'; item.reason = 'Transaction type, transfer leg, signed quantity or stock unit does not reconcile to its journal.';
    } else if (isFg) {
      const min = clean(row.sourceWarehouseMin), max = clean(row.sourceWarehouseMax);
      if (!min || min !== max) { item.status = 'unavailable'; item.reason = 'The FG receipt does not have one verified source warehouse.'; }
      else if (min !== 'B-WIP01') continue;
      else item.quantity = Number(row.trnQty);
    } else item.quantity = warehouse === 'B-WIP01' ? -Number(row.trnQty) : Number(row.trnQty);
    const signature = JSON.stringify([item.trnQty, item.journalQty, item.journal, item.journalEntry, item.status, item.category,
      item.newWarehouse, item.transferFlag, item.movementType, item.trnType, item.journalType, item.stockUom, item.journalUom,
      item.sourceWarehouseMin, item.sourceWarehouseMax]);
    if (seen.has(id)) {
      const previous = seen.get(id);
      if (previous.signature !== signature) {
        previous.item.status = 'unavailable'; previous.item.quantity = null; previous.item.reason = 'Conflicting copies of the same movement require journal review.';
        // A conflicting destination must invalidate both affected routes.
        if (previous.item.newWarehouse !== item.newWarehouse) result.push({ ...item, status: 'unavailable', quantity: null, reason: previous.item.reason });
      }
      continue;
    }
    seen.set(id, { item, signature }); result.push(item);
  }
  return result;
}

module.exports = { configuredWindows, normalizePostings };
