# @fieldrobin/sdk

Official JavaScript and TypeScript client for FieldRobin’s public discovery
API and authenticated MCP workspace tools.

FieldRobin is field service software for home-service businesses (customers,
jobs, scheduling, invoices). The SDK wraps `fetch` with no runtime dependencies.
`FieldRobinClient` calls public discovery and agent endpoints.
`FieldRobinMcpClient` connects to the authenticated MCP server and calls its
workspace tools. The MCP client does not perform OAuth login; obtain a token
through Authorization Code with PKCE, then pass it to the client. The SDK does
not prompt for approval, so your application must get user approval before a
state-changing tool call. The server also enforces the token’s granted scopes.

## Published version

The npm `latest` release is currently `0.1.1`. It supports public discovery and
agent API methods. Authenticated workspace MCP support is in source version
`0.2.0` and is not available from npm yet. The `FieldRobinMcpClient` examples
below require `@fieldrobin/sdk@0.2.0` or later. Check the registry before
installing:

```sh
npm view @fieldrobin/sdk version
```

The FieldRobin product repository is private. **This repository** is the
public source for the npm package
[`@fieldrobin/sdk`](https://www.npmjs.com/package/@fieldrobin/sdk).

Related public packages:

- Skills: [`praisondani/fieldrobin-skills`](https://github.com/praisondani/fieldrobin-skills)
- CLI: [`praisondani/fieldrobin-cli`](https://github.com/praisondani/fieldrobin-cli) /
  [`@fieldrobin/cli`](https://www.npmjs.com/package/@fieldrobin/cli)

## What it does

- Normalize a FieldRobin `baseUrl` and optional Bearer token
- `GET` public discovery documents (AI catalog, agent card, MCP server card,
  UCP profile, OpenAPI)
- Initialize Streamable HTTP MCP sessions, list tools, and call workspace tools
  with an OAuth access token
- Send A2A messages and create UCP checkouts with optional `Idempotency-Key`
- Surface HTTP failures as `FieldRobinApiError` and JSON-RPC failures as
  `FieldRobinMcpError`
- Zero runtime dependencies (uses the platform `fetch` API)

Workspace tool calls require an OAuth grant with `mcp:read`. Write tools need
their documented write scope. Scope-denial errors include the required scopes
and OAuth resource metadata for a step-up flow. The SDK never retries a tool
call automatically.

For quick terminal checks without writing code, use
[`@fieldrobin/cli`](https://www.npmjs.com/package/@fieldrobin/cli).

## Install

Install the current npm release for public discovery and agent API methods:

```sh
npm install @fieldrobin/sdk
```

For authenticated MCP workspace tools before the npm `0.2.0` release, install
the public GitHub `v0.2.0` tag:

```sh
npm install github:praisondani/fieldrobin-sdk#v0.2.0
```

Before using `FieldRobinMcpClient`, check public endpoint readiness with the
CLI source branch `codex/npm-release-status` (version `0.2.0`):

```sh
npm install github:praisondani/fieldrobin-sdk#v0.2.0 github:praisondani/fieldrobin-cli#codex/npm-release-status
npx fieldrobin doctor
```

`fieldrobin doctor` checks API health, OAuth metadata, and the unauthenticated
MCP tool catalog. It does not send an OAuth token or read workspace data. A
passing result confirms public routing and discovery only; it does not verify
an OAuth grant or workspace tool call. If any check fails, stop before OAuth
registration or connection setup.

## Example

```js
import { FieldRobinClient } from "@fieldrobin/sdk";

const client = new FieldRobinClient({
  baseUrl: "https://fieldrobin.com",
});

const catalog = await client.getAiCatalog();
const openapi = await client.getOpenApi();
const checkout = await client.createUcpCheckout({}, {
  idempotencyKey: "checkout-example-1",
});
```

To read a FieldRobin workspace through MCP, pass an OAuth access token with
`mcp:read`:

```js
import { FieldRobinMcpClient } from "@fieldrobin/sdk";

const mcp = new FieldRobinMcpClient({
  token: process.env.FIELDROBIN_MCP_TOKEN,
});

const { tools } = await mcp.listTools();
const summary = await mcp.callTool("get-workspace-summary");
```

`listTools()` initializes the MCP session. `callTool()` returns the MCP tool
result; check `isError` before treating a tool result as successful. The server
enforces the OAuth scopes and business binding. Do not retry a write after an
ambiguous network failure; reconcile it with the server’s verified result.

## Docs

- SDK page: https://fieldrobin.com/sdk
- Developer portal: https://fieldrobin.com/developers
- OpenAPI: https://fieldrobin.com/openapi.json

## Development

```sh
npm test
```
