export type JsonObject = Record<string, unknown>;

export const FIELDROBIN_MCP_PROTOCOL_VERSION: "2025-11-25";

export interface FieldRobinClientOptions {
  baseUrl?: string;
  token?: string;
  fetch?: typeof fetch;
}

export interface FieldRobinRequestOptions {
  headers?: Record<string, string>;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface FieldRobinApiErrorOptions {
  status?: number;
  body?: unknown;
}

export class FieldRobinApiError extends Error {
  readonly name: "FieldRobinApiError";
  readonly status?: number;
  readonly body?: unknown;
  constructor(message: string, options?: FieldRobinApiErrorOptions);
}

export interface FieldRobinMcpErrorOptions {
  code?: number | string;
  data?: unknown;
  id?: string | number | null;
  status?: number;
  body?: unknown;
}

export class FieldRobinMcpError extends Error {
  readonly name: "FieldRobinMcpError";
  readonly code?: number | string;
  readonly data?: unknown;
  readonly id?: string | number | null;
  readonly status?: number;
  readonly body?: unknown;
  constructor(message: string, options?: FieldRobinMcpErrorOptions);
}

export interface FieldRobinMcpClientInfo {
  name: string;
  version: string;
  title?: string;
}

export interface FieldRobinMcpClientOptions {
  baseUrl?: string;
  endpoint?: string;
  token?: string;
  fetch?: typeof fetch;
  protocolVersion?: string;
  clientInfo?: FieldRobinMcpClientInfo;
}

export interface FieldRobinMcpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: JsonObject;
  outputSchema?: JsonObject;
  annotations?: JsonObject;
  _meta?: JsonObject;
  [key: string]: unknown;
}

export interface FieldRobinMcpListToolsResult {
  tools: FieldRobinMcpTool[];
  nextCursor?: string;
  _meta?: JsonObject;
}

export interface FieldRobinMcpCallToolResult {
  content?: JsonObject[];
  structuredContent?: JsonObject;
  isError?: boolean;
  _meta?: JsonObject;
  [key: string]: unknown;
}

export interface FieldRobinMcpRequestOptions {
  signal?: AbortSignal;
}

export class FieldRobinClient {
  readonly baseUrl: string;
  readonly token: string | null;
  constructor(options?: FieldRobinClientOptions);
  request<T = unknown>(
    pathname: string,
    options?: FieldRobinRequestOptions & {
      method?: string;
      body?: BodyInit | JsonObject;
    },
  ): Promise<T>;
  get<T = unknown>(pathname: string, options?: FieldRobinRequestOptions): Promise<T>;
  getAiCatalog<T = JsonObject>(options?: FieldRobinRequestOptions): Promise<T>;
  getAgentCard<T = JsonObject>(options?: FieldRobinRequestOptions): Promise<T>;
  getMcpServerCard<T = JsonObject>(options?: FieldRobinRequestOptions): Promise<T>;
  getUcpProfile<T = JsonObject>(options?: FieldRobinRequestOptions): Promise<T>;
  getOpenApi<T = JsonObject>(options?: FieldRobinRequestOptions): Promise<T>;
  sendA2aMessage<T = JsonObject>(
    params?: JsonObject,
    options?: FieldRobinRequestOptions,
  ): Promise<T>;
  createUcpCheckout<T = JsonObject>(
    body?: JsonObject,
    options?: FieldRobinRequestOptions,
  ): Promise<T>;
}

export class FieldRobinMcpClient {
  readonly baseUrl: string;
  readonly endpoint: string;
  readonly protocolVersion: string;
  readonly clientInfo: FieldRobinMcpClientInfo;
  constructor(options?: FieldRobinMcpClientOptions);
  initialize(options?: FieldRobinMcpRequestOptions): Promise<JsonObject>;
  listTools(options?: FieldRobinMcpRequestOptions & { cursor?: string }): Promise<FieldRobinMcpListToolsResult>;
  callTool<T extends FieldRobinMcpCallToolResult = FieldRobinMcpCallToolResult>(
    name: string,
    args?: JsonObject,
    options?: FieldRobinMcpRequestOptions,
  ): Promise<T>;
}

export function createFieldRobinMcpClient(options?: FieldRobinMcpClientOptions): FieldRobinMcpClient;

export function createFieldRobinClient(options?: FieldRobinClientOptions): FieldRobinClient;
