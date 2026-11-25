// Preview-only Rev2 test: never clicks Confirm import. Uses isolated synthetic
// data. All API requests are intercepted; no live plans, Actuals or OEE are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sample = path.resolve(process.argv[2] || path.join(root, 'tests/fixtures/Production plan 17 Nov 2026 Rev2.xlsx'));
const out = path.join(root, 'diagnostics/planning-excel-rev2');
const origin = 'http://127.0.0.1:5176', debugUrl = 'http://127.0.0.1:9238';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sampleHash = () => crypto.createHash('sha256').update(fs.readFileSync(sample)).digest('hex');
const originalHash = sampleHash();
const parentCodes = ['N1WB-J12606-SAH', 'R1WB-E12606-AF', 'N1WB-E12606-SAJ', 'N1WB-E12606-SCP', 'N1WB-E13036-K', 'N1WB-E13036-N', 'N1WB-16450-CAA', 'N1WB-16451-CAA', 'N1WB-16450-BAA', 'N1WB-16451-BAA', 'N1XB-16450-ABA', 'N1XB-16451-ABA'];
const boms = parentCodes.map((parentStockCode) => ({ parentStockCode, parentDescription: 'Synthetic test parent', componentStockCode: 'TEST-RAW', componentDescription: 'Synthetic raw', qtyPer: 1, factorUnitsVerified: true, qtyPerBasis: 'stocking', parentUom: 'EA', componentUom: 'EA' }));
const seed = {
  items: [...parentCodes, 'TEST-RAW'].map((code) => ({ id: code, code, description: 'Synthetic test item', type: 'Buy', uom: 'EA', lotSize: 10, onHand: 0 })),
  demands: [], openOrders: [], activeWeekStart: '2026-11-09', selectedProductionLine: 'thermoforming', horizon: 1,
  planning: { weekStart: '2026-11-09', entries: [] },
  planningWeeks: {
    '2026-11-09': { weekStart: '2026-11-09', entries: [
      { id: 'KEEP-EXISTING', productionLine: 'thermoforming', machine: 'AR2', day: '2026-11-11', shift: 'SHIFT 01', partNumber: 'N1WB-E12606-SCP', buildQty: 56, originalPlanQty: 56, status: 'Planned' },
      { id: 'KEEP-OTHER-LINE', productionLine: 'blowMoulding', machine: 'BM01', day: '2026-11-11', shift: 'SHIFT 01', partNumber: 'N1WB_CAA_PAIR', buildQty: 3, originalPlanQty: 3, status: 'Planned' },
    ] },
    '2026-11-16': { weekStart: '2026-11-16', entries: [{ id: 'KEEP-OTHER-WEEK', productionLine: 'thermoforming', machine: 'AR1', day: '2026-11-18', shift: 'SHIFT 01', partNumber: 'N1WB-E12606-SCP', buildQty: 2, status: 'Planned' }] },
  },
  productionActuals: [{ id: 'KEEP-ACTUAL', planningEntryId: 'KEEP-EXISTING', productionLine: 'thermoforming', machine: 'AR2', day: '2026-11-11', shift: 'SHIFT 01', actualQty: 23 }],
  oeeHistory: [{ id: 'KEEP-OEE', planningEntryId: 'KEEP-EXISTING', availability: 0.9 }],
  cycleCountDays: [],
};

async function free(port) {
  await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(port, '127.0.0.1', () => probe.close(resolve)); });
}
async function waitForJson(url) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (r.ok) return await r.json(); } catch {}
    await pause(100);
  }
  throw new Error(`Could not connect to ${url}`);
}

