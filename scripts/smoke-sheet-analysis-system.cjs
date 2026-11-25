// Disposable browser and synthetic APIs; never touches the operator's profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { configuredWindows, normalizePostings } = require('../server/services/sheetAnalysisSystem');
const { deriveTailgates } = require('../server/services/tailgateBackflush');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'diagnostics/sheet-analysis-system');
const origin = process.env.SHEET_ANALYSIS_ORIGIN || 'http://127.0.0.1:5179', debug = 'http://127.0.0.1:9241';
assert.ok(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin), 'Browser acceptance must use a local app');
const liveAcceptance = process.env.SHEET_ANALYSIS_LIVE === '1';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const codes = ['120002', '121047', '120003'], ids = ['morning', 'afternoon', 'night'];
const dc = 'N1WB-E40726-DC', cj = 'N1WB-E40726-CJ', rap = 'N1WB-E40726-CJ-RAP', bed = 'N1WB-E12606-SCP';
const rules = { 'SHIFT 01': { start: '05:30', end: '14:30' }, 'SHIFT 02': { start: '14:30', end: '21:30' }, 'SHIFT 03': { start: '21:30', end: '05:30' } };
const line = (parentStockCode, componentStockCode, extra = {}) => ({ parentStockCode, parentDescription: parentStockCode === bed ? 'Bedliner test' : 'Tailgate test', componentStockCode, qtyPer: 0.25, parentUom: 'EA', componentUom: 'Pcs', factorUnitsVerified: true, qtyPerBasis: 'stocking', ...extra });
const boms = [line(dc, '120002'), line(cj, '120002'), line(cj, rap, { qtyPer: 1, componentUom: 'EA', route: '2' }), line(rap, '120003'), line(bed, '120002', { qtyPer: 0.75 }), line(bed, bed, { qtyPer: 1, componentUom: 'EA' })];
const inventory = [...codes.map((StockCode) => ({ StockCode, Description: 'Synthetic sheet', StockUom: 'Pcs', B_WIP01_SOH: 999 })), ...[dc, cj, rap, bed].map((StockCode) => ({ StockCode, Description: StockCode === bed ? 'Bedliner test' : 'Tailgate test', StockUom: 'EA' }))];
const day = (date, draft = false) => ({ id: date, date, productionLine: 'thermoforming', warehouse: 'B-WIP01', items: codes.map((stockCode) => ({ stockCode, uom: 'Pcs' })),
  shifts: ids.map((shift) => ({ shift, submittedAt: draft && shift === 'night' ? null : '2026-11-19T04:00:00Z' })),
  countRecords: ids.flatMap((shift, i) => codes.map((stockCode, n) => ({ id: `${date}-${shift}-${stockCode}`, cycleCountDayId: date, productionDate: date, productionLine: 'thermoforming', stockCode, shift, warehouse: 'B-WIP01', location: null,
    physicalCount: n === 0 ? 0 : i * 3 + n, countedAt: '2026-11-19T03:50:00Z', countedByUserId: 'SHEET-TEST' }))) });
