import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FieldRobinApiError,
  FieldRobinClient,
  FieldRobinMcpError,
  FieldRobinMcpClient,
} from "../index.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("@fieldrobin/sdk", () => {
  it("fetches discovery documents and normalizes the base URL", async () => {
    const calls = [];
    const client = new FieldRobinClient({
      baseUrl: "https://example.test/",
      fetch: async (url, init) => {
        calls.push({ url, init });
        return jsonResponse({ specVersion: "1.0" });
      },
    });

    const catalog = await client.getAiCatalog();

    assert.deepEqual(catalog, { specVersion: "1.0" });
    assert.equal(calls[0].url, "https://example.test/.well-known/ai-catalog.json");
    assert.match(calls[0].init.headers.Accept, /application\/json/);
  });

  it("sends JSON and an idempotency key for A2A handoffs", async () => {
    let call;
    const client = new FieldRobinClient({
      fetch: async (url, init) => {
        call = { url, init };
        return jsonResponse({ ok: true });
      },
    });

    await client.sendA2aMessage({ prompt: "Find pricing" }, { idempotencyKey: "a2a-1" });

    assert.equal(call.url, "https://fieldrobin.com/api/v1/agent/a2a");
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.headers["Idempotency-Key"], "a2a-1");
    assert.deepEqual(JSON.parse(call.init.body), {
      jsonrpc: "2.0",
      id: "fieldrobin-sdk",
      method: "message/send",
      params: { prompt: "Find pricing" },
    });
  });

  it("exposes structured API errors and rejects oversized retry keys", async () => {
    const client = new FieldRobinClient({
      fetch: async () => jsonResponse({ code: "NOPE", message: "Denied" }, 401),
    });

    await assert.rejects(
      client.get("/private"),
      (error) => {
        assert.ok(error instanceof FieldRobinApiError);
        assert.equal(error.status, 401);
        assert.deepEqual(error.body, { code: "NOPE", message: "Denied" });
        return true;
      },
    );

    await assert.rejects(
      client.createUcpCheckout({}, { idempotencyKey: "x".repeat(129) }),
      /Idempotency-Key must be 128 characters or fewer/,
    );
  });
});

