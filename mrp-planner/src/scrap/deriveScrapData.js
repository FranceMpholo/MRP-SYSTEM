export const WAREHOUSES = ['B-SCR01', 'B-REG01'];
export const MONTHLY_TARGET = 400000;
export const REG_DIRECTIONS = ['WIP → REG', 'REG → WIP', 'Other REG Activity'];
export function regDirection(row) {
  if (row.sourceWarehouse === 'B-WIP01' && row.destinationWarehouse === 'B-REG01') return REG_DIRECTIONS[0];
  if (row.sourceWarehouse === 'B-REG01' && row.destinationWarehouse === 'B-WIP01') return REG_DIRECTIONS[1];
  return REG_DIRECTIONS[2];
}
function aggregate(rows, filters, reg = false) {
  const daily = new Map(), monthly = new Map(), commodities = new Map(), stocks = new Map();
  const directions = Object.fromEntries(REG_DIRECTIONS.map(key => [key, { value: 0, quantity: 0, count: 0 }]));
  for (let date = new Date(filters.startDate + 'T00:00:00Z'); date <= new Date(filters.endDate + 'T00:00:00Z'); date.setUTCDate(date.getUTCDate() + 1)) {
    const day = date.toISOString().slice(0, 10), month = day.slice(0, 7);
    daily.set(day, { label: day, cost: 0 });
    if (!monthly.has(month)) monthly.set(month, { label: month, cost: 0, ...Object.fromEntries(REG_DIRECTIONS.map(key => [key, 0])) });
  }
  let totalValue = 0, totalQty = 0, missingCostCount = 0;
  const detail = rows.map(row => {
    const quantity = reg ? Math.abs(row.scrapQty) : row.scrapQty;
    const value = row.totalCost == null ? null : reg ? Math.abs(row.totalCost) : row.totalCost;
    const direction = reg ? regDirection(row) : null;
    totalValue += value ?? 0; totalQty += quantity;
    if (value == null) missingCostCount++;
    daily.get(row.date).cost += value ?? 0;
    const month = monthly.get(row.date.slice(0, 7));
    month.cost += value ?? 0;
    if (reg) { month[direction] += value ?? 0; directions[direction].value += value ?? 0; directions[direction].quantity += quantity; directions[direction].count++; }
    const label = row.mappingStatus === 'Incomplete Coverage' ? row.commodity + ' (Incomplete Coverage)' : row.commodity;
    commodities.set(label, (commodities.get(label) || 0) + (value ?? 0));
    stocks.set(row.stockCode, (stocks.get(row.stockCode) || 0) + (value ?? 0));
    return { ...row, quantity, value, direction };
  });
  const rank = map => [...map].map(([label, cost]) => ({ label, cost })).sort((a, b) => b.cost - a.cost || a.label.localeCompare(b.label));
  return { rows: detail, totalValue, totalQty, missingCostCount, daily: [...daily.values()], monthly: [...monthly.values()], commodities: rank(commodities), stocks: rank(stocks), directions,
    uoms: [...new Set(rows.map(row => row.uom?.toUpperCase() || 'Unknown'))],
    statuses: Object.fromEntries(['Mapped', 'Incomplete Coverage', 'Unmapped', 'Ambiguous'].map(status => [status, rows.filter(row => row.mappingStatus === status).length])) };
}
export function deriveScrapData(transactions, filters) {
  const rows = transactions.filter(row => row.date >= filters.startDate && row.date <= filters.endDate
    && (!filters.commodity || row.commodity === filters.commodity)
    && (!filters.warehouse || row.warehouse === filters.warehouse)
    && row.stockCode.toLowerCase().includes((filters.stockCode || '').trim().toLowerCase()));
  const confirmed = aggregate(rows.filter(row => row.warehouse === 'B-SCR01'), filters);
  const reg = aggregate(rows.filter(row => row.warehouse === 'B-REG01'), filters, true);
  const months = confirmed.monthly.length;
  const comparable = filters.warehouse !== 'B-REG01' && !filters.commodity && !(filters.stockCode || '').trim() && !confirmed.missingCostCount;
  return { confirmed, reg, target: { monthly: MONTHLY_TARGET, months, periodReference: MONTHLY_TARGET * months,
    variance: comparable ? confirmed.totalValue - MONTHLY_TARGET * months : null } };
}

