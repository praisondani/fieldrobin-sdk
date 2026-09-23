const DEFAULT_BASE_URL = "https://fieldrobin.com";
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

function normalizeBaseUrl(value) {
  const candidate = String(value || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const parsed = new URL(candidate);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("FieldRobin baseUrl must use http or https.");
  }
  return candidate;
}

function normalizeIdempotencyKey(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (normalized.length === 0) return null;
  if (normalized.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new TypeError(`Idempotency-Key must be ${MAX_IDEMPOTENCY_KEY_LENGTH} characters or fewer.`);
  }
  return normalized;
}

export class FieldRobinApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "FieldRobinApiError";
    this.status = status;
    this.body = body;
  }
}

export class FieldRobinClient {
  constructor({ baseUrl = DEFAULT_BASE_URL, token, fetch: fetchImplementation } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = token?.trim() || null;
    this.fetchImplementation = fetchImplementation || globalThis.fetch;
    if (typeof this.fetchImplementation !== "function") {
      throw new TypeError("FieldRobinClient requires a fetch implementation.");
    }
  }

  async request(pathname, {
    method = "GET",
    body,
    headers = {},
    idempotencyKey,
    signal,
  } = {}) {
    if (!pathname.startsWith("/")) {
      throw new TypeError("FieldRobin request paths must start with '/'.");
    }

    const requestHeaders = {
      Accept: "application/json, text/plain, text/markdown",
      ...headers,
    };
    if (this.token && !requestHeaders.Authorization) {
      requestHeaders.Authorization = `Bearer ${this.token}`;
    }

    const key = normalizeIdempotencyKey(idempotencyKey);
    if (key) requestHeaders["Idempotency-Key"] = key;

    let requestBody = body;
    if (body !== undefined && body !== null && typeof body !== "string") {
      requestHeaders["Content-Type"] ??= "application/json";
      requestBody = JSON.stringify(body);
    }

    const response = await this.fetchImplementation(`${this.baseUrl}${pathname}`, {
      method,
      headers: requestHeaders,
      body: requestBody,
      signal,
    });
    const contentType = response.headers?.get?.("content-type") || "";
    const responseBody = contentType.includes("json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const message = typeof responseBody === "object" && responseBody?.message
        ? responseBody.message
        : `FieldRobin request failed with HTTP ${response.status}`;
      throw new FieldRobinApiError(message, {
        status: response.status,
        body: responseBody,
      });
    }

    return responseBody;
  }

  get(pathname, options) {
    return this.request(pathname, { ...options, method: "GET" });
  }

  getAiCatalog(options) {
    return this.get("/.well-known/ai-catalog.json", options);
  }

  getAgentCard(options) {
    return this.get("/.well-known/agent-card.json", options);
  }

  getMcpServerCard(options) {
    return this.get("/.well-known/mcp/server-card.json", options);
  }

  getUcpProfile(options) {
    return this.get("/.well-known/ucp", options);
  }

  getOpenApi(options) {
    return this.get("/openapi.json", options);
  }

  sendA2aMessage(params = {}, options = {}) {
    return this.request("/api/v1/agent/a2a", {
      ...options,
      method: "POST",
      body: {
        jsonrpc: "2.0",
        id: params.id ?? "fieldrobin-sdk",
        method: "message/send",
        params,
      },
    });
  }

  createUcpCheckout(body = {}, options = {}) {
    return this.request("/api/v1/agent/ucp/checkout", {
      ...options,
      method: "POST",
      body,
    });
  }
}

export function createFieldRobinClient(options) {
  return new FieldRobinClient(options);
}
