// Self-contained presentation smoke check for an isolated headless browser on port 9223.
// All application data and API responses are synthetic; no database is contacted.
const assert = require('node:assert/strict');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const tabs = await (await fetch('http://127.0.0.1:9223/json')).json();
  const socket = new WebSocket(tabs[0].webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));

  let nextId = 0;
  const pending = new Map();
  const exceptions = [];
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const syntheticFinishedGoods = {
    success: true,
    data: [],
    count: 0,
    fetchedAt: '2099-01-15T12:00:00.000Z',
    shiftAllocation: false,
    basis: 'Synthetic smoke-test response',
  };

  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(message.error); else request.resolve(message.result);
      return;
    }
    if (message.method === 'Fetch.requestPaused') {
      const url = message.params.request.url;
      const payload = url.includes('/api/syspro/oee/finished-goods')
        ? syntheticFinishedGoods
        : { success: true, data: [], count: 0 };
      call('Fetch.fulfillRequest', {
        requestId: message.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(payload)).toString('base64'),
      }).catch((error) => {
        if (!error.message?.includes('Invalid InterceptionId')) exceptions.push({ text: error.message });
      });
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
  });

  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await evaluate(expression)) return;
      await pause(250);
    }
    throw new Error(`Timed out: ${expression}`);
  };
  const click = async (text) => {
    await evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(candidate=>candidate.textContent.trim()===${JSON.stringify(text)});if(!button)throw Error('Missing button');button.click()})()`);
    await pause(300);
  };
  const setSelect = async (selector, value) => {
    await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(element,${JSON.stringify(value)});element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await pause(300);
  };

  const testDate = '2099-01-15';
  const plans = [
    { id: 'test-plan-001', day: testDate, machine: 'TEST-MACHINE-001', shift: 'TEST-SHIFT-001', partNumber: 'TEST-OEE-PARENT-001', buildQty: 100, adjustedPlanQty: 80, productionLine: 'blowMoulding' },
    { id: 'test-plan-002', day: testDate, machine: 'TEST-MACHINE-002', shift: 'TEST-SHIFT-002', partNumber: 'TEST-OEE-PARENT-002', buildQty: 120, productionLine: 'blowMoulding' },
  ];
  const actuals = plans.map((plan, index) => ({
    id: `test-actual-${index + 1}`,
    planningEntryId: plan.id,
    actualMouldQty: 90,
    comment: 'Synthetic smoke-test note',
    oee: { runTime: 350, noTubs: 20, goodParts: 80 },
  }));
  const shiftConfig = {
    'TEST-SHIFT-001': { name: 'Synthetic Shift One', start: '06:00', end: '15:00', breaks: 30 },
    'TEST-SHIFT-002': { name: 'Synthetic Shift Two', start: '15:00', end: '22:00', breaks: 30 },
  };
  const appData = {
    items: [],
    demands: [],
    openOrders: [],
    planningWeeks: { [testDate]: { weekStart: testDate, entries: plans } },
    activeWeekStart: testDate,
    selectedProductionLine: 'blowMoulding',
    productionActuals: actuals,
    oeeSettings: { blowMoulding: shiftConfig, thermoforming: shiftConfig },
  };
  const runKey = String(Date.now());

  await call('Runtime.enable');
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Fetch.enable', { patterns: [
    { urlPattern: '*api/syspro/inventory*', requestStage: 'Request' },
    { urlPattern: '*api/syspro/bom*', requestStage: 'Request' },
    { urlPattern: '*api/syspro/oee/finished-goods*', requestStage: 'Request' },
  ] });
  const injection = await call('Page.addScriptToEvaluateOnNewDocument', {
    source: `if(location.origin==='http://localhost:5173'&&localStorage.getItem('test-oee-seeded')!==${JSON.stringify(runKey)}){localStorage.setItem('mrp-auth-users-v1',JSON.stringify([{id:'TEST-USER-001',username:'test-oee-user',fullName:'Synthetic OEE User',role:'ADMIN',isActive:true}]));localStorage.setItem('mrp-auth-session-v1',JSON.stringify({userId:'TEST-USER-001'}));localStorage.setItem('mrp-data',${JSON.stringify(JSON.stringify(appData))});localStorage.setItem('test-oee-seeded',${JSON.stringify(runKey)});}`,
  });

  await call('Page.navigate', { url: 'http://localhost:5173' });
  await until(`document.body.innerText.includes('Production Actuals')`);
  await click('OEE');
  await until(`document.querySelector('.oee-kpis')!==null`);
  assert.equal(await evaluate(`document.querySelectorAll('.oee-kpis article').length`), 6);
  assert.equal(await evaluate(`document.querySelectorAll('.oee-charts svg').length`), 4);
  assert.ok(await evaluate(`document.querySelector('.oee-dashboard').innerText.includes('2 complete / 2 selected runs')`));
  await until(`document.querySelector('.oee-header').innerText.includes('SYSPRO connected')`);

  await setSelect('.oee-filters label:nth-child(4) select', 'TEST-MACHINE-001');
  assert.ok(await evaluate(`document.querySelector('.oee-dashboard').innerText.includes('1 complete / 1 selected runs')`));
  assert.ok(await evaluate(`document.querySelector('.oee-dashboard').innerText.includes('cannot be allocated reliably')`));
  await setSelect('.oee-filters label:nth-child(4) select', '');

  await call('Page.reload');
  await until(`document.body.innerText.includes('Production Actuals')`);
  await click('OEE');
  await until(`document.querySelector('.oee-kpis')!==null`);
  assert.equal(await evaluate(`document.querySelectorAll('.oee-kpis article').length`), 6);
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));

  await call('Fetch.disable');
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier });
  socket.close();
  console.log('Synthetic OEE browser smoke checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
