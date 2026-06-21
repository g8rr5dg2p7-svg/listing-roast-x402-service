# Launch Notes

Live production service:

- Homepage: https://listing-roast-x402-service-production.up.railway.app
- Command builder: https://listing-roast-x402-service-production.up.railway.app/builder
- Sample score page: https://listing-roast-x402-service-production.up.railway.app/sample
- Sample score JSON: https://listing-roast-x402-service-production.up.railway.app/api/sample-score
- OpenAPI: https://listing-roast-x402-service-production.up.railway.app/openapi.json
- llms.txt: https://listing-roast-x402-service-production.up.railway.app/llms.txt
- AgentCore handoff: https://listing-roast-x402-service-production.up.railway.app/agentcore-x402-payments
- Coinbase Bazaar MCP handoff: https://listing-roast-x402-service-production.up.railway.app/coinbase-x402-bazaar-mcp-server
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

Official AgentCore/Bazaar references:

- AWS AgentCore Gateway Coinbase Bazaar setup: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-connect-bazaar.html
- Coinbase x402 Bazaar discovery and MCP server: https://docs.cdp.coinbase.com/x402/bazaar
- Coinbase Bazaar MCP server reference: https://docs.cdp.coinbase.com/api-reference/v2/rest-api/x402-facilitator/bazaar-mcp-server

Current verified state:

