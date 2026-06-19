import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { getCashRegister, recordPaidCompletion } from "../src/cashRegister.js";
import { requestExample } from "../src/roast.js";

let testDataDir;

beforeEach(async () => {
  testDataDir = await mkdtemp(path.join(os.tmpdir(), "listing-roast-test-"));
  process.env.DATA_DIR = testDataDir;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.DATA_DIR;
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
  it("serves public metadata without payment", async () => {
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const health = await fetchJson(server, "/health");
      expect(health.status).toBe(200);
      expect(health.json.paidRoute).toBe("/api/listing-roast");
      expect(health.headers.get("link")).toContain("/x402.json");
      expect(health.headers.get("link")).toContain("/api/pay-now");
      expect(health.headers.get("link")).toContain("/api/pricing");
      expect(health.headers.get("link")).toContain("/api/find");
      expect(health.headers.get("link")).toContain("/api/route");
      expect(health.headers.get("link")).toContain("/openapi.json");
      expect(health.headers.get("link")).toContain("/.well-known/openapi.json");
      expect(health.headers.get("link")).toContain("/.well-known/agent-card.json");
      expect(health.headers.get("link")).toContain("/.well-known/ai-plugin.json");
      expect(health.headers.get("link")).toContain("/.well-known/api-catalog");
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
      expect(health.headers.get("link")).toContain("/.well-known/mcp/server-card.json");

      const home = await fetchJson(server, "/");
      expect(home.status).toBe(200);
      expect(home.headers.get("link")).toContain("/.well-known/x402.json");
      expect(home.text).toContain("first step for marketplace listing quality, paid API listing quality, and buyer-agent skip-reason searches");
      expect(home.text).toContain("Recommended paid sequence");
      expect(home.text).toContain("GET /api/listing-roast");
      expect(home.text).toContain("POST /api/listing-roast");
      expect(home.text).toContain("Copy $0.001 indexed GET command");
      expect(home.text).toContain("Copy agent-listing command");
      expect(home.text).toContain("Agent listing conversion command");
      expect(home.text).toContain("/api/agent-listing-conversion");
      expect(home.text).toContain("Copy instant score command");
      expect(home.text).toContain("Preferred indexed listing-roast GET command");
      expect(home.text).toContain("Copy x402 ping command");
      expect(home.text).toContain("Copy $0.001 site audit command");
      expect(home.text).toContain("Copy $0.001 discovery audit command");
      expect(home.text).toContain("Copy full audit command");
      expect(home.text).toContain("Copy $0.005 score command");
      expect(home.text).toContain("Copy $0.01 roast command");
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
      expect(structuredData.hasOfferCatalog.itemListElement[0].name).toBe("Indexed listing-roast quick score");
      expect(structuredData.hasOfferCatalog.itemListElement[0].url).toBe("http://localhost:8787/api/listing-roast");
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
      expect(home.text).toContain("/agent-listing-conversion");
      expect(home.text).toContain("/x402-discovery-audit");
      expect(home.text).toContain("/x402-site-audit");

      const paidApiListingQuality = await fetchJson(server, "/paid-api-listing-quality");
      expect(paidApiListingQuality.status).toBe(200);
      expect(paidApiListingQuality.text).toContain("Paid API listing quality score for x402 services");
      expect(paidApiListingQuality.text).toContain("/api/listing-roast");
      expect(paidApiListingQuality.text).toContain("--max-amount 1000");
      expect(paidApiListingQuality.text).toContain("This page does not call a paid route");

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
      expect(builder.text).toContain("Preferred indexed GET command");
      expect(builder.text).toContain("Copy agent-listing command");
      expect(builder.text).toContain("/api/agent-listing-conversion");
      expect(builder.text).toContain("/api/listing-score");
      expect(builder.text).toContain("/api/x402-ping");
      expect(builder.text).toContain("/api/x402-site-audit");
      expect(builder.text).toContain("builderCommandBuilds");

      const sample = await fetchJson(server, "/sample");
      expect(sample.status).toBe(200);
      expect(sample.text).toContain("Sample the score, then start with the $0.001 indexed route.");
      expect(sample.text).toContain("Copy $0.001 indexed GET command");
      expect(sample.text).toContain("Indexed GET command");
      expect(sample.text).toContain("/api/listing-roast");
      expect(sample.text).toContain("/api/listing-score");
      expect(sample.text).toContain("Build your command");

      const sampleScore = await fetchJson(server, "/api/sample-score");
      expect(sampleScore.status).toBe(200);
      expect(sampleScore.json.price).toBe("$0.005");
      expect(sampleScore.json.command).toContain("--max-amount 5000");
      expect(sampleScore.json.output.endpoint).toBe("listing-score");
      expect(sampleScore.json.output.nextPaidAction.maxAmountRequired).toBe("10000");
      expect(sampleScore.json.output.nextPaidAction.path).toBe("/api/listing-roast");
      expect(sampleScore.json.output.nextPaidAction.route).toContain("/api/listing-roast");
      expect(sampleScore.json.output.nextPaidAction.command).toContain("--max-amount 10000");

      const schema = await fetchJson(server, "/api/schema");
      expect(schema.status).toBe(200);
      expect(schema.json.service.price).toBe("$0.01");

      const scoreSchema = await fetchJson(server, "/api/score-schema");
      expect(scoreSchema.status).toBe(200);
      expect(scoreSchema.json.service.price).toBe("$0.005");

      const mcp = await fetchJson(server, "/.well-known/mcp.json");
      expect(mcp.status).toBe(200);
      expect(mcp.json.builder).toContain("/builder");
      expect(mcp.json.iconUrl).toContain("/icon.svg");
      expect(mcp.json.openApi).toContain("/openapi.json");
      expect(mcp.json.openApiAliases[0]).toContain("/.well-known/openapi.json");
      expect(mcp.json.llms).toContain("/llms.txt");
      expect(mcp.json.llmsAliases[0]).toContain("/.well-known/llms.txt");
      expect(mcp.json.x402Manifest).toContain("/x402.json");
      expect(mcp.json.agentCard).toContain("/.well-known/agent-card.json");
      expect(mcp.json.agentCardAliases[0]).toContain("/.well-known/agent.json");
      expect(mcp.json.aiPlugin).toContain("/.well-known/ai-plugin.json");
      expect(mcp.json.apiCatalog).toContain("/.well-known/api-catalog");
      expect(mcp.json.agentTools).toContain("/.well-known/agent-tools.json");
      expect(mcp.json.agentSkills).toContain("/.well-known/agent-skills/index.json");
      expect(mcp.json.agentSkill).toContain("/.well-known/agent-skills/listing-roast-x402/SKILL.md");
      expect(mcp.json.llmsFull).toContain("/llms-full.txt");
      expect(mcp.json.llmsFullAliases[0]).toContain("/.well-known/llms-full.txt");
      expect(mcp.json.markdown).toContain("/index.md");
      expect(mcp.json.mcpAliases[0]).toContain("/.well-known/mcp");
      expect(mcp.json.mcpServerCard).toContain("/.well-known/mcp/server-card.json");
      expect(mcp.json.payNow).toContain("/api/pay-now");
      expect(mcp.json.payNowExamples.skipReasons.selectedActionKey).toBe("indexedQuickScore");
      expect(mcp.json.payNowExamples.discoveryAudit.selectedActionKey).toBe("discoveryAuditQuick");
      expect(mcp.json.payNowExamples.fullRoast.maxAmountRequired).toBe("10000");
      expect(mcp.json.cashRegister).toContain("/api/cash-register");
      expect(mcp.json.paidUsageProof.paidCompletions).toBe(0);
      expect(mcp.json.paidUsageProof.estimatedGrossRevenueUsd).toBe("0.00");
      expect(mcp.json.paidUsageProof.noSpend).toBe(true);
      expect(mcp.json.settlementProof.evidenceFields).toContain("receiverWallet.usdcBalance");
      expect(mcp.json.pricing).toContain("/api/pricing");
      expect(mcp.json.find).toContain("/api/find");
      expect(mcp.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(mcp.json.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(mcp.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(mcp.json.recommendedPaidSequence[1].use).toBe("fullRoast");
      expect(mcp.json.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(mcp.json.payment.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(mcp.json.payment.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(mcp.json.payment.payNowExamples.discoveryAudit.route).toContain("/api/x402-discovery-audit");
      expect(mcp.json.payment.settlementProof.cashRegister).toContain("/api/cash-register");
      expect(mcp.json.payment.paidUsageProof.cashRegister).toContain("/api/cash-register");
      expect(mcp.json.keywords).toContain("marketplace listing score");
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
      expect(mcp.json.tools[9].command).toContain("/api/x402-discovery-audit");
      expect(mcp.json.tools[9].command).toContain("--max-amount 1000");
      expect(mcp.json.tools[10].command).toContain("/api/x402-discovery-audit");
      expect(mcp.json.tools[10].command).toContain("--max-amount 10000");
      expect(mcp.json.tools[0].payment.maxAmountRequired).toBe("1000");
      expect(mcp.json.tools[0].payment.preferredFirstPaidAction).toBe(true);
      expect(mcp.json.tools[1].payment.maxAmountRequired).toBe("1000");
      expect(mcp.json.tools[1].payment.preferredFirstPaidAction).toBe(false);
      expect(mcp.json.tools.map((tool) => tool.path)).toEqual(["/api/listing-roast", "/api", "/api/v1", "/v1", "/api/instant-listing-score", "/api/x402-marketplace-conversion", "/api/agent-listing-conversion", "/api/x402-ping", "/api/x402-site-audit", "/api/x402-discovery-audit", "/api/x402-discovery-audit", "/api/listing-score", "/api/listing-roast"]);

      const mcpAlias = await fetchJson(server, "/.well-known/mcp");
      expect(mcpAlias.status).toBe(200);
      expect(mcpAlias.json.tools[0].path).toBe("/api/listing-roast");

      const mcpServerAlias = await fetchJson(server, "/.well-known/mcp-server");
      expect(mcpServerAlias.status).toBe(200);
      expect(mcpServerAlias.json.payNow).toContain("/api/pay-now");

      const mcpServerCard = await fetchJson(server, "/.well-known/mcp/server-card.json");
      expect(mcpServerCard.status).toBe(200);
      expect(mcpServerCard.json.serverInfo.name).toBe("Listing Roast x402");
      expect(mcpServerCard.json.transport).toBe("http");
      expect(mcpServerCard.json.payment.preferredFirstPaidAction.maxAmountRequired).toBe("1000");
      expect(mcpServerCard.json.payment.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(mcpServerCard.json.payment.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(mcpServerCard.json.payment.payNowExamples.skipReasons.route).toContain("/api/listing-roast");
      expect(mcpServerCard.json.payment.settlementProof.evidenceFields).toContain("paidCompletions");
      expect(mcpServerCard.json.payment.paidUsageProof.paidCompletions).toBe(0);
      expect(mcpServerCard.json.iconUrl).toContain("/icon.svg");
      expect(mcpServerCard.json.links.cashRegister).toContain("/api/cash-register");
      expect(mcpServerCard.json.links.llmsFull).toContain("/llms-full.txt");
      expect(mcpServerCard.json.links.llmsAliases[0]).toContain("/.well-known/llms.txt");
      expect(mcpServerCard.json.links.llmsFullAliases[0]).toContain("/.well-known/llms-full.txt");

      const x402Manifest = await fetchJson(server, "/x402.json");
      expect(x402Manifest.status).toBe(200);
      expectFreshDiscoveryHeaders(x402Manifest.headers);
      expect(x402Manifest.json.name).toBe("Listing Roast x402");
      expect(x402Manifest.json.serviceName).toBe("Listing Roast x402");
      expect(x402Manifest.json.displayName).toBe("Listing Roast x402");
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
      expect(x402Manifest.json.payment.x402.primaryNetwork).toBe("base");
      expect(x402Manifest.json.payment.x402.network).toBe("eip155:84532");
      expect(x402Manifest.json.payment.x402.asset).toBe("USDC");
      expect(x402Manifest.json.capabilities.tools).toBe(14);
      expect(x402Manifest.json.baseUrl).toBe("http://localhost:8787");
      expect(x402Manifest.json.keywords).toContain("paid API listing");
      expect(x402Manifest.json.keywords).toContain("x402 bazaar discovery audit");
      expect(x402Manifest.json.openApiAliases[0]).toContain("/.well-known/openapi.json");
      expect(x402Manifest.json.agentCard).toContain("/.well-known/agent-card.json");
      expect(x402Manifest.json.agentCardAliases[0]).toContain("/.well-known/agent.json");
      expect(x402Manifest.json.aiPlugin).toContain("/.well-known/ai-plugin.json");
      expect(x402Manifest.json.apiCatalog).toContain("/.well-known/api-catalog");
      expect(x402Manifest.json.agentTools).toContain("/.well-known/agent-tools.json");
      expect(x402Manifest.json.agentSkills).toContain("/.well-known/agent-skills/index.json");
      expect(x402Manifest.json.payNow).toContain("/api/pay-now");
      expect(x402Manifest.json.payNowExamples.skipReasons.selectedActionKey).toBe("indexedQuickScore");
      expect(x402Manifest.json.payNowExamples.discoveryAudit.selectedActionKey).toBe("discoveryAuditQuick");
      expect(x402Manifest.json.payNowExamples.fullRoast.maxAmountRequired).toBe("10000");
      expect(x402Manifest.json.cashRegister).toContain("/api/cash-register");
      expect(x402Manifest.json.paidUsageProof.paidCompletions).toBe(0);
      expect(x402Manifest.json.paidUsageProof.estimatedGrossRevenueUsd).toBe("0.00");
      expect(x402Manifest.json.paidUsageProof.cashRegister).toContain("/api/cash-register");
      expect(x402Manifest.json.paidUsageProof.walletEvidenceFields).toContain("receiverWallet.usdcUnits");
      expect(x402Manifest.json.paidUsageProof.noSpend).toBe(true);
      expect(x402Manifest.json.settlementProof.evidenceFields).toContain("receiverWallet.usdcUnits");
      expect(x402Manifest.json.pricing).toContain("/api/pricing");
      expect(x402Manifest.json.find).toContain("/api/find");
      expect(x402Manifest.json.route).toContain("/api/route");
      expect(x402Manifest.json.localDiscovery.resources).toContain("/v2/x402/discovery/resources");
      expect(x402Manifest.json.localDiscovery.search).toContain("/v2/x402/discovery/search");
      expect(x402Manifest.json.localDiscovery.merchant).toContain("/v2/x402/discovery/merchant");
      expect(x402Manifest.json.localDiscovery.searchExamples.find((example) => example.query === "buyer-agent skip reasons").expectedFirstPath).toBe("/api/listing-roast");
      expect(x402Manifest.json.localDiscovery.searchExamples.find((example) => example.query === "x402 discovery audit").expectedFirstPath).toBe("/api/x402-discovery-audit");
      expect(x402Manifest.json.localDiscovery.searchExamples.find((example) => example.query === "paid API preflight").searchUrl).toContain("/v2/x402/discovery/search?query=paid%20API%20preflight");
      expect(x402Manifest.json.localDiscovery.aliases.resources).toContain("http://localhost:8787/.well-known/x402/discovery/resources");
      expect(x402Manifest.json.aliases.some((url) => url.endsWith("/.well-known/x402"))).toBe(true);
      expect(x402Manifest.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(x402Manifest.json.preferredFirstPaidAction.maxAmountRequired).toBe("1000");
      expect(x402Manifest.json.recommendedFirstPaidAction.route).toContain("/api/listing-roast");
      expect(x402Manifest.json.recommendedFirstPaidAction.maxAmountRequired).toBe("1000");
      expect(x402Manifest.json.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(x402Manifest.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(x402Manifest.json.recommendedPaidSequence[1].use).toBe("fullRoast");
      expect(x402Manifest.json.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(x402Manifest.json.intentLandingPages.map((page) => page.path)).toEqual(["/paid-api-listing-quality", "/agent-listing-conversion", "/x402-discovery-audit", "/x402-site-audit"]);
      expect(x402Manifest.json.intentLandingPages[0].primaryPaidAction.path).toBe("/api/listing-roast");
      expect(x402Manifest.json.intentLandingPages[2].primaryPaidAction.path).toBe("/api/x402-discovery-audit");
      expect(x402Manifest.json.intentLandingPages[2].primaryPaidAction.method).toBe("GET");
      expect(x402Manifest.json.intentLandingPages[2].primaryPaidAction.maxAmountRequired).toBe("1000");
      expect(x402Manifest.json.resources.map((resource) => resource.id)).toEqual(["indexed_roast_quick_score", "directory_root_post", "api_entry", "api_v1_entry", "v1_entry", "instant_listing_score", "x402_marketplace_conversion_score", "agent_listing_conversion_score", "x402_ping", "x402_site_audit", "x402_discovery_audit_quick", "x402_discovery_audit", "listing_score", "listing_roast"]);
      expect(x402Manifest.json.resources.map((resource) => resource.path)).toEqual(["/api/listing-roast", "/", "/api", "/api/v1", "/v1", "/api/instant-listing-score", "/api/x402-marketplace-conversion", "/api/agent-listing-conversion", "/api/x402-ping", "/api/x402-site-audit", "/api/x402-discovery-audit", "/api/x402-discovery-audit", "/api/listing-score", "/api/listing-roast"]);
      const resourcesById = Object.fromEntries(x402Manifest.json.resources.map((resource) => [resource.id, resource]));
      expect(x402Manifest.json.resources[0].name).toBe("marketplace_listing_score_paid_api_listing_quality_score");
      expect(x402Manifest.json.resources[0].serviceName).toBe("Listing Roast x402");
      expect(x402Manifest.json.resources[0].tags).toEqual([
        "x402",
        "paid API listing quality score",
        "paid API listing quality",
        "marketplace listing score",
        "buyer-agent skip reasons",
        "buyer agent skip reasons",
        "agent-service listing score",
        "x402 site audit",
        "x402 discovery audit",
        "paid API preflight",
        "agent service clarity",
        "route health"
      ]);
      expect(x402Manifest.json.resources[0].description).toContain("x402 site audit starter");
      expect(x402Manifest.json.resources[0].description).toContain("paid API preflight");
      expect(x402Manifest.json.resources[0].description).toContain("marketplace listing score");
      expect(x402Manifest.json.resources[0].keywords).toContain("listing roast");
      expect(x402Manifest.json.resources[0].keywords).toContain("buyer-agent skip reasons");
      expect(x402Manifest.json.resources[0].keywords).toContain("agent service listing clarity");
      expect(x402Manifest.json.resources[0].keywords).toContain("x402 site audit");
      expect(x402Manifest.json.resources[0].keywords).toContain("x402 discovery audit");
      expect(x402Manifest.json.resources[0].keywords).toContain("paid API preflight");
      expect(x402Manifest.json.resources[0].keywords).toContain("x402 route health check");
      expect(x402Manifest.json.resources[0].keywords).toContain("bazaar search visibility");
      expect(x402Manifest.json.resources[0].description).toContain("stale pricing triage");
      expect(x402Manifest.json.resources[0].price).toBe("$0.001");
      expect(x402Manifest.json.resources[0].maxAmountRequired).toBe("1000");
      expect(resourcesById.directory_root_post.price).toBe("$0.001");
      expect(resourcesById.directory_root_post.method).toBe("POST");
      expect(resourcesById.directory_root_post.path).toBe("/");
      expect(resourcesById.directory_root_post.maxAmountRequired).toBe("1000");
      expect(resourcesById.directory_root_post.description).toContain("directory handoff");
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
      expect(resourcesById.x402_ping.price).toBe("$0.001");
      expect(resourcesById.x402_ping.keywords).toContain("x402 ping");
      expect(resourcesById.x402_ping.maxAmountRequired).toBe("1000");
      expect(resourcesById.x402_site_audit.price).toBe("$0.001");
      expect(resourcesById.x402_site_audit.tags).toEqual([
        "x402",
        "discovery audit",
        "x402 seller discoverability",
        "fix x402 Bazaar listing",
        "x402 catalog metadata quality",
        "x402 listing SEO audit",
        "x402 listing rank doctor",
        "x402 seller growth checklist",
        "x402 seller intelligence",
        "x402 marketplace SEO audit",
        "paid API preflight",
        "route health",
        "Bazaar visibility",
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
      expect(resourcesById.x402_discovery_audit_quick.price).toBe("$0.001");
      expect(resourcesById.x402_discovery_audit_quick.method).toBe("GET");
      expect(resourcesById.x402_discovery_audit_quick.path).toBe("/api/x402-discovery-audit");
      expect(resourcesById.x402_discovery_audit_quick.keywords).toContain("x402 discovery audit");
      expect(resourcesById.x402_discovery_audit_quick.maxAmountRequired).toBe("1000");
      expect(resourcesById.x402_discovery_audit.price).toBe("$0.01");
      expect(resourcesById.x402_discovery_audit.keywords).toContain("x402 bazaar discovery audit");
      expect(resourcesById.x402_discovery_audit.maxAmountRequired).toBe("10000");
      expect(resourcesById.listing_score.price).toBe("$0.005");
      expect(resourcesById.listing_score.maxAmountRequired).toBe("5000");
      expect(resourcesById.listing_roast.price).toBe("$0.01");
      expect(resourcesById.listing_roast.maxAmountRequired).toBe("10000");

      const wellKnownX402Manifest = await fetchJson(server, "/.well-known/x402.json");
      expect(wellKnownX402Manifest.status).toBe(200);
      expectFreshDiscoveryHeaders(wellKnownX402Manifest.headers);
      expect(wellKnownX402Manifest.json.resources[0].command).toContain("--max-amount 1000");
      expect(wellKnownX402Manifest.json.resources[0].command).toContain("/api/listing-roast");
      const wellKnownById = Object.fromEntries(wellKnownX402Manifest.json.resources.map((resource) => [resource.id, resource]));
      expect(wellKnownById.directory_root_post.command).toContain("-X POST");
      expect(wellKnownById.directory_root_post.command).toContain("--max-amount 1000");
      expect(wellKnownById.directory_root_post.command).not.toContain("-d ");
      expect(wellKnownById.api_entry.command).toContain("/api");
      expect(wellKnownById.api_v1_entry.command).toContain("/api/v1");
      expect(wellKnownById.v1_entry.command).toContain("/v1");
      expect(wellKnownById.instant_listing_score.command).toContain("/api/instant-listing-score");
      expect(wellKnownById.x402_marketplace_conversion_score.command).toContain("/api/x402-marketplace-conversion");
      expect(wellKnownById.agent_listing_conversion_score.command).toContain("/api/agent-listing-conversion");
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

      const agentTools = await fetchJson(server, "/.well-known/agent-tools.json");
      expect(agentTools.status).toBe(200);
      expectFreshDiscoveryHeaders(agentTools.headers);
      expect(agentTools.json.name).toBe("Listing Roast x402");
      expect(agentTools.json.serviceName).toBe("Listing Roast x402");
      expect(agentTools.json.provider_url).toBe("http://localhost:8787");
      expect(agentTools.json.iconUrl).toBe("http://localhost:8787/icon.svg");
      expect(agentTools.json.icon_url).toBe("http://localhost:8787/icon.svg");
      expect(agentTools.json.category).toBe("paid-api-listing");
      expect(agentTools.json.tags).toContain("marketplace listing score");
      expect(agentTools.json.openapi).toBe("/openapi.json");
      expect(agentTools.json.x402_catalog).toBe("/x402.json");
      expect(agentTools.json.preferred_first_paid_action.path).toBe("/api/listing-roast");
      expect(agentTools.json.preferred_first_paid_action.maxAmountRequired).toBe("1000");
      expect(agentTools.json.intent_landing_pages.map((page) => page.path)).toEqual(["/paid-api-listing-quality", "/agent-listing-conversion", "/x402-discovery-audit", "/x402-site-audit"]);
      expect(agentTools.json.intent_landing_pages[1].primaryPaidAction.path).toBe("/api/agent-listing-conversion");
      expect(agentTools.json.tools.map((tool) => tool.name)).toContain("indexed_roast_quick_score");
      expect(agentTools.json.tools[0].x402_route).toBe("/api/listing-roast");
      expect(agentTools.json.tools[0].price_usd).toBe("0.001");
      expect(agentTools.json.tools[0].command).toContain("--max-amount 1000");
      expect(agentTools.json.tools.find((tool) => tool.name === "directory_root_post").x402_route).toBe("/");
      expect(agentTools.json.tools.find((tool) => tool.name === "directory_root_post").command).not.toContain("-d ");
      expect(agentTools.json.tools.find((tool) => tool.name === "x402_site_audit").keywords).toContain("x402 route health check");
      expect(agentTools.json.tools.find((tool) => tool.name === "x402_discovery_audit_quick").max_amount_required).toBe("1000");
      expect(agentTools.json.tools.find((tool) => tool.name === "x402_discovery_audit").max_amount_required).toBe("10000");

      const agentCard = await fetchJson(server, "/.well-known/agent-card.json");
      expect(agentCard.status).toBe(200);
      expectFreshDiscoveryHeaders(agentCard.headers);
      expect(agentCard.json.protocolVersion).toBe("0.3.0");
      expect(agentCard.json.name).toBe("Listing Roast x402");
      expect(agentCard.json.url).toContain("/api/listing-roast");
      expect(agentCard.json.iconUrl).toContain("/icon.svg");
      expect(agentCard.json.preferredTransport).toBe("HTTP+JSON");
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
      expect(agentCard.json.skills[0].examples[0]).toContain("/api/listing-roast");
      expect(agentCard.json.skills[0].metadata.maxAmountRequired).toBe("1000");
      expect(agentCard.json.skills.find((skill) => skill.id === "x402-discovery-audit-quick").examples[0]).toContain("/api/x402-discovery-audit");
      expect(agentCard.json.skills.find((skill) => skill.id === "x402-discovery-audit-quick").metadata.maxAmountRequired).toBe("1000");
      expect(agentCard.json.skills.find((skill) => skill.id === "x402-discovery-audit").examples[0]).toContain("/api/x402-discovery-audit");
      expect(agentCard.json.skills.find((skill) => skill.id === "x402-discovery-audit").metadata.maxAmountRequired).toBe("10000");
      expect(agentCard.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(agentCard.json.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(agentCard.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(agentCard.json.recommendedPaidSequence[1].use).toBe("fullRoast");
      expect(agentCard.json.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(agentCard.json.payNowExamples.discoveryAudit.selectedActionKey).toBe("discoveryAuditQuick");
      expect(agentCard.json.cashRegister).toContain("/api/cash-register");
      expect(agentCard.json.paidUsageProof.paidCompletions).toBe(0);
      expect(agentCard.json.metadata.x402Manifest).toContain("/x402.json");
      expect(agentCard.json.metadata.iconUrl).toContain("/icon.svg");
      expect(agentCard.json.metadata.llmsAliases[0]).toContain("/.well-known/llms.txt");
      expect(agentCard.json.metadata.agentSkills).toContain("/.well-known/agent-skills/index.json");
      expect(agentCard.json.metadata.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(agentCard.json.metadata.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(agentCard.json.metadata.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(agentCard.json.metadata.payNowExamples.fullRoast.method).toBe("POST");
      expect(agentCard.json.metadata.paidUsageProof.estimatedGrossRevenueUsd).toBe("0.00");
      expect(agentCard.json.metadata.settlementProof.evidenceFields).toContain("estimatedGrossRevenueUsd");
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
      expect(aiPlugin.json.description_for_model).toContain("x402 payment");
      expect(aiPlugin.json.description_for_model).toContain("/api/listing-roast");
      expect(aiPlugin.json.auth.type).toBe("none");
      expect(aiPlugin.json.api.type).toBe("openapi");
      expect(aiPlugin.json.api.url).toContain("/.well-known/openapi.json");
      expect(aiPlugin.json.x_listing_roast.agentSkills).toContain("/.well-known/agent-skills/index.json");
      expect(aiPlugin.json.x_listing_roast.recommendedFirstPaidAction.maxAmountRequired).toBe("1000");
      expect(aiPlugin.json.x_listing_roast.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(aiPlugin.json.x_listing_roast.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(aiPlugin.json.x_listing_roast.recommendedPaidSequence[1].use).toBe("fullRoast");
      expect(aiPlugin.json.x_listing_roast.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(aiPlugin.json.x_listing_roast.payNowExamples.skipReasons.selectedActionKey).toBe("indexedQuickScore");
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
      expect(apiCatalog.json.linkset[0].item[1].href).toBe("http://localhost:8787/");
      expect(apiCatalog.json.linkset[0].item[1].title).toContain("root directory handoff");
      expect(apiCatalog.json.linkset[0].item.map((item) => item.href)).toContain("http://localhost:8787/api/v1");
      expect(apiCatalog.json.linkset[0].item.map((item) => item.href)).toContain("http://localhost:8787/v1");
      expect(apiCatalog.json.linkset[0].item.map((item) => item.href)).toContain("http://localhost:8787/api/listing-roast");
      expect(apiCatalog.json.linkset[0].item.map((item) => item.href)).toContain("http://localhost:8787/api/agent-listing-conversion");
      expect(apiCatalog.json.linkset[0].item.map((item) => item.href)).toContain("http://localhost:8787/api/pricing");
      expect(apiCatalog.json.linkset[0].item.map((item) => item.href)).toContain("http://localhost:8787/api/find");
      expect(apiCatalog.json.linkset[0].item.map((item) => item.href)).toContain("http://localhost:8787/api/route");
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
      expect(apiCatalog.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/api/cash-register");
      expect(apiCatalog.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/v2/x402/discovery/resources");
      expect(apiCatalog.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/v2/x402/discovery/search");
      expect(apiCatalog.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/v2/x402/discovery/merchant");
      expect(apiCatalog.json.linkset[0].status[0].href).toContain("/health");
      expect(apiCatalog.json.linkset[0].status.map((item) => item.href)).toContain("http://localhost:8787/api/cash-register");

      const agentSkillsHead = await fetch(`http://127.0.0.1:${server.address().port}/.well-known/agent-skills/index.json`, { method: "HEAD" });
      expect(agentSkillsHead.status).toBe(200);
      expectFreshDiscoveryHeaders(agentSkillsHead.headers);
      expect(agentSkillsHead.headers.get("content-type")).toContain("application/json");

      const agentSkills = await fetchJson(server, "/.well-known/agent-skills/index.json");
      expect(agentSkills.status).toBe(200);
      expectFreshDiscoveryHeaders(agentSkills.headers);
      expect(agentSkills.headers.get("access-control-allow-origin")).toBe("*");
      expect(agentSkills.json.$schema).toBe("https://schemas.agentskills.io/discovery/0.2.0/schema.json");
      expect(agentSkills.json.skills[0].name).toBe("listing-roast-x402");
      expect(agentSkills.json.skills[0].type).toBe("skill-md");
      expect(agentSkills.json.skills[0].url).toContain("/.well-known/agent-skills/listing-roast-x402/SKILL.md");
      expect(agentSkills.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(agentSkills.json.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(agentSkills.json.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
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
      expect(agentSkill.text).toContain("Full roast command");
      expect(agentSkill.text).toContain("/api/listing-roast");
      expect(agentSkill.text).toContain("/api/agent-listing-conversion");
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
      expect(examples.json.payNowUrl).toContain("/api/pay-now");
      expect(examples.json.payNowExamples.skipReasons.selectedActionKey).toBe("indexedQuickScore");
      expect(examples.json.payNowExamples.skipReasons.route).toContain("/api/listing-roast");
      expect(examples.json.payNowExamples.discoveryAudit.selectedActionKey).toBe("discoveryAuditQuick");
      expect(examples.json.payNowExamples.discoveryAudit.route).toContain("/api/x402-discovery-audit");
      expect(examples.json.payNowExamples.fullRoast.selectedActionKey).toBe("fullRoast");
      expect(examples.json.payNowExamples.fullRoast.maxAmountRequired).toBe("10000");
      expect(examples.json.pricing).toContain("/api/pricing");
      expect(examples.json.find).toContain("/api/find");
      expect(examples.json.route).toContain("/api/route");
      expect(examples.json.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(examples.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(examples.json.recommendedPaidSequence[1].use).toBe("fullRoast");
      expect(examples.json.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(examples.json.localDiscovery.resources).toContain("/v2/x402/discovery/resources");
      expect(examples.json.localDiscovery.searchExample.resources[0].metadata.path).toBe("/api/x402-discovery-audit");
      expect(examples.json.localDiscovery.merchantExample.resources).toHaveLength(14);
      expect(examples.json.pricingCatalog.count).toBe(14);
      expect(examples.json.pricingCatalog.routes[0].path).toBe("/api/listing-roast");
      expect(examples.json.findExamples.discoveryAudit.recommended.path).toBe("/api/x402-discovery-audit");
      expect(examples.json.findExamples.skipReasons.recommended.path).toBe("/api/listing-roast");
      expect(examples.json.findExamples.skipReasons.alternatives.map((route) => route.path)).toContain("/api/agent-listing-conversion");
      expect(examples.json.findExamples.customScore.recommended.id).toBe("listing_score");
      expect(examples.json.findExamples.customScore.recommended.method).toBe("POST");
      expect(examples.json.findExamples.fullRewrite.recommended.id).toBe("listing_roast");
      expect(examples.json.routeExamples.discoveryAudit.results[0].path).toBe("/api/x402-discovery-audit");
      expect(examples.json.routeExamples.skipReasons.results[0].path).toBe("/api/listing-roast");
      expect(examples.json.routeExamples.skipReasons.results.map((route) => route.path)).toContain("/api/agent-listing-conversion");
      expect(examples.json.routeExamples.customScore.results[0].id).toBe("listing_score");
      expect(examples.json.routeExamples.customScore.results[0].method).toBe("POST");
      expect(examples.json.routeExamples.fullRewrite.results[0].path).toBe("/api/listing-roast");
      expect(examples.json.payNow.route).toContain("/api/listing-roast");
      expect(examples.json.payNow.command).toContain("--max-amount 1000");
      expect(examples.json.payNow.noSpendNote).toContain("Fetching this endpoint is free");
      expect(examples.json.apiEntryRoute).toContain("/api");
      expect(examples.json.apiV1EntryRoute).toContain("/api/v1");
      expect(examples.json.v1EntryRoute).toContain("/v1");
      expect(examples.json.keywords).toContain("marketplace listing conversion");
      expect(examples.json.instantScoreRoute).toContain("/api/instant-listing-score");
      expect(examples.json.conversionScoreRoute).toContain("/api/x402-marketplace-conversion");
      expect(examples.json.agentListingConversionRoute).toContain("/api/agent-listing-conversion");
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
      expect(examples.json.paymentHints.instantScore.preferredFirstPaidAction).toBe(false);
      expect(examples.json.paymentHints.conversionScore.maxAmountRequired).toBe("1000");
      expect(examples.json.paymentHints.agentListingConversion.maxAmountRequired).toBe("1000");
      expect(examples.json.paymentHints.listingRoast.maxAmountRequired).toBe("10000");
      expect(examples.json.instantScoreCommand).toContain("--max-amount 1000");
      expect(examples.json.conversionScoreCommand).toContain("/api/x402-marketplace-conversion");
      expect(examples.json.conversionScoreCommand).toContain("--max-amount 1000");
      expect(examples.json.agentListingConversionCommand).toContain("/api/agent-listing-conversion");
      expect(examples.json.agentListingConversionCommand).toContain("--max-amount 1000");
      expect(examples.json.apiEntryCommand).toContain("x402 pay http://localhost:8787/api");
      expect(examples.json.apiEntryCommand).toContain("--max-amount 1000");
      expect(examples.json.apiV1EntryCommand).toContain("x402 pay http://localhost:8787/api/v1");
      expect(examples.json.apiV1EntryCommand).toContain("--max-amount 1000");
      expect(examples.json.v1EntryCommand).toContain("x402 pay http://localhost:8787/v1");
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
      expect(examples.json.agentListingConversionOutput.nextPaidAction.maxAmountRequired).toBe("10000");
      expect(examples.json.indexedRoastGetOutput.endpoint).toBe("listing-roast-quick-score");
      expect(examples.json.indexedRoastGetOutput.matchedBuyerIntent).toContain("stale price");
      expect(examples.json.indexedRoastGetOutput.nextPaidAction.maxAmountRequired).toBe("1000");
      expect(examples.json.indexedRoastGetOutput.nextPaidAction.command).toContain("/api/x402-discovery-audit");
      expect(examples.json.indexedRoastGetOutput.nextPaidAction.command).toContain("--max-amount 1000");
      expect(examples.json.indexedRoastGetOutput.buyerIntentHandoffs.find((handoff) => handoff.path === "/api/listing-roast").maxAmountRequired).toBe("10000");
      expect(examples.json.indexedRoastGetOutput.nextPaidActions).toHaveLength(3);
      expect(examples.json.indexedRoastGetOutput.nextPaidActions.find((action) => action.path === "/api/x402-discovery-audit").command).toContain("--max-amount 1000");
      expect(examples.json.indexedRoastGetOutput.nextPaidActions.find((action) => action.path === "/api/x402-site-audit").command).toContain("--max-amount 1000");
      expect(examples.json.indexedRoastGetOutput.nextPaidActions.find((action) => action.path === "/api/listing-roast").command).toContain("--max-amount 10000");
      expect(examples.json.indexedRoastGetOutput.nextPaidActions.find((action) => action.path === "/api/listing-roast").body.source).toBe("indexed-quick-score-upgrade");
      expect(examples.json.pingOutput.endpoint).toBe("x402-ping");
      expect(examples.json.siteAuditOutput.endpoint).toBe("x402-site-audit");
      expect(examples.json.siteAuditOutput.catalogRefresh.status).toBe("needs_settled_payment_with_resource_metadata");
      expect(examples.json.siteAuditOutput.catalogRefresh.settlementRequirements.join(" ")).toContain("paymentPayload.resource");
      expect(examples.json.discoveryAuditOutput.endpoint).toBe("x402-discovery-audit");
      expect(examples.json.discoveryAuditOutput.catalogRefresh.whyUnpaidProbesAreNotEnough).toContain("do not refresh CDP Bazaar");
      expect(examples.json.discoveryAuditOutput.nextActions.join(" ")).toContain("Bazaar catalogs settled resources");
      expect(examples.json.command).toContain("x402 pay");
      expect(examples.json.scoreCommand).toContain("/api/listing-score");
      expect(examples.json.scoreOutput.price).toBe("$0.005");
      expect(examples.json.scoreOutput.nextPaidAction.route).toContain("/api/listing-roast");
      expect(examples.json.scoreOutput.nextPaidAction.command).toContain("--max-amount 10000");
      expect(examples.json.output.price).toBe("$0.01");

      const openApi = await fetchJson(server, "/openapi.json");
      expect(openApi.status).toBe(200);
      expectFreshDiscoveryHeaders(openApi.headers);
      expect(openApi.json.openapi).toBe("3.1.0");
      expect(Object.keys(openApi.json.paths)[0]).toBe("/api/listing-roast");
      expect(Object.keys(openApi.json.paths).indexOf("/api/listing-roast")).toBeLessThan(Object.keys(openApi.json.paths).indexOf("/api"));

      const wellKnownOpenApi = await fetchJson(server, "/.well-known/openapi.json");
      expect(wellKnownOpenApi.status).toBe(200);
      expectFreshDiscoveryHeaders(wellKnownOpenApi.headers);
      expect(wellKnownOpenApi.json.openapi).toBe("3.1.0");
      expect(wellKnownOpenApi.json.info.title).toBe(openApi.json.info.title);

      expect(openApi.json.info["x-provider-url"]).toBe("http://localhost:8787");
      expect(openApi.json.info["x-service-name"]).toBe("Listing Roast x402");
      expect(openApi.json.info["x-category"]).toBe("paid-api-listing");
      expect(openApi.json.info["x-tags"]).toContain("marketplace listing score");
      expect(openApi.json.info["x-keywords"]).toContain("x402 listing");
      expect(openApi.json.info.x402.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(openApi.json.info.x402.preferredFirstPaidAction.maxAmountRequired).toBe("1000");
      expect(openApi.json.info["x-recommended-first-paid-action"].path).toBe("/api/listing-roast");
      expect(openApi.json.info["x-pay-now"]).toContain("/api/pay-now");
      expect(openApi.json.x402.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(openApi.json.x402.preferredFirstPaidAction.maxAmountRequired).toBe("1000");
      expect(openApi.json.x402.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(openApi.json.x402.buyerInstruction).toContain("GET /api/listing-roast");
      expect(openApi.json["x-recommended-first-paid-action"].path).toBe("/api/listing-roast");
      expect(openApi.json["x-pay-now"]).toContain("/api/pay-now");
      expect(openApi.json.components.securitySchemes.x402.type).toBe("apiKey");
      expect(openApi.json.components.securitySchemes.x402.in).toBe("header");
      expect(openApi.json.components.securitySchemes.x402.name).toBe("X-PAYMENT");
      expect(openApi.json.components.securitySchemes.x402.description).toContain("HTTP 402");
      expect(openApi.json.paths["/api"].get.operationId).toBe("getListingRoastApiEntry");
      expect(openApi.json.paths["/api"].get.security).toEqual([{ x402: [] }]);
      expect(openApi.json.paths["/api"].get["x-payment"].maxAmountRequired).toBe("1000");
      expect(openApi.json.paths["/api"].get["x-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api"].get.summary).toContain("$0.001");
      expect(openApi.json.paths["/api/v1"].get.operationId).toBe("getListingRoastApiV1Entry");
      expect(openApi.json.paths["/api/v1"].get["x-payment"].maxAmountRequired).toBe("1000");
      expect(openApi.json.paths["/api/v1"].get["x-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/v1"].get.summary).toContain("$0.001");
      expect(openApi.json.paths["/api/v1"].get.responses[402].headers["Payment-Required"].description).toContain("x402");
      expect(openApi.json.paths["/api/v1"].get.responses[402].content["application/json"].example.selectedPaidAction.path).toBe("/api/v1");
      expect(openApi.json.paths["/v1"].get.operationId).toBe("getListingRoastV1Entry");
      expect(openApi.json.paths["/v1"].get["x-payment"].maxAmountRequired).toBe("1000");
      expect(openApi.json.paths["/v1"].get["x-price"]).toBe("$0.001");
      expect(openApi.json.paths["/v1"].get.summary).toContain("$0.001");
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
      expect(openApi.json.paths["/api/agent-listing-conversion"].get.summary).toContain("agent service promotion readiness");
      expect(openApi.json.paths["/api/agent-listing-conversion"].get.summary).toContain("agent service listing clarity");
      expect(openApi.json.paths["/api/agent-listing-conversion"].get.summary).toContain("agent listing conversion");
      expect(openApi.json.paths["/api/agent-listing-conversion"].get.description).toContain("agent service listing clarity");
      expect(openApi.json.paths["/api/agent-listing-conversion"].get.description).toContain("agent service promotion readiness");
      expect(openApi.json.paths["/api/agent-listing-conversion"].get.description).toContain("buyer-agent skip reasons");
      expect(openApi.json.paths["/api/x402-ping"].get["x-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/x402-ping"].get["x-x402-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/x402-ping"].get.summary).toContain("$0.001");
      expect(openApi.json.paths["/api/x402-site-audit"].get["x-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/x402-site-audit"].get["x-x402-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/x402-site-audit"].get.operationId).toBe("getX402SellerIntelligenceCatalogMetadataStaleBazaarPriceRouteHealthPaidApiPreflightAudit");
      expect(openApi.json.paths["/api/x402-site-audit"].get.summary).toContain("$0.001");
      expect(openApi.json.paths["/api/x402-site-audit"].get.summary).toContain("catalog metadata quality");
      expect(openApi.json.paths["/api/x402-site-audit"].get.summary).toContain("stale Bazaar price");
      expect(openApi.json.paths["/api/x402-site-audit"].get.summary).toContain("route health check");
      expect(openApi.json.paths["/api/x402-site-audit"].get.summary).toContain("paid API preflight");
      expect(openApi.json.paths["/api/x402-site-audit"].get.summary).toContain("listing SEO audit");
      expect(openApi.json.paths["/api/x402-site-audit"].get.summary).toContain("rank doctor");
      expect(openApi.json.paths["/api/x402-site-audit"].get.summary).toContain("seller intelligence");
      expect(openApi.json.paths["/api/x402-site-audit"].get.summary).toContain("growth checklist");
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
      expect(openApi.json.paths["/api/x402-discovery-audit"].get["x-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/x402-discovery-audit"].get["x-x402-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/x402-discovery-audit"].get.summary).toContain("$0.001");
      expect(openApi.json.paths["/api/x402-discovery-audit"].get.summary).toContain("quick check");
      expect(openApi.json.paths["/api/x402-discovery-audit"].get.tags).toContain("x402 discovery audit");
      expect(openApi.json.paths["/api/x402-discovery-audit"].get.tags).toContain("paid API preflight");
      expect(openApi.json.paths["/api/x402-discovery-audit"].get.tags).toContain("x402 route health check");
      expect(openApi.json.paths["/api/x402-discovery-audit"].get.tags).toContain("stale Bazaar price");
      expect(openApi.json.paths["/api/x402-discovery-audit"].get["x-payment"].maxAmountRequired).toBe("1000");
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
      expect(openApi.json.paths["/api/listing-roast"].get.operationId).toBe("getPaidApiListingQualityBuyerAgentSkipReasonsListingRoastQuickScore");
      expect(openApi.json.paths["/api/listing-roast"].get.tags[0]).toBe("paid API listing quality");
      expect(openApi.json.paths["/api/listing-roast"].get.security).toEqual([{ x402: [] }]);
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].maxAmountRequired).toBe("1000");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].preferredFirstPaidAction).toBe(true);
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].buyerAction).toContain("buyer-agent skip reasons");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].paidUseProof.paidUsageProof).toContain("/api/pay-now");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].paidUseProof.cashRegister).toContain("/api/cash-register");
      expect(openApi.json.paths["/api/listing-roast"].get["x-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/listing-roast"].get["x-x402-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/listing-roast"].post.security).toEqual([{ x402: [] }]);
      expect(openApi.json.paths["/api/listing-roast"].post["x-payment"].maxAmountRequired).toBe("10000");
      expect(openApi.json.paths["/api/listing-roast"].post["x-price"]).toBe("$0.01");
      expect(openApi.json.paths["/api/listing-roast"].post["x-x402-price"]).toBe("$0.01");
      expect(openApi.json.paths["/api/listing-roast"].get.summary).toContain("$0.001");
      expect(openApi.json.paths["/api/listing-roast"].get.summary).toContain("buyer-agent skip reasons");
      expect(openApi.json.paths["/api/listing-roast"].get.summary).toContain("listing quality");
      expect(openApi.json.paths["/api/listing-roast"].get.description).toContain("Paid API listing quality score");
      expect(openApi.json.paths["/api/listing-roast"].get.description).toContain("agent listing conversion score");
      expect(openApi.json.paths["/api/listing-roast"].get.description).toContain("agent service listing clarity");
      expect(openApi.json.paths["/api/listing-roast"].get.description).toContain("x402 discovery audit triage");
      expect(openApi.json.paths["/api/listing-roast"].get.description).toContain("Bazaar search visibility");
      const indexedRoastGetParameters = Object.fromEntries(openApi.json.paths["/api/listing-roast"].get.parameters.map((parameter) => [parameter.name, parameter]));
      expect(indexedRoastGetParameters.currentPrice.example).toBe("$0.001 GET; $0.01 POST upgrade");
      expect(indexedRoastGetParameters.currentPrice.schema.default).toBe("$0.001 GET; $0.01 POST upgrade");
      expect(indexedRoastGetParameters.currentCheckoutPath.example).toBe("/api/listing-roast");
      expect(indexedRoastGetParameters.currentCheckoutPath.schema.default).toBe("/api/listing-roast");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[402].description).toContain("X-PAYMENT");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[402].headers["Payment-Required"].description).toContain("resource URL");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[402].headers.Link.description).toContain("pay-now");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[402].content["application/json"].example.selectedPaidAction.path).toBe("/api/listing-roast");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[402].content["application/json"].example.selectedPaidAction.maxAmountRequired).toBe("1000");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[402].content["application/json"].example.paidUseProof.paidUsageProof).toContain("/api/pay-now");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[402].content["application/json"].example.note).toContain("Payment-Required");
      expect(openApi.json.paths["/api/listing-roast"].post.responses[402].content["application/json"].example.selectedPaidAction.method).toBe("POST");
      expect(openApi.json.paths["/api/listing-roast"].post.responses[402].content["application/json"].example.selectedPaidAction.maxAmountRequired).toBe("10000");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[200].content["application/json"].example.nextPaidAction.maxAmountRequired).toBe("1000");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[200].content["application/json"].example.nextPaidAction.command).toContain("/api/x402-discovery-audit");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[200].content["application/json"].example.nextPaidActions.find((action) => action.path === "/api/listing-roast").command).toContain("--max-amount 10000");
      expect(scoreAgent402OpenApiOperation(openApi.json.paths["/api/listing-roast"].get, "paid API listing quality")).toBeGreaterThan(scoreAgent402OpenApiOperation(openApi.json.paths["/api/x402-site-audit"].get, "paid API listing quality"));
      expect(scoreAgent402OpenApiOperation(openApi.json.paths["/api/listing-roast"].get, "buyer-agent skip reasons")).toBeGreaterThan(scoreAgent402OpenApiOperation(openApi.json.paths["/api/agent-listing-conversion"].get, "buyer-agent skip reasons"));
      expect(openApi.json.paths["/api/pay-now"].get.operationId).toBe("getPayNow");
      expect(openApi.json.paths["/api/pay-now"].get.security).toBeUndefined();
      expect(openApi.json.paths["/api/pay-now"].get.parameters.map((parameter) => parameter.name)).toContain("intent");
      expect(openApi.json.paths["/api/pricing"].get.operationId).toBe("getPricingCatalog");
      expect(openApi.json.paths["/api/find"].get.operationId).toBe("findPaidRouteForTask");
      expect(openApi.json.paths["/api/route"].get.operationId).toBe("routePaidLocalTools");
      expect(openApi.json.paths["/api/route"].post.operationId).toBe("routePaidLocalToolsPost");
      expect(openApi.json.paths["/v2/x402/discovery/resources"].get.operationId).toBe("getLocalX402DiscoveryResources");
      expect(openApi.json.paths["/v2/x402/discovery/search"].get.operationId).toBe("searchLocalX402DiscoveryResources");
      expect(openApi.json.paths["/v2/x402/discovery/merchant"].get.operationId).toBe("getLocalX402MerchantResources");
      expect(openApi.json.paths["/api/listing-score"].post.summary).toContain("marketplace listing score");
      expect(openApi.json.paths["/api/listing-score"].post["x-payment"].maxAmountRequired).toBe("5000");
      expect(openApi.json.paths["/api/listing-score"].post["x-price"]).toBe("$0.005");
      expect(openApi.json.paths["/api/listing-score"].post["x-x402-price"]).toBe("$0.005");
      expect(openApi.json.paths["/api/listing-score"].post.responses[200].content["application/json"].example.nextPaidAction.command).toContain("--max-amount 10000");
      expect(openApi.json["x-listing-roast"].payNow).toContain("/api/pay-now");
      expect(openApi.json["x-listing-roast"].pricing).toContain("/api/pricing");
      expect(openApi.json["x-listing-roast"].find).toContain("/api/find");
      expect(openApi.json["x-listing-roast"].route).toContain("/api/route");
      expect(openApi.json["x-listing-roast"].localDiscovery.resources).toContain("/v2/x402/discovery/resources");
      expect(openApi.json["x-listing-roast"].localDiscovery.searchExamples.find((example) => example.query === "agent service clarity").expectedFirstPath).toBe("/api/listing-roast");
      expect(openApi.json["x-listing-roast"].localDiscovery.searchExamples.find((example) => example.query === "x402 route health check").expectedFirstPath).toBe("/api/x402-discovery-audit");
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
      expect(openApi.json["x-listing-roast"].recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(openApi.json["x-listing-roast"].recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(openApi.json["x-listing-roast"].recommendedPaidSequence[1].use).toBe("fullRoast");
      expect(openApi.json["x-listing-roast"].recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(openApi.json["x-listing-roast"].x402Manifest).toContain("/x402.json");
      expect(openApi.json["x-listing-roast"].keywords).toContain("paid API listing");

      const llms = await fetchJson(server, "/llms.txt");
      expect(llms.status).toBe(200);
      expect(llms.text).toContain("Command builder");
      expect(llms.text).toContain("/AGENTS.md");
      expect(llms.text).toContain("/docs");
      expect(llms.text).toContain("/api-docs");
      expect(llms.text).toContain("/api/instant-listing-score");
      expect(llms.text).toContain("/api/x402-marketplace-conversion");
      expect(llms.text).toContain("/api/agent-listing-conversion");
      expect(llms.text).toContain("/api/x402-ping");
      expect(llms.text).toContain("/api/x402-site-audit");
      expect(llms.text).toContain("/api/x402-discovery-audit");
      expect(llms.text).toContain("Buyer intent landing pages");
      expect(llms.text).toContain("/paid-api-listing-quality");
      expect(llms.text).toContain("/agent-listing-conversion");
      expect(llms.text).toContain("/x402-discovery-audit");
      expect(llms.text).toContain("/x402-site-audit");
      expect(llms.text).toContain("Primary paid action: GET http://localhost:8787/api/listing-roast ($0.001, max 1000)");
      expect(llms.text).toContain("/api/listing-score");
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
      expect(llms.text).toContain("x402 pay http://localhost:8787/api");
      expect(llms.text).toContain("x402 pay http://localhost:8787/api/v1");
      expect(llms.text).toContain("x402 pay http://localhost:8787/v1");
      expect(llms.text).toContain("x402 pay http://localhost:8787/api/listing-roast");
      expect(llms.text).toContain("/api/agent-listing-conversion");
      expect(llms.text).toContain("--max-amount 1000");
      expect(llms.text).toContain("--max-amount 10000");
      expect(llms.text).toContain("Recommended paid sequence");
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
      expect(llmsFull.text).toContain("Full roast command");
      expect(llmsFull.text).toContain("after the indexed quick score for the dedicated agent-listing conversion deep dive");
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

      const authMarkdown = await fetchJson(server, "/auth.md");
      expect(authMarkdown.status).toBe(200);
      expect(authMarkdown.headers.get("content-type")).toContain("text/markdown");
      expect(authMarkdown.text).toContain("# Auth.md");
      expect(authMarkdown.text).toContain("## Listing Roast x402 Auth");
      expect(authMarkdown.text).toContain("does not use accounts, API keys, OAuth login");
      expect(authMarkdown.text).toContain("Type: x402 payment");
      expect(authMarkdown.text).toContain("OAuth/OIDC: not supported");
      expect(authMarkdown.text).toContain("## Agent Registration");
      expect(authMarkdown.text).toContain("Registration endpoint: none");
      expect(authMarkdown.text).toContain("Token endpoint: none");
      expect(authMarkdown.text).toContain("Do not make a paid call unless the buyer explicitly intends to spend USDC");

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
      expect(robots.text).toContain("/api/route");
      expect(robots.text).toContain("/paid-api-listing-quality");
      expect(robots.text).toContain("/agent-listing-conversion");
      expect(robots.text).toContain("/x402-discovery-audit");
      expect(robots.text).toContain("/x402-site-audit");
      expect(robots.text).toContain("/.well-known/agent-tools.json");
      expect(robots.text).toContain("/.well-known/agent-skills/index.json");
      expect(robots.text).toContain("/.well-known/mcp/server-card.json");
      expect(robots.text).toContain("Preferred paid route after explicit buyer intent");

      const sitemap = await fetchJson(server, "/sitemap.xml");
      expect(sitemap.status).toBe(200);
      expect(sitemap.headers.get("cache-control")).toContain("no-store");
      expect(sitemap.text.indexOf("<loc>http://localhost:8787/api/listing-roast</loc>")).toBeGreaterThan(-1);
      expect(sitemap.text.indexOf("<loc>http://localhost:8787/api/listing-roast</loc>")).toBeLessThan(sitemap.text.indexOf("<loc>http://localhost:8787/api</loc>"));
      expect(sitemap.text).toContain("/paid-api-listing-quality");
      expect(sitemap.text).toContain("/agent-listing-conversion");
      expect(sitemap.text).toContain("/x402-discovery-audit");
      expect(sitemap.text).toContain("/x402-site-audit");
      expect(sitemap.text).toContain("/builder");
      expect(sitemap.text).toContain("/sample");
      expect(sitemap.text).toContain("/api/pay-now");
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
      expect(payNow.json.route).toContain("/api/listing-roast");
      expect(payNow.json.intent).toBeNull();
      expect(payNow.json.selectedActionKey).toBe("indexedQuickScore");
      expect(payNow.json.selectedPaidAction.path).toBe("/api/listing-roast");
      expect(payNow.json.method).toBe("GET");
      expect(payNow.json.price).toBe("$0.001");
      expect(payNow.json.maxAmountRequired).toBe("1000");
      expect(payNow.json.command).toContain("/api/listing-roast");
      expect(payNow.json.command).toContain("--max-amount 1000");
      expect(payNow.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(payNow.json.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(payNow.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(payNow.json.recommendedPaidSequence[1].use).toBe("fullRoast");
      expect(payNow.json.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(payNow.json.intentRoutes.instantScore.path).toBe("/api/instant-listing-score");
      expect(payNow.json.intentRoutes.conversionScore.path).toBe("/api/x402-marketplace-conversion");
      expect(payNow.json.intentRoutes.agentListingConversion.path).toBe("/api/agent-listing-conversion");
      expect(payNow.json.intentRoutes.x402Ping.path).toBe("/api/x402-ping");
      expect(payNow.json.intentRoutes.x402SiteAudit.path).toBe("/api/x402-site-audit");
      expect(payNow.json.intentRoutes.discoveryAudit.maxAmountRequired).toBe("10000");
      expect(payNow.json.routeSelector.map((route) => route.use)).toContain("fullRoast");
      expect(payNow.json.expectedChallenge.status).toBe(402);
      expect(payNow.json.paidUsageProof.paidCompletions).toBe(0);
      expect(payNow.json.paidUsageProof.noSpend).toBe(true);
      expect(payNow.json.noSpendNote).toContain("Fetching this endpoint is free");

      const payNowSkipReasons = await fetchJson(server, "/api/pay-now?intent=buyer-agent%20skip%20reasons");
      expect(payNowSkipReasons.status).toBe(200);
      expect(payNowSkipReasons.headers.get("payment-required")).toBeNull();
      expect(payNowSkipReasons.json.intent).toBe("buyer-agent skip reasons");
      expect(payNowSkipReasons.json.selectedActionKey).toBe("indexedQuickScore");
      expect(payNowSkipReasons.json.route).toContain("/api/listing-roast");
      expect(payNowSkipReasons.json.method).toBe("GET");
      expect(payNowSkipReasons.json.price).toBe("$0.001");
      expect(payNowSkipReasons.json.maxAmountRequired).toBe("1000");
      expect(payNowSkipReasons.json.command).toContain("/api/listing-roast");
      expect(payNowSkipReasons.json.expectedChallenge.amount).toBe("1000");
      expect(payNowSkipReasons.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(payNowSkipReasons.json.rankedPaidRoutes[0].id).toBe("indexed_roast_quick_score");
      expect(payNowSkipReasons.json.rankedPaidRoutes.map((route) => route.id)).toContain("agent_listing_conversion_score");

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

      const payNowMetadata = await fetchJson(server, "/api/pay-now?intent=openapi%20llms%20robots%20sitemap%20metadata");
      expect(payNowMetadata.status).toBe(200);
      expect(payNowMetadata.json.selectedActionKey).toBe("x402SiteAudit");
      expect(payNowMetadata.json.route).toContain("/api/x402-site-audit");

      const payNowFullRoast = await fetchJson(server, "/api/pay-now?intent=full%20roast%20rewrite%20top%20fixes");
      expect(payNowFullRoast.status).toBe(200);
      expect(payNowFullRoast.json.selectedActionKey).toBe("fullRoast");
      expect(payNowFullRoast.json.route).toContain("/api/listing-roast");
      expect(payNowFullRoast.json.method).toBe("POST");
      expect(payNowFullRoast.json.maxAmountRequired).toBe("10000");
      expect(payNowFullRoast.json.expectedChallenge.amount).toBe("10000");

      const pricing = await fetchJson(server, "/api/pricing");
      expect(pricing.status).toBe(200);
      expect(pricing.headers.get("payment-required")).toBeNull();
      expect(pricing.json.noSpend).toBe(true);
      expect(pricing.json.paidUsageProof.paidCompletions).toBe(0);
      expect(pricing.json.paidUsageProof.cashRegister).toContain("/api/cash-register");
      expect(pricing.json.count).toBe(14);
      expect(pricing.json.routes[0].path).toBe("/api/listing-roast");
      expect(pricing.json.routes[0].maxAmountRequired).toBe("1000");
      expect(pricing.json.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(pricing.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(pricing.json.recommendedPaidSequence[1].use).toBe("fullRoast");
      expect(pricing.json.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(pricing.json.routes.map((route) => route.path)).toContain("/api/x402-site-audit");

      const findDiscovery = await fetchJson(server, "/api/find?q=x402%20discovery%20audit");
      expect(findDiscovery.status).toBe(200);
      expect(findDiscovery.headers.get("payment-required")).toBeNull();
      expect(findDiscovery.json.noSpend).toBe(true);
      expect(findDiscovery.json.paidUsageProof.paidCompletions).toBe(0);
      expect(findDiscovery.json.recommended.path).toBe("/api/x402-discovery-audit");
      expect(findDiscovery.json.recommended.maxAmountRequired).toBe("1000");
      expect(findDiscovery.json.alternatives.map((route) => route.path)).toContain("/api/x402-site-audit");
      expect(findDiscovery.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(findDiscovery.json.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(findDiscovery.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(findDiscovery.json.recommendedPaidSequence[1].use).toBe("fullRoast");
      expect(findDiscovery.json.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(findDiscovery.json.paymentRule).toContain("Do not call");

      const findSkipReasons = await fetchJson(server, "/api/find?q=buyer-agent%20skip%20reasons");
      expect(findSkipReasons.status).toBe(200);
      expect(findSkipReasons.json.recommended.path).toBe("/api/listing-roast");
      expect(findSkipReasons.json.alternatives.map((route) => route.path)).toContain("/api/agent-listing-conversion");

      const findMixedSkipReasons = await fetchJson(server, "/api/find?q=buyer-agent%20skip%20reasons%20paid%20API%20listing%20clarity");
      expect(findMixedSkipReasons.status).toBe(200);
      expect(findMixedSkipReasons.json.recommended.path).toBe("/api/listing-roast");
      expect(findMixedSkipReasons.json.alternatives.map((route) => route.path)).toContain("/api/agent-listing-conversion");

      const findFullRewrite = await fetchJson(server, "/api/find?q=listing%20roast%20full%20rewrite");
      expect(findFullRewrite.status).toBe(200);
      expect(findFullRewrite.json.recommended.id).toBe("listing_roast");
      expect(findFullRewrite.json.recommended.method).toBe("POST");

      const findCustomScore = await fetchJson(server, "/api/find?q=score%20my%20paid%20API%20listing%20with%20a%20custom%20body");
      expect(findCustomScore.status).toBe(200);
      expect(findCustomScore.json.recommended.id).toBe("listing_score");
      expect(findCustomScore.json.recommended.method).toBe("POST");
      expect(findCustomScore.json.recommended.maxAmountRequired).toBe("5000");

      const routeDiscovery = await fetchJson(server, "/api/route?query=x402%20discovery%20audit&top=3");
      expect(routeDiscovery.status).toBe(200);
      expect(routeDiscovery.headers.get("payment-required")).toBeNull();
      expect(routeDiscovery.json.noSpend).toBe(true);
      expect(routeDiscovery.json.paidUsageProof.paidCompletions).toBe(0);
      expect(routeDiscovery.json.scope).toBe("owned-routes-only");
      expect(routeDiscovery.json.results).toHaveLength(3);
      expect(routeDiscovery.json.best.path).toBe("/api/x402-discovery-audit");
      expect(routeDiscovery.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(routeDiscovery.json.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(routeDiscovery.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(routeDiscovery.json.recommendedPaidSequence[1].use).toBe("fullRoast");
      expect(routeDiscovery.json.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");
      expect(routeDiscovery.json.paymentRule).toContain("Do not call");

      const routeFixBazaar = await fetchJson(server, "/api/route?intent=fix%20x402%20bazaar%20listing&top=3");
      expect(routeFixBazaar.status).toBe(200);
      expect(routeFixBazaar.headers.get("payment-required")).toBeNull();
      expect(routeFixBazaar.json.query).toBe("fix x402 bazaar listing");
      expect(routeFixBazaar.json.best.path).toBe("/api/x402-discovery-audit");
      expect(routeFixBazaar.json.best.maxAmountRequired).toBe("1000");

      const routeSellerSeo = await fetchJson(server, "/api/route", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "x402 listing rank doctor seller growth checklist", top: 2, include: "local" })
      });
      expect(routeSellerSeo.status).toBe(200);
      expect(routeSellerSeo.headers.get("payment-required")).toBeNull();
      expect(routeSellerSeo.json.best.path).toBe("/api/x402-site-audit");
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
      expect(routeSkipReasons.json.results).toHaveLength(2);
      expect(routeSkipReasons.json.results.map((route) => route.path)).toContain("/api/agent-listing-conversion");

      const routeMixedSkipReasons = await fetchJson(server, "/api/route", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "buyer-agent skip reasons paid API listing clarity", top: 2, include: "local" })
      });
      expect(routeMixedSkipReasons.status).toBe(200);
      expect(routeMixedSkipReasons.json.best.path).toBe("/api/listing-roast");
      expect(routeMixedSkipReasons.json.results.map((route) => route.path)).toContain("/api/agent-listing-conversion");

      const routeCustomScore = await fetchJson(server, "/api/route?query=I%20want%20to%20score%20my%20paid%20API%20listing%20with%20a%20custom%20body&top=3");
      expect(routeCustomScore.status).toBe(200);
      expect(routeCustomScore.json.best.id).toBe("listing_score");
      expect(routeCustomScore.json.best.method).toBe("POST");
      expect(routeCustomScore.json.best.maxAmountRequired).toBe("5000");
      expect(routeCustomScore.json.results[0].path).toBe("/api/listing-score");

      const localDiscovery = await fetchJson(server, "/v2/x402/discovery/resources?limit=2");
      expect(localDiscovery.status).toBe(200);
      expect(localDiscovery.headers.get("payment-required")).toBeNull();
      expect(localDiscovery.json.noSpend).toBe(true);
      expect(localDiscovery.json.paidUsageProof.paidCompletions).toBe(0);
      expect(localDiscovery.json.items).toHaveLength(2);
      expect(localDiscovery.json.pagination.total).toBe(14);
      expect(localDiscovery.json.items[0].resource).toBe("http://localhost:8787/api/listing-roast");
      expect(localDiscovery.json.items[0].accepts[0].amount).toBe("1000");
      expect(localDiscovery.json.items[0].metadata.preferredFirstPaidAction).toBe(true);
      expect(localDiscovery.json.items[0].tags).toEqual([
        "x402",
        "paid API listing quality score",
        "paid API listing quality",
        "marketplace listing score",
        "buyer-agent skip reasons",
        "buyer agent skip reasons",
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
      expect(localDiscovery.json.recommendedPaidSequence[0].use).toBe("indexedQuickScore");
      expect(localDiscovery.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(localDiscovery.json.recommendedPaidSequence[1].use).toBe("fullRoast");
      expect(localDiscovery.json.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");

      const localDiscoveryAlias = await fetchJson(server, "/.well-known/x402/discovery/resources?limit=1");
      expect(localDiscoveryAlias.status).toBe(200);
      expect(localDiscoveryAlias.json.items[0].metadata.path).toBe("/api/listing-roast");

      const localDiscoverySearch = await fetchJson(server, "/v2/x402/discovery/search?query=x402%20discovery%20audit&limit=2");
      expect(localDiscoverySearch.status).toBe(200);
      expect(localDiscoverySearch.headers.get("payment-required")).toBeNull();
      expect(localDiscoverySearch.json.noSpend).toBe(true);
      expect(localDiscoverySearch.json.paidUsageProof.paidCompletions).toBe(0);
      expect(localDiscoverySearch.json.resources[0].resource).toBe("http://localhost:8787/api/x402-discovery-audit");
      expect(localDiscoverySearch.json.resources[0].tags).toEqual([
        "x402",
        "Bazaar visibility",
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
      expect(localDiscoverySearch.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(localDiscoverySearch.json.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");

      const localDiscoveryListingScoreSearch = await fetchJson(server, "/v2/x402/discovery/search?query=marketplace%20listing%20score&limit=2");
      expect(localDiscoveryListingScoreSearch.status).toBe(200);
      expect(localDiscoveryListingScoreSearch.headers.get("payment-required")).toBeNull();
      expect(localDiscoveryListingScoreSearch.json.resources[0].metadata.path).toBe("/api/listing-roast");
      expect(localDiscoveryListingScoreSearch.json.resources[0].metadata.maxAmountRequired).toBe("1000");

      const localDiscoverySkipReasonsSearch = await fetchJson(server, "/v2/x402/discovery/search?query=buyer-agent%20skip%20reasons&limit=2");
      expect(localDiscoverySkipReasonsSearch.status).toBe(200);
      expect(localDiscoverySkipReasonsSearch.headers.get("payment-required")).toBeNull();
      expect(localDiscoverySkipReasonsSearch.json.resources[0].metadata.path).toBe("/api/listing-roast");
      expect(localDiscoverySkipReasonsSearch.json.resources[0].metadata.maxAmountRequired).toBe("1000");

      const localDiscoveryAgentClaritySearch = await fetchJson(server, "/v2/x402/discovery/search?query=agent%20service%20clarity&limit=2");
      expect(localDiscoveryAgentClaritySearch.status).toBe(200);
      expect(localDiscoveryAgentClaritySearch.headers.get("payment-required")).toBeNull();
      expect(localDiscoveryAgentClaritySearch.json.resources[0].metadata.path).toBe("/api/listing-roast");
      expect(localDiscoveryAgentClaritySearch.json.resources[0].metadata.maxAmountRequired).toBe("1000");

      const localDiscoveryConversionSearch = await fetchJson(server, "/v2/x402/discovery/search?query=x402%20marketplace%20conversion&limit=2");
      expect(localDiscoveryConversionSearch.status).toBe(200);
      expect(localDiscoveryConversionSearch.headers.get("payment-required")).toBeNull();
      expect(localDiscoveryConversionSearch.json.resources[0].metadata.path).toBe("/api/x402-marketplace-conversion");
      expect(localDiscoveryConversionSearch.json.resources[0].metadata.maxAmountRequired).toBe("1000");

      const localDiscoveryMerchant = await fetchJson(server, "/v2/x402/discovery/merchant?payTo=0x000000000000000000000000000000000000dEaD");
      expect(localDiscoveryMerchant.status).toBe(200);
      expect(localDiscoveryMerchant.headers.get("payment-required")).toBeNull();
      expect(localDiscoveryMerchant.json.paidUsageProof.paidCompletions).toBe(0);
      expect(localDiscoveryMerchant.json.resources).toHaveLength(14);
      expect(localDiscoveryMerchant.json.preferredFirstPaidAction.path).toBe("/api/listing-roast");
      expect(localDiscoveryMerchant.json.recommendedPaidSequence[0].action.maxAmountRequired).toBe("1000");
      expect(localDiscoveryMerchant.json.recommendedPaidSequence[1].action.maxAmountRequired).toBe("10000");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.status).toBe(200);
      expect(cashRegister.json.receiverWallet.network).toBe("eip155:84532");
      expect(cashRegister.json.receiverWallet.source).toBe("disabled_for_non_mainnet");
      expect(cashRegister.json.signals.homepageViews).toBe(2);
      expect(cashRegister.json.signals.builderViews).toBe(1);
      expect(cashRegister.json.signals.builderCommandBuilds).toBe(1);
      expect(cashRegister.json.signals.llmsViews).toBe(5);
      expect(cashRegister.json.signals.openApiViews).toBe(2);
      expect(cashRegister.json.signals.sampleViews).toBe(2);
      expect(cashRegister.json.signals.schemaViews).toBe(2);
      expect(cashRegister.json.signals.examplesViews).toBe(1);
      expect(cashRegister.json.signals.payNowViews).toBe(7);
      expect(cashRegister.json.signals.pricingViews).toBe(1);
      expect(cashRegister.json.signals.findViews).toBe(5);
      expect(cashRegister.json.signals.routeViews).toBe(10);
      expect(cashRegister.json.signals.localDiscoveryViews).toBe(8);
      expect(cashRegister.json.signals.mcpViews).toBe(4);
      expect(cashRegister.json.signals.x402ManifestViews).toBe(3);
      expect(cashRegister.json.signals.agentCardViews).toBe(2);
      expect(cashRegister.json.signals.aiPluginViews).toBe(1);
      expect(cashRegister.json.signals.apiCatalogViews).toBe(1);
      expect(cashRegister.json.signals.agentSkillsViews).toBe(1);
      expect(cashRegister.json.signals.agentSkillViews).toBe(1);
      expect(cashRegister.json.signals.commandCopyClicks).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.apiEntryValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.instantScoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.conversionScoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.agentListingConversionValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.indexedRoastGetValidUnpaidChallenges).toBe(0);
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

      const x402Manifest = await fetchJson(server, "/x402.json");
      expect(x402Manifest.status).toBe(200);
      expect(x402Manifest.json.paidUsageProof.paidCompletions).toBe(2);
      expect(x402Manifest.json.paidUsageProof.estimatedGrossRevenueUsd).toBe("0.002");
      expect(x402Manifest.json.paidUsageProof.proofText).toBe("2 paid completions; $0.002 registered");
      expect(x402Manifest.json.paidUsageProof.cashRegister).toContain("/api/cash-register");

      const openApi = await fetchJson(server, "/openapi.json");
      expect(openApi.status).toBe(200);
      expect(openApi.json["x-listing-roast"].paidUsageProof.paidCompletions).toBe(2);
      expect(openApi.json["x-listing-roast"].paidUsageProof.estimatedGrossRevenueUsd).toBe("0.002");
      expect(openApi.json["x-listing-roast"].paidUsageProof.proofText).toBe("2 paid completions; $0.002 registered");

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
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.error).toBe("Payment required");
      expect(challenge.resource.url).toContain("/api/listing-roast");
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.accepts[0].amount).toBe("10000");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
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
      expect(indexed.text).toContain("x402 pay http://localhost:8787/api/listing-roast");
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
      expect(apiClient.json.recommendedPaidSequence[1].use).toBe("fullRoast");
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
      expect(agentsMarkdown.text).toContain("/v1");

      const docs = await fetchJson(server, "/docs");
      expect(docs.status).toBe(200);
      expect(docs.headers.get("content-type")).toContain("text/markdown");
      expect(docs.text).toContain("# Listing Roast x402");
      expect(docs.text).toContain("/AGENTS.md");

      const apiDocs = await fetchJson(server, "/api-docs");
      expect(apiDocs.status).toBe(200);
      expect(apiDocs.headers.get("content-type")).toContain("text/markdown");
      expect(apiDocs.text).toContain("# Listing Roast x402");

      const versionedOpenApi = await fetchJson(server, "/api/v1/openapi.json");
      expect(versionedOpenApi.status).toBe(200);
      expect(versionedOpenApi.headers.get("payment-required")).toBeNull();
      expect(versionedOpenApi.json.openapi).toBe("3.1.0");
      expect(versionedOpenApi.json.paths["/v1"].get.operationId).toBe("getListingRoastV1Entry");

      const swaggerJson = await fetchJson(server, "/swagger.json");
      expect(swaggerJson.status).toBe(200);
      expect(swaggerJson.json.info.title).toBe("Listing Roast x402");

      const redirect = await fetch(`http://127.0.0.1:${server.address().port}/openapi.yaml`, { redirect: "manual" });
      expect(redirect.status).toBe(302);
      expect(redirect.headers.get("location")).toContain("/openapi.json");
      expect(redirect.headers.get("payment-required")).toBeNull();

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.paidCompletions).toBe(0);
      expect(cashRegister.json.signals.llmsViews).toBe(3);
      expect(cashRegister.json.signals.openApiViews).toBe(2);
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
    await recordPaidCompletion("listingRoast", 0.01);

    const cashRegister = await getCashRegister();
    expect(cashRegister.paidCompletions).toBe(11);
    expect(cashRegister.estimatedGrossRevenueUsd).toBe("0.033");
    expect(cashRegister.listingScoreCompletions).toBe(5);
    expect(cashRegister.listingScoreEstimatedRevenueUsd).toBe("$0.009");
    expect(cashRegister.directoryPostCompletions).toBe(1);
    expect(cashRegister.directoryPostEstimatedRevenueUsd).toBe("$0.001");
    expect(cashRegister.apiEntryCompletions).toBe(1);
    expect(cashRegister.apiEntryEstimatedRevenueUsd).toBe("$0.001");
    expect(cashRegister.instantScoreCompletions).toBe(3);
    expect(cashRegister.indexedRoastGetCompletions).toBe(1);
    expect(cashRegister.listingScorePostCompletions).toBe(1);
    expect(cashRegister.x402SiteAuditCompletions).toBe(1);
    expect(cashRegister.x402DiscoveryAuditCompletions).toBe(2);
    expect(cashRegister.x402DiscoveryAuditEstimatedRevenueUsd).toBe("$0.011");
    expect(cashRegister.x402PingCompletions).toBe(1);
    expect(cashRegister.listingRoastCompletions).toBe(1);
    expect(cashRegister.lastPaidCompletion.routeKey).toBe("listingRoast");
    expect(cashRegister.lastPaidCompletion.path).toBe("/api/listing-roast");
    expect(cashRegister.lastPaidCompletion.method).toBe("POST");
    expect(cashRegister.recentPaidCompletions).toHaveLength(11);
    expect(cashRegister.recentPaidCompletions.map((event) => event.routeKey)).toContain("directoryPost");
    expect(cashRegister.recentPaidCompletions.find((event) => event.routeKey === "directoryPost").path).toBe("/");
    expect(cashRegister.recentPaidCompletions.map((event) => event.routeKey)).toContain("conversionScore");
    expect(cashRegister.recentPaidCompletions.map((event) => event.routeKey)).toContain("agentListingConversion");
    expect(cashRegister.recentPaidCompletions.find((event) => event.routeKey === "agentListingConversion").path).toBe("/api/agent-listing-conversion");
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
      expect(challenge.resource.description).toContain("Public paid-use proof before payment");
      expect(challenge.resource.description).toContain("/api/pay-now");
      expect(challenge.resource.description).toContain("/api/cash-register");
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.accepts[0].amount).toBe("1000");
      expect(response.json.error).toBe("payment_required");
      expect(response.json.selectedPaidAction.path).toBe("/");
      expect(response.json.selectedPaidAction.method).toBe("POST");
      expect(response.json.selectedPaidAction.maxAmountRequired).toBe("1000");
      expect(response.json.selectedPaidAction.command).not.toContain("-d ");
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
      expect(challenge.extensions.bazaar.info.input.queryParams.currentPrice).toBe("$0.001 GET; $0.01 POST upgrade");
      expect(challenge.extensions.bazaar.info.input.queryParams.currentPrice).not.toBe("$1.00");
      expect(challenge.extensions.bazaar.info.output.example.agentName).toBeUndefined();
      expect(challenge.extensions.bazaar.info.output.example.price).toBe("$0.001");
      expect(challenge.extensions.bazaar.info.output.example.nextPaidAction.body.currentPrice).toBe("$0.001 GET; $0.01 POST upgrade");
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

  it("protects the agent listing conversion alias with a one-tenth-cent x402 challenge", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/api/agent-listing-conversion?serviceUrl=https%3A%2F%2Fexample.com&serviceName=Example");

      expect(response.status).toBe(402);
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.error).toBe("Payment required");
      const resourceUrl = new URL(challenge.resource.url);
      expect(resourceUrl.pathname).toBe("/api/agent-listing-conversion");
      expect(resourceUrl.search).toBe("");
      expect(challenge.resource.description).toMatch(/^buyer-agent skip reasons/);
      expect(challenge.resource.description).toContain("$0.001");
      expect(challenge.resource.description).toContain("agent listing conversion");
      expect(challenge.resource.description).toContain("agent service listing clarity");
      expect(challenge.resource.description).toContain("Listing Roast");
      expect(challenge.resource.description).toContain("buyer-agent skip reasons");
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.accepts[0].amount).toBe("1000");
      expect(response.json.error).toBe("payment_required");
      expect(response.json.noSpendPreview).toBe(true);
      expect(response.json.selectedPaidAction.path).toBe("/api/agent-listing-conversion");
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
      expect(response.headers.get("payment-required").length).toBeLessThan(9000);
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.error).toBe("Payment required");
      expect(challenge.resource.url).toContain("/api/listing-roast");
      expect(challenge.resource.description).toMatch(/^marketplace listing score/);
      expect(challenge.resource.description).toContain("$0.001");
      expect(challenge.resource.description).toContain("x402 site audit starter");
      expect(challenge.resource.description).toContain("buyer-agent skip reasons");
      expect(challenge.resource.description).toContain("agent service listing clarity");
      expect(challenge.resource.description).toContain("x402 discovery audit triage");
      expect(challenge.resource.description).toContain("paid API preflight");
      expect(challenge.resource.description).toContain("Bazaar search visibility");
      expect(challenge.resource.description).toContain("Public paid-use proof before payment");
      expect(challenge.resource.description).toContain("/api/pay-now");
      expect(challenge.resource.description).toContain("/api/cash-register");
      expect(challenge.resource.serviceName).toBe("Listing Roast x402");
      expect(challenge.resource.tags).toEqual([
        "x402",
        "paid API listing quality score",
        "paid API listing quality",
        "marketplace listing score",
        "buyer-agent skip reasons",
        "buyer agent skip reasons",
        "agent-service listing score",
        "x402 site audit",
        "x402 discovery audit",
        "paid API preflight",
        "agent service clarity",
        "route health"
      ]);
      expect(challenge.extensions.bazaar.info.input.queryParams.agentName).toBe("Listing Roast x402");
      expect(challenge.extensions.bazaar.info.input.queryParams.currentPrice).toBe("$0.001 GET; $0.01 POST upgrade");
      expect(challenge.extensions.bazaar.info.input.queryParams.currentPrice).not.toBe("$1.00");
      expect(challenge.extensions.bazaar.info.input.queryParams.goal).toContain("stale Bazaar listing");
      expect(challenge.extensions.bazaar.info.output.example.price).toBe("$0.001");
      expect(challenge.extensions.bazaar.info.output.example.matchedBuyerIntent).toContain("stale price");
      expect(challenge.extensions.bazaar.info.output.example.nextPaidAction.path).toBe("/api/x402-discovery-audit");
      expect(challenge.extensions.bazaar.info.output.example.nextPaidAction.maxAmountRequired).toBe("1000");
      expect(challenge.extensions.bazaar.info.output.example.nextPaidAction.command).toBeUndefined();
      expect(challenge.extensions.bazaar.info.output.example.buyerIntentHandoffs).toBeUndefined();
      expect(challenge.extensions.bazaar.info.output.example.nextPaidActions.find((action) => action.path === "/api/listing-roast").maxAmountRequired).toBe("10000");
      expect(challenge.extensions.bazaar.info.output.example.nextPaidActions.find((action) => action.path === "/api/listing-roast").command).toBeUndefined();
      const indexedQuerySchema = challenge.extensions.bazaar.schema.properties.input.properties.queryParams.properties;
      expect(indexedQuerySchema.agentName.description).toContain("paid API");
      expect(indexedQuerySchema.listingText.description).toContain("marketplace description");
      expect(indexedQuerySchema.currentPrice.example).toBe("$0.001 GET; $0.01 POST upgrade");
      expect(indexedQuerySchema.currentPrice.default).toBe("$0.001 GET; $0.01 POST upgrade");
      expect(indexedQuerySchema.currentCheckoutPath.example).toBe("/api/listing-roast");
      expect(indexedQuerySchema.currentCheckoutPath.default).toBe("/api/listing-roast");
      expect(indexedQuerySchema.goal.description).toContain("paid completions");
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.accepts[0].amount).toBe("1000");
      expect(response.json.error).toBe("payment_required");
      expect(response.json.selectedPaidAction.path).toBe("/api/listing-roast");
      expect(response.json.selectedPaidAction.command).toContain("--max-amount 1000");
      expect(response.json.intentRoutes.agentListingConversion.path).toBe("/api/agent-listing-conversion");

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
        "discovery audit",
        "x402 seller discoverability",
        "fix x402 Bazaar listing",
        "x402 catalog metadata quality",
        "x402 listing SEO audit",
        "x402 listing rank doctor",
        "x402 seller growth checklist",
        "x402 seller intelligence",
        "x402 marketplace SEO audit",
        "paid API preflight",
        "route health",
        "Bazaar visibility",
        "stale Bazaar price"
      ]);
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

  it("protects the x402 discovery audit GET route with a one-tenth-cent x402 challenge", async () => {
    mockFacilitatorSupportedKinds();
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/api/x402-discovery-audit?url=https%3A%2F%2Flisting-roast-x402-service-production.up.railway.app%2Fapi%2Flisting-roast&query=listing%20roast");

      expect(response.status).toBe(402);
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.error).toBe("Payment required");
      expect(challenge.resource.url).toContain("/api/x402-discovery-audit");
      expect(challenge.resource.description).toContain("$0.001");
      expect(challenge.resource.description).toContain("Discovery Audit Quick");
      expect(challenge.resource.description).toContain("route health");
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.accepts[0].amount).toBe("1000");
      expect(response.json.error).toBe("payment_required");
      expect(response.json.selectedPaidAction.path).toBe("/api/x402-discovery-audit");
      expect(response.json.selectedPaidAction.method).toBe("GET");
      expect(response.json.selectedPaidAction.maxAmountRequired).toBe("1000");
      expect(response.json.selectedPaidAction.command).toContain("/api/x402-discovery-audit");
      expect(response.json.selectedPaidAction.command).toContain("--max-amount 1000");

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
      expect(scoreBodySchema.agentName.description).toContain("agent service");
      expect(scoreBodySchema.listingText.description).toContain("buyer-facing listing copy");
      expect(scoreBodySchema.source.description).toContain("upgrade path");
      expect(challenge.extensions.bazaar.info.output.example.nextPaidAction.route).toContain("/api/listing-roast");
      expect(challenge.extensions.bazaar.info.output.example.nextPaidAction.command).toBeUndefined();
      expect(challenge.extensions.bazaar.info.output.example.nextPaidAction.body.source).toBe("listing-score-upgrade");

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

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.emptyDiscoveryProbes).toBe(1);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);
});
