import net from "node:net";

import { z } from "zod";

const CDP_DISCOVERY_BASE = "https://api.cdp.coinbase.com/platform/v2/x402/discovery";
const DEFAULT_TIMEOUT_MS = 4500;
const SETTLE_RESOURCE_ACTION = "Confirm the buyer/client settle request includes paymentPayload.resource for this exact endpoint and preserves the Bazaar extension metadata; Bazaar catalogs settled resources, not unpaid probes.";

const PRIVATE_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "0.0.0.0",
  "127.0.0.1",
  "::1"
]);

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254)
  );
}

function isPrivateIpv6(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

function assertPublicHttpsUrl(value) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const ipVersion = net.isIP(hostname);

  if (url.protocol !== "https:") {
    throw new Error("endpointUrl must use https");
  }

  if (
    PRIVATE_HOSTS.has(hostname) ||
    hostname.endsWith(".local") ||
    (ipVersion === 4 && isPrivateIpv4(hostname)) ||
    (ipVersion === 6 && isPrivateIpv6(hostname))
  ) {
    throw new Error("endpointUrl must be a public HTTPS URL");
  }

  return url;
}

function publicHttpsUrlSchema() {
  return z.string().trim().url().max(600).refine((value) => {
    try {
      assertPublicHttpsUrl(value);
      return true;
    } catch {
      return false;
    }
  }, "endpointUrl must be a public HTTPS URL");
}

export const discoveryAuditRequestSchema = z
  .object({
    endpointUrl: publicHttpsUrlSchema(),
    method: z.enum(["GET", "POST"]).default("GET"),
    expectedAmount: z.string().trim().regex(/^\d+$/).max(24).optional(),
    expectedNetwork: z.string().trim().min(3).max(80).optional(),
    searchQuery: z.string().trim().min(2).max(180).optional(),
    requestBody: z.union([z.record(z.unknown()), z.string().max(4000)]).optional()
  })
  .strict();

export const discoveryAuditRequestExample = {
  endpointUrl: "https://listing-roast-x402-service-production.up.railway.app/api/listing-roast",
  method: "GET",
  expectedAmount: "1000",
  expectedNetwork: "eip155:8453",
  searchQuery: "listing roast"
};

export const discoveryAuditOutputSchema = {
  type: "object",
  required: ["service", "endpoint", "price", "verdict", "auditedAt", "direct402", "bazaarDiscovery", "catalogRefresh", "mismatches", "nextActions", "safety"],
  properties: {
    service: { type: "string" },
    endpoint: { type: "string" },
    price: { type: "string" },
    verdict: { type: "string" },
    auditedAt: { type: "string" },
    input: { type: "object" },
    direct402: { type: "object" },
    bazaarDiscovery: { type: "object" },
    catalogRefresh: { type: "object" },
    mismatches: { type: "array", items: { type: "string" } },
    nextActions: { type: "array", items: { type: "string" } },
    safety: { type: "string" }
  }
};

function decodePaymentRequiredHeader(header) {
  if (!header) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
    });
    if (!response.ok) {
      throw new Error(`http_${response.status}`);
    }
    return await response.json();
  } catch (error) {
    return { error: error?.message || "request_failed" };
  }
}

function normalizeBody(value) {
  if (value == null) {
    return undefined;
  }

  return typeof value === "string" ? value : JSON.stringify(value);
}

async function inspectDirect402(input) {
  const endpointUrl = assertPublicHttpsUrl(input.endpointUrl).toString();
  const method = input.method || "GET";
  const headers = { Accept: "application/json" };
  const body = method === "POST" ? normalizeBody(input.requestBody ?? {}) : undefined;

  if (method === "POST") {
    headers["Content-Type"] = "application/json";
  }

  try {
    const response = await fetch(endpointUrl, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
    });
    const challenge = decodePaymentRequiredHeader(response.headers.get("payment-required"));
    const accept = challenge?.accepts?.[0] || null;

    return {
      ok: response.status === 402 && Boolean(challenge),
      status: response.status,
      hasPaymentRequiredHeader: Boolean(challenge),
      hasBazaarExtension: Boolean(challenge?.extensions?.bazaar),
      resourceUrl: challenge?.resource?.url || null,
      description: challenge?.resource?.description || null,
      mimeType: challenge?.resource?.mimeType || null,
      amount: accept?.amount || null,
      network: accept?.network || null,
      payTo: accept?.payTo || null,
      scheme: accept?.scheme || null
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      hasPaymentRequiredHeader: false,
      hasBazaarExtension: false,
      error: error?.message || "request_failed"
    };
  }
}

function compactResource(resource) {
  if (!resource) {
    return null;
  }

  const accept = resource.accepts?.[0] || {};
  return {
    resource: resource.resource || resource.url || null,
    description: resource.description || resource.metadata?.description || null,
    amount: accept.amount || null,
    network: accept.network || null,
    lastUpdated: resource.lastUpdated || null
  };
}

function discoveryResources(payload) {
  if (Array.isArray(payload?.resources)) {
    return payload.resources;
  }

  if (Array.isArray(payload?.items)) {
    return payload.items;
  }

  return [];
}

