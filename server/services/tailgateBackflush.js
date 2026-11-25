const fs = require('node:fs');
const path = require('node:path');
const { movementLocal } = require('./cycleCountMovements');
const clean = (value) => String(value ?? '').trim().toUpperCase();
const numeric = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const dateText = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
const round = (value) => Math.round((value + Number.EPSILON) * 1e8) / 1e8;
const sheets = ['120002', '120003'];
const sql = fs.readFileSync(path.join(__dirname, '../queries/tailgateBackflush.sql'), 'utf8');
const catalogSql = `SELECT i.StockCode AS stockCode,i.Description AS description,i.StockUom AS stockUom,
    CASE WHEN w.StockCode IS NULL THEN 0 ELSE 1 END AS finishedWarehouseExists
    FROM dbo.InvMaster i LEFT JOIN dbo.InvWarehouse w ON w.StockCode=i.StockCode AND w.Warehouse='B-FIN01'
    WHERE i.Description LIKE '%Tailgate%' OR i.Description LIKE '%Tlgt%' OR i.StockCode LIKE '%40726%'
    ORDER BY i.StockCode`;
const coverageSql = `SELECT MIN(h.earliestEntryDate) AS earliestEntryDate FROM dbo.InvMaster i
    OUTER APPLY (SELECT MIN(m.EntryDate) AS earliestEntryDate FROM dbo.InvMovements m
        WHERE m.StockCode=i.StockCode AND m.Warehouse='B-FIN01') h
    WHERE i.Description LIKE '%Tailgate%' OR i.Description LIKE '%Tlgt%' OR i.StockCode LIKE '%40726%'`;
const fail = (reason, status = 'unavailable') => ({ status, quantity: null, uom: 'EA', reason });
function parseRows(value) { if (Array.isArray(value)) return value; if (typeof value === 'string') { const rows = JSON.parse(value); if (Array.isArray(rows)) return rows; } throw new Error('Missing linked journal rows'); }
function uniqueRows(rows, journalOnly = false) {
  const seen = new Map();
  for (const row of rows) {
    const id = JSON.stringify([clean(row.stockCode), clean(row.warehouse), row.trnYear, row.trnMonth,
      ...(journalOnly ? [row.journal, row.journalEntry] : [dateText(row.entryDate), row.trnTime])]);
    const signature = JSON.stringify(row);
    if (seen.has(id) && seen.get(id).signature !== signature) throw new Error('Conflicting copies of a receipt or linked journal entry');
    seen.set(id, { row, signature });
  }
  return [...seen.values()].map(({ row }) => row);
}

// Identity only: never multiply finished units by a BOM factor. No suffix aliases.
function applicableMapping(stockCode, boms, date, { route, version, release } = {}) {
  const byParent = new Map(), candidates = new Set(), issues = new Set(), paths = [];
  for (const row of boms) { const key = clean(row.parentStockCode); if (!byParent.has(key)) byParent.set(key, []); byParent.get(key).push(row); }
  const visit = (parent, ancestors, trace) => {
    if (ancestors.has(parent)) return; // retain other positive branches; no consumption arithmetic
    if (ancestors.size > 16) { issues.add('BOM traversal is incomplete'); return; }
    for (const row of byParent.get(parent) || []) {
      if (parent === clean(stockCode) && route !== undefined && clean(row.route) !== clean(route)) continue;
      const on = dateText(row.structureOnDate), off = dateText(row.structureOffDate);
      const meaningful = (value) => value && !/^(1900|0001)-/.test(value);
      if ((meaningful(on) && on > date) || (meaningful(off) && off < date)) continue;
      if (meaningful(off) && off === date) issues.add('BOM expiry boundary requires source confirmation');
      if (!numeric(row.qtyPer)) { issues.add('Missing BOM factor'); continue; }
      if (Number(row.qtyPer) <= 0) continue;
      const child = clean(row.componentStockCode);
      if (row.parentReferenceExists === false || row.componentReferenceExists === false || row.factorUnitsVerified !== true || row.qtyPerBasis !== 'stocking') issues.add('Unverified BOM references or stock-unit basis');
      if ((clean(row.version) && clean(row.version) !== clean(version)) || (clean(row.release) && clean(row.release) !== clean(release))) issues.add('Applicable BOM revision is unresolved');
      const next = [...trace, { parent, child, route: clean(row.route) }];
      if (sheets.includes(child)) { candidates.add(child); paths.push(next); }
      else visit(child, new Set([...ancestors, parent]), next);
    }
  };
  visit(clean(stockCode), new Set(), []);
  if (!candidates.size) issues.add('No applicable positive BOM path to 120002 or 120003');
  if (candidates.size > 1) issues.add('Alternate BOM routes consume different sheets');
  return { stockCode: clean(stockCode), candidateSheets: [...candidates], status: issues.size ? 'incomplete' : 'verified', reason: [...issues].join('; '), paths };
}

