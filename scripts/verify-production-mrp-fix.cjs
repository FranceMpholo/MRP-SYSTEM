const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

(async () => {
  const root = path.resolve(__dirname, '..');
  const esbuild = await import('../mrp-planner/node_modules/esbuild/lib/main.js');

  const srcPath = path.join(root, 'mrp-planner/src/production/ProductionMRP.jsx');
  const testMjsPath = path.join(root, 'mrp-planner/src/production/ProductionMRP.test.mjs');

  let jsxCode = fs.readFileSync(srcPath, 'utf8');
  jsxCode = jsxCode
    .replace('from "./deriveProductionMRP"', 'from "./deriveProductionMRP.js"')
    .replace('from "./productionLines"', 'from "./productionLines.js"')
    .replace('import atdLogo from "../assets/atd-logo.png";', 'const atdLogo = "";')
    .replace('import { Boxes, ClipboardList, Download, PackageCheck } from "lucide-react";', 'const Boxes = () => null, ClipboardList = () => null, Download = () => null, PackageCheck = () => null;');

  const transformed = esbuild.transformSync(jsxCode, { loader: 'jsx', format: 'esm' }).code;
  fs.writeFileSync(testMjsPath, transformed);

  try {
    const React = (await import('../mrp-planner/node_modules/react/index.js')).default;
    const ReactDOMServer = (await import('../mrp-planner/node_modules/react-dom/server.node.js')).default;

    const { deriveProductionMRP } = await import('../mrp-planner/src/production/deriveProductionMRP.js');
    const { bomSourceReady } = await import('../mrp-planner/src/bom/bomValidation.js');
    const { canExportStoreRequest } = await import('../mrp-planner/src/production/storeRequestValidation.js');
    const ProductionMRP = (await import('../mrp-planner/src/production/ProductionMRP.test.mjs')).default;

    const snapshotPath = path.join(root, 'diagnostics/bom-performance/after-startup-response.json');
    const boms = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')).data;

    const validParent = 'N1WB-J12606-SAH';
    const missingParent = 'GENUINELY-MISSING-PARENT';

    const planValid = {
      entries: [{ id: 'e1', partNumber: validParent, productionLine: 'thermoforming', buildQty: 10 }]
    };
    const planMissing = {
      entries: [{ id: 'e2', partNumber: missingParent, productionLine: 'thermoforming', buildQty: 10 }]
    };

    console.log('--- TEST 1: Startup (loading: true, connected: false, boms: []) ---');
    let bomStatus = { connected: false, loading: true, lastUpdated: null, error: null };
    let mrp = deriveProductionMRP({ planning: planValid, items: [], boms: [], bomAvailable: bomSourceReady(bomStatus) });
    assert.equal(bomSourceReady(bomStatus), false);
    assert.equal(mrp.complete, false);
    assert.equal(mrp.dataIssues.some(i => i.includes('missing')), false, 'Must NOT emit missing-BOM while loading');
    assert.equal(mrp.dataIssues.some(i => i.includes('unavailable or refreshing')), true, 'Must keep stale safeguard issue');
    let html = ReactDOMServer.renderToStaticMarkup(React.createElement(ProductionMRP, {
      planning: planValid, items: [], boms: [], productionMrp: mrp, bomStatus, productionLine: 'thermoforming'
    }));
    assert.ok(html.includes('Loading SYSPRO BOM…'), 'Must show Loading message');
    assert.equal(html.includes('SYSPRO BOM unavailable'), false, 'Must NOT show unavailable while loading');
    assert.equal(html.includes('Syspro BOM unavailable'), false);
    assert.equal(html.includes('Thermoforming parent BOM missing'), false, 'Must NOT show parent missing warning while loading');
    assert.equal(html.includes('Material request incomplete'), false, 'Must NOT show secondary material request incomplete note while loading');
    console.log('PASS: Startup shows single Loading message and suppresses false missing warnings');

    console.log('\n--- TEST 2: Refresh (loading: true, connected: false, lastUpdated: Date) ---');
    bomStatus = { connected: false, loading: true, lastUpdated: new Date(), error: null };
    mrp = deriveProductionMRP({ planning: planValid, items: [], boms: [], bomAvailable: bomSourceReady(bomStatus) });
    html = ReactDOMServer.renderToStaticMarkup(React.createElement(ProductionMRP, {
      planning: planValid, items: [], boms: [], productionMrp: mrp, bomStatus, productionLine: 'thermoforming'
    }));
    assert.ok(html.includes('Loading SYSPRO BOM…'), 'Must show Loading message on refresh');
    assert.equal(html.includes('SYSPRO BOM unavailable'), false);
    assert.equal(html.includes('Thermoforming parent BOM missing'), false);
    console.log('PASS: Refresh shows single Loading message');

    console.log('\n--- TEST 3: Failure (loading: false, connected: false, error: Connection timeout) ---');
    bomStatus = { connected: false, loading: false, lastUpdated: null, error: 'Connection timeout' };
    mrp = deriveProductionMRP({ planning: planValid, items: [], boms: [], bomAvailable: bomSourceReady(bomStatus) });
    assert.equal(mrp.dataIssues.some(i => i.includes('missing')), false);
    html = ReactDOMServer.renderToStaticMarkup(React.createElement(ProductionMRP, {
      planning: planValid, items: [], boms: [], productionMrp: mrp, bomStatus, productionLine: 'thermoforming'
    }));
    assert.equal(html.includes('Loading SYSPRO BOM…'), false);
    assert.ok(html.includes('SYSPRO BOM unavailable: Connection timeout'), 'Must show single unavailable banner with detail');
    assert.equal(html.includes('Thermoforming parent BOM missing'), false);
    assert.equal(html.includes('stale lines are not approved for calculations'), false, 'Must not duplicate stale issue in UI');
    console.log('PASS: Failure shows single unavailable message with detail and suppresses false missing warnings');

    console.log('\n--- TEST 4: Recovery with Valid Parent (N1WB-J12606-SAH) ---');
    bomStatus = { connected: true, loading: false, lastUpdated: new Date(), error: null };
    mrp = deriveProductionMRP({ planning: planValid, items: [], boms, bomAvailable: bomSourceReady(bomStatus) });
    assert.equal(bomSourceReady(bomStatus), true);
    assert.equal(mrp.dataIssues.some(i => i.includes('Thermoforming parent BOM missing')), false, 'Valid parent must not be missing');
    assert.ok(mrp.dataIssues.some(i => i.includes('BOM cycle detected')), 'Must preserve genuine cycle warning');
    assert.ok(mrp.dataIssues.some(i => i.includes('Negative BOM QtyPer')), 'Must preserve negative quantity warning');
    html = ReactDOMServer.renderToStaticMarkup(React.createElement(ProductionMRP, {
      planning: planValid, items: [], boms, productionMrp: mrp, bomStatus, productionLine: 'thermoforming'
    }));
    assert.equal(html.includes('Loading SYSPRO BOM…'), false);
    assert.equal(html.includes('SYSPRO BOM unavailable'), false);
    assert.equal(html.includes('Thermoforming parent BOM missing'), false);
    assert.ok(html.includes('BOM cycle detected'), 'Cycle warning rendered');
    console.log('PASS: Valid parent loads without missing BOM warning and preserves genuine integrity warnings');

    console.log('\n--- TEST 5: Genuinely Missing Parent after Load ---');
    mrp = deriveProductionMRP({ planning: planMissing, items: [], boms, bomAvailable: bomSourceReady(bomStatus) });
    assert.ok(mrp.dataIssues.some(i => i.includes('Thermoforming parent BOM missing — GENUINELY-MISSING-PARENT')), 'Missing parent must be flagged');
    html = ReactDOMServer.renderToStaticMarkup(React.createElement(ProductionMRP, {
      planning: planMissing, items: [], boms, productionMrp: mrp, bomStatus, productionLine: 'thermoforming'
    }));
    assert.ok(html.includes('Thermoforming parent BOM missing — GENUINELY-MISSING-PARENT'), 'Missing parent banner rendered in HTML');
    console.log('PASS: Genuinely missing parent is correctly flagged after BOM loads');

    console.log('\n--- TEST 6: Safeguards for Calculation & PDF Export ---');
    bomStatus = { connected: false, loading: true, lastUpdated: null, error: null };
    mrp = deriveProductionMRP({ planning: planValid, items: [], boms, bomAvailable: bomSourceReady(bomStatus) });
    assert.equal(canExportStoreRequest(mrp), false);
    assert.equal(canExportStoreRequest(mrp) && bomSourceReady(bomStatus), false);
    mrp = deriveProductionMRP({ planning: planValid, items: [], boms, bomAvailable: false });
    assert.equal(canExportStoreRequest(mrp), false);
    assert.equal(mrp.complete, false);
    assert.equal(mrp.childRequirements[0].incompleteBomQtyPer, true);
    assert.equal(mrp.childRequirements[0].grossRequirement, null);
    console.log('PASS: Stale data and PDF export safeguards remain fully active');

    console.log('\n=============================================');
    console.log('ALL 6 VERIFICATION CHECKS PASSED PERFECTLY!');
    console.log('=============================================');
  } finally {
    if (fs.existsSync(testMjsPath)) {
      fs.unlinkSync(testMjsPath);
    }
  }
})();
