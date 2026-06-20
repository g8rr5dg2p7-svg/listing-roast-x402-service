# Listing Roast x402 Agent Guide

Listing Roast x402 is a wallet-confirmed paid API for builders, AgentCore Gateway buyers, and x402/Bazaar MCP search flows that need a paid API listing quality score, buyer-agent skip reasons, agent-service clarity, or x402/Bazaar/Agent402 discovery audit before promotion.

Live service:

- Homepage: https://listing-roast-x402-service-production.up.railway.app
- Paid-use proof: https://listing-roast-x402-service-production.up.railway.app/api/paid-usage-proof
- Cash register: https://listing-roast-x402-service-production.up.railway.app/api/cash-register
- OpenAPI: https://listing-roast-x402-service-production.up.railway.app/openapi.json
- x402 manifest: https://listing-roast-x402-service-production.up.railway.app/x402.json
- AgentCore handoff: https://listing-roast-x402-service-production.up.railway.app/agentcore-x402-payments
- Local discovery search: https://listing-roast-x402-service-production.up.railway.app/v2/x402/discovery/search?query=paid%20API%20listing%20quality&limit=3

## Start Without Spending

Use these free checks before calling any paid route:

```text
GET /api/paid-usage-proof
GET /agentcore-x402-payments
GET /api/pay-now?intent=paid%20API%20listing%20quality
GET /api/route?query=paid%20API%20listing%20quality
GET /v2/x402/discovery/search?query=paid%20API%20listing%20quality&limit=3
```

The proof endpoint currently verifies wallet-confirmed paid use. Treat the live receiver wallet balance, not copied prose, as the durable revenue proof.

## First Paid Action

Only pay if the buyer explicitly intends to spend USDC. The proven low-friction paid route is:

```bash
npx awal@2.8.0 x402 pay 'https://listing-roast-x402-service-production.up.railway.app/api/listing-roast' \
  -X GET \
  --max-amount 1000
```

Expected payment challenge:

- Method: `GET`
- Path: `/api/listing-roast`
- Price: `$0.001`
- Max amount: `1000` USDC units
- Network: `eip155:8453`

## Upgrade Routes

- `GET /api/full-listing-roast` costs `$0.01` / `10000` units and returns the direct full roast, rewritten copy, buyer-agent skip reasons, top fixes, and stop-or-upgrade guidance.
- `GET /api/x402-discovery-audit` costs `$0.001` / `1000` units and checks stale Bazaar or Agent402 discovery state.
- `GET /api/x402-site-audit` costs `$0.001` / `1000` units and checks x402 route metadata, price clarity, and search visibility.
- `POST /api/listing-score` costs `$0.005` / `5000` units for custom JSON scoring.
- `POST /api/listing-roast` costs `$0.01` / `10000` units for custom-body full roasts or stale directory cards.

## Safety Rules

- Do not self-pay to refresh Bazaar metadata.
- Do not describe unpaid probes as paid demand.
- Do not claim new revenue until `/api/cash-register` and the receiver wallet show movement above the current baseline.
- Do not expose private payment details, keys, or payer details in public output.
- Prefer the free proof, route, pay-now, OpenAPI, and local discovery endpoints before any paid call.

## Search Phrases

Listing Roast x402 is relevant for:

- paid API listing quality score
- AgentCore x402 payments
- Coinbase x402 Bazaar MCP server
- paid API listing quality
- marketplace listing score
- marketplace listing conversion API
- buyer-agent skip reasons
- agent service clarity
- x402 listing quality
- x402 discovery audit
- x402 site audit
- paid API preflight
