import express from "express";
import { getAuthHeaders } from "@coinbase/cdp-sdk/auth";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware } from "@x402/express";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";

import { getCashRegister, recordPaidCompletion, recordSignal } from "./cashRegister.js";
import {
  buildDiscoveryAuditExampleOutput,
  buildX402DiscoveryAudit,
  discoveryAuditOutputSchema,
  discoveryAuditRequestExample,
  discoveryAuditRequestSchema
} from "./discoveryAudit.js";
import { buildListingRoast, buildListingScore, listingRoastRequestSchema, requestExample } from "./roast.js";

const DEFAULT_DEV_PAY_TO = "0x000000000000000000000000000000000000dEaD";
const BASE_MAINNET_NETWORK = "eip155:8453";
const BASE_USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_DECIMALS = 1_000_000n;
const INSTANT_SCORE_PATH = "/api/instant-listing-score";
const CONVERSION_SCORE_PATH = "/api/x402-marketplace-conversion";
const AGENT_LISTING_PATH = "/api/agent-listing-conversion";
const ROAST_PATH = "/api/listing-roast";
const PING_PATH = "/api/x402-ping";
const SITE_AUDIT_PATH = "/api/x402-site-audit";
const DISCOVERY_AUDIT_PATH = "/api/x402-discovery-audit";
const PAY_NOW_PATH = "/api/pay-now";
const WELL_KNOWN_X402_PATH = "/.well-known/x402";
const WELL_KNOWN_X402_JSON_PATH = "/.well-known/x402.json";
const INSTANT_SCORE_AMOUNT = "1000";
const PING_AMOUNT = "1000";
const SITE_AUDIT_AMOUNT = "1000";
const DISCOVERY_AUDIT_AMOUNT = "10000";
const DISCOVERY_KEYWORDS = [
  "marketplace listing score",
  "marketplace listing quality",
  "marketplace listing conversion",
  "paid API listing quality score",
  "agent-service listing score",
  "x402 marketplace conversion",
  "x402 site audit",
  "x402 service discoverability audit",
  "x402 route health check",
  "paid API preflight",
  "x402 discovery audit",
  "x402 bazaar discovery audit",
  "x402 listing stale price",
  "buyer-agent skip reasons",
  "buyer agent skip reasons",
  "agent service listing clarity",
  "agent service listing audit",
  "agent listing conversion score",
  "agent listing conversion",
  "agent listing clarity",
  "x402 listing quality",
  "paid API listing",
  "x402 listing",
  "x402 service discoverability"
];
const DISCOVERY_DESCRIPTION = "Paid x402 API for paid API listing quality score, agent-service listing clarity, buyer-agent skip reasons, marketplace listing conversion, and x402 service discoverability before promotion.";
const INDEXED_QUICK_SCORE_DESCRIPTION = "Listing Roast Quick Score x402: $0.001 GET score API for marketplace listing quality, paid API discoverability, x402 listing quality, agent service listing clarity, buyer-agent skip reasons, and conversion checks on the indexed /api/listing-roast URL.";

export function getConfig(overrides = {}) {
  const payTo = overrides.payTo || process.env.PAY_TO || (process.env.NODE_ENV === "production" ? "" : DEFAULT_DEV_PAY_TO);

  if (!/^0x[a-fA-F0-9]{40}$/.test(payTo)) {
    throw new Error("PAY_TO must be set to a valid 0x wallet address before running this service.");
  }

  return {
    serviceName: "Listing Roast x402",
    serviceUrl: (overrides.serviceUrl || process.env.SERVICE_URL || "http://localhost:8787").replace(/\/+$/, ""),
    payTo,
    facilitatorUrl: overrides.facilitatorUrl || process.env.FACILITATOR_URL || "https://x402.org/facilitator",
    network: overrides.network || process.env.X402_NETWORK || "eip155:84532",
    cdpApiKeyId: overrides.cdpApiKeyId || process.env.CDP_API_KEY_ID || "",
    cdpApiKeySecret: overrides.cdpApiKeySecret || process.env.CDP_API_KEY_SECRET || "",
    baseRpcUrl: overrides.baseRpcUrl || process.env.BASE_RPC_URL || "https://mainnet.base.org",
    price: "$0.01",
    scorePrice: "$0.005",
    instantScorePrice: "$0.001",
    siteAuditPrice: "$0.001",
    discoveryAuditPrice: "$0.01"
  };
}

