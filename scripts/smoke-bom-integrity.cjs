// Requires a NEW isolated headless browser profile on port 9235. All API
// responses and business records are synthetic; no real browser storage is reset.
const assert = require('node:assert/strict');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
  const tabs = await (await fetch('http://127.0.0.1:9235/json')).json();
  const page = tabs.find((tab) => tab.type === 'page');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  let nextId = 0, mode = 'missing', fcsdMode = 'duplicate', oldFcsdRequests = 0;
  const pending = new Map(), exceptions = [];
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  const parent = 'N1WB-E12606-SCP', fcsdParent = 'N1WZ-17906-HU';
  const stock = [
    { StockCode: parent, Description: 'Synthetic parent', StockUom: 'EA', B_WIP01_SOH: 0, B_RAW01_SOH: 0 },
    { StockCode: '120002', Description: 'Synthetic sheet', StockUom: 'SHEET', B_WIP01_SOH: 7, B_RAW01_SOH: 13 },
    { StockCode: '120003', Description: 'Synthetic sheet B', StockUom: 'SHEET', B_WIP01_SOH: 0, B_RAW01_SOH: 0 },
    { StockCode: '121047', Description: 'Synthetic sheet C', StockUom: 'SHEET', B_WIP01_SOH: 0, B_RAW01_SOH: 0 },
    { StockCode: 'LIVE-MAT', Description: 'Live-only synthetic material', StockUom: 'KG', B_WIP01_SOH: 4, B_RAW01_SOH: 8 },
  ];
  const baseLine = { parentStockCode: parent, parentDescription: 'Synthetic parent', parentUom: 'EA',
    componentStockCode: '120002', componentDescription: 'Synthetic sheet', componentUom: 'SHEET',
    qtyPer: 2, qtyPerState: 'positive', factorUnitsVerified: true, qtyPerBasis: 'stocking', route: '0', sequence: '000000' };
  const rows = () => mode === 'empty' ? [] : mode === 'missing' ? [
    { ...baseLine, qtyPer: null, qtyPerState: 'missing' },
    { ...baseLine, componentStockCode: 'LIVE-MAT', componentUom: 'KG', qtyPer: 1 },
  ] : mode === 'duplicate' ? [baseLine, { ...baseLine, route: '1', sequence: '000001', qtyPer: -0.5, qtyPerState: 'negative' }]
    : mode === 'unverified' ? [{ ...baseLine, factorUnitsVerified: false }] : [baseLine];
  const response = (payload, status = 200) => ({ responseCode: status,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(payload)).toString('base64') });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = pending.get(message.id); pending.delete(message.id);
      if (message.error) request.reject(message.error); else request.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    if (message.method !== 'Fetch.requestPaused') return;
    const { request, requestId } = message.params;
    if (!['GET', 'HEAD'].includes(request.method)) exceptions.push({ unexpectedWrite: request.method, url: request.url });
    const path = new URL(request.url).pathname;
    let payload = { success: true, data: [], count: 0 }, status = 200;
    if (path === '/api/syspro/inventory') payload.data = stock;
    if (path === '/api/syspro/bom') {
      payload = mode === 'offline' ? { success: false, error: 'Synthetic BOM outage' } : { success: true, data: rows(), fetchedAt: new Date().toISOString() };
      if (mode === 'offline') status = 503;
    }
    if (path === '/api/syspro/fcsd/parts') payload.data = [
      { stockCode: fcsdParent, description: 'Synthetic FCSD parent', uom: 'EA', isBomParent: true },
      { stockCode: '120002', description: 'Synthetic sheet', uom: 'SHEET', isBomComponent: true },
    ];
    if (path === '/api/syspro/fcsd/bom') payload.data = fcsdMode === 'duplicate' ? [
      { ...baseLine, parentStockCode: fcsdParent }, { ...baseLine, parentStockCode: fcsdParent, route: '1', sequence: '000001' },
    ] : [{ ...baseLine, parentStockCode: fcsdParent, qtyPer: fcsdMode === 'slow-old' ? 99 : 2 }];
    const delayed = path.startsWith('/api/syspro/fcsd/') && fcsdMode === 'slow-old';
    if (delayed) oldFcsdRequests++;
    const fulfill = () => call('Fetch.fulfillRequest', { requestId, ...response(payload, status) }).catch((error) => {
      if (!/Invalid|No resource|cancel/i.test(error.message)) exceptions.push({ text: error.message });
    });
    if (delayed) setTimeout(fulfill, 700); else fulfill();
  });
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression) => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(expression)) return; await pause(100); }
    throw Error(`Timed out: ${expression}; screen: ${await evaluate('document.body.innerText.slice(-6000)')}`);
  };
  const click = async (text, scope = 'document') => evaluate(`(()=>{const b=[...${scope}.querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Button missing: '+${JSON.stringify(text)});b.click()})()`);
  const setValue = async (selector, value, tag = 'HTMLInputElement') => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${tag}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const plan = { id: 'bom-plan', day: '2026-11-16', partNumber: parent, buildQty: 10, machine: 'AR1', shift: 'SHIFT 01', productionLine: 'thermoforming', status: 'Planned' };
  const planner = { items: [
    { id: 'parent', code: parent, description: 'Synthetic saved parent', uom: 'EA', type: 'Make', onHand: 0, leadTimeDays: 0, lotSize: 1 },
    { id: 'sheet', code: '120002', description: 'Synthetic saved sheet', uom: 'SHEET', type: 'Buy', onHand: 0, bWip01Soh: 999, bRaw01Soh: 999, lotSize: 5 },
  ], demands: [{ id: 'KEEP-DEMAND', itemId: 'parent', qty: 10, dueDate: '2026-11-16' }], openOrders: [],
    activeWeekStart: '2026-11-16', selectedProductionLine: 'thermoforming', planningWeeks: { '2026-11-16': { weekStart: '2026-11-16', entries: [plan] } },
    productionActuals: [{ id: 'KEEP-ACTUAL', planningEntryId: plan.id, actualMouldQty: 10, updatedAt: '2026-11-16T13:00:00Z' }],
    openingWipBalances: [{ stockCode: '120002', quantity: 0, asOf: '2026-11-16T00:00:00' }],
    closingWipBalances: [{ stockCode: '120002', quantity: 0, asOf: '2026-11-17T00:00:00' }], sysproTransactions: [], cycleCountDays: [] };
  await call('Runtime.enable'); await call('Page.enable');
  await call('Fetch.enable', { patterns: [{ urlPattern: 'http://localhost:5173/api/*', requestStage: 'Request' }] });
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.origin==='http://localhost:5173'){if(localStorage.getItem('mrp-data')!==null)throw Error('This check requires a fresh isolated profile; refusing to replace planner data.');localStorage.setItem('mrp-data',${JSON.stringify(JSON.stringify(planner))});localStorage.setItem('mrp-auth-users-v1',JSON.stringify([{id:'BOM-SMOKE',username:'bom-smoke',fullName:'Synthetic BOM Reviewer',role:'ADMIN',isActive:true}]));localStorage.setItem('mrp-auth-session-v1',JSON.stringify({userId:'BOM-SMOKE'}));}` });
  await call('Page.navigate', { url: 'http://localhost:5173' });
  await until(`document.querySelector('[aria-label="Workspace"]')!==null`);
  await click('Bill of Materials'); await until(`document.querySelector('.bom-explorer')?.innerText.includes('source lines')`);
  await evaluate(`([...document.querySelectorAll('.bom-explorer button')].find(b=>b.textContent.includes(${JSON.stringify(parent)}))).click()`);
  assert.ok(await evaluate(`document.querySelector('.bom-explorer').innerText.includes('missing')`));
  await click('Production MRP');
  await until(`document.body.innerText.includes('Material request incomplete')`);
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Download PDF')).disabled`), true);
  assert.ok(await evaluate(`document.body.innerText.includes('LIVE-MAT')&&document.body.innerText.includes('KG')`));
  assert.equal(await evaluate(`[...document.querySelectorAll('table')][1].querySelector('tbody tr td:nth-child(4)').textContent`), '—');
  await click('Planning Ledger');
  await until(`document.body.innerText.includes('Ledger incomplete')`);
  await setValue('main select', 'live:LIVE-MAT', 'HTMLSelectElement');
  await until(`document.body.innerText.includes('Live item has no saved planning policy')`);
  await click('Production Actuals'); await evaluate(`document.querySelector('.actual-section-toggle').click()`);
  await until(`document.querySelector('.actual-recon-table')!==null`);
  assert.ok(await evaluate(`document.querySelector('.actual-recon-table').innerText.includes('Data incomplete')`));
  const expected = await evaluate(`[...document.querySelectorAll('.actual-recon-table tbody tr')].find(r=>r.querySelector('td')?.textContent==='120002').children[2].textContent`);
  assert.equal(expected, '—');
  await click('Dashboard');
  await evaluate(`document.querySelector('[aria-label="Open Thermoforming dashboard"]').click()`);
  await until(`document.querySelector('.sheet-analysis')!==null`);
  await setValue('.sheet-analysis input[type="date"]', '2026-11-16');
  await click('Show evidence');
  await until(`document.querySelector('.sheet-analysis-evidence')?.innerText.includes('missing or invalid')`);
  assert.ok(!(await evaluate(`document.querySelector('.sheet-analysis-evidence').innerText`)).includes('Calculation complete'));

  mode = 'unverified'; await click('Bill of Materials'); await click('Refresh', `document.querySelector('.bom-explorer')`);
  await until(`!document.querySelector('.bom-explorer button.mrp-btn').disabled`);
  await click('Production MRP');
  assert.ok(await evaluate(`document.body.innerText.includes('factor units are unverified')`));
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Download PDF')).disabled`), true);
  mode = 'duplicate'; await click('Bill of Materials'); await click('Refresh', `document.querySelector('.bom-explorer')`);
  await until(`document.querySelector('.bom-explorer').innerText.includes('2 source lines')`);
  await evaluate(`([...document.querySelectorAll('.bom-explorer button')].find(b=>b.textContent.includes(${JSON.stringify(parent)}))).click()`);
  assert.ok(await evaluate(`document.querySelector('.bom-explorer').innerText.includes('Multiple BOM routes')`));
  assert.ok(await evaluate(`document.querySelector('.bom-explorer').innerText.includes('-0.5')`));

  // A verified simple structure still produces the existing correct totals.
  mode = 'valid'; await click('Bill of Materials'); await click('Refresh', `document.querySelector('.bom-explorer')`);
  await until(`document.querySelector('.bom-explorer')?.innerText.includes('1 source lines')`);
  await click('Production MRP');
  await until(`![...document.querySelectorAll('button')].find(b=>b.textContent.includes('Download PDF')).disabled`);
  assert.equal(await evaluate(`[...document.querySelectorAll('table')][1].querySelector('tbody tr td:nth-child(4)').textContent`), '20');
  assert.equal(await evaluate(`[...document.querySelectorAll('table')][1].querySelector('tbody tr td:nth-child(5)').textContent`), '7');
  assert.equal(await evaluate(`[...document.querySelectorAll('table')][2].querySelector('tbody tr td:nth-child(8)').textContent`), '13');

  // Empty is distinguished from unavailable. Neither can claim no materials.
  mode = 'empty'; await click('Bill of Materials'); await click('Refresh', `document.querySelector('.bom-explorer')`);
  await until(`document.querySelector('.bom-explorer').innerText.includes('connected, empty snapshot')`);
  await click('Production MRP');
  assert.ok(await evaluate(`document.body.innerText.includes('Store requests are unresolved')`));
  mode = 'valid'; await click('Bill of Materials'); await click('Refresh', `document.querySelector('.bom-explorer')`);
  await until(`document.querySelector('.bom-explorer').innerText.includes('1 source lines')`);
  mode = 'offline'; await click('Refresh', `document.querySelector('.bom-explorer')`);
  await until(`document.querySelector('.bom-explorer').innerText.includes('Synthetic BOM outage')`);
  assert.ok(await evaluate(`document.querySelector('.bom-explorer').innerText.includes('inspection only')`));
  await click('Production MRP');
  assert.equal(await evaluate(`[...document.querySelectorAll('table')][1].querySelector('tbody tr td:nth-child(4)').textContent`), '—');
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Download PDF')).disabled`), true);

  // FCSD preserves duplicate alternate lines as unresolved instead of summing.
  await setValue('[aria-label="Workspace"]', 'fcsd', 'HTMLSelectElement');
  await until(`document.querySelector('.fcsd-list button')!==null`);
  await click('Add', `document.querySelector('.fcsd-tracker')`);
  await setValue(`input[aria-label="Quantity for ${fcsdParent}"]`, '10');
  await until(`document.querySelector('.fcsd-status-unresolved')!==null`);
  assert.ok(await evaluate(`document.querySelector('.fcsd-results').innerText.includes('Duplicate component lines')`));
  assert.equal(await evaluate(`document.querySelector('.fcsd-results tbody tr td:nth-child(3)').textContent`), 'Unresolved');
  fcsdMode = 'slow-old'; await click('Refresh SYSPRO snapshot');
  for (let attempt = 0; attempt < 100 && oldFcsdRequests < 2; attempt++) await pause(10);
  assert.equal(oldFcsdRequests, 2);
  fcsdMode = 'valid'; await click('Refresh SYSPRO snapshot');
  await until(`document.querySelector('.fcsd-results tbody tr td:nth-child(3)')?.textContent==='20'`);
  await pause(900);
  assert.equal(await evaluate(`document.querySelector('.fcsd-results tbody tr td:nth-child(3)').textContent`), '20');
  await pause(900);
  const saved = await evaluate(`JSON.parse(localStorage.getItem('mrp-data'))`);
  assert.equal(saved.demands[0].id, 'KEEP-DEMAND'); assert.equal(saved.productionActuals[0].id, 'KEEP-ACTUAL');
  assert.equal(saved.items.length, 2); assert.ok(!saved.items.some((item) => item.code === 'LIVE-MAT'));
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  await call('Fetch.disable'); socket.close();
  console.log('Synthetic BOM browser regression passed: all six consumers, live-only items, unknown factors, unverified units, valid totals, empty/offline states, stale exclusion, PDF gating, alternate/negative lines, out-of-order FCSD refreshes, and preserved saved records.');
})().catch((error) => { console.error(error); process.exit(1); });
