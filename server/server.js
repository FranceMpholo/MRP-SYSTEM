require('./loadEnv');
const express = require("express");
const cors = require("cors");
const inventoryRoutes = require("./routes/inventory");
const db = require("./db");
const { sendFailure } = require('./sysproErrors');

const app = express();
const port = Number(process.env.PORT) || 3001;
const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173").split(",");

app.disable("x-powered-by");
app.use(express.json());
app.use(cors({ origin(origin, callback) { callback(null, !origin || allowedOrigins.includes(origin)); } }));
// Process readiness only. SQL health and individual data sources are checked separately.
app.get('/api/ready', (_request, response) => response.set('Cache-Control', 'no-store').json({ success: true, service: 'mrp-syspro-api' }));
app.get("/api/health", async (_request, response) => {
  response.set('Cache-Control', 'no-store');
  try {
    await db.testConnection();
    response.json({ success: true, service: "mrp-syspro-api", database: "connected", checkedAt: new Date().toISOString() });
  } catch (error) {
    sendFailure(response, error, 'SYSPRO health check');
  }
});
app.use("/api/syspro", inventoryRoutes);
app.use("/api/syspro", require("./routes/cycleCount"));
app.use('/api/syspro', require('./routes/sheetAnalysis'));
app.use("/api/syspro/fcsd", require("./routes/fcsd"));
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

if (require.main === module) {
  const server = app.listen(port, () => console.log(`Syspro API listening on http://localhost:${port}`));
  server.on('error', (error) => { console.error('API startup failed:', error.code); process.exitCode = 1; });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    server.close(() => { db.close().finally(() => process.exit(0)); });
    setTimeout(() => process.exit(1), 5000).unref();
  });
}

module.exports = app;

