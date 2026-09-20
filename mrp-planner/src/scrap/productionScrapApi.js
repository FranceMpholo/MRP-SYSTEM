export const API_UNAVAILABLE = 'Production Scrap API is unavailable. Restart the backend or check the API route.';

export async function readProductionScrap(response) {
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    const body = await response.text();
    throw new Error(`Production Scrap API: HTTP ${response.status}, ${response.headers.get('content-type')}: ${body.slice(0, 200)}`);
  }
  const result = await response.json();
  if (!response.ok || !result.success || !Array.isArray(result.data)) {
    throw new Error(`Production Scrap API: HTTP ${response.status}: ${result.error || 'Invalid response shape'}`);
  }
  return result;
}

// Use the full mapped response, before commodity, stock or warehouse filters.
// Mapping confidence (e.g. Incomplete Coverage) is not a commodity.
export function commodityOptions(rows = []) {
  return [...new Set([...rows.map(row => row.commodity).filter(Boolean), 'Unmapped', 'Ambiguous'])].sort();
}
