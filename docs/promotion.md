# Promotion Kit

Use this when sharing Listing Roast x402 with builders. Keep the claim tight: the payment path is live and verified, but outside-buyer revenue starts only when someone other than us pays the endpoint.

## Primary Links

- Homepage: https://listing-roast-x402-service-production.up.railway.app
- Command builder: https://listing-roast-x402-service-production.up.railway.app/builder
- Sample score page: https://listing-roast-x402-service-production.up.railway.app/sample
- Sample score JSON: https://listing-roast-x402-service-production.up.railway.app/api/sample-score
- OpenAPI: https://listing-roast-x402-service-production.up.railway.app/openapi.json
- llms.txt: https://listing-roast-x402-service-production.up.railway.app/llms.txt
- Instant score route: https://listing-roast-x402-service-production.up.railway.app/api/instant-listing-score
- Indexed quick-score route: GET https://listing-roast-x402-service-production.up.railway.app/api/listing-roast
- Paid x402 ping route: https://listing-roast-x402-service-production.up.railway.app/api/x402-ping
- x402 site audit route: GET https://listing-roast-x402-service-production.up.railway.app/api/x402-site-audit
- x402 discovery audit quick route: GET https://listing-roast-x402-service-production.up.railway.app/api/x402-discovery-audit
- Agent402 route visibility audit route: GET https://listing-roast-x402-service-production.up.railway.app/api/agent402-route-visibility
- Full x402 discovery audit route: POST https://listing-roast-x402-service-production.up.railway.app/api/x402-discovery-audit
- Score route: https://listing-roast-x402-service-production.up.railway.app/api/listing-score
- Full roast route: POST https://listing-roast-x402-service-production.up.railway.app/api/listing-roast
- Examples: https://listing-roast-x402-service-production.up.railway.app/api/examples
- Cash register: https://listing-roast-x402-service-production.up.railway.app/api/cash-register
- GitHub: https://github.com/g8rr5dg2p7-svg/listing-roast-x402-service

## Short Pitch

Listing Roast x402 is a paid API for x402, MCP, and agent-service builders who need a paid API listing quality score before promotion. Start with the already-indexed $0.001 GET `/api/listing-roast` quick score for marketplace listing quality, x402 site-audit starter intent, x402 discovery-audit triage, and paid API preflight; use the $0.001 instant score URL, paid ping, GET site audit, GET discovery-audit quick route, or exact GET Agent402 route visibility route when needed; use the $0.005 listing score when you have a JSON payload; upgrade to the $0.01 full roast for buyer-agent skip reasons; or use the $0.01 full discovery audit when Bazaar pricing/search visibility or Agent402 route visibility needs a custom body.

## X-Style Post

I launched Listing Roast x402: a paid API listing quality score and roast for paid agent/API listing copy before you promote it.

Use the command builder or see the sample output first. Start with the already-indexed $0.001 GET `/api/listing-roast` quick score for marketplace listing quality, x402 site-audit starter intent, discovery-audit triage, and paid API preflight. Use the paid ping, instant score URL, GET x402 site audit, exact-path GET x402 discovery audit, or exact GET Agent402 route visibility audit when needed. Upgrade to the $0.005 score or $0.01 full roast when you want buyer-agent skip reasons, top fixes, a tighter rewrite, and a stop-or-upgrade recommendation. If Bazaar shows a stale price, Agent402 does not route to you, or search misses your route, use the $0.001 GET discovery audit first or the $0.01 full discovery audit when you need a custom request body.

No account. x402 payment. Base USDC.

https://listing-roast-x402-service-production.up.railway.app

Sample:
https://listing-roast-x402-service-production.up.railway.app/sample

Build a command for your own listing:
https://listing-roast-x402-service-production.up.railway.app/builder

## Builder Community Post

I built a small x402 service for people launching paid APIs or agent tools that need a paid API listing quality score before promotion.

Listing Roast x402 takes your listing copy and returns a structured critique:

- why buyer agents may skip it
- the top fixes to make before promoting
- a rewritten listing
- whether to stop editing and test paid traffic

It is live on Base mainnet with a $0.001 indexed GET quick score that now covers marketplace listing quality, x402 site-audit starter intent, discovery-audit triage, and paid API preflight; a $0.001 paid ping; a $0.001 instant GET score; a $0.001 GET site-audit endpoint; a $0.001 GET discovery-audit endpoint; a $0.001 GET Agent402 route visibility endpoint; a $0.005 score endpoint; a $0.01 full discovery audit endpoint; and a $0.01 full-roast endpoint.
The quick discovery audit and full discovery audit check a live x402 route against direct 402 metadata, public Bazaar discovery, Agent402 route visibility, and the settlement metadata needed for Bazaar catalog refresh without making paid calls.

https://listing-roast-x402-service-production.up.railway.app

The sample page shows the score output before payment:

https://listing-roast-x402-service-production.up.railway.app/sample

The command builder creates a copy-ready x402 command from your listing:

https://listing-roast-x402-service-production.up.railway.app/builder

The examples endpoint has a copy-ready request:

