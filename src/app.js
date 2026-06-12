import express from "express";
import { getAuthHeaders } from "@coinbase/cdp-sdk/auth";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware } from "@x402/express";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";

import { getCashRegister, recordPaidCompletion, recordSignal } from "./cashRegister.js";
import { buildListingRoast, buildListingScore, listingRoastRequestSchema, requestExample } from "./roast.js";

const DEFAULT_DEV_PAY_TO = "0x000000000000000000000000000000000000dEaD";
const BASE_MAINNET_NETWORK = "eip155:8453";
const BASE_USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_DECIMALS = 1_000_000n;

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
    price: "$1.00",
    scorePrice: "$0.05"
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

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function buildPayCommand(config, pathname = "/api/listing-roast", maxAmount = "1000000") {
  return `npx awal@2.8.0 x402 pay ${absoluteUrl(config, pathname)} \\
  -X POST \\
  -d ${shellQuote(JSON.stringify(requestExample))} \\
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
  const routePath = options.routePath || "/api/listing-roast";
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
        upgradeEndpoint: { type: "string" }
      }
    }
  });
}

function buildOpenApiDocument(config) {
  return {
    openapi: "3.1.0",
    info: {
      title: config.serviceName,
      version: "0.2.0",
      description: "Paid x402 API that scores and roasts paid agent/API listing copy before promotion."
    },
    servers: [{ url: config.serviceUrl }],
    paths: {
      "/api/listing-score": {
        post: {
          summary: "Paid $0.05 listing score",
          description: "Returns a quick listing score, checked signals, first fix, and upgrade guidance after x402 payment.",
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
      "/api/listing-roast": {
        post: {
          summary: "Paid $1 full listing roast",
          description: "Returns buyer-agent skip reasons, top fixes, rewritten listing copy, and stop-or-upgrade guidance after x402 payment.",
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
          summary: "Free sample score output",
          responses: {
            200: {
              description: "Sample request, command, and score output"
            }
          }
        }
      }
    },
    "x-listing-roast": {
      homepage: config.serviceUrl,
      builder: absoluteUrl(config, "/builder"),
      sample: absoluteUrl(config, "/sample"),
      scoreRoute: absoluteUrl(config, "/api/listing-score"),
      roastRoute: absoluteUrl(config, "/api/listing-roast"),
      scorePrice: config.scorePrice,
      roastPrice: config.price,
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
        description: "Listing Score x402: $0.05 paid API listing score for x402/MCP builders, first missing signal, and upgrade guidance.",
        mimeType: "application/json",
        extensions: declareDiscoveryExtension(buildScoreDiscovery(config))
      },
      "POST /api/listing-roast": {
        accepts: {
          scheme: "exact",
          price: config.price,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 300
        },
        description: "Listing Roast x402: $1 paid API listing critique for x402/MCP builders, buyer-agent skip reasons, top fixes, rewrite, and stop-or-upgrade guidance.",
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
  return pathname === "/api/listing-score" ? "scoreValidUnpaidChallenges" : "roastValidUnpaidChallenges";
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

  app.get("/health", (_request, response) => {
    response.json({ ok: true, service: config.serviceName, paidRoute: "/api/listing-roast" });
  });

  app.get("/", async (_request, response) => {
    await recordSignal("homepageViews");
    const cashRegisterUrl = absoluteUrl(config, "/api/cash-register");
    const paidRoute = absoluteUrl(config, "/api/listing-roast");
    const scoreRoute = absoluteUrl(config, "/api/listing-score");
    const builderUrl = absoluteUrl(config, "/builder");
    const sampleUrl = absoluteUrl(config, "/sample");
    const schemaUrl = absoluteUrl(config, "/api/schema");
    const examplesUrl = absoluteUrl(config, "/api/examples");
    const openApiUrl = absoluteUrl(config, "/openapi.json");
    const llmsUrl = absoluteUrl(config, "/llms.txt");
    const mcpUrl = absoluteUrl(config, "/.well-known/mcp.json");
    const payCommand = buildPayCommand(config);
    const scoreCommand = buildPayCommand(config, "/api/listing-score", "50000");
    const scoreOutput = buildListingScore(requestExample);
    const sampleOutput = buildListingRoast(requestExample);

    response.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="A $0.05 score and $1 x402 paid API that critiques paid agent and API listing copy before launch." />
  <meta property="og:title" content="${escapeHtml(config.serviceName)}" />
  <meta property="og:description" content="Find out why buyer agents skip your paid API listing before you promote it." />
  <meta property="og:url" content="${escapeHtml(config.serviceUrl)}" />
  <link rel="canonical" href="${escapeHtml(config.serviceUrl)}/" />
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
          <p class="lead">Start with a ${config.scorePrice} listing score or pay ${config.price} for the full roast. Send your listing copy and get buyer-agent skip reasons before you promote.</p>
          <div class="actions">
            <button class="button" type="button" data-copy-target="score-command" data-default-text="Copy $0.05 score command">Copy $0.05 score command</button>
            <button class="button secondary" type="button" data-copy-target="pay-command" data-default-text="Copy $1 roast command">Copy $1 roast command</button>
            <a class="button secondary" href="${builderUrl}">Build your command</a>
            <a class="button secondary" href="${sampleUrl}">View sample score</a>
            <a class="button secondary" href="${examplesUrl}">Open examples JSON</a>
            <a class="button secondary" href="${schemaUrl}">View JSON schema</a>
          </div>
          <div class="proof" aria-label="Proof points">
            <div><strong class="metric">Live</strong><span class="muted">Production x402 route</span></div>
            <div><strong>${config.scorePrice} / ${config.price}</strong><span class="muted">Score or full roast</span></div>
            <div><strong class="metric">Discoverable</strong><span class="muted">Declared for Bazaar</span></div>
          </div>
        </div>
        <div class="device" aria-label="Terminal preview">
          <div class="deviceTop"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
          <div class="terminal">$ x402 pay /api/listing-roast
<span class="warn">402 Payment Required</span>
payTo: ${escapeHtml(config.payTo)}
network: ${escapeHtml(config.network)}
score amount: 50000 USDC units
roast amount: 1000000 USDC units
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
          <p class="muted">x402, MCP, and agent-service builders who have a paid endpoint but weak listing copy.</p>
        </div>
        <div class="card">
          <h3>What you send</h3>
          <p class="muted">The service name, listing copy, target buyer, price, checkout path, and launch goal.</p>
        </div>
        <div class="card">
          <h3>What you get</h3>
          <p class="muted">A structured JSON critique that tells you what to fix before paying for traffic or posting widely.</p>
        </div>
      </div>
    </section>

    <section class="band" id="pay">
      <div class="wrap grid2">
        <div>
          <h2>Pay ${config.scorePrice} first, then upgrade when useful.</h2>
          <p>Both endpoints are protected by x402. The first unpaid request returns a payment challenge; the paid retry returns JSON.</p>
          <p>
            <span class="tag">Base mainnet</span>
            <span class="tag">USDC</span>
            <span class="tag">No account</span>
            <span class="tag">Agent-readable JSON</span>
          </p>
        </div>
        <div class="card">
          <h3>Score route</h3>
          <p><code>POST ${escapeHtml(scoreRoute)}</code></p>
          <p class="muted">Maximum payment: <strong>50000</strong> USDC units.</p>
        </div>
        <div class="card">
          <h3>Full roast route</h3>
          <p><code>POST ${escapeHtml(paidRoute)}</code></p>
          <p class="muted">Maximum payment: <strong>1000000</strong> USDC units.</p>
        </div>
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
          <p>The score response gives the first missing signal and upgrade guidance. The full roast adds skip reasons, top fixes, a rewrite, and stop-or-upgrade guidance.</p>
          <p class="muted">The current public cash register is available at <a href="${cashRegisterUrl}">/api/cash-register</a>. A sample score is available at <a href="${sampleUrl}">/sample</a>. The command builder is available at <a href="${builderUrl}">/builder</a>. Copy-ready examples are available at <a href="${examplesUrl}">/api/examples</a>. Route schemas are available at <a href="${schemaUrl}">/api/schema</a> and <a href="${absoluteUrl(config, "/api/score-schema")}">/api/score-schema</a>.</p>
        </div>
        <pre>${escapeHtml(prettyJson(scoreOutput))}</pre>
      </div>
      <div class="wrap grid2" style="margin-top: 18px;">
        <div>
          <h3>Full roast sample</h3>
          <p class="muted">The $1 route adds the rewrite and launch decision after payment.</p>
        </div>
        <pre>${escapeHtml(prettyJson(sampleOutput))}</pre>
      </div>
    </section>

    <section class="band">
      <div class="wrap grid2">
        <div class="card">
          <h3>Discovery</h3>
          <p class="muted">The route is declared for x402 Bazaar discovery with JSON body metadata, OpenAPI, llms.txt, and an example payload.</p>
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
    const urls = ["/", "/builder", "/sample", "/api/sample-score", "/openapi.json", "/llms.txt", "/api/schema", "/api/score-schema", "/api/examples", "/.well-known/mcp.json"].map((pathname) => {
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
      paidRoute: absoluteUrl(config, "/api/listing-roast"),
      scoreRoute: absoluteUrl(config, "/api/listing-score"),
      price: config.price,
      scorePrice: config.scorePrice,
      network: config.network,
      request: requestExample,
      command: buildPayCommand(config),
      scoreCommand: buildPayCommand(config, "/api/listing-score", "50000"),
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
      command: buildPayCommand(config, "/api/listing-score", "50000"),
      output: buildListingScore(requestExample)
    });
  });

  app.get("/llms.txt", async (_request, response) => {
    await recordSignal("llmsViews");
    response
      .type("text/plain")
      .send(`# Listing Roast x402

Listing Roast x402 is a paid API for x402, MCP, and agent-service builders who need clearer paid API listing copy before promotion.

Homepage: ${absoluteUrl(config, "/")}
Command builder: ${absoluteUrl(config, "/builder")}
Sample score page: ${absoluteUrl(config, "/sample")}
Sample score JSON: ${absoluteUrl(config, "/api/sample-score")}
OpenAPI: ${absoluteUrl(config, "/openapi.json")}
MCP metadata: ${absoluteUrl(config, "/.well-known/mcp.json")}

Paid routes:

- POST ${absoluteUrl(config, "/api/listing-score")}
  - Price: ${config.scorePrice}
  - Network: ${config.network}
  - Max amount: 50000 USDC units
  - Output: score, checked signals, first fix, next step, upgrade endpoint

- POST ${absoluteUrl(config, "/api/listing-roast")}
  - Price: ${config.price}
  - Network: ${config.network}
  - Max amount: 1000000 USDC units
  - Output: buyer-agent skip reasons, top fixes, rewritten listing, stop-or-upgrade guidance

Request body JSON:

${prettyJson(requestExample)}

Use the $0.05 score first when deciding whether the listing is worth a full rewrite.
`);
  });

  app.get("/openapi.json", async (_request, response) => {
    await recordSignal("openApiViews");
    response.json(buildOpenApiDocument(config));
  });

  app.get("/builder", async (_request, response) => {
    await recordSignal("builderViews");
    const scoreRoute = absoluteUrl(config, "/api/listing-score");
    const roastRoute = absoluteUrl(config, "/api/listing-roast");
    const sampleUrl = absoluteUrl(config, "/sample");
    const sampleScoreApi = absoluteUrl(config, "/api/sample-score");
    const scoreCommand = buildPayCommand(config, "/api/listing-score", "50000");
    const roastCommand = buildPayCommand(config);

    response.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Build a copy-ready x402 command for the Listing Roast $0.05 score route." />
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
      <p class="lead">Paste the offer you are trying to sell. This page builds the exact x402 command for the ${config.scorePrice} score route and the optional ${config.price} full roast route.</p>
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
          <div class="card">
            <h2>Score command <span class="metric">${config.scorePrice}</span></h2>
            <p class="muted"><code>POST ${escapeHtml(scoreRoute)}</code></p>
            <pre id="score-command">${escapeHtml(scoreCommand)}</pre>
            <button class="button" type="button" data-copy-target="score-command" data-default-text="Copy score command">Copy score command</button>
          </div>
          <div class="card" style="margin-top: 18px;">
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
      document.getElementById("score-command").textContent = command(scoreUrl, "50000");
      document.getElementById("pay-command").textContent = command(roastUrl, "1000000");
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
    const scoreCommand = buildPayCommand(config, "/api/listing-score", "50000");
    const roastCommand = buildPayCommand(config);
    const scoreOutput = buildListingScore(requestExample);
    const builderUrl = absoluteUrl(config, "/builder");
    const sampleScoreApi = absoluteUrl(config, "/api/sample-score");
    const paidRoute = absoluteUrl(config, "/api/listing-score");
    const roastRoute = absoluteUrl(config, "/api/listing-roast");

    response.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Sample Listing Roast x402 score output before paying $0.05." />
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
      <h1>Sample the $0.05 listing score before paying.</h1>
      <p class="lead">This is the exact response shape from the paid score route. If it matches what your agent or API listing needs, use the x402 command below.</p>
      <div class="actions">
        <button class="button" type="button" data-copy-target="score-command" data-default-text="Copy $0.05 score command">Copy $0.05 score command</button>
        <a class="button secondary" href="${builderUrl}">Build your command</a>
        <a class="button secondary" href="${sampleScoreApi}">Open sample JSON</a>
      </div>
      <div class="grid">
        <div class="card">
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
${copyScript("Copy $0.05 score command")}
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

  app.get("/.well-known/mcp.json", async (_request, response) => {
    await recordSignal("mcpViews");
    response.json({
      name: config.serviceName,
      homepage: absoluteUrl(config, "/"),
      builder: absoluteUrl(config, "/builder"),
      sample: absoluteUrl(config, "/sample"),
      openApi: absoluteUrl(config, "/openapi.json"),
      llms: absoluteUrl(config, "/llms.txt"),
      tools: [
        {
          name: "score_paid_listing",
          method: "POST",
          path: "/api/listing-score",
          url: absoluteUrl(config, "/api/listing-score"),
          price: config.scorePrice,
          network: config.network,
          input: requestExample
        },
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
    const cashRegister = await getCashRegister();
    const receiverWallet = await getReceiverBalanceSnapshot(config);
    response.json({ ...cashRegister, receiverWallet });
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

  app.post("/api/listing-roast", validateListingRoastRequest);
  app.post("/api/listing-score", validateListingRoastRequest);
  app.post(["/api/listing-score", "/api/listing-roast"], async (request, _response, next) => {
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

  app.post("/api/listing-score", async (request, response) => {
    const parsed = listingRoastRequestSchema.safeParse(request.listingRoastInput ?? request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
      return;
    }

    const result = buildListingScore(parsed.data);
    const cashRegister = await recordPaidCompletion("listingScore", 0.05);
    response.json({ ...result, cashRegister });
  });

  app.post("/api/listing-roast", async (request, response) => {
    const parsed = listingRoastRequestSchema.safeParse(request.listingRoastInput ?? request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
      return;
    }

    const result = buildListingRoast(parsed.data);
    const cashRegister = await recordPaidCompletion("listingRoast", 1);
    response.json({ ...result, cashRegister });
  });

  return app;
}
