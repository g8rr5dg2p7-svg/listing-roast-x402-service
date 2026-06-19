# Listing Roast x402 Service

Standalone x402 paid API for paid API listing quality scoring, critiquing agent-service listing copy, and auditing stale x402/Bazaar discovery state. It leads with the already-indexed $0.001 GET `/api/listing-roast` quick score, also supports $0.001 generic navigation routes at `/api`, `/api/v1`, and `/v1`, and has $0.001 instant, marketplace-conversion, agent-listing-conversion, ping, and site-audit GET endpoints, a $0.005 score endpoint, a $0.01 full-roast endpoint, and a $0.01 discovery audit endpoint.

This is intentionally separate from ApexScout and any other active project. It has a public homepage with Markdown negotiation, a command-builder page, a shareable sample page, protected JSON API routes, MCP-visible metadata and aliases, OpenAPI with explicit x402 payment hints and common aliases, AGENTS.md, docs aliases, llms.txt, llms-full.txt, x402 discovery link headers, an agent-card discovery bridge, a fallback AI plugin manifest, an RFC 9727 API catalog, Agent Skills discovery, and a local aggregate cash register.

By default, local development can use Base Sepolia through the public x402 facilitator. The live Railway service uses Base mainnet, a separate receiver wallet, and CDP facilitator credentials.

Live production deployment: https://listing-roast-x402-service-production.up.railway.app

## Routes

- `GET /` - public landing page.
- `GET /builder` - browser-side command builder for custom listing payloads.
- `GET /sample` - buyer-facing sample score page.
- `GET /api/sample-score` - free sample request, command, and score output.
- `GET /openapi.json`, `GET /.well-known/openapi.json`, `GET /api/v1/openapi.json`, and `GET /swagger.json` - machine-readable API description.
- `GET /openapi.yaml` - redirect to the JSON OpenAPI document.
- `GET /AGENTS.md`, `GET /docs`, and `GET /api-docs` - agent-readable safety, route, and discovery docs.
- `GET /llms.txt`, `GET /llms-full.txt`, and `GET /index.md` - agent-readable service summaries and route guides.
- `GET /x402.json` and `GET /.well-known/x402.json` - current owned x402 route manifest.
- `GET /api/pricing`, `GET /api/find`, and `GET/POST /api/route` - free no-spend buyer handoffs for prices, task-to-route matching, and Agent402-style local route ranking before payment.
- `GET /v2/x402/discovery/resources`, `GET /v2/x402/discovery/search`, and `GET /v2/x402/discovery/merchant` - free local Bazaar-shaped discovery aliases for agents that probe seller-hosted x402 discovery paths.
- `GET /.well-known/agent-card.json` and `GET /.well-known/agent.json` - agent-card discovery bridge for the paid x402 HTTP+JSON routes.
- `GET /.well-known/ai-plugin.json` - fallback plugin-style manifest that points older agent probes to the OpenAPI and x402 payment metadata.
- `GET /.well-known/api-catalog` - RFC 9727 linkset catalog for API discovery tools, with OpenAPI, x402, agent-card, MCP, and pay-now pointers.
- `GET /.well-known/agent-skills/index.json` and `GET /.well-known/agent-skills/listing-roast-x402/SKILL.md` - Agent Skills discovery index and verified skill instructions for buyer agents.
- `GET /api/schema` - full-roast request/response shape.
- `GET /api/score-schema` - score request/response shape.
- `GET /api/discovery-audit-schema` - x402 discovery-audit request/response shape.
- `GET /api/examples` - copy-ready request, command, and sample output.
- `GET /robots.txt` - public crawl hints with AI/search agent access, content-signal preferences, and direct discovery links.
- `GET /sitemap.xml` - public discovery URLs.
- `GET /.well-known/mcp.json`, `GET /.well-known/mcp`, `GET /.well-known/mcp-server`, and `GET /.well-known/mcp/server-card.json` - MCP-style discovery metadata and server-card aliases for agent-readiness scanners and MCP-aware clients.
- `GET /api`, `GET /api/v1`, and `GET /v1` - protected $0.001 x402 navigation routes and route maps for agents that start at generic API paths first.
- `GET /api/instant-listing-score` - protected $0.001 x402 instant score route with optional query params.
- `GET /api/x402-marketplace-conversion` - protected $0.001 x402 marketplace conversion score route with optional query params.
- `GET /api/agent-listing-conversion` - protected $0.001 agent listing conversion score route for buyer agents searching agent-service listing clarity or buyer-agent skip reasons.
- `GET /api/listing-roast` - protected $0.001 x402 quick score on the already-indexed listing-roast URL. This is the preferred first paid action for buyer agents coming from Bazaar.
- `GET /api/x402-ping` - protected $0.001 paid ping for verifying the x402 payment rail.
- `GET /api/x402-site-audit` - protected $0.001 x402/Bazaar site audit for direct 402 metadata, stale pricing, and search visibility. It makes no paid calls.
- `POST /api/x402-discovery-audit` - protected $0.01 x402/Bazaar discovery audit for stale pricing, missing search visibility, and direct 402 metadata checks. It makes no paid calls.
- `POST /api/listing-score` - protected $0.005 x402 score route.
- `POST /api/listing-roast` - protected $0.01 x402 full-roast route.
- `GET /api/cash-register` - deployment-local funnel counters, paid completion count, route-level paid counters, and receiver wallet USDC balance on Base mainnet.