function absoluteUrl(config, pathname) {
  return `${config.serviceUrl}${pathname}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function jsonScript(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function buildDiscoveryLinks(config) {
  return [
    `<${absoluteUrl(config, "/x402.json")}>; rel="payment"; type="application/json"`,
    `<${absoluteUrl(config, WELL_KNOWN_X402_JSON_PATH)}>; rel="service-desc"; type="application/json"`,
    `<${absoluteUrl(config, WELL_KNOWN_X402_PATH)}>; rel="service-desc"; type="application/json"`,
    `<${absoluteUrl(config, PAY_NOW_PATH)}>; rel="help"; type="application/json"`,
    `<${absoluteUrl(config, "/openapi.json")}>; rel="describedby"; type="application/vnd.oai.openapi+json"`,
    `<${absoluteUrl(config, "/llms.txt")}>; rel="describedby"; type="text/plain"`,
    `<${absoluteUrl(config, "/.well-known/mcp.json")}>; rel="service-desc"; type="application/json"`
  ].join(", ");
}

function buildStructuredData(config) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: config.serviceName,
    url: absoluteUrl(config, "/"),
    description: DISCOVERY_DESCRIPTION,
    provider: {
      "@type": "Organization",
      name: config.serviceName,
      url: absoluteUrl(config, "/")
    },
    areaServed: "Global",
    audience: {
      "@type": "Audience",
      audienceType: "x402, MCP, and agent-service builders"
    },
    keywords: DISCOVERY_KEYWORDS.join(", "),
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Listing Roast x402 paid routes",
      itemListElement: [
        {
          "@type": "Offer",
          name: "x402 paid ping",
          price: "0.001",
          priceCurrency: "USD",
          url: absoluteUrl(config, PING_PATH)
        },
        {
          "@type": "Offer",
          name: "x402 site audit and paid API preflight",
          price: "0.001",
          priceCurrency: "USD",
          url: absoluteUrl(config, SITE_AUDIT_PATH)
        },
        {
          "@type": "Offer",
          name: "x402 discovery audit",
          price: "0.01",
          priceCurrency: "USD",
          url: absoluteUrl(config, DISCOVERY_AUDIT_PATH)
        },
        {
          "@type": "Offer",
          name: "Instant listing score",
          price: "0.001",
          priceCurrency: "USD",
          url: absoluteUrl(config, INSTANT_SCORE_PATH)
        },
        {
          "@type": "Offer",
          name: "x402 marketplace conversion score",
          price: "0.001",
          priceCurrency: "USD",
          url: absoluteUrl(config, CONVERSION_SCORE_PATH)
        },
        {
          "@type": "Offer",
          name: "Agent listing conversion score",
          price: "0.001",
          priceCurrency: "USD",
          url: absoluteUrl(config, AGENT_LISTING_PATH)
        },
        {
          "@type": "Offer",
          name: "Indexed listing-roast quick score",
          price: "0.001",
          priceCurrency: "USD",
          url: absoluteUrl(config, ROAST_PATH)
        },
        {
          "@type": "Offer",
          name: "Listing score",
          price: "0.005",
          priceCurrency: "USD",
          url: absoluteUrl(config, "/api/listing-score")
        },
        {
          "@type": "Offer",
          name: "Listing conversion roast",
          price: "0.01",
          priceCurrency: "USD",
          url: absoluteUrl(config, ROAST_PATH)
        }
      ]
    }
  };
}

function buildPayCommand(config, pathname = ROAST_PATH, maxAmount = "10000", body = requestExample) {
  return `npx awal@2.8.0 x402 pay ${absoluteUrl(config, pathname)} \\
  -X POST \\
  -d ${shellQuote(JSON.stringify(body))} \\
  --max-amount ${maxAmount}`;
}

function buildGetPayCommand(config, pathname = INSTANT_SCORE_PATH, maxAmount = INSTANT_SCORE_AMOUNT) {
  return `npx awal@2.8.0 x402 pay ${absoluteUrl(config, pathname)} \\
  -X GET \\
  --max-amount ${maxAmount}`;
}

function copyScript(defaultText = "Copy payment command") {
  return `
    document.querySelectorAll("[data-copy-target]").forEach((button) => {
      button.addEventListener("click", async () => {
        const target = document.getElementById(button.dataset.copyTarget);
        if (!target) return;
        let copied = false;
        try {
          if (navigator.clipboard) {
            await navigator.clipboard.writeText(target.textContent.trim());
            copied = true;
          }
        } catch {}
        if (!copied) {
          const range = document.createRange();
          range.selectNodeContents(target);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
        fetch("/api/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: "commandCopyClicks" }),
          keepalive: true
        }).catch(() => {});
        const defaultText = button.dataset.defaultText || ${JSON.stringify(defaultText)};
        button.textContent = copied ? "Copied" : "Selected";
        setTimeout(() => { button.textContent = defaultText; }, 1600);
      });
    });`;
}

function encodeBalanceOf(address) {
  const normalized = address.toLowerCase().replace(/^0x/, "");
  return `0x70a08231${normalized.padStart(64, "0")}`;
}

function formatUsdc(rawUnits) {
  const whole = rawUnits / USDC_DECIMALS;
  const fraction = rawUnits % USDC_DECIMALS;
  const fractionText = fraction.toString().padStart(6, "0").replace(/0+$/, "");
  return fractionText ? `${whole}.${fractionText}` : `${whole}.00`;
}

async function getReceiverBalanceSnapshot(config) {
  const checkedAt = new Date().toISOString();

  if (config.network !== BASE_MAINNET_NETWORK) {
    return {
      address: config.payTo,
      network: config.network,
      asset: "USDC",
      usdcBalance: null,
      checkedAt,
      source: "disabled_for_non_mainnet"
    };
  }

  try {
    const rpcResponse = await fetch(config.baseRpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [
          {
            to: BASE_USDC_CONTRACT,
            data: encodeBalanceOf(config.payTo)
          },
          "latest"
        ]
      }),
      signal: AbortSignal.timeout(4500)
    });

    if (!rpcResponse.ok) {
      throw new Error("rpc_unavailable");
    }

    const payload = await rpcResponse.json();
    if (payload.error || !payload.result) {
      throw new Error("rpc_error");
    }

    const rawUnits = BigInt(payload.result);
    return {
      address: config.payTo,
      network: config.network,
      asset: "USDC",
      usdcBalance: formatUsdc(rawUnits),
      usdcUnits: rawUnits.toString(),
      checkedAt,
      source: new URL(config.baseRpcUrl).hostname
    };
  } catch {
    return {
      address: config.payTo,
      network: config.network,
      asset: "USDC",
      usdcBalance: null,
      checkedAt,
      source: "base_rpc",
      error: "unavailable"
    };
  }
}

function buildDiscovery(config, options = {}) {
  const routePath = options.routePath || ROAST_PATH;
  const price = options.price || config.price;
  const outputExample = options.outputExample || buildListingRoast(requestExample);
  const outputSchema = options.outputSchema || {
    type: "object",
    required: ["service", "endpoint", "price", "verdict", "score", "buyerAgentSkipReasons", "topFixes", "rewrittenListing"],
    properties: {
      service: { type: "string" },
      endpoint: { type: "string" },
      price: { type: "string" },
      verdict: { type: "string" },
      score: { type: "string" },
      buyerAgentSkipReasons: { type: "array", items: { type: "string" } },
      topFixes: { type: "array", items: { type: "string" } },
      rewrittenListing: { type: "string" },
      stopOrUpgrade: { type: "string" },
      nextMeasurement: { type: "string" }
    }
  };

  return {
    input: requestExample,
    bodyType: "json",
    inputSchema: {
      type: "object",
      required: ["agentName", "listingText"],
      properties: {
        agentName: { type: "string" },
        listingText: { type: "string" },
        targetBuyer: { type: "string" },
        currentPrice: { type: "string" },
        currentCheckoutPath: { type: "string" },
        goal: { type: "string" },
        source: { type: "string" }
      }
    },
    output: {
      example: outputExample,
      schema: outputSchema
    },
    service: {
      name: config.serviceName,
      url: config.serviceUrl,
      route: absoluteUrl(config, routePath),
      price,
      network: config.network
    }
  };
}

function buildScoreDiscovery(config) {
  return buildDiscovery(config, {
    routePath: "/api/listing-score",
    price: config.scorePrice,
    outputExample: buildListingScore(requestExample),
    outputSchema: {
      type: "object",
      required: ["service", "endpoint", "price", "verdict", "score", "checkedSignals", "firstFix", "nextStep", "upgradeEndpoint"],
      properties: {
        service: { type: "string" },
        endpoint: { type: "string" },
        price: { type: "string" },
        verdict: { type: "string" },
        score: { type: "string" },
        checkedSignals: { type: "object" },
        firstFix: { type: "string" },
        nextStep: { type: "string" },
        upgradeEndpoint: { type: "string" },
        nextPaidAction: {
          type: "object",
          properties: {
            route: { type: "string" },
            path: { type: "string" },
            method: { type: "string" },
            price: { type: "string" },
            maxAmountRequired: { type: "string" },
            body: { type: "object" },
            command: { type: "string" },
            reason: { type: "string" }
          }
        }
      }
    }
  });
}

function queryValue(value, fallback) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
}

function buildDiscoveryAuditInputFromQuery(query = {}) {
  const requestBody = queryValue(query.requestBody, "");
  const input = {
    endpointUrl: queryValue(query.endpointUrl || query.url, discoveryAuditRequestExample.endpointUrl),
    method: queryValue(query.method, discoveryAuditRequestExample.method).toUpperCase(),
    expectedAmount: queryValue(query.expectedAmount || query.amount, discoveryAuditRequestExample.expectedAmount),
    expectedNetwork: queryValue(query.expectedNetwork || query.network, discoveryAuditRequestExample.expectedNetwork),
    searchQuery: queryValue(query.searchQuery || query.query, discoveryAuditRequestExample.searchQuery)
  };

  if (requestBody) {
    input.requestBody = requestBody;
  }

  return input;
}

function buildSiteAuditOutput(config, auditOutput) {
  return {
    ...auditOutput,
    endpoint: "x402-site-audit",
    price: config.siteAuditPrice,
    mode: "quick-get",
    upgradeEndpoint: DISCOVERY_AUDIT_PATH,
    nextActions: [
      ...auditOutput.nextActions,
      "Use POST /api/x402-discovery-audit for the one-cent full audit when a custom JSON body is needed."
    ].slice(0, 6)
  };
}

function buildSiteAuditExampleOutput(config) {
  return buildSiteAuditOutput(config, buildDiscoveryAuditExampleOutput());
}

function buildInstantScoreInput(query = {}) {
  return listingRoastRequestSchema.parse({
    agentName: queryValue(query.agentName, requestExample.agentName),
    listingText: queryValue(query.listingText || query.text, requestExample.listingText),
    targetBuyer: queryValue(query.targetBuyer, requestExample.targetBuyer),
    currentPrice: queryValue(query.currentPrice, requestExample.currentPrice),
    currentCheckoutPath: queryValue(query.currentCheckoutPath, requestExample.currentCheckoutPath),
    goal: queryValue(query.goal, requestExample.goal),
    source: "instant-get-score"
  });
}

function buildUpgradeRequestBody(input, source = "score-upgrade") {
  return {
    agentName: input.agentName,
    listingText: input.listingText,
    targetBuyer: input.targetBuyer,
    currentPrice: input.currentPrice,
    currentCheckoutPath: input.currentCheckoutPath,
    goal: input.goal,
    source
  };
}

function buildNextPaidAction(config, input, options = {}) {
  if (!config) {
    return null;
  }

  const path = options.path || ROAST_PATH;
  const maxAmountRequired = options.maxAmountRequired || "10000";
  const body = buildUpgradeRequestBody(input, options.source || "score-upgrade");

  return {
    route: absoluteUrl(config, path),
    path,
    method: "POST",
    price: options.price || config.price,
    maxAmountRequired,
    body,
    command: buildPayCommand(config, path, maxAmountRequired, body),
    reason: options.reason || "Buy the full roast when you want the rewritten listing, top fixes, and stop-or-upgrade guidance."
  };
}

function addNextPaidAction(result, action) {
  return action ? { ...result, nextPaidAction: action } : result;
}

function buildInstantListingScore(input, config) {
  return addNextPaidAction({
    ...buildListingScore(input),
    endpoint: "instant-listing-score",
    price: "$0.001",
    nextStep: "This GET route is the lowest-friction paid check. Use /api/listing-score for a scored POST payload or /api/listing-roast for the full rewrite.",
    upgradeEndpoint: "/api/listing-score"
  }, buildNextPaidAction(config, input, {
    path: "/api/listing-score",
    price: config?.scorePrice || "$0.005",
    maxAmountRequired: "5000",
    source: "instant-score-upgrade",
    reason: "Buy the custom-body score when the default sample is useful but you want the score applied to your exact listing."
  }));
}

function buildConversionScore(input, config) {
  return addNextPaidAction({
    ...buildInstantListingScore(input, config),
    endpoint: "x402-marketplace-conversion-score",
    nextStep: "This route is optimized for x402 marketplace conversion buyers. Use GET /api/listing-roast when a marketplace result points to the already-indexed URL, or POST /api/listing-roast for the full rewrite.",
    upgradeEndpoint: ROAST_PATH
  }, buildNextPaidAction(config, input, {
    source: "conversion-score-upgrade",
    reason: "Buy the full roast when the conversion score shows enough buyer intent to justify a rewrite and launch recommendation."
  }));
}

function buildAgentListingConversionScore(input, config) {
  return addNextPaidAction({
    ...buildInstantListingScore(input, config),
    endpoint: "agent-listing-conversion-score",
    nextStep: "This route is optimized for buyer agents searching agent service listing clarity or agent listing conversion score. Use POST /api/listing-roast for the full rewrite and launch recommendation.",
    upgradeEndpoint: ROAST_PATH
  }, buildNextPaidAction(config, input, {
    source: "agent-listing-conversion-upgrade",
    reason: "Buy the full roast when the agent listing conversion score shows enough buyer intent to justify a rewrite and launch recommendation."
  }));
}

function buildIndexedRoastQuickScore(input, config) {
  return addNextPaidAction({
    ...buildInstantListingScore(input, config),
    endpoint: "listing-roast-quick-score",
    nextStep: "This GET route keeps the indexed /api/listing-roast URL payable at the lowest price. Use POST /api/listing-roast for the full rewrite and launch recommendation.",
    upgradeEndpoint: ROAST_PATH
  }, buildNextPaidAction(config, input, {
    source: "indexed-quick-score-upgrade",
    reason: "Buy the full roast from the already-indexed URL when the quick score is promising and you want the rewrite, top fixes, and stop-or-upgrade guidance."
  }));
}

function buildInstantScoreDiscovery(config) {
  const queryExample = {
    agentName: requestExample.agentName,
    listingText: requestExample.listingText,
    targetBuyer: requestExample.targetBuyer,
    currentPrice: requestExample.currentPrice,
    currentCheckoutPath: requestExample.currentCheckoutPath,
    goal: requestExample.goal
  };

  return {
    input: queryExample,
    inputSchema: {
      type: "object",
      properties: {
        agentName: { type: "string" },
        listingText: { type: "string" },
        targetBuyer: { type: "string" },
        currentPrice: { type: "string" },
        currentCheckoutPath: { type: "string" },
        goal: { type: "string" }
      }
    },
    output: {
      example: buildInstantListingScore(buildInstantScoreInput(), config),
      schema: buildScoreDiscovery(config).output.schema
    },
    service: {
      name: config.serviceName,
      url: config.serviceUrl,
      route: absoluteUrl(config, INSTANT_SCORE_PATH),
      price: config.instantScorePrice,
      network: config.network
    }
  };
}

function buildConversionScoreDiscovery(config) {
  const discovery = buildInstantScoreDiscovery(config);

  return {
    ...discovery,
    output: {
      ...discovery.output,
      example: buildConversionScore(buildInstantScoreInput(), config)
    },
    service: {
      ...discovery.service,
      route: absoluteUrl(config, CONVERSION_SCORE_PATH)
    }
  };
}

function buildAgentListingConversionDiscovery(config) {
  const discovery = buildInstantScoreDiscovery(config);

  return {
    ...discovery,
    output: {
      ...discovery.output,
      example: buildAgentListingConversionScore(buildInstantScoreInput(), config)
    },
    service: {
      ...discovery.service,
      route: absoluteUrl(config, AGENT_LISTING_PATH)
    }
  };
}

function buildIndexedRoastGetDiscovery(config) {
  const discovery = buildInstantScoreDiscovery(config);

  return {
    ...discovery,
    output: {
      ...discovery.output,
      example: buildIndexedRoastQuickScore(buildInstantScoreInput(), config)
    },
    service: {
      ...discovery.service,
      route: absoluteUrl(config, ROAST_PATH)
    }
  };
}

function buildPingOutput(config, query = {}) {
  const rawMessage = Array.isArray(query.msg) ? query.msg[0] : query.msg;
  const message = typeof rawMessage === "string" && rawMessage.trim() ? rawMessage.trim().slice(0, 180) : "x402 rail verified";

  return {
    service: config.serviceName,
    endpoint: "x402-ping",
    price: config.instantScorePrice,
    ok: true,
    message,
    timestamp: new Date().toISOString(),
    paidRoutes: {
      instantScore: INSTANT_SCORE_PATH,
      conversionScore: CONVERSION_SCORE_PATH,
      agentListingConversion: AGENT_LISTING_PATH,
      indexedQuickScore: ROAST_PATH,
      siteAudit: SITE_AUDIT_PATH,
      discoveryAudit: DISCOVERY_AUDIT_PATH,
      score: "/api/listing-score",
      fullRoast: ROAST_PATH
    },
    nextStep: "Use this paid ping to verify the x402 rail, then call /api/listing-roast with GET for a quick score or POST for the full roast."
  };
}

function buildPingDiscovery(config) {
  return {
    input: {
      msg: "hello from x402"
    },
    inputSchema: {
      type: "object",
      properties: {
        msg: { type: "string" }
      }
    },
    output: {
      example: buildPingOutput(config, { msg: "hello from x402" }),
      schema: {
        type: "object",
        required: ["service", "endpoint", "price", "ok", "message", "timestamp", "paidRoutes", "nextStep"],
        properties: {
          service: { type: "string" },
          endpoint: { type: "string" },
          price: { type: "string" },
          ok: { type: "boolean" },
          message: { type: "string" },
          timestamp: { type: "string" },
          paidRoutes: { type: "object" },
          nextStep: { type: "string" }
        }
      }
    },
    service: {
      name: config.serviceName,
      url: config.serviceUrl,
      route: absoluteUrl(config, PING_PATH),
      price: config.instantScorePrice,
      network: config.network
    }
  };
}

function buildDiscoveryAuditDiscovery(config) {
  return {
    input: discoveryAuditRequestExample,
    bodyType: "json",
    inputSchema: {
      type: "object",
      required: ["endpointUrl"],
      properties: {
        endpointUrl: {
          type: "string",
          description: "Public HTTPS x402 endpoint to inspect without making a paid call."
        },
        method: {
          type: "string",
          enum: ["GET", "POST"],
          description: "HTTP method to use for the unpaid 402 metadata probe."
        },
        expectedAmount: {
          type: "string",
          description: "Expected x402 amount in atomic USDC units, for example 1000 for $0.001."
        },
        expectedNetwork: {
          type: "string",
          description: "Expected CAIP-2 network, for example eip155:8453 for Base mainnet."
        },
        searchQuery: {
          type: "string",
          description: "Buyer query to test against CDP Bazaar semantic search."
        },
        requestBody: {
          type: "object",
          description: "Optional JSON body used only when method is POST."
        }
      }
    },
    output: {
      example: buildDiscoveryAuditExampleOutput(),
      schema: discoveryAuditOutputSchema
    },
    service: {
      name: config.serviceName,
      url: config.serviceUrl,
      route: absoluteUrl(config, DISCOVERY_AUDIT_PATH),
      price: config.discoveryAuditPrice,
      network: config.network
    }
  };
}

function buildSiteAuditDiscovery(config) {
  const discovery = buildDiscoveryAuditDiscovery(config);

  return {
    input: buildDiscoveryAuditInputFromQuery(),
    inputSchema: discovery.inputSchema,
    output: {
      example: buildSiteAuditExampleOutput(config),
      schema: discoveryAuditOutputSchema
    },
    service: {
      name: config.serviceName,
      url: config.serviceUrl,
      route: absoluteUrl(config, SITE_AUDIT_PATH),
      price: config.siteAuditPrice,
      network: config.network
    }
  };
}

function buildPaymentHint(config, options) {
  return {
    protocol: "x402",
    network: config.network,
    asset: "USDC",
    price: options.price,
    maxAmountRequired: options.maxAmountRequired,
    payTo: config.payTo,
    method: options.method,
    route: absoluteUrl(config, options.path),
    preferredFirstPaidAction: Boolean(options.preferredFirstPaidAction),
    buyerAction: options.buyerAction
  };
}

function buildPayNow(config) {
  return {
    service: config.serviceName,
    route: absoluteUrl(config, ROAST_PATH),
    method: "GET",
    price: config.instantScorePrice,
    maxAmountRequired: INSTANT_SCORE_AMOUNT,
    network: config.network,
    payTo: config.payTo,
    command: buildGetPayCommand(config, ROAST_PATH),
    reason: "Already-indexed Bazaar route and lowest-friction paid score.",
    expectedChallenge: {
      status: 402,
      amount: INSTANT_SCORE_AMOUNT,
      network: config.network,
      route: absoluteUrl(config, ROAST_PATH)
    },
    upgradeRoutes: {
      score: {
        route: absoluteUrl(config, "/api/listing-score"),
        method: "POST",
        price: config.scorePrice,
        maxAmountRequired: "5000"
      },
      roast: {
        route: absoluteUrl(config, ROAST_PATH),
        method: "POST",
        price: config.price,
        maxAmountRequired: "10000"
      }
    },
    noSpendNote: "Fetching this endpoint is free. Payment happens only when a buyer calls the x402 paid route."
  };
}

function buildOpenApiDocument(config) {
  return {
    openapi: "3.1.0",
    info: {
      title: config.serviceName,
      version: "0.2.0",
      description: DISCOVERY_DESCRIPTION,
      "x-keywords": DISCOVERY_KEYWORDS
    },
    servers: [{ url: config.serviceUrl }],
    paths: {
      [INSTANT_SCORE_PATH]: {
        get: {
          operationId: "getInstantListingScoreX402MarketplaceConversion",
          tags: ["x402 listing", "paid API listing", "paid API listing quality"],
          summary: "Paid $0.001 x402 marketplace conversion listing score",
          description: "Lowest-friction GET route for buyer agents that want an immediate paid API listing quality score, agent-service listing score, or x402 marketplace conversion check without building a JSON body first. Optional query params: agentName, listingText, targetBuyer, currentPrice, currentCheckoutPath, goal.",
          "x-price": config.instantScorePrice,
          "x-x402-price": config.instantScorePrice,
          "x-payment": buildPaymentHint(config, {
            path: INSTANT_SCORE_PATH,
            method: "GET",
            price: config.instantScorePrice,
            maxAmountRequired: INSTANT_SCORE_AMOUNT,
            buyerAction: "Pay $0.001 for an immediate listing quality score without building a JSON body."
          }),
          parameters: [
            { name: "agentName", in: "query", required: false, schema: { type: "string" } },
            { name: "listingText", in: "query", required: false, schema: { type: "string" } },
            { name: "targetBuyer", in: "query", required: false, schema: { type: "string" } },
            { name: "currentPrice", in: "query", required: false, schema: { type: "string" } },
            { name: "currentCheckoutPath", in: "query", required: false, schema: { type: "string" } },
            { name: "goal", in: "query", required: false, schema: { type: "string" } }
          ],
          responses: {
            200: {
              description: "Paid instant listing score response",
              content: {
                "application/json": {
                  schema: buildScoreDiscovery(config).output.schema,
                  example: buildInstantListingScore(buildInstantScoreInput(), config)
                }
              }
            },
            402: { description: "x402 payment required" }
          }
        }
      },
      [CONVERSION_SCORE_PATH]: {
        get: {
          operationId: "getX402MarketplaceConversionScore",
          tags: ["x402 marketplace conversion", "x402 listing", "paid API listing", "paid API listing quality"],
          summary: "Paid $0.001 x402 marketplace conversion score",
          description: "Lowest-friction GET route for buyer agents searching specifically for x402 marketplace conversion, marketplace listing score, paid API listing quality, or agent-service listing score. Optional query params: agentName, listingText, targetBuyer, currentPrice, currentCheckoutPath, goal.",
          "x-price": config.instantScorePrice,
          "x-x402-price": config.instantScorePrice,
          "x-payment": buildPaymentHint(config, {
            path: CONVERSION_SCORE_PATH,
            method: "GET",
            price: config.instantScorePrice,
            maxAmountRequired: INSTANT_SCORE_AMOUNT,
            buyerAction: "Pay $0.001 for an x402 marketplace conversion score without building a JSON body."
          }),
          parameters: [
            { name: "agentName", in: "query", required: false, schema: { type: "string" } },
            { name: "listingText", in: "query", required: false, schema: { type: "string" } },
            { name: "targetBuyer", in: "query", required: false, schema: { type: "string" } },
            { name: "currentPrice", in: "query", required: false, schema: { type: "string" } },
            { name: "currentCheckoutPath", in: "query", required: false, schema: { type: "string" } },
            { name: "goal", in: "query", required: false, schema: { type: "string" } }
          ],
          responses: {
            200: {
              description: "Paid x402 marketplace conversion score response",
              content: {
                "application/json": {
                  schema: buildScoreDiscovery(config).output.schema,
                  example: buildConversionScore(buildInstantScoreInput(), config)
                }
              }
            },
            402: { description: "x402 payment required" }
          }
        }
      },
      [AGENT_LISTING_PATH]: {
        get: {
          operationId: "getAgentListingConversionScore",
          tags: ["agent listing conversion", "agent service listing clarity", "x402 listing", "paid API listing", "paid API listing quality"],
          summary: "Paid $0.001 agent listing conversion score",
          description: "Lowest-friction GET route for buyer agents searching agent service listing clarity, agent listing conversion score, buyer intent, paid API listing quality, or marketplace conversion. Optional query params: agentName, listingText, targetBuyer, currentPrice, currentCheckoutPath, goal.",
          "x-price": config.instantScorePrice,
          "x-x402-price": config.instantScorePrice,
          "x-payment": buildPaymentHint(config, {
            path: AGENT_LISTING_PATH,
            method: "GET",
            price: config.instantScorePrice,
            maxAmountRequired: INSTANT_SCORE_AMOUNT,
            buyerAction: "Pay $0.001 for an agent listing conversion score without building a JSON body."
          }),
          parameters: [
            { name: "agentName", in: "query", required: false, schema: { type: "string" } },
            { name: "listingText", in: "query", required: false, schema: { type: "string" } },
            { name: "targetBuyer", in: "query", required: false, schema: { type: "string" } },
            { name: "currentPrice", in: "query", required: false, schema: { type: "string" } },
            { name: "currentCheckoutPath", in: "query", required: false, schema: { type: "string" } },
            { name: "goal", in: "query", required: false, schema: { type: "string" } }
          ],
          responses: {
            200: {
              description: "Paid agent listing conversion score response",
              content: {
                "application/json": {
                  schema: buildScoreDiscovery(config).output.schema,
                  example: buildAgentListingConversionScore(buildInstantScoreInput(), config)
                }
              }
            },
            402: { description: "x402 payment required" }
          }
        }
      },
      [PING_PATH]: {
        get: {
          operationId: "getX402Ping",
          tags: ["x402 ping", "paid API listing"],
          summary: "Paid $0.001 x402 rail ping",
          description: "Tiny paid GET endpoint for agents that want to verify the Base x402 payment rail before buying a richer listing score or roast.",
          "x-price": config.instantScorePrice,
          "x-x402-price": config.instantScorePrice,
          "x-payment": buildPaymentHint(config, {
            path: PING_PATH,
            method: "GET",
            price: config.instantScorePrice,
            maxAmountRequired: PING_AMOUNT,
            buyerAction: "Pay $0.001 to verify the x402 rail before buying a richer score or roast."
          }),
          parameters: [
            { name: "msg", in: "query", required: false, schema: { type: "string" } }
          ],
          responses: {
            200: {
              description: "Paid x402 ping response",
              content: {
                "application/json": {
                  schema: buildPingDiscovery(config).output.schema,
                  example: buildPingOutput(config, { msg: "hello from x402" })
                }
              }
            },
            402: { description: "x402 payment required" }
          }
        }
      },
      [SITE_AUDIT_PATH]: {
        get: {
          operationId: "getX402ServiceDiscoverabilityAuditPaidApiPreflightRouteHealthCheck",
          tags: ["x402 discovery", "x402 site audit", "x402 service discoverability audit", "paid API preflight", "x402 route health check", "paid API listing"],
          summary: "Paid $0.001 x402 service discoverability audit and paid API preflight",
          description: "Lowest-friction GET route for agents that want a quick no-spend x402 service discoverability audit, paid API preflight, route health check, public x402 discovery check, pricing check, direct 402 metadata check, and Bazaar search visibility check before buying the full audit.",
          "x-price": config.siteAuditPrice,
          "x-x402-price": config.siteAuditPrice,
          "x-payment": buildPaymentHint(config, {
            path: SITE_AUDIT_PATH,
            method: "GET",
            price: config.siteAuditPrice,
            maxAmountRequired: SITE_AUDIT_AMOUNT,
            buyerAction: "Pay $0.001 for a no-spend x402 service discoverability audit, paid API preflight, route health check, metadata, pricing, and search visibility check."
          }),
          parameters: [
            { name: "endpointUrl", in: "query", required: false, schema: { type: "string" } },
            { name: "url", in: "query", required: false, schema: { type: "string" } },
            { name: "method", in: "query", required: false, schema: { type: "string", enum: ["GET", "POST"] } },
            { name: "expectedAmount", in: "query", required: false, schema: { type: "string" } },
            { name: "expectedNetwork", in: "query", required: false, schema: { type: "string" } },
            { name: "searchQuery", in: "query", required: false, schema: { type: "string" } },
            { name: "query", in: "query", required: false, schema: { type: "string" } }
          ],
          responses: {
            200: {
              description: "Paid x402 site audit response",
              content: {
                "application/json": {
                  schema: discoveryAuditOutputSchema,
                  example: buildSiteAuditExampleOutput(config)
                }
              }
            },
            402: { description: "x402 payment required" }
          }
        }
      },
      [DISCOVERY_AUDIT_PATH]: {
        post: {
          operationId: "postX402DiscoveryAudit",
          tags: ["x402 discovery", "paid API listing"],
          summary: "Paid $0.01 x402 Bazaar discovery audit",
          description: "Audits a public x402 endpoint without making paid calls. Checks the direct unpaid 402 challenge, Bazaar extension metadata, CDP merchant discovery, stale indexed pricing, and search visibility.",
          "x-price": config.discoveryAuditPrice,
          "x-x402-price": config.discoveryAuditPrice,
          "x-payment": buildPaymentHint(config, {
            path: DISCOVERY_AUDIT_PATH,
            method: "POST",
            price: config.discoveryAuditPrice,
            maxAmountRequired: DISCOVERY_AUDIT_AMOUNT,
            buyerAction: "Pay $0.01 for a custom-body discovery audit without making paid calls to the audited endpoint."
          }),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: buildDiscoveryAuditDiscovery(config).inputSchema,
                example: discoveryAuditRequestExample
              }
            }
          },
          responses: {
            200: {
              description: "Paid x402 discovery audit response",
              content: {
                "application/json": {
                  schema: discoveryAuditOutputSchema,
                  example: buildDiscoveryAuditExampleOutput()
                }
              }
            },
            402: { description: "x402 payment required" }
          }
        }
      },
      "/api/listing-score": {
        post: {
          operationId: "postListingScore",
          tags: ["x402 listing", "paid API listing", "paid API listing quality"],
          summary: "Paid $0.005 marketplace listing score",
          description: "Scores paid API listing quality, agent-service listing clarity, marketplace conversion, x402 service discoverability, checked signals, first fix, and upgrade guidance after x402 payment.",
          "x-price": config.scorePrice,
          "x-x402-price": config.scorePrice,
          "x-payment": buildPaymentHint(config, {
            path: "/api/listing-score",
            method: "POST",
            price: config.scorePrice,
            maxAmountRequired: "5000",
            buyerAction: "Pay $0.005 for a JSON-body listing quality score and upgrade guidance."
          }),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: buildScoreDiscovery(config).inputSchema,
                example: requestExample
              }
            }
          },
          responses: {
            200: {
              description: "Paid listing score response",
              content: {
                "application/json": {
                  schema: buildScoreDiscovery(config).output.schema,
                  example: buildListingScore(requestExample)
                }
              }
            },
            402: { description: "x402 payment required" }
          }
        }
      },
      [ROAST_PATH]: {
        get: {
          operationId: "getIndexedListingRoastX402MarketplaceConversionQuickScore",
          tags: ["x402 listing", "paid API listing", "paid API listing quality"],
          summary: "Paid $0.001 indexed x402 marketplace conversion quick score",
          description: "Lowest-price GET challenge on the already-indexed /api/listing-roast URL. Returns a $0.001 score API for marketplace listing quality, paid API discoverability, x402 listing quality, agent service listing clarity, buyer-agent skip reasons, and conversion checks after payment. Use POST on the same URL for the full $0.01 roast.",
          "x-price": config.instantScorePrice,
          "x-x402-price": config.instantScorePrice,
          "x-payment": buildPaymentHint(config, {
            path: ROAST_PATH,
            method: "GET",
            price: config.instantScorePrice,
            maxAmountRequired: INSTANT_SCORE_AMOUNT,
            preferredFirstPaidAction: true,
            buyerAction: "Pay $0.001 on the already-indexed marketplace route for a quick listing quality score."
          }),
          parameters: [
            { name: "agentName", in: "query", required: false, schema: { type: "string" } },
            { name: "listingText", in: "query", required: false, schema: { type: "string" } },
            { name: "targetBuyer", in: "query", required: false, schema: { type: "string" } },
            { name: "currentPrice", in: "query", required: false, schema: { type: "string" } },
            { name: "currentCheckoutPath", in: "query", required: false, schema: { type: "string" } },
            { name: "goal", in: "query", required: false, schema: { type: "string" } }
          ],
          responses: {
            200: {
              description: "Paid quick score response from the indexed listing-roast URL",
              content: {
                "application/json": {
                  schema: buildScoreDiscovery(config).output.schema,
                  example: buildIndexedRoastQuickScore(buildInstantScoreInput(), config)
                }
              }
            },
            402: { description: "x402 payment required" }
          }
        },
        post: {
          operationId: "postListingRoast",
          tags: ["x402 listing", "paid API listing"],
          summary: "Paid $0.01 marketplace listing conversion roast",
          description: "Returns paid API listing conversion feedback, marketplace listing quality fixes, buyer-agent skip reasons, rewritten listing copy, and stop-or-upgrade guidance after x402 payment.",
          "x-price": config.price,
          "x-x402-price": config.price,
          "x-payment": buildPaymentHint(config, {
            path: ROAST_PATH,
            method: "POST",
            price: config.price,
            maxAmountRequired: "10000",
            buyerAction: "Pay $0.01 for the full listing roast, rewrite, and stop-or-upgrade guidance."
          }),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: buildDiscovery(config).inputSchema,
                example: requestExample
              }
            }
          },
          responses: {
            200: {
              description: "Paid full roast response",
              content: {
                "application/json": {
                  schema: buildDiscovery(config).output.schema,
                  example: buildListingRoast(requestExample)
                }
              }
            },
            402: { description: "x402 payment required" }
          }
        }
      },
      "/api/sample-score": {
        get: {
          operationId: "getSampleScore",
          summary: "Free sample score output",
          responses: {
            200: {
              description: "Sample request, command, and score output"
            }
          }
        }
      },
      [PAY_NOW_PATH]: {
        get: {
          operationId: "getPayNow",
          summary: "Free direct pay-now handoff",
          description: "Compact no-spend JSON that tells buyer agents which x402 route to pay first.",
          responses: {
            200: {
              description: "Direct pay-now handoff for the preferred first paid route"
            }
          }
        }
      }
    },
    "x-listing-roast": {
      homepage: config.serviceUrl,
      builder: absoluteUrl(config, "/builder"),
      sample: absoluteUrl(config, "/sample"),
      x402Manifest: absoluteUrl(config, "/x402.json"),
      x402ManifestAliases: [absoluteUrl(config, WELL_KNOWN_X402_JSON_PATH), absoluteUrl(config, WELL_KNOWN_X402_PATH)],
      payNow: absoluteUrl(config, PAY_NOW_PATH),
      preferredFirstPaidRoute: absoluteUrl(config, ROAST_PATH),
      recommendedFirstPaidAction: {
        route: absoluteUrl(config, ROAST_PATH),
        method: "GET",
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        reason: "This is the already-indexed Bazaar route and the lowest-friction paid score."
      },
      instantScoreRoute: absoluteUrl(config, INSTANT_SCORE_PATH),
      conversionScoreRoute: absoluteUrl(config, CONVERSION_SCORE_PATH),
      agentListingConversionRoute: absoluteUrl(config, AGENT_LISTING_PATH),
      pingRoute: absoluteUrl(config, PING_PATH),
      siteAuditRoute: absoluteUrl(config, SITE_AUDIT_PATH),
      discoveryAuditRoute: absoluteUrl(config, DISCOVERY_AUDIT_PATH),
      scoreRoute: absoluteUrl(config, "/api/listing-score"),
      roastRoute: absoluteUrl(config, ROAST_PATH),
      instantScorePrice: config.instantScorePrice,
      siteAuditPrice: config.siteAuditPrice,
      scorePrice: config.scorePrice,
      discoveryAuditPrice: config.discoveryAuditPrice,
      roastPrice: config.price,
      network: config.network,
      keywords: DISCOVERY_KEYWORDS
    }
  };
}

function buildX402Manifest(config) {
  return {
    name: config.serviceName,
    serviceName: config.serviceName,
    displayName: config.serviceName,
    service: config.serviceName,
    description: DISCOVERY_DESCRIPTION,
    keywords: DISCOVERY_KEYWORDS,
    homepage: absoluteUrl(config, "/"),
    builder: absoluteUrl(config, "/builder"),
    sample: absoluteUrl(config, "/sample"),
    openApi: absoluteUrl(config, "/openapi.json"),
    llms: absoluteUrl(config, "/llms.txt"),
    payNow: absoluteUrl(config, PAY_NOW_PATH),
    aliases: [absoluteUrl(config, WELL_KNOWN_X402_JSON_PATH), absoluteUrl(config, WELL_KNOWN_X402_PATH)],
    network: config.network,
    payTo: config.payTo,
    payment: {
      primaryNetwork: "base",
      network: config.network,
      currency: "USDC",
      asset: "USDC",
      payTo: config.payTo,
      x402: {
        primaryNetwork: "base",
        network: config.network,
        asset: "USDC",
        payTo: config.payTo
      }
    },
    capabilities: {
      tools: 9
    },
    recommendedFirstPaidAction: {
      route: absoluteUrl(config, ROAST_PATH),
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      reason: "This is the already-indexed Bazaar route and the lowest-friction paid score."
    },
    resources: [
      {
        id: "indexed_roast_quick_score",
        name: "indexed_roast_quick_score",
        method: "GET",
        path: ROAST_PATH,
        url: absoluteUrl(config, ROAST_PATH),
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        description: "One-tenth-cent GET score API for marketplace listing quality, paid API discoverability, x402 listing quality, agent service listing clarity, buyer-agent skip reasons, and conversion checks on the already-indexed listing-roast URL. POST the same URL for the full one-cent roast.",
        keywords: ["listing roast", "score API", "marketplace listing quality", "paid API discoverability", "x402 listing quality", "agent service listing clarity", "buyer-agent skip reasons", "buyer agent skip reasons", "agent-service listing score", "x402 marketplace conversion", "GET paid API"],
        command: buildGetPayCommand(config, ROAST_PATH),
        input: buildInstantScoreDiscovery(config).input,
        outputExample: buildIndexedRoastQuickScore(buildInstantScoreInput(), config),
        schema: absoluteUrl(config, "/api/score-schema")
      },
      {
        id: "instant_listing_score",
        name: "instant_listing_score",
        method: "GET",
        path: INSTANT_SCORE_PATH,
        url: absoluteUrl(config, INSTANT_SCORE_PATH),
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        description: "One-tenth-cent GET marketplace listing score, paid API listing quality score, agent-service listing score, and x402 marketplace conversion check. Works with optional query params or a default sample.",
        keywords: ["marketplace listing score", "paid API listing quality score", "agent-service listing score", "x402 marketplace conversion", "GET paid API"],
        command: buildGetPayCommand(config),
        input: buildInstantScoreDiscovery(config).input,
        outputExample: buildInstantListingScore(buildInstantScoreInput(), config),
        schema: absoluteUrl(config, "/api/score-schema")
      },
      {
        id: "x402_marketplace_conversion_score",
        name: "x402_marketplace_conversion_score",
        method: "GET",
        path: CONVERSION_SCORE_PATH,
        url: absoluteUrl(config, CONVERSION_SCORE_PATH),
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        description: "One-tenth-cent GET score API for buyer agents searching x402 marketplace conversion, marketplace listing score, paid API listing quality, and agent-service listing score.",
        keywords: ["x402 marketplace conversion", "marketplace listing score", "paid API listing quality score", "agent-service listing score", "GET paid API"],
        command: buildGetPayCommand(config, CONVERSION_SCORE_PATH, INSTANT_SCORE_AMOUNT),
        input: buildInstantScoreDiscovery(config).input,
        outputExample: buildConversionScore(buildInstantScoreInput(), config),
        schema: absoluteUrl(config, "/api/score-schema")
      },
      {
        id: "agent_listing_conversion_score",
        name: "agent_listing_conversion_score",
        method: "GET",
        path: AGENT_LISTING_PATH,
        url: absoluteUrl(config, AGENT_LISTING_PATH),
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        description: "One-tenth-cent GET agent listing conversion score for agent service listing clarity, buyer intent, paid API listing quality, and marketplace conversion. Optimized for agents searching agent-service listing clarity.",
        keywords: ["agent listing conversion score", "agent service listing clarity", "agent listing clarity", "buyer intent", "paid API listing quality", "agent-service listing score", "marketplace listing conversion", "GET paid API"],
        command: buildGetPayCommand(config, AGENT_LISTING_PATH, INSTANT_SCORE_AMOUNT),
        input: buildInstantScoreDiscovery(config).input,
        outputExample: buildAgentListingConversionScore(buildInstantScoreInput(), config),
        schema: absoluteUrl(config, "/api/score-schema")
      },
      {
        id: "x402_ping",
        name: "x402_ping",
        method: "GET",
        path: PING_PATH,
        url: absoluteUrl(config, PING_PATH),
        price: config.instantScorePrice,
        maxAmountRequired: PING_AMOUNT,
        description: "One-tenth-cent x402 rail ping for agents that want to verify payment before buying a listing score or roast.",
        keywords: ["x402 ping", "paid ping", "x402 rail", "x402 test", "Base USDC"],
        command: buildGetPayCommand(config, PING_PATH, PING_AMOUNT),
        input: buildPingDiscovery(config).input,
        outputExample: buildPingOutput(config, { msg: "hello from x402" }),
        schema: absoluteUrl(config, "/openapi.json")
      },
      {
        id: "x402_site_audit",
        name: "x402_site_audit",
        method: "GET",
        path: SITE_AUDIT_PATH,
        url: absoluteUrl(config, SITE_AUDIT_PATH),
        price: config.siteAuditPrice,
        maxAmountRequired: SITE_AUDIT_AMOUNT,
        description: "One-tenth-cent GET x402 service discoverability audit and paid API preflight for direct 402 metadata, route health, Bazaar pricing, search visibility, OpenAPI, llms.txt, and no-spend next actions.",
        keywords: ["x402 site audit", "x402 service discoverability audit", "paid API preflight", "x402 route health check", "x402 discovery audit", "x402 bazaar discovery audit", "bazaar search visibility", "x402 listing stale price"],
        command: buildGetPayCommand(config, SITE_AUDIT_PATH, SITE_AUDIT_AMOUNT),
        input: buildSiteAuditDiscovery(config).input,
        outputExample: buildSiteAuditExampleOutput(config),
        schema: absoluteUrl(config, "/api/discovery-audit-schema")
      },
      {
        id: "x402_discovery_audit",
        name: "x402_discovery_audit",
        method: "POST",
        path: DISCOVERY_AUDIT_PATH,
        url: absoluteUrl(config, DISCOVERY_AUDIT_PATH),
        price: config.discoveryAuditPrice,
        maxAmountRequired: DISCOVERY_AUDIT_AMOUNT,
        description: "One-cent x402 Bazaar discovery audit for stale indexed pricing, missing marketplace visibility, direct 402 metadata, and next actions. Makes no paid calls.",
        keywords: ["x402 bazaar discovery audit", "x402 listing stale price", "bazaar search visibility", "paid API listing", "x402 listing"],
        command: buildPayCommand(config, DISCOVERY_AUDIT_PATH, DISCOVERY_AUDIT_AMOUNT, discoveryAuditRequestExample),
        input: discoveryAuditRequestExample,
        outputExample: buildDiscoveryAuditExampleOutput(),
        schema: absoluteUrl(config, "/api/discovery-audit-schema")
      },
      {
        id: "listing_score",
        name: "listing_score",
        method: "POST",
        path: "/api/listing-score",
        url: absoluteUrl(config, "/api/listing-score"),
        price: config.scorePrice,
        maxAmountRequired: "5000",
        description: "Half-cent paid API listing quality score for agent-service listing clarity, marketplace conversion, x402 discoverability, checked signals, first fix, and upgrade guidance.",
        keywords: ["marketplace listing score", "paid API listing quality score", "agent-service listing score", "x402 marketplace conversion"],
        command: buildPayCommand(config, "/api/listing-score", "5000"),
        input: requestExample,
        outputExample: buildListingScore(requestExample),
        schema: absoluteUrl(config, "/api/score-schema")
      },
      {
        id: "listing_roast",
        name: "listing_roast",
        method: "POST",
        path: ROAST_PATH,
        url: absoluteUrl(config, ROAST_PATH),
        price: config.price,
        maxAmountRequired: "10000",
        description: "One-cent marketplace listing conversion roast for paid API listing quality, agent service listing clarity, buyer-agent skip reasons, top fixes, rewrite, and launch guidance.",
        keywords: ["marketplace listing conversion", "paid API listing quality", "agent service listing clarity", "buyer-agent skip reasons", "buyer agent skip reasons", "agent-service listing score", "x402 marketplace conversion"],
        command: buildPayCommand(config),
        input: requestExample,
        outputExample: buildListingRoast(requestExample),
        schema: absoluteUrl(config, "/api/schema")
      }
    ]
  };
}

function createX402Middleware(config) {
  const facilitator = new HTTPFacilitatorClient({
    url: config.facilitatorUrl,
    ...(config.cdpApiKeyId && config.cdpApiKeySecret ? { createAuthHeaders: createCdpAuthFactory(config) } : {})
  });
  const server = new x402ResourceServer(facilitator);
  registerExactEvmScheme(server);
  server.registerExtension(bazaarResourceServerExtension);
  server.onAfterVerify((context) => {
    console.log("[x402] verify ok", summarizePaymentContext(context));
  });
  server.onVerifyFailure((context) => {
    console.warn("[x402] verify failed", summarizePaymentContext(context));
  });
  server.onAfterSettle((context) => {
    console.log("[x402] settle ok", summarizePaymentContext(context));
  });
  server.onSettleFailure((context) => {
    console.warn("[x402] settle failed", summarizePaymentContext(context));
  });

  return paymentMiddleware(
    {
      "POST /api/listing-score": {
        accepts: {
          scheme: "exact",
          price: config.scorePrice,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 300
        },
        description: "Listing Score x402: $0.005 paid API listing quality score for agent-service listing clarity, marketplace conversion, x402 service discoverability, first missing signal, and upgrade guidance.",
        mimeType: "application/json",
        extensions: declareDiscoveryExtension(buildScoreDiscovery(config))
      },
      [`GET ${INSTANT_SCORE_PATH}`]: {
        accepts: {
          scheme: "exact",
          price: config.instantScorePrice,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 300
        },
        description: "Instant Listing Score x402: $0.001 GET marketplace listing score and paid API listing quality score for agent-service listing clarity, marketplace conversion, and x402 service discoverability.",
        mimeType: "application/json",
        extensions: declareDiscoveryExtension(buildInstantScoreDiscovery(config))
      },
      [`GET ${CONVERSION_SCORE_PATH}`]: {
        accepts: {
          scheme: "exact",
          price: config.instantScorePrice,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 300
        },
        description: "x402 Marketplace Conversion Score: $0.001 GET marketplace conversion score for paid API listing quality, agent-service listing clarity, and buyer-agent conversion checks.",
        mimeType: "application/json",
        extensions: declareDiscoveryExtension(buildConversionScoreDiscovery(config))
      },
      [`GET ${AGENT_LISTING_PATH}`]: {
        accepts: {
          scheme: "exact",
          price: config.instantScorePrice,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 300
        },
        description: "Agent Listing Conversion Score: $0.001 GET score for agent service listing clarity, agent listing conversion, paid API listing quality, buyer intent, and x402 marketplace conversion.",
        mimeType: "application/json",
        extensions: declareDiscoveryExtension(buildAgentListingConversionDiscovery(config))
      },
      [`GET ${ROAST_PATH}`]: {
        accepts: {
          scheme: "exact",
          price: config.instantScorePrice,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 300
        },
        description: INDEXED_QUICK_SCORE_DESCRIPTION,
        mimeType: "application/json",
        extensions: declareDiscoveryExtension(buildIndexedRoastGetDiscovery(config))
      },
      [`GET ${PING_PATH}`]: {
        accepts: {
          scheme: "exact",
          price: config.instantScorePrice,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 300
        },
        description: "Listing Roast x402 Ping: $0.001 paid GET ping to verify the Base x402 rail before buying a score or roast.",
        mimeType: "application/json",
        extensions: declareDiscoveryExtension(buildPingDiscovery(config))
      },
      [`GET ${SITE_AUDIT_PATH}`]: {
        accepts: {
          scheme: "exact",
          price: config.siteAuditPrice,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 300
        },
        description: "Listing Roast x402 Site Audit: $0.001 GET service discoverability audit, paid API preflight, route health check, direct 402 metadata, Bazaar pricing, search visibility, and no-spend fix steps.",
        mimeType: "application/json",
        extensions: declareDiscoveryExtension(buildSiteAuditDiscovery(config))
      },
      [`POST ${DISCOVERY_AUDIT_PATH}`]: {
        accepts: {
          scheme: "exact",
          price: config.discoveryAuditPrice,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 300
        },
        description: "Listing Roast x402 Discovery Audit: $0.01 Bazaar visibility audit for stale indexed pricing, direct 402 metadata, search position, and no-spend fix steps.",
        mimeType: "application/json",
        extensions: declareDiscoveryExtension(buildDiscoveryAuditDiscovery(config))
      },
      [`POST ${ROAST_PATH}`]: {
        accepts: {
          scheme: "exact",
          price: config.price,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 300
        },
        description: "Listing Roast x402: $0.01 marketplace listing conversion roast for paid API listing quality, agent service listing clarity, buyer-agent skip reasons, top fixes, rewrite, and stop-or-upgrade guidance.",
        mimeType: "application/json",
        extensions: declareDiscoveryExtension(buildDiscovery(config))
      }
    },
    server,
    undefined,
    undefined,
    true
  );
}

function summarizePaymentContext(context) {
  const result = context?.result ?? {};
  const requirements = context?.requirements ?? context?.paymentRequirements ?? {};
  const error = context?.error ?? {};
  const errorResult = error?.result ?? error?.data ?? {};
  return JSON.stringify({
    network: requirements.network,
    amount: requirements.amount,
    payTo: requirements.payTo,
    isValid: result.isValid,
    success: result.success,
    invalidReason: result.invalidReason,
    errorReason: result.errorReason,
    errorMessage: result.errorMessage,
    failureName: error.name,
    failureMessage: error.message,
    failureStatus: error.status,
    failureInvalidReason: errorResult.invalidReason,
    failureErrorReason: errorResult.errorReason,
    failureErrorMessage: errorResult.errorMessage
  });
}

function isEmptyBody(body) {
  return body == null || (typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0);
}

async function validateListingRoastRequest(request, response, next) {
  if (isEmptyBody(request.body)) {
    next();
    return;
  }

  const parsed = listingRoastRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    await recordSignal("invalidRequests");
    response.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    return;
  }

  request.listingRoastInput = parsed.data;
  next();
}

async function validateDiscoveryAuditRequest(request, response, next) {
  if (isEmptyBody(request.body)) {
    next();
    return;
  }

  const parsed = discoveryAuditRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    await recordSignal("invalidRequests");
    response.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    return;
  }

  request.discoveryAuditInput = parsed.data;
  next();
}

function hasPaymentHeader(request) {
  return Boolean(request.get("x-payment"));
}

function isAllowedSignal(value) {
  return typeof value === "string" && [
    "builderCommandBuilds",
    "commandCopyClicks"
  ].includes(value);
}

function validUnpaidSignalForPath(pathname) {
  if (pathname === INSTANT_SCORE_PATH || pathname === CONVERSION_SCORE_PATH || pathname === AGENT_LISTING_PATH) {
    return "instantScoreValidUnpaidChallenges";
  }

  if (pathname === PING_PATH) {
    return "pingValidUnpaidChallenges";
  }

  if (pathname === SITE_AUDIT_PATH || pathname === DISCOVERY_AUDIT_PATH) {
    return "discoveryAuditValidUnpaidChallenges";
  }

  return pathname === "/api/listing-score" ? "scoreValidUnpaidChallenges" : "roastValidUnpaidChallenges";
}

function rejectHeadPaidRoute(request, response, next) {
  if (request.method !== "HEAD") {
    next();
    return;
  }

  const pathname = new URL(request.originalUrl, "http://local").pathname;
  const allow = pathname === ROAST_PATH ? "GET, POST" : ["/api/listing-score", DISCOVERY_AUDIT_PATH].includes(pathname) ? "POST" : "GET";
  response.set("Allow", allow).status(405).end();
}

async function recordGetScoreProbe(request, _response, next) {
  if (!hasPaymentHeader(request)) {
    const pathname = new URL(request.originalUrl, "http://local").pathname;
    await recordSignal("unpaidChallenges");
    await recordSignal("validUnpaidChallenges");
    await recordSignal(pathname === ROAST_PATH ? "indexedRoastGetValidUnpaidChallenges" : "instantScoreValidUnpaidChallenges");
  }
  next();
}

async function recordPingProbe(request, _response, next) {
  if (!hasPaymentHeader(request)) {
    await recordSignal("unpaidChallenges");
    await recordSignal("validUnpaidChallenges");
    await recordSignal("pingValidUnpaidChallenges");
  }
  next();
}

async function recordSiteAuditProbe(request, _response, next) {
  if (!hasPaymentHeader(request)) {
    await recordSignal("unpaidChallenges");
    await recordSignal("validUnpaidChallenges");
    await recordSignal("discoveryAuditValidUnpaidChallenges");
  }
  next();
}

function createCdpAuthFactory(config) {
  const facilitatorUrl = new URL(config.facilitatorUrl);
  const requestHost = facilitatorUrl.host;
  const basePath = facilitatorUrl.pathname.replace(/\/+$/, "");

  return async () => ({
    verify: await getAuthHeaders({
      apiKeyId: config.cdpApiKeyId,
      apiKeySecret: config.cdpApiKeySecret,
      requestMethod: "POST",
      requestHost,
      requestPath: `${basePath}/verify`,
      source: "listing-roast-x402-service",
      sourceVersion: "0.1.0"
    }),
    settle: await getAuthHeaders({
      apiKeyId: config.cdpApiKeyId,
      apiKeySecret: config.cdpApiKeySecret,
      requestMethod: "POST",
      requestHost,
      requestPath: `${basePath}/settle`,
      source: "listing-roast-x402-service",
      sourceVersion: "0.1.0"
    }),
    supported: await getAuthHeaders({
      apiKeyId: config.cdpApiKeyId,
      apiKeySecret: config.cdpApiKeySecret,
      requestMethod: "GET",
      requestHost,
      requestPath: `${basePath}/supported`,
      source: "listing-roast-x402-service",
      sourceVersion: "0.1.0"
    })
  });
}

export function createApp(overrides = {}) {
  const config = getConfig(overrides);
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "32kb" }));
  app.use((_request, response, next) => {
    response.set("Link", buildDiscoveryLinks(config));
    next();
  });

  app.get("/health", (_request, response) => {
    response.json({ ok: true, service: config.serviceName, paidRoute: "/api/listing-roast" });
  });

  app.get("/", async (_request, response) => {
    await recordSignal("homepageViews");
    const cashRegisterUrl = absoluteUrl(config, "/api/cash-register");
    const instantRoute = absoluteUrl(config, INSTANT_SCORE_PATH);
    const paidRoute = absoluteUrl(config, ROAST_PATH);
    const scoreRoute = absoluteUrl(config, "/api/listing-score");
    const pingRoute = absoluteUrl(config, PING_PATH);
    const siteAuditRoute = absoluteUrl(config, SITE_AUDIT_PATH);
    const discoveryAuditRoute = absoluteUrl(config, DISCOVERY_AUDIT_PATH);
    const builderUrl = absoluteUrl(config, "/builder");
    const sampleUrl = absoluteUrl(config, "/sample");
    const schemaUrl = absoluteUrl(config, "/api/schema");
    const examplesUrl = absoluteUrl(config, "/api/examples");
    const openApiUrl = absoluteUrl(config, "/openapi.json");
    const llmsUrl = absoluteUrl(config, "/llms.txt");
    const mcpUrl = absoluteUrl(config, "/.well-known/mcp.json");
    const payNowUrl = absoluteUrl(config, PAY_NOW_PATH);
    const instantCommand = buildGetPayCommand(config);
    const indexedRoastGetCommand = buildGetPayCommand(config, ROAST_PATH);
    const pingCommand = buildGetPayCommand(config, PING_PATH, PING_AMOUNT);
    const siteAuditCommand = buildGetPayCommand(config, SITE_AUDIT_PATH, SITE_AUDIT_AMOUNT);
    const discoveryAuditCommand = buildPayCommand(config, DISCOVERY_AUDIT_PATH, DISCOVERY_AUDIT_AMOUNT, discoveryAuditRequestExample);
    const payCommand = buildPayCommand(config);
    const scoreCommand = buildPayCommand(config, "/api/listing-score", "5000");
    const scoreOutput = buildListingScore(requestExample);
    const sampleOutput = buildListingRoast(requestExample);

    response.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="A paid x402 API for listing scores, full listing roasts, and Bazaar discovery audits when x402 pricing or search visibility looks stale." />
  <meta property="og:title" content="${escapeHtml(config.serviceName)}" />
  <meta property="og:description" content="Find out why buyer agents skip your paid API listing before you promote it." />
  <meta property="og:url" content="${escapeHtml(config.serviceUrl)}" />
  <link rel="canonical" href="${escapeHtml(config.serviceUrl)}/" />
  <link rel="alternate" type="application/json" title="Listing Roast x402 manifest" href="${escapeHtml(absoluteUrl(config, "/x402.json"))}" />
  <link rel="alternate" type="application/vnd.oai.openapi+json" title="Listing Roast OpenAPI" href="${escapeHtml(absoluteUrl(config, "/openapi.json"))}" />
  <link rel="alternate" type="text/plain" title="Listing Roast llms.txt" href="${escapeHtml(absoluteUrl(config, "/llms.txt"))}" />
  <script type="application/ld+json">${jsonScript(buildStructuredData(config))}</script>
  <title>${escapeHtml(config.serviceName)}</title>
  <style>
    :root { color-scheme: light; --ink: #171717; --muted: #5b6470; --line: #d8dee7; --paper: #fbfaf7; --panel: #ffffff; --blue: #1458d4; --green: #0d7a4f; --gold: #9c6a00; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 16px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--paper); color: var(--ink); }
    header, section, footer { width: 100%; }
    .wrap { max-width: 1120px; margin: 0 auto; padding: 0 24px; min-width: 0; }
    .nav { display: flex; align-items: center; justify-content: space-between; min-height: 64px; border-bottom: 1px solid var(--line); }
    .brand { font-weight: 800; letter-spacing: 0; }
    .navlinks { display: flex; gap: 18px; flex-wrap: wrap; font-size: 0.95rem; }
    a { color: var(--blue); text-decoration-thickness: 1px; text-underline-offset: 3px; }
    .hero { padding: 56px 0 36px; background: linear-gradient(180deg, #ffffff 0%, #f3f6f8 100%); border-bottom: 1px solid var(--line); }
    .heroGrid { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(320px, 0.95fr); gap: 32px; align-items: center; }
    .heroGrid > *, .grid2 > *, .grid3 > * { min-width: 0; }
    h1 { font-size: clamp(2.4rem, 5vw, 4.9rem); line-height: 0.98; margin: 0 0 18px; letter-spacing: 0; max-width: 840px; }
    h2 { font-size: 1.65rem; margin: 0 0 14px; letter-spacing: 0; }
    h3 { font-size: 1rem; margin: 0 0 8px; letter-spacing: 0; }
    p { margin: 0 0 16px; max-width: 760px; }
    .lead { font-size: 1.18rem; color: #333c47; }
    .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 24px; }
    .button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 10px 15px; border-radius: 8px; border: 1px solid #101010; background: #111; color: #fff; text-decoration: none; font-weight: 700; }
    button.button { cursor: pointer; font: inherit; }
    .button.secondary { background: #fff; color: #111; border-color: var(--line); }
    .proof { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 24px; max-width: 780px; }
    .proof div, .miniCard { border: 1px solid var(--line); border-radius: 8px; background: rgba(255,255,255,0.78); padding: 12px; }
    .proof strong { display: block; font-size: 1.1rem; }
    .device { border: 1px solid #cbd4df; border-radius: 8px; background: #111827; color: #e8eef6; box-shadow: 0 18px 40px rgba(17,24,39,0.16); overflow: hidden; }
    .deviceTop { display: flex; gap: 7px; padding: 11px 14px; background: #0b1220; border-bottom: 1px solid #263449; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: #ee6a5f; }
    .dot:nth-child(2) { background: #f5bd4f; }
    .dot:nth-child(3) { background: #61c454; }
    .terminal { padding: 18px; min-height: 276px; font: 13px/1.48 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
    .terminal .ok { color: #7dd3a7; }
    .terminal .warn { color: #f6cf72; }
    .band { padding: 34px 0; border-bottom: 1px solid var(--line); }
    .grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
    .grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; align-items: start; }
    .card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px; min-width: 0; }
    code, pre { background: #fff; border: 1px solid var(--line); border-radius: 8px; }
    code { padding: 2px 6px; overflow-wrap: anywhere; word-break: break-word; }
    pre { padding: 16px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; max-width: 100%; margin: 0; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .muted { color: var(--muted); }
    .tag { display: inline-flex; align-items: center; min-height: 28px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--line); background: #fff; color: #2d3745; font-size: 0.9rem; margin: 0 6px 8px 0; }
    .metric { color: var(--green); font-weight: 800; }
    .warning { color: var(--gold); font-weight: 700; }
    footer { padding: 26px 0 44px; color: var(--muted); }
    @media (max-width: 820px) {
      .heroGrid, .grid2, .grid3, .proof { grid-template-columns: 1fr; }
      .hero { padding-top: 34px; }
      .nav { align-items: flex-start; flex-direction: column; gap: 8px; padding: 14px 0; }
      h1 { font-size: 2.55rem; }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap nav">
      <div class="brand">Listing Roast x402</div>
      <nav class="navlinks" aria-label="Primary">
        <a href="#pay">Pay</a>
        <a href="${builderUrl}">Builder</a>
        <a href="${sampleUrl}">Sample</a>
        <a href="${examplesUrl}">Examples</a>
        <a href="#output">Output</a>
        <a href="${schemaUrl}">Schema</a>
        <a href="${cashRegisterUrl}">Cash register</a>
      </nav>
    </div>
  </header>
  <main>
    <section class="hero">
      <div class="wrap heroGrid">
        <div>
          <h1>Find out why buyer agents skip your paid API listing.</h1>
          <p class="lead">Start with the already-indexed ${config.instantScorePrice} GET quick score on <code>${ROAST_PATH}</code>. Use the instant route when you want a dedicated score URL, run a ${config.siteAuditPrice} GET site audit when x402 discovery looks stale, or pay ${config.price} for the full roast.</p>
          <div class="actions">
            <button class="button" type="button" data-copy-target="indexed-command" data-default-text="Copy $0.001 indexed GET command">Copy $0.001 indexed GET command</button>
            <button class="button secondary" type="button" data-copy-target="instant-command" data-default-text="Copy instant score command">Copy instant score command</button>
            <button class="button secondary" type="button" data-copy-target="ping-command" data-default-text="Copy x402 ping command">Copy x402 ping command</button>
            <button class="button secondary" type="button" data-copy-target="site-audit-command" data-default-text="Copy $0.001 site audit command">Copy $0.001 site audit command</button>
            <button class="button secondary" type="button" data-copy-target="audit-command" data-default-text="Copy discovery audit command">Copy discovery audit command</button>
            <button class="button" type="button" data-copy-target="score-command" data-default-text="Copy $0.005 score command">Copy $0.005 score command</button>
            <button class="button secondary" type="button" data-copy-target="pay-command" data-default-text="Copy $0.01 roast command">Copy $0.01 roast command</button>
            <a class="button secondary" href="${builderUrl}">Build your command</a>
            <a class="button secondary" href="${sampleUrl}">View sample score</a>
            <a class="button secondary" href="${examplesUrl}">Open examples JSON</a>
            <a class="button secondary" href="${schemaUrl}">View JSON schema</a>
          </div>
          <div class="proof" aria-label="Proof points">
            <div><strong class="metric">Live</strong><span class="muted">Production x402 route</span></div>
            <div><strong>${config.instantScorePrice} / ${config.scorePrice} / ${config.price}</strong><span class="muted">Indexed GET, instant, score, audit, or roast</span></div>
            <div><strong class="metric">Discovery audit</strong><span class="muted">Checks stale Bazaar listings</span></div>
          </div>
        </div>
        <div class="device" aria-label="Terminal preview">
          <div class="deviceTop"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
          <div class="terminal">$ x402 pay ${ROAST_PATH}
<span class="warn">402 Payment Required</span>
payTo: ${escapeHtml(config.payTo)}
network: ${escapeHtml(config.network)}
preferred indexed GET amount: ${INSTANT_SCORE_AMOUNT} USDC units
instant score amount: ${INSTANT_SCORE_AMOUNT} USDC units
score amount: 5000 USDC units
site audit amount: ${SITE_AUDIT_AMOUNT} USDC units
roast amount: 10000 USDC units
audit amount: ${DISCOVERY_AUDIT_AMOUNT} USDC units
<span class="ok">200 OK after payment</span>
verdict: ready_to_test
score: 4/5</div>
        </div>
      </div>
    </section>

    <section class="band">
      <div class="wrap grid3">
        <div class="card">
          <h3>Who buys this</h3>
          <p class="muted">x402, MCP, and agent-service builders who need paid API listing quality scoring before promotion.</p>
        </div>
        <div class="card">
          <h3>What you send</h3>
          <p class="muted">The service name, listing copy, target buyer, price, checkout path, and launch goal.</p>
        </div>
        <div class="card">
          <h3>What you get</h3>
          <p class="muted">A paid API listing quality score, a structured JSON critique, or a no-spend discovery audit showing whether Bazaar metadata, price, and search visibility are stale.</p>
        </div>
      </div>
    </section>

    <section class="band" id="pay">
      <div class="wrap grid2">
        <div>
          <h2>Pay the indexed ${config.instantScorePrice} route first, audit discovery when needed.</h2>
          <p>All paid endpoints are protected by x402. The already-indexed <code>${ROAST_PATH}</code> GET route is the preferred first paid action for Bazaar traffic; the GET site audit is the lowest-friction discovery audit for agents that do not want to assemble a body first.</p>
          <p>
            <span class="tag">Base mainnet</span>
            <span class="tag">USDC</span>
            <span class="tag">No account</span>
            <span class="tag">Agent-readable JSON</span>
          </p>
        </div>
        <div class="card">
          <h3>Preferred indexed quick score route</h3>
          <p><code>GET ${escapeHtml(paidRoute)}</code></p>
          <p class="muted">Maximum payment: <strong>${INSTANT_SCORE_AMOUNT}</strong> USDC units. This keeps the already-indexed listing-roast URL payable at the lowest price.</p>
        </div>
        <div class="card">
          <h3>Instant score route</h3>
          <p><code>GET ${escapeHtml(instantRoute)}</code></p>
          <p class="muted">Maximum payment: <strong>${INSTANT_SCORE_AMOUNT}</strong> USDC units.</p>
        </div>
        <div class="card">
          <h3>x402 ping route</h3>
          <p><code>GET ${escapeHtml(pingRoute)}</code></p>
          <p class="muted">Maximum payment: <strong>${PING_AMOUNT}</strong> USDC units. Use this to verify the payment rail before buying a score or roast.</p>
        </div>
        <div class="card">
          <h3>x402 site audit route</h3>
          <p><code>GET ${escapeHtml(siteAuditRoute)}</code></p>
          <p class="muted">Maximum payment: <strong>${SITE_AUDIT_AMOUNT}</strong> USDC units. Use this for a quick x402 metadata, price, and Bazaar search check.</p>
        </div>
        <div class="card">
          <h3>Discovery audit route</h3>
          <p><code>POST ${escapeHtml(discoveryAuditRoute)}</code></p>
          <p class="muted">Maximum payment: <strong>${DISCOVERY_AUDIT_AMOUNT}</strong> USDC units. Use this when Bazaar shows stale pricing or search misses your route.</p>
        </div>
        <div class="card">
          <h3>Score route</h3>
          <p><code>POST ${escapeHtml(scoreRoute)}</code></p>
          <p class="muted">Maximum payment: <strong>5000</strong> USDC units.</p>
        </div>
        <div class="card">
          <h3>Full roast route</h3>
          <p><code>POST ${escapeHtml(paidRoute)}</code></p>
          <p class="muted">Maximum payment: <strong>10000</strong> USDC units.</p>
        </div>
      </div>
      <div class="wrap" style="margin-top: 18px;">
        <h3>Preferred indexed listing-roast GET command</h3>
        <pre id="indexed-command">${escapeHtml(indexedRoastGetCommand)}</pre>
      </div>
      <div class="wrap" style="margin-top: 18px;">
        <h3>Instant GET command</h3>
        <pre id="instant-command">${escapeHtml(instantCommand)}</pre>
      </div>
      <div class="wrap" style="margin-top: 18px;">
        <h3>x402 ping command</h3>
        <pre id="ping-command">${escapeHtml(pingCommand)}</pre>
      </div>
      <div class="wrap" style="margin-top: 18px;">
        <h3>x402 site audit command</h3>
        <pre id="site-audit-command">${escapeHtml(siteAuditCommand)}</pre>
      </div>
      <div class="wrap" style="margin-top: 18px;">
        <h3>x402 discovery audit command</h3>
        <pre id="audit-command">${escapeHtml(discoveryAuditCommand)}</pre>
      </div>
      <div class="wrap" style="margin-top: 18px;">
        <h3>Score command</h3>
        <pre id="score-command">${escapeHtml(scoreCommand)}</pre>
      </div>
      <div class="wrap" style="margin-top: 18px;">
        <h3>Full roast command</h3>
        <pre id="pay-command">${escapeHtml(payCommand)}</pre>
      </div>
    </section>

    <section class="band" id="output">
      <div class="wrap grid2">
        <div>
          <h2>Output built for action.</h2>
          <p>The score response gives the first missing signal and upgrade guidance. The site audit checks direct x402 metadata against Bazaar state at the same low first-click price. The full roast adds skip reasons, top fixes, a rewrite, and stop-or-upgrade guidance.</p>
          <p class="muted">The current public cash register is available at <a href="${cashRegisterUrl}">/api/cash-register</a>. A sample score is available at <a href="${sampleUrl}">/sample</a>. The command builder is available at <a href="${builderUrl}">/builder</a>. The direct pay-now handoff is available at <a href="${payNowUrl}">/api/pay-now</a>. Copy-ready examples are available at <a href="${examplesUrl}">/api/examples</a>. Route schemas are available at <a href="${schemaUrl}">/api/schema</a> and <a href="${absoluteUrl(config, "/api/score-schema")}">/api/score-schema</a>.</p>
        </div>
        <pre>${escapeHtml(prettyJson(scoreOutput))}</pre>
      </div>
      <div class="wrap grid2" style="margin-top: 18px;">
        <div>
          <h3>Full roast sample</h3>
          <p class="muted">The $0.01 route adds the rewrite and launch decision after payment.</p>
        </div>
        <pre>${escapeHtml(prettyJson(sampleOutput))}</pre>
      </div>
      <div class="wrap grid2" style="margin-top: 18px;">
        <div>
          <h3>Discovery audit sample</h3>
          <p class="muted">The $0.01 audit route reports stale Bazaar pricing, direct 402 metadata, search visibility, and next actions.</p>
        </div>
        <pre>${escapeHtml(prettyJson(buildDiscoveryAuditExampleOutput()))}</pre>
      </div>
    </section>

    <section class="band">
      <div class="wrap grid2">
        <div class="card">
          <h3>Discovery</h3>
          <p class="muted">The routes are declared for x402 Bazaar discovery with GET and JSON body metadata, OpenAPI, llms.txt, and example payloads. The already-indexed <code>GET /api/listing-roast</code> path returns a $0.001 quick score challenge, and <code>GET /api/x402-site-audit</code> returns a $0.001 discovery audit challenge.</p>
          <p><a href="${mcpUrl}">MCP metadata</a> · <a href="${openApiUrl}">OpenAPI</a> · <a href="${llmsUrl}">llms.txt</a></p>
        </div>
        <div class="card">
          <h3>When not to buy</h3>
          <p class="muted">Do not buy if you need deep market research, legal advice, or a custom strategy call. This is a fast listing clarity check for paid agent/API offers.</p>
        </div>
      </div>
    </section>
  </main>
  <footer>
    <div class="wrap">Listing Roast x402 runs as a standalone paid API. No subscriptions, no accounts, no ApexScout dependency.</div>
  </footer>
  <script>
${copyScript()}
  </script>
</body>
</html>`);
  });

  app.get("/robots.txt", (_request, response) => {
    response
      .type("text/plain")
      .send(`User-agent: *
Allow: /
Sitemap: ${absoluteUrl(config, "/sitemap.xml")}
`);
  });

  app.get("/sitemap.xml", (_request, response) => {
    const updated = new Date().toISOString();
    const urls = ["/", "/builder", "/sample", PAY_NOW_PATH, ROAST_PATH, INSTANT_SCORE_PATH, CONVERSION_SCORE_PATH, AGENT_LISTING_PATH, PING_PATH, SITE_AUDIT_PATH, DISCOVERY_AUDIT_PATH, "/api/sample-score", "/openapi.json", "/llms.txt", "/x402.json", WELL_KNOWN_X402_JSON_PATH, WELL_KNOWN_X402_PATH, "/api/schema", "/api/score-schema", "/api/discovery-audit-schema", "/api/examples", "/.well-known/mcp.json"].map((pathname) => {
      return `<url><loc>${escapeHtml(absoluteUrl(config, pathname))}</loc><lastmod>${updated}</lastmod></url>`;
    }).join("");

    response
      .type("application/xml")
      .send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  });

  app.get("/api/examples", async (_request, response) => {
    await recordSignal("examplesViews");
    response.json({
      service: config.serviceName,
      homepage: absoluteUrl(config, "/"),
      builder: absoluteUrl(config, "/builder"),
      samplePage: absoluteUrl(config, "/sample"),
      sampleScore: absoluteUrl(config, "/api/sample-score"),
      openApi: absoluteUrl(config, "/openapi.json"),
      llms: absoluteUrl(config, "/llms.txt"),
      x402Manifest: absoluteUrl(config, "/x402.json"),
      x402ManifestAliases: [absoluteUrl(config, WELL_KNOWN_X402_JSON_PATH), absoluteUrl(config, WELL_KNOWN_X402_PATH)],
      payNowUrl: absoluteUrl(config, PAY_NOW_PATH),
      payNow: buildPayNow(config),
      instantScoreRoute: absoluteUrl(config, INSTANT_SCORE_PATH),
      conversionScoreRoute: absoluteUrl(config, CONVERSION_SCORE_PATH),
      agentListingConversionRoute: absoluteUrl(config, AGENT_LISTING_PATH),
      indexedRoastGetRoute: absoluteUrl(config, ROAST_PATH),
      pingRoute: absoluteUrl(config, PING_PATH),
      siteAuditRoute: absoluteUrl(config, SITE_AUDIT_PATH),
      discoveryAuditRoute: absoluteUrl(config, DISCOVERY_AUDIT_PATH),
      paidRoute: absoluteUrl(config, ROAST_PATH),
      scoreRoute: absoluteUrl(config, "/api/listing-score"),
      price: config.price,
      scorePrice: config.scorePrice,
      instantScorePrice: config.instantScorePrice,
      siteAuditPrice: config.siteAuditPrice,
      network: config.network,
      recommendedFirstPaidAction: {
        route: absoluteUrl(config, ROAST_PATH),
        method: "GET",
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        reason: "This is the already-indexed Bazaar route and the lowest-friction paid score."
      },
      paymentHints: {
        indexedRoastGet: buildPaymentHint(config, {
          path: ROAST_PATH,
          method: "GET",
          price: config.instantScorePrice,
          maxAmountRequired: INSTANT_SCORE_AMOUNT,
          preferredFirstPaidAction: true,
          buyerAction: "Pay $0.001 on the already-indexed marketplace route for a quick listing quality score."
        }),
        instantScore: buildPaymentHint(config, {
          path: INSTANT_SCORE_PATH,
          method: "GET",
          price: config.instantScorePrice,
          maxAmountRequired: INSTANT_SCORE_AMOUNT,
          buyerAction: "Pay $0.001 for an immediate listing quality score without building a JSON body."
        }),
        conversionScore: buildPaymentHint(config, {
          path: CONVERSION_SCORE_PATH,
          method: "GET",
          price: config.instantScorePrice,
          maxAmountRequired: INSTANT_SCORE_AMOUNT,
          buyerAction: "Pay $0.001 for an x402 marketplace conversion score without building a JSON body."
        }),
        agentListingConversion: buildPaymentHint(config, {
          path: AGENT_LISTING_PATH,
          method: "GET",
          price: config.instantScorePrice,
          maxAmountRequired: INSTANT_SCORE_AMOUNT,
          buyerAction: "Pay $0.001 for an agent listing conversion score without building a JSON body."
        }),
        siteAudit: buildPaymentHint(config, {
          path: SITE_AUDIT_PATH,
          method: "GET",
          price: config.siteAuditPrice,
          maxAmountRequired: SITE_AUDIT_AMOUNT,
          buyerAction: "Pay $0.001 for a no-spend x402 metadata, pricing, and search visibility check."
        }),
        listingScore: buildPaymentHint(config, {
          path: "/api/listing-score",
          method: "POST",
          price: config.scorePrice,
          maxAmountRequired: "5000",
          buyerAction: "Pay $0.005 for a JSON-body listing quality score and upgrade guidance."
        }),
        listingRoast: buildPaymentHint(config, {
          path: ROAST_PATH,
          method: "POST",
          price: config.price,
          maxAmountRequired: "10000",
          buyerAction: "Pay $0.01 for the full listing roast, rewrite, and stop-or-upgrade guidance."
        })
      },
      keywords: DISCOVERY_KEYWORDS,
      request: requestExample,
      instantScoreCommand: buildGetPayCommand(config),
      conversionScoreCommand: buildGetPayCommand(config, CONVERSION_SCORE_PATH, INSTANT_SCORE_AMOUNT),
      agentListingConversionCommand: buildGetPayCommand(config, AGENT_LISTING_PATH, INSTANT_SCORE_AMOUNT),
      indexedRoastGetCommand: buildGetPayCommand(config, ROAST_PATH),
      pingCommand: buildGetPayCommand(config, PING_PATH, PING_AMOUNT),
      siteAuditCommand: buildGetPayCommand(config, SITE_AUDIT_PATH, SITE_AUDIT_AMOUNT),
      discoveryAuditCommand: buildPayCommand(config, DISCOVERY_AUDIT_PATH, DISCOVERY_AUDIT_AMOUNT, discoveryAuditRequestExample),
      command: buildPayCommand(config),
      scoreCommand: buildPayCommand(config, "/api/listing-score", "5000"),
      instantScoreOutput: buildInstantListingScore(buildInstantScoreInput(), config),
      conversionScoreOutput: buildConversionScore(buildInstantScoreInput(), config),
      agentListingConversionOutput: buildAgentListingConversionScore(buildInstantScoreInput(), config),
      indexedRoastGetOutput: buildIndexedRoastQuickScore(buildInstantScoreInput(), config),
      pingOutput: buildPingOutput(config, { msg: "hello from x402" }),
      siteAuditRequest: buildDiscoveryAuditInputFromQuery(),
      siteAuditOutput: buildSiteAuditExampleOutput(config),
      discoveryAuditRequest: discoveryAuditRequestExample,
      discoveryAuditOutput: buildDiscoveryAuditExampleOutput(),
      scoreOutput: buildListingScore(requestExample),
      output: buildListingRoast(requestExample)
    });
  });

  app.get("/api/sample-score", async (_request, response) => {
    await recordSignal("sampleViews");
    response.json({
      service: config.serviceName,
      samplePage: absoluteUrl(config, "/sample"),
      paidRoute: absoluteUrl(config, "/api/listing-score"),
      price: config.scorePrice,
      network: config.network,
      request: requestExample,
      command: buildPayCommand(config, "/api/listing-score", "5000"),
      output: buildListingScore(requestExample)
    });
  });

  app.get("/llms.txt", async (_request, response) => {
    await recordSignal("llmsViews");
    response
      .type("text/plain")
      .send(`# Listing Roast x402

Listing Roast x402 is a paid API for x402, MCP, and agent-service builders who need a paid API listing quality score, agent-service listing score, marketplace listing conversion feedback, or x402 service discoverability guidance before promotion.

Homepage: ${absoluteUrl(config, "/")}
Command builder: ${absoluteUrl(config, "/builder")}
Sample score page: ${absoluteUrl(config, "/sample")}
Sample score JSON: ${absoluteUrl(config, "/api/sample-score")}
OpenAPI: ${absoluteUrl(config, "/openapi.json")}
x402 manifest: ${absoluteUrl(config, "/x402.json")}
x402 manifest aliases: ${absoluteUrl(config, WELL_KNOWN_X402_JSON_PATH)}, ${absoluteUrl(config, WELL_KNOWN_X402_PATH)}
MCP metadata: ${absoluteUrl(config, "/.well-known/mcp.json")}
Pay-now JSON: ${absoluteUrl(config, PAY_NOW_PATH)}
Keywords: ${DISCOVERY_KEYWORDS.join(", ")}

Preferred first paid route:

- GET ${absoluteUrl(config, ROAST_PATH)}
  - Price: ${config.instantScorePrice}
  - Network: ${config.network}
  - Max amount: ${INSTANT_SCORE_AMOUNT} USDC units
  - Output: quick paid API listing quality score from the already-indexed listing-roast URL
  - Use first when a marketplace result points to /api/listing-roast or an agent wants the lowest-friction payable route

Other paid routes:

- GET ${absoluteUrl(config, INSTANT_SCORE_PATH)}
  - Price: ${config.instantScorePrice}
  - Network: ${config.network}
  - Max amount: ${INSTANT_SCORE_AMOUNT} USDC units
  - Output: paid API listing quality score, checked signals, first fix, next step
  - Use when an agent wants a dedicated instant-score URL without first assembling a JSON body

- GET ${absoluteUrl(config, CONVERSION_SCORE_PATH)}
  - Price: ${config.instantScorePrice}
  - Network: ${config.network}
  - Max amount: ${INSTANT_SCORE_AMOUNT} USDC units
  - Output: x402 marketplace conversion score, paid API listing quality score, checked signals, first fix, next step
  - Use when an agent searches for x402 marketplace conversion or wants the route path to match that buyer intent

- GET ${absoluteUrl(config, AGENT_LISTING_PATH)}
  - Price: ${config.instantScorePrice}
  - Network: ${config.network}
  - Max amount: ${INSTANT_SCORE_AMOUNT} USDC units
  - Output: agent listing conversion score, agent service listing clarity score, buyer intent checks, first fix, next step
  - Use when an agent searches for agent service listing clarity, agent listing conversion score, or buyer intent clarity

- GET ${absoluteUrl(config, PING_PATH)}
  - Price: ${config.instantScorePrice}
  - Network: ${config.network}
  - Max amount: ${PING_AMOUNT} USDC units
  - Output: paid ping, timestamp, echo message, and next paid routes
  - Use when an agent wants to verify the x402 rail before buying a score or roast

- GET ${absoluteUrl(config, SITE_AUDIT_PATH)}
  - Price: ${config.siteAuditPrice}
  - Network: ${config.network}
  - Max amount: ${SITE_AUDIT_AMOUNT} USDC units
  - Output: direct 402 metadata check, Bazaar pricing check, search visibility, stale price mismatch, and no-spend fix steps
  - Use when an agent wants a cheap x402 service discoverability audit, paid API preflight, route health check, or site audit without assembling a JSON body

- POST ${absoluteUrl(config, DISCOVERY_AUDIT_PATH)}
  - Price: ${config.discoveryAuditPrice}
  - Network: ${config.network}
  - Max amount: ${DISCOVERY_AUDIT_AMOUNT} USDC units
  - Output: direct 402 metadata check, Bazaar merchant discovery check, search visibility, stale pricing mismatch, and no-spend fix steps
  - Use when a builder sees stale Bazaar pricing, missing Agentic.Market visibility, or a live endpoint that search does not surface

- POST ${absoluteUrl(config, "/api/listing-score")}
  - Price: ${config.scorePrice}
  - Network: ${config.network}
  - Max amount: 5000 USDC units
  - Output: paid API listing quality score, checked signals, first fix, next step, upgrade endpoint

- POST ${absoluteUrl(config, ROAST_PATH)}
  - Price: ${config.price}
  - Network: ${config.network}
  - Max amount: 10000 USDC units
  - Output: buyer-agent skip reasons, top fixes, rewritten listing, stop-or-upgrade guidance

Request body JSON:

${prettyJson(requestExample)}

Use the indexed $0.001 GET /api/listing-roast route first when a buyer agent wants the fastest paid test from a Bazaar-visible URL.
`);
  });

  app.get("/openapi.json", async (_request, response) => {
    await recordSignal("openApiViews");
    response.json(buildOpenApiDocument(config));
  });

  async function serveX402Manifest(_request, response) {
    await recordSignal("x402ManifestViews");
    response.json(buildX402Manifest(config));
  }

  app.get("/x402.json", serveX402Manifest);
  app.get(WELL_KNOWN_X402_JSON_PATH, serveX402Manifest);
  app.get(WELL_KNOWN_X402_PATH, serveX402Manifest);

  app.get("/builder", async (_request, response) => {
    await recordSignal("builderViews");
    const instantRoute = absoluteUrl(config, INSTANT_SCORE_PATH);
    const indexedRoute = absoluteUrl(config, ROAST_PATH);
    const pingRoute = absoluteUrl(config, PING_PATH);
    const siteAuditRoute = absoluteUrl(config, SITE_AUDIT_PATH);
    const scoreRoute = absoluteUrl(config, "/api/listing-score");
    const roastRoute = absoluteUrl(config, ROAST_PATH);
    const sampleUrl = absoluteUrl(config, "/sample");
    const sampleScoreApi = absoluteUrl(config, "/api/sample-score");
    const instantCommand = buildGetPayCommand(config);
    const indexedCommand = buildGetPayCommand(config, ROAST_PATH);
    const pingCommand = buildGetPayCommand(config, PING_PATH, PING_AMOUNT);
    const siteAuditCommand = buildGetPayCommand(config, SITE_AUDIT_PATH, SITE_AUDIT_AMOUNT);
    const scoreCommand = buildPayCommand(config, "/api/listing-score", "5000");
    const roastCommand = buildPayCommand(config);

    response.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Build copy-ready x402 commands for the Listing Roast $0.001 GET score, $0.001 site audit, $0.005 score, and $0.01 full roast routes." />
  <link rel="canonical" href="${escapeHtml(absoluteUrl(config, "/builder"))}" />
  <title>Command builder | ${escapeHtml(config.serviceName)}</title>
  <style>
    :root { color-scheme: light; --ink: #171717; --muted: #5b6470; --line: #d8dee7; --paper: #fbfaf7; --panel: #ffffff; --blue: #1458d4; --green: #0d7a4f; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 16px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--paper); color: var(--ink); }
    .wrap { max-width: 1120px; margin: 0 auto; padding: 0 24px; min-width: 0; }
    header { border-bottom: 1px solid var(--line); background: #fff; }
    .nav { min-height: 64px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .brand { font-weight: 800; }
    a { color: var(--blue); text-underline-offset: 3px; }
    main { padding: 42px 0; }
    h1 { margin: 0 0 16px; font-size: clamp(2.15rem, 5vw, 4rem); line-height: 1; letter-spacing: 0; max-width: 860px; }
    h2 { margin: 0 0 12px; font-size: 1.35rem; letter-spacing: 0; }
    p { margin: 0 0 16px; max-width: 780px; }
    .lead { font-size: 1.14rem; color: #333c47; }
    .grid { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(340px, 1.1fr); gap: 20px; align-items: start; margin-top: 24px; }
    .card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px; min-width: 0; }
    label { display: block; font-weight: 700; margin: 0 0 6px; }
    input, textarea { width: 100%; border: 1px solid var(--line); border-radius: 8px; background: #fff; color: var(--ink); font: inherit; padding: 10px 12px; margin: 0 0 14px; }
    textarea { min-height: 150px; resize: vertical; }
    .actions { display: flex; gap: 12px; flex-wrap: wrap; margin: 20px 0; }
    .button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 10px 15px; border-radius: 8px; border: 1px solid #101010; background: #111; color: #fff; text-decoration: none; font-weight: 700; }
    .button.secondary { background: #fff; color: #111; border-color: var(--line); }
    button.button { cursor: pointer; font: inherit; }
    .muted { color: var(--muted); }
    .metric { color: var(--green); font-weight: 800; }
    code, pre { background: #fff; border: 1px solid var(--line); border-radius: 8px; }
    code { padding: 2px 6px; overflow-wrap: anywhere; word-break: break-word; }
    pre { padding: 16px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; max-width: 100%; margin: 0 0 16px; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    @media (max-width: 860px) { .grid { grid-template-columns: 1fr; } .nav { align-items: flex-start; flex-direction: column; padding: 14px 0; } }
  </style>
</head>
<body>
  <header>
    <div class="wrap nav">
      <div class="brand">Listing Roast x402</div>
      <nav><a href="${escapeHtml(config.serviceUrl)}">Home</a> · <a href="${sampleUrl}">Sample</a> · <a href="${sampleScoreApi}">Sample JSON</a></nav>
    </div>
  </header>
  <main>
    <div class="wrap">
      <h1>Build a paid score command from your listing.</h1>
      <p class="lead">Paste the offer you are trying to sell. This page leads with the already-indexed ${config.instantScorePrice} GET command, then gives the instant-score URL, site audit, ${config.scorePrice} score route, and optional ${config.price} full roast route.</p>
      <div class="grid">
        <form class="card" id="builder-form">
          <label for="agentName">Service name</label>
          <input id="agentName" name="agentName" value="${escapeHtml(requestExample.agentName)}" maxlength="120" />
          <label for="listingText">Listing copy</label>
          <textarea id="listingText" name="listingText" maxlength="4000">${escapeHtml(requestExample.listingText)}</textarea>
          <label for="targetBuyer">Target buyer</label>
          <input id="targetBuyer" name="targetBuyer" value="${escapeHtml(requestExample.targetBuyer)}" maxlength="160" />
          <label for="currentPrice">Current price</label>
          <input id="currentPrice" name="currentPrice" value="${escapeHtml(requestExample.currentPrice)}" maxlength="40" />
          <label for="currentCheckoutPath">Checkout path</label>
          <input id="currentCheckoutPath" name="currentCheckoutPath" value="${escapeHtml(requestExample.currentCheckoutPath)}" maxlength="240" />
          <label for="goal">Goal</label>
          <input id="goal" name="goal" value="${escapeHtml(requestExample.goal)}" maxlength="240" />
          <div class="actions">
            <button class="button" id="build-command" type="button">Build commands</button>
            <a class="button secondary" href="${sampleUrl}">See sample output</a>
          </div>
          <p class="muted">This builder runs in your browser. It does not submit your listing until you run a paid x402 command.</p>
        </form>
        <div>
          <div class="card" style="margin-top: 18px;">
            <h2>Preferred indexed GET command <span class="metric">${config.instantScorePrice}</span></h2>
            <p class="muted"><code>GET ${escapeHtml(indexedRoute)}</code></p>
            <pre id="indexed-command">${escapeHtml(indexedCommand)}</pre>
            <button class="button" type="button" data-copy-target="indexed-command" data-default-text="Copy indexed GET command">Copy indexed GET command</button>
            <p class="muted" style="margin-top: 16px;"><code>GET ${escapeHtml(instantRoute)}</code></p>
            <pre id="instant-command">${escapeHtml(instantCommand)}</pre>
            <button class="button secondary" type="button" data-copy-target="instant-command" data-default-text="Copy instant command">Copy instant command</button>
            <p class="muted" style="margin-top: 16px;"><code>GET ${escapeHtml(pingRoute)}</code></p>
            <pre id="ping-command">${escapeHtml(pingCommand)}</pre>
            <button class="button secondary" type="button" data-copy-target="ping-command" data-default-text="Copy x402 ping command">Copy x402 ping command</button>
            <p class="muted" style="margin-top: 16px;"><code>GET ${escapeHtml(siteAuditRoute)}</code></p>
            <pre id="site-audit-command">${escapeHtml(siteAuditCommand)}</pre>
            <button class="button secondary" type="button" data-copy-target="site-audit-command" data-default-text="Copy site audit command">Copy site audit command</button>
          </div>
          <div class="card" style="margin-top: 18px;">
            <h2>Score command <span class="metric">${config.scorePrice}</span></h2>
            <p class="muted"><code>POST ${escapeHtml(scoreRoute)}</code></p>
            <pre id="score-command">${escapeHtml(scoreCommand)}</pre>
            <button class="button" type="button" data-copy-target="score-command" data-default-text="Copy score command">Copy score command</button>
          </div>
          <div class="card">
            <h2>Full roast command <span class="metric">${config.price}</span></h2>
            <p class="muted"><code>POST ${escapeHtml(roastRoute)}</code></p>
            <pre id="pay-command">${escapeHtml(roastCommand)}</pre>
            <button class="button secondary" type="button" data-copy-target="pay-command" data-default-text="Copy full roast command">Copy full roast command</button>
          </div>
        </div>
      </div>
    </div>
  </main>
  <script>
    const scoreUrl = ${JSON.stringify(scoreRoute)};
    const roastUrl = ${JSON.stringify(roastRoute)};
    function fieldValue(id) {
      return document.getElementById(id).value.trim();
    }
    function shellQuote(value) {
      return "'" + String(value).replace(/'/g, "'\\\\''") + "'";
    }
    function payload() {
      return {
        agentName: fieldValue("agentName"),
        listingText: fieldValue("listingText"),
        targetBuyer: fieldValue("targetBuyer"),
        currentPrice: fieldValue("currentPrice"),
        currentCheckoutPath: fieldValue("currentCheckoutPath"),
        goal: fieldValue("goal")
      };
    }
    function command(url, maxAmount) {
      return "npx awal@2.8.0 x402 pay " + url + " -X POST -d " + shellQuote(JSON.stringify(payload())) + " --max-amount " + maxAmount;
    }
    function updateCommands(track) {
      document.getElementById("score-command").textContent = command(scoreUrl, "5000");
      document.getElementById("pay-command").textContent = command(roastUrl, "10000");
      if (track) {
        fetch("/api/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: "builderCommandBuilds" }),
          keepalive: true
        }).catch(() => {});
      }
    }
    document.getElementById("build-command").addEventListener("click", () => updateCommands(true));
    document.querySelectorAll("#builder-form input, #builder-form textarea").forEach((field) => {
      field.addEventListener("input", () => updateCommands(false));
    });
    updateCommands(false);
${copyScript("Copy command")}
  </script>
</body>
</html>`);
  });

  app.get("/sample", async (_request, response) => {
    await recordSignal("sampleViews");
    const indexedCommand = buildGetPayCommand(config, ROAST_PATH);
    const scoreCommand = buildPayCommand(config, "/api/listing-score", "5000");
    const roastCommand = buildPayCommand(config);
    const scoreOutput = buildListingScore(requestExample);
    const indexedOutput = buildIndexedRoastQuickScore(buildInstantScoreInput(), config);
    const builderUrl = absoluteUrl(config, "/builder");
    const sampleScoreApi = absoluteUrl(config, "/api/sample-score");
    const indexedRoute = absoluteUrl(config, ROAST_PATH);
    const paidRoute = absoluteUrl(config, "/api/listing-score");
    const roastRoute = absoluteUrl(config, "/api/listing-roast");

    response.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Sample Listing Roast x402 score output before paying. Start with the indexed $0.001 GET score route." />
  <link rel="canonical" href="${escapeHtml(absoluteUrl(config, "/sample"))}" />
  <title>Sample score | ${escapeHtml(config.serviceName)}</title>
  <style>
    :root { color-scheme: light; --ink: #171717; --muted: #5b6470; --line: #d8dee7; --paper: #fbfaf7; --panel: #ffffff; --blue: #1458d4; --green: #0d7a4f; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 16px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--paper); color: var(--ink); }
    .wrap { max-width: 1040px; margin: 0 auto; padding: 0 24px; min-width: 0; }
    header { border-bottom: 1px solid var(--line); background: #fff; }
    .nav { min-height: 64px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .brand { font-weight: 800; }
    a { color: var(--blue); text-underline-offset: 3px; }
    main { padding: 42px 0; }
    h1 { margin: 0 0 16px; font-size: clamp(2.15rem, 5vw, 4rem); line-height: 1; letter-spacing: 0; max-width: 780px; }
    h2 { margin: 0 0 12px; font-size: 1.35rem; letter-spacing: 0; }
    p { margin: 0 0 16px; max-width: 760px; }
    .lead { font-size: 1.14rem; color: #333c47; }
    .grid { display: grid; grid-template-columns: minmax(0, 0.82fr) minmax(320px, 1.18fr); gap: 20px; align-items: start; margin-top: 24px; }
    .card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px; min-width: 0; }
    .actions { display: flex; gap: 12px; flex-wrap: wrap; margin: 20px 0; }
    .button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 10px 15px; border-radius: 8px; border: 1px solid #101010; background: #111; color: #fff; text-decoration: none; font-weight: 700; }
    .button.secondary { background: #fff; color: #111; border-color: var(--line); }
    button.button { cursor: pointer; font: inherit; }
    .muted { color: var(--muted); }
    .metric { color: var(--green); font-weight: 800; }
    code, pre { background: #fff; border: 1px solid var(--line); border-radius: 8px; }
    code { padding: 2px 6px; overflow-wrap: anywhere; word-break: break-word; }
    pre { padding: 16px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; max-width: 100%; margin: 0; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    @media (max-width: 820px) { .grid { grid-template-columns: 1fr; } .nav { align-items: flex-start; flex-direction: column; padding: 14px 0; } }
  </style>
</head>
<body>
  <header>
    <div class="wrap nav">
      <div class="brand">Listing Roast x402</div>
      <nav><a href="${escapeHtml(config.serviceUrl)}">Home</a> · <a href="${builderUrl}">Builder</a> · <a href="${sampleScoreApi}">Sample JSON</a></nav>
    </div>
  </header>
  <main>
    <div class="wrap">
      <h1>Sample the score, then start with the $0.001 indexed route.</h1>
      <p class="lead">This shows the score shape before payment. If it matches what your agent or API listing needs, start with the already-indexed GET route, then upgrade to the custom score or full roast only when you need a body-specific review.</p>
      <div class="actions">
        <button class="button" type="button" data-copy-target="indexed-command" data-default-text="Copy $0.001 indexed GET command">Copy $0.001 indexed GET command</button>
        <button class="button secondary" type="button" data-copy-target="score-command" data-default-text="Copy $0.005 score command">Copy $0.005 score command</button>
        <a class="button secondary" href="${builderUrl}">Build your command</a>
        <a class="button secondary" href="${sampleScoreApi}">Open sample JSON</a>
      </div>
      <div class="grid">
        <div class="card">
          <h2>Preferred indexed score route</h2>
          <p><code>GET ${escapeHtml(indexedRoute)}</code></p>
          <p class="muted">Price: <span class="metric">${config.instantScorePrice}</span> on ${escapeHtml(config.network)}.</p>
          <h2>Paid score route</h2>
          <p><code>POST ${escapeHtml(paidRoute)}</code></p>
          <p class="muted">Price: <span class="metric">${config.scorePrice}</span> on ${escapeHtml(config.network)}.</p>
          <h2>Upgrade route</h2>
          <p><code>POST ${escapeHtml(roastRoute)}</code></p>
          <p class="muted">The full roast adds skip reasons, top fixes, a rewritten listing, and a stop-or-upgrade call.</p>
        </div>
        <pre>${escapeHtml(prettyJson(scoreOutput))}</pre>
      </div>
      <div class="grid">
        <div class="card">
          <h2>Indexed GET command</h2>
          <pre id="indexed-command">${escapeHtml(indexedCommand)}</pre>
          <h2>Indexed score sample</h2>
          <pre>${escapeHtml(prettyJson(indexedOutput))}</pre>
        </div>
        <div class="card">
          <h2>Score command</h2>
          <pre id="score-command">${escapeHtml(scoreCommand)}</pre>
        </div>
        <div class="card">
          <h2>Full roast command</h2>
          <pre>${escapeHtml(roastCommand)}</pre>
        </div>
      </div>
    </div>
  </main>
  <script>
${copyScript("Copy command")}
  </script>
</body>
</html>`);
  });

  app.get("/api/schema", async (_request, response) => {
    await recordSignal("schemaViews");
    response.json(buildDiscovery(config));
  });

  app.get("/api/score-schema", async (_request, response) => {
    await recordSignal("schemaViews");
    response.json(buildScoreDiscovery(config));
  });

  app.get("/api/discovery-audit-schema", async (_request, response) => {
    await recordSignal("schemaViews");
    response.json(buildDiscoveryAuditDiscovery(config));
  });

  app.get("/.well-known/mcp.json", async (_request, response) => {
    await recordSignal("mcpViews");
    response.json({
      name: config.serviceName,
      homepage: absoluteUrl(config, "/"),
      builder: absoluteUrl(config, "/builder"),
      sample: absoluteUrl(config, "/sample"),
      openApi: absoluteUrl(config, "/openapi.json"),
      llms: absoluteUrl(config, "/llms.txt"),
      x402Manifest: absoluteUrl(config, "/x402.json"),
      x402ManifestAliases: [absoluteUrl(config, WELL_KNOWN_X402_JSON_PATH), absoluteUrl(config, WELL_KNOWN_X402_PATH)],
      payNow: absoluteUrl(config, PAY_NOW_PATH),
      keywords: DISCOVERY_KEYWORDS,
      tools: [
        {
          name: "indexed_listing_roast_quick_score",
          method: "GET",
          path: ROAST_PATH,
          url: absoluteUrl(config, ROAST_PATH),
          price: config.instantScorePrice,
          network: config.network,
          description: "one-tenth-cent GET marketplace listing score API for marketplace listing quality, paid API discoverability, x402 listing quality, agent service listing clarity, buyer-agent skip reasons, and conversion checks on the indexed listing-roast URL.",
          payment: buildPaymentHint(config, {
            path: ROAST_PATH,
            method: "GET",
            price: config.instantScorePrice,
            maxAmountRequired: INSTANT_SCORE_AMOUNT,
            preferredFirstPaidAction: true,
            buyerAction: "Pay $0.001 on the already-indexed marketplace route for a quick listing quality score."
          }),
          keywords: ["listing roast", "score API", "marketplace listing quality", "paid API discoverability", "x402 listing quality", "agent service listing clarity", "buyer-agent skip reasons", "buyer agent skip reasons", "agent-service listing score", "x402 marketplace conversion"],
          input: buildInstantScoreDiscovery(config).input
        },
        {
          name: "instant_paid_listing_score",
          method: "GET",
          path: INSTANT_SCORE_PATH,
          url: absoluteUrl(config, INSTANT_SCORE_PATH),
          price: config.instantScorePrice,
          network: config.network,
          description: "one-tenth-cent GET marketplace listing score and paid API listing quality score for agent-service listing clarity, marketplace conversion, and x402 service discoverability.",
          payment: buildPaymentHint(config, {
            path: INSTANT_SCORE_PATH,
            method: "GET",
            price: config.instantScorePrice,
            maxAmountRequired: INSTANT_SCORE_AMOUNT,
            buyerAction: "Pay $0.001 for an immediate listing quality score without building a JSON body."
          }),
          keywords: ["marketplace listing score", "paid API listing quality score", "agent-service listing score", "x402 marketplace conversion", "GET paid API"],
          input: buildInstantScoreDiscovery(config).input
        },
        {
          name: "x402_marketplace_conversion_score",
          method: "GET",
          path: CONVERSION_SCORE_PATH,
          url: absoluteUrl(config, CONVERSION_SCORE_PATH),
          price: config.instantScorePrice,
          network: config.network,
          description: "one-tenth-cent GET x402 marketplace conversion score for paid API listing quality, agent-service listing clarity, and buyer-agent conversion checks.",
          payment: buildPaymentHint(config, {
            path: CONVERSION_SCORE_PATH,
            method: "GET",
            price: config.instantScorePrice,
            maxAmountRequired: INSTANT_SCORE_AMOUNT,
            buyerAction: "Pay $0.001 for an x402 marketplace conversion score without building a JSON body."
          }),
          keywords: ["x402 marketplace conversion", "marketplace listing score", "paid API listing quality score", "agent-service listing score", "GET paid API"],
          input: buildInstantScoreDiscovery(config).input
        },
        {
          name: "agent_listing_conversion_score",
          method: "GET",
          path: AGENT_LISTING_PATH,
          url: absoluteUrl(config, AGENT_LISTING_PATH),
          price: config.instantScorePrice,
          network: config.network,
          description: "one-tenth-cent GET agent listing conversion score for agent service listing clarity, buyer intent, paid API listing quality, and marketplace conversion.",
          payment: buildPaymentHint(config, {
            path: AGENT_LISTING_PATH,
            method: "GET",
            price: config.instantScorePrice,
            maxAmountRequired: INSTANT_SCORE_AMOUNT,
            buyerAction: "Pay $0.001 for an agent listing conversion score without building a JSON body."
          }),
          keywords: ["agent listing conversion score", "agent service listing clarity", "agent listing clarity", "buyer intent", "paid API listing quality", "agent-service listing score", "GET paid API"],
          input: buildInstantScoreDiscovery(config).input
        },
        {
          name: "paid_x402_ping",
          method: "GET",
          path: PING_PATH,
          url: absoluteUrl(config, PING_PATH),
          price: config.instantScorePrice,
          network: config.network,
          description: "one-tenth-cent paid ping to verify the Base x402 rail before buying a listing score or roast.",
          payment: buildPaymentHint(config, {
            path: PING_PATH,
            method: "GET",
            price: config.instantScorePrice,
            maxAmountRequired: PING_AMOUNT,
            buyerAction: "Pay $0.001 to verify the x402 rail before buying a richer score or roast."
          }),
          keywords: ["x402 ping", "paid ping", "x402 rail", "Base USDC"],
          input: buildPingDiscovery(config).input
        },
        {
          name: "x402_site_audit",
          method: "GET",
          path: SITE_AUDIT_PATH,
          url: absoluteUrl(config, SITE_AUDIT_PATH),
          price: config.siteAuditPrice,
          network: config.network,
          description: "one-tenth-cent GET x402 service discoverability audit and paid API preflight for direct 402 metadata, route health, Bazaar pricing, search visibility, and no-spend fix steps.",
          payment: buildPaymentHint(config, {
            path: SITE_AUDIT_PATH,
            method: "GET",
            price: config.siteAuditPrice,
            maxAmountRequired: SITE_AUDIT_AMOUNT,
            buyerAction: "Pay $0.001 for a no-spend x402 service discoverability audit, paid API preflight, route health check, metadata, pricing, and search visibility check."
          }),
          keywords: ["x402 site audit", "x402 service discoverability audit", "paid API preflight", "x402 route health check", "x402 discovery audit", "bazaar search visibility", "x402 listing stale price"],
          input: buildSiteAuditDiscovery(config).input
        },
        {
          name: "x402_discovery_audit",
          method: "POST",
          path: DISCOVERY_AUDIT_PATH,
          url: absoluteUrl(config, DISCOVERY_AUDIT_PATH),
          price: config.discoveryAuditPrice,
          network: config.network,
          description: "Bazaar discovery audit for stale indexed pricing, missing search visibility, direct 402 metadata, and no-spend fix steps.",
          payment: buildPaymentHint(config, {
            path: DISCOVERY_AUDIT_PATH,
            method: "POST",
            price: config.discoveryAuditPrice,
            maxAmountRequired: DISCOVERY_AUDIT_AMOUNT,
            buyerAction: "Pay $0.01 for a custom-body discovery audit without making paid calls to the audited endpoint."
          }),
          keywords: ["x402 bazaar discovery audit", "x402 listing stale price", "bazaar search visibility", "paid API listing"],
          input: discoveryAuditRequestExample
        },
        {
          name: "score_paid_listing",
          method: "POST",
          path: "/api/listing-score",
          url: absoluteUrl(config, "/api/listing-score"),
          price: config.scorePrice,
          network: config.network,
          description: "paid API listing quality score for agent-service listing clarity, marketplace conversion, and x402 service discoverability.",
          payment: buildPaymentHint(config, {
            path: "/api/listing-score",
            method: "POST",
            price: config.scorePrice,
            maxAmountRequired: "5000",
            buyerAction: "Pay $0.005 for a JSON-body listing quality score and upgrade guidance."
          }),
          keywords: ["marketplace listing score", "paid API listing quality score", "agent-service listing score", "x402 marketplace conversion"],
          input: requestExample
        },
        {
          name: "roast_paid_listing",
          method: "POST",
          path: ROAST_PATH,
          url: absoluteUrl(config, ROAST_PATH),
          price: config.price,
          network: config.network,
          description: "marketplace listing conversion roast for paid API listing quality, agent service listing clarity, and buyer-agent skip reasons.",
          payment: buildPaymentHint(config, {
            path: ROAST_PATH,
            method: "POST",
            price: config.price,
            maxAmountRequired: "10000",
            buyerAction: "Pay $0.01 for the full listing roast, rewrite, and stop-or-upgrade guidance."
          }),
          keywords: ["marketplace listing conversion", "paid API listing quality", "agent service listing clarity", "buyer-agent skip reasons", "buyer agent skip reasons", "agent-service listing score"],
          input: requestExample
        }
      ]
    });
  });

  app.get("/api/cash-register", async (_request, response) => {
    const cashRegister = await getCashRegister();
    const receiverWallet = await getReceiverBalanceSnapshot(config);
    response.json({ ...cashRegister, receiverWallet });
  });

  app.get(PAY_NOW_PATH, async (_request, response) => {
    await recordSignal("payNowViews");
    response.json(buildPayNow(config));
  });

  app.post("/api/track", async (request, response) => {
    const event = request.body?.event;
    if (!isAllowedSignal(event)) {
      response.status(204).end();
      return;
    }

    await recordSignal(event);
    response.status(204).end();
  });

  app.use([INSTANT_SCORE_PATH, CONVERSION_SCORE_PATH, AGENT_LISTING_PATH, ROAST_PATH, PING_PATH, SITE_AUDIT_PATH, DISCOVERY_AUDIT_PATH, "/api/listing-score"], rejectHeadPaidRoute);
  app.get([INSTANT_SCORE_PATH, CONVERSION_SCORE_PATH, AGENT_LISTING_PATH, ROAST_PATH], recordGetScoreProbe);
  app.get(PING_PATH, recordPingProbe);
  app.get(SITE_AUDIT_PATH, recordSiteAuditProbe);
  app.post(ROAST_PATH, validateListingRoastRequest);
  app.post("/api/listing-score", validateListingRoastRequest);
  app.post(DISCOVERY_AUDIT_PATH, validateDiscoveryAuditRequest);
  app.post(["/api/listing-score", ROAST_PATH, DISCOVERY_AUDIT_PATH], async (request, _response, next) => {
    if (!hasPaymentHeader(request)) {
      await recordSignal("unpaidChallenges");
      if (isEmptyBody(request.body)) {
        await recordSignal("emptyDiscoveryProbes");
      } else {
        await recordSignal("validUnpaidChallenges");
        await recordSignal(validUnpaidSignalForPath(request.path));
      }
    }
    next();
  });
  app.use(createX402Middleware(config));

  app.get(INSTANT_SCORE_PATH, async (request, response) => {
    const result = buildInstantListingScore(buildInstantScoreInput(request.query), config);
    const cashRegister = await recordPaidCompletion("instantScore", 0.001);
    response.json({ ...result, cashRegister });
  });

  app.get(CONVERSION_SCORE_PATH, async (request, response) => {
    const result = buildConversionScore(buildInstantScoreInput(request.query), config);
    const cashRegister = await recordPaidCompletion("instantScore", 0.001);
    response.json({ ...result, cashRegister });
  });

  app.get(AGENT_LISTING_PATH, async (request, response) => {
    const result = buildAgentListingConversionScore(buildInstantScoreInput(request.query), config);
    const cashRegister = await recordPaidCompletion("instantScore", 0.001);
    response.json({ ...result, cashRegister });
  });

  app.get(ROAST_PATH, async (request, response) => {
    const result = buildIndexedRoastQuickScore(buildInstantScoreInput(request.query), config);
    const cashRegister = await recordPaidCompletion("indexedRoastGet", 0.001);
    response.json({ ...result, cashRegister });
  });

  app.get(PING_PATH, async (request, response) => {
    const result = buildPingOutput(config, request.query);
    const cashRegister = await recordPaidCompletion("x402Ping", 0.001);
    response.json({ ...result, cashRegister });
  });

  app.get(SITE_AUDIT_PATH, async (request, response) => {
    const parsed = discoveryAuditRequestSchema.safeParse(buildDiscoveryAuditInputFromQuery(request.query));
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
      return;
    }

    const result = buildSiteAuditOutput(config, await buildX402DiscoveryAudit(parsed.data));
    const cashRegister = await recordPaidCompletion("x402SiteAudit", 0.001);
    response.json({ ...result, cashRegister });
  });

  app.post(DISCOVERY_AUDIT_PATH, async (request, response) => {
    const parsed = discoveryAuditRequestSchema.safeParse(request.discoveryAuditInput ?? request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
      return;
    }

    const result = await buildX402DiscoveryAudit(parsed.data);
    const cashRegister = await recordPaidCompletion("x402DiscoveryAudit", 0.01);
    response.json({ ...result, cashRegister });
  });

  app.post("/api/listing-score", async (request, response) => {
    const parsed = listingRoastRequestSchema.safeParse(request.listingRoastInput ?? request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
      return;
    }

    const result = buildListingScore(parsed.data);
    const cashRegister = await recordPaidCompletion("listingScorePost", 0.005);
    response.json({ ...result, cashRegister });
  });

  app.post(ROAST_PATH, async (request, response) => {
    const parsed = listingRoastRequestSchema.safeParse(request.listingRoastInput ?? request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
      return;
    }

    const result = buildListingRoast(parsed.data);
    const cashRegister = await recordPaidCompletion("listingRoast", 0.01);
    response.json({ ...result, cashRegister });
  });

  return app;
}
