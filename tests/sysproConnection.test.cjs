const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const { createDatabase, buildConfig } = require('../server/db');
const { describeError } = require('../server/sysproErrors');
const error = (code, message = 'synthetic failure') => Object.assign(new Error(message), { code });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function fixture(connect = async () => {}, query = async () => ({ recordset: [{ ok: 1 }] })) {
  const pools = []; let time = 0;
  class Pool extends EventEmitter {
    constructor() { super(); this.closed = 0; pools.push(this); }
    async connect() { await connect(this, pools.length); return this; }
    async close() { this.closed++; }
    request() { return { input() {}, query: (sql) => query(this, sql) }; }
  }
  const db = createDatabase({ config: buildConfig({ SYSPRO_USER: 'fixture', SYSPRO_PASSWORD: '' }), Pool, now: () => time });
  return { db, pools, tick(ms = 30000) { time += ms; } };
}

test('first pool failure is shared, closed, cooled down, then recovers without restart', async () => {
  const gate = deferred();
  const f = fixture(async (_pool, n) => { if (n === 1) await gate.promise; });
  const pending = [f.db.testConnection(), f.db.testConnection()];
  gate.reject(error('ESOCKET'));
  const result = await Promise.allSettled(pending);
  assert.ok(result.every((r) => r.status === 'rejected'));
  assert.equal(f.pools.length, 1); assert.equal(f.pools[0].closed, 1);
  await assert.rejects(f.db.testConnection(), { code: 'ESOCKET' });
  assert.equal(f.pools.length, 1);
  f.tick(); await f.db.testConnection(); await f.db.testConnection();
  assert.equal(f.pools.length, 2); assert.equal(f.pools[1].closed, 0);
  await f.db.close(); assert.equal(f.pools[1].closed, 1);
});

test('query permission failures and request timeouts retain the healthy pool', async () => {
  let failure = 'EREQUEST';
  const f = fixture(undefined, async () => { if (failure) throw error(failure); return { recordset: [] }; });
  await assert.rejects(f.db.testConnection(), { code: 'EREQUEST' });
  failure = 'ETIMEOUT'; await assert.rejects(f.db.testConnection(), { code: 'ETIMEOUT' });
  failure = null; await f.db.testConnection();
  assert.equal(f.pools.length, 1); assert.equal(f.pools[0].closed, 0); await f.db.close();
});

test('late failure cannot invalidate a replacement pool; error events close only their own pool', async () => {
  const gate = deferred(); let calls = 0;
  const f = fixture(undefined, async (_pool, sql) => {
    if (sql === 'old') return gate.promise;
    if (++calls === 1) throw error('ECONNCLOSED');
    return { recordset: [] };
  });
  const old = f.db.query('old');
  await assert.rejects(f.db.testConnection(), { code: 'ECONNCLOSED' });
  f.tick(); await f.db.testConnection();
  gate.reject(error('ESOCKET')); await assert.rejects(old);
  await f.db.testConnection();
  assert.equal(f.pools.length, 2); assert.equal(f.pools[1].closed, 0);
  f.pools[0].emit('error', error('ESOCKET'));
  assert.equal(f.pools[1].closed, 0);
  f.pools[1].emit('error', error('ESOCKET')); await new Promise(setImmediate);
  assert.equal(f.pools[1].closed, 1);
});

test('invalid configuration does not allocate pools; authentication failures have stable cooldown', async () => {
  let allocations = 0;
  const db = createDatabase({ config: buildConfig({}), Pool: class { constructor() { allocations++; } } });
  await assert.rejects(db.testConnection(), { code: 'SYSPRO_CONFIG' });
  assert.equal(allocations, 0);
  const f = fixture(async () => { throw error('ELOGIN'); });
  await assert.rejects(f.db.testConnection(), { code: 'ELOGIN' });
  f.tick(); await assert.rejects(f.db.testConnection(), { code: 'ELOGIN' });
  assert.equal(f.pools.length, 1); assert.equal(f.pools[0].closed, 1);
});

test('timeouts stay finite and bounded without changing existing TLS policy', () => {
  const c = buildConfig({ SYSPRO_CONNECTION_TIMEOUT_MS: 'Infinity', SYSPRO_REQUEST_TIMEOUT_MS: '99999999' });
  assert.equal(c.connectionTimeout, 15000); assert.equal(c.requestTimeout, 90000);
  assert.equal(c.options.encrypt, true); assert.equal(c.options.trustServerCertificate, true);
});

