// Isolated browser smoke check. Authentication, planner data, and SYSPRO responses are synthetic.
const assert = require("node:assert/strict");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const tabs = await (await fetch("http://127.0.0.1:9234/json")).json();
  const page = tabs.find((tab) => tab.type === "page");
  assert.ok(page, "isolated Edge page is available");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  let nextId = 0;
  const pending = new Map();
  const exceptions = [];
  let eosUnavailable = false;
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const inventory = [
    { StockCode: "120002", Description: "Synthetic Sheet A", StockUom: "EA", B_WIP01_SOH: 12.5 },
    { StockCode: "121047", Description: "Synthetic Sheet B", StockUom: "KG", B_WIP01_SOH: 0 },
    { StockCode: "120003", Description: "Synthetic Sheet C", StockUom: "EA", B_WIP01_SOH: 4 },
    { StockCode: "OPTIONAL-1", Description: "Synthetic optional", StockUom: "EA", B_WIP01_SOH: 2 },
  ];
  const apiResponse = (payload) => ({ responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(payload)).toString("base64") });

  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(message.error); else request.resolve(message.result);
      return;
    }
    if (message.method === "Fetch.requestPaused") {
      const url = message.params.request.url;
      if (url.includes('/api/syspro/cycle-count/eos')) {
        const date = new URL(url).searchParams.get('date');
        const base = date === '2026-11-12' ? 90 : 100;
        const data = inventory.flatMap((item) => ['morning', 'afternoon', 'night'].map((shift, index) => ({
          stockCode: item.StockCode, warehouse: 'B-WIP01', productionDate: date, shift,
          expectedEosSoh: base + index * 100, status: 'available',
          source: 'SYSPRO_RECONSTRUCTED_SHIFT_CLOSE', cutoffAt: `${date}T13:00:00Z`, fetchedAt: new Date().toISOString(),
        })));
        const response = apiResponse(eosUnavailable ? { success: false, error: 'Synthetic historical balance outage' } : { success: true, date, data });
        if (eosUnavailable) response.responseCode = 503;
        call('Fetch.fulfillRequest', { requestId: message.params.requestId, ...response }).catch((error) => exceptions.push({ text: error.message }));
        return;
      }
      const payload = url.includes("/api/syspro/inventory")
        ? { success: true, count: inventory.length, data: inventory }
        : { success: true, count: 0, data: [] };
      call("Fetch.fulfillRequest", { requestId: message.params.requestId, ...apiResponse(payload) }).catch((error) => {
        if (!error.message?.includes("Invalid InterceptionId")) exceptions.push({ text: error.message });
      });
      return;
    }
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails);
  });

  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression) => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await evaluate(expression)) return;
      await pause(250);
    }
    throw new Error(`Timed out: ${expression}`);
  };
  const clickText = async (text) => evaluate(`(()=>{const el=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(text)});if(!el)throw Error('Missing button '+${JSON.stringify(text)});el.click()})()`);
  const setInput = async (selector, value) => evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing input '+${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`);

  const runKey = String(Date.now());
  const initialPlannerData = { items: [], demands: [], openOrders: [], planningWeeks: {}, activeWeekStart: new Date().toISOString().slice(0, 10), selectedProductionLine: "thermoforming", cycleCountDays: [] };
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Fetch.enable", { patterns: [{ urlPattern: "http://localhost:5173/api/*", requestStage: "Request" }] });
  const injection = await call("Page.addScriptToEvaluateOnNewDocument", {
    source: `if(location.origin==='http://localhost:5173'&&localStorage.getItem('cycle-count-smoke-key')!==${JSON.stringify(runKey)}){localStorage.setItem('mrp-auth-users-v1',JSON.stringify([{id:'COUNT-SMOKE-USER',username:'count-smoke',fullName:'Synthetic Count Recorder',role:'ADMIN',isActive:true}]));localStorage.setItem('mrp-auth-session-v1',JSON.stringify({userId:'COUNT-SMOKE-USER'}));localStorage.setItem('mrp-data',${JSON.stringify(JSON.stringify(initialPlannerData))});localStorage.setItem('cycle-count-smoke-key',${JSON.stringify(runKey)});}`,
  });

  await call("Page.navigate", { url: "http://localhost:5173" });
  await until(`document.querySelector('[aria-label="Workspace"]')!==null`);
  await clickText("Cycle Count");
  await until(`document.querySelector('.cycle-count')!==null`);
  await setInput('.cc-header input[type="date"]', new Date().toISOString().slice(0, 10));
  await until(`document.querySelectorAll('.cc-entry tbody tr').length===3`);
  assert.equal(await evaluate(`[...document.querySelectorAll('.cc-entry tbody tr')].map(row=>row.querySelector('td').childNodes[0].textContent.trim()).join(',')`), "120002,121047,120003");
  assert.equal(await evaluate(`[...document.querySelectorAll('.cycle-count button')].some(button=>button.textContent.includes('Create Daily Count'))`), false);
  assert.ok(await evaluate(`document.querySelector('.cycle-count').innerText.includes('Count scope: B-WIP01')`));
  assert.ok(await evaluate(`document.querySelector('.cc-entry').innerText.includes('Required each shift')`));
  assert.ok(await evaluate(`document.querySelector('.cc-entry').innerText.includes('Synthetic Sheet A')`));
  assert.equal(await evaluate(`document.querySelector('[aria-label="Reason 120002"]')===null&&document.querySelector('[aria-label="Comment 120002"]')===null`), true);
  assert.ok(await evaluate(`document.querySelector('.cc-assignment').innerText.includes('0 of 3 required sheets counted')`));
  assert.equal(await evaluate(`document.querySelector('.cc-submit button').disabled`), true);

  await clickText("Daily Setup");
  assert.equal(await evaluate(`document.querySelectorAll('.cc-setup button[aria-label^="Remove "]').length`), 0);
  await clickText("Daily Setup");
  await setInput('input[aria-label="Physical count 120002"]', "0");
  await until(`document.querySelector('.cc-assignment').innerText.includes('1 of 3 required sheets counted')`);
  assert.ok(await evaluate(`document.querySelector('.cc-entry').innerText.includes('Counted by Synthetic Count Recorder')`));
  assert.equal(await evaluate(`document.querySelector('.cc-submit button').disabled`), true);
  await setInput('input[aria-label="Physical count 121047"]', "2.5");
  await setInput('input[aria-label="Physical count 120003"]', "4.125");
  await until(`document.querySelector('.cc-assignment').innerText.includes('3 of 3 required sheets counted')`);
  assert.equal(await evaluate(`document.querySelector('.cc-submit button').disabled`), false);
  await clickText("Submit Shift Count");
  await until(`document.querySelector('.cc-submitted')!==null`);
  await pause(900);

  const persisted = await evaluate(`JSON.parse(localStorage.getItem('mrp-data')).cycleCountDays.find(day=>day.productionLine==='thermoforming')`);
  assert.equal(persisted.countRecords.length, 9);
  const counted = persisted.countRecords.find((row) => row.shift === "morning" && row.stockCode === "120002");
  assert.equal(counted.physicalCount, 0);
  assert.equal(counted.countedByUserId, "COUNT-SMOKE-USER");
  assert.ok(counted.countedAt);
  assert.equal(counted.warehouse, "B-WIP01");
  assert.equal(counted.location, null);
  assert.equal(counted.productionDate, persisted.date);

  await call("Page.reload");
  await until(`document.querySelector('[aria-label="Workspace"]')!==null`);
  await clickText("Cycle Count");
  await until(`document.querySelectorAll('.cc-entry tbody tr').length===3`);
  assert.equal(await evaluate(`document.querySelector('input[aria-label="Physical count 120002"]').value`), "0");
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('mrp-data')).cycleCountDays.find(day=>day.productionLine==='thermoforming').countRecords.length`), 9);
  await clickText("Afternoon");
  await until(`document.querySelector('.cc-assignment').innerText.includes('0 of 3 required sheets counted')`);
  assert.equal(await evaluate(`document.querySelector('input[aria-label="Physical count 120002"]').value`), "");
  await clickText("Morning");
  await until(`document.querySelector('.cc-assignment').innerText.includes('3 of 3 required sheets counted')`);
  assert.equal(await evaluate(`document.querySelector('input[aria-label="Physical count 120002"]').value`), "0");
  const nextDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await setInput('.cc-header input[type="date"]', nextDate);
  await until(`document.querySelectorAll('.cc-entry tbody tr').length===3`);
  assert.equal(await evaluate(`document.querySelector('input[aria-label="Physical count 120002"]').value`), "");
  await setInput('.cc-header input[type="date"]', new Date().toISOString().slice(0, 10));
  await until(`document.querySelector('.cc-assignment').innerText.includes('3 of 3 required sheets counted')`);
  assert.equal(await evaluate(`document.querySelector('input[aria-label="Physical count 120002"]').value`), "0");
  await setInput('.cc-header input[type="date"]', '2026-11-13');
  await until(`document.querySelector('.cc-entry tbody tr td:nth-child(5)').textContent==='100'`);
  await clickText('Afternoon');
  await until(`document.querySelector('.cc-entry tbody tr td:nth-child(5)').textContent==='200'`);
  await clickText('Night');
  await until(`document.querySelector('.cc-entry tbody tr td:nth-child(5)').textContent==='300'`);
  await clickText('Daily Summary');
  assert.equal(await evaluate(`document.querySelector('.cc-summary tbody tr td:nth-child(4)').textContent`), '100');
  assert.equal(await evaluate(`document.querySelector('.cc-summary tbody tr td:nth-child(8)').textContent`), '200');
  assert.equal(await evaluate(`document.querySelector('.cc-summary tbody tr td:nth-child(12)').textContent`), '300');
  await clickText('Count Entry');
  await clickText('Morning');
  await setInput('.cc-header input[type="date"]', '2026-11-12');
  await until(`document.querySelector('.cc-entry tbody tr td:nth-child(5)').textContent==='90'`);
  await setInput('input[aria-label="Physical count 120002"]', '9');
  await until(`document.querySelector('.cc-entry tbody tr td:nth-child(7)').textContent==='-81'`);
  eosUnavailable = true;
  await clickText('Refresh EOS');
  await until(`document.querySelector('.cc-eos-source').innerText.includes('Synthetic historical balance outage')`);
  assert.equal(await evaluate(`document.querySelector('.cc-entry tbody tr td:nth-child(5)').textContent`), 'Unavailable');
  assert.equal(await evaluate(`document.querySelector('.cc-entry tbody tr td:nth-child(7)').textContent`), '—');
  assert.equal(await evaluate(`document.querySelector('input[aria-label="Physical count 120002"]').value`), '9');
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));

  await call("Fetch.disable");
  await call("Page.removeScriptToEvaluateOnNewDocument", { identifier: injection.identifier });
  socket.close();
  console.log("Synthetic Cycle Count browser smoke passed: required rows, save/reopen, historical EOS by date/shift, daily summary, and no live-stock or saved-variance fallback during outages.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
