import { classifyFcsdFinishedPartCode } from "./fcsdClassification.js";
import { inspectBom, bomFactor } from '../bom/bomValidation.js';

const normalizeCode = (value) => String(value ?? "").trim().toUpperCase();

function positiveQuantity(value) {
  if (value === "" || value === null || value === undefined) return null;
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}

/**
 * Builds a direct-level gross requirements preview. Nested BOMs are deliberately
 * not exploded until SYSPRO make/buy and stocked/phantom policies are known.
 */
export function calculateFcsdRequirements({ finishedParts = [], candidates = [], bomRows = [] }) {
  const candidateByCode = new Map(candidates.map((item) => [normalizeCode(item.stockCode), item]));
  const context = inspectBom(bomRows, candidates);
  const bomsByParent = new Map();
  for (const row of bomRows) {
    const parent = normalizeCode(row.parentStockCode);
    if (parent) bomsByParent.set(parent, [...(bomsByParent.get(parent) || []), row]);
  }

  const issues = [];
  const requirements = new Map();
  const negativeQuantities = [];
  let validFinishedParts = 0;

  const addIssue = (code, message, stockCode = "") => issues.push({ code, message, stockCode });

  for (const part of finishedParts) {
    const stockCode = normalizeCode(part.stockCode);
    const classification = classifyFcsdFinishedPartCode(stockCode);
    const quantity = positiveQuantity(part.quantity);
    if (!classification.isFcsd) {
      addIssue("INVALID_FINISHED_PART", "Finished-part code is invalid or is not classified as FCSD.", stockCode);
      continue;
    }
    if (quantity === null) {
      addIssue("INVALID_QUANTITY", "Enter a finite finished-part quantity greater than zero.", stockCode);
      continue;
    }
    const parent = candidateByCode.get(stockCode);
    if (!parent) {
      addIssue("MISSING_FINISHED_PART", "Finished part is missing from the current SYSPRO BOM-parent candidate snapshot.", stockCode);
      continue;
    }
    validFinishedParts += 1;
    const parentUom = String(parent.uom || "").trim();
    if (!parentUom) addIssue("MISSING_FINISHED_UOM", "Finished-part stock UOM is unavailable.", stockCode);

    const rootRows = bomsByParent.get(stockCode) || [];
    if (!rootRows.length) {
      addIssue("MISSING_BOM", "No BOM lines were returned for this finished part.", stockCode);
      continue;
    }

    // Validate the reachable graph for cycles and broken references, but do not
    // explode nested rows because stocked-subassembly/phantom behavior is unknown.
    const visit = (code, path) => {
      if (path.includes(code)) {
        addIssue("BOM_CYCLE", `BOM cycle detected: ${[...path, code].join(" → ")}.`, code);
        return;
      }
      const rows = bomsByParent.get(code) || [];
      for (const row of rows) {
        const child = normalizeCode(row.componentStockCode);
        if (!child) {
          addIssue("MISSING_COMPONENT_CODE", "A BOM line has a blank component reference.", code);
          continue;
        }
        const item = candidateByCode.get(child);
        if (!item) addIssue("MISSING_COMPONENT_REFERENCE", "Component is not present in the SYSPRO item snapshot.", child);
        const qtyPer = Number(row.qtyPer);
        if (row.qtyPer === null || row.qtyPer === undefined || row.qtyPer === "" || !Number.isFinite(qtyPer)) {
          addIssue("INVALID_BOM_QUANTITY", "BOM quantity per is missing or invalid.", child);
        }
        if (bomsByParent.has(child)) visit(child, [...path, code]);
      }
    };
    visit(stockCode, []);
    context.issuesForParent(stockCode).forEach((message) => addIssue(/differs.*conversion/i.test(message) ? 'MISSING_UOM_CONVERSION' : 'BOM_UNRESOLVED', message, stockCode));

    for (const row of rootRows) {
      const childCode = normalizeCode(row.componentStockCode);
      const factor = bomFactor(row);
      const qtyPer = factor.value;
      if (!childCode) continue;
      const unresolved = context.globalIssues.length > 0 || (context.lineIssues.get(row) || []).length > 0 || (context.parentIssues.get(stockCode) || []).length > 0;
      const reviewChild = candidateByCode.get(childCode);
      if (bomsByParent.has(childCode)) addIssue('NESTED_BOM_POLICY', 'Nested BOM is not exploded: make/buy and stocked-subassembly/phantom handling are not established.', childCode);
      if (unresolved) {
        const key = `${childCode}\u0000${String(reviewChild?.uom || row.componentUom || '').toUpperCase()}`;
        const existing = requirements.get(key);
        requirements.set(key, existing ? { ...existing, grossRequirement: null } : { stockCode: childCode,
          description: reviewChild?.description || row.componentDescription || 'Unresolved component', uom: reviewChild?.uom || row.componentUom || '',
          grossRequirement: null, contributions: [], nestedBom: bomsByParent.has(childCode) });
        if (factor.state === 'negative') {
          negativeQuantities.push({ stockCode: childCode, description: reviewChild?.description || '', uom: row.componentUom || '', quantity: quantity * qtyPer,
            contribution: { finishedPartCode: stockCode, quantity: quantity * qtyPer } });
          addIssue('NEGATIVE_BOM_QUANTITY', 'Negative BOM quantity is retained for review; its meaning is unresolved and it is not a stock credit.', childCode);
        }
        continue;
      }
      const lineParentUom = String(row.parentUom || "").trim();
      if (!lineParentUom || !parentUom) {
        addIssue("MISSING_PARENT_UOM", "Finished-part or BOM-line parent UOM is missing; build quantity conversion cannot be verified.", stockCode);
        continue;
      }
      if (lineParentUom.toUpperCase() !== parentUom.toUpperCase()) {
        addIssue("MISSING_UOM_CONVERSION", `BOM parent UOM ${lineParentUom} differs from finished-part stock UOM ${parentUom}; no conversion is available.`, stockCode);
        continue;
      }
      const child = candidateByCode.get(childCode);
      if (!child) continue;

      const lineUom = String(row.componentUom || "").trim();
      const stockUom = String(child.uom || "").trim();
      if (!lineUom || !stockUom) {
        addIssue("MISSING_UOM", "Component or BOM-line UOM is missing; conversion cannot be verified.", childCode);
        continue;
      }
      if (lineUom.toUpperCase() !== stockUom.toUpperCase()) {
        addIssue("MISSING_UOM_CONVERSION", `BOM-line UOM ${lineUom} differs from stock UOM ${stockUom}; no conversion is available.`, childCode);
        continue;
      }

      const requiredQty = quantity * qtyPer;
      const contribution = { finishedPartCode: stockCode, quantity: requiredQty };
      if (requiredQty < 0) {
        negativeQuantities.push({ stockCode: childCode, description: child.description || "", uom: stockUom, quantity: requiredQty, contribution });
        addIssue("NEGATIVE_BOM_QUANTITY", "Negative BOM quantity is shown separately for business review and is not credited against gross requirements.", childCode);
        continue;
      }

      if (bomsByParent.has(childCode)) {
        addIssue("NESTED_BOM_POLICY", "Nested BOM is not exploded: make/buy and stocked-subassembly/phantom handling are not established.", childCode);
      }
      const key = `${childCode}\u0000${stockUom.toUpperCase()}`;
      const current = requirements.get(key);
      if (current) {
        if (current.grossRequirement !== null) current.grossRequirement += requiredQty;
        current.contributions.push(contribution);
      } else {
        requirements.set(key, {
          stockCode: childCode,
          description: child.description || row.componentDescription || "Description unavailable",
          uom: stockUom,
          grossRequirement: requiredQty,
          contributions: [contribution],
          nestedBom: bomsByParent.has(childCode),
        });
      }
    }
  }

  const rows = [...requirements.values()].sort((a, b) => a.stockCode.localeCompare(b.stockCode) || a.uom.localeCompare(b.uom));
  const invalidQuantity = issues.some((issue) => issue.code === "INVALID_QUANTITY");
  return {
    requirements: rows,
    negativeQuantities,
    issues,
    complete: validFinishedParts > 0 && issues.length === 0 && !invalidQuantity,
    status: issues.length ? "UNRESOLVED" : validFinishedParts ? "PREVIEW" : "UNRESOLVED",
  };
}
