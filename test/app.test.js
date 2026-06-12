import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
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

      const home = await fetchJson(server, "/");
      expect(home.status).toBe(200);
      expect(home.text).toContain("Copy $0.05 score command");
      expect(home.text).toContain("Copy $1 roast command");
      expect(home.text).toContain("Build your command");
      expect(home.text).toContain("View sample score");
      expect(home.text).toContain("Open examples JSON");

      const builder = await fetchJson(server, "/builder");
      expect(builder.status).toBe(200);
      expect(builder.text).toContain("Build a paid score command from your listing.");
      expect(builder.text).toContain("/api/listing-score");
      expect(builder.text).toContain("builderCommandBuilds");

      const sample = await fetchJson(server, "/sample");
      expect(sample.status).toBe(200);
      expect(sample.text).toContain("Sample the $0.05 listing score before paying.");
      expect(sample.text).toContain("/api/listing-score");
      expect(sample.text).toContain("Build your command");

      const sampleScore = await fetchJson(server, "/api/sample-score");
      expect(sampleScore.status).toBe(200);
      expect(sampleScore.json.price).toBe("$0.05");
      expect(sampleScore.json.command).toContain("--max-amount 50000");
      expect(sampleScore.json.output.endpoint).toBe("listing-score");

      const schema = await fetchJson(server, "/api/schema");
      expect(schema.status).toBe(200);
      expect(schema.json.service.price).toBe("$1.00");

      const scoreSchema = await fetchJson(server, "/api/score-schema");
      expect(scoreSchema.status).toBe(200);
      expect(scoreSchema.json.service.price).toBe("$0.05");

      const mcp = await fetchJson(server, "/.well-known/mcp.json");
      expect(mcp.status).toBe(200);
      expect(mcp.json.builder).toContain("/builder");
      expect(mcp.json.openApi).toContain("/openapi.json");
      expect(mcp.json.llms).toContain("/llms.txt");
      expect(mcp.json.tools.map((tool) => tool.path)).toEqual(["/api/listing-score", "/api/listing-roast"]);

      const examples = await fetchJson(server, "/api/examples");
      expect(examples.status).toBe(200);
      expect(examples.json.builder).toContain("/builder");
      expect(examples.json.openApi).toContain("/openapi.json");
      expect(examples.json.llms).toContain("/llms.txt");
      expect(examples.json.command).toContain("x402 pay");
      expect(examples.json.scoreCommand).toContain("/api/listing-score");
      expect(examples.json.scoreOutput.price).toBe("$0.05");
      expect(examples.json.output.price).toBe("$1.00");

      const openApi = await fetchJson(server, "/openapi.json");
      expect(openApi.status).toBe(200);
      expect(openApi.json.openapi).toBe("3.1.0");
      expect(openApi.json.paths["/api/listing-score"].post.summary).toContain("$0.05");

      const llms = await fetchJson(server, "/llms.txt");
      expect(llms.status).toBe(200);
      expect(llms.text).toContain("Command builder");
      expect(llms.text).toContain("/api/listing-score");

      const robots = await fetchJson(server, "/robots.txt");
      expect(robots.status).toBe(200);
      expect(robots.text).toContain("Sitemap:");

      const sitemap = await fetchJson(server, "/sitemap.xml");
      expect(sitemap.status).toBe(200);
      expect(sitemap.text).toContain("/builder");
      expect(sitemap.text).toContain("/sample");
      expect(sitemap.text).toContain("/api/sample-score");
      expect(sitemap.text).toContain("/openapi.json");
      expect(sitemap.text).toContain("/llms.txt");
      expect(sitemap.text).toContain("/api/examples");
      expect(sitemap.text).toContain("/api/score-schema");

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

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.status).toBe(200);
      expect(cashRegister.json.receiverWallet.network).toBe("eip155:84532");
      expect(cashRegister.json.receiverWallet.source).toBe("disabled_for_non_mainnet");
      expect(cashRegister.json.signals.homepageViews).toBe(1);
      expect(cashRegister.json.signals.builderViews).toBe(1);
      expect(cashRegister.json.signals.builderCommandBuilds).toBe(1);
      expect(cashRegister.json.signals.llmsViews).toBe(1);
      expect(cashRegister.json.signals.openApiViews).toBe(1);
      expect(cashRegister.json.signals.sampleViews).toBe(2);
      expect(cashRegister.json.signals.schemaViews).toBe(2);
      expect(cashRegister.json.signals.examplesViews).toBe(1);
      expect(cashRegister.json.signals.mcpViews).toBe(1);
      expect(cashRegister.json.signals.commandCopyClicks).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.roastValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.scoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.emptyDiscoveryProbes).toBe(0);
      expect(cashRegister.json.signals.invalidRequests).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("protects the paid route with a $1 x402 challenge", async () => {
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
      expect(challenge.accepts[0].amount).toBe("1000000");

      const cashRegister = await fetchJson(server, "/api/cash-register");
      expect(cashRegister.json.signals.unpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.validUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.roastValidUnpaidChallenges).toBe(1);
      expect(cashRegister.json.signals.scoreValidUnpaidChallenges).toBe(0);
      expect(cashRegister.json.signals.emptyDiscoveryProbes).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15000);

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

  it("protects the score route with a five cent x402 challenge", async () => {
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
      expect(challenge.accepts[0].amount).toBe("50000");

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
