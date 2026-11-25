export function canExportStoreRequest({ complete, dataIssues = [], storeRequests = [] }) {
  return complete === true && dataIssues.length === 0 && storeRequests.every((row) =>
    ['productionShortfall', 'packsRequired', 'storeRequestQty', 'bRaw01Soh', 'projectedRawBalance'].every((key) =>
      row[key] !== null && row[key] !== undefined && Number.isFinite(Number(row[key]))));
}
