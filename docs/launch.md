# Launch Notes

Live testnet service:

- Homepage: https://listing-roast-x402-service-production.up.railway.app
- Paid route: https://listing-roast-x402-service-production.up.railway.app/api/listing-roast
- Schema: https://listing-roast-x402-service-production.up.railway.app/api/schema
- Cash register: https://listing-roast-x402-service-production.up.railway.app/api/cash-register
- GitHub: https://github.com/g8rr5dg2p7-svg/listing-roast-x402-service

Current verified state:

- Railway deploy: successful.
- Homepage: HTTP 200.
- Paid route: HTTP 402.
- Payment amount: 1000000 USDC units.
- Receiving wallet: 0xf7646611cDA025Df20eCAc1C2c513e30deED2Df2.
- Current network: eip155:84532 (Base Sepolia testnet).
- Gross paid completions: 0.

Production switch:

```bash
railway variable set --service listing-roast-x402-service \
  SERVICE_URL=https://listing-roast-x402-service-production.up.railway.app \
  PAY_TO=0xf7646611cDA025Df20eCAc1C2c513e30deED2Df2 \
  FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402 \
  X402_NETWORK=eip155:8453 \
  CDP_API_KEY_ID=<cdp-key-id> \
  CDP_API_KEY_SECRET=<cdp-key-secret>
```

Do not run the production switch until the CDP key is available. Mainnet x402 uses real funds and requires the CDP facilitator credentials.

Live verification after production switch:

```bash
node -e 'fetch("https://listing-roast-x402-service-production.up.railway.app/api/listing-roast", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({agentName:"Production Check", listingText:"A paid x402 API that helps builders check whether buyer agents understand the offer before paying.", targetBuyer:"x402 builders", currentPrice:"$1.00", currentCheckoutPath:"/api/listing-roast"})}).then(async r=>{const h=r.headers.get("payment-required"); const challenge=h?JSON.parse(Buffer.from(h,"base64url").toString("utf8")):null; console.log(JSON.stringify({status:r.status, resource:challenge?.resource?.url, payTo:challenge?.accepts?.[0]?.payTo, network:challenge?.accepts?.[0]?.network, amount:challenge?.accepts?.[0]?.amount}, null, 2));})'
```

Expected production result:

```json
{
  "status": 402,
  "resource": "https://listing-roast-x402-service-production.up.railway.app/api/listing-roast",
  "payTo": "0xf7646611cDA025Df20eCAc1C2c513e30deED2Df2",
  "network": "eip155:8453",
  "amount": "1000000"
}
```

Promotion rule:

Only promote the service as a real paid endpoint after the live production challenge shows `network: "eip155:8453"`.
