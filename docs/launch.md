# Launch Notes

Live production service:

- Homepage: https://listing-roast-x402-service-production.up.railway.app
- Command builder: https://listing-roast-x402-service-production.up.railway.app/builder
- Sample score page: https://listing-roast-x402-service-production.up.railway.app/sample
- Sample score JSON: https://listing-roast-x402-service-production.up.railway.app/api/sample-score
- OpenAPI: https://listing-roast-x402-service-production.up.railway.app/openapi.json
- llms.txt: https://listing-roast-x402-service-production.up.railway.app/llms.txt
- Instant score route: https://listing-roast-x402-service-production.up.railway.app/api/instant-listing-score
- Indexed quick-score route: GET https://listing-roast-x402-service-production.up.railway.app/api/listing-roast for marketplace listing quality, x402 site-audit starter intent, discovery-audit triage, and paid API preflight
- Paid x402 ping route: https://listing-roast-x402-service-production.up.railway.app/api/x402-ping
- x402 site audit route: GET https://listing-roast-x402-service-production.up.railway.app/api/x402-site-audit
- x402 discovery audit quick route: GET https://listing-roast-x402-service-production.up.railway.app/api/x402-discovery-audit
- Full x402 discovery audit route: POST https://listing-roast-x402-service-production.up.railway.app/api/x402-discovery-audit
- Score route: https://listing-roast-x402-service-production.up.railway.app/api/listing-score
- Full roast route: POST https://listing-roast-x402-service-production.up.railway.app/api/listing-roast
- Schema: https://listing-roast-x402-service-production.up.railway.app/api/schema
- Score schema: https://listing-roast-x402-service-production.up.railway.app/api/score-schema
- Discovery audit schema: https://listing-roast-x402-service-production.up.railway.app/api/discovery-audit-schema
- Cash register and receiver wallet balance: https://listing-roast-x402-service-production.up.railway.app/api/cash-register
- GitHub: https://github.com/g8rr5dg2p7-svg/listing-roast-x402-service

Current verified state:

- Railway deploy: successful. Latest verified deployment: 7b0d2b55-17e4-4a4d-b94d-370d0039d87b.
- Homepage: HTTP 200.
- Command builder: HTTP 200.
- Sample page: HTTP 200.
- Sample score JSON: HTTP 200.
- OpenAPI: HTTP 200.
- llms.txt: HTTP 200.
- x402 manifest: HTTP 200.
- Instant score route: HTTP 402, amount 1000 USDC units.
- x402 site audit route: HTTP 402, amount 1000 USDC units.
- x402 discovery audit quick route: HTTP 402, amount 1000 USDC units.
- Full x402 discovery audit route: HTTP 402, amount 10000 USDC units.
- Score route: HTTP 402, amount 5000 USDC units.
- Full roast route: HTTP 402, amount 10000 USDC units.
- Full-roast upgrade prompt: verified in `/api/examples`, `/api/sample-score`, and the OpenAPI 200 example as `Call this x402 endpoint with POST and pay up to 0.01 USDC: https://listing-roast-x402-service-production.up.railway.app/api/listing-roast`.
- Receiving wallet: 0xd9E7a161aD06F410c28b3939ceF5F06f0a327a8C.
- Current network: eip155:8453 (Base mainnet).
- Receiver wallet balance is the durable revenue check across deploys.
- The deployment-local cash counter can reset when Railway replaces the container.
- First settlement transaction: 0x59f6d99257170dd796419a7d8a50dab7d113acb2198f0fafa993f6f30490fbf0.
- Second settlement transaction: 0xa124906f1310b2100f02255c7467f2b89dae95594b36e8c70c98e6dc16a4da71 for 1000 USDC units on the indexed GET `/api/listing-roast` route.
- CDP Bazaar merchant discovery: indexed for the receiver wallet.

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
SMOKE_PATH=/api/listing-roast \
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

Promote the Railway homepage, `/builder`, `/sample`, or `/api/pay-now` page above. The service has verified production x402 challenges, two wallet-confirmed paid completions, and an explicit $0.01 full-roast upgrade prompt after the $0.001 quick score.
