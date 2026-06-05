# Listing Copy

## Short Listing

Listing Roast x402 is a $1 paid API for builders launching x402, MCP, or agent-facing services. Send listing copy and get buyer-agent skip reasons, the top fixes, a cleaner rewrite, and a stop-or-upgrade recommendation.

Paid endpoint: `POST /api/listing-roast`

Live URL: https://listing-roast-x402-service-production.up.railway.app

## Buyer-Facing Description

Listing Roast x402 helps builders avoid promoting paid API/service listings that buyer agents will skip. For $1, the API reviews the buyer, output promise, price visibility, checkout clarity, and example payload. It returns a structured JSON critique with skip reasons, top fixes, rewritten listing copy, and a recommendation on whether to stop editing and test traffic or fix the offer first.

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
  "endpoint": "listing-roast",
  "price": "$1.00",
  "verdict": "ready_to_test",
  "score": "5/5",
  "buyerAgentSkipReasons": [],
  "topFixes": [],
  "rewrittenListing": "...",
  "stopOrUpgrade": "...",
  "nextMeasurement": "..."
}
```

## Promotion Targets

- x402 Bazaar discovery.
- x402/MCP builder communities.
- GitHub README and repo topics.
- Any directory that accepts live x402 endpoints with clear pricing.
