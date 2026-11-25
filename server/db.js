require('./loadEnv');
const sql = require("mssql");
const { describeError } = require('./sysproErrors');

const timeout = (value, fallback, maximum) => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.min(Number(value), maximum) : fallback;

function buildConfig(env = process.env) {
  return {
    server: env.SYSPRO_SERVER?.trim() || "ATD-SQL01.duys.co.za",
    database: env.SYSPRO_DATABASE?.trim() || env.SYSPRO_DSN?.trim() || "SysproCompanyAtd",
    user: env.SYSPRO_USER?.trim() || undefined,
    password: env.SYSPRO_PASSWORD || "",
    port: Number(env.SYSPRO_PORT) || 1433,
    connectionTimeout: timeout(env.SYSPRO_CONNECTION_TIMEOUT_MS, 15000, 30000),
    requestTimeout: timeout(env.SYSPRO_REQUEST_TIMEOUT_MS, 60000, 90000),
    options: {
      encrypt: env.SYSPRO_ENCRYPT?.toLowerCase() !== "false",
      trustServerCertificate: env.SYSPRO_TRUST_SERVER_CERTIFICATE?.toLowerCase() !== "false",
    },
  };
}

function createDatabase({ config = buildConfig(), Pool = sql.ConnectionPool, now = Date.now } = {}) {
  let current, closing = Promise.resolve(), lastError, nextAttempt = 0, failures = 0;
  function cooldown(error) {
    lastError = error;
    nextAttempt = now() + (describeError(error).retryable ? Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)) : 60000);
  }
  async function discard(entry, error) {
    // A late error from an old request must never discard its replacement pool.
    if (current !== entry) return;
    cooldown(error);
    current = undefined;
    closing = Promise.resolve().then(() => entry.pool.close()).catch(() => {});
    await closing;
  }
  async function getEntry() {
    await closing;
    if (current) return current.promise;
    if (now() < nextAttempt) throw lastError;
    if (!config.user || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
      const error = Object.assign(new Error('Invalid SYSPRO configuration'), { code: 'SYSPRO_CONFIG' });
      cooldown(error); throw error;
    }
    // Blank passwords are permitted by some existing approved SQL logins. Do not
    // reject those configurations before SQL has actually tested authentication.
    const entry = { pool: new Pool(config) };
    current = entry;
    entry.pool.on('error', (error) => { void discard(entry, error); });
    entry.promise = Promise.resolve().then(() => entry.pool.connect()).then(() => {
      if (current !== entry) throw Object.assign(new Error('Pool closed during connection'), { code: 'ECONNCLOSED' });
      failures = 0; lastError = undefined; nextAttempt = 0;
      return entry;
    }).catch(async (error) => { await discard(entry, error); throw error; });
    return entry.promise;
  }
  async function query(queryText, parameters = []) {
    const entry = await getEntry();
    try {
      const request = entry.pool.request();
      for (const parameter of parameters) request.input(parameter.name, parameter.type, parameter.value);
      const result = await request.query(queryText);
      return result.recordset || [];
    } catch (error) {
      // SQL/permission/request timeouts do not invalidate a healthy connection.
      if (['SYSPRO_NETWORK', 'SYSPRO_POOL'].includes(describeError(error).code)) await discard(entry, error);
      throw error;
    }
  }
  return { query, async testConnection() { await query('SELECT 1 AS ConnectionTest'); return true; },
    async close() { await closing; const entry = current; if (entry) { await entry.promise.catch(() => {}); await discard(entry, Object.assign(new Error('Closed'), { code: 'ECONNCLOSED' })); } },
    connectionName: `${config.server}/${config.database}` };
}

module.exports = { ...createDatabase(), buildConfig, createDatabase };
