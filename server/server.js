require("dotenv").config();
const express = require("express");
const cors = require("cors");
const inventoryRoutes = require("./routes/inventory");
const db = require("./db");

const app = express();
const port = Number(process.env.PORT) || 3001;
const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173").split(",");

app.disable("x-powered-by");
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

if (require.main === module) app.listen(port, () => console.log(`Syspro API listening on http://localhost:${port}`));

module.exports = app;
