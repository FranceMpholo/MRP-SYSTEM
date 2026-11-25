import { useEffect, useState } from 'react';
import { fetchSheetClosingSoh } from '../api/sysproApi.js';
import { movementRequests } from '../cycleCount/cycleCountMovements.js';
import { REQUIRED_THERMOFORMING_SHEETS } from '../cycleCount/cycleCountUtils.js';

export function previousProductionDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const value = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) return '';
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

export function closingSohTarget(date, shiftRules) {
  const requests = movementRequests(date, shiftRules, 'night', true);
  if (!requests || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const third = requests.find((request) => request.shift === 'night');
  const closeDate = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(closeDate.getTime())) return null;
  if (third.end < third.start) closeDate.setUTCDate(closeDate.getUTCDate() + 1);
  const cutoffLocal = `${closeDate.toISOString().slice(0, 10)}T${third.end}:00`;
  return { requests, cutoffLocal, cutoffAt: new Date(`${cutoffLocal}+02:00`).toISOString() };
}

export function historicalSohValue(state, stockCode, date, target, { kind = 'closing', now = Date.now() } = {}) {
  const row = state?.data?.find((item) => item.stockCode === stockCode);
  if (target && (Date.parse(target.cutoffAt) > now || state?.status === 'awaiting_cutoff' || row?.status === 'in_progress')) {
    return { status: kind === 'closing' ? 'cycle_in_progress' : 'historical_unavailable', quantity: null,
      reason: kind === 'closing' ? 'The selected production date has not finished its third configured shift.' : 'The previous production date night shift has not closed yet.' };
  }
  if (state?.status === 'loading') return { status: 'loading', reason: 'Reading historical SYSPRO SOH.' };
  if (state?.status === 'connected' && row?.status === 'available' && row.productionDate === date && row.warehouse === 'B-WIP01'
      && row.shift === 'night' && target && row.cutoffAt === target.cutoffAt && typeof row.quantity === 'number' && Number.isFinite(row.quantity)) return row;
  return { status: 'historical_unavailable', quantity: null, reason: row?.reason || state?.error || 'The historical closing balance cannot be verified.' };
}

export function useSheetClosingSoh({ date, shiftRules, enabled }) {
  const target = closingSohTarget(date, shiftRules);
  const [refresh, setRefresh] = useState(0);
  const [clockTick, setClockTick] = useState(0);
  const key = JSON.stringify([date, target, refresh]);
  const cutoffPassed = Boolean(target && Date.now() >= Date.parse(target.cutoffAt));
  const [state, setState] = useState({ key: '', status: 'loading' });
  useEffect(() => {
    if (!enabled || !target) return;
    const wake = () => setClockTick((value) => value + 1);
    const remaining = Date.parse(target.cutoffAt) - Date.now();
    const timer = remaining > 0 ? setTimeout(wake, Math.min(remaining, 2147483647)) : null;
    window.addEventListener('focus', wake);
    return () => { if (timer !== null) clearTimeout(timer); window.removeEventListener('focus', wake); };
    // The timer releases the read at the cutoff; focus also handles sleep or clock changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, clockTick]);
  useEffect(() => {
    if (!enabled || !target || !cutoffPassed) return;
    const controller = new AbortController();
    setState({ key, status: 'loading' });
    const shifts = target.requests.map(({ shift, start, end }) => ({ shift, start, end }));
    fetchSheetClosingSoh({ date, shifts: JSON.stringify(shifts) }, { signal: controller.signal, timeoutMs: 105000 })
      .then((payload) => {
        if (payload.date !== date || payload.data.length !== 3 || REQUIRED_THERMOFORMING_SHEETS.some((stockCode) =>
          payload.data.filter((row) => row.stockCode === stockCode && row.productionDate === date && row.warehouse === 'B-WIP01'
            && row.shift === 'night' && row.cutoffAt === target.cutoffAt).length !== 1)) throw new Error('Historical SOH response does not match the selected closing time.');
        if (!controller.signal.aborted) setState({ key, status: 'connected', data: payload.data });
      }).catch((error) => { if (!controller.signal.aborted) setState({ key, status: 'unavailable', error: error.message }); });
    return () => controller.abort();
    // key includes the date, configured cutoffs and retry identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, cutoffPassed]);
  return { ...(target ? !cutoffPassed ? { status: 'awaiting_cutoff' } : state.key === key ? state : { status: 'loading' }
    : { status: 'unavailable', error: 'The configured Shift 3 closing time is invalid.' }), target,
    refresh: () => setRefresh((value) => value + 1) };
}
