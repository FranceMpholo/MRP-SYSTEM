import { useEffect, useState } from 'react';
import { fetchCycleCountMovements } from '../api/sysproApi.js';
import { CYCLE_COUNT_SHIFTS, REQUIRED_THERMOFORMING_SHEETS } from './cycleCountUtils.js';
import { movementRequests } from './cycleCountMovements.js';

export function useCycleCountMovements({ date, shiftRules, shift, summary, enabled }) {
  const requests = movementRequests(date, shiftRules, shift, summary);
  const key = JSON.stringify([enabled, date, shift, summary, requests]);
  const [state, setState] = useState({ key: '', shifts: {} });
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!enabled || !requests) return;
    const controller = new AbortController();
    const loading = Object.fromEntries(requests.map((request) => [request.shift, { status: 'loading' }]));
    setState({ key, shifts: loading });
    for (const request of requests) {
      fetchCycleCountMovements(request, { signal: controller.signal, timeoutMs: 105000 })
        .then((payload) => {
          // Reject incomplete/mismatched responses; never show another date's cached totals.
          if (payload.data.length !== REQUIRED_THERMOFORMING_SHEETS.length || REQUIRED_THERMOFORMING_SHEETS.some((code) =>
            payload.data.filter((row) => row.stockCode === code && row.productionDate === date && row.shift === request.shift && row.warehouse === 'B-WIP01').length !== 1)) {
            throw new Error('SYSPRO did not return a complete result for the selected shift.');
          }
          if (!controller.signal.aborted) setState((previous) => previous.key !== key ? previous : {
            key, shifts: { ...previous.shifts, [request.shift]: { status: 'connected', data: payload.data } },
          });
        })
        .catch((error) => {
          if (!controller.signal.aborted) setState((previous) => previous.key !== key ? previous : {
            key, shifts: { ...previous.shifts, [request.shift]: { status: 'offline', error: error.message } },
          });
        });
    }
    return () => controller.abort();
    // key contains all request fields, including configured start/end times.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refresh]);
  const shifts = !requests ? Object.fromEntries(CYCLE_COUNT_SHIFTS.map(({ id }) => [id, {
    status: 'unavailable_by_shift', error: 'Configured shift times are missing, invalid or overlapping. Check OEE Settings.',
  }])) : state.key === key ? state.shifts : {};
  return { shifts, refresh: () => setRefresh((value) => value + 1), loading: enabled && Boolean(requests) && requests.some((request) => !shifts[request.shift] || shifts[request.shift].status === 'loading'), requests };
}
