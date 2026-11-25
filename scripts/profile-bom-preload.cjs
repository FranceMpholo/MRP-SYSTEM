// Optional local diagnostics, loaded with NODE_OPTIONS=--require. No SQL/data
// changes, extra queries, credentials or record values are logged.
const { AsyncLocalStorage } = require('node:async_hooks');
const { performance } = require('node:perf_hooks');
const fs = require('node:fs');
const path = require('node:path');
const context = new AsyncLocalStorage();
const output = process.env.BOM_PROFILE_FILE;
if (!output) throw Error('BOM_PROFILE_FILE must name a local diagnostics file.');
fs.mkdirSync(path.dirname(output), { recursive: true });
const elapsed = (start) => performance.now() - start;
const rounded = (value) => Math.round(value * 100) / 100;
const express = require('express');
const handle = express.application.handle;
let sequence = 0;
express.application.handle = function (request, response, ...args) {
  if (request.url.split('?')[0] !== '/api/syspro/bom') return handle.call(this, request, response, ...args);
  const timing = { id: `${process.pid}-${++sequence}`, startedAt: new Date().toISOString(), start: performance.now(), mapMs: 0, queryCount: 0 };
  response.setHeader('X-BOM-Profile-Id', timing.id);
  response.once('finish', () => {
    const { start, dbStart, acquireStart, acquireEnd, queryEnd, jsonStart, ...report } = timing;
    report.totalMs = rounded(elapsed(start)); report.status = response.statusCode;
    fs.appendFileSync(output, JSON.stringify(report) + '\n');
  });
  response.once('close', () => {
    if (!response.writableFinished) fs.appendFileSync(output, JSON.stringify({ id: timing.id, abortedAfterMs: rounded(elapsed(timing.start)) }) + '\n');
  });
  return context.run(timing, () => handle.call(this, request, response, ...args));
};
const acquire = require('mssql').ConnectionPool.prototype.acquire;
require('mssql').ConnectionPool.prototype.acquire = function (request, callback) {
  const timing = context.getStore();
  if (!timing) return acquire.call(this, request, callback);
  timing.acquireStart = performance.now();
  timing.connectionOrPoolMs = rounded(timing.acquireStart - timing.dbStart);
  return acquire.call(this, request, (...args) => {
    timing.acquireEnd = performance.now(); timing.acquireMs = rounded(timing.acquireEnd - timing.acquireStart);
    return callback(...args);
  });
};
const db = require('../server/db'), query = db.query;
db.query = async function (...args) {
  const timing = context.getStore();
  if (!timing) return query(...args);
  timing.queryCount++; timing.dbStart = performance.now();
  try { const rows = await query(...args); timing.rows = rows.length; return rows; }
  finally {
    timing.queryEnd = performance.now();
    timing.queryAndRetrievalMs = rounded(timing.queryEnd - (timing.acquireEnd || timing.dbStart));
  }
};
const mapping = require('../server/bomMapping'), map = mapping.mapBomRow;
mapping.mapBomRow = function (row) {
  const timing = context.getStore(); if (!timing) return map(row);
  const start = performance.now(); const result = map(row); timing.mapMs += elapsed(start); return result;
};
const json = express.response.json, send = express.response.send;
express.response.json = function (payload) {
  const timing = context.getStore();
  if (timing) {
    timing.mappingAndEnvelopeMs = rounded(performance.now() - timing.queryEnd);
    timing.mapMs = rounded(timing.mapMs); timing.jsonStart = performance.now();
  }
  return json.call(this, payload);
};
express.response.send = function (body) {
  const timing = context.getStore();
  if (timing && typeof body === 'string') {
    timing.serializationMs = rounded(elapsed(timing.jsonStart)); timing.bytes = Buffer.byteLength(body);
    this.setHeader('Server-Timing', [
      ['pool', timing.connectionOrPoolMs], ['acquire', timing.acquireMs], ['sql', timing.queryAndRetrievalMs],
      ['map', timing.mappingAndEnvelopeMs], ['json', timing.serializationMs],
    ].map(([name, value]) => `${name};dur=${value || 0}`).join(', '));
    timing.beforeSendMs = rounded(elapsed(timing.start));
  }
  return send.call(this, body);
};
