export const initialSourceState = (source) => ({ phase: 'checking', data: [], lastUpdated: null, source, error: null });
export const connectionLabel = (phase) => ({ checking: 'Checking…', connected: 'Connected', reconnecting: 'Reconnecting…', offline: 'Offline' }[phase] || 'Checking…');

// One request and one retry timer per source. No business writes or persistence.
export function createSourceConnection({ read, source, onChange, now = Date.now, schedule = setTimeout, unschedule = clearTimeout }) {
  let state = initialSourceState(source), request, timer, generation = 0, failures = 0, stopped = false, lastStart = -Infinity;
  const publish = (changes) => { state = { ...state, ...changes }; onChange(state); };
  const clearRetry = () => { if (timer !== undefined) unschedule(timer); timer = undefined; };
  async function refresh({ trigger = false } = {}) {
    if (stopped || (trigger && (request || now() - lastStart < 10000))) return;
    clearRetry();
    request?.abort();
    const controller = new AbortController(), version = ++generation;
    request = controller; lastStart = now();
    publish({ phase: state.lastUpdated || failures ? 'reconnecting' : 'checking', error: null });
    try {
      const result = await read({ signal: controller.signal });
      if (stopped || controller.signal.aborted || version !== generation) return;
      failures = 0;
      publish({ phase: 'connected', data: result.data, lastUpdated: new Date(result.fetchedAt || now()), source: result.source || source, error: null });
    } catch (error) {
      if (stopped || controller.signal.aborted || version !== generation) return;
      const delay = Math.min(30000, 1000 * 2 ** Math.min(failures++, 5));
      publish({ phase: 'offline', error: error.message });
      if (error.retryable === true) timer = schedule(() => { timer = undefined; void refresh(); }, delay);
    } finally {
      if (version === generation) request = undefined;
    }
  }
  return { refresh, stop() { stopped = true; generation++; clearRetry(); request?.abort(); request = undefined; }, getState: () => state };
}
