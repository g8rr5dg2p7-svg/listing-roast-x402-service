# Listing Roast x402 Service

Standalone $1 x402 paid API for critiquing paid agent/API listing copy.

This is intentionally separate from ApexScout and any other active project. It has one public page, one protected JSON API route, MCP-visible metadata, and a local aggregate cash register.

By default, local development uses Base Sepolia through the public x402 facilitator. Real `$1` Base mainnet deployment needs your `PAY_TO` wallet plus CDP facilitator credentials.

## Routes

- `GET /` - public landing page.
- `GET /api/schema` - request/response shape.
- `GET /.well-known/mcp.json` - simple tool metadata.
- `POST /api/listing-roast` - protected $1 x402 route.
- `GET /api/cash-register` - aggregate paid completion count.

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

1. Authenticate the local wallet and set `PAY_TO` to the receiving address.
2. Deploy with `X402_NETWORK=eip155:8453` and the CDP facilitator credentials above.
3. Open `/api/schema` and `/.well-known/mcp.json` on the live URL.
4. Send one unpaid request and confirm the live route returns HTTP `402`.
5. Submit the live service URL to x402 discovery/listing surfaces only after the live `402` challenge is verified.
