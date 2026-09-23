export type JsonObject = Record<string, unknown>;

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

export function createFieldRobinClient(options?: FieldRobinClientOptions): FieldRobinClient;
