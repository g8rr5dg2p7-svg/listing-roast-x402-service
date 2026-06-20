# Launch Notes

Live production service:

- Homepage: https://listing-roast-x402-service-production.up.railway.app
- Command builder: https://listing-roast-x402-service-production.up.railway.app/builder
- Sample score page: https://listing-roast-x402-service-production.up.railway.app/sample
- Sample score JSON: https://listing-roast-x402-service-production.up.railway.app/api/sample-score
- OpenAPI: https://listing-roast-x402-service-production.up.railway.app/openapi.json
- llms.txt: https://listing-roast-x402-service-production.up.railway.app/llms.txt
- AgentCore handoff: https://listing-roast-x402-service-production.up.railway.app/agentcore-x402-payments
- Instant score route: https://listing-roast-x402-service-production.up.railway.app/api/instant-listing-score
- Indexed quick-score route: GET https://listing-roast-x402-service-production.up.railway.app/api/listing-roast for marketplace listing quality, AgentCore x402 payments readiness, x402 site-audit starter intent, discovery-audit triage, and paid API preflight
- Paid x402 ping route: https://listing-roast-x402-service-production.up.railway.app/api/x402-ping
- x402 site audit route: GET https://listing-roast-x402-service-production.up.railway.app/api/x402-site-audit
- x402 discovery audit quick route: GET https://listing-roast-x402-service-production.up.railway.app/api/x402-discovery-audit
- Agent402 route visibility audit route: GET https://listing-roast-x402-service-production.up.railway.app/api/agent402-route-visibility
- Full x402 discovery audit route: POST https://listing-roast-x402-service-production.up.railway.app/api/x402-discovery-audit
- Score route: https://listing-roast-x402-service-production.up.railway.app/api/listing-score
- Direct full roast route: GET https://listing-roast-x402-service-production.up.railway.app/api/full-listing-roast
- Custom-body full roast route: POST https://listing-roast-x402-service-production.up.railway.app/api/listing-roast (body optional for stale directory cards; omitted bodies use safe defaults)
- Schema: https://listing-roast-x402-service-production.up.railway.app/api/schema
- Score schema: https://listing-roast-x402-service-production.up.railway.app/api/score-schema
- Discovery audit schema: https://listing-roast-x402-service-production.up.railway.app/api/discovery-audit-schema
- Paid-use proof: https://listing-roast-x402-service-production.up.railway.app/api/paid-usage-proof
- Pay command handoff: https://listing-roast-x402-service-production.up.railway.app/api/pay-now?intent=paid%20API%20listing%20quality
- Local x402 discovery search: https://listing-roast-x402-service-production.up.railway.app/v2/x402/discovery/search?query=paid%20API%20listing%20quality&limit=3
- Official CDP Bazaar price-filtered search: https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=marketplace+listing+score&network=eip155%3A8453&maxUsdPrice=0.001&limit=10
- Cash register and receiver wallet balance: https://listing-roast-x402-service-production.up.railway.app/api/cash-register
- GitHub: https://github.com/g8rr5dg2p7-svg/listing-roast-x402-service

Current verified state:

