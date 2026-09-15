// Load connection settings before importing routes/db. db.js builds the ODBC
// connection string when it is first required.
require("dotenv").config({ quiet: true });
const express = require("express");
const cors = require("cors");
const inventoryRoutes = require("./routes/inventory");
const db = require("./db");

const app = express();
const port = Number(process.env.PORT) || 3001;
const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173").split(",");

app.disable("x-powered-by");
app.use(express.json());
app.use(cors({ origin(origin, callback) { callback(null, !origin || allowedOrigins.includes(origin)); } }));
app.get("/api/health", async (_request, response) => {
  try {
    await db.testConnection();
    response.json({ success: true, service: "mrp-syspro-api", database: "connected", connection: db.connectionName });
  } catch (_error) {
    response.json({ success: true, service: "mrp-syspro-api", database: "offline", connection: db.connectionName });
  }
});
app.use("/api/syspro", inventoryRoutes);
app.use("/api/syspro", require("./routes/productionScrap"));
app.use('/api/syspro', require('./routes/oee'));
app.use('/api/mrp', require('./routes/mrp'));

// Keep API misses and errors JSON, before any future static/SPA fallback.
app.use('/api', (_request, response) => {
  response.status(404).json({ success: false, error: 'API route not found. Restart the backend or check the API route.' });
});
app.use('/api', (error, _request, response, _next) => {
  console.error('API request failed:', error);
  response.status(500).json({ success: false, error: 'API request failed.' });
});

if (require.main === module) app.listen(port, () => console.log(`Syspro API listening on http://localhost:${port}`));

module.exports = app;