function validateReceipt(row, expectedType, inverse = false) {
  if (clean(row.movementType) !== 'I' || clean(row.trnType) !== expectedType || clean(row.journalType) !== expectedType
      || !numeric(row.trnQty) || !numeric(row.journalQty) || Math.abs(Number(row.trnQty) * (inverse ? -1 : 1) - Number(row.journalQty)) > 1e-7
      || !clean(row.stockUom || row.journalUom) || clean(row.stockUom || row.journalUom) !== clean(row.journalUom)) throw new Error('Receipt type, quantity or units do not reconcile with the inventory journal');
}
function verifyProduction(receipt, { receiptWarehouse = 'B-FIN01' } = {}) {
  validateReceipt(receipt, clean(receipt.trnType));
  if (clean(receipt.warehouse) !== receiptWarehouse) throw new Error('The receipt is outside the required production warehouse');
  if (!['EA', 'PCS', 'EACH', 'PART'].includes(clean(receipt.stockUom))) throw new Error('Finished receipt is not in verified part units');
  const type = clean(receipt.trnType);
  if (!['R', 'T'].includes(type)) throw new Error('The finished posting is not a production receipt or linked transfer');
  if (receiptWarehouse === 'B-WIP01' && type !== 'R') throw new Error('Warehouse transfers are not backflush production receipts');
  const jobs = new Set([receipt.movementJob, receipt.journalJob].map(clean).filter(Boolean));
  if (type === 'T') {
    if (clean(receipt.transferFlag) !== 'I' || !clean(receipt.gtrReference)) throw new Error('The FG incoming transfer has no verified GTR receipt identity');
    const sources = uniqueRows(parseRows(receipt.sourceLegsJson));
    if (!sources.length) throw new Error('The FG transfer is missing its WIP source leg');
    for (const source of sources) {
      validateReceipt({ ...source, stockUom: receipt.stockUom }, 'T', true);
      if (clean(source.stockCode) !== clean(receipt.stockCode) || !clean(source.warehouse) || clean(source.newWarehouse) !== 'B-FIN01'
          || clean(source.transferFlag) !== 'O' || clean(source.transferToWh) !== 'B-FIN01' || clean(source.gtrReference) !== clean(receipt.gtrReference)) throw new Error('The transfer source does not reconcile to the same full stock code and GTR route');
      for (const job of [source.movementJob, source.journalJob].map(clean).filter(Boolean)) jobs.add(job);
    }
    const origins = new Set(sources.map((row) => clean(row.warehouse)));
    if (origins.size !== 1) throw new Error('The FG transfer has conflicting source warehouses');
    // Split GTR receipts need a verified allocation, not equality by time/quantity.
    if (Math.abs(sources.reduce((sum, source) => sum + Number(source.journalQty), 0) - Number(receipt.trnQty)) > 1e-7) throw new Error('The GTR source/receipt quantities require allocation');
    if (![...origins].includes('B-WIP01')) return { excluded: true, reason: `Verified transfer from ${[...origins][0]} is outside B-WIP01 production scope` };
    if (jobs.size !== 1) throw new Error('No unique production job links this FG transfer to its backflush batch');
  }
  const backflushes = uniqueRows(parseRows(receipt.backflushesJson));
  if (backflushes.length !== 1) throw new Error('The producing backflush receipt is missing or ambiguous; GTR alone is not production lineage');
  const backflush = backflushes[0];
  validateReceipt(backflush, 'R');
  if (clean(backflush.stockCode) !== clean(receipt.stockCode) || clean(backflush.stockUom) !== clean(receipt.stockUom)
      || !/^BACKFLUSH\b/.test(clean(backflush.journalReference))) throw new Error('The producing journal is not a verified backflush for this full stock code');
  if (type === 'T') {
    const backflushJobs = new Set([backflush.movementJob, backflush.journalJob].map(clean).filter(Boolean));
    if (clean(backflush.warehouse) !== 'B-WIP01' || backflushJobs.size !== 1 || !jobs.has([...backflushJobs][0])
        || Number(backflush.trnQty) <= 0 || Math.abs(Number(receipt.trnQty)) > Number(backflush.trnQty)) throw new Error('The producing receipt does not establish the transferred job quantity');
  } else if (clean(backflush.warehouse) !== receiptWarehouse || backflush.trnYear !== receipt.trnYear || backflush.trnMonth !== receipt.trnMonth
      || backflush.journal !== receipt.journal || backflush.journalEntry !== receipt.journalEntry) throw new Error('The direct finished receipt is not the same backflush posting');
  const journalRows = uniqueRows(parseRows(backflush.journalRowsJson), true);
  const outputs = journalRows.filter((row) => clean(row.trnType) === 'R' && Number(row.journalQty) !== 0);
  if (outputs.length !== 1 || clean(outputs[0].stockCode) !== clean(receipt.stockCode)) throw new Error('The backflush journal has multiple outputs; material attribution requires an allocation');
  if (outputs[0].journalEntry !== backflush.journalEntry || !numeric(outputs[0].journalQty)
      || Math.abs(Number(outputs[0].journalQty) - Number(backflush.trnQty)) > 1e-7) throw new Error('The producing receipt does not reconcile to the linked journal output');
  const materials = journalRows.filter((row) => clean(row.trnType) === 'I' && Number(row.journalQty) !== 0);
  if (!materials.length) throw new Error('The backflush has no linked material issues');
  for (const material of materials) {
    if (clean(material.warehouse) !== 'B-WIP01' || clean(material.movementType) !== 'I' || clean(material.movementTrnType) !== 'I'
        || !numeric(material.trnQty) || !numeric(material.journalQty) || Math.abs(Number(material.trnQty) - Number(material.journalQty)) > 1e-7
        || !clean(material.stockUom) || clean(material.stockUom) !== clean(material.journalUom)
        || Math.sign(Number(material.journalQty)) !== Math.sign(Number(backflush.trnQty))) throw new Error('Backflush material consumption/reversal is not verified in B-WIP01');
  }
  const route = clean(backflush.jobStockCode) === clean(receipt.stockCode) && clean(backflush.jobRoute) ? clean(backflush.jobRoute) : undefined;
  return { backflush, materials, route, job: [...jobs][0] || clean(backflush.journalJob),
    identity: [backflush.trnYear, backflush.trnMonth, backflush.journal, backflush.journalEntry, clean(backflush.stockCode)].join('/') };
}

