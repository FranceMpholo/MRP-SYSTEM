// Runs the supplied workbook in an isolated Edge profile with synthetic business
// data. All API requests are intercepted; no live plans, Actuals or OEE are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sample = path.resolve(process.argv[2] || path.join(root, 'tests/fixtures/Production plan 17 Nov 2026 Rev2.xlsx'));
const out = path.join(root, 'diagnostics/planning-excel-profile');
const origin = 'http://127.0.0.1:5177', debugUrl = 'http://127.0.0.1:9239';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sampleHash = () => crypto.createHash('sha256').update(fs.readFileSync(sample)).digest('hex');
const originalHash = sampleHash();
const fixture = require('../tests/fixtures/planningProfileFixture.cjs');
const { parentCodes, boms } = fixture;
const seed = {
  items: fixture.items,
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
  await Promise.all([free(5177), free(9239)]);
  fs.mkdirSync(out, { recursive: true });
  const vite = spawn(process.execPath, [path.join(root, 'mrp-planner/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5177', '--strictPort'], { cwd: path.join(root, 'mrp-planner'), windowsHide: true, stdio: 'ignore' });
  const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=9239', `--user-data-dir=${path.join(out, `edge-profile-${Date.now()}`)}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
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
    const clickWithin = async (selector, text) => { await evaluate(`(()=>{const root=document.querySelector(${JSON.stringify(selector)});const button=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!button||button.disabled)throw Error('Missing/disabled '+${JSON.stringify(text)});button.click();})()`); await pause(60); };
    const uploadReady = async (file = sample) => { await upload(file); await until("document.querySelector('.excel-compact-summary')!==null || document.querySelector('.excel-plan-import [role=alert]')!==null"); const error = await evaluate("document.querySelector('.excel-plan-import [role=alert]')?.innerText"); assert.equal(error, undefined, error); };
    const cancel = async () => { await evaluate('window.confirm=()=>true'); await clickText('Cancel preview'); await until("document.querySelector('.excel-compact-summary')===null"); };
    const approveShifts = async () => {
      for (const [index, key] of ['06:00-14:23', '14:00-22:23', '22:00-06:23'].entries()) await setInput(`[aria-label="Shift mapping ${key}"]`, `SHIFT 0${index + 1}`);
      await setInput('[aria-label="Overnight date rule"]', 'start-date'); await clickText('Approve shift profile');
    };
    const configure = async () => {
      if (await evaluate("Boolean(document.querySelector('[data-shift-question]'))")) await approveShifts();
      let codeApprovals = 0, quantityApprovals = 0;
      while (await evaluate("Boolean(document.querySelector('[data-code-question]'))")) {
        if (++codeApprovals > 15) throw Error('Repeated code question did not resolve');
        const question = await evaluate("(()=>{const el=document.querySelector('[data-code-question]');return {key:el.dataset.codeQuestion,token:el.dataset.codeQuestion.split('|')[1],productionLine:el.dataset.codeQuestion.split('|')[0],machines:[...el.querySelector('select').options].map(o=>o.value).filter(v=>v.startsWith('machine:')).map(v=>v.slice(8))};})()");
        const [target, scope] = fixture.codeChoice(question); assert.ok(target, JSON.stringify(question));
        await setInput(`[aria-label="Scope ${question.key}"]`, scope);
        await setInput(`[aria-label="Code mapping ${question.key}"]`, target);
        await clickWithin(`[data-code-question="${question.key}"]`, 'Approve code mapping');
      }
      while (await evaluate("Boolean(document.querySelector('[data-quantity-question]'))")) {
        if (++quantityApprovals > 8) throw Error('Repeated quantity question did not resolve');
        const key = await evaluate("document.querySelector('[data-quantity-question]').dataset.quantityQuestion");
        await setInput(`[aria-label="Quantity unit ${key}"]`, key.split('|')[1]);
        await setInput(`[aria-label="Quantity factor ${key}"]`, '1');
        await clickWithin(`[data-quantity-question="${key}"]`, 'Approve quantity rule');
      }
      return { codeApprovals, quantityApprovals };
    };
    const resolveSplits = async () => {
      let decisions = 0;
      while (await evaluate("Boolean(document.querySelector('[aria-label^=\"Confirm separate runs\"]'))")) {
        if (++decisions > 12) throw Error('Exception did not resolve');
        await evaluate("document.querySelector('[aria-label^=\"Confirm separate runs\"]').click()"); await pause(80);
      }
      return decisions;
    };
    await uploadReady();
    assert.equal(await evaluate("document.querySelectorAll('[data-date-question]').length"), 0);
    assert.match(await evaluate("document.querySelector('[data-date-range]').innerText"), /2026-11-17.*2026-11-20/);
    assert.equal(await evaluate("document.querySelectorAll('[data-code-question]').length"), 5);
    assert.ok(await evaluate("document.querySelectorAll('[data-exception-cell]').length<6"), 'setup decisions should not repeat as per-row exceptions');
    await approveShifts(); await cancel();
    assert.deepEqual((await stored()).planningWeeks, initial.planningWeeks);
    assert.deepEqual((await stored()).planningImportProfiles, initial.planningImportProfiles);
    checks.push('Original OneDrive workbook recognized as the normal grid; filename year validated against every printed weekday. Cancelled first-use profile approval changes no saved profile or plan.');

    await uploadReady(); const approvals = await configure();
    assert.deepEqual(approvals, { codeApprovals: 6, quantityApprovals: 3 });
    const firstSplitDecisions = await resolveSplits();
    await until("document.querySelector('[data-ready-count]').textContent==='123'");
    assert.equal(await evaluate("document.querySelectorAll('[data-date-question],[data-code-question],[data-quantity-question],[data-shift-question]').length"), 0);
    assert.equal(await evaluate("document.querySelectorAll('[data-confirm-import]').length"), 1);
    await evaluate("document.querySelector('.excel-ready-details').open=true");
    const targetRows = await evaluate("[...document.querySelectorAll('[data-ready-row]')].filter(r=>r.cells[5].textContent==='Table 1!F4').map(r=>[r.cells[0].textContent,r.cells[1].innerText,r.cells[2].textContent,r.cells[3].textContent,r.cells[4].textContent])");
    assert.equal(targetRows.length, 3); assert.match(targetRows[0][1], /2026-11-18.*SHIFT 02/s);
    assert.deepEqual(targetRows.map((r) => [r[2], r[3], r[4]]), [['Planned', 'N1WB-J12606-SAH', '10 EA'], ['Changeover', '—', '—'], ['Planned', 'R1WB-E12606-AF', '30 EA']]);
    await evaluate("document.querySelector('.excel-ready-details').open=false;document.querySelector('.excel-plan-import').scrollIntoView({block:'start'})");
    await screenshot('first-profile-compact-preview');
    assert.deepEqual((await stored()).planningImportProfiles, initial.planningImportProfiles, 'approvals are not saved before final confirmation');
    await evaluate("window.__realStorageSet=window.storage.set.bind(window.storage);window.storage.set=async()=>{throw Error('Synthetic profile save failure');};");
    await evaluate("document.querySelector('[data-confirm-import]').click()");
    await until("document.querySelector('.excel-plan-import [role=alert]')?.innerText.includes('Synthetic profile save failure')");
    assert.deepEqual((await stored()).planningWeeks, initial.planningWeeks);
    assert.deepEqual((await stored()).planningImportProfiles, initial.planningImportProfiles);
    assert.equal(await evaluate("document.querySelector('[data-ready-count]').textContent"), '123');
    await evaluate('window.storage.set=window.__realStorageSet');
    await evaluate("document.querySelector('[data-confirm-import]').click()");
    await until("document.querySelector('.excel-import-success')!==null");
    await until("document.querySelector('.planner-toolbar').innerText.includes('Saved')");
    const first = await stored(), profileId = 'production-plan-grid-xlsx-v1', profile = first.planningImportProfiles[profileId];
    const imported = (value) => Object.values(value.planningWeeks).flatMap((week) => week.entries || []).filter((entry) => entry.importSource?.profileId);
    assert.equal(imported(first).length, 123); assert.equal(profile.revision, 1);
    assert.equal(Object.keys(profile.codeMappings).length, 6); assert.equal(Object.keys(profile.quantityRules).length, 3);
    assert.equal(profile.codeMappings['machine:BM01|BAA'].target, 'N1WB_BAA_PAIR');
    assert.equal(profile.codeMappings['machine:BM03|BAA'].target, 'N1XB_BAA_PAIR');
    for (const week of Object.values(initial.planningWeeks)) for (const old of week.entries) assert.deepEqual(Object.values(first.planningWeeks).flatMap((week) => week.entries).find((entry) => entry.id === old.id), old);
    assert.deepEqual(first.productionActuals, initial.productionActuals); assert.deepEqual(first.oeeHistory, initial.oeeHistory);
    checks.push('First upload groups six scoped shorthand approvals and three quantity rules; valid full codes read directly. One final confirmation saves 123 ordered activities plus the profile. Failed save retains preview and changes neither profile nor plan; retry saves once.');
    await clickText('Close import report');
    await call('Page.reload'); await until("document.querySelector('.production-overview')!==null"); await clickText('Planning');
    const secondFile = path.join(out, 'Production plan 24 Nov 2026 Rev2 test.xlsx'); fs.writeFileSync(secondFile, fixture.nextWorkbook());
    await uploadReady(secondFile);
    assert.equal(await evaluate("document.querySelectorAll('[data-date-question],[data-code-question],[data-quantity-question],[data-shift-question]').length"), 0);
    assert.match(await evaluate("document.querySelector('[data-date-range]').innerText"), /2026-11-24.*2026-11-27/);
    assert.match(await evaluate("document.querySelector('.excel-profile-status').innerText"), /Saved profile loaded.*no mapping questions/);
    const secondSplitDecisions = await resolveSplits();
    assert.equal(await evaluate("document.querySelector('[data-ready-count]').textContent"), '123');
    await evaluate("document.querySelector('.excel-plan-import').scrollIntoView({block:'start'})"); await screenshot('second-upload-no-questions');
    await evaluate("document.querySelector('[data-confirm-import]').click()"); await until("document.querySelector('.excel-import-success')!==null");
    await until("document.querySelector('.planner-toolbar').innerText.includes('Saved')");
    const second = await stored();
    assert.equal(imported(second).length, 246); assert.equal(new Set(imported(second).map((entry) => entry.id)).size, 246);
    assert.deepEqual(second.planningImportProfiles[profileId], profile, 'reusing approvals preserves their original reviewer/revision');
    assert.deepEqual(second.productionActuals, initial.productionActuals); assert.deepEqual(second.oeeHistory, initial.oeeHistory);
    checks.push('Second workbook retains the original grid and advances one week. After browser reload, saved approvals automatically apply: zero year or mapping questions, one final import confirmation. Only three source-cell split-output exceptions need review.');
    await clickText('Close import report');
    await evaluate("document.querySelector('[aria-label=\"Edit AR1 2026-11-25 SHIFT 02\"]').click()");
    await until("document.querySelectorAll('.bm-run-editor').length===3");
    await setInput('.bm-run-editor:nth-of-type(1) input[type=number]', '11'); await clickText('Save Shift');
    await until("document.querySelector('.planner-toolbar').innerText.includes('Saved')");
    const manual = await stored(); assert.ok(imported(manual).some((entry) => entry.day === '2026-11-25' && entry.partNumber === 'N1WB-J12606-SAH' && entry.buildQty === 11));
    await uploadReady(secondFile);
    assert.equal(await evaluate("document.querySelector('[data-ready-count]').textContent"), '0');
    assert.equal(await evaluate("document.querySelector('[data-duplicate-count]').textContent"), '123');
    assert.equal(await evaluate("document.querySelector('[data-confirm-import]').disabled"), true);
    await cancel(); assert.deepEqual((await stored()).planningWeeks, manual.planningWeeks);
    checks.push('Manual editing remains available; repeat upload skips every imported source fragment even after a manual quantity change.');

    const unknownFile = path.join(out, 'Production plan 24 Nov 2026 unknown test.xlsx'); fs.writeFileSync(unknownFile, fixture.nextWorkbook({ unknown: true }));
    await uploadReady(unknownFile);
    assert.equal(await evaluate("document.querySelectorAll('[data-code-question]').length"), 1);
    assert.match(await evaluate("document.querySelector('[data-code-question]').innerText"), /NEWCODE.*2 rows/s);
    assert.equal(await evaluate("document.querySelector('[data-confirm-import]').disabled"), true);
    await setInput('[aria-label="Scope thermoforming|NEWCODE"]', 'machine:AR2');
    await setInput('[aria-label="Find code thermoforming|NEWCODE"]', 'N1WB-E12606-SCP');
    await setInput('[aria-label="Code mapping thermoforming|NEWCODE"]', 'N1WB-E12606-SCP');
    await clickWithin('[data-code-question="thermoforming|NEWCODE"]', 'Approve code mapping');
    assert.equal(await evaluate("document.querySelectorAll('[data-code-question]').length"), 0);
    await cancel(); assert.deepEqual((await stored()).planningImportProfiles[profileId], profile);
    const conflictFile = path.join(out, 'Production plan 24 Nov 2025 conflict test.xlsx'); fs.writeFileSync(conflictFile, fixture.nextWorkbook());
    await uploadReady(conflictFile);
    assert.equal(await evaluate("document.querySelectorAll('[data-date-question]').length"), 1);
    assert.equal(await evaluate("document.querySelectorAll('[data-code-question],[data-quantity-question],[data-shift-question]').length"), 0);
    assert.match(await evaluate("document.querySelector('[data-date-question]').innerText"), /Date conflict/);
    assert.equal(await evaluate("document.querySelector('[data-confirm-import]').disabled"), true);
    await setInput('[aria-label="Workbook year"]', '2026'); await clickText('Confirm workbook dates');
    assert.equal(await evaluate("document.querySelectorAll('[data-date-question]').length"), 0);
    await cancel(); assert.deepEqual((await stored()).planningWeeks, manual.planningWeeks);
    checks.push('An unknown shorthand appearing twice asks one scoped question. A filename/weekday conflict raises one workbook question and blocks confirmation until corrected. Cancelling either leaves saved approvals and plans unchanged.');

    assert.equal(errors.length, 0, JSON.stringify(errors)); assert.equal(sampleHash(), originalHash);
    const report = { checks, sample: path.basename(sample), isolatedSyntheticStorageOnly: true, liveRowsAdded: 0, originalWorkbookUnchanged: true,
      firstUpload: { yearQuestions: 0, ...approvals, exceptionCellDecisions: firstSplitDecisions, imported: 123, finalConfirmations: 1 },
      secondUpload: { yearQuestions: 0, mappingQuestions: 0, exceptionCellDecisions: secondSplitDecisions, imported: 123, finalConfirmations: 1 },
      unknownCodeQuestions: 1, conflictQuestions: 1, failedSaveRetriedWithoutDuplicates: true, existingPlansActualsOeePreserved: true, runtimeExceptions: errors.length, apiWrites: requests.filter((request) => request.method !== 'GET').length };
    fs.writeFileSync(path.join(out, 'acceptance-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } finally {
    if (socket?.readyState === WebSocket.OPEN) { await call('Browser.close').catch(() => {}); socket.close(); }
    browser.kill(); vite.kill();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
