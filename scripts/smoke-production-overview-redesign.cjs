// Run against a NEW disposable Edge profile on CDP 9248 and local Vite on 5173.
// Every API request is fulfilled here; no backend or business records are used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const origin = "http://127.0.0.1:5173";
const output = path.resolve(__dirname, "../diagnostics/production-overview-redesign");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(); let id = 0;
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data); if (!message.id) return;
    const item = pending.get(message.id); pending.delete(message.id);
    if (message.error) item.reject(new Error(JSON.stringify(message.error))); else item.resolve(message.result);
  });
  return { call: (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }), close: () => socket.close() };
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  assert.equal((await fetch(origin)).status, 200);
  let tabs;
  for (let attempt = 0; attempt < 100 && !tabs; attempt++) {
    try { tabs = await (await fetch("http://127.0.0.1:9248/json")).json(); }
    catch (error) { if (attempt === 99) throw error; await pause(100); }
  }
  const socket = new WebSocket(tabs.find((tab) => tab.type === "page" && !tab.url.startsWith('edge:')).webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  let nextId = 0, injection, sourceMode = "ready";
  const pending = new Map(), exceptions = [], requests = [], checks = [], layouts = [];
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  const fixture = (url) => url.includes("/fcsd/parts") ? [{ stockCode: "N1WZ-17906-HU", description: "Synthetic FCSD RSB", uom: "EA", isBomParent: true }]
    : url.includes("/inventory") ? [{ StockCode: "N1WB-E12606-SCP", StockUom: "EA" }, { StockCode: "120002", StockUom: "SHEET" }]
      : url.includes("/bom") ? [{ parentStockCode: "N1WB-E12606-SCP", componentStockCode: "120002", qtyPer: 1 }]
        : [];
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = pending.get(message.id); pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result);
      return;
    }
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails);
    if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      (async () => {
        if (request.url.startsWith(`${origin}/api/`)) {
          requests.push({ url: request.url, method: request.method });
          assert.equal(request.method, "GET", "browser must never write to APIs");
          const mode = sourceMode;
          if (mode === "loading") await pause(2000);
          await call("Fetch.fulfillRequest", { requestId, responseCode: mode === "error" ? 503 : 200,
            responseHeaders: [{ name: "Content-Type", value: "application/json" }],
            body: Buffer.from(JSON.stringify(mode === "error" ? { success: false, error: "Synthetic source unavailable" } : { success: true, data: fixture(request.url), fetchedAt: "2026-11-13T17:00:00Z" })).toString("base64") });
        } else if (request.url.startsWith(origin)) await call("Fetch.continueRequest", { requestId });
        else await call("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
      })().catch((error) => {
        // Route changes can abort a request after CDP has paused it.
        if (!error.message.includes("Invalid InterceptionId")) exceptions.push({ text: error.message });
      });
    }
  });
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression) => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(expression)) return; await pause(100); }
    throw new Error(`Timed out: ${expression}`);
  };
  const click = async (selector) => { await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing '+${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});el.click()})()`); await pause(60); };
  const clickText = async (text) => { await evaluate(`(()=>{const el=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!el)throw Error('Missing '+${JSON.stringify(text)});el.click()})()`); await pause(60); };
  const back = async () => { await click('.production-overview-back'); await until("document.querySelectorAll('.production-overview-card').length===6"); };
  const line = () => evaluate(`document.querySelector('[aria-label="Workspace"]').value`);
  const cardText = (id) => evaluate(`document.querySelector('[data-card="${id}"]').innerText`);
  const mouseClick = async (selector) => {
    const point = await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
  };
  const openInfo = async (id) => {
    await click(`[data-production-info="${id}"]`);
    await until(`document.querySelector('#overview-${id}-information')!==null`);
    assert.equal(await evaluate("document.querySelectorAll('.production-overview-card').length"), 6, "info must not navigate");
    assert.equal(await evaluate("document.querySelectorAll('.production-card-popover').length"), 1);
  };
  const closeInfo = async (id) => {
    await click(".production-card-popover > header button");
    await until("document.querySelector('.production-card-popover')===null");
    assert.equal(await evaluate("document.activeElement.dataset.productionInfo"), id, "focus returns to the info trigger");
  };
  const notes = async (id) => {
    await openInfo(id);
    const result = await evaluate("document.querySelector('.production-card-popover-content').innerText");
    await closeInfo(id);
    return result;
  };
  const fitsViewport = async () => assert.ok(await evaluate("(()=>{const r=document.querySelector('.production-card-popover').getBoundingClientRect();return r.left>=11&&r.top>=11&&r.right<=innerWidth-11&&r.bottom<=innerHeight-11;})()"), "popover fits visible viewport");
  const resize = async (width, height) => { await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }); await pause(80); };
  const equalCards = async (label, columns) => {
    const layout = await evaluate(`(()=>{
      const grid=document.querySelector('.production-overview-grid');
      const cards=[...grid.children].map(card=>{const r=card.getBoundingClientRect();return {id:card.dataset.card,x:r.x,y:r.y,width:r.width,height:r.height,contentFits:card.scrollWidth<=card.clientWidth+1&&card.scrollHeight<=card.clientHeight+1};});
      return {viewport:innerWidth,columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,cards};
    })()`);
    assert.equal(layout.columns, columns, label);
    assert.ok(layout.cards.every((card) => Math.abs(card.width-layout.cards[0].width)<1 && Math.abs(card.height-layout.cards[0].height)<1 && card.contentFits), `${label}: all six cards have equal dimensions with no clipping`);
    assert.ok(await evaluate(`document.querySelector('.planner-main').scrollWidth<=document.querySelector('.planner-main').clientWidth+1`), `${label}: no horizontal workspace overflow`);
    layouts.push({ label, ...layout });
    return layout.cards[0].height;
  };
  const screenshot = async (name) => { const { data } = await call("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(output, name + ".png"), Buffer.from(data, "base64")); };
  const week = "2026-11-09";
  const thermo = { id: "thermo", productionLine: "thermoforming", machine: "AR1", day: "2026-11-13", shift: "SHIFT 01", partNumber: "N1WB-E12606-SCP", buildQty: 20, status: "Planned" };
  const blow = { id: "blow", machine: "BM01", day: "2026-11-13", shift: "SHIFT 01", partNumber: "N1WB_BAA_PAIR", buildQty: 10, status: "Planned" };
  const seed = {
    items: [], demands: [], openOrders: [], planning: { weekStart: week, entries: [] },
    planningWeeks: { [week]: { weekStart: week, entries: [thermo, blow] } }, activeWeekStart: week,
    selectedProductionLine: "blowMoulding", horizon: 1, cycleCountDays: [],
    productionActuals: [{ id: "a-thermo", planningEntryId: "thermo", actualMouldQty: 10 }, { id: "a-blow", planningEntryId: "blow", actualMouldQty: 0 }],
  };
  const load = async (planner = seed, mode = "ready") => {
    sourceMode = mode;
    if (injection) await call("Page.removeScriptToEvaluateOnNewDocument", { identifier: injection.identifier });
    injection = await call("Page.addScriptToEvaluateOnNewDocument", { source: `if(location.origin===${JSON.stringify(origin)}){localStorage.clear();localStorage.setItem('mrp-auth-users-v1',JSON.stringify([{id:'OVERVIEW-SYNTHETIC',username:'synthetic',fullName:'Synthetic Overview User',role:'ADMIN',isActive:true}]));localStorage.setItem('mrp-auth-session-v1',JSON.stringify({userId:'OVERVIEW-SYNTHETIC'}));localStorage.setItem('mrp-data',${JSON.stringify(JSON.stringify(planner))});}` });
    await call("Page.navigate", { url: origin });
    await until("document.querySelectorAll('.production-overview-card').length===6");
  };
  await call("Runtime.enable"); await call("Page.enable");
  await call("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  await resize(1600, 900); await load();
  await until(`document.querySelector('.planner-toolbar').innerText.includes('SYSPRO Connected')`);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.production-overview-card h2')].map(el=>el.textContent)"), ["Thermoforming", "Blow Molding", "Rear Step Bumper", "FCSD Tracker", "Bumper Frame & Chassis", "Overall Plant OEE"]);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.production-overview-grid')).gridTemplateColumns.split(' ').length"), 3);
  assert.equal(await evaluate("[...document.querySelectorAll('.planner-sidebar nav button')].filter(b=>b.textContent.trim().startsWith('Dashboard')).length"), 1);
  assert.ok(await evaluate("![...document.querySelectorAll('.planner-sidebar button')].some(b=>b.textContent.includes('Line Dashboard'))"));
  assert.ok(await evaluate("[...document.querySelectorAll('.production-overview-card')].every(card=>card.querySelectorAll('button').length===2&&!card.querySelector('button button, a button, button a'))"));
  assert.equal(await evaluate("document.querySelectorAll('.production-card-action').length"), 0);
  assert.doesNotMatch(await cardText("thermoforming"), /Source:|runs with one valid actual|forming output unavailable/);
  const thermoNotes = await notes("thermoforming");
  assert.match(thermoNotes, /assembly-completed parts/);
  assert.match(thermoNotes, /forming output unavailable/);
  assert.match(thermoNotes, /Source: workspace planning and supervisor actuals/);
  assert.match(thermoNotes, /Achievement is captured actual divided by effective plan/);
  assert.doesNotMatch(await cardText("thermoforming"), /formed parts|Formed parent/);
  assert.match(await cardText("thermoforming"), /50%/);
  assert.match(await cardText("blowMoulding"), /Actuals complete/);
  assert.equal(await evaluate("document.querySelector('[data-card=blowMoulding] .production-card-metrics > div:nth-child(2) dd').innerText"), "0 sets");
  assert.match(await evaluate("document.querySelector('[data-card=thermoforming] dd').innerText"), /parts/);
  assert.match(await cardText("oee"), /Plant summary not yet available/);
  assert.doesNotMatch(await cardText("oee"), /\d+%/);
  assert.equal(await line(), "blowMoulding");
  await screenshot("overview-desktop");
  const desktopHeight = await equalCards('1600px desktop: equal cards across both rows', 3);
  assert.ok(await evaluate(`(()=>{const cards=[...document.querySelectorAll('.production-overview-card')];return [0,1,2].every(i=>Math.abs(cards[i].getBoundingClientRect().y-cards[0].getBoundingClientRect().y)<1)&&[3,4,5].every(i=>Math.abs(cards[i].getBoundingClientRect().y-cards[3].getBoundingClientRect().y)<1);})()`));
  assert.ok(await evaluate(`(()=>{const a=document.querySelector('[data-card=thermoforming]'),b=document.querySelector('[data-card=blowMoulding]');return [...a.querySelectorAll('dt,dd')].every((node,i)=>Math.abs(node.getBoundingClientRect().y-b.querySelectorAll('dt,dd')[i].getBoundingClientRect().y)<1);})()`), 'metric labels and values align across production cards');
  for (const width of [1440, 1366]) { await resize(width,900); await equalCards(width+'px desktop',3); }
  await resize(1600,900);
  assert.equal(await evaluate("document.querySelectorAll('.production-overview-note').length"),0);
  const weekNotes = await notes('week');
  assert.match(weekNotes,/Week filters production summaries only/); assert.match(weekNotes,/not additive plant totals/);
  checks.push('equal card widths and heights across both desktop rows at 1600/1440/1366px; aligned metrics; week explanation in separate accessible info control');
  // An 800x450 CSS viewport at DPR 2 models the layout/reflow of a 1600x900
  // display at 200% browser zoom. Separately enlarge the actual text to exercise
  // intrinsic growth, rather than relying on viewport resizing alone.
  await call('Emulation.setDeviceMetricsOverride',{width:800,height:450,deviceScaleFactor:2,mobile:false}); await pause(100);
  await equalCards('200% browser zoom equivalent',2); await screenshot('overview-zoom-200');
  await openInfo('week'); await fitsViewport(); await closeInfo('week');
  await resize(1600,900);
  await evaluate(`window.textResizeBackup=[...document.querySelectorAll('.production-overview-card h2,.production-overview-card p,.production-card-metrics dt,.production-card-metrics dd,.production-state,.production-card-period-label')].map(el=>{const old=el.getAttribute('style');el.style.fontSize=(parseFloat(getComputedStyle(el).fontSize)*2)+'px';return {el,old};});void 0`);
  const expandedHeight = await equalCards('200% text resize with wrapping',3);
  assert.ok(expandedHeight>desktopHeight+30,'cards grow with larger text');
  assert.ok(await evaluate(`(()=>{const a=document.querySelector('[data-card=thermoforming]'),b=document.querySelector('[data-card=blowMoulding]');return [...a.querySelectorAll('dt,dd')].every((node,i)=>Math.abs(node.getBoundingClientRect().y-b.querySelectorAll('dt,dd')[i].getBoundingClientRect().y)<1);})()`), 'metric rows stay aligned even when enlarged subtitles wrap differently');
  await screenshot('overview-text-200');
  await evaluate(`for(const {el,old} of window.textResizeBackup){if(old===null)el.removeAttribute('style');else el.setAttribute('style',old);}delete window.textResizeBackup`);
  checks.push('200% zoom-equivalent reflow and doubled text remain readable without clipping; all rows grow equally');
  // Also test the browser's real zoom setting, in this disposable profile only.
  const version = await (await fetch('http://127.0.0.1:9248/json/version')).json();
  const browser = await connect(version.webSocketDebuggerUrl);
  const settingsTarget = await browser.call('Target.createTarget', { url: 'edge://settings/appearance', background: true });
  await pause(500);
  const settingsTabs = await (await fetch('http://127.0.0.1:9248/json')).json();
  const settings = await connect(settingsTabs.find((tab) => tab.id === settingsTarget.targetId).webSocketDebuggerUrl);
  const zoom = async (factor) => {
    const result = await settings.call('Runtime.evaluate', { expression: `new Promise(resolve=>chrome.settingsPrivate.setDefaultZoom(${factor},()=>chrome.settingsPrivate.getDefaultZoom(resolve)))`, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    assert.equal(result.result.value, factor);
  };
  try {
  await zoom(1);
  await resize(1600,900);
  await pause(150);
  const normalZoom = await evaluate('({width:innerWidth,dpr:devicePixelRatio})');
  await zoom(2); await call('Page.reload'); await pause(600); await until(`devicePixelRatio>=${normalZoom.dpr*1.8}`);
  await until("document.querySelectorAll('.production-overview-card').length===6");
  const zoomed = await evaluate('({width:innerWidth,dpr:devicePixelRatio})');
  assert.ok(Math.abs(zoomed.width-normalZoom.width/2)<=2, 'real 200% browser zoom halves the CSS viewport');
  await equalCards('Real Edge browser zoom at 200%',2); await screenshot('overview-browser-zoom-200');
  await openInfo('week'); await fitsViewport(); await closeInfo('week');
  checks.push(`real Edge 200% browser zoom: CSS viewport ${normalZoom.width} to ${zoomed.width}, devicePixelRatio ${normalZoom.dpr} to ${zoomed.dpr}; equal cards, no clipping, accessible week notes`);
  } finally {
  await zoom(1); await call('Page.reload'); await pause(600);
  await until("document.querySelectorAll('.production-overview-card').length===6");
  settings.close(); await browser.call('Target.closeTarget', { targetId: settingsTarget.targetId });
  browser.close(); await resize(1600,900);
  }
  checks.push("six ordered cards, three wide columns, separate sibling info/navigation buttons, visible metric units and statuses, preserved notes and unchanged calculations");
  await mouseClick('[data-production-info="thermoforming"]');
  await until("document.querySelector('#overview-thermoforming-information')!==null");
  assert.equal(await evaluate("document.querySelector('.production-card-popover').parentElement===document.body"), true);
  assert.equal(await evaluate("document.querySelector('[data-production-info=thermoforming]').getAttribute('aria-label')"), "Thermoforming information");
  await fitsViewport(); await screenshot("overview-info-desktop");
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await until("document.querySelector('.production-card-popover')===null");
  assert.equal(await evaluate("document.activeElement.dataset.productionInfo"), "thermoforming");
  await mouseClick('[data-production-info="thermoforming"]'); await until("document.querySelector('.production-card-popover')!==null");
  await mouseClick('[data-production-info="blowMoulding"]'); await until("document.querySelector('#overview-blowMoulding-information')!==null");
  assert.equal(await evaluate("document.querySelectorAll('.production-card-popover').length"), 1);
  assert.equal(await evaluate("document.querySelector('[data-production-info=thermoforming]').getAttribute('aria-expanded')"), "false");
  await mouseClick("#production-overview-title"); await until("document.querySelector('.production-card-popover')===null");
  assert.equal(await evaluate("document.activeElement.dataset.productionInfo"), "blowMoulding");
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await evaluate("document.querySelector('[data-production-info=thermoforming]').focus()");
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await until("document.querySelector('#overview-thermoforming-information')!==null");
  assert.ok(await evaluate("document.activeElement.closest('.production-card-popover')!==null"));
  await closeInfo("thermoforming");
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " ", unmodifiedText: " " });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await until("document.querySelector('#overview-thermoforming-information')!==null");
  await closeInfo("thermoforming");
  assert.match(await notes("blowMoulding"), /LH\/RH sets; unverified product units/);
  assert.match(await notes("rsb"), /FCSD\/scrap classifications/);
  assert.match(await notes("fcsd"), /unsaved preview. Workflow counts unavailable/);
  assert.match(await notes("frame"), /FCSD classifications/);
  assert.match(await notes("oee"), /Area percentages are not averaged/);
  checks.push("all six info panels retain notes; mouse isolation, keyboard Enter/Space, Escape, outside dismissal, single open panel, focus return and body portal");
  // Click the card's metrics, away from its title button. The stretched
  // native target must make the full card navigable without extra controls.
  const hit = await evaluate("(()=>{const r=document.querySelector('[data-card=thermoforming] .production-card-metrics').getBoundingClientRect();return {x:r.x+20,y:r.y+5};})()");
  await call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...hit });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...hit });
  await until("document.querySelector('#sheet-analysis-title')!==null");
  assert.equal(await line(), "thermoforming");
  assert.match(await evaluate("document.querySelector('main').innerText"), /Assembly-completed parts for the active planning week/);
  await back(); assert.equal(await line(), "thermoforming");
  await mouseClick('[data-card="frame"] footer'); await until("document.querySelector('.production-unavailable')!==null"); await back();
  await mouseClick('[data-card="rsb"] .production-card-arrow'); await until("document.querySelector('.production-unavailable')!==null"); await back();
  // Native Enter and Space activation must work, including a visible focus ring.
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await evaluate("document.querySelector('[data-card=blowMoulding] button').focus()");
  assert.ok(await evaluate("document.querySelector('[data-card=blowMoulding]').matches(':has(button:focus-visible)')"));
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await until("document.querySelector('main').innerText.includes('Blow Moulding Production Control')");
  assert.equal(await line(), "blowMoulding"); await back();
  await evaluate("document.querySelector('[data-card=rsb] button').focus()");
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " ", unmodifiedText: " " });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await until("document.querySelector('.production-unavailable')!==null"); await back();
  checks.push("whole-card pointer hit area, native Enter/Space activation, visible focus and corrected Thermoforming detail caption");
  for (const id of ["rsb", "frame"]) {
    await click(`[data-card="${id}"] button`); await until("document.querySelector('.production-unavailable')!==null");
    assert.match(await evaluate("document.querySelector('.production-unavailable').innerText"), /No production figures/);
    assert.equal(await line(), "blowMoulding"); await back();
  }
  await click('[data-card="oee"] button'); await until("document.querySelector('.oee-dashboard')!==null");
  assert.equal(await line(), "blowMoulding"); await back();
  await click('[data-card="fcsd"] button'); await until("document.querySelector('.fcsd-request-fields input')!==null");
  assert.match(await evaluate("document.querySelector('.fcsd-tracker').innerText"), /Planning preview/);
  await evaluate(`(()=>{const el=document.querySelector('.fcsd-request-fields input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'Disposable preview');el.dispatchEvent(new Event('input',{bubbles:true}));window.confirm=()=>{window.leavePrompts=(window.leavePrompts||0)+1;return false;};})()`);
  await pause(100); await click('.production-overview-back');
  assert.ok(await evaluate("document.querySelector('.fcsd-tracker')!==null"));
  assert.equal(await evaluate("document.querySelector('.fcsd-request-fields input').value"), "Disposable preview");
  assert.equal(await evaluate("window.leavePrompts"), 1);
  await evaluate("window.confirm=()=>true"); await back();
  assert.equal(await line(), "blowMoulding");
  await clickText("Cycle Count"); await until("document.querySelector('.cycle-count')!==null");
  assert.equal(await evaluate("document.querySelectorAll('.production-overview-back').length"), 0);
  await clickText("Dashboard"); await until("document.querySelectorAll('.production-overview-card').length===6");
  await evaluate(`(()=>{const el=document.querySelector('[aria-label="Workspace"]');el.value='thermoforming';el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`document.querySelector('[aria-label="Workspace"]').value==='thermoforming'`);
  assert.equal(await evaluate("document.querySelectorAll('.production-overview-card').length"), 6);
  await click('[data-card="oee"] button'); await until("document.querySelector('.oee-dashboard')!==null");
  assert.equal(await line(), "thermoforming"); await back(); assert.equal(await line(), "thermoforming");
  await click('[data-card="rsb"] button'); await until("document.querySelector('.production-unavailable')!==null");
  assert.equal(await line(), "thermoforming"); await back();
  checks.push("all card routes and back navigation, Sheet Analysis/Cycle Count retained, selected line retained, FCSD dirty preview cancellation and discard");
  await clickText("Next week"); await until("document.querySelector('.production-card-period').innerText.includes('2026-11-16')");
  assert.match(await notes("thermoforming"), /No production runs/); assert.match(await cardText("blowMoulding"), /Production data unavailable/);
  assert.match(await cardText("fcsd"), /Tracker required date/);
  assert.match(await notes("fcsd"), /Overview week does not apply/);
  await clickText("Previous week");
  await resize(1100, 900);
  await equalCards('1100px tablet',2);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.production-overview-grid')).gridTemplateColumns.split(' ').length"), 2);
  await screenshot("overview-medium");
  for(const width of [1024,820,768]) { await resize(width,900); await equalCards(width+'px tablet',2); }
  await resize(1100,900);
  checks.push("two medium columns and no redundant overview buttons in unrelated views");
  await resize(1280, 360);
  const fixedBefore = await evaluate(`(()=>{const b=document.querySelector('.planner-sidebar-brand').getBoundingClientRect(),t=document.querySelector('.planner-toolbar').getBoundingClientRect();return {brand:b.y,toolbar:t.y};})()`);
  assert.ok(await evaluate("document.querySelector('.planner-sidebar-scroll').scrollHeight>document.querySelector('.planner-sidebar-scroll').clientHeight"));
  await evaluate("document.querySelector('.planner-sidebar-scroll').scrollTop=120;document.querySelector('.planner-main').scrollTop=400");
  const fixedAfter = await evaluate(`(()=>{const b=document.querySelector('.planner-sidebar-brand').getBoundingClientRect(),t=document.querySelector('.planner-toolbar').getBoundingClientRect();return {brand:b.y,toolbar:t.y};})()`);
  assert.deepEqual(fixedAfter, fixedBefore);
  const mainScroll = await evaluate("document.querySelector('.planner-main').scrollTop");
  await evaluate("document.querySelector('.planner-sidebar-scroll').scrollTop=10");
  assert.equal(await evaluate("document.querySelector('.planner-main').scrollTop"), mainScroll);
  const navScroll = await evaluate("document.querySelector('.planner-sidebar-scroll').scrollTop");
  await evaluate("document.querySelector('.planner-main').scrollTop=700");
  assert.equal(await evaluate("document.querySelector('.planner-sidebar-scroll').scrollTop"), navScroll);
  await evaluate("document.querySelector('.planner-sidebar-scroll').scrollTop=0;document.querySelector('.planner-main').scrollTop=0");
  await call("Input.dispatchMouseEvent", { type: "mouseWheel", x: 100, y: 240, deltaY: 100, deltaX: 0 }); await pause(160);
  assert.ok(await evaluate("document.querySelector('.planner-sidebar-scroll').scrollTop>0"));
  assert.equal(await evaluate("document.querySelector('.planner-main').scrollTop"), 0);
  const wheelNav = await evaluate("document.querySelector('.planner-sidebar-scroll').scrollTop");
  await call("Input.dispatchMouseEvent", { type: "mouseWheel", x: 800, y: 240, deltaY: 160, deltaX: 0 }); await pause(160);
  assert.ok(await evaluate("document.querySelector('.planner-main').scrollTop>0"));
  assert.equal(await evaluate("document.querySelector('.planner-sidebar-scroll').scrollTop"), wheelNav);
  assert.ok(await evaluate("document.scrollingElement.scrollHeight<=innerHeight+1"));
  assert.ok(await evaluate("document.querySelector('.planner-sidebar-brand img').naturalWidth>0"));
  await clickText("Account"); await until("document.querySelector('#account-menu')!==null");
  assert.ok(await evaluate("document.querySelector('#account-menu').getBoundingClientRect().bottom<=innerHeight"));
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await until("document.querySelector('#account-menu')===null");
  await evaluate("document.querySelector('.planner-main').scrollTop=0"); await screenshot("overview-short-height");
  await openInfo("thermoforming"); await resize(1280, 240); await fitsViewport();
  assert.ok(await evaluate("document.querySelector('.production-card-popover').scrollHeight>document.querySelector('.production-card-popover').clientHeight"));
  await evaluate("document.querySelector('.planner-main').scrollTop=400;document.querySelector('.production-card-popover').scrollTop=40");
  await pause(80); await fitsViewport(); await screenshot("overview-info-short"); await closeInfo("thermoforming");
  await resize(1280, 360);
  checks.push("fixed logo and toolbar, independent sidebar/content scroll, short-height account menu and Escape");
  for (const [width, height] of [[390, 844], [390, 360], [320, 568]]) {
    await resize(width, height);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.production-overview-grid')).gridTemplateColumns.split(' ').length"), 1);
    await equalCards(width+'px phone / '+height+'px height',1);
    assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth"));
    assert.ok(await evaluate("document.querySelector('.planner-main').clientHeight>70"));
    await clickText("Open navigation");
    await clickText("Close navigation");
    await click('[aria-controls="planning-settings-menu"]'); await until("document.querySelector('#planning-settings-menu')!==null");
    assert.ok(await evaluate("document.querySelector('#planning-settings-menu').getBoundingClientRect().bottom<=innerHeight"));
    await click('[aria-controls="planning-settings-menu"]');
    await click('[data-card="frame"] button'); await until("document.querySelector('.production-unavailable')!==null"); await back();
    if (height === 844) await screenshot("overview-mobile");
    await mouseClick('[data-production-info="thermoforming"]');
    await until("document.querySelector('#overview-thermoforming-information')!==null"); await fitsViewport();
    assert.equal(await evaluate("document.querySelectorAll('.production-overview-card').length"), 6);
    if (height === 844) await screenshot("overview-info-mobile");
    await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await until("document.querySelector('.production-card-popover')===null");
    assert.equal(await evaluate("document.activeElement.dataset.productionInfo"), "thermoforming");
    await call("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " ", unmodifiedText: " " });
    await call("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    await until("document.querySelector('#overview-thermoforming-information')!==null"); await closeInfo("thermoforming");
  }
  checks.push("390/320px single columns, short mobile window, navigation toggle, toolbar menus and last-card access");
  await resize(1600, 900);
  const incomplete = structuredClone(seed);
  incomplete.productionActuals = [{ id: "old", planningEntryId: "thermo", actualMouldQty: 9, updatedAt: "2026-11-10T10:00:00Z" }, { id: "new", planningEntryId: "thermo", actualMouldQty: 12, updatedAt: "2026-11-10T11:00:00Z" }];
  await load(incomplete);
  assert.match(await cardText("thermoforming"), /Incomplete production data/);
  assert.doesNotMatch(await cardText("thermoforming"), /duplicate\/corrected actuals/);
  assert.match(await notes("thermoforming"), /duplicate\/corrected actuals/);
  assert.match(await notes("blowMoulding"), /missing actuals; missing is not zero/);
  assert.equal(await evaluate("document.querySelector('[data-card=thermoforming] .production-card-metrics > div:nth-child(2) dd').innerText"), "Unavailable");
  await screenshot("overview-incomplete");
  for (const [width, height] of [[390, 360], [320, 568]]) {
    await resize(width, height);
    assert.ok(await evaluate("[...document.querySelectorAll('.production-overview-card')].every(card=>card.scrollWidth<=card.clientWidth+1&&card.scrollHeight<=card.clientHeight+1)"));
    await openInfo("thermoforming"); await fitsViewport();
    assert.match(await evaluate("document.querySelector('.production-card-popover').innerText"), /duplicate\/corrected actuals/); await closeInfo("thermoforming");
  }
  await resize(1600, 900);
  await load(seed, "loading");
  await openInfo("thermoforming");
  await until("document.querySelector('.production-card-popover').innerText.includes('Material sources loading')");
  await until("document.querySelector('.planner-toolbar').innerText.includes('SYSPRO Connected')");
  await closeInfo("thermoforming");
  await load(seed, "error");
  await until("document.querySelector('.planner-toolbar').innerText.includes('SYSPRO Offline')");
  assert.match(await notes("thermoforming"), /Material sources unavailable/);
  await click('[data-card="fcsd"] button'); await until("document.querySelector('.fcsd-error')!==null"); await back();
  checks.push("missing and duplicate actuals, empty week, loading and error sources, FCSD error route");
  await load(seed); await until("document.querySelector('.planner-toolbar').innerText.includes('Saved')");
  const saved = await evaluate("JSON.parse(localStorage.getItem('mrp-data'))");
  for (const key of ["planningWeeks", "productionActuals", "cycleCountDays"]) assert.deepEqual(saved[key], seed[key]);
  assert.equal(saved.selectedProductionLine, seed.selectedProductionLine);
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  assert.ok(requests.length > 0); assert.ok(requests.every((request) => request.method === "GET"));
  const report = { checks, layouts, screenshots: ["overview-desktop.png", "overview-info-desktop.png", "overview-medium.png", "overview-mobile.png", "overview-info-mobile.png", "overview-short-height.png", "overview-info-short.png", "overview-incomplete.png", "overview-zoom-200.png", "overview-text-200.png", "overview-browser-zoom-200.png"], apiRequests: requests.length, apiWrites: 0, runtimeExceptions: exceptions.length, syntheticPlanningUnchanged: true };
  fs.writeFileSync(path.join(output, "browser-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await call("Page.removeScriptToEvaluateOnNewDocument", { identifier: injection.identifier });
  await call("Fetch.disable"); socket.close();
})().catch((error) => { console.error(error); process.exit(1); });
