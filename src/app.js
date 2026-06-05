import express from "express";
import { getAuthHeaders } from "@coinbase/cdp-sdk/auth";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware } from "@x402/express";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";

import { getCashRegister, recordPaidCompletion } from "./cashRegister.js";
import { buildListingRoast, listingRoastRequestSchema, requestExample } from "./roast.js";

const DEFAULT_DEV_PAY_TO = "0x000000000000000000000000000000000000dEaD";

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
    price: "$1.00"
  };
}

function absoluteUrl(config, pathname) {
  return `${config.serviceUrl}${pathname}`;
}

function buildDiscovery(config) {
  return {
    input: requestExample,
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
      example: buildListingRoast(requestExample),
      schema: {
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
      }
    },
    service: {
      name: config.serviceName,
      url: config.serviceUrl,
      route: absoluteUrl(config, "/api/listing-roast"),
      price: config.price,
      network: config.network
    }
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

  return paymentMiddleware(
    {
      "POST /api/listing-roast": {
        accepts: {
          scheme: "exact",
          price: config.price,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 300
        },
        description: "A $1 x402 critique for paid agent/API listing copy, buyer-agent skip reasons, and stop-or-upgrade guidance.",
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

function validateListingRoastRequest(request, response, next) {
  const parsed = listingRoastRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    return;
  }

  request.listingRoastInput = parsed.data;
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
  app.use(express.json({ limit: "32kb" }));

  app.get("/health", (_request, response) => {
    response.json({ ok: true, service: config.serviceName, paidRoute: "/api/listing-roast" });
  });

  app.get("/", (_request, response) => {
    response.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${config.serviceName}</title>
  <style>
    body { margin: 0; font: 16px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f5ef; color: #171717; }
    main { max-width: 920px; margin: 0 auto; padding: 56px 24px; }
    h1 { font-size: clamp(2rem, 5vw, 4rem); line-height: 1; margin: 0 0 20px; }
    p { max-width: 760px; }
    code, pre { background: #fff; border: 1px solid #ddd6c8; border-radius: 8px; }
    code { padding: 2px 6px; }
    pre { padding: 16px; overflow: auto; }
    a.button { display: inline-block; background: #111; color: #fff; padding: 12px 16px; border-radius: 8px; text-decoration: none; margin-right: 8px; }
    .muted { color: #5f5a50; }
  </style>
</head>
<body>
  <main>
    <h1>Listing Roast x402</h1>
    <p>A standalone $1 Base mainnet x402 route for builders who want paid agent/API listing copy critiqued before promoting it.</p>
    <p><strong>Paid route:</strong> <code>POST /api/listing-roast</code>. <strong>Price:</strong> ${config.price}. <strong>Output:</strong> JSON with skip reasons, top fixes, a rewrite, and stop-or-upgrade guidance.</p>
    <p>
      <a class="button" href="/api/schema">View schema</a>
      <a class="button" href="/.well-known/mcp.json">MCP metadata</a>
      <a class="button" href="/api/cash-register">Cash register</a>
    </p>
    <pre>curl -i -X POST ${absoluteUrl(config, "/api/listing-roast")} \\
  -H 'Content-Type: application/json' \\
  -d '${JSON.stringify(requestExample)}'</pre>
    <p class="muted">No subscriptions. No accounts. The protected route returns HTTP 402 until a valid x402 payment is attached.</p>
  </main>
</body>
</html>`);
  });

  app.get("/api/schema", (_request, response) => {
    response.json(buildDiscovery(config));
  });

  app.get("/.well-known/mcp.json", (_request, response) => {
    response.json({
      name: config.serviceName,
      tools: [
        {
          name: "roast_paid_listing",
          method: "POST",
          path: "/api/listing-roast",
          url: absoluteUrl(config, "/api/listing-roast"),
          price: config.price,
          network: config.network,
          input: requestExample
        }
      ]
    });
  });

  app.get("/api/cash-register", async (_request, response) => {
    response.json(await getCashRegister());
  });

  app.post("/api/listing-roast", validateListingRoastRequest);
  app.use(createX402Middleware(config));

  app.post("/api/listing-roast", async (request, response) => {
    const result = buildListingRoast(request.listingRoastInput);
    const cashRegister = await recordPaidCompletion();
    response.json({ ...result, cashRegister });
  });

  return app;
}
