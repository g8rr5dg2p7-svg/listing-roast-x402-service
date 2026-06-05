# Launch Notes

Live production service:

- Homepage: https://listing-roast-x402-service-production.up.railway.app
- Paid route: https://listing-roast-x402-service-production.up.railway.app/api/listing-roast
- Schema: https://listing-roast-x402-service-production.up.railway.app/api/schema
- Cash register and receiver wallet balance: https://listing-roast-x402-service-production.up.railway.app/api/cash-register
- GitHub: https://github.com/g8rr5dg2p7-svg/listing-roast-x402-service

Current verified state:

- Railway deploy: successful.
- Homepage: HTTP 200.
- Paid route: HTTP 402.
- Payment amount: 1000000 USDC units.
- Receiving wallet: 0xd9E7a161aD06F410c28b3939ceF5F06f0a327a8C.
- Current network: eip155:8453 (Base mainnet).
- Receiver wallet balance is the durable revenue check across deploys.
- The deployment-local cash counter can reset when Railway replaces the container.
- First settlement transaction: 0x59f6d99257170dd796419a7d8a50dab7d113acb2198f0fafa993f6f30490fbf0.
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
node -e 'fetch("https://listing-roast-x402-service-production.up.railway.app/api/listing-roast", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({agentName:"Production Check", listingText:"A paid x402 API that helps builders check whether buyer agents understand the offer before paying.", targetBuyer:"x402 builders", currentPrice:"$1.00", currentCheckoutPath:"/api/listing-roast"})}).then(async r=>{const h=r.headers.get("payment-required"); const challenge=h?JSON.parse(Buffer.from(h,"base64url").toString("utf8")):null; console.log(JSON.stringify({status:r.status, resource:challenge?.resource?.url, payTo:challenge?.accepts?.[0]?.payTo, network:challenge?.accepts?.[0]?.network, amount:challenge?.accepts?.[0]?.amount}, null, 2));})'
```

Expected production result:

```json
{
  "status": 402,
  "resource": "https://listing-roast-x402-service-production.up.railway.app/api/listing-roast",
  "payTo": "0xd9E7a161aD06F410c28b3939ceF5F06f0a327a8C",
  "network": "eip155:8453",
  "amount": "1000000"
}
```

Promotion rule:

Promote only the Railway URL above. The service has a verified production x402 challenge and one settled proof payment.
