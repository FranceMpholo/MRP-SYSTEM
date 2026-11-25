const STOCK_CODES = Object.freeze(['120002', '121047', '120003']);
const SHIFTS = Object.freeze(['morning', 'afternoon', 'night']);
const clean = (value) => String(value ?? '').trim();
const number = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const dateText = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : clean(value).slice(0, 10);
const quantity = (value) => Math.round((value + Number.EPSILON) * 1e8) / 1e8;

function shiftWindow(date, shift, start, end) {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!SHIFTS.includes(shift) || !time.test(start) || !time.test(end) || start === end) throw new Error('Invalid shift times');
  // SQL EntryDate/TrnTime are plant wall-clock values, not UTC instants.
  const startLocal = `${date}T${start}:00`;
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const endDate = end < start ? next.toISOString().slice(0, 10) : date;
  return { productionDate: date, shift, start, end, startLocal, endLocal: `${endDate}T${end}:00`,
    startAt: `${startLocal}+02:00`, endAt: `${endDate}T${end}:00+02:00`,
    startDay: date, endDayExclusive: new Date(Date.parse(`${endDate}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) };
}

function movementLocal(row) {
  const raw = number(row.trnTime);
  if (raw === null || raw < 0 || raw > 23595999 || !Number.isInteger(raw)) return null;
  const hours = Math.floor(raw / 1000000), minutes = Math.floor(raw / 10000) % 100, seconds = Math.floor(raw / 100) % 100;
  if (minutes >= 60 || seconds >= 60 || !/^\d{4}-\d{2}-\d{2}$/.test(dateText(row.entryDate))) return null;
  return `${dateText(row.entryDate)}T${[hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':')}.${String(raw % 100).padStart(2, '0')}0`;
}

function unavailable(reason, status = 'unavailable') { return { status, quantity: null, reason }; }
function deriveMovementTotals(window, rows, fetchedAt = new Date().toISOString()) {
  return STOCK_CODES.map((stockCode) => {
    const candidates = rows.filter((row) => clean(row.stockCode) === stockCode);
    const metadata = candidates[0];
    const result = { stockCode, warehouse: 'B-WIP01', productionDate: window.productionDate, shift: window.shift,
      startAt: window.startAt, endAt: window.endAt, fetchedAt, uom: clean(metadata?.stockUom),
      source: 'SYSPRO_TRANSACTION_JOURNAL', qtyReceived: { status: 'available', quantity: 0 }, totalIssue: { status: 'available', quantity: 0 } };
    if (!metadata?.warehouseExists || !metadata.earliestEntryDate || dateText(metadata.earliestEntryDate) > window.startDay) {
      result.qtyReceived = result.totalIssue = unavailable('The stock warehouse or retained movement history does not cover this date.');
      return result;
    }
    const seen = new Map();
    for (const row of candidates) {
      if (!row.entryDate) continue; // successful zero-movement metadata row
      const type = clean(row.trnType), flag = clean(row.transferFlag);
      const metric = type === 'T' ? 'qtyReceived' : ['I', 'E'].includes(type) ? 'totalIssue' : null;
      // Receipts, adjustments and cost changes are not issues or warehouse transfers.
      if (!metric) {
        if (!['R', 'A', 'C'].includes(type)) result.totalIssue = unavailable('An unverified transaction type requires journal review.');
        continue;
      }
      if (metric === 'qtyReceived' && flag === 'O') continue; // WIP outward transfer is not a RAW-to-WIP receipt
      const qty = number(row.trnQty), journalQty = number(row.journalQty);
      if (qty === 0) continue;
      const at = movementLocal(row);
      if (at && !(at >= window.startLocal && at < window.endLocal)) continue;
      if (!at) {
        result[metric] = unavailable('A relevant posting has no valid transaction time; its shift cannot be determined.', 'unavailable_by_shift');
        continue;
      }
      const key = JSON.stringify([stockCode, clean(row.warehouse), row.trnYear, row.trnMonth, dateText(row.entryDate), row.trnTime]);
      const signature = JSON.stringify([row.journal, row.journalEntry, type, qty, journalQty, flag, row.sourceWarehouseMin, row.sourceWarehouseMax, row.newWarehouse, row.journalUom]);
      if (seen.has(key)) {
        if (seen.get(key) !== signature) result[metric] = unavailable('Conflicting copies of a movement require journal review.');
        continue; // identity is the InvMovements primary key, not quantity/reference/time alone
      }
      seen.set(key, signature);
      if (clean(row.warehouse) !== 'B-WIP01' || clean(row.movementType) !== 'I' || clean(row.journalType) !== type
          || qty === null || journalQty === null || Math.abs(qty - journalQty) > 0.0000001
          || !clean(row.stockUom) || !clean(row.journalUom)
          || clean(row.journalUom).toUpperCase() !== clean(row.stockUom).toUpperCase()) {
        result[metric] = unavailable('The movement quantity, type or unit cannot be reconciled to its journal entry.');
        continue;
      }
      if (type === 'E') {
        result.totalIssue = unavailable('Expense-issue signs have not been verified for these sheets; journal review is required.');
        continue;
      }
      if (metric === 'qtyReceived') {
        if (flag !== 'I') { result.qtyReceived = unavailable('The transfer receipt leg cannot be verified.'); continue; }
        const sourceMin = clean(row.sourceWarehouseMin), sourceMax = clean(row.sourceWarehouseMax);
        if (sourceMin && sourceMin !== sourceMax) {
          result.qtyReceived = unavailable('Conflicting transfer source warehouses require journal review.'); continue;
        }
        // NewWarehouse is verified as the destination on outgoing legs. It is
        // often blank on receipts and is never assumed to mean their source.
        const source = sourceMin;
        if (!source) { result.qtyReceived = unavailable('The incoming transfer cannot be linked to a source warehouse.'); continue; }
        if (source !== 'B-RAW01') continue;
      }
      if (result[metric].status === 'available') result[metric].quantity = quantity(result[metric].quantity + qty);
    }
    return result;
  });
}

module.exports = { STOCK_CODES, shiftWindow, movementLocal, deriveMovementTotals };
