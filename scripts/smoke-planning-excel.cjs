// Runs the supplied workbook in an isolated Edge profile with synthetic business
// data. All API requests are intercepted; no live plans, Actuals or OEE are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sample = path.resolve(process.argv[2] || path.join(root, 'tests/fixtures/Production_Plan_Converted.xlsx'));
const out = path.join(root, 'diagnostics/planning-excel-import');
const origin = 'http://127.0.0.1:5175', debugUrl = 'http://127.0.0.1:9237';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sampleHash = () => crypto.createHash('sha256').update(fs.readFileSync(sample)).digest('hex');
const originalHash = sampleHash();
const parentCodes = ['N1WB-E12606-SCP', 'N1WB-P13036-D', 'N1WB-E13036-N', 'N1WB-16450-CAA', 'N1WB-16451-CAA'];
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
  await Promise.all([free(5175), free(9237)]);
  fs.mkdirSync(out, { recursive: true });
  const vite = spawn(process.execPath, [path.join(root, 'mrp-planner/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5175', '--strictPort'], { cwd: path.join(root, 'mrp-planner'), windowsHide: true, stdio: 'ignore' });
  const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=9237', `--user-data-dir=${path.join(out, `edge-profile-${Date.now()}`)}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
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
    await upload(); await until("document.querySelectorAll('[data-source-row]').length===115 || document.querySelector('.excel-plan-import [role=alert]')!==null");
    assert.equal(await evaluate("document.querySelector('.excel-plan-import [role=alert]')?.innerText"), undefined);
    assert.equal(await evaluate("document.querySelectorAll('[data-source-row]').length"), 115);
    assert.match(await rowText('B10:f0'), /Production Plan!B10/);
    assert.match(await rowText('B15:f0'), /Day-spanning/);
    assert.match(await rowText('A20:f0'), /CANCEL SHIFTS/);
    assert.equal(await evaluate("document.querySelectorAll('input[aria-label^=Include]:checked').length"), 0);
    assert.deepEqual((await stored()).planningWeeks, initial.planningWeeks);
    await screenshot('excel-upload-preview');
    await setInput('.excel-plan-import input[min="1900"]', '2026');
    await clickText('Dashboard'); await clickText('Planning');
    assert.equal(await evaluate("document.querySelector('.excel-plan-import input[min=\"1900\"]').value"), '2026');
    await evaluate('window.confirm=()=>true'); await clickText('Discard review');
    assert.deepEqual((await stored()).planningWeeks, initial.planningWeeks);
    checks.push('Actual workbook uploads locally: 115 fragments, source cells, merged dates, multi-runs, remarks and unsupported day scopes; navigation retains corrections; cancellation changes no plan.');

    await upload(); await until("document.querySelectorAll('[data-source-row]').length===115");
    await setInput('.excel-plan-import input[min="1900"]', '2026');
    await clickText('Fill printed dates using this year');
    await checkLabel('Year confirmed'); await checkLabel('Date and year checked'); await checkLabel('I checked the printed dates');
    for (const [index, shift] of ['06:00 - 14:23', '14:00 - 22:23', '22:00 - 06:23'].entries()) await setInput(`[aria-label="Application shift for ${shift}"]`, `SHIFT 0${index + 1}`);
    await checkLabel('Mapping/time difference confirmed'); await checkLabel('The printed date is the shift-start date');
    const selectedIds = ['B7:f0', 'B10:f0', 'B10:f1', 'B10:f2', 'B10:f3', 'D6:f0', 'J9:f0', 'B12:f0', 'C7:f0'];
    for (const id of selectedIds) await check(`[aria-label="Include ${id}"]`);
    for (const [key, target, unit] of [
      ['AR2|N1WB-E12606-SCP', 'N1WB-E12606-SCP', 'EA'], ['AR3|SGL RH', 'N1WB-P13036-D', 'EA'],
      ['AR3|DBL RH', 'N1WB-E13036-N', 'EA'], ['AR5|SCP', 'N1WB-E12606-SCP', 'EA'], ['BM02|CAA', 'N1WB_CAA_PAIR', 'SET'],
    ]) {
      await setInput(`[aria-label="Stock mapping ${key}"]`, target);
      await setInput(`[aria-label="Source unit ${key}"]`, unit);
      await setInput(`[aria-label="Conversion factor ${key}"]`, '1');
      await setInput(`[aria-label="Mapping explanation ${key}"]`, 'Synthetic test approval of mapping and units; no live sample approval implied.');
      await check(`[aria-label="Confirm mapping ${key}"]`);
    }
    assert.match(await rowText('B7:f0'), /Likely duplicate/);
    await check('[aria-label="Append confirmation B7:f0"]'); await check('[aria-label="Independent run B7:f0"]');
    await setInput('[aria-label="Excel quantity B7:f0"]', '57');
    await setInput('[aria-label="Excel quantity C7:f0"]', '0');
    for (const id of ['B10:f1', 'B10:f3', 'D6:f0']) await check(`[aria-label="Confirm activity ${id}"]`);
    await checkLabel('I reviewed machine/date/shift ownership');
    await until("![...document.querySelectorAll('button')].find(b=>b.textContent==='Review exact additions').disabled");
    assert.deepEqual((await stored()).planningWeeks, initial.planningWeeks);
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
    await evaluate("document.querySelector('[data-source-row=\"B10:f0\"]').scrollIntoView({block:'start'})");
    await screenshot('excel-mobile-corrections');
    await call('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
    await clickText('Review exact additions');
    assert.equal(await evaluate("document.querySelectorAll('.excel-additions-table tbody tr').length"), 8);
    assert.match(await evaluate("document.querySelector('.excel-exclusions').innerText"), /greater than zero/);
    await screenshot('excel-exact-additions');
    await checkLabel('I reviewed these exact additions');
    await evaluate("window.__originalStorageSet=window.storage.set.bind(window.storage);window.storage.set=async()=>{throw Error('Synthetic storage failure for retry verification');};");
    await clickText('Confirm import');
    await until("document.querySelector('.excel-plan-import [role=alert]')?.innerText.includes('preview is retained')");
    assert.deepEqual((await stored()).planningWeeks, initial.planningWeeks);
    assert.equal(await evaluate("document.querySelectorAll('.excel-additions-table tbody tr').length"), 8);
    await screenshot('excel-failed-save-retained');
    await evaluate('window.storage.set=window.__originalStorageSet');
    await clickText('Retry save'); await until("document.querySelector('.excel-import-success')!==null");
    await until("document.querySelector('.planner-toolbar').innerText.includes('Saved')");
    const saved = await stored(), entries = Object.values(saved.planningWeeks).flatMap((week) => week.entries || []), added = entries.filter((entry) => entry.importSource?.sourceCell);
    assert.equal(added.length, 8); assert.equal(new Set(added.map((entry) => entry.id)).size, 8);
    assert.deepEqual(added.filter((entry) => entry.machine === 'AR3').map((entry) => entry.status), ['Planned', 'Changeover', 'Planned', 'Changeover']);
    assert.equal(added.find((entry) => entry.machine === 'BM02').quantityUom, 'SET');
    assert.equal(added.find((entry) => entry.machine === 'AR2').buildQty, 57);
    assert.equal(saved.planningWeeks['2026-11-09'].excelPlanImports.length, 1);
    for (const old of initial.planningWeeks['2026-11-09'].entries) assert.deepEqual(entries.find((entry) => entry.id === old.id), old);
    assert.deepEqual(saved.planningWeeks['2026-11-16'], initial.planningWeeks['2026-11-16']);
    assert.deepEqual(saved.productionActuals, initial.productionActuals); assert.deepEqual(saved.oeeHistory, initial.oeeHistory);
    checks.push('Editable correction, explicit year/dates/shifts and shorthand/unit mappings, duplicate split-run confirmation, 8 exact valid additions; invalid selected row skipped with reason. Failed save retains the review and changes no plan; retry saves exactly one batch. Existing weeks, plans, linked Actuals and OEE are unchanged.');

    await clickText('Close import report');
    await call('Page.reload'); await until("document.querySelector('.production-overview')!==null");
    await clickText('Planning'); await until("document.querySelector('.bm-planning')!==null");
    assert.equal(Object.values((await stored()).planningWeeks).flatMap((week) => week.entries).filter((entry) => entry.importSource?.sourceCell).length, 8);
    await evaluate("document.querySelector('[aria-label=\"Edit AR2 2026-11-11 SHIFT 01\"]').click()");
    await until("document.querySelectorAll('.bm-run-editor').length===2");
    await evaluate("document.querySelector('.excel-import-source').open=true");
    assert.match(await evaluate("document.querySelector('.excel-import-source').innerText"), /Production Plan!B7/);
    await setInput('.bm-run-editor:nth-of-type(2) input[type=number]', '58');
    await clickText('Save Shift'); await until("document.querySelector('.bm-editor')===null");
    await until("document.querySelector('.planner-toolbar').innerText.includes('Saved')");
    const manual = await stored();
    assert.equal(manual.planningWeeks['2026-11-09'].entries.find((entry) => entry.id === added.find((entry) => entry.machine === 'AR2').id).buildQty, 58);
    assert.deepEqual(manual.planningWeeks['2026-11-09'].excelPlanImports, saved.planningWeeks['2026-11-09'].excelPlanImports);
    assert.deepEqual(manual.productionActuals, initial.productionActuals); assert.deepEqual(manual.oeeHistory, initial.oeeHistory);
    await upload(); await until("document.querySelectorAll('[data-source-row]').length===115");
    await setInput('.excel-plan-import input[min="1900"]', '2026'); await clickText('Fill printed dates using this year');
    await check('[aria-label="Include B7:f0"]');
    assert.match(await rowText('B7:f0'), /already imported/);
    assert.deepEqual((await stored()).planningWeeks, manual.planningWeeks);
    await evaluate('window.confirm=()=>true'); await clickText('Discard review');
    checks.push('Reload retains all imported entries and provenance. Manual editing changes quantity without changing ID, source report, Actuals or OEE. A repeated upload flags the imported source fragment even after manual edits.');

    const invalid = path.join(out, 'unsupported.xlsx'); fs.writeFileSync(invalid, 'not a workbook');
    await upload(invalid); await until("document.querySelector('.excel-plan-import [role=alert]')!==null");
    assert.match(await evaluate("document.querySelector('.excel-plan-import [role=alert]').innerText"), /not a readable/);
    assert.deepEqual((await stored()).planningWeeks, manual.planningWeeks);
    await clickText('Discard review');
    await clickText('Production MRP');
    await until("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Download PDF'&&!b.disabled)");
    const pdfName = 'Store-Request-B-RAW01-2026-11-09.pdf';
    if (fs.existsSync(path.join(out, pdfName))) fs.unlinkSync(path.join(out, pdfName));
    await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: out });
    await clickText('Download PDF');
    for (let attempt = 0; attempt < 200 && !fs.existsSync(path.join(out, pdfName)); attempt++) await pause(100);
    assert.equal(fs.readFileSync(path.join(out, pdfName)).subarray(0, 5).toString(), '%PDF-');
    checks.push('Unsupported .xlsx fails clearly without plan changes. Existing Store Request PDF downloads successfully.');
    await evaluate("const users=JSON.parse(localStorage.getItem('mrp-auth-users-v1'));users[0].role='SUPERVISOR';localStorage.setItem('mrp-auth-users-v1',JSON.stringify(users));");
    await call('Page.reload'); await until("document.querySelector('.production-overview')!==null"); await clickText('Planning');
    assert.equal(await evaluate("document.querySelector('.excel-plan-import')===null"), true);
    checks.push('Planning read/adjust permission does not grant Excel import permission.');
    assert.equal(errors.length, 0, JSON.stringify(errors)); assert.equal(sampleHash(), originalHash);
    const report = { checks, sample: path.basename(sample), sourceCells: 97, previewRows: 115, selected: 9, imported: 8, skipped: 107, runtimeExceptions: errors.length, apiWrites: 0, sampleUnchanged: true, isolatedBrowserStorageOnly: true };
    fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (socket?.readyState === WebSocket.OPEN) { await call('Browser.close').catch(() => {}); socket.close(); }
    browser.kill(); vite.kill();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
