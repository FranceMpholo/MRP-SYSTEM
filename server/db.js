const sql = require("mssql");

function buildConfig(env = process.env) {
  return {
    server: env.SYSPRO_SERVER?.trim() || "ATD-SQL01.duys.co.za",
    database: env.SYSPRO_DATABASE?.trim() || env.SYSPRO_DSN?.trim() || "SysproCompanyAtd",
    user: env.SYSPRO_USER?.trim() || undefined,
    password: env.SYSPRO_PASSWORD || "",
    port: Number(env.SYSPRO_PORT) || 1433,
    connectionTimeout: Number(env.SYSPRO_CONNECTION_TIMEOUT_MS) || 15000,
    requestTimeout: Number(env.SYSPRO_REQUEST_TIMEOUT_MS) || 60000,
    options: {
      encrypt: env.SYSPRO_ENCRYPT?.toLowerCase() !== "false",
      trustServerCertificate: env.SYSPRO_TRUST_SERVER_CERTIFICATE?.toLowerCase() !== "false",
    },
  };
}

const config = buildConfig();
let poolPromise;

async function getPool() {
  if (!poolPromise) poolPromise = new sql.ConnectionPool(config).connect();
  try { return await poolPromise; }
  catch (error) { poolPromise = undefined; throw error; }
}

async function query(queryText, parameters = []) {
  if (parameters.length) throw new Error("Parameterized queries are not implemented for the SYSPRO adapter.");
  const pool = await getPool();
  try {
    const result = await pool.request().query(queryText);
    return result.recordset || [];
  }
  catch (error) { poolPromise = undefined; throw error; }
}

async function testConnection() {
  await query("SELECT 1 AS ConnectionTest");
  return true;
}

module.exports = { query, testConnection, buildConfig, connectionName: `${config.server}/${config.database}` };