## Promotion

Share the homepage first with x402, MCP, and agent-service builders. The reusable posts, direct-message copy, and monitoring checklist live in [docs/promotion.md](docs/promotion.md). The focused discovery-audit outreach packet lives in [docs/outreach.md](docs/outreach.md).

## Run Locally

```bash
npm install
PAY_TO=0x000000000000000000000000000000000000dEaD npm start
```

Then check an unpaid x402 challenge:

```bash
curl -i -X POST http://localhost:8787/api/listing-score \
  -H 'Content-Type: application/json' \
  -d '{"agentName":"Example API","listingText":"A paid API for agents.","targetBuyer":"x402 builders"}'
```

## Verify

```bash
npm test
npm run smoke
```

The default smoke test should return HTTP `402` with a `payment-required` header containing a `10000` USDC-unit challenge. Set `SMOKE_PATH=/api EXPECTED_X402_AMOUNT=1000`, `SMOKE_PATH=/api/v1 EXPECTED_X402_AMOUNT=1000`, or `SMOKE_PATH=/v1 EXPECTED_X402_AMOUNT=1000` to verify the generic entrypoints. Set `SMOKE_PATH=/api/listing-score EXPECTED_X402_AMOUNT=5000` to verify the score route. Set `SMOKE_PATH=/api/instant-listing-score EXPECTED_X402_AMOUNT=1000` to verify the instant GET route. Set `SMOKE_PATH=/api/x402-marketplace-conversion EXPECTED_X402_AMOUNT=1000` to verify the marketplace-conversion route. Set `SMOKE_PATH=/api/agent-listing-conversion EXPECTED_X402_AMOUNT=1000` to verify the agent-listing-conversion route. Set `SMOKE_PATH=/api/listing-roast SMOKE_METHOD=GET EXPECTED_X402_AMOUNT=1000` to verify the indexed quick-score route. Set `SMOKE_PATH=/api/x402-ping EXPECTED_X402_AMOUNT=1000` to verify the paid ping route. Set `SMOKE_PATH=/api/x402-site-audit EXPECTED_X402_AMOUNT=1000` to verify the site-audit route. Set `SMOKE_PATH=/api/x402-discovery-audit EXPECTED_X402_AMOUNT=10000` to verify the discovery audit route.

## Docker

```bash
docker build -t listing-roast-x402-service .
docker run --rm -p 8787:8787 --env-file .env listing-roast-x402-service
```

Before real deployment, replace `PAY_TO` with the wallet address that should receive USDC and set:

```bash
FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
X402_NETWORK=eip155:8453
CDP_API_KEY_ID=...
CDP_API_KEY_SECRET=...
```

## Launch Checklist

1. Open `/builder`, `/sample`, `/api/sample-score`, `/api`, `/api/v1`, `/v1`, `/api/instant-listing-score`, `/api/x402-marketplace-conversion`, `/api/agent-listing-conversion`, `GET /api/listing-roast`, `/api/x402-ping`, `/api/x402-site-audit`, `/api/x402-discovery-audit`, `/openapi.json`, `/.well-known/openapi.json`, `/api/v1/openapi.json`, `/swagger.json`, `/openapi.yaml`, `/AGENTS.md`, `/docs`, `/api-docs`, `/llms.txt`, `/llms-full.txt`, `/index.md`, `/x402.json`, `/.well-known/x402.json`, `/.well-known/agent-card.json`, `/.well-known/agent.json`, `/.well-known/ai-plugin.json`, `/.well-known/api-catalog`, `/.well-known/agent-skills/index.json`, `/.well-known/agent-skills/listing-roast-x402/SKILL.md`, `/api/schema`, `/api/score-schema`, `/api/discovery-audit-schema`, `/api/examples`, `/.well-known/mcp.json`, `/.well-known/mcp`, `/.well-known/mcp-server`, and `/.well-known/mcp/server-card.json` on the live URL.
2. Send one unpaid request and confirm the live route returns HTTP `402`.
3. Confirm the live instant score, marketplace-conversion, agent-listing-conversion, indexed GET, paid ping, and site-audit challenges use `X402_NETWORK=eip155:8453` and amount `1000`; confirm the live score challenge uses amount `5000`; confirm the full-roast and full discovery-audit challenges use amount `10000`.
4. Monitor `/api/cash-register`; use `signals.builderViews`, `signals.builderCommandBuilds`, `signals.sampleViews`, `signals.validUnpaidChallenges`, and `signals.commandCopyClicks` for buyer interest, route-level paid counters for conversion source, `signals.emptyDiscoveryProbes` for bot/discovery noise, and `receiverWallet.usdcBalance` as the durable revenue check across deploys.
5. Promote the live route only after the production challenge and settlement proof are verified.
