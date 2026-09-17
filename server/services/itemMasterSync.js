"use strict";

const ITEM_SOURCE = "SYSPRO";
const ADVISORY_LOCK_KEY = 2147483202;

class ItemMasterSyncError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "ItemMasterSyncError";
    this.code = code;
    this.details = details;
  }
}

function field(row, name) {
  const key = Object.keys(row || {}).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? null : row[key];
}

function trimNullable(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function normalizedKey(value) {
  return String(value ?? "").trim().toUpperCase();
}

function flag(value) {
  return value === true || value === 1 || value === "1";
}

function classifyItem(isBomParent, isBomComponent) {
  if (isBomParent && isBomComponent) return "BOM_PARENT_COMPONENT";
  if (isBomParent) return "BOM_PARENT";
  if (isBomComponent) return "BOM_COMPONENT";
  throw new ItemMasterSyncError("A BOM-scoped item has no BOM role.", "INVALID_BOM_ROLE");
}

function increment(distribution, value) {
  const key = value ?? "(missing)";
  distribution[key] = (distribution[key] || 0) + 1;
}

function normalizeSourceRows(rows) {
  if (!Array.isArray(rows)) {
    throw new ItemMasterSyncError("The SYSPRO snapshot is not an array.", "INVALID_SNAPSHOT");
  }

  const report = {
    totalBomScopedCodes: rows.length,
    invMasterMatches: 0,
    missingInvMasterRows: 0,
    parentCount: 0,
    componentCount: 0,
    parentAndComponentCount: 0,
    blankCodes: 0,
    duplicateNormalizedCodes: 0,
    missingDescriptions: 0,
    missingUom: 0,
    partCategoryDistribution: {},
    stockOnHoldDistribution: {},
    supercessionDateCount: 0,
  };
  const items = [];
  const seen = new Map();
  const errors = [];

  for (const row of rows) {
    const stockCode = trimNullable(field(row, "StockCode"));
    const key = normalizedKey(stockCode);
    const masterStockCode = trimNullable(field(row, "MasterStockCode"));
    const isBomParent = flag(field(row, "IsBomParent"));
    const isBomComponent = flag(field(row, "IsBomComponent"));

    if (!stockCode) {
      report.blankCodes += 1;
      errors.push("The snapshot contains a blank BOM stock code.");
      continue;
    }
    if (/_PAIR$/i.test(stockCode)) {
      errors.push(`Synthetic planning code is not an inventory item: ${stockCode}`);
    }
    if (seen.has(key)) {
      report.duplicateNormalizedCodes += 1;
      errors.push(`Duplicate normalized stock code: ${stockCode}`);
    } else {
      seen.set(key, stockCode);
    }
    if (!masterStockCode || normalizedKey(masterStockCode) !== key) {
      report.missingInvMasterRows += 1;
      errors.push(`BOM stock code has no matching InvMaster row: ${stockCode}`);
    } else {
      report.invMasterMatches += 1;
    }

    let itemType = null;
    try {
      itemType = classifyItem(isBomParent, isBomComponent);
    } catch (error) {
      errors.push(`${error.message} Stock code: ${stockCode}`);
    }

    if (isBomParent) report.parentCount += 1;
    if (isBomComponent) report.componentCount += 1;
    if (isBomParent && isBomComponent) report.parentAndComponentCount += 1;

    const description = trimNullable(field(row, "Description"));
    const uom = trimNullable(field(row, "StockUom"));
    const partCategory = trimNullable(field(row, "PartCategory"));
    const stockOnHold = trimNullable(field(row, "StockOnHold"));
    const supercessionDate = field(row, "SupercessionDate");
    if (!description) report.missingDescriptions += 1;
    if (!uom) report.missingUom += 1;
    increment(report.partCategoryDistribution, partCategory);
    increment(report.stockOnHoldDistribution, stockOnHold);
    if (supercessionDate !== null && supercessionDate !== undefined && supercessionDate !== "") {
      report.supercessionDateCount += 1;
    }

    items.push({
      stockCode,
      normalizedStockCode: key,
      description,
      uom,
      itemType,
      sourceSystem: ITEM_SOURCE,
      sourceStatus: {
        partCategory,
        productClass: trimNullable(field(row, "ProductClass")),
        stockOnHold,
        stockOnHoldReason: trimNullable(field(row, "StockOnHoldReason")),
        supercessionDate: supercessionDate ?? null,
        dateStkAdded: field(row, "DateStkAdded") ?? null,
      },
    });
  }

  if (errors.length) {
    throw new ItemMasterSyncError("SYSPRO item snapshot validation failed.", "SOURCE_VALIDATION_FAILED", {
      errors,
      report,
    });
  }
  return { items, report };
}

function planItemChanges(items, existingRows, { activityResolver } = {}) {
  if (!Array.isArray(existingRows)) {
    throw new ItemMasterSyncError("Existing PostgreSQL items are not an array.", "INVALID_EXISTING_ITEMS");
  }
  const existingByKey = new Map();
  const sourceSystemDistribution = {};

  for (const row of existingRows) {
    const key = normalizedKey(field(row, "stock_code"));
    if (!key) continue;
    if (existingByKey.has(key)) {
      throw new ItemMasterSyncError("PostgreSQL contains normalized stock-code collisions.", "POSTGRES_COLLISION", { key });
    }
    existingByKey.set(key, row);
    increment(sourceSystemDistribution, trimNullable(field(row, "source_system")));
  }

  const inserts = [];
  const updates = [];
  const unchanged = [];
  const unresolved = [];
  const localCollisions = [];

  for (const item of items) {
    const existing = existingByKey.get(item.normalizedStockCode);
    if (existing && String(field(existing, "source_system") || "").toUpperCase() !== ITEM_SOURCE) {
      localCollisions.push(item.stockCode);
      continue;
    }

    const active = activityResolver ? activityResolver(item, existing || null) : undefined;
    if (typeof active !== "boolean") unresolved.push(item.stockCode);
    const proposed = { ...item, isActive: active, existingId: existing ? field(existing, "id") : null };

    if (!existing) {
      inserts.push(proposed);
      continue;
    }

    const changed = trimNullable(field(existing, "description")) !== item.description
      || trimNullable(field(existing, "uom")) !== item.uom
      || trimNullable(field(existing, "item_type")) !== item.itemType
      || (typeof active === "boolean" && field(existing, "is_active") !== active);
    (changed ? updates : unchanged).push(proposed);
  }

  if (localCollisions.length) {
    throw new ItemMasterSyncError(
      "SYSPRO stock codes collide with local or TEST PostgreSQL items.",
      "LOCAL_ITEM_COLLISION",
      { stockCodes: localCollisions }
    );
  }

  return {
    inserts,
    updates,
    unchanged,
    unresolved,
    sourceSystemDistribution,
    proposedInserts: inserts.length,
    proposedUpdates: updates.length,
    unchangedRows: unchanged.length,
    unresolvedRows: unresolved.length,
  };
}

async function readExistingItems(postgres) {
  const result = await postgres.query(
    `SELECT id, stock_code, description, uom, item_type, source_system, is_active, syspro_last_synced_at
     FROM items
     ORDER BY stock_code`
  );
  return result.rows || result;
}

async function applyPlan(postgres, plan, syncedAt) {
  if (plan.unresolved.length) {
    throw new ItemMasterSyncError(
      "Apply refused: the item is_active policy is unresolved.",
      "ACTIVITY_POLICY_UNRESOLVED",
      { unresolvedRows: plan.unresolved.length }
    );
  }

  const client = await postgres.pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT pg_advisory_xact_lock($1)", [ADVISORY_LOCK_KEY]);

    const currentRows = await readExistingItems(client);
    const rechecked = planItemChanges(
      [...plan.inserts, ...plan.updates, ...plan.unchanged].map(({ existingId, isActive, ...item }) => item),
      currentRows,
      { activityResolver: (item) => {
        const proposed = [...plan.inserts, ...plan.updates, ...plan.unchanged]
          .find((entry) => entry.normalizedStockCode === item.normalizedStockCode);
        return proposed?.isActive;
      } }
    );

    for (const item of rechecked.inserts) {
      await client.query(
        `INSERT INTO items
           (stock_code, description, uom, item_type, source_system, is_active, syspro_last_synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [item.stockCode, item.description, item.uom, item.itemType, ITEM_SOURCE, item.isActive, syncedAt]
      );
    }
    for (const item of rechecked.updates) {
      await client.query(
        `UPDATE items
         SET description = $2, uom = $3, item_type = $4, is_active = $5,
             syspro_last_synced_at = $6, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND source_system = $7`,
        [item.existingId, item.description, item.uom, item.itemType, item.isActive, syncedAt, ITEM_SOURCE]
      );
    }

    const expected = rechecked.inserts.length + rechecked.updates.length + rechecked.unchanged.length;
    const validation = await client.query(
      `SELECT COUNT(*)::integer AS matched_count
       FROM items
       WHERE source_system = $1 AND UPPER(BTRIM(stock_code)) = ANY($2::text[])`,
      [ITEM_SOURCE, [...rechecked.inserts, ...rechecked.updates, ...rechecked.unchanged].map((item) => item.normalizedStockCode)]
    );
    if (Number(validation.rows[0]?.matched_count) !== expected) {
      throw new ItemMasterSyncError("Post-write item validation failed.", "POST_WRITE_VALIDATION_FAILED");
    }
    await client.query("COMMIT");
    return rechecked;
  } catch (error) {
    if (transactionStarted) {
      try { await client.query("ROLLBACK"); } catch { /* preserve the original error */ }
    }
    throw error;
  } finally {
    client.release();
  }
}

async function synchronizeItemMaster({ sourceQuery, postgres, apply = false, activityResolver, now = () => new Date() }) {
  let sourceRows;
  try {
    sourceRows = await sourceQuery();
  } catch (error) {
    throw new ItemMasterSyncError("No SYSPRO item snapshot was obtained.", "SOURCE_UNAVAILABLE", { cause: error.message });
  }

  const normalized = normalizeSourceRows(sourceRows);
  if (apply && typeof activityResolver !== "function") {
    throw new ItemMasterSyncError(
      "Apply refused: the item is_active business rule is unresolved.",
      "ACTIVITY_POLICY_UNRESOLVED"
    );
  }

  const existingRows = await readExistingItems(postgres);
  const plan = planItemChanges(normalized.items, existingRows, { activityResolver });
  const report = {
    ...normalized.report,
    postgresSourceSystemDistribution: plan.sourceSystemDistribution,
    localTestCollisions: 0,
    proposedInserts: plan.proposedInserts,
    proposedUpdates: plan.proposedUpdates,
    unchangedRows: plan.unchangedRows,
    unresolvedRows: plan.unresolvedRows,
  };

  if (!apply) return { applied: false, report, plan };
  const syncedAt = now();
  const appliedPlan = await applyPlan(postgres, plan, syncedAt);
  return { applied: true, syncedAt, report, plan: appliedPlan };
}

module.exports = {
  ITEM_SOURCE,
  ItemMasterSyncError,
  classifyItem,
  normalizedKey,
  normalizeSourceRows,
  planItemChanges,
  readExistingItems,
  applyPlan,
  synchronizeItemMaster,
};
