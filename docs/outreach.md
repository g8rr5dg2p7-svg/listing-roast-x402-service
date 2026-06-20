# Discovery Audit Outreach Packet

Use this packet for controlled outreach to x402 builders. Keep the claim narrow: the service is live, the paid routes return valid x402 challenges, the receiver wallet has confirmed paid use, and the site audit plus discovery-audit routes check stale Bazaar state plus catalog-refresh settlement requirements without making paid calls to the target endpoint.

## Primary Offer

Listing Roast x402 now includes a $0.001 GET x402 site audit, a $0.001 exact-path GET x402 discovery audit, and a $0.01 full discovery audit for builders whose Bazaar, Agentic.Market, or Agent402 routing is stale, missing from search, or showing the wrong price.

Live routes:
https://listing-roast-x402-service-production.up.railway.app/api/x402-site-audit
https://listing-roast-x402-service-production.up.railway.app/api/x402-discovery-audit

Homepage:
https://listing-roast-x402-service-production.up.railway.app

AgentCore handoff:
https://listing-roast-x402-service-production.up.railway.app/agentcore-x402-payments

Paid-use proof:
https://listing-roast-x402-service-production.up.railway.app/api/paid-usage-proof

## Proof To Mention

- Base mainnet x402 route.
- Two wallet-confirmed paid completions are visible on `/api/paid-usage-proof`; verify the live proof before posting.
- Prices: $0.001 / 1000 USDC units for the GET site audit and quick GET discovery audit, $0.01 / 10000 USDC units for the full discovery audit.
- Checks direct unpaid 402 metadata, Bazaar extension metadata, merchant discovery, stale indexed pricing, search visibility, and whether the next real settlement needs exact resource metadata for catalog refresh.
- Makes no paid calls to the endpoint being audited.
- Useful when a direct x402 route is correct but Bazaar or Agentic.Market still shows stale metadata.

## Public Post

I added a small wallet-confirmed x402 site-audit endpoint for builders whose Bazaar listing looks stale.

It checks a live x402 route against:
- direct 402 metadata
- Bazaar extension metadata
- CDP merchant discovery
- stale indexed pricing
- search visibility
- catalog-refresh settlement metadata

It does not make paid calls to the endpoint being audited.

Price starts at $0.001 on Base USDC via x402.

https://listing-roast-x402-service-production.up.railway.app

Proof before payment:
https://listing-roast-x402-service-production.up.railway.app/api/paid-usage-proof

## Builder Reply

If your x402 route returns the right direct price but Bazaar or Agentic.Market still shows an old price or misses the route in search, I built a $0.001 GET discovery audit for that exact gap.

It checks the public route, direct unpaid 402 metadata, Bazaar metadata, merchant discovery, search visibility, Agent402 route visibility, and whether the next real settlement needs exact resource metadata for catalog refresh. It does not pay the target endpoint.

https://listing-roast-x402-service-production.up.railway.app/api/x402-discovery-audit

## Directory PR Blurb

Listing Roast x402 - Wallet-confirmed paid API for x402, AgentCore Gateway, Bazaar-MCP, and agent-service builders. Offers $0.001 paid API listing quality scores, a free AgentCore x402 payments handoff, a $0.001 GET x402 site audit, a $0.001 GET x402 discovery audit quick check, a $0.01 listing roast, and a $0.01 Bazaar/Agent402 discovery audit for stale pricing, direct 402 metadata, search visibility, Agent402 route visibility, catalog-refresh settlement metadata, and no-spend next actions. Base USDC via x402.

https://listing-roast-x402-service-production.up.railway.app

## Target Surfaces

- GitHub: `xpaysh/awesome-x402`, under production implementations or tools/utilities.
- GitHub: `Merit-Systems/awesome-agentic-commerce`, near x402 ecosystem tooling.
- x402 builder threads where sellers mention stale Bazaar visibility or missing search results.
- AgentCore Gateway or Bazaar-MCP buyer threads where agents need low-price paid x402 endpoints.
- Agentic.Market and x402scan ecosystem discussions after a real external settled payment refreshes marketplace data.

## Guardrails

- Do not claim new outside revenue until `/api/cash-register` or the wallet confirms it.
- Do not claim Bazaar has refreshed until public search shows the refreshed route or price.
- Do not pay our own route for indexing unless explicitly approved as a separate spend action.
- Do not describe unpaid probes as buyer demand.
