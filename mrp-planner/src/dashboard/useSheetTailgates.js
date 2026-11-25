import { useEffect, useState } from 'react';
import { fetchSheetTailgates, fetchSheetBedliners } from '../api/sysproApi.js';
import { movementRequests } from '../cycleCount/cycleCountMovements.js';

export function useSheetBuiltOutput({ date, shiftRules, enabled, kind }) {
  const requests = movementRequests(date, shiftRules, 'morning', true);
  const [refresh, setRefresh] = useState(0);
  const key = JSON.stringify([kind, date, requests, refresh]);
  const [state, setState] = useState({ key: '', status: 'loading' });
  useEffect(() => {
    if (!enabled || !requests || !date) return;
    const controller = new AbortController();
    setState({ key, status: 'loading' });
    const shifts = requests.map(({ shift, start, end }) => ({ shift, start, end }));
    const fetchOutput = kind === 'bedliners' ? fetchSheetBedliners : fetchSheetTailgates;
    fetchOutput({ date, shifts: JSON.stringify(shifts) }, { signal: controller.signal, timeoutMs: 105000 })
      .then((payload) => {
        if (payload.date !== date || payload.data.length !== 2 || ['120002', '120003'].some((stockCode) => payload.data.filter((row) => row.stockCode === stockCode).length !== 1)
          || payload.windows?.length !== 3 || requests.some((request) => !payload.windows.some((window) => window.shift === request.shift && window.productionDate === date && window.start === request.start && window.end === request.end))) throw new Error('Incomplete or mismatched selected-day production response.');
        if (!controller.signal.aborted) setState({ key, status: 'connected', payload });
      }).catch((error) => { if (!controller.signal.aborted) setState({ key, status: 'unavailable', error: error.message }); });
    return () => controller.abort();
  }, [key, enabled]);
  return { ...(requests && date ? state.key === key ? state : { status: 'loading' }
    : { status: 'unavailable', error: 'Choose a valid date and three non-overlapping configured shifts.' }),
    refresh: () => setRefresh((value) => value + 1) };
}
export function useSheetTailgates(args) { return useSheetBuiltOutput({ ...args, kind: 'tailgates' }); }
export function useSheetBedliners(args) { return useSheetBuiltOutput({ ...args, kind: 'bedliners' }); }
