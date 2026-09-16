const noAccessToken = async () => null;

let accessTokenProvider = noAccessToken;

export class ApiError extends Error {
  constructor(message, { status = 0, details = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export function setAccessTokenProvider(provider) {
  if (provider !== null && provider !== undefined && typeof provider !== "function") {
    throw new TypeError("Access-token provider must be a function");
  }
  accessTokenProvider = provider || noAccessToken;
}

export function resetAccessTokenProvider() {
  accessTokenProvider = noAccessToken;
}

async function readJsonResponse(response) {
  if (response.status === 204) return null;

  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("API returned an invalid JSON response", {
      status: response.status,
    });
  }
}

export async function apiRequest(path, {
  method = "GET",
  body,
  headers,
  signal,
} = {}) {
  if (typeof path !== "string" || !path.startsWith("/api/")) {
    throw new TypeError("API path must start with /api/");
  }

  const requestHeaders = new Headers(headers);
  requestHeaders.set("Accept", "application/json");

  const token = await accessTokenProvider();
  if (token !== null && token !== undefined && String(token).trim() !== "") {
    requestHeaders.set("Authorization", `Bearer ${String(token).trim()}`);
  } else {
    requestHeaders.delete("Authorization");
  }

  const init = {
    method: String(method).toUpperCase(),
    headers: requestHeaders,
    signal,
  };

  if (body !== undefined) {
    requestHeaders.set("Content-Type", "application/json");
    init.body = JSON.stringify(body);
  }

  const response = await fetch(path, init);
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new ApiError(
      typeof payload?.error === "string" && payload.error.trim()
        ? payload.error
        : `API request failed (${response.status})`,
      {
        status: response.status,
        details: payload?.details ?? null,
      }
    );
  }

  return payload;
}

export const apiGet = (path, options = {}) =>
  apiRequest(path, { ...options, method: "GET" });

export const apiPost = (path, body, options = {}) =>
  apiRequest(path, { ...options, method: "POST", body });

export const apiPatch = (path, body, options = {}) =>
  apiRequest(path, { ...options, method: "PATCH", body });

export const apiDelete = (path, options = {}) =>
  apiRequest(path, { ...options, method: "DELETE" });
