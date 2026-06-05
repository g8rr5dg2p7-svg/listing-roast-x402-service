const baseUrl = process.env.SMOKE_BASE_URL || "http://localhost:8787";

const response = await fetch(`${baseUrl}/api/listing-roast`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    agentName: "Smoke Test API",
    listingText: "A paid x402 API that helps builders check whether buyer agents understand the offer before paying.",
    targetBuyer: "x402 builders",
    currentPrice: "$1.00",
    currentCheckoutPath: "/api/listing-roast"
  })
});

const text = await response.text();
const paymentRequired = response.headers.get("payment-required");
let challenge = null;

if (paymentRequired) {
  challenge = JSON.parse(Buffer.from(paymentRequired, "base64url").toString("utf8"));
}

const firstAccept = challenge?.accepts?.[0];
const passed =
  response.status === 402 &&
  challenge?.resource?.url?.includes("/api/listing-roast") &&
  firstAccept?.amount === "1000000" &&
  firstAccept?.network === "eip155:84532";

console.log(JSON.stringify({ status: response.status, passed, challenge }, null, 2));

if (!passed) {
  console.error(text.slice(0, 1000));
  process.exit(1);
}
