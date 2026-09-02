export const transactionTimestamp = (transaction) => new Date(`${transaction.transactionDate}T${transaction.transactionTime || "00:00:00"}`).getTime();
export const isInPeriod = (transaction, period) => {
  const timestamp = transactionTimestamp(transaction);
  return Number.isFinite(timestamp) && timestamp >= new Date(period.dateFrom).getTime() && timestamp < new Date(period.dateTo).getTime();
};
export const isActualInPeriod = (actual, period) => {
  const timestamp = new Date(actual.actualDateTime || `${actual.day}T${actual.time || "00:00:00"}`).getTime();
  return Number.isFinite(timestamp) && timestamp >= new Date(period.dateFrom).getTime() && timestamp < new Date(period.dateTo).getTime();
};

export function balanceForPeriod(balances = [], stockCode, boundary, mode) {
  const boundaryTime = new Date(boundary).getTime();
  const candidates = balances.filter((balance) => balance.stockCode === stockCode && Number.isFinite(new Date(balance.asOf).getTime()));
  const eligible = candidates.filter((balance) => mode === "opening" ? new Date(balance.asOf).getTime() <= boundaryTime : new Date(balance.asOf).getTime() >= boundaryTime);
  eligible.sort((a, b) => mode === "opening" ? new Date(b.asOf) - new Date(a.asOf) : new Date(a.asOf) - new Date(b.asOf));
  return eligible.length ? Number(eligible[0].quantity) || 0 : null;
}