describe("FieldRobin MCP client", () => {
  it("initializes an authenticated Streamable HTTP session before listing tools", async () => {
    const calls = [];
    const client = new FieldRobinMcpClient({
      baseUrl: "https://example.test/",
      token: "oauth-access-token",
      fetch: async (url, init) => {
        calls.push({ url, init });
        const request = JSON.parse(init.body);

        if (request.method === "initialize") {
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: {
              protocolVersion: "2025-11-25",
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: "fieldrobin-mcp", version: "1.2.1" },
            },
          }), {
            status: 200,
            headers: {
              "content-type": "application/json",
              "Mcp-Session-Id": "session-123",
            },
          });
        }

        if (request.method === "tools/list") {
          return jsonResponse({
            jsonrpc: "2.0",
            id: request.id,
            result: { tools: [{ name: "get-workspace-summary" }] },
          });
        }

        return new Response(null, { status: 202 });
      },
    });

    const result = await client.listTools();

    assert.deepEqual(result.tools, [{ name: "get-workspace-summary" }]);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].url, "https://example.test/api/v1/mcp");
    assert.equal(calls[0].init.headers.Authorization, "Bearer oauth-access-token");
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "@fieldrobin/sdk", version: "0.2.0" },
      },
    });
    assert.deepEqual(JSON.parse(calls[1].init.body), {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    assert.equal(calls[2].init.headers["MCP-Session-Id"], "session-123");
    assert.equal(calls[2].init.headers["MCP-Protocol-Version"], "2025-11-25");
  });

  it("calls a named workspace tool with its JSON arguments and session", async () => {
    const calls = [];
    const client = new FieldRobinMcpClient({
      baseUrl: "https://example.test",
      token: "oauth-access-token",
      fetch: async (url, init) => {
        calls.push({ url, init });
        const request = JSON.parse(init.body);

        if (request.method === "initialize") {
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: { protocolVersion: "2025-11-25" },
          }), {
            headers: {
              "content-type": "application/json",
              "Mcp-Session-Id": "session-456",
            },
          });
        }

        if (request.method === "tools/call") {
          return jsonResponse({
            jsonrpc: "2.0",
            id: request.id,
            result: { structuredContent: { businessName: "Northwind HVAC" } },
          });
        }

        return new Response(null, { status: 202 });
      },
    });

    const result = await client.callTool("get-workspace-summary", { include: ["jobs"] });

    assert.deepEqual(result, { structuredContent: { businessName: "Northwind HVAC" } });
    assert.equal(calls.length, 3);
    assert.deepEqual(JSON.parse(calls[2].init.body), {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "get-workspace-summary",
        arguments: { include: ["jobs"] },
      },
    });
    assert.equal(calls[2].init.headers.Authorization, "Bearer oauth-access-token");
    assert.equal(calls[2].init.headers["MCP-Session-Id"], "session-456");
  });

  it("shares one initialization when read and tool calls start together", async () => {
    const calls = [];
    const client = new FieldRobinMcpClient({
      token: "oauth-access-token",
      fetch: async (_url, init) => {
        const request = JSON.parse(init.body);
        calls.push({ request, headers: init.headers });

        if (request.method === "initialize") {
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: { protocolVersion: "2025-11-25" },
          }), {
            headers: {
              "content-type": "application/json",
              "Mcp-Session-Id": "shared-session",
            },
          });
        }

        if (request.method === "tools/list") {
          return jsonResponse({
            jsonrpc: "2.0",
            id: request.id,
            result: { tools: [{ name: "get-workspace-summary" }] },
          });
        }

        if (request.method === "tools/call") {
          return jsonResponse({
            jsonrpc: "2.0",
            id: request.id,
            result: { structuredContent: { ok: true } },
          });
        }

        return new Response(null, { status: 202 });
      },
    });

    const [tools, result] = await Promise.all([
      client.listTools(),
      client.callTool("get-workspace-summary"),
    ]);

    assert.equal(tools.tools[0].name, "get-workspace-summary");
    assert.deepEqual(result.structuredContent, { ok: true });
    assert.equal(calls.filter(({ request }) => request.method === "initialize").length, 1);
    assert.equal(calls.filter(({ request }) => request.method === "notifications/initialized").length, 1);
    assert.ok(calls.filter(({ request }) => request.method === "tools/list" || request.method === "tools/call")
      .every(({ headers }) => headers["MCP-Session-Id"] === "shared-session"));
  });

  it("parses event-stream responses and preserves JSON-RPC errors", async () => {
    const client = new FieldRobinMcpClient({
      baseUrl: "https://example.test",
      token: "oauth-access-token",
      fetch: async (_url, init) => {
        const request = JSON.parse(init.body);

        if (request.method === "initialize") {
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: { protocolVersion: "2025-11-25" },
          }), {
            headers: {
              "content-type": "application/json",
              "Mcp-Session-Id": "session-789",
            },
          });
        }

        if (request.method === "tools/call") {
          const body = JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            error: { code: -32003, message: "Write scope required", data: { requiredScope: "mcp:jobs:write" } },
          });
          return new Response(`event: message\ndata: ${body}\n\n`, {
            headers: { "content-type": "text/event-stream" },
          });
        }

        return new Response(null, { status: 202 });
      },
    });

    await assert.rejects(
      client.callTool("create-job", { idempotency_key: "request-1" }),
      (error) => {
        assert.ok(error instanceof FieldRobinMcpError);
        assert.equal(error.code, -32003);
        assert.deepEqual(error.data, { requiredScope: "mcp:jobs:write" });
        return true;
      },
    );
  });

  it("preserves OAuth scope step-up details from an HTTP JSON-RPC error", async () => {
    const client = new FieldRobinMcpClient({
      token: "read-only-oauth-token",
      fetch: async (_url, init) => {
        const request = JSON.parse(init.body);

        if (request.method === "initialize") {
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: { protocolVersion: "2025-11-25" },
          }), { headers: { "content-type": "application/json" } });
        }

        if (request.method === "tools/call") {
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32003,
              message: "create-job requires mcp:read and mcp:jobs:write.",
              data: {
                code: "MCP_WRITE_SCOPE_REQUIRED",
                required_scopes: ["mcp:read", "mcp:jobs:write"],
                resource_metadata: "https://fieldrobin.com/.well-known/oauth-protected-resource/api/v1/mcp",
              },
            },
          }), {
            status: 403,
            headers: { "content-type": "application/json" },
          });
        }

        return new Response(null, { status: 202 });
      },
    });

    await assert.rejects(
      client.callTool("create-job", { idempotency_key: "job-1" }),
      (error) => {
        assert.ok(error instanceof FieldRobinMcpError);
        assert.equal(error.status, 403);
        assert.equal(error.code, -32003);
        assert.equal(error.data.code, "MCP_WRITE_SCOPE_REQUIRED");
        assert.deepEqual(error.data.required_scopes, ["mcp:read", "mcp:jobs:write"]);
        return true;
      },
    );
  });

  it("returns the matching streamed response without waiting for the event stream to close", async () => {
    const encoder = new TextEncoder();
    const abortController = new AbortController();
    let streamCanceled = false;
    const client = new FieldRobinMcpClient({
      token: "oauth-access-token",
      fetch: async (_url, init) => {
        const request = JSON.parse(init.body);

        if (request.method === "initialize") {
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: { protocolVersion: "2025-11-25" },
          }), {
            headers: {
              "content-type": "application/json",
              "Mcp-Session-Id": "stream-session",
            },
          });
        }

        if (request.method === "tools/list") {
          const source = new ReadableStream({
            start(controller) {
              const notice = JSON.stringify({
                jsonrpc: "2.0",
                method: "notifications/progress",
                params: { progress: 1 },
              });
              const response = JSON.stringify({
                jsonrpc: "2.0",
                id: request.id,
                result: { tools: [{ name: "get-workspace-summary" }] },
              });
              controller.enqueue(encoder.encode(`event: message\ndata: ${notice}\n\n`));
              controller.enqueue(encoder.encode(`event: message\ndata: ${response}\n\n`));
              init.signal?.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true });
            },
            cancel() {
              streamCanceled = true;
            },
          });
          return new Response(source, { headers: { "content-type": "text/event-stream" } });
        }

        return new Response(null, { status: 202 });
      },
    });

    const operation = client.listTools({ signal: abortController.signal });
    let timer;
    const outcome = await Promise.race([
      operation.then((value) => ({ value })),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), 100);
      }),
    ]);
    clearTimeout(timer);

    if (outcome.timedOut) {
      abortController.abort();
      await assert.rejects(operation, /aborted/);
      assert.fail("the MCP client waited for the event stream to close");
    }

    assert.deepEqual(outcome.value.tools, [{ name: "get-workspace-summary" }]);
    assert.equal(streamCanceled, true);
  });

  it("refuses workspace tool calls without an OAuth token", async () => {
    const client = new FieldRobinMcpClient({
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    });

    await assert.rejects(
      client.callTool("get-workspace-summary"),
      /OAuth access token with mcp:read/,
    );
  });
});

describe("SDK documentation", () => {
  it("checks public endpoints before starting MCP or OAuth setup", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

    assert.match(readme, /fieldrobin doctor/);
    assert.match(readme, /OAuth metadata/i);
    assert.match(readme, /does not send an OAuth token or read workspace data/i);
    assert.match(readme, /stop/i);
  });
});
