// Requires Vite and an isolated headless Edge on port 9235. Each case also
// creates its own disposable CDP browser context. No live API is contacted.
const assert = require("node:assert/strict");
const { pbkdf2Sync } = require("node:crypto");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const debugUrl = "http://127.0.0.1:9235";
const appUrl = "http://127.0.0.1:5173";
const password = "Synthetic-Logout-Test-Only";
const salt = Buffer.alloc(16, 1);
const passwordHash = `pbkdf2-sha256$210000$${salt.toString("base64")}$${pbkdf2Sync(password, salt, 210000, 32, "sha256").toString("base64")}`;
const fixture = {
  items: [], demands: [], openOrders: [], selectedProductionLine: "blowMoulding",
  activeWeekStart: "2026-11-09",
  planningWeeks: { "2026-11-09": { weekStart: "2026-11-09", entries: [
    { id: "TEST-PLAN", productionLine: "blowMoulding", machine: "BM01", day: "2026-11-09", shift: "SHIFT 01", partNumber: "TEST-PARENT", buildQty: 40, status: "Planned" },
  ] } },
  productionActuals: [{ id: "TEST-ACTUAL", planningEntryId: "TEST-PLAN", actualMouldQty: 23 }],
};

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
    } else listeners.forEach((listener) => listener(message));
  });
  return {
    onEvent(listener) { listeners.push(listener); },
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

async function run() {
  const version = await (await fetch(`${debugUrl}/json/version`)).json();
  const browser = await connect(version.webSocketDebuggerUrl);
  const contexts = [];
  const errors = [];
  async function open(options = {}) {
    const { browserContextId } = await browser.call("Target.createBrowserContext");
    contexts.push(browserContextId);
    const { targetId } = await browser.call("Target.createTarget", { url: "about:blank", browserContextId });
    const tabs = await (await fetch(`${debugUrl}/json`)).json();
    const page = await connect(tabs.find((tab) => tab.id === targetId).webSocketDebuggerUrl);
    page.onEvent((message) => {
      if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails);
      if (message.method === "Fetch.requestPaused") {
        page.call("Fetch.fulfillRequest", {
          requestId: message.params.requestId, responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "application/json" }],
          body: Buffer.from(JSON.stringify({ success: true, data: [], count: 0 })).toString("base64"),
        }).catch((error) => { if (!error.message.includes("Invalid InterceptionId")) errors.push(error.message); });
      }
    });
    const evaluate = async (expression) => {
      const result = await page.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const until = async (expression) => {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (await evaluate(expression)) return;
        await pause(100);
      }
      throw new Error(`Browser timeout: ${expression}`);
    };
    await page.call("Runtime.enable");
    await page.call("Page.enable");
    await page.call("Page.bringToFront");
    await page.call("Fetch.enable", { patterns: [{ urlPattern: `${appUrl}/api/*`, requestStage: "Request" }] });
    await page.call("Page.addScriptToEvaluateOnNewDocument", { source: `
      if(location.origin===${JSON.stringify(appUrl)}) {
        if(!localStorage.getItem('logout-smoke-seeded')) {
          localStorage.setItem('mrp-auth-users-v1',JSON.stringify([{id:'TEST-LOGOUT-USER',username:'logout-test',fullName:'Synthetic Logout User',role:'ADMIN',isActive:true,passwordHash:${JSON.stringify(passwordHash)}}]));
          localStorage.setItem('mrp-auth-session-v1',JSON.stringify({userId:'TEST-LOGOUT-USER'}));
          localStorage.setItem('mrp-data',${JSON.stringify(options.raw ?? JSON.stringify(fixture))});
          localStorage.setItem('logout-smoke-seeded','yes');
        }
        window.__logoutWrites=[];window.__clearEvents=[];window.__activeWrites=0;window.__maxActiveWrites=0;
        window.__failWrites=false;window.__failReads=${Boolean(options.failReads)};window.__holdNextWrite=false;
        const reads=[];window.__releaseReads=()=>reads.splice(0).forEach(resolve=>resolve());
        const nativeRemove=Storage.prototype.removeItem;
        Storage.prototype.removeItem=function(key){
          if(key==='mrp-auth-session-v1')window.__clearEvents.push({active:window.__activeWrites,stored:localStorage.getItem('mrp-data')});
          return nativeRemove.call(this,key);
        };
        window.storage={
          get:async key=>{
            if(${Boolean(options.holdReads)})await new Promise(resolve=>reads.push(resolve));
            if(window.__failReads)throw Error('Synthetic read failure');
            const value=localStorage.getItem(key);return value===null?null:{value};
          },
          set:async(key,value)=>{
            const attempt={quantity:JSON.parse(value).productionActuals[0]?.actualMouldQty,done:false};window.__logoutWrites.push(attempt);
            window.__activeWrites++;window.__maxActiveWrites=Math.max(window.__maxActiveWrites,window.__activeWrites);
            try{
              if(window.__holdNextWrite){window.__holdNextWrite=false;await new Promise(resolve=>window.__releaseWrite=resolve);}
              if(window.__failWrites)throw Error('Synthetic quota failure');
              localStorage.setItem(key,value);attempt.done=true;
            }finally{window.__activeWrites--;}
          }
        };
      }` });
    await page.call("Page.navigate", { url: appUrl });
    return { page, evaluate, until, async close() {
      await browser.call("Target.disposeBrowserContext", { browserContextId });
      contexts.splice(contexts.indexOf(browserContextId), 1);
      page.close();
    } };
  }
  const click = (text) => `[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`;
  const setInput = (selector, value) => `(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(String(value))});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`;
  const actualInput = ".actual-cell.production input[type=number]";
  const storedQuantity = "JSON.parse(localStorage.getItem('mrp-data')).productionActuals[0].actualMouldQty";
  async function ready(page) {
    await page.until("document.querySelector('[aria-label=Workspace]')!==null&&window.__logoutWrites.some(row=>row.done)");
    await page.evaluate(click("Production Actuals"));
    await page.until(`document.querySelector(${JSON.stringify(actualInput)})!==null`);
  }
  async function signedOut(page, quantity) {
    await page.until("document.querySelector('.auth-card input[type=password]')!==null");
    assert.equal(await page.evaluate("localStorage.getItem('mrp-auth-session-v1')"), null);
    assert.equal(await page.evaluate(storedQuantity), quantity);
    assert.equal(await page.evaluate("window.__clearEvents.at(-1).active"), 0);
    assert.equal(await page.evaluate("window.__maxActiveWrites"), 1);
  }
  try {
    let p = await open();
    await ready(p);
    const before = await p.evaluate("window.__logoutWrites.length");
    // Same JavaScript task: no timeout or React-render wait between edit/logout.
    await p.evaluate(`window.__holdNextWrite=true;${setInput(actualInput, 31)};const logout=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Logout');logout.click();logout.click();logout.click();`);
    await p.until("typeof window.__releaseWrite==='function'");
    assert.ok(await p.evaluate("localStorage.getItem('mrp-auth-session-v1')"));
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(actualInput)}).value`), "31");
    assert.equal(await p.evaluate("window.__logoutWrites.length"), before + 1);
    await p.evaluate("window.__releaseWrite()");
    await signedOut(p, 31);
    await pause(800);
    assert.equal(await p.evaluate("window.__logoutWrites.length"), before + 1);
    await p.evaluate(setInput(".auth-card input[autocomplete=username]", "logout-test"));
    await p.evaluate(setInput(".auth-card input[type=password]", password));
    await p.evaluate("document.querySelector('.auth-card').requestSubmit()");
    await p.until("document.querySelector('[aria-label=Workspace]')!==null");
    await p.evaluate(click("Production Actuals"));
    await p.until(`document.querySelector(${JSON.stringify(actualInput)})?.value==='31'`);
    await p.close();
    console.log("PASS immediate edit/logout/login restores 31; session waits for storage; repeated clicks and cancelled timer do not duplicate writes");

    p = await open();
    await ready(p);
    const cleanWrites = await p.evaluate("window.__logoutWrites.length");
    await p.evaluate(click("Logout"));
    await signedOut(p, 23);
    assert.equal(await p.evaluate("window.__logoutWrites.length"), cleanWrites);
    await p.close();
    console.log("PASS normal clean logout performs no additional planner write");

    p = await open();
    await ready(p);
    await p.evaluate(`window.__failWrites=true;${setInput(actualInput, 31)};${click("Logout")}`);
    await p.until("document.body.innerText.includes('Retry logout')");
    assert.ok(await p.evaluate("localStorage.getItem('mrp-auth-session-v1')"));
    assert.equal(await p.evaluate(storedQuantity), 23);
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(actualInput)}).value`), "31");
    assert.ok(await p.evaluate("document.body.innerText.includes('Changes could not be saved')&&document.body.innerText.includes('You are still signed in')"));
    const failedWrites = await p.evaluate("window.__logoutWrites.length");
    await pause(800);
    assert.equal(await p.evaluate("window.__logoutWrites.length"), failedWrites);
    await p.evaluate(`window.__failWrites=false;${setInput(actualInput, 32)};${click("Retry logout")}`);
    await signedOut(p, 32);
    assert.equal(await p.evaluate("window.__logoutWrites.length"), failedWrites + 1);
    await p.close();
    console.log("PASS failed logout retains session and edit 31; explicit retry saves latest edit 32 before logout");

    p = await open();
    await ready(p);
    const initialWrites = await p.evaluate("window.__logoutWrites.length");
    await p.evaluate(`window.__holdNextWrite=true;${setInput(actualInput, 24)}`);
    await p.until("typeof window.__releaseWrite==='function'");
    await p.evaluate(`${setInput(actualInput, 31)};${click("Logout")}`);
    assert.ok(await p.evaluate("localStorage.getItem('mrp-auth-session-v1')"));
    assert.equal(await p.evaluate("window.__logoutWrites.length"), initialWrites + 1);
    await p.evaluate("window.__releaseWrite()");
    await signedOut(p, 31);
    await pause(800);
    assert.deepEqual(await p.evaluate("window.__logoutWrites.slice(-2).map(row=>row.quantity)"), [24, 31]);
    assert.equal(await p.evaluate("window.__logoutWrites.length"), initialWrites + 2);
    await p.close();
    console.log("PASS an older in-flight autosave finishes before the final logout save; writes stay serialized");

    for (const options of [{ raw: "{malformed" }, { raw: JSON.stringify({ items: {} }) }, { failReads: true }, { holdReads: true }]) {
      p = await open(options);
      await p.until(options.holdReads ? "document.body.innerText.includes('Loading planning data')" : "document.body.innerText.includes('Retry loading')");
      const stored = await p.evaluate("localStorage.getItem('mrp-data')");
      await p.evaluate(click("Logout"));
      await p.until("document.querySelector('.auth-card input[type=password]')!==null");
      await p.evaluate("window.__releaseReads()");
      await pause(800);
      assert.equal(await p.evaluate("localStorage.getItem('mrp-auth-session-v1')"), null);
      assert.equal(await p.evaluate("localStorage.getItem('mrp-data')"), stored);
      assert.equal(await p.evaluate("window.__logoutWrites.length"), 0);
      await p.close();
    }
    console.log("PASS malformed JSON, invalid saved structure, read failure, and pending loading logout without any planner writes");
    assert.deepEqual(errors, [], "No uncaught browser errors");
  } finally {
    for (const browserContextId of contexts) await browser.call("Target.disposeBrowserContext", { browserContextId });
    browser.close();
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
