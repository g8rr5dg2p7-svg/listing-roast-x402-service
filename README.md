# Listing Roast x402 Service

Standalone x402 paid API for marketplace listing quality and discoverability scoring, critiquing agent-service listing copy, and auditing stale x402/Bazaar discovery state. It leads with the already-indexed $0.001 GET `/api/listing-roast` quick score for marketplace listing quality, x402 site-audit starter intent, x402 discovery-audit triage, and paid API preflight. Promising buyers can then upgrade to the $0.01 POST `/api/listing-roast` full roast or the dedicated $0.001 audit GET routes. It also supports $0.001 generic navigation routes with fallback quick scores at `/api`, `/api/v1`, and `/v1`, $0.001 instant, marketplace-conversion, agent-listing-conversion, ping, site-audit, and exact-path discovery-audit GET endpoints, a $0.005 score endpoint, and a $0.01 full discovery audit endpoint.

This is intentionally separate from ApexScout and any other active project. It has a public homepage with Markdown negotiation, a command-builder page, a shareable sample page, protected JSON API routes, MCP-visible metadata and aliases, OpenAPI with explicit x402 payment hints and common aliases, AGENTS.md, docs aliases, llms.txt, well-known llms aliases, llms-full.txt, a hosted service icon, x402 discovery link headers, an agent-card discovery bridge, a fallback AI plugin manifest, an RFC 9727 API catalog, agent-tools discovery, Agent Skills discovery, and a local aggregate cash register.

By default, local development can use Base Sepolia through the public x402 facilitator. The live Railway service uses Base mainnet, a separate receiver wallet, and CDP facilitator credentials.

Live production deployment: https://listing-roast-x402-service-production.up.railway.app

## Routes

