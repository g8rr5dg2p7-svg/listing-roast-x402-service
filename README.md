# Listing Roast x402 Service

Standalone $1 x402 paid API for critiquing paid agent/API listing copy.

This is intentionally separate from ApexScout and any other active project. It has one public page, one protected JSON API route, MCP-visible metadata, and a local aggregate cash register.

By default, local development can use Base Sepolia through the public x402 facilitator. The live Railway service uses Base mainnet, a separate receiver wallet, and CDP facilitator credentials.

Live production deployment: https://listing-roast-x402-service-production.up.railway.app

## Routes

- `GET /` - public landing page.
- `GET /api/schema` - request/response shape.
- `GET /api/examples` - copy-ready request, command, and sample output.
- `GET /robots.txt` - public crawl hints.
- `GET /sitemap.xml` - public discovery URLs.
- `GET /.well-known/mcp.json` - simple tool metadata.
- `POST /api/listing-roast` - protected $1 x402 route.
- `GET /api/cash-register` - deployment-local funnel counters, paid completion count, and receiver wallet USDC balance on Base mainnet.

## Promotion

Share the homepage first with x402, MCP, and agent-service builders. The reusable posts, direct-message copy, and monitoring checklist live in [docs/promotion.md](docs/promotion.md).

## Run Locally

```bash
npm install
PAY_TO=0x000000000000000000000000000000000000dEaD npm start
```

Then check the unpaid x402 challenge:

```bash
curl -i -X POST http://localhost:8787/api/listing-roast \
  -H 'Content-Type: application/json' \
  -d '{"agentName":"Example API","listingText":"A paid API for agents.","targetBuyer":"x402 builders"}'
```

## Verify

```bash
npm test
npm run smoke
```

The smoke test should return HTTP `402` with a `payment-required` header containing a `1000000` USDC-unit challenge.

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

1. Open `/api/schema`, `/api/examples`, and `/.well-known/mcp.json` on the live URL.
2. Send one unpaid request and confirm the live route returns HTTP `402`.
3. Confirm the live challenge uses `X402_NETWORK=eip155:8453` and amount `1000000`.
4. Monitor `/api/cash-register`; use `signals.validUnpaidChallenges` for buyer-shaped payment attempts, `signals.emptyDiscoveryProbes` for bot/discovery noise, and `receiverWallet.usdcBalance` as the durable revenue check across deploys.
5. Promote the live route only after the production challenge and settlement proof are verified.