- Latest verified deployment: 89d9ed98-e8d2-487b-a374-cb41b31d105f.
- Latest live code commit: 7d75866 Expose exact intent choices in MCP handoffs.
- Latest GitHub release: mcp-exact-intent-choice-v1.
- Latest metadata version: 2026-06-21-mcp-tool-card-handoff-v72.
- Revenue truth as of the 2026-06-21T03:40Z live no-spend check: 2 wallet-confirmed paid completions, $0.002 registered gross revenue, receiver wallet 1.001 USDC / 1001000 units. No third paid completion has been confirmed yet.
- The second wallet-confirmed paid completion came through the already-indexed $0.001 `GET /api/listing-roast` route. That remains the preferred first paid action for public Bazaar, AgentCore Gateway, and Coinbase x402 Bazaar MCP buyers.
- AgentCore Gateway and Coinbase Bazaar MCP handoff is live in `/agentcore-x402-payments`, `/coinbase-x402-bazaar-mcp-server`, `/x402.json`, `/openapi.json`, `/llms.txt`, and MCP metadata. AgentCore buyers can add the official Coinbase Bazaar MCP server at `https://api.cdp.coinbase.com/platform/v2/x402/discovery/mcp` with No Authorization, use `search_resources`, and reserve `proxy_tool_call` for intentional paid calls.
- Agent-tools and x402 manifests now explicitly keep `GET /api/listing-roast` as the primary paid call, omit `POST /` from public resource/tool/action arrays, and expose `POST /` only as `fallbackDirectoryPost` for stale generic-snippet recovery. The root POST route remains live and protected at $0.001 / 1000 units, but crawlers should now sample the indexed GET route first.
- Agent-tools entries now expose plain price and amount fields in both common naming styles: `price`, `priceUsd`, `price_usd`, `maxAmountRequired`, `max_amount_required`, `maxPaymentUsd`, `max_payment_usd`, `amount`, `amount_usdc_units`, and `max_usdc_units`. Live verification confirmed the first public tool is `GET /api/listing-roast` at `$0.001` / `1000` units, with no root POST tool listed.
- The homepage now exposes `GET /api/listing-roast` as the first paid action in the first visible payment line, `x402:first-paid-action` meta tag, and top-level structured-data offer. Live verification confirmed the homepage returns 200, includes the first-paid-action meta and visible text, and its structured-data offer points to the `$0.001` indexed GET route.
- The command builder and sample page now expose the direct no-body `$0.01` `GET /api/full-listing-roast` command before the custom-body `POST /api/listing-roast` fallback. Live verification confirmed `/builder` and `/sample` return 200 and show both the direct full-roast GET and custom-body POST fallback, while `/.well-known/x402`, `/.well-known/agent-tools.json`, and `/x402.json` still keep `GET /api/listing-roast` first.
- Sample score, examples, and the unpaid `POST /api/listing-score` 402 preview now keep the full-roast upgrade label and detailed next paid action aligned on direct no-body `GET /api/full-listing-roast` at 10000 units. Live verification confirmed `/api/sample-score` and `/api/examples` return 200 with `upgradeEndpoint=/api/full-listing-roast`, and `/api/listing-score` returns a valid 402 at 5000 units with a paid-response preview that upgrades to `GET /api/full-listing-roast`.
- Current public CDP search still finds Listing Roast first for `marketplace listing score`, `paid api listing quality`, and `paid API listing quality score` with `maxUsdPrice=0.001`, plus `listing roast` and `full listing roast` with `maxUsdPrice=0.01`. Public CDP search still does not reliably surface the newer AgentCore/Bazaar-MCP terms until a real buyer settlement refreshes those public cards, so owned pay-now, OpenAPI, x402 manifest, and local discovery remain the fallback handoff.
- The owned public CDP search audit snapshot was refreshed from no-spend public CDP searches observed at 2026-06-21T03:18:07Z. Live verification confirmed `/x402.json` and `/api/paid-usage-proof` expose that timestamp and the current missing/competed-query map while keeping `/api/listing-roast` as the first public paid route.
- Exact-intent command choice is live in `/api/commands`, `/api/pay-now`, `/api/find`, and `/api/route`: buyer phrases such as `buyer-agent skip reasons` still keep the wallet-proven `/api/listing-roast` command first, but now also expose `exactIntentCommand`, `exactIntentExpectedChallenge`, `catalogRefreshCommand`, and `catalogRefreshInstruction` for `/api/buyer-agent-skip-reasons` with explicit no-self-pay guidance. Live no-spend verification on 2026-06-21T03:33Z confirmed the new fields, `/x402.json` metadata version v70, 402 challenges at 1000 units for `/api/listing-roast` and `/api/buyer-agent-skip-reasons`, and a 10000-unit challenge for `/api/full-listing-roast`.
- MCP exact-intent command choice is live in `POST /mcp` for `search_resources`, `proxy_tool_call`, and `listing_roast_x402_handoff`: AgentCore/Bazaar-MCP buyers still see `/api/listing-roast` as the first paid action, and now also receive exact-route and catalog-refresh commands such as `/api/agentcore-x402-payments` or `/api/buyer-agent-skip-reasons` with `noSelfPay=true`. Live no-spend verification on 2026-06-21T03:40Z confirmed the MCP fields, `/x402.json` metadata version v71, 402 challenges for `/api/listing-roast` and `/api/agentcore-x402-payments`, and no new paid completion.
- External directory PR remains open and clean: https://github.com/xpaysh/awesome-x402/pull/549.
- Watch for the next real movement above this baseline: `paidCompletions > 2`, `estimatedGrossRevenueUsd > 0.002`, `receiverWallet.usdcBalance > 1.001`, or paid route counters moving beyond the current second-sale baseline.

Historical verification context from the earlier route/CDP search pass:

