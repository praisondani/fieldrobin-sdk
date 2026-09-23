import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FieldRobinApiError,
  FieldRobinClient,
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
