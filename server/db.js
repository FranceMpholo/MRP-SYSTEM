const odbc = require("odbc");

function connectionValue(value) {
  if (!value) return "";
  return `{${String(value).replaceAll("}", "}}")}}`;
}

function buildConnectionString(env = process.env) {
  // Use this when the complete ODBC string is already known.
  if (env.SYSPRO_ODBC?.trim()) return env.SYSPRO_ODBC.trim();

  const parts = [`DSN=${env.SYSPRO_DSN?.trim() || "SysproCompanyAtd"}`];
  if (env.SYSPRO_USER?.trim()) parts.push(`UID=${connectionValue(env.SYSPRO_USER.trim())}`);
  if (env.SYSPRO_PASSWORD) parts.push(`PWD=${connectionValue(env.SYSPRO_PASSWORD)}`);
  if (env.SYSPRO_DATABASE?.trim()) parts.push(`DATABASE=${connectionValue(env.SYSPRO_DATABASE.trim())}`);
  return parts.join(";");
}

const connectionString = buildConnectionString();
let poolPromise;

async function getPool() {
  if (!poolPromise) poolPromise = odbc.pool(connectionString);
  try { return await poolPromise; }
  catch (error) { poolPromise = undefined; throw error; }
}

async function query(sql, parameters = []) {
  const pool = await getPool();
  try { return await pool.query(sql, parameters); }
  catch (error) { poolPromise = undefined; throw error; }
}

async function testConnection() {
  const pool = await getPool();
  await pool.query("SELECT 1 AS ConnectionTest");
  return true;
}

module.exports = { query, testConnection, buildConnectionString, connectionName: connectionString.startsWith("DSN=") ? connectionString.split(";")[0] : "SYSPRO_ODBC override" };