- `GET /` - public landing page.
- `GET /builder` - browser-side command builder for custom listing payloads.
- `GET /sample` - buyer-facing sample score page.
- `GET /api/sample-score` - free sample request, proven $0.001 first paid command, and score output.
- `GET /openapi.json`, `GET /.well-known/openapi.json`, `GET /api/v1/openapi.json`, and `GET /swagger.json` - machine-readable API description.
- `GET /openapi.yaml` - redirect to the JSON OpenAPI document.
- `GET /AGENTS.md`, `GET /docs`, and `GET /api-docs` - agent-readable safety, route, and discovery docs.
- `GET /llms.txt`, `GET /.well-known/llms.txt`, `GET /llms-full.txt`, `GET /.well-known/llms-full.txt`, and `GET /index.md` - agent-readable service summaries and route guides.
- `GET /icon.svg` and `GET /favicon.svg` - hosted service icon URLs for agent and marketplace profiles.
- `GET /x402.json`, `GET /.well-known/x402.json`, `GET /.well-known/x402`, and `GET /api/x402.json` - current owned x402 route manifest.
- `GET /paid-api-listing-quality`, `GET /buyer-agent-skip-reasons`, `GET /agent-service-clarity`, `GET /agent-listing-conversion`, `GET /x402-discovery-audit`, and `GET /x402-site-audit` - free no-spend intent landing pages for buyer agents and crawlers.
- `GET /api/pay-now`, `GET /api/paid-usage-proof`, `GET /api/pricing`, `GET /api/find`, and `GET/POST /api/route` - free no-spend buyer handoffs for intent-aware pay commands, wallet-backed paid-use proof, prices, task-to-route matching, and Agent402-style local route ranking before payment. Use `/api/pay-now?intent=buyer-agent%20skip%20reasons` to get the exact existing paid route for a buyer task and `/api/paid-usage-proof` to verify paid completions before paying. These handoffs also expose `provenFirstPaidAction`, which points to the indexed $0.001 `GET /api/listing-roast` route with wallet-backed paid-use proof.
- `GET /v2/x402/discovery/resources`, `GET /v2/x402/discovery/search`, and `GET /v2/x402/discovery/merchant` - free local Bazaar-shaped discovery aliases for agents that probe seller-hosted x402 discovery paths.
- `GET /.well-known/agent-card.json`, `GET /.well-known/agent.json`, `GET /api/agent-card`, and `GET /api/agent.json` - agent-card discovery bridge for the paid x402 HTTP+JSON routes.
- `GET /.well-known/ai-plugin.json` - fallback plugin-style manifest that points older agent probes to the OpenAPI and x402 payment metadata.
- `GET /.well-known/api-catalog` - RFC 9727 linkset catalog for API discovery tools, with OpenAPI, x402, agent-card, MCP, and pay-now pointers.
- `GET /.well-known/agent-tools.json` - agent-tools discovery manifest with paid route names, prices, commands, schemas, and the preferred first paid action.
- `GET /.well-known/agent-skills/index.json` and `GET /.well-known/agent-skills/listing-roast-x402/SKILL.md` - Agent Skills discovery index and verified skill instructions for buyer agents.
- `GET /api/schema` - full-roast request/response shape.
- `GET /api/score-schema` - score request/response shape.
- `GET /api/discovery-audit-schema` - x402 discovery-audit request/response shape.
- `GET /api/examples` - copy-ready request, command, sample output, and public paid-use proof.
- `GET /robots.txt` - public crawl hints with AI/search agent access, content-signal preferences, and direct discovery links.
- `GET /sitemap.xml` - public discovery URLs.
- `GET /.well-known/mcp.json`, `GET /.well-known/mcp`, `GET /.well-known/mcp-server`, and `GET /.well-known/mcp/server-card.json` - MCP-style discovery metadata and server-card aliases for agent-readiness scanners and MCP-aware clients.
- `POST /` - protected $0.001 x402 directory handoff for buyer agents following generic root-POST snippets from agent directories. It returns the paid route map and the preferred indexed `/api/listing-roast` next action after payment.
- `GET /api`, `GET /api/v1`, and `GET /v1` - protected $0.001 x402 navigation routes with route maps and fallback quick scores for agents that start at generic API paths first.
- `GET /api/instant-listing-score` - protected $0.001 x402 instant score route with optional query params.
- `GET /api/x402-marketplace-conversion` - protected $0.001 x402 marketplace conversion score route with optional query params.
- `GET /api/agent-listing-conversion` - protected $0.001 agent listing conversion score route for the dedicated post-quick-score conversion deep dive.
- `GET /api/listing-roast` - protected $0.001 x402 quick score on the already-indexed listing-roast URL. This is the preferred first paid action for buyer agents coming from Bazaar and the paid-use-confirmed route to try first for marketplace listing quality, paid API listing quality, buyer-agent skip reasons, x402 site-audit starter intent, x402 discovery-audit triage, paid API preflight, and discoverability.
- `GET /api/x402-ping` - protected $0.001 paid ping for verifying the x402 payment rail.
- `GET /api/x402-site-audit` - protected $0.001 x402/Bazaar site audit for direct 402 metadata, stale pricing, search visibility, and catalog-refresh settlement requirements. It accepts `endpointUrl`, `url`, `base_url`, `baseUrl`, `targetUrl`, or `resource` and makes no paid calls.
- `GET /api/x402-discovery-audit` - protected $0.001 exact-path x402/Bazaar discovery audit quick check for stale pricing, missing search visibility, direct 402 metadata, and whether the next real settlement needs `paymentPayload.resource` metadata. It accepts the same URL aliases and makes no paid calls.
- `POST /api/x402-discovery-audit` - protected $0.01 full x402/Bazaar discovery audit for stale pricing, missing search visibility, direct 402 metadata, and catalog-refresh settlement requirements with a custom body. It accepts the same URL aliases and makes no paid calls.
- `POST /api/listing-score` - protected $0.005 x402 score route.
- `POST /api/listing-roast` - protected $0.01 x402 full-roast upgrade after the quick score.
- `GET /api/cash-register` - deployment-local funnel counters, paid completion count, route-level paid counters, and receiver wallet USDC balance on Base mainnet. `GET /api/paid-usage-proof` is the compact buyer-facing proof view over the same evidence.

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