test('safe diagnostics distinguish DNS, TCP, auth, permission, timeout and pool failures', () => {
  const cases = [['ENOTFOUND', 'SYSPRO_DNS', true], ['ECONNREFUSED', 'SYSPRO_NETWORK', true], ['ELOGIN', 'SYSPRO_AUTH', false],
    ['EREQUEST', 'SYSPRO_QUERY', false], ['ETIMEOUT', 'SYSPRO_TIMEOUT', true], ['ECONNCLOSED', 'SYSPRO_POOL', true], ['SYSPRO_CONFIG', 'SYSPRO_CONFIG', false]];
  for (const [code, category, retryable] of cases) {
    const detail = describeError(error(code, 'SECRET synthetic credentials/query'));
    assert.equal(detail.code, category); assert.equal(detail.retryable, retryable);
    assert.ok(!JSON.stringify(detail).includes('SECRET'));
  }
  assert.equal(describeError(Object.assign(error('ESOCKET'), { originalError: error('ENOTFOUND') })).code, 'SYSPRO_DNS');
});

let connection, api;
test.before(async () => {
  connection = await import('../mrp-planner/src/api/sysproConnection.js');
  api = await import('../mrp-planner/src/api/sysproApi.js');
});

function sourceFixture(read) {
  let time = 0; const timers = new Map(), changes = []; let nextTimer = 0;
  const source = connection.createSourceConnection({ read, source: 'synthetic SYSPRO', onChange: (s) => changes.push(s), now: () => time,
    schedule(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; }, unschedule(id) { timers.delete(id); } });
  return { source, changes, timers, tick(ms = 30000) { time += ms; }, async retry() { const [id, timer] = [...timers][0]; timers.delete(id); time += timer.ms; timer.fn(); await new Promise(setImmediate); } };
}

test('initial status is checking; backend/SQL recovery has a single capped retry loop and clears errors', async () => {
  let available = false, inFlight = 0, maximum = 0, calls = 0;
  const f = sourceFixture(async () => { calls++; maximum = Math.max(maximum, ++inFlight); await Promise.resolve(); inFlight--;
    if (!available) throw Object.assign(error('BACKEND_UNAVAILABLE'), { retryable: true }); return { data: [{ StockCode: 'fixture' }] }; });
  assert.equal(f.source.getState().phase, 'checking');
  await f.source.refresh(); assert.equal(f.source.getState().phase, 'offline');
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    assert.equal(f.timers.size, 1); assert.equal([...f.timers.values()][0].ms, delay); await f.retry();
  }
  available = true; await f.retry();
  assert.equal(f.source.getState().phase, 'connected'); assert.equal(f.source.getState().error, null);
  assert.equal(f.timers.size, 0); assert.equal(maximum, 1); assert.ok(calls > 1);
  assert.ok(f.changes.some((s) => s.phase === 'reconnecting'));
  f.source.stop();
});

test('last known data retains timestamp and source while offline; stable errors do not retry', async () => {
  let fail = false;
  const f = sourceFixture(async () => { if (fail) throw Object.assign(error('SYSPRO_AUTH', 'Approved credentials required'), { retryable: false });
    return { data: [{ StockCode: 'fixture' }], fetchedAt: '2026-11-18T10:00:00Z', source: 'synthetic inventory' }; });
  await f.source.refresh(); const success = f.source.getState();
  fail = true; await f.source.refresh(); const failed = f.source.getState();
  assert.equal(failed.phase, 'offline'); assert.equal(failed.data, success.data);
  assert.equal(failed.lastUpdated, success.lastUpdated); assert.equal(failed.source, 'synthetic inventory'); assert.equal(f.timers.size, 0);
  f.source.stop();
});

test('obsolete errors cannot overwrite a newer success; stopping aborts and clears retries', async () => {
  const old = deferred(); let calls = 0, signal;
  const f = sourceFixture(async (options) => { if (++calls === 1) { signal = options.signal; return old.promise; } return { data: ['new'] }; });
  const previous = f.source.refresh(); await f.source.refresh();
  assert.equal(signal.aborted, true);
  old.reject(Object.assign(error('ESOCKET'), { retryable: true })); await previous;
  assert.equal(f.source.getState().phase, 'connected'); assert.deepEqual(f.source.getState().data, ['new']); assert.equal(f.timers.size, 0);
  f.source.stop(); await f.source.refresh(); assert.equal(calls, 2);
  const retry = sourceFixture(async () => { throw Object.assign(error('ETIMEOUT'), { retryable: true }); });
  await retry.source.refresh(); assert.equal(retry.timers.size, 1); retry.source.stop(); assert.equal(retry.timers.size, 0);
});