async function inspectMerchantDiscovery(payTo) {
  if (!payTo) {
    return { resources: [], error: "no_payTo_from_direct_402" };
  }

  const params = new URLSearchParams({ payTo, limit: "100" });
  const payload = await fetchJson(`${CDP_DISCOVERY_BASE}/merchant?${params.toString()}`);

  return {
    total: payload.pagination?.total ?? discoveryResources(payload).length,
    resources: discoveryResources(payload).map(compactResource),
    error: payload.error || null
  };
}

async function inspectSearch(input, direct402) {
  const endpointUrl = new URL(input.endpointUrl);
  const query = input.searchQuery || direct402.description || endpointUrl.hostname;
  const params = new URLSearchParams({ query, limit: "10" });

  if (input.expectedNetwork || direct402.network) {
    params.set("network", input.expectedNetwork || direct402.network);
  }

  const payload = await fetchJson(`${CDP_DISCOVERY_BASE}/search?${params.toString()}`);
  const resources = discoveryResources(payload);

  return {
    query,
    count: resources.length,
    searchMethod: payload.searchMethod || null,
    partialResults: Boolean(payload.partialResults),
    resources: resources.map(compactResource),
    error: payload.error || null
  };
}

function sameUrl(left, right) {
  try {
    return new URL(left).toString().replace(/\/+$/, "") === new URL(right).toString().replace(/\/+$/, "");
  } catch {
    return false;
  }
}

function buildAssessment(input, direct402, merchantDiscovery, searchDiscovery) {
  const indexedResource = merchantDiscovery.resources.find((resource) => sameUrl(resource.resource, input.endpointUrl));
  const searchResource = searchDiscovery.resources.find((resource) => sameUrl(resource.resource, input.endpointUrl));
  const mismatches = [];
  const nextActions = [];

  if (!direct402.ok) {
    mismatches.push("The direct endpoint did not return a usable x402 payment challenge.");
    nextActions.push("Fix the endpoint so an unpaid buyer request returns HTTP 402 with payment requirements before promoting it.");
  }

  if (direct402.ok && !direct402.hasBazaarExtension) {
    mismatches.push("The direct 402 challenge is missing Bazaar discovery metadata.");
    nextActions.push("Register the Bazaar resource server extension and declare input/output metadata in the route configuration.");
  }

  if (input.expectedAmount && direct402.amount && input.expectedAmount !== direct402.amount) {
    mismatches.push(`The direct endpoint amount is ${direct402.amount}, not the expected ${input.expectedAmount}.`);
    nextActions.push("Update pricing or the launch copy so buyers see the same amount before and after discovery.");
  }

  if (input.expectedNetwork && direct402.network && input.expectedNetwork !== direct402.network) {
    mismatches.push(`The direct endpoint network is ${direct402.network}, not the expected ${input.expectedNetwork}.`);
    nextActions.push("Align the route network with the advertised chain before sending buyer traffic.");
  }

  if (!indexedResource) {
    mismatches.push("CDP merchant discovery does not show this exact endpoint URL.");
    nextActions.push("Complete one real settled payment through the CDP Facilitator for this URL so Bazaar can catalog the current metadata.");
    nextActions.push(SETTLE_RESOURCE_ACTION);
  } else if (direct402.amount && indexedResource.amount && direct402.amount !== indexedResource.amount) {
    mismatches.push(`Bazaar has stale pricing: indexed amount ${indexedResource.amount}, direct amount ${direct402.amount}.`);
    nextActions.push("Get a real settled payment on the current route; Bazaar updates catalog entries from settle traffic, not from unpaid probes.");
    nextActions.push(SETTLE_RESOURCE_ACTION);
  }

  if (!searchResource) {
    mismatches.push("The endpoint does not appear in the top search results for the tested query.");
    nextActions.push("Use a natural-language route description with the buyer problem, output, price, and category terms buyers actually search.");
  }

  if (direct402.ok && indexedResource && searchResource && mismatches.length === 0) {
    nextActions.push("The route is visible and internally consistent. Start promotion and watch paid completions, unique payers, and wallet settlement.");
  }

  const verdict = !direct402.ok
    ? "fix_payment_challenge"
    : !indexedResource || mismatches.some((item) => item.includes("stale pricing"))
      ? "needs_bazaar_settlement_refresh"
      : !searchResource
        ? "needs_search_positioning"
        : mismatches.length
          ? "fix_before_promotion"
          : "ready_to_promote";

  return {
    verdict,
    indexedResource,
    searchResource,
    mismatches,
    nextActions: [...new Set(nextActions)].slice(0, 6)
  };
}