function deriveBuiltParts({ date, windows, receipts, catalog, boms, coverage, receiptWarehouse = 'B-FIN01' }) {
  const discovered = catalog.map((item) => ({ ...item, stockCode: clean(item.stockCode), ...applicableMapping(item.stockCode, boms, date) }));
  if (!catalog.length || !boms.length) return { date, windows, catalog: discovered, rows: [],
    sheets: sheets.map((stockCode) => ({ stockCode, ...fail('A complete product master and applicable BOM snapshot is required') })) };
  const evidence = [], productionQuantities = new Map();
  let selected;
  try { selected = uniqueRows(receipts.filter((row) => { const at = movementLocal(row); return !at || windows.some((window) => at >= window.startLocal && at < window.endLocal); })); }
  catch (error) { return { date, windows, catalog: discovered, sheets: sheets.map((stockCode) => ({ stockCode, ...fail(error.message) })), rows: [] }; }
  for (const receipt of selected) {
    const at = movementLocal(receipt), window = at && windows.find((item) => at >= item.startLocal && at < item.endLocal);
    if (at && !window) continue;
    if (numeric(receipt.trnQty) && Number(receipt.trnQty) === 0) continue;
    const mapping = applicableMapping(receipt.stockCode, boms, dateText(receipt.entryDate));
    const item = { stockCode: clean(receipt.stockCode), receiptId: [receipt.trnYear, receipt.trnMonth, receipt.journal, receipt.journalEntry, dateText(receipt.entryDate), receipt.trnTime].join('/'),
      quantity: numeric(receipt.trnQty) ? Number(receipt.trnQty) : null, shift: window?.shift || null, postingLocal: at,
      warehouse: clean(receipt.warehouse), trnType: clean(receipt.trnType), journal: receipt.journal, journalEntry: receipt.journalEntry, reference: receipt.reference || receipt.journalReference,
      candidateSheets: mapping.candidateSheets, status: 'unavailable', reason: '', mapping };
    try {
      if (!at) throw new Error('The finished receipt has no verified timestamp for the configured shifts');
      const production = verifyProduction(receipt, { receiptWarehouse });
      if (production.excluded) { item.status = 'excluded'; item.reason = production.reason; evidence.push(item); continue; }
      const productionDate = dateText(production.backflush.entryDate);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(productionDate)) throw new Error('The producing backflush date is unavailable for BOM effectivity');
      item.backflushId = production.identity; item.job = production.job; item.confirmedRoute = production.route;
      const rootIssues = new Set(production.materials.map((row) => clean(row.stockCode)));
      const options = { route: production.route, version: production.backflush.jobVersion || receipt.version, release: production.backflush.jobRelease || receipt.release };
      let applicable = applicableMapping(receipt.stockCode, boms, productionDate, options);
      if (production.route === undefined) {
        // Actual issued top-level components can prove a route family. Do not pick
        // route 0 just because it exists, or infer a batch from equal quantities.
        const matchedRoutes = [...new Set(boms.filter((row) => clean(row.parentStockCode) === item.stockCode && rootIssues.has(clean(row.componentStockCode)) && Number(row.qtyPer) > 0
          && (sheets.includes(clean(row.componentStockCode)) || applicableMapping(row.componentStockCode, boms, productionDate).candidateSheets.length)).map((row) => clean(row.route)))];
        const matches = matchedRoutes.map((route) => applicableMapping(receipt.stockCode, boms, productionDate, { ...options, route }));
        const candidateSheets = [...new Set(matches.flatMap((row) => row.candidateSheets))];
        if (matches.length && matches.every((row) => row.status === 'verified') && candidateSheets.length === 1) {
          applicable = { ...matches[0], candidateSheets }; item.confirmedRoutes = matchedRoutes;
        }
      }
      const consumed = production.materials.flatMap((material) => sheets.includes(clean(material.stockCode)) ? [clean(material.stockCode)]
        : applicableMapping(material.stockCode, boms, productionDate).candidateSheets);
      const consumedSheets = [...new Set(consumed)];
      item.candidateSheets = [...new Set([...applicable.candidateSheets, ...consumedSheets])];
      item.mapping = applicable;
      if (applicable.status !== 'verified' || applicable.candidateSheets.length !== 1 || consumedSheets.length !== 1 || consumedSheets[0] !== applicable.candidateSheets[0]) {
        item.status = 'incomplete'; item.reason = applicable.reason || 'The posting/job and applicable BOM do not establish one consumed sheet';
      } else { item.status = 'available'; item.sheet = consumedSheets[0]; }
      if (clean(receipt.trnType) === 'T') {
        const group = productionQuantities.get(production.identity) || { produced: Math.abs(Number(production.backflush.trnQty)), rows: [] };
        group.rows.push(item); productionQuantities.set(production.identity, group);
      }
    } catch (error) { item.reason = error.message; }
    evidence.push(item);
  }
  for (const group of productionQuantities.values()) if (Math.abs(group.rows.reduce((sum, row) => sum + row.quantity, 0)) > group.produced + 1e-7) {
    for (const row of group.rows) { row.status = 'unavailable'; row.reason = 'Finished receipts exceed their linked backflush output; allocation is unverified'; }
  }
  const covered = coverage?.earliestEntryDate && dateText(coverage.earliestEntryDate) <= date;
  return { date, windows, catalog: discovered, rows: evidence, sheets: sheets.map((stockCode) => {
    const relevant = evidence.filter((row) => row.status !== 'excluded' && (row.sheet === stockCode || (!row.sheet && (!row.candidateSheets.length || row.candidateSheets.includes(stockCode)))));
    const verified = relevant.filter((row) => row.status === 'available');
    const byStockCode = [...new Set(relevant.map((row) => row.stockCode))].map((code) => ({ stockCode: code,
      quantity: round(verified.filter((row) => row.stockCode === code).reduce((sum, row) => sum + row.quantity, 0)),
      unresolvedReceipts: relevant.filter((row) => row.stockCode === code && row.status !== 'available').length }));
    const unresolved = relevant.filter((row) => row.status !== 'available');
    const subtotal = round(verified.reduce((sum, row) => sum + row.quantity, 0));
    const error = !covered ? fail(`Retained ${receiptWarehouse} history does not cover this production date`)
      : unresolved.some((row) => row.status === 'unavailable') ? fail(unresolved.find((row) => row.status === 'unavailable').reason)
        : unresolved.length ? fail('One or more production receipts have unresolved applicable BOM or production-route attribution', 'incomplete') : null;
    return { stockCode, ...(error || { status: 'available', quantity: subtotal, uom: 'EA', reason: receiptWarehouse === 'B-WIP01'
      ? 'Verified B-WIP01 backflush production at its receipt timestamp; subsequent FG transfers are separate'
      : 'Verified backflush units received into B-FIN01; not sheet equivalents' }),
      verifiedSubtotal: subtotal, byStockCode, unresolvedCodes: [...new Set(unresolved.map((row) => row.stockCode))] };
  }) };
}
const deriveTailgates = (args) => deriveBuiltParts(args);

