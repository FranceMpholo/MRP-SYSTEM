// Isolated browser acceptance: all API data is synthetic; operator data is untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'diagnostics/cycle-count-movements');
const origin = 'http://127.0.0.1:5178', debug = 'http://127.0.0.1:9240';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const codes = ['120002', '121047', '120003'];
const rules = { 'SHIFT 01': { start: '05:30', end: '14:30' }, 'SHIFT 02': { start: '14:30', end: '21:30' }, 'SHIFT 03': { start: '21:30', end: '05:30' } };
async function free(port) { await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(port, '127.0.0.1', () => probe.close(resolve)); }); }
async function waitJson(url) { for (let n = 0; n < 200; n++) { try { const response = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (response.ok) return await response.json(); } catch {} await pause(100); } throw new Error(`Unavailable: ${url}`); }

(async () => {
  await Promise.all([free(5178), free(9240)]); fs.mkdirSync(out, { recursive: true });
  const vite = spawn(process.execPath, [path.join(root, 'mrp-planner/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5178', '--strictPort'], { cwd: path.join(root, 'mrp-planner'), windowsHide: true, stdio: 'ignore' });
  const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--remote-debugging-port=9240', `--user-data-dir=${path.join(out, `edge-profile-${Date.now()}`)}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let socket, call;
  try {
    socket = new WebSocket((await waitJson(`${debug}/json`)).find((tab) => tab.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
    let id = 0, responseMode = 'normal', requestDelay = 500;
    const pending = new Map(), errors = [], requests = [], checks = [];
    call = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params })); });
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) { const item = pending.get(message.id); pending.delete(message.id); if (message.error) item.reject(new Error(JSON.stringify(message.error))); else item.resolve(message.result); return; }
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
      if (message.method !== 'Fetch.requestPaused') return;
      const { request, requestId } = message.params;
      (async () => {
        if (!request.url.startsWith(`${origin}/api/`)) return call(request.url.startsWith(origin) ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId, ...(request.url.startsWith(origin) ? {} : { errorReason: 'BlockedByClient' }) });
        assert.equal(request.method, 'GET'); requests.push(request.url);
        const url = new URL(request.url), date = url.searchParams.get('date'), shift = url.searchParams.get('shift');
        const mode = responseMode, delay = requestDelay;
        let payload = { success: true, data: [] }, responseCode = 200;
        if (url.pathname.endsWith('/inventory')) {
          payload.data = codes.map((StockCode) => ({ StockCode, Description: 'Synthetic required sheet', StockUom: 'EA', B_WIP01_SOH: 900 }));
          if (mode === 'outage') { payload = { success: false, code: 'SYSPRO_TIMEOUT', error: 'Synthetic inventory timeout', retryable: true }; responseCode = 503; }
        }
        if (url.pathname.endsWith('/eos')) {
          payload.data = codes.flatMap((stockCode) => ['morning', 'afternoon', 'night'].map((shift) => ({ stockCode, productionDate: date, shift, warehouse: 'B-WIP01', expectedEosSoh: 100, status: 'available' })));
          if (mode === 'outage') { payload = { success: false, error: 'Synthetic EOS outage' }; responseCode = 503; }
        }
        if (url.pathname.endsWith('/movements')) {
          const index = ['morning', 'afternoon', 'night'].indexOf(shift);
          payload.data = codes.map((stockCode, n) => ({ stockCode, productionDate: date, shift, warehouse: 'B-WIP01', uom: 'EA',
            startAt: `${date}T${url.searchParams.get('start')}:00+02:00`, endAt: `${date}T${url.searchParams.get('end')}:00+02:00`,
            qtyReceived: { status: mode === 'no-time' ? 'unavailable_by_shift' : 'available', quantity: mode === 'no-time' ? null : mode === 'zero' || n === 2 ? 0 : (date === '2026-11-18' ? 100 : 200) + index * 10 + n, reason: 'No verified transaction time' },
            totalIssue: { status: mode === 'no-time' ? 'unavailable_by_shift' : 'available', quantity: mode === 'no-time' ? null : mode === 'zero' ? 0 : 5 + index * 10 + n, reason: 'No verified transaction time' } }));
          if (mode === 'outage') { payload = { success: false, code: 'SYSPRO_TIMEOUT', error: 'Synthetic journal timeout', retryable: true }; responseCode = 503; }
          await pause(delay);
        }
        await call('Fetch.fulfillRequest', { requestId, responseCode, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(payload)).toString('base64') });
      })().catch((error) => { if (!/Invalid InterceptionId|Invalid interceptionId|Invalid parameters|Target closed/.test(error.message)) errors.push(error.message); });
    });
    const evaluate = async (expression) => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
    const until = async (expression) => { for (let n = 0; n < 200; n++) { if (await evaluate(expression)) return; await pause(100); } throw new Error(`Timed out: ${expression}`); };
    const click = async (text) => { await evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(text)});if(!button||button.disabled)throw Error('Missing/disabled button '+${JSON.stringify(text)});button.click()})()`); await pause(35); };
    const input = async (selector, value) => { await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)throw Error('Missing/disabled input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`); await pause(35); };
    const cell = (metric) => `document.querySelector('.cc-entry tbody tr [data-movement="${metric}"]')?.textContent`;
    const seed = { items: [], demands: [], openOrders: [], planningWeeks: {}, activeWeekStart: '2026-11-16', selectedProductionLine: 'thermoforming', cycleCountDays: [], oeeSettings: { thermoforming: rules } };
    await call('Runtime.enable'); await call('Page.enable');
    await call('Emulation.setDeviceMetricsOverride', { width: 1700, height: 1100, deviceScaleFactor: 1, mobile: false });
    await call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    const injection = await call('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.origin===${JSON.stringify(origin)}){localStorage.clear();localStorage.setItem('mrp-auth-users-v1',JSON.stringify([{id:'TEST-COUNT',username:'test-count',fullName:'Synthetic Operator',role:'ADMIN',isActive:true}]));localStorage.setItem('mrp-auth-session-v1',JSON.stringify({userId:'TEST-COUNT'}));localStorage.setItem('mrp-data',${JSON.stringify(JSON.stringify(seed))});}` });
    await call('Page.navigate', { url: origin }); await until(`document.querySelector('[aria-label="Workspace"]')!==null`);
    await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier });
    await click('Cycle Count'); await until(`document.querySelectorAll('.cc-entry tbody tr').length===3`);
    await input('.cc-header input[type="date"]', '2026-11-18');
    assert.equal(await evaluate(cell('qtyReceived')), 'Loading');
    await until(`${cell('qtyReceived')}==='100'`);
    assert.equal(await evaluate(`[...document.querySelectorAll('.cc-entry th')].slice(5,8).map(el=>el.textContent).join('|')`), 'Physical Count|Qty Received|Total Issue');
    assert.equal(await evaluate(`document.querySelectorAll('.cc-entry input[aria-label^="Physical count"]').length`), 3);
    assert.equal(await evaluate(`document.querySelectorAll('.cc-entry [data-movement] input').length`), 0);
    assert.equal(await evaluate(`document.querySelectorAll('.cc-entry tbody tr')[2].querySelector('[data-movement="qtyReceived"]').textContent`), '0');
    assert.ok(requests.some((url) => url.includes('/movements?') && url.includes('start=05%3A30') && url.includes('end=14%3A30')));
    checks.push('Read-only adjacent columns; Loading, genuine zero and configured times');
    await click('Afternoon'); await until(`${cell('qtyReceived')}==='110'`); assert.equal(await evaluate(cell('totalIssue')), '15');
    await click('Night'); await until(`${cell('qtyReceived')}==='120'`); assert.equal(await evaluate(cell('totalIssue')), '25');
    assert.ok(await evaluate(`document.querySelector('.cc-movement-source').innerText.includes('21:30–05:30 next day')`));
    requestDelay = 900; await click('Morning'); await pause(50); requestDelay = 50; await click('Night');
    await until(`${cell('qtyReceived')}==='120'`); await pause(1100); assert.equal(await evaluate(cell('qtyReceived')), '120');
    await input('.cc-header input[type="date"]', '2026-11-19'); await until(`${cell('qtyReceived')}==='220'`);
    checks.push('Date/shift switching, overnight start-date request and late-response isolation');
    responseMode = 'no-time'; await click('Refresh movements'); await until(`${cell('qtyReceived')}==='Unavailable by shift'`);
    responseMode = 'zero'; await click('Refresh movements'); await until(`${cell('qtyReceived')}==='0'`); assert.equal(await evaluate(cell('totalIssue')), '0');
    checks.push('Unavailable by shift, successful empty result and retry');
    responseMode = 'outage'; await click('Refresh movements'); await click('Refresh EOS'); await until(`${cell('qtyReceived')}==='Unavailable'`);
    for (const [index, code] of codes.entries()) await input(`[aria-label="Physical count ${code}"]`, String([0, 2.5, 4.125][index]));
    await until(`!document.querySelector('.cc-submit button').disabled`); await click('Submit Shift Count'); await until(`document.querySelector('.cc-submitted')!==null`);
    await until(`document.querySelector('.planner-toolbar').innerText.includes('Saved')`);
    const stored = await evaluate(`JSON.parse(localStorage.getItem('mrp-data')).cycleCountDays.find(day=>day.date==='2026-11-19')`);
    assert.deepEqual(stored.countRecords.filter((row) => row.shift === 'night').map((row) => row.physicalCount), [0, 2.5, 4.125]);
    assert.ok(stored.countRecords.every((row) => !('qtyReceived' in row) && !('totalIssue' in row)));
    checks.push('Physical zero/decimal entry and submission during movement/EOS outage; totals never persisted');
    responseMode = 'normal'; await click('Daily Summary'); await until(`document.querySelectorAll('.cc-summary [data-movement]').length===18`);
    await until(`![...document.querySelectorAll('.cc-summary [data-movement]')].some(el=>el.textContent==='Loading')`);
    const screenshot = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, 'summary.png'), Buffer.from(screenshot.data, 'base64'));
    responseMode = 'outage';
    await call('Page.reload'); await until(`document.querySelector('[aria-label="Workspace"]')!==null`); await click('Cycle Count');
    await input('.cc-header input[type="date"]', '2026-11-19'); await click('Night'); await until(`document.querySelector('.cc-submitted')!==null`);
    assert.equal(await evaluate(`document.querySelector('[aria-label="Physical count 120002"]').value`), '0');
    assert.equal(await evaluate(`document.querySelector('[aria-label="Physical count 120002"]').disabled`), true);
    checks.push('All three shifts in daily summary; submitted counts survive reload');
    await input('.cc-header input[type="date"]', '2026-11-20');
    await until(`${cell('qtyReceived')}==='Unavailable'`);
    for (const code of codes) await input(`[aria-label="Physical count ${code}"]`, '0');
    await until(`!document.querySelector('.cc-submit button').disabled`); await click('Submit Shift Count'); await until(`document.querySelector('.cc-submitted')!==null`);
    checks.push('Cold reload with inventory, EOS and movement feeds all unavailable still allows a new shift count');
    assert.equal(errors.length, 0, JSON.stringify(errors));
    fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify({ synthetic: true, checks, requests, errors }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
  } finally {
    if (call && socket?.readyState === WebSocket.OPEN) { await call('Browser.close').catch(() => {}); socket.close(); }
    browser.kill(); vite.kill();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