(async () => {
  await Promise.all([free(5176), free(9238)]);
  fs.mkdirSync(out, { recursive: true });
  const vite = spawn(process.execPath, [path.join(root, 'mrp-planner/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5176', '--strictPort'], { cwd: path.join(root, 'mrp-planner'), windowsHide: true, stdio: 'ignore' });
  const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=9238', `--user-data-dir=${path.join(out, `edge-profile-${Date.now()}`)}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let socket, call;
  try {
    const tabs = await waitForJson(`${debugUrl}/json`);
    socket = new WebSocket(tabs.find((tab) => tab.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let nextId = 0;
    const pending = new Map(), errors = [], requests = [], checks = [];
    call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) { const item = pending.get(message.id); pending.delete(message.id); if (message.error) item.reject(new Error(JSON.stringify(message.error))); else item.resolve(message.result); return; }
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
      if (message.method === 'Fetch.requestPaused') {
        const { request, requestId } = message.params;
        (async () => {
          if (request.url.startsWith(`${origin}/api/`)) {
            requests.push({ method: request.method, url: request.url });
            assert.equal(request.method, 'GET', 'Workbook parsing must never upload data or write to an API');
            const data = request.url.includes('/bom') ? boms : request.url.includes('/inventory') ? [...parentCodes, 'TEST-RAW'].map((StockCode) => ({ StockCode, Description: 'Synthetic inventory', StockUom: 'EA', B_WIP01_SOH: 0, B_RAW01_SOH: 10000 })) : [];
            await call('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify({ success: true, data })).toString('base64') });
          } else if (request.url.startsWith(origin)) await call('Fetch.continueRequest', { requestId });
          else await call('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
        })().catch((error) => { if (!error.message.includes('Invalid InterceptionId')) errors.push(error.message); });
      }
    });
    const evaluate = async (expression) => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
    const until = async (expression) => { for (let attempt = 0; attempt < 250; attempt++) { if (await evaluate(expression)) return; await pause(100); } throw new Error(`Timed out: ${expression}`); };
    const clickText = async (text) => { await evaluate(`(()=>{const el=[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(text)});if(!el||el.disabled)throw Error('Missing/disabled button '+${JSON.stringify(text)});el.click();})()`); await pause(40); };
    const setInput = async (selector, value) => {
      const label = /^\[aria-label="(.*)"\]$/.exec(selector)?.[1];
      await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)})||(${JSON.stringify(label)}&&[...document.querySelectorAll('label')].find(label=>label.textContent.trim().startsWith(${JSON.stringify(label)}))?.querySelector('input,select'));if(!el)throw Error('Missing input '+${JSON.stringify(selector)});const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`); await pause(25);
    };
    const check = async (selector) => { await evaluate(`(()=>{const box=document.querySelector(${JSON.stringify(selector)});if(!box||box.disabled)throw Error('Missing/disabled checkbox '+${JSON.stringify(selector)});if(!box.checked)box.click();})()`); await pause(25); };
    const checkLabel = async (prefix) => { await evaluate(`(()=>{const labels=[...document.querySelectorAll('.excel-plan-import label')].filter(el=>el.textContent.trim().startsWith(${JSON.stringify(prefix)}));if(!labels.length)throw Error('Missing checkbox '+${JSON.stringify(prefix)});for(const label of labels){const el=label.querySelector('input[type=checkbox]');if(el&&!el.checked)el.click();}})()`); await pause(40); };
    const upload = async (file = sample) => { await call('DOM.enable'); const { root } = await call('DOM.getDocument'); const { nodeId } = await call('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' }); await call('DOM.setFileInputFiles', { nodeId, files: [file] }); };
    const screenshot = async (name) => { const { data } = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(data, 'base64')); };
    const stored = () => evaluate("JSON.parse(localStorage.getItem('mrp-data'))");
    const rowText = (id) => evaluate(`document.querySelector('[data-source-row="${id}"]').innerText`);
    await call('Runtime.enable'); await call('Page.enable');
    await call('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
    await call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    const injection = await call('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.origin===${JSON.stringify(origin)}){localStorage.clear();localStorage.setItem('mrp-auth-users-v1',JSON.stringify([{id:'TEST-EXCEL-REVIEWER',username:'synthetic',fullName:'Synthetic Excel Reviewer',role:'ADMIN',isActive:true}]));localStorage.setItem('mrp-auth-session-v1',JSON.stringify({userId:'TEST-EXCEL-REVIEWER'}));localStorage.setItem('mrp-data',${JSON.stringify(JSON.stringify(seed))});}` });
    await call('Page.navigate', { url: origin });
    await until("document.querySelector('.production-overview')!==null");
    await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier });
    await until("document.querySelector('.planner-toolbar').innerText.includes('Saved')");
    await clickText('Planning'); await until("document.querySelector('.bm-planning')!==null");
    const initial = await stored();
    // Guard even the isolated storage against accidentally saving import rows.
    await evaluate("window.__importSaveAttempts=0;window.__originalStorageSet=window.storage.set.bind(window.storage);window.storage.set=async(key,value,...rest)=>{if(key==='mrp-data'&&Object.values(JSON.parse(value).planningWeeks||{}).some(w=>(w.entries||[]).some(e=>e.id?.startsWith('excel_')))){window.__importSaveAttempts++;throw Error('Preview-only test: import saves forbidden');}return window.__originalStorageSet(key,value,...rest);};");
    await upload();
    await until("document.querySelectorAll('[data-source-row]').length===125 || document.querySelector('.excel-plan-import [role=alert]')!==null");
    assert.equal(await evaluate("document.querySelector('.excel-plan-import [role=alert]')?.innerText"), undefined);
    assert.match(await evaluate("document.querySelector('.excel-recognition').innerText"), /Table 1.*4 days.*3 repeating shifts.*9 machines.*108 source cells.*125 activities/);
    assert.equal(await evaluate("document.querySelectorAll('input[aria-label^=Include]:checked').length"), 0);
    assert.equal(await evaluate("document.querySelector('.excel-plan-import input[min=\"1900\"]').value"), '');
    assert.deepEqual((await stored()).planningWeeks, initial.planningWeeks);
    assert.match(await rowText('F4:f0'), /Table 1!F4/);
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Excel quantity F4:f0\"]').value"), '10');
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Product text F4:f0\"]').value"), 'N1WB-J12606-SAH');
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Activity F4:f1\"]').value"), 'Changeover');
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Excel quantity F4:f2\"]').value"), '30');
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Product text F4:f2\"]').value"), 'R1WB-E12606-AF');
    await evaluate("document.querySelector('.excel-plan-import').scrollIntoView({block:'start'})");
    await screenshot('rev2-upload-recognition');

    // These are synthetic preview decisions, not approval of unstated business units.
    await setInput('.excel-plan-import input[min="1900"]', '2026');
    await clickText('Fill printed dates using this year');
    await checkLabel('Year confirmed'); await checkLabel('Date and year checked'); await checkLabel('I checked the printed dates');
    for (const [index, shift] of ['06:00 - 14:23', '14:00 - 22:23', '22:00 - 06:23'].entries()) await setInput(`[aria-label="Application shift for ${shift}"]`, `SHIFT 0${index + 1}`);
    await checkLabel('Mapping/time difference confirmed'); await checkLabel('The printed date is the shift-start date');
    for (const id of ['F4:f0', 'F4:f1', 'F4:f2', 'B8:f0', 'B8:f1', 'B8:f2', 'B10:f0', 'C9:f0', 'E11:f0', 'B6:f0']) await check(`[aria-label="Include ${id}"]`);
    assert.match(await rowText('F4:f0'), /quantity meaning\/units/);
    const choices = [
      ['AR1|N1WB-J12606-SAH', 'N1WB-J12606-SAH', 'EA'], ['AR1|R1WB-E12606-AF', 'R1WB-E12606-AF', 'EA'],
      ['AR3|DBL LH', 'N1WB-E13036-K', 'EA'], ['AR3|DBL RH', 'N1WB-E13036-N', 'EA'],
      ['BM02|CAA', 'N1WB_CAA_PAIR', 'SET'], ['BM01|BAA', 'N1WB_BAA_PAIR', 'SET'], ['BM03|ABA', 'N1XB_ABA_PAIR', 'SET'],
      ['AR4|N1WB-E12606-SAJ', 'N1WB-E12606-SAJ', 'EA'],
    ];
    for (const [key, target, unit] of choices) {
      await setInput(`[aria-label="Stock mapping ${key}"]`, target);
      await setInput(`[aria-label="Source unit ${key}"]`, unit);
      await setInput(`[aria-label="Conversion factor ${key}"]`, '1');
      await setInput(`[aria-label="Mapping explanation ${key}"]`, 'Synthetic preview only. Workbook does not establish these units; a planner must review the live mapping and quantity basis.');
      await check(`[aria-label="Confirm mapping ${key}"]`);
    }
    await check('[aria-label="Confirm activity F4:f1"]'); await check('[aria-label="Confirm activity B8:f1"]');
    await checkLabel('I reviewed machine/date/shift ownership');
    assert.match(await rowText('B6:f0'), /notes\/conditions/);
    assert.match(await rowText('B6:f1'), /till AR#1/);
    assert.match(await rowText('C6:f1'), /and programming/);
    await clickText('Review exact additions');
    const targetPreview = await evaluate("[...document.querySelectorAll('.excel-additions-table tbody tr')].filter(row=>row.cells[0].innerText.includes('Table 1!F4')).map(row=>({source:row.cells[0].innerText,target:row.cells[1].innerText,activity:row.cells[2].innerText}))");
    assert.equal(targetPreview.length, 3);
    for (const row of targetPreview) assert.match(row.target, /AR1.*2026-11-18.*SHIFT 02/s);
    assert.match(targetPreview[0].activity, /Planned.*N1WB-J12606-SAH.*10 EA/s);
    assert.match(targetPreview[1].activity, /Changeover.*Non-production activity/s);
    assert.match(targetPreview[2].activity, /Planned.*R1WB-E12606-AF.*30 EA/s);
    assert.equal(await evaluate("document.querySelectorAll('.excel-additions-table tbody tr').length"), 9);
    assert.match(await evaluate("document.querySelector('.excel-exclusions').innerText"), /notes\/conditions/);
    await checkLabel('I reviewed these exact additions');
    assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm import').disabled"), false);
    await evaluate("document.querySelector('.excel-additions-table').scrollIntoView({block:'start'})");
    await screenshot('rev2-ar1-shift2-preview');
    fs.writeFileSync(path.join(out, 'ar1-shift2-preview.json'), JSON.stringify(targetPreview, null, 2));
    assert.deepEqual((await stored()).planningWeeks, initial.planningWeeks);
    assert.deepEqual((await stored()).productionActuals, initial.productionActuals);
    assert.deepEqual((await stored()).oeeHistory, initial.oeeHistory);
    assert.equal(await evaluate('window.__importSaveAttempts'), 0);
    await evaluate('window.confirm=()=>true'); await clickText('Discard review');
    assert.deepEqual((await stored()).planningWeeks, initial.planningWeeks);
    assert.equal(errors.length, 0, JSON.stringify(errors)); assert.equal(sampleHash(), originalHash);
    const report = {
      sample: path.basename(sample), sheet: 'Table 1', days: ['17-Nov', '18-Nov', '19-Nov', '20-Nov'], machines: 9,
      sourceCells: 108, previewFragments: 125, productionFragments: 85, changeovers: 10, offMarkers: 28, notes: 2,
      target: { machine: 'AR1', sourceCell: 'Table 1!F4', dateUsedForDryRun: '2026-11-18', mappedShift: 'SHIFT 02',
        sequence: [{ kind: 'Production', stockCode: 'N1WB-J12606-SAH', quantity: 10 }, { kind: 'Changeover' }, { kind: 'Production', stockCode: 'R1WB-E12606-AF', quantity: 30 }] },
      explicitYearAndShiftConfirmationsTested: true, shorthandAndUnitConfirmationControlsTested: true,
      syntheticCatalogOnly: true, actualUnstatedQuantityUnitsApproved: false, confirmedPreviewAdditions: 9,
      importButtonClicked: false, importSaveAttempts: 0, rowsAdded: 0, planningActualsOeeUnchanged: true, cancellationUnchanged: true,
      apiWrites: requests.filter((request) => request.method !== 'GET').length, runtimeExceptions: errors.length, sampleUnchanged: true,
      remainingReview: ['Year is absent from the sheet; 2026 was explicitly entered for the dry run, not inferred.',
        'All three source shift times differ from configured shifts; mappings and overnight dates need planner approval.',
        'DBL LH/RH, BAA, CAA, ABA and other shorthand require verified full stock codes.',
        'All 85 production quantities have an unstated unit basis; EA/SET decisions in this test use synthetic data only.',
        'Table 1!B6: till AR#1; Table 1!C6: and programming. No timing, transfer or programming duration is inferred.',
        'Multiple blow-moulding outputs in C11, J11 and K11 require independent-run or paired-output review.',
        'OFF and C/O meaning must be explicitly confirmed before any future import.'],
    };
    fs.writeFileSync(path.join(out, 'preview-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (socket?.readyState === WebSocket.OPEN) { await call('Browser.close').catch(() => {}); socket.close(); }
    browser.kill(); vite.kill();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
