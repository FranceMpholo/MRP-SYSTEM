const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const path = require('node:path');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fixtureFile = path.join(__dirname, 'fixtures/sysproDevService.cjs');
const launcherFile = path.join(__dirname, '../scripts/dev.cjs');
async function freePort() {
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise((resolve) => probe.close(resolve)); return port;
}
function launch(options, env = {}) {
  const script = `require(${JSON.stringify(launcherFile)}).main(${JSON.stringify({ backendFile: fixtureFile, frontendFile: fixtureFile, ...options })}).catch(e=>{console.error(e.message);process.exitCode=1;});`;
  const child = spawn(process.execPath, ['-e', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
  const exit = once(child, 'exit');
  return { child, exit, output: () => output };
}
async function ready(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(200) });
      const payload = await response.json(); if (payload.fixture) return payload; } catch {}
    await pause(50);
  }
  throw Error('Synthetic development process did not start');
}
function cleanup(t, run, ports) {
  t.after(async () => {
    // Only these synthetic fixture ports can receive the fixture-only /crash URL.
    for (const port of ports) {
      try { const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(200) });
        if ((await r.json()).fixture) await fetch(`http://127.0.0.1:${port}/crash`); } catch {}
    }
    if (run.child.exitCode === null) run.child.kill();
  });
}

test('combined cold startup starts both children, surfaces failures, and stops the other owned process', { timeout: 15000 }, async (t) => {
  const apiPort = await freePort(), frontendPort = await freePort();
  const run = launch({ apiPort, frontendPort });
  cleanup(t, run, [frontendPort, apiPort]);
  assert.equal((await ready(apiPort)).kind, 'backend');
  assert.equal((await ready(frontendPort)).kind, 'frontend');
  await fetch(`http://127.0.0.1:${frontendPort}/crash`);
  const [code] = await run.exit; assert.equal(code, 7);
  assert.match(run.output(), /fixture backend ready/); assert.match(run.output(), /fixture frontend ready/);
  await assert.rejects(fetch(`http://127.0.0.1:${apiPort}/`, { signal: AbortSignal.timeout(500) }));
});

test('a cold backend taking longer than ten seconds can finish before Vite starts', { timeout: 30000 }, async (t) => {
  const apiPort = await freePort(), frontendPort = await freePort();
  const run = launch({ apiPort, frontendPort }, { DEV_STARTUP_TIMEOUT_MS: '', DEV_FIXTURE_START_DELAY_MS: '11000' });
  cleanup(t, run, [frontendPort, apiPort]);
  await pause(1000);
  await assert.rejects(fetch(`http://127.0.0.1:${frontendPort}/`, { signal: AbortSignal.timeout(500) }));
  assert.equal((await ready(frontendPort, 20000)).kind, 'frontend');
  assert.match(run.output(), /waiting up to 60 seconds/);
  await fetch(`http://127.0.0.1:${frontendPort}/crash`);
  const [code] = await run.exit;
  assert.equal(code, 7);
  await assert.rejects(fetch(`http://127.0.0.1:${apiPort}/`, { signal: AbortSignal.timeout(500) }));
});

test('a readiness timeout reports the endpoint and stops the owned backend', { timeout: 10000 }, async (t) => {
  const apiPort = await freePort(), frontendPort = await freePort();
  const run = launch({ apiPort, frontendPort }, { DEV_STARTUP_TIMEOUT_MS: '1500', DEV_FIXTURE_START_DELAY_MS: '5000' });
  cleanup(t, run, [frontendPort, apiPort]);
  const [code] = await run.exit;
  assert.equal(code, 1);
  assert.match(run.output(), /Backend did not become ready within 1.5 seconds/);
  assert.ok(run.output().includes(`http://127.0.0.1:${apiPort}/api/ready`));
  assert.match(run.output(), /npm run server/);
  assert.doesNotMatch(run.output(), /fixture frontend ready/);
  await assert.rejects(fetch(`http://127.0.0.1:${apiPort}/`, { signal: AbortSignal.timeout(500) }));
});

test('an unsuccessful readiness HTTP status cannot start the frontend', { timeout: 10000 }, async (t) => {
  const apiPort = await freePort(), frontendPort = await freePort();
  const run = launch({ apiPort, frontendPort, startupTimeoutMs: 2000 }, { DEV_FIXTURE_READY_STATUS: '503' });
  cleanup(t, run, [frontendPort, apiPort]);
  const [code] = await run.exit;
  assert.equal(code, 1);
  assert.match(run.output(), /HTTP 503/);
  assert.doesNotMatch(run.output(), /fixture frontend ready/);
  await assert.rejects(fetch(`http://127.0.0.1:${apiPort}/`, { signal: AbortSignal.timeout(500) }));
});

test('a backend startup crash surfaces its error without waiting for the deadline', { timeout: 10000 }, async (t) => {
  const apiPort = await freePort(), frontendPort = await freePort();
  const run = launch({ apiPort, frontendPort, backendFile: path.join(__dirname, 'fixtures/missing-backend.cjs') });
  cleanup(t, run, [frontendPort, apiPort]);
  const [code] = await run.exit;
  assert.equal(code, 1);
  assert.match(run.output(), /MODULE_NOT_FOUND/);
  assert.doesNotMatch(run.output(), /Backend did not become ready|fixture frontend ready/);
});

test('occupied frontend port fails before starting another backend', { timeout: 10000 }, async (t) => {
  const occupied = net.createServer(); occupied.listen(0); await once(occupied, 'listening');
  t.after(() => new Promise((resolve) => occupied.close(resolve)));
  const apiPort = await freePort();
  const run = launch({ apiPort, frontendPort: occupied.address().port });
  const [code] = await run.exit;
  assert.equal(code, 1); assert.match(run.output(), /already in use/);
  assert.doesNotMatch(run.output(), /fixture .* ready/);
  await assert.rejects(fetch(`http://127.0.0.1:${apiPort}/`, { signal: AbortSignal.timeout(500) }));
});
