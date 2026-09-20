const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const sql = require('mssql');
const db = require('../db');
const { validDate } = require('./productionScrap');
const query = fs.readFileSync(path.join(__dirname, '../queries/oeeFinishedGoods.sql'), 'utf8');
const router = express.Router();
router.get('/oee/finished-goods', async (request, response) => {
  const { startDate, endDate } = request.query;
  response.set('Cache-Control', 'no-store');
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate || endDate >= '9999-12-31' || (Date.parse(endDate) - Date.parse(startDate)) / 86400000 > 366) {
    return response.status(400).json({ success: false, error: 'Choose a valid period of no more than 367 days.' });
  }
  try {
    const data = await db.query(query, [{ name: 'StartDate', type: sql.Date, value: new Date(startDate) }, { name: 'EndDate', type: sql.Date, value: new Date(endDate) }]);
    response.json({ success: true, data, count: data.length, fetchedAt: new Date().toISOString(), shiftAllocation: false,
      basis: 'Source-leg transfers into B-FIN01; FG-to-WIP reported separately. Posting date, not production date. Reconciliation only.' });
  } catch (error) {
    console.error('OEE finished goods read failed:', error.message);
    response.status(503).json({ success: false, error: 'B-FIN01 movement data is unavailable.' });
  }
});
module.exports = router;