async function readTailgates(db, date, windows, parameters) {
  const { BOM_SQL } = require('../routes/inventory');
  const { mapBomRow } = require('../bomMapping');
  const [receipts, catalog, boms, coverage] = await Promise.all([db.query(sql, parameters), db.query(catalogSql), db.query(BOM_SQL), db.query(coverageSql)]);
  const types = require('mssql');
  const bind = (entries) => entries.map(([name, value]) => ({ name, value, type: typeof value === 'number' ? types.Int : types.VarChar(60) }));
  const refs = [...new Map(receipts.filter((row) => clean(row.trnType) === 'T' && clean(row.gtrReference))
    .map((row) => [[clean(row.stockCode), clean(row.gtrReference)].join('/'), row])).values()];
  const sources = refs.length ? await db.query(`SELECT m.StockCode AS stockCode,m.Warehouse AS warehouse,m.NewWarehouse AS newWarehouse,
      m.EntryDate AS entryDate,m.TrnTime AS trnTime,m.TrnYear AS trnYear,m.TrnMonth AS trnMonth,
      m.Journal AS journal,m.JournalEntry AS journalEntry,m.MovementType AS movementType,m.TrnType AS trnType,
      m.TrnQty AS trnQty,m.Job AS movementJob,j.Job AS journalJob,j.TrnType AS journalType,j.TrnQty AS journalQty,
      j.Uom AS journalUom,j.TransferFlag AS transferFlag,j.TransferToWh AS transferToWh,j.GtrReference AS gtrReference
      FROM dbo.InvMovements m LEFT JOIN dbo.InvJournalDet j ON j.JnlYear=m.TrnYear AND j.JnlMonth=m.TrnMonth
        AND j.Journal=m.Journal AND j.EntryNumber=m.JournalEntry AND j.StockCode=m.StockCode AND j.Warehouse=m.Warehouse
      WHERE m.NewWarehouse='B-FIN01' AND m.TrnType='T' AND (
        ${refs.map((_, i) => `(m.StockCode=@SourceCode${i} AND m.Reference=@Gtr${i})`).join(' OR ')})`,
    bind(refs.flatMap((row, i) => [[`SourceCode${i}`, clean(row.stockCode)], [`Gtr${i}`, clean(row.gtrReference)]]))) : [];
  const jobs = [...new Map([...receipts, ...sources].flatMap((row) => [row.movementJob, row.journalJob].map(clean).filter(Boolean)
    .map((job) => [[clean(row.stockCode), job].join('/'), { stockCode: clean(row.stockCode), job }]))).values()];
  const direct = receipts.filter((row) => clean(row.trnType) === 'R');
  const filters = [...jobs.map((_, i) => `(b.StockCode=@JobCode${i} AND (b.Job=@Job${i} OR bj.Job=@Job${i}))`),
    ...direct.map((_, i) => `(b.StockCode=@DirectCode${i} AND b.TrnYear=@DirectYear${i} AND b.TrnMonth=@DirectMonth${i} AND b.Journal=@DirectJournal${i} AND b.JournalEntry=@DirectEntry${i} AND b.Warehouse='B-FIN01')`)];
  const backflushes = filters.length ? await db.query(`SELECT b.StockCode AS stockCode,b.Warehouse AS warehouse,b.EntryDate AS entryDate,
      b.TrnTime AS trnTime,b.TrnYear AS trnYear,b.TrnMonth AS trnMonth,b.Journal AS journal,b.JournalEntry AS journalEntry,
      b.MovementType AS movementType,b.TrnType AS trnType,b.TrnQty AS trnQty,b.Job AS movementJob,
      bj.TrnType AS journalType,bj.TrnQty AS journalQty,bj.Uom AS journalUom,bj.Job AS journalJob,bj.Reference AS journalReference,
      i.StockUom AS stockUom,w.StockCode AS jobStockCode,w.Route AS jobRoute,w.Version AS jobVersion,w.Release AS jobRelease
      FROM dbo.InvMovements b LEFT JOIN dbo.InvJournalDet bj ON bj.JnlYear=b.TrnYear AND bj.JnlMonth=b.TrnMonth
        AND bj.Journal=b.Journal AND bj.EntryNumber=b.JournalEntry AND bj.StockCode=b.StockCode AND bj.Warehouse=b.Warehouse
      LEFT JOIN dbo.InvMaster i ON i.StockCode=b.StockCode
      LEFT JOIN dbo.WipMaster w ON w.Job=COALESCE(NULLIF(LTRIM(RTRIM(bj.Job)),''),NULLIF(LTRIM(RTRIM(b.Job)),''))
      WHERE b.TrnType='R' AND (${filters.join(' OR ')})`, bind([
    ...jobs.flatMap((row, i) => [[`JobCode${i}`, row.stockCode], [`Job${i}`, row.job]]),
    ...direct.flatMap((row, i) => [[`DirectCode${i}`, clean(row.stockCode)], [`DirectYear${i}`, row.trnYear], [`DirectMonth${i}`, row.trnMonth], [`DirectJournal${i}`, row.journal], [`DirectEntry${i}`, row.journalEntry]])])) : [];
  const journals = [...new Map(backflushes.map((row) => [[row.trnYear, row.trnMonth, row.journal].join('/'), row])).values()];
  const journalRows = journals.length ? await db.query(`SELECT d.StockCode AS stockCode,d.Warehouse AS warehouse,d.TrnType AS trnType,
      d.TrnQty AS journalQty,d.Uom AS journalUom,d.Reference AS reference,d.JnlYear AS trnYear,d.JnlMonth AS trnMonth,
      d.Journal AS journal,d.EntryNumber AS journalEntry,d.Job AS journalJob,i.StockUom AS stockUom,
      m.EntryDate AS entryDate,m.TrnTime AS trnTime,m.TrnQty AS trnQty,m.MovementType AS movementType,m.TrnType AS movementTrnType
      FROM dbo.InvJournalDet d LEFT JOIN dbo.InvMaster i ON i.StockCode=d.StockCode
      LEFT JOIN dbo.InvMovements m ON m.TrnYear=d.JnlYear AND m.TrnMonth=d.JnlMonth
        AND m.Journal=d.Journal AND m.JournalEntry=d.EntryNumber AND m.StockCode=d.StockCode AND m.Warehouse=d.Warehouse
      WHERE d.TrnType IN ('I','R') AND (${journals.map((_, i) => `(d.JnlYear=@Year${i} AND d.JnlMonth=@Month${i} AND d.Journal=@Journal${i})`).join(' OR ')})`,
    bind(journals.flatMap((row, i) => [[`Year${i}`, row.trnYear], [`Month${i}`, row.trnMonth], [`Journal${i}`, row.journal]]))) : [];
  const sameJournal = (a, b) => a.trnYear === b.trnYear && a.trnMonth === b.trnMonth && a.journal === b.journal;
  for (const receipt of receipts) {
    receipt.sourceLegsJson = sources.filter((row) => clean(row.stockCode) === clean(receipt.stockCode) && clean(row.gtrReference) === clean(receipt.gtrReference));
    const linkedJobs = new Set([receipt, ...receipt.sourceLegsJson].flatMap((row) => [row.movementJob, row.journalJob].map(clean).filter(Boolean)));
    receipt.backflushesJson = backflushes.filter((row) => clean(row.stockCode) === clean(receipt.stockCode) && (clean(receipt.trnType) === 'R'
      ? sameJournal(row, receipt) && row.journalEntry === receipt.journalEntry && row.warehouse === receipt.warehouse
      : [row.movementJob, row.journalJob].some((job) => clean(job) && linkedJobs.has(clean(job)))))
      .map((row) => ({ ...row, journalRowsJson: journalRows.filter((detail) => sameJournal(row, detail)) }));
  }
  return deriveTailgates({ date, windows, receipts, catalog, boms: boms.map(mapBomRow), coverage: coverage[0] });
}
module.exports = { sql, catalogSql, coverageSql, applicableMapping, verifyProduction, deriveBuiltParts, deriveTailgates, readTailgates };
