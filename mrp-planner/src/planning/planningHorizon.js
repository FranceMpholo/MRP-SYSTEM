import { addCalendarDays } from './planningBoardUtils.js';

export const PLANNING_HORIZONS = [1, 2, 4, 6];
export const DEFAULT_PLANNING_HORIZON = 1;
export const normalizePlanningHorizon = value => PLANNING_HORIZONS.includes(Number(value)) ? Number(value) : DEFAULT_PLANNING_HORIZON;

// View-only selection. Preserve existing past-due analysis, but never fold
// future demand or receipts into the final visible week.
export function horizonOrders(records, activeWeekStart, horizon) {
  const endExclusive = addCalendarDays(activeWeekStart, normalizePlanningHorizon(horizon) * 7);
  return records.filter(record => record.dueDate < endExclusive);
}