function buildCatalogRefresh(input, direct402, assessment) {
  const hasStalePricing = Boolean(
    assessment.indexedResource?.amount &&
    direct402.amount &&
    assessment.indexedResource.amount !== direct402.amount
  );
  const needsSettlementRefresh = !assessment.indexedResource || hasStalePricing;
  const status = !direct402.ok
    ? "blocked_until_402_fixed"
    : !direct402.hasBazaarExtension
      ? "blocked_until_bazaar_extension_declared"
      : needsSettlementRefresh
        ? "needs_settled_payment_with_resource_metadata"
        : !assessment.searchResource
          ? "indexed_but_needs_search_positioning"
          : "current";

  return {
    status,
    directChallengeReadyForCatalog: Boolean(direct402.ok && direct402.hasBazaarExtension),
    needsRealSettlement: needsSettlementRefresh,
    exactResourceUrl: input.endpointUrl,
    settlementRequirements: [
      "A real buyer must complete verify and settle through the CDP Facilitator for this exact endpoint URL.",
      "The settle payload must include paymentPayload.resource for the exact resource URL so CDP can catalog the route.",
      "The client/facilitator path should preserve the Bazaar extension metadata declared in the 402 challenge."
    ],
    whyUnpaidProbesAreNotEnough: "Unpaid 402/details/search probes can prove direct route truth, but they do not refresh CDP Bazaar catalog entries.",
    evidence: {
      direct402Ok: Boolean(direct402.ok),
      bazaarExtensionPresent: Boolean(direct402.hasBazaarExtension),
      merchantIndexed: Boolean(assessment.indexedResource),
      searchVisible: Boolean(assessment.searchResource),
      indexedAmount: assessment.indexedResource?.amount || null,
      directAmount: direct402.amount || null
    }
  };
}

export function buildDiscoveryAuditExampleOutput() {
  return {
    service: "Listing Roast x402",
    endpoint: "x402-discovery-audit",
    price: "$0.01",
    verdict: "needs_bazaar_settlement_refresh",
    auditedAt: "2026-06-18T00:00:00.000Z",
    input: discoveryAuditRequestExample,
    direct402: {
      ok: true,
      status: 402,
      hasPaymentRequiredHeader: true,
      hasBazaarExtension: true,
      amount: "1000",
      network: "eip155:8453"
    },
    bazaarDiscovery: {
      merchantIndexed: true,
      searchVisible: false,
      indexedAmount: "1000000",
      searchQuery: "listing roast"
    },
    catalogRefresh: {
      status: "needs_settled_payment_with_resource_metadata",
      directChallengeReadyForCatalog: true,
      needsRealSettlement: true,
      exactResourceUrl: discoveryAuditRequestExample.endpointUrl,
      settlementRequirements: [
        "A real buyer must complete verify and settle through the CDP Facilitator for this exact endpoint URL.",
        "The settle payload must include paymentPayload.resource for the exact resource URL so CDP can catalog the route.",
        "The client/facilitator path should preserve the Bazaar extension metadata declared in the 402 challenge."
      ],
      whyUnpaidProbesAreNotEnough: "Unpaid 402/details/search probes can prove direct route truth, but they do not refresh CDP Bazaar catalog entries.",
      evidence: {
        direct402Ok: true,
        bazaarExtensionPresent: true,
        merchantIndexed: true,
        searchVisible: false,
        indexedAmount: "1000000",
        directAmount: "1000"
      }
    },
    mismatches: ["Bazaar has stale pricing: indexed amount 1000000, direct amount 1000."],
    nextActions: [
      "Get a real settled payment on the current route; Bazaar updates catalog entries from settle traffic, not from unpaid probes.",
      SETTLE_RESOURCE_ACTION
    ],
    safety: "No paid calls were made by this audit. It only requested unpaid 402 metadata and public discovery records."
  };
}

export async function buildX402DiscoveryAudit(rawInput) {
  const input = discoveryAuditRequestSchema.parse(rawInput);
  const direct402 = await inspectDirect402(input);
  const merchantDiscovery = await inspectMerchantDiscovery(direct402.payTo);
  const searchDiscovery = await inspectSearch(input, direct402);
  const assessment = buildAssessment(input, direct402, merchantDiscovery, searchDiscovery);

  return {
    service: "Listing Roast x402",
    endpoint: "x402-discovery-audit",
    price: "$0.01",
    verdict: assessment.verdict,
    auditedAt: new Date().toISOString(),
    input: {
      endpointUrl: input.endpointUrl,
      method: input.method,
      expectedAmount: input.expectedAmount || null,
      expectedNetwork: input.expectedNetwork || null,
      searchQuery: input.searchQuery || searchDiscovery.query
    },
    direct402,
    bazaarDiscovery: {
      merchantIndexed: Boolean(assessment.indexedResource),
      searchVisible: Boolean(assessment.searchResource),
      indexedResource: assessment.indexedResource,
      searchQuery: searchDiscovery.query,
      searchMethod: searchDiscovery.searchMethod,
      searchTopResults: searchDiscovery.resources.slice(0, 5),
      merchantLookupError: merchantDiscovery.error,
      searchLookupError: searchDiscovery.error
    },
    catalogRefresh: buildCatalogRefresh(input, direct402, assessment),
    mismatches: assessment.mismatches,
    nextActions: assessment.nextActions,
    safety: "No paid calls were made by this audit. It only requested unpaid 402 metadata and public discovery records."
  };
}
