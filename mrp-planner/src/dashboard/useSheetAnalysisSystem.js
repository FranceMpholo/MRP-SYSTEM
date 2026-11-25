import { useEffect, useState } from 'react';
import { fetchSheetAnalysisSystem } from '../api/sysproApi.js';
import { movementRequests } from '../cycleCount/cycleCountMovements.js';
import { REQUIRED_THERMOFORMING_SHEETS } from '../cycleCount/cycleCountUtils.js';

export function useSheetAnalysisSystem({ date, shiftRules, enabled }) {
  const requests = movementRequests(date, shiftRules, 'morning', true);
  const [refresh, setRefresh] = useState(0);
  const key = JSON.stringify([date, requests, refresh]);
  const [state, setState] = useState({ key: '', status: 'loading' });
  useEffect(() => {
    if (!enabled || !requests || !date) return;
    const controller = new AbortController();
    setState({ key, status: 'loading' });
    const shifts = requests.map(({ shift, start, end }) => ({ shift, start, end }));
    fetchSheetAnalysisSystem({ date, shifts: JSON.stringify(shifts) }, { signal: controller.signal, timeoutMs: 105000 })
      .then((payload) => {
        if (payload.date !== date || payload.data.length !== 9 || requests.some((request) => REQUIRED_THERMOFORMING_SHEETS.some((stockCode) =>
          payload.data.filter((row) => row.stockCode === stockCode && row.shift === request.shift && row.productionDate === date && row.warehouse === 'B-WIP01').length !== 1))
          || requests.some((request) => !payload.windows?.some((window) => window.shift === request.shift && window.productionDate === date && window.start === request.start && window.end === request.end))) throw new Error('Incomplete or mismatched selected-day movement response.');
        if (!controller.signal.aborted) setState({ key, status: 'connected', payload });
      }).catch((error) => { if (!controller.signal.aborted) setState({ key, status: 'unavailable', error: error.message }); });
    return () => controller.abort();
    // The key contains all configured request fields and refresh identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return { ...(requests && date ? state.key === key ? state : { status: 'loading' }
    : { status: 'unavailable_by_shift', error: 'Choose a valid date and three non-overlapping configured shift times.' }), requests,
    refresh: () => setRefresh((value) => value + 1) };
}
