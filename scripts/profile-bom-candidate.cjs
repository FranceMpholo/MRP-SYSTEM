// One read-only candidate SELECT with session-local SQL timing messages. No
// schema/statistics/cache changes, mutations, or secret values in the report.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const sql = require('mssql');
const { buildConfig } = require('../server/db');
const { BOM_SQL } = require('../server/routes/inventory');
const { mapBomRow } = require('../server/bomMapping');
const output = path.resolve(__dirname, '../diagnostics/bom-performance');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

(async () => {
  const config = buildConfig();
  // Keep SHOWPLAN's session-local option on this one disposable connection.
  config.pool = { max: 1, min: 0, idleTimeoutMillis: 30000 };
  config.validateConnection = false;
  const pool = new sql.ConnectionPool(config);
  try {
    let start = performance.now(); await pool.connect(); const connectionMs = performance.now() - start;
    const originalSql = BOM_SQL.replace(/\s+OPTION\s*\(HASH JOIN\)\s*;/i, ';');
    let originalPlan = {};
    try {
      // batch() keeps SET in the connection's batch/session scope, rather than
      // a parameterized sp_executesql call whose settings are restored on exit.
      await pool.request().batch('SET SHOWPLAN_XML ON');
      try {
        const result = await pool.request().batch(originalSql);
        const xml = Object.values(result.recordset?.[0] || {})[0];
        if (typeof xml === 'string' && xml.includes('<ShowPlanXML')) {
          fs.writeFileSync(path.join(output, 'original-estimated-plan.xml'), xml);
          const operators = [...xml.matchAll(/<RelOp\b[^>]*PhysicalOp="([^"]+)"/g)].map((match) => match[1]);
          originalPlan = { estimatedOnly: true, operators, joins: operators.filter((op) => /Join|Loop|Hash|Merge/.test(op)) };
        } else throw Object.assign(new Error('Expected estimated XML plan'), { code: 'NOT_A_PLAN' });
      } finally { await pool.request().batch('SET SHOWPLAN_XML OFF'); }
    } catch (error) { originalPlan = { unavailable: true, code: error.code, number: error.number,
      showplanPermissionDenied: /SHOWPLAN permission denied/i.test(error.message) }; }
    if (process.argv.includes('--plan-only')) {
      fs.writeFileSync(path.join(output, 'original-plan-summary.json'), JSON.stringify(originalPlan, null, 2));
      console.log(JSON.stringify(originalPlan, null, 2)); return;
    }
    const query = originalSql.replace(/;\s*$/, '\nOPTION (HASH JOIN);');
    const request = pool.request(), sqlTimings = [];
    request.on('info', (info) => { if (/SQL Server.*Times|CPU time|elapsed time/.test(info.message)) sqlTimings.push(info.message.trim()); });
    start = performance.now(); const result = await request.query(`SET STATISTICS TIME ON;\n${query}\nSET STATISTICS TIME OFF;`);
    const queryAndRetrievalMs = performance.now() - start;
    start = performance.now(); const data = result.recordset.map(mapBomRow); const mapMs = performance.now() - start;
    start = performance.now(); const body = JSON.stringify(data); const serializationMs = performance.now() - start;
    const { inspectBom } = await import('../mrp-planner/src/bom/bomValidation.js');
    const warnings = (rows) => { const c = inspectBom(rows); return JSON.stringify({ global: c.globalIssues, parents: [...c.parentIssues], lines: rows.map((row) => c.lineIssues.get(row)) }); };
    const baseline = JSON.parse(fs.readFileSync(path.join(output, 'before-manual-response.json'), 'utf8')).data;
    const report = { connectionMs, queryAndRetrievalMs, mapMs, serializationMs, originalPlan, rows: data.length, dataBytes: Buffer.byteLength(body),
      dataSha256: hash(body), baselineDataSha256: hash(JSON.stringify(baseline)),
      warningsSha256: hash(warnings(data)), baselineWarningsSha256: hash(warnings(baseline)), sqlTimings };
    fs.writeFileSync(path.join(output, 'candidate-mapped.json'), body);
    fs.writeFileSync(path.join(output, 'candidate.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await pool.close(); }
})().catch((error) => { console.error({ code: error.code, message: 'Read-only BOM candidate measurement failed; details kept local.' }); process.exitCode = 1; });
