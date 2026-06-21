import { z } from "zod";

export const listingRoastRequestSchema = z
  .object({
    agentName: z.string().trim().min(1).max(120),
    listingText: z.string().trim().min(20).max(4000),
    targetBuyer: z.string().trim().min(2).max(160).default("x402, MCP, and AgentCore Gateway builders"),
    currentPrice: z.string().trim().max(40).optional(),
    currentCheckoutPath: z.string().trim().max(240).optional(),
    goal: z.string().trim().max(240).optional(),
    source: z.string().trim().max(120).optional()
  })
  .strict();

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return undefined;
}

export function normalizeListingRoastRequestBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return body;
  }

  return {
    agentName: firstString(body.agentName, body.serviceName, body.name, body.agent, body.title),
    listingText: firstString(body.listingText, body.description, body.listing, body.copy, body.summary),
    targetBuyer: firstString(body.targetBuyer, body.buyer, body.audience, body.targetAudience),
    currentPrice: firstString(body.currentPrice, body.price, body.amount),
    currentCheckoutPath: firstString(body.currentCheckoutPath, body.checkoutPath, body.path, body.route, body.url, body.endpointUrl, body.resource),
    goal: firstString(body.goal, body.objective),
    source: firstString(body.source)
  };
}

const buyerWords = [
  "buyer",
  "agent",
  "x402",
  "mcp",
  "pay",
  "paid",
  "price",
  "output",
  "json",
  "example",
  "checkout"
];

function hasAny(text, words) {
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word));
}

function firstSentence(text) {
  const sentence = text.split(/[.!?]\s+/)[0]?.trim();
  return sentence && sentence.length > 0 ? sentence.slice(0, 220) : text.slice(0, 220);
}

function classify(input) {
  const listing = input.listingText;
  const hasBuyer = hasAny(`${listing} ${input.targetBuyer}`, ["buyer", "agent", "mcp", "x402"]);
  const hasPrice = Boolean(input.currentPrice) || hasAny(listing, ["$", "price", "paid", "per call"]);
  const hasOutput = hasAny(listing, ["returns", "output", "json", "report", "audit", "score", "recommendation"]);
  const hasCheckout = Boolean(input.currentCheckoutPath) || hasAny(listing, ["checkout", "endpoint", "/api", "402", "payment"]);
  const hasExample = hasAny(listing, ["example", "sample", "try", "payload", "curl"]);
  const score = [hasBuyer, hasPrice, hasOutput, hasCheckout, hasExample].filter(Boolean).length;

  return {
    score,
    hasBuyer,
    hasPrice,
    hasOutput,
    hasCheckout,
    hasExample,
    verdict: score >= 4 ? "ready_to_test" : score >= 2 ? "fix_before_paid_push" : "rewrite_before_promotion"
  };
}

function issueList(input, checks) {
  const issues = [];

  if (!checks.hasBuyer) {
    issues.push("Name the buyer directly. A buyer agent should know whether this is for x402 builders, MCP builders, API sellers, or another narrow group.");
  }

  if (!checks.hasPrice) {
    issues.push("Show the price before the checkout path. Buyer agents should not discover cost only after a 402 challenge.");
  }

  if (!checks.hasOutput) {
    issues.push("Say exactly what the paid response returns. The listing should promise a concrete JSON/report shape, not a broad benefit.");
  }

  if (!checks.hasCheckout) {
    issues.push("Make the payment path obvious. Include the protected API route or a payment-intent link near the first call to action.");
  }

  if (!checks.hasExample) {
    issues.push("Add a short example payload or use case. Agent buyers convert faster when the first request can be copied.");
  }

  if (input.listingText.length > 900) {
    issues.push("Shorten the listing. Long copy hides the payment decision and makes buyer agents summarize instead of buying.");
  }

  return issues.slice(0, 6);
}

function rewrite(input, checks) {
  const price = input.currentPrice || "the listed price";
  const path = input.currentCheckoutPath || "POST /api/your-paid-route";
  const target = input.targetBuyer || "x402, MCP, and AgentCore Gateway builders";
  const output = checks.hasOutput ? firstSentence(input.listingText) : "a structured critique with skip reasons, conversion fixes, and a stop-or-upgrade recommendation";

  return `${input.agentName} helps ${target} improve a paid agent/API listing before promotion. For ${price}, call ${path} to get ${output}. Use it when the listing is live enough to sell, but the buyer, output, price, or checkout promise may still be unclear.`;
}

export function buildListingRoast(input) {
  const checks = classify(input);
  const issues = issueList(input, checks);
  const topFixes = issues.length
    ? issues.slice(0, 3)
    : [
        "Keep the buyer, price, output, and checkout path visible in the first screen.",
        "Add one copy-paste payload for the most likely buyer.",
        "Track whether visitors reach the unpaid 402 challenge before changing the offer."
      ];

  return {
    service: "Listing Roast x402",
    endpoint: "listing-roast",
    price: "$0.01",
    verdict: checks.verdict,
    score: `${checks.score}/5`,
    input: {
      agentName: input.agentName,
      targetBuyer: input.targetBuyer,
      currentPrice: input.currentPrice ?? null,
      currentCheckoutPath: input.currentCheckoutPath ?? null,
      goal: input.goal ?? null
    },
    buyerAgentSkipReasons: issues,
    topFixes,
    rewrittenListing: rewrite(input, checks),
    stopOrUpgrade: checks.score >= 4
      ? "Stop editing and test paid traffic. Upgrade only if qualified buyers reach the 402 challenge but do not complete payment."
      : "Do not promote broadly yet. Fix the missing buyer, output, price, or checkout promise first.",
    nextMeasurement: "Watch page views, unpaid 402 challenges, paid completions, and refund/complaint signals separately."
  };
}

export function buildListingScore(input) {
  const checks = classify(input);
  const issues = issueList(input, checks);

  return {
    service: "Listing Roast x402",
    endpoint: "listing-score",
    price: "$0.005",
    verdict: checks.verdict,
    score: `${checks.score}/5`,
    checkedSignals: {
      buyer: checks.hasBuyer,
      price: checks.hasPrice,
      output: checks.hasOutput,
      checkout: checks.hasCheckout,
      example: checks.hasExample
    },
    firstFix: issues[0] || "The basics are present. Use the full roast only if you want a rewrite and launch recommendation.",
    nextStep: checks.score >= 4
      ? "Ready to test. Pay for the full roast only if you want the rewritten listing and stop-or-upgrade guidance."
      : "Fix the first missing signal before buying traffic or promoting broadly.",
    upgradeEndpoint: "/api/full-listing-roast",
    nextPaidAction: {
      path: "/api/full-listing-roast",
      method: "GET",
      price: "$0.01",
      maxAmountRequired: "10000",
      reason: "Buy the direct full roast when you want the rewritten listing, top fixes, and stop-or-upgrade guidance without assembling another JSON body."
    }
  };
}

export const requestExample = {
  agentName: "Example x402 API",
  listingText: "A paid x402 API that helps builders check whether buyer agents understand the offer before paying. It returns JSON with skip reasons, top fixes, a rewritten listing, and a stop-or-upgrade recommendation. Example payloads are included for quick testing.",
  targetBuyer: "x402, MCP, and AgentCore Gateway builders",
  currentPrice: "$0.01",
  currentCheckoutPath: "/api/example-agent-score",
  goal: "Increase first paid conversion"
};
