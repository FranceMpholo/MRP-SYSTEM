const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const sql = require('mssql');
const db = require('../db');
const router = express.Router();
const SCRAP_SQL = fs.readFileSync(path.join(__dirname, '../queries/productionScrap.sql'), 'utf8');
const PARENTS_SQL = fs.readFileSync(path.join(__dirname, '../queries/scrapCommodityParents.sql'), 'utf8');
const { mapCommodities } = require('../scrapCommodity');

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

router.get('/production-scrap', async (request, response) => {
  const { startDate, endDate } = request.query;
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate
      || (Date.parse(endDate) - Date.parse(startDate)) / 86400000 > 3660 || endDate >= '9999-12-31') {
    return response.status(400).json({ success: false, error: 'Choose a valid date range of no more than 10 years.' });
  }
  response.set('Cache-Control', 'no-store');
  try {
    const parameters = [
      { name: 'StartDate', type: sql.Date, value: new Date(startDate) },
      { name: 'EndDate', type: sql.Date, value: new Date(endDate) },
    ];
    const rows = await db.query(SCRAP_SQL, parameters);
    const links = rows.length ? await db.query(PARENTS_SQL, parameters) : [];
    const { data, mappings } = mapCommodities(rows, links);
    response.json({ success: true, data, mappings, count: data.length, fetchedAt: new Date().toISOString(),
      basis: 'Confirmed scrap: validated B-SCR01 transfers only. REG: WIP-to-REG and REG-to-WIP transfer activity, separately reported.',
      mappingBasis: 'Current direct BOM parents; commodity membership does not establish the physical department responsible.' });
  } catch (error) {
    console.error('Syspro production scrap read failed:', error.message);
    response.status(503).json({ success: false, error: 'Production scrap is unavailable. Check the SYSPRO connection and retry.' });
  }
});

module.exports = router;
module.exports.validDate = validDate;
