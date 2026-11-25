function describeError(error) {
  const errors = [], seen = new Set();
  function visit(value) {
    if (!value || seen.has(value)) return;
    seen.add(value); errors.push(value);
    visit(value.cause); visit(value.originalError);
    for (const nested of value.errors || value.precedingErrors || []) visit(nested);
  }
  visit(error);
  const codes = errors.map((e) => e.code);
  const message = errors.map((e) => e.message || '').join(' ');
  const result = (code, error, retryable) => ({ code, error, retryable });
  if (codes.includes('SYSPRO_CONFIG')) return result('SYSPRO_CONFIG', 'SYSPRO configuration is invalid. Ask the administrator to check the server environment.', false);
  if (errors.some((e) => [229, 916, 4060].includes(Number(e.number ?? e.info?.number)))) return result('SYSPRO_QUERY', 'SYSPRO database access or SELECT permission was denied. Ask IT to verify database permissions.', false);
  if (codes.includes('ELOGIN') || /login failed|authentication failed/i.test(message)) return result('SYSPRO_AUTH', 'SYSPRO authentication failed. Ask IT to verify the approved SQL credentials (including any missing password).', false);
  if (codes.some((c) => ['ENOTFOUND', 'EAI_AGAIN'].includes(c)) || /getaddrinfo|ENOTFOUND|EAI_AGAIN/.test(message)) return result('SYSPRO_DNS', 'SYSPRO hostname cannot be resolved. Check the corporate network or VPN/DNS.', true);
  if (codes.some((c) => ['ETIMEOUT', 'ETIMEDOUT'].includes(c))) return result('SYSPRO_TIMEOUT', 'SYSPRO connection or query timed out. Check SQL availability and retry.', true);
  if (codes.some((c) => ['ESOCKET', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EINSTLOOKUP'].includes(c))) return result('SYSPRO_NETWORK', 'SYSPRO SQL connection is unavailable. Check the corporate network/VPN and SQL service.', true);
  if (codes.some((c) => ['ENOTOPEN', 'ECONNCLOSED'].includes(c))) return result('SYSPRO_POOL', 'SYSPRO connection was closed. Reconnecting.', true);
  return result('SYSPRO_QUERY', 'SYSPRO query failed. Ask IT to check database access, SELECT permissions and query compatibility.', false);
}

function sendFailure(response, error, operation) {
  const detail = describeError(error);
  // Do not send SQL text, addresses, driver messages or credentials to browsers.
  console.error(`${operation} failed:`, { code: detail.code, driverCode: error.code });
  return response.status(503).set('Cache-Control', 'no-store').json({ success: false, ...detail });
}

module.exports = { describeError, sendFailure };