function payload(date, shifts, mode) {
  const windows = configuredWindows(date, shifts);
  const next = windows.find((window) => window.shift === 'night').endLocal.slice(0, 10);
  const fg = (stockCode, qty, trnTime, extra = {}) => ({ stockCode, description: stockCode === bed ? 'Lnr test Bedliner' : 'Tailgate test', stockUom: 'EA', warehouse: 'B-FIN01', newWarehouse: '', entryDate: date, trnTime,
    trnYear: 2027, trnMonth: 8, journal: 1, journalEntry: trnTime, movementType: 'I', trnType: 'T', trnQty: qty, journalType: 'T', journalQty: qty, journalUom: 'EA', transferFlag: 'I', sourceWarehouseMin: 'B-WIP01', sourceWarehouseMax: 'B-WIP01', ...extra });
  const postings = [fg(dc, 8, 14400000), fg(bed, 20, 16000000), fg(rap, 4, 5295999, { entryDate: next })];
  if (mode !== 'scrap-zero') for (const [i, stockCode] of codes.entries()) {
    const destination = stockCode === '121047' ? 'B-SCR01' : 'B-REG01';
    const transfer = (quantity, trnTime, extra = {}) => fg(stockCode, -quantity, trnTime, { stockUom: 'Pcs', journalUom: 'Pcs',
      warehouse: 'B-WIP01', newWarehouse: destination, transferFlag: 'O', journalQty: quantity, ...extra });
    const outbound = transfer(10 + i, 6000000);
    postings.push(outbound, { ...outbound }, transfer(5, 15000000), transfer(3, 5295999, { entryDate: next }),
      transfer(-2, 17000000), transfer(1, 18000000, { warehouse: destination, newWarehouse: 'B-WIP01' }),
      transfer(100, 19000000, { newWarehouse: destination === 'B-REG01' ? 'B-SCR01' : 'B-REG01' }),
      transfer(100, 5300000, { entryDate: next }));
    if (mode === 'scrap-invalid' && stockCode === '120002') outbound.journalQty = null;
    if (mode === 'scrap-missing-time' && stockCode === '120003') outbound.trnTime = null;
  }
  if (mode === 'ambiguous') postings.push(fg(cj, 7, 17000000));
  if (mode === 'date-only') { postings[0].trnTime = null; postings[2].trnTime = null; }
  return { success: true, date: mode === 'mismatch' ? '2000-01-01' : date, windows, fetchedAt: new Date().toISOString(),
    data: windows.flatMap((window, i) => codes.map((stockCode) => ({ stockCode, productionDate: date, shift: window.shift, warehouse: 'B-WIP01', uom: 'Pcs', startAt: window.startAt, endAt: window.endAt,
      qtyReceived: { status: 'available', quantity: date === '2026-11-18' ? i * 10 : i * 20 }, totalIssue: { status: 'available', quantity: i + 1 } }))),
    stockCoverage: codes.map((stockCode) => ({ stockCode, warehouseExists: true, earliestEntryDate: '2025-01-01' })), movementEvidence: [], postingData: { status: 'connected', rows: normalizePostings(postings, windows) } };
}
function tailgatePayload(date, shifts, mode) {
  const windows = configuredWindows(date, shifts), next = windows.find((window) => window.shift === 'night').endLocal.slice(0, 10);
  const receipt = (stockCode, quantity, sheet, trnTime, journal, extra = {}) => {
    const row = { stockCode, stockUom: 'EA', warehouse: 'B-FIN01', entryDate: date, trnTime, trnYear: 2027, trnMonth: 8,
      journal, journalEntry: 2, movementType: 'I', trnType: 'R', trnQty: quantity, journalType: 'R', journalQty: quantity,
      journalUom: 'EA', journalReference: 'Backflush by TEST', ...extra };
    row.backflushesJson = [{ ...row, journalRowsJson: [{ stockCode: sheet, warehouse: 'B-WIP01', trnType: 'I', movementTrnType: 'I', movementType: 'I',
      trnQty: quantity / 4, journalQty: quantity / 4, stockUom: 'Pcs', journalUom: 'Pcs', trnYear: 2027, trnMonth: 8, journal, journalEntry: 1 }, { ...row }] }];
    return row;
  };
  const dcReceipt = receipt(dc, 8, '120002', mode === 'date-only' ? null : 14000000, 1);
  const receipts = mode === 'tailgate-zero' ? [] : [dcReceipt, structuredClone(dcReceipt), receipt(dc, 2, '120002', 16000000, 2), receipt(dc, -2, '120002', 17000000, 3), receipt(rap, 4, '120003', 5295999, 4, { entryDate: next })];
  if (mode === 'ambiguous') {
    const unresolved = receipt(cj, 7, '120002', 18000000, 5);
    unresolved.backflushesJson[0].journalRowsJson.push({ ...unresolved.backflushesJson[0].journalRowsJson[0], stockCode: '120003', journalEntry: 3 });
    receipts.push(unresolved);
  }
  const result = deriveTailgates({ date, windows, receipts, boms, catalog: [dc, cj, rap].map((stockCode) => ({ stockCode, description: 'Tailgate test' })), coverage: { earliestEntryDate: '2025-01-01' } });
  return { success: true, ...result, data: result.sheets, fetchedAt: new Date().toISOString() };
}
async function free(port) { await new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(port, '127.0.0.1', () => server.close(resolve)); }); }
async function waitJson(url) { for (let n = 0; n < 200; n++) { try { const r = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (r.ok) return await r.json(); } catch {} await pause(100); } throw new Error(`No listener ${url}`); }
(async () => {
  await Promise.all([...(process.env.SHEET_ANALYSIS_ORIGIN ? [] : [free(5179)]), free(9241)]); fs.mkdirSync(out, { recursive: true });
  const vite = process.env.SHEET_ANALYSIS_ORIGIN ? null : spawn(process.execPath, [path.join(root, 'mrp-planner/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5179', '--strictPort'], { cwd: path.join(root, 'mrp-planner'), windowsHide: true, stdio: 'ignore' });
  const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--remote-debugging-port=9241', `--user-data-dir=${path.join(out, `edge-profile-${Date.now()}`)}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let socket, call, liveTailgateServer, liveTailgateBase;
  try {
    socket = new WebSocket((await waitJson(`${debug}/json`)).find((tab) => tab.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
    let id = 0, responseMode = 'normal', delay = 400;
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
        const url = new URL(request.url), mode = responseMode, wait = delay;
        let result = { success: true, data: [] }, responseCode = 200;
        if (url.pathname.endsWith('/inventory')) result.data = inventory;
        if (url.pathname.endsWith('/bom')) result.data = boms;
        if (url.pathname.endsWith('/sheet-analysis/tailgates')) {
          if (mode === 'live') {
            const live = await fetch(liveTailgateBase + url.pathname + url.search);
            result = await live.json(); responseCode = live.status;
          } else {
            result = tailgatePayload(url.searchParams.get('date'), JSON.parse(url.searchParams.get('shifts')), mode);
            if (mode === 'outage' || mode === 'tailgate-outage') { responseCode = 503; result = { success: false, code: 'SYSPRO_TIMEOUT', error: 'Synthetic tailgate lineage outage', retryable: true }; }
            await pause(wait);
          }
        }
        if (url.pathname.endsWith('/sheet-analysis/closing-soh')) {
          const date = url.searchParams.get('date');
          const close = configuredWindows(date, JSON.parse(url.searchParams.get('shifts'))).find((window) => window.shift === 'night');
          result = { success: true, date, data: codes.map((stockCode, i) => ({ stockCode, productionDate: date, warehouse: 'B-WIP01', shift: 'night', status: 'available', quantity: [date === '2026-11-19' ? 890.5 : date === '2026-11-20' ? 903.75 : 0, 98, 132][i], cutoffLocal: close.endLocal, cutoffAt: new Date(close.endAt).toISOString() })) };
          if (mode === 'soh-outage' || mode === 'outage') { responseCode = 503; result = { success: false, code: 'SYSPRO_TIMEOUT', error: 'Synthetic historical SOH outage', retryable: true }; }
          if (mode === 'soh-mismatch') result.data.forEach((row) => { row.cutoffAt = '2000-01-01T00:00:00.000Z'; });
          await pause(wait);
        }
        if (url.pathname.endsWith('/sheet-analysis/system')) {
          if (mode === 'live') return call('Fetch.continueRequest', { requestId });
          result = payload(url.searchParams.get('date'), JSON.parse(url.searchParams.get('shifts')), mode);
          if (mode === 'outage') { responseCode = 503; result = { success: false, code: 'SYSPRO_TIMEOUT', error: 'Synthetic journal outage', retryable: true }; }
          await pause(wait);
        }
        await call('Fetch.fulfillRequest', { requestId, responseCode, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(result)).toString('base64') });
      })().catch((error) => { if (!/Invalid InterceptionId|Invalid interceptionId|Target closed|Invalid parameters/.test(error.message)) errors.push(error.message); });
    });
    const evaluate = async (expression) => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
    const until = async (expression) => { for (let n = 0; n < 200; n++) { if (await evaluate(expression)) return; await pause(100); } throw new Error(`Timed out: ${expression}`); };
    const click = async (selector) => { await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)throw Error('Missing/disabled '+${JSON.stringify(selector)});el.click()})()`); await pause(30); };
    const button = async (root, text) => { await evaluate(`(()=>{const el=[...document.querySelector(${JSON.stringify(root)}).querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(text)});if(!el||el.disabled)throw Error('Missing/disabled '+${JSON.stringify(text)});el.click()})()`); await pause(30); };
    const input = async (date) => { await evaluate(`(()=>{const el=document.querySelector('.sheet-analysis input[type=date]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(date)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`); await pause(30); };
    const card = (code = '120002') => `.sheet-analysis-card[data-stock-code="${code}"]`;
    const metric = (label, code) => `document.querySelector(${JSON.stringify(`${card(code)} [data-sheet-metric="${label}"] dd`)})?.childNodes[0]?.textContent.replace(',', '.')`;
    const seed = { items: [], demands: [], openOrders: [], planning: { weekStart: '2026-11-16', entries: [] }, planningWeeks: { '2026-11-16': { weekStart: '2026-11-16', entries: [{ id: 'KEEP-PLAN', productionLine: 'thermoforming', machine: 'AR1', day: '2026-11-18', shift: 'SHIFT 01', partNumber: bed, buildQty: 20, status: 'Planned' }] } }, activeWeekStart: '2026-11-16', selectedProductionLine: 'thermoforming', cycleCountDays: [day('2026-11-18'), day('2026-11-19', true)], productionActuals: [{ id: 'KEEP-ACTUAL', planningEntryId: 'KEEP-PLAN', actualMouldQty: 2000 }], oeeHistory: [{ id: 'KEEP-OEE', planningEntryId: 'KEEP-PLAN' }], oeeSettings: { thermoforming: rules } };
    await call('Runtime.enable'); await call('Page.enable'); await call('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1050, deviceScaleFactor: 1, mobile: false });
    await call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    const injection = await call('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.origin===${JSON.stringify(origin)}){localStorage.clear();localStorage.setItem('mrp-auth-users-v1',JSON.stringify([{id:'SHEET-TEST',username:'sheet-test',fullName:'Synthetic Sheet Tester',role:'ADMIN',isActive:true}]));localStorage.setItem('mrp-auth-session-v1',JSON.stringify({userId:'SHEET-TEST'}));localStorage.setItem('mrp-data',${JSON.stringify(JSON.stringify(seed))});}` });
    await call('Page.navigate', { url: origin }); await until(`document.querySelector('[aria-label="Open Thermoforming dashboard"]')!==null`);
    await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier });
    await click('[aria-label="Open Thermoforming dashboard"]'); await until(`document.querySelector('#sheet-analysis-title')!==null`);
    await input('2026-11-18'); await until(`${metric('3-shift count sum')}==='0'`);
    await until(`document.querySelector('.planner-toolbar').innerText.includes('Saved')`);
    const saved = await evaluate(`localStorage.getItem('mrp-data')`);
    assert.equal(await evaluate(`document.querySelectorAll('.sheet-analysis-header .sheet-analysis-switch').length`), 0);
    assert.equal(await evaluate(`document.querySelectorAll('.sheet-analysis-card[data-source=physical]').length`), 3);
    assert.equal(await evaluate(`document.querySelectorAll('.sheet-analysis-card-actions[role=group]').length`), 3);
    assert.equal(await evaluate(`[...document.querySelectorAll('.sheet-analysis-card-actions button')].map(el=>el.textContent).join('|')`), 'Physical|System|Physical|System|Physical|System');
    checks.push('Shared date only; three independent card footer controls; obsolete evidence/navigation buttons removed');
    await button(card(), 'System');
    assert.equal(await evaluate(metric('Received Sheets')), 'Loading');
    await until(`${metric('Received Sheets')}==='30'&&${metric('SOH in WIP (Closing Balance)')}==='0'`);
    assert.equal(await evaluate(`document.querySelectorAll('.sheet-analysis-card[data-source=physical]').length`), 2);
    assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(card() + ' [data-sheet-metric]')}).length`), 7);
    assert.deepEqual(await evaluate(`[...document.querySelectorAll(${JSON.stringify(card() + ' dt')})].map(el=>el.textContent)`), ['Opening Balance of Sheets', 'Received Sheets', 'SOH in WIP (Closing Balance)', 'Issued Sheets', 'Scrap & Defect Sheets', 'Bedliners Built', 'Tailgates Built']);
    assert.equal(await evaluate(metric('Issued Sheets')), '6'); assert.equal(await evaluate(metric('Bedliners Built')), '20'); assert.equal(await evaluate(metric('Tailgates Built')), '8');
    assert.ok(await evaluate(`document.querySelector(${JSON.stringify(card() + ' [data-sheet-metric="SOH in WIP (Closing Balance)"] dd')}).title.includes('2026-11-19 05:30:00 SAST')`));
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(card() + ' button[aria-pressed=true]')}).textContent`), 'System');
    checks.push('SOH directly below Received; confirmed zero retained; custom overnight closes on next date; original quantities unchanged');
    await button(card('121047'), 'System'); await button(card('120003'), 'System');
    await until(`${metric('SOH in WIP (Closing Balance)', '121047')}==='98'`);
    for (const [i, stockCode] of codes.entries()) {
      assert.equal(await evaluate(metric('Scrap & Defect Sheets', stockCode)), String(15 + i));
      const title = await evaluate(`document.querySelector(${JSON.stringify(card(stockCode) + ' [data-sheet-metric="Scrap & Defect Sheets"] dd')}).title`);
      assert.ok(title.includes(stockCode === '121047' ? 'B-WIP01 to B-SCR01' : 'B-WIP01 to B-REG01'));
      assert.equal(await evaluate(metric('Issued Sheets', stockCode)), '6');
    }
    const scrapShot = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, 'scrap-route-cards.png'), Buffer.from(scrapShot.data, 'base64'));
    checks.push('All System cards use their stock-specific scrap route; returns/reversals net once, duplicates and other routes excluded, configured next-day 05:30 cutoff respected, issues separate');
    responseMode = 'scrap-zero'; await button('.sheet-analysis-system-state', 'Refresh system');
    await until(`${metric('Scrap & Defect Sheets')}==='0'&&${metric('Scrap & Defect Sheets', '121047')}==='0'&&${metric('Scrap & Defect Sheets', '120003')}==='0'`);
    responseMode = 'scrap-invalid'; await button('.sheet-analysis-system-state', 'Refresh system');
    await until(`${metric('Scrap & Defect Sheets')}==='Unavailable'`);
    assert.equal(await evaluate(metric('Issued Sheets')), '6');
    responseMode = 'scrap-missing-time'; await button('.sheet-analysis-system-state', 'Refresh system');
    await until(`${metric('Scrap & Defect Sheets', '120003')}==='Unavailable'`);
    responseMode = 'normal'; await button('.sheet-analysis-system-state', 'Refresh system');
    await until(`${metric('Scrap & Defect Sheets')}==='15'`);
    checks.push('Verified scrap zero is numeric; missing journal agreement or transaction time is Unavailable; refresh recovers without altering other measures');
    const sharedReads = { system: requests.filter((url) => url.includes('/sheet-analysis/system?')).length,
      soh: requests.filter((url) => url.includes('/sheet-analysis/closing-soh?')).length };
    await button(card(), 'Physical');
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.sheet-analysis-card')].map(el=>el.dataset.source)`), ['physical', 'system', 'system']);
    assert.equal(await evaluate(metric('3-shift count sum')), '0');
    assert.equal(await evaluate(metric('Tailgates Built', '120003')), '4');
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(card() + ' button[aria-pressed=true]')}).textContent`), 'Physical');
    assert.equal(requests.filter((url) => url.includes('/sheet-analysis/system?')).length, sharedReads.system);
    assert.equal(requests.filter((url) => url.includes('/sheet-analysis/closing-soh?')).length, sharedReads.soh);
    const shot = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, 'mixed-card-views.png'), Buffer.from(shot.data, 'base64'));
    checks.push('120002 Physical leaves 121047 and 120003 System; active highlighting is per card; shared reads are not duplicated');
    await input('2026-11-19');
    await until(`${metric('3-shift count sum')}==='Incomplete'&&${metric('Received Sheets', '121047')}==='60'`);
    assert.ok(await evaluate(`document.querySelector(${JSON.stringify(card('121047') + ' [data-sheet-metric="SOH in WIP (Closing Balance)"] dd')}).title.includes('2026-11-20 05:30:00 SAST')`));
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.sheet-analysis-card')].map(el=>el.dataset.source)`), ['physical', 'system', 'system']);
    delay = 900; await input('2026-11-18'); delay = 50; await input('2026-11-19');
    await until(`${metric('Received Sheets', '121047')}==='60'`); await pause(1100);
    assert.equal(await evaluate(metric('Received Sheets', '121047')), '60');
    await input('2026-11-18'); await until(`${metric('Received Sheets', '121047')}==='30'`);
    checks.push('Shared date refreshes different card views without resetting them; draft counts stay incomplete; late responses cannot replace the newer day');
    responseMode = 'soh-outage'; await button('.sheet-analysis-system-state', 'Refresh system');
    await until(`${metric('SOH in WIP (Closing Balance)', '121047')}==='Historical SOH unavailable'`);
    assert.equal(await evaluate(metric('Issued Sheets', '121047')), '6'); assert.equal(await evaluate(metric('3-shift count sum')), '0');
    responseMode = 'soh-mismatch'; await button('.sheet-analysis-system-state', 'Refresh system');
    await until(`${metric('SOH in WIP (Closing Balance)', '121047')}==='Historical SOH unavailable'`);
    assert.equal(await evaluate(metric('Received Sheets', '121047')), '30');
    responseMode = 'normal'; await button('.sheet-analysis-system-state', 'Refresh system');
    await until(`${metric('SOH in WIP (Closing Balance)', '121047')}==='98'`);
    checks.push('Unverifiable or mismatched SOH is labelled Historical SOH unavailable without hiding posted metrics; retry restores the historical balance');
    responseMode = 'ambiguous'; await button('.sheet-analysis-system-state', 'Refresh system');
    await until(`${metric('Tailgates Built', '120003')}==='Incomplete'`);
    await button(card(), 'System'); assert.equal(await evaluate(metric('Tailgates Built')), 'Incomplete');
    assert.ok(await evaluate(`document.querySelector(${JSON.stringify(card() + ' [data-sheet-metric="Tailgates Built"] dd')}).title.includes('Verified subtotal: 8')`));
    responseMode = 'tailgate-zero'; await button('.sheet-analysis-system-state', 'Refresh system');
    await until(`${metric('Tailgates Built')}==='0'&&${metric('Tailgates Built', '120003')}==='0'`);
    responseMode = 'tailgate-outage'; await button('.sheet-analysis-system-state', 'Refresh system');
    await until(`${metric('Tailgates Built')}==='Unavailable'`);
    assert.equal(await evaluate(metric('Scrap & Defect Sheets')), '15');
    responseMode = 'date-only'; await button('.sheet-analysis-system-state', 'Refresh system');
    await until(`${metric('Tailgates Built')}==='Unavailable'`);
    assert.ok(await evaluate(`document.querySelector(${JSON.stringify(card() + ' [data-sheet-metric="Tailgates Built"] dd')}).title.includes('timestamp')`));
    responseMode = 'normal';
    await button('.sheet-analysis-system-state', 'Refresh system'); await until(`${metric('Tailgates Built')}==='8'`);
    checks.push('Tailgates uses independently verified backflush units: duplicates and signed reversal net once; exact CJ-RAP stays distinct; ambiguous attribution is Incomplete with a subtotal; zero, missing time and independent outages stay distinct');
    await input('2026-11-19'); await until(`${metric('SOH in WIP (Closing Balance)')}==='890.5'`);
    const closes19 = await evaluate(`[...document.querySelectorAll('.sheet-analysis-card')].map(el=>el.querySelector('[data-sheet-metric="SOH in WIP (Closing Balance)"] dd').childNodes[0].textContent)`);
    await input('2026-11-20'); await until(`${metric('Opening Balance of Sheets')}==='890.5'&&${metric('SOH in WIP (Closing Balance)')}==='903.75'`);
    const opens20 = await evaluate(`[...document.querySelectorAll('.sheet-analysis-card')].map(el=>el.querySelector('[data-sheet-metric="Opening Balance of Sheets"] dd').childNodes[0].textContent)`);
    assert.deepEqual(opens20, closes19);
    assert.ok(await evaluate(`document.querySelector(${JSON.stringify(card() + ' [data-sheet-metric="Opening Balance of Sheets"] dd')}).title.includes('night started 2026-11-19')`));
    const completed = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, 'opening-closing-20nov.png'), Buffer.from(completed.data, 'base64'));
    checks.push('19 November closing equals 20 November opening for all sheets; exact seven-row order and example 890.5 / 903.75 verified with fixtures');
    await input('2026-11-18'); await until(`${metric('SOH in WIP (Closing Balance)')}==='0'`);
    const closingRequests = requests.filter((url) => url.includes('/sheet-analysis/closing-soh?') && new URL(url).searchParams.get('date') === '2026-11-20').length;
    await evaluate(`(()=>{const realNow=Date.now.bind(Date),started=realNow(),base=Date.parse('2026-11-21T03:29:55Z');window.__sheetRealNow=realNow;Date.now=()=>base+(realNow()-started);})()`);
    await input('2026-11-20'); await until(`${metric('Opening Balance of Sheets')}==='890.5'`);
    assert.equal(await evaluate(metric('SOH in WIP (Closing Balance)')), 'Shift cycle in progress');
    assert.equal(requests.filter((url) => url.includes('/sheet-analysis/closing-soh?') && new URL(url).searchParams.get('date') === '2026-11-20').length, closingRequests);
    await until(`${metric('SOH in WIP (Closing Balance)')}==='903.75'`);
    assert.equal(await evaluate(metric('Opening Balance of Sheets')), '890.5');
    await evaluate(`Date.now=window.__sheetRealNow`);
    await input('2026-11-18'); await until(`${metric('SOH in WIP (Closing Balance)')}==='0'`);
    checks.push('Before cutoff opening is available but closing is Shift cycle in progress; timer automatically fetches the verified closing balance once the overnight cutoff passes');
    responseMode = 'outage'; await button('.sheet-analysis-system-state', 'Refresh system');
    await until(`${metric('Received Sheets')}==='Unavailable'&&${metric('SOH in WIP (Closing Balance)')}==='Historical SOH unavailable'`);
    await button(card(), 'Physical'); assert.equal(await evaluate(metric('3-shift count sum')), '0');
    assert.equal(await evaluate(`localStorage.getItem('mrp-data')`), saved);
    checks.push('Existing CJ and posting-date safeguards retained; outage does not alter physical counts or persisted plans, Actuals and OEE');
    let liveCards;
    if (liveAcceptance) {
      const report = JSON.parse(fs.readFileSync(path.join(out, 'live-system-report.json'), 'utf8'));
      assert.ok(Date.now() - Date.parse(report.checkedAt) < 3600000, 'Run the journal verification first to obtain a current baseline');
      const defaults = (await import('../mrp-planner/src/planning/shiftConfig.js')).SHIFT_CONFIG;
      const liveApp = require('express')(); liveApp.use('/api/syspro', require('../server/routes/sheetAnalysis'));
      liveTailgateServer = liveApp.listen(0, '127.0.0.1'); await new Promise((resolve) => liveTailgateServer.once('listening', resolve));
      liveTailgateBase = `http://127.0.0.1:${liveTailgateServer.address().port}`;
      // Only this disposable profile's synthetic settings change for the live read.
      await evaluate(`(()=>{const value=JSON.parse(localStorage.getItem('mrp-data'));value.oeeSettings.thermoforming=${JSON.stringify(defaults)};localStorage.setItem('mrp-data',JSON.stringify(value));})()`);
      responseMode = 'live'; await call('Page.reload');
      await until(`document.querySelector('[aria-label="Open Thermoforming dashboard"]')!==null`);
      await click('[aria-label="Open Thermoforming dashboard"]'); await until(`document.querySelector('#sheet-analysis-title')!==null`);
      await input(report.date);
      for (const stockCode of codes) await button(card(stockCode), 'System');
      await until(`${metric('Received Sheets')}!=='Loading'&&${metric('Received Sheets')}!==undefined`);
      liveCards = [];
      for (const stockCode of codes) {
        const expected = report.comparison.find((row) => row.stockCode === stockCode);
        assert.equal(expected.scrap.quantity, expected.journalScrap);
        const quantity = await evaluate(metric('Scrap & Defect Sheets', stockCode));
        assert.equal(Number(quantity), expected.journalScrap);
        assert.equal(Number(await evaluate(metric('Issued Sheets', stockCode))), expected.journalIssued);
        liveCards.push({ stockCode, quantity, journalScrap: expected.journalScrap, destination: expected.scrapDestination });
      }
      const liveShot = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, 'live-scrap-route-cards.png'), Buffer.from(liveShot.data, 'base64'));
      checks.push(`Running app ${origin}: all three System scrap cards and issued totals match independent live SYSPRO journal for ${report.date}; default shifts, isolated profile; unrelated APIs synthetic`);
      const tailgateReport = JSON.parse(fs.readFileSync(path.join(root, 'diagnostics/tailgate-backflush/live-report.json'), 'utf8'));
      assert.equal(tailgateReport.date, report.date);
      await until(`${metric('Tailgates Built')}!=='Loading'&&${metric('Tailgates Built', '120003')}!=='Loading'`);
      for (const row of tailgateReport.totals) {
        const expected = row.status === 'available' ? String(row.quantity) : row.status === 'incomplete' ? 'Incomplete' : 'Unavailable';
        assert.equal(await evaluate(metric('Tailgates Built', row.stockCode)), expected);
      }
      const tailgateShot = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(root, 'diagnostics/tailgate-backflush/live-cards.png'), Buffer.from(tailgateShot.data, 'base64'));
      checks.push('Running frontend with an isolated newly loaded read-only tailgate API: completed-day states match live journal evidence; missing producing-job lineage remains Unavailable rather than a false built total');
    }
    assert.equal(errors.length, 0, JSON.stringify(errors));
    fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify({ synthetic: true, liveCards, origin, checks, errors, requests }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, checks, liveCards, errors }, null, 2));
  } finally {
    if (call && socket?.readyState === WebSocket.OPEN) { await call('Browser.close').catch(() => {}); socket.close(); }
    browser.kill(); vite?.kill();
    if (liveTailgateServer) await new Promise((resolve) => liveTailgateServer.close(resolve));
    if (liveAcceptance) await require('../server/db').close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