test('focus/online triggers are throttled and cannot overlap an in-flight check', async () => {
  const gate = deferred(); let calls = 0;
  const f = sourceFixture(async () => { calls++; return gate.promise; });
  const initial = f.source.refresh(); f.tick(); await f.source.refresh({ trigger: true }); assert.equal(calls, 1);
  gate.resolve({ data: [] }); await initial;
  await f.source.refresh({ trigger: true }); assert.equal(calls, 2);
  await f.source.refresh({ trigger: true }); assert.equal(calls, 2);
  f.source.stop();
});

test('API transport distinguishes proxy failure, timeout, auth and cancellation', async (t) => {
  t.mock.method(global, 'fetch', async () => new Response('', { status: 500 }));
  await assert.rejects(api.fetchSysproInventory(), { code: 'BACKEND_UNAVAILABLE', retryable: true });
  global.fetch = async () => new Response('<html>wrong proxy</html>');
  await assert.rejects(api.fetchSysproInventory(), { code: 'API_RESPONSE', retryable: false });
  global.fetch = async () => new Response(JSON.stringify({ success: false, code: 'SYSPRO_AUTH', error: 'Ask IT for approved credentials', retryable: false }), { status: 503 });
  await assert.rejects(api.fetchSysproInventory(), { code: 'SYSPRO_AUTH', retryable: false });
  global.fetch = (_url, { signal }) => new Promise((_resolve, reject) => { const abort = () => reject(new DOMException('Aborted', 'AbortError')); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); });
  await assert.rejects(api.fetchSysproInventory({ timeoutMs: 5 }), { code: 'REQUEST_TIMEOUT', retryable: true });
  const controller = new AbortController(); const pending = api.fetchSysproBom({ signal: controller.signal }); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('HTTP health checks SQL, reports failure as 503, and source failures stay independent', async (t) => {
  const db = require('../server/db'), app = require('../server/server');
  t.mock.method(console, 'error', () => {});
  t.mock.method(db, 'testConnection', async () => { throw error('ELOGIN', 'SECRET'); });
  t.mock.method(db, 'query', async (sql) => { if (sql.includes('FROM BomStructure')) throw error('EREQUEST'); return [{ StockCode: 'synthetic' }]; });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const ready = await fetch(`${url}/api/ready`); assert.equal(ready.status, 200);
  const health = await fetch(`${url}/api/health`); assert.equal(health.status, 503); assert.equal(health.headers.get('cache-control'), 'no-store');
  const payload = await health.json(); assert.equal(payload.success, false); assert.equal(payload.code, 'SYSPRO_AUTH'); assert.ok(!JSON.stringify(payload).includes('SECRET'));
  const inventory = await fetch(`${url}/api/syspro/inventory`); assert.equal(inventory.status, 200);
  const stock = await inventory.json(); assert.equal(stock.data[0].StockCode, 'synthetic'); assert.ok(stock.fetchedAt); assert.ok(stock.source);
  const bom = await fetch(`${url}/api/syspro/bom`); assert.equal(bom.status, 503); assert.equal((await bom.json()).code, 'SYSPRO_QUERY');
  db.testConnection = async () => true;
  const recovered = await fetch(`${url}/api/health`); assert.equal(recovered.status, 200); assert.equal((await recovered.json()).database, 'connected');
});

test('stale inventory prevents complete ledger calculations', async () => {
  const { runMRP } = await import('../mrp-planner/src/bom/mrpEngine.js');
  const result = runMRP([{ id: 'fixture', code: 'fixture', onHand: 10 }], [], [], [], 1, new Date('2026-11-16'), true, false);
  assert.equal(result.fixture.incomplete, true); assert.equal(result.fixture.POH[0], null);
  assert.ok(result.fixture.issues.some((issue) => issue.includes('inventory unavailable')));
});

test('environment settings load from project root even with a different working directory', () => {
  const { spawnSync } = require('node:child_process');
  const path = require('node:path');
  const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(require.resolve('dotenv'))}).config = (options) => console.log(options.path); require(${JSON.stringify(path.resolve(__dirname, '../server/loadEnv'))});`],
    { cwd: path.parse(process.cwd()).root, encoding: 'utf8' });
  assert.equal(result.status, 0); assert.equal(result.stdout.trim(), path.resolve(__dirname, '../.env'));
});
