export const TRANSACTION_CLASSES = Object.freeze({
  PRODUCTION_CONSUMPTION: "PRODUCTION_CONSUMPTION", RAW_TO_WIP: "RAW_TO_WIP", SCRAP: "SCRAP",
  REG_TRANSFER: "REG_TRANSFER", REVERSAL: "REVERSAL", ADJUSTMENT: "ADJUSTMENT", OTHER: "OTHER",
});

// Raw Syspro adapters should supply a classifier; this core never guesses transaction codes.
export function normalizeSysproTransaction(raw, classify = () => TRANSACTION_CLASSES.OTHER) {
  const transactionClass = raw.transactionClass || classify(raw);
  return {
    transactionId: raw.transactionId || raw.id,
    stockCode: raw.stockCode,
    transactionDate: raw.transactionDate,
    transactionTime: raw.transactionTime || "00:00:00",
    transactionType: raw.transactionType || "",
    sourceWarehouse: raw.sourceWarehouse || "",
    destinationWarehouse: raw.destinationWarehouse || "",
    quantity: Math.abs(Number(raw.quantity) || 0),
    direction: raw.direction || "OUT",
    reference: raw.reference || "",
    job: raw.job || "",
    transactionClass,
    reversesTransactionClass: raw.reversesTransactionClass || null,
    knownPendingBackflush: raw.knownPendingBackflush === true,
    rawTransaction: raw.rawTransaction || raw,
  };
}
