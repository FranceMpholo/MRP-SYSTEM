// Browser smoke using isolated Edge CDP storage and synthetic API responses only.
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
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const inventory = [
    { StockCode: "BED-1", Description: "Synthetic Bedliner", StockUom: "EA" },
    { StockCode: "TAIL-1", Description: "Synthetic Tailgate", StockUom: "EA" },
    { StockCode: "120002", Description: "Synthetic Sheet A", StockUom: "SHEET", B_WIP01_SOH: 40 },
    { StockCode: "121047", Description: "Synthetic Sheet B", StockUom: "KG", B_WIP01_SOH: 0 },
    { StockCode: "120003", Description: "Synthetic Sheet C", StockUom: "EA", B_WIP01_SOH: 7 },
  ];
  const boms = [
    { parentStockCode: "BED-1", parentDescription: "Synthetic Bedliner", componentStockCode: "120002", componentDescription: "Synthetic Sheet A", parentUom: "EA", componentUom: "SHEET", factorUnitsVerified: true, qtyPerBasis: "stocking", qtyPer: 2.5 },
    { parentStockCode: "BED-1", parentDescription: "Synthetic Bedliner", componentStockCode: "121047", componentDescription: "Synthetic Sheet B", parentUom: "EA", componentUom: "KG", factorUnitsVerified: true, qtyPerBasis: "stocking", qtyPer: 0.5 },
    { parentStockCode: "TAIL-1", parentDescription: "Synthetic Tailgate", componentStockCode: "120002", componentDescription: "Synthetic Sheet A", parentUom: "EA", componentUom: "SHEET", factorUnitsVerified: true, qtyPerBasis: "stocking", qtyPer: 1.25 },
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
      const payload = url.includes("/api/syspro/inventory")
        ? { success: true, count: inventory.length, data: inventory }
        : url.includes("/api/syspro/bom")
          ? { success: true, count: boms.length, data: boms }
          : url.includes("/api/syspro/oee/finished-goods")
            ? { success: true, data: [{ date: "2026-11-13", stockCode: "BED-1", uom: "EA", direction: "Into FG", quantity: 6 }, { date: "2026-11-13", stockCode: "BED-1", uom: "EA", direction: "FG to WIP", quantity: 1 }], fetchedAt: "2026-11-13T17:00:00.000Z", shiftAllocation: false, basis: "Synthetic posting-date fixture; no shift allocation." }
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
  const setSelect = async (selector, value) => evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing select '+${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const runKey = String(Date.now());
  const planner = {
    items: [], demands: [], openOrders: [], planning: { weekStart: "2026-11-09", entries: [] }, planningWeeks: {
      "2026-11-09": { weekStart: "2026-11-09", entries: [
        { id: "plan-bed", productionLine: "thermoforming", day: "2026-11-13", shift: "SHIFT 01", machine: "AR1", partNumber: "BED-1", status: "Planned", buildQty: 20 },
        { id: "plan-tail", productionLine: "thermoforming", day: "2026-11-13", shift: "SHIFT 01", machine: "AR3", partNumber: "TAIL-1", status: "Planned", buildQty: 10 },
      ] },
    }, activeWeekStart: "2026-11-09", selectedProductionLine: "thermoforming", horizon: 1,
    productionActuals: [
      { id: "actual-bed", planningEntryId: "plan-bed", actualMouldQty: 8, updatedAt: "2026-11-13T13:00:00.000Z" },
      { id: "actual-tail", planningEntryId: "plan-tail", actualMouldQty: 4, updatedAt: "2026-11-13T14:00:00.000Z" },
    ],
    cycleCountDays: [{
      id: "count-day", date: "2026-11-13", productionLine: "thermoforming", warehouse: "B-WIP01",
      shifts: [{ shift: "morning", submittedByUserId: "SHEET-SMOKE-USER", submittedAt: "2026-11-13T15:00:00.000Z" }],
      countRecords: ["120002", "121047", "120003"].map((stockCode, index) => ({ id: `count-${index}`, stockCode, shift: "morning", warehouse: "B-WIP01", location: null, physicalCount: index === 0 ? 0 : 5 + index, countedAt: "2026-11-13T14:50:00.000Z", countedByUserId: "SHEET-SMOKE-USER" })),
    }],
  };
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Fetch.enable", { patterns: [{ urlPattern: "http://localhost:5173/api/*", requestStage: "Request" }] });
  const injection = await call("Page.addScriptToEvaluateOnNewDocument", { source: `if(location.origin==='http://localhost:5173'&&localStorage.getItem('sheet-analysis-smoke-key')!==${JSON.stringify(runKey)}){localStorage.setItem('mrp-auth-users-v1',JSON.stringify([{id:'SHEET-SMOKE-USER',username:'sheet-smoke',fullName:'Synthetic Sheet Analyst',role:'ADMIN',isActive:true}]));localStorage.setItem('mrp-auth-session-v1',JSON.stringify({userId:'SHEET-SMOKE-USER'}));localStorage.setItem('mrp-data',${JSON.stringify(JSON.stringify(planner))});localStorage.setItem('sheet-analysis-smoke-key',${JSON.stringify(runKey)});}` });
  await call("Page.navigate", { url: "http://localhost:5173" });
  await until(`document.querySelector('[aria-label="Workspace"]')!==null`);
  await until(`document.querySelector('#sheet-analysis-title')!==null`);
  await setInput('.sheet-analysis input[type="date"]', "2026-11-13");
  await until(`document.querySelector('.sheet-analysis-fg tbody tr td')?.innerText.includes('BED-1')`);
  assert.equal(await evaluate(`document.querySelectorAll('.sheet-analysis-card').length`), 3);
  const cardText = await evaluate(`document.querySelector('.sheet-analysis-card').innerText`);
  assert.ok(cardText.includes("120002"));
  assert.ok(await evaluate(`document.querySelector('.sheet-analysis-card dl>div:nth-child(1) dd').innerText.includes('0')`), cardText);
  assert.ok(await evaluate(`document.querySelector('.sheet-analysis-card dl>div:nth-child(2) dd').innerText.includes('25')`), cardText);
  assert.ok(cardText.includes("Historical system balance unavailable"), cardText);
  assert.ok(cardText.includes("timing not aligned"), cardText);
  const fgText = await evaluate(`document.querySelector('.sheet-analysis-fg').innerText`);
  assert.ok(fgText.toLowerCase().includes("posted into fg"), fgText);
  await clickText("Show evidence");
  const evidence = await evaluate(`document.querySelector('.sheet-analysis-evidence').innerText`);
  assert.ok(/2[,.]5/.test(evidence), evidence);
  assert.ok(evidence.includes("BOM snapshot"), evidence);
  await setSelect('.sheet-analysis select', "afternoon");
  await until(`document.querySelector('.sheet-analysis-card').innerText.includes('No Cycle Count record')`);
  await clickText("Show evidence");
  assert.ok((await evaluate(`document.querySelector('.sheet-analysis-evidence').innerText`)).includes("No planned Thermoforming production entries"));
  await setSelect('.sheet-analysis select', "morning");
  await clickText("Cycle Count");
  await until(`document.querySelector('.cycle-count')!==null`);
  await clickText("Dashboard");
  await until(`document.querySelector('#sheet-analysis-title')!==null`);
  await clickText("Production Actuals");
  await until(`document.querySelector('.production-actuals')!==null`);
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  await call("Fetch.disable");
  await call("Page.removeScriptToEvaluateOnNewDocument", { identifier: injection.identifier });
  socket.close();
  console.log("Synthetic Sheet Analysis browser smoke passed: date/shift filters, three sheets, count zero, direct consolidated QtyPer, unavailable historical variance, separate FG posting, evidence expansion, and navigation links.");
})().catch((error) => { console.error(error); process.exit(1); });
