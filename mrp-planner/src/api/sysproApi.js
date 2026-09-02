export async function fetchSysproInventory({ signal } = {}) {
  const response = await fetch("/api/syspro/inventory", { method: "GET", headers: { Accept: "application/json" }, signal });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success || !Array.isArray(payload.data)) throw new Error(payload?.error || `Syspro request failed (${response.status})`);
  return payload;
}

export async function fetchSysproBom({ signal } = {}) {
  const response = await fetch("/api/syspro/bom", { method: "GET", headers: { Accept: "application/json" }, signal });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success || !Array.isArray(payload.data)) throw new Error(payload?.error || `Syspro BOM request failed (${response.status})`);
  return payload;
}

export function mergeSysproInventory(items = [], inventoryRows = []) {
  const inventoryByCode = new Map(inventoryRows.map((row) => [String(row.StockCode ?? row.STOCKCODE ?? "").trim(), row]));
  return items.map((item) => {
    const row = inventoryByCode.get(String(item.stockCode ?? item.code ?? "").trim());
    if (!row) return item;
    return { ...item, bWip01Soh: Number(row.B_WIP01_SOH ?? row.b_wip01_soh) || 0, bRaw01Soh: Number(row.B_RAW01_SOH ?? row.b_raw01_soh) || 0 };
  });
}