- Railway deploy: successful. Latest verified deployment: 70d39f95-e996-484f-b768-057d9b9f58a5.
- Latest live code commit: pending deploy for the route-finder payable-route handoff.
- Latest GitHub release: cdp-domain-discovery-v1.
- Latest metadata version: 2026-06-20-find-paid-route-v27.
- Latest repo docs refresh: CDP/Bazaar price-filtered search, domain-restricted CDP discovery handoffs, explicit `/api/find` payable-route fields, indexed-route handoffs, stale cached-card normalization proof, expanded buyer-search hints, and Bazaar-style MCP compatibility handoffs aligned with the live payment metadata.
- Homepage: HTTP 200.
- Command builder: HTTP 200.
- Sample page: HTTP 200.
- Sample score JSON: HTTP 200.
- OpenAPI: HTTP 200.
- llms.txt: HTTP 200.
- x402 manifest: HTTP 200.
- `/api/examples`: HTTP 200; indexed quick-score sample exposes the full official CDP Bazaar handoff with `maxUsdPrice=0.001`.
- `npx awal@2.8.0 x402 details` on `GET /api/listing-roast`: HTTP 402; payment metadata exposes `officialCdpDiscovery` with `marketplace listing score`, `maxUsdPrice=0.001`, expanded alternate searches including `paid api listing quality`, `buyer-agent skip reasons`, `AgentCore x402 payments`, `Coinbase x402 Bazaar MCP server`, `x402 site audit`, `x402 discovery audit`, and `listing roast`, amount 1000, Base USDC, and the indexed `/api/listing-roast` resource.
- `GET /api/listing-roast` with stale cached `$1.00` query params: HTTP 402; payment header amount remains 1000, header has no `$1.00`, body exposes `staleCachedDirectoryInputGuard`, and paid scoring normalizes stale directory inputs to the current `$0.001 GET /api/listing-roast` defaults.
- AgentCore handoff page: HTTP 200.
- Instant score route: HTTP 402, amount 1000 USDC units.
- x402 site audit route: HTTP 402, amount 1000 USDC units.
- x402 discovery audit quick route: HTTP 402, amount 1000 USDC units.
- Agent402 route visibility audit route: HTTP 402, amount 1000 USDC units.
- Full x402 discovery audit route: HTTP 402, amount 10000 USDC units.
- Score route: HTTP 402, amount 5000 USDC units.
- Direct full roast route: HTTP 402, amount 10000 USDC units.
- Custom-body full roast route: HTTP 402, amount 10000 USDC units. Empty-body and `{}` stale-card POST probes return the same valid x402 challenge; invalid non-empty bodies return 400 before payment.
- Discovery-audit output includes direct 402 metadata, public Bazaar visibility, Agent402 route visibility, and catalog-refresh settlement guidance without paying the audited endpoint.
- Direct full-roast route: verified in `/x402.json`, `/api/find`, `/api/commands`, and direct x402 details as `GET /api/full-listing-roast` with amount 10000.
- AgentCore handoff: verified in `/x402.json`, `/llms.txt`, `/sitemap.xml`, and direct page render; it points AgentCore Gateway and Bazaar-MCP buyers to the already-indexed $0.001 GET `/api/listing-roast` first paid action.
- MCP JSON-RPC handoff: verified live on `POST /mcp`; no-spend `search_resources` and `proxy_tool_call` compatibility aliases return Listing Roast route commands, price caps, and proof links only. They do not execute paid calls.
- CDP domain-restricted discovery: verified live in `/x402.json` and `/llms.txt`; `urlSubstring=listing-roast-x402-service-production.up.railway.app` returns the indexed `/api/listing-roast` CDP resource at amount 1000 without payment.
- Route finder: `/api/find?q=buyer-agent%20skip%20reasons` now exposes explicit `selectedPaidUrl`, `firstPaidUrl`, `selectedPaidPrice`, `selectedPaidMaxAmountRequired`, and `payableRoute` fields so simple agents do not confuse the free route-selector URL with the payable x402 route.
- Receiving wallet: 0xd9E7a161aD06F410c28b3939ceF5F06f0a327a8C.
- Current network: eip155:8453 (Base mainnet).
- Receiver wallet balance is the durable revenue check across deploys.
- Current public paid-use proof: 2 wallet-confirmed paid completions, $0.002 registered gross revenue, receiver wallet 1.001 USDC / 1001000 units.
- The cash register baseline is preserved through Railway env import; use `/api/cash-register` plus the receiver wallet balance to distinguish register-confirmed and wallet-settled revenue.
- First settlement transaction: 0x59f6d99257170dd796419a7d8a50dab7d113acb2198f0fafa993f6f30490fbf0.
- Second settlement transaction: 0xa124906f1310b2100f02255c7467f2b89dae95594b36e8c70c98e6dc16a4da71 for 1000 USDC units on the indexed GET `/api/listing-roast` route.
- CDP Bazaar merchant discovery: indexed for the receiver wallet. The external search card may remain cached until another real settlement refreshes Bazaar metadata; direct live payment metadata is current. Latest official search evidence with `max-price 0.001` on 2026-06-20T19:37Z: domain-restricted CDP search with `urlSubstring=listing-roast-x402-service-production.up.railway.app` returns Listing Roast; `marketplace listing score`, `paid api listing quality`, `listing quality score API`, and `x402 listing quality` return Listing Roast. `buyer-agent skip reasons`, `x402 discovery audit`, `AgentCore x402 payments`, and `Coinbase x402 Bazaar MCP server` do not yet return the already-indexed card until another real settlement refreshes broader cached metadata.
- Local seller-hosted discovery now returns top-level `url`, `route`, `path`, `method`, `price`, `priceUsd`, `maxAmountRequired`, `max_amount_required`, and `command` fields for buyer agents that do not inspect nested metadata.

