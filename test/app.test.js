import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { requestExample } from "../src/roast.js";

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

describe("Listing Roast x402 service", () => {
  it("serves public metadata without payment", async () => {
    const app = createApp({ payTo: "0x000000000000000000000000000000000000dEaD" });
    const server = await listen(app);
    try {
      const health = await fetchJson(server, "/health");
      expect(health.status).toBe(200);
      expect(health.json.paidRoute).toBe("/api/listing-roast");

      const schema = await fetchJson(server, "/api/schema");
      expect(schema.status).toBe(200);
      expect(schema.json.service.price).toBe("$1.00");

      const mcp = await fetchJson(server, "/.well-known/mcp.json");
      expect(mcp.status).toBe(200);
      expect(mcp.json.tools[0].path).toBe("/api/listing-roast");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("protects the paid route with a $1 x402 challenge", async () => {
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
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

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
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
