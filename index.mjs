const DEFAULT_BASE_URL = "https://fieldrobin.com";
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
export const FIELDROBIN_MCP_PROTOCOL_VERSION = "2025-11-25";

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

export class FieldRobinMcpError extends Error {
  constructor(message, { code, data, id, status, body } = {}) {
    super(message);
    this.name = "FieldRobinMcpError";
    this.code = code;
    this.data = data;
    this.id = id;
    this.status = status;
    this.body = body;
  }
}

function parseEventBlock(block) {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data || data === "[DONE]") return null;
  return JSON.parse(data);
}

function parseEventStream(text, requestId) {
  for (const block of text.split(/\r?\n\r?\n/)) {
    const message = parseEventBlock(block);
    if (message && (requestId === undefined || message.id === requestId)) return message;
  }

  return null;
}

async function readEventStream(response, requestId) {
  const reader = response.body?.getReader();
  if (!reader) return parseEventStream(await response.text(), requestId);

  const decoder = new TextDecoder();
  let buffer = "";
  let streamEnded = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        streamEnded = true;
        buffer += decoder.decode();
      } else {
        buffer += decoder.decode(value, { stream: true });
      }
      buffer = buffer.replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const message = parseEventBlock(block);
        if (message && (requestId === undefined || message.id === requestId)) return message;
        boundary = buffer.indexOf("\n\n");
      }

      if (streamEnded) {
        const message = parseEventBlock(buffer);
        if (message && (requestId === undefined || message.id === requestId)) return message;
        return null;
      }
    }
  } finally {
    if (!streamEnded) {
      try {
        await reader.cancel();
      } catch {
        // The response may already have closed while cancellation propagated.
      }
    }
    reader.releaseLock();
  }
}

async function readMcpResponse(response, { requestId } = {}) {
  const contentType = response.headers?.get?.("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    return readEventStream(response, requestId);
  }

  const text = await response.text();
  if (!text) return null;
  if (contentType.includes("json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Authenticated or public MCP client for FieldRobin's Streamable HTTP endpoint.
 * Tool calls require a user-authorized OAuth access token; discovery does not.
 */
export class FieldRobinMcpClient {
  #token;
  #fetchImplementation;
  #sessionId = null;
  #negotiatedProtocolVersion = null;
  #initializationPromise = null;
  #initializationResult = null;
  #nextRequestId = 1;

  constructor({
    baseUrl = DEFAULT_BASE_URL,
    endpoint,
    token,
    fetch: fetchImplementation,
    protocolVersion = FIELDROBIN_MCP_PROTOCOL_VERSION,
    clientInfo = { name: "@fieldrobin/sdk", version: "0.2.0" },
  } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.endpoint = endpoint
      ? normalizeBaseUrl(endpoint)
      : `${this.baseUrl}/api/v1/mcp`;
    this.#token = token?.trim() || null;
    this.#fetchImplementation = fetchImplementation || globalThis.fetch;
    if (typeof this.#fetchImplementation !== "function") {
      throw new TypeError("FieldRobinMcpClient requires a fetch implementation.");
    }
    this.protocolVersion = protocolVersion;
    this.clientInfo = clientInfo;
  }

  async #postMessage(message, { signal, initializing = false } = {}) {
    const headers = {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    };
    if (this.#token) headers.Authorization = `Bearer ${this.#token}`;
    if (!initializing && this.#sessionId) headers["MCP-Session-Id"] = this.#sessionId;
    if (!initializing && this.#negotiatedProtocolVersion) {
      headers["MCP-Protocol-Version"] = this.#negotiatedProtocolVersion;
    }

    const response = await this.#fetchImplementation(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
      signal,
    });
    const sessionId = response.headers?.get?.("mcp-session-id");
    if (sessionId) this.#sessionId = sessionId;
    const responseBody = await readMcpResponse(response, { requestId: message.id });

    if (responseBody?.error) {
      throw new FieldRobinMcpError(responseBody.error.message || "FieldRobin MCP request failed.", {
        code: responseBody.error.code,
        data: responseBody.error.data,
        id: responseBody.id,
        status: response.status,
        body: responseBody,
      });
    }

    if (!response.ok) {
      const messageText = typeof responseBody === "object" && responseBody?.message
        ? responseBody.message
        : `FieldRobin MCP request failed with HTTP ${response.status}`;
      throw new FieldRobinApiError(messageText, {
        status: response.status,
        body: responseBody,
      });
    }

    return responseBody;
  }

  async initialize({ signal } = {}) {
    if (this.#initializationResult) return this.#initializationResult;
    if (this.#initializationPromise) return this.#initializationPromise;

    const initialization = this.#performInitialize({ signal });
    this.#initializationPromise = initialization;
    try {
      this.#initializationResult = await initialization;
      return this.#initializationResult;
    } finally {
      if (this.#initializationPromise === initialization) {
        this.#initializationPromise = null;
      }
    }
  }

  async #performInitialize({ signal } = {}) {
    this.#sessionId = null;
    this.#negotiatedProtocolVersion = null;
    const id = this.#nextRequestId++;
    const response = await this.#postMessage({
      jsonrpc: "2.0",
      id,
      method: "initialize",
      params: {
        protocolVersion: this.protocolVersion,
        capabilities: {},
        clientInfo: this.clientInfo,
      },
    }, { signal, initializing: true });

    if (response?.id !== id || !response.result?.protocolVersion) {
      throw new FieldRobinMcpError("FieldRobin MCP returned an invalid initialize response.", {
        code: "INVALID_MCP_RESPONSE",
        id: response?.id,
        body: response,
      });
    }

    this.#negotiatedProtocolVersion = response.result.protocolVersion;
    try {
      await this.#postMessage({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }, { signal });
    } catch (error) {
      this.#sessionId = null;
      this.#negotiatedProtocolVersion = null;
      throw error;
    }

    return response.result;
  }

  async #ensureInitialized(options) {
    if (!this.#negotiatedProtocolVersion) await this.initialize(options);
  }

  async listTools({ cursor, signal } = {}) {
    await this.#ensureInitialized({ signal });
    const params = cursor ? { cursor } : {};
    const id = this.#nextRequestId++;
    const response = await this.#postMessage({
      jsonrpc: "2.0",
      id,
      method: "tools/list",
      params,
    }, { signal });

    if (response?.id !== id || !response.result || !Array.isArray(response.result.tools)) {
      throw new FieldRobinMcpError("FieldRobin MCP returned an invalid tools/list response.", {
        code: "INVALID_MCP_RESPONSE",
        id: response?.id,
        body: response,
      });
    }

    return response.result;
  }

  async callTool(name, args = {}, { signal } = {}) {
    if (!this.#token) {
      throw new TypeError("FieldRobin MCP tool calls require an OAuth access token with mcp:read.");
    }

    await this.#ensureInitialized({ signal });
    const id = this.#nextRequestId++;
    const response = await this.#postMessage({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    }, { signal });

    if (response?.id !== id || !response.result) {
      throw new FieldRobinMcpError("FieldRobin MCP returned an invalid tools/call response.", {
        code: "INVALID_MCP_RESPONSE",
        id: response?.id,
        body: response,
      });
    }

    return response.result;
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

export function createFieldRobinMcpClient(options) {
  return new FieldRobinMcpClient(options);
}
