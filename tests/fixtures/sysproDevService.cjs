// Disposable HTTP process used only by dev-launcher tests. No database modules.
const portIndex = process.argv.indexOf('--port');
const kind = portIndex < 0 ? 'backend' : 'frontend';
const port = Number(portIndex < 0 ? process.env.PORT : process.argv[portIndex + 1]);
const server = require('node:http').createServer((request, response) => {
  response.statusCode = kind === 'backend' ? Number(process.env.DEV_FIXTURE_READY_STATUS) || 200 : 200;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ service: 'mrp-syspro-api', fixture: true, kind }));
  if (request.url === '/crash') setTimeout(() => process.exit(7), 10);
});
const delayMs = kind === 'backend' ? Number(process.env.DEV_FIXTURE_START_DELAY_MS) || 0 : 0;
setTimeout(() => server.listen(port, '127.0.0.1', () => console.log(`fixture ${kind} ready`)), delayMs);