https://listing-roast-x402-service-production.up.railway.app/api/examples

Feedback welcome, especially from builders listing x402, MCP, or agent-service endpoints.

## Direct Message

I saw you are building around x402/agent APIs. I launched a small paid endpoint that scores and roasts API listing copy before promotion.

It is meant for the exact moment where the endpoint works, but the buyer, output, price, or checkout promise may still be unclear.

Homepage:
https://listing-roast-x402-service-production.up.railway.app

No pressure, but I would value blunt feedback if the offer is useful or not.

## Agent Commands

Instant GET:

```bash
npx awal@2.8.0 x402 pay https://listing-roast-x402-service-production.up.railway.app/api/instant-listing-score \
  -X GET \
  --max-amount 1000
```

Paid x402 ping:

```bash
npx awal@2.8.0 x402 pay https://listing-roast-x402-service-production.up.railway.app/api/x402-ping \
  -X GET \
  --max-amount 1000
```

x402 site audit:

```bash
npx awal@2.8.0 x402 pay https://listing-roast-x402-service-production.up.railway.app/api/x402-site-audit \
  -X GET \
  --max-amount 1000
```

x402 discovery audit quick check:

```bash
npx awal@2.8.0 x402 pay https://listing-roast-x402-service-production.up.railway.app/api/x402-discovery-audit \
  -X GET \
  --max-amount 1000
```

Agent402 route visibility quick check:

```bash
npx awal@2.8.0 x402 pay https://listing-roast-x402-service-production.up.railway.app/api/agent402-route-visibility \
  -X GET \
  --max-amount 1000
```

Full x402 discovery audit:

```bash
npx awal@2.8.0 x402 pay https://listing-roast-x402-service-production.up.railway.app/api/x402-discovery-audit \
  -X POST \
  -d '{"endpointUrl":"https://listing-roast-x402-service-production.up.railway.app/api/listing-roast","method":"GET","expectedAmount":"1000","expectedNetwork":"eip155:8453","searchQuery":"listing roast"}' \
  --max-amount 10000
```

Indexed listing-roast quick score:

```bash
npx awal@2.8.0 x402 pay https://listing-roast-x402-service-production.up.railway.app/api/listing-roast \
  -X GET \
  --max-amount 1000
```

Score:

```bash
npx awal@2.8.0 x402 pay https://listing-roast-x402-service-production.up.railway.app/api/listing-score \
  -X POST \
  -d '{"agentName":"Example x402 API","listingText":"A paid x402 API that helps builders check whether buyer agents understand the offer before paying. It returns JSON with skip reasons, top fixes, a rewritten listing, and a stop-or-upgrade recommendation. Example payloads are included for quick testing.","targetBuyer":"x402 and MCP builders","currentPrice":"$0.01","currentCheckoutPath":"/api/example-agent-score","goal":"Increase first paid conversion"}' \
  --max-amount 5000
```

Full roast:

```bash
npx awal@2.8.0 x402 pay https://listing-roast-x402-service-production.up.railway.app/api/listing-roast \
  -X POST \
  -d '{"agentName":"Example x402 API","listingText":"A paid x402 API that helps builders check whether buyer agents understand the offer before paying. It returns JSON with skip reasons, top fixes, a rewritten listing, and a stop-or-upgrade recommendation. Example payloads are included for quick testing.","targetBuyer":"x402 and MCP builders","currentPrice":"$0.01","currentCheckoutPath":"/api/example-agent-score","goal":"Increase first paid conversion"}' \
  --max-amount 10000
```

## Where To Share First

- x402 builder threads and chats.
- MCP builder communities.
- Agent API marketplace builders.
- Builders with a live paid endpoint but unclear listing copy.
- GitHub projects that already mention x402 and are asking for service examples.

Avoid cold spam. Prefer posts where builders are already discussing x402 discovery, paid APIs, MCP tools, or launch copy.

## What To Watch

- `/api/cash-register` -> `receiverWallet.usdcBalance`
- `/api/cash-register` -> `signals.homepageViews`
- `/api/cash-register` -> `signals.builderViews`
- `/api/cash-register` -> `signals.builderCommandBuilds`
- `/api/cash-register` -> `signals.sampleViews`
- `/api/cash-register` -> `signals.commandCopyClicks`
- `/api/cash-register` -> `signals.examplesViews`
- `/api/cash-register` -> `signals.unpaidChallenges`
- `/api/cash-register` -> `signals.validUnpaidChallenges`
- `/api/cash-register` -> `signals.discoveryAuditValidUnpaidChallenges`
- `/api/cash-register` -> `signals.emptyDiscoveryProbes`
- unpaid 402 challenge checks, split between buyer-shaped requests and empty discovery probes
- paid completions
- complaints or refund signals
- whether Bazaar search uses the refreshed description

## Do Not Claim Yet

- Do not claim outside customer revenue until the receiver wallet balance increases above the proof-payment balance.
- Do not claim marketplace ranking if Bazaar is still serving cached metadata.
- Do not imply this is connected to ApexScout.
