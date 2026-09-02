import { BLOW_MOULDING_PARENT_PAIRS } from "../planning/blowMouldingParentPairs.js";
import { normalizeSysproTransaction, TRANSACTION_CLASSES as TC } from "./transactionNormalization.js";
import { balanceForPeriod, isActualInPeriod, isInPeriod } from "./periodUtils.js";
import { DEFAULT_TOLERANCE, evaluateTolerance } from "./tolerances.js";
import { entryProductionLine, getThermoformingDisplayCode } from "../production/productionLines.js";

const number = (value) => Number(value) || 0;
const byStockCode = (rows = []) => new Map(rows.map((row) => [row.stockCode, row]));

export function deriveMaterialReconciliation({
  productionActuals = [], items = [], boms = [], parentPairs = BLOW_MOULDING_PARENT_PAIRS,
  sysproTransactions = [], openingWipBalances = [], closingWipBalances = [], tolerances = [], period,
}) {
  const empty = { summary: { materialsChecked: 0, tied: 0, consumptionVariances: 0, stockBalanceVariances: 0, pendingBkf: 0, dataIssues: 0 }, rows: [] };
  if (!period?.dateFrom || !period?.dateTo) return empty;
  const itemsByCode = new Map(items.map((item) => [String(item.code || "").trim().toUpperCase(), item]));
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const bomsByParent = new Map();
  boms.forEach((bom) => { const key = String(bom.parentStockCode || "").trim().toUpperCase(); if (key) bomsByParent.set(key, [...(bomsByParent.get(key) || []), bom]); });
  const pairsByCode = new Map(parentPairs.map((pair) => [pair.planningCode, pair]));
  const expectedByChild = new Map();
  let missingBom = false;

  productionActuals.filter((actual) => number(actual.actualMouldQty) > 0 && isActualInPeriod(actual, period)).forEach((actual) => {
    const pair = entryProductionLine(actual) === "thermoforming" ? null : pairsByCode.get(actual.partNumber);
    const parentCodes = pair ? pair.parents : [actual.partNumber];
    parentCodes.forEach((parentStockCode) => {
      const normalizedParent = String(parentStockCode || "").trim().toUpperCase();
      const parentBoms = bomsByParent.get(normalizedParent);
      if (!parentBoms?.length) { missingBom = true; return; }
      parentBoms.forEach((bom) => {
        const childCode = String(bom.componentStockCode || "").trim().toUpperCase();
        const child = itemsByCode.get(childCode) || { id: childCode, code: childCode, description: bom.componentDescription || "No description", uom: "" };
        const expectedQty = number(actual.actualMouldQty) * number(bom.qtyPer);
        const current = expectedByChild.get(childCode) || { child, expectedConsumptionQty: 0, contributions: [] };
        current.expectedConsumptionQty += expectedQty;
        current.contributions.push({ actualRecordId: actual.id, planningEntryId: actual.planningEntryId || null, machine: actual.machine, day: actual.day, shift: actual.shift, displayCode: pair?.displayCode || (entryProductionLine(actual) === "thermoforming" ? getThermoformingDisplayCode(parentStockCode) : actual.partNumber), parentStockCode, actualMouldQty: number(actual.actualMouldQty), bomQtyPer: number(bom.qtyPer), expectedQty });
        expectedByChild.set(childCode, current);
      });
    });
  });

  const transactions = sysproTransactions.map((transaction) => normalizeSysproTransaction(transaction)).filter((transaction) => isInPeriod(transaction, period));
  const transactionsByCode = new Map();
  transactions.forEach((transaction) => transactionsByCode.set(transaction.stockCode, [...(transactionsByCode.get(transaction.stockCode) || []), transaction]));
  const toleranceByCode = byStockCode(tolerances);
  const allCodes = new Set([...expectedByChild.values()].map(({ child }) => child.code));
  transactions.forEach((transaction) => allCodes.add(transaction.stockCode));
  openingWipBalances.forEach((balance) => allCodes.add(balance.stockCode));
  closingWipBalances.forEach((balance) => allCodes.add(balance.stockCode));

  const rows = [...allCodes].filter(Boolean).map((stockCode) => {
    const item = itemsByCode.get(stockCode);
    const expected = expectedByChild.get(String(stockCode || "").trim().toUpperCase()) || null;
    const matched = transactionsByCode.get(stockCode) || [];
    const ofClass = (transactionClass) => matched.filter((transaction) => transaction.transactionClass === transactionClass);
    const consumption = ofClass(TC.PRODUCTION_CONSUMPTION);
    const reversals = ofClass(TC.REVERSAL);
    const consumptionReversals = reversals.filter((transaction) => transaction.reversesTransactionClass === TC.PRODUCTION_CONSUMPTION);
    const transfers = ofClass(TC.RAW_TO_WIP);
    const scrap = ofClass(TC.SCRAP);
    const reg = ofClass(TC.REG_TRANSFER);
    const adjustments = ofClass(TC.ADJUSTMENT);
    const grossConsumption = consumption.reduce((sum, transaction) => sum + transaction.quantity, 0);
    const reversedConsumption = consumptionReversals.reduce((sum, transaction) => sum + transaction.quantity, 0);
    const systemConsumptionQty = grossConsumption - reversedConsumption;
    const expectedConsumptionQty = number(expected?.expectedConsumptionQty);
    const consumptionVarianceQty = systemConsumptionQty - expectedConsumptionQty;
    const consumptionVariancePct = expectedConsumptionQty > 0 ? consumptionVarianceQty / expectedConsumptionQty * 100 : null;
    const openingWipQty = balanceForPeriod(openingWipBalances, stockCode, period.dateFrom, "opening");
    const actualClosingWipQty = balanceForPeriod(closingWipBalances, stockCode, period.dateTo, "closing");
    const incomingWipQty = transfers.filter((t) => t.direction === "IN" || t.destinationWarehouse === "B-WIP01").reduce((sum, t) => sum + t.quantity, 0);
    const scrapOutQty = scrap.filter((t) => t.direction !== "IN").reduce((sum, t) => sum + t.quantity, 0);
    const regOutQty = reg.filter((t) => t.direction !== "IN").reduce((sum, t) => sum + t.quantity, 0);
    const reversalInQty = reversals.filter((t) => t.direction === "IN").reduce((sum, t) => sum + t.quantity, 0);
    const adjustmentQty = adjustments.reduce((sum, t) => sum + (t.direction === "OUT" ? -t.quantity : t.quantity), 0);
    const outgoingWipQty = grossConsumption + scrapOutQty + regOutQty;
    const expectedClosingWipQty = openingWipQty === null ? null : openingWipQty + incomingWipQty - outgoingWipQty + reversalInQty + adjustmentQty;
    const stockBalanceVarianceQty = actualClosingWipQty === null || expectedClosingWipQty === null ? null : actualClosingWipQty - expectedClosingWipQty;
    const configured = toleranceByCode.get(stockCode) || {};
    const consumptionTolerance = configured.consumptionTolerance || DEFAULT_TOLERANCE;
    const stockBalanceTolerance = configured.stockBalanceTolerance || DEFAULT_TOLERANCE;
    const consumptionEvaluation = evaluateTolerance({ varianceQty: consumptionVarianceQty, expectedQty: expectedConsumptionQty, tolerance: consumptionTolerance });
    const stockEvaluation = evaluateTolerance({ varianceQty: stockBalanceVarianceQty, expectedQty: expectedClosingWipQty, tolerance: stockBalanceTolerance });
    const missingRequiredSysproData = openingWipQty === null || actualClosingWipQty === null;
    const dataIncomplete = !expected || missingBom || missingRequiredSysproData;
    const pending = matched.some((transaction) => transaction.knownPendingBackflush);
    let status = "Tied";
    if (dataIncomplete) status = "Data incomplete";
    else if (pending) status = "Pending BKF";
    else if (!consumptionEvaluation.withinTolerance) status = "Consumption variance";
    else if (!stockEvaluation.withinTolerance) status = "Stock balance variance";

    return { childItemId: item?.id || null, stockCode, description: item?.description || "Item not found", uom: item?.uom || "", expectedConsumptionQty, systemConsumptionQty, consumptionVarianceQty, consumptionVariancePct, openingWipQty, incomingWipQty, outgoingWipQty, expectedClosingWipQty, actualClosingWipQty, stockBalanceVarianceQty, consumptionTolerance, stockBalanceTolerance, consumptionWithinTolerance: consumptionEvaluation.withinTolerance, stockBalanceWithinTolerance: stockEvaluation.withinTolerance, status, stockBalance: { openingWipQty, rawToWipQty: incomingWipQty, productionConsumptionQty: grossConsumption, scrapOutQty, regOutQty, reversalInQty, adjustmentQty, expectedClosingWipQty, actualClosingWipQty, stockBalanceVarianceQty }, drillDown: { actualContributions: expected?.contributions || [], parentBomContributions: expected?.contributions || [], sysproConsumptionTransactions: [...consumption, ...consumptionReversals], transferTransactions: transfers, scrapTransactions: scrap, regTransactions: reg, reversalTransactions: reversals, adjustmentTransactions: adjustments } };
  }).sort((a, b) => a.stockCode.localeCompare(b.stockCode));

  const count = (status) => rows.filter((row) => row.status === status).length;
  return { summary: { materialsChecked: rows.length, tied: count("Tied"), consumptionVariances: count("Consumption variance"), stockBalanceVariances: count("Stock balance variance"), pendingBkf: count("Pending BKF"), dataIssues: count("Data incomplete") }, rows };
}

export default deriveMaterialReconciliation;
