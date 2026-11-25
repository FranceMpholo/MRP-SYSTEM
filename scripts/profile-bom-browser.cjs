// Read-only live BOM profiling. Requires a NEW isolated Edge profile on CDP
// 9250 and the existing Vite server. ERP bodies stay in ignored diagnostics.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const stage = process.argv[2];
assert.ok(['before', 'after'].includes(stage));
const output = path.resolve(__dirname, '../diagnostics/bom-performance');
const origin = 'http://127.0.0.1:5173';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

(async () => {
  // Match the combined development launcher's readiness gate. A measurement
  // must not accidentally include a still-starting diagnostic launcher.
  for (let attempt = 0; ; attempt++) {
    try { const response = await fetch('http://127.0.0.1:3001/api/ready', { signal: AbortSignal.timeout(1000) }); if (response.ok) break; } catch {}
    if (attempt >= 100) throw Error('Local backend did not become ready.');
    await pause(100);
  }
  const tabs = await (await fetch('http://127.0.0.1:9250/json')).json();
  const socket = new WebSocket(tabs.find((tab) => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  let id = 0, phase = 'startup'; const pending = new Map(), network = [], errors = [];
  const call = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const item = pending.get(message.id); pending.delete(message.id); if (message.error) item.reject(message.error); else item.resolve(message.result); return; }
    const p = message.params;
    if (message.method === 'Fetch.requestPaused') {
      void call('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 503,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify({ success: false, code: 'SYSPRO_QUERY', error: 'Synthetic failed refresh; previous snapshot is stale.', retryable: false })).toString('base64') });
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails);
    if (message.method === 'Network.requestWillBeSent' && new URL(p.request.url).pathname === '/api/syspro/bom') network.push({ phase, id: p.requestId, started: p.timestamp, method: p.request.method });
    const request = network.find((r) => r.id === p?.requestId);
    if (!request) return;
    if (message.method === 'Network.responseReceived') Object.assign(request, { headersAt: p.timestamp, status: p.response.status, headers: p.response.headers });
    if (message.method === 'Network.loadingFinished') Object.assign(request, { finishedAt: p.timestamp, transferredBytes: p.encodedDataLength });
    if (message.method === 'Network.loadingFailed') Object.assign(request, { failedAt: p.timestamp, error: p.errorText, cancelled: p.canceled });
  });
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value;
  };
  const until = async (expression, timeoutMs = 130000) => {
    const start = Date.now(); while (Date.now() - start < timeoutMs) { if (await evaluate(expression)) return; await pause(100); }
    throw Error(`Timed out: ${expression}`);
  };
  await call('Page.enable'); await call('Runtime.enable');
  await call('Network.enable', { maxTotalBufferSize: 100000000, maxResourceBufferSize: 50000000 });
  await call('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  const planner = stage === 'after' ? JSON.parse(fs.readFileSync(path.join(output, 'before-planner.json'), 'utf8')) : null;
  const injection = await call('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.origin===${JSON.stringify(origin)}){
    if(localStorage.getItem('mrp-data')!==null)throw Error('Fresh isolated profile required; existing planner data will not be replaced.');
    localStorage.setItem('mrp-auth-users-v1',JSON.stringify([{id:'BOM-PROFILE',username:'synthetic',fullName:'Isolated BOM Timing',role:'ADMIN',isActive:true}]));
    localStorage.setItem('mrp-auth-session-v1',JSON.stringify({userId:'BOM-PROFILE'}));
    ${planner ? `localStorage.setItem('mrp-data',${JSON.stringify(JSON.stringify(planner))});` : ''}
    window.__bomPhase='startup';window.__bomEvents=[];window.__bomLongTasks=[];
    new PerformanceObserver(list=>window.__bomLongTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
    const check=()=>{const event=window.__bomEvents.findLast(e=>e.parseEnd&&!e.uiReady);if(event&&document.querySelector('.bom-explorer .mrp-btn-primary')?.disabled===false){event.uiReady=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>event.painted=performance.now()));}};
    new MutationObserver(check).observe(document,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['disabled']});
    const original=window.fetch;
    window.fetch=async(...args)=>{const url=String(args[0]);if(!url.endsWith('/api/syspro/bom'))return original(...args);
      const event={phase:window.__bomPhase,start:performance.now()};window.__bomEvents.push(event);
      try{const response=await original(...args);event.headersAt=performance.now();event.status=response.status;
        response.json=async()=>{const text=await response.text();event.readEnd=performance.now();const payload=JSON.parse(text);event.parseEnd=performance.now();event.rows=payload.count;window.__lastBomPayload=payload;return payload;};return response;
      }catch(error){event.error=error.name;throw error;}
    };
  }` });
  await call('Page.navigate', { url: origin });
  await until("document.querySelector('[aria-label=Workspace]')!==null", 20000);
  await evaluate(`([...document.querySelectorAll('.planner-sidebar button')].find(b=>b.textContent.trim()==='Bill of Materials')).click()`);
  const results = [];
  for (const current of ['startup', 'manual']) {
    phase = current;
    if (current === 'manual') {
      await evaluate(`window.__bomPhase='manual';document.querySelector('.bom-explorer .mrp-btn-primary').click()`);
    }
    await until(`window.__bomEvents.some(e=>e.phase==='${current}'&&e.painted)`);
    const requests = network.filter((r) => r.phase === current);
    assert.equal(requests.length, 1, `${current}: one BOM request, no duplicate or slow-request retry`);
    const request = requests[0]; assert.equal(request.status, 200);
    const response = await call('Network.getResponseBody', { requestId: request.id });
    const body = response.base64Encoded ? Buffer.from(response.body, 'base64') : Buffer.from(response.body);
    const payload = JSON.parse(body);
    fs.writeFileSync(path.join(output, `${stage}-${current}-response.json`), body);
    const browser = await evaluate(`window.__bomEvents.find(e=>e.phase==='${current}'&&e.painted)`);
    const validation = await evaluate(`(async()=>{const {inspectBom}=await import('/src/bom/bomValidation.js');const rows=window.__lastBomPayload.data;const start=performance.now();const context=inspectBom(rows);const ms=performance.now()-start;const warnings=JSON.stringify({global:context.globalIssues,parents:[...context.parentIssues],lines:rows.map(r=>context.lineIssues.get(r))});const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(warnings));return {ms,globalWarnings:context.globalIssues.length,parentWarnings:[...context.parentIssues.values()].reduce((n,a)=>n+a.length,0),lineWarnings:[...context.lineIssues.values()].reduce((n,a)=>n+a.length,0),warningsSha256:[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')};})()`);
    const timing = {
      phase: current, requestCount: requests.length, rows: payload.count, bytes: body.length, dataSha256: hash(JSON.stringify(payload.data)), fetchedAt: payload.fetchedAt,
      serverTiming: request.headers['Server-Timing'] || request.headers['server-timing'], profileId: request.headers['X-BOM-Profile-Id'] || request.headers['x-bom-profile-id'],
      totalNetworkMs: (request.finishedAt - request.started) * 1000, ttfbMs: (request.headersAt - request.started) * 1000,
      transferMs: (request.finishedAt - request.headersAt) * 1000, browserBodyReadMs: browser.readEnd - browser.headersAt,
      jsonParseMs: browser.parseEnd - browser.readEnd, browserProcessingToReadyMs: browser.uiReady - browser.parseEnd,
      browserProcessingToPaintMs: browser.painted - browser.parseEnd, browserFetchToPaintMs: browser.painted - browser.start, validation,
    };
    results.push(timing); console.log(JSON.stringify({ stage, ...timing }, null, 2));
    fs.writeFileSync(path.join(output, `${stage}-browser.json`), JSON.stringify({ results, errors, requests: network }, null, 2));
  }
  let staleRefresh;
  if (stage === 'after') {
    const prior = await evaluate(`({timestamp:document.querySelector('.bom-explorer > div p').innerText,parents:document.querySelectorAll('.bom-explorer > div:last-child > div').length})`);
    await call('Fetch.enable', { patterns: [{ urlPattern: `${origin}/api/syspro/bom`, requestStage: 'Request' }] });
    phase = 'failed-refresh-fixture';
    await evaluate("window.__bomPhase='failed-refresh-fixture';document.querySelector('.bom-explorer .mrp-btn-primary').click()");
    await until(`document.querySelector('.bom-explorer')?.innerText.includes('previous snapshot is shown for inspection only')`, 10000);
    const stale = await evaluate(`({timestamp:document.querySelector('.bom-explorer > div p').innerText,parents:document.querySelectorAll('.bom-explorer > div:last-child > div').length,warning:document.querySelector('.bom-explorer [role=status]').innerText})`);
    assert.equal(stale.timestamp, prior.timestamp); assert.equal(stale.parents, prior.parents); assert.ok(stale.parents > 0);
    assert.match(stale.warning, /dependent calculations are incomplete/);
    staleRefresh = { fixtureOnly: true, retainedTimestamp: true, retainedParentCount: stale.parents, explicitlyStale: true, incompleteCalculations: true };
    // Keep interception enabled through teardown; the stable synthetic query
    // error schedules no retries and cannot contact SYSPRO.
  }
  fs.writeFileSync(path.join(output, `${stage}-browser.json`), JSON.stringify({ results, errors, requests: network, staleRefresh }, null, 2));
  const saved = await evaluate("JSON.parse(localStorage.getItem('mrp-data'))");
  if (stage === 'before') fs.writeFileSync(path.join(output, 'before-planner.json'), JSON.stringify(saved));
  else for (const key of ['items', 'demands', 'openOrders', 'planningWeeks', 'productionActuals', 'cycleCountDays']) assert.deepEqual(saved[key], planner[key]);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier });
  socket.close();
})().catch((error) => { console.error(error); process.exit(1); });