The default smoke test should return HTTP `402` with a `payment-required` header containing a `10000` USDC-unit challenge. Set `SMOKE_PATH=/ SMOKE_METHOD=POST` to verify the root directory handoff. Set `SMOKE_PATH=/api EXPECTED_X402_AMOUNT=1000`, `SMOKE_PATH=/api/v1 EXPECTED_X402_AMOUNT=1000`, or `SMOKE_PATH=/v1 EXPECTED_X402_AMOUNT=1000` to verify the generic entrypoints. Set `SMOKE_PATH=/api/listing-score EXPECTED_X402_AMOUNT=5000` to verify the score route. Set `SMOKE_PATH=/api/instant-listing-score EXPECTED_X402_AMOUNT=1000` to verify the instant GET route. Set `SMOKE_PATH=/api/x402-marketplace-conversion EXPECTED_X402_AMOUNT=1000` to verify the marketplace-conversion route. Set `SMOKE_PATH=/api/agent-listing-conversion EXPECTED_X402_AMOUNT=1000` to verify the agent-listing-conversion route. Set `SMOKE_PATH=/api/listing-roast SMOKE_METHOD=GET EXPECTED_X402_AMOUNT=1000` to verify the indexed quick-score route. Set `SMOKE_PATH=/api/x402-ping EXPECTED_X402_AMOUNT=1000` to verify the paid ping route. Set `SMOKE_PATH=/api/x402-site-audit EXPECTED_X402_AMOUNT=1000` to verify the site-audit route. Set `SMOKE_PATH=/api/x402-discovery-audit EXPECTED_X402_AMOUNT=1000` to verify the quick discovery-audit GET route. Set `SMOKE_PATH=/api/x402-discovery-audit SMOKE_METHOD=POST EXPECTED_X402_AMOUNT=10000` to verify the full discovery-audit POST route.

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

1. Open `/builder`, `/sample`, `/api/sample-score`, `POST /`, `/api`, `/api/v1`, `/v1`, `/api/instant-listing-score`, `/api/x402-marketplace-conversion`, `/api/agent-listing-conversion`, `GET /api/listing-roast`, `/api/x402-ping`, `/api/x402-site-audit`, `/api/x402-discovery-audit`, `/openapi.json`, `/.well-known/openapi.json`, `/api/v1/openapi.json`, `/swagger.json`, `/openapi.yaml`, `/AGENTS.md`, `/docs`, `/api-docs`, `/llms.txt`, `/.well-known/llms.txt`, `/llms-full.txt`, `/.well-known/llms-full.txt`, `/index.md`, `/icon.svg`, `/favicon.svg`, `/x402.json`, `/.well-known/x402.json`, `/.well-known/agent-card.json`, `/.well-known/agent.json`, `/.well-known/ai-plugin.json`, `/.well-known/api-catalog`, `/.well-known/agent-tools.json`, `/.well-known/agent-skills/index.json`, `/.well-known/agent-skills/listing-roast-x402/SKILL.md`, `/api/schema`, `/api/score-schema`, `/api/discovery-audit-schema`, `/api/examples`, `/.well-known/mcp.json`, `/.well-known/mcp`, `/.well-known/mcp-server`, and `/.well-known/mcp/server-card.json` on the live URL.
2. Send one unpaid request and confirm the live route returns HTTP `402`.
3. Confirm the live root directory POST, instant score, marketplace-conversion, agent-listing-conversion, indexed GET, paid ping, site-audit, and quick discovery-audit GET challenges use `X402_NETWORK=eip155:8453` and amount `1000`; confirm the live score challenge uses amount `5000`; confirm the full-roast and full discovery-audit POST challenges use amount `10000`.
4. Monitor `/api/cash-register`; use `signals.builderViews`, `signals.builderCommandBuilds`, `signals.sampleViews`, `signals.payNowViews`, `signals.proofViews`, `signals.agentToolsViews`, `signals.directoryPostValidUnpaidChallenges`, `signals.validUnpaidChallenges`, and `signals.commandCopyClicks` for buyer interest, route-level paid counters including `directoryPostCompletions` for conversion source, `signals.emptyDiscoveryProbes` for bot/discovery noise, and `receiverWallet.usdcBalance` as the durable revenue check across deploys.
5. Promote the live route only after the production challenge and settlement proof are verified.
