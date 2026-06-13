# Listing Roast x402 Service

Standalone x402 paid API for critiquing paid agent/API listing copy. It has a $0.001 instant GET score endpoint, a $0.005 score endpoint, and a $0.01 full-roast endpoint.

This is intentionally separate from ApexScout and any other active project. It has a public homepage, a command-builder page, a shareable sample page, three protected JSON API routes, MCP-visible metadata, OpenAPI, llms.txt, and a local aggregate cash register.

By default, local development can use Base Sepolia through the public x402 facilitator. The live Railway service uses Base mainnet, a separate receiver wallet, and CDP facilitator credentials.

Live production deployment: https://listing-roast-x402-service-production.up.railway.app

## Routes

- `GET /` - public landing page.
- `GET /builder` - browser-side command builder for custom listing payloads.
- `GET /sample` - buyer-facing sample score page.
- `GET /api/sample-score` - free sample request, command, and score output.
- `GET /openapi.json` - machine-readable API description.
- `GET /llms.txt` - agent-readable service summary and route guide.
- `GET /x402.json` and `GET /.well-known/x402.json` - current owned x402 route manifest.
- `GET /api/schema` - full-roast request/response shape.
- `GET /api/score-schema` - score request/response shape.
- `GET /api/examples` - copy-ready request, command, and sample output.
- `GET /robots.txt` - public crawl hints.
- `GET /sitemap.xml` - public discovery URLs.
- `GET /.well-known/mcp.json` - simple tool metadata.
- `GET /api/instant-listing-score` - protected $0.001 x402 instant score route with optional query params.
- `GET /api/listing-roast` - protected $0.001 x402 quick score on the already-indexed listing-roast URL.
- `POST /api/listing-score` - protected $0.005 x402 score route.
- `POST /api/listing-roast` - protected $0.01 x402 full-roast route.
- `GET /api/cash-register` - deployment-local funnel counters, paid completion count, and receiver wallet USDC balance on Base mainnet.

## Promotion

Share the homepage first with x402, MCP, and agent-service builders. The reusable posts, direct-message copy, and monitoring checklist live in [docs/promotion.md](docs/promotion.md).

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

The default smoke test should return HTTP `402` with a `payment-required` header containing a `10000` USDC-unit challenge. Set `SMOKE_PATH=/api/listing-score EXPECTED_X402_AMOUNT=5000` to verify the score route. Set `SMOKE_PATH=/api/instant-listing-score EXPECTED_X402_AMOUNT=1000` to verify the instant GET route. Set `SMOKE_PATH=/api/listing-roast SMOKE_METHOD=GET EXPECTED_X402_AMOUNT=1000` to verify the indexed quick-score route.

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

1. Open `/builder`, `/sample`, `/api/sample-score`, `/api/instant-listing-score`, `GET /api/listing-roast`, `/openapi.json`, `/llms.txt`, `/x402.json`, `/.well-known/x402.json`, `/api/schema`, `/api/score-schema`, `/api/examples`, and `/.well-known/mcp.json` on the live URL.
2. Send one unpaid request and confirm the live route returns HTTP `402`.
3. Confirm the live instant score and indexed GET challenges use `X402_NETWORK=eip155:8453` and amount `1000`; confirm the live score challenge uses amount `5000`; confirm the full-roast challenge uses amount `10000`.
4. Monitor `/api/cash-register`; use `signals.builderViews`, `signals.builderCommandBuilds`, `signals.sampleViews`, `signals.validUnpaidChallenges`, and `signals.commandCopyClicks` for buyer interest, `signals.emptyDiscoveryProbes` for bot/discovery noise, and `receiverWallet.usdcBalance` as the durable revenue check across deploys.
5. Promote the live route only after the production challenge and settlement proof are verified.
