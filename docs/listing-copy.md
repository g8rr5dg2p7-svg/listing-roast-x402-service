# Listing Copy

## Short Listing

Listing Roast x402 is a wallet-confirmed paid score API for builders launching x402, MCP, AgentCore Gateway, or agent-facing services who need a paid API listing quality score, marketplace listing quality feedback, and discoverability guidance before promotion. Start with the already-indexed $0.001 GET `/api/listing-roast` quick score for paid API listing quality, marketplace listing quality, AgentCore x402 payments readiness, buyer-agent skip reasons, x402 site-audit starter intent, x402 discovery-audit triage, and paid API preflight; buy the $0.01 GET `/api/full-listing-roast` route for buyer-agent skip reasons, top fixes, rewritten copy, and launch guidance without assembling a POST body; use POST `/api/listing-roast` when you have a custom body; use the free `/agentcore-x402-payments` handoff, $0.001 paid ping, instant GET score URL, GET site audit, exact-path GET discovery audit, or exact GET Agent402 route visibility audit when needed; use the $0.005 score when you have a JSON payload; or use the $0.01 full x402 discovery audit when Bazaar pricing/search visibility or Agent402 route visibility needs a custom body.

Command builder: https://listing-roast-x402-service-production.up.railway.app/builder

Sample score page: https://listing-roast-x402-service-production.up.railway.app/sample

Paid-use proof: https://listing-roast-x402-service-production.up.railway.app/api/paid-usage-proof

AgentCore handoff: https://listing-roast-x402-service-production.up.railway.app/agentcore-x402-payments

Instant score endpoint: `GET /api/instant-listing-score`

Indexed quick-score endpoint: `GET /api/listing-roast`

Paid x402 ping endpoint: `GET /api/x402-ping`

x402 site audit endpoint: `GET /api/x402-site-audit`

x402 discovery audit endpoints: `GET /api/x402-discovery-audit`, `GET /api/agent402-route-visibility`, `POST /api/x402-discovery-audit`

Score endpoint: `POST /api/listing-score`

Direct full roast endpoint: `GET /api/full-listing-roast`

Custom-body full roast endpoint: `POST /api/listing-roast` (body optional for stale directory cards; omitted bodies use safe defaults)

Live URL: https://listing-roast-x402-service-production.up.railway.app

## Buyer-Facing Description

Listing Roast x402 helps builders avoid promoting paid API/service listings that buyer agents will skip. The command builder creates a copy-ready x402 command from the buyer's own listing, the sample page shows the score output before payment, and the proof endpoint shows wallet-confirmed paid use before payment. For $0.001, the already-indexed listing-roast GET route is the preferred paid API listing quality, marketplace listing quality, AgentCore x402 payments readiness, buyer-agent skip-reason, x402 site-audit starter, discovery-audit triage, and paid API preflight quick score; the free AgentCore handoff points AgentCore Gateway and Bazaar-MCP buyers to that same route; the paid ping verifies the x402 rail; the instant GET route gives a dedicated score URL; the site audit checks public x402 metadata and Bazaar search visibility; the exact-path GET discovery audit gives the cheapest discovery-audit first touch; and `GET /api/agent402-route-visibility` gives Agent402/router searches a literal paid route. For $0.005, the score endpoint checks the buyer, output promise, price visibility, checkout clarity, and example payload. For $0.01, GET `/api/full-listing-roast` returns a structured JSON critique with skip reasons, top fixes, rewritten listing copy, and a recommendation on whether to stop editing and test traffic or fix the offer first. POST `/api/listing-roast` remains available for custom request bodies and stale directory cards; omitted bodies use safe defaults. The $0.01 POST discovery audit checks a public x402 endpoint against direct 402 metadata, Bazaar search/merchant discovery, Agent402 route visibility, and the catalog-refresh settlement requirements without making paid calls when a custom JSON body is needed.

## Example Request

```json
{
  "agentName": "Example x402 API",
  "listingText": "A paid x402 API that helps builders check whether buyer agents understand the offer before paying. It returns JSON with skip reasons, top fixes, a rewritten listing, and a stop-or-upgrade recommendation. Example payloads are included for quick testing.",
  "targetBuyer": "x402 and MCP builders",
  "currentPrice": "$0.01",
  "currentCheckoutPath": "/api/example-agent-score",
  "goal": "Increase first paid conversion"
}
```

## Example Output Shape

```json
{
  "service": "Listing Roast x402",
  "endpoint": "listing-score",
  "price": "$0.005",
  "verdict": "ready_to_test",
  "score": "5/5",
  "checkedSignals": {},
  "firstFix": "...",
  "nextStep": "...",
  "upgradeEndpoint": "/api/full-listing-roast"
}
```

## Promotion Targets

- x402 Bazaar discovery.
- x402/MCP builder communities.
- AgentCore Gateway and Bazaar-MCP buyer flows.
- GitHub README and repo topics.
- Any directory that accepts live x402 endpoints with clear pricing.
- Agent crawlers that read `/llms.txt` or `/openapi.json`.