- Railway deploy: successful. Latest verified deployment: df86a180-e074-466d-b352-c44a60c24774.
- Latest live code commit: 9a1c6f4 Add full roast direct handoff.
- Latest GitHub release: full-roast-direct-handoff-v1.
- Latest metadata version: 2026-06-21-route-cdp-search-context-v51.
- Latest repo docs refresh: direct terminal `paymentShortcut` guidance for the $0.01 full-roast route and stale-card `POST /api/listing-roast` path, early `paymentShortcut.upgradeAfterQuickScore` for true quick-score-to-full-roast upgrades, compact upgrade shortcuts in `/api/pay-now`, `/api/examples`, `/api/commands`, and payment hints, early `paymentShortcut` fields before bulky unpaid 402 metadata, compact top-level payable-route fields in unpaid 402 JSON bodies, aggregate no-spend buyer-intent signals, explicit payable-route fields on `/api/find`, `/api/route`, local discovery search, and MCP search handoffs, CDP/Bazaar price-filtered search, domain-restricted CDP discovery handoffs, indexed-route handoffs, stale cached-card normalization proof, expanded buyer-search hints, Bazaar-style MCP compatibility handoffs aligned with the live payment metadata, explicit public CDP search-reality fields that separate currently working marketplace queries from terms that should use owned pay-now or local discovery until the cached public card refreshes, top-level first-paid-action fields on `/api/paid-usage-proof`, receiver-wallet-confirmed paid-use proof embedded directly in `/api/pay-now` buyer handoffs, cached receiver-wallet proof shared across free discovery handoffs, v41 `cheapCapSearchStrategy` fields that tell buyer agents to search public CDP/Bazaar with `maxUsdPrice=0.001` or use the direct proven route when broader caps surface generic competitors, a dedicated `signals.fullRoastGetValidUnpaidChallenges` counter for buyers who reach the direct $0.01 full-roast route but stop at payment, v43 `fullRoastDirectHandoff` fields that tell high-intent full-roast buyers to use `GET /api/full-listing-roast` directly instead of stopping at the public CDP quick-score card, and v51 `publicCdpSearchAudit` fields on `/api/route` plus the existing free handoffs to expose the fresh no-spend CDP search map, the one indexed merchant resource, stale public-card service-name state, ranked-first queries, missing/competed queries, and owned handoff routes for buyers who do not find Listing Roast through public CDP search.
- Homepage: HTTP 200.
- Command builder: HTTP 200.
- Sample page: HTTP 200.
- Sample score JSON: HTTP 200.
- OpenAPI: HTTP 200.
- llms.txt: HTTP 200.
- x402 manifest: HTTP 200.
- `/api/examples`: HTTP 200; compact command, pay-now, and payment-hint sections expose `/api/listing-roast` as the first paid path and `/api/full-listing-roast` as the 10000-unit upgrade.
- `npx awal@2.8.0 x402 details` on `GET /api/listing-roast`: HTTP 402; payment metadata exposes `officialCdpDiscovery` with `marketplace listing score`, `maxUsdPrice=0.001`, expanded alternate searches including `paid api listing quality`, `buyer-agent skip reasons`, `AgentCore x402 payments`, `Coinbase x402 Bazaar MCP server`, `x402 site audit`, `x402 discovery audit`, and `listing roast`, amount 1000, Base USDC, and the indexed `/api/listing-roast` resource. The unpaid JSON body now also exposes an early `paymentShortcut` plus top-level `selectedPaidUrl`, `selectedPaidPath`, `selectedPaidMaxAmountRequired`, `firstPaidUrl`, and `payableRoute` fields so simple or truncating JSON-first agents can find the payable route without traversing nested metadata; `paymentShortcut.upgradeAfterQuickScore` points to the $0.01 `GET /api/full-listing-roast` upgrade.
- Search-reality handoff: `/x402.json`, unpaid 402 bodies, and local discovery expose `knownWorkingSearchQueries` for `marketplace listing score`, `paid api listing quality`, `paid API listing quality score`, `listing roast`, and `full listing roast`, plus `notYetRankingSearchQueries` for broader terms including `buyer-agent skip reasons`, `agent service clarity`, `x402 discovery audit`, `x402 site audit`, `AgentCore x402 payments`, and `Coinbase x402 Bazaar MCP server`.
- Public CDP search audit handoff: `/x402.json`, unpaid 402 bodies, and `/api/paid-usage-proof` expose `publicCdpSearchAudit` from the 2026-06-21 no-spend CDP audit. It records that public CDP merchant lookup currently has one indexed Listing Roast resource, the wallet-confirmed `GET /api/listing-roast` route, and that the cached public card can still show `serviceName=null` even though the live 402 challenge exposes the current service name. It also records ranked-first queries (`marketplace listing score`, `paid api listing quality`, `paid API listing quality score`, `listing roast`, `full listing roast`) and missing/competed queries (`buyer-agent skip reasons`, `agent service clarity`, `x402 discovery audit`, `x402 site audit`, `x402 listing rank doctor`, `score x402 endpoint before paying`, `paid API preflight`, `AgentCore x402 payments`, `Coinbase x402 Bazaar MCP server`) with owned pay-now handoffs.
- Paid-use proof action handoff: `/api/paid-usage-proof` is free, returns no `Payment-Required` header, and now exposes top-level `paidCompletions`, `estimatedGrossRevenueUsd`, `proofText`, `settlementStatus`, `provenFirstPaidAction`, `paymentShortcut`, `command`, `searchReality`, and `searchReality.publicCdpSearchAudit` so cautious buyer agents can verify wallet-backed use and identify the $0.001 first paid route without traversing nested proof data.
- Pay-now wallet proof handoff: `/api/pay-now?intent=full%20listing%20roast` and `/api/pay-now?intent=buyer-agent%20skip%20reasons` now include wallet-confirmed `paidUsageProof` at the payment decision point. Live verification on 2026-06-20T21:23Z returned proof text `2 wallet-confirmed paid completions; $0.002 registered; receiver wallet 1.001 USDC`, `settlementStatus=wallet-confirmed`, and `walletProof.status=wallet-confirmed` before payment.
- Discovery wallet proof handoff: v40 shares a short-lived receiver-wallet snapshot across free discovery documents so `/x402.json`, `/api/examples`, `/api/pricing`, `/api/find`, `/api/route`, local discovery search, MCP metadata, MCP server card, agent card, agent tools, agent skills, and `/api/pay-now?intent=full%20listing%20roast` all return wallet-confirmed proof consistently under discovery-read bursts.
- `GET /api/listing-roast` with stale cached `$1.00` query params: HTTP 402; payment header amount remains 1000, header has no `$1.00`, body exposes `staleCachedDirectoryInputGuard`, and paid scoring normalizes stale directory inputs to the current `$0.001 GET /api/listing-roast` defaults.
- AgentCore handoff page: HTTP 200.
- Instant score route: HTTP 402, amount 1000 USDC units.
- x402 site audit route: HTTP 402, amount 1000 USDC units.
- x402 discovery audit quick route: HTTP 402, amount 1000 USDC units.
- Agent402 route visibility audit route: HTTP 402, amount 1000 USDC units.
- Full x402 discovery audit route: HTTP 402, amount 10000 USDC units.
- Score route: HTTP 402, amount 5000 USDC units.
- Direct full roast route: HTTP 402, amount 10000 USDC units. Live no-spend verification on 2026-06-20T21:55Z moved `signals.fullRoastGetValidUnpaidChallenges` from 0 to 1 while `paidCompletions` stayed 2 and the receiver wallet stayed 1.001 USDC.
- Custom-body full roast route: HTTP 402, amount 10000 USDC units. Empty-body and `{}` stale-card POST probes return the same valid x402 challenge; invalid non-empty bodies return 400 before payment.
- Discovery-audit output includes direct 402 metadata, public Bazaar visibility, Agent402 route visibility, and catalog-refresh settlement guidance without paying the audited endpoint.
- Direct full-roast route: verified in `/x402.json`, `/api/find`, `/api/commands`, and direct x402 details as `GET /api/full-listing-roast` with amount 10000.
- AgentCore handoff: verified in `/x402.json`, `/llms.txt`, `/sitemap.xml`, and direct page render; it points AgentCore Gateway and Bazaar-MCP buyers to the already-indexed $0.001 GET `/api/listing-roast` first paid action.
- MCP JSON-RPC handoff: verified live on `POST /mcp`; no-spend `search_resources`, `proxy_tool_call`, and `listing_roast_x402_handoff` compatibility aliases return Listing Roast route commands, exact-route command choices, price caps, and proof links only. They do not execute paid calls.
- CDP domain-restricted discovery: verified live in `/x402.json` and `/llms.txt`; `urlSubstring=listing-roast-x402-service-production.up.railway.app` returns the indexed `/api/listing-roast` CDP resource at amount 1000 without payment.
- Pay-now, route finder, router, local discovery, and MCP handoffs: `/api/pay-now?intent=buyer-agent%20skip%20reasons`, `/api/find?q=x402%20discovery%20audit`, `/api/route?query=full%20roast%20rewrite%20top%20fixes`, `/v2/x402/discovery/search?query=paid%20API%20listing%20quality`, and MCP `search_resources` now expose explicit selected paid route handoffs so simple agents do not confuse free selector URLs with payable x402 routes. Each free handoff records only an aggregate selected intent key in `/api/cash-register.intentSignals`; raw query text is not stored.
- Receiving wallet: 0xd9E7a161aD06F410c28b3939ceF5F06f0a327a8C.
- Current network: eip155:8453 (Base mainnet).
- Receiver wallet balance is the durable revenue check across deploys.
- Current public paid-use proof: 2 wallet-confirmed paid completions, $0.002 registered gross revenue, receiver wallet 1.001 USDC / 1001000 units. Post-deploy no-spend verification at 2026-06-21T03:40Z confirmed the v71 MCP exact-intent handoff in `POST /mcp`, the v70 exact-intent command fields in free handoff routes, the v43 full-roast direct handoff in `/x402.json` and `/api/paid-usage-proof`, the v42 full-roast unpaid-challenge signal, v41 cheap-cap discovery handoff, v40 cached discovery wallet-proof handoff, v38 pay-now wallet-proof handoff, v37 proof-action handoff, v36 search-reality handoff, and health route; it did not create a new paid completion.
- The cash register baseline is preserved through Railway env import; use `/api/cash-register` plus the receiver wallet balance to distinguish register-confirmed and wallet-settled revenue.
- First settlement transaction: 0x59f6d99257170dd796419a7d8a50dab7d113acb2198f0fafa993f6f30490fbf0.
- Second settlement transaction: 0xa124906f1310b2100f02255c7467f2b89dae95594b36e8c70c98e6dc16a4da71 for 1000 USDC units on the indexed GET `/api/listing-roast` route.
- CDP Bazaar merchant discovery: indexed for the receiver wallet. The external search card may remain cached until another real settlement refreshes Bazaar metadata; direct live payment metadata is current. Latest official no-spend search evidence at 2026-06-21T03:18Z: merchant lookup still has the settled `GET /api/listing-roast` route from the 2026-06-18 settlement. `marketplace listing score`, `paid api listing quality`, and `paid API listing quality score` return Listing Roast first at `maxUsdPrice=0.001`; `listing roast` and `full listing roast` return Listing Roast first at `maxUsdPrice=0.01`. Broader `0.005`/`0.01` caps can put higher-priced generic competitors above Listing Roast for listing-quality phrases, so the owned handoff exposes `cheapCapSearchStrategy`, `competitiveCapRisks`, `publicCdpSearchAudit`, and domain-restricted CDP search URLs. `buyer-agent skip reasons`, `agent service clarity`, `x402 discovery audit`, `x402 site audit`, `x402 listing rank doctor`, `score x402 endpoint before paying`, `paid API preflight`, `AgentCore x402 payments`, and `Coinbase x402 Bazaar MCP server` still miss or are competed in public CDP search, so owned local discovery and `/api/pay-now` remain the right handoff for those intents until real buyer settlements refresh exact-route public catalog cards.
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