Current production environment:

```bash
railway variable set --service listing-roast-x402-service \
  SERVICE_URL=https://listing-roast-x402-service-production.up.railway.app \
  PAY_TO=0xd9E7a161aD06F410c28b3939ceF5F06f0a327a8C \
  FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402 \
  X402_NETWORK=eip155:8453 \
  CDP_API_KEY_ID=<cdp-key-id> \
  CDP_API_KEY_SECRET=<cdp-key-secret>
```

Live verification:

```bash
SMOKE_BASE_URL=https://listing-roast-x402-service-production.up.railway.app \
SMOKE_PATH=/api/instant-listing-score \
EXPECTED_X402_NETWORK=eip155:8453 \
EXPECTED_X402_AMOUNT=1000 \
npm run smoke

SMOKE_BASE_URL=https://listing-roast-x402-service-production.up.railway.app \
SMOKE_PATH=/api/listing-roast \
SMOKE_METHOD=GET \
EXPECTED_X402_NETWORK=eip155:8453 \
EXPECTED_X402_AMOUNT=1000 \
npm run smoke

SMOKE_BASE_URL=https://listing-roast-x402-service-production.up.railway.app \
SMOKE_PATH=/api/x402-ping \
EXPECTED_X402_NETWORK=eip155:8453 \
EXPECTED_X402_AMOUNT=1000 \
npm run smoke

SMOKE_BASE_URL=https://listing-roast-x402-service-production.up.railway.app \
SMOKE_PATH=/api/x402-site-audit \
EXPECTED_X402_NETWORK=eip155:8453 \
EXPECTED_X402_AMOUNT=1000 \
npm run smoke

SMOKE_BASE_URL=https://listing-roast-x402-service-production.up.railway.app \
SMOKE_PATH=/api/listing-score \
EXPECTED_X402_NETWORK=eip155:8453 \
EXPECTED_X402_AMOUNT=5000 \
npm run smoke

SMOKE_BASE_URL=https://listing-roast-x402-service-production.up.railway.app \
SMOKE_PATH=/api/x402-discovery-audit \
EXPECTED_X402_NETWORK=eip155:8453 \
EXPECTED_X402_AMOUNT=1000 \
npm run smoke

SMOKE_BASE_URL=https://listing-roast-x402-service-production.up.railway.app \
SMOKE_PATH=/api/x402-discovery-audit \
SMOKE_METHOD=POST \
EXPECTED_X402_NETWORK=eip155:8453 \
EXPECTED_X402_AMOUNT=10000 \
npm run smoke

SMOKE_BASE_URL=https://listing-roast-x402-service-production.up.railway.app \
SMOKE_PATH=/api/full-listing-roast \
SMOKE_METHOD=GET \
EXPECTED_X402_NETWORK=eip155:8453 \
EXPECTED_X402_AMOUNT=10000 \
npm run smoke

SMOKE_BASE_URL=https://listing-roast-x402-service-production.up.railway.app \
SMOKE_PATH=/api/listing-roast \
SMOKE_METHOD=POST \
EXPECTED_X402_NETWORK=eip155:8453 \
EXPECTED_X402_AMOUNT=10000 \
npm run smoke
```

Expected production result:

```json
{
  "status": 402,
  "resource": "https://listing-roast-x402-service-production.up.railway.app/api/instant-listing-score",
  "payTo": "0xd9E7a161aD06F410c28b3939ceF5F06f0a327a8C",
  "network": "eip155:8453",
  "amount": "1000"
}
```

Promotion rule:

Promote the Railway homepage, `/builder`, `/sample`, `/api/pay-now`, or `/api/paid-usage-proof` page above. The service has verified production x402 challenges, two wallet-confirmed paid completions, a receiver-wallet snapshot on the free proof endpoint, a direct $0.01 GET full-roast route after the $0.001 quick score, and a safe custom-body POST fallback for stale directory cards.
