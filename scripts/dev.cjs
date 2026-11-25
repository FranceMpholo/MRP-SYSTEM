// Own only the child processes started here; never stop an existing dev server.
require('../server/loadEnv');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const configuredStartupTimeout = Number(process.env.DEV_STARTUP_TIMEOUT_MS);
const defaultStartupTimeoutMs = Number.isFinite(configuredStartupTimeout) && configuredStartupTimeout > 0
  ? configuredStartupTimeout : 60000;

function ensureFree(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(new Error(`Port ${port} is already in use. Use the existing development session or stop it in its own terminal before npm run dev.`)));
    probe.listen(port, () => probe.close(resolve));
  });
}

async function main({ apiPort = Number(process.env.PORT) || 3001, frontendPort = 5173,
  startupTimeoutMs = defaultStartupTimeoutMs,
  backendFile = path.join(root, 'server/server.js'), frontendFile = path.join(root, 'mrp-planner/node_modules/vite/bin/vite.js') } = {}) {
  if (!Number.isFinite(startupTimeoutMs) || startupTimeoutMs <= 0) throw new Error('Backend startup timeout must be a positive number of milliseconds.');
  await Promise.all([ensureFree(apiPort), ensureFree(frontendPort)]);
  const children = new Set();
  let stopping = false;
  const stop = (code) => {
    if (stopping) return;
    stopping = true; process.exitCode = code;
    for (const child of children) child.kill();
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop(0));
  function launch(file, args, cwd) {
    const child = spawn(process.execPath, [file, ...args], { cwd, stdio: 'inherit', env: { ...process.env, PORT: String(apiPort) }, windowsHide: true });
    children.add(child);
    child.once('error', (error) => { console.error('Development startup failed:', error.code); stop(1); });
    child.once('exit', (code) => { children.delete(child); if (!stopping) stop(code || 1); });
  }
  const readinessUrl = `http://127.0.0.1:${apiPort}/api/ready`;
  console.log(`Starting backend; waiting up to ${startupTimeoutMs / 1000} seconds for ${readinessUrl} ...`);
  launch(backendFile, [], root);
  const deadline = Date.now() + startupTimeoutMs;
  let ready = false;
  let lastReadinessError = 'No response received';
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch(readinessUrl, { signal: AbortSignal.timeout(Math.max(1, Math.min(1000, deadline - Date.now()))) });
      if (!response.ok) lastReadinessError = `HTTP ${response.status}`;
      else if ((await response.json()).service === 'mrp-syspro-api') { ready = true; break; }
      else lastReadinessError = 'Unexpected service at the readiness endpoint';
    } catch (error) { lastReadinessError = error.cause?.code || error.code || error.name; }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(100, deadline - Date.now()))));
  }
  if (stopping) return;
  if (!ready) {
    console.error(`Backend did not become ready within ${startupTimeoutMs / 1000} seconds (${readinessUrl}: ${lastReadinessError}).`);
    console.error('Run "npm run server" to inspect backend startup directly. For a slow cold start, increase DEV_STARTUP_TIMEOUT_MS in the root .env.');
    stop(1); return;
  }
  launch(frontendFile, ['--port', String(frontendPort), '--strictPort'], path.join(root, 'mrp-planner'));
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { ensureFree, main };
