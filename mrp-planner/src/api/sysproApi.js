async function readSyspro(path, { signal, timeoutMs = 125000 } = {}) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const failure = (message, code, retryable) => Object.assign(new Error(message), { code, retryable });
  try {
    const response = await fetch(`/api/syspro/${path}`, { method: 'GET', cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success || !Array.isArray(payload.data)) {
      if (payload?.code?.startsWith('SYSPRO_')) throw failure(payload.error, payload.code, payload.retryable === true);
      if (response.status >= 500) throw failure('Backend unavailable. Start both services with npm run dev and check the backend terminal.', 'BACKEND_UNAVAILABLE', true);
      throw failure('Unexpected API response. Check the API proxy or restart the local backend.', 'API_RESPONSE', false);
    }
    return payload;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timedOut) throw failure('SYSPRO request timed out. Check the backend and corporate network.', 'REQUEST_TIMEOUT', true);
    if (error.code) throw error;
    throw failure('Backend unreachable. Check the network and start both services with npm run dev.', 'BACKEND_UNAVAILABLE', true);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

export const fetchSysproInventory = (options) => readSyspro('inventory', options);
export const fetchSysproBom = (options) => readSyspro('bom', options);
export const fetchCycleCountMovements = (parameters, options) => readSyspro(`cycle-count/movements?${new URLSearchParams(parameters)}`, options);
export const fetchSheetAnalysisSystem = (parameters, options) => readSyspro(`sheet-analysis/system?${new URLSearchParams(parameters)}`, options);
export const fetchSheetClosingSoh = (parameters, options) => readSyspro(`sheet-analysis/closing-soh?${new URLSearchParams(parameters)}`, options);
export const fetchSheetTailgates = (parameters, options) => readSyspro(`sheet-analysis/tailgates?${new URLSearchParams(parameters)}`, options);
export const fetchSheetBedliners = (parameters, options) => readSyspro(`sheet-analysis/bedliners?${new URLSearchParams(parameters)}`, options);

export function mergeSysproInventory(items = [], inventoryRows = [], includeCodes = []) {
  const code = (value) => String(value ?? '').trim().toUpperCase();
  const quantity = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  const inventoryByCode = new Map(inventoryRows.map((row) => [code(row.StockCode ?? row.STOCKCODE), row]));
  const existing = new Set(items.map((item) => code(item.stockCode ?? item.code)));
  // This is an in-memory calculation overlay, never added to saved item master.
  const referencedItems = [...new Set(includeCodes.map(code))].filter((key) => key && !existing.has(key) && inventoryByCode.has(key))
    .map((key) => ({ id: `live:${key}`, code: key, liveOnly: true, type: null, onHand: null }));
  return [...items, ...referencedItems].map((item) => {
    const row = inventoryByCode.get(code(item.stockCode ?? item.code));
    if (!row) return { ...item, stockSource: 'saved planning item; no matching live inventory row', liveStockAvailable: false };
    return { ...item, savedPlanningUom: item.uom ?? null, description: row.Description || item.description || '', uom: row.StockUom || item.uom || '',
      bWip01Soh: quantity(row.B_WIP01_SOH ?? row.b_wip01_soh), bRaw01Soh: quantity(row.B_RAW01_SOH ?? row.b_raw01_soh),
      stockSource: 'SYSPRO current inventory', liveStockAvailable: true };
  });
}
