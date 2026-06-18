# Listing Copy

## Short Listing

Listing Roast x402 is a paid API for builders launching x402, MCP, or agent-facing services. Start with a $0.001 paid ping or instant GET score, use the $0.005 score when you have a JSON payload, upgrade to the $0.01 full roast for buyer-agent skip reasons, or use the $0.01 x402 discovery audit when Bazaar pricing/search visibility looks stale.

Command builder: https://listing-roast-x402-service-production.up.railway.app/builder

Sample score page: https://listing-roast-x402-service-production.up.railway.app/sample

Instant score endpoint: `GET /api/instant-listing-score`

Indexed quick-score endpoint: `GET /api/listing-roast`

Paid x402 ping endpoint: `GET /api/x402-ping`

x402 discovery audit endpoint: `POST /api/x402-discovery-audit`

Score endpoint: `POST /api/listing-score`

Full roast endpoint: `POST /api/listing-roast`

Live URL: https://listing-roast-x402-service-production.up.railway.app

## Buyer-Facing Description

Listing Roast x402 helps builders avoid promoting paid API/service listings that buyer agents will skip. The command builder creates a copy-ready x402 command from the buyer's own listing, and the sample page shows the score output before payment. For $0.001, the paid ping verifies the x402 rail, while the instant GET route and indexed listing-roast GET route return a quick score with no JSON body required. For $0.005, the score endpoint checks the buyer, output promise, price visibility, checkout clarity, and example payload. For $0.01, the full roast returns a structured JSON critique with skip reasons, top fixes, rewritten listing copy, and a recommendation on whether to stop editing and test traffic or fix the offer first. The $0.01 discovery audit checks a public x402 endpoint against direct 402 metadata and Bazaar search/merchant discovery without making paid calls.

## Example Request

```json
{
  "agentName": "Example x402 API",
  "listingText": "A paid x402 API that helps builders check whether buyer agents understand the offer before paying. It returns JSON with skip reasons, top fixes, a rewritten listing, and a stop-or-upgrade recommendation. Example payloads are included for quick testing.",
  "targetBuyer": "x402 and MCP builders",
  "currentPrice": "$1.00",
  "currentCheckoutPath": "/api/listing-roast",
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
  "upgradeEndpoint": "/api/listing-roast"
}
```

## Promotion Targets

- x402 Bazaar discovery.
- x402/MCP builder communities.
- GitHub README and repo topics.
- Any directory that accepts live x402 endpoints with clear pricing.
- Agent crawlers that read `/llms.txt` or `/openapi.json`.
