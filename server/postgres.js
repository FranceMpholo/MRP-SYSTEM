const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || "mrp_planner",
  user: process.env.PGUSER || "mrp_app",
  password: process.env.PGPASSWORD,
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error);
});

async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result.rows;
}

async function testConnection() {
  await pool.query("SELECT 1 AS connection_test");
  return true;
}

module.exports = {
  query,
  testConnection,
  pool,
  connectionName: `${process.env.PGHOST || "127.0.0.1"}/${process.env.PGDATABASE || "mrp_planner"}`,
};
