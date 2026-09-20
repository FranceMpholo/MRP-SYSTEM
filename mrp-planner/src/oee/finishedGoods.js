import { getParentPair, BLOW_MOULDING_PARENT_PAIRS } from '../planning/blowMouldingParentPairs.js';
import { classifyThermoformingParent } from '../production/productionLines.js';
import { numberOrNull } from './deriveOee.js';

export function deriveFinishedGoods(payload, rows, filters, productionLine) {
  const empty = { available: false, movements: [], products: [], comparison: [], reason: 'Data Incomplete: B-FIN01 movement data unavailable.' };
  if (payload === null) return empty;
  if (filters.machine !== '' || filters.shift !== '') return { ...empty, reason: 'Data Incomplete: transfers cannot be allocated reliably to a production machine or shift. Select all machines and shifts for period visibility.' };
  const bmCodes = new Set(BLOW_MOULDING_PARENT_PAIRS.flatMap(pair => pair.parents));
  const plannedCodes = new Set(rows.flatMap(row => row.pair?.parents ?? [row.product]));
  const query = filters.product.trim().toLowerCase();
  const movements = payload.data.filter(row => row.date >= filters.startDate && row.date <= filters.endDate
    && (productionLine === 'thermoforming' ? classifyThermoformingParent(row.stockCode) !== null : bmCodes.has(row.stockCode) || plannedCodes.has(row.stockCode))
    && (query === '' || row.stockCode.toLowerCase().includes(query) || plannedCodes.has(row.stockCode)));
  const products = [...new Set(movements.map(row => row.stockCode))].sort().map(stockCode => {
    const selected = movements.filter(row => row.stockCode === stockCode);
    const uoms = [...new Set(selected.map(row => row.uom?.toUpperCase()))];
    return { stockCode, uom: uoms.length === 1 ? uoms[0] : 'Mixed units',
      incoming: uoms.length === 1 ? selected.filter(row => row.direction === 'Into FG').reduce((sum, row) => sum + row.quantity, 0) : null,
      returned: uoms.length === 1 ? selected.filter(row => row.direction === 'FG to WIP').reduce((sum, row) => sum + row.quantity, 0) : null };
  });
  const comparison = [...new Set(rows.map(row => row.product))].map(product => {
    const selected = rows.filter(row => row.product === product), pair = getParentPair(product), codes = pair?.parents ?? [product];
    const transfers = codes.map(code => products.find(row => row.stockCode === code));
    // Require observed EA movements for each parent. Absence is not fabricated as zero.
    const compatible = transfers.every(row => row !== undefined && row.uom === 'EA') && selected.every(row => numberOrNull(row.goodParts) !== null && row.goodParts >= 0 && row.totalProduced !== null && row.goodParts <= row.totalProduced)
      && (productionLine === 'thermoforming' || pair !== null);
    if (!compatible) return { label: product, valid: false };
    const goodParts = selected.reduce((sum, row) => sum + row.goodParts, 0) * (pair === null ? 1 : pair.parents.length);
    const fgTransferred = transfers.reduce((sum, row) => sum + row.incoming, 0);
    return { label: pair?.displayCode ?? product, valid: true, goodParts, fgTransferred, pendingFg: goodParts - fgTransferred,
      normalization: pair === null ? 'Individual parts (EA)' : 'Good mould sets × 2 = physical LH + RH pieces; not matched pairs' };
  });
  return { available: true, movements, products, comparison, reason: 'Period posting visibility only; transfers are not linked to individual production runs.' };
}
