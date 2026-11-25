import { CYCLE_COUNT_SHIFTS, REQUIRED_THERMOFORMING_SHEETS } from './cycleCountUtils.js';

export function movementRequests(date, shiftRules, selectedShift, summary = false) {
  const occupied = new Set();
  const rules = CYCLE_COUNT_SHIFTS.map(({ id, planningShift }) => {
    const { start, end } = shiftRules?.[planningShift] || {};
    const valid = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!valid.test(start) || !valid.test(end) || start === end) return null;
    const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const from = minutes(start), duration = (minutes(end) - from + 1440) % 1440;
    for (let n = 0; n < duration; n++) {
      const minute = (from + n) % 1440;
      if (occupied.has(minute)) return null;
      occupied.add(minute);
    }
    return { date, shift: id, start, end };
  });
  if (rules.some((rule) => !rule)) return null;
  return rules.filter((rule) => summary || rule.shift === selectedShift);
}

export function movementDisplay(state, stockCode, metric) {
  if (!REQUIRED_THERMOFORMING_SHEETS.includes(stockCode)) return { text: '—', reason: 'Movement lookup is scoped to the three required sheets.' };
  if (!state || state.status === 'loading') return { text: 'Loading', reason: 'Reading the selected shift from SYSPRO.' };
  if (state.status === 'unavailable_by_shift') return { text: 'Unavailable by shift', reason: state.error };
  if (state.status !== 'connected') return { text: 'Unavailable', reason: state.error || 'SYSPRO movement query failed.' };
  const row = state.data?.find((entry) => entry.stockCode === stockCode);
  const value = row?.[metric];
  if (value?.status === 'available' && typeof value.quantity === 'number' && Number.isFinite(value.quantity)) {
    return { quantity: value.quantity, reason: `${row.startAt} ≤ posting < ${row.endAt}. ${row.uom || 'Stock UOM'}. Net of signed reversals.` };
  }
  return { text: value?.status === 'unavailable_by_shift' ? 'Unavailable by shift' : 'Unavailable', reason: value?.reason || 'No verified movement result for this sheet.' };
}
