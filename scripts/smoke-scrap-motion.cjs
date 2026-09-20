// Self-contained presentation checks for an isolated headless browser on port 9223.
// The API is intercepted with synthetic rows; no database is contacted.
const assert = require('node:assert/strict');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const { WAREHOUSES } = await import('../mrp-planner/src/scrap/deriveScrapData.js');
  const tabs = await (await fetch('http://127.0.0.1:9223/json')).json();
  const socket = new WebSocket(tabs[0].webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  let nextId = 0;
  const pending = new Map();
  const requests = [];
  const exceptions = [];

  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const promise = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) promise.reject(message.error); else promise.resolve(message.result);
    } else if (message.method === 'Fetch.requestPaused') {
      if (message.params.request.url.includes('/api/syspro/production-scrap')) {
        requests.push(message.params.requestId);
      } else {
        call('Fetch.fulfillRequest', {
          requestId: message.params.requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify({ success: true, data: [], count: 0 })).toString('base64'),
        }).catch((error) => {
          if (!error.message?.includes('Invalid InterceptionId')) exceptions.push({ text: error.message });
        });
      }
    } else if (message.method === 'Runtime.exceptionThrown') {
      exceptions.push(message.params.exceptionDetails);
    }
  });

  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  const until = async (expression) => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await evaluate(expression)) return;
      await pause(100);
    }
    throw new Error(`Timed out: ${expression}`);
  };
  const click = async (label) => evaluate(`([...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(label)})).click()`);
  const setFilter = async (index, value, select = false) => {
    await evaluate(`(()=>{const element=document.querySelector('.scrap-filters label:nth-child(${index}) ${select ? 'select' : 'input'}');Object.getOwnPropertyDescriptor(${select ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype,'value').set.call(element,${JSON.stringify(value)});element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await pause(40);
  };

  const [confirmedWarehouse, otherActivityWarehouse] = WAREHOUSES;
  const productionWarehouse = 'TEST-WAREHOUSE-WIP';
  const testDate = new Date().toISOString().slice(0, 10);
  const previousDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const commodities = ['TEST-COMMODITY-001', 'TEST-COMMODITY-002', 'Unmapped', 'Ambiguous'];
  const rows = Array.from({ length: 145 }, (_, index) => ({
    date: index % 2 === 0 ? previousDate : testDate,
    stockCode: `TEST-COMPONENT-${String(index).padStart(3, '0')}`,
    description: 'Synthetic motion-test row',
    commodity: commodities[index % commodities.length],
    mappingStatus: 'Mapped',
    warehouse: index < 125 ? confirmedWarehouse : otherActivityWarehouse,
    sourceWarehouse: index < 135 ? productionWarehouse : otherActivityWarehouse,
    destinationWarehouse: index < 125 ? confirmedWarehouse : index < 135 ? otherActivityWarehouse : productionWarehouse,
    scrapQty: index % 10 === 0 ? -2.5 : 10,
    totalCost: index % 10 === 0 ? -25 : 100,
    unitCost: 10,
    uom: 'TEST-UOM',
    journal: index,
    journalEntry: 1,
    trnYear: 2099,
    trnMonth: 1,
    reference: 'Synthetic animation fixture',
  }));
  const fulfill = async () => {
    for (let attempt = 0; requests.length === 0 && attempt < 80; attempt += 1) await pause(100);
    assert.ok(requests.length > 0);
    while (requests.length) {
      await call('Fetch.fulfillRequest', {
        requestId: requests.shift(),
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify({ success: true, data: rows, mappings: {}, fetchedAt: '2099-01-15T12:00:00.000Z' })).toString('base64'),
      }).catch((error) => {
        if (!error.message?.includes('Invalid InterceptionId')) throw error;
      });
    }
  };

  await call('Runtime.enable');
  await call('Page.enable');
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await call('Fetch.enable', { patterns: [
    { urlPattern: '*api/syspro/inventory*', requestStage: 'Request' },
    { urlPattern: '*api/syspro/bom*', requestStage: 'Request' },
    { urlPattern: '*api/syspro/production-scrap*', requestStage: 'Request' },
  ] });
  await call('Page.navigate', { url: 'http://localhost:5173' });
  await until(`document.querySelector('nav')!==null`);
  await evaluate(`window.scrapAnimationStarts=0;document.addEventListener('animationstart',event=>{if(event.animationName!=='scrap-skeleton-pulse')window.scrapAnimationStarts+=1})`);
  await click('Production Scrap');
  await until(`document.querySelector('.scrap-loading')!==null`);
  assert.equal(await evaluate(`document.querySelectorAll('.scrap-count').length`), 0);
  assert.ok(await evaluate(`document.querySelectorAll('.scrap-skeleton-chart').length>0&&document.querySelectorAll('.scrap-skeleton-row').length>0`));
  await fulfill();
  await until(`document.querySelector('.scrap-count')!==null`);
  assert.ok(await evaluate(`[...document.querySelectorAll('.scrap-count')].some(element=>element.textContent!==element.getAttribute('aria-label'))`));
  assert.ok(await evaluate(`[...document.querySelectorAll('.scrap-bar-horizontal')].some(element=>getComputedStyle(element).transform!=='matrix(1, 0, 0, 1, 0, 0)')`));
  assert.ok(await evaluate(`document.querySelector('.scrap-line-reveal').getAnimations().some(animation=>animation.playState==='running')`));
  await pause(800);
  assert.ok(await evaluate(`[...document.querySelectorAll('.scrap-count')].every(element=>element.textContent===element.getAttribute('aria-label'))`));

  const animationStarts = await evaluate(`window.scrapAnimationStarts`);
  await evaluate(`window.scrapGroup=document.querySelector('.scrap-chart-dataset');document.querySelector('.scrap-pagination button:last-child').click()`);
  await pause(200);
  assert.ok(await evaluate(`document.querySelector('.scrap-pagination').innerText.includes('Page 2')`));
  assert.ok(await evaluate(`window.scrapGroup===document.querySelector('.scrap-chart-dataset')`));

  const plotPosition = await evaluate(`(()=>{const element=document.querySelector('.scrap-plot svg');element.scrollIntoView({block:'center'});const rect=element.getBoundingClientRect();return{x:rect.x+rect.width*.55,y:rect.y+rect.height*.55}})()`);
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...plotPosition });
  await until(`document.querySelector('.scrap-tooltip')!==null`);
  assert.ok(await evaluate(`document.querySelector('.scrap-point.is-active')!==null`));
  await evaluate(`document.querySelector('.scrap-bar-horizontal').focus()`);
  assert.ok(await evaluate(`document.querySelector('.scrap-tooltip')!==null`));
  await evaluate(`document.querySelector('.scrap-bar-horizontal').blur()`);
  await pause(900);
  assert.equal(await evaluate(`window.scrapAnimationStarts`), animationStarts);

  await setFilter(3, 'TEST-COMMODITY-002', true);
  await pause(800);
  assert.ok(await evaluate(`[...document.querySelectorAll('.scrap-table-scroll tbody tr')].every(row=>row.children[1]?.textContent==='TEST-COMMODITY-002')`));
  await setFilter(4, confirmedWarehouse, true);
  assert.equal(await evaluate(`document.querySelectorAll('.scrap-reg-section').length`), 0);
  await setFilter(4, otherActivityWarehouse, true);
  assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Confirmed Scrap"]').length`), 0);
  await setFilter(3, '', true);
  await setFilter(5, 'TEST-COMPONENT-125');
  await pause(750);
  assert.equal(await evaluate(`document.querySelectorAll('.scrap-table-scroll tbody tr').length`), 1);
  await setFilter(5, '');
  await setFilter(1, testDate);
  await until(`document.querySelector('.scrap-loading')!==null`);
  await fulfill();
  await until(`document.querySelector('.scrap-count')!==null`);
  await setFilter(2, testDate);
  await until(`document.querySelector('.scrap-loading')!==null`);
  await fulfill();
  await until(`document.querySelector('.scrap-count')!==null`);
  assert.ok(await evaluate(`[...document.querySelectorAll('.scrap-table-scroll tbody tr')].every(row=>row.children[0]?.textContent===${JSON.stringify(testDate)})`));

  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await pause(50);
  await setFilter(3, 'TEST-COMMODITY-002', true);
  assert.ok(await evaluate(`[...document.querySelectorAll('.scrap-count')].every(element=>element.textContent===element.getAttribute('aria-label'))`));
  assert.ok(await evaluate(`[...document.querySelectorAll('.production-scrap *')].every(element=>element.getAnimations().every(animation=>animation.playState!=='running'))`));
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));

  await call('Fetch.disable');
  socket.close();
  console.log('Synthetic Scrap animation browser checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
