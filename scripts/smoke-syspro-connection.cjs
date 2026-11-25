// Requires a NEW isolated headless browser on CDP port 9247. All failure
// simulations are intercepted browser responses; company services stay intact.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const tabs = await (await fetch('http://127.0.0.1:9247/json')).json();
  const page = tabs.find((tab) => tab.type === 'page');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  let id = 0, mode = 'hold', inventoryCalls = 0;
  const pending = new Map(), held = [], exceptions = [], writes = [];
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params }));
  });
  const stock = [{ StockCode: 'SYNTHETIC-STOCK', Description: 'Synthetic stock', StockUom: 'EA', B_WIP01_SOH: 5, B_RAW01_SOH: 7 }];
  const fulfill = (requestId, payload, status = 200) => call('Fetch.fulfillRequest', { requestId, responseCode: status,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(payload)).toString('base64') });
  async function respond(event) {
    const { requestId, request } = event;
    const path = new URL(request.url).pathname;
    if (!['GET', 'HEAD'].includes(request.method)) writes.push({ method: request.method, path });
    if (path === '/api/syspro/inventory') inventoryCalls++;
    if (mode === 'hold' && ['/api/syspro/inventory', '/api/syspro/bom'].includes(path)) { held.push(event); return; }
    if (path === '/api/syspro/inventory' && mode === 'backend') return fulfill(requestId, null, 500);
    if (path === '/api/syspro/inventory' && ['dns', 'auth'].includes(mode)) return fulfill(requestId,
      { success: false, code: mode === 'dns' ? 'SYSPRO_DNS' : 'SYSPRO_AUTH', error: mode === 'dns' ? 'Check corporate VPN/DNS.' : 'Ask IT to verify approved SQL credentials.', retryable: mode === 'dns' }, 503);
    if (path === '/api/syspro/bom' && mode === 'bom-query') return fulfill(requestId,
      { success: false, code: 'SYSPRO_QUERY', error: 'Check database SELECT permissions.', retryable: false }, 503);
    return fulfill(requestId, { success: true, data: path === '/api/syspro/inventory' ? stock : [], fetchedAt: '2026-11-18T10:00:00Z', source: `synthetic ${path.endsWith('/bom') ? 'BOM' : 'inventory'}` });
  }
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const item = pending.get(message.id); pending.delete(message.id); if (message.error) item.reject(message.error); else item.resolve(message.result); return; }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    if (message.method === 'Fetch.requestPaused') respond(message.params).catch((error) => exceptions.push(error));
  });
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression, attempts = 160) => {
    for (let i = 0; i < attempts; i++) { if (await evaluate(expression)) return; await pause(100); }
    throw Error(`Timed out: ${expression}; screen: ${await evaluate('document.body.innerText.slice(-4000)')}; exceptions: ${JSON.stringify(exceptions)}`);
  };
  const click = (text) => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}); if(!b)throw Error('Missing button '+${JSON.stringify(text)}); b.click()})()`);
  const connected = `document.querySelector('.planner-toolbar-status.syspro-connected')!==null`;
  const offline = `document.querySelector('.planner-toolbar-status.syspro-offline')!==null`;
  await call('Runtime.enable'); await call('Page.enable');
  await call('Fetch.enable', { patterns: [{ urlPattern: 'http://localhost:5173/api/*', requestStage: 'Request' }] });
  const seed = await call('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.origin==='http://localhost:5173'){
    if(localStorage.getItem('mrp-data')!==null)throw Error('Fresh isolated profile required; refusing to replace planner data.');
    localStorage.setItem('mrp-data',JSON.stringify({items:[{id:'KEEP-ITEM',code:'SYNTHETIC-STOCK',onHand:0,uom:'EA'}],demands:[{id:'KEEP-DEMAND',itemId:'KEEP-ITEM',qty:10,dueDate:'2026-11-18'}],openOrders:[],activeWeekStart:'2026-11-16',selectedProductionLine:'blowMoulding',planningWeeks:{'2026-11-16':{weekStart:'2026-11-16',entries:[]}},productionActuals:[],cycleCountDays:[]}));
    localStorage.setItem('mrp-auth-users-v1',JSON.stringify([{id:'CONNECTION-SMOKE',username:'synthetic',fullName:'Synthetic Connection Reviewer',role:'ADMIN',isActive:true}]));
    localStorage.setItem('mrp-auth-session-v1',JSON.stringify({userId:'CONNECTION-SMOKE'}));
  }` });
  await call('Page.navigate', { url: 'http://localhost:5173' });
  await until(`document.querySelector('.planner-toolbar-status.syspro-checking')!==null`);
  assert.ok(!(await evaluate(`document.querySelector('.planner-toolbar').innerText.includes('Offline')`)));
  mode = 'ok'; for (const event of held.splice(0)) await respond(event);
  await until(connected);
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: seed.identifier });
  await call('Page.reload'); await pause(500); await until(connected);
  await click('Data');
  mode = 'backend'; await click('Refresh SYSPRO stock'); await until(offline);
  assert.ok(await evaluate(`document.querySelector('#data-connection-menu').innerText.includes('Backend unavailable')`));
  assert.ok(await evaluate(`document.querySelector('#data-connection-menu').innerText.includes('Stale snapshot')&&document.querySelector('#data-connection-menu').innerText.includes('synthetic inventory')`));
  await click('Items');
  await until(`document.querySelector('main')?.innerText.includes('For inspection only') || document.body.innerText.includes('For inspection only')`);
  assert.ok(await evaluate(`document.body.innerText.includes('SYNTHETIC-STOCK')`));
  mode = 'ok'; await until(connected);
  // Open Data if navigation dismissed it.
  if (!(await evaluate(`!!document.querySelector('#data-connection-menu')`))) await click('Data');
  mode = 'dns'; await click('Refresh SYSPRO stock'); await until(offline);
  assert.ok(await evaluate(`document.querySelector('#data-connection-menu').innerText.includes('VPN/DNS')`));
  mode = 'ok'; await until(connected);
  mode = 'auth'; await click('Refresh SYSPRO stock'); await until(offline);
  const count = inventoryCalls; await pause(1700); assert.equal(inventoryCalls, count, 'Authentication must not automatically retry');
  mode = 'ok'; await click('Retry connection'); await until(connected);
  await click('Bill of Materials');
  mode = 'bom-query'; await click('Refresh');
  await until(`document.querySelector('.bom-explorer')?.innerText.includes('SELECT permissions')`);
  assert.ok(await evaluate(connected), 'One failed BOM endpoint must not mark stock offline');
  mode = 'ok'; await click('Refresh');
  await until(`document.querySelector('.bom-explorer')?.innerText.includes('connected, empty snapshot')`);
  assert.ok(!(await evaluate(`document.querySelector('.bom-explorer').innerText.includes('SELECT permissions')`)));
  await evaluate(`window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('focus'))`);
  await until(connected);
  const saved = await evaluate(`JSON.parse(localStorage.getItem('mrp-data'))`);
  assert.equal(saved.items[0].id, 'KEEP-ITEM'); assert.equal(saved.demands[0].id, 'KEEP-DEMAND');
  assert.equal(writes.length, 0, JSON.stringify(writes)); assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  const screenshot = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('diagnostics/syspro-connectivity/browser-fixtures.png', Buffer.from(screenshot.data, 'base64'));
  await call('Fetch.disable');
  // Real read-only browser reload through the existing Vite proxy. No fixture data
  // is sent to the API, and the isolated browser's saved records remain local.
  await call('Page.reload'); await pause(500); await until(connected);
  await click('Data');
  const real = await evaluate(`document.querySelector('#data-connection-menu').innerText`);
  console.log(JSON.stringify({ browser: 'passed', scenarios: ['cold start', 'reload', 'backend restored', 'SQL DNS restored', 'stable authentication error', 'manual retry', 'stale snapshot', 'independent BOM failure', 'error cleared', 'focus/online', 'preserved local records'], liveBrowser: real, writes: writes.length, exceptions: exceptions.length }, null, 2));
  socket.close();
})().catch((error) => { console.error(error); process.exit(1); });
