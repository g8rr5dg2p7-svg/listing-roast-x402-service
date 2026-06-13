const baseUrl = process.env.SMOKE_BASE_URL || "http://localhost:8787";
const expectedNetwork = process.env.EXPECTED_X402_NETWORK || "eip155:84532";
const smokePath = process.env.SMOKE_PATH || "/api/listing-roast";
const defaultGetPaths = new Set(["/api/instant-listing-score", "/api/x402-ping"]);
const smokeMethod = process.env.SMOKE_METHOD || (defaultGetPaths.has(smokePath) ? "GET" : "POST");
const expectedAmount = process.env.EXPECTED_X402_AMOUNT || (["/api/instant-listing-score", "/api/x402-ping"].includes(smokePath) ? "1000" : smokePath === "/api/listing-score" ? "5000" : "10000");

const requestOptions = {
  method: smokeMethod,
  headers: { "Content-Type": "application/json" },
  body: smokeMethod === "GET" ? undefined : JSON.stringify({
    agentName: "Smoke Test API",
    listingText: "A paid x402 API that helps builders check whether buyer agents understand the offer before paying.",
    targetBuyer: "x402 builders",
    currentPrice: "$1.00",
    currentCheckoutPath: "/api/listing-roast"
  })
};

const response = await fetch(`${baseUrl}${smokePath}`, requestOptions);

const text = await response.text();
const paymentRequired = response.headers.get("payment-required");
let challenge = null;

if (paymentRequired) {
  challenge = JSON.parse(Buffer.from(paymentRequired, "base64url").toString("utf8"));
}

const firstAccept = challenge?.accepts?.[0];
const passed =
  response.status === 402 &&
  challenge?.resource?.url?.includes(smokePath) &&
  firstAccept?.amount === expectedAmount &&
  firstAccept?.network === expectedNetwork;

console.log(JSON.stringify({ status: response.status, passed, challenge }, null, 2));

if (!passed) {
  console.error(text.slice(0, 1000));
  process.exit(1);
}
