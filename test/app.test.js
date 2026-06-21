import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildInstantScoreInput, createApp, normalizeIndexedQuickScoreQuery } from "../src/app.js";
import { getCashRegister, recordPaidCompletion } from "../src/cashRegister.js";
import { requestExample } from "../src/roast.js";

let testDataDir;
const QUICK_SCORE_ALIAS_PATHS = ["/api/marketplace-listing-score", "/api/marketplace-listing-conversion-api", "/api/marketplace-listing-conversion", "/api/marketplace-product-listing-quality", "/api/paid-api-listing-quality", "/api/paid-api-listing-quality-score", "/api/listing-quality-score-api", "/api/agentcore-x402-payments", "/api/coinbase-x402-bazaar-mcp-server", "/api/x402-listing-quality", "/api/buyer-agent-skip-reasons", "/api/agent-service-clarity"];
const PREFLIGHT_ALIAS_PATHS = ["/api/preflight", "/api/v1/preflight", "/preflight"];
const SITE_AUDIT_EXACT_ALIAS_PATHS = ["/api/x402-buyer-prepay-risk-score", "/api/score-x402-endpoint-before-paying", "/api/x402-route-health-check", "/api/x402-listing-rank-doctor"];
const INTENT_LANDING_PAGE_PATHS = ["/paid-api-listing-quality", "/paid-api-listing-quality-score", "/listing-quality-score-api", "/marketplace-product-listing-quality", "/marketplace-listing-conversion-api", "/marketplace-listing-conversion", "/x402-listing-quality", "/buyer-agent-skip-reasons", "/agent-service-clarity", "/agent-listing-conversion", "/x402-discovery-audit", "/x402-site-audit", "/x402-buyer-prepay-risk-score", "/score-x402-endpoint-before-paying", "/x402-route-health-check", "/x402-listing-rank-doctor", "/agentcore-x402-payments", "/coinbase-x402-bazaar-mcp-server", "/full-listing-roast"];
const COMPACT_OPENAPI_OMITTED_PATHS = ["/api", "/api/v1", "/v1", "/v2/x402/discovery/resources", "/v2/x402/discovery/search", "/v2/x402/discovery/merchant", "/preflight"];
const PAID_RESOURCE_COUNT = 35;

beforeEach(async () => {
  testDataDir = await mkdtemp(path.join(os.tmpdir(), "listing-roast-test-"));
  process.env.DATA_DIR = testDataDir;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.DATA_DIR;
  delete process.env.BASELINE_LAST_SETTLEMENT_TX_HASH;
  delete process.env.BASELINE_LAST_SETTLEMENT_USDC_UNITS;
  delete process.env.BASELINE_LAST_SETTLEMENT_CONFIRMED_AT;
  delete process.env.BASELINE_LAST_SETTLEMENT_ROUTE_PATH;
  delete process.env.BASELINE_LAST_SETTLEMENT_METHOD;
  delete process.env.BASELINE_LAST_SETTLEMENT_MAX_AMOUNT_REQUIRED;
  delete process.env.BASELINE_PAID_COMPLETIONS;
  delete process.env.BASELINE_ESTIMATED_GROSS_REVENUE_USD;
  delete process.env.BASELINE_LISTING_SCORE_COMPLETIONS;
  delete process.env.BASELINE_LISTING_SCORE_REVENUE_USD;
  delete process.env.BASELINE_INDEXED_ROAST_GET_COMPLETIONS;
  delete process.env.BASELINE_INDEXED_ROAST_GET_REVENUE_USD;
  delete process.env.BASELINE_LAST_PAID_AT;
  await rm(testDataDir, { recursive: true, force: true });
});

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function fetchJson(server, path, options = {}) {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, options);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return {
    status: response.status,
    headers: response.headers,
    text,
    json
  };
}

function readPaymentRequiredHeader(headers) {
  const encoded = headers.get("payment-required");
  expect(encoded).toBeTruthy();
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
}

function expectFreshDiscoveryHeaders(headers) {
  expect(headers.get("cache-control")).toContain("no-store");
  expect(headers.get("pragma")).toBe("no-cache");
  expect(headers.get("expires")).toBe("0");
}

function expectBrowserPaymentSupport(browserPayment, route = "http://localhost:8787/api/listing-roast") {
  expect(browserPayment.browserPaymentReady).toBe(true);
  expect(browserPayment.paymentRequiredStatus).toBe(402);
  expect(browserPayment.paymentRequiredHeader).toBe("Payment-Required");
  expect(browserPayment.paymentHeader).toBe("X-PAYMENT");
  expect(browserPayment.paymentResponseHeader).toBe("X-PAYMENT-RESPONSE");
  expect(browserPayment.cors.allowOrigin).toBe("*");
  expect(browserPayment.cors.allowMethods).toContain("OPTIONS");
  expect(browserPayment.cors.allowMethods).toContain("GET");
  expect(browserPayment.cors.allowMethods).toContain("POST");
  expect(browserPayment.cors.allowHeaders).toContain("X-PAYMENT");
  expect(browserPayment.cors.exposeHeaders).toContain("Payment-Required");
  expect(browserPayment.cors.exposeHeaders).toContain("X-PAYMENT-RESPONSE");
  expect(browserPayment.cors.exposeHeaders).toContain("Link");
  expect(browserPayment.preflight.status).toBe(204);
  expect(browserPayment.preflight.noPaymentRequired).toBe(true);
  expect(browserPayment.endpoints.route).toBe(route);
  expect(browserPayment.endpoints.payNow).toBe("http://localhost:8787/api/pay-now");
  expect(browserPayment.instruction).toContain("preflight with OPTIONS");
}

function scoreAgent402OpenApiOperation(operation, query) {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, 32);
  const slug = (operation.operationId || "").toLowerCase();
  const name = (operation.summary || "").toLowerCase();
  const category = (operation.tags || [])[0] || "other";
  const hay = `${operation.summary || ""} ${operation.description || ""} ${category} ${(operation.tags || []).join(" ")}`.toLowerCase();
  let score = 0;

  for (const term of terms) {
    if (slug === term) score += 10;
    else if (slug.includes(term)) score += 4;
    if (name.includes(term)) score += 2;
    if (hay.includes(term)) score += 1;
  }

  return score;
}

function countOpenApiOperations(paths) {
  return Object.values(paths).reduce((count, pathItem) => (
    count + ["get", "post", "put", "patch", "delete"].filter((method) => pathItem[method]).length
  ), 0);
}

function mockFacilitatorSupportedKinds() {
  const realFetch = globalThis.fetch;

  vi.stubGlobal("fetch", async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url.endsWith("/supported")) {
      return new Response(JSON.stringify({
        kinds: [
          {
            x402Version: 2,
            scheme: "exact",
            network: "eip155:84532",
            extra: {
              name: "USD Coin",
              version: "2"
            }
          },
          {
            x402Version: 2,
            scheme: "exact",
            network: "eip155:8453",
            extra: {
              name: "USD Coin",
              version: "2"
            }
          }
        ],
        extensions: ["bazaar"],
        signers: {}
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    return realFetch(input, init);
  });
}

describe("Listing Roast x402 service", () => {
  it("normalizes stale Bazaar defaults for the indexed quick-score route", () => {
    const staleCachedQuery = {
      agentName: "Example x402 API",
      listingText: "A paid x402 API that helps builders check whether buyer agents understand the offer before paying. It returns JSON with skip reasons, top fixes, a rewritten listing, and a stop-or-upgrade recommendation. Example payloads are included for quick testing.",
      targetBuyer: "x402, MCP, and AgentCore Gateway builders",
      currentPrice: "$1.00",
      currentCheckoutPath: "/api/listing-roast",
      goal: "Increase first paid conversion"
    };

    const normalized = normalizeIndexedQuickScoreQuery(staleCachedQuery);
    expect(normalized.agentName).toBe("Listing Roast x402");
    expect(normalized.currentPrice).toBe("$0.001 GET; $0.01 GET/POST roast");
    expect(normalized.listingText).toContain("$0.001 GET /api/listing-roast");

    const input = buildInstantScoreInput(staleCachedQuery, { normalizeStaleIndexedDefaults: true });
    expect(input.agentName).toBe("Listing Roast x402");
    expect(input.currentPrice).toBe("$0.001 GET; $0.01 GET/POST roast");
    expect(input.source).toBe("indexed-get-score-stale-bazaar-cache-normalized");

    const customQuery = {
      ...staleCachedQuery,
      agentName: "Custom Paid API",
      currentPrice: "$0.02"
    };
    expect(normalizeIndexedQuickScoreQuery(customQuery)).toBe(customQuery);
    expect(buildInstantScoreInput(customQuery, { normalizeStaleIndexedDefaults: true }).currentPrice).toBe("$0.02");
  });

  it("serves checkout-style aliases as free pay-now handoffs", async () => {
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      for (const aliasPath of ["/api/checkout", "/checkout", "/api/buy", "/buy", "/api/pay", "/pay", "/api/start", "/start"]) {
        const checkout = await fetchJson(server, `${aliasPath}?intent=buyer-agent%20skip%20reasons`);
        expect(checkout.status).toBe(200);
        expect(checkout.headers.get("payment-required")).toBeNull();
        expect(checkout.json.noSpendNote).toContain("Fetching this endpoint is free");
        expect(checkout.json.canonicalPayNow).toBe("http://localhost:8787/api/pay-now");
        expect(checkout.json.checkoutAliases).toContain(`http://localhost:8787${aliasPath}`);
        expect(checkout.json.links.canonicalPayNow).toBe("http://localhost:8787/api/pay-now");
        expect(checkout.json.links.checkoutAliases).toContain("http://localhost:8787/api/checkout");
        expect(checkout.json.selectedActionKey).toBe("buyerAgentSkipReasons");
        expect(checkout.json.selectedPaidPath).toBe("/api/listing-roast");
        expect(checkout.json.firstPaidPath).toBe("/api/listing-roast");
        expect(checkout.json.payableRoute.path).toBe("/api/listing-roast");
        expectBrowserPaymentSupport(checkout.json.browserPayment);
        expect(checkout.json.paymentRule).toContain("Do not call paid routes");
      }
    } finally {
      server.close();
    }
  });

  it("accepts checkout-style POST handoffs without spending", async () => {
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    const handoffPaths = ["/api/pay-now", "/api/checkout", "/checkout", "/api/buy", "/buy", "/api/pay", "/pay", "/api/start", "/start"];
    try {
      for (const aliasPath of handoffPaths) {
        const checkout = await fetchJson(server, aliasPath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ intent: "buyer-agent skip reasons" })
        });
        expect(checkout.status).toBe(200);
        expect(checkout.headers.get("payment-required")).toBeNull();
        expect(checkout.json.handoffMethod).toBe("POST");
        expect(checkout.json.acceptedIntentFields).toContain("intent");
        expect(checkout.json.noSpendNote).toContain("Fetching this endpoint is free");
        expect(checkout.json.selectedActionKey).toBe("buyerAgentSkipReasons");
        expect(checkout.json.selectedPaidPath).toBe("/api/listing-roast");
        expect(checkout.json.firstPaidPath).toBe("/api/listing-roast");
        expect(checkout.json.payableRoute.path).toBe("/api/listing-roast");
        expectBrowserPaymentSupport(checkout.json.browserPayment);
        expect(checkout.json.paymentRule).toContain("Do not call paid routes");
      }

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.payNowViews).toBe(handoffPaths.length);
      expect(cashRegister.json.intentSignals.payNow.buyerAgentSkipReasons).toBe(handoffPaths.length);
      expect(JSON.stringify(cashRegister.json.intentSignals)).not.toContain("buyer-agent skip reasons");
    } finally {
      server.close();
    }
  });

  it("exposes x402 payment headers to browser clients and handles preflight without payment", async () => {
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const unpaidRoast = await fetchJson(server, "/api/listing-roast", {
        headers: { origin: "https://buyer.example" }
      });
      expect(unpaidRoast.status).toBe(402);
      expect(unpaidRoast.headers.get("payment-required")).toBeTruthy();
      expect(unpaidRoast.headers.get("access-control-allow-origin")).toBe("*");
      expect(unpaidRoast.headers.get("access-control-expose-headers")).toContain("Payment-Required");
      expect(unpaidRoast.headers.get("access-control-expose-headers")).toContain("X-PAYMENT-RESPONSE");
      expect(unpaidRoast.headers.get("access-control-expose-headers")).toContain("Link");
      expectBrowserPaymentSupport(unpaidRoast.json.browserPayment);
      expectBrowserPaymentSupport(unpaidRoast.json.payableRoute.browserPayment);
      expect(unpaidRoast.json.paymentRequirementsSource.browserReadable).toBe(true);

      const payNowPreflight = await fetchJson(server, "/api/pay-now", {
        method: "OPTIONS",
        headers: {
          origin: "https://buyer.example",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type"
        }
      });
      expect(payNowPreflight.status).toBe(204);
      expect(payNowPreflight.headers.get("payment-required")).toBeNull();
      expect(payNowPreflight.headers.get("access-control-allow-origin")).toBe("*");
      expect(payNowPreflight.headers.get("access-control-allow-methods")).toContain("GET");
      expect(payNowPreflight.headers.get("access-control-allow-methods")).toContain("POST");
      expect(payNowPreflight.headers.get("access-control-allow-headers")).toBe("content-type");

      const paidRoutePreflight = await fetchJson(server, "/api/listing-roast", {
        method: "OPTIONS",
        headers: {
          origin: "https://buyer.example",
          "access-control-request-method": "GET",
          "access-control-request-headers": "x-payment"
        }
      });
      expect(paidRoutePreflight.status).toBe(204);
      expect(paidRoutePreflight.headers.get("payment-required")).toBeNull();
      expect(paidRoutePreflight.headers.get("access-control-allow-headers")).toBe("x-payment");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.indexedRoastGetValidUnpaidChallenges).toBe(1);
    } finally {
      server.close();
    }
  });

  it("records aggregate no-spend intent signals without storing raw queries", async () => {
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const payNow = await fetchJson(server, "/api/pay-now?intent=buyer-agent%20skip%20reasons");
      expect(payNow.status).toBe(200);
      expect(payNow.headers.get("payment-required")).toBeNull();
      expect(payNow.json.selectedActionKey).toBe("buyerAgentSkipReasons");
      expect(payNow.json.selectedPaidUrl).toContain("/api/listing-roast");
      expect(payNow.json.selectedPaidPath).toBe("/api/listing-roast");
      expect(payNow.json.firstPaidUrl).toContain("/api/listing-roast");
      expect(payNow.json.payableRoute.path).toBe("/api/listing-roast");
      expect(payNow.json.exactIntentPaidUrl).toContain("/api/buyer-agent-skip-reasons");
      expect(payNow.json.intentSignal).toEqual({
        source: "payNow",
        selectedActionKey: "buyerAgentSkipReasons",
        aggregateOnly: true,
        rawQueryStored: false,
        cashRegisterPath: "/api/cash-register"
      });

      const findDiscovery = await fetchJson(server, "/api/find?q=x402%20discovery%20audit");
      expect(findDiscovery.status).toBe(200);
      expect(findDiscovery.headers.get("payment-required")).toBeNull();
      expect(findDiscovery.json.service).toBe("Listing Roast x402");
      expect(findDiscovery.json.serviceName).toBe("Listing Roast x402");
      expect(findDiscovery.json.metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(findDiscovery.json.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(findDiscovery.json.selectedActionKey).toBe("discoveryAuditQuick");
      expect(findDiscovery.json.selectedPaidUrl).toContain("/api/x402-discovery-audit");
      expect(findDiscovery.json.intentSignal.source).toBe("find");
      expect(findDiscovery.json.intentSignal.rawQueryStored).toBe(false);

      const routeFullRoast = await fetchJson(server, "/api/route?query=full%20roast%20rewrite%20top%20fixes");
      expect(routeFullRoast.status).toBe(200);
      expect(routeFullRoast.headers.get("payment-required")).toBeNull();
      expect(routeFullRoast.json.service).toBe("Listing Roast x402");
      expect(routeFullRoast.json.serviceName).toBe("Listing Roast x402");
      expect(routeFullRoast.json.metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(routeFullRoast.json.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(routeFullRoast.json.selectedActionKey).toBe("fullRoastGet");
      expect(routeFullRoast.json.selectedPaidUrl).toContain("/api/full-listing-roast");
      expect(routeFullRoast.json.payableRoute.path).toBe("/api/full-listing-roast");
      expect(routeFullRoast.json.results[0].serviceName).toBe("Listing Roast x402");
      expect(routeFullRoast.json.results[0].metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(routeFullRoast.json.intentSignal.source).toBe("route");

      const routePreflight = await fetchJson(server, "/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "paid API preflight before paying" })
      });
      expect(routePreflight.status).toBe(200);
      expect(routePreflight.json.serviceName).toBe("Listing Roast x402");
      expect(routePreflight.json.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(routePreflight.json.selectedActionKey).toBe("x402SiteAudit");
      expect(routePreflight.json.intentSignal.rawQueryStored).toBe(false);

      const localDiscovery = await fetchJson(server, "/v2/x402/discovery/search?query=paid%20API%20listing%20quality&limit=2");
      expect(localDiscovery.status).toBe(200);
      expect(localDiscovery.headers.get("payment-required")).toBeNull();
      expect(localDiscovery.json.service).toBe("Listing Roast x402");
      expect(localDiscovery.json.serviceName).toBe("Listing Roast x402");
      expect(localDiscovery.json.metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(localDiscovery.json.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(localDiscovery.json.selectedActionKey).toBe("paidApiListingQuality");
      expect(localDiscovery.json.selectedPaidUrl).toContain("/api/listing-roast");
      expect(localDiscovery.json.payableRoute.path).toBe("/api/listing-roast");
      expect(localDiscovery.json.exactIntentPaidUrl).toContain("/api/paid-api-listing-quality");
      expect(localDiscovery.json.resources[0].serviceName).toBe("Listing Roast x402 Paid API Listing Quality Score");
      expect(localDiscovery.json.resources[0].metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(localDiscovery.json.resources[0].metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(localDiscovery.json.resources[0].metadata.serviceName).toBe("Listing Roast x402");
      expect(localDiscovery.json.resources[0].metadata.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(localDiscovery.json.intentSignal).toEqual({
        source: "localDiscovery",
        selectedActionKey: "paidApiListingQuality",
        aggregateOnly: true,
        rawQueryStored: false,
        cashRegisterPath: "/api/cash-register"
      });

      const mcpSearch = await fetchJson(server, "/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "search_resources",
            arguments: {
              query: "buyer-agent skip reasons",
              limit: 2
            }
          }
        })
      });
      expect(mcpSearch.status).toBe(200);
      expect(mcpSearch.json.result.structuredContent.selectedActionKey).toBe("buyerAgentSkipReasons");
      expect(mcpSearch.json.result.structuredContent.selectedFirstPaidAction.path).toBe("/api/listing-roast");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.status).toBe(200);
      expect(cashRegister.json.intentSignals.payNow.buyerAgentSkipReasons).toBe(1);
      expect(cashRegister.json.intentSignals.find.discoveryAuditQuick).toBe(1);
      expect(cashRegister.json.intentSignals.route.fullRoastGet).toBe(1);
      expect(cashRegister.json.intentSignals.route.x402SiteAudit).toBe(1);
      expect(cashRegister.json.intentSignals.localDiscovery.paidApiListingQuality).toBe(1);
      expect(cashRegister.json.intentSignals.mcp.buyerAgentSkipReasons).toBe(1);
      expect(JSON.stringify(cashRegister.json.intentSignals)).not.toContain("buyer-agent skip reasons");
      expect(JSON.stringify(cashRegister.json.intentSignals)).not.toContain("paid API preflight before paying");
      expect(JSON.stringify(cashRegister.json.intentSignals)).not.toContain("paid API listing quality");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("serves public metadata without payment", async () => {
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const health = await fetchJson(server, "/health");
      expect(health.status).toBe(200);
      expect(health.json.paidRoute).toBe("/api/listing-roast");
      expect(health.headers.get("link")).toContain("/x402.json");
      expect(health.headers.get("link")).toContain("/api/listing-roast");
      expect(health.headers.get("link")).toContain("/api/marketplace-listing-score");
      expect(health.headers.get("link")).toContain("/api/marketplace-product-listing-quality");
      expect(health.headers.get("link")).toContain("/api/paid-api-listing-quality");
      expect(health.headers.get("link")).toContain("/api/paid-api-listing-quality-score");
      expect(health.headers.get("link")).toContain("/api/listing-quality-score-api");
      expect(health.headers.get("link")).toContain("/api/x402-listing-quality");
      expect(health.headers.get("link")).toContain("/api/buyer-agent-skip-reasons");
      expect(health.headers.get("link")).toContain("/api/agent-service-clarity");
      expect(health.headers.get("link")).toContain("GET $0.001 paid API listing quality");
      expect(health.headers.get("link")).toContain("GET $0.001 paid API listing quality score");
      expect(health.headers.get("link")).toContain("GET $0.001 x402 listing quality");
      expect(health.headers.get("link")).toContain("/api/pay-now");
      expect(health.headers.get("link")).toContain("/api/commands");
      expect(health.headers.get("link")).toContain("/api/proof");
      expect(health.headers.get("link")).toContain("/proof");
      expect(health.headers.get("link")).toContain("/api/pricing");
      expect(health.headers.get("link")).toContain("/api/find");
      expect(health.headers.get("link")).toContain("/api/route");
      expect(health.headers.get("link")).toContain("/api/sample");
      expect(health.headers.get("link")).toContain("/openapi.json");
      expect(health.headers.get("link")).toContain("/.well-known/openapi.json");
      expect(health.headers.get("link")).toContain("/schema.json");
      expect(health.headers.get("link")).toContain("/.well-known/agent-card.json");
      expect(health.headers.get("link")).toContain("/api/x402.json");
      expect(health.headers.get("link")).toContain("/api/agent-card");
      expect(health.headers.get("link")).toContain("/api/agent.json");
      expect(health.headers.get("link")).toContain("/.well-known/ai-plugin.json");
      expect(health.headers.get("link")).toContain("/.well-known/api-catalog");
      expect(health.headers.get("link")).toContain("/.well-known/api-catalog.json");
      expect(health.headers.get("link")).toContain("/.well-known/agent-tools.json");
      expect(health.headers.get("link")).toContain("/.well-known/agent-skills/index.json");
      expect(health.headers.get("link")).toContain("/.well-known/llms.txt");
      expect(health.headers.get("link")).toContain("/llms-full.txt");
      expect(health.headers.get("link")).toContain("/.well-known/llms-full.txt");
      expect(health.headers.get("link")).toContain("/icon.svg");
      expect(health.headers.get("link")).toContain("/index.md");
      expect(health.headers.get("link")).toContain("/auth.md");
      expect(health.headers.get("link")).toContain("/.well-known/auth.md");
      expect(health.headers.get("link")).toContain("/.well-known/mcp");
      expect(health.headers.get("link")).toContain("/.well-known/mcp-server");
      expect(health.headers.get("link")).toContain("/.well-known/mcp-server.json");
      expect(health.headers.get("link")).toContain("/mcp");
      expect(health.headers.get("link")).toContain("/.well-known/mcp/server-card.json");

      const home = await fetchJson(server, "/");
      expect(home.status).toBe(200);
      expect(home.headers.get("link")).toContain("/.well-known/x402.json");
      expect(home.text).toContain("AgentCore x402 payments readiness");
      expect(home.text).toContain("x402:first-paid-action");
      expect(home.text).toContain("GET /api/listing-roast; price $0.001; max 1000 USDC units");
      expect(home.text).toContain("First paid action: $0.001 GET <code>/api/listing-roast</code>, max 1000 USDC units.");
      expect(home.text).toContain("first step for marketplace listing quality, marketplace listing conversion API, marketplace listing conversion, marketplace product listing quality, listing quality score API, paid API listing quality, paid API listing quality score, AgentCore x402 payments, Coinbase x402 Bazaar MCP server buyers");
      expect(home.text).toContain("x402 marketplace conversion score, agent listing conversion score, structured JSON critique");
      expect(home.text).toContain("Recommended paid sequence");
      expect(home.text).toContain("GET /api/listing-roast");
      expect(home.text).toContain("POST /api/listing-roast");
      expect(home.text).toContain("safe defaults when stale directory cards omit the body");
      expect(home.text).toContain("Copy $0.001 indexed GET command");
      expect(home.text).toContain("Copy agent-listing command");
      expect(home.text).toContain("Agent listing conversion command");
      expect(home.text).toContain("/api/agent-listing-conversion");
      expect(home.text).toContain("Marketplace listing conversion command");
      expect(home.text).toContain("/api/marketplace-listing-conversion-api");
      expect(home.text).toContain("Copy instant score command");
      expect(home.text).toContain("Preferred indexed listing-roast GET command");
      expect(home.text).toContain("Copy x402 ping command");
      expect(home.text).toContain("Copy $0.001 site audit command");
      expect(home.text).toContain("Copy $0.001 discovery audit command");
      expect(home.text).toContain("Copy full audit command");
      expect(home.text).toContain("Copy $0.005 score command");
      expect(home.text).toContain("Copy $0.01 roast command");
      expect(home.text).toContain("Copy exact quality-score command");
      expect(home.text).toContain("Exact paid API listing quality score command");
      expect(home.text).toContain("/api/paid-api-listing-quality-score");
      expect(home.text).toContain("Exact listing quality score API command");
      expect(home.text).toContain("/api/listing-quality-score-api");
      expect(home.text).toContain("Exact x402 listing quality command");
      expect(home.text).toContain("/api/x402-listing-quality");
      expect(home.text).toContain("Exact marketplace product listing quality command");
      expect(home.text).toContain("/api/marketplace-product-listing-quality");
      expect(home.text).toContain("Preview paid output JSON");
      expect(home.text).toContain("/api/pay-now?intent=marketplace%20listing%20score");
      expect(home.text).toContain("Open compact command JSON");
      expect(home.text).toContain("/api/commands?intent=paid%20API%20listing%20quality");
      expect(home.text).toContain("Build your command");
      expect(home.text).toContain("View sample score");
      expect(home.text).toContain("Open examples JSON");
      expect(home.text).toContain("application/ld+json");
      expect(home.text).toContain("Listing Roast x402 paid routes");
      expect(home.text).toContain("/icon.svg");
      expect(home.text).toContain("/.well-known/llms.txt");
      expect(home.text).toContain("/.well-known/llms-full.txt");
      const structuredDataMatch = home.text.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
      expect(structuredDataMatch).toBeTruthy();
      const structuredData = JSON.parse(structuredDataMatch[1]);
      expect(structuredData.offers).toMatchObject({
        name: "Preferred first paid action: GET /api/listing-roast",
        price: "0.001",
        priceCurrency: "USD",
        url: "http://localhost:8787/api/listing-roast"
      });
      expect(structuredData.hasOfferCatalog.itemListElement[0].name).toBe("Indexed listing-roast quick score");
      expect(structuredData.hasOfferCatalog.itemListElement[0].url).toBe("http://localhost:8787/api/listing-roast");
      const structuredOffers = structuredData.hasOfferCatalog.itemListElement;
      expect(structuredOffers.find((offer) => offer.name === "x402 discovery audit quick check").price).toBe("0.001");
      expect(structuredOffers.find((offer) => offer.name === "Full x402 discovery audit").price).toBe("0.01");
      expect(structuredOffers.find((offer) => offer.name === "Direct full listing roast")).toMatchObject({
        price: "0.01",
        url: "http://localhost:8787/api/full-listing-roast"
      });
      expect(structuredOffers.find((offer) => offer.name === "Custom-body listing conversion roast")).toMatchObject({
        price: "0.01",
        url: "http://localhost:8787/api/listing-roast"
      });
      expect(home.text).toContain("/llms-full.txt");
      expect(home.text).toContain("/auth.md");
      expect(home.text).toContain("/.well-known/mcp/server-card.json");
      expect(home.text).toContain("navigator.modelContext");
      expect(home.text).toContain("registerTool");
      expect(home.text).toContain("listing_roast_x402_handoff");
      expect(home.text).toContain("readOnlyHint");
      expect(home.text).toContain("This tool never calls a paid endpoint");
      expect(home.text).toContain("Do not call paid routes unless the buyer explicitly intends to pay USDC");
      expect(home.text).toContain("/paid-api-listing-quality");
      expect(home.text).toContain("/paid-api-listing-quality-score");
      expect(home.text).toContain("/listing-quality-score-api");
      expect(home.text).toContain("/marketplace-product-listing-quality");
      expect(home.text).toContain("/x402-listing-quality");
      expect(home.text).toContain("/buyer-agent-skip-reasons");
      expect(home.text).toContain("/agent-service-clarity");
      expect(home.text).toContain("/agent-listing-conversion");
      expect(home.text).toContain("/x402-discovery-audit");
      expect(home.text).toContain("/x402-site-audit");
      expect(home.text).toContain("/x402-buyer-prepay-risk-score");
      expect(home.text).toContain("/score-x402-endpoint-before-paying");
      expect(home.text).toContain("/x402-route-health-check");
      expect(home.text).toContain("/x402-listing-rank-doctor");
      expect(home.text).toContain("/agentcore-x402-payments");
      expect(home.text).toContain("/coinbase-x402-bazaar-mcp-server");
      expect(home.text).toContain("/full-listing-roast");
      expect(home.text).toContain("/api/preflight");
      expect(home.text).toContain("/api/v1/preflight");
      expect(home.text).toContain("/preflight");

      const paidApiListingQuality = await fetchJson(server, "/paid-api-listing-quality");
      expect(paidApiListingQuality.status).toBe(200);
      expect(paidApiListingQuality.text).toContain("Paid API listing quality score for x402 services");
      expect(paidApiListingQuality.text).toContain("/api/listing-roast");
      expect(paidApiListingQuality.text).toContain("/api/paid-usage-proof");
      expect(paidApiListingQuality.text).toContain("--max-amount 1000");
      expect(paidApiListingQuality.text).toContain("This page does not call a paid route");

      const paidApiListingQualityScore = await fetchJson(server, "/paid-api-listing-quality-score");
      expect(paidApiListingQualityScore.status).toBe(200);
      expect(paidApiListingQualityScore.text).toContain("Exact paid API listing quality score route for buyer agents");
      expect(paidApiListingQualityScore.text).toContain("/api/paid-api-listing-quality-score");
      expect(paidApiListingQualityScore.text).toContain("/api/listing-roast");
      expect(paidApiListingQualityScore.text).toContain("/api/paid-usage-proof");
      expect(paidApiListingQualityScore.text).toContain("This page does not call a paid route");

      const agentCoreX402Payments = await fetchJson(server, "/agentcore-x402-payments");
      expect(agentCoreX402Payments.status).toBe(200);
      expect(agentCoreX402Payments.text).toContain("AgentCore x402 payments route for paid API listing quality");
      expect(agentCoreX402Payments.text).toContain("AgentCore Gateway");
      expect(agentCoreX402Payments.text).toContain("Coinbase x402 Bazaar MCP server");
      expect(agentCoreX402Payments.text).toContain("search_resources");
      expect(agentCoreX402Payments.text).toContain("proxy_tool_call");
      expect(agentCoreX402Payments.text).toContain("https://api.cdp.coinbase.com/platform/v2/x402/discovery/mcp");
      expect(agentCoreX402Payments.text).toContain("No Authorization");
      expect(agentCoreX402Payments.text).toContain("/api/listing-roast");
      expect(agentCoreX402Payments.text).toContain("/api/full-listing-roast");
      expect(agentCoreX402Payments.text).toContain("/x402.json");
      expect(agentCoreX402Payments.text).toContain("/openapi.json");
      expect(agentCoreX402Payments.text).toContain("This page does not call a paid route");

      const coinbaseX402BazaarMcpServer = await fetchJson(server, "/coinbase-x402-bazaar-mcp-server");
      expect(coinbaseX402BazaarMcpServer.status).toBe(200);
      expect(coinbaseX402BazaarMcpServer.text).toContain("Coinbase x402 Bazaar MCP server route for paid API listing quality");
      expect(coinbaseX402BazaarMcpServer.text).toContain("AgentCore Gateway");
      expect(coinbaseX402BazaarMcpServer.text).toContain("search_resources");
      expect(coinbaseX402BazaarMcpServer.text).toContain("proxy_tool_call");
      expect(coinbaseX402BazaarMcpServer.text).toContain("https://api.cdp.coinbase.com/platform/v2/x402/discovery/mcp");
      expect(coinbaseX402BazaarMcpServer.text).toContain("No Authorization");
      expect(coinbaseX402BazaarMcpServer.text).toContain("/api/coinbase-x402-bazaar-mcp-server");
      expect(coinbaseX402BazaarMcpServer.text).toContain("/api/listing-roast");
      expect(coinbaseX402BazaarMcpServer.text).toContain("/api/full-listing-roast");
      expect(coinbaseX402BazaarMcpServer.text).toContain("This page does not call a paid route");

      const fullListingRoast = await fetchJson(server, "/full-listing-roast");
      expect(fullListingRoast.status).toBe(200);
      expect(fullListingRoast.text).toContain("Full listing roast for paid API sellers");
      expect(fullListingRoast.text).toContain("/api/full-listing-roast");
      expect(fullListingRoast.text).toContain("/api/listing-roast");
      expect(fullListingRoast.text).toContain("/api/paid-usage-proof");
      expect(fullListingRoast.text).toContain("--max-amount 10000");
      expect(fullListingRoast.text).toContain("This page does not call a paid route");

      const x402BuyerPrepayRiskScore = await fetchJson(server, "/x402-buyer-prepay-risk-score");
      expect(x402BuyerPrepayRiskScore.status).toBe(200);
      expect(x402BuyerPrepayRiskScore.text).toContain("x402 buyer prepay risk score before paying more");
      expect(x402BuyerPrepayRiskScore.text).toContain("/api/x402-buyer-prepay-risk-score");
      expect(x402BuyerPrepayRiskScore.text).toContain("/api/x402-discovery-audit");
      expect(x402BuyerPrepayRiskScore.text).toContain("This page does not call a paid route");

      const scoreX402EndpointBeforePaying = await fetchJson(server, "/score-x402-endpoint-before-paying");
      expect(scoreX402EndpointBeforePaying.status).toBe(200);
      expect(scoreX402EndpointBeforePaying.text).toContain("Score an x402 endpoint before paying");
      expect(scoreX402EndpointBeforePaying.text).toContain("/api/score-x402-endpoint-before-paying");
      expect(scoreX402EndpointBeforePaying.text).toContain("/api/x402-discovery-audit");
      expect(scoreX402EndpointBeforePaying.text).toContain("This page does not call a paid route");

      const x402RouteHealthCheck = await fetchJson(server, "/x402-route-health-check");
      expect(x402RouteHealthCheck.status).toBe(200);
      expect(x402RouteHealthCheck.text).toContain("x402 route health check before paying more");
      expect(x402RouteHealthCheck.text).toContain("/api/x402-route-health-check");
      expect(x402RouteHealthCheck.text).toContain("/api/x402-discovery-audit");
      expect(x402RouteHealthCheck.text).toContain("This page does not call a paid route");

      const x402ListingRankDoctor = await fetchJson(server, "/x402-listing-rank-doctor");
      expect(x402ListingRankDoctor.status).toBe(200);
      expect(x402ListingRankDoctor.text).toContain("x402 listing rank doctor for marketplace visibility");
      expect(x402ListingRankDoctor.text).toContain("/api/x402-listing-rank-doctor");
      expect(x402ListingRankDoctor.text).toContain("/api/x402-discovery-audit");
      expect(x402ListingRankDoctor.text).toContain("This page does not call a paid route");

      const listingQualityScoreApi = await fetchJson(server, "/listing-quality-score-api");
      expect(listingQualityScoreApi.status).toBe(200);
      expect(listingQualityScoreApi.text).toContain("Listing quality score API for paid marketplace offers");
      expect(listingQualityScoreApi.text).toContain("/api/listing-quality-score-api");
      expect(listingQualityScoreApi.text).toContain("/api/listing-roast");
      expect(listingQualityScoreApi.text).toContain("/api/paid-usage-proof");
      expect(listingQualityScoreApi.text).toContain("This page does not call a paid route");

      const marketplaceProductListingQuality = await fetchJson(server, "/marketplace-product-listing-quality");
      expect(marketplaceProductListingQuality.status).toBe(200);
      expect(marketplaceProductListingQuality.text).toContain("Marketplace product listing quality score for paid APIs");
      expect(marketplaceProductListingQuality.text).toContain("/api/marketplace-product-listing-quality");
      expect(marketplaceProductListingQuality.text).toContain("/api/listing-roast");
      expect(marketplaceProductListingQuality.text).toContain("/api/paid-usage-proof");
      expect(marketplaceProductListingQuality.text).toContain("This page does not call a paid route");

      const marketplaceListingConversion = await fetchJson(server, "/marketplace-listing-conversion");
      expect(marketplaceListingConversion.status).toBe(200);
      expect(marketplaceListingConversion.text).toContain("Marketplace listing conversion API score for paid APIs");
      expect(marketplaceListingConversion.text).toContain("/api/marketplace-listing-conversion-api");
      expect(marketplaceListingConversion.text).toContain("/api/marketplace-listing-conversion");
      expect(marketplaceListingConversion.text).toContain("/api/listing-roast");
      expect(marketplaceListingConversion.text).toContain("/api/paid-usage-proof");
      expect(marketplaceListingConversion.text).toContain("This page does not call a paid route");

      const marketplaceListingConversionApi = await fetchJson(server, "/marketplace-listing-conversion-api");
      expect(marketplaceListingConversionApi.status).toBe(200);
      expect(marketplaceListingConversionApi.text).toContain("Marketplace listing conversion API score for paid APIs");
      expect(marketplaceListingConversionApi.text).toContain("/api/marketplace-listing-conversion-api");
      expect(marketplaceListingConversionApi.text).toContain("/api/listing-roast");
      expect(marketplaceListingConversionApi.text).toContain("This page does not call a paid route");

      const x402ListingQuality = await fetchJson(server, "/x402-listing-quality");
      expect(x402ListingQuality.status).toBe(200);
      expect(x402ListingQuality.text).toContain("x402 listing quality score for paid APIs");
      expect(x402ListingQuality.text).toContain("/api/x402-listing-quality");
      expect(x402ListingQuality.text).toContain("/api/listing-roast");
      expect(x402ListingQuality.text).toContain("/api/paid-usage-proof");
      expect(x402ListingQuality.text).toContain("This page does not call a paid route");

      const buyerAgentSkipReasons = await fetchJson(server, "/buyer-agent-skip-reasons");
      expect(buyerAgentSkipReasons.status).toBe(200);
      expect(buyerAgentSkipReasons.text).toContain("Buyer-agent skip reasons for paid API listings");
      expect(buyerAgentSkipReasons.text).toContain("/api/buyer-agent-skip-reasons");
      expect(buyerAgentSkipReasons.text).toContain("/api/listing-roast");
      expect(buyerAgentSkipReasons.text).toContain("Start with the proven $0.001 indexed route");
      expect(buyerAgentSkipReasons.text).toContain("/api/pay-now?intent=buyer-agent%20skip%20reasons");
      expect(buyerAgentSkipReasons.text).toContain("/api/commands?intent=buyer-agent%20skip%20reasons");
      expect(buyerAgentSkipReasons.text).toContain("/api/paid-usage-proof");
      expect(buyerAgentSkipReasons.text).toContain("This page does not call a paid route");

      const agentServiceClarity = await fetchJson(server, "/agent-service-clarity");
      expect(agentServiceClarity.status).toBe(200);
      expect(agentServiceClarity.text).toContain("Agent service clarity score for x402 paid APIs");
      expect(agentServiceClarity.text).toContain("/api/agent-service-clarity");
      expect(agentServiceClarity.text).toContain("/api/listing-roast");
      expect(agentServiceClarity.text).toContain("/api/paid-usage-proof");
      expect(agentServiceClarity.text).toContain("/api/agent-listing-conversion");

      const agentListingConversion = await fetchJson(server, "/agent-listing-conversion");
      expect(agentListingConversion.status).toBe(200);
      expect(agentListingConversion.text).toContain("Agent listing conversion score and buyer-agent skip reasons");
      expect(agentListingConversion.text).toContain("/api/agent-listing-conversion");
      expect(agentListingConversion.text).toContain("agent service listing clarity");

      const x402DiscoveryAudit = await fetchJson(server, "/x402-discovery-audit");
      expect(x402DiscoveryAudit.status).toBe(200);
      expect(x402DiscoveryAudit.text).toContain("x402 discovery audit for stale Bazaar visibility");
      expect(x402DiscoveryAudit.text).toContain("/api/x402-discovery-audit");
      expect(x402DiscoveryAudit.text).toContain("Start with the $0.001 GET discovery audit");

      const x402SiteAudit = await fetchJson(server, "/x402-site-audit");
      expect(x402SiteAudit.status).toBe(200);
      expect(x402SiteAudit.text).toContain("x402 site audit and paid API preflight");
      expect(x402SiteAudit.text).toContain("/api/x402-site-audit");
      expect(x402SiteAudit.text).toContain("/api/preflight");
      expect(x402SiteAudit.text).toContain("/api/v1/preflight");
      expect(x402SiteAudit.text).toContain("/preflight");
      expect(x402SiteAudit.text).toContain("x402 route health check");

      const homeMarkdown = await fetchJson(server, "/", {
        headers: { Accept: "text/markdown" }
      });
      expect(homeMarkdown.status).toBe(200);
      expect(homeMarkdown.headers.get("content-type")).toContain("text/markdown");
      expect(homeMarkdown.text).toContain("# Listing Roast x402");
      expect(homeMarkdown.text).toContain("Do not call paid routes unless the buyer explicitly intends to pay");
      expect(homeMarkdown.text).toContain("/api/listing-roast");

      const builder = await fetchJson(server, "/builder");
      expect(builder.status).toBe(200);
      expect(builder.text).toContain("Build a paid score command from your listing.");
      expect(builder.text).toContain("Paid-use proof");
      expect(builder.text).toContain("registered in the public cash register");
      expect(builder.text).toContain("Preferred route that already converted");
      expect(builder.text).toContain("Verify before paying");
      expect(builder.text).toContain("Preferred indexed GET command");
      expect(builder.text).toContain("Copy agent-listing command");
      expect(builder.text).toContain("Copy buyer-skip command");
      expect(builder.text).toContain("Copy discovery-audit command");
      expect(builder.text).toContain("Direct full roast command");
      expect(builder.text).toContain("Copy direct full roast command");
      expect(builder.text).toContain("Custom body fallback");
      expect(builder.text).toContain("Copy custom-body roast command");
      expect(builder.text).toContain("/api/paid-usage-proof");
      expect(builder.text).toContain("/api/cash-register");
      expect(builder.text).toContain("/api/agent-listing-conversion");
      expect(builder.text).toContain("/api/buyer-agent-skip-reasons");
      expect(builder.text).toContain("/api/listing-score");
      expect(builder.text).toContain("/api/x402-ping");
      expect(builder.text).toContain("/api/x402-site-audit");
      expect(builder.text).toContain("/api/x402-discovery-audit");
      expect(builder.text).toContain("x402 pay &#39;http://localhost:8787/api/listing-score&#39;");
      expect(builder.text).toContain("x402 pay &#39;http://localhost:8787/api/full-listing-roast&#39;");
      expect(builder.text).toContain("x402 pay &#39;http://localhost:8787/api/listing-roast&#39;");
      expect(builder.text).toContain('" + shellQuote(url) + " -X POST -d "');
      expect(builder.text).toContain("builderCommandBuilds");

      const sample = await fetchJson(server, "/sample");
      expect(sample.status).toBe(200);
      expect(sample.text).toContain("Sample the score, then start with the $0.001 indexed route.");
      expect(sample.text).toContain("Copy $0.001 indexed GET command");
      expect(sample.text).toContain("Copy $0.001 buyer-skip command");
      expect(sample.text).toContain("Copy $0.001 discovery-audit command");
      expect(sample.text).toContain("Copy $0.01 direct full roast command");
      expect(sample.text).toContain("Indexed GET command");
      expect(sample.text).toContain("Direct full roast command");
      expect(sample.text).toContain("Custom-body full roast command");
      expect(sample.text).toContain("/api/listing-roast");
      expect(sample.text).toContain("/api/full-listing-roast");
      expect(sample.text).toContain("/api/buyer-agent-skip-reasons");
      expect(sample.text).toContain("/api/x402-discovery-audit");
      expect(sample.text).toContain("/api/listing-score");
      expect(sample.text).toContain("Build your command");

      const sampleScore = await fetchJson(server, "/api/sample-score");
      expect(sampleScore.status).toBe(200);
      expectFreshDiscoveryHeaders(sampleScore.headers);
      expect(sampleScore.json.price).toBe("$0.001");
      expect(sampleScore.json.aliases[0]).toContain("/api/sample");
      expect(sampleScore.json.commands).toContain("/api/commands");
      expect(sampleScore.json.payNow).toContain("/api/pay-now");
      expect(sampleScore.json.paidUsageProofUrl).toContain("/api/paid-usage-proof");
      expect(sampleScore.json.paidRoute).toContain("/api/listing-roast");
      expect(sampleScore.json.command).toContain("/api/listing-roast");
      expect(sampleScore.json.command).toContain("--max-amount 1000");
      expect(sampleScore.json.officialCdpDiscovery.indexedRoute).toBe("http://localhost:8787/api/listing-roast");
      expect(sampleScore.json.officialCdpDiscovery.refreshRule).toContain("real settlement");
      expect(sampleScore.json.provenFirstPaidAction.path).toBe("/api/listing-roast");
      expect(sampleScore.json.provenFirstPaidAction.maxAmountRequired).toBe("1000");
      expect(sampleScore.json.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(sampleScore.json.customScoreAction.path).toBe("/api/listing-score");
      expect(sampleScore.json.customScoreAction.maxAmountRequired).toBe("5000");
      expect(sampleScore.json.customScoreOutput.endpoint).toBe("listing-score");
      expect(sampleScore.json.paidUsageProof.preferredConvertedRoute.path).toBe("/api/listing-roast");
      expect(sampleScore.json.exactIntentActions.buyerAgentSkipReasons.path).toBe("/api/buyer-agent-skip-reasons");
      expect(sampleScore.json.exactIntentActions.buyerAgentSkipReasons.maxAmountRequired).toBe("1000");
      expect(sampleScore.json.exactIntentActions.marketplaceListingConversion.path).toBe("/api/marketplace-listing-conversion-api");
      expect(sampleScore.json.exactIntentActions.marketplaceListingConversion.maxAmountRequired).toBe("1000");
      expect(sampleScore.json.exactIntentActions.discoveryAuditQuick.path).toBe("/api/x402-discovery-audit");
      expect(sampleScore.json.exactIntentActions.discoveryAuditQuick.maxAmountRequired).toBe("1000");
      expect(sampleScore.json.firstPaidOutput.endpoint).toBe("listing-roast-quick-score");
      expect(sampleScore.json.firstPaidOutput.nextPaidActions.find((action) => action.path === "/api/x402-discovery-audit").maxAmountRequired).toBe("1000");
      expect(sampleScore.json.firstPaidOutput.nextPaidActions.find((action) => action.path === "/api/full-listing-roast").agentPaymentPrompt).toContain("pay up to 0.01 USDC");
      expect(sampleScore.json.output.endpoint).toBe("listing-score");
      expect(sampleScore.json.output.upgradeEndpoint).toBe("/api/full-listing-roast");
      expect(sampleScore.json.output.nextPaidAction.maxAmountRequired).toBe("10000");
      expect(sampleScore.json.output.nextPaidAction.path).toBe("/api/full-listing-roast");
      expect(sampleScore.json.output.nextPaidAction.method).toBe("GET");
      expect(sampleScore.json.output.nextPaidAction.route).toContain("/api/full-listing-roast");
      expect(sampleScore.json.output.nextPaidAction.command).toContain("/api/full-listing-roast?");
      expect(sampleScore.json.output.nextPaidAction.command).toContain("--max-amount 10000");
      expect(sampleScore.json.output.nextPaidAction.agentPaymentPrompt).toContain("pay up to 0.01 USDC");
      expect(sampleScore.json.output.nextPaidAction.query.source).toBe("listing-score-upgrade");
      expect(sampleScore.json.output.nextPaidAction.body).toBeUndefined();

      const sampleAlias = await fetchJson(server, "/api/sample");
      expect(sampleAlias.status).toBe(200);
      expect(sampleAlias.json.commands).toContain("/api/commands");
      expect(sampleAlias.json.payNow).toContain("/api/pay-now");
      expect(sampleAlias.json.paidRoute).toContain("/api/listing-roast");
      expect(sampleAlias.json.command).toContain("--max-amount 1000");

      const schema = await fetchJson(server, "/api/schema");
      expect(schema.status).toBe(200);
      expect(schema.json.commands).toContain("/api/commands");
      expect(schema.json.service.price).toBe("$0.01");

      const rootSchemaAlias = await fetchJson(server, "/schema.json");
      expect(rootSchemaAlias.status).toBe(200);
      expect(rootSchemaAlias.json.commands).toContain("/api/commands");
      expect(rootSchemaAlias.json.payNow).toContain("/api/pay-now");
      expect(rootSchemaAlias.json.service.price).toBe("$0.01");

      const scoreSchema = await fetchJson(server, "/api/score-schema");
      expect(scoreSchema.status).toBe(200);
      expect(scoreSchema.json.service.price).toBe("$0.005");

      const discoveryAuditSchema = await fetchJson(server, "/api/discovery-audit-schema");
      expect(discoveryAuditSchema.status).toBe(200);
      expect(discoveryAuditSchema.json.inputSchema.anyOf).toEqual(expect.arrayContaining([
        { required: ["endpointUrl"] },
        { required: ["url"] },
        { required: ["base_url"] },
        { required: ["baseUrl"] }
      ]));
      expect(discoveryAuditSchema.json.inputSchema.properties.url.description).toContain("Alias for endpointUrl");
      expect(discoveryAuditSchema.json.inputSchema.properties.base_url.description).toContain("Alias for endpointUrl");
      expect(discoveryAuditSchema.json.inputSchema.properties.agent402Query.description).toContain("Agent402");

      const mcp = await fetchJson(server, "/.well-known/mcp.json");
      expect(mcp.status).toBe(200);
      expect(mcp.json.service).toBe("Listing Roast x402");
      expect(mcp.json.serviceName).toBe("Listing Roast x402");
      expect(mcp.json.metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(mcp.json.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(mcp.json.metadataUpdatedAt).toBe("2026-06-21T03:14:35.000Z");
      expect(mcp.json.metadata_updated_at).toBe("2026-06-21T03:14:35.000Z");
      expect(mcp.json.builder).toContain("/builder");
      expect(mcp.json.iconUrl).toContain("/icon.svg");
      expect(mcp.json.openApi).toContain("/openapi.json");
      expect(mcp.json.openApiAliases[0]).toContain("/.well-known/openapi.json");
      expect(mcp.json.openApiAliases).toContain("http://localhost:8787/api/openapi.json");
      expect(mcp.json.openApiAliases).toContain("http://localhost:8787/api-docs/openapi.json");
      expect(mcp.json.openApiAliases).toContain("http://localhost:8787/api/v1/openapi.json");
      expect(mcp.json.openApiYamlAliases).toContain("http://localhost:8787/.well-known/openapi.yaml");
      expect(mcp.json.schemaAliases).toContain("http://localhost:8787/schema.json");
      expect(mcp.json.llms).toContain("/llms.txt");
      expect(mcp.json.llmsAliases[0]).toContain("/.well-known/llms.txt");
      expect(mcp.json.x402Manifest).toContain("/x402.json");
      expect(mcp.json.agentCard).toContain("/.well-known/agent-card.json");
      expect(mcp.json.agentCardAliases[0]).toContain("/.well-known/agent.json");
      expect(mcp.json.aiPlugin).toContain("/.well-known/ai-plugin.json");
      expect(mcp.json.apiCatalog).toContain("/.well-known/api-catalog");
      expect(mcp.json.apiCatalogAliases).toContain("http://localhost:8787/.well-known/api-catalog.json");
      expect(mcp.json.agentTools).toContain("/.well-known/agent-tools.json");
      expect(mcp.json.agentSkills).toContain("/.well-known/agent-skills/index.json");
      expect(mcp.json.agentSkill).toContain("/.well-known/agent-skills/listing-roast-x402/SKILL.md");
      expect(mcp.json.llmsFull).toContain("/llms-full.txt");
      expect(mcp.json.llmsFullAliases[0]).toContain("/.well-known/llms-full.txt");
      expect(mcp.json.markdown).toContain("/index.md");
      expect(mcp.json.mcpAliases[0]).toContain("/.well-known/mcp");
      expect(mcp.json.mcpAliases).toContain("http://localhost:8787/.well-known/mcp-server.json");
      expect(mcp.json.mcpAliases).toContain("http://localhost:8787/mcp");
      expect(mcp.json.mcpAliases).toContain("http://localhost:8787/mcp.json");
      expect(mcp.json.mcpServerCard).toContain("/.well-known/mcp/server-card.json");
      expect(mcp.json.mcpServerCardAliases).toContain("http://localhost:8787/mcp/server-card.json");
      expect(mcp.json.payNow).toContain("/api/pay-now");
      expect(mcp.json.commands).toContain("/api/commands");
      expect(mcp.json.payNowExamples.skipReasons.selectedActionKey).toBe("buyerAgentSkipReasons");
      expect(mcp.json.payNowExamples.skipReasons.route).toContain("/api/listing-roast");
      expect(mcp.json.payNowExamples.skipReasons.selectedFirstPaidAction.path).toBe("/api/listing-roast");
      expect(mcp.json.payNowExamples.skipReasons.paidResponsePreview.route).toBe("/api/listing-roast");
      expect(mcp.json.payNowExamples.skipReasons.selectedFirstPaidResponsePreview.route).toBe("/api/listing-roast");
      expect(mcp.json.payNowExamples.discoveryAudit.selectedActionKey).toBe("discoveryAuditQuick");
      expect(mcp.json.payNowExamples.discoveryAudit.paidResponsePreview.example.endpoint).toBe("x402-discovery-audit-quick");
      expect(mcp.json.payNowExamples.discoveryAudit.selectedPaidSequence[0].use).toBe("discoveryAuditQuick");
      expect(mcp.json.payNowExamples.discoveryAudit.selectedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(mcp.json.payNowExamples.discoveryAudit.selectedPaidSequence[1].use).toBe("discoveryAudit");
      expect(mcp.json.payNowExamples.fullRoast.maxAmountRequired).toBe("10000");
      expect(mcp.json.cashRegister).toContain("/api/cash-register");
      expect(mcp.json.paidUsageProof.paidCompletions).toBe(0);
      expect(mcp.json.paidUsageProof.estimatedGrossRevenueUsd).toBe("0.00");
      expect(mcp.json.paidUsageProof.noSpend).toBe(true);
      expect(mcp.json.officialCdpDiscovery.indexedRoute).toBe("http://localhost:8787/api/listing-roast");
      expect(mcp.json.payment.officialCdpDiscovery.recommendedSearchUrl).toContain("maxUsdPrice=0.001");
      expect(mcp.json.settlementProof.evidenceFields).toContain("receiverWallet.usdcBalance");
      expect(mcp.json.pricing).toContain("/api/pricing");
      expect(mcp.json.find).toContain("/api/find");
      expect(mcp.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(mcp.json.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(mcp.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(mcp.json.recommendedPaidSequence[1].use).toBe("fullRoastGet");
      expect(mcp.json.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(mcp.json.payment.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(mcp.json.payment.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(mcp.json.payment.commands).toContain("/api/commands");
      expect(mcp.json.payment.payNowExamples.discoveryAudit.route).toContain("/api/x402-discovery-audit");
      expect(mcp.json.payment.settlementProof.cashRegister).toContain("/api/cash-register");
      expect(mcp.json.payment.paidUsageProof.cashRegister).toContain("/api/cash-register");
      expect(mcp.json.keywords).toContain("marketplace listing score");
      expect(mcp.json.preflightAliases).toContain("http://localhost:8787/api/preflight");
      expect(mcp.json.preflightAliases).toContain("http://localhost:8787/api/v1/preflight");
      expect(mcp.json.preflightAliases).toContain("http://localhost:8787/preflight");
      expect(mcp.json.tools[0].description).toContain("marketplace listing score");
      expect(mcp.json.tools[0].command).toContain("/api/listing-roast");
      expect(mcp.json.tools[0].command).toContain("--max-amount 1000");
      expect(mcp.json.tools[1].command).toContain("/api");
      expect(mcp.json.tools[1].command).toContain("--max-amount 1000");
      expect(mcp.json.tools[2].command).toContain("/api/v1");
      expect(mcp.json.tools[2].command).toContain("--max-amount 1000");
      expect(mcp.json.tools[3].command).toContain("/v1");
      expect(mcp.json.tools[3].command).toContain("--max-amount 1000");
      expect(mcp.json.tools[6].command).toContain("/api/agent-listing-conversion");
      expect(mcp.json.tools[6].command).toContain("--max-amount 1000");
      expect(mcp.json.tools[9].command).toContain("/api/agent402-route-visibility");
      expect(mcp.json.tools[9].command).toContain("--max-amount 1000");
      expect(mcp.json.tools[10].command).toContain("/api/x402-discovery-audit");
      expect(mcp.json.tools[10].command).toContain("--max-amount 1000");
      expect(mcp.json.tools[11].command).toContain("/api/x402-discovery-audit");
      expect(mcp.json.tools[11].command).toContain("--max-amount 10000");
      expect(mcp.json.tools[0].payment.maxAmountRequired).toBe("1000");
      expect(mcp.json.tools[0].payment.preferredFirstPaidAction).toBe(true);
      expect(mcp.json.tools[1].payment.maxAmountRequired).toBe("1000");
      expect(mcp.json.tools[1].payment.preferredFirstPaidAction).toBe(false);
      expect(mcp.json.tools.map((tool) => tool.path)).toEqual(["/api/listing-roast", "/api", "/api/v1", "/v1", "/api/instant-listing-score", "/api/x402-marketplace-conversion", "/api/agent-listing-conversion-score", "/api/x402-ping", "/api/x402-site-audit", "/api/agent402-route-visibility", "/api/x402-discovery-audit", "/api/x402-discovery-audit", "/api/listing-score", "/api/listing-roast"]);

      const mcpAlias = await fetchJson(server, "/.well-known/mcp");
      expect(mcpAlias.status).toBe(200);
      expect(mcpAlias.json.tools[0].path).toBe("/api/listing-roast");

      const mcpServerAlias = await fetchJson(server, "/.well-known/mcp-server");
      expect(mcpServerAlias.status).toBe(200);
      expect(mcpServerAlias.json.payNow).toContain("/api/pay-now");

      const mcpServerJsonAlias = await fetchJson(server, "/.well-known/mcp-server.json");
      expect(mcpServerJsonAlias.status).toBe(200);
      expect(mcpServerJsonAlias.json.payNow).toContain("/api/pay-now");

      const mcpRootAlias = await fetchJson(server, "/mcp");
      expect(mcpRootAlias.status).toBe(200);
      expect(mcpRootAlias.json.commands).toContain("/api/commands");
      expect(mcpRootAlias.json.mcpJsonRpcEndpoint).toContain("/mcp");
      expect(mcpRootAlias.json.mcpJsonRpcMethods).toContain("tools/call");
      expect(mcpRootAlias.json.mcpJsonRpcMethods).toContain("resources/list");
      expect(mcpRootAlias.json.mcpJsonRpcMethods).toContain("resources/read");
      expect(mcpRootAlias.json.mcpJsonRpcMethods).toContain("prompts/list");
      expect(mcpRootAlias.json.mcpJsonRpcTools).toContain("search_resources");
      expect(mcpRootAlias.json.mcpJsonRpcTools).toContain("proxy_tool_call");
      expect(mcpRootAlias.json.mcpJsonRpcTools).toContain("listing_roast_x402_handoff");
      expect(mcpRootAlias.json.mcpJsonRpcResources).toContain("listing-roast://paid-usage-proof");

      const mcpInitialize = await fetchJson(server, "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
      });
      expect(mcpInitialize.status).toBe(200);
      expect(mcpInitialize.json.jsonrpc).toBe("2.0");
      expect(mcpInitialize.json.id).toBe(1);
      expect(mcpInitialize.json.result.serverInfo.name).toBe("Listing Roast x402");
      expect(mcpInitialize.json.result.serverInfo.version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(mcpInitialize.json.result.capabilities.tools).toEqual({});

      const mcpTools = await fetchJson(server, "/.well-known/mcp.json", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
      });
      expect(mcpTools.status).toBe(200);
      expect(mcpTools.json.result.tools.map((tool) => tool.name)).toEqual([
        "search_resources",
        "proxy_tool_call",
        "listing_roast_x402_handoff",
        "listing_roast_route_search",
        "listing_roast_paid_usage_proof"
      ]);
      expect(mcpTools.json.result.tools.find((tool) => tool.name === "search_resources").description).toContain("Bazaar MCP-compatible");
      expect(mcpTools.json.result.tools.find((tool) => tool.name === "proxy_tool_call").description).toContain("does not execute paid calls");

      const mcpHandoff = await fetchJson(server, "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "listing_roast_x402_handoff",
            arguments: { intent: "buyer-agent skip reasons" }
          }
        })
      });
      expect(mcpHandoff.status).toBe(200);
      expect(mcpHandoff.json.result.isError).toBe(false);
      expect(mcpHandoff.json.result.content[0].text).toContain("--max-amount 1000");
      expect(mcpHandoff.json.result.structuredContent.noSpend).toBe(true);
      expect(mcpHandoff.json.result.structuredContent.selectedActionKey).toBe("buyerAgentSkipReasons");
      expect(mcpHandoff.json.result.structuredContent.selectedFirstPaidAction.path).toBe("/api/listing-roast");
      expect(mcpHandoff.json.result.structuredContent.selectedPaidAction.path).toBe("/api/listing-roast");
      expect(mcpHandoff.json.result.structuredContent.exactIntentPaidAction.path).toBe("/api/buyer-agent-skip-reasons");
      expect(mcpHandoff.json.result.structuredContent.paymentRule).toContain("explicitly intends to pay");

      const mcpSearchResources = await fetchJson(server, "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 31,
          method: "tools/call",
          params: {
            name: "search_resources",
            arguments: { query: "AgentCore x402 payments", limit: 3 }
          }
        })
      });
      expect(mcpSearchResources.status).toBe(200);
      expect(mcpSearchResources.json.result.isError).toBe(false);
      expect(mcpSearchResources.json.result.structuredContent.noSpend).toBe(true);
      expect(mcpSearchResources.json.result.structuredContent.compatibility).toBe("coinbase-bazaar-mcp-search_resources");
      expect(mcpSearchResources.json.result.structuredContent.resources[0].resource).toContain("/api/");
      expect(mcpSearchResources.json.result.structuredContent.paymentRule).toContain("does not spend funds");

      const mcpProxyToolCall = await fetchJson(server, "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 32,
          method: "tools/call",
          params: {
            name: "proxy_tool_call",
            arguments: { toolName: "buyer-agent skip reasons", arguments: { intent: "buyer-agent skip reasons" } }
          }
        })
      });
      expect(mcpProxyToolCall.status).toBe(200);
      expect(mcpProxyToolCall.json.result.isError).toBe(false);
      expect(mcpProxyToolCall.json.result.content[0].text).toContain("No paid request was executed");
      expect(mcpProxyToolCall.json.result.structuredContent.noSpend).toBe(true);
      expect(mcpProxyToolCall.json.result.structuredContent.compatibility).toContain("proxy_tool_call");
      expect(mcpProxyToolCall.json.result.structuredContent.selectedFirstPaidAction.path).toBe("/api/listing-roast");
      expect(mcpProxyToolCall.json.result.structuredContent.paymentRule).toContain("separate explicit x402 HTTP call");

      const mcpProof = await fetchJson(server, "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "listing_roast_paid_usage_proof", arguments: {} }
        })
      });
      expect(mcpProof.status).toBe(200);
      expect(mcpProof.json.result.structuredContent.noSpend).toBe(true);
      expect(mcpProof.json.result.structuredContent.paidUsageProof.noSpend).toBe(true);
      expect(mcpProof.json.result.content[0].text).toContain("Preferred first paid route");

      const mcpResources = await fetchJson(server, "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "resources/list", params: {} })
      });
      expect(mcpResources.status).toBe(200);
      expect(mcpResources.json.result.resources.map((resource) => resource.uri)).toEqual([
        "listing-roast://x402-manifest",
        "listing-roast://paid-usage-proof",
        "listing-roast://commands",
        "listing-roast://route-search"
      ]);

      const mcpResourceRead = await fetchJson(server, "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 6, method: "resources/read", params: { uri: "listing-roast://paid-usage-proof" } })
      });
      expect(mcpResourceRead.status).toBe(200);
      expect(mcpResourceRead.json.result.contents[0].uri).toBe("listing-roast://paid-usage-proof");
      expect(mcpResourceRead.json.result.contents[0].mimeType).toBe("application/json");
      const mcpPaidUsageProofResource = JSON.parse(mcpResourceRead.json.result.contents[0].text);
      expect(mcpPaidUsageProofResource.paidUsageProof.noSpend).toBe(true);
      expect(mcpPaidUsageProofResource.settlementProof.evidenceFields).toContain("receiverWallet.usdcBalance");
      expect(mcpPaidUsageProofResource.cashRegister).toContain("/api/cash-register");

      const mcpPrompts = await fetchJson(server, "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "prompts/list", params: {} })
      });
      expect(mcpPrompts.status).toBe(200);
      expect(mcpPrompts.json.result.prompts).toEqual([]);

      const mcpInitialized = await fetchJson(server, "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })
      });
      expect(mcpInitialized.status).toBe(204);
      expect(mcpInitialized.text).toBe("");
      expect(mcpInitialized.json).toBeNull();

      const mcpServerCard = await fetchJson(server, "/.well-known/mcp/server-card.json");
      expect(mcpServerCard.status).toBe(200);
      expect(mcpServerCard.json.service).toBe("Listing Roast x402");
      expect(mcpServerCard.json.serviceName).toBe("Listing Roast x402");
      expect(mcpServerCard.json.metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(mcpServerCard.json.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(mcpServerCard.json.metadataUpdatedAt).toBe("2026-06-21T03:14:35.000Z");
      expect(mcpServerCard.json.metadata_updated_at).toBe("2026-06-21T03:14:35.000Z");
      expect(mcpServerCard.json.serverInfo.name).toBe("Listing Roast x402");
      expect(mcpServerCard.json.serverInfo.version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(mcpServerCard.json.transport).toBe("http");
      expect(mcpServerCard.json.jsonRpcEndpoint).toContain("/mcp");
      expect(mcpServerCard.json.payment.preferredFirstPaidAction.maxAmountRequired).toBe("1000");
      expect(mcpServerCard.json.payment.commands).toContain("/api/commands");
      expect(mcpServerCard.json.payment.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(mcpServerCard.json.payment.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(mcpServerCard.json.payment.payNowExamples.skipReasons.route).toContain("/api/listing-roast");
      expect(mcpServerCard.json.payment.payNowExamples.skipReasons.selectedFirstPaidAction.path).toBe("/api/listing-roast");
      expect(mcpServerCard.json.payment.payNowExamples.skipReasons.paidResponsePreview.route).toBe("/api/listing-roast");
      expect(mcpServerCard.json.payment.settlementProof.evidenceFields).toContain("paidCompletions");
      expect(mcpServerCard.json.payment.paidUsageProof.paidCompletions).toBe(0);
      expect(mcpServerCard.json.officialCdpDiscovery.indexedRoute).toBe("http://localhost:8787/api/listing-roast");
      expect(mcpServerCard.json.payment.officialCdpDiscovery.refreshRule).toContain("unpaid probes do not refresh");
      expect(mcpServerCard.json.iconUrl).toContain("/icon.svg");
      expect(mcpServerCard.json.links.cashRegister).toContain("/api/cash-register");
      expect(mcpServerCard.json.links.commands).toContain("/api/commands");
      expect(mcpServerCard.json.links.llmsFull).toContain("/llms-full.txt");
      expect(mcpServerCard.json.links.llmsAliases[0]).toContain("/.well-known/llms.txt");
      expect(mcpServerCard.json.links.llmsFullAliases[0]).toContain("/.well-known/llms-full.txt");
      expect(mcpServerCard.json.links.preflightAliases).toContain("http://localhost:8787/api/preflight");

      const x402Manifest = await fetchJson(server, "/x402.json");
      expect(x402Manifest.status).toBe(200);
      expectFreshDiscoveryHeaders(x402Manifest.headers);
      const compressedX402Manifest = await fetch(`http://127.0.0.1:${server.address().port}/x402.json`, {
        headers: { "accept-encoding": "gzip" }
      });
      expect(compressedX402Manifest.status).toBe(200);
      expect(compressedX402Manifest.headers.get("content-encoding")).toBe("gzip");
      expect((await compressedX402Manifest.json()).metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(x402Manifest.json.name).toBe("Listing Roast x402");
      expect(x402Manifest.json.serviceName).toBe("Listing Roast x402");
      expect(x402Manifest.json.displayName).toBe("Listing Roast x402");
      expect(x402Manifest.json.description).toContain("x402 marketplace conversion");
      expect(x402Manifest.json.description).toContain("agent listing conversion score");
      expect(x402Manifest.json.providerUrl).toBe("http://localhost:8787");
      expect(x402Manifest.json.iconUrl).toBe("http://localhost:8787/icon.svg");
      expect(x402Manifest.json.llmsAliases[0]).toContain("/.well-known/llms.txt");
      expect(x402Manifest.json.llmsFullAliases[0]).toContain("/.well-known/llms-full.txt");
      expect(x402Manifest.json.category).toBe("paid-api-listing");
      expect(x402Manifest.json.tags).toContain("marketplace listing score");
      expect(x402Manifest.json.payment.primaryNetwork).toBe("base");
      expect(x402Manifest.json.payment.network).toBe("eip155:84532");
      expect(x402Manifest.json.payment.currency).toBe("USDC");
      expect(x402Manifest.json.payment.asset).toBe("USDC");
      expect(x402Manifest.json.payment.commands).toContain("/api/commands");
      expectBrowserPaymentSupport(x402Manifest.json.browserPayment);
      expectBrowserPaymentSupport(x402Manifest.json.payment.browserPayment);
      expect(x402Manifest.json.payment.x402.primaryNetwork).toBe("base");
      expect(x402Manifest.json.payment.x402.network).toBe("eip155:84532");
      expect(x402Manifest.json.payment.x402.asset).toBe("USDC");
      expectBrowserPaymentSupport(x402Manifest.json.payment.x402.browserPayment);
      expect(x402Manifest.json.capabilities.tools).toBe(PAID_RESOURCE_COUNT);
      expect(x402Manifest.json.baseUrl).toBe("http://localhost:8787");
      expect(x402Manifest.json.keywords).toContain("paid API listing");
      expect(x402Manifest.json.keywords).toContain("x402 bazaar discovery audit");
      expect(x402Manifest.json.openApiAliases[0]).toContain("/.well-known/openapi.json");
      expect(x402Manifest.json.openApiAliases).toContain("http://localhost:8787/api/openapi.json");
      expect(x402Manifest.json.openApiAliases).toContain("http://localhost:8787/api-docs/openapi.json");
      expect(x402Manifest.json.openApiYamlAliases).toContain("http://localhost:8787/.well-known/openapi.yaml");
      expect(x402Manifest.json.agentCard).toContain("/.well-known/agent-card.json");
      expect(x402Manifest.json.agentCardAliases[0]).toContain("/.well-known/agent.json");
      expect(x402Manifest.json.agentCardAliases).toContain("http://localhost:8787/api/agent-card");
      expect(x402Manifest.json.agentCardAliases).toContain("http://localhost:8787/api/agent.json");
      expect(x402Manifest.json.aiPlugin).toContain("/.well-known/ai-plugin.json");
      expect(x402Manifest.json.apiCatalog).toContain("/.well-known/api-catalog");
      expect(x402Manifest.json.agentTools).toContain("/.well-known/agent-tools.json");
      expect(x402Manifest.json.agentSkills).toContain("/.well-known/agent-skills/index.json");
      expect(x402Manifest.json.metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(x402Manifest.json.metadataUpdatedAt).toBe("2026-06-21T03:14:35.000Z");
      expect(x402Manifest.json.sampleAliases).toContain("http://localhost:8787/api/sample");
      expect(x402Manifest.json.schemaAliases).toContain("http://localhost:8787/schema.json");
      expect(x402Manifest.json.apiCatalogAliases).toContain("http://localhost:8787/.well-known/api-catalog.json");
      expect(x402Manifest.json.mcpAliases).toContain("http://localhost:8787/.well-known/mcp-server.json");
      expect(x402Manifest.json.mcpAliases).toContain("http://localhost:8787/mcp");
      expect(x402Manifest.json.mcpAliases).toContain("http://localhost:8787/mcp.json");
      expect(x402Manifest.json.mcpServerCardAliases).toContain("http://localhost:8787/mcp/server-card.json");
      expect(x402Manifest.json.aliases).toContain("http://localhost:8787/.well-known/payments.json");
      expect(x402Manifest.json.commands).toContain("/api/commands");
      expect(x402Manifest.json.compactCommandHandoff.firstPaidAction.path).toBe("/api/listing-roast");
      expect(x402Manifest.json.compactCommandHandoff.exactIntentPaidAction.path).toBe("/api/paid-api-listing-quality");
      expect(x402Manifest.json.compactCommandHandoff.paymentShortcut.upgradeAfterQuickScore.selectedPaidPath).toBe("/api/full-listing-roast");
      expect(x402Manifest.json.resources.find((resource) => resource.path === "/api/listing-roast").description).toContain("why buyer agents skip a paid API");
      expectBrowserPaymentSupport(x402Manifest.json.resources.find((resource) => resource.path === "/api/listing-roast").browserPayment);
      expect(x402Manifest.json.payNow).toContain("/api/pay-now");
      expect(x402Manifest.json.startHere.path).toBe("/api/listing-roast");
      expect(x402Manifest.json.startHere.method).toBe("GET");
      expect(x402Manifest.json.startHere.maxAmountRequired).toBe("1000");
      expect(x402Manifest.json.startHere.buyerInstruction).toContain("start with GET /api/listing-roast");
      expect(x402Manifest.json.startHere.expectedChallenge.status).toBe(402);
      expect(x402Manifest.json.startHere.expectedChallenge.amount).toBe("1000");
      expect(x402Manifest.json.startHere.upgradeAfterFit.path).toBe("/api/full-listing-roast");
      expect(x402Manifest.json.startHere.upgradeAfterFit.method).toBe("GET");
      expect(x402Manifest.json.payNowExamples.skipReasons.selectedActionKey).toBe("buyerAgentSkipReasons");
      expect(x402Manifest.json.payNowExamples.skipReasons.route).toContain("/api/listing-roast");
      expect(x402Manifest.json.payNowExamples.skipReasons.selectedFirstPaidAction.path).toBe("/api/listing-roast");
      expect(x402Manifest.json.payNowExamples.skipReasons.paidResponsePreview.route).toBe("/api/listing-roast");
      expect(x402Manifest.json.payNowExamples.skipReasons.selectedFirstPaidResponsePreview.route).toBe("/api/listing-roast");
      expect(x402Manifest.json.payNowExamples.discoveryAudit.selectedActionKey).toBe("discoveryAuditQuick");
      expect(x402Manifest.json.payNowExamples.discoveryAudit.selectedFirstPaidAction.path).toBe("/api/x402-discovery-audit");
      expect(x402Manifest.json.payNowExamples.discoveryAudit.paidResponsePreview.example.endpoint).toBe("x402-discovery-audit-quick");
      expect(x402Manifest.json.payNowExamples.discoveryAudit.selectedPaidSequence[0].use).toBe("discoveryAuditQuick");
      expect(x402Manifest.json.payNowExamples.discoveryAudit.buyerInstruction).toContain("/api/x402-discovery-audit");
      expect(x402Manifest.json.payNowExamples.fullRoast.maxAmountRequired).toBe("10000");
      expect(x402Manifest.json.payNowExamples.fullRoast.selectedActionKey).toBe("fullRoastGet");
      expect(x402Manifest.json.payNowExamples.fullRoast.selectedFirstPaidAction.path).toBe("/api/full-listing-roast");
      expect(x402Manifest.json.resources.find((resource) => resource.id === "full_listing_roast_get").maxAmountRequired).toBe("10000");
      expect(x402Manifest.json.cashRegister).toContain("/api/cash-register");
      expect(x402Manifest.json.paidUsageProof.paidCompletions).toBe(0);
      expect(x402Manifest.json.paidUsageProof.estimatedGrossRevenueUsd).toBe("0.00");
      expect(x402Manifest.json.paidUsageProof.cashRegister).toContain("/api/cash-register");
      expect(x402Manifest.json.paidUsageProof.walletEvidenceFields).toContain("receiverWallet.usdcUnits");
      expect(x402Manifest.json.paidUsageProof.noSpend).toBe(true);
      expect(x402Manifest.json.officialCdpDiscovery.indexedRoute).toBe("http://localhost:8787/api/listing-roast");
      expect(x402Manifest.json.officialCdpDiscovery.recommendedSearchQuery).toBe("marketplace listing score");
      expect(x402Manifest.json.officialCdpDiscovery.recommendedMaxUsdPrice).toBe("0.001");
      expect(x402Manifest.json.officialCdpDiscovery.alternateSearchQueries).toContain("paid api listing quality");
      expect(x402Manifest.json.officialCdpDiscovery.alternateSearchQueries).toContain("buyer-agent skip reasons");
      expect(x402Manifest.json.officialCdpDiscovery.alternateSearchQueries).toContain("AgentCore x402 payments");
      expect(x402Manifest.json.officialCdpDiscovery.alternateSearchQueries).toContain("Coinbase x402 Bazaar MCP server");
      expect(x402Manifest.json.officialCdpDiscovery.knownWorkingSearchQueries.map((entry) => entry.query)).toContain("paid api listing quality");
      expect(x402Manifest.json.officialCdpDiscovery.knownWorkingSearchQueries.find((entry) => entry.query === "listing roast").maxUsdPrice).toBe("0.01");
      expect(x402Manifest.json.officialCdpDiscovery.knownWorkingSearchQueries.find((entry) => entry.query === "listing roast").searchUrl).toContain("maxUsdPrice=0.01");
      expect(x402Manifest.json.officialCdpDiscovery.notYetRankingSearchQueries.map((entry) => entry.query)).toContain("buyer-agent skip reasons");
      expect(x402Manifest.json.officialCdpDiscovery.notYetRankingSearchQueries.find((entry) => entry.query === "buyer-agent skip reasons").currentPublicSearchState).toContain("/api/pay-now");
      expect(x402Manifest.json.officialCdpDiscovery.searchRealityRule).toContain("maxUsdPrice=0.001");
      expect(x402Manifest.json.officialCdpDiscovery.cheapCapSearchStrategy.rule).toContain("Broader 0.005/0.01 caps");
      expect(x402Manifest.json.officialCdpDiscovery.cheapCapSearchStrategy.directRoute).toBe("http://localhost:8787/api/listing-roast");
      expect(x402Manifest.json.officialCdpDiscovery.cheapCapSearchStrategy.directRouteMaxAmountRequired).toBe("1000");
      expect(x402Manifest.json.officialCdpDiscovery.fullRoastDirectHandoff.publicCdpSearchState).toContain("/api/listing-roast");
      expect(x402Manifest.json.officialCdpDiscovery.fullRoastDirectHandoff.directRoute).toBe("http://localhost:8787/api/full-listing-roast");
      expect(x402Manifest.json.officialCdpDiscovery.fullRoastDirectHandoff.directRouteMaxAmountRequired).toBe("10000");
      expect(x402Manifest.json.officialCdpDiscovery.fullRoastDirectHandoff.directPayNow).toContain("full%20roast%20rewrite%20top%20fixes");
      expect(x402Manifest.json.officialCdpDiscovery.competitiveCapRisks.find((entry) => entry.query === "marketplace listing score").riskAtMaxUsdPrice).toContain("0.01");
      const publicCdpSearchAudit = x402Manifest.json.officialCdpDiscovery.publicCdpSearchAudit;
      expect(publicCdpSearchAudit.indexedMerchantResources).toBe(1);
      expect(publicCdpSearchAudit.indexedResource).toBe("http://localhost:8787/api/listing-roast");
      expect(publicCdpSearchAudit.publicCardObservedServiceName).toBeNull();
      expect(publicCdpSearchAudit.liveChallengeServiceName).toBe("Listing Roast x402 Paid API Listing Quality Score");
      expect(publicCdpSearchAudit.rankedFirstQueries.map((entry) => entry.query)).toContain("full listing roast");
      expect(publicCdpSearchAudit.missingOrCompetedQueries.map((entry) => entry.query)).toContain("score x402 endpoint before paying");
      expect(publicCdpSearchAudit.missingOrCompetedQueries.map((entry) => entry.query)).toContain("paid API preflight");
      expect(publicCdpSearchAudit.missingOrCompetedQueries.find((entry) => entry.query === "paid API preflight").firstPaidRoute).toContain("/api/x402-site-audit");
      expect(publicCdpSearchAudit.catalogRefreshRule).toContain("real settled payments");
      expect(x402Manifest.json.officialCdpDiscovery.priceFilterReason).toContain("maxUsdPrice=0.001");
      expect(x402Manifest.json.officialCdpDiscovery.recommendedSearchUrl).toContain("/search?query=marketplace+listing+score");
      expect(x402Manifest.json.officialCdpDiscovery.domainRestrictedSearchUrl).toContain("urlSubstring=localhost");
      expect(x402Manifest.json.officialCdpDiscovery.domainRestrictedRecommendedSearchUrl).toContain("query=marketplace+listing+score");
      expect(x402Manifest.json.officialCdpDiscovery.domainRestrictedRecommendedSearchUrl).toContain("urlSubstring=localhost");
      expect(x402Manifest.json.officialCdpDiscovery.domainRestrictedUrlSubstring).toBe("localhost");
      expect(x402Manifest.json.officialCdpDiscovery.domainRestrictedSearchReason).toContain("broad CDP search is stale or noisy");
      expect(x402Manifest.json.officialCdpDiscovery.merchantDiscoveryUrl).toContain("/merchant?payTo=0x000000000000000000000000000000000000dEaD");
      expect(x402Manifest.json.officialCdpDiscovery.merchantDiscoveryStaleMetadataNote).toContain("cached Bazaar extension fields");
      expect(x402Manifest.json.settlementProof.evidenceFields).toContain("receiverWallet.usdcUnits");
      expect(x402Manifest.json.pricing).toContain("/api/pricing");
      expect(x402Manifest.json.find).toContain("/api/find");
      expect(x402Manifest.json.route).toContain("/api/route");
      expect(x402Manifest.json.localDiscovery.resources).toContain("/v2/x402/discovery/resources");
      expect(x402Manifest.json.localDiscovery.search).toContain("/v2/x402/discovery/search");
      expect(x402Manifest.json.localDiscovery.merchant).toContain("/v2/x402/discovery/merchant");
      expect(x402Manifest.json.localDiscovery.searchExamples.find((example) => example.query === "paid API listing quality").expectedFirstPath).toBe("/api/listing-roast");
      expect(x402Manifest.json.localDiscovery.searchExamples.find((example) => example.query === "paid API listing quality").exactIntentPath).toBe("/api/paid-api-listing-quality");
      expect(x402Manifest.json.localDiscovery.searchExamples.find((example) => example.query === "buyer-agent skip reasons").expectedFirstPath).toBe("/api/listing-roast");
      expect(x402Manifest.json.localDiscovery.searchExamples.find((example) => example.query === "buyer-agent skip reasons").exactIntentPath).toBe("/api/buyer-agent-skip-reasons");
      expect(x402Manifest.json.localDiscovery.searchExamples.find((example) => example.query === "agent service clarity").expectedFirstPath).toBe("/api/listing-roast");
      expect(x402Manifest.json.localDiscovery.searchExamples.find((example) => example.query === "agent service clarity").exactIntentPath).toBe("/api/agent-service-clarity");
      expect(x402Manifest.json.localDiscovery.searchExamples.find((example) => example.query === "x402 discovery audit").expectedFirstPath).toBe("/api/x402-discovery-audit");
      expect(x402Manifest.json.localDiscovery.searchExamples.find((example) => example.query === "paid API preflight").expectedFirstPath).toBe("/api/x402-site-audit");
      expect(x402Manifest.json.localDiscovery.searchExamples.find((example) => example.query === "paid API preflight").searchUrl).toContain("/v2/x402/discovery/search?query=paid%20API%20preflight");
      expect(x402Manifest.json.localDiscovery.aliases.resources).toContain("http://localhost:8787/.well-known/x402/discovery/resources");
      expect(x402Manifest.json.localDiscovery.officialCdpDiscovery.indexedRouteReason).toContain("already-settled");
      expect(x402Manifest.json.aliases).toContain("http://localhost:8787/api/x402.json");
      expect(x402Manifest.json.aliases.some((url) => url.endsWith("/.well-known/x402"))).toBe(true);
      expect(x402Manifest.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(x402Manifest.json.preferredFirstPaidAction.maxAmountRequired).toBe("1000");
      expect(x402Manifest.json.recommendedFirstPaidAction.route).toContain("/api/listing-roast");
      expect(x402Manifest.json.recommendedFirstPaidAction.maxAmountRequired).toBe("1000");
      expect(x402Manifest.json.url).toBe("http://localhost:8787/api/listing-roast");
      expect(x402Manifest.json.api_url).toBe("http://localhost:8787/api/listing-roast");
      expect(x402Manifest.json.endpoint_url).toBe("http://localhost:8787/api/listing-roast");
      expect(x402Manifest.json.method).toBe("GET");
      expect(x402Manifest.json.path).toBe("/api/listing-roast");
      expect(x402Manifest.json.x402_route).toBe("/api/listing-roast");
      expect(x402Manifest.json.price_usd).toBe("0.001");
      expect(x402Manifest.json.max_amount_required).toBe("1000");
      expect(x402Manifest.json.call_command).toContain("x402 pay 'http://localhost:8787/api/listing-roast'");
      expect(x402Manifest.json.curl).toBe("curl -X GET http://localhost:8787/api/listing-roast");
      expect(x402Manifest.json.primary_call.endpoint_url).toBe("http://localhost:8787/api/listing-roast");
      expect(x402Manifest.json.primaryCall.method).toBe("GET");
      expect(x402Manifest.json.primaryEndpoint.path).toBe("/api/listing-roast");
      expect(x402Manifest.json.primaryEndpoint.method).toBe("GET");
      expect(x402Manifest.json.primaryEndpoint.maxAmountRequired).toBe("1000");
      expect(x402Manifest.json.primaryEndpoint.serviceName).toBe("Listing Roast x402 Paid API Listing Quality Score");
      expect(x402Manifest.json.primaryEndpoint.note).toContain("POST / is only a fallback directory handoff");
      expect(x402Manifest.json.resource_samples[0].url).toBe("http://localhost:8787/api/listing-roast");
      expect(x402Manifest.json.resource_samples[0].resource).toBe("http://localhost:8787/api/listing-roast");
      expect(x402Manifest.json.resource_samples[0].method).toBe("GET");
      expect(x402Manifest.json.resource_samples[0].price).toBe("$0.001");
      expect(x402Manifest.json.resource_samples[0].price_usd).toBe("0.001");
      expect(x402Manifest.json.resource_samples[0].max_amount_required).toBe("1000");
      expect(x402Manifest.json.resource_samples[0].serviceName).toBe("Listing Roast x402 Paid API Listing Quality Score");
      expect(x402Manifest.json.resource_samples[0].description).toContain("marketplace listing score");
      expect(x402Manifest.json.resource_samples[0].keywords).toContain("paid API listing quality score");
      expect(x402Manifest.json.resource_count).toBe(PAID_RESOURCE_COUNT);
      expect(x402Manifest.json.call_info.resource_count).toBe(PAID_RESOURCE_COUNT);
      expect(x402Manifest.json.call_info.resource_samples[0].method).toBe("GET");
      expect(x402Manifest.json.call.primary_method).toBe("GET");
      expect(x402Manifest.json.call.x402_route).toBe("/api/listing-roast");
      expect(x402Manifest.json.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(x402Manifest.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(x402Manifest.json.recommendedPaidSequence[1].use).toBe("fullRoastGet");
      expect(x402Manifest.json.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(x402Manifest.json.intentLandingPages.map((page) => page.path)).toEqual(INTENT_LANDING_PAGE_PATHS);
      expect(x402Manifest.json.intentLandingPages[0].primaryPaidAction.path).toBe("/api/listing-roast");
      expect(x402Manifest.json.intentLandingPages[0].supportingPaidAction.path).toBe("/api/paid-api-listing-quality");
      expect(x402Manifest.json.intentLandingPages[0].upgradePaidAction.path).toBe("/api/full-listing-roast");
      expect(x402Manifest.json.intentLandingPages[0].upgradePaidAction.method).toBe("GET");
      expect(x402Manifest.json.intentLandingPages[1].primaryPaidAction.path).toBe("/api/listing-roast");
      expect(x402Manifest.json.intentLandingPages[1].supportingPaidAction.path).toBe("/api/paid-api-listing-quality-score");
      expect(x402Manifest.json.intentLandingPages[2].primaryPaidAction.path).toBe("/api/listing-roast");
      expect(x402Manifest.json.intentLandingPages[2].supportingPaidAction.path).toBe("/api/listing-quality-score-api");
      expect(x402Manifest.json.intentLandingPages[3].primaryPaidAction.path).toBe("/api/listing-roast");
      expect(x402Manifest.json.intentLandingPages[3].supportingPaidAction.path).toBe("/api/marketplace-product-listing-quality");
      expect(x402Manifest.json.intentLandingPages[4].primaryPaidAction.path).toBe("/api/listing-roast");
      expect(x402Manifest.json.intentLandingPages[4].supportingPaidAction.path).toBe("/api/marketplace-listing-conversion-api");
      expect(x402Manifest.json.intentLandingPages[5].primaryPaidAction.path).toBe("/api/listing-roast");
      expect(x402Manifest.json.intentLandingPages[5].supportingPaidAction.path).toBe("/api/marketplace-listing-conversion-api");
      expect(x402Manifest.json.intentLandingPages[6].primaryPaidAction.path).toBe("/api/listing-roast");
      expect(x402Manifest.json.intentLandingPages[6].supportingPaidAction.path).toBe("/api/x402-listing-quality");
      expect(x402Manifest.json.intentLandingPages[7].primaryPaidAction.path).toBe("/api/listing-roast");
      expect(x402Manifest.json.intentLandingPages[7].supportingPaidAction.path).toBe("/api/buyer-agent-skip-reasons");
      expect(x402Manifest.json.intentLandingPages[7].firstPaidAction.path).toBe("/api/listing-roast");
      expect(x402Manifest.json.intentLandingPages[7].exactIntentPaidAction.path).toBe("/api/buyer-agent-skip-reasons");
      expect(x402Manifest.json.intentLandingPages[7].payNow).toContain("/api/pay-now?intent=buyer-agent%20skip%20reasons");
      expect(x402Manifest.json.intentLandingPages[7].commands).toContain("/api/commands?intent=buyer-agent%20skip%20reasons");
      expect(x402Manifest.json.intentLandingPages[8].primaryPaidAction.path).toBe("/api/listing-roast");
      expect(x402Manifest.json.intentLandingPages[8].supportingPaidAction.path).toBe("/api/agent-service-clarity");
      expect(x402Manifest.json.intentLandingPages[10].primaryPaidAction.path).toBe("/api/x402-discovery-audit");
      expect(x402Manifest.json.intentLandingPages[10].primaryPaidAction.method).toBe("GET");
      expect(x402Manifest.json.intentLandingPages[10].primaryPaidAction.maxAmountRequired).toBe("1000");
      expect(x402Manifest.json.intentLandingPages[12].primaryPaidAction.path).toBe("/api/x402-buyer-prepay-risk-score");
      expect(x402Manifest.json.intentLandingPages[12].primaryPaidAction.maxAmountRequired).toBe("1000");
      expect(x402Manifest.json.intentLandingPages[12].supportingPaidAction.path).toBe("/api/x402-discovery-audit");
      expect(x402Manifest.json.intentLandingPages[13].primaryPaidAction.path).toBe("/api/score-x402-endpoint-before-paying");
      expect(x402Manifest.json.intentLandingPages[14].primaryPaidAction.path).toBe("/api/x402-route-health-check");
      expect(x402Manifest.json.intentLandingPages[15].primaryPaidAction.path).toBe("/api/x402-listing-rank-doctor");
      expect(x402Manifest.json.intentLandingPages[16].primaryPaidAction.path).toBe("/api/listing-roast");
      expect(x402Manifest.json.intentLandingPages[16].supportingPaidAction.path).toBe("/api/full-listing-roast");
      expect(x402Manifest.json.intentLandingPages[16].keywords).toContain("search_resources");
      expect(x402Manifest.json.intentLandingPages[16].keywords).toContain("proxy_tool_call");
      expect(x402Manifest.json.intentLandingPages[16].integrationNotes.join(" ")).toContain("No Authorization");
      expect(x402Manifest.json.intentLandingPages[16].integrationNotes.join(" ")).toContain("/platform/v2/x402/discovery/mcp");
      expect(x402Manifest.json.intentLandingPages[17].primaryPaidAction.path).toBe("/api/listing-roast");
      expect(x402Manifest.json.intentLandingPages[17].supportingPaidAction.path).toBe("/api/coinbase-x402-bazaar-mcp-server");
      expect(x402Manifest.json.intentLandingPages[17].keywords).toContain("search_resources");
      expect(x402Manifest.json.intentLandingPages[17].keywords).toContain("proxy_tool_call");
      expect(x402Manifest.json.intentLandingPages[17].integrationNotes.join(" ")).toContain("GET /api/listing-roast");
      expect(x402Manifest.json.intentLandingPages[17].integrationNotes.join(" ")).toContain("GET /api/full-listing-roast");
      expect(x402Manifest.json.intentLandingPages[18].primaryPaidAction.path).toBe("/api/full-listing-roast");
      expect(x402Manifest.json.intentLandingPages[18].primaryPaidAction.maxAmountRequired).toBe("10000");
      expect(x402Manifest.json.intentLandingPages[18].supportingPaidAction.path).toBe("/api/listing-roast");
      expect(x402Manifest.json.intentLandingPages[18].upgradePaidAction.path).toBe("/api/listing-roast");
      expect(x402Manifest.json.intentLandingPages[18].payNow).toContain("/api/pay-now?intent=full%20listing%20roast");
      expect(x402Manifest.json.intentLandingPages[18].commands).toContain("/api/commands?intent=full%20listing%20roast");
      expect(x402Manifest.json.resources.map((resource) => resource.id)).toEqual(["indexed_roast_quick_score", "marketplace_listing_score_alias", "marketplace_listing_conversion_api_alias", "marketplace_listing_conversion_alias", "marketplace_product_listing_quality_alias", "paid_api_listing_quality_alias", "paid_api_listing_quality_score_alias", "listing_quality_score_api_alias", "agentcore_x402_payments_alias", "coinbase_x402_bazaar_mcp_server_alias", "x402_listing_quality_alias", "buyer_agent_skip_reasons_alias", "agent_service_clarity_alias", "api_entry", "api_v1_entry", "v1_entry", "instant_listing_score", "x402_marketplace_conversion_score", "agent_listing_conversion_score", "agent_listing_conversion_score_alias", "x402_ping", "x402_site_audit", "paid_api_preflight", "api_v1_paid_api_preflight", "root_paid_api_preflight", "x402_buyer_prepay_risk_score", "score_x402_endpoint_before_paying", "x402_route_health_check", "x402_listing_rank_doctor", "agent402_route_visibility_audit", "x402_discovery_audit_quick", "x402_discovery_audit", "listing_score", "full_listing_roast_get", "listing_roast"]);
      expect(x402Manifest.json.resources.map((resource) => resource.path)).toEqual(["/api/listing-roast", ...QUICK_SCORE_ALIAS_PATHS, "/api", "/api/v1", "/v1", "/api/instant-listing-score", "/api/x402-marketplace-conversion", "/api/agent-listing-conversion", "/api/agent-listing-conversion-score", "/api/x402-ping", "/api/x402-site-audit", ...PREFLIGHT_ALIAS_PATHS, ...SITE_AUDIT_EXACT_ALIAS_PATHS, "/api/agent402-route-visibility", "/api/x402-discovery-audit", "/api/x402-discovery-audit", "/api/listing-score", "/api/full-listing-roast", "/api/listing-roast"]);
      expect(x402Manifest.json.resources.map((resource) => resource.id)).not.toContain("directory_root_post");
      expect(x402Manifest.json.fallbackDirectoryPost.path).toBe("/");
      expect(x402Manifest.json.fallbackDirectoryPost.method).toBe("POST");
      expect(x402Manifest.json.fallbackDirectoryPost.listedInResources).toBe(false);
      expect(x402Manifest.json.fallbackDirectoryPost.reason).toContain("omitted from public resource/tool arrays");
      expect(x402Manifest.json.capabilities.actions).toBe(PAID_RESOURCE_COUNT);
      expect(x402Manifest.json.actions.map((action) => action.id)).toEqual(x402Manifest.json.resources.map((resource) => resource.id));
      expect(x402Manifest.json.paidActions.map((action) => action.path)).toEqual(x402Manifest.json.resources.map((resource) => resource.path));
      expect(x402Manifest.json.tools.map((tool) => tool.url)).toEqual(x402Manifest.json.resources.map((resource) => resource.url));
      expect(x402Manifest.json.actions[0].path).toBe("/api/listing-roast");
      expect(x402Manifest.json.actions[0].max_amount_required).toBe("1000");
      expect(x402Manifest.json.actions[0].agentPaymentRequest.maxPayment).toBe("0.001");
      expect(x402Manifest.json.actions[0].agentPaymentPrompt).toContain("pay up to 0.001 USDC");
      expect(x402Manifest.json.actions[0].paymentRequired).toBe(true);
      expect(x402Manifest.json.actions[0].x402.network).toBe("eip155:84532");
      expect(x402Manifest.json.actions[0].preferredFirstPaidAction).toBe(true);
      const resourcesById = Object.fromEntries(x402Manifest.json.resources.map((resource) => [resource.id, resource]));
      expect(resourcesById.x402_buyer_prepay_risk_score.path).toBe("/api/x402-buyer-prepay-risk-score");
      expect(resourcesById.x402_buyer_prepay_risk_score.maxAmountRequired).toBe("1000");
      expect(resourcesById.x402_buyer_prepay_risk_score.canonicalRoute).toBe("/api/x402-site-audit");
      expect(resourcesById.score_x402_endpoint_before_paying.path).toBe("/api/score-x402-endpoint-before-paying");
      expect(resourcesById.x402_route_health_check.keywords).toContain("x402 route health check");
      expect(resourcesById.x402_listing_rank_doctor.keywords).toContain("x402 listing rank doctor");
      expect(resourcesById.agent402_route_visibility_audit.path).toBe("/api/agent402-route-visibility");
      expect(resourcesById.agent402_route_visibility_audit.input.url).toBe("http://localhost:8787/api/agent402-route-visibility");
      expect(resourcesById.agent402_route_visibility_audit.input.base_url).toBe("http://localhost:8787/api/agent402-route-visibility");
      expect(resourcesById.agent402_route_visibility_audit.input.endpointUrl).toBe("http://localhost:8787/api/agent402-route-visibility");
      expect(resourcesById.agent402_route_visibility_audit.input.resource).toBe("http://localhost:8787/api/agent402-route-visibility");
      expect(resourcesById.agent402_route_visibility_audit.input.searchQuery).toBe("Agent402 route visibility");
      expect(resourcesById.agent402_route_visibility_audit.input.agent402Query).toBe("Agent402 route visibility");
      expect(resourcesById.agent402_route_visibility_audit.outputExample.route).toBe("/api/agent402-route-visibility");
      expect(resourcesById.agent402_route_visibility_audit.outputExample.endpoint).toBe("agent402-route-visibility-audit");
      expect(resourcesById.agent402_route_visibility_audit.outputExample.input.endpointUrl).toBe("http://localhost:8787/api/agent402-route-visibility");
      expect(resourcesById.agent402_route_visibility_audit.outputExample.input.searchQuery).toBe("Agent402 route visibility");
      expect(resourcesById.agent402_route_visibility_audit.outputExample.input.agent402Query).toBe("Agent402 route visibility");
      expect(resourcesById.agent402_route_visibility_audit.outputExample.agent402Route.topRank).toBe(1);
      expect(resourcesById.agent402_route_visibility_audit.outputExample.agent402Route.matchedResult.route).toBe("/api/agent402-route-visibility");
      expect(x402Manifest.json.resources[0].name).toBe("marketplace_listing_score_paid_api_listing_quality_score");
      expect(x402Manifest.json.resources[0].serviceName).toBe("Listing Roast x402 Paid API Listing Quality Score");
      expect(x402Manifest.json.resources[0].description).toMatch(/^Listing Roast helps x402 and AgentCore sellers/);
      expect(x402Manifest.json.resources[0].description).toContain("marketplace listing conversion API");
      expect(x402Manifest.json.resources[0].description).toContain("marketplace product listing quality");
      expect(x402Manifest.json.resources[0].description).toContain("Agentic.Market listing score");
      expect(x402Manifest.json.tags).toContain("Agentic.Market listing score");
      expect(x402Manifest.json.resources[0].tags).toEqual([
        "x402",
        "listing quality score API",
        "marketplace product listing quality",
        "paid API listing quality score",
        "paid API listing quality",
        "AgentCore x402 payments",
        "Coinbase x402 Bazaar MCP server",
        "marketplace listing score",
        "marketplace listing conversion API",
        "x402 marketplace conversion",
        "agent listing conversion",
        "buyer-agent skip reasons",
        "agent-service listing score",
        "x402 site audit",
        "x402 discovery audit",
        "paid API preflight",
        "agent service clarity",
        "route health"
      ]);
      expect(x402Manifest.json.resources[0].description).toContain("marketplace listing score");
      expect(x402Manifest.json.resources[0].description).toContain("marketplace listing conversion API");
      expect(x402Manifest.json.resources[0].description).toContain("x402 marketplace conversion");
      expect(x402Manifest.json.resources[0].description).toContain("buyer-agent skip reasons");
      expect(x402Manifest.json.resources[0].description).toContain("buyer agent skip reasons");
      expect(x402Manifest.json.resources[0].description).toContain("agent service clarity");
      expect(x402Manifest.json.resources[0].description).toContain("agent-service listing score");
      expect(x402Manifest.json.resources[0].description).toContain("x402 discovery audit");
      expect(x402Manifest.json.resources[0].description).toContain("route health");
      expect(x402Manifest.json.resources[0].description).toContain("stale Bazaar price");
      expect(x402Manifest.json.resources[0].keywords).toContain("listing roast");
      expect(x402Manifest.json.resources[0].keywords).toContain("buyer-agent skip reasons");
      expect(x402Manifest.json.resources[0].keywords).toContain("agent service listing clarity");
      expect(x402Manifest.json.resources[0].keywords).toContain("x402 site audit");
      expect(x402Manifest.json.resources[0].keywords).toContain("x402 discovery audit");
      expect(x402Manifest.json.resources[0].keywords).toContain("paid API preflight");
      expect(x402Manifest.json.resources[0].keywords).toContain("x402 route health check");
      expect(x402Manifest.json.resources[0].keywords).toContain("bazaar search visibility");
      expect(x402Manifest.json.resources[0].price).toBe("$0.001");
      expect(x402Manifest.json.resources[0].maxAmountRequired).toBe("1000");
      expect(x402Manifest.json.resources[0].agentPaymentRequest.maxPayment).toBe("0.001");
      expect(x402Manifest.json.resources[0].agentPaymentPrompt).toContain("pay up to 0.001 USDC");
      expect(resourcesById.marketplace_listing_score_alias.path).toBe("/api/marketplace-listing-score");
      expect(resourcesById.marketplace_listing_score_alias.price).toBe("$0.001");
      expect(resourcesById.marketplace_listing_score_alias.maxAmountRequired).toBe("1000");
      expect(resourcesById.marketplace_listing_score_alias.canonicalRoute).toBe("/api/listing-roast");
      expect(resourcesById.marketplace_listing_score_alias.description).toContain("marketplace listing score");
      expect(resourcesById.marketplace_listing_score_alias.command).toContain("/api/marketplace-listing-score");
      expect(resourcesById.marketplace_listing_score_alias.input.currentCheckoutPath).toBe("/api/marketplace-listing-score");
      expect(resourcesById.marketplace_listing_score_alias.input.goal).toContain("marketplace listing score");
      expect(resourcesById.marketplace_listing_conversion_api_alias.path).toBe("/api/marketplace-listing-conversion-api");
      expect(resourcesById.marketplace_listing_conversion_api_alias.price).toBe("$0.001");
      expect(resourcesById.marketplace_listing_conversion_api_alias.maxAmountRequired).toBe("1000");
      expect(resourcesById.marketplace_listing_conversion_api_alias.canonicalRoute).toBe("/api/listing-roast");
      expect(resourcesById.marketplace_listing_conversion_api_alias.description).toContain("exact-path alias");
      expect(resourcesById.marketplace_listing_conversion_api_alias.keywords).toContain("marketplace listing conversion API");
      expect(resourcesById.marketplace_listing_conversion_api_alias.command).toContain("/api/marketplace-listing-conversion-api");
      expect(resourcesById.marketplace_listing_conversion_api_alias.input.currentCheckoutPath).toBe("/api/marketplace-listing-conversion-api");
      expect(resourcesById.marketplace_listing_conversion_api_alias.input.goal).toContain("marketplace listing conversion API");
      expect(resourcesById.marketplace_listing_conversion_alias.path).toBe("/api/marketplace-listing-conversion");
      expect(resourcesById.marketplace_listing_conversion_alias.price).toBe("$0.001");
      expect(resourcesById.marketplace_listing_conversion_alias.maxAmountRequired).toBe("1000");
      expect(resourcesById.marketplace_listing_conversion_alias.canonicalRoute).toBe("/api/listing-roast");
      expect(resourcesById.marketplace_listing_conversion_alias.description).toContain("marketplace listing conversion API");
      expect(resourcesById.marketplace_listing_conversion_alias.description).toContain("marketplace listing conversion");
      expect(resourcesById.marketplace_listing_conversion_alias.keywords).toContain("marketplace listing conversion API");
      expect(resourcesById.marketplace_listing_conversion_alias.keywords).toContain("x402 marketplace conversion");
      expect(resourcesById.marketplace_listing_conversion_alias.command).toContain("/api/marketplace-listing-conversion");
      expect(resourcesById.marketplace_listing_conversion_alias.input.currentCheckoutPath).toBe("/api/marketplace-listing-conversion");
      expect(resourcesById.marketplace_listing_conversion_alias.input.goal).toContain("marketplace listing conversion");
      expect(resourcesById.marketplace_product_listing_quality_alias.path).toBe("/api/marketplace-product-listing-quality");
      expect(resourcesById.marketplace_product_listing_quality_alias.description).toContain("marketplace product listing quality");
      expect(resourcesById.marketplace_product_listing_quality_alias.input.currentCheckoutPath).toBe("/api/marketplace-product-listing-quality");
      expect(resourcesById.marketplace_product_listing_quality_alias.input.goal).toContain("marketplace product listing quality");
      expect(resourcesById.paid_api_listing_quality_alias.path).toBe("/api/paid-api-listing-quality");
      expect(resourcesById.paid_api_listing_quality_alias.description).toContain("paid API listing quality");
      expect(resourcesById.paid_api_listing_quality_alias.input.currentCheckoutPath).toBe("/api/paid-api-listing-quality");
      expect(resourcesById.paid_api_listing_quality_alias.input.goal).toContain("paid API listing quality");
      expect(resourcesById.paid_api_listing_quality_score_alias.path).toBe("/api/paid-api-listing-quality-score");
      expect(resourcesById.paid_api_listing_quality_score_alias.description).toContain("paid API listing quality score");
      expect(resourcesById.paid_api_listing_quality_score_alias.input.currentCheckoutPath).toBe("/api/paid-api-listing-quality-score");
      expect(resourcesById.listing_quality_score_api_alias.path).toBe("/api/listing-quality-score-api");
      expect(resourcesById.listing_quality_score_api_alias.description).toContain("listing quality score API");
      expect(resourcesById.listing_quality_score_api_alias.input.currentCheckoutPath).toBe("/api/listing-quality-score-api");
      expect(resourcesById.x402_listing_quality_alias.path).toBe("/api/x402-listing-quality");
      expect(resourcesById.x402_listing_quality_alias.description).toContain("x402 listing quality");
      expect(resourcesById.x402_listing_quality_alias.input.currentCheckoutPath).toBe("/api/x402-listing-quality");
      expect(resourcesById.buyer_agent_skip_reasons_alias.path).toBe("/api/buyer-agent-skip-reasons");
      expect(resourcesById.buyer_agent_skip_reasons_alias.keywords).toContain("buyer-agent skip reasons");
      expect(resourcesById.buyer_agent_skip_reasons_alias.input.currentCheckoutPath).toBe("/api/buyer-agent-skip-reasons");
      expect(resourcesById.agent_service_clarity_alias.path).toBe("/api/agent-service-clarity");
      expect(resourcesById.agent_service_clarity_alias.keywords).toContain("agent service clarity");
      expect(resourcesById.agent_service_clarity_alias.input.currentCheckoutPath).toBe("/api/agent-service-clarity");
      expect(resourcesById.api_entry.price).toBe("$0.001");
      expect(resourcesById.api_entry.method).toBe("GET");
      expect(resourcesById.api_entry.maxAmountRequired).toBe("1000");
      expect(resourcesById.api_v1_entry.price).toBe("$0.001");
      expect(resourcesById.api_v1_entry.method).toBe("GET");
      expect(resourcesById.api_v1_entry.maxAmountRequired).toBe("1000");
      expect(resourcesById.v1_entry.price).toBe("$0.001");
      expect(resourcesById.v1_entry.method).toBe("GET");
      expect(resourcesById.v1_entry.maxAmountRequired).toBe("1000");
      expect(resourcesById.instant_listing_score.price).toBe("$0.001");
      expect(resourcesById.instant_listing_score.maxAmountRequired).toBe("1000");
      expect(resourcesById.x402_marketplace_conversion_score.price).toBe("$0.001");
      expect(resourcesById.x402_marketplace_conversion_score.keywords).toContain("x402 marketplace conversion");
      expect(resourcesById.x402_marketplace_conversion_score.maxAmountRequired).toBe("1000");
      expect(resourcesById.agent_listing_conversion_score.price).toBe("$0.001");
      expect(resourcesById.agent_listing_conversion_score.keywords).toContain("agent service listing clarity");
      expect(resourcesById.agent_listing_conversion_score.keywords).toContain("buyer-agent skip reasons");
      expect(resourcesById.agent_listing_conversion_score.maxAmountRequired).toBe("1000");
      expect(resourcesById.agent_listing_conversion_score_alias.path).toBe("/api/agent-listing-conversion-score");
      expect(resourcesById.agent_listing_conversion_score_alias.price).toBe("$0.001");
      expect(resourcesById.agent_listing_conversion_score_alias.maxAmountRequired).toBe("1000");
      expect(resourcesById.agent_listing_conversion_score_alias.canonicalRoute).toBe("/api/agent-listing-conversion");
      expect(resourcesById.agent_listing_conversion_score_alias.command).toContain("/api/agent-listing-conversion-score");
      expect(resourcesById.agent_listing_conversion_score_alias.input.currentCheckoutPath).toBe("/api/agent-listing-conversion-score");
      expect(resourcesById.agent_listing_conversion_score_alias.outputExample.route).toBe("/api/agent-listing-conversion-score");
      expect(resourcesById.agent_listing_conversion_score_alias.outputExample.exactScoreAlias).toBe("/api/agent-listing-conversion-score");
      expect(resourcesById.agent_listing_conversion_score_alias.outputExample.canonicalRoute).toBe("/api/agent-listing-conversion");
      expect(resourcesById.x402_ping.price).toBe("$0.001");
      expect(resourcesById.x402_ping.keywords).toContain("x402 ping");
      expect(resourcesById.x402_ping.maxAmountRequired).toBe("1000");
      expect(resourcesById.x402_site_audit.price).toBe("$0.001");
      expect(resourcesById.x402_site_audit.description).toContain("paid API preflight before paying");
      expect(resourcesById.x402_site_audit.tags).toEqual([
        "x402",
        "x402 site audit",
        "discovery audit",
        "x402 buyer prepay risk score",
        "score x402 endpoint before paying",
        "x402 seller discoverability",
        "fix x402 Bazaar listing",
        "x402 catalog metadata quality",
        "x402 route health check",
        "x402 listing SEO audit",
        "x402 listing rank doctor",
        "x402 seller growth checklist",
        "x402 seller intelligence",
        "x402 marketplace SEO audit",
        "paid API preflight",
        "route health",
        "Bazaar search visibility",
        "stale Bazaar price"
      ]);
      expect(resourcesById.x402_site_audit.keywords).toContain("x402 site audit");
      expect(resourcesById.x402_site_audit.keywords).toContain("x402 listing SEO audit");
      expect(resourcesById.x402_site_audit.keywords).toContain("x402 listing rank doctor");
      expect(resourcesById.x402_site_audit.keywords).toContain("x402 seller growth checklist");
      expect(resourcesById.x402_site_audit.keywords).toContain("x402 seller intelligence");
      expect(resourcesById.x402_site_audit.keywords).toContain("paid API preflight");
      expect(resourcesById.x402_site_audit.keywords).toContain("x402 route health check");
      expect(resourcesById.x402_site_audit.maxAmountRequired).toBe("1000");
      expect(resourcesById.x402_site_audit.input.url).toBe("https://listing-roast-x402-service-production.up.railway.app/api/listing-roast");
      expect(resourcesById.x402_site_audit.input.base_url).toBe("https://listing-roast-x402-service-production.up.railway.app/api/listing-roast");
      expect(resourcesById.x402_site_audit.input.endpointUrl).toBe("https://listing-roast-x402-service-production.up.railway.app/api/listing-roast");
      expect(resourcesById.paid_api_preflight.path).toBe("/api/preflight");
      expect(resourcesById.paid_api_preflight.canonicalRoute).toBe("/api/x402-site-audit");
      expect(resourcesById.paid_api_preflight.description).toContain("paid API preflight before paying");
      expect(resourcesById.api_v1_paid_api_preflight.path).toBe("/api/v1/preflight");
      expect(resourcesById.root_paid_api_preflight.path).toBe("/preflight");
      expect(resourcesById.x402_discovery_audit_quick.price).toBe("$0.001");
      expect(resourcesById.x402_discovery_audit_quick.method).toBe("GET");
      expect(resourcesById.x402_discovery_audit_quick.path).toBe("/api/x402-discovery-audit");
      expect(resourcesById.x402_discovery_audit_quick.keywords).toContain("x402 discovery audit");
      expect(resourcesById.x402_discovery_audit_quick.maxAmountRequired).toBe("1000");
      expect(resourcesById.x402_discovery_audit_quick.input.url).toBe("https://listing-roast-x402-service-production.up.railway.app/api/listing-roast");
      expect(resourcesById.x402_discovery_audit_quick.input.base_url).toBe("https://listing-roast-x402-service-production.up.railway.app/api/listing-roast");
      expect(resourcesById.x402_discovery_audit.price).toBe("$0.01");
      expect(resourcesById.x402_discovery_audit.keywords).toContain("x402 bazaar discovery audit");
      expect(resourcesById.x402_discovery_audit.maxAmountRequired).toBe("10000");
      expect(resourcesById.x402_discovery_audit.input.url).toBe("https://listing-roast-x402-service-production.up.railway.app/api/listing-roast");
      expect(resourcesById.x402_discovery_audit.input.base_url).toBe("https://listing-roast-x402-service-production.up.railway.app/api/listing-roast");
      expect(resourcesById.listing_score.price).toBe("$0.005");
      expect(resourcesById.listing_score.maxAmountRequired).toBe("5000");
      expect(resourcesById.listing_roast.price).toBe("$0.01");
      expect(resourcesById.listing_roast.maxAmountRequired).toBe("10000");
      expect(resourcesById.listing_roast.description).toContain("omitted bodies use safe defaults");
      expect(resourcesById.listing_roast.description).toContain("Prefer GET /api/full-listing-roast");
      expect(resourcesById.listing_roast.keywords).toContain("custom-body full roast");
      expect(resourcesById.listing_roast.keywords).toContain("stale directory card");

      const wellKnownX402Manifest = await fetchJson(server, "/.well-known/x402.json");
      expect(wellKnownX402Manifest.status).toBe(200);
      expectFreshDiscoveryHeaders(wellKnownX402Manifest.headers);
      expect(wellKnownX402Manifest.json.resources[0].command).toContain("--max-amount 1000");
      expect(wellKnownX402Manifest.json.resources[0].command).toContain("/api/listing-roast");
      const wellKnownById = Object.fromEntries(wellKnownX402Manifest.json.resources.map((resource) => [resource.id, resource]));
      expect(wellKnownById.directory_root_post).toBeUndefined();
      expect(wellKnownX402Manifest.json.fallbackDirectoryPost.command).toContain("-X POST");
      expect(wellKnownX402Manifest.json.fallbackDirectoryPost.command).toContain("--max-amount 1000");
      expect(wellKnownX402Manifest.json.fallbackDirectoryPost.command).not.toContain("-d ");
      expect(wellKnownById.api_entry.command).toContain("/api");
      expect(wellKnownById.api_v1_entry.command).toContain("/api/v1");
      expect(wellKnownById.v1_entry.command).toContain("/v1");
      expect(wellKnownById.instant_listing_score.command).toContain("/api/instant-listing-score");
      expect(wellKnownById.x402_marketplace_conversion_score.command).toContain("/api/x402-marketplace-conversion");
      expect(wellKnownById.agent_listing_conversion_score.command).toContain("/api/agent-listing-conversion");
      expect(wellKnownById.agent_listing_conversion_score_alias.command).toContain("/api/agent-listing-conversion-score");
      expect(wellKnownById.x402_ping.command).toContain("/api/x402-ping");
      expect(wellKnownById.x402_site_audit.command).toContain("/api/x402-site-audit");
      expect(wellKnownById.x402_discovery_audit_quick.command).toContain("/api/x402-discovery-audit");
      expect(wellKnownById.x402_discovery_audit_quick.command).toContain("--max-amount 1000");
      expect(wellKnownById.x402_discovery_audit.command).toContain("/api/x402-discovery-audit");
      expect(wellKnownById.listing_roast.command).toContain("--max-amount 10000");

      const wellKnownX402Alias = await fetchJson(server, "/.well-known/x402");
      expect(wellKnownX402Alias.status).toBe(200);
      expectFreshDiscoveryHeaders(wellKnownX402Alias.headers);
      expect(wellKnownX402Alias.json.resources[0].path).toBe("/api/listing-roast");
      expect(wellKnownX402Alias.json.payNow).toContain("/api/pay-now");

      const apiX402Alias = await fetchJson(server, "/api/x402.json");
      expect(apiX402Alias.status).toBe(200);
      expectFreshDiscoveryHeaders(apiX402Alias.headers);
      expect(apiX402Alias.json.resources[0].path).toBe("/api/listing-roast");
      expect(apiX402Alias.json.payNow).toContain("/api/pay-now");

      const agentTools = await fetchJson(server, "/.well-known/agent-tools.json");
      expect(agentTools.status).toBe(200);
      expectFreshDiscoveryHeaders(agentTools.headers);
      expect(agentTools.json.name).toBe("Listing Roast x402");
      expect(agentTools.json.type).toBe("x402-paid-api-service");
      expect(agentTools.json.version).toBe("0.3");
      expect(agentTools.json.service).toBe("Listing Roast x402");
      expect(agentTools.json.serviceName).toBe("Listing Roast x402");
      expect(agentTools.json.provider_url).toBe("http://localhost:8787");
      expect(agentTools.json.iconUrl).toBe("http://localhost:8787/icon.svg");
      expect(agentTools.json.icon_url).toBe("http://localhost:8787/icon.svg");
      expect(agentTools.json.category).toBe("paid-api-listing");
      expect(agentTools.json.tags).toContain("marketplace listing score");
      expect(agentTools.json.metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(agentTools.json.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(agentTools.json.metadataUpdatedAt).toBe("2026-06-21T03:14:35.000Z");
      expect(agentTools.json.metadata_updated_at).toBe("2026-06-21T03:14:35.000Z");
      expect(agentTools.json.commands).toContain("/api/commands");
      expect(agentTools.json.links.commands).toContain("/api/commands");
      expect(agentTools.json.payment.commands).toContain("/api/commands");
      expectBrowserPaymentSupport(agentTools.json.browserPayment);
      expectBrowserPaymentSupport(agentTools.json.payment.browserPayment);
      expect(agentTools.json.payment.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(agentTools.json.payment.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(agentTools.json.officialCdpDiscovery.indexedRoute).toBe("http://localhost:8787/api/listing-roast");
      expect(agentTools.json.payment.officialCdpDiscovery.refreshRule).toContain("real settlement");
      expect(agentTools.json.official_cdp_discovery.recommendedSearchUrl).toContain("maxUsdPrice=0.001");
      expect(agentTools.json.paidUsageProof.paidCompletions).toBe(0);
      expect(agentTools.json.paidUsageProof.estimatedGrossRevenueUsd).toBe("0.00");
      expect(agentTools.json.paidUsageProof.proofText).toContain("0 paid completions");
      expect(agentTools.json.paidUsageProof.preferredConvertedRoute.path).toBe("/api/listing-roast");
      expect(agentTools.json.paid_usage_proof_summary.proofText).toContain("0 paid completions");
      expect(agentTools.json.paid_usage_proof_summary.cashRegister).toContain("/api/cash-register");
      expect(agentTools.json.resource_samples[0].url).toBe("http://localhost:8787/api/listing-roast");
      expect(agentTools.json.resource_samples[0].resource).toBe("http://localhost:8787/api/listing-roast");
      expect(agentTools.json.resource_samples[0].method).toBe("GET");
      expect(agentTools.json.resource_samples[0].price_usd).toBe("0.001");
      expect(agentTools.json.resource_samples[0].agentPaymentRequest.maxPayment).toBe("0.001");
      expect(agentTools.json.resource_samples[0].agentPaymentPrompt).toContain("pay up to 0.001 USDC");
      expect(agentTools.json.resource_samples[0].serviceName).toBe("Listing Roast x402 Paid API Listing Quality Score");
      expect(agentTools.json.resource_samples[0].description).toContain("marketplace listing score");
      expect(agentTools.json.resource_samples[0].keywords).toContain("paid API listing quality score");
      expect(agentTools.json.resource_count).toBe(PAID_RESOURCE_COUNT);
      expect(agentTools.json.call_info.resource_count).toBe(PAID_RESOURCE_COUNT);
      expect(agentTools.json.call_info.resource_samples[0].method).toBe("GET");
      expect(agentTools.json.openapi).toBe("/openapi.json");
      expect(agentTools.json.x402_catalog).toBe("/x402.json");
      expect(agentTools.json.endpoints.primary_paid_call.method).toBe("GET");
      expect(agentTools.json.endpoints.primary_paid_call.url).toBe("http://localhost:8787/api/listing-roast");
      expect(agentTools.json.endpoints.primary_paid_call.max_amount_required).toBe("1000");
      expect(agentTools.json.endpoints.cash_register).toBe("http://localhost:8787/api/cash-register");
      expect(agentTools.json.url).toBe("http://localhost:8787/api/listing-roast");
      expect(agentTools.json.api_url).toBe("http://localhost:8787/api/listing-roast");
      expect(agentTools.json.endpoint_url).toBe("http://localhost:8787/api/listing-roast");
      expect(agentTools.json.method).toBe("GET");
      expect(agentTools.json.path).toBe("/api/listing-roast");
      expect(agentTools.json.x402_route).toBe("/api/listing-roast");
      expect(agentTools.json.price_usd).toBe("0.001");
      expect(agentTools.json.max_amount_required).toBe("1000");
      expect(agentTools.json.max_payment_usd).toBe("0.001");
      expect(agentTools.json.agentPaymentRequest.maxPayment).toBe("0.001");
      expect(agentTools.json.agentPaymentPrompt).toContain("pay up to 0.001 USDC");
      expect(agentTools.json.call_command).toContain("x402 pay 'http://localhost:8787/api/listing-roast'");
      expect(agentTools.json.curl).toBe("curl -X GET http://localhost:8787/api/listing-roast");
      expect(agentTools.json.primary_call.endpoint_url).toBe("http://localhost:8787/api/listing-roast");
      expect(agentTools.json.primaryCall.method).toBe("GET");
      expect(agentTools.json.primaryEndpoint.path).toBe("/api/listing-roast");
      expect(agentTools.json.primaryEndpoint.method).toBe("GET");
      expect(agentTools.json.primary_endpoint.path).toBe("/api/listing-roast");
      expect(agentTools.json.primary_endpoint.method).toBe("GET");
      expect(agentTools.json.primary_endpoint.serviceName).toBe("Listing Roast x402 Paid API Listing Quality Score");
      expect(agentTools.json.primary_endpoint.note).toContain("POST / is only a fallback directory handoff");
      expect(agentTools.json.call.primary_method).toBe("GET");
      expect(agentTools.json.call.x402_route).toBe("/api/listing-roast");
      expect(agentTools.json.agent_hint).toContain("GET /api/listing-roast");
      expect(agentTools.json.preferred_first_paid_action.path).toBe("/api/listing-roast");
      expect(agentTools.json.preferred_first_paid_action.maxAmountRequired).toBe("1000");
      expect(agentTools.json.intent_landing_pages.map((page) => page.path)).toEqual(INTENT_LANDING_PAGE_PATHS);
      expect(agentTools.json.intent_landing_pages[1].primaryPaidAction.path).toBe("/api/listing-roast");
      expect(agentTools.json.intent_landing_pages[1].supportingPaidAction.path).toBe("/api/paid-api-listing-quality-score");
      expect(agentTools.json.intent_landing_pages[2].primaryPaidAction.path).toBe("/api/listing-roast");
      expect(agentTools.json.intent_landing_pages[2].supportingPaidAction.path).toBe("/api/listing-quality-score-api");
      expect(agentTools.json.intent_landing_pages[3].primaryPaidAction.path).toBe("/api/listing-roast");
      expect(agentTools.json.intent_landing_pages[3].supportingPaidAction.path).toBe("/api/marketplace-product-listing-quality");
      expect(agentTools.json.intent_landing_pages[4].primaryPaidAction.path).toBe("/api/listing-roast");
      expect(agentTools.json.intent_landing_pages[4].supportingPaidAction.path).toBe("/api/marketplace-listing-conversion-api");
      expect(agentTools.json.intent_landing_pages[5].primaryPaidAction.path).toBe("/api/listing-roast");
      expect(agentTools.json.intent_landing_pages[5].supportingPaidAction.path).toBe("/api/marketplace-listing-conversion-api");
      expect(agentTools.json.intent_landing_pages[6].primaryPaidAction.path).toBe("/api/listing-roast");
      expect(agentTools.json.intent_landing_pages[6].supportingPaidAction.path).toBe("/api/x402-listing-quality");
      expect(agentTools.json.intent_landing_pages[7].primaryPaidAction.path).toBe("/api/listing-roast");
      expect(agentTools.json.intent_landing_pages[7].supportingPaidAction.path).toBe("/api/buyer-agent-skip-reasons");
      expect(agentTools.json.intent_landing_pages[7].firstPaidAction.path).toBe("/api/listing-roast");
      expect(agentTools.json.intent_landing_pages[7].exactIntentPaidAction.path).toBe("/api/buyer-agent-skip-reasons");
      expect(agentTools.json.intent_landing_pages[7].payNow).toContain("/api/pay-now?intent=buyer-agent%20skip%20reasons");
      expect(agentTools.json.intent_landing_pages[8].primaryPaidAction.path).toBe("/api/listing-roast");
      expect(agentTools.json.intent_landing_pages[8].supportingPaidAction.path).toBe("/api/agent-service-clarity");
      expect(agentTools.json.tools.map((tool) => tool.name)).toContain("indexed_roast_quick_score");
      expect(agentTools.json.tools[0].path).toBe("/api/listing-roast");
      expect(agentTools.json.tools[0].route).toBe("http://localhost:8787/api/listing-roast");
      expect(agentTools.json.tools[0].x402_route).toBe("/api/listing-roast");
      expectBrowserPaymentSupport(agentTools.json.tools[0].browserPayment);
      expectBrowserPaymentSupport(agentTools.json.tools[0].payment.browserPayment);
      expect(agentTools.json.tools[0].id).toBe("indexed_roast_quick_score");
      expect(agentTools.json.tools[0].price).toBe("$0.001");
      expect(agentTools.json.tools[0].priceUsd).toBe("0.001");
      expect(agentTools.json.tools[0].price_usd).toBe("0.001");
      expect(agentTools.json.tools[0].maxAmountRequired).toBe("1000");
      expect(agentTools.json.tools[0].max_amount_required).toBe("1000");
      expect(agentTools.json.tools[0].maxPaymentUsd).toBe("0.001");
      expect(agentTools.json.tools[0].max_payment_usd).toBe("0.001");
      expect(agentTools.json.tools[0].amount).toBe("1000");
      expect(agentTools.json.tools[0].amount_usdc_units).toBe("1000");
      expect(agentTools.json.tools[0].max_usdc_units).toBe("1000");
      expect(agentTools.json.tools[0].agentPaymentRequest.maxPayment).toBe("0.001");
      expect(agentTools.json.tools[0].agentPaymentPrompt).toContain("pay up to 0.001 USDC");
      expect(agentTools.json.tools[0].command).toContain("--max-amount 1000");
      expect(agentTools.json.tools.find((tool) => tool.name === "directory_root_post")).toBeUndefined();
      expect(agentTools.json.fallbackDirectoryPost.path).toBe("/");
      expect(agentTools.json.fallbackDirectoryPost.command).toContain("-X POST");
      expect(agentTools.json.fallbackDirectoryPost.command).not.toContain("-d ");
      expect(agentTools.json.tools.find((tool) => tool.name === "x402_site_audit").keywords).toContain("x402 route health check");
      expect(agentTools.json.tools.find((tool) => tool.name === "paid_api_preflight").local_route).toBe("/api/preflight");
      expect(agentTools.json.tools.find((tool) => tool.name === "paid_api_preflight").category).toBe("x402-discovery");
      expect(agentTools.json.tools.find((tool) => tool.name === "paid_api_preflight").command).toContain("/api/preflight");
      expect(agentTools.json.tools.find((tool) => tool.name === "api_v1_paid_api_preflight").local_route).toBe("/api/v1/preflight");
      expect(agentTools.json.tools.find((tool) => tool.name === "root_paid_api_preflight").local_route).toBe("/preflight");
      expect(agentTools.json.tools.find((tool) => tool.name === "x402_discovery_audit_quick").max_amount_required).toBe("1000");
      expect(agentTools.json.tools.find((tool) => tool.name === "x402_discovery_audit").max_amount_required).toBe("10000");

      const agentCard = await fetchJson(server, "/.well-known/agent-card.json");
      expect(agentCard.status).toBe(200);
      expectFreshDiscoveryHeaders(agentCard.headers);
      expect(agentCard.json.service).toBe("Listing Roast x402");
      expect(agentCard.json.serviceName).toBe("Listing Roast x402");
      expect(agentCard.json.metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(agentCard.json.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(agentCard.json.metadataUpdatedAt).toBe("2026-06-21T03:14:35.000Z");
      expect(agentCard.json.metadata_updated_at).toBe("2026-06-21T03:14:35.000Z");
      expect(agentCard.json.protocolVersion).toBe("0.3.0");
      expect(agentCard.json.name).toBe("Listing Roast x402");
      expect(agentCard.json.url).toContain("/api/listing-roast");
      expect(agentCard.json.iconUrl).toContain("/icon.svg");
      expect(agentCard.json.preferredTransport).toBe("HTTP+JSON");
      expect(agentCard.json.commands).toContain("/api/commands");
      expect(agentCard.json.links.commands).toContain("/api/commands");
      expect(agentCard.json.payment.commands).toContain("/api/commands");
      expectBrowserPaymentSupport(agentCard.json.browserPayment);
      expectBrowserPaymentSupport(agentCard.json.payment.browserPayment);
      expectBrowserPaymentSupport(agentCard.json.capabilities.extensions[0].params.browserPayment);
      expect(agentCard.json.payment.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(agentCard.json.payment.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(agentCard.json.officialCdpDiscovery.recommendedSearchQuery).toBe("marketplace listing score");
      expect(agentCard.json.payment.officialCdpDiscovery.merchantDiscoveryUrl).toContain("/merchant?payTo=0x000000000000000000000000000000000000dEaD");
      expect(agentCard.json.supportedInterfaces.map((item) => item.transport)).toEqual(["HTTP+JSON", "HTTP+JSON", "HTTP+JSON", "HTTP+JSON", "OPENAPI", "X402", "MCP", "MCP-SERVER-CARD"]);
      expect(agentCard.json.additionalInterfaces.map((item) => item.transport)).toEqual(["HTTP+JSON", "HTTP+JSON", "HTTP+JSON", "HTTP+JSON", "OPENAPI", "X402", "MCP", "MCP-SERVER-CARD"]);
      expect(agentCard.json.securitySchemes.x402.name).toBe("X-PAYMENT");
      expect(agentCard.json.security[0]).toEqual({ x402: [] });
      expect(agentCard.json.skills.map((skill) => skill.id)).toContain("agent-listing-conversion-score");
      expect(agentCard.json.skills.map((skill) => skill.id)).toContain("api-entry-route-map");
      expect(agentCard.json.skills.map((skill) => skill.id)).toContain("api-v1-entry-route-map");
      expect(agentCard.json.skills.map((skill) => skill.id)).toContain("v1-entry-route-map");
      expect(agentCard.json.skills.map((skill) => skill.id)).toContain("x402-site-audit");
      expect(agentCard.json.skills[0].examples[0]).toContain("npx awal@2.8.0 x402 pay");

      const apiAgentCard = await fetchJson(server, "/api/agent-card");
      expect(apiAgentCard.status).toBe(200);
      expectFreshDiscoveryHeaders(apiAgentCard.headers);
      expect(apiAgentCard.json.name).toBe("Listing Roast x402");
      expect(apiAgentCard.json.url).toContain("/api/listing-roast");

      const apiAgentJson = await fetchJson(server, "/api/agent.json");
      expect(apiAgentJson.status).toBe(200);
      expectFreshDiscoveryHeaders(apiAgentJson.headers);
      expect(apiAgentJson.json.name).toBe("Listing Roast x402");
      expect(apiAgentJson.json.url).toContain("/api/listing-roast");
      expect(agentCard.json.skills[0].examples[0]).toContain("/api/listing-roast");
      expect(agentCard.json.skills[0].metadata.maxAmountRequired).toBe("1000");
      expect(agentCard.json.skills.find((skill) => skill.id === "x402-discovery-audit-quick").examples[0]).toContain("/api/x402-discovery-audit");
      expect(agentCard.json.skills.find((skill) => skill.id === "x402-discovery-audit-quick").metadata.maxAmountRequired).toBe("1000");
      expect(agentCard.json.skills.find((skill) => skill.id === "x402-discovery-audit").examples[0]).toContain("/api/x402-discovery-audit");
      expect(agentCard.json.skills.find((skill) => skill.id === "x402-discovery-audit").metadata.maxAmountRequired).toBe("10000");
      expect(agentCard.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(agentCard.json.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(agentCard.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(agentCard.json.recommendedPaidSequence[1].use).toBe("fullRoastGet");
      expect(agentCard.json.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(agentCard.json.payNowExamples.discoveryAudit.selectedActionKey).toBe("discoveryAuditQuick");
      expect(agentCard.json.payNowExamples.discoveryAudit.paidResponsePreview.route).toBe("/api/x402-discovery-audit");
      expect(agentCard.json.payNowExamples.discoveryAudit.selectedPaidSequence[0].action.path).toBe("/api/x402-discovery-audit");
      expect(agentCard.json.payNowExamples.discoveryAudit.buyerInstruction).toContain("For this exact buyer intent");
      expect(agentCard.json.cashRegister).toContain("/api/cash-register");
      expect(agentCard.json.paidUsageProof.paidCompletions).toBe(0);
      expect(agentCard.json.actions).toHaveLength(PAID_RESOURCE_COUNT);
      expect(agentCard.json.paidActions).toHaveLength(PAID_RESOURCE_COUNT);
      expect(agentCard.json.tools).toHaveLength(PAID_RESOURCE_COUNT);
      expect(agentCard.json.actions[0].path).toBe("/api/listing-roast");
      expect(agentCard.json.actions[0].maxAmountRequired).toBe("1000");
      expect(agentCard.json.actions[0].x402.network).toBe("eip155:84532");
      expect(agentCard.json.tools[0].preferredFirstPaidAction).toBe(true);
      expect(agentCard.json.metadata.x402Manifest).toContain("/x402.json");
      expect(agentCard.json.metadata.iconUrl).toContain("/icon.svg");
      expect(agentCard.json.metadata.llmsAliases[0]).toContain("/.well-known/llms.txt");
      expect(agentCard.json.metadata.agentSkills).toContain("/.well-known/agent-skills/index.json");
      expect(agentCard.json.metadata.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(agentCard.json.metadata.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(agentCard.json.metadata.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(agentCard.json.metadata.payNowExamples.fullRoast.method).toBe("GET");
      expect(agentCard.json.metadata.payNowExamples.fullRoast.selectedFirstPaidAction.path).toBe("/api/full-listing-roast");
      expect(agentCard.json.metadata.paidUsageProof.estimatedGrossRevenueUsd).toBe("0.00");
      expect(agentCard.json.metadata.settlementProof.evidenceFields).toContain("estimatedGrossRevenueUsd");
      expect(agentCard.json.metadata.officialCdpDiscovery.indexedRoute).toBe("http://localhost:8787/api/listing-roast");
      expect(agentCard.json.metadata.preflightAliases).toContain("http://localhost:8787/api/preflight");
      expect(agentCard.json.metadata.preflightAliases).toContain("http://localhost:8787/api/v1/preflight");
      expect(agentCard.json.metadata.preflightAliases).toContain("http://localhost:8787/preflight");
      expect(agentCard.json.metadata.a2aTaskEndpointAvailable).toBe(false);

      const agentJson = await fetchJson(server, "/.well-known/agent.json");
      expect(agentJson.status).toBe(200);
      expectFreshDiscoveryHeaders(agentJson.headers);
      expect(agentJson.json.skills[0].id).toBe(agentCard.json.skills[0].id);

      const aiPlugin = await fetchJson(server, "/.well-known/ai-plugin.json");
      expect(aiPlugin.status).toBe(200);
      expectFreshDiscoveryHeaders(aiPlugin.headers);
      expect(aiPlugin.json.schema_version).toBe("v1");
      expect(aiPlugin.json.name_for_model).toBe("listing_roast_x402");
      expect(aiPlugin.json.description_for_human).toContain("x402 marketplace conversion");
      expect(aiPlugin.json.description_for_human).toContain("agent listing conversion score");
      expect(aiPlugin.json.description_for_model).toContain("x402 payment");
      expect(aiPlugin.json.description_for_model).toContain("/api/listing-roast");
      expect(aiPlugin.json.description_for_model).toContain("x402 marketplace conversion");
      expect(aiPlugin.json.description_for_model).toContain("agent listing conversion score");
      expect(aiPlugin.json.auth.type).toBe("none");
      expect(aiPlugin.json.api.type).toBe("openapi");
      expect(aiPlugin.json.api.url).toContain("/.well-known/openapi.json");
      expect(aiPlugin.json.commands).toContain("/api/commands");
      expect(aiPlugin.json.links.commands).toContain("/api/commands");
      expect(aiPlugin.json.officialCdpDiscovery.indexedRoute).toBe("http://localhost:8787/api/listing-roast");
      expect(aiPlugin.json.x_listing_roast.commands).toContain("/api/commands");
      expect(aiPlugin.json.x_listing_roast.links.commands).toContain("/api/commands");
      expect(aiPlugin.json.x_listing_roast.agentSkills).toContain("/.well-known/agent-skills/index.json");
      expect(aiPlugin.json.x_listing_roast.recommendedFirstPaidAction.maxAmountRequired).toBe("1000");
      expect(aiPlugin.json.x_listing_roast.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(aiPlugin.json.x_listing_roast.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(aiPlugin.json.x_listing_roast.recommendedPaidSequence[1].use).toBe("fullRoastGet");
      expect(aiPlugin.json.x_listing_roast.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(aiPlugin.json.x_listing_roast.preflightAliases).toContain("http://localhost:8787/api/preflight");
      expect(aiPlugin.json.x_listing_roast.preflightAliases).toContain("http://localhost:8787/api/v1/preflight");
      expect(aiPlugin.json.x_listing_roast.preflightAliases).toContain("http://localhost:8787/preflight");
      expect(aiPlugin.json.x_listing_roast.payNowExamples.skipReasons.selectedActionKey).toBe("buyerAgentSkipReasons");
      expect(aiPlugin.json.x_listing_roast.payNowExamples.skipReasons.selectedFirstPaidResponsePreview.route).toBe("/api/listing-roast");
      expect(aiPlugin.json.x_listing_roast.officialCdpDiscovery.refreshRule).toContain("unpaid probes do not refresh");
      expect(aiPlugin.json.x_listing_roast.cashRegister).toContain("/api/cash-register");
      expect(aiPlugin.json.x_listing_roast.paidUsageProof.paidCompletions).toBe(0);
      expect(aiPlugin.json.x_listing_roast.settlementProof.evidenceFields).toContain("paidCompletions");

      const apiCatalogHead = await fetch(`http://127.0.0.1:${server.address().port}/.well-known/api-catalog`, { method: "HEAD" });
      expect(apiCatalogHead.status).toBe(200);
      expectFreshDiscoveryHeaders(apiCatalogHead.headers);
      expect(apiCatalogHead.headers.get("content-type")).toContain("application/linkset+json");
      expect(apiCatalogHead.headers.get("content-type")).toContain("rfc9727");
      expect(apiCatalogHead.headers.get("link")).toContain("rel=\"api-catalog\"");

      const apiCatalog = await fetchJson(server, "/.well-known/api-catalog");
      expect(apiCatalog.status).toBe(200);
      expectFreshDiscoveryHeaders(apiCatalog.headers);
      expect(apiCatalog.headers.get("content-type")).toContain("application/linkset+json");
      expect(apiCatalog.headers.get("content-type")).toContain("rfc9727");
      expect(apiCatalog.json.linkset[0].anchor).toContain("/.well-known/api-catalog");
      expect(apiCatalog.json.linkset[0].item[0].href).toBe("http://localhost:8787/api/listing-roast");
      expect(apiCatalog.json.linkset[0].item[0].title).toContain("preferred first");
      QUICK_SCORE_ALIAS_PATHS.forEach((aliasPath, index) => {
        expect(apiCatalog.json.linkset[0].item[index + 1].href).toBe(`http://localhost:8787${aliasPath}`);
        expect(apiCatalog.json.linkset[0].item[index + 1].title).toContain("quick-score alias");
      });
      const apiCatalogItemsByHref = Object.fromEntries(apiCatalog.json.linkset[0].item.map((item) => [item.href, item]));
      expect(apiCatalogItemsByHref["http://localhost:8787/api/marketplace-listing-score"].title).toBe("GET $0.001 marketplace listing score quick-score alias");
      expect(apiCatalogItemsByHref["http://localhost:8787/api/marketplace-listing-conversion-api"].title).toBe("GET $0.001 marketplace listing conversion API exact-path quick-score alias");
      expect(apiCatalogItemsByHref["http://localhost:8787/api/marketplace-listing-conversion"].title).toBe("GET $0.001 marketplace listing conversion API quick-score alias");
      expect(apiCatalogItemsByHref["http://localhost:8787/api/marketplace-product-listing-quality"].title).toBe("GET $0.001 marketplace product listing quality quick-score alias");
      expect(apiCatalogItemsByHref["http://localhost:8787/api/paid-api-listing-quality"].title).toBe("GET $0.001 paid API listing quality quick-score alias");
      expect(apiCatalogItemsByHref["http://localhost:8787/api/paid-api-listing-quality-score"].title).toBe("GET $0.001 paid API listing quality score quick-score alias");
      expect(apiCatalogItemsByHref["http://localhost:8787/api/listing-quality-score-api"].title).toBe("GET $0.001 listing quality score API quick-score alias");
      expect(apiCatalogItemsByHref["http://localhost:8787/api/agentcore-x402-payments"].title).toBe("GET $0.001 AgentCore Gateway search_resources quick-score alias");
      expect(apiCatalogItemsByHref["http://localhost:8787/api/coinbase-x402-bazaar-mcp-server"].title).toBe("GET $0.001 Coinbase x402 Bazaar MCP search_resources proxy_tool_call quick-score alias");
      expect(apiCatalogItemsByHref["http://localhost:8787/api/x402-listing-quality"].title).toBe("GET $0.001 x402 listing quality quick-score alias");
      expect(apiCatalogItemsByHref["http://localhost:8787/api/buyer-agent-skip-reasons"].title).toBe("GET $0.001 buyer-agent skip reasons quick-score alias");
      expect(apiCatalogItemsByHref["http://localhost:8787/api/agent-service-clarity"].title).toBe("GET $0.001 agent service clarity quick-score alias");
      expect(apiCatalog.json.linkset[0].item[QUICK_SCORE_ALIAS_PATHS.length + 1].href).toBe("http://localhost:8787/");
      expect(apiCatalog.json.linkset[0].item[QUICK_SCORE_ALIAS_PATHS.length + 1].title).toContain("root directory handoff");
      expect(apiCatalog.json.linkset[0].item.map((item) => item.href)).toContain("http://localhost:8787/api/v1");
      expect(apiCatalog.json.linkset[0].item.map((item) => item.href)).toContain("http://localhost:8787/v1");
      expect(apiCatalog.json.linkset[0].item.map((item) => item.href)).toContain("http://localhost:8787/api/listing-roast");
      QUICK_SCORE_ALIAS_PATHS.forEach((aliasPath) => {
        expect(apiCatalog.json.linkset[0].item.map((item) => item.href)).toContain(`http://localhost:8787${aliasPath}`);
      });
      expect(apiCatalog.json.linkset[0].item.map((item) => item.href)).toContain("http://localhost:8787/api/agent-listing-conversion");
      expect(apiCatalog.json.linkset[0].item.map((item) => item.href)).toContain("http://localhost:8787/api/preflight");
      expect(apiCatalog.json.linkset[0].item.map((item) => item.href)).toContain("http://localhost:8787/api/v1/preflight");
      expect(apiCatalog.json.linkset[0].item.map((item) => item.href)).toContain("http://localhost:8787/preflight");
      expect(apiCatalog.json.linkset[0].item.map((item) => item.href)).toContain("http://localhost:8787/api/pricing");
      expect(apiCatalog.json.linkset[0].item.map((item) => item.href)).toContain("http://localhost:8787/api/find");
      expect(apiCatalog.json.linkset[0].item.map((item) => item.href)).toContain("http://localhost:8787/api/route");
      expect(apiCatalog.json.linkset[0].item.map((item) => item.href)).toContain("http://localhost:8787/api/commands");
      expect(apiCatalog.json.linkset[0].item.map((item) => item.href)).toContain("http://localhost:8787/v2/x402/discovery/resources");
      expect(apiCatalog.json.linkset[0].item.map((item) => item.href)).toContain("http://localhost:8787/v2/x402/discovery/search");
      expect(apiCatalog.json.linkset[0].item.map((item) => item.href)).toContain("http://localhost:8787/v2/x402/discovery/merchant");
      expect(apiCatalog.json.linkset[0]["service-desc"][0].href).toContain("/openapi.json");
      expect(apiCatalog.json.linkset[0]["service-desc"].map((item) => item.href)).toContain("http://localhost:8787/api/v1/openapi.json");
      expect(apiCatalog.json.linkset[0]["service-doc"].map((item) => item.href)).toContain("http://localhost:8787/AGENTS.md");
      expect(apiCatalog.json.linkset[0]["service-doc"].map((item) => item.href)).toContain("http://localhost:8787/docs");
      expect(apiCatalog.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/x402.json");
      expect(apiCatalog.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/.well-known/ai-plugin.json");
      expect(apiCatalog.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/.well-known/agent-tools.json");
      expect(apiCatalog.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/.well-known/agent-skills/index.json");
      expect(apiCatalog.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/.well-known/mcp/server-card.json");
      expect(apiCatalog.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/llms-full.txt");
      expect(apiCatalog.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/api/pricing");
      expect(apiCatalog.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/api/find");
      expect(apiCatalog.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/api/route");
      expect(apiCatalog.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/api/commands");
      expect(apiCatalog.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/api/cash-register");
      expect(apiCatalog.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/v2/x402/discovery/resources");
      expect(apiCatalog.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/v2/x402/discovery/search");
      expect(apiCatalog.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/v2/x402/discovery/merchant");
      expect(apiCatalog.json.linkset[0]["payment-handoff"].map((item) => item.href)).toContain("http://localhost:8787/api/pay-now?intent=paid%20API%20listing%20quality%20score");
      expect(apiCatalog.json.linkset[0]["payment-handoff"].map((item) => item.href)).toContain("http://localhost:8787/api/pay-now?intent=full%20roast%20rewrite%20top%20fixes");
      expect(apiCatalog.json.linkset[0]["payment-handoff"].map((item) => item.href)).toContain("http://localhost:8787/api/pay-now?intent=x402%20discovery%20audit");
      expect(apiCatalog.json.linkset[0]["command-handoff"].map((item) => item.href)).toContain("http://localhost:8787/api/commands?intent=marketplace%20listing%20score");
      expect(apiCatalog.json.linkset[0]["command-handoff"].map((item) => item.href)).toContain("http://localhost:8787/api/commands?intent=buyer-agent%20skip%20reasons");
      expect(apiCatalog.json.linkset[0]["command-handoff"].map((item) => item.href)).toContain("http://localhost:8787/api/commands?intent=full%20roast%20rewrite%20top%20fixes");
      expect(apiCatalog.json.linkset[0]["recommended-paid-sequence"][0].href).toBe("http://localhost:8787/api/listing-roast");
      expect(apiCatalog.json.linkset[0]["recommended-paid-sequence"][0].method).toBe("GET");
      expect(apiCatalog.json.linkset[0]["recommended-paid-sequence"][0].maxAmountRequired).toBe("1000");
      expect(apiCatalog.json.linkset[0]["recommended-paid-sequence"][0].agentPaymentRequest.maxPayment).toBe("0.001");
      expect(apiCatalog.json.linkset[0]["recommended-paid-sequence"][0].agentPaymentPrompt).toContain("pay up to 0.001 USDC");
      expect(apiCatalog.json.linkset[0]["recommended-paid-sequence"][0].command).toContain("x402 pay 'http://localhost:8787/api/listing-roast'");
      expect(apiCatalog.json.linkset[0]["recommended-paid-sequence"][0].command).toContain("-X GET");
      expect(apiCatalog.json.linkset[0]["recommended-paid-sequence"][0].command).toContain("--max-amount 1000");
      expect(apiCatalog.json.linkset[0]["recommended-paid-sequence"][0].expectedChallenge).toEqual({
        status: 402,
        network: "eip155:84532",
        amount: "1000",
        route: "http://localhost:8787/api/listing-roast"
      });
      expect(apiCatalog.json.linkset[0]["recommended-paid-sequence"][1].href).toBe("http://localhost:8787/api/full-listing-roast");
      expect(apiCatalog.json.linkset[0]["recommended-paid-sequence"][1].method).toBe("GET");
      expect(apiCatalog.json.linkset[0]["recommended-paid-sequence"][1].maxAmountRequired).toBe("10000");
      expect(apiCatalog.json.linkset[0]["recommended-paid-sequence"][1].agentPaymentRequest.maxPayment).toBe("0.01");
      expect(apiCatalog.json.linkset[0]["recommended-paid-sequence"][1].agentPaymentPrompt).toContain("pay up to 0.01 USDC");
      expect(apiCatalog.json.linkset[0]["recommended-paid-sequence"][1].command).toContain("x402 pay 'http://localhost:8787/api/full-listing-roast'");
      expect(apiCatalog.json.linkset[0]["recommended-paid-sequence"][1].command).toContain("-X GET");
      expect(apiCatalog.json.linkset[0]["recommended-paid-sequence"][1].command).toContain("--max-amount 10000");
      expect(apiCatalog.json.linkset[0]["official-cdp-discovery"][0].href).toBe("http://localhost:8787/api/listing-roast");
      expect(apiCatalog.json.linkset[0]["official-cdp-discovery"][0].indexedRouteReason).toContain("already-settled");
      expect(apiCatalog.json.linkset[0]["official-cdp-discovery"][1].href).toContain("/search?query=marketplace+listing+score");
      expect(apiCatalog.json.linkset[0]["official-cdp-discovery"][2].href).toContain("/merchant?payTo=0x000000000000000000000000000000000000dEaD");
      expect(apiCatalog.json.linkset[0]["paid-use-proof"][0].href).toBe("http://localhost:8787/api/paid-usage-proof");
      expect(apiCatalog.json.linkset[0]["paid-use-proof"][0].title).toContain("0 paid completions");
      expect(apiCatalog.json.linkset[0]["paid-use-proof"][0].paidCompletions).toBe(0);
      expect(apiCatalog.json.linkset[0]["paid-use-proof"][0].estimatedGrossRevenueUsd).toBe("0.00");
      expect(apiCatalog.json.linkset[0]["paid-use-proof"][0].preferredConvertedRoute.path).toBe("/api/listing-roast");
      expect(apiCatalog.json.linkset[0].status[0].href).toContain("/health");
      expect(apiCatalog.json.linkset[0].status.map((item) => item.href)).toContain("http://localhost:8787/api/cash-register");
      expect(apiCatalog.json.linkset[0].status.find((item) => item.href === "http://localhost:8787/api/cash-register").title).toContain("0 paid completions");

      const apiCatalogJsonAlias = await fetchJson(server, "/.well-known/api-catalog.json");
      expect(apiCatalogJsonAlias.status).toBe(200);
      expectFreshDiscoveryHeaders(apiCatalogJsonAlias.headers);
      expect(apiCatalogJsonAlias.headers.get("content-type")).toContain("application/linkset+json");
      expect(apiCatalogJsonAlias.json.linkset[0].item.map((item) => item.href)).toContain("http://localhost:8787/api/sample");
      expect(apiCatalogJsonAlias.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/schema.json");
      expect(apiCatalogJsonAlias.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/.well-known/api-catalog.json");
      expect(apiCatalogJsonAlias.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/.well-known/mcp-server.json");
      expect(apiCatalogJsonAlias.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/mcp");

      const agentSkillsHead = await fetch(`http://127.0.0.1:${server.address().port}/.well-known/agent-skills/index.json`, { method: "HEAD" });
      expect(agentSkillsHead.status).toBe(200);
      expectFreshDiscoveryHeaders(agentSkillsHead.headers);
      expect(agentSkillsHead.headers.get("content-type")).toContain("application/json");

      const agentSkills = await fetchJson(server, "/.well-known/agent-skills/index.json");
      expect(agentSkills.status).toBe(200);
      expectFreshDiscoveryHeaders(agentSkills.headers);
      expect(agentSkills.headers.get("access-control-allow-origin")).toBe("*");
      expect(agentSkills.json.$schema).toBe("https://schemas.agentskills.io/discovery/0.2.0/schema.json");
      expect(agentSkills.json.service).toBe("Listing Roast x402");
      expect(agentSkills.json.serviceName).toBe("Listing Roast x402");
      expect(agentSkills.json.metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(agentSkills.json.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(agentSkills.json.metadataUpdatedAt).toBe("2026-06-21T03:14:35.000Z");
      expect(agentSkills.json.metadata_updated_at).toBe("2026-06-21T03:14:35.000Z");
      expect(agentSkills.json.keywords).toContain("x402 discovery audit");
      expect(agentSkills.json.intentLandingPages.map((page) => page.path)).toContain("/x402-discovery-audit");
      expect(agentSkills.json.skills[0].name).toBe("listing-roast-x402");
      expect(agentSkills.json.skills[0].type).toBe("skill-md");
      expect(agentSkills.json.skills[0].url).toContain("/.well-known/agent-skills/listing-roast-x402/SKILL.md");
      expect(agentSkills.json.commands).toContain("/api/commands");
      expectBrowserPaymentSupport(agentSkills.json.browserPayment);
      expect(agentSkills.json.links.commands).toContain("/api/commands");
      expect(agentSkills.json.links.x402ManifestAliases).toContain("http://localhost:8787/.well-known/payments.json");
      expect(agentSkills.json.links.openApiAliases).toContain("http://localhost:8787/api/openapi.json");
      expect(agentSkills.json.links.openApiYamlAliases).toContain("http://localhost:8787/.well-known/openapi.yaml");
      expect(agentSkills.json.links.mcpAliases).toContain("http://localhost:8787/mcp.json");
      expect(agentSkills.json.links.mcpServerCardAliases).toContain("http://localhost:8787/mcp/server-card.json");
      expect(agentSkills.json.payment.commands).toContain("/api/commands");
      expect(agentSkills.json.payment.manifestAliases).toContain("http://localhost:8787/payment.json");
      expect(agentSkills.json.payment.cashRegister).toContain("/api/cash-register");
      expect(agentSkills.json.payment.paidUsageProof.paidCompletions).toBe(0);
      expect(agentSkills.json.payment.paidUsageProof.proofText).toContain("0 paid completions");
      expect(agentSkills.json.officialCdpDiscovery.indexedRoute).toBe("http://localhost:8787/api/listing-roast");
      expect(agentSkills.json.payment.officialCdpDiscovery.recommendedSearchUrl).toContain("maxUsdPrice=0.001");
      expect(agentSkills.json.payment.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(agentSkills.json.payment.exactIntentPaidActions.buyerAgentSkipReasons.path).toBe("/api/buyer-agent-skip-reasons");
      expect(agentSkills.json.payment.exactIntentPaidActions.discoveryAuditQuick.path).toBe("/api/x402-discovery-audit");
      expect(agentSkills.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(agentSkills.json.cashRegister).toContain("/api/cash-register");
      expect(agentSkills.json.paidUsageProof.proofText).toContain("0 paid completions");
      expect(agentSkills.json.exactIntentPaidActions.paidApiListingQuality.path).toBe("/api/paid-api-listing-quality");
      expect(agentSkills.json.exactIntentPaidActions.discoveryAuditQuick.maxAmountRequired).toBe("1000");
      expect(agentSkills.json.routeFinderExamples.join(" ")).toContain("x402%20discovery%20audit");
      expect(agentSkills.json.routeFinderExamples.join(" ")).toContain("listing%20roast%20full%20rewrite");
      expect(agentSkills.json.localRouterExamples.join(" ")).toContain("buyer-agent%20skip%20reasons");
      expect(agentSkills.json.localRouterExamples.join(" ")).toContain("listing%20roast%20full%20rewrite");
      expect(agentSkills.json.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(agentSkills.json.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(agentSkills.json.skills[0].metadata.commands).toContain("/api/commands");
      expect(agentSkills.json.skills[0].metadata.cashRegister).toContain("/api/cash-register");
      expect(agentSkills.json.skills[0].metadata.paidUsageProof.proofText).toContain("0 paid completions");
      expect(agentSkills.json.skills[0].metadata.officialCdpDiscovery.refreshRule).toContain("real settlement");
      expect(agentSkills.json.skills[0].metadata.x402ManifestAliases).toContain("http://localhost:8787/payments.json");
      expect(agentSkills.json.skills[0].metadata.openApiAliases).toContain("http://localhost:8787/api-docs/openapi.json");
      expect(agentSkills.json.skills[0].metadata.mcpAliases).toContain("http://localhost:8787/mcp.json");
      expect(agentSkills.json.skills[0].metadata.exactIntentPaidActions.discoveryAuditQuick.path).toBe("/api/x402-discovery-audit");
      expect(agentSkills.json.skills[0].metadata.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");

      const agentSkillHead = await fetch(`http://127.0.0.1:${server.address().port}/.well-known/agent-skills/listing-roast-x402/SKILL.md`, { method: "HEAD" });
      expect(agentSkillHead.status).toBe(200);
      expectFreshDiscoveryHeaders(agentSkillHead.headers);
      expect(agentSkillHead.headers.get("content-type")).toContain("text/markdown");

      const agentSkill = await fetchJson(server, "/.well-known/agent-skills/listing-roast-x402/SKILL.md");
      expect(agentSkill.status).toBe(200);
      expectFreshDiscoveryHeaders(agentSkill.headers);
      expect(agentSkill.headers.get("access-control-allow-origin")).toBe("*");
      expect(agentSkill.text).toContain("name: listing-roast-x402");
      expect(agentSkill.text).toContain("Do not call paid routes unless the buyer explicitly intends to pay");
      expect(agentSkill.text).toContain("Recommended Paid Sequence");
      expect(agentSkill.text).toContain("Paid-Use Proof Before Payment");
      expect(agentSkill.text).toContain("Paid-use proof before payment: 0 paid completions; $0.00 registered.");
      expect(agentSkill.text).toContain("/api/paid-usage-proof");
      expect(agentSkill.text).toContain("/api/cash-register");
      expect(agentSkill.text).toContain("Full roast command");
      expect(agentSkill.text).toContain("/api/pay-now?intent=full%20roast%20rewrite%20top%20fixes");
      expect(agentSkill.text).toContain("/api/find?q=listing%20roast%20full%20rewrite");
      expect(agentSkill.text).toContain("/api/route?query=listing%20roast%20full%20rewrite&top=3");
      expect(agentSkill.text).toContain("Agent payment prompt: Call this x402 endpoint with GET and pay up to 0.001 USDC: http://localhost:8787/api/listing-roast");
      expect(agentSkill.text).toContain("/api/listing-roast");
      expect(agentSkill.text).toContain("/api/agent-listing-conversion");
      expect(agentSkill.text).toContain("/api/preflight");
      expect(agentSkill.text).toContain("/api/v1/preflight");
      expect(agentSkill.text).toContain("/preflight");
      expect(agentSkills.json.skills[0].digest).toBe(`sha256:${createHash("sha256").update(agentSkill.text).digest("hex")}`);

      const examples = await fetchJson(server, "/api/examples");
      expect(examples.status).toBe(200);
      expect(examples.json.builder).toContain("/builder");
      expect(examples.json.openApi).toContain("/openapi.json");
      expect(examples.json.openApiAliases[0]).toContain("/.well-known/openapi.json");
      expect(examples.json.openApiAliases).toContain("http://localhost:8787/api/v1/openapi.json");
      expect(examples.json.openApiAliases).toContain("http://localhost:8787/swagger.json");
      expect(examples.json.openApiYaml).toContain("/openapi.yaml");
      expect(examples.json.docs).toContain("/docs");
      expect(examples.json.apiDocs).toContain("/api-docs");
      expect(examples.json.agentsMarkdown).toContain("/AGENTS.md");
      expect(examples.json.llms).toContain("/llms.txt");
      expect(examples.json.llmsFull).toContain("/llms-full.txt");
      expect(examples.json.markdown).toContain("/index.md");
      expect(examples.json.x402Manifest).toContain("/x402.json");
      expect(examples.json.x402ManifestAliases.some((url) => url.endsWith("/.well-known/x402"))).toBe(true);
      expect(examples.json.agentCard).toContain("/.well-known/agent-card.json");
      expect(examples.json.agentCardAliases[0]).toContain("/.well-known/agent.json");
      expect(examples.json.aiPlugin).toContain("/.well-known/ai-plugin.json");
      expect(examples.json.apiCatalog).toContain("/.well-known/api-catalog");
      expect(examples.json.agentTools).toContain("/.well-known/agent-tools.json");
      expect(examples.json.agentSkills).toContain("/.well-known/agent-skills/index.json");
      expect(examples.json.agentSkill).toContain("/.well-known/agent-skills/listing-roast-x402/SKILL.md");
      expect(examples.json.mcp).toContain("/.well-known/mcp.json");
      expect(examples.json.mcpAliases[1]).toContain("/.well-known/mcp-server");
      expect(examples.json.mcpServerCard).toContain("/.well-known/mcp/server-card.json");
      expect(examples.json.commands).toContain("/api/commands");
      expect(examples.json.compactCommandHandoff.firstPaidAction.path).toBe("/api/listing-roast");
      expect(examples.json.compactCommandHandoff.exactIntentPaidAction.path).toBe("/api/paid-api-listing-quality");
      expect(examples.json.compactCommandHandoff.buyerPhraseCommandPack[0].exactIntentPaidAction.path).toBe("/api/paid-api-listing-quality-score");
      expect(examples.json.officialCdpDiscovery.indexedRoute).toBe("http://localhost:8787/api/listing-roast");
      expect(examples.json.officialCdpDiscovery.recommendedSearchUrl).toContain("maxUsdPrice=0.001");
      expect(examples.json.buyerPhraseCommandPack[0].firstPaidAction.path).toBe("/api/listing-roast");
      expect(examples.json.buyerPhraseCommandPack[0].command).toContain("/api/listing-roast");
      expect(examples.json.buyerPhraseCommandPack[0].exactIntentCommand).toContain("/api/paid-api-listing-quality-score");
      expect(examples.json.payNowUrl).toContain("/api/pay-now");
      expect(examples.json.paidUsageProofUrl).toContain("/api/paid-usage-proof");
      expect(examples.json.cashRegister).toContain("/api/cash-register");
      expect(examples.json.paidUsageProof.paidCompletions).toBe(0);
      expect(examples.json.paidUsageProof.noSpend).toBe(true);
      expect(examples.json.paidUsageProof.preferredConvertedRoute.path).toBe("/api/listing-roast");
      expect(examples.json.settlementProof.cashRegister).toContain("/api/cash-register");
      expect(examples.json.payNowExamples.skipReasons.selectedActionKey).toBe("buyerAgentSkipReasons");
      expect(examples.json.payNowExamples.skipReasons.route).toContain("/api/listing-roast");
      expect(examples.json.payNowExamples.skipReasons.selectedFirstPaidAction.path).toBe("/api/listing-roast");
      expect(examples.json.payNowExamples.skipReasons.paidResponsePreview.route).toBe("/api/listing-roast");
      expect(examples.json.payNowExamples.skipReasons.paymentShortcut.firstPaidPath).toBe("/api/listing-roast");
      expect(examples.json.payNowExamples.skipReasons.paymentShortcut.upgradeAfterQuickScore.selectedPaidPath).toBe("/api/full-listing-roast");
      expect(examples.json.payNowExamples.skipReasons.paidResponsePreview.upgradeAfterQuickScore.selectedPaidMaxAmountRequired).toBe("10000");
      expect(examples.json.payNowExamples.skipReasons.paidUsageProof.noSpend).toBe(true);
      expect(examples.json.payNowExamples.discoveryAudit.selectedActionKey).toBe("discoveryAuditQuick");
      expect(examples.json.payNowExamples.discoveryAudit.route).toContain("/api/x402-discovery-audit");
      expect(examples.json.payNowExamples.discoveryAudit.paidResponsePreview.example.endpoint).toBe("x402-discovery-audit-quick");
      expect(examples.json.payNowExamples.fullRoast.selectedActionKey).toBe("fullRoastGet");
      expect(examples.json.payNowExamples.fullRoast.selectedFirstPaidAction.path).toBe("/api/full-listing-roast");
      expect(examples.json.payNowExamples.fullRoast.maxAmountRequired).toBe("10000");
      expect(examples.json.pricing).toContain("/api/pricing");
      expect(examples.json.find).toContain("/api/find");
      expect(examples.json.route).toContain("/api/route");
      expect(examples.json.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(examples.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(examples.json.recommendedPaidSequence[1].use).toBe("fullRoastGet");
      expect(examples.json.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(examples.json.localDiscovery.resources).toContain("/v2/x402/discovery/resources");
      expect(examples.json.localDiscovery.officialCdpDiscovery.recommendedSearchQuery).toBe("marketplace listing score");
      expect(examples.json.localDiscovery.searchExample.resources[0].metadata.path).toBe("/api/x402-discovery-audit");
      expect(examples.json.localDiscovery.merchantExample.resources).toHaveLength(20);
      expect(examples.json.localDiscovery.merchantExample.pagination.total).toBe(PAID_RESOURCE_COUNT);
      expect(examples.json.pricingCatalog.count).toBe(PAID_RESOURCE_COUNT);
      expect(examples.json.pricingCatalog.routes[0].path).toBe("/api/listing-roast");
      expect(examples.json.findExamples.discoveryAudit.recommended.path).toBe("/api/x402-discovery-audit");
      expect(examples.json.findExamples.skipReasons.recommended.path).toBe("/api/listing-roast");
      expect(examples.json.findExamples.skipReasons.exactIntentPaidAction.path).toBe("/api/buyer-agent-skip-reasons");
      expect(examples.json.findExamples.skipReasons.rankedPaidRoutes[0].path).toBe("/api/listing-roast");
      expect(examples.json.findExamples.skipReasons.alternatives.map((route) => route.path)).toContain("/api/buyer-agent-skip-reasons");
      expect(examples.json.findExamples.skipReasons.alternatives.map((route) => route.path)).toContain("/api/agent-listing-conversion");
      expect(examples.json.findExamples.customScore.recommended.id).toBe("listing_score");
      expect(examples.json.findExamples.customScore.recommended.method).toBe("POST");
      expect(examples.json.findExamples.fullRewrite.recommended.id).toBe("full_listing_roast_get");
      expect(examples.json.findExamples.fullRewrite.recommended.path).toBe("/api/full-listing-roast");
      expect(examples.json.routeExamples.discoveryAudit.results[0].path).toBe("/api/x402-discovery-audit");
      expect(examples.json.routeExamples.skipReasons.results[0].path).toBe("/api/listing-roast");
      expect(examples.json.routeExamples.skipReasons.exactIntentPaidAction.path).toBe("/api/buyer-agent-skip-reasons");
      expect(examples.json.routeExamples.skipReasons.results.map((route) => route.path)).toContain("/api/buyer-agent-skip-reasons");
      expect(examples.json.routeExamples.skipReasons.results.map((route) => route.path)).toContain("/api/agent-listing-conversion");
      expect(examples.json.routeExamples.customScore.results[0].id).toBe("listing_score");
      expect(examples.json.routeExamples.customScore.results[0].method).toBe("POST");
      expect(examples.json.routeExamples.fullRewrite.results[0].path).toBe("/api/full-listing-roast");
      expect(examples.json.payNow.route).toContain("/api/listing-roast");
      expect(examples.json.payNow.command).toContain("--max-amount 1000");
      expect(examples.json.payNow.metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(examples.json.payNow.paymentShortcut.selectedPaidPath).toBe("/api/listing-roast");
      expect(examples.json.payNow.paymentShortcut.upgradeAfterQuickScore.selectedPaidPath).toBe("/api/full-listing-roast");
      expect(examples.json.compactCommandHandoff.paymentShortcut.firstPaidPath).toBe("/api/listing-roast");
      expect(examples.json.compactCommandHandoff.paymentShortcut.upgradeAfterQuickScore.selectedPaidMaxAmountRequired).toBe("10000");
      expect(examples.json.payNow.noSpendNote).toContain("Fetching this endpoint is free");
      expect(examples.json.apiEntryRoute).toContain("/api");
      expect(examples.json.apiV1EntryRoute).toContain("/api/v1");
      expect(examples.json.v1EntryRoute).toContain("/v1");
      expect(examples.json.keywords).toContain("marketplace listing conversion API");
      expect(examples.json.keywords).toContain("marketplace listing conversion");
      expect(examples.json.instantScoreRoute).toContain("/api/instant-listing-score");
      expect(examples.json.conversionScoreRoute).toContain("/api/x402-marketplace-conversion");
      expect(examples.json.agentListingConversionRoute).toContain("/api/agent-listing-conversion-score");
      expect(examples.json.agentListingConversionCanonicalRoute).toContain("/api/agent-listing-conversion");
      expect(examples.json.indexedRoastGetRoute).toContain("/api/listing-roast");
      expect(examples.json.pingRoute).toContain("/api/x402-ping");
      expect(examples.json.siteAuditRoute).toContain("/api/x402-site-audit");
      expect(examples.json.discoveryAuditRoute).toContain("/api/x402-discovery-audit");
      expect(examples.json.instantScorePrice).toBe("$0.001");
      expect(examples.json.siteAuditPrice).toBe("$0.001");
      expect(examples.json.recommendedFirstPaidAction.route).toContain("/api/listing-roast");
      expect(examples.json.recommendedFirstPaidAction.maxAmountRequired).toBe("1000");
      expect(examples.json.paymentHints.apiEntry.maxAmountRequired).toBe("1000");
      expect(examples.json.paymentHints.apiV1Entry.maxAmountRequired).toBe("1000");
      expect(examples.json.paymentHints.v1Entry.maxAmountRequired).toBe("1000");
      expect(examples.json.paymentHints.indexedRoastGet.preferredFirstPaidAction).toBe(true);
      expect(examples.json.paymentHints.indexedRoastGet.paymentShortcut.firstPaidPath).toBe("/api/listing-roast");
      expect(examples.json.paymentHints.indexedRoastGet.paymentShortcut.upgradeAfterQuickScore.selectedPaidPath).toBe("/api/full-listing-roast");
      expect(examples.json.paymentHints.instantScore.preferredFirstPaidAction).toBe(false);
      expect(examples.json.paymentHints.conversionScore.maxAmountRequired).toBe("1000");
      expect(examples.json.paymentHints.agentListingConversion.maxAmountRequired).toBe("1000");
      expect(examples.json.paymentHints.listingRoast.maxAmountRequired).toBe("10000");
      expect(examples.json.instantScoreCommand).toContain("--max-amount 1000");
      expect(examples.json.conversionScoreCommand).toContain("/api/x402-marketplace-conversion");
      expect(examples.json.conversionScoreCommand).toContain("--max-amount 1000");
      expect(examples.json.agentListingConversionCommand).toContain("/api/agent-listing-conversion-score");
      expect(examples.json.agentListingConversionCommand).toContain("--max-amount 1000");
      expect(examples.json.apiEntryCommand).toContain("x402 pay 'http://localhost:8787/api'");
      expect(examples.json.apiEntryCommand).toContain("--max-amount 1000");
      expect(examples.json.apiV1EntryCommand).toContain("x402 pay 'http://localhost:8787/api/v1'");
      expect(examples.json.apiV1EntryCommand).toContain("--max-amount 1000");
      expect(examples.json.v1EntryCommand).toContain("x402 pay 'http://localhost:8787/v1'");
      expect(examples.json.v1EntryCommand).toContain("--max-amount 1000");
      expect(examples.json.indexedRoastGetCommand).toContain("--max-amount 1000");
      expect(examples.json.pingCommand).toContain("--max-amount 1000");
      expect(examples.json.siteAuditCommand).toContain("--max-amount 1000");
      expect(examples.json.discoveryAuditQuickCommand).toContain("/api/x402-discovery-audit");
      expect(examples.json.discoveryAuditQuickCommand).toContain("--max-amount 1000");
      expect(examples.json.discoveryAuditCommand).toContain("--max-amount 10000");
      expect(examples.json.apiEntryOutput.endpoint).toBe("api-entry");
      expect(examples.json.apiEntryOutput.includedQuickScore.endpoint).toBe("listing-roast-quick-score");
      expect(examples.json.apiEntryOutput.includedQuickScore.price).toBe("$0.001");
      expect(examples.json.apiEntryOutput.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(examples.json.instantScoreOutput.price).toBe("$0.001");
      expect(examples.json.instantScoreOutput.nextPaidAction.maxAmountRequired).toBe("5000");
      expect(examples.json.instantScoreOutput.nextPaidAction.command).toContain("/api/listing-score");
      expect(examples.json.conversionScoreOutput.endpoint).toBe("x402-marketplace-conversion-score");
      expect(examples.json.conversionScoreOutput.nextPaidAction.maxAmountRequired).toBe("10000");
      expect(examples.json.agentListingConversionOutput.endpoint).toBe("agent-listing-conversion-score");
      expect(examples.json.agentListingConversionOutput.route).toBe("/api/agent-listing-conversion-score");
      expect(examples.json.agentListingConversionOutput.canonicalRoute).toBe("/api/agent-listing-conversion");
      expect(examples.json.agentListingConversionOutput.nextPaidAction.maxAmountRequired).toBe("10000");
      expect(examples.json.indexedRoastGetOutput.endpoint).toBe("listing-roast-quick-score");
      expect(examples.json.indexedRoastGetOutput.matchedBuyerIntent).toContain("marketplace listing score");
      expect(examples.json.indexedRoastGetOutput.matchedBuyerIntent).toContain("paid API listing quality score");
      expect(examples.json.indexedRoastGetOutput.liteRoastPreview.type).toBe("lite-roast-preview");
      expect(examples.json.indexedRoastGetOutput.liteRoastPreview.includedIn).toContain("$0.001");
      expect(examples.json.indexedRoastGetOutput.liteRoastPreview.topFixes.length).toBeGreaterThan(0);
      expect(examples.json.indexedRoastGetOutput.liteRoastPreview.rewrittenListingPreview).toContain("Listing Roast x402");
      expect(examples.json.indexedRoastGetOutput.liteRoastPreview.stopOrUpgrade).toContain("Stop");
      expect(examples.json.indexedRoastGetOutput.liteRoastPreview.fullRoastUpgrade.path).toBe("/api/full-listing-roast");
      expect(examples.json.indexedRoastGetOutput.liteRoastPreview.fullRoastUpgrade.maxAmountRequired).toBe("10000");
      expect(examples.json.indexedRoastGetOutput.buyerSearchPhrases).toContain("paid API listing quality score");
      expect(examples.json.indexedRoastGetOutput.buyerSearchPhrases).toContain("buyer agent skip reasons");
      expect(examples.json.indexedRoastGetOutput.buyerSearchPhrases).toContain("agent service clarity");
      expect(examples.json.indexedRoastGetOutput.settlementRefreshNote).toContain("paymentPayload.resource");
      expect(examples.json.indexedRoastGetOutput.settlementRefreshNote).toContain("unpaid probes do not refresh");
      expect(examples.json.indexedRoastGetOutput.officialCdpDiscovery.indexedRoute).toBe("http://localhost:8787/api/listing-roast");
      expect(examples.json.indexedRoastGetOutput.officialCdpDiscovery.recommendedSearchQuery).toBe("marketplace listing score");
      expect(examples.json.indexedRoastGetOutput.officialCdpDiscovery.recommendedMaxUsdPrice).toBe("0.001");
      expect(examples.json.indexedRoastGetOutput.officialCdpDiscovery.recommendedSearchUrl).toContain("maxUsdPrice=0.001");
      expect(examples.json.indexedRoastGetOutput.nextPaidAction.maxAmountRequired).toBe("10000");
      expect(examples.json.indexedRoastGetOutput.nextPaidAction.command).toContain("/api/full-listing-roast");
      expect(examples.json.indexedRoastGetOutput.nextPaidAction.command).toContain("--max-amount 10000");
      expect(examples.json.indexedRoastGetOutput.nextPaidAction.agentPaymentPrompt).toContain("pay up to 0.01 USDC");
      expect(examples.json.indexedRoastGetOutput.fullRoastUpgradeDecision.revenueStep).toBe("$0.01 full roast upgrade");
      expect(examples.json.indexedRoastGetOutput.fullRoastUpgradeDecision.agentPaymentPrompt).toContain("pay up to 0.01 USDC");
      expect(examples.json.indexedRoastGetOutput.fullRoastUpgradeDecision.action.command).toContain("--max-amount 10000");
      expect(examples.json.indexedRoastGetOutput.fullRoastUpgradeDecision.action.agentPaymentPrompt).toContain("pay up to 0.01 USDC");
      expect(examples.json.indexedRoastGetOutput.fullRoastUpgradeDecision.expectedOutput).toContain("rewrittenListing");
      expect(examples.json.indexedRoastGetOutput.buyerIntentHandoffs.find((handoff) => handoff.path === "/api/full-listing-roast").maxAmountRequired).toBe("10000");
      expect(examples.json.indexedRoastGetOutput.nextPaidActions).toHaveLength(3);
      expect(examples.json.indexedRoastGetOutput.nextPaidActions[0].path).toBe("/api/full-listing-roast");
      expect(examples.json.indexedRoastGetOutput.nextPaidActions[0].maxAmountRequired).toBe("10000");
      expect(examples.json.indexedRoastGetOutput.nextPaidActions[0].agentPaymentPrompt).toContain("pay up to 0.01 USDC");
      expect(examples.json.indexedRoastGetOutput.nextPaidActions.find((action) => action.path === "/api/x402-discovery-audit").command).toContain("--max-amount 1000");
      expect(examples.json.indexedRoastGetOutput.nextPaidActions.find((action) => action.path === "/api/x402-site-audit").command).toContain("--max-amount 1000");
      expect(examples.json.indexedRoastGetOutput.nextPaidActions.find((action) => action.path === "/api/full-listing-roast").command).toContain("--max-amount 10000");
      expect(examples.json.indexedRoastGetOutput.nextPaidActions.find((action) => action.path === "/api/full-listing-roast").body).toBeUndefined();
      expect(examples.json.pingOutput.endpoint).toBe("x402-ping");
      expect(examples.json.siteAuditOutput.endpoint).toBe("x402-site-audit");
      expect(examples.json.siteAuditOutput.catalogRefresh.status).toBe("needs_settled_payment_with_resource_metadata");
      expect(examples.json.siteAuditOutput.catalogRefresh.settlementRequirements.join(" ")).toContain("paymentPayload.resource");
      expect(examples.json.discoveryAuditOutput.endpoint).toBe("x402-discovery-audit");
      expect(examples.json.discoveryAuditOutput.agent402Route.routeVisible).toBe(true);
      expect(examples.json.discoveryAuditOutput.agent402Route.matchedResult.route).toBe("/api/listing-roast");
      expect(examples.json.discoveryAuditOutput.catalogRefresh.whyUnpaidProbesAreNotEnough).toContain("do not refresh CDP Bazaar");
      expect(examples.json.discoveryAuditOutput.nextActions.join(" ")).toContain("Bazaar catalogs settled resources");
      expect(examples.json.command).toContain("x402 pay");
      expect(examples.json.scoreCommand).toContain("/api/listing-score");
      expect(examples.json.scoreOutput.price).toBe("$0.005");
      expect(examples.json.scoreOutput.upgradeEndpoint).toBe("/api/full-listing-roast");
      expect(examples.json.scoreOutput.nextPaidAction.route).toContain("/api/full-listing-roast");
      expect(examples.json.scoreOutput.nextPaidAction.method).toBe("GET");
      expect(examples.json.scoreOutput.nextPaidAction.query.source).toBe("listing-score-upgrade");
      expect(examples.json.scoreOutput.nextPaidAction.body).toBeUndefined();
      expect(examples.json.scoreOutput.nextPaidAction.command).toContain("--max-amount 10000");
      expect(examples.json.output.price).toBe("$0.01");

      const openApi = await fetchJson(server, "/openapi.json");
      expect(openApi.status).toBe(200);
      expectFreshDiscoveryHeaders(openApi.headers);
      expect(openApi.json.openapi).toBe("3.1.0");
      expect(openApi.json.info["x-openapi-profile"]).toBe("compact");
      expect(openApi.json.info["x-full-openapi"]).toBe("http://localhost:8787/openapi-full.json");
      expect(openApi.json.info["x-compact-omitted-paths"]).toEqual(COMPACT_OPENAPI_OMITTED_PATHS);
      expect(openApi.json["x-openapi-profile"].profile).toBe("compact");
      expect(openApi.json["x-openapi-profile"].routeCount).toBe(40);
      expect(openApi.json["x-openapi-profile"].fullOpenApi).toBe("http://localhost:8787/openapi-full.json");
      expect(openApi.json["x-openapi-profile"].fullOpenApiAliases).toEqual([
        "http://localhost:8787/openapi-full.json",
        "http://localhost:8787/.well-known/openapi-full.json",
        "http://localhost:8787/api/openapi-full.json"
      ]);
      expect(openApi.json["x-openapi-profile"].omittedPaths).toEqual(COMPACT_OPENAPI_OMITTED_PATHS);
      expect(countOpenApiOperations(openApi.json.paths)).toBe(40);
      COMPACT_OPENAPI_OMITTED_PATHS.forEach((pathname) => {
        expect(openApi.json.paths[pathname]).toBeUndefined();
      });
      expect(Object.keys(openApi.json.paths)[0]).toBe("/api/listing-roast");

      const wellKnownOpenApi = await fetchJson(server, "/.well-known/openapi.json");
      expect(wellKnownOpenApi.status).toBe(200);
      expectFreshDiscoveryHeaders(wellKnownOpenApi.headers);
      expect(wellKnownOpenApi.json.openapi).toBe("3.1.0");
      expect(wellKnownOpenApi.json.info.title).toBe(openApi.json.info.title);
      expect(wellKnownOpenApi.json.info["x-openapi-profile"]).toBe("compact");

      const fullOpenApi = await fetchJson(server, "/openapi-full.json");
      expect(fullOpenApi.status).toBe(200);
      expectFreshDiscoveryHeaders(fullOpenApi.headers);
      expect(fullOpenApi.json.openapi).toBe("3.1.0");
      expect(fullOpenApi.json.info.title).toBe(openApi.json.info.title);
      expect(fullOpenApi.json.info["x-openapi-profile"]).toBe("full");
      expect(fullOpenApi.json["x-openapi-profile"].profile).toBe("full");
      expect(fullOpenApi.json["x-openapi-profile"].routeCount).toBe(47);
      expect(fullOpenApi.json["x-openapi-profile"].compactOpenApi).toBe("http://localhost:8787/openapi.json");
      expect(countOpenApiOperations(fullOpenApi.json.paths)).toBe(47);
      COMPACT_OPENAPI_OMITTED_PATHS.forEach((pathname) => {
        expect(fullOpenApi.json.paths[pathname]).toBeTruthy();
      });
      expect(Object.keys(fullOpenApi.json.paths).indexOf("/api/listing-roast")).toBeLessThan(Object.keys(fullOpenApi.json.paths).indexOf("/api"));

      const wellKnownFullOpenApi = await fetchJson(server, "/.well-known/openapi-full.json");
      expect(wellKnownFullOpenApi.status).toBe(200);
      expect(wellKnownFullOpenApi.json.info["x-openapi-profile"]).toBe("full");

      const apiFullOpenApi = await fetchJson(server, "/api/openapi-full.json");
      expect(apiFullOpenApi.status).toBe(200);
      expect(apiFullOpenApi.json.info["x-openapi-profile"]).toBe("full");

      expect(openApi.json.info["x-provider-url"]).toBe("http://localhost:8787");
      expect(openApi.json.info["x-service-name"]).toBe("Listing Roast x402");
      expect(openApi.json.info["x-category"]).toBe("paid-api-listing");
      expect(openApi.json.info["x-tags"]).toContain("marketplace listing score");
      expect(openApi.json.info["x-keywords"]).toContain("x402 listing");
      expect(openApi.json.info.x402.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(openApi.json.info.x402.preferredFirstPaidAction.maxAmountRequired).toBe("1000");
      expectBrowserPaymentSupport(openApi.json.info.x402.browserPayment);
      expectBrowserPaymentSupport(openApi.json.info["x-browser-payment"]);
      expect(openApi.json.info["x-recommended-first-paid-action"].path).toBe("/api/listing-roast");
      expect(openApi.json.info["x-commands"]).toContain("/api/commands");
      expect(openApi.json.info["x-pay-now"]).toContain("/api/pay-now");
      expect(openApi.json.x402.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(openApi.json.x402.preferredFirstPaidAction.maxAmountRequired).toBe("1000");
      expect(openApi.json.x402.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(openApi.json.x402.buyerInstruction).toContain("GET /api/listing-roast");
      expectBrowserPaymentSupport(openApi.json.x402.browserPayment);
      expectBrowserPaymentSupport(openApi.json["x-browser-payment"]);
      expect(openApi.json["x-recommended-first-paid-action"].path).toBe("/api/listing-roast");
      expect(openApi.json["x-pay-now"]).toContain("/api/pay-now");
      expect(openApi.json.components.securitySchemes.x402.type).toBe("apiKey");
      expect(openApi.json.components.securitySchemes.x402.in).toBe("header");
      expect(openApi.json.components.securitySchemes.x402.name).toBe("X-PAYMENT");
      expect(openApi.json.components.securitySchemes.x402.description).toContain("HTTP 402");
      expect(fullOpenApi.json.paths["/api"].get.operationId).toBe("getListingRoastApiEntry");
      expect(fullOpenApi.json.paths["/api"].get.security).toEqual([{ x402: [] }]);
      expect(fullOpenApi.json.paths["/api"].get["x-payment"].maxAmountRequired).toBe("1000");
      expect(fullOpenApi.json.paths["/api"].get["x-price"]).toBe("$0.001");
      expect(fullOpenApi.json.paths["/api"].get.summary).toContain("$0.001");
      expect(fullOpenApi.json.paths["/api/v1"].get.operationId).toBe("getListingRoastApiV1Entry");
      expect(fullOpenApi.json.paths["/api/v1"].get["x-payment"].maxAmountRequired).toBe("1000");
      expect(fullOpenApi.json.paths["/api/v1"].get["x-price"]).toBe("$0.001");
      expect(fullOpenApi.json.paths["/api/v1"].get.summary).toContain("$0.001");
      expect(fullOpenApi.json.paths["/api/v1"].get.responses[402].headers["Payment-Required"].description).toContain("x402");
      expect(fullOpenApi.json.paths["/api/v1"].get.responses[402].content["application/json"].example.selectedPaidAction.path).toBe("/api/v1");
      expect(fullOpenApi.json.paths["/v1"].get.operationId).toBe("getListingRoastV1Entry");
      expect(fullOpenApi.json.paths["/v1"].get["x-payment"].maxAmountRequired).toBe("1000");
      expect(fullOpenApi.json.paths["/v1"].get["x-price"]).toBe("$0.001");
      expect(fullOpenApi.json.paths["/v1"].get.summary).toContain("$0.001");
      expect(openApi.json.paths["/api/instant-listing-score"].get.operationId).toBe("getInstantListingScoreX402MarketplaceConversion");
      expect(openApi.json.paths["/api/instant-listing-score"].get["x-payment"].maxAmountRequired).toBe("1000");
      expect(openApi.json.paths["/api/instant-listing-score"].get["x-payment"].preferredFirstPaidAction).toBe(false);
      expect(openApi.json.paths["/api/instant-listing-score"].get["x-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/instant-listing-score"].get["x-x402-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/instant-listing-score"].get.summary).toContain("$0.001");
      expect(openApi.json.paths["/api/instant-listing-score"].get.summary).toContain("x402 marketplace conversion");
      expect(openApi.json.paths["/api/x402-marketplace-conversion"].get.operationId).toBe("getX402MarketplaceConversionScore");
      expect(openApi.json.paths["/api/x402-marketplace-conversion"].get["x-payment"].maxAmountRequired).toBe("1000");
      expect(openApi.json.paths["/api/x402-marketplace-conversion"].get["x-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/x402-marketplace-conversion"].get["x-x402-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/x402-marketplace-conversion"].get.summary).toContain("x402 marketplace conversion");
      expect(openApi.json.paths["/api/agent-listing-conversion"].get.operationId).toBe("getAgentListingConversionScore");
      expect(openApi.json.paths["/api/agent-listing-conversion"].get["x-payment"].maxAmountRequired).toBe("1000");
      expect(openApi.json.paths["/api/agent-listing-conversion"].get["x-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/agent-listing-conversion"].get.summary).toContain("Listing Roast");
      expect(openApi.json.paths["/api/agent-listing-conversion"].get.summary).toContain("agent listing conversion score");
      expect(openApi.json.paths["/api/agent-listing-conversion"].get.summary).toContain("agent service promotion readiness");
      expect(openApi.json.paths["/api/agent-listing-conversion"].get.summary).toContain("agent service listing clarity");
      expect(openApi.json.paths["/api/agent-listing-conversion"].get.summary).toContain("agent listing conversion");
      expect(openApi.json.paths["/api/agent-listing-conversion"].get.description).toContain("agent service listing clarity");
      expect(openApi.json.paths["/api/agent-listing-conversion"].get.description).toContain("agent service promotion readiness");
      expect(openApi.json.paths["/api/agent-listing-conversion"].get.description).toContain("buyer-agent skip reasons");
      expect(openApi.json.paths["/api/agent-listing-conversion-score"].get.operationId).toBe("getAgentListingConversionScoreAlias");
      expect(openApi.json.paths["/api/agent-listing-conversion-score"].get["x-payment"].maxAmountRequired).toBe("1000");
      expect(openApi.json.paths["/api/agent-listing-conversion-score"].get["x-payment"].route).toContain("/api/agent-listing-conversion-score");
      expect(openApi.json.paths["/api/agent-listing-conversion-score"].get.summary).toContain("agent listing conversion score alias");
      expect(openApi.json.paths["/api/agent-listing-conversion-score"].get.description).toContain("literal agent listing conversion score phrase");
      expect(openApi.json.paths["/api/agent-listing-conversion-score"].get.responses[200].content["application/json"].example.route).toBe("/api/agent-listing-conversion-score");
      expect(openApi.json.paths["/api/x402-ping"].get["x-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/x402-ping"].get["x-x402-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/x402-ping"].get.summary).toContain("$0.001");
      expect(openApi.json.paths["/api/x402-site-audit"].get["x-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/x402-site-audit"].get["x-x402-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/x402-site-audit"].get.operationId).toBe("getX402SiteAuditListingSeoMarketplaceSeoBazaarSearchVisibilitySellerGrowth");
      expect(openApi.json.paths["/api/x402-site-audit"].get.summary).toContain("$0.001");
      expect(openApi.json.paths["/api/x402-site-audit"].get.summary).toContain("x402 site audit");
      expect(openApi.json.paths["/api/x402-site-audit"].get.summary).toContain("x402 marketplace SEO audit");
      expect(openApi.json.paths["/api/x402-site-audit"].get.summary).toContain("Bazaar search visibility");
      expect(openApi.json.paths["/api/x402-site-audit"].get.summary).toContain("stale Bazaar price");
      expect(openApi.json.paths["/api/x402-site-audit"].get.summary).toContain("route health");
      expect(openApi.json.paths["/api/x402-site-audit"].get.summary).toContain("paid API preflight");
      expect(openApi.json.paths["/api/x402-site-audit"].get.summary).toContain("listing SEO audit");
      expect(openApi.json.paths["/api/x402-site-audit"].get.summary).toContain("seller growth checklist");
      expect(openApi.json.paths["/api/x402-site-audit"].get.tags).toContain("x402 seller discoverability");
      expect(openApi.json.paths["/api/x402-site-audit"].get.tags).toContain("fix x402 Bazaar listing");
      expect(openApi.json.paths["/api/x402-site-audit"].get.tags).toContain("x402 catalog metadata quality");
      expect(openApi.json.paths["/api/x402-site-audit"].get.tags).toContain("x402 listing SEO audit");
      expect(openApi.json.paths["/api/x402-site-audit"].get.tags).toContain("x402 listing rank doctor");
      expect(openApi.json.paths["/api/x402-site-audit"].get.tags).toContain("x402 seller growth checklist");
      expect(openApi.json.paths["/api/x402-site-audit"].get.tags).toContain("x402 seller intelligence");
      expect(openApi.json.paths["/api/x402-site-audit"].get.tags).toContain("stale Bazaar price");
      expect(openApi.json.paths["/api/x402-site-audit"].get.description).toContain("stale Bazaar price");
      expect(openApi.json.paths["/api/x402-site-audit"].get.description).toContain("fix x402 Bazaar listing");
      expect(openApi.json.paths["/api/x402-site-audit"].get.description).toContain("x402 site audit");
      expect(openApi.json.paths["/api/x402-site-audit"].get.description).toContain("Bazaar search visibility");
      const siteAuditParameters = Object.fromEntries(openApi.json.paths["/api/x402-site-audit"].get.parameters.map((parameter) => [parameter.name, parameter]));
      expect(Object.keys(siteAuditParameters)).toEqual(expect.arrayContaining(["endpointUrl", "url", "base_url", "baseUrl", "targetUrl", "resource"]));
      const expectOpenApi402ExampleMatchesPath = (routePath) => {
        const operation = openApi.json.paths[routePath].get;
        const example = operation.responses[402].content["application/json"].example;

        expect(example.selectedActionKey).toBe(operation["x-payment"].selectedActionKey);
        expect(example.selectedPaidAction.path).toBe(routePath);
        expect(example.selectedPaidAction.maxAmountRequired).toBe(operation["x-payment"].maxAmountRequired);
        expect(new URL(example.resource.url).pathname).toBe(routePath);
        expect(example.accepts[0].amount).toBe(operation["x-payment"].maxAmountRequired);
        expect(example.accepts[0].extra.resource).toBe(example.resource.url);
        expect(new URL(example.agentPaymentRequest.url).pathname).toBe(routePath);
        expect(example.x402Retry.route).toBe(routePath);
        expect(example.payCommand).toContain(routePath);
      };
      QUICK_SCORE_ALIAS_PATHS.forEach(expectOpenApi402ExampleMatchesPath);
      expect(openApi.json.paths["/api/preflight"].get.operationId).toBe("getPaidApiPreflight");
      expect(openApi.json.paths["/api/preflight"].get["x-payment"].maxAmountRequired).toBe("1000");
      expect(openApi.json.paths["/api/preflight"].get["x-payment"].route).toContain("/api/preflight");
      expect(openApi.json.paths["/api/preflight"].get.summary).toContain("paid API preflight");
      PREFLIGHT_ALIAS_PATHS.slice(0, 2).forEach(expectOpenApi402ExampleMatchesPath);
      expect(openApi.json.paths["/api/v1/preflight"].get.operationId).toBe("getApiV1PaidApiPreflight");
      expect(openApi.json.paths["/api/v1/preflight"].get["x-payment"].maxAmountRequired).toBe("1000");
      expect(fullOpenApi.json.paths["/preflight"].get.operationId).toBe("getRootPaidApiPreflight");
      expect(fullOpenApi.json.paths["/preflight"].get["x-payment"].route).toContain("/preflight");
      {
        const operation = fullOpenApi.json.paths["/preflight"].get;
        const example = operation.responses[402].content["application/json"].example;
        expect(example.selectedActionKey).toBe(operation["x-payment"].selectedActionKey);
        expect(example.selectedPaidAction.path).toBe("/preflight");
        expect(example.selectedPaidAction.maxAmountRequired).toBe(operation["x-payment"].maxAmountRequired);
        expect(new URL(example.resource.url).pathname).toBe("/preflight");
        expect(example.accepts[0].amount).toBe(operation["x-payment"].maxAmountRequired);
        expect(example.accepts[0].extra.resource).toBe(example.resource.url);
        expect(new URL(example.agentPaymentRequest.url).pathname).toBe("/preflight");
        expect(example.x402Retry.route).toBe("/preflight");
        expect(example.payCommand).toContain("/preflight");
      }
      SITE_AUDIT_EXACT_ALIAS_PATHS.forEach(expectOpenApi402ExampleMatchesPath);
      expect(openApi.json.paths["/api/x402-buyer-prepay-risk-score"].get["x-payment"].selectedActionKey).toBe("x402BuyerPrepayRiskScore");
      expect(openApi.json.paths["/api/score-x402-endpoint-before-paying"].get["x-payment"].selectedActionKey).toBe("scoreX402EndpointBeforePaying");
      expect(openApi.json.paths["/api/x402-route-health-check"].get["x-payment"].selectedActionKey).toBe("x402RouteHealthCheck");
      expect(openApi.json.paths["/api/x402-listing-rank-doctor"].get["x-payment"].selectedActionKey).toBe("x402ListingRankDoctor");
      expect(openApi.json.paths["/api/x402-discovery-audit"].get["x-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/x402-discovery-audit"].get["x-x402-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/x402-discovery-audit"].get.summary).toContain("$0.001");
      expect(openApi.json.paths["/api/x402-discovery-audit"].get.summary).toContain("quick check");
      expect(openApi.json.paths["/api/x402-discovery-audit"].get.tags).toContain("x402 discovery audit");
      expect(openApi.json.paths["/api/x402-discovery-audit"].get.tags).toContain("paid API preflight");
      expect(openApi.json.paths["/api/x402-discovery-audit"].get.tags).toContain("x402 route health check");
      expect(openApi.json.paths["/api/x402-discovery-audit"].get.tags).toContain("stale Bazaar price");
      expect(openApi.json.paths["/api/x402-discovery-audit"].get["x-payment"].maxAmountRequired).toBe("1000");
      expect(openApi.json.paths["/api/x402-discovery-audit"].get["x-payment"].paidResponsePreview.route).toBe("/api/x402-discovery-audit");
      expect(openApi.json.paths["/api/x402-discovery-audit"].get["x-payment"].paidResponsePreview.example.endpoint).toBe("x402-discovery-audit-quick");
      expect(openApi.json.paths["/api/x402-discovery-audit"].get["x-payment"].paidUsageProof).toContain("/api/paid-usage-proof");
      const discoveryAuditGetParameters = Object.fromEntries(openApi.json.paths["/api/x402-discovery-audit"].get.parameters.map((parameter) => [parameter.name, parameter]));
      expect(Object.keys(discoveryAuditGetParameters)).toEqual(expect.arrayContaining(["endpointUrl", "url", "base_url", "baseUrl", "targetUrl", "resource", "agent402Query"]));
      expect(discoveryAuditGetParameters.agent402Query.description).toContain("Agent402");
      expect(openApi.json.paths["/api/x402-discovery-audit"].get["x-payment"].x402Retry.route).toContain("/api/x402-discovery-audit");
      expect(openApi.json.paths["/api/x402-discovery-audit"].get["x-payment"].x402Retry.paymentHeader).toBe("X-PAYMENT");
      expect(openApi.json.paths["/api/x402-discovery-audit"].get.responses[402].content["application/json"].example.selectedPaidAction.path).toBe("/api/x402-discovery-audit");
      expect(openApi.json.paths["/api/x402-discovery-audit"].get.responses[402].content["application/json"].example.selectedPaidAction.maxAmountRequired).toBe("1000");
      expect(openApi.json.paths["/api/x402-discovery-audit"].post["x-price"]).toBe("$0.01");
      expect(openApi.json.paths["/api/x402-discovery-audit"].post["x-x402-price"]).toBe("$0.01");
      expect(openApi.json.paths["/api/x402-discovery-audit"].post.summary).toContain("$0.01");
      expect(openApi.json.paths["/api/x402-discovery-audit"].post.responses[402].content["application/json"].example.selectedPaidAction.path).toBe("/api/x402-discovery-audit");
      expect(openApi.json.paths["/api/x402-discovery-audit"].post.responses[402].content["application/json"].example.selectedPaidAction.maxAmountRequired).toBe("10000");
      expect(openApi.json.paths["/api/x402-discovery-audit"].post.tags).toContain("fix x402 Bazaar listing");
      expect(openApi.json.paths["/api/x402-discovery-audit"].post.tags).toContain("x402 catalog metadata quality");
      expect(openApi.json.paths["/api/x402-discovery-audit"].post.tags).toContain("x402 listing SEO audit");
      expect(openApi.json.paths["/api/x402-discovery-audit"].post.tags).toContain("x402 listing rank doctor");
      expect(openApi.json.paths["/api/x402-discovery-audit"].post.tags).toContain("x402 seller growth checklist");
      expect(openApi.json.paths["/api/x402-discovery-audit"].post.tags).toContain("x402 seller intelligence");
      expect(openApi.json.paths["/api/x402-discovery-audit"].post.tags).toContain("stale Bazaar price");
      expect(openApi.json.paths["/api/x402-discovery-audit"].post.requestBody.content["application/json"].schema.anyOf).toEqual(expect.arrayContaining([
        { required: ["endpointUrl"] },
        { required: ["url"] },
        { required: ["base_url"] },
        { required: ["baseUrl"] }
      ]));
      expect(openApi.json.paths["/api/x402-discovery-audit"].post.requestBody.content["application/json"].schema.properties.url.description).toContain("Alias for endpointUrl");
      expect(openApi.json.paths["/api/x402-discovery-audit"].post.requestBody.content["application/json"].schema.properties.base_url.description).toContain("Alias for endpointUrl");
      expect(openApi.json.paths["/api/listing-roast"].get.operationId).toBe("getPaidApiListingQualityBuyerAgentSkipReasonsListingRoastQuickScore");
      expect(openApi.json.paths["/api/listing-roast"].get.summary).toContain("paid API listing quality score");
      expect(openApi.json.paths["/api/listing-roast"].get.summary).toContain("AgentCore Gateway search_resources");
      expect(openApi.json.paths["/api/listing-roast"].get.summary).toContain("Coinbase Bazaar MCP");
      expect(openApi.json.paths["/api/listing-roast"].get.tags[0]).toBe("listing roast quick score");
      expect(openApi.json.paths["/api/listing-roast"].get.tags).toContain("paid API listing quality");
      expect(openApi.json.paths["/api/listing-roast"].get.tags).toContain("AgentCore x402 payments");
      expect(openApi.json.paths["/api/listing-roast"].get.tags).toContain("Coinbase x402 Bazaar MCP server");
      expect(openApi.json.paths["/api/listing-roast"].get.security).toEqual([{ x402: [] }]);
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].maxAmountRequired).toBe("1000");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].preferredFirstPaidAction).toBe(true);
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].buyerAction).toContain("buyer-agent skip reasons");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].paidResponsePreview.route).toBe("/api/listing-roast");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].paidResponsePreview.example.endpoint).toBe("listing-roast-quick-score");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].paidResponsePreview.example.liteRoastPreview.type).toBe("lite-roast-preview");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].paidResponsePreview.example.liteRoastPreview.topFixes.length).toBeGreaterThan(0);
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].paidResponsePreview.example.liteRoastPreview.fullRoastUpgrade.path).toBe("/api/full-listing-roast");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].paidResponsePreview.includes).toContain("next paid action");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].paidUsageProof).toContain("/api/paid-usage-proof");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].cashRegister).toContain("/api/cash-register");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].paidUseProof.paidUsageProof).toContain("/api/paid-usage-proof");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].paidUseProof.cashRegister).toContain("/api/cash-register");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].agentPaymentRequest.maxPayment).toBe("0.001");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].agentPaymentPrompt).toContain("pay up to 0.001 USDC");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].firstAgentPaymentRequest.url).toContain("/api/listing-roast");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].firstPayCommand).toContain("/api/listing-roast");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].payCommand).toBe(openApi.json.paths["/api/listing-roast"].get["x-payment"].firstPayCommand);
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].command).toBe(openApi.json.paths["/api/listing-roast"].get["x-payment"].firstPayCommand);
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].commandHandoff).toContain("/api/commands?intent=Listing%20Roast%20Quick%20Score");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].commands).toBe(openApi.json.paths["/api/listing-roast"].get["x-payment"].commandHandoff);
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].freeHandoff).toContain("/api/pay-now?intent=Listing%20Roast%20Quick%20Score");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].x402Retry.route).toContain("/api/listing-roast");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].x402Retry.paymentRequiredHeader).toBe("Payment-Required");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].x402Retry.paymentHeader).toBe("X-PAYMENT");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].x402Retry.maxPaymentUsd).toBe("0.001");
      expect(openApi.json.info["x-guidance"]).toContain("x-payment-info");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment-info"]).toMatchObject({
        price: { mode: "fixed", currency: "USD", amount: "0.001" },
        protocols: [
          {
            x402: {
              network: "eip155:84532",
              asset: "USDC",
              payTo: "0x000000000000000000000000000000000000dEaD",
              resource: "http://localhost:8787/api/listing-roast",
              method: "GET",
              maxAmountRequired: "1000",
              paymentRequiredHeader: "Payment-Required",
              paymentHeader: "X-PAYMENT",
              paymentResponseHeader: "X-PAYMENT-RESPONSE",
              manifest: "http://localhost:8787/x402.json",
              payNow: "http://localhost:8787/api/pay-now?intent=Listing%20Roast%20Quick%20Score",
              paidUsageProof: "http://localhost:8787/api/paid-usage-proof"
            }
          }
        ]
      });
      expect(openApi.json.paths["/api/buyer-agent-skip-reasons"].get["x-payment"].selectedPaidAction.path).toBe("/api/buyer-agent-skip-reasons");
      expect(openApi.json.paths["/api/buyer-agent-skip-reasons"].get["x-payment-info"].price.amount).toBe("0.001");
      expect(openApi.json.paths["/api/buyer-agent-skip-reasons"].get["x-payment-info"].protocols[0].x402.resource).toBe("http://localhost:8787/api/buyer-agent-skip-reasons");
      expect(openApi.json.paths["/api/buyer-agent-skip-reasons"].get["x-payment"].exactIntentPaidAction.path).toBe("/api/buyer-agent-skip-reasons");
      expect(openApi.json.paths["/api/buyer-agent-skip-reasons"].get["x-payment"].selectedFirstPaidAction.path).toBe("/api/listing-roast");
      expect(openApi.json.paths["/api/buyer-agent-skip-reasons"].get["x-payment"].selectedPaidSequence[0].action.path).toBe("/api/listing-roast");
      expect(openApi.json.paths["/api/buyer-agent-skip-reasons"].get["x-payment"].firstAgentPaymentRequest.url).toContain("/api/listing-roast");
      expect(openApi.json.paths["/api/buyer-agent-skip-reasons"].get["x-payment"].firstPayCommand).toContain("/api/listing-roast");
      expect(openApi.json.paths["/api/buyer-agent-skip-reasons"].get["x-payment"].payCommand).toContain("/api/listing-roast");
      expect(openApi.json.paths["/api/buyer-agent-skip-reasons"].get["x-payment"].selectedPaidActionCommand).toContain("/api/buyer-agent-skip-reasons");
      expect(openApi.json.paths["/api/buyer-agent-skip-reasons"].get["x-payment"].commandHandoff).toContain("/api/commands?intent=buyer-agent%20skip%20reasons");
      expect(openApi.json.paths["/api/buyer-agent-skip-reasons"].get["x-payment"].buyerInstruction).toContain("start with GET /api/listing-roast");
      expect(openApi.json.paths["/api/buyer-agent-skip-reasons"].get["x-payment"].paidResponsePreview.route).toBe("/api/buyer-agent-skip-reasons");
      expect(openApi.json.paths["/api/buyer-agent-skip-reasons"].get["x-payment"].selectedFirstPaidResponsePreview.route).toBe("/api/listing-roast");
      expect(openApi.json.paths["/api/listing-roast"].get["x-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/listing-roast"].get["x-x402-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/listing-roast"].post.security).toEqual([{ x402: [] }]);
      expect(openApi.json.paths["/api/listing-roast"].post["x-payment"].maxAmountRequired).toBe("10000");
      expect(openApi.json.paths["/api/listing-roast"].post["x-payment-info"].price.amount).toBe("0.01");
      expect(openApi.json.paths["/api/listing-roast"].post["x-payment-info"].protocols[0].x402.method).toBe("POST");
      expect(openApi.json.paths["/api/listing-roast"].post["x-payment"].paidResponsePreview.route).toBe("/api/listing-roast");
      expect(openApi.json.paths["/api/listing-roast"].post["x-payment"].paidResponsePreview.includes).toContain("full rewrite");
      expect(openApi.json.paths["/api/listing-roast"].post["x-payment"].payCommand).toContain("-X POST");
      expect(openApi.json.paths["/api/listing-roast"].post["x-payment"].payCommand).toContain("--max-amount 10000");
      expect(openApi.json.paths["/api/listing-roast"].post["x-payment"].commandHandoff).toContain("/api/commands?intent=full%20listing%20roast");
      expect(openApi.json.paths["/api/listing-roast"].post["x-price"]).toBe("$0.01");
      expect(openApi.json.paths["/api/listing-roast"].post["x-x402-price"]).toBe("$0.01");
      expect(openApi.json.paths["/api/listing-roast"].post.description).toContain("omitted bodies use safe Listing Roast defaults");
      expect(openApi.json.paths["/api/listing-roast"].post.requestBody.required).toBe(false);
      expect(openApi.json.paths["/api/listing-roast"].get.summary).toContain("$0.001");
      expect(openApi.json.paths["/api/listing-roast"].get.summary).toContain("buyer-agent skip reasons");
      expect(openApi.json.paths["/api/listing-roast"].get.summary).toContain("listing quality");
      expect(openApi.json.paths["/api/listing-roast"].get.description).toContain("Listing quality score API for paid API listing quality score");
      expect(openApi.json.paths["/api/listing-roast"].get.description).toContain("AgentCore x402 payments readiness");
      expect(openApi.json.paths["/api/listing-roast"].get.description).toContain("Coinbase x402 Bazaar MCP server buyers");
      expect(openApi.json.paths["/api/listing-roast"].get.description).toContain("search_resources discovery");
      expect(openApi.json.paths["/api/listing-roast"].get.description).toContain("proxy_tool_call paid-call handoffs");
      expect(openApi.json.paths["/api/listing-roast"].get.description).toContain("marketplace product listing quality");
      expect(openApi.json.paths["/api/listing-roast"].get.description).toContain("agent listing conversion score");
      expect(openApi.json.paths["/api/listing-roast"].get.description).toContain("agent service listing clarity");
      expect(openApi.json.paths["/api/listing-roast"].get.description).toContain("x402 discovery audit");
      expect(openApi.json.paths["/api/listing-roast"].get.description).toContain("Bazaar search visibility");
      expect(openApi.json.paths["/api/listing-roast"].get.description).toContain("paid API preflight");
      const indexedRoastGetParameters = Object.fromEntries(openApi.json.paths["/api/listing-roast"].get.parameters.map((parameter) => [parameter.name, parameter]));
      expect(indexedRoastGetParameters.currentPrice.example).toBe("$0.001 GET; $0.01 GET/POST roast");
      expect(indexedRoastGetParameters.currentPrice.schema.default).toBe("$0.001 GET; $0.01 GET/POST roast");
      expect(indexedRoastGetParameters.currentCheckoutPath.example).toBe("/api/listing-roast");
      expect(indexedRoastGetParameters.currentCheckoutPath.schema.default).toBe("/api/listing-roast");
      const paidApiAliasParameters = Object.fromEntries(openApi.json.paths["/api/paid-api-listing-quality"].get.parameters.map((parameter) => [parameter.name, parameter]));
      expect(paidApiAliasParameters.currentCheckoutPath.example).toBe("/api/paid-api-listing-quality");
      expect(paidApiAliasParameters.currentCheckoutPath.schema.default).toBe("/api/paid-api-listing-quality");
      expect(paidApiAliasParameters.goal.example).toContain("paid API listing quality");
      expect(openApi.json.paths["/api/agentcore-x402-payments"].get.summary).toContain("AgentCore Gateway search_resources");
      expect(openApi.json.paths["/api/agentcore-x402-payments"].get.description).toContain("proxy_tool_call handoffs");
      expect(openApi.json.paths["/api/coinbase-x402-bazaar-mcp-server"].get.summary).toContain("search_resources proxy_tool_call");
      expect(openApi.json.paths["/api/coinbase-x402-bazaar-mcp-server"].get.description).toContain("AgentCore Gateway integrations");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[402].description).toContain("X-PAYMENT");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[402].headers["Payment-Required"].description).toContain("resource URL");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[402].headers.Link.description).toContain("pay-now");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[402].content["application/json"].example.selectedPaidAction.path).toBe("/api/listing-roast");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[402].content["application/json"].example.selectedPaidAction.maxAmountRequired).toBe("1000");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[402].content["application/json"].example.paidUseProof.paidUsageProof).toContain("/api/paid-usage-proof");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[402].content["application/json"].example.settlementProof.evidenceFields).toContain("receiverWallet.usdcUnits");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[402].content["application/json"].example.note).toContain("Payment-Required");
      expect(openApi.json.paths["/api/listing-roast"].post.responses[402].content["application/json"].example.selectedPaidAction.method).toBe("POST");
      expect(openApi.json.paths["/api/listing-roast"].post.responses[402].content["application/json"].example.selectedPaidAction.maxAmountRequired).toBe("10000");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[200].content["application/json"].example.nextPaidAction.maxAmountRequired).toBe("10000");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[200].content["application/json"].example.nextPaidAction.command).toContain("/api/full-listing-roast");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[200].content["application/json"].example.nextPaidAction.command).toContain("--max-amount 10000");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[200].content["application/json"].example.nextPaidAction.agentPaymentPrompt).toContain("pay up to 0.01 USDC");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[200].content["application/json"].example.fullRoastUpgradeDecision.action.path).toBe("/api/full-listing-roast");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[200].content["application/json"].example.fullRoastUpgradeDecision.action.maxAmountRequired).toBe("10000");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[200].content["application/json"].example.fullRoastUpgradeDecision.agentPaymentPrompt).toContain("pay up to 0.01 USDC");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[200].content["application/json"].example.nextPaidActions.find((action) => action.path === "/api/full-listing-roast").command).toContain("--max-amount 10000");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[200].content["application/json"].example.nextPaidActions.find((action) => action.path === "/api/full-listing-roast").agentPaymentPrompt).toContain("pay up to 0.01 USDC");
      expect(scoreAgent402OpenApiOperation(openApi.json.paths["/api/listing-roast"].get, "paid API listing quality")).toBeGreaterThan(scoreAgent402OpenApiOperation(openApi.json.paths["/api/x402-site-audit"].get, "paid API listing quality"));
      expect(scoreAgent402OpenApiOperation(openApi.json.paths["/api/listing-roast"].get, "buyer-agent skip reasons")).toBeGreaterThan(scoreAgent402OpenApiOperation(openApi.json.paths["/api/agent-listing-conversion"].get, "buyer-agent skip reasons"));
      expect(scoreAgent402OpenApiOperation(openApi.json.paths["/api/listing-roast"].get, "listing roast")).toBeGreaterThan(scoreAgent402OpenApiOperation(openApi.json.paths["/api/listing-roast"].post, "listing roast"));
      expect(openApi.json.paths["/api/pay-now"].get.operationId).toBe("getPayNow");
      expect(openApi.json.paths["/api/pay-now"].get.security).toEqual([]);
      expect(openApi.json.paths["/api/pay-now"].get.parameters.map((parameter) => parameter.name)).toContain("intent");
      expect(openApi.json.paths["/api/pay-now"].post.operationId).toBe("postPayNow");
      expect(openApi.json.paths["/api/pay-now"].post.security).toEqual([]);
      expect(openApi.json.paths["/api/pay-now"].post.requestBody.content["application/json"].schema.properties.intent.type).toBe("string");
      expect(openApi.json.paths["/api/commands"].get.operationId).toBe("getCommands");
      expect(openApi.json.paths["/api/commands"].get.security).toEqual([]);
      expect(openApi.json.paths["/api/commands"].get.parameters.map((parameter) => parameter.name)).toContain("intent");
      expect(openApi.json.paths["/api/paid-usage-proof"].get.operationId).toBe("getPaidUsageProof");
      expect(openApi.json.paths["/api/paid-usage-proof"].get.security).toEqual([]);
      const paidOpenApiOperations = Object.values(openApi.json.paths).flatMap((pathItem) => ["get", "post", "put", "patch", "delete"]
        .map((method) => pathItem[method])
        .filter(Boolean)
        .filter((operation) => operation["x-payment"]));
      expect(paidOpenApiOperations.length).toBeGreaterThan(20);
      for (const operation of paidOpenApiOperations) {
        expect(operation["x-payment-info"].price).toMatchObject({
          mode: "fixed",
          currency: "USD",
          amount: operation["x-payment"].maxPaymentUsd
        });
        expect(operation["x-payment-info"].protocols[0].x402.maxAmountRequired).toBe(operation["x-payment"].maxAmountRequired);
        expect(operation["x-payment-info"].protocols[0].x402.paymentHeader).toBe("X-PAYMENT");
      }
      expect(openApi.json.paths["/api/pricing"].get.operationId).toBe("getPricingCatalog");
      expect(openApi.json.paths["/api/find"].get.operationId).toBe("findPaidRouteForTask");
      expect(openApi.json.paths["/api/route"].get.operationId).toBe("routePaidLocalTools");
      expect(openApi.json.paths["/api/route"].post.operationId).toBe("routePaidLocalToolsPost");
      expect(fullOpenApi.json.paths["/v2/x402/discovery/resources"].get.operationId).toBe("getLocalX402DiscoveryResources");
      expect(fullOpenApi.json.paths["/v2/x402/discovery/search"].get.operationId).toBe("searchLocalX402DiscoveryResources");
      expect(fullOpenApi.json.paths["/v2/x402/discovery/merchant"].get.operationId).toBe("getLocalX402MerchantResources");
      expect(openApi.json.paths["/api/listing-score"].post.summary).toContain("marketplace listing score");
      expect(openApi.json.paths["/api/listing-score"].post["x-payment"].maxAmountRequired).toBe("5000");
      expect(openApi.json.paths["/api/listing-score"].post["x-price"]).toBe("$0.005");
      expect(openApi.json.paths["/api/listing-score"].post["x-x402-price"]).toBe("$0.005");
      expect(openApi.json.paths["/api/listing-score"].post.responses[200].content["application/json"].example.nextPaidAction.command).toContain("--max-amount 10000");
      expect(openApi.json["x-listing-roast"].commands).toContain("/api/commands");
      expect(openApi.json["x-listing-roast"].payNow).toContain("/api/pay-now");
      expect(openApi.json["x-listing-roast"].pricing).toContain("/api/pricing");
      expect(openApi.json["x-listing-roast"].find).toContain("/api/find");
      expect(openApi.json["x-listing-roast"].route).toContain("/api/route");
      expect(openApi.json["x-listing-roast"].localDiscovery.resources).toContain("/v2/x402/discovery/resources");
      expect(openApi.json.info.x402.officialCdpDiscovery.indexedRoute).toBe("http://localhost:8787/api/listing-roast");
      expect(openApi.json.x402.officialCdpDiscovery.recommendedSearchUrl).toContain("query=marketplace+listing+score");
      expect(openApi.json["x-listing-roast"].officialCdpDiscovery.refreshRule).toContain("real settlement");
      expect(openApi.json["x-listing-roast"].localDiscovery.officialCdpDiscovery.indexedRouteReason).toContain("already-settled");
      expect(openApi.json["x-listing-roast"].localDiscovery.searchExamples.find((example) => example.query === "agent service clarity").expectedFirstPath).toBe("/api/listing-roast");
      expect(openApi.json["x-listing-roast"].localDiscovery.searchExamples.find((example) => example.query === "agent service clarity").exactIntentPath).toBe("/api/agent-service-clarity");
      expect(openApi.json["x-listing-roast"].localDiscovery.searchExamples.find((example) => example.query === "x402 route health check").expectedFirstPath).toBe("/api/x402-route-health-check");
      expect(openApi.json["x-listing-roast"].localDiscovery.searchExamples.find((example) => example.query === "paid API preflight").expectedFirstPath).toBe("/api/x402-site-audit");
      expect(openApi.json["x-listing-roast"].apiV1EntryRoute).toContain("/api/v1");
      expect(openApi.json["x-listing-roast"].v1EntryRoute).toContain("/v1");
      expect(openApi.json["x-listing-roast"].x402ManifestAliases.some((url) => url.endsWith("/.well-known/x402"))).toBe(true);
      expect(openApi.json["x-listing-roast"].agentCard).toContain("/.well-known/agent-card.json");
      expect(openApi.json["x-listing-roast"].agentCardAliases[0]).toContain("/.well-known/agent.json");
      expect(openApi.json["x-listing-roast"].aiPlugin).toContain("/.well-known/ai-plugin.json");
      expect(openApi.json["x-listing-roast"].apiCatalog).toContain("/.well-known/api-catalog");
      expect(openApi.json["x-listing-roast"].agentSkills).toContain("/.well-known/agent-skills/index.json");
      expect(openApi.json.info["x-icon-url"]).toBe("http://localhost:8787/icon.svg");
      expect(openApi.json["x-listing-roast"].iconUrl).toContain("/icon.svg");
      expect(openApi.json["x-listing-roast"].llmsAliases[0]).toContain("/.well-known/llms.txt");
      expect(openApi.json["x-listing-roast"].llmsFull).toContain("/llms-full.txt");
      expect(openApi.json["x-listing-roast"].llmsFullAliases[0]).toContain("/.well-known/llms-full.txt");
      expect(openApi.json["x-listing-roast"].mcpServerCard).toContain("/.well-known/mcp/server-card.json");
      expect(openApi.json["x-listing-roast"].cashRegister).toContain("/api/cash-register");
      expect(openApi.json["x-listing-roast"].paidUsageProof.paidCompletions).toBe(0);
      expect(openApi.json["x-listing-roast"].paidUsageProof.estimatedGrossRevenueUsd).toBe("0.00");
      expect(openApi.json["x-listing-roast"].paidUsageProof.noSpend).toBe(true);
      expect(openApi.json["x-listing-roast"].settlementProof.evidenceFields).toContain("receiverWallet.usdcBalance");
      expect(openApi.json["x-listing-roast"].recommendedFirstPaidAction.route).toContain("/api/listing-roast");
      expect(openApi.json["x-recommended-paid-sequence"][0].use).toBe("indexedQuickScore");
      expect(openApi.json["x-recommended-paid-sequence"][0].action.maxAmountRequired).toBe("1000");
      expect(openApi.json["x-recommended-paid-sequence"][1].use).toBe("fullRoastGet");
      expect(openApi.json["x-recommended-paid-sequence"][1].action.maxAmountRequired).toBe("10000");
      expect(openApi.json.info["x-recommended-paid-sequence"][0].use).toBe("indexedQuickScore");
      expect(openApi.json.info["x-recommended-paid-sequence"][1].action.path).toBe("/api/full-listing-roast");
      expect(openApi.json["x-listing-roast"].recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(openApi.json["x-listing-roast"].recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(openApi.json["x-listing-roast"].recommendedPaidSequence[1].use).toBe("fullRoastGet");
      expect(openApi.json["x-listing-roast"].recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(openApi.json["x-listing-roast"].x402Manifest).toContain("/x402.json");
      expect(openApi.json["x-listing-roast"].keywords).toContain("paid API listing");

      const indexedPaymentPrompt = "Agent payment prompt: Call this x402 endpoint with GET and pay up to 0.001 USDC: http://localhost:8787/api/listing-roast";
      const llms = await fetchJson(server, "/llms.txt");
      expect(llms.status).toBe(200);
      expect(llms.text).toContain("Command builder");
      expect(llms.text).toContain(indexedPaymentPrompt);
      expect(llms.text).toContain("Paid-use proof before payment: 0 paid completions; $0.00 registered.");
      expect(llms.text).not.toContain("Paid-use proof before payment: Paid-use proof before payment");
      expect(llms.text).toContain("Bazaar cataloging note");
      expect(llms.text).toContain("extensions.bazaar metadata");
      expect(llms.text).toContain("Official CDP discovery handoff");
      expect(llms.text).toContain("Official CDP search: https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=marketplace+listing+score");
      expect(llms.text).toContain("Official CDP domain-restricted search: https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?");
      expect(llms.text).toContain("urlSubstring=localhost");
      expect(llms.text).toContain("Official CDP merchant lookup: https://api.cdp.coinbase.com/platform/v2/x402/discovery/merchant?payTo=0x000000000000000000000000000000000000dEaD");
      expect(llms.text).toContain("Start paid use with the already-settled indexed route: http://localhost:8787/api/listing-roast");
      expect(llms.text).toContain("Refresh rule: CDP Bazaar refreshes catalog metadata after real settlement");
      expect(llms.text).toContain("/api/cash-register");
      expect(llms.text).toContain("/AGENTS.md");
      expect(llms.text).toContain("/docs");
      expect(llms.text).toContain("/api-docs");
      expect(llms.text).toContain("/api/instant-listing-score");
      expect(llms.text).toContain("/api/x402-marketplace-conversion");
      expect(llms.text).toContain("/api/agent-listing-conversion");
      expect(llms.text).toContain("/api/x402-ping");
      expect(llms.text).toContain("/api/x402-site-audit");
      expect(llms.text).toContain("/api/preflight");
      expect(llms.text).toContain("/api/v1/preflight");
      expect(llms.text).toContain("/preflight");
      expect(llms.text).toContain("/api/x402-discovery-audit");
      expect(llms.text).toContain("/api/paid-api-listing-quality-score");
      expect(llms.text).toContain("/api/x402-listing-quality");
      expect(llms.text).toContain("paid API listing quality score, AgentCore x402 payments");
      expect(llms.text).toContain("Buyer intent landing pages");
      expect(llms.text).toContain("/paid-api-listing-quality");
      expect(llms.text).toContain("/paid-api-listing-quality-score");
      expect(llms.text).toContain("/x402-listing-quality");
      expect(llms.text).toContain("/agent-listing-conversion");
      expect(llms.text).toContain("/x402-discovery-audit");
      expect(llms.text).toContain("/x402-site-audit");
      expect(llms.text).toContain("/agentcore-x402-payments");
      expect(llms.text).toContain("Primary paid action: GET http://localhost:8787/api/listing-roast ($0.001, max 1000)");
      expect(llms.text).toContain("Exact intent fallback: GET http://localhost:8787/api/paid-api-listing-quality ($0.001, max 1000)");
      expect(llms.text).toContain("Upgrade paid action: GET http://localhost:8787/api/full-listing-roast ($0.01, max 10000)");
      expect(llms.text).not.toContain("Upgrade paid action: POST http://localhost:8787/api/listing-roast ($0.01, max 10000)");
      expect(llms.text).toContain("/api/listing-score");
      expect(llms.text).toContain("GET http://localhost:8787/api/full-listing-roast");
      expect(llms.text).toContain("custom-body full listing roast");
      expect(llms.text).toContain("omitted bodies use safe defaults for stale directory cards");
      expect(llms.text).toContain("/api/pay-now");
      expect(llms.text).toContain("/api/pricing");
      expect(llms.text).toContain("/api/route");
      expect(llms.text).toContain("/api/find?q=x402%20discovery%20audit");
      expect(llms.text).toContain("/api/find?q=score%20my%20paid%20API%20listing%20with%20a%20custom%20body");
      expect(llms.text).toContain("/api/route?query=score%20my%20paid%20API%20listing%20with%20a%20custom%20body&top=3");
      expect(llms.text).toContain("/v2/x402/discovery/resources");
      expect(llms.text).toContain("/v2/x402/discovery/search");
      expect(llms.text).toContain("/v2/x402/discovery/merchant");
      expect(llms.text).toContain("/.well-known/openapi.json");
      expect(llms.text).toContain("/.well-known/x402");
      expect(llms.text).toContain("/.well-known/agent-card.json");
      expect(llms.text).toContain("/.well-known/agent.json");
      expect(llms.text).toContain("/.well-known/ai-plugin.json");
      expect(llms.text).toContain("/.well-known/api-catalog");
      expect(llms.text).toContain("/.well-known/agent-skills/index.json");
      expect(llms.text).toContain("/.well-known/agent-skills/listing-roast-x402/SKILL.md");
      expect(llms.text).toContain("/llms-full.txt");
      expect(llms.text).toContain("/index.md");
      expect(llms.text).toContain("/.well-known/mcp-server");
      expect(llms.text).toContain("/.well-known/mcp/server-card.json");
      expect(llms.text).toContain("npx awal@2.8.0 x402 pay");
      expect(llms.text).toContain("x402 pay 'http://localhost:8787/api'");
      expect(llms.text).toContain("x402 pay 'http://localhost:8787/api/v1'");
      expect(llms.text).toContain("x402 pay 'http://localhost:8787/v1'");
      expect(llms.text).toContain("x402 pay 'http://localhost:8787/api/listing-roast'");
      expect(llms.text).toContain("/api/agent-listing-conversion");
      expect(llms.text).toContain("--max-amount 1000");
      expect(llms.text).toContain("--max-amount 10000");
      expect(llms.text).toContain("Recommended Paid Sequence");
      expect(llms.text).toContain("Full roast command");
      expect(llms.text).toContain("already-indexed listing-roast URL");
      expect(llms.text).toContain("/x402.json");
      expect(llms.text).toContain("marketplace listing score");
      expect(llms.text.indexOf("/api/listing-roast")).toBeLessThan(llms.text.indexOf("/api/v1"));

      const wellKnownLlms = await fetchJson(server, "/.well-known/llms.txt");
      expect(wellKnownLlms.status).toBe(200);
      expect(wellKnownLlms.text).toContain("Preferred first paid route");

      const llmsFull = await fetchJson(server, "/llms-full.txt");
      expect(llmsFull.status).toBe(200);
      expect(llmsFull.headers.get("content-type")).toContain("text/markdown");
      expect(llmsFull.text).toContain("# Listing Roast x402");
      expect(llmsFull.text).toContain("/.well-known/mcp/server-card.json");
      expect(llmsFull.text).toContain("Recommended Paid Sequence");
      expect(llmsFull.text).toContain("Paid-Use Proof Before Payment");
      expect(llmsFull.text).toContain(indexedPaymentPrompt);
      expect(llmsFull.text).toContain("Paid-use proof before payment: 0 paid completions; $0.00 registered.");
      expect(llmsFull.text).toContain("Bazaar Cataloging Note");
      expect(llmsFull.text).toContain("extensions.bazaar metadata");
      expect(llmsFull.text).toContain("Full roast command");
      expect(llmsFull.text).toContain("after the indexed quick score for the exact agent-listing conversion score deep dive");
      expect(llmsFull.text).toContain("/api/preflight");
      expect(llmsFull.text).toContain("/api/v1/preflight");
      expect(llmsFull.text).toContain("/preflight");
      expect(llmsFull.text.indexOf("/api/listing-roast")).toBeLessThan(llmsFull.text.indexOf("/api/v1"));

      const wellKnownLlmsFull = await fetchJson(server, "/.well-known/llms-full.txt");
      expect(wellKnownLlmsFull.status).toBe(200);
      expect(wellKnownLlmsFull.headers.get("content-type")).toContain("text/markdown");

      const icon = await fetchJson(server, "/icon.svg");
      expect(icon.status).toBe(200);
      expect(icon.headers.get("content-type")).toContain("image/svg+xml");
      expect(icon.text).toContain("Listing Roast x402");

      const indexMarkdown = await fetchJson(server, "/index.md");
      expect(indexMarkdown.status).toBe(200);
      expect(indexMarkdown.headers.get("content-type")).toContain("text/markdown");
      expect(indexMarkdown.text).toContain("Preferred First Paid Route");
      expect(indexMarkdown.text).toContain("Paid-Use Proof Before Payment");
      expect(indexMarkdown.text).toContain(indexedPaymentPrompt);
      expect(indexMarkdown.text).toContain("Paid-use proof before payment: 0 paid completions; $0.00 registered.");
      expect(indexMarkdown.text).toContain("Bazaar Cataloging Note");
      expect(indexMarkdown.text).toContain("extensions.bazaar metadata");
      expect(indexMarkdown.text).toContain("/api/preflight");
      expect(indexMarkdown.text).toContain("/api/v1/preflight");
      expect(indexMarkdown.text).toContain("/preflight");

      const authMarkdown = await fetchJson(server, "/auth.md");
      expect(authMarkdown.status).toBe(200);
      expect(authMarkdown.headers.get("content-type")).toContain("text/markdown");
      expect(authMarkdown.text).toContain("# Auth.md");
      expect(authMarkdown.text).toContain("## Listing Roast x402 Auth");
      expect(authMarkdown.text).toContain("Paid-Use Proof Before Payment");
      expect(authMarkdown.text).toContain("Paid-use proof before payment: 0 paid completions; $0.00 registered.");
      expect(authMarkdown.text).toContain("Bazaar Cataloging Note");
      expect(authMarkdown.text).toContain("extensions.bazaar metadata");
      expect(authMarkdown.text).toContain("does not use accounts, API keys, OAuth login");
      expect(authMarkdown.text).toContain("Type: x402 payment");
      expect(authMarkdown.text).toContain("OAuth/OIDC: not supported");
      expect(authMarkdown.text).toContain("## Agent Registration");
      expect(authMarkdown.text).toContain("Registration endpoint: none");
      expect(authMarkdown.text).toContain("Token endpoint: none");
      expect(authMarkdown.text).toContain("Do not make a paid call unless the buyer explicitly intends to spend USDC");
      expect(authMarkdown.text).toContain(indexedPaymentPrompt);

      const wellKnownAuthMarkdown = await fetchJson(server, "/.well-known/auth.md");
      expect(wellKnownAuthMarkdown.status).toBe(200);
      expect(wellKnownAuthMarkdown.headers.get("content-type")).toContain("text/markdown");
      expect(wellKnownAuthMarkdown.text).toContain("x402 payment");

      const robots = await fetchJson(server, "/robots.txt");
      expect(robots.status).toBe(200);
      expect(robots.headers.get("cache-control")).toContain("no-store");
      expect(robots.text).toContain("Sitemap:");
      expect(robots.text).toContain("User-agent: ChatGPT-User");
      expect(robots.text).toContain("User-agent: ClaudeBot");
      expect(robots.text).toContain("Content-Signal: search=yes, ai-input=yes, ai-train=no");
      expect(robots.text).toContain("/x402.json");
      expect(robots.text).toContain("/api/commands");
      expect(robots.text).toContain("/api/pay-now?intent=paid%20API%20listing%20quality%20score");
      expect(robots.text).toContain(indexedPaymentPrompt);
      expect(robots.text).toContain("/api/route");
      expect(robots.text).toContain("/paid-api-listing-quality");
      expect(robots.text).toContain("/buyer-agent-skip-reasons");
      expect(robots.text).toContain("/agent-service-clarity");
      expect(robots.text).toContain("/agent-listing-conversion");
      expect(robots.text).toContain("/x402-discovery-audit");
      expect(robots.text).toContain("/x402-site-audit");
      expect(robots.text).toContain("/x402-buyer-prepay-risk-score");
      expect(robots.text).toContain("/score-x402-endpoint-before-paying");
      expect(robots.text).toContain("/x402-route-health-check");
      expect(robots.text).toContain("/x402-listing-rank-doctor");
      expect(robots.text).toContain("/full-listing-roast");
      expect(robots.text).toContain("/.well-known/agent-tools.json");
      expect(robots.text).toContain("/.well-known/agent-skills/index.json");
      expect(robots.text).toContain("/.well-known/mcp/server-card.json");
      expect(robots.text).toContain("Official CDP search: https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=marketplace+listing+score");
      expect(robots.text).toContain("Official CDP merchant lookup: https://api.cdp.coinbase.com/platform/v2/x402/discovery/merchant?payTo=0x000000000000000000000000000000000000dEaD");
      expect(robots.text).toContain("Official CDP indexed paid route: http://localhost:8787/api/listing-roast");
      expect(robots.text).toContain("Official CDP refresh rule: CDP Bazaar refreshes catalog metadata after real settlement");
      expect(robots.text).toContain("Preferred paid route after explicit buyer intent");

      const sitemap = await fetchJson(server, "/sitemap.xml");
      expect(sitemap.status).toBe(200);
      expect(sitemap.headers.get("cache-control")).toContain("no-store");
      expect(sitemap.text.indexOf("<loc>http://localhost:8787/api/listing-roast</loc>")).toBeGreaterThan(-1);
      expect(sitemap.text.indexOf("<loc>http://localhost:8787/api/listing-roast</loc>")).toBeLessThan(sitemap.text.indexOf("<loc>http://localhost:8787/api</loc>"));
      expect(sitemap.text).toContain("/paid-api-listing-quality");
      expect(sitemap.text).toContain("/buyer-agent-skip-reasons");
      expect(sitemap.text).toContain("/agent-service-clarity");
      expect(sitemap.text).toContain("/agent-listing-conversion");
      expect(sitemap.text).toContain("/x402-discovery-audit");
      expect(sitemap.text).toContain("/x402-site-audit");
      expect(sitemap.text).toContain("/x402-buyer-prepay-risk-score");
      expect(sitemap.text).toContain("/score-x402-endpoint-before-paying");
      expect(sitemap.text).toContain("/x402-route-health-check");
      expect(sitemap.text).toContain("/x402-listing-rank-doctor");
      expect(sitemap.text).toContain("/full-listing-roast");
      expect(sitemap.text).toContain("/builder");
      expect(sitemap.text).toContain("/sample");
      expect(sitemap.text).toContain("/api/pay-now");
      expect(sitemap.text).toContain("/api/commands");
      expect(sitemap.text).toContain("/api/pricing");
      expect(sitemap.text).toContain("/api/find");
      expect(sitemap.text).toContain("/api/route");
      expect(sitemap.text).toContain("/v2/x402/discovery/resources");
      expect(sitemap.text).toContain("/x402/discovery/resources");
      expect(sitemap.text).toContain("/discovery/resources");
      expect(sitemap.text).toContain("/.well-known/x402/discovery/resources");
      expect(sitemap.text).toContain("/v1/x402/discovery/resources");
      expect(sitemap.text).toContain("/v2/x402/discovery/search");
      expect(sitemap.text).toContain("/v2/x402/discovery/merchant");
      expect(sitemap.text).toContain("<loc>http://localhost:8787/api</loc>");
      expect(sitemap.text).toContain("<loc>http://localhost:8787/api/v1</loc>");
      expect(sitemap.text).toContain("<loc>http://localhost:8787/v1</loc>");
      expect(sitemap.text).toContain("/api/instant-listing-score");
      expect(sitemap.text).toContain("/api/x402-marketplace-conversion");
      expect(sitemap.text).toContain("/api/agent-listing-conversion");
      expect(sitemap.text).toContain("/api/x402-ping");
      expect(sitemap.text).toContain("/api/x402-site-audit");
      expect(sitemap.text).toContain("/api/preflight");
      expect(sitemap.text).toContain("/api/v1/preflight");
      expect(sitemap.text).toContain("/preflight");
      expect(sitemap.text).toContain("/api/x402-discovery-audit");
      expect(sitemap.text).toContain("/api/sample-score");
      expect(sitemap.text).toContain("/openapi.json");
      expect(sitemap.text).toContain("/.well-known/openapi.json");
      expect(sitemap.text).toContain("/api/v1/openapi.json");
      expect(sitemap.text).toContain("/swagger.json");
      expect(sitemap.text).toContain("/openapi.yaml");
      expect(sitemap.text).toContain("/AGENTS.md");
      expect(sitemap.text).toContain("/docs");
      expect(sitemap.text).toContain("/api-docs");
      expect(sitemap.text).toContain("/llms.txt");
      expect(sitemap.text).toContain("/.well-known/llms.txt");
      expect(sitemap.text).toContain("/llms-full.txt");
      expect(sitemap.text).toContain("/.well-known/llms-full.txt");
      expect(sitemap.text).toContain("/icon.svg");
      expect(sitemap.text).toContain("/index.md");
      expect(sitemap.text).toContain("/auth.md");
      expect(sitemap.text).toContain("/.well-known/auth.md");
      expect(sitemap.text).toContain("/x402.json");
      expect(sitemap.text).toContain("/.well-known/x402.json");
      expect(sitemap.text).toContain("/.well-known/x402</loc>");
      expect(sitemap.text).toContain("/.well-known/agent-card.json");
      expect(sitemap.text).toContain("/.well-known/agent.json");
      expect(sitemap.text).toContain("/.well-known/ai-plugin.json");
      expect(sitemap.text).toContain("/.well-known/api-catalog");
      expect(sitemap.text).toContain("/.well-known/agent-tools.json");
      expect(sitemap.text).toContain("/.well-known/agent-skills/index.json");
      expect(sitemap.text).toContain("/.well-known/agent-skills/listing-roast-x402/SKILL.md");
      expect(sitemap.text).toContain("/.well-known/mcp/server-card.json");
      expect(sitemap.text).toContain("/api/examples");
      expect(sitemap.text).toContain("/api/score-schema");
      expect(sitemap.text).toContain("/api/discovery-audit-schema");

      const track = await fetchJson(server, "/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "commandCopyClicks" })
      });
      expect(track.status).toBe(204);

      const builderTrack = await fetchJson(server, "/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "builderCommandBuilds" })
      });
      expect(builderTrack.status).toBe(204);

      const payNow = await fetchJson(server, "/api/pay-now");
      expect(payNow.status).toBe(200);
      expect(payNow.json.service).toBe("Listing Roast x402");
      expect(payNow.json.serviceName).toBe("Listing Roast x402");
      expect(payNow.json.metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(payNow.json.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(payNow.json.metadataUpdatedAt).toBe("2026-06-21T03:14:35.000Z");
      expect(payNow.json.metadata_updated_at).toBe("2026-06-21T03:14:35.000Z");
      expectBrowserPaymentSupport(payNow.json.browserPayment);
      expect(payNow.json.route).toContain("/api/listing-roast");
      expect(payNow.json.intent).toBeNull();
      expect(payNow.json.selectedActionKey).toBe("indexedQuickScore");
      expect(payNow.json.selectedPaidAction.path).toBe("/api/listing-roast");
      expect(payNow.json.selectedPaidAction.agentPaymentRequest.maxPayment).toBe("0.001");
      expect(payNow.json.selectedPaidAction.agentPaymentPrompt).toContain("pay up to 0.001 USDC");
      expect(payNow.json.method).toBe("GET");
      expect(payNow.json.price).toBe("$0.001");
      expect(payNow.json.maxAmountRequired).toBe("1000");
      expect(payNow.json.command).toContain("/api/listing-roast");
      expect(payNow.json.command).toContain("--max-amount 1000");
      expect(payNow.json.commands).toContain("/api/commands");
      expect(payNow.json.links.commands).toContain("/api/commands");
      expect(payNow.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(payNow.json.preferredFirstPaidAction.agentPaymentRequest.maxPayment).toBe("0.001");
      expect(payNow.json.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(payNow.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(payNow.json.recommendedPaidSequence[0].action.agentPaymentPrompt).toContain("pay up to 0.001 USDC");
      expect(payNow.json.recommendedPaidSequence[1].use).toBe("fullRoastGet");
      expect(payNow.json.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(payNow.json.genericRecommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(payNow.json.genericRecommendedPaidSequence[1].use).toBe("fullRoastGet");
      expect(payNow.json.paidResponsePreview.route).toBe("/api/listing-roast");
      expect(payNow.json.paidResponsePreview.example.endpoint).toBe("listing-roast-quick-score");
      expect(payNow.json.paidResponsePreview.example.liteRoastPreview.type).toBe("lite-roast-preview");
      expect(payNow.json.paidResponsePreview.example.liteRoastPreview.topFixes.length).toBeGreaterThan(0);
      expect(payNow.json.paidResponsePreview.example.liteRoastPreview.fullRoastUpgrade.path).toBe("/api/full-listing-roast");
      expect(payNow.json.selectedFirstPaidResponsePreview.route).toBe("/api/listing-roast");
      expect(payNow.json.intentRoutes.instantScore.path).toBe("/api/instant-listing-score");
      expect(payNow.json.intentRoutes.marketplaceListingScore.path).toBe("/api/marketplace-listing-score");
      expect(payNow.json.intentRoutes.marketplaceListingConversion.path).toBe("/api/marketplace-listing-conversion-api");
      expect(payNow.json.intentRoutes.marketplaceProductListingQuality.path).toBe("/api/marketplace-product-listing-quality");
      expect(payNow.json.intentRoutes.paidApiListingQuality.path).toBe("/api/paid-api-listing-quality");
      expect(payNow.json.intentRoutes.paidApiListingQualityScore.path).toBe("/api/paid-api-listing-quality-score");
      expect(payNow.json.intentRoutes.listingQualityScoreApi.path).toBe("/api/listing-quality-score-api");
      expect(payNow.json.intentRoutes.x402ListingQuality.path).toBe("/api/x402-listing-quality");
      expect(payNow.json.intentRoutes.buyerAgentSkipReasons.path).toBe("/api/buyer-agent-skip-reasons");
      expect(payNow.json.intentRoutes.agentServiceClarity.path).toBe("/api/agent-service-clarity");
      expect(payNow.json.intentRoutes.conversionScore.path).toBe("/api/x402-marketplace-conversion");
      expect(payNow.json.intentRoutes.agentListingConversion.path).toBe("/api/agent-listing-conversion-score");
      expect(payNow.json.intentRoutes.x402Ping.path).toBe("/api/x402-ping");
      expect(payNow.json.intentRoutes.x402SiteAudit.path).toBe("/api/x402-site-audit");
      expect(payNow.json.intentRoutes.x402BuyerPrepayRiskScore.path).toBe("/api/x402-buyer-prepay-risk-score");
      expect(payNow.json.intentRoutes.scoreX402EndpointBeforePaying.path).toBe("/api/score-x402-endpoint-before-paying");
      expect(payNow.json.intentRoutes.x402RouteHealthCheck.path).toBe("/api/x402-route-health-check");
      expect(payNow.json.intentRoutes.x402ListingRankDoctor.path).toBe("/api/x402-listing-rank-doctor");
      expect(payNow.json.intentRoutes.discoveryAudit.maxAmountRequired).toBe("10000");
      expect(payNow.json.routeSelector.map((route) => route.use)).toContain("fullRoast");
      expect(payNow.json.routeSelector.map((route) => route.use)).toContain("marketplaceListingScore");
      expect(payNow.json.routeSelector.map((route) => route.use)).toContain("marketplaceListingConversion");
      expect(payNow.json.routeSelector.map((route) => route.use)).toContain("marketplaceProductListingQuality");
      expect(payNow.json.routeSelector.map((route) => route.use)).toContain("paidApiListingQuality");
      expect(payNow.json.routeSelector.map((route) => route.use)).toContain("paidApiListingQualityScore");
      expect(payNow.json.routeSelector.map((route) => route.use)).toContain("listingQualityScoreApi");
      expect(payNow.json.routeSelector.map((route) => route.use)).toContain("x402ListingQuality");
      expect(payNow.json.routeSelector.map((route) => route.use)).toContain("buyerAgentSkipReasons");
      expect(payNow.json.routeSelector.map((route) => route.use)).toContain("agentServiceClarity");
      expect(payNow.json.buyerPhraseCommandPack.map((entry) => entry.intent)).toEqual([
        "paid API listing quality score",
        "listing quality score API",
        "x402 listing quality",
        "marketplace listing conversion API",
        "marketplace product listing quality",
        "buyer-agent skip reasons",
        "Agentic.Market listing score"
      ]);
      expect(payNow.json.buyerPhraseCommandPack[0].firstPaidAction.path).toBe("/api/listing-roast");
      expect(payNow.json.buyerPhraseCommandPack[0].firstPaidAction.agentPaymentRequest.maxPayment).toBe("0.001");
      expect(payNow.json.buyerPhraseCommandPack[0].exactIntentPaidAction.path).toBe("/api/paid-api-listing-quality-score");
      expect(payNow.json.buyerPhraseCommandPack[0].exactIntentPaidAction.agentPaymentPrompt).toContain("pay up to 0.001 USDC");
      expect(payNow.json.buyerPhraseCommandPack[0].command).toContain("/api/listing-roast");
      expect(payNow.json.buyerPhraseCommandPack[0].exactIntentCommand).toContain("/api/paid-api-listing-quality-score");
      expect(payNow.json.buyerPhraseCommandPack[1].exactIntentPaidAction.path).toBe("/api/listing-quality-score-api");
      expect(payNow.json.buyerPhraseCommandPack[2].exactIntentPaidAction.path).toBe("/api/x402-listing-quality");
      expect(payNow.json.buyerPhraseCommandPack[3].exactIntentPaidAction.path).toBe("/api/marketplace-listing-conversion-api");
      expect(payNow.json.buyerPhraseCommandPack[4].exactIntentPaidAction.path).toBe("/api/marketplace-product-listing-quality");
      expect(payNow.json.buyerPhraseCommandPack[6].exactIntentPaidAction.path).toBe("/api/marketplace-listing-score");
      expect(payNow.json.expectedChallenge.status).toBe(402);
      expect(payNow.json.paidUsageProof.service).toBe("Listing Roast x402");
      expect(payNow.json.paidUsageProof.serviceName).toBe("Listing Roast x402");
      expect(payNow.json.paidUsageProof.metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(payNow.json.paidUsageProof.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(payNow.json.paidUsageProof.metadataUpdatedAt).toBe("2026-06-21T03:14:35.000Z");
      expect(payNow.json.paidUsageProof.metadata_updated_at).toBe("2026-06-21T03:14:35.000Z");
      expect(payNow.json.paidUsageProof.paidCompletions).toBe(0);
      expect(payNow.json.paidUsageProof.noSpend).toBe(true);
      expect(payNow.json.bazaarCataloging.noSelfPay).toBe(true);
      expect(payNow.json.bazaarCataloging.note).toContain("extensions.bazaar metadata");
      expect(payNow.json.bazaarCataloging.doNot).toContain("Do not pay only to refresh Bazaar search");
      expect(payNow.json.officialCdpDiscovery.indexedRoute).toBe("http://localhost:8787/api/listing-roast");
      expect(payNow.json.officialCdpDiscovery.recommendedSearchQuery).toBe("marketplace listing score");
      expect(payNow.json.officialCdpDiscovery.merchantDiscoveryUrl).toContain("/merchant?payTo=0x000000000000000000000000000000000000dEaD");
      expect(payNow.json.noSpendNote).toContain("Fetching this endpoint is free");

      const paidUsageProof = await fetchJson(server, "/api/paid-usage-proof");
      expect(paidUsageProof.status).toBe(200);
      expect(paidUsageProof.headers.get("payment-required")).toBeNull();
      expect(paidUsageProof.json.service).toBe("Listing Roast x402");
      expect(paidUsageProof.json.serviceName).toBe("Listing Roast x402");
      expect(paidUsageProof.json.metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(paidUsageProof.json.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(paidUsageProof.json.metadataUpdatedAt).toBe("2026-06-21T03:14:35.000Z");
      expect(paidUsageProof.json.metadata_updated_at).toBe("2026-06-21T03:14:35.000Z");
      expect(paidUsageProof.json.noSpend).toBe(true);
      expect(paidUsageProof.json.paidCompletions).toBe(0);
      expect(paidUsageProof.json.estimatedGrossRevenueUsd).toBe("0.00");
      expect(paidUsageProof.json.proofText).toContain("0 paid completions");
      expect(paidUsageProof.json.paidUsageProof.service).toBe("Listing Roast x402");
      expect(paidUsageProof.json.paidUsageProof.serviceName).toBe("Listing Roast x402");
      expect(paidUsageProof.json.paidUsageProof.metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(paidUsageProof.json.paidUsageProof.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(paidUsageProof.json.paidUsageProof.metadataUpdatedAt).toBe("2026-06-21T03:14:35.000Z");
      expect(paidUsageProof.json.paidUsageProof.metadata_updated_at).toBe("2026-06-21T03:14:35.000Z");
      expect(paidUsageProof.json.paidUsageProof.paidCompletions).toBe(0);
      expect(paidUsageProof.json.paidUsageProof.noSpend).toBe(true);
      expect(paidUsageProof.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(paidUsageProof.json.provenFirstPaidAction.path).toBe("/api/listing-roast");
      expect(paidUsageProof.json.preferredFirstPaidAction.maxAmountRequired).toBe("1000");
      expect(paidUsageProof.json.paymentShortcut.firstPaidPath).toBe("/api/listing-roast");
      expect(paidUsageProof.json.paymentShortcut.firstPaidMaxAmountRequired).toBe("1000");
      expect(paidUsageProof.json.command).toContain("/api/listing-roast");
      expect(paidUsageProof.json.firstPaidCommand).toContain("--max-amount 1000");
      expect(paidUsageProof.json.searchReality.knownWorkingSearchQueries.map((entry) => entry.query)).toContain("marketplace listing score");
      expect(paidUsageProof.json.searchReality.notYetRankingSearchQueries.map((entry) => entry.query)).toContain("buyer-agent skip reasons");
      expect(paidUsageProof.json.searchReality.cheapCapSearchStrategy.directRouteMaxAmountRequired).toBe("1000");
      expect(paidUsageProof.json.searchReality.fullRoastDirectHandoff.directRoute).toContain("/api/full-listing-roast");
      expect(paidUsageProof.json.searchReality.fullRoastDirectHandoff.directRouteMaxAmountRequired).toBe("10000");
      expect(paidUsageProof.json.searchReality.competitiveCapRisks.map((entry) => entry.query)).toContain("x402 discovery audit");
      expect(paidUsageProof.json.searchReality.publicCdpSearchAudit.indexedMerchantResources).toBe(1);
      expect(paidUsageProof.json.searchReality.publicCdpSearchAudit.rankedFirstQueries.map((entry) => entry.query)).toContain("listing roast");
      expect(paidUsageProof.json.searchReality.publicCdpSearchAudit.missingOrCompetedQueries.map((entry) => entry.query)).toContain("x402 listing rank doctor");
      expect(paidUsageProof.json.buyerPhraseCommandPack[0].firstPaidAction.path).toBe("/api/listing-roast");
      expect(paidUsageProof.json.buyerPhraseCommandPack[0].exactIntentPaidAction.path).toBe("/api/paid-api-listing-quality-score");
      expect(paidUsageProof.json.buyerPhraseCommandPack[0].command).toContain("/api/listing-roast");
      expect(paidUsageProof.json.buyerPhraseCommandPack[0].exactIntentCommand).toContain("/api/paid-api-listing-quality-score");
      expect(paidUsageProof.json.commands).toContain("/api/commands");
      expect(paidUsageProof.json.payNow).toContain("/api/pay-now");
      expect(paidUsageProof.json.cashRegister).toContain("/api/cash-register");
      expect(paidUsageProof.json.bazaarCataloging.noSelfPay).toBe(true);
      expect(paidUsageProof.json.bazaarCataloging.note).toContain("extensions.bazaar metadata");
      expect(paidUsageProof.json.officialCdpDiscovery.recommendedSearchUrl).toContain("query=marketplace+listing+score");
      expect(paidUsageProof.json.officialCdpDiscovery.refreshRule).toContain("real settlement");
      for (const aliasPath of ["/api/proof", "/proof", "/paid-usage-proof"]) {
        const proofAlias = await fetchJson(server, aliasPath);
        expect(proofAlias.status).toBe(200);
        expect(proofAlias.headers.get("payment-required")).toBeNull();
        expect(proofAlias.json.noSpend).toBe(true);
        expect(proofAlias.json.paidUsageProof.paidCompletions).toBe(0);
        expect(proofAlias.json.cashRegister).toContain("/api/cash-register");
      }

      const commands = await fetchJson(server, "/api/commands?intent=paid%20API%20listing%20quality");
      expect(commands.status).toBe(200);
      expect(commands.headers.get("payment-required")).toBeNull();
      expect(commands.json.noSpend).toBe(true);
      expect(commands.json.kind).toBe("compact-pay-command-handoff");
      expect(commands.json.officialCdpDiscovery.source).toBe("coinbase-cdp-bazaar");
      expect(commands.json.officialCdpDiscovery.indexedRoute).toBe("http://localhost:8787/api/listing-roast");
      expect(commands.json.officialCdpDiscovery.refreshRule).toContain("unpaid probes do not refresh");
      expect(commands.json.selectedActionKey).toBe("paidApiListingQuality");
      expect(commands.json.selectedPaidAction.path).toBe("/api/listing-roast");
      expect(commands.json.selectedFirstPaidAction.path).toBe("/api/listing-roast");
      expect(commands.json.agentPaymentRequest.maxPayment).toBe("0.001");
      expect(commands.json.payCommand).toBe(commands.json.firstPaidAction.command);
      expect(commands.json.command).toBe(commands.json.firstPaidAction.command);
      expect(commands.json.firstPaidCommand).toBe(commands.json.firstPaidAction.command);
      expect(commands.json.commandHandoff).toContain("/api/commands?intent=paid%20API%20listing%20quality");
      expect(commands.json.freeHandoff).toContain("/api/pay-now?intent=paid%20API%20listing%20quality");
      expect(commands.json.firstPaidAction.path).toBe("/api/listing-roast");
      expect(commands.json.firstPaidAction.command).toContain("--max-amount 1000");
      expect(commands.json.firstPaidAction.agentPaymentRequest.maxPayment).toBe("0.001");
      expect(commands.json.firstPaidAction.agentPaymentPrompt).toContain("pay up to 0.001 USDC");
      expect(commands.json.recommendedPaidSequence[0].action.path).toBe("/api/listing-roast");
      expect(commands.json.recommendedPaidSequence[0].action.method).toBe("GET");
      expect(commands.json.recommendedPaidSequence[0].action.agentPaymentRequest.maxPayment).toBe("0.001");
      expect(commands.json.recommendedPaidSequence[1].action.path).toBe("/api/full-listing-roast");
      expect(commands.json.recommendedPaidSequence[1].action.method).toBe("GET");
      expect(commands.json.recommendedPaidSequence[1].action.command).toContain("--max-amount 10000");
      expect(commands.json.genericRecommendedPaidSequence[1].action.method).toBe("GET");
      expect(commands.json.exactIntentPaidAction.path).toBe("/api/paid-api-listing-quality");
      expect(commands.json.buyerPhraseCommandPack[0].firstPaidAction.path).toBe("/api/listing-roast");
      expect(commands.json.buyerPhraseCommandPack[0].exactIntentPaidAction.path).toBe("/api/paid-api-listing-quality-score");
      expect(commands.json.buyerPhraseCommandPack[0].recommendedPaidSequence[1].action.path).toBe("/api/full-listing-roast");
      expect(commands.json.buyerPhraseCommandPack[0].upgradeAfterFit.command).toContain("-X GET");
      expect(commands.json.buyerPhraseCommandPack[0].commandHandoff).toContain("paid%20API%20listing%20quality%20score");
      expect(commands.json.bazaarCataloging.noSelfPay).toBe(true);
      expect(commands.json.bazaarCataloging.note).toContain("extensions.bazaar metadata");

      const commandsListingRoast = await fetchJson(server, "/api/commands?intent=listing%20roast");
      expect(commandsListingRoast.status).toBe(200);
      expect(commandsListingRoast.headers.get("payment-required")).toBeNull();
      expect(commandsListingRoast.json.firstPaidAction.path).toBe("/api/listing-roast");
      expect(commandsListingRoast.json.firstPaidAction.method).toBe("GET");
      expect(commandsListingRoast.json.firstPaidAction.maxAmountRequired).toBe("1000");
      expect(commandsListingRoast.json.firstPaidAction.command).toContain("-X GET");

      const commandsFullRoast = await fetchJson(server, "/api/commands?intent=full%20roast%20rewrite%20top%20fixes");
      expect(commandsFullRoast.status).toBe(200);
      expect(commandsFullRoast.json.firstPaidAction.path).toBe("/api/full-listing-roast");
      expect(commandsFullRoast.json.firstPaidAction.method).toBe("GET");
      expect(commandsFullRoast.json.firstPaidAction.maxAmountRequired).toBe("10000");
      expect(commandsFullRoast.json.firstPaidAction.command).toContain("-X GET");

      const commandsFullListingRoast = await fetchJson(server, "/api/commands?intent=full%20listing%20roast");
      expect(commandsFullListingRoast.status).toBe(200);
      expect(commandsFullListingRoast.headers.get("payment-required")).toBeNull();
      expect(commandsFullListingRoast.json.noSpend).toBe(true);
      expect(commandsFullListingRoast.json.selectedActionKey).toBe("fullRoastGet");
      expect(commandsFullListingRoast.json.firstPaidAction.path).toBe("/api/full-listing-roast");
      expect(commandsFullListingRoast.json.firstPaidAction.method).toBe("GET");
      expect(commandsFullListingRoast.json.firstPaidAction.maxAmountRequired).toBe("10000");
      expect(commandsFullListingRoast.json.firstPaidAction.command).toContain("/api/full-listing-roast");
      expect(commandsFullListingRoast.json.expectedChallenge.route).toContain("/api/full-listing-roast");

      const commandsSiteAudit = await fetchJson(server, "/api/commands?intent=x402%20site%20audit");
      expect(commandsSiteAudit.status).toBe(200);
      expect(commandsSiteAudit.json.firstPaidAction.path).toBe("/api/x402-site-audit");
      expect(commandsSiteAudit.json.firstPaidAction.method).toBe("GET");
      expect(commandsSiteAudit.json.firstPaidAction.maxAmountRequired).toBe("1000");
      expect(commandsSiteAudit.json.firstPaidAction.command).toContain("/api/x402-site-audit");

      const commandsSellerGrowth = await fetchJson(server, "/api/commands?intent=x402%20seller%20growth%20checklist");
      expect(commandsSellerGrowth.status).toBe(200);
      expect(commandsSellerGrowth.json.firstPaidAction.path).toBe("/api/x402-site-audit");
      expect(commandsSellerGrowth.json.firstPaidAction.method).toBe("GET");
      expect(commandsSellerGrowth.json.firstPaidAction.maxAmountRequired).toBe("1000");
      expect(commandsSellerGrowth.json.recommendedPaidSequence[1].action.path).toBe("/api/x402-discovery-audit");

      for (const [intent, selectedActionKey, paidPath] of [
        ["x402 buyer prepay risk score", "x402BuyerPrepayRiskScore", "/api/x402-buyer-prepay-risk-score"],
        ["score x402 endpoint before paying", "scoreX402EndpointBeforePaying", "/api/score-x402-endpoint-before-paying"],
        ["x402 route health check", "x402RouteHealthCheck", "/api/x402-route-health-check"],
        ["x402 listing rank doctor", "x402ListingRankDoctor", "/api/x402-listing-rank-doctor"]
      ]) {
        const commandIntent = await fetchJson(server, `/api/commands?intent=${encodeURIComponent(intent)}`);
        expect(commandIntent.status).toBe(200);
        expect(commandIntent.headers.get("payment-required")).toBeNull();
        expect(commandIntent.json.noSpend).toBe(true);
        expect(commandIntent.json.selectedActionKey).toBe(selectedActionKey);
        expect(commandIntent.json.selectedPaidAction.path).toBe(paidPath);
        expect(commandIntent.json.firstPaidAction.path).toBe(paidPath);
        expect(commandIntent.json.firstPaidAction.method).toBe("GET");
        expect(commandIntent.json.firstPaidAction.maxAmountRequired).toBe("1000");
        expect(commandIntent.json.firstPaidAction.command).toContain(paidPath);
        expect(commandIntent.json.expectedChallenge.route).toContain(paidPath);
        expect(commandIntent.json.commandHandoff).toContain(`/api/commands?intent=${encodeURIComponent(intent)}`);
      }

      const commandsMarketplaceConversion = await fetchJson(server, "/api/commands?intent=x402%20marketplace%20conversion");
      expect(commandsMarketplaceConversion.status).toBe(200);
      expect(commandsMarketplaceConversion.json.firstPaidAction.path).toBe("/api/listing-roast");
      expect(commandsMarketplaceConversion.json.firstPaidAction.method).toBe("GET");
      expect(commandsMarketplaceConversion.json.firstPaidAction.maxAmountRequired).toBe("1000");
      expect(commandsMarketplaceConversion.json.exactIntentPaidAction.path).toBe("/api/marketplace-listing-conversion-api");
      expect(commandsMarketplaceConversion.json.exactIntentPaidAction.command).toContain("/api/marketplace-listing-conversion-api");

      const commandsMarketplaceListingConversion = await fetchJson(server, "/api/commands?intent=marketplace%20listing%20conversion");
      expect(commandsMarketplaceListingConversion.status).toBe(200);
      expect(commandsMarketplaceListingConversion.json.firstPaidAction.path).toBe("/api/listing-roast");
      expect(commandsMarketplaceListingConversion.json.exactIntentPaidAction.path).toBe("/api/marketplace-listing-conversion-api");
      expect(commandsMarketplaceListingConversion.json.exactIntentPaidAction.command).toContain("/api/marketplace-listing-conversion-api");

      const commandsAgenticMarketListingScore = await fetchJson(server, "/api/commands?intent=agentic%20market%20listing%20score");
      expect(commandsAgenticMarketListingScore.status).toBe(200);
      expect(commandsAgenticMarketListingScore.headers.get("payment-required")).toBeNull();
      expect(commandsAgenticMarketListingScore.json.firstPaidAction.path).toBe("/api/listing-roast");
      expect(commandsAgenticMarketListingScore.json.firstPaidAction.method).toBe("GET");
      expect(commandsAgenticMarketListingScore.json.firstPaidAction.maxAmountRequired).toBe("1000");
      expect(commandsAgenticMarketListingScore.json.exactIntentPaidAction.path).toBe("/api/marketplace-listing-score");
      expect(commandsAgenticMarketListingScore.json.expectedChallenge.route).toContain("/api/listing-roast");

      const commandsAgentListingConversion = await fetchJson(server, "/api/commands?intent=agent%20listing%20conversion");
      expect(commandsAgentListingConversion.status).toBe(200);
      expect(commandsAgentListingConversion.json.firstPaidAction.path).toBe("/api/agent-listing-conversion-score");
      expect(commandsAgentListingConversion.json.firstPaidAction.method).toBe("GET");
      expect(commandsAgentListingConversion.json.firstPaidAction.maxAmountRequired).toBe("1000");
      expect(commandsAgentListingConversion.json.firstPaidAction.command).toContain("/api/agent-listing-conversion-score");

      const payNowSkipReasons = await fetchJson(server, "/api/pay-now?intent=buyer-agent%20skip%20reasons");
      expect(payNowSkipReasons.status).toBe(200);
      expect(payNowSkipReasons.headers.get("payment-required")).toBeNull();
      expect(payNowSkipReasons.json.intent).toBe("buyer-agent skip reasons");
      expect(payNowSkipReasons.json.selectedActionKey).toBe("buyerAgentSkipReasons");
      expect(payNowSkipReasons.json.route).toContain("/api/listing-roast");
      expect(payNowSkipReasons.json.method).toBe("GET");
      expect(payNowSkipReasons.json.price).toBe("$0.001");
      expect(payNowSkipReasons.json.maxAmountRequired).toBe("1000");
      expect(payNowSkipReasons.json.command).toContain("/api/listing-roast");
      expect(payNowSkipReasons.json.expectedChallenge.amount).toBe("1000");
      expect(payNowSkipReasons.json.expectedChallenge.route).toContain("/api/listing-roast");
      expect(payNowSkipReasons.json.selectedPaidAction.path).toBe("/api/listing-roast");
      expect(payNowSkipReasons.json.exactIntentPaidAction.path).toBe("/api/buyer-agent-skip-reasons");
      expect(payNowSkipReasons.json.selectedFirstPaidAction.path).toBe("/api/listing-roast");
      expect(payNowSkipReasons.json.publicCdpStaleCardOverride.status).toBe("owned-live-metadata-overrides-stale-public-card");
      expect(payNowSkipReasons.json.publicCdpStaleCardOverride.preferredFirstPaidPath).toBe("/api/listing-roast");
      expect(payNowSkipReasons.json.publicCdpStaleCardOverride.selectedPaidPath).toBe("/api/listing-roast");
      expect(payNowSkipReasons.json.publicCdpStaleCardOverride.selectedPaidMaxAmountRequired).toBe("1000");
      expect(payNowSkipReasons.json.publicCdpStaleCardOverride.directFullRoastPath).toBe("/api/full-listing-roast");
      expect(payNowSkipReasons.json.publicCdpStaleCardOverride.stalePublicFieldsToIgnore.join(" ")).toContain("$1.00");
      expect(payNowSkipReasons.json.publicCdpStaleCardOverride.stalePublicFieldsToIgnore.join(" ")).toContain("POST /api/listing-roast");
      expect(payNowSkipReasons.json.selectedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(payNowSkipReasons.json.selectedPaidSequence[0].action.path).toBe("/api/listing-roast");
      expect(payNowSkipReasons.json.selectedPaidSequence[1].use).toBe("fullRoastGet");
      expect(payNowSkipReasons.json.paidResponsePreview.route).toBe("/api/listing-roast");
      expect(payNowSkipReasons.json.paidResponsePreview.includes).toContain("verdict");
      expect(payNowSkipReasons.json.selectedFirstPaidResponsePreview.route).toBe("/api/listing-roast");
      expect(payNowSkipReasons.json.buyerInstruction).toContain("start with GET /api/listing-roast");
      expect(payNowSkipReasons.json.buyerInstruction).toContain("Use GET /api/buyer-agent-skip-reasons only when");
      expect(payNowSkipReasons.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(payNowSkipReasons.json.provenFirstPaidAction.path).toBe("/api/listing-roast");
      expect(payNowSkipReasons.json.provenFirstPaidReason).toContain("wallet-backed paid-use proof");
      expect(payNowSkipReasons.json.rankedPaidRoutes[0].id).toBe("indexed_roast_quick_score");
      expect(payNowSkipReasons.json.rankedPaidRoutes.map((route) => route.id)).toContain("buyer_agent_skip_reasons_alias");
      expect(payNowSkipReasons.json.rankedPaidRoutes.map((route) => route.id)).toContain("agent_listing_conversion_score");

      const payNowPaidApiListingQuality = await fetchJson(server, "/api/pay-now?intent=paid%20API%20listing%20quality");
      expect(payNowPaidApiListingQuality.status).toBe(200);
      expect(payNowPaidApiListingQuality.json.selectedActionKey).toBe("paidApiListingQuality");
      expect(payNowPaidApiListingQuality.json.route).toContain("/api/listing-roast");
      expect(payNowPaidApiListingQuality.json.command).toContain("/api/listing-roast");
      expect(payNowPaidApiListingQuality.json.selectedPaidAction.path).toBe("/api/listing-roast");
      expect(payNowPaidApiListingQuality.json.exactIntentPaidAction.path).toBe("/api/paid-api-listing-quality");
      expect(payNowPaidApiListingQuality.json.selectedFirstPaidAction.path).toBe("/api/listing-roast");
      expect(payNowPaidApiListingQuality.json.metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(payNowPaidApiListingQuality.json.paymentShortcut.selectedPaidPath).toBe("/api/listing-roast");
      expect(payNowPaidApiListingQuality.json.paymentShortcut.firstPaidPath).toBe("/api/listing-roast");
      expect(payNowPaidApiListingQuality.json.paymentShortcut.upgradeAfterQuickScore.selectedPaidPath).toBe("/api/full-listing-roast");
      expect(payNowPaidApiListingQuality.json.paymentShortcut.upgradeAfterQuickScore.selectedPaidMaxAmountRequired).toBe("10000");
      expect(payNowPaidApiListingQuality.json.paidResponsePreview.upgradeAfterQuickScore.command).toContain("/api/full-listing-roast");
      expect(payNowPaidApiListingQuality.json.provenFirstPaidAction.path).toBe("/api/listing-roast");
      expect(payNowPaidApiListingQuality.json.rankedPaidRoutes[0].id).toBe("indexed_roast_quick_score");
      expect(payNowPaidApiListingQuality.json.rankedPaidRoutes.map((route) => route.id)).toContain("paid_api_listing_quality_alias");

      const payNowMarketplaceListingScore = await fetchJson(server, "/api/pay-now?intent=marketplace%20listing%20score");
      expect(payNowMarketplaceListingScore.status).toBe(200);
      expect(payNowMarketplaceListingScore.json.selectedActionKey).toBe("marketplaceListingScore");
      expect(payNowMarketplaceListingScore.json.route).toContain("/api/listing-roast");
      expect(payNowMarketplaceListingScore.json.selectedPaidAction.path).toBe("/api/listing-roast");
      expect(payNowMarketplaceListingScore.json.exactIntentPaidAction.path).toBe("/api/marketplace-listing-score");
      expect(payNowMarketplaceListingScore.json.selectedFirstPaidAction.path).toBe("/api/listing-roast");
      expect(payNowMarketplaceListingScore.json.rankedPaidRoutes[0].id).toBe("indexed_roast_quick_score");
      expect(payNowMarketplaceListingScore.json.rankedPaidRoutes.map((route) => route.id)).toContain("marketplace_listing_score_alias");

      const payNowMarketplaceListingConversion = await fetchJson(server, "/api/pay-now?intent=marketplace%20listing%20conversion");
      expect(payNowMarketplaceListingConversion.status).toBe(200);
      expect(payNowMarketplaceListingConversion.json.selectedActionKey).toBe("marketplaceListingConversion");
      expect(payNowMarketplaceListingConversion.json.route).toContain("/api/listing-roast");
      expect(payNowMarketplaceListingConversion.json.command).toContain("/api/listing-roast");
      expect(payNowMarketplaceListingConversion.json.selectedPaidAction.path).toBe("/api/listing-roast");
      expect(payNowMarketplaceListingConversion.json.exactIntentPaidAction.path).toBe("/api/marketplace-listing-conversion-api");
      expect(payNowMarketplaceListingConversion.json.selectedFirstPaidAction.path).toBe("/api/listing-roast");
      expect(payNowMarketplaceListingConversion.json.rankedPaidRoutes[0].id).toBe("indexed_roast_quick_score");
      expect(payNowMarketplaceListingConversion.json.rankedPaidRoutes.map((route) => route.id)).toContain("marketplace_listing_conversion_api_alias");

      const payNowAgentServiceClarity = await fetchJson(server, "/api/pay-now?intent=agent%20service%20clarity");
      expect(payNowAgentServiceClarity.status).toBe(200);
      expect(payNowAgentServiceClarity.json.selectedActionKey).toBe("agentServiceClarity");
      expect(payNowAgentServiceClarity.json.route).toContain("/api/listing-roast");
      expect(payNowAgentServiceClarity.json.selectedPaidAction.path).toBe("/api/listing-roast");
      expect(payNowAgentServiceClarity.json.exactIntentPaidAction.path).toBe("/api/agent-service-clarity");
      expect(payNowAgentServiceClarity.json.selectedFirstPaidAction.path).toBe("/api/listing-roast");
      expect(payNowAgentServiceClarity.json.rankedPaidRoutes[0].id).toBe("indexed_roast_quick_score");
      expect(payNowAgentServiceClarity.json.rankedPaidRoutes.map((route) => route.id)).toContain("agent_service_clarity_alias");

      const payNowDiscoveryAudit = await fetchJson(server, "/api/pay-now?intent=x402%20discovery%20audit");
      expect(payNowDiscoveryAudit.status).toBe(200);
      expect(payNowDiscoveryAudit.json.selectedActionKey).toBe("discoveryAuditQuick");
      expect(payNowDiscoveryAudit.json.route).toContain("/api/x402-discovery-audit");
      expect(payNowDiscoveryAudit.json.maxAmountRequired).toBe("1000");

      const payNowFixBazaar = await fetchJson(server, "/api/pay-now?intent=fix%20x402%20bazaar%20listing");
      expect(payNowFixBazaar.status).toBe(200);
      expect(payNowFixBazaar.json.selectedActionKey).toBe("discoveryAuditQuick");
      expect(payNowFixBazaar.json.route).toContain("/api/x402-discovery-audit");
      expect(payNowFixBazaar.json.maxAmountRequired).toBe("1000");
      expect(payNowFixBazaar.json.rankedPaidRoutes[0].id).toBe("x402_discovery_audit_quick");

      const payNowStalePrice = await fetchJson(server, "/api/pay-now?intent=stale%20bazaar%20price");
      expect(payNowStalePrice.status).toBe(200);
      expect(payNowStalePrice.json.selectedActionKey).toBe("discoveryAuditQuick");
      expect(payNowStalePrice.json.route).toContain("/api/x402-discovery-audit");

      const payNowAgent402Route = await fetchJson(server, "/api/pay-now?intent=Agent402%20route%20visibility");
      expect(payNowAgent402Route.status).toBe(200);
      expect(payNowAgent402Route.json.selectedActionKey).toBe("agent402RouteVisibility");
      expect(payNowAgent402Route.json.route).toContain("/api/agent402-route-visibility");
      expect(payNowAgent402Route.json.rankedPaidRoutes[0].id).toBe("agent402_route_visibility_audit");

      const payNowPreflight = await fetchJson(server, "/api/pay-now?intent=paid%20API%20preflight%20before%20paying");
      expect(payNowPreflight.status).toBe(200);
      expect(payNowPreflight.json.selectedActionKey).toBe("x402SiteAudit");
      expect(payNowPreflight.json.route).toContain("/api/x402-site-audit");
      expect(payNowPreflight.json.maxAmountRequired).toBe("1000");
      expect(payNowPreflight.json.rankedPaidRoutes[0].id).toBe("x402_site_audit");
      expect(payNowPreflight.json.paidResponsePreview.example.endpoint).toBe("x402-site-audit");
      expect(payNowPreflight.json.paidResponsePreview.example.direct402.amount).toBe("1000");
      expect(payNowPreflight.json.paidResponsePreview.example.nextActions[0]).toContain("settled payment");

      for (const [intent, selectedActionKey, paidPath] of [
        ["x402 buyer prepay risk score", "x402BuyerPrepayRiskScore", "/api/x402-buyer-prepay-risk-score"],
        ["score x402 endpoint before paying", "scoreX402EndpointBeforePaying", "/api/score-x402-endpoint-before-paying"],
        ["x402 route health check", "x402RouteHealthCheck", "/api/x402-route-health-check"],
        ["x402 listing rank doctor", "x402ListingRankDoctor", "/api/x402-listing-rank-doctor"]
      ]) {
        const payNowPrepayAlias = await fetchJson(server, `/api/pay-now?intent=${encodeURIComponent(intent)}`);
        expect(payNowPrepayAlias.status).toBe(200);
        expect(payNowPrepayAlias.json.selectedActionKey).toBe(selectedActionKey);
        expect(payNowPrepayAlias.json.route).toContain(paidPath);
        expect(payNowPrepayAlias.json.maxAmountRequired).toBe("1000");
        expect(payNowPrepayAlias.json.paidResponsePreview.includes).toContain("direct 402 check");
        expect(payNowPrepayAlias.json.paidResponsePreview.includes).toContain("search visibility");
        expect(payNowPrepayAlias.json.paidResponsePreview.example.endpoint).toBe("x402-site-audit");
        expect(payNowPrepayAlias.json.paidResponsePreview.example.direct402.amount).toBe("1000");
        expect(payNowPrepayAlias.json.paidResponsePreview.example.agent402Route.matchedResult.route).toBe("/api/listing-roast");
      }

      const payNowDirectoryPost = await fetchJson(server, "/api/pay-now?intent=generic%20root%20POST%20directory%20handoff");
      expect(payNowDirectoryPost.status).toBe(200);
      expect(payNowDirectoryPost.json.selectedActionKey).toBe("directoryPost");
      expect(payNowDirectoryPost.json.route).toBe("http://localhost:8787/");
      expect(payNowDirectoryPost.json.method).toBe("POST");
      expect(payNowDirectoryPost.json.maxAmountRequired).toBe("1000");

      const payNowApiV1 = await fetchJson(server, "/api/pay-now?intent=api%2Fv1%20route%20map");
      expect(payNowApiV1.status).toBe(200);
      expect(payNowApiV1.json.selectedActionKey).toBe("apiV1Entry");
      expect(payNowApiV1.json.route).toContain("/api/v1");
      expect(payNowApiV1.json.maxAmountRequired).toBe("1000");

      const payNowV1 = await fetchJson(server, "/api/pay-now?intent=short%20v1%20entry%20route%20map");
      expect(payNowV1.status).toBe(200);
      expect(payNowV1.json.selectedActionKey).toBe("v1Entry");
      expect(payNowV1.json.route).toContain("/v1");
      expect(payNowV1.json.maxAmountRequired).toBe("1000");

      const payNowMetadata = await fetchJson(server, "/api/pay-now?intent=openapi%20llms%20robots%20sitemap%20metadata");
      expect(payNowMetadata.status).toBe(200);
      expect(payNowMetadata.json.selectedActionKey).toBe("x402SiteAudit");
      expect(payNowMetadata.json.route).toContain("/api/x402-site-audit");

      const payNowAgentListingConversion = await fetchJson(server, "/api/pay-now?intent=agent%20listing%20conversion");
      expect(payNowAgentListingConversion.status).toBe(200);
      expect(payNowAgentListingConversion.json.selectedActionKey).toBe("agentListingConversion");
      expect(payNowAgentListingConversion.json.route).toContain("/api/agent-listing-conversion-score");
      expect(payNowAgentListingConversion.json.maxAmountRequired).toBe("1000");
      expect(payNowAgentListingConversion.json.selectedPaidAction.path).toBe("/api/agent-listing-conversion-score");
      expect(payNowAgentListingConversion.json.selectedFirstPaidAction.path).toBe("/api/agent-listing-conversion-score");
      expect(payNowAgentListingConversion.json.command).toContain("/api/agent-listing-conversion-score");

      const payNowFullRoast = await fetchJson(server, "/api/pay-now?intent=full%20roast%20rewrite%20top%20fixes");
      expect(payNowFullRoast.status).toBe(200);
      expect(payNowFullRoast.json.selectedActionKey).toBe("fullRoastGet");
      expect(payNowFullRoast.json.route).toContain("/api/full-listing-roast");
      expect(payNowFullRoast.json.method).toBe("GET");
      expect(payNowFullRoast.json.maxAmountRequired).toBe("10000");
      expect(payNowFullRoast.json.expectedChallenge.amount).toBe("10000");
      expect(payNowFullRoast.json.publicCdpStaleCardOverride.selectedPaidPath).toBe("/api/full-listing-roast");
      expect(payNowFullRoast.json.publicCdpStaleCardOverride.selectedPaidMaxAmountRequired).toBe("10000");
      expect(payNowFullRoast.json.publicCdpStaleCardOverride.directFullRoastPath).toBe("/api/full-listing-roast");
      expect(payNowFullRoast.json.paymentShortcut.firstPaidPath).toBe("/api/full-listing-roast");
      expect(payNowFullRoast.json.paymentShortcut.upgradeAfterQuickScore).toBeUndefined();
      expect(payNowFullRoast.json.paymentShortcut.directFullRoastNow).toBeUndefined();
      expect(payNowFullRoast.json.paymentShortcut.instruction).toContain("direct paid route");

      const payNowDiscovery = await fetchJson(server, "/api/pay-now?intent=x402%20discovery%20audit");
      expect(payNowDiscovery.status).toBe(200);
      expect(payNowDiscovery.json.selectedActionKey).toBe("discoveryAuditQuick");
      expect(payNowDiscovery.json.selectedFirstPaidAction.path).toBe("/api/x402-discovery-audit");
      expect(payNowDiscovery.json.selectedPaidSequence[0].use).toBe("discoveryAuditQuick");
      expect(payNowDiscovery.json.selectedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(payNowDiscovery.json.selectedPaidSequence[1].use).toBe("discoveryAudit");
      expect(payNowDiscovery.json.selectedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(payNowDiscovery.json.recommendedPaidSequence[0].use).toBe("discoveryAuditQuick");
      expect(payNowDiscovery.json.recommendedPaidSequence[0].action.path).toBe("/api/x402-discovery-audit");
      expect(payNowDiscovery.json.recommendedPaidSequence[1].use).toBe("discoveryAudit");
      expect(payNowDiscovery.json.genericRecommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(payNowDiscovery.json.genericRecommendedPaidSequence[0].action.path).toBe("/api/listing-roast");
      expect(payNowDiscovery.json.paidResponsePreview.route).toBe("/api/x402-discovery-audit");
      expect(payNowDiscovery.json.paidResponsePreview.example.endpoint).toBe("x402-discovery-audit-quick");
      expect(payNowDiscovery.json.buyerInstruction).toContain("For this exact buyer intent");
      expect(payNowDiscovery.json.buyerInstruction).toContain("/api/x402-discovery-audit");
      expect(payNowDiscovery.json.provenFirstPaidAction.path).toBe("/api/listing-roast");

      const pricing = await fetchJson(server, "/api/pricing");
      expect(pricing.status).toBe(200);
      expect(pricing.headers.get("payment-required")).toBeNull();
      expect(pricing.json.service).toBe("Listing Roast x402");
      expect(pricing.json.serviceName).toBe("Listing Roast x402");
      expect(pricing.json.metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(pricing.json.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(pricing.json.metadataUpdatedAt).toBe("2026-06-21T03:14:35.000Z");
      expect(pricing.json.metadata_updated_at).toBe("2026-06-21T03:14:35.000Z");
      expect(pricing.json.noSpend).toBe(true);
      expect(pricing.json.paidUsageProof.serviceName).toBe("Listing Roast x402");
      expect(pricing.json.paidUsageProof.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(pricing.json.paidUsageProof.paidCompletions).toBe(0);
      expect(pricing.json.paidUsageProof.cashRegister).toContain("/api/cash-register");
      expect(pricing.json.commands).toContain("/api/commands");
      expect(pricing.json.links.commands).toContain("/api/commands");
      expect(pricing.json.count).toBe(PAID_RESOURCE_COUNT);
      expect(pricing.json.startHere.path).toBe("/api/listing-roast");
      expect(pricing.json.startHere.method).toBe("GET");
      expect(pricing.json.startHere.maxAmountRequired).toBe("1000");
      expect(pricing.json.startHere.upgradeAfterFit.maxAmountRequired).toBe("10000");
      expect(pricing.json.routes[0].path).toBe("/api/listing-roast");
      expect(pricing.json.routes[0].maxAmountRequired).toBe("1000");
      expect(pricing.json.preferredFirstPaidResponsePreview.route).toBe("/api/listing-roast");
      expect(pricing.json.preferredFirstPaidResponsePreview.example.endpoint).toBe("listing-roast-quick-score");
      expect(pricing.json.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(pricing.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(pricing.json.recommendedPaidSequence[1].use).toBe("fullRoastGet");
      expect(pricing.json.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(pricing.json.routes.map((route) => route.path)).toContain("/api/x402-site-audit");
      expect(pricing.json.routes.map((route) => route.path)).toContain("/api/preflight");
      expect(pricing.json.routes.map((route) => route.path)).toContain("/api/v1/preflight");
      expect(pricing.json.routes.map((route) => route.path)).toContain("/preflight");

      const findDiscovery = await fetchJson(server, "/api/find?q=x402%20discovery%20audit");
      expect(findDiscovery.status).toBe(200);
      expect(findDiscovery.headers.get("payment-required")).toBeNull();
      expect(findDiscovery.json.service).toBe("Listing Roast x402");
      expect(findDiscovery.json.serviceName).toBe("Listing Roast x402");
      expect(findDiscovery.json.metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(findDiscovery.json.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(findDiscovery.json.noSpend).toBe(true);
      expect(findDiscovery.json.paidUsageProof.paidCompletions).toBe(0);
      expect(findDiscovery.json.commands).toContain("/api/commands");
      expect(findDiscovery.json.links.commands).toContain("/api/commands");
      expect(findDiscovery.json.startHere.use).toBe("discoveryAuditQuick");
      expect(findDiscovery.json.startHere.path).toBe("/api/x402-discovery-audit");
      expect(findDiscovery.json.startHere.method).toBe("GET");
      expect(findDiscovery.json.startHere.expectedChallenge.amount).toBe("1000");
      expect(findDiscovery.json.startHere.upgradeAfterFit.path).toBe("/api/x402-discovery-audit");
      expect(findDiscovery.json.startHere.upgradeAfterFit.maxAmountRequired).toBe("10000");
      expect(findDiscovery.json.recommended.path).toBe("/api/x402-discovery-audit");
      expect(findDiscovery.json.recommended.maxAmountRequired).toBe("1000");
      expect(findDiscovery.json.selectedActionKey).toBe("discoveryAuditQuick");
      expect(findDiscovery.json.selectedPaidAction.path).toBe("/api/x402-discovery-audit");
      expect(findDiscovery.json.selectedPaidAction.maxAmountRequired).toBe("1000");
      expect(findDiscovery.json.selectedPaidRoute.path).toBe("/api/x402-discovery-audit");
      expect(findDiscovery.json.selectedPaidUrl).toContain("/api/x402-discovery-audit");
      expect(findDiscovery.json.firstPaidRoute.path).toBe("/api/x402-discovery-audit");
      expect(findDiscovery.json.payableRoute.maxAmountRequired).toBe("1000");
      expect(findDiscovery.json.routeSelectorUrl).toContain("/api/route");
      expect(findDiscovery.json.officialCdpDiscovery.domainRestrictedSearchUrl).toContain("urlSubstring=localhost");
      expect(findDiscovery.json.selectedFirstPaidAction.path).toBe("/api/x402-discovery-audit");
      expect(findDiscovery.json.selectedPaidSequence[0].use).toBe("discoveryAuditQuick");
      expect(findDiscovery.json.selectedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(findDiscovery.json.selectedPaidSequence[1].use).toBe("discoveryAudit");
      expect(findDiscovery.json.buyerInstruction).toContain("For this exact buyer intent");
      expect(findDiscovery.json.buyerInstruction).toContain("/api/x402-discovery-audit");
      expect(findDiscovery.json.alternatives.map((route) => route.path)).toContain("/api/x402-site-audit");
      expect(findDiscovery.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(findDiscovery.json.provenFirstPaidAction.path).toBe("/api/listing-roast");
      expect(findDiscovery.json.provenFirstPaidReason).toContain("wallet-backed paid-use proof");
      expect(findDiscovery.json.recommendedPaidSequence[0].use).toBe("discoveryAuditQuick");
      expect(findDiscovery.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(findDiscovery.json.recommendedPaidSequence[0].action.path).toBe("/api/x402-discovery-audit");
      expect(findDiscovery.json.recommendedPaidSequence[1].use).toBe("discoveryAudit");
      expect(findDiscovery.json.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(findDiscovery.json.genericRecommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(findDiscovery.json.genericRecommendedPaidSequence[0].action.path).toBe("/api/listing-roast");
      expect(findDiscovery.json.genericRecommendedPaidSequence[1].use).toBe("fullRoastGet");
      expect(findDiscovery.json.paidResponsePreview.route).toBe("/api/x402-discovery-audit");
      expect(findDiscovery.json.paidResponsePreview.includes).toContain("search visibility");
      expect(findDiscovery.json.selectedFirstPaidResponsePreview.example.endpoint).toBe("x402-discovery-audit-quick");
      expect(findDiscovery.json.command).toContain("/api/x402-discovery-audit");
      expect(findDiscovery.json.commandHandoff).toContain("x402%20discovery%20audit");
      expect(findDiscovery.json.paymentRule).toContain("Do not call");

      const findAgent402Route = await fetchJson(server, "/api/find?q=Agent402%20route%20visibility");
      expect(findAgent402Route.status).toBe(200);
      expect(findAgent402Route.json.startHere.use).toBe("agent402RouteVisibility");
      expect(findAgent402Route.json.selectedActionKey).toBe("agent402RouteVisibility");
      expect(findAgent402Route.json.selectedPaidAction.path).toBe("/api/agent402-route-visibility");
      expect(findAgent402Route.json.paidResponsePreview.includes).toContain("Agent402 route visibility");

      const findQualityScore = await fetchJson(server, "/api/find?q=paid%20API%20listing%20quality%20score");
      expect(findQualityScore.status).toBe(200);
      expect(findQualityScore.json.selectedActionKey).toBe("paidApiListingQualityScore");
      expect(findQualityScore.json.selectedFirstPaidAction.path).toBe("/api/listing-roast");
      expect(findQualityScore.json.selectedFirstPaidAction.agentPaymentRequest.maxPayment).toBe("0.001");
      expect(findQualityScore.json.command).toContain("/api/listing-roast");
      expect(findQualityScore.json.exactIntentPaidAction.path).toBe("/api/paid-api-listing-quality-score");
      expect(findQualityScore.json.exactIntentPaidAction.agentPaymentPrompt).toContain("pay up to 0.001 USDC");
      expect(findQualityScore.json.exactIntentCommand).toContain("/api/paid-api-listing-quality-score");
      expect(findQualityScore.json.commandHandoff).toContain("paid%20API%20listing%20quality%20score");

      const findPreflight = await fetchJson(server, "/api/find?q=paid%20API%20preflight%20before%20paying");
      expect(findPreflight.status).toBe(200);
      expect(findPreflight.json.recommended.path).toBe("/api/x402-site-audit");
      expect(findPreflight.json.selectedActionKey).toBe("x402SiteAudit");
      expect(findPreflight.json.selectedPaidAction.maxAmountRequired).toBe("1000");

      const findAgentListingConversion = await fetchJson(server, "/api/find?q=agent%20listing%20conversion%20score");
      expect(findAgentListingConversion.status).toBe(200);
      expect(findAgentListingConversion.json.recommended.path).toBe("/api/agent-listing-conversion-score");
      expect(findAgentListingConversion.json.selectedActionKey).toBe("agentListingConversion");
      expect(findAgentListingConversion.json.selectedPaidAction.path).toBe("/api/agent-listing-conversion-score");
      expect(findAgentListingConversion.json.selectedPaidAction.maxAmountRequired).toBe("1000");
      expect(findAgentListingConversion.json.selectedFirstPaidAction.path).toBe("/api/agent-listing-conversion-score");
      expect(findAgentListingConversion.json.command).toContain("/api/agent-listing-conversion-score");

      const findMarketplaceListingConversion = await fetchJson(server, "/api/find?q=marketplace%20listing%20conversion");
      expect(findMarketplaceListingConversion.status).toBe(200);
      expect(findMarketplaceListingConversion.json.recommended.path).toBe("/api/listing-roast");
      expect(findMarketplaceListingConversion.json.selectedActionKey).toBe("marketplaceListingConversion");
      expect(findMarketplaceListingConversion.json.selectedPaidAction.path).toBe("/api/listing-roast");
      expect(findMarketplaceListingConversion.json.exactIntentPaidAction.path).toBe("/api/marketplace-listing-conversion-api");
      expect(findMarketplaceListingConversion.json.selectedFirstPaidAction.path).toBe("/api/listing-roast");
      expect(findMarketplaceListingConversion.json.command).toContain("/api/listing-roast");
      expect(findMarketplaceListingConversion.json.exactIntentCommand).toContain("/api/marketplace-listing-conversion-api");

      const findSkipReasons = await fetchJson(server, "/api/find?q=buyer-agent%20skip%20reasons");
      expect(findSkipReasons.status).toBe(200);
      expect(findSkipReasons.json.recommended.path).toBe("/api/listing-roast");
      expect(findSkipReasons.json.recommendedRoute.path).toBe("/api/listing-roast");
      expect(findSkipReasons.json.recommendedPaidRoute.path).toBe("/api/listing-roast");
      expect(findSkipReasons.json.selectedActionKey).toBe("buyerAgentSkipReasons");
      expect(findSkipReasons.json.selectedPaidAction.path).toBe("/api/listing-roast");
      expect(findSkipReasons.json.selectedPaidRoute.path).toBe("/api/listing-roast");
      expect(findSkipReasons.json.selectedPaidUrl).toContain("/api/listing-roast");
      expect(findSkipReasons.json.selectedPaidPrice).toBe("$0.001");
      expect(findSkipReasons.json.selectedPaidMaxAmountRequired).toBe("1000");
      expect(findSkipReasons.json.firstPaidRoute.path).toBe("/api/listing-roast");
      expect(findSkipReasons.json.firstPaidUrl).toContain("/api/listing-roast");
      expect(findSkipReasons.json.payableRoute.path).toBe("/api/listing-roast");
      expect(findSkipReasons.json.exactIntentPaidAction.path).toBe("/api/buyer-agent-skip-reasons");
      expect(findSkipReasons.json.exactIntentPaidRoute.path).toBe("/api/buyer-agent-skip-reasons");
      expect(findSkipReasons.json.exactIntentPaidUrl).toContain("/api/buyer-agent-skip-reasons");
      expect(findSkipReasons.json.selectedFirstPaidAction.path).toBe("/api/listing-roast");
      expect(findSkipReasons.json.selectedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(findSkipReasons.json.selectedPaidSequence[0].action.path).toBe("/api/listing-roast");
      expect(findSkipReasons.json.paidResponsePreview.route).toBe("/api/listing-roast");
      expect(findSkipReasons.json.selectedFirstPaidResponsePreview.route).toBe("/api/listing-roast");
      expect(findSkipReasons.json.command).toContain("/api/listing-roast");
      expect(findSkipReasons.json.exactIntentCommand).toContain("/api/buyer-agent-skip-reasons");
      expect(findSkipReasons.json.buyerInstruction).toContain("start with GET /api/listing-roast");
      expect(findSkipReasons.json.rankedPaidRoutes[0].path).toBe("/api/listing-roast");
      expect(findSkipReasons.json.rankedPaidRoutes[0].maxAmountRequired).toBe("1000");
      expect(findSkipReasons.json.alternatives.map((route) => route.path)).toContain("/api/buyer-agent-skip-reasons");
      expect(findSkipReasons.json.alternatives.map((route) => route.path)).toContain("/api/agent-listing-conversion");

      const findMixedSkipReasons = await fetchJson(server, "/api/find?q=buyer-agent%20skip%20reasons%20paid%20API%20listing%20clarity");
      expect(findMixedSkipReasons.status).toBe(200);
      expect(findMixedSkipReasons.json.recommended.path).toBe("/api/listing-roast");
      expect(findMixedSkipReasons.json.selectedActionKey).toBe("buyerAgentSkipReasons");
      expect(findMixedSkipReasons.json.exactIntentPaidAction.path).toBe("/api/buyer-agent-skip-reasons");
      expect(findMixedSkipReasons.json.alternatives.map((route) => route.path)).toContain("/api/agent-service-clarity");

      const findFullRewrite = await fetchJson(server, "/api/find?q=listing%20roast%20full%20rewrite");
      expect(findFullRewrite.status).toBe(200);
      expect(findFullRewrite.json.recommended.id).toBe("full_listing_roast_get");
      expect(findFullRewrite.json.recommended.method).toBe("GET");
      expect(findFullRewrite.json.startHere.use).toBe("fullRoastGet");
      expect(findFullRewrite.json.startHere.path).toBe("/api/full-listing-roast");
      expect(findFullRewrite.json.startHere.method).toBe("GET");
      expect(findFullRewrite.json.startHere.maxAmountRequired).toBe("10000");
      expect(findFullRewrite.json.startHere.upgradeAfterFit).toBeUndefined();
      expect(findFullRewrite.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(findFullRewrite.json.preferredFirstPaidAction.method).toBe("GET");
      expect(findFullRewrite.json.recommendedPaidSequence[0].use).toBe("fullRoastGet");
      expect(findFullRewrite.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("10000");

      const findCustomScore = await fetchJson(server, "/api/find?q=score%20my%20paid%20API%20listing%20with%20a%20custom%20body");
      expect(findCustomScore.status).toBe(200);
      expect(findCustomScore.json.recommended.id).toBe("listing_score");
      expect(findCustomScore.json.recommended.method).toBe("POST");
      expect(findCustomScore.json.recommended.maxAmountRequired).toBe("5000");

      const routeDiscovery = await fetchJson(server, "/api/route?query=x402%20discovery%20audit&top=3");
      expect(routeDiscovery.status).toBe(200);
      expect(routeDiscovery.headers.get("payment-required")).toBeNull();
      expect(routeDiscovery.json.service).toBe("Listing Roast x402");
      expect(routeDiscovery.json.serviceName).toBe("Listing Roast x402");
      expect(routeDiscovery.json.metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(routeDiscovery.json.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(routeDiscovery.json.noSpend).toBe(true);
      expect(routeDiscovery.json.paidUsageProof.paidCompletions).toBe(0);
      expect(routeDiscovery.json.officialCdpDiscovery.publicCdpSearchAudit.indexedMerchantResources).toBe(1);
      expect(routeDiscovery.json.officialCdpDiscovery.publicCdpSearchAudit.missingOrCompetedQueries.map((entry) => entry.query)).toContain("x402 discovery audit");
      expect(routeDiscovery.json.searchReality.publicCdpSearchAudit.missingOrCompetedQueries.find((entry) => entry.query === "x402 discovery audit").firstPaidRoute).toContain("/api/x402-discovery-audit");
      expect(routeDiscovery.json.searchReality.knownWorkingSearchQueries.map((entry) => entry.query)).toContain("marketplace listing score");
      expect(routeDiscovery.json.startHere.use).toBe("discoveryAuditQuick");
      expect(routeDiscovery.json.startHere.path).toBe("/api/x402-discovery-audit");
      expect(routeDiscovery.json.startHere.buyerInstruction).toContain("start with GET /api/x402-discovery-audit");
      expect(routeDiscovery.json.startHere.upgradeAfterFit.path).toBe("/api/x402-discovery-audit");
      expect(routeDiscovery.json.startHere.upgradeAfterFit.maxAmountRequired).toBe("10000");
      expect(routeDiscovery.json.scope).toBe("owned-routes-only");
      expect(routeDiscovery.json.results).toHaveLength(3);
      expect(routeDiscovery.json.results[0].serviceName).toBe("Listing Roast x402");
      expect(routeDiscovery.json.results[0].metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(routeDiscovery.json.results[0].metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(routeDiscovery.json.best.path).toBe("/api/x402-discovery-audit");
      expect(routeDiscovery.json.selectedActionKey).toBe("discoveryAuditQuick");
      expect(routeDiscovery.json.selectedPaidAction.path).toBe("/api/x402-discovery-audit");
      expect(routeDiscovery.json.selectedPaidAction.maxAmountRequired).toBe("1000");
      expect(routeDiscovery.json.selectedFirstPaidAction.path).toBe("/api/x402-discovery-audit");
      expect(routeDiscovery.json.selectedPaidSequence[0].use).toBe("discoveryAuditQuick");
      expect(routeDiscovery.json.selectedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(routeDiscovery.json.selectedPaidSequence[1].use).toBe("discoveryAudit");
      expect(routeDiscovery.json.buyerInstruction).toContain("For this exact buyer intent");
      expect(routeDiscovery.json.buyerInstruction).toContain("/api/x402-discovery-audit");
      expect(routeDiscovery.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(routeDiscovery.json.provenFirstPaidAction.path).toBe("/api/listing-roast");
      expect(routeDiscovery.json.provenFirstPaidReason).toContain("wallet-backed paid-use proof");
      expect(routeDiscovery.json.recommendedPaidSequence[0].use).toBe("discoveryAuditQuick");
      expect(routeDiscovery.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(routeDiscovery.json.recommendedPaidSequence[0].action.path).toBe("/api/x402-discovery-audit");
      expect(routeDiscovery.json.recommendedPaidSequence[1].use).toBe("discoveryAudit");
      expect(routeDiscovery.json.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(routeDiscovery.json.genericRecommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(routeDiscovery.json.genericRecommendedPaidSequence[0].action.path).toBe("/api/listing-roast");
      expect(routeDiscovery.json.genericRecommendedPaidSequence[1].use).toBe("fullRoastGet");
      expect(routeDiscovery.json.paidResponsePreview.route).toBe("/api/x402-discovery-audit");
      expect(routeDiscovery.json.paidResponsePreview.example.endpoint).toBe("x402-discovery-audit-quick");
      expect(routeDiscovery.json.command).toContain("/api/x402-discovery-audit");
      expect(routeDiscovery.json.commandHandoff).toContain("x402%20discovery%20audit");
      expect(routeDiscovery.json.paymentRule).toContain("Do not call");

      const routeAgent402Route = await fetchJson(server, "/api/route?query=Agent402%20route%20visibility&top=3");
      expect(routeAgent402Route.status).toBe(200);
      expect(routeAgent402Route.json.startHere.use).toBe("agent402RouteVisibility");
      expect(routeAgent402Route.json.best.path).toBe("/api/agent402-route-visibility");
      expect(routeAgent402Route.json.selectedActionKey).toBe("agent402RouteVisibility");
      expect(routeAgent402Route.json.selectedPaidAction.path).toBe("/api/agent402-route-visibility");
      expect(routeAgent402Route.json.paidResponsePreview.includes).toContain("Agent402 route visibility");

      const routeFullRewrite = await fetchJson(server, "/api/route?query=listing%20roast%20full%20rewrite&top=3");
      expect(routeFullRewrite.status).toBe(200);
      expect(routeFullRewrite.headers.get("payment-required")).toBeNull();
      expect(routeFullRewrite.json.best.path).toBe("/api/full-listing-roast");
      expect(routeFullRewrite.json.best.method).toBe("GET");
      expect(routeFullRewrite.json.selectedActionKey).toBe("fullRoastGet");
      expect(routeFullRewrite.json.startHere.use).toBe("fullRoastGet");
      expect(routeFullRewrite.json.startHere.path).toBe("/api/full-listing-roast");
      expect(routeFullRewrite.json.startHere.method).toBe("GET");
      expect(routeFullRewrite.json.startHere.maxAmountRequired).toBe("10000");
      expect(routeFullRewrite.json.startHere.upgradeAfterFit).toBeUndefined();
      expect(routeFullRewrite.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(routeFullRewrite.json.preferredFirstPaidAction.method).toBe("GET");
      expect(routeFullRewrite.json.recommendedPaidSequence[0].use).toBe("fullRoastGet");
      expect(routeFullRewrite.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("10000");

      const routeFixBazaar = await fetchJson(server, "/api/route?intent=fix%20x402%20bazaar%20listing&top=3");
      expect(routeFixBazaar.status).toBe(200);
      expect(routeFixBazaar.headers.get("payment-required")).toBeNull();
      expect(routeFixBazaar.json.query).toBe("fix x402 bazaar listing");
      expect(routeFixBazaar.json.best.path).toBe("/api/x402-discovery-audit");
      expect(routeFixBazaar.json.best.maxAmountRequired).toBe("1000");

      const routePreflight = await fetchJson(server, "/api/route?query=paid%20api%20preflight%20before%20paying&top=3");
      expect(routePreflight.status).toBe(200);
      expect(routePreflight.headers.get("payment-required")).toBeNull();
      expect(routePreflight.json.best.path).toBe("/api/x402-site-audit");
      expect(routePreflight.json.selectedActionKey).toBe("x402SiteAudit");
      expect(routePreflight.json.selectedPaidAction.maxAmountRequired).toBe("1000");

      const prepayRiskQueries = [
        ["x402 buyer prepay risk score", "/api/x402-buyer-prepay-risk-score", "x402BuyerPrepayRiskScore"],
        ["score x402 endpoint before paying", "/api/score-x402-endpoint-before-paying", "scoreX402EndpointBeforePaying"],
        ["x402 route health check", "/api/x402-route-health-check", "x402RouteHealthCheck"],
        ["x402 listing rank doctor", "/api/x402-listing-rank-doctor", "x402ListingRankDoctor"]
      ];
      for (const [query, path, selectedActionKey] of prepayRiskQueries) {
        const route = await fetchJson(server, `/api/route?query=${encodeURIComponent(query)}&top=3`);
        expect(route.status).toBe(200);
        expect(route.headers.get("payment-required")).toBeNull();
        expect(route.json.best.path).toBe(path);
        expect(route.json.selectedActionKey).toBe(selectedActionKey);
        expect(route.json.selectedPaidAction.path).toBe(path);
        expect(route.json.selectedPaidAction.maxAmountRequired).toBe("1000");
      }

      const routeAgentCore = await fetchJson(server, "/api/route?query=AgentCore%20x402%20payments&top=3");
      expect(routeAgentCore.status).toBe(200);
      expect(routeAgentCore.headers.get("payment-required")).toBeNull();
      expect(routeAgentCore.json.best.path).toBe("/api/listing-roast");
      expect(routeAgentCore.json.selectedActionKey).toBe("agentCoreX402Payments");
      expect(routeAgentCore.json.selectedPaidAction.path).toBe("/api/listing-roast");
      expect(routeAgentCore.json.exactIntentPaidAction.path).toBe("/api/agentcore-x402-payments");
      expect(routeAgentCore.json.selectedFirstPaidAction.path).toBe("/api/listing-roast");
      expect(routeAgentCore.json.results.map((route) => route.path)).toContain("/api/agentcore-x402-payments");

      const routeCoinbaseMcp = await fetchJson(server, "/api/route?query=Coinbase%20x402%20Bazaar%20MCP%20server&top=5");
      expect(routeCoinbaseMcp.status).toBe(200);
      expect(routeCoinbaseMcp.headers.get("payment-required")).toBeNull();
      expect(routeCoinbaseMcp.json.best.path).toBe("/api/listing-roast");
      expect(routeCoinbaseMcp.json.selectedActionKey).toBe("coinbaseX402BazaarMcpServer");
      expect(routeCoinbaseMcp.json.selectedPaidAction.path).toBe("/api/listing-roast");
      expect(routeCoinbaseMcp.json.exactIntentPaidAction.path).toBe("/api/coinbase-x402-bazaar-mcp-server");
      expect(routeCoinbaseMcp.json.selectedFirstPaidAction.path).toBe("/api/listing-roast");
      expect(routeCoinbaseMcp.json.results.map((route) => route.path)).toContain("/api/coinbase-x402-bazaar-mcp-server");

      const routeBazaarMcpTools = await fetchJson(server, "/api/route?query=search_resources%20proxy_tool_call%20Coinbase%20x402%20Bazaar%20MCP%20server&top=5");
      expect(routeBazaarMcpTools.status).toBe(200);
      expect(routeBazaarMcpTools.headers.get("payment-required")).toBeNull();
      expect(routeBazaarMcpTools.json.best.path).toBe("/api/listing-roast");
      expect(routeBazaarMcpTools.json.selectedActionKey).toBe("coinbaseX402BazaarMcpServer");
      expect(routeBazaarMcpTools.json.selectedPaidAction.path).toBe("/api/listing-roast");
      expect(routeBazaarMcpTools.json.exactIntentPaidAction.path).toBe("/api/coinbase-x402-bazaar-mcp-server");

      const routeAgentListingConversion = await fetchJson(server, "/api/route?query=agent%20listing%20conversion%20score&top=3");
      expect(routeAgentListingConversion.status).toBe(200);
      expect(routeAgentListingConversion.headers.get("payment-required")).toBeNull();
      expect(routeAgentListingConversion.json.best.path).toBe("/api/agent-listing-conversion-score");
      expect(routeAgentListingConversion.json.selectedActionKey).toBe("agentListingConversion");
      expect(routeAgentListingConversion.json.selectedPaidAction.path).toBe("/api/agent-listing-conversion-score");
      expect(routeAgentListingConversion.json.selectedPaidAction.maxAmountRequired).toBe("1000");
      expect(routeAgentListingConversion.json.selectedFirstPaidAction.path).toBe("/api/agent-listing-conversion-score");
      expect(routeAgentListingConversion.json.command).toContain("/api/agent-listing-conversion-score");

      const routeMarketplaceListingConversion = await fetchJson(server, "/api/route?query=marketplace%20listing%20conversion&top=3");
      expect(routeMarketplaceListingConversion.status).toBe(200);
      expect(routeMarketplaceListingConversion.headers.get("payment-required")).toBeNull();
      expect(routeMarketplaceListingConversion.json.best.path).toBe("/api/listing-roast");
      expect(routeMarketplaceListingConversion.json.selectedActionKey).toBe("marketplaceListingConversion");
      expect(routeMarketplaceListingConversion.json.selectedPaidAction.path).toBe("/api/listing-roast");
      expect(routeMarketplaceListingConversion.json.exactIntentPaidAction.path).toBe("/api/marketplace-listing-conversion-api");
      expect(routeMarketplaceListingConversion.json.selectedFirstPaidAction.path).toBe("/api/listing-roast");
      expect(routeMarketplaceListingConversion.json.command).toContain("/api/listing-roast");

      const routeSellerSeo = await fetchJson(server, "/api/route", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "x402 listing rank doctor seller growth checklist", top: 2, include: "local" })
      });
      expect(routeSellerSeo.status).toBe(200);
      expect(routeSellerSeo.headers.get("payment-required")).toBeNull();
      expect(routeSellerSeo.json.best.path).toBe("/api/x402-listing-rank-doctor");
      expect(routeSellerSeo.json.selectedActionKey).toBe("x402ListingRankDoctor");
      expect(routeSellerSeo.json.selectedPaidAction.path).toBe("/api/x402-listing-rank-doctor");
      expect(routeSellerSeo.json.results[0].description).toContain("listing rank doctor");
      expect(routeSellerSeo.json.results[0].description).toContain("seller growth checklist");

      const routeSkipReasons = await fetchJson(server, "/api/route", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "buyer-agent skip reasons", top: 2, include: "local" })
      });
      expect(routeSkipReasons.status).toBe(200);
      expect(routeSkipReasons.headers.get("payment-required")).toBeNull();
      expect(routeSkipReasons.json.best.path).toBe("/api/listing-roast");
      expect(routeSkipReasons.json.commands).toContain("/api/commands");
      expect(routeSkipReasons.json.links.commands).toContain("/api/commands");
      expect(routeSkipReasons.json.selectedActionKey).toBe("buyerAgentSkipReasons");
      expect(routeSkipReasons.json.selectedPaidAction.path).toBe("/api/listing-roast");
      expect(routeSkipReasons.json.exactIntentPaidAction.path).toBe("/api/buyer-agent-skip-reasons");
      expect(routeSkipReasons.json.selectedFirstPaidAction.path).toBe("/api/listing-roast");
      expect(routeSkipReasons.json.selectedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(routeSkipReasons.json.selectedPaidSequence[0].action.path).toBe("/api/listing-roast");
      expect(routeSkipReasons.json.buyerInstruction).toContain("start with GET /api/listing-roast");
      expect(routeSkipReasons.json.results).toHaveLength(2);
      expect(routeSkipReasons.json.results.map((route) => route.path)).toContain("/api/buyer-agent-skip-reasons");

      const routeMixedSkipReasons = await fetchJson(server, "/api/route", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "buyer-agent skip reasons paid API listing clarity", top: 2, include: "local" })
      });
      expect(routeMixedSkipReasons.status).toBe(200);
      expect(routeMixedSkipReasons.json.best.path).toBe("/api/listing-roast");
      expect(routeMixedSkipReasons.json.exactIntentPaidAction.path).toBe("/api/buyer-agent-skip-reasons");
      expect(routeMixedSkipReasons.json.results.map((route) => route.path)).toContain("/api/buyer-agent-skip-reasons");

      const routeCustomScore = await fetchJson(server, "/api/route?query=I%20want%20to%20score%20my%20paid%20API%20listing%20with%20a%20custom%20body&top=3");
      expect(routeCustomScore.status).toBe(200);
      expect(routeCustomScore.json.best.id).toBe("listing_score");
      expect(routeCustomScore.json.best.method).toBe("POST");
      expect(routeCustomScore.json.best.maxAmountRequired).toBe("5000");
      expect(routeCustomScore.json.results[0].path).toBe("/api/listing-score");

      const localDiscovery = await fetchJson(server, "/v2/x402/discovery/resources?limit=2");
      expect(localDiscovery.status).toBe(200);
      expect(localDiscovery.headers.get("payment-required")).toBeNull();
      expect(localDiscovery.json.service).toBe("Listing Roast x402");
      expect(localDiscovery.json.serviceName).toBe("Listing Roast x402");
      expect(localDiscovery.json.metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(localDiscovery.json.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(localDiscovery.json.metadataUpdatedAt).toBe("2026-06-21T03:14:35.000Z");
      expect(localDiscovery.json.metadata_updated_at).toBe("2026-06-21T03:14:35.000Z");
      expect(localDiscovery.json.noSpend).toBe(true);
      expect(localDiscovery.json.paidUsageProof.paidCompletions).toBe(0);
      expect(localDiscovery.json.commands).toContain("/api/commands");
      expect(localDiscovery.json.links.commands).toContain("/api/commands");
      expect(localDiscovery.json.startHere.path).toBe("/api/listing-roast");
      expect(localDiscovery.json.startHere.method).toBe("GET");
      expect(localDiscovery.json.officialCdpDiscovery.source).toBe("coinbase-cdp-bazaar");
      expect(localDiscovery.json.officialCdpDiscovery.indexedRoute).toBe("http://localhost:8787/api/listing-roast");
      expect(localDiscovery.json.officialCdpDiscovery.recommendedSearchQuery).toBe("marketplace listing score");
      expect(localDiscovery.json.officialCdpDiscovery.recommendedMaxUsdPrice).toBe("0.001");
      expect(localDiscovery.json.officialCdpDiscovery.recommendedSearchUrl).toContain("/search?query=marketplace+listing+score");
      expect(localDiscovery.json.officialCdpDiscovery.domainRestrictedSearchUrl).toContain("urlSubstring=localhost");
      expect(localDiscovery.json.officialCdpDiscovery.merchantDiscoveryUrl).toContain("/merchant?payTo=0x000000000000000000000000000000000000dEaD");
      expect(localDiscovery.json.officialCdpDiscovery.refreshRule).toContain("real settlement");
      expect(localDiscovery.json.items).toHaveLength(2);
      expect(localDiscovery.json.pagination.total).toBe(PAID_RESOURCE_COUNT);
      expect(localDiscovery.json.items[0].resource).toBe("http://localhost:8787/api/listing-roast");
      expect(localDiscovery.json.items[0].serviceName).toBe("Listing Roast x402 Paid API Listing Quality Score");
      expect(localDiscovery.json.items[0].metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(localDiscovery.json.items[0].metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(localDiscovery.json.items[0].metadataUpdatedAt).toBe("2026-06-21T03:14:35.000Z");
      expect(localDiscovery.json.items[0].metadata_updated_at).toBe("2026-06-21T03:14:35.000Z");
      expect(localDiscovery.json.items[0].url).toBe("http://localhost:8787/api/listing-roast");
      expect(localDiscovery.json.items[0].route).toBe("http://localhost:8787/api/listing-roast");
      expect(localDiscovery.json.items[0].path).toBe("/api/listing-roast");
      expect(localDiscovery.json.items[0].method).toBe("GET");
      expect(localDiscovery.json.items[0].price).toBe("$0.001");
      expect(localDiscovery.json.items[0].priceUsd).toBe(0.001);
      expect(localDiscovery.json.items[0].maxAmountRequired).toBe("1000");
      expect(localDiscovery.json.items[0].max_amount_required).toBe("1000");
      expect(localDiscovery.json.items[0].command).toContain("/api/listing-roast");
      expect(localDiscovery.json.items[0].accepts[0].amount).toBe("1000");
      expect(localDiscovery.json.items[0].extensions.bazaar.info.input.type).toBe("http");
      expect(localDiscovery.json.items[0].extensions.bazaar.info.input.method).toBe("GET");
      expect(localDiscovery.json.items[0].extensions.bazaar.info.input.path).toBe("/api/listing-roast");
      expect(localDiscovery.json.items[0].extensions.bazaar.schema.schemaUrl).toContain("/api/score-schema");
      expect(localDiscovery.json.items[0].metadata.id).toBe("indexed_roast_quick_score");
      expect(localDiscovery.json.items[0].metadata.serviceName).toBe("Listing Roast x402");
      expect(localDiscovery.json.items[0].metadata.metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(localDiscovery.json.items[0].metadata.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(localDiscovery.json.items[0].metadata.metadataUpdatedAt).toBe("2026-06-21T03:14:35.000Z");
      expect(localDiscovery.json.items[0].metadata.metadata_updated_at).toBe("2026-06-21T03:14:35.000Z");
      expect(localDiscovery.json.items[0].metadata.url).toBe("http://localhost:8787/api/listing-roast");
      expect(localDiscovery.json.items[0].metadata.priceUsd).toBe(0.001);
      expect(localDiscovery.json.items[0].metadata.max_amount_required).toBe("1000");
      expect(localDiscovery.json.items[0].metadata.commands).toContain("/api/commands");
      expect(localDiscovery.json.items[0].metadata.preferredFirstPaidAction).toBe(true);
      expect(localDiscovery.json.items[0].tags).toEqual([
        "x402",
        "listing quality score API",
        "marketplace product listing quality",
        "paid API listing quality score",
        "paid API listing quality",
        "AgentCore x402 payments",
        "Coinbase x402 Bazaar MCP server",
        "marketplace listing score",
        "marketplace listing conversion API",
        "x402 marketplace conversion",
        "agent listing conversion",
        "buyer-agent skip reasons",
        "agent-service listing score",
        "x402 site audit",
        "x402 discovery audit",
        "paid API preflight",
        "agent service clarity",
        "route health"
      ]);
      expect(localDiscovery.json.items[0].metadata.serviceTags).toContain("paid API listing quality");
      expect(localDiscovery.json.items[0].metadata.keywords).toContain("buyer-agent skip reasons");
      expect(localDiscovery.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(localDiscovery.json.preferredFirstPaidResponsePreview.route).toBe("/api/listing-roast");
      expect(localDiscovery.json.preferredFirstPaidResponsePreview.example.endpoint).toBe("listing-roast-quick-score");
      expect(localDiscovery.json.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(localDiscovery.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(localDiscovery.json.recommendedPaidSequence[1].use).toBe("fullRoastGet");
      expect(localDiscovery.json.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");

      const localDiscoveryAlias = await fetchJson(server, "/.well-known/x402/discovery/resources?limit=1");
      expect(localDiscoveryAlias.status).toBe(200);
      expect(localDiscoveryAlias.json.items[0].path).toBe("/api/listing-roast");
      expect(localDiscoveryAlias.json.items[0].method).toBe("GET");
      expect(localDiscoveryAlias.json.items[0].maxAmountRequired).toBe("1000");
      expect(localDiscoveryAlias.json.items[0].metadata.path).toBe("/api/listing-roast");

      const localDiscoverySearch = await fetchJson(server, "/v2/x402/discovery/search?query=x402%20discovery%20audit&limit=2");
      expect(localDiscoverySearch.status).toBe(200);
      expect(localDiscoverySearch.headers.get("payment-required")).toBeNull();
      expect(localDiscoverySearch.json.service).toBe("Listing Roast x402");
      expect(localDiscoverySearch.json.serviceName).toBe("Listing Roast x402");
      expect(localDiscoverySearch.json.metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(localDiscoverySearch.json.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(localDiscoverySearch.json.noSpend).toBe(true);
      expect(localDiscoverySearch.json.paidUsageProof.paidCompletions).toBe(0);
      expect(localDiscoverySearch.json.commands).toContain("/api/commands");
      expect(localDiscoverySearch.json.links.commands).toContain("/api/commands");
      expect(localDiscoverySearch.json.startHere.use).toBe("discoveryAuditQuick");
      expect(localDiscoverySearch.json.startHere.path).toBe("/api/x402-discovery-audit");
      expect(localDiscoverySearch.json.startHere.method).toBe("GET");
      expect(localDiscoverySearch.json.officialCdpDiscovery.indexedRoute).toBe("http://localhost:8787/api/listing-roast");
      expect(localDiscoverySearch.json.officialCdpDiscovery.indexedRouteReason).toContain("already-settled");
      expect(localDiscoverySearch.json.officialCdpDiscovery.recommendedSearchUrl).toContain("maxUsdPrice=0.001");
      expect(localDiscoverySearch.json.startHere.upgradeAfterFit.path).toBe("/api/x402-discovery-audit");
      expect(localDiscoverySearch.json.startHere.upgradeAfterFit.maxAmountRequired).toBe("10000");
      expect(localDiscoverySearch.json.resources[0].resource).toBe("http://localhost:8787/api/x402-discovery-audit");
      expect(localDiscoverySearch.json.resources[0].serviceName).toBe("Listing Roast x402");
      expect(localDiscoverySearch.json.resources[0].metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(localDiscoverySearch.json.resources[0].url).toBe("http://localhost:8787/api/x402-discovery-audit");
      expect(localDiscoverySearch.json.resources[0].path).toBe("/api/x402-discovery-audit");
      expect(localDiscoverySearch.json.resources[0].method).toBe("GET");
      expect(localDiscoverySearch.json.resources[0].price).toBe("$0.001");
      expect(localDiscoverySearch.json.resources[0].maxAmountRequired).toBe("1000");
      expect(localDiscoverySearch.json.resources[0].max_amount_required).toBe("1000");
      expect(localDiscoverySearch.json.resources[0].extensions.bazaar.info.input.method).toBe("GET");
      expect(localDiscoverySearch.json.resources[0].extensions.bazaar.info.input.path).toBe("/api/x402-discovery-audit");
      expect(localDiscoverySearch.json.resources[0].extensions.bazaar.schema.schemaUrl).toContain("/api/discovery-audit-schema");
      expect(localDiscoverySearch.json.selectedActionKey).toBe("discoveryAuditQuick");
      expect(localDiscoverySearch.json.selectedPaidAction.path).toBe("/api/x402-discovery-audit");
      expect(localDiscoverySearch.json.selectedPaidAction.maxAmountRequired).toBe("1000");
      expect(localDiscoverySearch.json.selectedFirstPaidAction.path).toBe("/api/x402-discovery-audit");
      expect(localDiscoverySearch.json.selectedPaidSequence[0].use).toBe("discoveryAuditQuick");
      expect(localDiscoverySearch.json.selectedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(localDiscoverySearch.json.selectedPaidSequence[1].use).toBe("discoveryAudit");
      expect(localDiscoverySearch.json.buyerInstruction).toContain("/api/x402-discovery-audit");
      expect(localDiscoverySearch.json.provenFirstPaidAction.path).toBe("/api/listing-roast");
      expect(localDiscoverySearch.json.resources[0].metadata.id).toBe("x402_discovery_audit_quick");
      expect(localDiscoverySearch.json.resources[0].metadata.serviceName).toBe("Listing Roast x402");
      expect(localDiscoverySearch.json.resources[0].metadata.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(localDiscoverySearch.json.resources[0].tags).toEqual([
        "x402",
        "Bazaar visibility",
        "Agent402 route visibility",
        "Agent402 router",
        "discovery audit",
        "x402 seller discoverability",
        "fix x402 Bazaar listing",
        "x402 listing SEO audit",
        "x402 listing rank doctor",
        "paid API preflight",
        "route health"
      ]);
      expect(localDiscoverySearch.json.resources[0].metadata.serviceTags).toContain("paid API preflight");
      expect(localDiscoverySearch.json.resources.map((resource) => resource.metadata.path)).toContain("/api/x402-discovery-audit");
      expect(localDiscoverySearch.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(localDiscoverySearch.json.recommendedPaidSequence[0].use).toBe("discoveryAuditQuick");
      expect(localDiscoverySearch.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(localDiscoverySearch.json.recommendedPaidSequence[0].action.path).toBe("/api/x402-discovery-audit");
      expect(localDiscoverySearch.json.recommendedPaidSequence[1].use).toBe("discoveryAudit");
      expect(localDiscoverySearch.json.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(localDiscoverySearch.json.genericRecommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(localDiscoverySearch.json.genericRecommendedPaidSequence[0].action.path).toBe("/api/listing-roast");
      expect(localDiscoverySearch.json.genericRecommendedPaidSequence[1].use).toBe("fullRoastGet");
      expect(localDiscoverySearch.json.paidResponsePreview.route).toBe("/api/x402-discovery-audit");
      expect(localDiscoverySearch.json.paidResponsePreview.example.endpoint).toBe("x402-discovery-audit-quick");

      const localDiscoveryFullRoastSearch = await fetchJson(server, "/v2/x402/discovery/search?query=full%20roast%20rewrite%20top%20fixes&limit=2");
      expect(localDiscoveryFullRoastSearch.status).toBe(200);
      expect(localDiscoveryFullRoastSearch.headers.get("payment-required")).toBeNull();
      expect(localDiscoveryFullRoastSearch.json.resources[0].metadata.id).toBe("full_listing_roast_get");
      expect(localDiscoveryFullRoastSearch.json.startHere.use).toBe("fullRoastGet");
      expect(localDiscoveryFullRoastSearch.json.startHere.path).toBe("/api/full-listing-roast");
      expect(localDiscoveryFullRoastSearch.json.startHere.method).toBe("GET");
      expect(localDiscoveryFullRoastSearch.json.startHere.maxAmountRequired).toBe("10000");
      expect(localDiscoveryFullRoastSearch.json.startHere.upgradeAfterFit).toBeUndefined();
      expect(localDiscoveryFullRoastSearch.json.recommendedPaidSequence[0].use).toBe("fullRoastGet");
      expect(localDiscoveryFullRoastSearch.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("10000");
      expect(localDiscoveryFullRoastSearch.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(localDiscoveryFullRoastSearch.json.preferredFirstPaidAction.method).toBe("GET");

      const localDiscoveryPreflightSearch = await fetchJson(server, "/v2/x402/discovery/search?query=paid%20API%20preflight%20before%20paying&limit=2");
      expect(localDiscoveryPreflightSearch.status).toBe(200);
      expect(localDiscoveryPreflightSearch.headers.get("payment-required")).toBeNull();
      expect(localDiscoveryPreflightSearch.json.resources[0].resource).toBe("http://localhost:8787/api/x402-site-audit");
      expect(localDiscoveryPreflightSearch.json.selectedActionKey).toBe("x402SiteAudit");
      expect(localDiscoveryPreflightSearch.json.selectedPaidAction.path).toBe("/api/x402-site-audit");
      expect(localDiscoveryPreflightSearch.json.selectedPaidAction.maxAmountRequired).toBe("1000");
      expect(localDiscoveryPreflightSearch.json.resources[0].metadata.serviceTags).toContain("paid API preflight");

      const localDiscoveryListingScoreSearch = await fetchJson(server, "/v2/x402/discovery/search?query=marketplace%20listing%20score&limit=2");
      expect(localDiscoveryListingScoreSearch.status).toBe(200);
      expect(localDiscoveryListingScoreSearch.headers.get("payment-required")).toBeNull();
      expect(localDiscoveryListingScoreSearch.json.resources[0].metadata.path).toBe("/api/listing-roast");
      expect(localDiscoveryListingScoreSearch.json.selectedActionKey).toBe("marketplaceListingScore");
      expect(localDiscoveryListingScoreSearch.json.exactIntentPaidAction.path).toBe("/api/marketplace-listing-score");
      expect(localDiscoveryListingScoreSearch.json.resources[0].metadata.maxAmountRequired).toBe("1000");

      const localDiscoveryListingQualitySearch = await fetchJson(server, "/v2/x402/discovery/search?query=paid%20API%20listing%20quality&limit=2");
      expect(localDiscoveryListingQualitySearch.status).toBe(200);
      expect(localDiscoveryListingQualitySearch.headers.get("payment-required")).toBeNull();
      expect(localDiscoveryListingQualitySearch.json.resources[0].url).toBe("http://localhost:8787/api/listing-roast");
      expect(localDiscoveryListingQualitySearch.json.resources[0].path).toBe("/api/listing-roast");
      expect(localDiscoveryListingQualitySearch.json.resources[0].method).toBe("GET");
      expect(localDiscoveryListingQualitySearch.json.resources[0].price).toBe("$0.001");
      expect(localDiscoveryListingQualitySearch.json.resources[0].maxAmountRequired).toBe("1000");
      expect(localDiscoveryListingQualitySearch.json.resources[0].max_amount_required).toBe("1000");
      expect(localDiscoveryListingQualitySearch.json.resources[0].metadata.path).toBe("/api/listing-roast");
      expect(localDiscoveryListingQualitySearch.json.selectedActionKey).toBe("paidApiListingQuality");
      expect(localDiscoveryListingQualitySearch.json.exactIntentPaidAction.path).toBe("/api/paid-api-listing-quality");
      expect(localDiscoveryListingQualitySearch.json.resources[0].metadata.maxAmountRequired).toBe("1000");

      const localDiscoveryListingQualityScoreSearch = await fetchJson(server, "/v2/x402/discovery/search?query=paid%20API%20listing%20quality%20score&limit=2");
      expect(localDiscoveryListingQualityScoreSearch.status).toBe(200);
      expect(localDiscoveryListingQualityScoreSearch.headers.get("payment-required")).toBeNull();
      expect(localDiscoveryListingQualityScoreSearch.json.resources[0].metadata.path).toBe("/api/listing-roast");
      expect(localDiscoveryListingQualityScoreSearch.json.selectedActionKey).toBe("paidApiListingQualityScore");
      expect(localDiscoveryListingQualityScoreSearch.json.exactIntentPaidAction.path).toBe("/api/paid-api-listing-quality-score");
      expect(localDiscoveryListingQualityScoreSearch.json.resources[0].metadata.maxAmountRequired).toBe("1000");

      const localDiscoveryListingQualityScoreApiSearch = await fetchJson(server, "/v2/x402/discovery/search?query=listing%20quality%20score%20API&limit=2");
      expect(localDiscoveryListingQualityScoreApiSearch.status).toBe(200);
      expect(localDiscoveryListingQualityScoreApiSearch.headers.get("payment-required")).toBeNull();
      expect(localDiscoveryListingQualityScoreApiSearch.json.resources[0].metadata.path).toBe("/api/listing-roast");
      expect(localDiscoveryListingQualityScoreApiSearch.json.selectedActionKey).toBe("listingQualityScoreApi");
      expect(localDiscoveryListingQualityScoreApiSearch.json.exactIntentPaidAction.path).toBe("/api/listing-quality-score-api");
      expect(localDiscoveryListingQualityScoreApiSearch.json.resources[0].metadata.maxAmountRequired).toBe("1000");

      const localDiscoveryX402ListingQualitySearch = await fetchJson(server, "/v2/x402/discovery/search?query=x402%20listing%20quality&limit=2");
      expect(localDiscoveryX402ListingQualitySearch.status).toBe(200);
      expect(localDiscoveryX402ListingQualitySearch.headers.get("payment-required")).toBeNull();
      expect(localDiscoveryX402ListingQualitySearch.json.resources[0].metadata.path).toBe("/api/listing-roast");
      expect(localDiscoveryX402ListingQualitySearch.json.selectedActionKey).toBe("x402ListingQuality");
      expect(localDiscoveryX402ListingQualitySearch.json.exactIntentPaidAction.path).toBe("/api/x402-listing-quality");
      expect(localDiscoveryX402ListingQualitySearch.json.resources[0].metadata.maxAmountRequired).toBe("1000");

      const localDiscoveryMarketplaceQualitySearch = await fetchJson(server, "/v2/x402/discovery/search?query=marketplace%20listing%20quality&limit=2");
      expect(localDiscoveryMarketplaceQualitySearch.status).toBe(200);
      expect(localDiscoveryMarketplaceQualitySearch.headers.get("payment-required")).toBeNull();
      expect(localDiscoveryMarketplaceQualitySearch.json.resources[0].metadata.path).toBe("/api/listing-roast");
      expect(localDiscoveryMarketplaceQualitySearch.json.selectedActionKey).toBe("marketplaceListingScore");

      const localDiscoveryMarketplaceProductQualitySearch = await fetchJson(server, "/v2/x402/discovery/search?query=marketplace%20product%20listing%20quality&limit=2");
      expect(localDiscoveryMarketplaceProductQualitySearch.status).toBe(200);
      expect(localDiscoveryMarketplaceProductQualitySearch.headers.get("payment-required")).toBeNull();
      expect(localDiscoveryMarketplaceProductQualitySearch.json.resources[0].metadata.path).toBe("/api/listing-roast");
      expect(localDiscoveryMarketplaceProductQualitySearch.json.selectedActionKey).toBe("marketplaceProductListingQuality");
      expect(localDiscoveryMarketplaceProductQualitySearch.json.exactIntentPaidAction.path).toBe("/api/marketplace-product-listing-quality");
      expect(localDiscoveryMarketplaceQualitySearch.json.selectedActionKey).toBe("marketplaceListingScore");
      expect(localDiscoveryMarketplaceQualitySearch.json.exactIntentPaidAction.path).toBe("/api/marketplace-listing-score");
      expect(localDiscoveryMarketplaceQualitySearch.json.resources[0].metadata.maxAmountRequired).toBe("1000");

      const localDiscoveryMarketplaceListingConversionSearch = await fetchJson(server, "/v2/x402/discovery/search?query=marketplace%20listing%20conversion&limit=2");
      expect(localDiscoveryMarketplaceListingConversionSearch.status).toBe(200);
      expect(localDiscoveryMarketplaceListingConversionSearch.headers.get("payment-required")).toBeNull();
      expect(localDiscoveryMarketplaceListingConversionSearch.json.resources[0].metadata.path).toBe("/api/listing-roast");
      expect(localDiscoveryMarketplaceListingConversionSearch.json.selectedActionKey).toBe("marketplaceListingConversion");
      expect(localDiscoveryMarketplaceListingConversionSearch.json.exactIntentPaidAction.path).toBe("/api/marketplace-listing-conversion-api");
      expect(localDiscoveryMarketplaceListingConversionSearch.json.resources[0].metadata.maxAmountRequired).toBe("1000");

      const localDiscoverySkipReasonsSearch = await fetchJson(server, "/v2/x402/discovery/search?query=buyer-agent%20skip%20reasons&limit=2");
      expect(localDiscoverySkipReasonsSearch.status).toBe(200);
      expect(localDiscoverySkipReasonsSearch.headers.get("payment-required")).toBeNull();
      expect(localDiscoverySkipReasonsSearch.json.resources[0].metadata.path).toBe("/api/listing-roast");
      expect(localDiscoverySkipReasonsSearch.json.selectedActionKey).toBe("buyerAgentSkipReasons");
      expect(localDiscoverySkipReasonsSearch.json.selectedPaidAction.path).toBe("/api/listing-roast");
      expect(localDiscoverySkipReasonsSearch.json.exactIntentPaidAction.path).toBe("/api/buyer-agent-skip-reasons");
      expect(localDiscoverySkipReasonsSearch.json.selectedFirstPaidAction.path).toBe("/api/listing-roast");
      expect(localDiscoverySkipReasonsSearch.json.selectedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(localDiscoverySkipReasonsSearch.json.selectedPaidSequence[0].action.path).toBe("/api/listing-roast");
      expect(localDiscoverySkipReasonsSearch.json.paidResponsePreview.route).toBe("/api/listing-roast");
      expect(localDiscoverySkipReasonsSearch.json.selectedFirstPaidResponsePreview.route).toBe("/api/listing-roast");
      expect(localDiscoverySkipReasonsSearch.json.buyerInstruction).toContain("start with GET /api/listing-roast");
      expect(localDiscoverySkipReasonsSearch.json.resources[0].metadata.maxAmountRequired).toBe("1000");
      expect(localDiscoverySkipReasonsSearch.json.resources[1].path).toBe("/api/buyer-agent-skip-reasons");
      expect(localDiscoverySkipReasonsSearch.json.officialCdpDiscovery.knownWorkingSearchQueries.map((entry) => entry.query)).toContain("marketplace listing score");
      expect(localDiscoverySkipReasonsSearch.json.officialCdpDiscovery.notYetRankingSearchQueries.map((entry) => entry.query)).toContain("buyer-agent skip reasons");
      expect(localDiscoverySkipReasonsSearch.json.officialCdpDiscovery.searchRealityRule).toContain("direct proven route");
      expect(localDiscoverySkipReasonsSearch.json.officialCdpDiscovery.cheapCapSearchStrategy.recommendedMaxUsdPrice).toBe("0.001");

      const localDiscoveryAgentClaritySearch = await fetchJson(server, "/v2/x402/discovery/search?query=agent%20service%20clarity&limit=2");
      expect(localDiscoveryAgentClaritySearch.status).toBe(200);
      expect(localDiscoveryAgentClaritySearch.headers.get("payment-required")).toBeNull();
      expect(localDiscoveryAgentClaritySearch.json.resources[0].metadata.path).toBe("/api/listing-roast");
      expect(localDiscoveryAgentClaritySearch.json.selectedActionKey).toBe("agentServiceClarity");
      expect(localDiscoveryAgentClaritySearch.json.exactIntentPaidAction.path).toBe("/api/agent-service-clarity");
      expect(localDiscoveryAgentClaritySearch.json.resources[0].metadata.maxAmountRequired).toBe("1000");

      const localDiscoveryConversionSearch = await fetchJson(server, "/v2/x402/discovery/search?query=x402%20marketplace%20conversion&limit=2");
      expect(localDiscoveryConversionSearch.status).toBe(200);
      expect(localDiscoveryConversionSearch.headers.get("payment-required")).toBeNull();
      expect(localDiscoveryConversionSearch.json.resources[0].metadata.path).toBe("/api/listing-roast");
      expect(localDiscoveryConversionSearch.json.selectedActionKey).toBe("marketplaceListingConversion");
      expect(localDiscoveryConversionSearch.json.exactIntentPaidAction.path).toBe("/api/marketplace-listing-conversion-api");
      expect(localDiscoveryConversionSearch.json.resources[0].metadata.maxAmountRequired).toBe("1000");

      const localDiscoveryMerchant = await fetchJson(server, "/v2/x402/discovery/merchant?payTo=0x000000000000000000000000000000000000dEaD");
      expect(localDiscoveryMerchant.status).toBe(200);
      expect(localDiscoveryMerchant.headers.get("payment-required")).toBeNull();
      expect(localDiscoveryMerchant.json.service).toBe("Listing Roast x402");
      expect(localDiscoveryMerchant.json.serviceName).toBe("Listing Roast x402");
      expect(localDiscoveryMerchant.json.metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(localDiscoveryMerchant.json.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(localDiscoveryMerchant.json.paidUsageProof.paidCompletions).toBe(0);
      expect(localDiscoveryMerchant.json.commands).toContain("/api/commands");
      expect(localDiscoveryMerchant.json.links.commands).toContain("/api/commands");
      expect(localDiscoveryMerchant.json.resources).toHaveLength(20);
      expect(localDiscoveryMerchant.json.count).toBe(20);
      expect(localDiscoveryMerchant.json.pagination.limit).toBe(20);
      expect(localDiscoveryMerchant.json.pagination.offset).toBe(0);
      expect(localDiscoveryMerchant.json.pagination.total).toBe(PAID_RESOURCE_COUNT);
      expect(localDiscoveryMerchant.json.resources[0].path).toBe("/api/listing-roast");
      expect(localDiscoveryMerchant.json.resources[0].serviceName).toBe("Listing Roast x402 Paid API Listing Quality Score");
      expect(localDiscoveryMerchant.json.resources[0].metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(localDiscoveryMerchant.json.resources[0].method).toBe("GET");
      expect(localDiscoveryMerchant.json.resources[0].price).toBe("$0.001");
      expect(localDiscoveryMerchant.json.resources[0].maxAmountRequired).toBe("1000");
      expect(localDiscoveryMerchant.json.resources[0].extensions.bazaar.info.input.path).toBe("/api/listing-roast");
      expect(localDiscoveryMerchant.json.resources[0].extensions.bazaar.schema.schemaUrl).toContain("/api/score-schema");
      expect(localDiscoveryMerchant.json.officialCdpDiscovery.merchantDiscoveryUrl).toContain("payTo=0x000000000000000000000000000000000000dEaD");
      expect(localDiscoveryMerchant.json.officialCdpDiscovery.recommendedSearchQuery).toBe("marketplace listing score");
      expect(localDiscoveryMerchant.json.officialCdpDiscovery.refreshRule).toContain("unpaid probes do not refresh");
      expect(localDiscoveryMerchant.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(localDiscoveryMerchant.json.preferredFirstPaidResponsePreview.route).toBe("/api/listing-roast");
      expect(localDiscoveryMerchant.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(localDiscoveryMerchant.json.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");

      const pagedLocalDiscoveryMerchant = await fetchJson(server, "/v2/x402/discovery/merchant?payTo=0x000000000000000000000000000000000000dEaD&limit=2&offset=1");
      expect(pagedLocalDiscoveryMerchant.status).toBe(200);
      expect(pagedLocalDiscoveryMerchant.headers.get("payment-required")).toBeNull();
      expect(pagedLocalDiscoveryMerchant.json.resources).toHaveLength(2);
      expect(pagedLocalDiscoveryMerchant.json.count).toBe(2);
      expect(pagedLocalDiscoveryMerchant.json.pagination.limit).toBe(2);
      expect(pagedLocalDiscoveryMerchant.json.pagination.offset).toBe(1);
      expect(pagedLocalDiscoveryMerchant.json.pagination.total).toBe(PAID_RESOURCE_COUNT);
      expect(pagedLocalDiscoveryMerchant.json.resources[0].path).toBe(QUICK_SCORE_ALIAS_PATHS[0]);
      expect(pagedLocalDiscoveryMerchant.json.resources[0].extensions.bazaar.info.input.path).toBe(QUICK_SCORE_ALIAS_PATHS[0]);

      const fullLocalDiscoveryMerchant = await fetchJson(server, "/v2/x402/discovery/merchant?payTo=0x000000000000000000000000000000000000dEaD&limit=100");
      expect(fullLocalDiscoveryMerchant.status).toBe(200);
      expect(fullLocalDiscoveryMerchant.json.resources).toHaveLength(PAID_RESOURCE_COUNT);
      expect(fullLocalDiscoveryMerchant.json.pagination.limit).toBe(100);
      expect(fullLocalDiscoveryMerchant.json.pagination.offset).toBe(0);
      expect(fullLocalDiscoveryMerchant.json.pagination.total).toBe(PAID_RESOURCE_COUNT);
      expect(fullLocalDiscoveryMerchant.json.resources.map((resource) => resource.metadata.path)).toContain("/api/preflight");
      expect(fullLocalDiscoveryMerchant.json.resources.map((resource) => resource.metadata.path)).toContain("/api/v1/preflight");
      expect(fullLocalDiscoveryMerchant.json.resources.map((resource) => resource.metadata.path)).toContain("/preflight");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.status).toBe(200);
      expect(cashRegister.json.receiverWallet.network).toBe("eip155:84532");
      expect(cashRegister.json.receiverWallet.source).toBe("disabled_for_non_mainnet");
      expect(cashRegister.json.signals.homepageViews).toBe(2);
      expect(cashRegister.json.signals.builderViews).toBe(1);
      expect(cashRegister.json.signals.builderCommandBuilds).toBe(1);
      expect(cashRegister.json.signals.llmsViews).toBe(5);
      expect(cashRegister.json.signals.openApiViews).toBe(5);
      expect(cashRegister.json.signals.sampleViews).toBe(3);
      expect(cashRegister.json.signals.schemaViews).toBe(4);
      expect(cashRegister.json.signals.examplesViews).toBe(1);
      expect(cashRegister.json.signals.commandsViews).toBe(14);
      expect(cashRegister.json.signals.payNowViews).toBe(22);
      expect(cashRegister.json.signals.pricingViews).toBe(1);
      expect(cashRegister.json.signals.findViews).toBe(10);
      expect(cashRegister.json.signals.routeViews).toBe(37);
      expect(cashRegister.json.signals.localDiscoveryViews).toBe(19);
      expect(cashRegister.json.signals.mcpViews).toBe(16);
      expect(cashRegister.json.signals.x402ManifestViews).toBe(5);
      expect(cashRegister.json.signals.agentCardViews).toBe(4);
      expect(cashRegister.json.signals.aiPluginViews).toBe(1);
      expect(cashRegister.json.signals.apiCatalogViews).toBe(2);
      expect(cashRegister.json.signals.agentSkillsViews).toBe(1);
      expect(cashRegister.json.signals.agentSkillViews).toBe(1);
      expect(cashRegister.json.signals.commandCopyClicks).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.apiEntryValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.instantScoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.conversionScoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.agentListingConversionValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.indexedRoastGetValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.fullRoastGetValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.pingValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.siteAuditValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.roastValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.scoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.discoveryAuditValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.emptyDiscoveryProbes).toBe(0);
      expect(cashRegister.json.signals.invalidRequests).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("surfaces paid completion proof on the homepage", async () => {
    await recordPaidCompletion("instantScore", 0.001);
    await recordPaidCompletion("indexedRoastGet", 0.001);

    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const home = await fetchJson(server, "/");
      expect(home.status).toBe(200);
      expect(home.text).toContain("2 paid completions");
      expect(home.text).toContain("$0.002 registered in the public cash register");
      expect(home.text).toContain("CDP Bazaar indexed");
      expect(home.text).toContain("search marketplace listing score with maxUsdPrice=0.001");
      expect(home.text).toContain("Live 402 wins");
      expect(home.text).toContain("Agent payment prompt: <code>Call this x402 endpoint with GET and pay up to 0.001 USDC: http://localhost:8787/api/listing-roast</code>");

      const x402Manifest = await fetchJson(server, "/x402.json");
      expect(x402Manifest.status).toBe(200);
      expect(x402Manifest.json.paidUsageProof.paidCompletions).toBe(2);
      expect(x402Manifest.json.paidUsageProof.estimatedGrossRevenueUsd).toBe("0.002");
      expect(x402Manifest.json.paidUsageProof.proofText).toBe("2 paid completions; $0.002 registered");
      expect(x402Manifest.json.paidUsageProof.cashRegister).toContain("/api/cash-register");
      expect(x402Manifest.json.paidUsageProof.preferredConvertedRoute.path).toBe("/api/listing-roast");
      expect(x402Manifest.json.paidUsageProof.preferredConvertedRoute.completions).toBe(1);
      expect(x402Manifest.json.paidUsageProof.preferredConvertedRoute.hasConfirmedPaidUse).toBe(true);

      const openApi = await fetchJson(server, "/openapi.json");
      expect(openApi.status).toBe(200);
      expect(openApi.json["x-listing-roast"].paidUsageProof.paidCompletions).toBe(2);
      expect(openApi.json["x-listing-roast"].paidUsageProof.estimatedGrossRevenueUsd).toBe("0.002");
      expect(openApi.json["x-listing-roast"].paidUsageProof.proofText).toBe("2 paid completions; $0.002 registered");
      expect(openApi.json["x-listing-roast"].paidUsageProof.preferredConvertedRoute.hasConfirmedPaidUse).toBe(true);

      const mcp = await fetchJson(server, "/.well-known/mcp.json");
      expect(mcp.status).toBe(200);
      expect(mcp.json.paidUsageProof.paidCompletions).toBe(2);
      expect(mcp.json.payment.paidUsageProof.estimatedGrossRevenueUsd).toBe("0.002");

      const mcpServerCard = await fetchJson(server, "/.well-known/mcp/server-card.json");
      expect(mcpServerCard.status).toBe(200);
      expect(mcpServerCard.json.payment.paidUsageProof.proofText).toBe("2 paid completions; $0.002 registered");

      const agentCard = await fetchJson(server, "/.well-known/agent-card.json");
      expect(agentCard.status).toBe(200);
      expect(agentCard.json.paidUsageProof.paidCompletions).toBe(2);
      expect(agentCard.json.metadata.paidUsageProof.estimatedGrossRevenueUsd).toBe("0.002");

      const aiPlugin = await fetchJson(server, "/.well-known/ai-plugin.json");
      expect(aiPlugin.status).toBe(200);
      expect(aiPlugin.json.x_listing_roast.paidUsageProof.paidCompletions).toBe(2);

      const payNow = await fetchJson(server, "/api/pay-now?intent=buyer-agent%20skip%20reasons");
      expect(payNow.status).toBe(200);
      expect(payNow.json.paidUsageProof.paidCompletions).toBe(2);
      expect(payNow.json.paidUsageProof.estimatedGrossRevenueUsd).toBe("0.002");
      expect(payNow.json.paidUsageProof.preferredConvertedRoute.completions).toBe(1);
      expect(payNow.json.settlementProof.evidenceFields).toContain("indexedRoastGetCompletions");

      const proof = await fetchJson(server, "/api/paid-usage-proof");
      expect(proof.status).toBe(200);
      expect(proof.json.paidUsageProof.paidCompletions).toBe(2);
      expect(proof.json.paidUsageProof.estimatedGrossRevenueUsd).toBe("0.002");
      expect(proof.json.paidUsageProof.preferredConvertedRoute.hasConfirmedPaidUse).toBe(true);
      expect(proof.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(proof.json.buyerInstruction).toContain("start with GET /api/listing-roast");

      const pricing = await fetchJson(server, "/api/pricing");
      expect(pricing.status).toBe(200);
      expect(pricing.json.paidUsageProof.proofText).toBe("2 paid completions; $0.002 registered");

      const find = await fetchJson(server, "/api/find?q=buyer-agent%20skip%20reasons");
      expect(find.status).toBe(200);
      expect(find.json.paidUsageProof.paidCompletions).toBe(2);

      const route = await fetchJson(server, "/api/route?query=buyer-agent%20skip%20reasons&top=2");
      expect(route.status).toBe(200);
      expect(route.json.paidUsageProof.estimatedGrossRevenueUsd).toBe("0.002");

      const localDiscovery = await fetchJson(server, "/v2/x402/discovery/resources?limit=1");
      expect(localDiscovery.status).toBe(200);
      expect(localDiscovery.json.paidUsageProof.paidCompletions).toBe(2);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("exposes public latest wallet settlement proof when configured", async () => {
    process.env.BASELINE_LAST_SETTLEMENT_TX_HASH = "0xa124906f1310b2100f02255c7467f2b89dae95594b36e8c70c98e6dc16a4da71";
    process.env.BASELINE_LAST_SETTLEMENT_USDC_UNITS = "1000";
    process.env.BASELINE_LAST_SETTLEMENT_CONFIRMED_AT = "2026-06-18T06:43:23.000Z";
    process.env.BASELINE_LAST_SETTLEMENT_ROUTE_PATH = "/api/listing-roast";
    process.env.BASELINE_LAST_SETTLEMENT_METHOD = "GET";
    process.env.BASELINE_LAST_SETTLEMENT_MAX_AMOUNT_REQUIRED = "1000";

    await recordPaidCompletion("indexedRoastGet", 0.001);

    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const x402Manifest = await fetchJson(server, "/x402.json");
      expect(x402Manifest.status).toBe(200);
      expect(x402Manifest.json.paidUsageProof.proofText).toBe("1 wallet-settlement-linked paid completion; $0.001 registered; latest settlement 0.001 USDC");
      expect(x402Manifest.json.paidUsageProof.latestWalletSettlement.txHash).toBe(process.env.BASELINE_LAST_SETTLEMENT_TX_HASH);
      expect(x402Manifest.json.paidUsageProof.latestWalletSettlement.usdcUnits).toBe("1000");
      expect(x402Manifest.json.paidUsageProof.latestWalletSettlement.usdc).toBe("0.001");
      expect(x402Manifest.json.paidUsageProof.latestWalletSettlement.route.path).toBe("/api/listing-roast");
      expect(x402Manifest.json.paidUsageProof.latestWalletSettlement.payerDetails).toBe("omitted");
      expect(x402Manifest.json.settlementProof.latestWalletSettlement.explorerUrl).toContain("basescan.org/tx/");

      const payNow = await fetchJson(server, "/api/pay-now");
      expect(payNow.status).toBe(200);
      expect(payNow.json.paidUsageProof.latestWalletSettlement.route.maxAmountRequired).toBe("1000");
      expect(payNow.json.settlementProof.latestWalletSettlement.usdc).toBe("0.001");

      const unpaidIndexedRoast = await fetchJson(server, "/api/listing-roast");
      expect(unpaidIndexedRoast.status).toBe(402);
      expect(unpaidIndexedRoast.json.settlementProof.latestWalletSettlement.txHash).toBe(process.env.BASELINE_LAST_SETTLEMENT_TX_HASH);
      expect(unpaidIndexedRoast.json.settlementProof.latestWalletSettlement.usdc).toBe("0.001");
      expect(unpaidIndexedRoast.json.settlementProof.latestWalletSettlement.route.path).toBe("/api/listing-roast");
      expect(unpaidIndexedRoast.json.settlementProof.latestWalletSettlement.payerDetails).toBe("omitted");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("includes receiver wallet proof on the free paid usage proof endpoint", async () => {
    mockFacilitatorSupportedKinds();
    process.env.BASELINE_PAID_COMPLETIONS = "2";
    process.env.BASELINE_ESTIMATED_GROSS_REVENUE_USD = "0.002";
    process.env.BASELINE_INDEXED_ROAST_GET_COMPLETIONS = "1";
    process.env.BASELINE_INDEXED_ROAST_GET_REVENUE_USD = "0.001";
    process.env.BASELINE_LAST_PAID_AT = "2026-06-18T06:43:22.052Z";
    process.env.BASELINE_LAST_SETTLEMENT_TX_HASH = "0xa124906f1310b2100f02255c7467f2b89dae95594b36e8c70c98e6dc16a4da71";
    process.env.BASELINE_LAST_SETTLEMENT_USDC_UNITS = "1000";
    process.env.BASELINE_LAST_SETTLEMENT_CONFIRMED_AT = "2026-06-18T06:43:23.000Z";
    process.env.BASELINE_LAST_SETTLEMENT_ROUTE_PATH = "/api/listing-roast";
    process.env.BASELINE_LAST_SETTLEMENT_METHOD = "GET";
    process.env.BASELINE_LAST_SETTLEMENT_MAX_AMOUNT_REQUIRED = "1000";

    const rpcServer = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: `0x${1001000n.toString(16)}` }));
    });
    await new Promise((resolve) => rpcServer.listen(0, resolve));
    const rpcUrl = `http://127.0.0.1:${rpcServer.address().port}`;

    const app = createApp({
      payTo: "0x000000000000000000000000000000000000dEaD",
      network: "eip155:8453",
      baseRpcUrl: rpcUrl
    });
    const server = await listen(app);

    try {
      const proof = await fetchJson(server, "/api/paid-usage-proof");
      expect(proof.status).toBe(200);
      expect(proof.headers.get("payment-required")).toBeNull();
      expect(proof.json.serviceName).toBe("Listing Roast x402");
      expect(proof.json.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(proof.json.paidCompletions).toBe(2);
      expect(proof.json.estimatedGrossRevenueUsd).toBe("0.002");
      expect(proof.json.proofText).toBe("2 wallet-confirmed paid completions; $0.002 registered; receiver wallet 1.001 USDC");
      expect(proof.json.settlementStatus).toBe("wallet-confirmed");
      expect(proof.json.paidUsageProof.serviceName).toBe("Listing Roast x402");
      expect(proof.json.paidUsageProof.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(proof.json.paidUsageProof.settlementStatus).toBe("wallet-confirmed");
      expect(proof.json.paidUsageProof.proofText).toBe("2 wallet-confirmed paid completions; $0.002 registered; receiver wallet 1.001 USDC");
      expect(proof.json.paidUsageProof.receiverWallet.usdcUnits).toBe("1001000");
      expect(proof.json.paidUsageProof.walletProof.status).toBe("wallet-confirmed");
      expect(proof.json.paidUsageProof.walletProof.latestSettlementTxHash).toBe(process.env.BASELINE_LAST_SETTLEMENT_TX_HASH);
      expect(proof.json.receiverWallet.usdcBalance).toBe("1.001");
      expect(proof.json.purpose).toContain("wallet-confirmed paid usage");
      expect(proof.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(proof.json.provenFirstPaidAction.path).toBe("/api/listing-roast");
      expect(proof.json.paymentShortcut.firstPaidPath).toBe("/api/listing-roast");
      expect(proof.json.command).toContain("/api/listing-roast");
      expect(proof.json.searchReality.knownWorkingSearchQueries.map((entry) => entry.query)).toContain("paid api listing quality");
      expect(proof.json.searchReality.notYetRankingSearchQueries.map((entry) => entry.query)).toContain("buyer-agent skip reasons");

      const payNowFirstPaid = await fetchJson(server, "/api/pay-now?intent=buyer-agent%20skip%20reasons");
      expect(payNowFirstPaid.status).toBe(200);
      expect(payNowFirstPaid.json.serviceName).toBe("Listing Roast x402");
      expect(payNowFirstPaid.json.metadata_version).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(payNowFirstPaid.json.selectedPaidAction.path).toBe("/api/listing-roast");
      expect(payNowFirstPaid.json.paymentShortcut.firstPaidPath).toBe("/api/listing-roast");
      expect(payNowFirstPaid.json.paidUsageProof.settlementStatus).toBe("wallet-confirmed");
      expect(payNowFirstPaid.json.paidUsageProof.proofText).toBe("2 wallet-confirmed paid completions; $0.002 registered; receiver wallet 1.001 USDC");
      expect(payNowFirstPaid.json.paidUsageProof.receiverWallet.usdcUnits).toBe("1001000");
      expect(payNowFirstPaid.json.paidUsageProof.walletProof.status).toBe("wallet-confirmed");

      const payNowFullRoast = await fetchJson(server, "/api/pay-now?intent=full%20listing%20roast");
      expect(payNowFullRoast.status).toBe(200);
      expect(payNowFullRoast.json.selectedActionKey).toBe("fullRoastGet");
      expect(payNowFullRoast.json.selectedPaidAction.path).toBe("/api/full-listing-roast");
      expect(payNowFullRoast.json.maxAmountRequired).toBe("10000");
      expect(payNowFullRoast.json.paidUsageProof.settlementStatus).toBe("wallet-confirmed");
      expect(payNowFullRoast.json.paidUsageProof.receiverWallet.usdcBalance).toBe("1.001");
      expect(payNowFullRoast.json.paidUsageProof.walletProof.latestSettlementTxHash).toBe(process.env.BASELINE_LAST_SETTLEMENT_TX_HASH);

      const discoveryProofChecks = [
        { path: "/x402.json", proof: (json) => json.paidUsageProof },
        { path: "/api/examples", proof: (json) => json.paidUsageProof },
        { path: "/api/pricing", proof: (json) => json.paidUsageProof },
        { path: "/api/find?q=buyer-agent%20skip%20reasons", proof: (json) => json.paidUsageProof },
        { path: "/api/route?query=full%20listing%20roast", proof: (json) => json.paidUsageProof },
        { path: "/v2/x402/discovery/resources?limit=1", proof: (json) => json.paidUsageProof },
        { path: "/v2/x402/discovery/search?query=paid%20API%20listing%20quality", proof: (json) => json.paidUsageProof },
        { path: "/v2/x402/discovery/merchant", proof: (json) => json.paidUsageProof },
        { path: "/.well-known/mcp.json", proof: (json) => json.paidUsageProof },
        { path: "/.well-known/mcp/server-card.json", proof: (json) => json.payment.paidUsageProof },
        { path: "/.well-known/agent-card.json", proof: (json) => json.paidUsageProof },
        { path: "/.well-known/ai-plugin.json", proof: (json) => json.x_listing_roast.paidUsageProof },
        { path: "/.well-known/agent-tools.json", proof: (json) => json.paidUsageProof },
        { path: "/.well-known/agent-skills/index.json", proof: (json) => json.paidUsageProof }
      ];

      for (const check of discoveryProofChecks) {
        const discoveryResponse = await fetchJson(server, check.path);
        const discoveryProof = check.proof(discoveryResponse.json);
        expect(discoveryResponse.status).toBe(200);
        expect(discoveryProof.settlementStatus).toBe("wallet-confirmed");
        expect(discoveryProof.proofText).toBe("2 wallet-confirmed paid completions; $0.002 registered; receiver wallet 1.001 USDC");
        expect(discoveryProof.receiverWallet.usdcUnits).toBe("1001000");
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await new Promise((resolve) => rpcServer.close(resolve));
    }
  });

  it("shows wallet-derived paid completion proof on the cash register for imported baselines", async () => {
    mockFacilitatorSupportedKinds();
    process.env.BASELINE_PAID_COMPLETIONS = "2";
    process.env.BASELINE_ESTIMATED_GROSS_REVENUE_USD = "0.002";
    process.env.BASELINE_LISTING_SCORE_COMPLETIONS = "2";
    process.env.BASELINE_LISTING_SCORE_REVENUE_USD = "0.002";
    process.env.BASELINE_INDEXED_ROAST_GET_COMPLETIONS = "1";
    process.env.BASELINE_INDEXED_ROAST_GET_REVENUE_USD = "0.001";
    process.env.BASELINE_LAST_PAID_AT = "2026-06-18T06:43:22.052Z";
    process.env.BASELINE_LAST_SETTLEMENT_TX_HASH = "0xa124906f1310b2100f02255c7467f2b89dae95594b36e8c70c98e6dc16a4da71";
    process.env.BASELINE_LAST_SETTLEMENT_USDC_UNITS = "1000";
    process.env.BASELINE_LAST_SETTLEMENT_CONFIRMED_AT = "2026-06-18T06:43:23.000Z";
    process.env.BASELINE_LAST_SETTLEMENT_ROUTE_PATH = "/api/listing-roast";
    process.env.BASELINE_LAST_SETTLEMENT_METHOD = "GET";
    process.env.BASELINE_LAST_SETTLEMENT_MAX_AMOUNT_REQUIRED = "1000";

    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.status).toBe(200);
      expect(cashRegister.json.paidCompletions).toBe(2);
      expect(cashRegister.json.estimatedGrossRevenueUsd).toBe("0.002");
      expect(cashRegister.json.lastPaidCompletion.source).toBe("public_wallet_settlement");
      expect(cashRegister.json.lastPaidCompletion.routeKey).toBe("indexedRoastGet");
      expect(cashRegister.json.lastPaidCompletion.method).toBe("GET");
      expect(cashRegister.json.lastPaidCompletion.path).toBe("/api/listing-roast");
      expect(cashRegister.json.lastPaidCompletion.estimatedRevenueUsd).toBe("0.001");
      expect(cashRegister.json.lastPaidCompletion.txHash).toBe(process.env.BASELINE_LAST_SETTLEMENT_TX_HASH);
      expect(cashRegister.json.recentPaidCompletions).toHaveLength(1);
      expect(cashRegister.json.derivedPaidCompletion.routeKey).toBe("indexedRoastGet");
      expect(cashRegister.json.latestWalletSettlement.payerDetails).toBe("omitted");
      expect(cashRegister.json.latestWalletSettlement.route.maxAmountRequired).toBe("1000");

      const proof = await fetchJson(server, "/api/paid-usage-proof");
      expect(proof.status).toBe(200);
      expect(proof.json.paidUsageProof.latestPaidCompletion.source).toBe("public_wallet_settlement");
      expect(proof.json.paidUsageProof.latestPaidCompletion.routeKey).toBe("indexedRoastGet");
      expect(proof.json.paidUsageProof.latestPaidCompletion.path).toBe("/api/listing-roast");
      expect(proof.json.paidUsageProof.latestPaidCompletion.estimatedRevenueUsd).toBe("0.001");

      const home = await fetchJson(server, "/");
      expect(home.status).toBe(200);
      expect(home.text).toContain("GET /api/listing-roast settled");
      expect(home.text).toContain("0.001 wallet proof is exposed in the cash register");

      const unpaidIndexedRoast = await fetchJson(server, "/api/listing-roast");
      expect(unpaidIndexedRoast.status).toBe(402);
      expect(unpaidIndexedRoast.json.paidUseProof.walletConfirmedPaidRoute.source).toBe("public_wallet_settlement");
      expect(unpaidIndexedRoast.json.paidUseProof.walletConfirmedPaidRoute.path).toBe("/api/listing-roast");
      expect(unpaidIndexedRoast.json.paidUseProof.walletConfirmedPaidRoute.estimatedRevenueUsd).toBe("0.001");
      expect(unpaidIndexedRoast.json.paidUseProof.walletConfirmedPaidRoute.payerDetails).toBe("omitted");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("protects the paid route with a one-cent x402 challenge", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/api/listing-roast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestExample)
      });

      expect(response.status).toBe(402);
      expect(response.headers.get("payment-required").length).toBeLessThan(7600);
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.error).toBe("Payment required");
      expect(challenge.resource.url).toContain("/api/listing-roast");
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.accepts[0].amount).toBe("10000");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.fullRoastGetValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.roastValidUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.indexedRoastGetValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.scoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.emptyDiscoveryProbes).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

  it("shows route-specific browser paywalls for paid route probes", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    const browserHeaders = {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
    };

    try {
      const indexed = await fetchJson(server, "/api/listing-roast", { headers: browserHeaders });
      expect(indexed.status).toBe(402);
      expect(indexed.headers.get("content-type")).toContain("text/html");
      expect(indexed.text).toContain("Pay Listing Roast x402");
      expect(indexed.text).toContain("/api/listing-roast");
      expect(indexed.text).toContain("x402 pay &#39;http://localhost:8787/api/listing-roast&#39;");
      expect(indexed.text).toContain("Choose A Different Route");

      const siteAudit = await fetchJson(server, "/api/x402-site-audit", { headers: browserHeaders });
      expect(siteAudit.status).toBe(402);
      expect(siteAudit.headers.get("content-type")).toContain("text/html");
      expect(siteAudit.text).toContain("/api/x402-site-audit");
      expect(siteAudit.text).toContain("--max-amount 1000");
      expect(siteAudit.text).toContain("/api/pay-now");

      const apiClient = await fetchJson(server, "/api/x402-site-audit", { headers: { Accept: "application/json" } });
      expect(apiClient.status).toBe(402);
      expect(apiClient.headers.get("content-type")).toContain("application/json");
      expect(apiClient.json.selectedPaidAction.path).toBe("/api/x402-site-audit");
      expect(apiClient.json.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(apiClient.json.recommendedPaidSequence[1].use).toBe("fullRoastGet");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

  it("serves common agent docs and OpenAPI aliases without payment", async () => {
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const agentsMarkdown = await fetchJson(server, "/AGENTS.md");
      expect(agentsMarkdown.status).toBe(200);
      expect(agentsMarkdown.headers.get("content-type")).toContain("text/markdown");
      expect(agentsMarkdown.headers.get("payment-required")).toBeNull();
      expect(agentsMarkdown.text).toContain("Do not call paid routes unless the buyer explicitly intends to pay");
      expect(agentsMarkdown.text).toContain("No OAuth, account registration, API key, agent registration, ACP, UCP, or MPP endpoint is supported");
      expect(agentsMarkdown.text).toContain("Paid-Use Proof Before Payment");
      expect(agentsMarkdown.text).toContain("Paid-use proof before payment: 0 paid completions; $0.00 registered.");
      expect(agentsMarkdown.text).toContain("Bazaar Cataloging Note");
      expect(agentsMarkdown.text).toContain("extensions.bazaar metadata");
      expect(agentsMarkdown.text).toContain("Official CDP discovery handoff");
      expect(agentsMarkdown.text).toContain("Official CDP search: https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=marketplace+listing+score");
      expect(agentsMarkdown.text).toContain("Official CDP merchant lookup: https://api.cdp.coinbase.com/platform/v2/x402/discovery/merchant?payTo=0x000000000000000000000000000000000000dEaD");
      expect(agentsMarkdown.text).toContain("Start paid use with the already-settled indexed route: http://localhost:8787/api/listing-roast");
      expect(agentsMarkdown.text).toContain("x402 marketplace conversion read, agent listing conversion score");
      expect(agentsMarkdown.text).toContain("paid API listing quality, AgentCore x402 payments readiness, x402 marketplace conversion, or agent listing conversion score");
      expect(agentsMarkdown.text).toContain("Agent payment prompt: Call this x402 endpoint with GET and pay up to 0.001 USDC: http://localhost:8787/api/listing-roast");
      expect(agentsMarkdown.text).toContain("Recommended Paid Sequence");
      expect(agentsMarkdown.text).toContain("Full roast command");
      expect(agentsMarkdown.text).toContain("GET http://localhost:8787/api/full-listing-roast");
      expect(agentsMarkdown.text).toContain("POST http://localhost:8787/api/listing-roast");
      expect(agentsMarkdown.text).toContain("custom-body full listing roast; omitted bodies use safe defaults");
      expect(agentsMarkdown.text).toContain("--max-amount 10000");
      expect(agentsMarkdown.text).toContain("/api/paid-usage-proof");
      expect(agentsMarkdown.text).toContain("/api/cash-register");
      expect(agentsMarkdown.text).toContain("/v1");
      expect(agentsMarkdown.text).toContain("/api/preflight");
      expect(agentsMarkdown.text).toContain("/api/v1/preflight");
      expect(agentsMarkdown.text).toContain("/preflight");

      const docs = await fetchJson(server, "/docs");
      expect(docs.status).toBe(200);
      expect(docs.headers.get("content-type")).toContain("text/markdown");
      expect(docs.text).toContain("# Listing Roast x402");
      expect(docs.text).toContain("Paid-use proof before payment: 0 paid completions; $0.00 registered.");
      expect(docs.text).toContain("/AGENTS.md");
      expect(docs.text).toContain("Official CDP discovery handoff");
      expect(docs.text).toContain("Official CDP search: https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=marketplace+listing+score");
      expect(docs.text).toContain("x402 marketplace conversion, agent listing conversion score");

      const apiDocs = await fetchJson(server, "/api-docs");
      expect(apiDocs.status).toBe(200);
      expect(apiDocs.headers.get("content-type")).toContain("text/markdown");
      expect(apiDocs.text).toContain("# Listing Roast x402");
      expect(apiDocs.text).toContain("Paid-use proof before payment: 0 paid completions; $0.00 registered.");

      const versionedOpenApi = await fetchJson(server, "/api/v1/openapi.json");
      expect(versionedOpenApi.status).toBe(200);
      expect(versionedOpenApi.headers.get("payment-required")).toBeNull();
      expect(versionedOpenApi.json.openapi).toBe("3.1.0");
      expect(versionedOpenApi.json.paths["/v1"].get.operationId).toBe("getListingRoastV1Entry");

      const swaggerJson = await fetchJson(server, "/swagger.json");
      expect(swaggerJson.status).toBe(200);
      expect(swaggerJson.json.info.title).toBe("Listing Roast x402");

      const apiOpenApi = await fetchJson(server, "/api/openapi.json");
      expect(apiOpenApi.status).toBe(200);
      expect(apiOpenApi.json.info.title).toBe("Listing Roast x402");

      const apiDocsOpenApi = await fetchJson(server, "/api-docs/openapi.json");
      expect(apiDocsOpenApi.status).toBe(200);
      expect(apiDocsOpenApi.json.info.title).toBe("Listing Roast x402");

      const redirect = await fetch(`http://127.0.0.1:${server.address().port}/openapi.yaml`, { redirect: "manual" });
      expect(redirect.status).toBe(302);
      expect(redirect.headers.get("location")).toContain("/openapi.json");
      expect(redirect.headers.get("payment-required")).toBeNull();

      const wellKnownRedirect = await fetch(`http://127.0.0.1:${server.address().port}/.well-known/openapi.yaml`, { redirect: "manual" });
      expect(wellKnownRedirect.status).toBe(302);
      expect(wellKnownRedirect.headers.get("location")).toContain("/openapi.json");
      expect(wellKnownRedirect.headers.get("payment-required")).toBeNull();

      const paymentAlias = await fetchJson(server, "/.well-known/payments.json");
      expect(paymentAlias.status).toBe(200);
      expect(paymentAlias.json.metadataVersion).toBe("2026-06-21-score-upgrade-label-cleanup-v68");
      expect(paymentAlias.json.commands).toContain("/api/commands");

      const mcpJsonAlias = await fetchJson(server, "/mcp.json");
      expect(mcpJsonAlias.status).toBe(200);
      expect(mcpJsonAlias.json.commands).toContain("/api/commands");

      const mcpServerCardAlias = await fetchJson(server, "/mcp/server-card.json");
      expect(mcpServerCardAlias.status).toBe(200);
      expect(mcpServerCardAlias.json.payment.commands).toContain("/api/commands");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.paidCompletions).toBe(0);
      expect(cashRegister.json.signals.llmsViews).toBe(3);
      expect(cashRegister.json.signals.openApiViews).toBe(4);
      expect(cashRegister.json.signals.unpaidChallenges).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("rejects HEAD probes on paid routes without recording revenue", async () => {
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const headPing = await fetchJson(server, "/api/x402-ping", { method: "HEAD" });
      expect(headPing.status).toBe(405);
      expect(headPing.headers.get("allow")).toBe("GET");
      expect(headPing.headers.get("payment-required")).toBeNull();
      expect(headPing.headers.get("link")).toContain("/x402.json");

      const headApi = await fetchJson(server, "/api", { method: "HEAD" });
      expect(headApi.status).toBe(405);
      expect(headApi.headers.get("allow")).toBe("GET");
      expect(headApi.headers.get("payment-required")).toBeNull();

      const headApiV1 = await fetchJson(server, "/api/v1", { method: "HEAD" });
      expect(headApiV1.status).toBe(405);
      expect(headApiV1.headers.get("allow")).toBe("GET");
      expect(headApiV1.headers.get("payment-required")).toBeNull();

      const headV1 = await fetchJson(server, "/v1", { method: "HEAD" });
      expect(headV1.status).toBe(405);
      expect(headV1.headers.get("allow")).toBe("GET");
      expect(headV1.headers.get("payment-required")).toBeNull();

      const headExamples = await fetchJson(server, "/api/examples", { method: "HEAD" });
      expect(headExamples.status).toBe(200);
      expect(headExamples.headers.get("payment-required")).toBeNull();

      const headSiteAudit = await fetchJson(server, "/api/x402-site-audit", { method: "HEAD" });
      expect(headSiteAudit.status).toBe(405);
      expect(headSiteAudit.headers.get("allow")).toBe("GET");
      expect(headSiteAudit.headers.get("payment-required")).toBeNull();

      const headPreflightAlias = await fetchJson(server, "/api/preflight", { method: "HEAD" });
      expect(headPreflightAlias.status).toBe(405);
      expect(headPreflightAlias.headers.get("allow")).toBe("GET");
      expect(headPreflightAlias.headers.get("payment-required")).toBeNull();

      const headRoast = await fetchJson(server, "/api/listing-roast", { method: "HEAD" });
      expect(headRoast.status).toBe(405);
      expect(headRoast.headers.get("allow")).toBe("GET, POST");
      expect(headRoast.headers.get("payment-required")).toBeNull();

      const headAudit = await fetchJson(server, "/api/x402-discovery-audit", { method: "HEAD" });
      expect(headAudit.status).toBe(405);
      expect(headAudit.headers.get("allow")).toBe("GET, POST");
      expect(headAudit.headers.get("payment-required")).toBeNull();

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.paidCompletions).toBe(0);
      expect(cashRegister.json.signals.unpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.apiEntryValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.pingValidUnpaidChallenges).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("preserves concurrent signal writes", async () => {
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      await Promise.all(Array.from({ length: 12 }, () => fetchJson(server, "/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "commandCopyClicks" })
      })));

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.commandCopyClicks).toBe(12);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("keeps route-level paid counters alongside aggregate revenue", async () => {
    await recordPaidCompletion("directoryPost", 0.001);
    await recordPaidCompletion("apiEntry", 0.001);
    await recordPaidCompletion("instantScore", 0.001);
    await recordPaidCompletion("conversionScore", 0.001);
    await recordPaidCompletion("agentListingConversion", 0.001);
    await recordPaidCompletion("indexedRoastGet", 0.001);
    await recordPaidCompletion("listingScorePost", 0.005);
    await recordPaidCompletion("x402SiteAudit", 0.001);
    await recordPaidCompletion("x402DiscoveryAudit", 0.01);
    await recordPaidCompletion("x402Ping", 0.001);
    await recordPaidCompletion("fullRoastGet", 0.01);
    await recordPaidCompletion("listingRoast", 0.01);

    const cashRegister = await getCashRegister();
    expect(cashRegister.paidCompletions).toBe(12);
    expect(cashRegister.estimatedGrossRevenueUsd).toBe("0.043");
    expect(cashRegister.listingScoreCompletions).toBe(5);
    expect(cashRegister.listingScoreEstimatedRevenueUsd).toBe("$0.009");
    expect(cashRegister.directoryPostCompletions).toBe(1);
    expect(cashRegister.directoryPostEstimatedRevenueUsd).toBe("$0.001");
    expect(cashRegister.apiEntryCompletions).toBe(1);
    expect(cashRegister.apiEntryEstimatedRevenueUsd).toBe("$0.001");
    expect(cashRegister.instantScoreCompletions).toBe(3);
    expect(cashRegister.indexedRoastGetCompletions).toBe(1);
    expect(cashRegister.fullRoastGetCompletions).toBe(1);
    expect(cashRegister.fullRoastGetEstimatedRevenueUsd).toBe("$0.01");
    expect(cashRegister.listingScorePostCompletions).toBe(1);
    expect(cashRegister.x402SiteAuditCompletions).toBe(1);
    expect(cashRegister.x402DiscoveryAuditCompletions).toBe(2);
    expect(cashRegister.x402DiscoveryAuditEstimatedRevenueUsd).toBe("$0.011");
    expect(cashRegister.x402PingCompletions).toBe(1);
    expect(cashRegister.listingRoastCompletions).toBe(1);
    expect(cashRegister.lastPaidCompletion.routeKey).toBe("listingRoast");
    expect(cashRegister.lastPaidCompletion.path).toBe("/api/listing-roast");
    expect(cashRegister.lastPaidCompletion.method).toBe("POST");
    expect(cashRegister.recentPaidCompletions).toHaveLength(12);
    expect(cashRegister.recentPaidCompletions.map((event) => event.routeKey)).toContain("directoryPost");
    expect(cashRegister.recentPaidCompletions.find((event) => event.routeKey === "directoryPost").path).toBe("/");
    expect(cashRegister.recentPaidCompletions.map((event) => event.routeKey)).toContain("conversionScore");
    expect(cashRegister.recentPaidCompletions.map((event) => event.routeKey)).toContain("agentListingConversion");
    expect(cashRegister.recentPaidCompletions.find((event) => event.routeKey === "agentListingConversion").path).toBe("/api/agent-listing-conversion");
    expect(cashRegister.recentPaidCompletions.map((event) => event.routeKey)).toContain("fullRoastGet");
    expect(cashRegister.recentPaidCompletions.find((event) => event.routeKey === "fullRoastGet").path).toBe("/api/full-listing-roast");
  });

  it("protects the public directory root POST handoff with a one-tenth-cent x402 challenge", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/", { method: "POST" });

      expect(response.status).toBe(402);
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.error).toBe("Payment required");
      expect(challenge.resource.url).toBe("http://localhost:8787/");
      expect(challenge.resource.description).toContain("$0.001");
      expect(challenge.resource.description).toContain("directory handoff");
      expect(challenge.resource.description).toContain("preferred first paid action");
      expect(challenge.resource.description).toContain("GET /api/listing-roast");
      expect(challenge.resource.description).toContain("Proof before payment");
      expect(challenge.resource.description).toContain("/api/paid-usage-proof");
      expect(challenge.resource.description).toContain("/api/cash-register");
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.accepts[0].amount).toBe("1000");
      expect(response.json.error).toBe("payment_required");
      expect(response.json.selectedPaidAction.path).toBe("/");
      expect(response.json.selectedPaidAction.method).toBe("POST");
      expect(response.json.selectedPaidAction.maxAmountRequired).toBe("1000");
      expect(response.json.selectedPaidAction.command).not.toContain("-d ");
      expect(response.json.resource.description).toContain("includes a quick score");
      expect(response.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.directoryPostValidUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.emptyDiscoveryProbes).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

  it("protects the generic API entrypoint with a one-tenth-cent x402 challenge", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/api");

      expect(response.status).toBe(402);
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.error).toBe("Payment required");
      expect(challenge.resource.url).toContain("/api");
      expect(challenge.resource.description).toContain("$0.001");
      expect(challenge.resource.description).toContain("API Entry");
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.accepts[0].amount).toBe("1000");

      const examples = await fetchJson(server, "/api/examples");
      expect(examples.status).toBe(200);
      expect(examples.headers.get("payment-required")).toBeNull();

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.apiEntryValidUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.instantScoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.indexedRoastGetValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.pingValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.emptyDiscoveryProbes).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

  it("protects the versioned API entrypoint with a one-tenth-cent x402 challenge", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/api/v1");

      expect(response.status).toBe(402);
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.error).toBe("Payment required");
      expect(challenge.resource.url).toContain("/api/v1");
      expect(challenge.resource.description).toContain("$0.001");
      expect(challenge.resource.description).toContain("API v1 Entry");
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.accepts[0].amount).toBe("1000");

      const examples = await fetchJson(server, "/api/examples");
      expect(examples.status).toBe(200);
      expect(examples.headers.get("payment-required")).toBeNull();

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.apiEntryValidUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.instantScoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.indexedRoastGetValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.pingValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.emptyDiscoveryProbes).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

  it("protects the short v1 entrypoint with a one-tenth-cent x402 challenge", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/v1");

      expect(response.status).toBe(402);
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.error).toBe("Payment required");
      expect(challenge.resource.url).toContain("/v1");
      expect(challenge.resource.description).toContain("$0.001");
      expect(challenge.resource.description).toContain("v1 Entry");
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.accepts[0].amount).toBe("1000");

      const examples = await fetchJson(server, "/api/examples");
      expect(examples.status).toBe(200);
      expect(examples.headers.get("payment-required")).toBeNull();

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.apiEntryValidUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.instantScoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.indexedRoastGetValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.pingValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.emptyDiscoveryProbes).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

  it("protects the instant GET score route with a one-tenth-cent x402 challenge", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/api/instant-listing-score");

      expect(response.status).toBe(402);
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.error).toBe("Payment required");
      expect(challenge.resource.url).toContain("/api/instant-listing-score");
      expect(challenge.resource.description).toContain("$0.001");
      expect(challenge.extensions.bazaar.info.input.queryParams.agentName).toBe("Listing Roast x402");
      expect(challenge.extensions.bazaar.info.input.queryParams.listingText).toMatch(/^Score marketplace product listing quality/);
      expect(challenge.extensions.bazaar.info.input.queryParams.listingText).toContain("$0.001 GET /api/listing-roast");
      expect(challenge.extensions.bazaar.info.input.queryParams.currentPrice).toBe("$0.001 GET; $0.01 GET/POST roast");
      expect(challenge.extensions.bazaar.info.input.queryParams.currentPrice).not.toBe("$1.00");
      expect(challenge.extensions.bazaar.info.output.example.agentName).toBeUndefined();
      expect(challenge.extensions.bazaar.info.output.example.price).toBe("$0.001");
      expect(challenge.extensions.bazaar.info.output.example.nextPaidAction.body.currentPrice).toBe("$0.001 GET; $0.01 GET/POST roast");
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.accepts[0].amount).toBe("1000");
      expect(response.json.error).toBe("payment_required");
      expect(response.json.selectedPaidAction.path).toBe("/api/instant-listing-score");
      expect(response.json.selectedPaidAction.maxAmountRequired).toBe("1000");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.instantScoreValidUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.conversionScoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.agentListingConversionValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.indexedRoastGetValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.roastValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.scoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.emptyDiscoveryProbes).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

  it("protects the x402 marketplace conversion alias with a one-tenth-cent x402 challenge", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/api/x402-marketplace-conversion");

      expect(response.status).toBe(402);
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.error).toBe("Payment required");
      expect(challenge.resource.url).toContain("/api/x402-marketplace-conversion");
      expect(challenge.resource.description).toContain("$0.001");
      expect(challenge.resource.description).toContain("Marketplace Conversion");
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.accepts[0].amount).toBe("1000");
      expect(response.json.error).toBe("payment_required");
      expect(response.json.selectedPaidAction.path).toBe("/api/x402-marketplace-conversion");
      expect(response.json.selectedPaidAction.maxAmountRequired).toBe("1000");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.instantScoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.conversionScoreValidUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.agentListingConversionValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.indexedRoastGetValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.roastValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.scoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.emptyDiscoveryProbes).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

  it("protects the exact agent listing conversion score alias with a one-tenth-cent x402 challenge", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/api/agent-listing-conversion-score?serviceUrl=https%3A%2F%2Fexample.com&serviceName=Example");

      expect(response.status).toBe(402);
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.error).toBe("Payment required");
      const resourceUrl = new URL(challenge.resource.url);
      expect(resourceUrl.pathname).toBe("/api/agent-listing-conversion-score");
      expect(resourceUrl.search).toBe("");
      expect(challenge.resource.description).toMatch(/^Agent Listing Conversion Score by Listing Roast/);
      expect(challenge.resource.description).toContain("$0.001");
      expect(challenge.resource.description).toContain("agent listing conversion");
      expect(challenge.resource.description).toContain("Exact score alias /api/agent-listing-conversion-score");
      expect(challenge.resource.description).toContain("buyer agent skip reasons");
      expect(challenge.resource.description).toContain("agent service listing clarity");
      expect(challenge.resource.description).toContain("Listing Roast");
      expect(challenge.resource.description).toContain("buyer-agent skip reasons");
      expect(response.json.resource.description).toBe(challenge.resource.description);
      expect(challenge.extensions.bazaar.info.input.queryParams.currentCheckoutPath).toBe("/api/agent-listing-conversion-score");
      expect(challenge.extensions.bazaar.info.output.example.route).toBe("/api/agent-listing-conversion-score");
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.accepts[0].amount).toBe("1000");
      expect(response.json.error).toBe("payment_required");
      expect(response.json.noSpendPreview).toBe(true);
      expect(response.json.selectedPaidAction.path).toBe("/api/agent-listing-conversion-score");
      expect(response.json.intentRoutes.fullRoast.maxAmountRequired).toBe("10000");
      expect(response.json.freeHandoff).toContain("/api/pay-now");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.instantScoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.conversionScoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.agentListingConversionValidUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.indexedRoastGetValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.roastValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.scoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.emptyDiscoveryProbes).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

  it("keeps the canonical agent listing conversion route protected", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/api/agent-listing-conversion");

      expect(response.status).toBe(402);
      const challenge = readPaymentRequiredHeader(response.headers);
      const resourceUrl = new URL(challenge.resource.url);
      expect(resourceUrl.pathname).toBe("/api/agent-listing-conversion");
      expect(challenge.accepts[0].amount).toBe("1000");
      expect(response.json.selectedPaidAction.path).toBe("/api/agent-listing-conversion");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.agentListingConversionValidUnpaidChallenges).toBe(1);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

  it("protects the indexed listing-roast GET route with a one-tenth-cent x402 challenge", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({
      payTo: "0x000000000000000000000000000000000000dEaD",
      serviceUrl: "https://listing-roast-x402-service-production.up.railway.app"
    });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/api/listing-roast");

      expect(response.status).toBe(402);
      expect(response.headers.get("payment-required").length).toBeLessThan(7600);
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.error).toBe("Payment required");
      expect(challenge.resource.url).toContain("/api/listing-roast");
      expect(challenge.resource.description).toMatch(/^Listing Roast x402/);
      expect(challenge.resource.description.slice(0, 210)).toContain("buyer-agent skip reasons");
      expect(challenge.resource.description.slice(0, 210)).toContain("agent service clarity");
      expect(challenge.resource.description.slice(0, 210)).toContain("full listing roast");
      expect(challenge.resource.description).toContain("listing quality score API");
      expect(challenge.resource.description.toLowerCase()).toContain("paid api listing quality score");
      expect(challenge.resource.description).toContain("marketplace product listing quality");
      expect(challenge.resource.description).toContain("Agentic.Market listing score");
      expect(challenge.resource.description).toContain("AgentCore Gateway");
      expect(challenge.resource.description).toContain("Coinbase x402 Bazaar MCP server buyers");
      expect(challenge.resource.description).toContain("marketplace conversion API");
      expect(challenge.resource.description).toContain("paid API listing quality score");
      expect(challenge.resource.description).toContain("agent listing conversion score");
      expect(challenge.resource.description).toContain("x402 discovery audit");
      expect(challenge.resource.description).toContain("x402 site audit");
      expect(challenge.resource.description).toContain("paid API preflight");
      expect(challenge.resource.description).toContain("route health");
      expect(challenge.resource.description).toContain("stale Bazaar price");
      expect(challenge.resource.description).toContain("$0.001");
      expect(challenge.resource.description).toContain("buyer-agent skip reasons");
      expect(challenge.resource.description).toContain("buyer agent skip reasons");
      expect(challenge.resource.description).toContain("agent service clarity");
      expect(challenge.resource.description).toContain("Commands");
      expect(challenge.resource.description).toContain("/api/commands");
      expect(challenge.resource.description).toContain("Proof before payment");
      expect(challenge.resource.description).toContain("/api/paid-usage-proof");
      expect(challenge.resource.description).toContain("/api/cash-register");
      expect(challenge.resource.description).toContain("GET /api/full-listing-roast");
      expect(challenge.resource.serviceName).toBe("Listing Roast x402 Paid API Listing Quality Score");
      expect(challenge.resource.tags).toEqual([
        "x402",
        "paid API listing quality score",
        "AgentCore x402 payments",
        "Coinbase x402 Bazaar MCP server",
        "marketplace listing score",
        "buyer agent skip reasons",
        "x402 marketplace conversion",
        "x402 discovery audit",
        "paid API preflight",
        "stale Bazaar price"
      ]);
      expect(challenge.extensions.bazaar.info.input.queryParams.agentName).toBe("Listing Roast x402");
      expect(challenge.extensions.bazaar.info.input.queryParams.listingText).toMatch(/^Score marketplace product listing quality/);
      expect(challenge.extensions.bazaar.info.input.queryParams.listingText).toContain("x402 marketplace conversion");
      expect(challenge.extensions.bazaar.info.input.queryParams.listingText).toContain("agent listing conversion score");
      expect(challenge.extensions.bazaar.info.input.queryParams.listingText).toContain("$0.001 GET /api/listing-roast");
      expect(challenge.extensions.bazaar.info.input.queryParams.currentPrice).toBe("$0.001 GET; $0.01 GET/POST roast");
      expect(challenge.extensions.bazaar.info.input.queryParams.currentPrice).not.toBe("$1.00");
      expect(challenge.extensions.bazaar.info.input.queryParams.goal).toContain("$0.01 full roast");
      expect(challenge.extensions.bazaar.info.output.example.price).toBe("$0.001");
      expect(challenge.extensions.bazaar.info.output.example.matchedBuyerIntent).toContain("marketplace listing score");
      expect(challenge.extensions.bazaar.info.output.example.matchedBuyerIntent).toContain("paid API listing quality score");
      expect(challenge.extensions.bazaar.info.output.example.settlementRefreshNote).toContain("paymentPayload.resource");
      expect(challenge.extensions.bazaar.info.output.example.settlementRefreshNote).toContain("unpaid probes do not refresh");
      expect(challenge.extensions.bazaar.info.output.example.officialCdpDiscovery.indexedRoute).toBeUndefined();
      expect(challenge.extensions.bazaar.info.output.example.officialCdpDiscovery.recommendedSearchQuery).toBe("marketplace listing score");
      expect(challenge.extensions.bazaar.info.output.example.officialCdpDiscovery.recommendedMaxUsdPrice).toBe("0.001");
      expect(challenge.extensions.bazaar.info.output.example.officialCdpDiscovery.recommendedSearchUrl).toBeUndefined();
      expect(challenge.extensions.bazaar.info.output.example.officialCdpDiscovery.cheapCapSearchStrategy).toBeUndefined();
      expect(challenge.extensions.bazaar.info.output.example.officialCdpDiscovery.alternateSearchQueries).toContain("paid api listing quality");
      expect(challenge.extensions.bazaar.info.output.example.officialCdpDiscovery.alternateSearchQueries).toContain("buyer-agent skip reasons");
      expect(challenge.extensions.bazaar.info.output.example.officialCdpDiscovery.alternateSearchQueries).toContain("x402 discovery audit");
      expect(challenge.extensions.bazaar.info.output.example.officialCdpDiscovery.publicCdpSearchAudit).toBeUndefined();
      expect(challenge.extensions.bazaar.info.output.example.buyerSearchPhrases).toBeUndefined();
      expect(challenge.extensions.bazaar.info.output.example.nextPaidAction.path).toBe("/api/full-listing-roast");
      expect(challenge.extensions.bazaar.info.output.example.nextPaidAction.maxAmountRequired).toBe("10000");
      expect(challenge.extensions.bazaar.info.output.example.nextPaidAction.command).toBeUndefined();
      expect(challenge.extensions.bazaar.info.output.example.fullRoastUpgradeDecision).toBeUndefined();
      expect(challenge.extensions.bazaar.info.output.example.buyerIntentHandoffs).toBeUndefined();
      expect(challenge.extensions.bazaar.info.output.example.nextPaidActions[0].path).toBe("/api/full-listing-roast");
      expect(challenge.extensions.bazaar.info.output.example.nextPaidActions[0].maxAmountRequired).toBe("10000");
      expect(challenge.extensions.bazaar.info.output.example.nextPaidActions.find((action) => action.path === "/api/full-listing-roast").maxAmountRequired).toBe("10000");
      expect(challenge.extensions.bazaar.info.output.example.nextPaidActions.find((action) => action.path === "/api/full-listing-roast").command).toBeUndefined();
      const indexedQuerySchema = challenge.extensions.bazaar.schema.properties.input.properties.queryParams.properties;
      expect(indexedQuerySchema.agentName.description).toBeUndefined();
      expect(indexedQuerySchema.listingText.description).toBeUndefined();
      expect(indexedQuerySchema.currentPrice.example).toBeUndefined();
      expect(indexedQuerySchema.currentPrice.default).toBeUndefined();
      expect(challenge.extensions.bazaar.info.input.queryParams.currentPrice).toBe("$0.001 GET; $0.01 GET/POST roast");
      expect(indexedQuerySchema.currentCheckoutPath.example).toBeUndefined();
      expect(indexedQuerySchema.currentCheckoutPath.default).toBeUndefined();
      expect(challenge.extensions.bazaar.info.input.queryParams.currentCheckoutPath).toBe("/api/listing-roast");
      expect(indexedQuerySchema.goal.description).toBeUndefined();
      const indexedOutputSchema = challenge.extensions.bazaar.schema.properties.output.properties.example;
      expect(indexedOutputSchema.required).toEqual(["service", "endpoint", "price"]);
      expect(indexedOutputSchema.properties.service.type).toBe("string");
      expect(indexedOutputSchema.properties.verdict.type).toBe("string");
      expect(indexedOutputSchema.properties.score.type).toBe("string");
      expect(indexedOutputSchema.properties.nextPaidAction.properties.path.type).toBe("string");
      expect(indexedOutputSchema.properties.nextPaidActions.items.properties.intent.type).toBe("string");
      expect(indexedOutputSchema.additionalProperties).toBe(true);
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.accepts[0].amount).toBe("1000");
      expect(challenge.accepts[0].extra.resource).toBe(challenge.resource.url);
      expect(challenge.accepts[0].extra.version).toBe("2");
      expect(response.json.error).toBe("payment_required");
      expect(response.text.indexOf("\"paymentShortcut\"")).toBeGreaterThan(-1);
      expect(response.text.indexOf("\"paymentShortcut\"")).toBeLessThan(response.text.indexOf("\"resource\""));
      expect(response.text.indexOf("\"selectedPaidUrl\"")).toBeLessThan(response.text.indexOf("\"resource\""));
      expect(response.json.accepts[0].extra.resource).toBe(response.json.resource.url);
      expect(response.json.resource.description).toContain("x402 seller growth checklist");
      expect(response.json.catalogRefreshHint.resource).toBe(response.json.resource.url);
      expect(response.json.catalogRefreshHint.liveDefaults.method).toBe("GET");
      expect(response.json.catalogRefreshHint.liveDefaults.path).toBe("/api/listing-roast");
      expect(response.json.catalogRefreshHint.liveDefaults.maxAmountRequired).toBe("1000");
      expect(response.json.catalogRefreshHint.liveDefaults.currentPrice).toBe("$0.001 GET; $0.01 GET/POST roast");
      expect(response.json.catalogRefreshHint.liveDefaults.currentCheckoutPath).toBe("/api/listing-roast");
      expect(response.json.catalogRefreshHint.liveDefaults.listingText).toContain("$0.001 GET /api/listing-roast");
      expect(response.json.catalogRefreshHint.staleCachedDirectoryInputGuard.normalizedOnPaidRetry).toBe(true);
      expect(response.json.catalogRefreshHint.staleCachedDirectoryInputGuard.stalePriceExample).toBe("$1.00");
      expect(response.json.catalogRefreshHint.staleCachedDirectoryInputGuard.livePrice).toBe("$0.001 GET; $0.01 GET/POST roast");
      expect(response.json.catalogRefreshHint.staleCachedDirectoryInputGuard.maxAmountRequired).toBe("1000");
      expect(response.json.catalogRefreshHint.staleCachedDirectoryInputGuard.note).toContain("normalizes");
      expect(response.json.catalogRefreshHint.officialCdpDiscovery.recommendedSearchQuery).toBe("marketplace listing score");
      expect(response.json.catalogRefreshHint.officialCdpDiscovery.recommendedMaxUsdPrice).toBe("0.001");
      expect(response.json.catalogRefreshHint.officialCdpDiscovery.recommendedSearchUrl).toContain("maxUsdPrice=0.001");
      expect(response.json.catalogRefreshHint.officialCdpDiscovery.alternateSearchQueries).toContain("paid api listing quality");
      expect(response.json.catalogRefreshHint.officialCdpDiscovery.alternateSearchQueries).toContain("buyer-agent skip reasons");
      expect(response.json.catalogRefreshHint.officialCdpDiscovery.alternateSearchQueries).toContain("x402 site audit");
      expect(response.json.catalogRefreshHint.officialCdpDiscovery.knownWorkingSearchQueries.map((entry) => entry.query)).toContain("paid api listing quality");
      expect(response.json.catalogRefreshHint.officialCdpDiscovery.knownWorkingSearchQueries.find((entry) => entry.query === "listing roast").maxUsdPrice).toBe("0.01");
      expect(response.json.catalogRefreshHint.officialCdpDiscovery.notYetRankingSearchQueries.map((entry) => entry.query)).toContain("buyer-agent skip reasons");
      expect(response.json.catalogRefreshHint.officialCdpDiscovery.publicCdpSearchAudit.publicCardObservedServiceName).toBeNull();
      expect(response.json.catalogRefreshHint.officialCdpDiscovery.publicCdpSearchAudit.missingOrCompetedQueries.map((entry) => entry.query)).toContain("score x402 endpoint before paying");
      expect(response.json.officialCdpDiscovery.indexedRoute).toBe(response.json.resource.url);
      expect(response.json.officialCdpDiscovery.priceFilterReason).toContain("maxUsdPrice=0.001");
      expect(response.json.selectedPaidUrl).toBe(response.json.resource.url);
      expect(response.json.selectedPaidPath).toBe("/api/listing-roast");
      expect(response.json.selectedPaidMethod).toBe("GET");
      expect(response.json.selectedPaidMaxAmountRequired).toBe("1000");
      expect(response.json.publicCdpStaleCardOverride.status).toBe("owned-live-metadata-overrides-stale-public-card");
      expect(response.json.publicCdpStaleCardOverride.preferredFirstPaidPath).toBe("/api/listing-roast");
      expect(response.json.publicCdpStaleCardOverride.selectedPaidPath).toBe("/api/listing-roast");
      expect(response.json.publicCdpStaleCardOverride.selectedPaidMaxAmountRequired).toBe("1000");
      expect(response.json.publicCdpStaleCardOverride.directFullRoastPath).toBe("/api/full-listing-roast");
      expect(response.json.publicCdpStaleCardOverride.stalePublicFieldsToIgnore.join(" ")).toContain("$1.00");
      expect(response.json.publicCdpStaleCardOverride.stalePublicFieldsToIgnore.join(" ")).toContain("POST /api/listing-roast");
      expect(response.json.firstPaidUrl).toBe(response.json.resource.url);
      expect(response.json.firstPaidPath).toBe("/api/listing-roast");
      expect(response.json.firstPaidMaxAmountRequired).toBe("1000");
      expect(response.json.payableRoute.selectedPaidUrl).toBe(response.json.selectedPaidUrl);
      expect(response.json.paymentShortcut).toEqual(response.json.payableRoute);
      expect(response.json.payableRoute.selectedPaidPath).toBe("/api/listing-roast");
      expect(response.json.payableRoute.selectedPaidMethod).toBe("GET");
      expect(response.json.payableRoute.selectedPaidMaxAmountRequired).toBe("1000");
      expect(response.json.payableRoute.firstPaidPath).toBe("/api/listing-roast");
      expect(response.json.payableRoute.firstPaidMaxAmountRequired).toBe("1000");
      expect(response.json.payableRoute.upgradeAfterQuickScore.selectedPaidPath).toBe("/api/full-listing-roast");
      expect(response.json.payableRoute.upgradeAfterQuickScore.selectedPaidMethod).toBe("GET");
      expect(response.json.payableRoute.upgradeAfterQuickScore.selectedPaidMaxAmountRequired).toBe("10000");
      expect(response.json.payableRoute.upgradeAfterQuickScore.maxPaymentUsd).toBe("0.01");
      expect(response.json.payableRoute.upgradeAfterQuickScore.paymentRequiredHeader).toBe("Payment-Required");
      expect(response.json.payableRoute.upgradeAfterQuickScore.paymentHeader).toBe("X-PAYMENT");
      expect(response.json.payableRoute.upgradeAfterQuickScore.command).toContain("/api/full-listing-roast");
      expect(response.json.payableRoute.upgradeAfterQuickScore.command).toContain("--max-amount 10000");
      expect(response.json.payableRoute.directFullRoastNow.selectedPaidPath).toBe("/api/full-listing-roast");
      expect(response.json.payableRoute.directFullRoastNow.selectedPaidMethod).toBe("GET");
      expect(response.json.payableRoute.directFullRoastNow.selectedPaidMaxAmountRequired).toBe("10000");
      expect(response.json.payableRoute.directFullRoastNow.whenToUse).toContain("full listing roast");
      expect(response.json.directFullRoastNow).toEqual(response.json.payableRoute.directFullRoastNow);
      expect(response.json.buyerDecision.quickScoreNow.path).toBe("/api/listing-roast");
      expect(response.json.buyerDecision.fullRoastNow.selectedPaidPath).toBe("/api/full-listing-roast");
      expect(response.json.buyerDecision.instruction).toContain("full listing roast");
      expect(response.json.payableRoute.maxPaymentUsd).toBe("0.001");
      expect(response.json.payableRoute.paymentRequiredHeader).toBe("Payment-Required");
      expect(response.json.payableRoute.paymentHeader).toBe("X-PAYMENT");
      expect(response.json.payableRoute.noSpend).toBe(true);
      expect(response.json.payableRoute.instruction).toContain("selectedPaidUrl");
      expect(response.json.selectedPaidAction.path).toBe("/api/listing-roast");
      expect(response.json.selectedPaidAction.command).toContain("--max-amount 1000");
      expect(response.json.agentPaymentRequest.url).toContain("/api/listing-roast");
      expect(response.json.agentPaymentRequest.method).toBe("GET");
      expect(response.json.agentPaymentRequest.maxPayment).toBe("0.001");
      expect(response.json.agentPaymentRequest.maxAmountRequired).toBe("1000");
      expect(response.json.agentPaymentPrompt).toContain("pay up to 0.001 USDC");
      expect(response.json.payCommand).toContain("/api/listing-roast");
      expect(response.json.payCommand).toMatch(/x402 pay '.*\/api\/listing-roast'/);
      expect(response.json.payCommand).toContain("--max-amount 1000");
      expect(response.json.pay_command).toBe(response.json.payCommand);
      expect(response.json.command).toBe(response.json.payCommand);
      expect(response.json.selectedPaidActionCommand).toBe(response.json.payCommand);
      expect(response.json.exactIntentPayCommand).toBe(response.json.payCommand);
      expect(response.json.firstPayCommand).toBe(response.json.payCommand);
      expect(response.json.firstPaidCommand).toBe(response.json.payCommand);
      expect(response.json.firstAgentPaymentRequest.url).toContain("/api/listing-roast");
      expect(response.json.firstAgentPaymentRequest.maxAmountRequired).toBe("1000");
      expect(response.json.payCommandExamples.bareRoute).toBe(response.json.payCommand);
      expect(response.json.payCommandExamples.withSampleInputs).toMatch(/x402 pay '.*\/api\/listing-roast\?agentName=/);
      expect(response.json.payCommandExamples.withSampleInputs).toContain("/api/listing-roast?agentName=");
      expect(response.json.payCommandExamples.withSampleInputs).toContain("&listingText=");
      expect(response.json.payCommandExamples.withSampleInputs).toContain("' \\\n  -X GET");
      expect(response.json.payCommandExamples.withSampleInputs).toContain("listingText=");
      expect(response.json.payCommandExamples.withSampleInputs).toContain("--max-amount 1000");
      expect(response.json.sampleQueryPayCommand).toBe(response.json.payCommandExamples.withSampleInputs);
      expect(response.json.sampleQueryInputs.agentName).toBe("Listing Roast x402");
      expect(response.json.sampleQueryInputs.listingText).toContain("marketplace product listing quality");
      expect(response.json.payNow).toContain("/api/pay-now");
      expect(response.json.commandHandoff).toContain("/api/commands");
      expect(response.json.commandHandoff).toContain("intent=Listing%20Roast%20Quick%20Score");
      expect(response.json.commands).toBe(response.json.commandHandoff);
      expect(response.json.payableRoute.payNow).toBe(response.json.payNow);
      expect(response.json.payableRoute.commands).toBe(response.json.commandHandoff);
      expect(response.json.payableRoute.command).toBe(response.json.payCommand);
      expect(response.json.whyPay).toContain("$0.001");
      expect(response.json.paidResponsePreview.noSpendPreview).toBe(true);
      expect(response.json.paidResponsePreview.route).toBe("/api/listing-roast");
      expect(response.json.paidResponsePreview.maxAmountRequired).toBe("1000");
      expect(response.json.paidResponsePreview.includes).toContain("score");
      expect(response.json.paidResponsePreview.example.endpoint).toBe("listing-roast-quick-score");
      expect(response.json.paidResponsePreview.example.liteRoastPreview.type).toBe("lite-roast-preview");
      expect(response.json.paidResponsePreview.example.liteRoastPreview.topFixes.length).toBeGreaterThan(0);
      expect(response.json.paidResponsePreview.example.liteRoastPreview.rewrittenListingPreview).toContain("Listing Roast x402");
      expect(response.json.paidResponsePreview.example.liteRoastPreview.fullRoastUpgrade.path).toBe("/api/full-listing-roast");
      expect(response.json.paidResponsePreview.example.nextPaidAction.path).toBe("/api/full-listing-roast");
      expect(response.json.paidUsageProof).toContain("/api/paid-usage-proof");
      expect(response.json.commands).toContain("/api/commands");
      expect(response.json.cashRegister).toContain("/api/cash-register");
      expect(response.json.settlementProof.cashRegister).toContain("/api/cash-register");
      expect(response.json.settlementProof.evidenceFields).toContain("receiverWallet.usdcUnits");
      expect(response.json.x402Retry.paymentRequiredHeader).toBe("Payment-Required");
      expect(response.json.x402Retry.paymentHeader).toBe("X-PAYMENT");
      expect(response.json.x402Retry.route).toContain("/api/listing-roast");
      expect(response.json.x402Retry.maxPaymentUsd).toBe("0.001");
      expect(response.json.x402Retry.agentPaymentPrompt).toContain("pay up to 0.001 USDC");
      expect(response.json.x402Retry.command).toContain("--max-amount 1000");
      expect(response.json.intentRoutes.agentListingConversion.path).toBe("/api/agent-listing-conversion-score");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.instantScoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.conversionScoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.agentListingConversionValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.indexedRoastGetValidUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.roastValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.scoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.emptyDiscoveryProbes).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

  it("keeps POST listing-roast terminal handoffs free of quick-score upgrade hints", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({
      payTo: "0x000000000000000000000000000000000000dEaD",
      serviceUrl: "https://listing-roast-x402-service-production.up.railway.app"
    });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/api/listing-roast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentName: "Example x402 API",
          listingText: "Score marketplace product listing quality and buyer-agent skip reasons.",
          targetBuyer: "x402, MCP, and AgentCore Gateway builders",
          currentPrice: "$0.01",
          goal: "Improve paid conversion"
        })
      });

      expect(response.status).toBe(402);
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.accepts[0].amount).toBe("10000");
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(response.json.selectedPaidPath).toBe("/api/listing-roast");
      expect(response.json.selectedPaidMethod).toBe("POST");
      expect(response.json.selectedPaidMaxAmountRequired).toBe("10000");
      expect(response.json.firstPaidPath).toBe("/api/listing-roast");
      expect(response.json.firstPaidMethod).toBe("POST");
      expect(response.json.firstPaidMaxAmountRequired).toBe("10000");
      expect(response.json.paymentShortcut.firstPaidPath).toBe("/api/listing-roast");
      expect(response.json.paymentShortcut.firstPaidMethod).toBe("POST");
      expect(response.json.paymentShortcut.upgradeAfterQuickScore).toBeUndefined();
      expect(response.json.payableRoute.upgradeAfterQuickScore).toBeUndefined();
      expect(response.json.paidResponsePreview.upgradeAfterQuickScore).toBeUndefined();
      expect(response.json.payableRoute.instruction).toContain("selectedPaidUrl");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

  it("keeps quick-score alias 402 bodies aligned with their challenged route", async () => {
    mockFacilitatorSupportedKinds();
    const expectedByPath = {
      "/api/marketplace-listing-score": "marketplaceListingScore",
      "/api/marketplace-listing-conversion-api": "marketplaceListingConversion",
      "/api/marketplace-listing-conversion": "marketplaceListingConversion",
      "/api/marketplace-product-listing-quality": "marketplaceProductListingQuality",
      "/api/paid-api-listing-quality": "paidApiListingQuality",
      "/api/paid-api-listing-quality-score": "paidApiListingQualityScore",
      "/api/listing-quality-score-api": "listingQualityScoreApi",
      "/api/agentcore-x402-payments": "agentCoreX402Payments",
      "/api/coinbase-x402-bazaar-mcp-server": "coinbaseX402BazaarMcpServer",
      "/api/x402-listing-quality": "x402ListingQuality",
      "/api/buyer-agent-skip-reasons": "buyerAgentSkipReasons",
      "/api/agent-service-clarity": "agentServiceClarity"
    };
    const expectedDescriptionPrefixByPath = {
      "/api/marketplace-listing-score": "Marketplace listing score x402",
      "/api/marketplace-listing-conversion-api": "Marketplace listing conversion API x402",
      "/api/marketplace-listing-conversion": "Marketplace listing conversion API x402",
      "/api/marketplace-product-listing-quality": "Marketplace product listing quality x402",
      "/api/paid-api-listing-quality": "Paid API listing quality score x402",
      "/api/paid-api-listing-quality-score": "Paid API listing quality score x402",
      "/api/listing-quality-score-api": "Listing quality score API x402",
      "/api/agentcore-x402-payments": "AgentCore x402 payments readiness x402",
      "/api/coinbase-x402-bazaar-mcp-server": "Coinbase x402 Bazaar MCP server readiness x402",
      "/api/x402-listing-quality": "x402 listing quality score",
      "/api/buyer-agent-skip-reasons": "Buyer-agent skip reasons and buyer agent skip reasons x402",
      "/api/agent-service-clarity": "Agent service clarity and agent-service listing score x402"
    };
    const expectedPayNowIntentByPath = {
      "/api/marketplace-listing-score": "marketplace listing score",
      "/api/marketplace-listing-conversion-api": "marketplace listing conversion API",
      "/api/marketplace-listing-conversion": "marketplace listing conversion API",
      "/api/marketplace-product-listing-quality": "marketplace product listing quality",
      "/api/paid-api-listing-quality": "paid API listing quality",
      "/api/paid-api-listing-quality-score": "paid API listing quality score",
      "/api/listing-quality-score-api": "listing quality score API",
      "/api/agentcore-x402-payments": "AgentCore x402 payments",
      "/api/coinbase-x402-bazaar-mcp-server": "Coinbase x402 Bazaar MCP server",
      "/api/x402-listing-quality": "x402 listing quality",
      "/api/buyer-agent-skip-reasons": "buyer-agent skip reasons",
      "/api/agent-service-clarity": "agent service clarity"
    };
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      for (const routePath of QUICK_SCORE_ALIAS_PATHS) {
        const response = await fetchJson(server, routePath);

        expect(response.status).toBe(402);
        const challenge = readPaymentRequiredHeader(response.headers);
        expect(challenge.resource.url).toContain(routePath);
        expect(challenge.resource.description).toMatch(new RegExp(`^${expectedDescriptionPrefixByPath[routePath]}`));
        expect(challenge.resource.description).toContain("$0.001");
        expect(challenge.resource.description).toContain("/api/listing-roast");
        expect(challenge.extensions.bazaar.info.input.queryParams.currentCheckoutPath).toBe(routePath);
        expect(challenge.extensions.bazaar.schema.properties.input.properties.queryParams.properties.currentCheckoutPath.default).toBeUndefined();
        expect(challenge.extensions.bazaar.info.input.queryParams.goal).toContain(routePath);
        expect(challenge.accepts[0].network).toBe("eip155:84532");
        expect(challenge.accepts[0].amount).toBe("1000");
        expect(challenge.accepts[0].extra.resource).toBe(challenge.resource.url);
        expect(response.json.error).toBe("payment_required");
        expect(response.json.x402Version).toBe(challenge.x402Version);
        expect(response.text.indexOf("\"paymentShortcut\"")).toBeGreaterThan(-1);
        expect(response.text.indexOf("\"paymentShortcut\"")).toBeLessThan(response.text.indexOf("\"resource\""));
        expect(response.text.indexOf("\"selectedPaidUrl\"")).toBeLessThan(response.text.indexOf("\"resource\""));
        expect(response.json.resource.url).toBe(challenge.resource.url);
        expect(response.json.resource.description).toBe(challenge.resource.description);
        expect(response.json.resource.mimeType).toBe(challenge.resource.mimeType);
        expect(response.json.resource.serviceName).toBe(challenge.resource.serviceName);
        expect(response.json.resource.tags).toEqual(challenge.resource.tags);
        expect(response.json.accepts[0].network).toBe(challenge.accepts[0].network);
        expect(response.json.accepts[0].amount).toBe(challenge.accepts[0].amount);
        expect(response.json.accepts[0].asset).toBe(challenge.accepts[0].asset);
        expect(response.json.accepts[0].payTo).toBe(challenge.accepts[0].payTo);
        expect(response.json.accepts[0].extra.resource).toBe(response.json.resource.url);
        expect(response.json.catalogRefreshHint.resource).toBe(response.json.resource.url);
        expect(response.json.paymentRequirementsSource.authoritative).toBe("Payment-Required response header");
        expect(response.json.selectedPaidUrl).toBe(response.json.resource.url);
        expect(response.json.selectedPaidPath).toBe(routePath);
        expect(response.json.selectedPaidMethod).toBe("GET");
        expect(response.json.selectedPaidMaxAmountRequired).toBe("1000");
        expect(response.json.firstPaidUrl).toContain("/api/listing-roast");
        expect(response.json.firstPaidPath).toBe("/api/listing-roast");
        expect(response.json.firstPaidMaxAmountRequired).toBe("1000");
        expect(response.json.payableRoute.selectedPaidUrl).toBe(response.json.selectedPaidUrl);
        expect(response.json.paymentShortcut).toEqual(response.json.payableRoute);
        expect(response.json.payableRoute.selectedPaidPath).toBe(routePath);
        expect(response.json.payableRoute.selectedPaidMethod).toBe("GET");
        expect(response.json.payableRoute.selectedPaidMaxAmountRequired).toBe("1000");
        expect(response.json.payableRoute.firstPaidPath).toBe("/api/listing-roast");
        expect(response.json.payableRoute.upgradeAfterQuickScore.selectedPaidPath).toBe("/api/full-listing-roast");
        expect(response.json.payableRoute.upgradeAfterQuickScore.selectedPaidMaxAmountRequired).toBe("10000");
        expect(response.json.payableRoute.upgradeAfterQuickScore.command).toContain("/api/full-listing-roast");
        expect(response.json.payableRoute.directFullRoastNow.selectedPaidPath).toBe("/api/full-listing-roast");
        expect(response.json.directFullRoastNow.selectedPaidMaxAmountRequired).toBe("10000");
        expect(response.json.buyerDecision.fullRoastNow.command).toContain("/api/full-listing-roast");
        expect(response.json.payableRoute.paymentRequiredHeader).toBe("Payment-Required");
        expect(response.json.payableRoute.paymentHeader).toBe("X-PAYMENT");
        expect(response.json.payableRoute.noSpend).toBe(true);
        const freeHandoff = new URL(response.json.freeHandoff);
        expect(freeHandoff.pathname).toBe("/api/pay-now");
        expect(freeHandoff.searchParams.get("intent")).toBe(expectedPayNowIntentByPath[routePath]);
        expect(response.json.payNow).toBe(response.json.freeHandoff);
        expect(response.headers.get("link")).toContain(`/api/pay-now?intent=${encodeURIComponent(expectedPayNowIntentByPath[routePath])}`);
        expect(response.headers.get("link")).toContain(`/api/commands?intent=${encodeURIComponent(expectedPayNowIntentByPath[routePath])}`);
        expect(response.json.selectedPaidAction.path).toBe(routePath);
        expect(response.json.selectedPaidAction.maxAmountRequired).toBe("1000");
        expect(response.json.selectedPaidAction.command).toContain(routePath);
        expect(response.json.payCommand).toContain(routePath);
        expect(response.json.pay_command).toBe(response.json.payCommand);
        expect(response.json.command).toBe(response.json.payCommand);
        expect(response.json.selectedPaidActionCommand).toBe(response.json.payCommand);
        expect(response.json.exactIntentPayCommand).toContain(routePath);
        expect(response.json.firstPayCommand).toContain("/api/listing-roast");
        expect(response.json.firstPaidCommand).toBe(response.json.firstPayCommand);
        expect(response.json.firstAgentPaymentRequest.url).toContain("/api/listing-roast");
        expect(response.json.firstAgentPaymentRequest.maxAmountRequired).toBe("1000");
        expect(response.json.payCommandExamples.bareRoute).toBe(response.json.payCommand);
        expect(response.json.selectedActionKey).toBe(expectedByPath[routePath]);
        expect(response.json.selectedFirstPaidAction.path).toBe("/api/listing-roast");
        expect(response.json.exactIntentPaidAction.path).toBe(routePath);
        expect(response.json.selectedPaidSequence[0].use).toBe("indexedQuickScore");
        expect(response.json.selectedPaidSequence[0].action.path).toBe("/api/listing-roast");
        expect(response.json.selectedFirstPaidResponsePreview.route).toBe("/api/listing-roast");
        expect(response.json.buyerInstruction).toContain("start with GET /api/listing-roast");
        const expectedIntentRoutePath = routePath === "/api/marketplace-listing-conversion" ? "/api/marketplace-listing-conversion-api" : routePath;
        expect(response.json.intentRoutes[expectedByPath[routePath]].path).toBe(expectedIntentRoutePath);
        expect(response.json.paidResponsePreview.route).toBe(routePath);
        expect(response.json.paidResponsePreview.maxAmountRequired).toBe("1000");
        expect(response.json.paidResponsePreview.example.endpoint).toBe("listing-roast-quick-score");
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

  it("protects the x402 ping route with a one-tenth-cent x402 challenge", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/api/x402-ping?msg=hello");

      expect(response.status).toBe(402);
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.error).toBe("Payment required");
      expect(challenge.resource.url).toContain("/api/x402-ping");
      expect(challenge.resource.description).toContain("$0.001");
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.accepts[0].amount).toBe("1000");
      expect(response.json.error).toBe("payment_required");
      expect(response.json.selectedPaidAction.path).toBe("/api/x402-ping");
      expect(response.json.selectedPaidAction.maxAmountRequired).toBe("1000");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.instantScoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.indexedRoastGetValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.pingValidUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.roastValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.scoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.emptyDiscoveryProbes).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

  it("protects the x402 site audit route with a one-tenth-cent x402 challenge", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/api/x402-site-audit?url=https%3A%2F%2Flisting-roast-x402-service-production.up.railway.app%2Fapi%2Flisting-roast&query=listing%20roast");

      expect(response.status).toBe(402);
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.error).toBe("Payment required");
      expect(challenge.resource.url).toContain("/api/x402-site-audit");
      expect(challenge.resource.description).toContain("$0.001");
      expect(challenge.resource.description).toContain("Site Audit");
      expect(challenge.resource.description).toContain("paid API preflight");
      expect(challenge.resource.description).toContain("route health check");
      expect(challenge.resource.serviceName).toBe("Listing Roast x402");
      expect(challenge.resource.tags).toEqual([
        "x402",
        "x402 site audit",
        "x402 buyer prepay risk score",
        "score x402 endpoint before paying",
        "x402 marketplace SEO audit",
        "x402 seller growth checklist",
        "x402 listing SEO audit",
        "paid API preflight",
        "x402 route health check",
        "route health",
        "Bazaar search visibility",
        "stale Bazaar price"
      ]);
      expect(challenge.extensions.bazaar.info.input.queryParams.url).toBe("https://listing-roast-x402-service-production.up.railway.app/api/listing-roast");
      expect(challenge.extensions.bazaar.info.input.queryParams.base_url).toBe("https://listing-roast-x402-service-production.up.railway.app/api/listing-roast");
      expect(challenge.extensions.bazaar.info.input.queryParams.endpointUrl).toBe("https://listing-roast-x402-service-production.up.railway.app/api/listing-roast");
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.accepts[0].amount).toBe("1000");
      expect(response.json.error).toBe("payment_required");
      expect(response.json.selectedPaidAction.path).toBe("/api/x402-site-audit");
      expect(response.json.selectedPaidAction.maxAmountRequired).toBe("1000");
      expect(response.json.routeSelector.map((route) => route.use)).toContain("x402SiteAudit");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.siteAuditValidUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.discoveryAuditValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.instantScoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.pingValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.emptyDiscoveryProbes).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

  it("protects common paid API preflight aliases with the site audit x402 challenge", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      for (const path of ["/api/preflight", "/api/v1/preflight", "/preflight"]) {
        const response = await fetchJson(server, `${path}?url=https%3A%2F%2Flisting-roast-x402-service-production.up.railway.app%2Fapi%2Flisting-roast&query=paid%20API%20preflight`);
        expect(response.status).toBe(402);
        expect(response.headers.get("payment-required").length).toBeLessThan(7600);
        const challenge = readPaymentRequiredHeader(response.headers);
        expect(challenge.error).toBe("Payment required");
        expect(challenge.resource.url).toContain(path);
        expect(challenge.accepts[0].extra.resource).toContain(path);
        expect(challenge.resource.description).toContain("paid API preflight");
        expect(challenge.extensions.bazaar.info.input.queryParams.url).toBe("https://listing-roast-x402-service-production.up.railway.app/api/listing-roast");
        expect(challenge.extensions.bazaar.info.input.queryParams.base_url).toBe("https://listing-roast-x402-service-production.up.railway.app/api/listing-roast");
        expect(challenge.accepts[0].network).toBe("eip155:84532");
        expect(challenge.accepts[0].amount).toBe("1000");
        expect(response.json.resource.url).toContain(path);
        expect(response.json.accepts[0].extra.resource).toContain(path);
        expect(response.json.selectedPaidAction.path).toBe(path);
        expect(response.json.agentPaymentRequest.url).toContain(path);
        expect(response.json.selectedPaidAction.maxAmountRequired).toBe("1000");
      }

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(3);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(3);
      expect(cashRegister.json.signals.siteAuditValidUnpaidChallenges).toBe(3);
      expect(cashRegister.json.signals.discoveryAuditValidUnpaidChallenges).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

  it("protects exact buyer prepay audit aliases with the site audit x402 challenge", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const cases = [
        ["/api/x402-buyer-prepay-risk-score", "x402 buyer prepay risk score", "x402BuyerPrepayRiskScore"],
        ["/api/score-x402-endpoint-before-paying", "score x402 endpoint before paying", "scoreX402EndpointBeforePaying"],
        ["/api/x402-route-health-check", "x402 route health check", "x402RouteHealthCheck"],
        ["/api/x402-listing-rank-doctor", "x402 listing rank doctor", "x402ListingRankDoctor"]
      ];

      for (const [path, query, selectedActionKey] of cases) {
        const response = await fetchJson(server, `${path}?url=https%3A%2F%2Flisting-roast-x402-service-production.up.railway.app%2Fapi%2Flisting-roast&query=${encodeURIComponent(query)}`);
        expect(response.status).toBe(402);
        const challenge = readPaymentRequiredHeader(response.headers);
        expect(challenge.error).toBe("Payment required");
        expect(challenge.resource.url).toContain(path);
        expect(challenge.accepts[0].extra.resource).toContain(path);
        expect(challenge.resource.description.toLowerCase()).toContain("site-audit");
        expect(challenge.accepts[0].network).toBe("eip155:84532");
        expect(challenge.accepts[0].amount).toBe("1000");
        expect(response.json.selectedActionKey).toBe(selectedActionKey);
        expect(response.json.resource.url).toContain(path);
        expect(response.json.accepts[0].extra.resource).toContain(path);
        expect(response.json.selectedPaidAction.path).toBe(path);
        expect(response.json.agentPaymentRequest.url).toContain(path);
        expect(response.json.selectedPaidAction.maxAmountRequired).toBe("1000");
      }

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(4);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(4);
      expect(cashRegister.json.signals.siteAuditValidUnpaidChallenges).toBe(4);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

  it("protects the x402 discovery audit GET route with a one-tenth-cent x402 challenge", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/api/x402-discovery-audit?url=https%3A%2F%2Flisting-roast-x402-service-production.up.railway.app%2Fapi%2Flisting-roast&query=listing%20roast");

      expect(response.status).toBe(402);
      expect(response.headers.get("payment-required").length).toBeLessThan(7600);
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.error).toBe("Payment required");
      expect(challenge.resource.url).toContain("/api/x402-discovery-audit");
      expect(challenge.resource.description).toContain("$0.001");
      expect(challenge.resource.description).toContain("Discovery Audit Quick");
      expect(challenge.resource.description).toContain("route health");
      expect(challenge.extensions.bazaar.info.input.queryParams.url).toBe("https://listing-roast-x402-service-production.up.railway.app/api/listing-roast");
      expect(challenge.extensions.bazaar.info.input.queryParams.base_url).toBe("https://listing-roast-x402-service-production.up.railway.app/api/listing-roast");
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.accepts[0].amount).toBe("1000");
      expect(response.json.error).toBe("payment_required");
      expect(response.json.selectedPaidAction.path).toBe("/api/x402-discovery-audit");
      expect(response.json.selectedPaidAction.method).toBe("GET");
      expect(response.json.selectedPaidAction.maxAmountRequired).toBe("1000");
      expect(response.json.selectedPaidAction.command).toContain("/api/x402-discovery-audit");
      expect(response.json.selectedPaidAction.command).toContain("--max-amount 1000");
      expect(response.json.paidResponsePreview.route).toBe("/api/x402-discovery-audit");
      expect(response.json.paidResponsePreview.includes).toContain("search visibility");
      expect(response.json.paidResponsePreview.example.endpoint).toBe("x402-discovery-audit-quick");
      expect(response.json.paidResponsePreview.example.bazaarDiscovery).toBeDefined();
      expect(response.json.paidUsageProof).toContain("/api/paid-usage-proof");
      expect(response.json.x402Retry.route).toContain("/api/x402-discovery-audit");
      expect(response.json.x402Retry.paymentHeader).toBe("X-PAYMENT");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.siteAuditValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.discoveryAuditValidUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.scoreValidUnpaidChallenges).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

  it("protects the Agent402 route visibility alias with exact route metadata", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/api/agent402-route-visibility");

      expect(response.status).toBe(402);
      expect(response.headers.get("payment-required").length).toBeLessThan(7600);
      const challenge = readPaymentRequiredHeader(response.headers);
      const input = challenge.extensions.bazaar.info.input.queryParams;
      expect(challenge.error).toBe("Payment required");
      expect(challenge.resource.url).toContain("/api/agent402-route-visibility");
      expect(challenge.resource.description).toContain("Agent402 Route Visibility");
      expect(challenge.resource.tags).toContain("Agent402 route visibility");
      expect(input.url).toBe("http://localhost:8787/api/agent402-route-visibility");
      expect(input.base_url).toBe("http://localhost:8787/api/agent402-route-visibility");
      expect(input.endpointUrl).toBe("http://localhost:8787/api/agent402-route-visibility");
      expect(input.resource).toBe("http://localhost:8787/api/agent402-route-visibility");
      expect(input.searchQuery).toBe("Agent402 route visibility");
      expect(input.agent402Query).toBe("Agent402 route visibility");
      expect(challenge.extensions.bazaar.info.output.example.route).toBe("/api/agent402-route-visibility");
      expect(challenge.extensions.bazaar.info.output.example.endpoint).toBe("agent402-route-visibility-audit");
      expect(challenge.extensions.bazaar.info.output.example.agent402Route.topRank).toBe(1);
      expect(challenge.extensions.bazaar.info.output.example.agent402Route.matchedResult.route).toBe("/api/agent402-route-visibility");
      expect(challenge.extensions.bazaar.info.output.example.catalogRefresh.exactResourceUrl).toBe("http://localhost:8787/api/agent402-route-visibility");
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.accepts[0].amount).toBe("1000");
      expect(response.json.selectedActionKey).toBe("agent402RouteVisibility");
      expect(response.json.selectedPaidAction.path).toBe("/api/agent402-route-visibility");
      expect(response.json.selectedPaidAction.maxAmountRequired).toBe("1000");
      expect(response.json.paidResponsePreview.route).toBe("/api/agent402-route-visibility");
      expect(response.json.paidResponsePreview.example.endpoint).toBe("agent402-route-visibility-audit");
      expect(response.json.paidResponsePreview.example.agent402Route.matchedResult.route).toBe("/api/agent402-route-visibility");
      expect(response.json.paidResponsePreview.example.catalogRefresh.exactResourceUrl).toBe("http://localhost:8787/api/agent402-route-visibility");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.discoveryAuditValidUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.siteAuditValidUnpaidChallenges).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

  it("protects the x402 discovery audit route with a one-cent x402 challenge", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/api/x402-discovery-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpointUrl: "https://listing-roast-x402-service-production.up.railway.app/api/listing-roast",
          method: "GET",
          expectedAmount: "1000",
          expectedNetwork: "eip155:8453",
          searchQuery: "listing roast"
        })
      });

      expect(response.status).toBe(402);
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.error).toBe("Payment required");
      expect(challenge.resource.url).toContain("/api/x402-discovery-audit");
      expect(challenge.resource.description).toContain("Discovery Audit");
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.accepts[0].amount).toBe("10000");
      expect(response.json.error).toBe("payment_required");
      expect(response.json.selectedPaidAction.path).toBe("/api/x402-discovery-audit");
      expect(response.json.selectedPaidAction.maxAmountRequired).toBe("10000");
      expect(response.json.selectedPaidAction.command).toContain("/api/x402-discovery-audit");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.siteAuditValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.discoveryAuditValidUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.scoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.emptyDiscoveryProbes).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

  it("accepts buyer-style aliases before the paid x402 discovery audit challenge", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/api/x402-discovery-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceUrl: "https://listing-roast-x402-service-production.up.railway.app",
          expectedCheckoutPath: "/api/listing-roast",
          expectedPrice: "$0.001",
          network: "eip155:8453",
          goal: "verify x402 route health"
        })
      });

      expect(response.status).toBe(402);
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.accepts[0].amount).toBe("10000");
      expect(response.json.error).toBe("payment_required");
      expect(response.json.selectedPaidAction.path).toBe("/api/x402-discovery-audit");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.discoveryAuditValidUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.invalidRequests).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

  it("protects the score route with a half-cent x402 challenge", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/api/listing-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestExample)
      });

      expect(response.status).toBe(402);
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.error).toBe("Payment required");
      expect(challenge.resource.url).toContain("/api/listing-score");
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.accepts[0].amount).toBe("5000");
      const scoreBodySchema = challenge.extensions.bazaar.schema.properties.input.properties.body.properties;
      expect(scoreBodySchema.agentName.description).toBeUndefined();
      expect(scoreBodySchema.listingText.description).toBeUndefined();
      expect(scoreBodySchema.currentCheckoutPath.description).toBeUndefined();
      expect(scoreBodySchema.source.description).toBeUndefined();
      expect(challenge.extensions.bazaar.info.output.example.nextPaidAction.route).toContain("/api/full-listing-roast");
      expect(challenge.extensions.bazaar.info.output.example.nextPaidAction.method).toBe("GET");
      expect(challenge.extensions.bazaar.info.output.example.nextPaidAction.command).toBeUndefined();
      expect(challenge.extensions.bazaar.info.output.example.nextPaidAction.query.source).toBe("listing-score-upgrade");
      expect(challenge.extensions.bazaar.info.output.example.nextPaidAction.body).toBeUndefined();

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.roastValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.scoreValidUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.emptyDiscoveryProbes).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

  it("protects the direct full-roast GET route with a one-cent x402 challenge", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/api/full-listing-roast?agentName=Direct%20Roast%20API&listingText=A%20paid%20x402%20API%20with%20buyer-agent%20skip%20reasons%20top%20fixes%20and%20rewritten%20listing%20copy&targetBuyer=x402%20sellers&currentPrice=%240.01&currentCheckoutPath=%2Fapi%2Ffull-listing-roast&goal=Buy%20the%20full%20roast");

      expect(response.status).toBe(402);
      expect(response.headers.get("payment-required").length).toBeLessThan(7600);
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.error).toBe("Payment required");
      expect(challenge.resource.url).toContain("/api/full-listing-roast");
      expect(challenge.resource.description).toContain("Full Listing Roast");
      expect(challenge.resource.description).toContain("$0.01");
      expect(challenge.resource.description).toContain("top fixes");
      expect(challenge.accepts[0].amount).toBe("10000");
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.extensions.bazaar.info.input.queryParams.currentCheckoutPath).toBe("/api/full-listing-roast");
      expect(challenge.extensions.bazaar.info.output.example.price).toBe("$0.01");
      expect(challenge.extensions.bazaar.info.output.example.endpoint).toBe("listing-roast");
      expect(challenge.extensions.bazaar.info.output.example.verdict).toBeTruthy();
      expect(challenge.extensions.bazaar.info.output.example.buyerAgentSkipReasons).toEqual(expect.any(Array));
      expect(challenge.extensions.bazaar.info.output.example.topFixes).toEqual(expect.any(Array));
      expect(challenge.extensions.bazaar.info.output.example.topFixes[0]).toContain("buyer");
      expect(challenge.extensions.bazaar.info.output.example.rewrittenListing).toContain("/api/full-listing-roast");
      expect(challenge.extensions.bazaar.info.output.example.stopOrUpgrade).toBeTruthy();
      expect(challenge.extensions.bazaar.schema.properties.output.properties.example.properties.topFixes.items.type).toBe("string");
      expect(challenge.extensions.bazaar.schema.properties.output.properties.example.properties.rewrittenListing.type).toBe("string");
      expect(response.json.selectedPaidAction.path).toBe("/api/full-listing-roast");
      expect(response.json.selectedPaidAction.method).toBe("GET");
      expect(response.json.selectedPaidAction.maxAmountRequired).toBe("10000");
      expect(response.json.paidResponsePreview.includes).toContain("full rewrite");
      expect(response.json.paidResponsePreview.example.price).toBe("$0.01");
      expect(response.json.paidResponsePreview.example.topFixes).toEqual(expect.any(Array));
      expect(response.json.paidResponsePreview.example.rewrittenListing).toContain("/api/full-listing-roast");
      expect(response.json.buyerDecision.quickScoreNow).toBeUndefined();
      expect(response.json.buyerDecision.fullRoastNow.path).toBe("/api/full-listing-roast");
      expect(response.json.buyerDecision.fullRoastNow.selectedPaidPath).toBe("/api/full-listing-roast");
      expect(response.json.buyerDecision.fullRoastNow.maxAmountRequired).toBe("10000");
      expect(response.json.buyerDecision.fullRoastNow.whenToUse).toContain("full listing roast");
      expect(response.json.buyerDecision.instruction).toContain("pay fullRoastNow");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.fullRoastGetValidUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.roastValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.indexedRoastGetValidUnpaidChallenges).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

  it("accepts common buyer-agent aliases before the full-roast payment challenge", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/api/listing-roast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Alias x402 API",
          description: "A paid x402 API that helps sellers understand why buyer agents skip a paid route before paying. It returns skip reasons, top fixes, rewritten listing copy, and a paid launch recommendation.",
          buyer: "x402 sellers",
          price: "$0.01",
          url: "https://example.com/api/paid-route",
          objective: "Increase paid conversions"
        })
      });

      expect(response.status).toBe(402);
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.error).toBe("Payment required");
      expect(challenge.resource.url).toContain("/api/listing-roast");
      expect(challenge.resource.description).toContain("omitted bodies use safe defaults");
      expect(challenge.accepts[0].amount).toBe("10000");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.roastValidUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.invalidRequests).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

  it("rejects invalid paid-route requests before asking for payment", async () => {
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/api/listing-roast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName: "Bad" })
      });

      expect(response.status).toBe(400);
      expect(response.headers.get("payment-required")).toBeNull();
      expect(response.json.error).toBe("invalid_request");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.invalidRequests).toBe(1);
      expect(cashRegister.json.signals.unpaidChallenges).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("lets empty discovery probes reach the x402 challenge", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/api/listing-roast", {
        method: "POST"
      });

      expect(response.status).toBe(402);
      expect(response.headers.get("payment-required")).toBeTruthy();
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.resource.description).toContain("Custom JSON body optional");
      expect(challenge.resource.description).toContain("omitted bodies use safe defaults");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.emptyDiscoveryProbes).toBe(1);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);
});
