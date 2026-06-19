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
      expect(health.headers.get("link")).toContain("/openapi.json");
      expect(health.headers.get("link")).toContain("/.well-known/openapi.json");
      expect(health.headers.get("link")).toContain("/.well-known/agent-card.json");
      expect(health.headers.get("link")).toContain("/.well-known/ai-plugin.json");
      expect(health.headers.get("link")).toContain("/.well-known/api-catalog");
      expect(health.headers.get("link")).toContain("/.well-known/agent-skills/index.json");
      expect(health.headers.get("link")).toContain("/llms-full.txt");
      expect(health.headers.get("link")).toContain("/index.md");
      expect(health.headers.get("link")).toContain("/.well-known/mcp");
      expect(health.headers.get("link")).toContain("/.well-known/mcp-server");
      expect(health.headers.get("link")).toContain("/.well-known/mcp/server-card.json");

      const home = await fetchJson(server, "/");
      expect(home.status).toBe(200);
      expect(home.headers.get("link")).toContain("/.well-known/x402.json");
      expect(home.text).toContain("Copy $0.001 indexed GET command");
      expect(home.text).toContain("Copy agent-listing command");
      expect(home.text).toContain("Agent listing conversion command");
      expect(home.text).toContain("/api/agent-listing-conversion");
      expect(home.text).toContain("Copy instant score command");
      expect(home.text).toContain("Preferred indexed listing-roast GET command");
      expect(home.text).toContain("Copy x402 ping command");
      expect(home.text).toContain("Copy $0.001 site audit command");
      expect(home.text).toContain("Copy discovery audit command");
      expect(home.text).toContain("Copy $0.005 score command");
      expect(home.text).toContain("Copy $0.01 roast command");
      expect(home.text).toContain("Build your command");
      expect(home.text).toContain("View sample score");
      expect(home.text).toContain("Open examples JSON");
      expect(home.text).toContain("application/ld+json");
      expect(home.text).toContain("Listing Roast x402 paid routes");
      expect(home.text).toContain("/llms-full.txt");
      expect(home.text).toContain("/.well-known/mcp/server-card.json");

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

      const schema = await fetchJson(server, "/api/schema");
      expect(schema.status).toBe(200);
      expect(schema.json.service.price).toBe("$0.01");

      const scoreSchema = await fetchJson(server, "/api/score-schema");
      expect(scoreSchema.status).toBe(200);
      expect(scoreSchema.json.service.price).toBe("$0.005");

      const mcp = await fetchJson(server, "/.well-known/mcp.json");
      expect(mcp.status).toBe(200);
      expect(mcp.json.builder).toContain("/builder");
      expect(mcp.json.openApi).toContain("/openapi.json");
      expect(mcp.json.openApiAliases[0]).toContain("/.well-known/openapi.json");
      expect(mcp.json.llms).toContain("/llms.txt");
      expect(mcp.json.x402Manifest).toContain("/x402.json");
      expect(mcp.json.agentCard).toContain("/.well-known/agent-card.json");
      expect(mcp.json.agentCardAliases[0]).toContain("/.well-known/agent.json");
      expect(mcp.json.aiPlugin).toContain("/.well-known/ai-plugin.json");
      expect(mcp.json.apiCatalog).toContain("/.well-known/api-catalog");
      expect(mcp.json.agentSkills).toContain("/.well-known/agent-skills/index.json");
      expect(mcp.json.agentSkill).toContain("/.well-known/agent-skills/listing-roast-x402/SKILL.md");
      expect(mcp.json.llmsFull).toContain("/llms-full.txt");
      expect(mcp.json.markdown).toContain("/index.md");
      expect(mcp.json.mcpAliases[0]).toContain("/.well-known/mcp");
      expect(mcp.json.mcpServerCard).toContain("/.well-known/mcp/server-card.json");
      expect(mcp.json.payNow).toContain("/api/pay-now");
      expect(mcp.json.keywords).toContain("marketplace listing score");
      expect(mcp.json.tools[0].description).toContain("marketplace listing score");
      expect(mcp.json.tools[0].command).toContain("/api/listing-roast");
      expect(mcp.json.tools[0].command).toContain("--max-amount 1000");
      expect(mcp.json.tools[3].command).toContain("/api/agent-listing-conversion");
      expect(mcp.json.tools[3].command).toContain("--max-amount 1000");
      expect(mcp.json.tools[6].command).toContain("/api/x402-discovery-audit");
      expect(mcp.json.tools[6].command).toContain("--max-amount 10000");
      expect(mcp.json.tools[0].payment.maxAmountRequired).toBe("1000");
      expect(mcp.json.tools[0].payment.preferredFirstPaidAction).toBe(true);
      expect(mcp.json.tools[1].payment.maxAmountRequired).toBe("1000");
      expect(mcp.json.tools[1].payment.preferredFirstPaidAction).toBe(false);
      expect(mcp.json.tools.map((tool) => tool.path)).toEqual(["/api/listing-roast", "/api/instant-listing-score", "/api/x402-marketplace-conversion", "/api/agent-listing-conversion", "/api/x402-ping", "/api/x402-site-audit", "/api/x402-discovery-audit", "/api/listing-score", "/api/listing-roast"]);

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
      expect(mcpServerCard.json.links.llmsFull).toContain("/llms-full.txt");

      const x402Manifest = await fetchJson(server, "/x402.json");
      expect(x402Manifest.status).toBe(200);
      expect(x402Manifest.json.name).toBe("Listing Roast x402");
      expect(x402Manifest.json.serviceName).toBe("Listing Roast x402");
      expect(x402Manifest.json.displayName).toBe("Listing Roast x402");
      expect(x402Manifest.json.payment.primaryNetwork).toBe("base");
      expect(x402Manifest.json.payment.network).toBe("eip155:84532");
      expect(x402Manifest.json.payment.currency).toBe("USDC");
      expect(x402Manifest.json.payment.asset).toBe("USDC");
      expect(x402Manifest.json.payment.x402.primaryNetwork).toBe("base");
      expect(x402Manifest.json.payment.x402.network).toBe("eip155:84532");
      expect(x402Manifest.json.payment.x402.asset).toBe("USDC");
      expect(x402Manifest.json.capabilities.tools).toBe(9);
      expect(x402Manifest.json.keywords).toContain("paid API listing");
      expect(x402Manifest.json.keywords).toContain("x402 bazaar discovery audit");
      expect(x402Manifest.json.openApiAliases[0]).toContain("/.well-known/openapi.json");
      expect(x402Manifest.json.agentCard).toContain("/.well-known/agent-card.json");
      expect(x402Manifest.json.agentCardAliases[0]).toContain("/.well-known/agent.json");
      expect(x402Manifest.json.aiPlugin).toContain("/.well-known/ai-plugin.json");
      expect(x402Manifest.json.apiCatalog).toContain("/.well-known/api-catalog");
      expect(x402Manifest.json.agentSkills).toContain("/.well-known/agent-skills/index.json");
      expect(x402Manifest.json.payNow).toContain("/api/pay-now");
      expect(x402Manifest.json.aliases.some((url) => url.endsWith("/.well-known/x402"))).toBe(true);
      expect(x402Manifest.json.recommendedFirstPaidAction.route).toContain("/api/listing-roast");
      expect(x402Manifest.json.recommendedFirstPaidAction.maxAmountRequired).toBe("1000");
      expect(x402Manifest.json.resources.map((resource) => resource.id)).toEqual(["indexed_roast_quick_score", "instant_listing_score", "x402_marketplace_conversion_score", "agent_listing_conversion_score", "x402_ping", "x402_site_audit", "x402_discovery_audit", "listing_score", "listing_roast"]);
      expect(x402Manifest.json.resources.map((resource) => resource.path)).toEqual(["/api/listing-roast", "/api/instant-listing-score", "/api/x402-marketplace-conversion", "/api/agent-listing-conversion", "/api/x402-ping", "/api/x402-site-audit", "/api/x402-discovery-audit", "/api/listing-score", "/api/listing-roast"]);
      expect(x402Manifest.json.resources[0].keywords).toContain("listing roast");
      expect(x402Manifest.json.resources[0].keywords).toContain("buyer-agent skip reasons");
      expect(x402Manifest.json.resources[0].keywords).toContain("agent service listing clarity");
      expect(x402Manifest.json.resources[0].price).toBe("$0.001");
      expect(x402Manifest.json.resources[0].maxAmountRequired).toBe("1000");
      expect(x402Manifest.json.resources[1].price).toBe("$0.001");
      expect(x402Manifest.json.resources[1].method).toBe("GET");
      expect(x402Manifest.json.resources[1].maxAmountRequired).toBe("1000");
      expect(x402Manifest.json.resources[2].price).toBe("$0.001");
      expect(x402Manifest.json.resources[2].keywords).toContain("x402 marketplace conversion");
      expect(x402Manifest.json.resources[2].maxAmountRequired).toBe("1000");
      expect(x402Manifest.json.resources[3].price).toBe("$0.001");
      expect(x402Manifest.json.resources[3].keywords).toContain("agent service listing clarity");
      expect(x402Manifest.json.resources[3].keywords).toContain("buyer-agent skip reasons");
      expect(x402Manifest.json.resources[3].maxAmountRequired).toBe("1000");
      expect(x402Manifest.json.resources[4].price).toBe("$0.001");
      expect(x402Manifest.json.resources[4].keywords).toContain("x402 ping");
      expect(x402Manifest.json.resources[4].maxAmountRequired).toBe("1000");
      expect(x402Manifest.json.resources[5].price).toBe("$0.001");
      expect(x402Manifest.json.resources[5].keywords).toContain("x402 site audit");
      expect(x402Manifest.json.resources[5].keywords).toContain("paid API preflight");
      expect(x402Manifest.json.resources[5].keywords).toContain("x402 route health check");
      expect(x402Manifest.json.resources[5].maxAmountRequired).toBe("1000");
      expect(x402Manifest.json.resources[6].price).toBe("$0.01");
      expect(x402Manifest.json.resources[6].keywords).toContain("x402 bazaar discovery audit");
      expect(x402Manifest.json.resources[6].maxAmountRequired).toBe("10000");
      expect(x402Manifest.json.resources[7].price).toBe("$0.005");
      expect(x402Manifest.json.resources[7].maxAmountRequired).toBe("5000");
      expect(x402Manifest.json.resources[8].price).toBe("$0.01");
      expect(x402Manifest.json.resources[8].maxAmountRequired).toBe("10000");

      const wellKnownX402Manifest = await fetchJson(server, "/.well-known/x402.json");
      expect(wellKnownX402Manifest.status).toBe(200);
      expect(wellKnownX402Manifest.json.resources[0].command).toContain("--max-amount 1000");
      expect(wellKnownX402Manifest.json.resources[0].command).toContain("/api/listing-roast");
      expect(wellKnownX402Manifest.json.resources[1].command).toContain("/api/instant-listing-score");
      expect(wellKnownX402Manifest.json.resources[2].command).toContain("/api/x402-marketplace-conversion");
      expect(wellKnownX402Manifest.json.resources[3].command).toContain("/api/agent-listing-conversion");
      expect(wellKnownX402Manifest.json.resources[4].command).toContain("/api/x402-ping");
      expect(wellKnownX402Manifest.json.resources[5].command).toContain("/api/x402-site-audit");
      expect(wellKnownX402Manifest.json.resources[6].command).toContain("/api/x402-discovery-audit");
      expect(wellKnownX402Manifest.json.resources[8].command).toContain("--max-amount 10000");

      const wellKnownX402Alias = await fetchJson(server, "/.well-known/x402");
      expect(wellKnownX402Alias.status).toBe(200);
      expect(wellKnownX402Alias.json.resources[0].path).toBe("/api/listing-roast");
      expect(wellKnownX402Alias.json.payNow).toContain("/api/pay-now");

      const agentCard = await fetchJson(server, "/.well-known/agent-card.json");
      expect(agentCard.status).toBe(200);
      expect(agentCard.json.protocolVersion).toBe("0.3.0");
      expect(agentCard.json.name).toBe("Listing Roast x402");
      expect(agentCard.json.url).toContain("/api/listing-roast");
      expect(agentCard.json.preferredTransport).toBe("HTTP+JSON");
      expect(agentCard.json.additionalInterfaces.map((item) => item.transport)).toEqual(["HTTP+JSON", "OPENAPI", "X402", "MCP", "MCP-SERVER-CARD"]);
      expect(agentCard.json.securitySchemes.x402.name).toBe("X-PAYMENT");
      expect(agentCard.json.security[0]).toEqual({ x402: [] });
      expect(agentCard.json.skills.map((skill) => skill.id)).toContain("agent-listing-conversion-score");
      expect(agentCard.json.skills.map((skill) => skill.id)).toContain("x402-site-audit");
      expect(agentCard.json.skills[0].examples[0]).toContain("npx awal@2.8.0 x402 pay");
      expect(agentCard.json.skills[0].examples[0]).toContain("/api/listing-roast");
      expect(agentCard.json.skills[0].metadata.maxAmountRequired).toBe("1000");
      expect(agentCard.json.skills[3].examples[0]).toContain("/api/x402-discovery-audit");
      expect(agentCard.json.skills[3].metadata.maxAmountRequired).toBe("10000");
      expect(agentCard.json.metadata.x402Manifest).toContain("/x402.json");
      expect(agentCard.json.metadata.agentSkills).toContain("/.well-known/agent-skills/index.json");
      expect(agentCard.json.metadata.a2aTaskEndpointAvailable).toBe(false);

      const agentJson = await fetchJson(server, "/.well-known/agent.json");
      expect(agentJson.status).toBe(200);
      expect(agentJson.json.skills[0].id).toBe(agentCard.json.skills[0].id);

      const aiPlugin = await fetchJson(server, "/.well-known/ai-plugin.json");
      expect(aiPlugin.status).toBe(200);
      expect(aiPlugin.json.schema_version).toBe("v1");
      expect(aiPlugin.json.name_for_model).toBe("listing_roast_x402");
      expect(aiPlugin.json.description_for_model).toContain("x402 payment");
      expect(aiPlugin.json.description_for_model).toContain("/api/listing-roast");
      expect(aiPlugin.json.auth.type).toBe("none");
      expect(aiPlugin.json.api.type).toBe("openapi");
      expect(aiPlugin.json.api.url).toContain("/.well-known/openapi.json");
      expect(aiPlugin.json.x_listing_roast.agentSkills).toContain("/.well-known/agent-skills/index.json");
      expect(aiPlugin.json.x_listing_roast.recommendedFirstPaidAction.maxAmountRequired).toBe("1000");

      const apiCatalogHead = await fetch(`http://127.0.0.1:${server.address().port}/.well-known/api-catalog`, { method: "HEAD" });
      expect(apiCatalogHead.status).toBe(200);
      expect(apiCatalogHead.headers.get("content-type")).toContain("application/linkset+json");
      expect(apiCatalogHead.headers.get("content-type")).toContain("rfc9727");
      expect(apiCatalogHead.headers.get("link")).toContain("rel=\"api-catalog\"");

      const apiCatalog = await fetchJson(server, "/.well-known/api-catalog");
      expect(apiCatalog.status).toBe(200);
      expect(apiCatalog.headers.get("content-type")).toContain("application/linkset+json");
      expect(apiCatalog.headers.get("content-type")).toContain("rfc9727");
      expect(apiCatalog.json.linkset[0].anchor).toContain("/.well-known/api-catalog");
      expect(apiCatalog.json.linkset[0].item.map((item) => item.href)).toContain("http://localhost:8787/api/listing-roast");
      expect(apiCatalog.json.linkset[0].item.map((item) => item.href)).toContain("http://localhost:8787/api/agent-listing-conversion");
      expect(apiCatalog.json.linkset[0]["service-desc"][0].href).toContain("/openapi.json");
      expect(apiCatalog.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/x402.json");
      expect(apiCatalog.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/.well-known/ai-plugin.json");
      expect(apiCatalog.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/.well-known/agent-skills/index.json");
      expect(apiCatalog.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/.well-known/mcp/server-card.json");
      expect(apiCatalog.json.linkset[0]["service-meta"].map((item) => item.href)).toContain("http://localhost:8787/llms-full.txt");
      expect(apiCatalog.json.linkset[0].status[0].href).toContain("/health");

      const agentSkillsHead = await fetch(`http://127.0.0.1:${server.address().port}/.well-known/agent-skills/index.json`, { method: "HEAD" });
      expect(agentSkillsHead.status).toBe(200);
      expect(agentSkillsHead.headers.get("content-type")).toContain("application/json");

      const agentSkills = await fetchJson(server, "/.well-known/agent-skills/index.json");
      expect(agentSkills.status).toBe(200);
      expect(agentSkills.headers.get("access-control-allow-origin")).toBe("*");
      expect(agentSkills.json.$schema).toBe("https://schemas.agentskills.io/discovery/0.2.0/schema.json");
      expect(agentSkills.json.skills[0].name).toBe("listing-roast-x402");
      expect(agentSkills.json.skills[0].type).toBe("skill-md");
      expect(agentSkills.json.skills[0].url).toContain("/.well-known/agent-skills/listing-roast-x402/SKILL.md");

      const agentSkillHead = await fetch(`http://127.0.0.1:${server.address().port}/.well-known/agent-skills/listing-roast-x402/SKILL.md`, { method: "HEAD" });
      expect(agentSkillHead.status).toBe(200);
      expect(agentSkillHead.headers.get("content-type")).toContain("text/markdown");

      const agentSkill = await fetchJson(server, "/.well-known/agent-skills/listing-roast-x402/SKILL.md");
      expect(agentSkill.status).toBe(200);
      expect(agentSkill.headers.get("access-control-allow-origin")).toBe("*");
      expect(agentSkill.text).toContain("name: listing-roast-x402");
      expect(agentSkill.text).toContain("Do not call paid routes unless the buyer explicitly intends to pay");
      expect(agentSkill.text).toContain("/api/listing-roast");
      expect(agentSkill.text).toContain("/api/agent-listing-conversion");
      expect(agentSkills.json.skills[0].digest).toBe(`sha256:${createHash("sha256").update(agentSkill.text).digest("hex")}`);

      const examples = await fetchJson(server, "/api/examples");
      expect(examples.status).toBe(200);
      expect(examples.json.builder).toContain("/builder");
      expect(examples.json.openApi).toContain("/openapi.json");
      expect(examples.json.openApiAliases[0]).toContain("/.well-known/openapi.json");
      expect(examples.json.llms).toContain("/llms.txt");
      expect(examples.json.llmsFull).toContain("/llms-full.txt");
      expect(examples.json.markdown).toContain("/index.md");
      expect(examples.json.x402Manifest).toContain("/x402.json");
      expect(examples.json.x402ManifestAliases.some((url) => url.endsWith("/.well-known/x402"))).toBe(true);
      expect(examples.json.agentCard).toContain("/.well-known/agent-card.json");
      expect(examples.json.agentCardAliases[0]).toContain("/.well-known/agent.json");
      expect(examples.json.aiPlugin).toContain("/.well-known/ai-plugin.json");
      expect(examples.json.apiCatalog).toContain("/.well-known/api-catalog");
      expect(examples.json.agentSkills).toContain("/.well-known/agent-skills/index.json");
      expect(examples.json.agentSkill).toContain("/.well-known/agent-skills/listing-roast-x402/SKILL.md");
      expect(examples.json.mcp).toContain("/.well-known/mcp.json");
      expect(examples.json.mcpAliases[1]).toContain("/.well-known/mcp-server");
      expect(examples.json.mcpServerCard).toContain("/.well-known/mcp/server-card.json");
      expect(examples.json.payNowUrl).toContain("/api/pay-now");
      expect(examples.json.payNow.route).toContain("/api/listing-roast");
      expect(examples.json.payNow.command).toContain("--max-amount 1000");
      expect(examples.json.payNow.noSpendNote).toContain("Fetching this endpoint is free");
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
      expect(examples.json.indexedRoastGetCommand).toContain("--max-amount 1000");
      expect(examples.json.pingCommand).toContain("--max-amount 1000");
      expect(examples.json.siteAuditCommand).toContain("--max-amount 1000");
      expect(examples.json.discoveryAuditCommand).toContain("--max-amount 10000");
      expect(examples.json.instantScoreOutput.price).toBe("$0.001");
      expect(examples.json.instantScoreOutput.nextPaidAction.maxAmountRequired).toBe("5000");
      expect(examples.json.instantScoreOutput.nextPaidAction.command).toContain("/api/listing-score");
      expect(examples.json.conversionScoreOutput.endpoint).toBe("x402-marketplace-conversion-score");
      expect(examples.json.conversionScoreOutput.nextPaidAction.maxAmountRequired).toBe("10000");
      expect(examples.json.agentListingConversionOutput.endpoint).toBe("agent-listing-conversion-score");
      expect(examples.json.agentListingConversionOutput.nextPaidAction.maxAmountRequired).toBe("10000");
      expect(examples.json.indexedRoastGetOutput.endpoint).toBe("listing-roast-quick-score");
      expect(examples.json.indexedRoastGetOutput.nextPaidAction.maxAmountRequired).toBe("10000");
      expect(examples.json.indexedRoastGetOutput.nextPaidAction.command).toContain("/api/listing-roast");
      expect(examples.json.indexedRoastGetOutput.nextPaidAction.command).toContain("--max-amount 10000");
      expect(examples.json.pingOutput.endpoint).toBe("x402-ping");
      expect(examples.json.siteAuditOutput.endpoint).toBe("x402-site-audit");
      expect(examples.json.discoveryAuditOutput.endpoint).toBe("x402-discovery-audit");
      expect(examples.json.command).toContain("x402 pay");
      expect(examples.json.scoreCommand).toContain("/api/listing-score");
      expect(examples.json.scoreOutput.price).toBe("$0.005");
      expect(examples.json.output.price).toBe("$0.01");

      const openApi = await fetchJson(server, "/openapi.json");
      expect(openApi.status).toBe(200);
      expect(openApi.json.openapi).toBe("3.1.0");

      const wellKnownOpenApi = await fetchJson(server, "/.well-known/openapi.json");
      expect(wellKnownOpenApi.status).toBe(200);
      expect(wellKnownOpenApi.json.openapi).toBe("3.1.0");
      expect(wellKnownOpenApi.json.info.title).toBe(openApi.json.info.title);

      expect(openApi.json.info["x-keywords"]).toContain("x402 listing");
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
      expect(openApi.json.paths["/api/agent-listing-conversion"].get.summary).toContain("agent listing conversion");
      expect(openApi.json.paths["/api/agent-listing-conversion"].get.description).toContain("agent service listing clarity");
      expect(openApi.json.paths["/api/agent-listing-conversion"].get.description).toContain("buyer-agent skip reasons");
      expect(openApi.json.paths["/api/x402-ping"].get["x-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/x402-ping"].get["x-x402-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/x402-ping"].get.summary).toContain("$0.001");
      expect(openApi.json.paths["/api/x402-site-audit"].get["x-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/x402-site-audit"].get["x-x402-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/x402-site-audit"].get.operationId).toBe("getX402ServiceDiscoverabilityAuditPaidApiPreflightRouteHealthCheck");
      expect(openApi.json.paths["/api/x402-site-audit"].get.summary).toContain("$0.001");
      expect(openApi.json.paths["/api/x402-site-audit"].get.summary).toContain("x402 service discoverability audit");
      expect(openApi.json.paths["/api/x402-site-audit"].get.summary).toContain("paid API preflight");
      expect(openApi.json.paths["/api/x402-discovery-audit"].post["x-price"]).toBe("$0.01");
      expect(openApi.json.paths["/api/x402-discovery-audit"].post["x-x402-price"]).toBe("$0.01");
      expect(openApi.json.paths["/api/x402-discovery-audit"].post.summary).toContain("$0.01");
      expect(openApi.json.paths["/api/listing-roast"].get.operationId).toBe("getIndexedListingRoastX402MarketplaceConversionQuickScore");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].maxAmountRequired).toBe("1000");
      expect(openApi.json.paths["/api/listing-roast"].get["x-payment"].preferredFirstPaidAction).toBe(true);
      expect(openApi.json.paths["/api/listing-roast"].get["x-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/listing-roast"].get["x-x402-price"]).toBe("$0.001");
      expect(openApi.json.paths["/api/listing-roast"].post["x-payment"].maxAmountRequired).toBe("10000");
      expect(openApi.json.paths["/api/listing-roast"].post["x-price"]).toBe("$0.01");
      expect(openApi.json.paths["/api/listing-roast"].post["x-x402-price"]).toBe("$0.01");
      expect(openApi.json.paths["/api/listing-roast"].get.summary).toContain("$0.001");
      expect(openApi.json.paths["/api/listing-roast"].get.summary).toContain("x402 marketplace conversion");
      expect(openApi.json.paths["/api/listing-roast"].get.description).toContain("buyer-agent skip reasons");
      expect(openApi.json.paths["/api/listing-roast"].get.description).toContain("agent service listing clarity");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[200].content["application/json"].example.nextPaidAction.maxAmountRequired).toBe("10000");
      expect(openApi.json.paths["/api/listing-roast"].get.responses[200].content["application/json"].example.nextPaidAction.command).toContain("/api/listing-roast");
      expect(openApi.json.paths["/api/pay-now"].get.operationId).toBe("getPayNow");
      expect(openApi.json.paths["/api/listing-score"].post.summary).toContain("marketplace listing score");
      expect(openApi.json.paths["/api/listing-score"].post["x-payment"].maxAmountRequired).toBe("5000");
      expect(openApi.json.paths["/api/listing-score"].post["x-price"]).toBe("$0.005");
      expect(openApi.json.paths["/api/listing-score"].post["x-x402-price"]).toBe("$0.005");
      expect(openApi.json["x-listing-roast"].payNow).toContain("/api/pay-now");
      expect(openApi.json["x-listing-roast"].x402ManifestAliases.some((url) => url.endsWith("/.well-known/x402"))).toBe(true);
      expect(openApi.json["x-listing-roast"].agentCard).toContain("/.well-known/agent-card.json");
      expect(openApi.json["x-listing-roast"].agentCardAliases[0]).toContain("/.well-known/agent.json");
      expect(openApi.json["x-listing-roast"].aiPlugin).toContain("/.well-known/ai-plugin.json");
      expect(openApi.json["x-listing-roast"].apiCatalog).toContain("/.well-known/api-catalog");
      expect(openApi.json["x-listing-roast"].agentSkills).toContain("/.well-known/agent-skills/index.json");
      expect(openApi.json["x-listing-roast"].llmsFull).toContain("/llms-full.txt");
      expect(openApi.json["x-listing-roast"].mcpServerCard).toContain("/.well-known/mcp/server-card.json");
      expect(openApi.json["x-listing-roast"].recommendedFirstPaidAction.route).toContain("/api/listing-roast");
      expect(openApi.json["x-listing-roast"].x402Manifest).toContain("/x402.json");
      expect(openApi.json["x-listing-roast"].keywords).toContain("paid API listing");

      const llms = await fetchJson(server, "/llms.txt");
      expect(llms.status).toBe(200);
      expect(llms.text).toContain("Command builder");
      expect(llms.text).toContain("/api/instant-listing-score");
      expect(llms.text).toContain("/api/x402-marketplace-conversion");
      expect(llms.text).toContain("/api/agent-listing-conversion");
      expect(llms.text).toContain("/api/x402-ping");
      expect(llms.text).toContain("/api/x402-site-audit");
      expect(llms.text).toContain("/api/x402-discovery-audit");
      expect(llms.text).toContain("/api/listing-score");
      expect(llms.text).toContain("/api/pay-now");
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
      expect(llms.text).toContain("x402 pay http://localhost:8787/api/listing-roast");
      expect(llms.text).toContain("/api/agent-listing-conversion");
      expect(llms.text).toContain("--max-amount 1000");
      expect(llms.text).toContain("--max-amount 10000");
      expect(llms.text).toContain("already-indexed listing-roast URL");
      expect(llms.text).toContain("/x402.json");
      expect(llms.text).toContain("marketplace listing score");

      const llmsFull = await fetchJson(server, "/llms-full.txt");
      expect(llmsFull.status).toBe(200);
      expect(llmsFull.headers.get("content-type")).toContain("text/markdown");
      expect(llmsFull.text).toContain("# Listing Roast x402");
      expect(llmsFull.text).toContain("/.well-known/mcp/server-card.json");

      const indexMarkdown = await fetchJson(server, "/index.md");
      expect(indexMarkdown.status).toBe(200);
      expect(indexMarkdown.headers.get("content-type")).toContain("text/markdown");
      expect(indexMarkdown.text).toContain("Preferred First Paid Route");

      const robots = await fetchJson(server, "/robots.txt");
      expect(robots.status).toBe(200);
      expect(robots.text).toContain("Sitemap:");
      expect(robots.text).toContain("User-agent: ChatGPT-User");
      expect(robots.text).toContain("User-agent: ClaudeBot");
      expect(robots.text).toContain("Content-Signal: search=yes,ai-input=yes,ai-train=no");
      expect(robots.text).toContain("/x402.json");
      expect(robots.text).toContain("/.well-known/agent-skills/index.json");
      expect(robots.text).toContain("/.well-known/mcp/server-card.json");
      expect(robots.text).toContain("Preferred paid route after explicit buyer intent");

      const sitemap = await fetchJson(server, "/sitemap.xml");
      expect(sitemap.status).toBe(200);
      expect(sitemap.text).toContain("/builder");
      expect(sitemap.text).toContain("/sample");
      expect(sitemap.text).toContain("/api/pay-now");
      expect(sitemap.text).toContain("/api/instant-listing-score");
      expect(sitemap.text).toContain("/api/x402-marketplace-conversion");
      expect(sitemap.text).toContain("/api/agent-listing-conversion");
      expect(sitemap.text).toContain("/api/x402-ping");
      expect(sitemap.text).toContain("/api/x402-site-audit");
      expect(sitemap.text).toContain("/api/x402-discovery-audit");
      expect(sitemap.text).toContain("/api/sample-score");
      expect(sitemap.text).toContain("/openapi.json");
      expect(sitemap.text).toContain("/.well-known/openapi.json");
      expect(sitemap.text).toContain("/llms.txt");
      expect(sitemap.text).toContain("/llms-full.txt");
      expect(sitemap.text).toContain("/index.md");
      expect(sitemap.text).toContain("/x402.json");
      expect(sitemap.text).toContain("/.well-known/x402.json");
      expect(sitemap.text).toContain("/.well-known/x402</loc>");
      expect(sitemap.text).toContain("/.well-known/agent-card.json");
      expect(sitemap.text).toContain("/.well-known/agent.json");
      expect(sitemap.text).toContain("/.well-known/ai-plugin.json");
      expect(sitemap.text).toContain("/.well-known/api-catalog");
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
      expect(payNow.json.method).toBe("GET");
      expect(payNow.json.price).toBe("$0.001");
      expect(payNow.json.maxAmountRequired).toBe("1000");
      expect(payNow.json.command).toContain("/api/listing-roast");
      expect(payNow.json.command).toContain("--max-amount 1000");
      expect(payNow.json.expectedChallenge.status).toBe(402);
      expect(payNow.json.noSpendNote).toContain("Fetching this endpoint is free");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.status).toBe(200);
      expect(cashRegister.json.receiverWallet.network).toBe("eip155:84532");
      expect(cashRegister.json.receiverWallet.source).toBe("disabled_for_non_mainnet");
      expect(cashRegister.json.signals.homepageViews).toBe(2);
      expect(cashRegister.json.signals.builderViews).toBe(1);
      expect(cashRegister.json.signals.builderCommandBuilds).toBe(1);
      expect(cashRegister.json.signals.llmsViews).toBe(3);
      expect(cashRegister.json.signals.openApiViews).toBe(2);
      expect(cashRegister.json.signals.sampleViews).toBe(2);
      expect(cashRegister.json.signals.schemaViews).toBe(2);
      expect(cashRegister.json.signals.examplesViews).toBe(1);
      expect(cashRegister.json.signals.payNowViews).toBe(1);
      expect(cashRegister.json.signals.mcpViews).toBe(4);
      expect(cashRegister.json.signals.x402ManifestViews).toBe(3);
      expect(cashRegister.json.signals.agentCardViews).toBe(2);
      expect(cashRegister.json.signals.aiPluginViews).toBe(1);
      expect(cashRegister.json.signals.apiCatalogViews).toBe(1);
      expect(cashRegister.json.signals.agentSkillsViews).toBe(1);
      expect(cashRegister.json.signals.agentSkillViews).toBe(1);
      expect(cashRegister.json.signals.commandCopyClicks).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.instantScoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.indexedRoastGetValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.pingValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.roastValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.scoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.discoveryAuditValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.emptyDiscoveryProbes).toBe(0);
      expect(cashRegister.json.signals.invalidRequests).toBe(0);
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

  it("rejects HEAD probes on paid routes without recording revenue", async () => {
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const headPing = await fetchJson(server, "/api/x402-ping", { method: "HEAD" });
      expect(headPing.status).toBe(405);
      expect(headPing.headers.get("allow")).toBe("GET");
      expect(headPing.headers.get("payment-required")).toBeNull();
      expect(headPing.headers.get("link")).toContain("/x402.json");

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
      expect(headAudit.headers.get("allow")).toBe("POST");
      expect(headAudit.headers.get("payment-required")).toBeNull();

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.paidCompletions).toBe(0);
      expect(cashRegister.json.signals.unpaidChallenges).toBe(0);
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
    await recordPaidCompletion("instantScore", 0.001);
    await recordPaidCompletion("indexedRoastGet", 0.001);
    await recordPaidCompletion("listingScorePost", 0.005);
    await recordPaidCompletion("x402SiteAudit", 0.001);
    await recordPaidCompletion("x402DiscoveryAudit", 0.01);
    await recordPaidCompletion("x402Ping", 0.001);
    await recordPaidCompletion("listingRoast", 0.01);

    const cashRegister = await getCashRegister();
    expect(cashRegister.paidCompletions).toBe(7);
    expect(cashRegister.estimatedGrossRevenueUsd).toBe("0.029");
    expect(cashRegister.listingScoreCompletions).toBe(3);
    expect(cashRegister.listingScoreEstimatedRevenueUsd).toBe("$0.007");
    expect(cashRegister.instantScoreCompletions).toBe(1);
    expect(cashRegister.indexedRoastGetCompletions).toBe(1);
    expect(cashRegister.listingScorePostCompletions).toBe(1);
    expect(cashRegister.x402SiteAuditCompletions).toBe(1);
    expect(cashRegister.x402DiscoveryAuditCompletions).toBe(2);
    expect(cashRegister.x402DiscoveryAuditEstimatedRevenueUsd).toBe("$0.011");
    expect(cashRegister.x402PingCompletions).toBe(1);
    expect(cashRegister.listingRoastCompletions).toBe(1);
  });

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
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.accepts[0].amount).toBe("1000");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.instantScoreValidUnpaidChallenges).toBe(1);
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

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.instantScoreValidUnpaidChallenges).toBe(1);
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
      const response = await fetchJson(server, "/api/agent-listing-conversion");

      expect(response.status).toBe(402);
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.error).toBe("Payment required");
      expect(challenge.resource.url).toContain("/api/agent-listing-conversion");
      expect(challenge.resource.description).toContain("$0.001");
      expect(challenge.resource.description).toContain("Agent Listing Conversion");
      expect(challenge.resource.description).toContain("Listing Roast");
      expect(challenge.resource.description).toContain("buyer-agent skip reasons");
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.accepts[0].amount).toBe("1000");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.instantScoreValidUnpaidChallenges).toBe(1);
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
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const response = await fetchJson(server, "/api/listing-roast");

      expect(response.status).toBe(402);
      const challenge = readPaymentRequiredHeader(response.headers);
      expect(challenge.error).toBe("Payment required");
      expect(challenge.resource.url).toContain("/api/listing-roast");
      expect(challenge.resource.description).toContain("$0.001");
      expect(challenge.resource.description).toContain("buyer-agent skip reasons");
      expect(challenge.resource.description).toContain("agent service listing clarity");
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.accepts[0].amount).toBe("1000");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.instantScoreValidUnpaidChallenges).toBe(0);
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
      expect(challenge.accepts[0].network).toBe("eip155:84532");
      expect(challenge.accepts[0].amount).toBe("1000");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.discoveryAuditValidUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.instantScoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.pingValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.emptyDiscoveryProbes).toBe(0);
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

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.discoveryAuditValidUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.scoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.emptyDiscoveryProbes).toBe(0);
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
