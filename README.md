# @fieldrobin/sdk

Official JavaScript and TypeScript client for FieldRobin’s **public** API and
agent-discovery surfaces.

FieldRobin is field service software for home-service businesses (customers,
jobs, scheduling, invoices). This SDK wraps `fetch` with a small typed client.
It does **not** include a private workspace SDK. Pass an OAuth or API Bearer
`token` only when you intentionally call an authenticated endpoint.

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
- Send A2A messages and create UCP checkouts with optional `Idempotency-Key`
- Surface HTTP failures as `FieldRobinApiError` with status and body
- Zero runtime dependencies (uses the platform `fetch` API)

For quick terminal checks without writing code, use
[`@fieldrobin/cli`](https://www.npmjs.com/package/@fieldrobin/cli).

## Install

```sh
npm install @fieldrobin/sdk
```

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

## Docs

- SDK page: https://fieldrobin.com/sdk
- Developer portal: https://fieldrobin.com/developers
- OpenAPI: https://fieldrobin.com/openapi.json

## Development

```sh
npm test
```
