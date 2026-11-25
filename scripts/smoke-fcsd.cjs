// Isolated browser smoke check. API data, user/session, and planner storage are synthetic.
const assert = require("node:assert/strict");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const tabs = await (await fetch("http://127.0.0.1:9233/json")).json();
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
  const parts = [
    { stockCode: "N1WZ-17906-HU", description: "FCSD RSB", uom: "EA", isBomParent: true, isBomComponent: false },
    { stockCode: "N1WZ-16451-H", description: "FCSD Side Step", uom: "EA", isBomParent: true, isBomComponent: false },
    { stockCode: "N1WB-16451-KA", description: "OEM Side Step", uom: "EA", isBomParent: true, isBomComponent: false },
    { stockCode: "N2WZ-12345-X", description: "Unmapped FCSD candidate", uom: "EA", isBomParent: true, isBomComponent: false },
    { stockCode: "SHARED-001", description: "Shared component", uom: "EA", isBomParent: false, isBomComponent: true },
  ];
  const bom = [
    { parentStockCode: "N1WZ-17906-HU", parentUom: "EA", componentStockCode: "SHARED-001", componentDescription: "Shared component", componentUom: "EA", factorUnitsVerified: true, qtyPerBasis: "stocking", qtyPer: 2 },
    { parentStockCode: "N1WZ-16451-H", parentUom: "EA", componentStockCode: "SHARED-001", componentDescription: "Shared component", componentUom: "EA", factorUnitsVerified: true, qtyPerBasis: "stocking", qtyPer: 5 },
  ];
  const response = (payload) => ({ responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(payload)).toString("base64") });

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
      const payload = url.includes("/api/syspro/fcsd/parts")
        ? { success: true, count: parts.length, data: parts, fetchedAt: "2026-11-12T10:00:00.000Z", coverage: "Synthetic all-InvMaster candidate snapshot." }
        : url.includes("/api/syspro/fcsd/bom")
          ? { success: true, count: bom.length, data: bom, fetchedAt: "2026-11-12T10:00:01.000Z", snapshot: true, revisionMetadataAvailable: false }
          : { success: true, count: 0, data: [] };
      call("Fetch.fulfillRequest", { requestId: message.params.requestId, ...response(payload) }).catch((error) => {
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
  const setSelect = async (selector, value) => evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing select '+${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const setInput = async (selector, value) => evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const clickText = async (text) => evaluate(`(()=>{const el=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(text)});if(!el)throw Error('Missing button '+${JSON.stringify(text)});el.click()})()`);

  const runKey = String(Date.now());
  const initialPlannerData = { items: [], demands: [{ id: "KEEP-ME" }], openOrders: [], selectedProductionLine: "thermoforming" };
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Fetch.enable", { patterns: [{ urlPattern: "http://localhost:5173/api/*", requestStage: "Request" }] });
  const injection = await call("Page.addScriptToEvaluateOnNewDocument", {
    source: `if(location.origin==='http://localhost:5173'&&localStorage.getItem('fcsd-smoke-key')!==${JSON.stringify(runKey)}){localStorage.setItem('mrp-auth-users-v1',JSON.stringify([{id:'FCSD-SMOKE-USER',username:'fcsd-smoke',fullName:'Synthetic FCSD User',role:'ADMIN',isActive:true}]));localStorage.setItem('mrp-auth-session-v1',JSON.stringify({userId:'FCSD-SMOKE-USER'}));localStorage.setItem('mrp-data',${JSON.stringify(JSON.stringify(initialPlannerData))});localStorage.setItem('fcsd-smoke-key',${JSON.stringify(runKey)});}`,
  });

  await call("Page.navigate", { url: "http://localhost:5173" });
  await until(`document.querySelector('[aria-label="Workspace"]')!==null`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Workspace"] option[value="fcsd"]').textContent`), "FCSD Tracker");
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('mrp-data')).selectedProductionLine`), "thermoforming");
  await setSelect('[aria-label="Workspace"]', "fcsd");
  await until(`document.querySelector('.fcsd-tracker h1')?.textContent==='FCSD Tracker'`);
  assert.ok(await evaluate(`document.querySelector('.fcsd-tracker').innerText.includes('not approved for scheduling')`));
  assert.ok(await evaluate(`document.querySelector('.fcsd-list').innerText.includes('N1WZ-17906-HU')`));
  assert.ok(!(await evaluate(`document.querySelector('.fcsd-list').innerText.includes('N1WB-16451-KA')`)));
  await setSelect(".fcsd-filters select", "Unclassified");
  assert.ok(await evaluate(`document.querySelector('.fcsd-list').innerText.includes('N2WZ-12345-X')`));
  assert.ok(!(await evaluate(`document.querySelector('.fcsd-list').innerText.includes('N1WZ-17906-HU')`)));
  await setSelect(".fcsd-filters select", "");

  await clickText("Add");
  await evaluate(`([...document.querySelectorAll('.fcsd-list button')].find(button=>button.textContent.trim()==='Add')).click()`);
  await until(`document.querySelectorAll('input[aria-label^="Quantity for "]').length===2`);
  await setInput('input[aria-label="Quantity for N1WZ-17906-HU"]', "3");
  await setInput('input[aria-label="Quantity for N1WZ-16451-H"]', "4");
  await until(`document.querySelector('.fcsd-results')?.innerText.includes('26')`);
  assert.ok(await evaluate(`document.querySelector('.fcsd-results').innerText.includes('SHARED-001')`));
  assert.ok(await evaluate(`document.querySelector('.fcsd-results').innerText.includes('N1WZ-17906-HU: 6')`));
  assert.ok(await evaluate(`document.querySelector('.fcsd-results').innerText.includes('N1WZ-16451-H: 20')`));
  await evaluate(`window.confirm=()=>{window.__fcsdLeavePrompted=true;return true}`);
  await setSelect('[aria-label="Workspace"]', "thermoforming");
  await until(`!document.querySelector('.fcsd-tracker')`);
  await pause(900);
  assert.equal(await evaluate(`window.__fcsdLeavePrompted`), true);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('mrp-data')).selectedProductionLine`), "thermoforming");
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('mrp-data')).demands[0].id`), "KEEP-ME");
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));

  await call("Fetch.disable");
  await call("Page.removeScriptToEvaluateOnNewDocument", { identifier: injection.identifier });
  socket.close();
  console.log("Synthetic FCSD browser smoke checks passed: selector isolation, classification picker, quantities, shared gross totals, contributions, leave warning, and preserved planner state.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
