import express from "express";
import { createHash } from "node:crypto";
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
const ROOT_DIRECTORY_POST_PATH = "/";
const API_ENTRY_PATH = "/api";
const API_V1_ENTRY_PATH = "/api/v1";
const V1_ENTRY_PATH = "/v1";
const INSTANT_SCORE_PATH = "/api/instant-listing-score";
const CONVERSION_SCORE_PATH = "/api/x402-marketplace-conversion";
const AGENT_LISTING_PATH = "/api/agent-listing-conversion";
const ROAST_PATH = "/api/listing-roast";
const QUICK_SCORE_ALIAS_PATHS = Object.freeze([
  "/api/marketplace-listing-score",
  "/api/paid-api-listing-quality",
  "/api/buyer-agent-skip-reasons",
  "/api/agent-service-clarity"
]);
const QUICK_SCORE_PAID_PATHS = Object.freeze([ROAST_PATH, ...QUICK_SCORE_ALIAS_PATHS]);
const QUICK_SCORE_ALIAS_METADATA = Object.freeze({
  "/api/marketplace-listing-score": {
    id: "marketplace_listing_score_alias",
    name: "marketplace_listing_score",
    operationId: "getMarketplaceListingScoreAlias",
    summary: "Paid $0.001 marketplace listing score alias",
    catalogTitle: "GET $0.001 marketplace listing score quick-score alias",
    description: "One-tenth-cent GET alias for marketplace listing score buyers. Returns the same quick score as the indexed, paid-use-confirmed /api/listing-roast route, with paid API listing quality, buyer-agent skip reasons, and next paid action guidance.",
    keywords: ["marketplace listing score", "marketplace listing quality", "listing quality score", "x402 listing quality", "paid API listing quality"]
  },
  "/api/paid-api-listing-quality": {
    id: "paid_api_listing_quality_alias",
    name: "paid_api_listing_quality",
    operationId: "getPaidApiListingQualityAlias",
    summary: "Paid $0.001 paid API listing quality alias",
    catalogTitle: "GET $0.001 paid API listing quality quick-score alias",
    description: "One-tenth-cent GET alias for paid API listing quality buyers. Returns the same quick score as the indexed, paid-use-confirmed /api/listing-roast route, with marketplace listing score, agent service clarity, buyer-agent skip reasons, and upgrade guidance.",
    keywords: ["paid API listing quality", "paid API listing quality score", "paid API listing", "agent-service listing score", "marketplace listing score"]
  },
  "/api/buyer-agent-skip-reasons": {
    id: "buyer_agent_skip_reasons_alias",
    name: "buyer_agent_skip_reasons",
    operationId: "getBuyerAgentSkipReasonsAlias",
    summary: "Paid $0.001 buyer-agent skip reasons alias",
    catalogTitle: "GET $0.001 buyer-agent skip reasons quick-score alias",
    description: "One-tenth-cent GET alias for buyer-agent skip reason searches. Returns the same quick score as the indexed, paid-use-confirmed /api/listing-roast route, with top skip reasons, agent service clarity, and the next paid action.",
    keywords: ["buyer-agent skip reasons", "buyer agent skip reasons", "agent skip reasons", "agent listing conversion", "agent service clarity"]
  },
  "/api/agent-service-clarity": {
    id: "agent_service_clarity_alias",
    name: "agent_service_clarity",
    operationId: "getAgentServiceClarityAlias",
    summary: "Paid $0.001 agent service clarity alias",
    catalogTitle: "GET $0.001 agent service clarity quick-score alias",
    description: "One-tenth-cent GET alias for agent service clarity and promotion-readiness buyers. Returns the same quick score as the indexed, paid-use-confirmed /api/listing-roast route, with buyer-agent skip reasons, marketplace listing quality, and first-fix guidance.",
    keywords: ["agent service clarity", "agent service listing clarity", "agent-service listing score", "agent listing clarity", "agent service promotion readiness"]
  }
});
const SCORE_PATH = "/api/listing-score";
const PING_PATH = "/api/x402-ping";
const SITE_AUDIT_PATH = "/api/x402-site-audit";
const PREFLIGHT_ALIAS_PATHS = Object.freeze(["/api/preflight", "/api/v1/preflight", "/preflight"]);
const SITE_AUDIT_PAID_PATHS = Object.freeze([SITE_AUDIT_PATH, ...PREFLIGHT_ALIAS_PATHS]);
const DISCOVERY_AUDIT_PATH = "/api/x402-discovery-audit";
const PAY_NOW_PATH = "/api/pay-now";
const PAID_USAGE_PROOF_PATH = "/api/paid-usage-proof";
const PRICING_PATH = "/api/pricing";
const FIND_PATH = "/api/find";
const ROUTE_PATH = "/api/route";
const LOCAL_DISCOVERY_RESOURCE_PATHS = [
  "/v2/x402/discovery/resources",
  "/x402/discovery/resources",
  "/discovery/resources",
  "/.well-known/x402/discovery/resources",
  "/v1/x402/discovery/resources"
];
const LOCAL_DISCOVERY_SEARCH_PATHS = [
  "/v2/x402/discovery/search",
  "/x402/discovery/search",
  "/discovery/search",
  "/.well-known/x402/discovery/search",
  "/v1/x402/discovery/search"
];
const LOCAL_DISCOVERY_MERCHANT_PATHS = [
  "/v2/x402/discovery/merchant",
  "/x402/discovery/merchant",
  "/discovery/merchant",
  "/.well-known/x402/discovery/merchant",
  "/v1/x402/discovery/merchant"
];
const WELL_KNOWN_X402_PATH = "/.well-known/x402";
const WELL_KNOWN_X402_JSON_PATH = "/.well-known/x402.json";
const WELL_KNOWN_OPENAPI_JSON_PATH = "/.well-known/openapi.json";
const WELL_KNOWN_AGENT_CARD_PATH = "/.well-known/agent-card.json";
const WELL_KNOWN_AGENT_JSON_PATH = "/.well-known/agent.json";
const WELL_KNOWN_AI_PLUGIN_PATH = "/.well-known/ai-plugin.json";
const WELL_KNOWN_API_CATALOG_PATH = "/.well-known/api-catalog";
const WELL_KNOWN_AGENT_TOOLS_PATH = "/.well-known/agent-tools.json";
const WELL_KNOWN_AGENT_SKILLS_INDEX_PATH = "/.well-known/agent-skills/index.json";
const WELL_KNOWN_AGENT_SKILL_PATH = "/.well-known/agent-skills/listing-roast-x402/SKILL.md";
const WELL_KNOWN_LLMS_PATH = "/.well-known/llms.txt";
const WELL_KNOWN_LLMS_FULL_PATH = "/.well-known/llms-full.txt";
const WELL_KNOWN_MCP_JSON_PATH = "/.well-known/mcp.json";
const WELL_KNOWN_MCP_PATH = "/.well-known/mcp";
const WELL_KNOWN_MCP_SERVER_PATH = "/.well-known/mcp-server";
const WELL_KNOWN_MCP_SERVER_CARD_PATH = "/.well-known/mcp/server-card.json";
const LLMS_PATH = "/llms.txt";
const LLMS_FULL_PATH = "/llms-full.txt";
const INDEX_MARKDOWN_PATH = "/index.md";
const AUTH_MARKDOWN_PATH = "/auth.md";
const WELL_KNOWN_AUTH_MARKDOWN_PATH = "/.well-known/auth.md";
const ICON_SVG_PATH = "/icon.svg";
const FAVICON_SVG_PATH = "/favicon.svg";
const AGENT_SKILLS_SCHEMA = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";
const AGENTS_MARKDOWN_PATH = "/AGENTS.md";
const DOCS_PATH = "/docs";
const API_DOCS_PATH = "/api-docs";
const PAID_API_LISTING_QUALITY_PATH = "/paid-api-listing-quality";
const AGENT_LISTING_CONVERSION_PAGE_PATH = "/agent-listing-conversion";
const X402_DISCOVERY_AUDIT_PAGE_PATH = "/x402-discovery-audit";
const X402_SITE_AUDIT_PAGE_PATH = "/x402-site-audit";
const INTENT_LANDING_PATHS = [
  PAID_API_LISTING_QUALITY_PATH,
  AGENT_LISTING_CONVERSION_PAGE_PATH,
  X402_DISCOVERY_AUDIT_PAGE_PATH,
  X402_SITE_AUDIT_PAGE_PATH
];
const API_V1_OPENAPI_JSON_PATH = "/api/v1/openapi.json";
const SWAGGER_JSON_PATH = "/swagger.json";
const OPENAPI_YAML_PATH = "/openapi.yaml";
const API_CATALOG_PROFILE = "https://www.rfc-editor.org/info/rfc9727";
const API_CATALOG_CONTENT_TYPE = `application/linkset+json; profile="${API_CATALOG_PROFILE}"`;
const INSTANT_SCORE_AMOUNT = "1000";
const PING_AMOUNT = "1000";
const SITE_AUDIT_AMOUNT = "1000";
const DISCOVERY_AUDIT_QUICK_AMOUNT = "1000";
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
  "x402 navigation",
  "API entrypoint",
  "route map",
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
  "x402 service discoverability",
  "x402 seller discoverability",
  "fix x402 Bazaar listing",
  "x402 catalog metadata quality",
  "x402 listing SEO audit",
  "x402 listing rank doctor",
  "x402 seller growth checklist",
  "x402 seller intelligence",
  "x402 marketplace SEO audit",
  "agent service promotion readiness"
];
const DISCOVERY_DESCRIPTION = "Score API marketplace listing quality and discoverability before promotion: paid x402 API for paid API listing quality score, agent-service listing clarity, buyer-agent skip reasons, marketplace listing conversion, x402 seller discoverability, listing SEO audit, seller growth checklist, and agent service promotion readiness.";
const SERVICE_CATEGORY = "paid-api-listing";
const SERVICE_TAGS = Object.freeze([
  "x402",
  "paid API listing quality score",
  "paid API listing quality",
  "marketplace listing score",
  "buyer-agent skip reasons",
  "buyer agent skip reasons",
  "agent-service listing score",
  "agent service clarity",
  "x402 discovery audit",
  "paid API preflight",
  "route health"
]);
const DIRECTORY_POST_DESCRIPTION = "Listing Roast directory handoff: $0.001 POST root route for buyer agents following generic marketplace or agent-tools directory snippets; returns route map, indexed /api/listing-roast quick-score handoff, prices, and next paid actions.";
const INDEXED_QUICK_SCORE_DESCRIPTION = "Score API marketplace listing quality and discoverability for paid API listing quality, marketplace listing score, buyer-agent skip reasons, agent service listing clarity, paid API preflight, x402 site audit starter, x402 discovery audit triage, Bazaar search visibility, and stale pricing triage: lowest-price $0.001 GET on indexed /api/listing-roast. This paid-use-confirmed route has wallet proof at /api/paid-usage-proof; try it before higher-priced listing scorers or the $0.01 roast. Use /api/x402-site-audit for pre-pay metadata, /api/x402-discovery-audit for stale Bazaar, or POST /api/listing-roast for the full roast.";
const AGENT_LISTING_CONVERSION_DESCRIPTION = "buyer-agent skip reasons, agent service listing clarity, agent service promotion readiness, and agent listing conversion score: $0.001 GET Listing Roast x402 score for paid API listing quality, buyer intent, x402 marketplace conversion, and first-fix upgrade guidance.";
const X402_SERVICE_NAME = "Listing Roast x402";
const DISCOVERY_METADATA_VERSION = "2026-06-19-proven-first-route-v1";
const DISCOVERY_METADATA_UPDATED_AT = "2026-06-19T20:05:00.000Z";
const ROUTE_SERVICE_TAGS = Object.freeze({
  directoryPost: ["x402", "agent-tools", "directory handoff", "paid API", "route map"],
  apiEntry: ["x402", "paid API", "route map", "API entrypoint", "listing quality"],
  listingScore: ["x402", "paid API listing quality", "agent service clarity", "marketplace conversion", "discoverability"],
  instantScore: ["x402", "paid API listing quality", "marketplace listing score", "agent service clarity", "discoverability"],
  conversionScore: ["x402", "marketplace conversion", "paid API listing quality", "buyer-agent", "listing quality"],
  agentListingConversion: ["x402", "buyer-agent skip reasons", "agent service clarity", "agent service promotion readiness", "listing conversion", "paid API"],
  indexedQuickScore: ["x402", "paid API listing quality score", "paid API listing quality", "marketplace listing score", "buyer-agent skip reasons", "buyer agent skip reasons", "agent-service listing score", "x402 site audit", "x402 discovery audit", "paid API preflight", "agent service clarity", "route health"],
  x402Ping: ["x402", "payment rail", "paid API", "route health", "Base USDC"],
  x402SiteAudit: ["x402", "discovery audit", "x402 seller discoverability", "fix x402 Bazaar listing", "x402 catalog metadata quality", "x402 listing SEO audit", "x402 listing rank doctor", "x402 seller growth checklist", "x402 seller intelligence", "x402 marketplace SEO audit", "paid API preflight", "route health", "Bazaar visibility", "stale Bazaar price"],
  discoveryAuditQuick: ["x402", "Bazaar visibility", "discovery audit", "x402 seller discoverability", "fix x402 Bazaar listing", "x402 listing SEO audit", "x402 listing rank doctor", "paid API preflight", "route health"],
  discoveryAudit: ["x402", "Bazaar visibility", "discovery audit", "fix x402 Bazaar listing", "x402 catalog metadata quality", "x402 listing SEO audit", "x402 listing rank doctor", "x402 seller growth checklist", "x402 seller intelligence", "x402 marketplace SEO audit", "stale Bazaar price", "paid API preflight"],
  fullRoast: ["x402", "listing roast", "marketplace conversion", "paid API listing quality", "buyer-agent skip reasons"]
});
const LISTING_QUERY_PARAMETER_EXAMPLES = Object.freeze({
  agentName: "Listing Roast x402",
  listingText: "Score API marketplace listing quality and discoverability for paid API listing quality, paid API preflight, stale Bazaar price/search, buyer-agent skip reasons, and agent-service clarity. Start with the paid-use-confirmed $0.001 GET /api/listing-roast route; use $0.001 site audit for route checks and $0.001 discovery audit for stale Bazaar metadata.",
  targetBuyer: "x402 and MCP builders",
  currentPrice: "$0.001 GET; $0.01 POST upgrade",
  currentCheckoutPath: "/api/listing-roast",
  goal: "Convert buyer agents through the lowest-friction paid score, route pre-pay endpoint checks to the $0.001 site audit, and route stale Bazaar listing buyers to the $0.001 discovery audit"
});
const quickScoreRequestExample = Object.freeze({
  ...LISTING_QUERY_PARAMETER_EXAMPLES
});
function quickScoreAliasInputDefaults(routePath) {
  const metadata = QUICK_SCORE_ALIAS_METADATA[routePath];
  if (!metadata) {
    return quickScoreRequestExample;
  }

  const primaryIntent = metadata.keywords[0] || metadata.name.replaceAll("_", " ");
  const supportingIntents = metadata.keywords.slice(1, 4).join(", ");

  return {
    ...quickScoreRequestExample,
    listingText: `A $0.001 x402 quick score for ${primaryIntent}${supportingIntents ? `, ${supportingIntents}` : ""}. Use exact GET ${routePath} when a buyer agent searches that phrase, then upgrade to POST ${ROAST_PATH} for the $0.01 full roast when the score shows enough fit.`,
    targetBuyer: `buyer agents searching ${primaryIntent}`,
    currentCheckoutPath: routePath,
    goal: `Convert buyer agents searching "${primaryIntent}" through exact GET ${routePath}; keep the first paid action at $0.001 and hand off to the $0.01 full roast only after fit is proven.`
  };
}
const MANIFEST_RESOURCE_ROUTE_KEYS = Object.freeze({
  indexed_roast_quick_score: "indexedQuickScore",
  directory_root_post: "directoryPost",
  api_entry: "apiEntry",
  api_v1_entry: "apiEntry",
  v1_entry: "apiEntry",
  instant_listing_score: "instantScore",
  x402_marketplace_conversion_score: "conversionScore",
  agent_listing_conversion_score: "agentListingConversion",
  x402_ping: "x402Ping",
  x402_site_audit: "x402SiteAudit",
  marketplace_listing_score_alias: "indexedQuickScore",
  paid_api_listing_quality_alias: "indexedQuickScore",
  buyer_agent_skip_reasons_alias: "indexedQuickScore",
  agent_service_clarity_alias: "indexedQuickScore",
  paid_api_preflight: "x402SiteAudit",
  api_v1_paid_api_preflight: "x402SiteAudit",
  root_paid_api_preflight: "x402SiteAudit",
  x402_discovery_audit_quick: "discoveryAuditQuick",
  x402_discovery_audit: "discoveryAudit",
  listing_score: "listingScore",
  listing_roast: "fullRoast"
});
const LISTING_REQUEST_SCHEMA_PROPERTIES = {
  agentName: {
    type: "string",
    description: "Name of the paid API, MCP tool, agent service, or marketplace listing being evaluated.",
    example: LISTING_QUERY_PARAMETER_EXAMPLES.agentName
  },
  listingText: {
    type: "string",
    description: "Current buyer-facing listing copy, README excerpt, marketplace description, or route summary to score.",
    example: LISTING_QUERY_PARAMETER_EXAMPLES.listingText
  },
  targetBuyer: {
    type: "string",
    description: "The buyer or agent persona the listing should convert, such as x402 builders, MCP users, or API buyers.",
    example: LISTING_QUERY_PARAMETER_EXAMPLES.targetBuyer
  },
  currentPrice: {
    type: "string",
    description: "Advertised price or max x402 amount the buyer will see before paying.",
    example: LISTING_QUERY_PARAMETER_EXAMPLES.currentPrice
  },
  currentCheckoutPath: {
    type: "string",
    description: "The endpoint, checkout path, or x402 route the buyer is expected to call.",
    example: LISTING_QUERY_PARAMETER_EXAMPLES.currentCheckoutPath
  },
  goal: {
    type: "string",
    description: "The conversion goal, such as more paid completions, fewer buyer-agent skips, or better marketplace search fit.",
    example: LISTING_QUERY_PARAMETER_EXAMPLES.goal
  },
  source: {
    type: "string",
    description: "Optional caller context used to identify the route, experiment, or upgrade path that requested the score."
  }
};

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

function quickScoreAliasUrls(config) {
  return QUICK_SCORE_ALIAS_PATHS.map((pathname) => absoluteUrl(config, pathname));
}

function formatQuickScoreAliasUrls(config) {
  return quickScoreAliasUrls(config).join(", ");
}

function preflightAliasUrls(config) {
  return PREFLIGHT_ALIAS_PATHS.map((pathname) => absoluteUrl(config, pathname));
}

function formatPreflightAliasUrls(config) {
  return preflightAliasUrls(config).join(", ");
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

function indentText(value, spaces = 4) {
  const prefix = " ".repeat(spaces);
  return String(value)
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function uniqueTerms(values = []) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim())));
}

function routeTags(routeKey) {
  return ROUTE_SERVICE_TAGS[routeKey] || [];
}

function enrichManifestResource(resource) {
  const tags = routeTags(MANIFEST_RESOURCE_ROUTE_KEYS[resource.id]);
  return {
    serviceName: X402_SERVICE_NAME,
    ...resource,
    tags,
    keywords: uniqueTerms([...(resource.keywords || []), ...tags])
  };
}

function jsonScript(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function buildIconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="Listing Roast x402">
  <rect width="96" height="96" rx="18" fill="#111827"/>
  <path d="M22 25h31v10H34v36H22V25Z" fill="#ffffff"/>
  <path d="M55 25h19c10 0 17 6 17 15 0 6-3 11-9 14l10 17H79L70 56h-4v15H55V25Zm11 10v12h8c4 0 6-2 6-6s-2-6-6-6h-8Z" fill="#38bdf8"/>
  <path d="M24 78h48" stroke="#22c55e" stroke-width="6" stroke-linecap="round"/>
</svg>`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function listingRequestSchemaProperties({ includeSource = true } = {}) {
  if (includeSource) {
    return LISTING_REQUEST_SCHEMA_PROPERTIES;
  }

  const { source, ...properties } = LISTING_REQUEST_SCHEMA_PROPERTIES;
  return properties;
}

function listingQuerySchemaProperties(defaults = LISTING_QUERY_PARAMETER_EXAMPLES) {
  return Object.fromEntries(Object.entries(listingRequestSchemaProperties({ includeSource: false })).map(([name, schema]) => [
    name,
    {
      ...schema,
      example: defaults[name] || LISTING_QUERY_PARAMETER_EXAMPLES[name],
      default: defaults[name] || LISTING_QUERY_PARAMETER_EXAMPLES[name]
    }
  ]));
}

function listingQueryOpenApiParameters(defaults = LISTING_QUERY_PARAMETER_EXAMPLES) {
  return Object.entries(listingQuerySchemaProperties(defaults)).map(([name, schema]) => ({
    name,
    in: "query",
    required: false,
    schema,
    example: schema.example
  }));
}

function buildDiscoveryLinks(config) {
  const exactPaidRouteLinks = [
    [ROAST_PATH, "GET $0.001 indexed listing-roast quick score"],
    ["/api/marketplace-listing-score", "GET $0.001 marketplace listing score"],
    ["/api/paid-api-listing-quality", "GET $0.001 paid API listing quality"],
    ["/api/buyer-agent-skip-reasons", "GET $0.001 buyer-agent skip reasons"],
    ["/api/agent-service-clarity", "GET $0.001 agent service clarity"]
  ].map(([pathname, title]) => `<${absoluteUrl(config, pathname)}>; rel="payment"; type="application/json"; title="${title}"`);

  return [
    `<${absoluteUrl(config, "/x402.json")}>; rel="payment"; type="application/json"`,
    ...exactPaidRouteLinks,
    `<${absoluteUrl(config, WELL_KNOWN_X402_JSON_PATH)}>; rel="service-desc"; type="application/json"`,
    `<${absoluteUrl(config, WELL_KNOWN_X402_PATH)}>; rel="service-desc"; type="application/json"`,
    `<${absoluteUrl(config, PAY_NOW_PATH)}>; rel="help"; type="application/json"`,
    `<${absoluteUrl(config, PAID_USAGE_PROOF_PATH)}>; rel="service-meta"; type="application/json"; title="wallet-backed paid-use proof"`,
    `<${absoluteUrl(config, PRICING_PATH)}>; rel="service-meta"; type="application/json"`,
    `<${absoluteUrl(config, FIND_PATH)}>; rel="search"; type="application/json"`,
    `<${absoluteUrl(config, ROUTE_PATH)}>; rel="service-meta"; type="application/json"`,
    `<${absoluteUrl(config, LOCAL_DISCOVERY_RESOURCE_PATHS[0])}>; rel="service-meta"; type="application/json"`,
    `<${absoluteUrl(config, LOCAL_DISCOVERY_SEARCH_PATHS[0])}>; rel="search"; type="application/json"`,
    `<${absoluteUrl(config, "/openapi.json")}>; rel="describedby"; type="application/vnd.oai.openapi+json"`,
    `<${absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH)}>; rel="describedby"; type="application/vnd.oai.openapi+json"`,
    `<${absoluteUrl(config, API_V1_OPENAPI_JSON_PATH)}>; rel="describedby"; type="application/vnd.oai.openapi+json"`,
    `<${absoluteUrl(config, SWAGGER_JSON_PATH)}>; rel="describedby"; type="application/vnd.oai.openapi+json"`,
    `<${absoluteUrl(config, LLMS_PATH)}>; rel="describedby"; type="text/plain"`,
    `<${absoluteUrl(config, WELL_KNOWN_LLMS_PATH)}>; rel="describedby"; type="text/plain"`,
    `<${absoluteUrl(config, LLMS_FULL_PATH)}>; rel="describedby"; type="text/markdown"`,
    `<${absoluteUrl(config, WELL_KNOWN_LLMS_FULL_PATH)}>; rel="describedby"; type="text/markdown"`,
    `<${absoluteUrl(config, INDEX_MARKDOWN_PATH)}>; rel="describedby"; type="text/markdown"`,
    `<${absoluteUrl(config, AGENTS_MARKDOWN_PATH)}>; rel="describedby"; type="text/markdown"`,
    `<${absoluteUrl(config, DOCS_PATH)}>; rel="describedby"; type="text/markdown"`,
    `<${absoluteUrl(config, AUTH_MARKDOWN_PATH)}>; rel="describedby"; type="text/markdown"`,
    `<${absoluteUrl(config, WELL_KNOWN_AUTH_MARKDOWN_PATH)}>; rel="describedby"; type="text/markdown"`,
    `<${absoluteUrl(config, WELL_KNOWN_MCP_JSON_PATH)}>; rel="service-desc"; type="application/json"`,
    `<${absoluteUrl(config, WELL_KNOWN_MCP_PATH)}>; rel="service-desc"; type="application/json"`,
    `<${absoluteUrl(config, WELL_KNOWN_MCP_SERVER_PATH)}>; rel="service-desc"; type="application/json"`,
    `<${absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH)}>; rel="mcp-server-card"; type="application/json"`,
    `<${absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH)}>; rel="service-desc"; type="application/json"`,
    `<${absoluteUrl(config, WELL_KNOWN_AGENT_JSON_PATH)}>; rel="service-desc"; type="application/json"`,
    `<${absoluteUrl(config, WELL_KNOWN_AI_PLUGIN_PATH)}>; rel="service-desc"; type="application/json"`,
    `<${absoluteUrl(config, WELL_KNOWN_API_CATALOG_PATH)}>; rel="api-catalog"; type="application/linkset+json"`,
    `<${absoluteUrl(config, WELL_KNOWN_AGENT_TOOLS_PATH)}>; rel="service-desc"; type="application/json"`,
    `<${absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH)}>; rel="agent-skills"; type="application/json"`,
    `<${absoluteUrl(config, ICON_SVG_PATH)}>; rel="icon"; type="image/svg+xml"`
  ].join(", ");
}

function setFreshDiscoveryHeaders(response) {
  return response
    .set("Cache-Control", "no-store, max-age=0")
    .set("Pragma", "no-cache")
    .set("Expires", "0");
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
          name: "Indexed listing-roast quick score",
          price: "0.001",
          priceCurrency: "USD",
          url: absoluteUrl(config, ROAST_PATH)
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
          name: "buyer-agent skip reasons and agent listing conversion score",
          price: "0.001",
          priceCurrency: "USD",
          url: absoluteUrl(config, AGENT_LISTING_PATH)
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
          name: "x402 site audit and paid API preflight",
          price: "0.001",
          priceCurrency: "USD",
          url: absoluteUrl(config, SITE_AUDIT_PATH)
        },
        {
          "@type": "Offer",
          name: "x402 discovery audit quick check",
          price: "0.001",
          priceCurrency: "USD",
          url: absoluteUrl(config, DISCOVERY_AUDIT_PATH)
        },
        {
          "@type": "Offer",
          name: "Full x402 discovery audit",
          price: "0.01",
          priceCurrency: "USD",
          url: absoluteUrl(config, DISCOVERY_AUDIT_PATH)
        },
        {
          "@type": "Offer",
          name: "Agent API entrypoint",
          price: "0.001",
          priceCurrency: "USD",
          url: absoluteUrl(config, API_ENTRY_PATH)
        },
        {
          "@type": "Offer",
          name: "Agent API v1 entrypoint",
          price: "0.001",
          priceCurrency: "USD",
          url: absoluteUrl(config, API_V1_ENTRY_PATH)
        },
        {
          "@type": "Offer",
          name: "Versioned agent API entrypoint",
          price: "0.001",
          priceCurrency: "USD",
          url: absoluteUrl(config, V1_ENTRY_PATH)
        },
        {
          "@type": "Offer",
          name: "x402 paid ping",
          price: "0.001",
          priceCurrency: "USD",
          url: absoluteUrl(config, PING_PATH)
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

function buildPostPayCommand(config, pathname = ROOT_DIRECTORY_POST_PATH, maxAmount = INSTANT_SCORE_AMOUNT) {
  return `npx awal@2.8.0 x402 pay ${absoluteUrl(config, pathname)} \\
  -X POST \\
  --max-amount ${maxAmount}`;
}

function buildGetPayCommand(config, pathname = INSTANT_SCORE_PATH, maxAmount = INSTANT_SCORE_AMOUNT) {
  return `npx awal@2.8.0 x402 pay ${absoluteUrl(config, pathname)} \\
  -X GET \\
  --max-amount ${maxAmount}`;
}

function sha256Digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function buildAgentSkillMarkdown(config) {
  return `---
name: listing-roast-x402
description: Use Listing Roast x402 when an agent needs a paid API listing quality score, buyer-agent skip reasons, agent-service listing clarity, x402 marketplace conversion feedback, or a discoverability audit before promoting a paid x402/API service. Start with free discovery and only pay when the buyer intends to spend USDC.
---

# Listing Roast x402

Listing Roast x402 is a paid HTTP JSON API for builders who need to understand why buyer agents skip a paid API or x402 marketplace listing.

## Free Discovery

Fetch these before any payment:

- OpenAPI: ${absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH)}
- x402 manifest: ${absoluteUrl(config, "/x402.json")}
- API catalog: ${absoluteUrl(config, WELL_KNOWN_API_CATALOG_PATH)}
- Agent card: ${absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH)}
- Examples and commands: ${absoluteUrl(config, "/api/examples")}
- Pay-now handoff: ${absoluteUrl(config, PAY_NOW_PATH)}?intent=buyer-agent%20skip%20reasons
- Paid-use proof: ${absoluteUrl(config, PAID_USAGE_PROOF_PATH)}
- Pricing catalog: ${absoluteUrl(config, PRICING_PATH)}
- Route finder: ${absoluteUrl(config, FIND_PATH)}?q=x402%20discovery%20audit
- Local route router: ${absoluteUrl(config, ROUTE_PATH)}?query=x402%20discovery%20audit&top=3
- Route guide: ${absoluteUrl(config, "/llms.txt")}
- Full route guide: ${absoluteUrl(config, LLMS_FULL_PATH)}
- MCP metadata: ${absoluteUrl(config, WELL_KNOWN_MCP_JSON_PATH)}
- MCP discovery aliases: ${absoluteUrl(config, WELL_KNOWN_MCP_PATH)}, ${absoluteUrl(config, WELL_KNOWN_MCP_SERVER_PATH)}
- MCP server card: ${absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH)}

## Payment Rule

Do not call paid routes unless the buyer explicitly intends to pay. Paid calls require x402 payment in USDC on ${config.network}. Use the max amount shown below.

## Preferred First Paid Action

Use this when a buyer wants the cheapest live score for listing quality, paid API discoverability, x402 listing quality, buyer-agent skip reasons, or agent-service listing clarity:

\`\`\`bash
${buildGetPayCommand(config, ROAST_PATH)}
\`\`\`

Expected price: ${config.instantScorePrice}. Max amount: ${INSTANT_SCORE_AMOUNT} USDC units.

Exact buyer-phrase aliases for the same quick score:

${QUICK_SCORE_ALIAS_PATHS.map((pathname) => `- GET ${absoluteUrl(config, pathname)} (${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT} USDC units)`).join("\n")}

## Recommended Paid Sequence

1. Start with GET ${absoluteUrl(config, ROAST_PATH)} for ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT} USDC units. This is the already-indexed quick score route and the lowest-friction paid test.
2. Upgrade to POST ${absoluteUrl(config, ROAST_PATH)} for ${config.price}, max 10000 USDC units only when the quick score is promising and the buyer wants the full rewrite, top fixes, and stop-or-upgrade guidance.

Full roast command:

\`\`\`bash
${buildPayCommand(config, ROAST_PATH, "10000")}
\`\`\`

## Other Paid Actions

Generic x402 navigation route:

\`\`\`bash
${buildGetPayCommand(config, API_ENTRY_PATH, INSTANT_SCORE_AMOUNT)}
\`\`\`

Versioned x402 navigation route:

\`\`\`bash
${buildGetPayCommand(config, API_V1_ENTRY_PATH, INSTANT_SCORE_AMOUNT)}
\`\`\`

Short versioned x402 navigation route:

\`\`\`bash
${buildGetPayCommand(config, V1_ENTRY_PATH, INSTANT_SCORE_AMOUNT)}
\`\`\`

Agent listing conversion score and buyer-agent skip reasons:

\`\`\`bash
${buildGetPayCommand(config, AGENT_LISTING_PATH, INSTANT_SCORE_AMOUNT)}
\`\`\`

x402 marketplace conversion score:

\`\`\`bash
${buildGetPayCommand(config, CONVERSION_SCORE_PATH, INSTANT_SCORE_AMOUNT)}
\`\`\`

x402 site audit and paid API preflight:

\`\`\`bash
${buildGetPayCommand(config, SITE_AUDIT_PATH, SITE_AUDIT_AMOUNT)}
\`\`\`

Direct paid API preflight aliases for agents that probe common pre-pay URLs:

${PREFLIGHT_ALIAS_PATHS.map((pathname) => `- GET ${absoluteUrl(config, pathname)} (${config.siteAuditPrice}, max ${SITE_AUDIT_AMOUNT} USDC units)`).join("\n")}

Full listing roast, rewrite, and stop-or-upgrade guidance:

\`\`\`bash
${buildPayCommand(config, ROAST_PATH, "10000")}
\`\`\`

## When To Use

Use this service for paid API listing quality, agent service listing clarity, buyer-agent skip reasons, marketplace listing conversion, x402 route health, and discoverability checks before promotion.

Do not use it for legal advice, deep market research, or broad business strategy.
`;
}

function buildAuthMarkdown(config) {
  return `# Auth.md

## Listing Roast x402 Auth

Listing Roast x402 does not use accounts, API keys, OAuth login, browser sign-up, or agent registration.

Access is HTTP-native:

1. Fetch free discovery documents.
2. Choose a route.
3. If the buyer explicitly intends to pay, call the paid route with x402.
4. The server returns HTTP 402 with payment requirements until a valid x402 payment is provided.
5. After payment, retry the same route with the payment header and read the JSON response.

## Supported Auth Method

- Type: x402 payment
- Network: ${config.network}
- Asset: USDC
- Receiver: available in the HTTP 402 payment challenge
- API keys: not required
- OAuth/OIDC: not supported
- Agent registration: not supported
- User account: not required

## Agent Registration

Agent registration is not supported and is not required for Listing Roast x402.

- Registration endpoint: none
- Identity endpoint: none
- Claim endpoint: none
- Token endpoint: none
- Authorization server: none
- Supported identity types: none
- Supported scopes: none

Agents authorize each paid API call by completing the x402 payment challenge for that exact request. There are no long-lived credentials to register, issue, refresh, or revoke.

## Free Discovery

- Homepage: ${absoluteUrl(config, "/")}
- x402 manifest: ${absoluteUrl(config, "/x402.json")}
- OpenAPI: ${absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH)}
- API catalog: ${absoluteUrl(config, WELL_KNOWN_API_CATALOG_PATH)}
- Agent card: ${absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH)}
- Agent Skills: ${absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH)}
- MCP metadata: ${absoluteUrl(config, WELL_KNOWN_MCP_JSON_PATH)}
- MCP server card: ${absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH)}
- llms.txt: ${absoluteUrl(config, "/llms.txt")}
- Full Markdown guide: ${absoluteUrl(config, LLMS_FULL_PATH)}
- Pay-now handoff: ${absoluteUrl(config, PAY_NOW_PATH)}?intent=buyer-agent%20skip%20reasons
- Paid-use proof: ${absoluteUrl(config, PAID_USAGE_PROOF_PATH)}
- Pricing catalog: ${absoluteUrl(config, PRICING_PATH)}
- Route finder: ${absoluteUrl(config, FIND_PATH)}?q=x402%20discovery%20audit
- Local route router: ${absoluteUrl(config, ROUTE_PATH)}?query=x402%20discovery%20audit&top=3
- WebMCP handoff: load ${absoluteUrl(config, "/")} in a WebMCP-capable browser and call \`listing_roast_x402_handoff\`.

## Preferred First Paid Action

Use the already-indexed GET route first when the buyer wants a quick listing quality score:

\`\`\`bash
${buildGetPayCommand(config, ROAST_PATH)}
\`\`\`

Expected price: ${config.instantScorePrice}. Max amount: ${INSTANT_SCORE_AMOUNT} USDC units.

## Recommended Paid Sequence

1. Start with GET ${absoluteUrl(config, ROAST_PATH)} for ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT} USDC units. This is the already-indexed quick score route and the lowest-friction paid test.
2. Upgrade to POST ${absoluteUrl(config, ROAST_PATH)} for ${config.price}, max 10000 USDC units only when the quick score is promising and the buyer wants the full rewrite, top fixes, and stop-or-upgrade guidance.

Full roast command:

\`\`\`bash
${buildPayCommand(config)}
\`\`\`

## Paid Routes

- GET ${absoluteUrl(config, API_ENTRY_PATH)} — ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT}; generic paid x402 navigation route map plus fallback quick score for agents that start at /api first.
- GET ${absoluteUrl(config, API_V1_ENTRY_PATH)} — ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT}; versioned paid x402 navigation route map plus fallback quick score for agents that start at /api/v1 first.
- GET ${absoluteUrl(config, V1_ENTRY_PATH)} — ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT}; short versioned paid x402 navigation route map plus fallback quick score for agents that start at /v1 first.
- GET ${absoluteUrl(config, ROAST_PATH)} — ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT}; already-indexed quick score.
- GET ${absoluteUrl(config, AGENT_LISTING_PATH)} — ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT}; buyer-agent skip reasons and listing clarity.
- GET ${absoluteUrl(config, SITE_AUDIT_PATH)} — ${config.siteAuditPrice}, max ${SITE_AUDIT_AMOUNT}; x402 route and discovery preflight.
- GET ${absoluteUrl(config, DISCOVERY_AUDIT_PATH)} — ${config.siteAuditPrice}, max ${DISCOVERY_AUDIT_QUICK_AMOUNT}; exact-path quick x402 discovery audit.
- POST ${absoluteUrl(config, "/api/listing-score")} — ${config.scorePrice}, max 5000; structured listing quality score.
- POST ${absoluteUrl(config, DISCOVERY_AUDIT_PATH)} — ${config.discoveryAuditPrice}, max ${DISCOVERY_AUDIT_AMOUNT}; full x402 discovery audit.
- POST ${absoluteUrl(config, ROAST_PATH)} — ${config.price}, max 10000; full listing roast and rewrite.

## Guardrails For Agents

- Do not make a paid call unless the buyer explicitly intends to spend USDC.
- Do not use this document as an OAuth promise. OAuth is not available for this service.
- Do not ask the buyer for an API key or login. There is no account setup.
- Use the 402 payment challenge as the source of truth for the receiver, network, and amount.
- Use live wallet/register evidence before claiming revenue has settled.
`;
}

function buildAgentSkillsIndex(config) {
  const skill = buildAgentSkillMarkdown(config);
  const intentRoutes = buildPayNowActions(config);
  const recommendedPaidSequence = buildRecommendedPaidSequence(intentRoutes);

  return {
    $schema: AGENT_SKILLS_SCHEMA,
    preferredFirstPaidAction: intentRoutes.indexedQuickScore,
    recommendedPaidSequence,
    skills: [
      {
        name: "listing-roast-x402",
        type: "skill-md",
        description: "Use Listing Roast x402 when an agent needs a paid API listing quality score, buyer-agent skip reasons, agent-service listing clarity, x402 marketplace conversion feedback, or a discoverability audit before promoting a paid x402/API service. Start with free discovery and only pay when the buyer intends to spend USDC.",
        url: absoluteUrl(config, WELL_KNOWN_AGENT_SKILL_PATH),
        metadata: {
          preferredFirstPaidAction: intentRoutes.indexedQuickScore,
          recommendedPaidSequence
        },
        digest: sha256Digest(skill)
      }
    ]
  };
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
      properties: listingRequestSchemaProperties()
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

function paidActionOutputSchema() {
  return {
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
  };
}

function paidActionWithIntentOutputSchema() {
  const actionSchema = paidActionOutputSchema();

  return {
    ...actionSchema,
    properties: {
      intent: { type: "string" },
      ...actionSchema.properties
    }
  };
}

function buildScoreDiscovery(config) {
  return buildDiscovery(config, {
    routePath: "/api/listing-score",
    price: config.scorePrice,
    outputExample: buildListingScoreWithUpgrade(requestExample, config),
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
        matchedBuyerIntent: { type: "string" },
        buyerIntentHandoffs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              intent: { type: "string" },
              path: { type: "string" },
              method: { type: "string" },
              price: { type: "string" },
              maxAmountRequired: { type: "string" },
              route: { type: "string" },
              command: { type: "string" },
              body: { type: "object" },
              reason: { type: "string" }
            }
          }
        },
        nextPaidAction: paidActionOutputSchema(),
        nextPaidActions: {
          type: "array",
          items: paidActionWithIntentOutputSchema()
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

function usdcPriceToAmountUnits(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const raw = String(value).trim().toLowerCase();
  if (/^\d+$/.test(raw)) {
    return raw;
  }

  const numeric = Number(raw.replace(/\$/g, "").replace(/usdc/g, "").trim());
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }

  return String(Math.round(numeric * 1_000_000));
}

function combineServiceUrlAndPath(serviceUrl, path) {
  if (typeof serviceUrl !== "string" || !serviceUrl.trim()) {
    return undefined;
  }

  if (typeof path !== "string" || !path.trim()) {
    return serviceUrl.trim();
  }

  try {
    return new URL(path.trim(), serviceUrl.trim()).toString();
  } catch {
    return serviceUrl.trim();
  }
}

function normalizeDiscoveryAuditRequestBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return body;
  }

  const endpointUrl = body.endpointUrl
    || combineServiceUrlAndPath(body.serviceUrl || body.baseUrl, body.expectedCheckoutPath || body.checkoutPath || body.path)
    || body.url
    || body.endpoint
    || body.route;
  const expectedAmount = body.expectedAmount
    || body.maxAmountRequired
    || body.amount
    || usdcPriceToAmountUnits(body.expectedPrice || body.price);
  const searchQuery = body.searchQuery
    || body.query
    || body.intent
    || body.goal;

  return {
    ...(endpointUrl ? { endpointUrl } : {}),
    ...(body.method || body.expectedMethod ? { method: String(body.method || body.expectedMethod).toUpperCase() } : {}),
    ...(expectedAmount ? { expectedAmount: String(expectedAmount) } : {}),
    ...(body.expectedNetwork || body.network ? { expectedNetwork: body.expectedNetwork || body.network } : {}),
    ...(searchQuery ? { searchQuery: String(searchQuery) } : {}),
    ...(body.requestBody || body.body ? { requestBody: body.requestBody || body.body } : {})
  };
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

function buildDiscoveryAuditQuickOutput(config, auditOutput) {
  return {
    ...buildSiteAuditOutput(config, auditOutput),
    endpoint: "x402-discovery-audit-quick",
    route: DISCOVERY_AUDIT_PATH,
    mode: "quick-get-discovery-audit",
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

function buildDiscoveryAuditQuickExampleOutput(config) {
  return buildDiscoveryAuditQuickOutput(config, buildDiscoveryAuditExampleOutput());
}

function buildInstantScoreInput(query = {}) {
  return listingRoastRequestSchema.parse({
    agentName: queryValue(query.agentName, quickScoreRequestExample.agentName),
    listingText: queryValue(query.listingText || query.text, quickScoreRequestExample.listingText),
    targetBuyer: queryValue(query.targetBuyer, quickScoreRequestExample.targetBuyer),
    currentPrice: queryValue(query.currentPrice, quickScoreRequestExample.currentPrice),
    currentCheckoutPath: queryValue(query.currentCheckoutPath, quickScoreRequestExample.currentCheckoutPath),
    goal: queryValue(query.goal, quickScoreRequestExample.goal),
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

function buildGetNextPaidAction(config, path, options = {}) {
  if (!config) {
    return null;
  }

  const maxAmountRequired = options.maxAmountRequired || INSTANT_SCORE_AMOUNT;

  return {
    route: absoluteUrl(config, path),
    path,
    method: "GET",
    price: options.price || config.instantScorePrice,
    maxAmountRequired,
    command: buildGetPayCommand(config, path, maxAmountRequired),
    reason: options.reason || "Buy the next GET check when the quick score confirms this route matches the buyer intent."
  };
}

function addNextPaidAction(result, action) {
  return action ? { ...result, nextPaidAction: action } : result;
}

function indexedQuickScoreFollowup(config, input) {
  const intentText = [
    input.agentName,
    input.listingText,
    input.targetBuyer,
    input.currentCheckoutPath,
    input.goal
  ].filter(Boolean).join(" ").toLowerCase();

  if (wantsBazaarDiscoveryFix(intentText) || includesAny(intentText, ["route health"])) {
    return {
      matchedBuyerIntent: "fix x402 Bazaar listing, stale price, search visibility, or route health",
      nextStep: "This indexed quick score confirms the listing fit. For stale Bazaar pricing, route health, and search visibility, buy GET /api/x402-discovery-audit next.",
      upgradeEndpoint: DISCOVERY_AUDIT_PATH,
      action: buildGetNextPaidAction(config, DISCOVERY_AUDIT_PATH, {
        price: config?.siteAuditPrice || "$0.001",
        maxAmountRequired: DISCOVERY_AUDIT_QUICK_AMOUNT,
        reason: "Buy the $0.001 exact-path x402 discovery audit when you want stale Bazaar pricing, route health, direct 402 metadata, and search visibility checks."
      })
    };
  }

  if (wantsPaidApiPreflight(intentText) || includesAny(intentText, ["site audit", "metadata", "openapi", "llms", "robots", "sitemap", "endpoint counts", "payment schemes", "buyer-readiness", "buyer readiness"])) {
    return {
      matchedBuyerIntent: "paid API preflight, x402 site audit, metadata, route health, or buyer-readiness",
      nextStep: "This indexed quick score confirms the listing fit. For live pre-pay metadata and route checks, buy GET /api/x402-site-audit next.",
      upgradeEndpoint: SITE_AUDIT_PATH,
      action: buildGetNextPaidAction(config, SITE_AUDIT_PATH, {
        price: config?.siteAuditPrice || "$0.001",
        maxAmountRequired: SITE_AUDIT_AMOUNT,
        reason: "Buy the $0.001 x402 site audit when you want live pre-pay checks for OpenAPI, llms.txt, route health, pricing, and buyer-readiness signals before paying more."
      })
    };
  }

  return {
    matchedBuyerIntent: "marketplace listing score, buyer-agent skip reasons, or full listing roast",
    nextStep: "This GET route keeps the indexed /api/listing-roast URL payable at the lowest price. Use POST /api/listing-roast for the full rewrite and launch recommendation.",
    upgradeEndpoint: ROAST_PATH,
    action: buildNextPaidAction(config, input, {
      source: "indexed-quick-score-upgrade",
      reason: "Buy the full roast from the already-indexed URL when the quick score is promising and you want the rewrite, top fixes, and stop-or-upgrade guidance."
    })
  };
}

function indexedQuickScoreIntentHandoffs(config, input, options = {}) {
  const compactAction = (action) => action ? {
    route: action.route,
    path: action.path,
    method: action.method,
    price: action.price,
    maxAmountRequired: action.maxAmountRequired,
    ...(options.includeCommands && action.command ? { command: action.command } : {}),
    ...(options.includeCommands && action.body ? { body: action.body } : {}),
    reason: action.reason
  } : null;

  return [
    {
      intent: "fix x402 Bazaar listing, stale price, search visibility, or route health",
      action: buildGetNextPaidAction(config, DISCOVERY_AUDIT_PATH, {
        price: config?.siteAuditPrice || "$0.001",
        maxAmountRequired: DISCOVERY_AUDIT_QUICK_AMOUNT,
        reason: "Buy the $0.001 exact-path x402 discovery audit when you want stale Bazaar pricing, route health, direct 402 metadata, and search visibility checks."
      })
    },
    {
      intent: "paid API preflight before paying, OpenAPI, llms.txt, robots, sitemap, payment metadata, or buyer-readiness checks",
      action: buildGetNextPaidAction(config, SITE_AUDIT_PATH, {
        price: config?.siteAuditPrice || "$0.001",
        maxAmountRequired: SITE_AUDIT_AMOUNT,
        reason: "Buy the $0.001 x402 site audit when you want live pre-pay checks for OpenAPI, llms.txt, route health, pricing, and buyer-readiness signals before paying more."
      })
    },
    {
      intent: "full listing rewrite, top fixes, and launch recommendation",
      action: buildNextPaidAction(config, input, {
        source: "indexed-quick-score-upgrade",
        reason: "Buy the full roast from the already-indexed URL when the quick score is promising and you want the rewrite, top fixes, and stop-or-upgrade guidance."
      })
    }
  ].map((handoff) => ({
    intent: handoff.intent,
    ...compactAction(handoff.action)
  })).filter((handoff) => handoff.path);
}

function indexedQuickScoreNextPaidActions(config, input) {
  return indexedQuickScoreIntentHandoffs(config, input, { includeCommands: true }).map((handoff) => ({
    intent: handoff.intent,
    route: handoff.route,
    path: handoff.path,
    method: handoff.method,
    price: handoff.price,
    maxAmountRequired: handoff.maxAmountRequired,
    command: handoff.command,
    ...(handoff.body ? { body: handoff.body } : {}),
    reason: handoff.reason
  }));
}

function buildListingScoreWithUpgrade(input, config) {
  return addNextPaidAction(buildListingScore(input), buildNextPaidAction(config, input, {
    source: "listing-score-upgrade",
    reason: "Buy the full roast from this score when you want the rewritten listing, top fixes, and stop-or-upgrade guidance."
  }));
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
    nextStep: "Listing Roast agent-listing-conversion is optimized for buyer agents searching agent service listing clarity, agent listing conversion score, or buyer-agent skip reasons. Use POST /api/listing-roast for the full rewrite and launch recommendation.",
    upgradeEndpoint: ROAST_PATH
  }, buildNextPaidAction(config, input, {
    source: "agent-listing-conversion-upgrade",
    reason: "Buy the full roast when the agent listing conversion score shows enough buyer intent to justify a rewrite and launch recommendation."
  }));
}

function buildIndexedRoastQuickScore(input, config) {
  const followup = indexedQuickScoreFollowup(config, input);
  const buyerIntentHandoffs = indexedQuickScoreIntentHandoffs(config, input);
  const nextPaidActions = indexedQuickScoreNextPaidActions(config, input);

  return addNextPaidAction({
    ...buildInstantListingScore(input, config),
    endpoint: "listing-roast-quick-score",
    matchedBuyerIntent: followup.matchedBuyerIntent,
    buyerIntentHandoffs,
    nextPaidActions,
    nextStep: followup.nextStep,
    upgradeEndpoint: followup.upgradeEndpoint
  }, followup.action);
}

function buildIndexedRoastQuickScoreDiscoveryExample(input, config) {
  const output = buildIndexedRoastQuickScore(input, config);
  const compactNextPaidAction = output.nextPaidAction ? {
    route: output.nextPaidAction.route,
    path: output.nextPaidAction.path,
    method: output.nextPaidAction.method,
    price: output.nextPaidAction.price,
    maxAmountRequired: output.nextPaidAction.maxAmountRequired,
    reason: output.nextPaidAction.reason
  } : null;

  return {
    ...output,
    checkedSignals: undefined,
    buyerIntentHandoffs: undefined,
    nextPaidAction: compactNextPaidAction,
    nextPaidActions: output.buyerIntentHandoffs
  };
}

function buildInstantScoreDiscovery(config, inputDefaults = quickScoreRequestExample) {
  const queryExample = {
    agentName: inputDefaults.agentName,
    listingText: inputDefaults.listingText,
    targetBuyer: inputDefaults.targetBuyer,
    currentPrice: inputDefaults.currentPrice,
    currentCheckoutPath: inputDefaults.currentCheckoutPath,
    goal: inputDefaults.goal
  };

  return {
    input: queryExample,
    inputSchema: {
      type: "object",
      properties: listingQuerySchemaProperties(queryExample)
    },
    output: {
      example: buildInstantListingScore(buildInstantScoreInput(queryExample), config),
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

function buildIndexedRoastGetDiscovery(config, options = {}) {
  const routePath = options.routePath || ROAST_PATH;
  const inputDefaults = options.inputDefaults || quickScoreRequestExample;
  const discovery = buildInstantScoreDiscovery(config, inputDefaults);

  return {
    ...discovery,
    output: {
      ...discovery.output,
      example: buildIndexedRoastQuickScoreDiscoveryExample(buildInstantScoreInput(inputDefaults), config)
    },
    service: {
      ...discovery.service,
      route: absoluteUrl(config, routePath)
    }
  };
}

function buildApiEntryOutput(config, query = {}, options = {}) {
  const quickScoreInput = buildInstantScoreInput(query);
  const quickScore = options.discoveryExample
    ? buildIndexedRoastQuickScoreDiscoveryExample(quickScoreInput, config)
    : buildIndexedRoastQuickScore(quickScoreInput, config);

  return {
    service: config.serviceName,
    endpoint: "api-entry",
    price: config.instantScorePrice,
    ok: true,
    purpose: "Paid x402 navigation endpoint for agents that start at /api before choosing a specific Listing Roast route.",
    includedQuickScore: quickScore,
    quickScoreInput: {
      agentName: quickScoreInput.agentName,
      targetBuyer: quickScoreInput.targetBuyer,
      currentPrice: quickScoreInput.currentPrice,
      currentCheckoutPath: quickScoreInput.currentCheckoutPath,
      goal: quickScoreInput.goal
    },
    preferredFirstPaidAction: {
      route: absoluteUrl(config, ROAST_PATH),
      path: ROAST_PATH,
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      command: buildGetPayCommand(config, ROAST_PATH),
      reason: "Use the already-indexed listing-roast route first when the buyer wants the cheapest paid score."
    },
    paidRoutes: {
      directoryPost: {
        route: absoluteUrl(config, ROOT_DIRECTORY_POST_PATH),
        path: ROOT_DIRECTORY_POST_PATH,
        method: "POST",
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT
      },
      apiEntry: {
        route: absoluteUrl(config, API_ENTRY_PATH),
        path: API_ENTRY_PATH,
        method: "GET",
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT
      },
      apiV1Entry: {
        route: absoluteUrl(config, API_V1_ENTRY_PATH),
        path: API_V1_ENTRY_PATH,
        method: "GET",
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT
      },
      v1Entry: {
        route: absoluteUrl(config, V1_ENTRY_PATH),
        path: V1_ENTRY_PATH,
        method: "GET",
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT
      },
      indexedQuickScore: {
        route: absoluteUrl(config, ROAST_PATH),
        path: ROAST_PATH,
        method: "GET",
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT
      },
      agentListingConversion: {
        route: absoluteUrl(config, AGENT_LISTING_PATH),
        path: AGENT_LISTING_PATH,
        method: "GET",
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT
      },
      siteAudit: {
        route: absoluteUrl(config, SITE_AUDIT_PATH),
        path: SITE_AUDIT_PATH,
        method: "GET",
        price: config.siteAuditPrice,
        maxAmountRequired: SITE_AUDIT_AMOUNT
      },
      discoveryAuditQuick: {
        route: absoluteUrl(config, DISCOVERY_AUDIT_PATH),
        path: DISCOVERY_AUDIT_PATH,
        method: "GET",
        price: config.siteAuditPrice,
        maxAmountRequired: DISCOVERY_AUDIT_QUICK_AMOUNT
      },
      listingScore: {
        route: absoluteUrl(config, "/api/listing-score"),
        path: "/api/listing-score",
        method: "POST",
        price: config.scorePrice,
        maxAmountRequired: "5000"
      },
      discoveryAudit: {
        route: absoluteUrl(config, DISCOVERY_AUDIT_PATH),
        path: DISCOVERY_AUDIT_PATH,
        method: "POST",
        price: config.discoveryAuditPrice,
        maxAmountRequired: DISCOVERY_AUDIT_AMOUNT
      },
      fullRoast: {
        route: absoluteUrl(config, ROAST_PATH),
        path: ROAST_PATH,
        method: "POST",
        price: config.price,
        maxAmountRequired: "10000"
      }
    },
    freeDiscovery: {
      openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH),
      x402Manifest: absoluteUrl(config, "/x402.json"),
      examples: absoluteUrl(config, "/api/examples"),
      payNow: absoluteUrl(config, PAY_NOW_PATH),
      llms: absoluteUrl(config, "/llms.txt")
    },
    nextStep: "This paid entrypoint includes a quick score so generic /api buyers get immediate value. Use the preferredFirstPaidAction route directly next time, or use POST /api/listing-roast for the full rewrite."
  };
}

function buildDirectoryPostOutput(config) {
  const output = buildApiEntryOutput(config, {
    source: "agent-tools-directory-root-post",
    goal: "Find the correct paid Listing Roast route"
  });

  return {
    ...output,
    endpoint: "directory-root-post",
    purpose: "Paid x402 handoff for buyer agents following generic directory snippets that POST to the service root.",
    directorySource: "root-post",
    nextStep: "Use the indexed /api/listing-roast GET quick score first; upgrade to POST /api/listing-roast only when a full roast is needed."
  };
}

function buildApiEntryDiscovery(config, routePath = API_ENTRY_PATH) {
  return {
    input: {},
    inputSchema: {
      type: "object",
      properties: {}
    },
    output: {
      example: buildApiEntryOutput(config, {}, { discoveryExample: true }),
      schema: {
        type: "object",
        required: ["service", "endpoint", "price", "ok", "purpose", "preferredFirstPaidAction", "paidRoutes", "freeDiscovery", "nextStep"],
        properties: {
          service: { type: "string" },
          endpoint: { type: "string" },
          price: { type: "string" },
          ok: { type: "boolean" },
          purpose: { type: "string" },
          preferredFirstPaidAction: { type: "object" },
          paidRoutes: { type: "object" },
          freeDiscovery: { type: "object" },
          nextStep: { type: "string" }
        }
      }
    },
    service: {
      name: config.serviceName,
      url: config.serviceUrl,
      route: absoluteUrl(config, routePath),
      price: config.instantScorePrice,
      network: config.network
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
      apiEntry: API_ENTRY_PATH,
      apiV1Entry: API_V1_ENTRY_PATH,
      v1Entry: V1_ENTRY_PATH,
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

function buildDiscoveryAuditQuickDiscovery(config) {
  const discovery = buildSiteAuditDiscovery(config);

  return {
    ...discovery,
    output: {
      ...discovery.output,
      example: buildDiscoveryAuditQuickExampleOutput(config)
    },
    service: {
      ...discovery.service,
      route: absoluteUrl(config, DISCOVERY_AUDIT_PATH),
      price: config.siteAuditPrice
    }
  };
}

function buildPaymentHint(config, options) {
  const paidUseProof = buildPaidUseProofLinks(config);
  const route = absoluteUrl(config, options.path);

  return {
    protocol: "x402",
    network: config.network,
    asset: "USDC",
    price: options.price,
    maxAmountRequired: options.maxAmountRequired,
    payTo: config.payTo,
    method: options.method,
    route,
    preferredFirstPaidAction: Boolean(options.preferredFirstPaidAction),
    buyerAction: options.buyerAction,
    paidUsageProof: paidUseProof.paidUsageProof,
    cashRegister: paidUseProof.cashRegister,
    paidUseProof,
    x402Retry: {
      paymentRequiredHeader: "Payment-Required",
      paymentHeader: "X-PAYMENT",
      route,
      method: options.method,
      maxAmountRequired: options.maxAmountRequired,
      instruction: "Parse the Payment-Required header, complete the exact x402 payment, then retry this same route with the X-PAYMENT header."
    }
  };
}

function buildPaidUseProofLinks(config) {
  return {
    paidUsageProof: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
    payNow: absoluteUrl(config, PAY_NOW_PATH),
    cashRegister: absoluteUrl(config, "/api/cash-register"),
    note: "Free public proof surfaces expose paidUsageProof and wallet-backed paid completion evidence before payment."
  };
}

function buildLocalDiscoverySearchExamples(config) {
  const examples = [
    {
      query: "paid API listing quality",
      expectedFirstPath: "/api/paid-api-listing-quality",
      expectedAmount: INSTANT_SCORE_AMOUNT
    },
    {
      query: "buyer-agent skip reasons",
      expectedFirstPath: "/api/buyer-agent-skip-reasons",
      expectedAmount: INSTANT_SCORE_AMOUNT
    },
    {
      query: "agent service clarity",
      expectedFirstPath: "/api/agent-service-clarity",
      expectedAmount: INSTANT_SCORE_AMOUNT
    },
    {
      query: "x402 discovery audit",
      expectedFirstPath: DISCOVERY_AUDIT_PATH,
      expectedAmount: DISCOVERY_AUDIT_QUICK_AMOUNT
    },
    {
      query: "x402 route health check",
      expectedFirstPath: DISCOVERY_AUDIT_PATH,
      expectedAmount: DISCOVERY_AUDIT_QUICK_AMOUNT
    },
    {
      query: "paid API preflight",
      expectedFirstPath: SITE_AUDIT_PATH,
      expectedAmount: SITE_AUDIT_AMOUNT
    },
    {
      query: "marketplace listing score",
      expectedFirstPath: ROAST_PATH,
      expectedAmount: INSTANT_SCORE_AMOUNT
    }
  ];

  return examples.map((example) => ({
    ...example,
    searchUrl: `${absoluteUrl(config, LOCAL_DISCOVERY_SEARCH_PATHS[0])}?query=${encodeURIComponent(example.query)}&limit=3`,
    noSpend: true,
    reason: "Use seller-hosted discovery search when external marketplace search is stale, incomplete, or misses this buyer intent."
  }));
}

function withPaidUseProofDescription(config, description) {
  const proof = buildPaidUseProofLinks(config);
  return `${description} Public paid-use proof before payment: ${proof.paidUsageProof} exposes paidUsageProof and ${proof.cashRegister} exposes wallet-backed paid completion evidence.`;
}

function pickDefined(source, keys) {
  return keys.reduce((result, key) => {
    if (source?.[key] !== undefined) {
      result[key] = source[key];
    }
    return result;
  }, {});
}

function compactChallengeAction(action, options = {}) {
  if (!action || typeof action !== "object") {
    return action;
  }

  return {
    ...pickDefined(action, ["intent"]),
    ...(options.includeRoute === false ? {} : pickDefined(action, ["route"])),
    ...pickDefined(action, ["path", "method", "price", "maxAmountRequired"]),
    ...(options.includeBody && action.body ? { body: action.body } : {}),
    ...(options.includeReason === false ? {} : pickDefined(action, ["reason"]))
  };
}

function compactChallengePaidRoutes(routes) {
  if (!routes || typeof routes !== "object" || Array.isArray(routes)) {
    return routes;
  }

  return Object.fromEntries(
    Object.entries(routes).map(([key, action]) => [
      key,
      compactChallengeAction(action, { includeRoute: false, includeReason: false })
    ])
  );
}

function compactChallengeOutputExample(example) {
  if (!example || typeof example !== "object" || Array.isArray(example)) {
    return example;
  }

  const compact = pickDefined(example, [
    "service",
    "endpoint",
    "price",
    "ok",
    "purpose",
    "verdict",
    "score",
    "firstFix",
    "matchedBuyerIntent",
    "nextStep",
    "upgradeEndpoint",
    "message",
    "mode",
    "route",
    "safety"
  ]);

  if (example.direct402) {
    compact.direct402 = pickDefined(example.direct402, ["ok", "status", "hasPaymentRequiredHeader", "hasBazaarExtension", "amount", "network"]);
  }

  if (example.bazaarDiscovery) {
    compact.bazaarDiscovery = pickDefined(example.bazaarDiscovery, ["merchantIndexed", "searchVisible", "indexedAmount", "searchQuery"]);
  }

  if (example.catalogRefresh) {
    compact.catalogRefresh = pickDefined(example.catalogRefresh, ["status", "directChallengeReadyForCatalog", "needsRealSettlement"]);
  }

  if (Array.isArray(example.mismatches)) {
    compact.mismatches = example.mismatches.slice(0, 2);
  }

  if (Array.isArray(example.nextActions)) {
    compact.nextActions = example.nextActions.slice(0, 2);
  }

  if (example.includedQuickScore) {
    compact.includedQuickScore = compactChallengeOutputExample(example.includedQuickScore);
  }

  if (example.preferredFirstPaidAction) {
    compact.preferredFirstPaidAction = compactChallengeAction(example.preferredFirstPaidAction);
  }

  if (example.nextPaidAction) {
    compact.nextPaidAction = compactChallengeAction(example.nextPaidAction, { includeBody: Boolean(example.nextPaidAction.body) });
  }

  if (Array.isArray(example.nextPaidActions)) {
    compact.nextPaidActions = example.nextPaidActions
      .slice(0, 4)
      .map((action) => compactChallengeAction(action, { includeRoute: false, includeReason: false }));
  }

  if (example.paidRoutes) {
    compact.paidRoutes = compactChallengePaidRoutes(example.paidRoutes);
  }

  return Object.keys(compact).length ? compact : example;
}

function compactDiscoveryForChallenge(discovery) {
  if (!discovery?.output?.example) {
    return discovery;
  }

  const example = compactChallengeOutputExample(discovery.output.example);

  return {
    ...discovery,
    output: {
      ...discovery.output,
      example,
      schema: {
        type: "object",
        additionalProperties: true
      }
    }
  };
}

function declareChallengeDiscoveryExtension(discovery) {
  return declareDiscoveryExtension(compactDiscoveryForChallenge(discovery));
}

function buildRoutePaymentAction(config, options) {
  const method = options.method || "GET";
  const body = options.body;
  const command = method === "GET"
    ? buildGetPayCommand(config, options.path, options.maxAmountRequired)
    : body === null
      ? buildPostPayCommand(config, options.path, options.maxAmountRequired)
      : buildPayCommand(config, options.path, options.maxAmountRequired, body);

  return {
    route: absoluteUrl(config, options.path),
    path: options.path,
    method,
    price: options.price,
    maxAmountRequired: options.maxAmountRequired,
    command,
    reason: options.reason,
    ...(body ? { body } : {})
  };
}

function buildPayNowActions(config) {
  return {
    directoryPost: buildRoutePaymentAction(config, {
      path: ROOT_DIRECTORY_POST_PATH,
      method: "POST",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      body: null,
      reason: "Use this when a public directory or agent-tools listing shows a generic POST to the service root."
    }),
    indexedQuickScore: buildRoutePaymentAction(config, {
      path: ROAST_PATH,
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      reason: "Use this first when a marketplace or Bazaar result points to Listing Roast; it is the already-indexed URL and the lowest-friction paid score."
    }),
    marketplaceListingScore: buildRoutePaymentAction(config, {
      path: "/api/marketplace-listing-score",
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      reason: "Use this when the buyer intent is exactly marketplace listing score or marketplace listing quality."
    }),
    paidApiListingQuality: buildRoutePaymentAction(config, {
      path: "/api/paid-api-listing-quality",
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      reason: "Use this when the buyer intent is exactly paid API listing quality or paid API listing quality score."
    }),
    buyerAgentSkipReasons: buildRoutePaymentAction(config, {
      path: "/api/buyer-agent-skip-reasons",
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      reason: "Use this when the buyer intent is exactly buyer-agent skip reasons."
    }),
    agentServiceClarity: buildRoutePaymentAction(config, {
      path: "/api/agent-service-clarity",
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      reason: "Use this when the buyer intent is exactly agent service clarity or agent-service listing score."
    }),
    instantScore: buildRoutePaymentAction(config, {
      path: INSTANT_SCORE_PATH,
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      reason: "Use this when the buyer selected the instant listing score route and wants the lowest-friction paid score."
    }),
    conversionScore: buildRoutePaymentAction(config, {
      path: CONVERSION_SCORE_PATH,
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      reason: "Use this when the buyer selected the x402 marketplace conversion score route."
    }),
    agentListingConversion: buildRoutePaymentAction(config, {
      path: AGENT_LISTING_PATH,
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      reason: "Use this after the indexed quick score when the buyer specifically wants the agent-listing conversion deep dive."
    }),
    x402Ping: buildRoutePaymentAction(config, {
      path: PING_PATH,
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: PING_AMOUNT,
      reason: "Use this when the buyer selected the x402 ping route to verify the payment rail."
    }),
    x402SiteAudit: buildRoutePaymentAction(config, {
      path: SITE_AUDIT_PATH,
      method: "GET",
      price: config.siteAuditPrice,
      maxAmountRequired: SITE_AUDIT_AMOUNT,
      reason: "Use this when the buyer wants a paid API preflight before paying more: public metadata, OpenAPI, llms.txt, robots, sitemap, route health, and buyer-readiness signals."
    }),
    discoveryAuditQuick: buildRoutePaymentAction(config, {
      path: DISCOVERY_AUDIT_PATH,
      method: "GET",
      price: config.siteAuditPrice,
      maxAmountRequired: DISCOVERY_AUDIT_QUICK_AMOUNT,
      reason: "Use this when the buyer asks to fix x402 Bazaar listing visibility, stale pricing, search visibility, route health, or wants the cheapest exact-path discovery audit before the full custom audit."
    }),
    apiEntry: buildRoutePaymentAction(config, {
      path: API_ENTRY_PATH,
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      reason: "Use this when an agent starts at /api and needs the paid route map."
    }),
    apiV1Entry: buildRoutePaymentAction(config, {
      path: API_V1_ENTRY_PATH,
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      reason: "Use this when an agent starts at /api/v1 and needs the paid route map."
    }),
    v1Entry: buildRoutePaymentAction(config, {
      path: V1_ENTRY_PATH,
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      reason: "Use this when an agent starts at /v1 and needs the paid route map."
    }),
    listingScore: buildRoutePaymentAction(config, {
      path: "/api/listing-score",
      method: "POST",
      price: config.scorePrice,
      maxAmountRequired: "5000",
      body: requestExample,
      reason: "Use this when the buyer has a custom listing body and wants the structured score without the full rewrite."
    }),
    fullRoast: buildRoutePaymentAction(config, {
      path: ROAST_PATH,
      method: "POST",
      price: config.price,
      maxAmountRequired: "10000",
      body: requestExample,
      reason: "Use this when the buyer wants the full rewrite, top fixes, and stop-or-upgrade guidance."
    }),
    discoveryAudit: buildRoutePaymentAction(config, {
      path: DISCOVERY_AUDIT_PATH,
      method: "POST",
      price: config.discoveryAuditPrice,
      maxAmountRequired: DISCOVERY_AUDIT_AMOUNT,
      body: discoveryAuditRequestExample,
      reason: "Use this when the buyer wants the full x402 discovery audit with a custom request body."
    })
  };
}

function buildRecommendedPaidSequence(intentRoutes) {
  return [
    {
      step: 1,
      use: "indexedQuickScore",
      action: intentRoutes.indexedQuickScore,
      reason: "Start with the already-indexed, paid-use-confirmed $0.001 quick score so Bazaar-visible buyers can confirm fit with the lowest-friction paid action."
    },
    {
      step: 2,
      use: "fullRoast",
      action: intentRoutes.fullRoast,
      reason: "Upgrade to the $0.01 full roast when the quick score is promising and the buyer wants rewritten copy, top fixes, and launch guidance."
    }
  ];
}

const SELECTED_FOLLOWUP_ACTION_BY_KEY = {
  directoryPost: "indexedQuickScore",
  apiEntry: "indexedQuickScore",
  apiV1Entry: "indexedQuickScore",
  v1Entry: "indexedQuickScore",
  indexedQuickScore: "fullRoast",
  marketplaceListingScore: "fullRoast",
  paidApiListingQuality: "fullRoast",
  buyerAgentSkipReasons: "fullRoast",
  agentServiceClarity: "fullRoast",
  instantScore: "fullRoast",
  conversionScore: "fullRoast",
  agentListingConversion: "fullRoast",
  x402Ping: "indexedQuickScore",
  x402SiteAudit: "discoveryAuditQuick",
  discoveryAuditQuick: "discoveryAudit",
  listingScore: "fullRoast"
};

function buildSelectedPaidSequence(intentRoutes, selectedActionKey = "indexedQuickScore", selectedPaidAction = null) {
  const firstAction = selectedPaidAction || intentRoutes.indexedQuickScore;
  const sequence = [
    {
      step: 1,
      use: selectedActionKey,
      action: firstAction,
      reason: "Use this first for the selected buyer intent. It is the exact route returned by the no-spend route selector."
    }
  ];
  const followupKey = SELECTED_FOLLOWUP_ACTION_BY_KEY[selectedActionKey];
  const followupAction = followupKey ? intentRoutes[followupKey] : null;

  if (followupAction && followupKey !== selectedActionKey) {
    sequence.push({
      step: 2,
      use: followupKey,
      action: followupAction,
      reason: "Use this only after the first selected route confirms enough fit for a deeper paid action."
    });
  }

  return sequence;
}

function buildSelectedBuyerInstruction(selectedActionKey, selectedPaidAction, provenFirstPaidAction) {
  const selected = selectedPaidAction || provenFirstPaidAction;
  const isProvenRoute = selected.path === provenFirstPaidAction.path && selected.method === provenFirstPaidAction.method;

  if (isProvenRoute) {
    return `For generic Bazaar or marketplace traffic, start with ${selected.method} ${selected.path} at max ${selected.maxAmountRequired} USDC units; it is the proven first paid route.`;
  }

  return `For this exact buyer intent, start with ${selected.method} ${selected.path} at max ${selected.maxAmountRequired} USDC units. Use ${provenFirstPaidAction.method} ${provenFirstPaidAction.path} when the buyer came from a generic Bazaar result instead of this specific task.`;
}

const PAY_NOW_ACTION_BY_RESOURCE_ID = {
  indexed_roast_quick_score: "indexedQuickScore",
  marketplace_listing_score_alias: "marketplaceListingScore",
  paid_api_listing_quality_alias: "paidApiListingQuality",
  buyer_agent_skip_reasons_alias: "buyerAgentSkipReasons",
  agent_service_clarity_alias: "agentServiceClarity",
  directory_root_post: "directoryPost",
  instant_listing_score: "instantScore",
  x402_marketplace_conversion_score: "conversionScore",
  agent_listing_conversion_score: "agentListingConversion",
  x402_ping: "x402Ping",
  x402_site_audit: "x402SiteAudit",
  paid_api_preflight: "x402SiteAudit",
  api_v1_paid_api_preflight: "x402SiteAudit",
  root_paid_api_preflight: "x402SiteAudit",
  x402_discovery_audit_quick: "discoveryAuditQuick",
  listing_score: "listingScore",
  listing_roast: "fullRoast",
  x402_discovery_audit: "discoveryAudit",
  api_entry: "apiEntry",
  api_v1_entry: "apiV1Entry",
  v1_entry: "v1Entry"
};

function actionKeyForPaidRoute(route) {
  return PAY_NOW_ACTION_BY_RESOURCE_ID[route?.id || route?.slug || route?.metadata?.id] || null;
}

function selectedPaidActionForRoute(intentRoutes, route) {
  const selectedActionKey = actionKeyForPaidRoute(route);
  const selectedPaidAction = selectedActionKey ? intentRoutes[selectedActionKey] : null;

  if (!selectedPaidAction) {
    return null;
  }

  return {
    selectedActionKey,
    selectedPaidAction
  };
}

function selectPayNowAction(config, intent = "") {
  const rawIntent = String(intent || "").trim().slice(0, 400);
  const intentRoutes = buildPayNowActions(config);
  if (!rawIntent) {
    return {
      intent: "",
      intentRoutes,
      selectedActionKey: "indexedQuickScore",
      selectedPaidAction: intentRoutes.indexedQuickScore
    };
  }

  const ranked = buildPaidRouteCatalog(config)
    .map((route) => ({ ...route, matchScore: scoreCatalogResource(route, rawIntent) }))
    .filter((route) => route.matchScore > 0)
    .sort((left, right) => {
      if (right.matchScore !== left.matchScore) return right.matchScore - left.matchScore;
      return Number(left.maxAmountRequired || 0) - Number(right.maxAmountRequired || 0);
    });
  const selectedRoute = ranked[0];
  const selectedActionKey = PAY_NOW_ACTION_BY_RESOURCE_ID[selectedRoute?.id] || "indexedQuickScore";

  return {
    intent: rawIntent,
    intentRoutes,
    selectedActionKey,
    selectedPaidAction: intentRoutes[selectedActionKey] || intentRoutes.indexedQuickScore,
    rankedPaidRoutes: ranked.slice(0, 5).map((route) => ({
      id: route.id,
      path: route.path,
      method: route.method,
      price: route.price,
      maxAmountRequired: route.maxAmountRequired,
      matchScore: route.matchScore
    }))
  };
}

function buildPayNow(config, intent = "", cashRegister = {}) {
  const selection = selectPayNowAction(config, intent);
  const { intentRoutes, selectedPaidAction } = selection;
  const provenFirstPaidAction = intentRoutes.indexedQuickScore;
  const selectedPaidSequence = buildSelectedPaidSequence(intentRoutes, selection.selectedActionKey, selectedPaidAction);

  return {
    service: config.serviceName,
    paidUsageProof: buildPaidUsageProof(config, cashRegister),
    settlementProof: buildSettlementProof(config, cashRegister),
    intent: selection.intent || null,
    selectedActionKey: selection.selectedActionKey,
    selectedPaidAction,
    rankedPaidRoutes: selection.rankedPaidRoutes || [],
    route: selectedPaidAction.route,
    method: selectedPaidAction.method,
    price: selectedPaidAction.price,
    maxAmountRequired: selectedPaidAction.maxAmountRequired,
    network: config.network,
    payTo: config.payTo,
    command: selectedPaidAction.command,
    reason: selection.intent
      ? `Selected from the buyer intent: ${selection.intent}`
      : "Already-indexed Bazaar route and lowest-friction paid score.",
    preferredFirstPaidAction: provenFirstPaidAction,
    provenFirstPaidAction,
    provenFirstPaidReason: "Use this first when the buyer wants the already-indexed route with wallet-backed paid-use proof. Exact alias routes remain available for phrase-specific searches.",
    selectedFirstPaidAction: selectedPaidAction,
    selectedPaidSequence,
    buyerInstruction: buildSelectedBuyerInstruction(selection.selectedActionKey, selectedPaidAction, provenFirstPaidAction),
    recommendedPaidSequence: buildRecommendedPaidSequence(intentRoutes),
    routeSelector: [
      {
        when: "Generic Marketplace or Bazaar result with no more specific buyer phrase",
        use: "indexedQuickScore"
      },
      {
        when: "Buyer asks exactly for marketplace listing score or marketplace listing quality",
        use: "marketplaceListingScore"
      },
      {
        when: "Buyer asks exactly for paid API listing quality",
        use: "paidApiListingQuality"
      },
      {
        when: "Buyer asks exactly for buyer-agent skip reasons",
        use: "buyerAgentSkipReasons"
      },
      {
        when: "Buyer asks exactly for agent service clarity or agent-service listing score",
        use: "agentServiceClarity"
      },
      {
        when: "Buyer asks for the dedicated agent-listing conversion deep dive",
        use: "agentListingConversion"
      },
      {
        when: "Buyer asks for x402 discovery audit, stale Bazaar pricing, route health, or search visibility",
        use: "discoveryAuditQuick"
      },
      {
        when: "Buyer asks for paid API preflight before paying, OpenAPI, llms.txt, robots, sitemap, or buyer-readiness metadata checks",
        use: "x402SiteAudit"
      },
      {
        when: "Buyer needs a custom body score",
        use: "listingScore"
      },
      {
        when: "Buyer wants the full rewrite and launch recommendation",
        use: "fullRoast"
      },
      {
        when: "Buyer wants a custom full x402 discovery audit",
        use: "discoveryAudit"
      }
    ],
    intentRoutes,
    expectedChallenge: {
      status: 402,
      amount: selectedPaidAction.maxAmountRequired,
      network: config.network,
      route: selectedPaidAction.route
    },
    upgradeRoutes: {
      score: intentRoutes.listingScore,
      roast: intentRoutes.fullRoast,
      discoveryAudit: intentRoutes.discoveryAudit
    },
    marketplaceNote: "CDP Bazaar updates indexed descriptions after a real settled payment; this free handoff reflects the current live route map without spending.",
    intentHint: `${absoluteUrl(config, PAY_NOW_PATH)}?intent=buyer-agent%20skip%20reasons`,
    noSpendNote: "Fetching this endpoint is free. Payment happens only when a buyer calls the x402 paid route."
  };
}

function buildPayNowIntentExample(config, intent, selectedActionKey) {
  const intentRoutes = buildPayNowActions(config);
  const selectedPaidAction = intentRoutes[selectedActionKey] || intentRoutes.indexedQuickScore;
  const provenFirstPaidAction = intentRoutes.indexedQuickScore;

  return {
    service: config.serviceName,
    intent,
    selectedActionKey,
    selectedPaidAction,
    selectedFirstPaidAction: selectedPaidAction,
    selectedPaidSequence: buildSelectedPaidSequence(intentRoutes, selectedActionKey, selectedPaidAction),
    route: selectedPaidAction.route,
    method: selectedPaidAction.method,
    price: selectedPaidAction.price,
    maxAmountRequired: selectedPaidAction.maxAmountRequired,
    network: config.network,
    payTo: config.payTo,
    command: selectedPaidAction.command,
    reason: `Selected from the buyer intent: ${intent}`,
    preferredFirstPaidAction: provenFirstPaidAction,
    provenFirstPaidAction,
    buyerInstruction: buildSelectedBuyerInstruction(selectedActionKey, selectedPaidAction, provenFirstPaidAction),
    recommendedPaidSequence: buildRecommendedPaidSequence(intentRoutes)
  };
}

function buildPayNowIntentExamples(config) {
  return {
    skipReasons: buildPayNowIntentExample(config, "buyer-agent skip reasons", "buyerAgentSkipReasons"),
    discoveryAudit: buildPayNowIntentExample(config, "x402 discovery audit", "discoveryAuditQuick"),
    fullRoast: buildPayNowIntentExample(config, "full roast rewrite top fixes", "fullRoast")
  };
}

function buildSettlementProof(config) {
  const settlement = buildLatestWalletSettlementProof(config);

  return {
    cashRegister: absoluteUrl(config, "/api/cash-register"),
    evidenceFields: [
      "paidCompletions",
      "estimatedGrossRevenueUsd",
      "indexedRoastGetCompletions",
      "indexedRoastGetEstimatedRevenueUsd",
      "receiverWallet.usdcBalance",
      "receiverWallet.usdcUnits"
    ],
    ...(settlement ? { latestWalletSettlement: settlement } : {}),
    note: "Use this free endpoint to verify public paid-completion counters and receiver wallet snapshot before treating revenue as settled."
  };
}

function buildLatestWalletSettlementProof(config) {
  const txHash = process.env.BASELINE_LAST_SETTLEMENT_TX_HASH || "";
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return null;
  }

  const usdcUnits = process.env.BASELINE_LAST_SETTLEMENT_USDC_UNITS || "";
  const confirmedAt = process.env.BASELINE_LAST_SETTLEMENT_CONFIRMED_AT || process.env.BASELINE_LAST_PAID_AT || null;
  const path = process.env.BASELINE_LAST_SETTLEMENT_ROUTE_PATH || ROAST_PATH;
  const method = (process.env.BASELINE_LAST_SETTLEMENT_METHOD || "GET").toUpperCase();
  const maxAmountRequired = process.env.BASELINE_LAST_SETTLEMENT_MAX_AMOUNT_REQUIRED || INSTANT_SCORE_AMOUNT;
  const usdc = /^\d+$/.test(usdcUnits) ? formatUsdc(BigInt(usdcUnits)) : null;

  return {
    txHash,
    explorerUrl: `https://basescan.org/tx/${txHash}`,
    network: config.network,
    asset: "USDC",
    ...(usdcUnits ? { usdcUnits } : {}),
    ...(usdc ? { usdc } : {}),
    ...(confirmedAt ? { confirmedAt } : {}),
    route: {
      method,
      path,
      url: absoluteUrl(config, path),
      maxAmountRequired
    },
    source: "public_base_usdc_transfer",
    payerDetails: "omitted",
    note: "Public wallet-settlement proof only. Private payment details are not exposed."
  };
}

function buildUnpaidPaymentPreview(config, intentRouteKey = "indexedQuickScore") {
  const payNow = buildPayNow(config);
  const selected = payNow.intentRoutes[intentRouteKey] || payNow.preferredFirstPaidAction;
  const paidUseProof = buildPaidUseProofLinks(config);

  return {
    error: "payment_required",
    service: config.serviceName,
    noSpendPreview: true,
    selectedPaidAction: selected,
    preferredFirstPaidAction: payNow.preferredFirstPaidAction,
    recommendedPaidSequence: payNow.recommendedPaidSequence,
    routeSelector: payNow.routeSelector,
    intentRoutes: payNow.intentRoutes,
    freeHandoff: absoluteUrl(config, PAY_NOW_PATH),
    paidUsageProof: paidUseProof.paidUsageProof,
    cashRegister: paidUseProof.cashRegister,
    paidUseProof,
    x402Retry: {
      paymentRequiredHeader: "Payment-Required",
      paymentHeader: "X-PAYMENT",
      route: selected.route,
      method: selected.method,
      maxAmountRequired: selected.maxAmountRequired,
      command: selected.command,
      instruction: "Parse the Payment-Required header, complete the exact x402 payment, then retry this same route with the X-PAYMENT header."
    },
    x402Manifest: absoluteUrl(config, "/x402.json"),
    openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH),
    note: "The x402 payment challenge is in the Payment-Required response header. This body is a free buyer handoff so agents can choose the right paid route without guessing."
  };
}

function unpaidPaymentPreview(config, intentRouteKey) {
  return () => ({
    contentType: "application/json",
    body: buildUnpaidPaymentPreview(config, intentRouteKey)
  });
}

function buildCustomPaywallHtml(config, intentRouteKey = "indexedQuickScore") {
  const preview = buildUnpaidPaymentPreview(config, intentRouteKey);
  const selected = preview.selectedPaidAction;
  const choices = preview.routeSelector
    .map((choice) => {
      const action = preview.intentRoutes[choice.use];
      return `<li><strong>${escapeHtml(action?.price || "")}</strong> ${escapeHtml(choice.when)} <code>${escapeHtml(action?.path || choice.use)}</code></li>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Pay Listing Roast x402</title>
    <style>
      :root { color-scheme: light dark; --bg: #f7f8f5; --ink: #141614; --muted: #5d655d; --line: #d9ded2; --accent: #116149; --panel: #ffffff; }
      @media (prefers-color-scheme: dark) { :root { --bg: #111513; --ink: #f3f6f0; --muted: #b5bdb2; --line: #30382f; --accent: #7fe0bd; --panel: #181e1a; } }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--bg); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.5; }
      main { width: min(880px, calc(100% - 32px)); margin: 40px auto; }
      .eyebrow { color: var(--accent); font-weight: 700; text-transform: uppercase; font-size: 12px; letter-spacing: 0; }
      h1 { margin: 8px 0 10px; font-size: clamp(30px, 5vw, 54px); line-height: 1.02; letter-spacing: 0; }
      p { color: var(--muted); margin: 0 0 18px; max-width: 70ch; }
      .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 22px; margin: 22px 0; }
      .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 18px 0; }
      .meta div { border-top: 1px solid var(--line); padding-top: 10px; }
      .label { display: block; color: var(--muted); font-size: 13px; }
      code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
      pre { overflow-x: auto; white-space: pre-wrap; word-break: break-word; background: color-mix(in srgb, var(--panel) 82%, var(--ink)); border: 1px solid var(--line); border-radius: 8px; padding: 16px; }
      a { color: var(--accent); font-weight: 700; text-decoration-thickness: 1px; text-underline-offset: 3px; }
      ul { padding-left: 20px; color: var(--muted); }
      li { margin: 8px 0; }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">Payment required</div>
      <h1>${escapeHtml(config.serviceName)}</h1>
      <p>${escapeHtml(selected.reason)} No account or API key is needed; access unlocks when an x402 payment is sent for this exact route.</p>

      <section class="panel" aria-label="Selected paid route">
        <div class="meta">
          <div><span class="label">Route</span><strong>${escapeHtml(selected.path)}</strong></div>
          <div><span class="label">Method</span><strong>${escapeHtml(selected.method)}</strong></div>
          <div><span class="label">Price</span><strong>${escapeHtml(selected.price)}</strong></div>
          <div><span class="label">Max amount</span><strong>${escapeHtml(selected.maxAmountRequired)} USDC units</strong></div>
        </div>
        <pre>${escapeHtml(selected.command)}</pre>
      </section>

      <section aria-label="Other payment routes">
        <h2>Choose A Different Route</h2>
        <ul>${choices}</ul>
      </section>

      <p>Free handoff: <a href="${escapeHtml(preview.freeHandoff)}">/api/pay-now</a> · Manifest: <a href="${escapeHtml(preview.x402Manifest)}">/x402.json</a> · OpenAPI: <a href="${escapeHtml(preview.openApi)}">/.well-known/openapi.json</a></p>
    </main>
  </body>
</html>`;
}

function buildWebMcpHandoff(config) {
  return {
    service: config.serviceName,
    noSpend: true,
    purpose: "Help browser agents discover Listing Roast x402, inspect free metadata, and choose the lowest-cost paid route only after explicit buyer intent.",
    freeDiscovery: {
      homepage: absoluteUrl(config, "/"),
      markdownGuide: absoluteUrl(config, INDEX_MARKDOWN_PATH),
      llms: absoluteUrl(config, "/llms.txt"),
      llmsFull: absoluteUrl(config, LLMS_FULL_PATH),
      openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH),
      x402Manifest: absoluteUrl(config, "/x402.json"),
      apiCatalog: absoluteUrl(config, WELL_KNOWN_API_CATALOG_PATH),
      agentCard: absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH),
      agentSkills: absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH),
      mcp: absoluteUrl(config, WELL_KNOWN_MCP_JSON_PATH),
      mcpServerCard: absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH),
      examples: absoluteUrl(config, "/api/examples"),
      payNow: absoluteUrl(config, PAY_NOW_PATH)
    },
    preferredFirstPaidAction: {
      route: absoluteUrl(config, ROAST_PATH),
      path: ROAST_PATH,
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      network: config.network,
      command: buildGetPayCommand(config, ROAST_PATH),
      buyerAction: "Pay $0.001 for the already-indexed listing quality quick score."
    },
    paidRoutes: [
      {
        route: absoluteUrl(config, API_ENTRY_PATH),
        path: API_ENTRY_PATH,
        method: "GET",
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        buyerAction: "Generic paid x402 navigation route map for agents that start at /api first."
      },
      {
        route: absoluteUrl(config, API_V1_ENTRY_PATH),
        path: API_V1_ENTRY_PATH,
        method: "GET",
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        buyerAction: "Versioned paid x402 navigation route map for agents that start at /api/v1 first."
      },
      {
        route: absoluteUrl(config, V1_ENTRY_PATH),
        path: V1_ENTRY_PATH,
        method: "GET",
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        buyerAction: "Short versioned paid x402 navigation route map for agents that start at /v1 first."
      },
      {
        route: absoluteUrl(config, ROAST_PATH),
        path: ROAST_PATH,
        method: "GET",
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        buyerAction: "Cheapest indexed quick score."
      },
      {
        route: absoluteUrl(config, AGENT_LISTING_PATH),
        path: AGENT_LISTING_PATH,
        method: "GET",
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        buyerAction: "Buyer-agent skip reasons and listing clarity score."
      },
      {
        route: absoluteUrl(config, SITE_AUDIT_PATH),
        path: SITE_AUDIT_PATH,
        method: "GET",
        price: config.siteAuditPrice,
        maxAmountRequired: SITE_AUDIT_AMOUNT,
        buyerAction: "Low-friction x402 metadata and Bazaar visibility audit."
      },
      {
        route: absoluteUrl(config, DISCOVERY_AUDIT_PATH),
        path: DISCOVERY_AUDIT_PATH,
        method: "POST",
        price: config.discoveryAuditPrice,
        maxAmountRequired: DISCOVERY_AUDIT_AMOUNT,
        buyerAction: "Full x402 discovery audit for stale marketplace pricing or search misses."
      },
      {
        route: absoluteUrl(config, "/api/listing-score"),
        path: "/api/listing-score",
        method: "POST",
        price: config.scorePrice,
        maxAmountRequired: "5000",
        buyerAction: "Structured listing quality score from buyer-provided copy."
      },
      {
        route: absoluteUrl(config, ROAST_PATH),
        path: ROAST_PATH,
        method: "POST",
        price: config.price,
        maxAmountRequired: "10000",
        buyerAction: "Full listing roast, rewrite, top fixes, and launch guidance."
      }
    ],
    guardrails: [
      "This handoff is free and read-only.",
      "Do not call paid routes unless the buyer explicitly intends to pay USDC.",
      "Use the maxAmountRequired value shown for the selected route."
    ]
  };
}

function webMcpScript(config) {
  const handoff = buildWebMcpHandoff(config);
  return `
    (function () {
      var contexts = [];
      var navigatorContext = typeof navigator !== "undefined" ? navigator.modelContext : null;
      var documentContext = typeof document !== "undefined" ? document.modelContext : null;
      if (navigatorContext && typeof navigatorContext.registerTool === "function") {
        contexts.push(navigatorContext);
      }
      if (documentContext && typeof documentContext.registerTool === "function" && documentContext !== navigatorContext) {
        contexts.push(documentContext);
      }
      if (!contexts.length) return;
      var handoff = ${jsonScript(handoff)};
      var tool = {
        name: "listing_roast_x402_handoff",
        description: "Return the free discovery links and preferred x402 paid route for Listing Roast. This tool never calls a paid endpoint.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        },
        annotations: {
          readOnlyHint: true
        },
        execute: async function () {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(handoff)
              }
            ],
            structuredContent: handoff
          };
        }
      };
      contexts.forEach(function (context) {
        try {
          var result = context.registerTool(tool);
          if (result && typeof result.catch === "function") {
            result.catch(function () {});
          }
        } catch {}
      });
    })();`;
}

function buildOpenApiX402Security() {
  return [{ x402: [] }];
}

function buildOpenApiPaymentRequiredResponse(config, intentRouteKey = "indexedQuickScore") {
  return {
    description: "x402 payment required. Read the Payment-Required header, complete the exact USDC payment, then retry with the X-PAYMENT header.",
    headers: {
      "Payment-Required": {
        description: "Base64url-encoded x402 payment requirements with resource URL, accepted network, amount, payTo address, and Bazaar metadata.",
        schema: { type: "string" }
      },
      Link: {
        description: "Discovery links for the x402 manifest, pay-now helper, pricing catalog, OpenAPI document, and agent metadata.",
        schema: { type: "string" }
      }
    },
    content: {
      "application/json": {
        example: buildUnpaidPaymentPreview(config, intentRouteKey)
      }
    }
  };
}

function buildOpenApiDocument(config, cashRegister = {}) {
  const intentRoutes = buildPayNowActions(config);
  const recommendedPaidSequence = buildRecommendedPaidSequence(intentRoutes);
  const paymentActionByRoute = {
    [`GET ${API_ENTRY_PATH}`]: "apiEntry",
    [`GET ${API_V1_ENTRY_PATH}`]: "apiV1Entry",
    [`GET ${V1_ENTRY_PATH}`]: "v1Entry",
    [`GET ${INSTANT_SCORE_PATH}`]: "instantScore",
    [`GET ${CONVERSION_SCORE_PATH}`]: "conversionScore",
    [`GET ${AGENT_LISTING_PATH}`]: "agentListingConversion",
    [`GET ${PING_PATH}`]: "x402Ping",
    [`GET ${SITE_AUDIT_PATH}`]: "x402SiteAudit",
    [`GET ${DISCOVERY_AUDIT_PATH}`]: "discoveryAuditQuick",
    [`POST ${DISCOVERY_AUDIT_PATH}`]: "discoveryAudit",
    "POST /api/listing-score": "listingScore",
    [`GET ${ROAST_PATH}`]: "indexedQuickScore",
    [`POST ${ROAST_PATH}`]: "fullRoast"
  };

  const document = {
    openapi: "3.1.0",
    info: {
      title: config.serviceName,
      version: "0.2.0",
      description: DISCOVERY_DESCRIPTION,
      contact: { url: config.serviceUrl },
      "x-provider-url": config.serviceUrl,
      "x-service-name": config.serviceName,
      "x-icon-url": absoluteUrl(config, ICON_SVG_PATH),
      "x-category": SERVICE_CATEGORY,
      "x-tags": SERVICE_TAGS,
      "x-keywords": DISCOVERY_KEYWORDS,
      "x402": {
        network: config.network,
        asset: "USDC",
        payTo: config.payTo,
        manifest: absoluteUrl(config, "/x402.json"),
        payNow: absoluteUrl(config, PAY_NOW_PATH),
        paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
        preferredFirstPaidAction: intentRoutes.indexedQuickScore,
        recommendedPaidSequence
      },
      "x-recommended-first-paid-action": intentRoutes.indexedQuickScore,
      "x-pay-now": absoluteUrl(config, PAY_NOW_PATH),
      "x-paid-usage-proof": absoluteUrl(config, PAID_USAGE_PROOF_PATH)
    },
    servers: [{ url: config.serviceUrl }],
    "x402": {
      network: config.network,
      asset: "USDC",
      payTo: config.payTo,
      manifest: absoluteUrl(config, "/x402.json"),
      payNow: absoluteUrl(config, PAY_NOW_PATH),
      paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
      preferredFirstPaidAction: intentRoutes.indexedQuickScore,
      recommendedPaidSequence,
      buyerInstruction: "If the buyer intends to spend USDC, start with GET /api/listing-roast at $0.001 / max 1000 USDC units; read the 402 Payment-Required header, complete x402 payment, then retry with X-PAYMENT."
    },
    "x-recommended-first-paid-action": intentRoutes.indexedQuickScore,
    "x-pay-now": absoluteUrl(config, PAY_NOW_PATH),
    "x-paid-usage-proof": absoluteUrl(config, PAID_USAGE_PROOF_PATH),
    paths: {
      [ROAST_PATH]: {
        get: {
          operationId: "getPaidApiListingQualityBuyerAgentSkipReasonsListingRoastQuickScore",
          tags: ["paid API listing quality", "paid API listing quality score", "buyer-agent skip reasons", "buyer agent skip reasons", "agent-service listing score", "agent service listing clarity", "x402 listing", "paid API listing"],
          summary: "Paid $0.001 paid API listing quality, agent conversion, and buyer-agent skip reasons quick score",
          description: "Score API marketplace listing quality and discoverability before promotion from the already-indexed, paid-use-confirmed /api/listing-roast URL. Returns the lowest-price $0.001 Paid API listing quality score for agent listing conversion score, x402 discovery audit triage, buyer-agent skip reasons, agent service listing clarity, paid API preflight triage, route health, stale pricing, Bazaar search visibility, and conversion checks after payment. Use POST on the same URL for the full $0.01 roast.",
          "x-price": config.instantScorePrice,
          "x-x402-price": config.instantScorePrice,
          "x-payment": buildPaymentHint(config, {
            path: ROAST_PATH,
            method: "GET",
            price: config.instantScorePrice,
            maxAmountRequired: INSTANT_SCORE_AMOUNT,
            preferredFirstPaidAction: true,
            buyerAction: "Pay $0.001 on the already-indexed marketplace route for buyer-agent skip reasons, agent service listing clarity, and a quick listing quality score."
          }),
          parameters: listingQueryOpenApiParameters(),
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
      [API_ENTRY_PATH]: {
        get: {
          operationId: "getListingRoastApiEntry",
          tags: ["x402 navigation", "API entrypoint", "agent commerce"],
          summary: "Paid $0.001 x402 navigation entrypoint",
          description: "Generic paid GET navigation endpoint for agents that start at /api. Returns a quick score, preferred paid route, full route map, and free discovery links after x402 payment.",
          "x-price": config.instantScorePrice,
          "x-x402-price": config.instantScorePrice,
          "x-payment": buildPaymentHint(config, {
            path: API_ENTRY_PATH,
            method: "GET",
            price: config.instantScorePrice,
            maxAmountRequired: INSTANT_SCORE_AMOUNT,
            buyerAction: "Pay $0.001 for the generic API entry route map when an agent starts discovery at /api."
          }),
          responses: {
            200: {
              description: "Paid API entry route map",
              content: {
                "application/json": {
                  schema: buildApiEntryDiscovery(config).output.schema,
                  example: buildApiEntryOutput(config)
                }
              }
            },
            402: { description: "x402 payment required" }
          }
        }
      },
      [API_V1_ENTRY_PATH]: {
        get: {
          operationId: "getListingRoastApiV1Entry",
          tags: ["x402 navigation", "API v1 entrypoint", "agent commerce"],
          summary: "Paid $0.001 x402 API v1 navigation entrypoint",
          description: "Versioned paid GET navigation endpoint for agents that start at /api/v1. Returns a quick score, preferred paid route, full route map, and free discovery links after x402 payment.",
          "x-price": config.instantScorePrice,
          "x-x402-price": config.instantScorePrice,
          "x-payment": buildPaymentHint(config, {
            path: API_V1_ENTRY_PATH,
            method: "GET",
            price: config.instantScorePrice,
            maxAmountRequired: INSTANT_SCORE_AMOUNT,
            buyerAction: "Pay $0.001 for the API v1 entry route map when an agent starts discovery at /api/v1."
          }),
          responses: {
            200: {
              description: "Paid API v1 entry route map",
              content: {
                "application/json": {
                  schema: buildApiEntryDiscovery(config).output.schema,
                  example: buildApiEntryOutput(config)
                }
              }
            },
            402: { description: "x402 payment required" }
          }
        }
      },
      [V1_ENTRY_PATH]: {
        get: {
          operationId: "getListingRoastV1Entry",
          tags: ["x402 navigation", "v1 entrypoint", "agent commerce"],
          summary: "Paid $0.001 x402 short v1 navigation entrypoint",
          description: "Short versioned paid GET navigation endpoint for agents that start at /v1. Returns a quick score, preferred paid route, full route map, and free discovery links after x402 payment.",
          "x-price": config.instantScorePrice,
          "x-x402-price": config.instantScorePrice,
          "x-payment": buildPaymentHint(config, {
            path: V1_ENTRY_PATH,
            method: "GET",
            price: config.instantScorePrice,
            maxAmountRequired: INSTANT_SCORE_AMOUNT,
            buyerAction: "Pay $0.001 for the v1 entry route map when an agent starts discovery at /v1."
          }),
          responses: {
            200: {
              description: "Paid short v1 entry route map",
              content: {
                "application/json": {
                  schema: buildApiEntryDiscovery(config).output.schema,
                  example: buildApiEntryOutput(config)
                }
              }
            },
            402: { description: "x402 payment required" }
          }
        }
      },
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
          parameters: listingQueryOpenApiParameters(),
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
          parameters: listingQueryOpenApiParameters(),
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
          tags: ["agent listing conversion", "agent service listing clarity", "agent service promotion readiness", "buyer-agent skip reasons", "x402 listing", "paid API listing", "paid API listing quality"],
          summary: "buyer-agent skip reasons, agent service promotion readiness, agent service listing clarity, and agent listing conversion score by Listing Roast",
          description: `${AGENT_LISTING_CONVERSION_DESCRIPTION} Optional query params: agentName, listingText, targetBuyer, currentPrice, currentCheckoutPath, goal.`,
          "x-price": config.instantScorePrice,
          "x-x402-price": config.instantScorePrice,
          "x-payment": buildPaymentHint(config, {
            path: AGENT_LISTING_PATH,
            method: "GET",
            price: config.instantScorePrice,
            maxAmountRequired: INSTANT_SCORE_AMOUNT,
            buyerAction: "Pay $0.001 for an agent listing conversion score without building a JSON body."
          }),
          parameters: listingQueryOpenApiParameters(),
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
          operationId: "getX402SellerIntelligenceCatalogMetadataStaleBazaarPriceRouteHealthPaidApiPreflightAudit",
          tags: ["x402 discovery", "x402 site audit", "x402 seller discoverability", "x402 service discoverability audit", "fix x402 Bazaar listing", "x402 catalog metadata quality", "x402 listing SEO audit", "x402 listing rank doctor", "x402 seller growth checklist", "x402 seller intelligence", "x402 marketplace SEO audit", "paid API preflight", "x402 route health check", "stale Bazaar price", "paid API listing"],
          summary: "Paid $0.001 x402 seller intelligence, catalog metadata quality, stale Bazaar price, route health check, paid API preflight, listing SEO audit, rank doctor, growth checklist, and Bazaar fix",
          description: "Lowest-friction GET route for agents that want a quick no-spend x402 listing SEO audit, x402 listing rank doctor, x402 seller growth checklist, x402 seller intelligence, x402 marketplace SEO audit, x402 seller discoverability audit, fix x402 Bazaar listing guidance, x402 catalog metadata quality check, paid API preflight, route health check, public x402 discovery check, pricing check, stale Bazaar price check, direct 402 metadata check, and Bazaar search visibility check before buying the full audit.",
          "x-price": config.siteAuditPrice,
          "x-x402-price": config.siteAuditPrice,
          "x-payment": buildPaymentHint(config, {
            path: SITE_AUDIT_PATH,
            method: "GET",
            price: config.siteAuditPrice,
            maxAmountRequired: SITE_AUDIT_AMOUNT,
            buyerAction: "Pay $0.001 for a no-spend x402 listing SEO audit, listing rank doctor, seller growth checklist, paid API preflight, metadata, pricing, and search visibility check."
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
        get: {
          operationId: "getX402DiscoveryAuditQuick",
          tags: ["x402 discovery", "x402 discovery audit", "x402 seller discoverability", "x402 route health check", "paid API preflight", "stale Bazaar price", "paid API listing"],
          summary: "Paid $0.001 x402 discovery audit quick check",
          description: "Exact-path GET route for agents that ask for an x402 discovery audit and need the cheapest paid route-health, stale Bazaar price, public x402 discovery, direct 402 metadata, and search visibility check before buying the full custom audit.",
          "x-price": config.siteAuditPrice,
          "x-x402-price": config.siteAuditPrice,
          "x-payment": buildPaymentHint(config, {
            path: DISCOVERY_AUDIT_PATH,
            method: "GET",
            price: config.siteAuditPrice,
            maxAmountRequired: DISCOVERY_AUDIT_QUICK_AMOUNT,
            buyerAction: "Pay $0.001 for the exact x402 discovery audit path before buying the full custom audit."
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
              description: "Paid x402 discovery audit quick response",
              content: {
                "application/json": {
                  schema: discoveryAuditOutputSchema,
                  example: buildDiscoveryAuditQuickExampleOutput(config)
                }
              }
            },
            402: { description: "x402 payment required" }
          }
        },
        post: {
          operationId: "postX402DiscoveryAudit",
          tags: ["x402 discovery", "fix x402 Bazaar listing", "x402 catalog metadata quality", "x402 listing SEO audit", "x402 listing rank doctor", "x402 seller growth checklist", "x402 seller intelligence", "x402 marketplace SEO audit", "stale Bazaar price", "paid API listing"],
          summary: "Paid $0.01 x402 Bazaar discovery audit",
          description: "Audits a public x402 endpoint without making paid calls. Checks the direct unpaid 402 challenge, Bazaar extension metadata, CDP merchant discovery, x402 catalog metadata quality, x402 listing SEO, x402 listing rank, stale Bazaar price or stale indexed pricing, seller growth checklist, and search visibility.",
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
                  example: buildListingScoreWithUpgrade(requestExample, config)
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
          summary: "Free intent-aware pay-now handoff",
          description: "Compact no-spend JSON that tells buyer agents which existing x402 route to pay for a task or buyer intent.",
          parameters: [
            { name: "intent", in: "query", required: false, schema: { type: "string" }, description: "Buyer task, such as buyer-agent skip reasons, x402 discovery audit, or full listing roast." },
            { name: "q", in: "query", required: false, schema: { type: "string" }, description: "Alias for intent." },
            { name: "query", in: "query", required: false, schema: { type: "string" }, description: "Alias for intent." },
            { name: "task", in: "query", required: false, schema: { type: "string" }, description: "Alias for intent." }
          ],
          responses: {
            200: {
              description: "Direct pay-now handoff for the selected paid route"
            }
          }
        }
      },
      [PAID_USAGE_PROOF_PATH]: {
        get: {
          operationId: "getPaidUsageProof",
          summary: "Free wallet-backed paid-use proof",
          description: "Compact no-spend JSON showing current paid completions, estimated gross revenue, wallet evidence fields, and the preferred first paid route.",
          responses: {
            200: {
              description: "Wallet-backed paid-use proof and first paid action",
              content: {
                "application/json": {
                  example: buildPaidUsageProofResponse(config)
                }
              }
            }
          }
        }
      },
      [PRICING_PATH]: {
        get: {
          operationId: "getPricingCatalog",
          summary: "Free x402 paid route pricing catalog",
          description: "No-spend JSON catalog of Listing Roast paid routes, prices, max x402 amounts, schemas, and copy-ready commands.",
          responses: {
            200: {
              description: "Paid route pricing catalog",
              content: {
                "application/json": {
                  example: buildPricingCatalog(config)
                }
              }
            }
          }
        }
      },
      [FIND_PATH]: {
        get: {
          operationId: "findPaidRouteForTask",
          summary: "Free task-to-paid-route finder",
          description: "No-spend route selector that maps a buyer task or query to the best existing Listing Roast x402 paid route.",
          parameters: [
            { name: "q", in: "query", required: false, schema: { type: "string" }, description: "Buyer task, such as x402 discovery audit, buyer-agent skip reasons, or listing roast full rewrite." },
            { name: "query", in: "query", required: false, schema: { type: "string" }, description: "Alias for q." },
            { name: "task", in: "query", required: false, schema: { type: "string" }, description: "Alias for q." }
          ],
          responses: {
            200: {
              description: "Best paid route for the requested task",
              content: {
                "application/json": {
                  example: buildFindResult(config, "x402 discovery audit")
                }
              }
            }
          }
        }
      },
      [ROUTE_PATH]: {
        get: {
          operationId: "routePaidLocalTools",
          summary: "Free local x402 route ranking",
          description: "No-spend local router that ranks this seller's existing paid x402 routes for a buyer query. Supports Agent402-style query/top/include fields, but only returns owned Listing Roast routes.",
          parameters: [
            { name: "query", in: "query", required: false, schema: { type: "string" }, description: "Buyer task, such as x402 discovery audit, buyer-agent skip reasons, or listing roast full rewrite." },
            { name: "q", in: "query", required: false, schema: { type: "string" }, description: "Alias for query." },
            { name: "task", in: "query", required: false, schema: { type: "string" }, description: "Alias for query." },
            { name: "top", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 20 }, description: "Maximum ranked routes to return." },
            { name: "include", in: "query", required: false, schema: { type: "string", enum: ["all", "local", "external"] }, description: "Use all or local for owned routes. external returns an empty local result because this endpoint does not route third-party sellers." }
          ],
          responses: {
            200: {
              description: "Ranked owned paid routes for the requested task",
              content: {
                "application/json": {
                  example: buildRouteResult(config, { query: "x402 discovery audit", top: 3 })
                }
              }
            }
          }
        },
        post: {
          operationId: "routePaidLocalToolsPost",
          summary: "Free local x402 route ranking",
          description: "POST form of the no-spend local router. Accepts Agent402-style JSON body fields: query, top, include.",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    query: { type: "string" },
                    task: { type: "string" },
                    top: { type: "integer", minimum: 1, maximum: 20 },
                    include: { type: "string", enum: ["all", "local", "external"] }
                  }
                },
                example: { query: "buyer-agent skip reasons", top: 3, include: "local" }
              }
            }
          },
          responses: {
            200: {
              description: "Ranked owned paid routes for the requested task",
              content: {
                "application/json": {
                  example: buildRouteResult(config, { query: "buyer-agent skip reasons", top: 3, include: "local" })
                }
              }
            }
          }
        }
      },
      [LOCAL_DISCOVERY_RESOURCE_PATHS[0]]: {
        get: {
          operationId: "getLocalX402DiscoveryResources",
          summary: "Free local x402 discovery resources",
          description: "No-spend Bazaar-shaped local catalog for buyer agents that probe x402 discovery resources on this seller domain.",
          parameters: [
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 1000 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          responses: {
            200: {
              description: "Local Bazaar-shaped discovery resources",
              content: {
                "application/json": {
                  example: buildLocalDiscoveryResources(config)
                }
              }
            }
          }
        }
      },
      [LOCAL_DISCOVERY_SEARCH_PATHS[0]]: {
        get: {
          operationId: "searchLocalX402DiscoveryResources",
          summary: "Free local x402 discovery search",
          description: "No-spend local search over this seller's paid x402 routes for agents that probe x402 discovery search on this seller domain.",
          parameters: [
            { name: "query", in: "query", required: false, schema: { type: "string" } },
            { name: "q", in: "query", required: false, schema: { type: "string" } },
            { name: "network", in: "query", required: false, schema: { type: "string" } },
            { name: "payTo", in: "query", required: false, schema: { type: "string" } },
            { name: "maxUsdPrice", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 1000 } }
          ],
          responses: {
            200: {
              description: "Local Bazaar-shaped search results",
              content: {
                "application/json": {
                  example: buildLocalDiscoverySearch(config, { query: "x402 discovery audit" })
                }
              }
            }
          }
        }
      },
      [LOCAL_DISCOVERY_MERCHANT_PATHS[0]]: {
        get: {
          operationId: "getLocalX402MerchantResources",
          summary: "Free local x402 merchant resources",
          description: "No-spend local merchant lookup for this seller domain.",
          parameters: [
            { name: "payTo", in: "query", required: false, schema: { type: "string" } }
          ],
          responses: {
            200: {
              description: "Local merchant resources for this seller",
              content: {
                "application/json": {
                  example: buildLocalDiscoveryMerchant(config)
                }
              }
            }
          }
        }
      }
    },
    components: {
      securitySchemes: {
        x402: {
          type: "apiKey",
          in: "header",
          name: "X-PAYMENT",
          description: "x402 payment proof header sent after reading the HTTP 402 payment requirements."
        }
      }
    },
    "x-listing-roast": {
      homepage: config.serviceUrl,
      builder: absoluteUrl(config, "/builder"),
      sample: absoluteUrl(config, "/sample"),
      iconUrl: absoluteUrl(config, ICON_SVG_PATH),
      x402Manifest: absoluteUrl(config, "/x402.json"),
      x402ManifestAliases: [absoluteUrl(config, WELL_KNOWN_X402_JSON_PATH), absoluteUrl(config, WELL_KNOWN_X402_PATH)],
      llms: absoluteUrl(config, LLMS_PATH),
      llmsAliases: [absoluteUrl(config, WELL_KNOWN_LLMS_PATH)],
      llmsFull: absoluteUrl(config, LLMS_FULL_PATH),
      llmsFullAliases: [absoluteUrl(config, WELL_KNOWN_LLMS_FULL_PATH)],
      markdown: absoluteUrl(config, INDEX_MARKDOWN_PATH),
      agentCard: absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH),
      agentCardAliases: [absoluteUrl(config, WELL_KNOWN_AGENT_JSON_PATH)],
      aiPlugin: absoluteUrl(config, WELL_KNOWN_AI_PLUGIN_PATH),
      apiCatalog: absoluteUrl(config, WELL_KNOWN_API_CATALOG_PATH),
      agentTools: absoluteUrl(config, WELL_KNOWN_AGENT_TOOLS_PATH),
      agentSkills: absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH),
      mcp: absoluteUrl(config, WELL_KNOWN_MCP_JSON_PATH),
      mcpAliases: [absoluteUrl(config, WELL_KNOWN_MCP_PATH), absoluteUrl(config, WELL_KNOWN_MCP_SERVER_PATH)],
      mcpServerCard: absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH),
      payNow: absoluteUrl(config, PAY_NOW_PATH),
      payNowExamples: buildPayNowIntentExamples(config),
      cashRegister: absoluteUrl(config, "/api/cash-register"),
      paidUsageProof: buildPaidUsageProof(config, cashRegister),
      settlementProof: buildSettlementProof(config),
      pricing: absoluteUrl(config, PRICING_PATH),
      find: absoluteUrl(config, FIND_PATH),
      route: absoluteUrl(config, ROUTE_PATH),
      localDiscovery: {
        resources: absoluteUrl(config, LOCAL_DISCOVERY_RESOURCE_PATHS[0]),
        search: absoluteUrl(config, LOCAL_DISCOVERY_SEARCH_PATHS[0]),
        merchant: absoluteUrl(config, LOCAL_DISCOVERY_MERCHANT_PATHS[0]),
        searchExamples: buildLocalDiscoverySearchExamples(config)
      },
      apiEntryRoute: absoluteUrl(config, API_ENTRY_PATH),
      apiV1EntryRoute: absoluteUrl(config, API_V1_ENTRY_PATH),
      v1EntryRoute: absoluteUrl(config, V1_ENTRY_PATH),
      preferredFirstPaidRoute: absoluteUrl(config, ROAST_PATH),
      recommendedFirstPaidAction: intentRoutes.indexedQuickScore,
      recommendedPaidSequence,
      intentLandingPages: buildIntentLandingHandoffs(config),
      instantScoreRoute: absoluteUrl(config, INSTANT_SCORE_PATH),
      conversionScoreRoute: absoluteUrl(config, CONVERSION_SCORE_PATH),
      agentListingConversionRoute: absoluteUrl(config, AGENT_LISTING_PATH),
      pingRoute: absoluteUrl(config, PING_PATH),
      siteAuditRoute: absoluteUrl(config, SITE_AUDIT_PATH),
      discoveryAuditRoute: absoluteUrl(config, DISCOVERY_AUDIT_PATH),
      scoreRoute: absoluteUrl(config, "/api/listing-score"),
      roastRoute: absoluteUrl(config, ROAST_PATH),
      apiEntryPrice: config.instantScorePrice,
      instantScorePrice: config.instantScorePrice,
      siteAuditPrice: config.siteAuditPrice,
      scorePrice: config.scorePrice,
      discoveryAuditPrice: config.discoveryAuditPrice,
      roastPrice: config.price,
      network: config.network,
      keywords: DISCOVERY_KEYWORDS
    }
  };

  for (const aliasPath of QUICK_SCORE_ALIAS_PATHS) {
    const metadata = QUICK_SCORE_ALIAS_METADATA[aliasPath];
    const aliasInputDefaults = quickScoreAliasInputDefaults(aliasPath);
    paymentActionByRoute[`GET ${aliasPath}`] = "indexedQuickScore";
    document.paths[aliasPath] = {
      get: {
        ...document.paths[ROAST_PATH].get,
        operationId: metadata.operationId,
        summary: metadata.summary,
        description: `${metadata.description} Canonical route: GET ${ROAST_PATH}.`,
        parameters: listingQueryOpenApiParameters(aliasInputDefaults),
        "x-payment": buildPaymentHint(config, {
          path: aliasPath,
          method: "GET",
          price: config.instantScorePrice,
          maxAmountRequired: INSTANT_SCORE_AMOUNT,
          buyerAction: `Pay $0.001 for ${metadata.name.replaceAll("_", " ")}.`
        })
      }
    };
  }

  const preflightAliasOperationIds = {
    "/api/preflight": "getPaidApiPreflight",
    "/api/v1/preflight": "getApiV1PaidApiPreflight",
    "/preflight": "getRootPaidApiPreflight"
  };
  for (const aliasPath of PREFLIGHT_ALIAS_PATHS) {
    paymentActionByRoute[`GET ${aliasPath}`] = "x402SiteAudit";
    document.paths[aliasPath] = {
      get: {
        ...document.paths[SITE_AUDIT_PATH].get,
        operationId: preflightAliasOperationIds[aliasPath],
        summary: "Paid $0.001 paid API preflight before paying",
        description: "Direct paid API preflight alias for agents that probe common preflight URLs before paying. Returns the x402 site-audit output for direct 402 metadata, route health, Bazaar pricing, search visibility, OpenAPI, llms.txt, and no-spend next actions.",
        "x-payment": buildPaymentHint(config, {
          path: aliasPath,
          method: "GET",
          price: config.siteAuditPrice,
          maxAmountRequired: SITE_AUDIT_AMOUNT,
          buyerAction: "Pay $0.001 for a paid API preflight before paying more."
        })
      }
    };
  }

  for (const [pathname, pathItem] of Object.entries(document.paths)) {
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const operation = pathItem[method];
      if (operation && operation["x-payment"]) {
        operation.security = buildOpenApiX402Security();
        operation.responses[402] = buildOpenApiPaymentRequiredResponse(config, paymentActionByRoute[`${method.toUpperCase()} ${pathname}`]);
      }
    }
  }

  return document;
}

function buildPaidUsageProof(config, cashRegister = {}) {
  const paidCompletions = Number(cashRegister.paidCompletions || 0);
  const estimatedGrossRevenueUsd = String(cashRegister.estimatedGrossRevenueUsd || "0.00").replace(/^\$/, "");
  const indexedRoastGetCompletions = Number(cashRegister.indexedRoastGetCompletions || 0);
  const indexedRoastGetEstimatedRevenueUsd = String(cashRegister.indexedRoastGetEstimatedRevenueUsd || "$0.00");
  const latestWalletSettlement = buildLatestWalletSettlementProof(config);

  return {
    paidCompletions,
    estimatedGrossRevenueUsd,
    proofText: `${paidCompletions} paid ${paidCompletions === 1 ? "completion" : "completions"}; $${estimatedGrossRevenueUsd} registered`,
    lastPaidAt: cashRegister.lastPaidAt || null,
    preferredConvertedRoute: {
      path: ROAST_PATH,
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      completions: indexedRoastGetCompletions,
      estimatedRevenueUsd: indexedRoastGetEstimatedRevenueUsd,
      hasConfirmedPaidUse: indexedRoastGetCompletions > 0,
      note: indexedRoastGetCompletions > 0
        ? "The preferred indexed GET /api/listing-roast route has confirmed paid use."
        : "The preferred indexed GET /api/listing-roast route is the current first paid action."
    },
    ...(latestWalletSettlement ? { latestWalletSettlement } : {}),
    source: "public_cash_register",
    cashRegister: absoluteUrl(config, "/api/cash-register"),
    walletEvidenceFields: ["receiverWallet.usdcBalance", "receiverWallet.usdcUnits", "receiverWallet.checkedAt"],
    noSpend: true
  };
}

function buildPaidUsageProofResponse(config, cashRegister = {}) {
  const intentRoutes = buildPayNowActions(config);
  const proof = buildPaidUsageProof(config, cashRegister);

  return {
    service: config.serviceName,
    noSpend: true,
    purpose: "Compact public proof that Listing Roast x402 has real paid usage and the first paid route is still the low-friction indexed GET.",
    paidUsageProof: proof,
    settlementProof: buildSettlementProof(config),
    preferredFirstPaidAction: intentRoutes.indexedQuickScore,
    recommendedPaidSequence: buildRecommendedPaidSequence(intentRoutes),
    payNow: absoluteUrl(config, PAY_NOW_PATH),
    pricing: absoluteUrl(config, PRICING_PATH),
    find: absoluteUrl(config, FIND_PATH),
    route: absoluteUrl(config, ROUTE_PATH),
    cashRegister: absoluteUrl(config, "/api/cash-register"),
    x402Manifest: absoluteUrl(config, "/x402.json"),
    openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH),
    buyerInstruction: "Use this free proof endpoint before paying. If the buyer intends to spend USDC, start with GET /api/listing-roast at max 1000 USDC units, then upgrade only if the quick score proves enough fit.",
    safety: "No paid calls are made by this endpoint. Wallet balance comes only from the public cash-register receiver wallet snapshot."
  };
}

function buildQuickScoreAliasManifestResources(config) {
  return QUICK_SCORE_ALIAS_PATHS.map((path) => {
    const metadata = QUICK_SCORE_ALIAS_METADATA[path];
    const aliasInputDefaults = quickScoreAliasInputDefaults(path);
    return {
      id: metadata.id,
      name: metadata.name,
      method: "GET",
      path,
      url: absoluteUrl(config, path),
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      description: metadata.description,
      keywords: uniqueTerms([...metadata.keywords, "listing roast", "GET paid API", "x402 quick score", "paid API discoverability"]),
      command: buildGetPayCommand(config, path, INSTANT_SCORE_AMOUNT),
      input: buildInstantScoreDiscovery(config, aliasInputDefaults).input,
      outputExample: buildIndexedRoastQuickScore(buildInstantScoreInput(aliasInputDefaults), config),
      schema: absoluteUrl(config, "/api/score-schema"),
      canonicalRoute: ROAST_PATH
    };
  });
}

function buildPreflightAliasManifestResources(config) {
  const aliasIds = ["paid_api_preflight", "api_v1_paid_api_preflight", "root_paid_api_preflight"];
  return PREFLIGHT_ALIAS_PATHS.map((path, index) => ({
    id: aliasIds[index],
    name: aliasIds[index],
    method: "GET",
    path,
    url: absoluteUrl(config, path),
    price: config.siteAuditPrice,
    maxAmountRequired: SITE_AUDIT_AMOUNT,
    description: "One-tenth-cent GET paid API preflight before paying. This alias returns the x402 site-audit output for direct 402 metadata, route health, Bazaar pricing, search visibility, OpenAPI, llms.txt, and no-spend next actions.",
    keywords: ["paid API preflight", "api preflight", "endpoint preflight", "before paying", "pre-pay endpoint check", "x402 site audit", "x402 route health check"],
    command: buildGetPayCommand(config, path, SITE_AUDIT_AMOUNT),
    input: buildSiteAuditDiscovery(config).input,
    outputExample: buildSiteAuditExampleOutput(config),
    schema: absoluteUrl(config, "/api/discovery-audit-schema"),
    canonicalRoute: SITE_AUDIT_PATH
  }));
}

function buildPrimaryEndpointHandoff(config, intentRoutes = buildPayNowActions(config)) {
  const action = intentRoutes.indexedQuickScore;
  return {
    id: "indexed_roast_quick_score",
    name: "indexed_roast_quick_score",
    title: "GET $0.001 indexed listing-roast quick score",
    serviceName: X402_SERVICE_NAME,
    method: action.method,
    path: action.path,
    url: action.route,
    route: action.route,
    price: action.price,
    maxAmountRequired: action.maxAmountRequired,
    network: config.network,
    payTo: config.payTo,
    command: action.command,
    reason: action.reason,
    description: INDEXED_QUICK_SCORE_DESCRIPTION,
    tags: routeTags("indexedQuickScore"),
    keywords: uniqueTerms([
      "listing roast",
      "marketplace listing score",
      "paid API listing quality score",
      "buyer-agent skip reasons",
      "x402 discovery audit",
      "stale Bazaar price",
      ...routeTags("indexedQuickScore")
    ]),
    note: `Use GET ${ROAST_PATH} as the first paid call. POST ${ROOT_DIRECTORY_POST_PATH} is only a fallback directory handoff.`
  };
}

function buildPrimaryResourceSample(primaryEndpoint) {
  return {
    id: primaryEndpoint.id,
    name: primaryEndpoint.name,
    title: primaryEndpoint.title,
    serviceName: primaryEndpoint.serviceName,
    url: primaryEndpoint.url,
    resource: primaryEndpoint.url,
    kind: "http",
    method: primaryEndpoint.method,
    path: primaryEndpoint.path,
    price: primaryEndpoint.price,
    price_usd: priceToUsd(primaryEndpoint.price),
    maxAmountRequired: primaryEndpoint.maxAmountRequired,
    max_amount_required: primaryEndpoint.maxAmountRequired,
    description: primaryEndpoint.description,
    tags: primaryEndpoint.tags,
    keywords: primaryEndpoint.keywords,
    command: primaryEndpoint.command,
    reason: primaryEndpoint.reason
  };
}

function buildX402Manifest(config, cashRegister = {}) {
  const intentRoutes = buildPayNowActions(config);
  const primaryEndpoint = buildPrimaryEndpointHandoff(config, intentRoutes);
  const primaryResourceSample = buildPrimaryResourceSample(primaryEndpoint);
  const baseUrl = absoluteUrl(config, "/").replace(/\/$/, "");

  return {
    name: config.serviceName,
    serviceName: config.serviceName,
    displayName: config.serviceName,
    service: config.serviceName,
    baseUrl,
    version: DISCOVERY_METADATA_VERSION,
    metadataVersion: DISCOVERY_METADATA_VERSION,
    metadataUpdatedAt: DISCOVERY_METADATA_UPDATED_AT,
    lastUpdated: DISCOVERY_METADATA_UPDATED_AT,
    description: DISCOVERY_DESCRIPTION,
    providerUrl: config.serviceUrl,
    iconUrl: absoluteUrl(config, ICON_SVG_PATH),
    icon: absoluteUrl(config, ICON_SVG_PATH),
    category: SERVICE_CATEGORY,
    tags: SERVICE_TAGS,
    keywords: DISCOVERY_KEYWORDS,
    homepage: absoluteUrl(config, "/"),
    builder: absoluteUrl(config, "/builder"),
    sample: absoluteUrl(config, "/sample"),
    openApi: absoluteUrl(config, "/openapi.json"),
    openApiAliases: [absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH)],
    llms: absoluteUrl(config, LLMS_PATH),
    llmsAliases: [absoluteUrl(config, WELL_KNOWN_LLMS_PATH)],
    llmsFull: absoluteUrl(config, LLMS_FULL_PATH),
    llmsFullAliases: [absoluteUrl(config, WELL_KNOWN_LLMS_FULL_PATH)],
    markdown: absoluteUrl(config, INDEX_MARKDOWN_PATH),
    agentCard: absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH),
    agentCardAliases: [absoluteUrl(config, WELL_KNOWN_AGENT_JSON_PATH)],
    aiPlugin: absoluteUrl(config, WELL_KNOWN_AI_PLUGIN_PATH),
    apiCatalog: absoluteUrl(config, WELL_KNOWN_API_CATALOG_PATH),
    agentTools: absoluteUrl(config, WELL_KNOWN_AGENT_TOOLS_PATH),
    agentSkills: absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH),
    mcp: absoluteUrl(config, WELL_KNOWN_MCP_JSON_PATH),
    mcpAliases: [absoluteUrl(config, WELL_KNOWN_MCP_PATH), absoluteUrl(config, WELL_KNOWN_MCP_SERVER_PATH)],
    mcpServerCard: absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH),
    payNow: absoluteUrl(config, PAY_NOW_PATH),
    payNowExamples: buildPayNowIntentExamples(config),
    intentLandingPages: buildIntentLandingHandoffs(config),
    paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
    cashRegister: absoluteUrl(config, "/api/cash-register"),
    paidUsageProof: buildPaidUsageProof(config, cashRegister),
    settlementProof: buildSettlementProof(config),
    pricing: absoluteUrl(config, PRICING_PATH),
    find: absoluteUrl(config, FIND_PATH),
    route: absoluteUrl(config, ROUTE_PATH),
    localDiscovery: {
      resources: absoluteUrl(config, LOCAL_DISCOVERY_RESOURCE_PATHS[0]),
      search: absoluteUrl(config, LOCAL_DISCOVERY_SEARCH_PATHS[0]),
      merchant: absoluteUrl(config, LOCAL_DISCOVERY_MERCHANT_PATHS[0]),
      searchExamples: buildLocalDiscoverySearchExamples(config),
      aliases: {
        resources: LOCAL_DISCOVERY_RESOURCE_PATHS.map((path) => absoluteUrl(config, path)),
        search: LOCAL_DISCOVERY_SEARCH_PATHS.map((path) => absoluteUrl(config, path)),
        merchant: LOCAL_DISCOVERY_MERCHANT_PATHS.map((path) => absoluteUrl(config, path))
      }
    },
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
      tools: 21
    },
    primaryEndpoint,
    primaryPaidEndpoint: primaryEndpoint,
    resource_count: 1,
    resource_samples: [primaryResourceSample],
    call_info: {
      resource_count: 1,
      resource_samples: [primaryResourceSample]
    },
    call: {
      primaryEndpoint,
      primary_url: primaryEndpoint.url,
      primary_method: primaryEndpoint.method,
      x402_route: primaryEndpoint.path,
      command: primaryEndpoint.command,
      note: primaryEndpoint.note
    },
    preferredFirstPaidAction: intentRoutes.indexedQuickScore,
    recommendedFirstPaidAction: intentRoutes.indexedQuickScore,
    recommendedPaidSequence: buildRecommendedPaidSequence(intentRoutes),
    quickScoreAliases: quickScoreAliasUrls(config),
    preflightAliases: preflightAliasUrls(config),
    resources: [
      {
        id: "indexed_roast_quick_score",
        name: "marketplace_listing_score_paid_api_listing_quality_score",
        method: "GET",
        path: ROAST_PATH,
        url: absoluteUrl(config, ROAST_PATH),
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        description: INDEXED_QUICK_SCORE_DESCRIPTION,
        keywords: ["listing roast", "score API", "marketplace listing quality", "paid API listing quality", "paid API discoverability", "x402 listing quality", "agent listing conversion score", "agent listing conversion", "agent service listing clarity", "buyer-agent skip reasons", "buyer agent skip reasons", "agent-service listing score", "x402 marketplace conversion", "x402 site audit", "x402 service discoverability audit", "x402 discovery audit", "x402 bazaar discovery audit", "paid API preflight", "x402 route health check", "bazaar search visibility", "x402 listing stale price", "x402 metadata audit", "x402 buyer-readiness signals", "GET paid API"],
        command: buildGetPayCommand(config, ROAST_PATH),
        input: buildInstantScoreDiscovery(config).input,
        outputExample: buildIndexedRoastQuickScore(buildInstantScoreInput(), config),
        schema: absoluteUrl(config, "/api/score-schema")
      },
      ...buildQuickScoreAliasManifestResources(config),
      {
        id: "directory_root_post",
        name: "directory_root_post",
        method: "POST",
        path: ROOT_DIRECTORY_POST_PATH,
        url: absoluteUrl(config, ROOT_DIRECTORY_POST_PATH),
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        description: DIRECTORY_POST_DESCRIPTION,
        keywords: ["agent-tools", "directory handoff", "generic POST", "root POST", "x402 route map", "paid API directory"],
        command: buildPostPayCommand(config, ROOT_DIRECTORY_POST_PATH, INSTANT_SCORE_AMOUNT),
        input: {},
        outputExample: buildDirectoryPostOutput(config),
        schema: absoluteUrl(config, "/openapi.json")
      },
      {
        id: "api_entry",
        name: "api_entry",
        method: "GET",
        path: API_ENTRY_PATH,
        url: absoluteUrl(config, API_ENTRY_PATH),
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        description: "One-tenth-cent generic x402 navigation endpoint for agents that start at /api. Returns a quick score, paid route map, and preferred first paid action after payment.",
        keywords: ["x402 navigation", "API entrypoint", "agent commerce", "route map", "/api"],
        command: buildGetPayCommand(config, API_ENTRY_PATH, INSTANT_SCORE_AMOUNT),
        input: {},
        outputExample: buildApiEntryOutput(config),
        schema: absoluteUrl(config, "/openapi.json")
      },
      {
        id: "api_v1_entry",
        name: "api_v1_entry",
        method: "GET",
        path: API_V1_ENTRY_PATH,
        url: absoluteUrl(config, API_V1_ENTRY_PATH),
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        description: "One-tenth-cent versioned x402 navigation endpoint for agents that start at /api/v1. Returns a quick score, paid route map, and preferred first paid action after payment.",
        keywords: ["x402 navigation", "API v1 entrypoint", "agent commerce", "route map", "api v1"],
        command: buildGetPayCommand(config, API_V1_ENTRY_PATH, INSTANT_SCORE_AMOUNT),
        input: {},
        outputExample: buildApiEntryOutput(config),
        schema: absoluteUrl(config, "/openapi.json")
      },
      {
        id: "v1_entry",
        name: "v1_entry",
        method: "GET",
        path: V1_ENTRY_PATH,
        url: absoluteUrl(config, V1_ENTRY_PATH),
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        description: "One-tenth-cent short versioned x402 navigation endpoint for agents that start at /v1. Returns a quick score, paid route map, and preferred first paid action after payment.",
        keywords: ["x402 navigation", "v1 entrypoint", "agent commerce", "route map", "v1"],
        command: buildGetPayCommand(config, V1_ENTRY_PATH, INSTANT_SCORE_AMOUNT),
        input: {},
        outputExample: buildApiEntryOutput(config),
        schema: absoluteUrl(config, "/openapi.json")
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
        description: AGENT_LISTING_CONVERSION_DESCRIPTION,
        keywords: ["agent service listing clarity", "agent service listing clarity x402", "agent listing conversion score", "buyer-agent skip reasons", "buyer agent skip reasons", "agent listing clarity", "buyer intent", "paid API listing quality", "agent-service listing score", "marketplace listing conversion", "GET paid API"],
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
        description: "One-tenth-cent GET x402 listing SEO audit, listing rank doctor, seller growth checklist, service discoverability audit, and paid API preflight before paying for direct 402 metadata, route health, Bazaar pricing, search visibility, OpenAPI, llms.txt, and no-spend next actions.",
        keywords: ["x402 site audit", "x402 service discoverability audit", "x402 listing SEO audit", "x402 listing rank doctor", "x402 seller growth checklist", "x402 seller intelligence", "x402 marketplace SEO audit", "paid API preflight", "x402 route health check", "x402 discovery audit", "x402 bazaar discovery audit", "bazaar search visibility", "x402 listing stale price"],
        command: buildGetPayCommand(config, SITE_AUDIT_PATH, SITE_AUDIT_AMOUNT),
        input: buildSiteAuditDiscovery(config).input,
        outputExample: buildSiteAuditExampleOutput(config),
        schema: absoluteUrl(config, "/api/discovery-audit-schema")
      },
      ...buildPreflightAliasManifestResources(config),
      {
        id: "x402_discovery_audit_quick",
        name: "x402_discovery_audit_quick",
        method: "GET",
        path: DISCOVERY_AUDIT_PATH,
        url: absoluteUrl(config, DISCOVERY_AUDIT_PATH),
        price: config.siteAuditPrice,
        maxAmountRequired: DISCOVERY_AUDIT_QUICK_AMOUNT,
        description: "One-tenth-cent GET x402 discovery audit on the exact discovery-audit path for agents probing stale Bazaar pricing, search visibility, route health, paid API preflight, direct 402 metadata, and no-spend next actions before buying the full custom audit.",
        keywords: ["x402 discovery audit", "x402 bazaar discovery audit", "x402 service discoverability audit", "paid API preflight", "x402 route health check", "bazaar search visibility", "x402 listing stale price", "stale Bazaar price", "GET paid API"],
        command: buildGetPayCommand(config, DISCOVERY_AUDIT_PATH, DISCOVERY_AUDIT_QUICK_AMOUNT),
        input: buildDiscoveryAuditQuickDiscovery(config).input,
        outputExample: buildDiscoveryAuditQuickExampleOutput(config),
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
        description: "One-cent x402 Bazaar discovery audit for listing SEO, listing rank, seller growth, stale indexed pricing, missing marketplace visibility, direct 402 metadata, and next actions. Makes no paid calls.",
        keywords: ["x402 bazaar discovery audit", "x402 listing SEO audit", "x402 listing rank doctor", "x402 seller growth checklist", "x402 seller intelligence", "x402 marketplace SEO audit", "x402 listing stale price", "bazaar search visibility", "paid API listing", "x402 listing"],
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
        outputExample: buildListingScoreWithUpgrade(requestExample, config),
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
    ].map(enrichManifestResource)
  };
}

function priceToUsd(price) {
  return String(price || "").replace(/^\$/, "");
}

function buildAgentToolsManifest(config) {
  const x402Manifest = buildX402Manifest(config);
  const intentRoutes = buildPayNowActions(config);
  const primaryEndpoint = buildPrimaryEndpointHandoff(config, intentRoutes);
  const primaryResourceSample = buildPrimaryResourceSample(primaryEndpoint);
  const payment = {
    asset: config.network === BASE_MAINNET_NETWORK ? BASE_USDC_CONTRACT : "USDC",
    assetName: config.network === BASE_MAINNET_NETWORK ? "Base mainnet USDC" : "USDC",
    network: config.network,
    payTo: config.payTo
  };

  const tools = x402Manifest.resources.map((resource) => ({
    name: resource.id,
    title: resource.name,
    description: resource.description,
    category: resource.id === "x402_site_audit" || resource.id === "x402_discovery_audit" || resource.canonicalRoute === SITE_AUDIT_PATH ? "x402-discovery" : "paid-api-listing",
    method: resource.method,
    local_route: resource.path,
    x402_route: resource.path,
    url: resource.url,
    price_usd: priceToUsd(resource.price),
    max_amount_required: resource.maxAmountRequired,
    network: config.network,
    asset: payment.asset,
    assetName: payment.assetName,
    payment,
    command: resource.command,
    input: resource.input || {},
    output_example: resource.outputExample || {},
    schema_url: resource.schema,
    docs_url: absoluteUrl(config, DOCS_PATH),
    tags: resource.tags || [],
    keywords: resource.keywords || [],
    preferred_first_paid_action: resource.id === "indexed_roast_quick_score",
    no_spend_handoff: absoluteUrl(config, PAY_NOW_PATH)
  }));

  return {
    name: config.serviceName,
    type: "x402-paid-api-service",
    version: "0.3",
    metadata_version: DISCOVERY_METADATA_VERSION,
    metadata_updated_at: DISCOVERY_METADATA_UPDATED_AT,
    last_updated: DISCOVERY_METADATA_UPDATED_AT,
    description: DISCOVERY_DESCRIPTION,
    serviceName: config.serviceName,
    provider_url: config.serviceUrl,
    iconUrl: absoluteUrl(config, ICON_SVG_PATH),
    icon_url: absoluteUrl(config, ICON_SVG_PATH),
    category: SERVICE_CATEGORY,
    tags: SERVICE_TAGS,
    base_url: x402Manifest.baseUrl,
    payment,
    paid_relay: true,
    resource_count: 1,
    resource_samples: [primaryResourceSample],
    call_info: {
      resource_count: 1,
      resource_samples: [primaryResourceSample]
    },
    catalog: "/x402.json",
    x402_catalog: "/x402.json",
    bazaar_metadata: WELL_KNOWN_X402_PATH,
    openapi: "/openapi.json",
    openapi_alias: WELL_KNOWN_OPENAPI_JSON_PATH,
    llms: LLMS_PATH,
    llms_alias: WELL_KNOWN_LLMS_PATH,
    llms_full: LLMS_FULL_PATH,
    llms_full_alias: WELL_KNOWN_LLMS_FULL_PATH,
    mcp: WELL_KNOWN_MCP_JSON_PATH,
    agent_card: WELL_KNOWN_AGENT_CARD_PATH,
    api_catalog: WELL_KNOWN_API_CATALOG_PATH,
    pay_now: PAY_NOW_PATH,
    paid_usage_proof: PAID_USAGE_PROOF_PATH,
    pricing: PRICING_PATH,
    route: ROUTE_PATH,
    settlement_proof: "/api/cash-register",
    primary_endpoint: primaryEndpoint,
    primary_paid_endpoint: primaryEndpoint,
    endpoints: {
      primary_paid_call: {
        method: primaryEndpoint.method,
        url: primaryEndpoint.url,
        path: primaryEndpoint.path,
        price_usd: priceToUsd(primaryEndpoint.price),
        max_amount_required: primaryEndpoint.maxAmountRequired,
        command: primaryEndpoint.command,
        returns: "paid listing quality quick score with next paid action guidance"
      },
      pay_now: absoluteUrl(config, PAY_NOW_PATH),
      paid_usage_proof: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
      pricing: absoluteUrl(config, PRICING_PATH),
      route: absoluteUrl(config, ROUTE_PATH),
      x402_manifest: absoluteUrl(config, WELL_KNOWN_X402_PATH),
      openapi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH),
      api_catalog: absoluteUrl(config, WELL_KNOWN_API_CATALOG_PATH),
      cash_register: absoluteUrl(config, "/api/cash-register")
    },
    call: {
      primary_endpoint: primaryEndpoint,
      primary_url: primaryEndpoint.url,
      primary_method: primaryEndpoint.method,
      x402_route: primaryEndpoint.path,
      command: primaryEndpoint.command,
      note: primaryEndpoint.note
    },
    agent_hint: "For the first paid call, use GET /api/listing-roast with max 1000 USDC units. POST / is only a fallback directory handoff, not the preferred buyer path.",
    intent_landing_pages: buildIntentLandingHandoffs(config),
    preferred_first_paid_action: {
      name: "indexed_roast_quick_score",
      ...intentRoutes.indexedQuickScore
    },
    recommended_paid_sequence: buildRecommendedPaidSequence(intentRoutes),
    no_spend_note: "This manifest is free to fetch. Payment happens only when a buyer calls one of the listed x402 routes.",
    tools
  };
}

function buildPaidRouteCatalog(config) {
  return buildX402Manifest(config).resources.map((resource) => ({
    id: resource.id,
    serviceName: resource.serviceName,
    name: resource.name,
    method: resource.method,
    path: resource.path,
    url: resource.url,
    price: resource.price,
    maxAmountRequired: resource.maxAmountRequired,
    description: resource.description,
    tags: resource.tags,
    keywords: resource.keywords,
    command: resource.command,
    schema: resource.schema,
    preferredFirstPaidAction: resource.id === "indexed_roast_quick_score"
  }));
}

function buildPricingCatalog(config, cashRegister = {}) {
  const routes = buildPaidRouteCatalog(config);
  const intentRoutes = buildPayNowActions(config);

  return {
    service: config.serviceName,
    noSpend: true,
    paidUsageProof: buildPaidUsageProof(config, cashRegister),
    paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
    homepage: absoluteUrl(config, "/"),
    pricing: absoluteUrl(config, PRICING_PATH),
    find: absoluteUrl(config, FIND_PATH),
    route: absoluteUrl(config, ROUTE_PATH),
    localDiscovery: {
      resources: absoluteUrl(config, LOCAL_DISCOVERY_RESOURCE_PATHS[0]),
      search: absoluteUrl(config, LOCAL_DISCOVERY_SEARCH_PATHS[0]),
      merchant: absoluteUrl(config, LOCAL_DISCOVERY_MERCHANT_PATHS[0]),
      searchExamples: buildLocalDiscoverySearchExamples(config)
    },
    openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH),
    x402Manifest: absoluteUrl(config, "/x402.json"),
    payNow: absoluteUrl(config, PAY_NOW_PATH),
    count: routes.length,
    preferredFirstPaidAction: routes[0],
    recommendedPaidSequence: buildRecommendedPaidSequence(intentRoutes),
    routes,
    queryExamples: [
      `${absoluteUrl(config, FIND_PATH)}?q=x402%20discovery%20audit`,
      `${absoluteUrl(config, FIND_PATH)}?q=buyer-agent%20skip%20reasons`,
      `${absoluteUrl(config, FIND_PATH)}?q=listing%20roast%20full%20rewrite`,
      `${absoluteUrl(config, ROUTE_PATH)}?query=x402%20discovery%20audit&top=3`
    ],
    note: "This pricing catalog is free to fetch. It only describes paid x402 routes; payment happens when a buyer calls a paid route with a valid x402 payment header."
  };
}

function parseDiscoveryLimit(value, fallback = 100) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), 1000);
}

function parseDiscoveryOffset(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(parsed, 0);
}

function atomicAmountToUsd(amount) {
  const numeric = Number(amount || 0);
  return Number.isFinite(numeric) ? numeric / Number(USDC_DECIMALS) : 0;
}

function buildLocalDiscoveryItems(config) {
  const now = new Date().toISOString();

  return buildX402Manifest(config).resources.map((resource) => ({
    resource: resource.url,
    type: "http",
    x402Version: 2,
    serviceName: resource.serviceName || config.serviceName,
    description: resource.description,
    tags: resource.tags || [],
    keywords: resource.keywords || [],
    accepts: [
      {
        scheme: "exact",
        network: config.network,
        amount: resource.maxAmountRequired,
        asset: config.network === BASE_MAINNET_NETWORK ? BASE_USDC_CONTRACT : "USDC",
        payTo: config.payTo,
        extra: {
          name: "USDC",
          decimals: 6
        }
      }
    ],
    lastUpdated: now,
    metadata: {
      id: resource.id,
      serviceName: config.serviceName,
      name: resource.name,
      method: resource.method,
      path: resource.path,
      price: resource.price,
      maxAmountRequired: resource.maxAmountRequired,
      description: resource.description,
      serviceTags: resource.tags || [],
      tags: uniqueTerms([...(resource.tags || []), ...(resource.keywords || [])]),
      keywords: resource.keywords || [],
      input: resource.input || {},
      output: {
        example: resource.outputExample || {}
      },
      schema: resource.schema,
      command: resource.command,
      preferredFirstPaidAction: resource.id === "indexed_roast_quick_score",
      noSpendHandoff: absoluteUrl(config, PAY_NOW_PATH),
      paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH)
    }
  }));
}

function buildLocalDiscoveryResources(config, query = {}, cashRegister = {}) {
  const allItems = buildLocalDiscoveryItems(config);
  const intentRoutes = buildPayNowActions(config);
  const limit = parseDiscoveryLimit(query.limit);
  const offset = parseDiscoveryOffset(query.offset);
  const items = allItems.slice(offset, offset + limit);

  return {
    x402Version: 2,
    source: "local-owned-surface",
    service: config.serviceName,
    noSpend: true,
    paidUsageProof: buildPaidUsageProof(config, cashRegister),
    paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
    canonicalBazaar: "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources",
    payNow: absoluteUrl(config, PAY_NOW_PATH),
    pricing: absoluteUrl(config, PRICING_PATH),
    preferredFirstPaidAction: intentRoutes.indexedQuickScore,
    recommendedPaidSequence: buildRecommendedPaidSequence(intentRoutes),
    items,
    pagination: {
      limit,
      offset,
      total: allItems.length
    },
    search: absoluteUrl(config, LOCAL_DISCOVERY_SEARCH_PATHS[0]),
    merchant: absoluteUrl(config, LOCAL_DISCOVERY_MERCHANT_PATHS[0]),
    note: "Free local Bazaar-shaped catalog for buyer agents that probe discovery paths on this seller domain. Canonical CDP Bazaar discovery remains hosted by Coinbase."
  };
}

function buildLocalDiscoverySearch(config, query = {}, cashRegister = {}) {
  const rawQuery = String(query.query || query.q || "").trim().slice(0, 400);
  const maxUsdPrice = query.maxUsdPrice == null ? null : Number(query.maxUsdPrice);
  const intentRoutes = buildPayNowActions(config);
  const resources = buildLocalDiscoveryItems(config)
    .filter((item) => !query.network || item.accepts.some((accept) => accept.network === query.network))
    .filter((item) => !query.payTo || item.accepts.some((accept) => String(accept.payTo).toLowerCase() === String(query.payTo).toLowerCase()))
    .filter((item) => !Number.isFinite(maxUsdPrice) || item.accepts.some((accept) => atomicAmountToUsd(accept.amount) <= maxUsdPrice))
    .map((item) => ({
      item,
      score: rawQuery ? scoreCatalogResource({
        id: item.metadata.id,
        name: item.metadata.name,
        method: item.metadata.method,
        path: item.metadata.path,
        description: item.description,
        keywords: item.metadata.tags,
        preferredFirstPaidAction: item.metadata.preferredFirstPaidAction
      }, rawQuery) : (item.metadata.preferredFirstPaidAction ? 1 : 0)
    }))
    .filter((entry) => !rawQuery || entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return atomicAmountToUsd(left.item.accepts[0]?.amount) - atomicAmountToUsd(right.item.accepts[0]?.amount);
    })
    .slice(0, parseDiscoveryLimit(query.limit, 20))
    .map((entry) => entry.item);
  const selected = selectedPaidActionForRoute(intentRoutes, resources[0]);
  const selectedActionKey = selected?.selectedActionKey || "indexedQuickScore";
  const selectedPaidAction = selected?.selectedPaidAction || intentRoutes.indexedQuickScore;

  return {
    x402Version: 2,
    source: "local-owned-surface",
    service: config.serviceName,
    query: rawQuery,
    noSpend: true,
    paidUsageProof: buildPaidUsageProof(config, cashRegister),
    paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
    payNow: absoluteUrl(config, PAY_NOW_PATH),
    pricing: absoluteUrl(config, PRICING_PATH),
    ...(selected || {}),
    selectedFirstPaidAction: selectedPaidAction,
    selectedPaidSequence: buildSelectedPaidSequence(intentRoutes, selectedActionKey, selectedPaidAction),
    buyerInstruction: buildSelectedBuyerInstruction(selectedActionKey, selectedPaidAction, intentRoutes.indexedQuickScore),
    preferredFirstPaidAction: intentRoutes.indexedQuickScore,
    provenFirstPaidAction: intentRoutes.indexedQuickScore,
    recommendedPaidSequence: buildRecommendedPaidSequence(intentRoutes),
    resources,
    partialResults: false,
    searchMethod: "local-hybrid",
    canonicalBazaarSearch: "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search",
    note: "Free local search over this seller's paid x402 route catalog. Payment only happens when a buyer calls a paid route with a valid x402 payment header."
  };
}

function buildLocalDiscoveryMerchant(config, query = {}, cashRegister = {}) {
  const payTo = String(query.payTo || "").toLowerCase();
  const matchesMerchant = !payTo || payTo === config.payTo.toLowerCase();
  const intentRoutes = buildPayNowActions(config);
  const items = matchesMerchant ? buildLocalDiscoveryItems(config) : [];

  return {
    x402Version: 2,
    source: "local-owned-surface",
    service: config.serviceName,
    payTo: query.payTo || config.payTo,
    noSpend: true,
    paidUsageProof: buildPaidUsageProof(config, cashRegister),
    paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
    payNow: absoluteUrl(config, PAY_NOW_PATH),
    pricing: absoluteUrl(config, PRICING_PATH),
    preferredFirstPaidAction: intentRoutes.indexedQuickScore,
    recommendedPaidSequence: buildRecommendedPaidSequence(intentRoutes),
    resources: items,
    count: items.length,
    canonicalMerchantDiscovery: "https://api.cdp.coinbase.com/platform/v2/x402/discovery/merchant",
    note: "Free local merchant lookup for this seller domain. Canonical merchant discovery remains hosted by Coinbase."
  };
}

function includesAny(text, values) {
  return values.some((value) => text.includes(value));
}

function wantsPaidApiPreflight(query) {
  return includesAny(query, [
    "paid api preflight",
    "api preflight",
    "endpoint preflight",
    "preflight before paying",
    "before paying",
    "before you pay",
    "before spending",
    "pre-pay",
    "pre pay"
  ]);
}

function wantsBazaarDiscoveryFix(query) {
  return includesAny(query, [
    "discovery audit",
    "bazaar",
    "stale price",
    "stale pricing",
    "search visibility",
    "search position"
  ]);
}

function scoreCatalogResource(resource, query) {
  const normalizedQuery = query.toLowerCase();
  const wantsPreflight = wantsPaidApiPreflight(normalizedQuery);
  const wantsDiscoveryFix = wantsBazaarDiscoveryFix(normalizedQuery);
  const wantsCustomScore = includesAny(normalizedQuery, [
    "custom body",
    "body-specific",
    "json body",
    "submitted copy",
    "provided copy",
    "current listing copy",
    "score my listing",
    "score my paid api listing",
    "score our paid api listing"
  ]);
  const wantsFullRoast = includesAny(normalizedQuery, [
    "full roast",
    "rewrite",
    "top fixes",
    "launch guidance",
    "launch recommendation"
  ]);
  const searchable = [
    resource.id,
    resource.name,
    resource.method,
    resource.path,
    resource.description,
    ...(resource.keywords || [])
  ].join(" ").toLowerCase();
  const tokens = normalizedQuery.split(/[^a-z0-9]+/).filter((token) => token.length > 2);
  let score = resource.preferredFirstPaidAction ? 5 : 0;
  const isIndexedRoastGet = resource.id === "indexed_roast_quick_score" || (String(resource.method || "").toUpperCase() === "GET" && resource.path === ROAST_PATH);

  if (normalizedQuery && searchable.includes(normalizedQuery)) {
    score += 25;
  }

  for (const token of tokens) {
    if (searchable.includes(token)) {
      score += 3;
    }
  }

  if (wantsPreflight && !wantsDiscoveryFix) {
    if (resource.path === SITE_AUDIT_PATH) score += 175;
    if (resource.id === "indexed_roast_quick_score") score += 25;
    if (resource.id === "x402_discovery_audit_quick") score += 20;
  }

  if (wantsDiscoveryFix || includesAny(normalizedQuery, ["route health"])) {
    if (resource.id === "x402_discovery_audit_quick") score += 130;
    if (resource.id === "x402_discovery_audit") score += 80;
    if (resource.path === SITE_AUDIT_PATH) score += 55;
    if (resource.id === "indexed_roast_quick_score") score += 25;
  }

  if (includesAny(normalizedQuery, ["site audit", "metadata", "openapi", "llms", "robots", "sitemap", "endpoint counts", "payment schemes", "buyer-readiness", "buyer readiness"])) {
    if (resource.path === SITE_AUDIT_PATH) score += 125;
    if (resource.id === "x402_discovery_audit_quick") score += 35;
  }

  if (includesAny(normalizedQuery, ["discovery audit", "bazaar discovery", "x402 discovery"])) {
    if (resource.id === "x402_discovery_audit_quick") score += 70;
    if (resource.id === "x402_discovery_audit") score += 35;
  }

  if (includesAny(normalizedQuery, ["skip reason", "skip reasons", "agent listing", "listing clarity", "agent service clarity", "agent-service", "buyer intent"])) {
    if (isIndexedRoastGet) score += 155;
    if (resource.id === "buyer_agent_skip_reasons_alias" && includesAny(normalizedQuery, ["buyer-agent skip reason", "buyer-agent skip reasons", "buyer agent skip reason", "buyer agent skip reasons", "skip reasons"])) score += 320;
    if (resource.id === "agent_service_clarity_alias" && includesAny(normalizedQuery, ["agent service clarity", "agent-service clarity", "agent service listing clarity", "agent-service listing score", "listing clarity"])) score += 320;
    if (resource.path === AGENT_LISTING_PATH) score += 90;
    if (resource.id === "listing_roast") score += 30;
  }

  if (includesAny(normalizedQuery, ["marketplace listing score", "marketplace listing quality", "paid api listing quality", "paid api listing quality score", "listing quality score", "x402 listing quality", "agent-service listing score", "agent service listing score"])) {
    if (isIndexedRoastGet) score += 260;
    if (resource.id === "marketplace_listing_score_alias" && includesAny(normalizedQuery, ["marketplace listing score", "marketplace listing quality"])) score += 460;
    if (resource.id === "paid_api_listing_quality_alias" && includesAny(normalizedQuery, ["paid api listing quality", "paid api listing quality score", "paid api listing"])) score += 460;
    if (resource.id === "agent_service_clarity_alias" && includesAny(normalizedQuery, ["agent-service listing score", "agent service listing score"])) score += 430;
    if (resource.path === INSTANT_SCORE_PATH) score += 10;
  }

  if (includesAny(normalizedQuery, ["x402 marketplace conversion", "marketplace conversion score", "marketplace conversion check"])) {
    if (resource.path === CONVERSION_SCORE_PATH) score += 140;
    if (isIndexedRoastGet) score += 15;
  }

  if (includesAny(normalizedQuery, ["full roast", "rewrite", "top fixes", "launch guidance", "custom body", "body-specific"])) {
    if (resource.id === "listing_roast") score += 125;
    if (resource.id === "listing_score") score += 55;
    if (resource.id === "indexed_roast_quick_score") score += 20;
  }

  if (wantsCustomScore) {
    if (resource.id === "listing_score") score += 170;
    if (resource.path === INSTANT_SCORE_PATH) score += 15;
  }

  if (wantsFullRoast) {
    if (resource.id === "listing_roast") score += 70;
  }

  if (includesAny(normalizedQuery, ["score", "listing quality", "marketplace conversion", "paid api listing", "discoverability", "conversion"])) {
    if (resource.id === "indexed_roast_quick_score") score += 105;
    if (resource.path === CONVERSION_SCORE_PATH) score += 85;
    if (resource.path === INSTANT_SCORE_PATH) score += 70;
    if (resource.id === "listing_score") score += 45;
    if (resource.path === AGENT_LISTING_PATH) score += 30;
  }

  if (includesAny(normalizedQuery, ["ping", "rail", "test payment", "verify payment"])) {
    if (resource.path === PING_PATH) score += 120;
  }

  if (includesAny(normalizedQuery, ["api entry", "entrypoint", "route map", "probe /api", "/api first", "api/v1", "/v1"])) {
    if ([API_ENTRY_PATH, API_V1_ENTRY_PATH, V1_ENTRY_PATH].includes(resource.path)) score += 90;
  }

  if (includesAny(normalizedQuery, ["root post", "generic post", "directory post", "directory handoff", "service root"])) {
    if (resource.id === "directory_root_post") score += 140;
  }

  if (includesAny(normalizedQuery, ["/api/v1", "api/v1", "api v1"])) {
    if (resource.path === API_V1_ENTRY_PATH) score += 140;
  }

  if (includesAny(normalizedQuery, ["/v1", " v1 ", "v1 entry", "short v1"])) {
    if (resource.path === V1_ENTRY_PATH) score += 140;
  }

  if (includesAny(normalizedQuery, ["/api first", "probe /api", "api entry"])) {
    if (resource.path === API_ENTRY_PATH) score += 120;
  }

  return score;
}

function buildFindResult(config, rawQuery = "", cashRegister = {}) {
  const query = String(rawQuery || "").trim().slice(0, 240);
  const routes = buildPaidRouteCatalog(config);
  const intentRoutes = buildPayNowActions(config);
  const ranked = routes
    .map((route) => ({ ...route, matchScore: query ? scoreCatalogResource(route, query) : (route.preferredFirstPaidAction ? 1 : 0) }))
    .sort((left, right) => {
      if (right.matchScore !== left.matchScore) return right.matchScore - left.matchScore;
      return Number(left.maxAmountRequired || 0) - Number(right.maxAmountRequired || 0);
    });
  const recommended = ranked[0] || routes[0];
  const selected = selectedPaidActionForRoute(intentRoutes, recommended);
  const provenFirstPaidAction = intentRoutes.indexedQuickScore;
  const selectedActionKey = selected?.selectedActionKey || "indexedQuickScore";
  const selectedPaidAction = selected?.selectedPaidAction || provenFirstPaidAction;

  return {
    service: config.serviceName,
    query,
    noSpend: true,
    paidUsageProof: buildPaidUsageProof(config, cashRegister),
    paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
    recommended,
    ...(selected || {}),
    alternatives: ranked.filter((route) => route.id !== recommended.id).slice(0, 4),
    pricing: absoluteUrl(config, PRICING_PATH),
    find: absoluteUrl(config, FIND_PATH),
    route: absoluteUrl(config, ROUTE_PATH),
    openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH),
    x402Manifest: absoluteUrl(config, "/x402.json"),
    payNow: absoluteUrl(config, PAY_NOW_PATH),
    preferredFirstPaidAction: provenFirstPaidAction,
    provenFirstPaidAction,
    provenFirstPaidReason: "Use this first when the buyer wants the already-indexed route with wallet-backed paid-use proof. The recommended route may still point to a phrase-specific alias.",
    selectedFirstPaidAction: selectedPaidAction,
    selectedPaidSequence: buildSelectedPaidSequence(intentRoutes, selectedActionKey, selectedPaidAction),
    buyerInstruction: buildSelectedBuyerInstruction(selectedActionKey, selectedPaidAction, provenFirstPaidAction),
    recommendedPaidSequence: buildRecommendedPaidSequence(intentRoutes),
    paymentRule: "Do not call the recommended paid route unless the buyer explicitly intends to pay USDC through x402.",
    note: "This endpoint is free. It maps a buyer task to the best existing paid route, price, max amount, schema, and copy-ready command."
  };
}

function parseRouteTop(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(Math.max(parsed, 1), 20);
}

function normalizeRouteInclude(value) {
  const include = String(value || "local").toLowerCase();
  return ["all", "local", "external"].includes(include) ? include : "local";
}

function buildRouteResult(config, payload = {}, cashRegister = {}) {
  const query = String(payload.query || payload.q || payload.task || payload.intent || "").trim().slice(0, 400);
  const include = normalizeRouteInclude(payload.include);
  const top = parseRouteTop(payload.top || payload.k || payload.limit);
  const externalOnly = include === "external";
  const routes = externalOnly ? [] : buildPaidRouteCatalog(config);
  const intentRoutes = buildPayNowActions(config);
  const ranked = routes
    .map((route) => ({
      slug: route.id,
      id: route.id,
      name: route.name,
      method: route.method,
      path: route.path,
      route: route.url,
      url: route.url,
      price: route.price,
      maxAmountRequired: route.maxAmountRequired,
      schema: route.schema,
      command: route.command,
      description: route.description,
      preferredFirstPaidAction: route.preferredFirstPaidAction,
      source: "local-owned-surface",
      matchScore: query ? scoreCatalogResource(route, query) : (route.preferredFirstPaidAction ? 1 : 0)
    }))
    .filter((route) => !query || route.matchScore > 0)
    .sort((left, right) => {
      if (right.matchScore !== left.matchScore) return right.matchScore - left.matchScore;
      return Number(left.maxAmountRequired || 0) - Number(right.maxAmountRequired || 0);
    })
    .slice(0, top);
  const selected = selectedPaidActionForRoute(intentRoutes, ranked[0]);
  const provenFirstPaidAction = intentRoutes.indexedQuickScore;
  const selectedActionKey = selected?.selectedActionKey || "indexedQuickScore";
  const selectedPaidAction = selected?.selectedPaidAction || provenFirstPaidAction;

  return {
    service: config.serviceName,
    router: "local-owned-x402-router",
    query,
    include,
    top,
    noSpend: true,
    paidUsageProof: buildPaidUsageProof(config, cashRegister),
    paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
    scope: "owned-routes-only",
    results: ranked,
    best: ranked[0] || null,
    ...(selected || {}),
    count: ranked.length,
    totalLocalRoutes: buildPaidRouteCatalog(config).length,
    pricing: absoluteUrl(config, PRICING_PATH),
    find: absoluteUrl(config, FIND_PATH),
    route: absoluteUrl(config, ROUTE_PATH),
    openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH),
    x402Manifest: absoluteUrl(config, "/x402.json"),
    localDiscovery: {
      resources: absoluteUrl(config, LOCAL_DISCOVERY_RESOURCE_PATHS[0]),
      search: absoluteUrl(config, LOCAL_DISCOVERY_SEARCH_PATHS[0]),
      merchant: absoluteUrl(config, LOCAL_DISCOVERY_MERCHANT_PATHS[0]),
      searchExamples: buildLocalDiscoverySearchExamples(config)
    },
    payNow: absoluteUrl(config, PAY_NOW_PATH),
    preferredFirstPaidAction: provenFirstPaidAction,
    provenFirstPaidAction,
    provenFirstPaidReason: "Use this first when the buyer wants the already-indexed route with wallet-backed paid-use proof. The best match may still point to a phrase-specific alias.",
    selectedFirstPaidAction: selectedPaidAction,
    selectedPaidSequence: buildSelectedPaidSequence(intentRoutes, selectedActionKey, selectedPaidAction),
    buyerInstruction: buildSelectedBuyerInstruction(selectedActionKey, selectedPaidAction, provenFirstPaidAction),
    recommendedPaidSequence: buildRecommendedPaidSequence(intentRoutes),
    paymentRule: "This router is free. Do not call a returned paid route unless the buyer explicitly intends to pay USDC through x402.",
    note: externalOnly
      ? "include=external is accepted for Agent402-style clients, but this seller-hosted router only ranks owned Listing Roast routes and does not proxy third-party sellers."
      : "Free Agent402-style local route ranking over this seller's paid x402 routes. Payment only happens when a buyer calls a returned paid route with a valid x402 payment header."
  };
}

function buildAgentSkill(config, options) {
  const example = options.method === "GET"
    ? buildGetPayCommand(config, options.path, options.maxAmountRequired)
    : buildPayCommand(config, options.path, options.maxAmountRequired, options.body || requestExample);

  return {
    id: options.id,
    name: options.name,
    description: options.description,
    tags: options.tags,
    examples: [example],
    inputModes: options.inputModes || ["application/json"],
    outputModes: ["application/json"],
    security: [{ x402: [] }],
    metadata: {
      method: options.method,
      path: options.path,
      url: absoluteUrl(config, options.path),
      price: options.price,
      maxAmountRequired: options.maxAmountRequired,
      payment: buildPaymentHint(config, {
        path: options.path,
        method: options.method,
        price: options.price,
        maxAmountRequired: options.maxAmountRequired,
        preferredFirstPaidAction: Boolean(options.preferredFirstPaidAction),
        buyerAction: options.buyerAction
      })
    }
  };
}

function buildAgentCard(config, cashRegister = {}) {
  const intentRoutes = buildPayNowActions(config);
  const recommendedPaidSequence = buildRecommendedPaidSequence(intentRoutes);
  const supportedInterfaces = [
    { url: absoluteUrl(config, ROAST_PATH), transport: "HTTP+JSON" },
    { url: absoluteUrl(config, API_ENTRY_PATH), transport: "HTTP+JSON" },
    { url: absoluteUrl(config, API_V1_ENTRY_PATH), transport: "HTTP+JSON" },
    { url: absoluteUrl(config, V1_ENTRY_PATH), transport: "HTTP+JSON" },
    { url: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH), transport: "OPENAPI" },
    { url: absoluteUrl(config, "/x402.json"), transport: "X402" },
    { url: absoluteUrl(config, WELL_KNOWN_MCP_JSON_PATH), transport: "MCP" },
    { url: absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH), transport: "MCP-SERVER-CARD" }
  ];

  return {
    protocolVersion: "0.3.0",
    name: config.serviceName,
    description: "Paid HTTP+JSON x402 service for listing quality, buyer-agent skip reasons, and x402 discoverability audits.",
    url: absoluteUrl(config, ROAST_PATH),
    iconUrl: absoluteUrl(config, ICON_SVG_PATH),
    preferredTransport: "HTTP+JSON",
    supportedInterfaces,
    additionalInterfaces: supportedInterfaces,
    provider: {
      organization: config.serviceName,
      url: absoluteUrl(config, "/")
    },
    version: "0.2.0",
    documentationUrl: absoluteUrl(config, LLMS_PATH),
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
      extensions: [
        {
          uri: "https://x402.org",
          description: "Paid routes require x402 payment before protected JSON output is returned.",
          required: true,
          params: {
            network: config.network,
            asset: "USDC",
            manifest: absoluteUrl(config, "/x402.json")
          }
        }
      ]
    },
    securitySchemes: {
      x402: {
        type: "apiKey",
        in: "header",
        name: "X-PAYMENT",
        description: "x402 payment proof header sent after reading the HTTP 402 payment requirements."
      }
    },
    security: [{ x402: [] }],
    defaultInputModes: ["application/json", "text/plain"],
    defaultOutputModes: ["application/json"],
    preferredFirstPaidAction: intentRoutes.indexedQuickScore,
    recommendedPaidSequence,
    payNowExamples: buildPayNowIntentExamples(config),
    cashRegister: absoluteUrl(config, "/api/cash-register"),
    paidUsageProof: buildPaidUsageProof(config, cashRegister),
    settlementProof: buildSettlementProof(config),
    skills: [
      buildAgentSkill(config, {
        id: "indexed-listing-roast-quick-score",
        name: "Buyer-agent skip reasons quick score",
        description: "$0.001 GET score for buyer-agent skip reasons, agent service listing clarity, and paid API listing quality on the already-indexed Listing Roast route.",
        tags: ["x402", "paid API listing", "listing roast", "buyer-agent skip reasons"],
        method: "GET",
        path: ROAST_PATH,
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        preferredFirstPaidAction: true,
        buyerAction: "Pay $0.001 on the already-indexed marketplace route for a quick listing quality score."
      }),
      buildAgentSkill(config, {
        id: "api-entry-route-map",
        name: "API entry route map",
        description: "$0.001 GET generic x402 navigation endpoint for agents that start at /api.",
        tags: ["x402 navigation", "API entrypoint", "agent commerce", "route map"],
        method: "GET",
        path: API_ENTRY_PATH,
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        buyerAction: "Pay $0.001 for the generic API entry route map when an agent starts discovery at /api."
      }),
      buildAgentSkill(config, {
        id: "api-v1-entry-route-map",
        name: "API v1 entry route map",
        description: "$0.001 GET versioned x402 navigation endpoint for agents that start at /api/v1.",
        tags: ["x402 navigation", "API v1 entrypoint", "agent commerce", "route map", "api v1"],
        method: "GET",
        path: API_V1_ENTRY_PATH,
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        buyerAction: "Pay $0.001 for the API v1 entry route map when an agent starts discovery at /api/v1."
      }),
      buildAgentSkill(config, {
        id: "v1-entry-route-map",
        name: "Short v1 entry route map",
        description: "$0.001 GET short versioned x402 navigation endpoint for agents that start at /v1.",
        tags: ["x402 navigation", "v1 entrypoint", "agent commerce", "route map", "v1"],
        method: "GET",
        path: V1_ENTRY_PATH,
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        buyerAction: "Pay $0.001 for the short v1 entry route map when an agent starts discovery at /v1."
      }),
      buildAgentSkill(config, {
        id: "agent-listing-conversion-score",
        name: "buyer-agent skip reasons and agent listing conversion score",
        description: AGENT_LISTING_CONVERSION_DESCRIPTION,
        tags: ["agent listing conversion", "agent service listing clarity", "buyer-agent skip reasons"],
        method: "GET",
        path: AGENT_LISTING_PATH,
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        buyerAction: "Pay $0.001 for an agent listing conversion score without building a JSON body."
      }),
      buildAgentSkill(config, {
        id: "x402-site-audit",
        name: "x402 site audit",
        description: "$0.001 GET x402 listing SEO audit, listing rank doctor, seller growth checklist, service discoverability, and paid API preflight before paying audit.",
        tags: ["x402 site audit", "x402 service discoverability", "x402 listing SEO audit", "x402 listing rank doctor", "x402 seller growth checklist", "x402 seller intelligence", "paid API preflight"],
        method: "GET",
        path: SITE_AUDIT_PATH,
        price: config.siteAuditPrice,
        maxAmountRequired: SITE_AUDIT_AMOUNT,
        buyerAction: "Pay $0.001 for a no-spend x402 metadata, pricing, and search visibility check."
      }),
      buildAgentSkill(config, {
        id: "x402-discovery-audit-quick",
        name: "x402 discovery audit quick check",
        description: "$0.001 GET x402 discovery audit on the exact audit path for stale pricing, search visibility, route health, paid API preflight, and direct 402 metadata.",
        tags: ["x402 discovery audit", "x402 bazaar discovery", "x402 route health", "paid API preflight", "stale price"],
        method: "GET",
        path: DISCOVERY_AUDIT_PATH,
        price: config.siteAuditPrice,
        maxAmountRequired: DISCOVERY_AUDIT_QUICK_AMOUNT,
        buyerAction: "Pay $0.001 for the exact x402 discovery audit path before buying the full custom audit."
      }),
      buildAgentSkill(config, {
        id: "x402-discovery-audit",
        name: "x402 discovery audit",
        description: "$0.01 POST audit for stale pricing, search visibility, listing SEO, seller growth, and direct 402 metadata.",
        tags: ["x402 discovery audit", "x402 bazaar discovery", "x402 listing SEO audit", "x402 listing rank doctor", "x402 seller growth checklist", "x402 seller intelligence", "stale price"],
        method: "POST",
        path: DISCOVERY_AUDIT_PATH,
        price: config.discoveryAuditPrice,
        maxAmountRequired: DISCOVERY_AUDIT_AMOUNT,
        body: discoveryAuditRequestExample,
        buyerAction: "Pay $0.01 for a custom-body discovery audit without making paid calls to the audited endpoint."
      }),
      buildAgentSkill(config, {
        id: "listing-roast-full-review",
        name: "Listing roast full review",
        description: "$0.01 POST full roast with skip reasons, top fixes, rewritten listing, and stop-or-upgrade guidance.",
        tags: ["listing roast", "marketplace listing conversion", "paid API listing quality"],
        method: "POST",
        path: ROAST_PATH,
        price: config.price,
        maxAmountRequired: "10000",
        buyerAction: "Pay $0.01 for the full listing roast, rewrite, and stop-or-upgrade guidance."
      })
    ],
    supportsAuthenticatedExtendedCard: false,
    metadata: {
      paymentProtocol: "x402",
      payNow: absoluteUrl(config, PAY_NOW_PATH),
      pricing: absoluteUrl(config, PRICING_PATH),
      find: absoluteUrl(config, FIND_PATH),
      route: absoluteUrl(config, ROUTE_PATH),
      x402Manifest: absoluteUrl(config, "/x402.json"),
      openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH),
      iconUrl: absoluteUrl(config, ICON_SVG_PATH),
      llms: absoluteUrl(config, LLMS_PATH),
      llmsAliases: [absoluteUrl(config, WELL_KNOWN_LLMS_PATH)],
      llmsFull: absoluteUrl(config, LLMS_FULL_PATH),
      llmsFullAliases: [absoluteUrl(config, WELL_KNOWN_LLMS_FULL_PATH)],
      mcp: absoluteUrl(config, WELL_KNOWN_MCP_JSON_PATH),
      mcpAliases: [absoluteUrl(config, WELL_KNOWN_MCP_PATH), absoluteUrl(config, WELL_KNOWN_MCP_SERVER_PATH)],
      mcpServerCard: absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH),
      quickScoreAliases: quickScoreAliasUrls(config),
      preflightAliases: preflightAliasUrls(config),
      agentSkills: absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH),
      noSpendDiscovery: true,
      preferredFirstPaidAction: intentRoutes.indexedQuickScore,
      recommendedPaidSequence,
      payNowExamples: buildPayNowIntentExamples(config),
      cashRegister: absoluteUrl(config, "/api/cash-register"),
      paidUsageProof: buildPaidUsageProof(config, cashRegister),
      settlementProof: buildSettlementProof(config),
      a2aTaskEndpointAvailable: false,
      note: "This public card is a discovery bridge for paid x402 HTTP+JSON routes. Use OpenAPI, x402 manifest, or MCP metadata for exact callable routes."
    }
  };
}

function buildAiPluginManifest(config, cashRegister = {}) {
  const intentRoutes = buildPayNowActions(config);
  const recommendedPaidSequence = buildRecommendedPaidSequence(intentRoutes);

  return {
    schema_version: "v1",
    name_for_human: "Listing Roast x402",
    name_for_model: "listing_roast_x402",
    description_for_human: "Paid x402 API for listing quality scoring, buyer-agent skip reasons, and x402 discoverability checks.",
    description_for_model: [
      "Listing Roast x402 is a paid HTTP JSON API for x402, MCP, and agent-service builders.",
      "Use it when a builder needs a paid API listing quality score, buyer-agent skip reasons, x402 marketplace conversion feedback, or x402 service discoverability guidance before promotion.",
      "Protected routes require x402 payment in USDC on Base before JSON output is returned.",
      `Use GET ${absoluteUrl(config, API_ENTRY_PATH)}, GET ${absoluteUrl(config, API_V1_ENTRY_PATH)}, or GET ${absoluteUrl(config, V1_ENTRY_PATH)} for a generic ${config.instantScorePrice} paid x402 navigation route map with fallback quick score when an agent starts at /api, /api/v1, or /v1 first.`,
      `Preferred first paid action: GET ${absoluteUrl(config, ROAST_PATH)} for ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT} USDC units; direct quick-score aliases are ${formatQuickScoreAliasUrls(config)}.`,
      `Use GET ${absoluteUrl(config, AGENT_LISTING_PATH)} for agent service listing clarity, agent listing conversion score, and buyer-agent skip reasons.`,
      `Use GET ${absoluteUrl(config, SITE_AUDIT_PATH)} for a cheap x402 site audit and paid API preflight before paying; direct preflight aliases are ${formatPreflightAliasUrls(config)}.`,
      `Use POST ${absoluteUrl(config, ROAST_PATH)} only when the buyer wants the full ${config.price} roast, rewrite, and stop-or-upgrade guidance.`,
      `Use free GET ${absoluteUrl(config, PRICING_PATH)} for the paid route price catalog, free GET ${absoluteUrl(config, FIND_PATH)}?q=<task> to choose one route, and free GET/POST ${absoluteUrl(config, ROUTE_PATH)} to rank local paid routes before spending.`,
      "Do not call paid routes unless the buyer intends to pay; free discovery files are OpenAPI, x402 manifest, agent card, Agent Skills index, MCP metadata, llms.txt, examples, sample score, paid-use proof, pricing, route finder, local route router, and pay-now JSON."
    ].join(" "),
    auth: {
      type: "none"
    },
    api: {
      type: "openapi",
      url: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH),
      is_user_authenticated: false
    },
    legal_info_url: absoluteUrl(config, "/"),
    x_listing_roast: {
      paymentProtocol: "x402",
      network: config.network,
      asset: "USDC",
      payNow: absoluteUrl(config, PAY_NOW_PATH),
      pricing: absoluteUrl(config, PRICING_PATH),
      find: absoluteUrl(config, FIND_PATH),
      route: absoluteUrl(config, ROUTE_PATH),
      x402Manifest: absoluteUrl(config, "/x402.json"),
      agentCard: absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH),
      agentSkills: absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH),
      openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH),
      quickScoreAliases: quickScoreAliasUrls(config),
      preflightAliases: preflightAliasUrls(config),
      recommendedFirstPaidAction: intentRoutes.indexedQuickScore,
      recommendedPaidSequence,
      payNowExamples: buildPayNowIntentExamples(config),
      cashRegister: absoluteUrl(config, "/api/cash-register"),
      paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
      paidUsageProof: buildPaidUsageProof(config, cashRegister),
      settlementProof: buildSettlementProof(config)
    }
  };
}

function buildApiCatalog(config) {
  const item = [
    { href: absoluteUrl(config, ROAST_PATH), type: "application/json", title: "GET preferred first $0.001 indexed x402 marketplace listing score and POST $0.01 full roast" },
    ...QUICK_SCORE_ALIAS_PATHS.map((pathname) => ({ href: absoluteUrl(config, pathname), type: "application/json", title: QUICK_SCORE_ALIAS_METADATA[pathname].catalogTitle })),
    { href: absoluteUrl(config, ROOT_DIRECTORY_POST_PATH), type: "application/json", title: "POST $0.001 root directory handoff for generic agent-tools snippets" },
    { href: absoluteUrl(config, INSTANT_SCORE_PATH), type: "application/json", title: "GET $0.001 instant paid API listing quality score" },
    { href: absoluteUrl(config, CONVERSION_SCORE_PATH), type: "application/json", title: "GET $0.001 x402 marketplace conversion score" },
    { href: absoluteUrl(config, AGENT_LISTING_PATH), type: "application/json", title: "GET $0.001 buyer-agent skip reasons and agent listing conversion score" },
    { href: absoluteUrl(config, PING_PATH), type: "application/json", title: "GET $0.001 paid x402 ping" },
    { href: absoluteUrl(config, SITE_AUDIT_PATH), type: "application/json", title: "GET $0.001 x402 site audit and paid API preflight" },
    ...PREFLIGHT_ALIAS_PATHS.map((pathname) => ({ href: absoluteUrl(config, pathname), type: "application/json", title: "GET $0.001 paid API preflight alias for x402 site audit" })),
    { href: absoluteUrl(config, "/api/listing-score"), type: "application/json", title: "POST $0.005 paid API listing quality score" },
    { href: absoluteUrl(config, DISCOVERY_AUDIT_PATH), type: "application/json", title: "GET $0.001 and POST $0.01 x402 discovery audit" },
    { href: absoluteUrl(config, API_ENTRY_PATH), type: "application/json", title: "GET $0.001 generic x402 navigation route map" },
    { href: absoluteUrl(config, API_V1_ENTRY_PATH), type: "application/json", title: "GET $0.001 versioned x402 navigation route map" },
    { href: absoluteUrl(config, V1_ENTRY_PATH), type: "application/json", title: "GET $0.001 short versioned x402 navigation route map" },
    { href: absoluteUrl(config, PAY_NOW_PATH), type: "application/json", title: "GET free intent-aware pay-now handoff for the selected paid route" },
    { href: absoluteUrl(config, PAID_USAGE_PROOF_PATH), type: "application/json", title: "GET free wallet-backed paid-use proof" },
    { href: absoluteUrl(config, PRICING_PATH), type: "application/json", title: "GET free paid route pricing catalog" },
    { href: absoluteUrl(config, FIND_PATH), type: "application/json", title: "GET free task-to-paid-route finder" },
    { href: absoluteUrl(config, ROUTE_PATH), type: "application/json", title: "GET/POST free local paid-route router" },
    { href: absoluteUrl(config, LOCAL_DISCOVERY_RESOURCE_PATHS[0]), type: "application/json", title: "GET free local x402 discovery resources" },
    { href: absoluteUrl(config, LOCAL_DISCOVERY_SEARCH_PATHS[0]), type: "application/json", title: "GET free local x402 discovery search" },
    { href: absoluteUrl(config, LOCAL_DISCOVERY_MERCHANT_PATHS[0]), type: "application/json", title: "GET free local x402 merchant resources" },
    { href: absoluteUrl(config, "/api/examples"), type: "application/json", title: "GET free examples, commands, payment hints, and sample outputs" },
    { href: absoluteUrl(config, "/api/sample-score"), type: "application/json", title: "GET free sample score output" }
  ];

  return {
    linkset: [
      {
        anchor: absoluteUrl(config, WELL_KNOWN_API_CATALOG_PATH),
        item,
        "service-desc": [
          { href: absoluteUrl(config, "/openapi.json"), type: "application/vnd.oai.openapi+json", title: "OpenAPI 3.1 contract" },
          { href: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH), type: "application/vnd.oai.openapi+json", title: "Well-known OpenAPI alias" },
          { href: absoluteUrl(config, API_V1_OPENAPI_JSON_PATH), type: "application/vnd.oai.openapi+json", title: "Versioned OpenAPI alias" },
          { href: absoluteUrl(config, SWAGGER_JSON_PATH), type: "application/vnd.oai.openapi+json", title: "Swagger JSON alias" }
        ],
        "service-doc": [
          { href: absoluteUrl(config, "/"), type: "text/html", title: "Human homepage" },
          { href: absoluteUrl(config, DOCS_PATH), type: "text/markdown", title: "Agent-readable docs" },
          { href: absoluteUrl(config, API_DOCS_PATH), type: "text/markdown", title: "API docs alias" },
          { href: absoluteUrl(config, AGENTS_MARKDOWN_PATH), type: "text/markdown", title: "AGENTS.md safety and route guide" },
          { href: absoluteUrl(config, "/llms.txt"), type: "text/plain", title: "Agent-readable route guide" }
        ],
        "service-meta": [
          { href: absoluteUrl(config, "/x402.json"), type: "application/json", title: "x402 paid route manifest" },
          { href: absoluteUrl(config, WELL_KNOWN_X402_JSON_PATH), type: "application/json", title: "Well-known x402 JSON alias" },
          { href: absoluteUrl(config, WELL_KNOWN_X402_PATH), type: "application/json", title: "Well-known x402 alias" },
          { href: absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH), type: "application/json", title: "A2A-style agent card" },
          { href: absoluteUrl(config, WELL_KNOWN_AGENT_JSON_PATH), type: "application/json", title: "Agent card alias" },
          { href: absoluteUrl(config, WELL_KNOWN_AI_PLUGIN_PATH), type: "application/json", title: "Fallback AI plugin manifest" },
          { href: absoluteUrl(config, WELL_KNOWN_AGENT_TOOLS_PATH), type: "application/json", title: "Agent tools discovery manifest" },
          { href: absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH), type: "application/json", title: "Agent Skills discovery index" },
          { href: absoluteUrl(config, WELL_KNOWN_MCP_JSON_PATH), type: "application/json", title: "MCP metadata" },
          { href: absoluteUrl(config, WELL_KNOWN_MCP_PATH), type: "application/json", title: "MCP discovery alias" },
          { href: absoluteUrl(config, WELL_KNOWN_MCP_SERVER_PATH), type: "application/json", title: "MCP server discovery draft alias" },
          { href: absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH), type: "application/json", title: "MCP server card" },
          { href: absoluteUrl(config, LLMS_FULL_PATH), type: "text/markdown", title: "Full agent-readable route guide" },
          { href: absoluteUrl(config, INDEX_MARKDOWN_PATH), type: "text/markdown", title: "Homepage Markdown guide" },
          { href: absoluteUrl(config, PAY_NOW_PATH), type: "application/json", title: "Intent-aware pay-now handoff" },
          { href: absoluteUrl(config, PRICING_PATH), type: "application/json", title: "Paid route pricing catalog" },
          { href: absoluteUrl(config, FIND_PATH), type: "application/json", title: "Task-to-paid-route finder" },
          { href: absoluteUrl(config, ROUTE_PATH), type: "application/json", title: "Local paid-route router" },
          { href: absoluteUrl(config, "/api/cash-register"), type: "application/json", title: "Paid completion and receiver wallet proof" },
          { href: absoluteUrl(config, LOCAL_DISCOVERY_RESOURCE_PATHS[0]), type: "application/json", title: "Local x402 discovery resources" },
          { href: absoluteUrl(config, LOCAL_DISCOVERY_SEARCH_PATHS[0]), type: "application/json", title: "Local x402 discovery search" },
          { href: absoluteUrl(config, LOCAL_DISCOVERY_MERCHANT_PATHS[0]), type: "application/json", title: "Local x402 merchant resources" },
          { href: absoluteUrl(config, "/api/examples"), type: "application/json", title: "Examples and copy-ready commands" }
        ],
        status: [
          { href: absoluteUrl(config, "/health"), type: "application/json", title: "Service health" },
          { href: absoluteUrl(config, "/api/cash-register"), type: "application/json", title: "Paid completion and receiver wallet proof" }
        ]
      }
    ]
  };
}

function buildAgentMarkdownGuide(config) {
  return `# Listing Roast x402

Listing Roast x402 is a paid HTTP JSON API for builders who need a quick read on why buyer agents skip a paid API or x402 marketplace listing.

Preferred first paid route: GET ${absoluteUrl(config, ROAST_PATH)} (${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT} USDC units). Use this already-indexed quick score before generic /api, /api/v1, or /v1 entrypoints.

Quick-score aliases: GET ${formatQuickScoreAliasUrls(config)}. These aliases cost ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT} USDC units, and return the same quick score for marketplace listing score, paid API listing quality, buyer-agent skip reasons, and agent service clarity searches.

## Free Discovery

- Homepage: ${absoluteUrl(config, "/")}
- Docs: ${absoluteUrl(config, DOCS_PATH)}
- API docs: ${absoluteUrl(config, API_DOCS_PATH)}
- AGENTS.md: ${absoluteUrl(config, AGENTS_MARKDOWN_PATH)}
- OpenAPI: ${absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH)}
- OpenAPI aliases: ${absoluteUrl(config, "/openapi.json")}, ${absoluteUrl(config, API_V1_OPENAPI_JSON_PATH)}, ${absoluteUrl(config, SWAGGER_JSON_PATH)}
- x402 manifest: ${absoluteUrl(config, "/x402.json")}
- API catalog: ${absoluteUrl(config, WELL_KNOWN_API_CATALOG_PATH)}
- Agent card: ${absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH)}
- Agent Skills index: ${absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH)}
- MCP metadata: ${absoluteUrl(config, WELL_KNOWN_MCP_JSON_PATH)}
- MCP discovery alias: ${absoluteUrl(config, WELL_KNOWN_MCP_PATH)}
- MCP server-card metadata: ${absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH)}
- Examples and commands: ${absoluteUrl(config, "/api/examples")}
- Pay-now handoff: ${absoluteUrl(config, PAY_NOW_PATH)}?intent=buyer-agent%20skip%20reasons
- Paid-use proof: ${absoluteUrl(config, PAID_USAGE_PROOF_PATH)}
- Pricing catalog: ${absoluteUrl(config, PRICING_PATH)}
- Route finder: ${absoluteUrl(config, FIND_PATH)}?q=x402%20discovery%20audit
- Cash register: ${absoluteUrl(config, "/api/cash-register")}

## Payment Rule

Do not call paid routes unless the buyer explicitly intends to pay USDC through x402. All free discovery routes above are safe to fetch without payment.

## Preferred First Paid Route

- Method: GET
- URL: ${absoluteUrl(config, ROAST_PATH)}
- Price: ${config.instantScorePrice}
- Max amount: ${INSTANT_SCORE_AMOUNT} USDC units
- Best for: paid API listing quality, marketplace listing quality, x402 listing quality, agent service listing clarity, and buyer-agent skip reasons.
- Exact buyer-phrase aliases: GET ${formatQuickScoreAliasUrls(config)}

\`\`\`bash
${buildGetPayCommand(config, ROAST_PATH)}
\`\`\`

## Recommended Paid Sequence

1. Start with GET ${absoluteUrl(config, ROAST_PATH)} for ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT} USDC units. This is the already-indexed quick score route and the lowest-friction paid test.
2. Upgrade to POST ${absoluteUrl(config, ROAST_PATH)} for ${config.price}, max 10000 USDC units only when the quick score is promising and the buyer wants the full rewrite, top fixes, and stop-or-upgrade guidance.

Full roast command:

\`\`\`bash
${buildPayCommand(config)}
\`\`\`

## Other Paid Routes

- GET ${absoluteUrl(config, API_ENTRY_PATH)} for a generic paid x402 navigation route map with fallback quick score when an agent starts at /api first. Price: ${config.instantScorePrice}. Max amount: ${INSTANT_SCORE_AMOUNT}.
- GET ${absoluteUrl(config, API_V1_ENTRY_PATH)} for a versioned paid x402 navigation route map with fallback quick score when an agent starts at /api/v1 first. Price: ${config.instantScorePrice}. Max amount: ${INSTANT_SCORE_AMOUNT}.
- GET ${absoluteUrl(config, V1_ENTRY_PATH)} for a short versioned paid x402 navigation route map with fallback quick score when an agent starts at /v1 first. Price: ${config.instantScorePrice}. Max amount: ${INSTANT_SCORE_AMOUNT}.
- GET ${absoluteUrl(config, AGENT_LISTING_PATH)} after the indexed quick score for the dedicated agent-listing conversion deep dive. Price: ${config.instantScorePrice}. Max amount: ${INSTANT_SCORE_AMOUNT}.
- GET ${absoluteUrl(config, CONVERSION_SCORE_PATH)} for x402 marketplace conversion score. Price: ${config.instantScorePrice}. Max amount: ${INSTANT_SCORE_AMOUNT}.
- GET ${absoluteUrl(config, SITE_AUDIT_PATH)} for x402 route health, direct 402 metadata, stale price checks, and search visibility. Price: ${config.siteAuditPrice}. Max amount: ${SITE_AUDIT_AMOUNT}.
- GET ${formatPreflightAliasUrls(config)} for common paid API preflight aliases that return the same x402 site-audit output. Price: ${config.siteAuditPrice}. Max amount: ${SITE_AUDIT_AMOUNT}.
- GET ${absoluteUrl(config, DISCOVERY_AUDIT_PATH)} for the exact-path quick x402 discovery audit. Price: ${config.siteAuditPrice}. Max amount: ${DISCOVERY_AUDIT_QUICK_AMOUNT}.
- POST ${absoluteUrl(config, "/api/listing-score")} for a custom-body listing score. Price: ${config.scorePrice}. Max amount: 5000.
- POST ${absoluteUrl(config, DISCOVERY_AUDIT_PATH)} for a custom-body x402 discovery audit. Price: ${config.discoveryAuditPrice}. Max amount: ${DISCOVERY_AUDIT_AMOUNT}.
- POST ${absoluteUrl(config, ROAST_PATH)} for the full listing roast, rewrite, top fixes, and stop-or-upgrade guidance. Price: ${config.price}. Max amount: 10000.

## Keywords

${DISCOVERY_KEYWORDS.join(", ")}
`;
}

function buildAgentsMarkdown(config) {
  return `# AGENTS.md

Listing Roast x402 is a paid API for agents and builders who need a quick x402 listing-quality score, buyer-agent skip-reason check, or service-discovery audit.

## Safety

- Free discovery routes may be fetched without payment.
- Do not call paid routes unless the buyer explicitly intends to pay USDC through x402.
- No OAuth, account registration, API key, agent registration, ACP, UCP, or MPP endpoint is supported.
- Use the HTTP 402 challenge and x402 payment header flow for paid routes.

## Best First Paid Route

- Method: GET
- URL: ${absoluteUrl(config, ROAST_PATH)}
- Price: ${config.instantScorePrice}
- Max amount: ${INSTANT_SCORE_AMOUNT} USDC units
- Use it for the fastest paid score from the already-indexed listing-roast URL.
- Exact buyer-phrase aliases: GET ${formatQuickScoreAliasUrls(config)}.

\`\`\`bash
${buildGetPayCommand(config, ROAST_PATH)}
\`\`\`

## Generic Paid Entry Points

- GET ${absoluteUrl(config, API_ENTRY_PATH)} for agents that start at /api first.
- GET ${absoluteUrl(config, API_V1_ENTRY_PATH)} for agents that start at /api/v1 first.
- GET ${absoluteUrl(config, V1_ENTRY_PATH)} for agents that start at /v1 first.

Each generic entrypoint costs ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT} USDC units, and returns the paid route map after x402 payment.

## Quick-Score Buyer Phrase Aliases

- GET ${formatQuickScoreAliasUrls(config)} are direct aliases for marketplace listing score, paid API listing quality, buyer-agent skip reasons, and agent service clarity searches.
- Each alias costs ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT} USDC units, and returns the same quick-score output as GET ${absoluteUrl(config, ROAST_PATH)}.

## Paid API Preflight Aliases

- GET ${absoluteUrl(config, SITE_AUDIT_PATH)} is the canonical paid API preflight and x402 site-audit route.
- GET ${formatPreflightAliasUrls(config)} are direct aliases for agents that probe common preflight URLs before paying more. Each costs ${config.siteAuditPrice}, max ${SITE_AUDIT_AMOUNT} USDC units, and returns the same site-audit output after x402 payment.

## Free Discovery

- Docs: ${absoluteUrl(config, DOCS_PATH)}
- API docs: ${absoluteUrl(config, API_DOCS_PATH)}
- OpenAPI: ${absoluteUrl(config, "/openapi.json")}
- Versioned OpenAPI alias: ${absoluteUrl(config, API_V1_OPENAPI_JSON_PATH)}
- Swagger JSON alias: ${absoluteUrl(config, SWAGGER_JSON_PATH)}
- x402 manifest: ${absoluteUrl(config, "/x402.json")}
- llms.txt: ${absoluteUrl(config, "/llms.txt")}
- Full guide: ${absoluteUrl(config, LLMS_FULL_PATH)}
- Examples: ${absoluteUrl(config, "/api/examples")}
- Pricing catalog: ${absoluteUrl(config, PRICING_PATH)}
- Route finder: ${absoluteUrl(config, FIND_PATH)}?q=buyer-agent%20skip%20reasons
- API catalog: ${absoluteUrl(config, WELL_KNOWN_API_CATALOG_PATH)}
- Agent card: ${absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH)}
- Agent Skills: ${absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH)}
- MCP metadata: ${absoluteUrl(config, WELL_KNOWN_MCP_JSON_PATH)}

## Other Paid Routes

- GET ${absoluteUrl(config, INSTANT_SCORE_PATH)} for an instant listing score.
- GET ${absoluteUrl(config, AGENT_LISTING_PATH)} for agent listing conversion and buyer-agent skip reasons.
- GET ${absoluteUrl(config, CONVERSION_SCORE_PATH)} for x402 marketplace conversion.
- GET ${absoluteUrl(config, SITE_AUDIT_PATH)} for a no-spend x402 site audit.
  - Paid API preflight aliases: GET ${formatPreflightAliasUrls(config)}.
- GET ${absoluteUrl(config, DISCOVERY_AUDIT_PATH)} for the exact-path quick x402 discovery audit.
- GET ${absoluteUrl(config, PING_PATH)} for a paid x402 rail ping.
- POST ${absoluteUrl(config, "/api/listing-score")} for a custom-body listing score.
- POST ${absoluteUrl(config, DISCOVERY_AUDIT_PATH)} for a custom-body x402 discovery audit.
- POST ${absoluteUrl(config, ROAST_PATH)} for the full listing roast.
`;
}

function buildRobotsTxt(config) {
  const sitemapUrl = absoluteUrl(config, "/sitemap.xml");

  return `User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=no
Allow: /

User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: Claude-User
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

# Content-Signal policy: search=yes, ai-input=yes, ai-train=no
# Free agent discovery:
# - ${absoluteUrl(config, PAID_API_LISTING_QUALITY_PATH)}
# - ${absoluteUrl(config, AGENT_LISTING_CONVERSION_PAGE_PATH)}
# - ${absoluteUrl(config, X402_DISCOVERY_AUDIT_PAGE_PATH)}
# - ${absoluteUrl(config, X402_SITE_AUDIT_PAGE_PATH)}
# - ${absoluteUrl(config, "/llms.txt")}
# - ${absoluteUrl(config, LLMS_FULL_PATH)}
# - ${absoluteUrl(config, "/x402.json")}
# - ${absoluteUrl(config, PRICING_PATH)}
# - ${absoluteUrl(config, FIND_PATH)}?q=x402%20discovery%20audit
# - ${absoluteUrl(config, ROUTE_PATH)}?query=x402%20discovery%20audit&top=3
# - ${absoluteUrl(config, WELL_KNOWN_API_CATALOG_PATH)}
# - ${absoluteUrl(config, WELL_KNOWN_AGENT_TOOLS_PATH)}
# - ${absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH)}
# - ${absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH)}
# Preferred paid route after explicit buyer intent: ${absoluteUrl(config, ROAST_PATH)}
Sitemap: ${sitemapUrl}
`;
}

function buildIntentLandingPages(config) {
  const intentRoutes = buildPayNowActions(config);

  return [
    {
      path: PAID_API_LISTING_QUALITY_PATH,
      title: "Paid API listing quality score | Listing Roast x402",
      heading: "Paid API listing quality score for x402 services",
      summary: "Use this when a buyer agent is searching for paid API listing quality, marketplace listing quality, x402 listing quality, or paid API discoverability before spending USDC.",
      primaryAction: intentRoutes.paidApiListingQuality,
      primaryLabel: "Use the $0.001 paid API listing quality route",
      supportingAction: intentRoutes.indexedQuickScore,
      supportingLabel: "Use the indexed /api/listing-roast route when a marketplace result points there.",
      keywords: ["paid API listing quality", "marketplace listing quality", "x402 listing quality", "paid API discoverability", "buyer-agent skip reasons"]
    },
    {
      path: AGENT_LISTING_CONVERSION_PAGE_PATH,
      title: "Agent listing conversion score | Listing Roast x402",
      heading: "Agent listing conversion score and buyer-agent skip reasons",
      summary: "Use this when the buyer wants to know whether agents understand the offer, price, output, and checkout path before paying.",
      primaryAction: intentRoutes.agentListingConversion,
      primaryLabel: "Use the $0.001 agent listing conversion route",
      supportingAction: intentRoutes.fullRoast,
      supportingLabel: "Upgrade to the $0.01 full roast for rewritten listing copy and launch guidance.",
      keywords: ["agent listing conversion", "agent service listing clarity", "buyer-agent skip reasons", "buyer intent", "paid API listing quality"]
    },
    {
      path: X402_DISCOVERY_AUDIT_PAGE_PATH,
      title: "x402 discovery audit | Listing Roast x402",
      heading: "x402 discovery audit for stale Bazaar visibility",
      summary: "Use this when a seller needs to compare direct x402 payment metadata with marketplace search visibility, stale pricing, and route health before promotion.",
      primaryAction: intentRoutes.discoveryAuditQuick,
      primaryLabel: "Start with the $0.001 GET discovery audit",
      supportingAction: intentRoutes.discoveryAudit,
      supportingLabel: "Use the $0.01 POST discovery audit when a custom endpoint body is needed.",
      keywords: ["x402 discovery audit", "x402 bazaar discovery audit", "bazaar search visibility", "x402 listing stale price", "x402 route health check"]
    },
    {
      path: X402_SITE_AUDIT_PAGE_PATH,
      title: "x402 site audit | Listing Roast x402",
      heading: "x402 site audit and paid API preflight",
      summary: "Use this when a buyer wants a quick paid API preflight before paying more: route-health, OpenAPI, llms.txt, pricing, and Bazaar visibility without assembling a request body. Direct aliases: /api/preflight, /api/v1/preflight, and /preflight.",
      primaryAction: intentRoutes.x402SiteAudit,
      primaryLabel: "Use the $0.001 GET site audit",
      supportingAction: intentRoutes.discoveryAudit,
      supportingLabel: "Use the $0.01 POST discovery audit for a custom-body report.",
      keywords: ["x402 site audit", "paid API preflight", "x402 route health check", "x402 service discoverability audit", "x402 listing SEO audit"]
    }
  ];
}

function summarizePaidAction(action) {
  return {
    route: action.route,
    path: action.path,
    method: action.method,
    price: action.price,
    maxAmountRequired: action.maxAmountRequired,
    command: action.command,
    reason: action.reason
  };
}

function buildIntentLandingHandoffs(config) {
  return buildIntentLandingPages(config).map((page) => ({
    path: page.path,
    url: absoluteUrl(config, page.path),
    title: page.heading,
    summary: page.summary,
    keywords: page.keywords,
    primaryPaidAction: summarizePaidAction(page.primaryAction),
    supportingPaidAction: summarizePaidAction(page.supportingAction)
  }));
}

function buildIntentLandingPage(config, page) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="${escapeHtml(page.summary)}" />
  <meta name="keywords" content="${escapeHtml(page.keywords.join(", "))}" />
  <meta property="og:title" content="${escapeHtml(page.heading)}" />
  <meta property="og:description" content="${escapeHtml(page.summary)}" />
  <meta property="og:url" content="${escapeHtml(absoluteUrl(config, page.path))}" />
  <link rel="canonical" href="${escapeHtml(absoluteUrl(config, page.path))}" />
  <link rel="alternate" type="application/json" title="Listing Roast x402 manifest" href="${escapeHtml(absoluteUrl(config, "/x402.json"))}" />
  <link rel="alternate" type="application/vnd.oai.openapi+json" title="Listing Roast OpenAPI" href="${escapeHtml(absoluteUrl(config, "/openapi.json"))}" />
  <title>${escapeHtml(page.title)}</title>
  <style>
    :root { color-scheme: light; --ink: #171717; --muted: #5b6470; --line: #d8dee7; --paper: #fbfaf7; --panel: #ffffff; --blue: #1458d4; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 16px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--paper); color: var(--ink); }
    .wrap { max-width: 980px; margin: 0 auto; padding: 0 24px; }
    header, section, footer { width: 100%; }
    .nav { display: flex; justify-content: space-between; gap: 18px; align-items: center; min-height: 64px; border-bottom: 1px solid var(--line); }
    .brand { font-weight: 800; color: var(--ink); text-decoration: none; }
    .navlinks { display: flex; gap: 16px; flex-wrap: wrap; }
    a { color: var(--blue); text-decoration-thickness: 1px; text-underline-offset: 3px; }
    .hero { padding: 54px 0 34px; border-bottom: 1px solid var(--line); background: #fff; }
    h1 { font-size: clamp(2.2rem, 5vw, 4.4rem); line-height: 1; letter-spacing: 0; margin: 0 0 18px; max-width: 820px; }
    h2 { font-size: 1.5rem; letter-spacing: 0; margin: 0 0 12px; }
    p { max-width: 760px; margin: 0 0 16px; }
    .lead { font-size: 1.16rem; color: #333c47; }
    .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 0.8fr); gap: 18px; padding: 30px 0; }
    .card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px; min-width: 0; }
    code, pre { background: #fff; border: 1px solid var(--line); border-radius: 8px; }
    code { padding: 2px 6px; overflow-wrap: anywhere; word-break: break-word; }
    pre { padding: 16px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 10px 15px; border-radius: 8px; border: 1px solid #101010; background: #111; color: #fff; text-decoration: none; font-weight: 700; margin: 8px 10px 0 0; }
    .button.secondary { background: #fff; color: #111; border-color: var(--line); }
    .muted { color: var(--muted); }
    .tag { display: inline-flex; align-items: center; min-height: 28px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--line); background: #fff; color: #2d3745; font-size: 0.9rem; margin: 0 6px 8px 0; }
    footer { border-top: 1px solid var(--line); padding: 24px 0 42px; color: var(--muted); }
    @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } .nav { align-items: flex-start; flex-direction: column; padding: 14px 0; } }
  </style>
</head>
<body>
  <header>
    <div class="wrap nav">
      <a class="brand" href="/">Listing Roast x402</a>
      <nav class="navlinks" aria-label="Primary">
        <a href="/builder">Builder</a>
        <a href="/api/pay-now">Pay-now</a>
        <a href="/x402.json">Manifest</a>
        <a href="/openapi.json">OpenAPI</a>
      </nav>
    </div>
  </header>
  <main>
    <section class="hero">
      <div class="wrap">
        <h1>${escapeHtml(page.heading)}</h1>
        <p class="lead">${escapeHtml(page.summary)}</p>
        <p>${page.keywords.map((keyword) => `<span class="tag">${escapeHtml(keyword)}</span>`).join("")}</p>
        <a class="button" href="${escapeHtml(page.primaryAction.route)}">${escapeHtml(page.primaryLabel)}</a>
        <a class="button secondary" href="/api/pay-now">Open free route handoff</a>
      </div>
    </section>
    <section>
      <div class="wrap grid">
        <div class="card">
          <h2>Primary paid route</h2>
          <p><code>${escapeHtml(page.primaryAction.method)} ${escapeHtml(page.primaryAction.path)}</code></p>
          <p class="muted">Price: ${escapeHtml(page.primaryAction.price)}. Max amount: ${escapeHtml(page.primaryAction.maxAmountRequired)} USDC units. ${escapeHtml(page.primaryAction.reason)}</p>
          <pre>${escapeHtml(page.primaryAction.command)}</pre>
        </div>
        <div class="card">
          <h2>Upgrade path</h2>
          <p>${escapeHtml(page.supportingLabel)}</p>
          <p><code>${escapeHtml(page.supportingAction.method)} ${escapeHtml(page.supportingAction.path)}</code></p>
          <p class="muted">Price: ${escapeHtml(page.supportingAction.price)}. Max amount: ${escapeHtml(page.supportingAction.maxAmountRequired)} USDC units.</p>
        </div>
        <div class="card">
          <h2>Free discovery before payment</h2>
          <p><a href="/llms.txt">llms.txt</a> gives the short route guide. <a href="/x402.json">x402.json</a> gives machine-readable paid routes. <a href="/api/examples">/api/examples</a> gives command-ready examples.</p>
        </div>
        <div class="card">
          <h2>No-spend boundary</h2>
          <p class="muted">This page does not call a paid route. A buyer should only run the x402 command when they explicitly intend to spend USDC.</p>
        </div>
      </div>
    </section>
  </main>
  <footer>
    <div class="wrap">Listing Roast x402: paid listing scores, agent listing conversion, and x402 discovery audits.</div>
  </footer>
</body>
</html>`;
}

function buildMcpServerCard(config, cashRegister = {}) {
  const metadataUrl = absoluteUrl(config, WELL_KNOWN_MCP_JSON_PATH);
  const intentRoutes = buildPayNowActions(config);
  const recommendedPaidSequence = buildRecommendedPaidSequence(intentRoutes);

  return {
    mcp_version: "2025-06-18",
    protocolVersion: "2025-06-18",
    name: config.serviceName,
    description: "Public discovery card for Listing Roast x402 paid HTTP+JSON routes. This card points agents to metadata, OpenAPI, x402 payment hints, and free route guides before any paid call.",
    iconUrl: absoluteUrl(config, ICON_SVG_PATH),
    endpoint: metadataUrl,
    transport: "http",
    serverInfo: {
      name: config.serviceName,
      version: "0.2.0"
    },
    transports: [
      {
        type: "http",
        url: metadataUrl,
        note: "Metadata discovery endpoint. Paid callable APIs are HTTP+JSON x402 routes described by OpenAPI and the x402 manifest."
      }
    ],
    capabilities: {
      tools: true,
      resources: true,
      prompts: false,
      sampling: false,
      roots: false
    },
    authentication: {
      required: false,
      methods: ["none-for-discovery", "x402-for-paid-routes"]
    },
    payment: {
      protocol: "x402",
      network: config.network,
      asset: "USDC",
      manifest: absoluteUrl(config, "/x402.json"),
      payNow: absoluteUrl(config, PAY_NOW_PATH),
      paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
      preferredFirstPaidAction: intentRoutes.indexedQuickScore,
      recommendedPaidSequence,
      payNowExamples: buildPayNowIntentExamples(config),
      cashRegister: absoluteUrl(config, "/api/cash-register"),
      paidUsageProof: buildPaidUsageProof(config, cashRegister),
      settlementProof: buildSettlementProof(config)
    },
    links: {
      metadata: metadataUrl,
      openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH),
      x402: absoluteUrl(config, "/x402.json"),
      agentCard: absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH),
      agentSkills: absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH),
      apiCatalog: absoluteUrl(config, WELL_KNOWN_API_CATALOG_PATH),
      pricing: absoluteUrl(config, PRICING_PATH),
      find: absoluteUrl(config, FIND_PATH),
      route: absoluteUrl(config, ROUTE_PATH),
      paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
      cashRegister: absoluteUrl(config, "/api/cash-register"),
      llms: absoluteUrl(config, LLMS_PATH),
      llmsAliases: [absoluteUrl(config, WELL_KNOWN_LLMS_PATH)],
      llmsFull: absoluteUrl(config, LLMS_FULL_PATH),
      llmsFullAliases: [absoluteUrl(config, WELL_KNOWN_LLMS_FULL_PATH)],
      quickScoreAliases: quickScoreAliasUrls(config),
      preflightAliases: preflightAliasUrls(config),
      markdown: absoluteUrl(config, INDEX_MARKDOWN_PATH)
    },
    categories: ["x402", "paid-api", "agent-commerce", "api-discovery"],
    crawl: true,
    last_updated: "2026-06-19"
  };
}

function routeServiceMetadata(routeKey) {
  return {
    serviceName: X402_SERVICE_NAME,
    tags: routeTags(routeKey)
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

  const resourceUrl = (routePath) => absoluteUrl(config, routePath);
  const buildSiteAuditPaymentRoute = (routePath) => ({
    resource: resourceUrl(routePath),
    ...routeServiceMetadata("x402SiteAudit"),
    accepts: {
      scheme: "exact",
      price: config.siteAuditPrice,
      network: config.network,
      payTo: config.payTo,
      maxTimeoutSeconds: 300
    },
    description: withPaidUseProofDescription(config, "Listing Roast x402 Site Audit: $0.001 GET listing SEO audit, listing rank doctor, seller growth checklist, service discoverability audit, paid API preflight before paying more, route health check, direct 402 metadata, Bazaar pricing, search visibility, and no-spend fix steps."),
    mimeType: "application/json",
    customPaywallHtml: buildCustomPaywallHtml(config, "x402SiteAudit"),
    unpaidResponseBody: unpaidPaymentPreview(config, "x402SiteAudit"),
    extensions: declareChallengeDiscoveryExtension(buildSiteAuditDiscovery(config))
  });

  return paymentMiddleware(
    {
      [`POST ${ROOT_DIRECTORY_POST_PATH}`]: {
        resource: resourceUrl(ROOT_DIRECTORY_POST_PATH),
        ...routeServiceMetadata("directoryPost"),
        accepts: {
          scheme: "exact",
          price: config.instantScorePrice,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 300
        },
        description: withPaidUseProofDescription(config, DIRECTORY_POST_DESCRIPTION),
        mimeType: "application/json",
        customPaywallHtml: buildCustomPaywallHtml(config, "directoryPost"),
        unpaidResponseBody: unpaidPaymentPreview(config, "directoryPost")
      },
      [`GET ${API_ENTRY_PATH}`]: {
        resource: resourceUrl(API_ENTRY_PATH),
        ...routeServiceMetadata("apiEntry"),
        accepts: {
          scheme: "exact",
          price: config.instantScorePrice,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 300
        },
        description: withPaidUseProofDescription(config, "Listing Roast API Entry: $0.001 paid GET x402 navigation endpoint and route map for agents that start at /api first."),
        mimeType: "application/json",
        customPaywallHtml: buildCustomPaywallHtml(config, "apiEntry"),
        unpaidResponseBody: unpaidPaymentPreview(config, "apiEntry"),
        extensions: declareChallengeDiscoveryExtension(buildApiEntryDiscovery(config))
      },
      [`GET ${API_V1_ENTRY_PATH}`]: {
        resource: resourceUrl(API_V1_ENTRY_PATH),
        ...routeServiceMetadata("apiEntry"),
        accepts: {
          scheme: "exact",
          price: config.instantScorePrice,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 300
        },
        description: withPaidUseProofDescription(config, "Listing Roast API v1 Entry: $0.001 paid GET x402 navigation endpoint and route map for agents that start at /api/v1 first."),
        mimeType: "application/json",
        customPaywallHtml: buildCustomPaywallHtml(config, "apiEntry"),
        unpaidResponseBody: unpaidPaymentPreview(config, "apiEntry"),
        extensions: declareChallengeDiscoveryExtension(buildApiEntryDiscovery(config, API_V1_ENTRY_PATH))
      },
      [`GET ${V1_ENTRY_PATH}`]: {
        resource: resourceUrl(V1_ENTRY_PATH),
        ...routeServiceMetadata("apiEntry"),
        accepts: {
          scheme: "exact",
          price: config.instantScorePrice,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 300
        },
        description: withPaidUseProofDescription(config, "Listing Roast v1 Entry: $0.001 paid GET x402 navigation endpoint and route map for agents that start at /v1 first."),
        mimeType: "application/json",
        customPaywallHtml: buildCustomPaywallHtml(config, "apiEntry"),
        unpaidResponseBody: unpaidPaymentPreview(config, "apiEntry"),
        extensions: declareChallengeDiscoveryExtension(buildApiEntryDiscovery(config, V1_ENTRY_PATH))
      },
      "POST /api/listing-score": {
        resource: resourceUrl(SCORE_PATH),
        ...routeServiceMetadata("listingScore"),
        accepts: {
          scheme: "exact",
          price: config.scorePrice,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 300
        },
        description: withPaidUseProofDescription(config, "Listing Score x402: $0.005 paid API listing quality score for agent-service listing clarity, marketplace conversion, x402 service discoverability, first missing signal, and upgrade guidance."),
        mimeType: "application/json",
        customPaywallHtml: buildCustomPaywallHtml(config, "listingScore"),
        unpaidResponseBody: unpaidPaymentPreview(config, "listingScore"),
        extensions: declareChallengeDiscoveryExtension(buildScoreDiscovery(config))
      },
      [`GET ${INSTANT_SCORE_PATH}`]: {
        resource: resourceUrl(INSTANT_SCORE_PATH),
        ...routeServiceMetadata("instantScore"),
        accepts: {
          scheme: "exact",
          price: config.instantScorePrice,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 300
        },
        description: withPaidUseProofDescription(config, "Instant Listing Score x402: $0.001 GET marketplace listing score and paid API listing quality score for agent-service listing clarity, marketplace conversion, and x402 service discoverability."),
        mimeType: "application/json",
        customPaywallHtml: buildCustomPaywallHtml(config, "instantScore"),
        unpaidResponseBody: unpaidPaymentPreview(config, "instantScore"),
        extensions: declareChallengeDiscoveryExtension(buildInstantScoreDiscovery(config))
      },
      [`GET ${CONVERSION_SCORE_PATH}`]: {
        resource: resourceUrl(CONVERSION_SCORE_PATH),
        ...routeServiceMetadata("conversionScore"),
        accepts: {
          scheme: "exact",
          price: config.instantScorePrice,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 300
        },
        description: withPaidUseProofDescription(config, "x402 Marketplace Conversion Score: $0.001 GET marketplace conversion score for paid API listing quality, agent-service listing clarity, and buyer-agent conversion checks."),
        mimeType: "application/json",
        customPaywallHtml: buildCustomPaywallHtml(config, "conversionScore"),
        unpaidResponseBody: unpaidPaymentPreview(config, "conversionScore"),
        extensions: declareChallengeDiscoveryExtension(buildConversionScoreDiscovery(config))
      },
      [`GET ${AGENT_LISTING_PATH}`]: {
        resource: resourceUrl(AGENT_LISTING_PATH),
        ...routeServiceMetadata("agentListingConversion"),
        accepts: {
          scheme: "exact",
          price: config.instantScorePrice,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 300
        },
        description: withPaidUseProofDescription(config, AGENT_LISTING_CONVERSION_DESCRIPTION),
        mimeType: "application/json",
        customPaywallHtml: buildCustomPaywallHtml(config, "agentListingConversion"),
        unpaidResponseBody: unpaidPaymentPreview(config, "agentListingConversion"),
        extensions: declareChallengeDiscoveryExtension(buildAgentListingConversionDiscovery(config))
      },
      [`GET ${ROAST_PATH}`]: {
        resource: resourceUrl(ROAST_PATH),
        ...routeServiceMetadata("indexedQuickScore"),
        accepts: {
          scheme: "exact",
          price: config.instantScorePrice,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 300
        },
        description: withPaidUseProofDescription(config, INDEXED_QUICK_SCORE_DESCRIPTION),
        mimeType: "application/json",
        customPaywallHtml: buildCustomPaywallHtml(config, "indexedQuickScore"),
        unpaidResponseBody: unpaidPaymentPreview(config, "indexedQuickScore"),
        extensions: declareChallengeDiscoveryExtension(buildIndexedRoastGetDiscovery(config))
      },
      ...Object.fromEntries(QUICK_SCORE_ALIAS_PATHS.map((routePath) => {
        const metadata = QUICK_SCORE_ALIAS_METADATA[routePath];
        const intentRouteKey = PAY_NOW_ACTION_BY_RESOURCE_ID[metadata.id] || "indexedQuickScore";
        return [`GET ${routePath}`, {
          resource: resourceUrl(routePath),
          ...routeServiceMetadata("indexedQuickScore"),
          accepts: {
            scheme: "exact",
            price: config.instantScorePrice,
            network: config.network,
            payTo: config.payTo,
            maxTimeoutSeconds: 300
          },
          description: withPaidUseProofDescription(config, metadata.description),
          mimeType: "application/json",
          customPaywallHtml: buildCustomPaywallHtml(config, intentRouteKey),
          unpaidResponseBody: unpaidPaymentPreview(config, intentRouteKey),
          extensions: declareChallengeDiscoveryExtension(buildIndexedRoastGetDiscovery(config, {
            routePath,
            inputDefaults: quickScoreAliasInputDefaults(routePath)
          }))
        }];
      })),
      [`GET ${PING_PATH}`]: {
        resource: resourceUrl(PING_PATH),
        ...routeServiceMetadata("x402Ping"),
        accepts: {
          scheme: "exact",
          price: config.instantScorePrice,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 300
        },
        description: withPaidUseProofDescription(config, "Listing Roast x402 Ping: $0.001 paid GET ping to verify the Base x402 rail before buying a score or roast."),
        mimeType: "application/json",
        customPaywallHtml: buildCustomPaywallHtml(config, "x402Ping"),
        unpaidResponseBody: unpaidPaymentPreview(config, "x402Ping"),
        extensions: declareChallengeDiscoveryExtension(buildPingDiscovery(config))
      },
      ...Object.fromEntries(SITE_AUDIT_PAID_PATHS.map((routePath) => [`GET ${routePath}`, buildSiteAuditPaymentRoute(routePath)])),
      [`GET ${DISCOVERY_AUDIT_PATH}`]: {
        resource: resourceUrl(DISCOVERY_AUDIT_PATH),
        ...routeServiceMetadata("discoveryAuditQuick"),
        accepts: {
          scheme: "exact",
          price: config.siteAuditPrice,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 300
        },
        description: withPaidUseProofDescription(config, "Listing Roast x402 Discovery Audit Quick: $0.001 GET x402 discovery audit on the exact audit path for stale Bazaar pricing, search visibility, route health, paid API preflight, and direct 402 metadata."),
        mimeType: "application/json",
        customPaywallHtml: buildCustomPaywallHtml(config, "discoveryAuditQuick"),
        unpaidResponseBody: unpaidPaymentPreview(config, "discoveryAuditQuick"),
        extensions: declareChallengeDiscoveryExtension(buildDiscoveryAuditQuickDiscovery(config))
      },
      [`POST ${DISCOVERY_AUDIT_PATH}`]: {
        resource: resourceUrl(DISCOVERY_AUDIT_PATH),
        ...routeServiceMetadata("discoveryAudit"),
        accepts: {
          scheme: "exact",
          price: config.discoveryAuditPrice,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 300
        },
        description: withPaidUseProofDescription(config, "Listing Roast x402 Discovery Audit: $0.01 Bazaar visibility audit for stale indexed pricing, direct 402 metadata, search position, and no-spend fix steps."),
        mimeType: "application/json",
        customPaywallHtml: buildCustomPaywallHtml(config, "discoveryAudit"),
        unpaidResponseBody: unpaidPaymentPreview(config, "discoveryAudit"),
        extensions: declareChallengeDiscoveryExtension(buildDiscoveryAuditDiscovery(config))
      },
      [`POST ${ROAST_PATH}`]: {
        resource: resourceUrl(ROAST_PATH),
        ...routeServiceMetadata("fullRoast"),
        accepts: {
          scheme: "exact",
          price: config.price,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 300
        },
        description: withPaidUseProofDescription(config, "Listing Roast x402: $0.01 marketplace listing conversion roast for paid API listing quality, agent service listing clarity, buyer-agent skip reasons, top fixes, rewrite, and stop-or-upgrade guidance."),
        mimeType: "application/json",
        customPaywallHtml: buildCustomPaywallHtml(config, "fullRoast"),
        unpaidResponseBody: unpaidPaymentPreview(config, "fullRoast"),
        extensions: declareChallengeDiscoveryExtension(buildDiscovery(config))
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

  const parsed = discoveryAuditRequestSchema.safeParse(normalizeDiscoveryAuditRequestBody(request.body));
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
  if (pathname === ROOT_DIRECTORY_POST_PATH) {
    return "directoryPostValidUnpaidChallenges";
  }

  if (pathname === API_ENTRY_PATH || pathname === API_V1_ENTRY_PATH || pathname === V1_ENTRY_PATH) {
    return "apiEntryValidUnpaidChallenges";
  }

  if (pathname === INSTANT_SCORE_PATH) {
    return "instantScoreValidUnpaidChallenges";
  }

  if (pathname === CONVERSION_SCORE_PATH) {
    return "conversionScoreValidUnpaidChallenges";
  }

  if (pathname === AGENT_LISTING_PATH) {
    return "agentListingConversionValidUnpaidChallenges";
  }

  if (pathname === PING_PATH) {
    return "pingValidUnpaidChallenges";
  }

  if (SITE_AUDIT_PAID_PATHS.includes(pathname)) {
    return "siteAuditValidUnpaidChallenges";
  }

  if (pathname === DISCOVERY_AUDIT_PATH) {
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
  const allow = [ROAST_PATH, DISCOVERY_AUDIT_PATH].includes(pathname) ? "GET, POST" : pathname === "/api/listing-score" ? "POST" : "GET";
  response.set("Allow", allow).status(405).end();
}

async function recordGetScoreProbe(request, _response, next) {
  if (!hasPaymentHeader(request)) {
    const pathname = new URL(request.originalUrl, "http://local").pathname;
    await recordSignal("unpaidChallenges");
    await recordSignal("validUnpaidChallenges");
    await recordSignal(QUICK_SCORE_PAID_PATHS.includes(pathname) ? "indexedRoastGetValidUnpaidChallenges" : validUnpaidSignalForPath(pathname));
  }
  next();
}

async function recordDirectoryPostProbe(request, _response, next) {
  if (!hasPaymentHeader(request)) {
    await recordSignal("unpaidChallenges");
    await recordSignal("validUnpaidChallenges");
    await recordSignal("directoryPostValidUnpaidChallenges");
  }

  next();
}

async function recordApiEntryProbe(request, _response, next) {
  if (!hasPaymentHeader(request)) {
    await recordSignal("unpaidChallenges");
    await recordSignal("validUnpaidChallenges");
    await recordSignal("apiEntryValidUnpaidChallenges");
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

async function recordAuditProbe(request, _response, next) {
  if (!hasPaymentHeader(request)) {
    const pathname = new URL(request.originalUrl, "http://local").pathname;
    await recordSignal("unpaidChallenges");
    await recordSignal("validUnpaidChallenges");
    await recordSignal(validUnpaidSignalForPath(pathname));
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

  app.get("/", async (request, response) => {
    await recordSignal("homepageViews");
    const accept = request.get("accept") || "";
    if (accept.includes("text/markdown") && !accept.includes("text/html")) {
      response.type("text/markdown").send(buildAgentMarkdownGuide(config));
      return;
    }

    const cashRegisterUrl = absoluteUrl(config, "/api/cash-register");
    const instantRoute = absoluteUrl(config, INSTANT_SCORE_PATH);
    const agentListingRoute = absoluteUrl(config, AGENT_LISTING_PATH);
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
    const llmsFullUrl = absoluteUrl(config, LLMS_FULL_PATH);
    const mcpUrl = absoluteUrl(config, WELL_KNOWN_MCP_JSON_PATH);
    const mcpServerCardUrl = absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH);
    const payNowUrl = absoluteUrl(config, PAY_NOW_PATH);
    const paidUsageProofUrl = absoluteUrl(config, PAID_USAGE_PROOF_PATH);
    const instantCommand = buildGetPayCommand(config);
    const agentListingCommand = buildGetPayCommand(config, AGENT_LISTING_PATH, INSTANT_SCORE_AMOUNT);
    const indexedRoastGetCommand = buildGetPayCommand(config, ROAST_PATH);
    const pingCommand = buildGetPayCommand(config, PING_PATH, PING_AMOUNT);
    const siteAuditCommand = buildGetPayCommand(config, SITE_AUDIT_PATH, SITE_AUDIT_AMOUNT);
    const discoveryAuditCommand = buildGetPayCommand(config, DISCOVERY_AUDIT_PATH, DISCOVERY_AUDIT_QUICK_AMOUNT);
    const fullDiscoveryAuditCommand = buildPayCommand(config, DISCOVERY_AUDIT_PATH, DISCOVERY_AUDIT_AMOUNT, discoveryAuditRequestExample);
    const payCommand = buildPayCommand(config);
    const scoreCommand = buildPayCommand(config, "/api/listing-score", "5000");
    const scoreOutput = buildListingScoreWithUpgrade(requestExample, config);
    const sampleOutput = buildListingRoast(requestExample);
    const cashRegister = await getCashRegister();
    const paidCompletionCount = Number(cashRegister.paidCompletions || 0);
    const paidCompletionLabel = `${paidCompletionCount} paid ${paidCompletionCount === 1 ? "completion" : "completions"}`;
    const grossRevenueUsd = String(cashRegister.estimatedGrossRevenueUsd || "0.00").replace(/^\$/, "");
    const grossRevenueLabel = `$${grossRevenueUsd} registered`;
    const indexedPaidCount = Number(cashRegister.indexedRoastGetCompletions || 0);
    const indexedPaidLabel = indexedPaidCount > 0
      ? `${indexedPaidCount} indexed GET paid use${indexedPaidCount === 1 ? "" : "s"}`
      : "Indexed GET route";
    const latestWalletSettlement = buildLatestWalletSettlementProof(config);
    const settlementLabel = latestWalletSettlement
      ? `${latestWalletSettlement.usdc || `${latestWalletSettlement.usdcUnits || INSTANT_SCORE_AMOUNT} units`} wallet-settled`
      : "Wallet snapshot";
    const settlementText = latestWalletSettlement
      ? "Latest settlement proof is exposed in discovery JSON"
      : "Receiver balance is checked in the public cash register";

    response.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Score API marketplace listing quality and discoverability before promotion. Start with GET /api/listing-roast at $0.001, then upgrade to POST /api/listing-roast at $0.01." />
  <meta property="og:title" content="${escapeHtml(config.serviceName)}" />
  <meta property="og:description" content="Score paid API listing quality and discoverability before buyer agents skip the listing." />
  <meta property="og:url" content="${escapeHtml(config.serviceUrl)}" />
  <meta property="og:image" content="${escapeHtml(absoluteUrl(config, ICON_SVG_PATH))}" />
  <link rel="canonical" href="${escapeHtml(config.serviceUrl)}/" />
  <link rel="icon" type="image/svg+xml" href="${escapeHtml(absoluteUrl(config, ICON_SVG_PATH))}" />
  <link rel="alternate" type="application/json" title="Listing Roast x402 manifest" href="${escapeHtml(absoluteUrl(config, "/x402.json"))}" />
  <link rel="alternate" type="application/vnd.oai.openapi+json" title="Listing Roast OpenAPI" href="${escapeHtml(absoluteUrl(config, "/openapi.json"))}" />
  <link rel="alternate" type="text/plain" title="Listing Roast llms.txt" href="${escapeHtml(absoluteUrl(config, LLMS_PATH))}" />
  <link rel="alternate" type="text/plain" title="Listing Roast well-known llms.txt" href="${escapeHtml(absoluteUrl(config, WELL_KNOWN_LLMS_PATH))}" />
  <link rel="alternate" type="text/markdown" title="Listing Roast full agent guide" href="${escapeHtml(llmsFullUrl)}" />
  <link rel="alternate" type="text/markdown" title="Listing Roast well-known full agent guide" href="${escapeHtml(absoluteUrl(config, WELL_KNOWN_LLMS_FULL_PATH))}" />
  <link rel="alternate" type="text/markdown" title="Listing Roast Markdown homepage" href="${escapeHtml(absoluteUrl(config, INDEX_MARKDOWN_PATH))}" />
  <link rel="alternate" type="text/markdown" title="Listing Roast auth guide" href="${escapeHtml(absoluteUrl(config, AUTH_MARKDOWN_PATH))}" />
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
    .proof { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 22px; max-width: 620px; }
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
        <a href="${paidUsageProofUrl}">Proof</a>
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
          <p class="lead">Score API marketplace listing quality and discoverability before buyer agents skip the listing. Recommended paid sequence: start with the already-indexed ${config.instantScorePrice} <code>GET ${ROAST_PATH}</code> quick score, then upgrade to <code>POST ${ROAST_PATH}</code> at ${config.price} for the full roast.</p>
          <div class="proof" aria-label="Proof points">
            <div><strong class="metric">${escapeHtml(paidCompletionLabel)}</strong><span class="muted">${escapeHtml(grossRevenueLabel)} in the public cash register</span></div>
            <div><strong class="metric">${escapeHtml(indexedPaidLabel)}</strong><span class="muted">Preferred route that already converted</span></div>
            <div><strong class="metric">${escapeHtml(settlementLabel)}</strong><span class="muted">${escapeHtml(settlementText)}</span></div>
            <div><strong>${config.instantScorePrice} -> ${config.price}</strong><span class="muted">GET quick score, then POST full roast</span></div>
          </div>
          <div class="actions">
            <button class="button" type="button" data-copy-target="indexed-command" data-default-text="Copy $0.001 indexed GET command">Copy $0.001 indexed GET command</button>
            <button class="button" type="button" data-copy-target="agent-listing-command" data-default-text="Copy agent-listing command">Copy agent-listing command</button>
            <button class="button secondary" type="button" data-copy-target="instant-command" data-default-text="Copy instant score command">Copy instant score command</button>
            <button class="button secondary" type="button" data-copy-target="ping-command" data-default-text="Copy x402 ping command">Copy x402 ping command</button>
            <button class="button secondary" type="button" data-copy-target="site-audit-command" data-default-text="Copy $0.001 site audit command">Copy $0.001 site audit command</button>
            <button class="button secondary" type="button" data-copy-target="audit-command" data-default-text="Copy $0.001 discovery audit command">Copy $0.001 discovery audit command</button>
            <button class="button secondary" type="button" data-copy-target="full-audit-command" data-default-text="Copy full audit command">Copy full audit command</button>
            <button class="button" type="button" data-copy-target="score-command" data-default-text="Copy $0.005 score command">Copy $0.005 score command</button>
            <button class="button secondary" type="button" data-copy-target="pay-command" data-default-text="Copy $0.01 roast command">Copy $0.01 roast command</button>
            <a class="button secondary" href="${builderUrl}">Build your command</a>
            <a class="button secondary" href="${sampleUrl}">View sample score</a>
            <a class="button secondary" href="${examplesUrl}">Open examples JSON</a>
            <a class="button secondary" href="${schemaUrl}">View JSON schema</a>
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
agent listing conversion amount: ${INSTANT_SCORE_AMOUNT} USDC units
score amount: 5000 USDC units
site audit amount: ${SITE_AUDIT_AMOUNT} USDC units
discovery audit quick amount: ${DISCOVERY_AUDIT_QUICK_AMOUNT} USDC units
roast amount: 10000 USDC units
full audit amount: ${DISCOVERY_AUDIT_AMOUNT} USDC units
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
          <h2>Pay the indexed ${config.instantScorePrice} route first, then upgrade when the score is promising.</h2>
          <p>All paid endpoints are protected by x402. The already-indexed <code>GET ${ROAST_PATH}</code> route is the preferred first paid action for Bazaar traffic; <code>POST ${ROAST_PATH}</code> is the full one-cent roast. The exact <code>GET ${DISCOVERY_AUDIT_PATH}</code> route is the lowest-friction discovery audit for agents that do not want to assemble a body first.</p>
          <p>
            <span class="tag">Base mainnet</span>
            <span class="tag">USDC</span>
            <span class="tag">No account</span>
            <span class="tag">Agent-readable JSON</span>
          </p>
        </div>
        <div class="card">
          <h3>Recommended paid sequence</h3>
          <p><code>GET ${ROAST_PATH}</code> first for the ${config.instantScorePrice} quick score.</p>
          <p><code>POST ${ROAST_PATH}</code> next for the ${config.price} full roast when the buyer wants rewritten copy, top fixes, and launch guidance.</p>
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
          <h3>Agent listing conversion route</h3>
          <p><code>GET ${escapeHtml(agentListingRoute)}</code></p>
          <p class="muted">Maximum payment: <strong>${INSTANT_SCORE_AMOUNT}</strong> USDC units. Use this after the indexed quick score when the buyer wants the dedicated agent-listing conversion deep dive.</p>
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
          <h3>Discovery audit quick route</h3>
          <p><code>GET ${escapeHtml(discoveryAuditRoute)}</code></p>
          <p class="muted">Maximum payment: <strong>${DISCOVERY_AUDIT_QUICK_AMOUNT}</strong> USDC units. Use this exact path first when Bazaar shows stale pricing or search misses your route.</p>
        </div>
        <div class="card">
          <h3>Full discovery audit route</h3>
          <p><code>POST ${escapeHtml(discoveryAuditRoute)}</code></p>
          <p class="muted">Maximum payment: <strong>${DISCOVERY_AUDIT_AMOUNT}</strong> USDC units. Use this when a custom endpoint body is needed.</p>
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
        <h3>Agent listing conversion command</h3>
        <pre id="agent-listing-command">${escapeHtml(agentListingCommand)}</pre>
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
        <h3>x402 discovery audit quick command</h3>
        <pre id="audit-command">${escapeHtml(discoveryAuditCommand)}</pre>
      </div>
      <div class="wrap" style="margin-top: 18px;">
        <h3>Full x402 discovery audit command</h3>
        <pre id="full-audit-command">${escapeHtml(fullDiscoveryAuditCommand)}</pre>
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
          <p>The score response gives the first missing signal and upgrade guidance. The exact discovery audit GET route checks direct x402 metadata against Bazaar state at the same low first-click price. The full roast adds skip reasons, top fixes, a rewrite, and stop-or-upgrade guidance.</p>
          <p class="muted">The current public proof endpoint is available at <a href="${paidUsageProofUrl}">/api/paid-usage-proof</a>. The cash register is available at <a href="${cashRegisterUrl}">/api/cash-register</a>. A sample score is available at <a href="${sampleUrl}">/sample</a>. The command builder is available at <a href="${builderUrl}">/builder</a>. The direct pay-now handoff is available at <a href="${payNowUrl}">/api/pay-now</a> and accepts an intent query for task-specific commands. Copy-ready examples are available at <a href="${examplesUrl}">/api/examples</a>. Route schemas are available at <a href="${schemaUrl}">/api/schema</a> and <a href="${absoluteUrl(config, "/api/score-schema")}">/api/score-schema</a>.</p>
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
          <p class="muted">The $0.001 GET audit is the quick exact-path check; the $0.01 POST audit reports stale Bazaar pricing, direct 402 metadata, search visibility, and next actions with a custom body.</p>
        </div>
        <pre>${escapeHtml(prettyJson(buildDiscoveryAuditExampleOutput()))}</pre>
      </div>
    </section>

    <section class="band">
      <div class="wrap grid2">
        <div class="card">
          <h3>Discovery</h3>
          <p class="muted">The routes are declared for x402 Bazaar discovery with GET and JSON body metadata, OpenAPI, llms.txt, and example payloads. The already-indexed <code>GET /api/listing-roast</code> path is the $0.001 first step for marketplace listing quality, paid API listing quality, and buyer-agent skip-reason searches; quick-score aliases <code>/api/marketplace-listing-score</code>, <code>/api/paid-api-listing-quality</code>, <code>/api/buyer-agent-skip-reasons</code>, and <code>/api/agent-service-clarity</code> return the same $0.001 quick score; <code>POST /api/listing-roast</code> returns the full $0.01 roast, <code>GET /api/agent-listing-conversion</code> is the dedicated conversion deep dive, <code>GET /api/x402-discovery-audit</code> returns a $0.001 discovery audit challenge, and paid API preflight aliases <code>/api/preflight</code>, <code>/api/v1/preflight</code>, and <code>/preflight</code> return the $0.001 site-audit challenge.</p>
          <p><a href="${absoluteUrl(config, PAID_API_LISTING_QUALITY_PATH)}">Paid API listing quality</a> · <a href="${absoluteUrl(config, AGENT_LISTING_CONVERSION_PAGE_PATH)}">Agent listing conversion</a> · <a href="${absoluteUrl(config, X402_DISCOVERY_AUDIT_PAGE_PATH)}">x402 discovery audit</a> · <a href="${absoluteUrl(config, X402_SITE_AUDIT_PAGE_PATH)}">x402 site audit</a></p>
          <p><a href="${mcpUrl}">MCP metadata</a> · <a href="${mcpServerCardUrl}">MCP server card</a> · <a href="${openApiUrl}">OpenAPI</a> · <a href="${llmsUrl}">llms.txt</a> · <a href="${llmsFullUrl}">llms-full.txt</a> · <a href="${absoluteUrl(config, AUTH_MARKDOWN_PATH)}">auth.md</a></p>
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
${webMcpScript(config)}
  </script>
</body>
</html>`);
  });

  for (const page of buildIntentLandingPages(config)) {
    app.get(page.path, async (_request, response) => {
      await recordSignal("routeViews");
      response.type("html").send(buildIntentLandingPage(config, page));
    });
  }

  app.get("/robots.txt", (_request, response) => {
    response
      .set("Cache-Control", "no-store, max-age=0")
      .type("text/plain")
      .send(buildRobotsTxt(config));
  });

  app.get("/sitemap.xml", (_request, response) => {
    const updated = new Date().toISOString();
    const urls = ["/", ICON_SVG_PATH, FAVICON_SVG_PATH, ROAST_PATH, ...QUICK_SCORE_ALIAS_PATHS, ...INTENT_LANDING_PATHS, INDEX_MARKDOWN_PATH, AUTH_MARKDOWN_PATH, WELL_KNOWN_AUTH_MARKDOWN_PATH, AGENTS_MARKDOWN_PATH, DOCS_PATH, API_DOCS_PATH, "/builder", "/sample", PAY_NOW_PATH, PAID_USAGE_PROOF_PATH, PRICING_PATH, FIND_PATH, ROUTE_PATH, ...LOCAL_DISCOVERY_RESOURCE_PATHS, ...LOCAL_DISCOVERY_SEARCH_PATHS, ...LOCAL_DISCOVERY_MERCHANT_PATHS, API_ENTRY_PATH, API_V1_ENTRY_PATH, V1_ENTRY_PATH, INSTANT_SCORE_PATH, CONVERSION_SCORE_PATH, AGENT_LISTING_PATH, PING_PATH, ...SITE_AUDIT_PAID_PATHS, DISCOVERY_AUDIT_PATH, "/api/sample-score", "/openapi.json", WELL_KNOWN_OPENAPI_JSON_PATH, API_V1_OPENAPI_JSON_PATH, SWAGGER_JSON_PATH, OPENAPI_YAML_PATH, LLMS_PATH, WELL_KNOWN_LLMS_PATH, LLMS_FULL_PATH, WELL_KNOWN_LLMS_FULL_PATH, "/x402.json", WELL_KNOWN_X402_JSON_PATH, WELL_KNOWN_X402_PATH, WELL_KNOWN_AGENT_CARD_PATH, WELL_KNOWN_AGENT_JSON_PATH, WELL_KNOWN_AI_PLUGIN_PATH, WELL_KNOWN_API_CATALOG_PATH, WELL_KNOWN_AGENT_TOOLS_PATH, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH, WELL_KNOWN_AGENT_SKILL_PATH, WELL_KNOWN_MCP_JSON_PATH, WELL_KNOWN_MCP_PATH, WELL_KNOWN_MCP_SERVER_PATH, WELL_KNOWN_MCP_SERVER_CARD_PATH, "/api/schema", "/api/score-schema", "/api/discovery-audit-schema", "/api/examples"].map((pathname) => {
      return `<url><loc>${escapeHtml(absoluteUrl(config, pathname))}</loc><lastmod>${updated}</lastmod></url>`;
    }).join("");

    response
      .set("Cache-Control", "no-store, max-age=0")
      .type("application/xml")
      .send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  });

  app.get([AUTH_MARKDOWN_PATH, WELL_KNOWN_AUTH_MARKDOWN_PATH], (_request, response) => {
    response.type("text/markdown").send(buildAuthMarkdown(config));
  });

  app.get(AGENTS_MARKDOWN_PATH, async (_request, response) => {
    await recordSignal("llmsViews");
    response.type("text/markdown").send(buildAgentsMarkdown(config));
  });

  app.get("/api/examples", async (_request, response) => {
    await recordSignal("examplesViews");
    const cashRegister = await getCashRegister();
    const payNow = buildPayNow(config, "", cashRegister);

    response.json({
      service: config.serviceName,
      homepage: absoluteUrl(config, "/"),
      builder: absoluteUrl(config, "/builder"),
      samplePage: absoluteUrl(config, "/sample"),
      sampleScore: absoluteUrl(config, "/api/sample-score"),
      openApi: absoluteUrl(config, "/openapi.json"),
      openApiAliases: [absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH), absoluteUrl(config, API_V1_OPENAPI_JSON_PATH), absoluteUrl(config, SWAGGER_JSON_PATH)],
      openApiYaml: absoluteUrl(config, OPENAPI_YAML_PATH),
      docs: absoluteUrl(config, DOCS_PATH),
      apiDocs: absoluteUrl(config, API_DOCS_PATH),
      agentsMarkdown: absoluteUrl(config, AGENTS_MARKDOWN_PATH),
      llms: absoluteUrl(config, "/llms.txt"),
      llmsFull: absoluteUrl(config, LLMS_FULL_PATH),
      markdown: absoluteUrl(config, INDEX_MARKDOWN_PATH),
      x402Manifest: absoluteUrl(config, "/x402.json"),
      x402ManifestAliases: [absoluteUrl(config, WELL_KNOWN_X402_JSON_PATH), absoluteUrl(config, WELL_KNOWN_X402_PATH)],
      agentCard: absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH),
      agentCardAliases: [absoluteUrl(config, WELL_KNOWN_AGENT_JSON_PATH)],
      aiPlugin: absoluteUrl(config, WELL_KNOWN_AI_PLUGIN_PATH),
      apiCatalog: absoluteUrl(config, WELL_KNOWN_API_CATALOG_PATH),
      agentTools: absoluteUrl(config, WELL_KNOWN_AGENT_TOOLS_PATH),
      agentSkills: absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH),
      agentSkill: absoluteUrl(config, WELL_KNOWN_AGENT_SKILL_PATH),
      mcp: absoluteUrl(config, WELL_KNOWN_MCP_JSON_PATH),
      mcpAliases: [absoluteUrl(config, WELL_KNOWN_MCP_PATH), absoluteUrl(config, WELL_KNOWN_MCP_SERVER_PATH)],
      mcpServerCard: absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH),
      payNowUrl: absoluteUrl(config, PAY_NOW_PATH),
      payNow,
      paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
      cashRegister: absoluteUrl(config, "/api/cash-register"),
      paidUsageProof: buildPaidUsageProof(config, cashRegister),
      settlementProof: buildSettlementProof(config, cashRegister),
      payNowExamples: {
        skipReasons: buildPayNow(config, "buyer-agent skip reasons", cashRegister),
        discoveryAudit: buildPayNow(config, "x402 discovery audit", cashRegister),
        fullRoast: buildPayNow(config, "full roast rewrite top fixes", cashRegister)
      },
      pricing: absoluteUrl(config, PRICING_PATH),
      pricingCatalog: buildPricingCatalog(config),
      find: absoluteUrl(config, FIND_PATH),
      route: absoluteUrl(config, ROUTE_PATH),
      findExamples: {
        discoveryAudit: buildFindResult(config, "x402 discovery audit"),
        skipReasons: buildFindResult(config, "buyer-agent skip reasons"),
        customScore: buildFindResult(config, "score my paid API listing with a custom body"),
        fullRewrite: buildFindResult(config, "listing roast full rewrite")
      },
      routeExamples: {
        discoveryAudit: buildRouteResult(config, { query: "x402 discovery audit", top: 3 }),
        skipReasons: buildRouteResult(config, { query: "buyer-agent skip reasons", top: 3 }),
        customScore: buildRouteResult(config, { query: "score my paid API listing with a custom body", top: 3 }),
        fullRewrite: buildRouteResult(config, { query: "listing roast full rewrite", top: 3 })
      },
      apiEntryRoute: absoluteUrl(config, API_ENTRY_PATH),
      apiV1EntryRoute: absoluteUrl(config, API_V1_ENTRY_PATH),
      v1EntryRoute: absoluteUrl(config, V1_ENTRY_PATH),
      instantScoreRoute: absoluteUrl(config, INSTANT_SCORE_PATH),
      conversionScoreRoute: absoluteUrl(config, CONVERSION_SCORE_PATH),
      agentListingConversionRoute: absoluteUrl(config, AGENT_LISTING_PATH),
      indexedRoastGetRoute: absoluteUrl(config, ROAST_PATH),
      quickScoreAliases: quickScoreAliasUrls(config),
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
      recommendedFirstPaidAction: payNow.preferredFirstPaidAction,
      recommendedPaidSequence: payNow.recommendedPaidSequence,
      paymentHints: {
        apiEntry: buildPaymentHint(config, {
          path: API_ENTRY_PATH,
          method: "GET",
          price: config.instantScorePrice,
          maxAmountRequired: INSTANT_SCORE_AMOUNT,
          buyerAction: "Pay $0.001 for the generic API entry route map when an agent starts discovery at /api."
        }),
        apiV1Entry: buildPaymentHint(config, {
          path: API_V1_ENTRY_PATH,
          method: "GET",
          price: config.instantScorePrice,
          maxAmountRequired: INSTANT_SCORE_AMOUNT,
          buyerAction: "Pay $0.001 for the API v1 entry route map when an agent starts discovery at /api/v1."
        }),
        v1Entry: buildPaymentHint(config, {
          path: V1_ENTRY_PATH,
          method: "GET",
          price: config.instantScorePrice,
          maxAmountRequired: INSTANT_SCORE_AMOUNT,
          buyerAction: "Pay $0.001 for the short v1 entry route map when an agent starts discovery at /v1."
        }),
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
        discoveryAuditQuick: buildPaymentHint(config, {
          path: DISCOVERY_AUDIT_PATH,
          method: "GET",
          price: config.siteAuditPrice,
          maxAmountRequired: DISCOVERY_AUDIT_QUICK_AMOUNT,
          buyerAction: "Pay $0.001 for the exact x402 discovery audit path before buying the full custom audit."
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
      localDiscovery: {
        resources: absoluteUrl(config, LOCAL_DISCOVERY_RESOURCE_PATHS[0]),
        search: absoluteUrl(config, LOCAL_DISCOVERY_SEARCH_PATHS[0]),
        merchant: absoluteUrl(config, LOCAL_DISCOVERY_MERCHANT_PATHS[0]),
        searchExamples: buildLocalDiscoverySearchExamples(config),
        resourceExample: buildLocalDiscoveryResources(config, { limit: 2 }),
        searchExample: buildLocalDiscoverySearch(config, { query: "x402 discovery audit" }),
        merchantExample: buildLocalDiscoveryMerchant(config, { payTo: config.payTo })
      },
      keywords: DISCOVERY_KEYWORDS,
      request: requestExample,
      apiEntryCommand: buildGetPayCommand(config, API_ENTRY_PATH, INSTANT_SCORE_AMOUNT),
      apiV1EntryCommand: buildGetPayCommand(config, API_V1_ENTRY_PATH, INSTANT_SCORE_AMOUNT),
      v1EntryCommand: buildGetPayCommand(config, V1_ENTRY_PATH, INSTANT_SCORE_AMOUNT),
      instantScoreCommand: buildGetPayCommand(config),
      conversionScoreCommand: buildGetPayCommand(config, CONVERSION_SCORE_PATH, INSTANT_SCORE_AMOUNT),
      agentListingConversionCommand: buildGetPayCommand(config, AGENT_LISTING_PATH, INSTANT_SCORE_AMOUNT),
      indexedRoastGetCommand: buildGetPayCommand(config, ROAST_PATH),
      pingCommand: buildGetPayCommand(config, PING_PATH, PING_AMOUNT),
      siteAuditCommand: buildGetPayCommand(config, SITE_AUDIT_PATH, SITE_AUDIT_AMOUNT),
      discoveryAuditQuickCommand: buildGetPayCommand(config, DISCOVERY_AUDIT_PATH, DISCOVERY_AUDIT_QUICK_AMOUNT),
      discoveryAuditCommand: buildPayCommand(config, DISCOVERY_AUDIT_PATH, DISCOVERY_AUDIT_AMOUNT, discoveryAuditRequestExample),
      command: buildPayCommand(config),
      scoreCommand: buildPayCommand(config, "/api/listing-score", "5000"),
      apiEntryOutput: buildApiEntryOutput(config),
      instantScoreOutput: buildInstantListingScore(buildInstantScoreInput(), config),
      conversionScoreOutput: buildConversionScore(buildInstantScoreInput(), config),
      agentListingConversionOutput: buildAgentListingConversionScore(buildInstantScoreInput(), config),
      indexedRoastGetOutput: buildIndexedRoastQuickScore(buildInstantScoreInput(), config),
      pingOutput: buildPingOutput(config, { msg: "hello from x402" }),
      siteAuditRequest: buildDiscoveryAuditInputFromQuery(),
      siteAuditOutput: buildSiteAuditExampleOutput(config),
      discoveryAuditRequest: discoveryAuditRequestExample,
      discoveryAuditOutput: buildDiscoveryAuditExampleOutput(),
      scoreOutput: buildListingScoreWithUpgrade(requestExample, config),
      output: buildListingRoast(requestExample)
    });
  });

  app.get("/api/sample-score", async (_request, response) => {
    await recordSignal("sampleViews");
    const intentRoutes = buildPayNowActions(config);
    const recommendedPaidSequence = buildRecommendedPaidSequence(intentRoutes);
    const cashRegister = await getCashRegister();
    const sampleScoreOutput = buildListingScoreWithUpgrade(requestExample, config);
    const indexedQuickScoreOutput = buildIndexedRoastQuickScore(buildInstantScoreInput(), config);

    response.json({
      service: config.serviceName,
      samplePage: absoluteUrl(config, "/sample"),
      paidRoute: intentRoutes.indexedQuickScore.route,
      price: intentRoutes.indexedQuickScore.price,
      network: config.network,
      request: requestExample,
      command: intentRoutes.indexedQuickScore.command,
      buyerInstruction: "This free sample shows the score shape. Start paid usage with the proven $0.001 indexed GET route, then use the custom score or full roast only when the quick score fits.",
      paidUsageProof: buildPaidUsageProof(config, cashRegister),
      preferredFirstPaidAction: intentRoutes.indexedQuickScore,
      provenFirstPaidAction: intentRoutes.indexedQuickScore,
      recommendedPaidSequence,
      exactIntentActions: {
        marketplaceListingScore: intentRoutes.marketplaceListingScore,
        paidApiListingQuality: intentRoutes.paidApiListingQuality,
        buyerAgentSkipReasons: intentRoutes.buyerAgentSkipReasons,
        discoveryAuditQuick: intentRoutes.discoveryAuditQuick,
        x402SiteAudit: intentRoutes.x402SiteAudit
      },
      firstPaidOutput: indexedQuickScoreOutput,
      customScoreAction: intentRoutes.listingScore,
      customScoreOutput: sampleScoreOutput,
      output: sampleScoreOutput
    });
  });

  app.get([ICON_SVG_PATH, FAVICON_SVG_PATH], (_request, response) => {
    response
      .set("Cache-Control", "public, max-age=300")
      .type("image/svg+xml")
      .send(buildIconSvg());
  });

  app.get([INDEX_MARKDOWN_PATH, LLMS_FULL_PATH, WELL_KNOWN_LLMS_FULL_PATH], async (_request, response) => {
    await recordSignal("llmsViews");
    response.type("text/markdown").send(buildAgentMarkdownGuide(config));
  });

  app.get([LLMS_PATH, WELL_KNOWN_LLMS_PATH], async (_request, response) => {
    await recordSignal("llmsViews");
    response
      .type("text/plain")
      .send(`# Listing Roast x402

Listing Roast x402 is a paid API for x402, MCP, and agent-service builders who need a paid API listing quality score, agent-service listing score, marketplace listing conversion feedback, or x402 service discoverability guidance before promotion.

Preferred first paid route: GET ${absoluteUrl(config, ROAST_PATH)} (${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT} USDC units). Use this already-indexed quick score before generic /api, /api/v1, or /v1 entrypoints.

Quick-score aliases: GET ${formatQuickScoreAliasUrls(config)}. These aliases cost ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT} USDC units, and return the same quick score for marketplace listing score, paid API listing quality, buyer-agent skip reasons, and agent service clarity searches.

Paid API preflight aliases: GET ${formatPreflightAliasUrls(config)}. These aliases cost ${config.siteAuditPrice}, max ${SITE_AUDIT_AMOUNT} USDC units, and return the x402 site-audit output for agents that probe common preflight URLs before paying more.

Homepage: ${absoluteUrl(config, "/")}
Command builder: ${absoluteUrl(config, "/builder")}
Sample score page: ${absoluteUrl(config, "/sample")}
Sample score JSON: ${absoluteUrl(config, "/api/sample-score")}
OpenAPI: ${absoluteUrl(config, "/openapi.json")}
OpenAPI aliases: ${absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH)}, ${absoluteUrl(config, API_V1_OPENAPI_JSON_PATH)}, ${absoluteUrl(config, SWAGGER_JSON_PATH)}
Docs: ${absoluteUrl(config, DOCS_PATH)}, ${absoluteUrl(config, API_DOCS_PATH)}, ${absoluteUrl(config, AGENTS_MARKDOWN_PATH)}
x402 manifest: ${absoluteUrl(config, "/x402.json")}
x402 manifest aliases: ${absoluteUrl(config, WELL_KNOWN_X402_JSON_PATH)}, ${absoluteUrl(config, WELL_KNOWN_X402_PATH)}
Agent card: ${absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH)}
Agent card aliases: ${absoluteUrl(config, WELL_KNOWN_AGENT_JSON_PATH)}
AI plugin manifest: ${absoluteUrl(config, WELL_KNOWN_AI_PLUGIN_PATH)}
API catalog: ${absoluteUrl(config, WELL_KNOWN_API_CATALOG_PATH)}
Agent Skills index: ${absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH)}
Agent Skill: ${absoluteUrl(config, WELL_KNOWN_AGENT_SKILL_PATH)}
Full agent guide: ${absoluteUrl(config, LLMS_FULL_PATH)}
Markdown homepage: ${absoluteUrl(config, INDEX_MARKDOWN_PATH)}
MCP metadata: ${absoluteUrl(config, WELL_KNOWN_MCP_JSON_PATH)}
MCP aliases: ${absoluteUrl(config, WELL_KNOWN_MCP_PATH)}, ${absoluteUrl(config, WELL_KNOWN_MCP_SERVER_PATH)}
MCP server card: ${absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH)}
Pay-now JSON: ${absoluteUrl(config, PAY_NOW_PATH)}
Paid-use proof: ${absoluteUrl(config, PAID_USAGE_PROOF_PATH)}
Pricing catalog: ${absoluteUrl(config, PRICING_PATH)}
Route finder examples: ${absoluteUrl(config, FIND_PATH)}?q=x402%20discovery%20audit, ${absoluteUrl(config, FIND_PATH)}?q=buyer-agent%20skip%20reasons, ${absoluteUrl(config, FIND_PATH)}?q=score%20my%20paid%20API%20listing%20with%20a%20custom%20body, ${absoluteUrl(config, FIND_PATH)}?q=listing%20roast%20full%20rewrite
Local route router examples: GET ${absoluteUrl(config, ROUTE_PATH)}?query=x402%20discovery%20audit&top=3, GET ${absoluteUrl(config, ROUTE_PATH)}?query=score%20my%20paid%20API%20listing%20with%20a%20custom%20body&top=3, POST ${absoluteUrl(config, ROUTE_PATH)} {"query":"buyer-agent skip reasons","top":3,"include":"local"}
Local x402 discovery resources: ${absoluteUrl(config, LOCAL_DISCOVERY_RESOURCE_PATHS[0])}
Local x402 discovery search: ${absoluteUrl(config, LOCAL_DISCOVERY_SEARCH_PATHS[0])}?query=x402%20discovery%20audit
Local x402 merchant resources: ${absoluteUrl(config, LOCAL_DISCOVERY_MERCHANT_PATHS[0])}?payTo=${config.payTo}
Keywords: ${DISCOVERY_KEYWORDS.join(", ")}

Buyer intent landing pages:
${buildIntentLandingHandoffs(config).map((page) => `- ${page.title}: ${page.url}
  - Use when: ${page.summary}
  - Primary paid action: ${page.primaryPaidAction.method} ${absoluteUrl(config, page.primaryPaidAction.path)} (${page.primaryPaidAction.price}, max ${page.primaryPaidAction.maxAmountRequired})
  - Supporting paid action: ${page.supportingPaidAction.method} ${absoluteUrl(config, page.supportingPaidAction.path)} (${page.supportingPaidAction.price}, max ${page.supportingPaidAction.maxAmountRequired})`).join("\n")}

Preferred first paid route:

- GET ${absoluteUrl(config, ROAST_PATH)}
  - Price: ${config.instantScorePrice}
  - Network: ${config.network}
  - Max amount: ${INSTANT_SCORE_AMOUNT} USDC units
  - Command:
${indentText(buildGetPayCommand(config, ROAST_PATH))}
  - Output: quick paid API listing quality score from the already-indexed listing-roast URL
  - Use first when a marketplace result points to /api/listing-roast or an agent wants the lowest-friction payable route
  - Exact buyer-phrase aliases: GET ${formatQuickScoreAliasUrls(config)}

Recommended paid sequence:

1. Start with GET ${absoluteUrl(config, ROAST_PATH)} for ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT} USDC units.
2. Upgrade to POST ${absoluteUrl(config, ROAST_PATH)} for ${config.price}, max 10000 USDC units only when the buyer wants the full rewrite, top fixes, and stop-or-upgrade guidance.

Full roast command:
${indentText(buildPayCommand(config))}

Other paid routes:

- GET ${absoluteUrl(config, API_ENTRY_PATH)}
  - Price: ${config.instantScorePrice}
  - Network: ${config.network}
  - Max amount: ${INSTANT_SCORE_AMOUNT} USDC units
  - Command:
${indentText(buildGetPayCommand(config, API_ENTRY_PATH, INSTANT_SCORE_AMOUNT))}
  - Output: paid API entry route map with preferred first paid action and free discovery links
  - Use when an agent starts at /api before choosing a specific paid route

- GET ${absoluteUrl(config, API_V1_ENTRY_PATH)}
  - Price: ${config.instantScorePrice}
  - Network: ${config.network}
  - Max amount: ${INSTANT_SCORE_AMOUNT} USDC units
  - Command:
${indentText(buildGetPayCommand(config, API_V1_ENTRY_PATH, INSTANT_SCORE_AMOUNT))}
  - Output: paid API v1 entry route map with preferred first paid action and free discovery links
  - Use when an agent starts at /api/v1 before choosing a specific paid route

- GET ${absoluteUrl(config, V1_ENTRY_PATH)}
  - Price: ${config.instantScorePrice}
  - Network: ${config.network}
  - Max amount: ${INSTANT_SCORE_AMOUNT} USDC units
  - Command:
${indentText(buildGetPayCommand(config, V1_ENTRY_PATH, INSTANT_SCORE_AMOUNT))}
  - Output: paid short v1 entry route map with preferred first paid action and free discovery links
  - Use when an agent probes /v1 before choosing a specific paid route

- GET ${absoluteUrl(config, INSTANT_SCORE_PATH)}
  - Price: ${config.instantScorePrice}
  - Network: ${config.network}
  - Max amount: ${INSTANT_SCORE_AMOUNT} USDC units
  - Command:
${indentText(buildGetPayCommand(config))}
  - Output: paid API listing quality score, checked signals, first fix, next step
  - Use when an agent wants a dedicated instant-score URL without first assembling a JSON body

- GET ${absoluteUrl(config, CONVERSION_SCORE_PATH)}
  - Price: ${config.instantScorePrice}
  - Network: ${config.network}
  - Max amount: ${INSTANT_SCORE_AMOUNT} USDC units
  - Command:
${indentText(buildGetPayCommand(config, CONVERSION_SCORE_PATH, INSTANT_SCORE_AMOUNT))}
  - Output: x402 marketplace conversion score, paid API listing quality score, checked signals, first fix, next step
  - Use when an agent searches for x402 marketplace conversion or wants the route path to match that buyer intent

- GET ${absoluteUrl(config, AGENT_LISTING_PATH)}
  - Price: ${config.instantScorePrice}
  - Network: ${config.network}
  - Max amount: ${INSTANT_SCORE_AMOUNT} USDC units
  - Command:
${indentText(buildGetPayCommand(config, AGENT_LISTING_PATH, INSTANT_SCORE_AMOUNT))}
  - Output: agent listing conversion score, agent service listing clarity score, buyer-agent skip reasons, buyer intent checks, first fix, next step
  - Use after the indexed quick score when the buyer wants the dedicated agent-listing conversion deep dive

- GET ${absoluteUrl(config, PING_PATH)}
  - Price: ${config.instantScorePrice}
  - Network: ${config.network}
  - Max amount: ${PING_AMOUNT} USDC units
  - Command:
${indentText(buildGetPayCommand(config, PING_PATH, PING_AMOUNT))}
  - Output: paid ping, timestamp, echo message, and next paid routes
  - Use when an agent wants to verify the x402 rail before buying a score or roast

- GET ${absoluteUrl(config, SITE_AUDIT_PATH)}
  - Price: ${config.siteAuditPrice}
  - Network: ${config.network}
  - Max amount: ${SITE_AUDIT_AMOUNT} USDC units
  - Command:
${indentText(buildGetPayCommand(config, SITE_AUDIT_PATH, SITE_AUDIT_AMOUNT))}
  - Output: direct 402 metadata check, Bazaar pricing check, search visibility, stale price mismatch, and no-spend fix steps
  - Use when an agent wants a cheap x402 listing SEO audit, listing rank doctor, seller intelligence, seller growth checklist, paid API preflight, route health check, or site audit without assembling a JSON body

- GET ${absoluteUrl(config, DISCOVERY_AUDIT_PATH)}
  - Price: ${config.siteAuditPrice}
  - Network: ${config.network}
  - Max amount: ${DISCOVERY_AUDIT_QUICK_AMOUNT} USDC units
  - Command:
${indentText(buildGetPayCommand(config, DISCOVERY_AUDIT_PATH, DISCOVERY_AUDIT_QUICK_AMOUNT))}
  - Output: exact-path x402 discovery audit, direct 402 metadata check, Bazaar pricing check, search visibility, and no-spend fix steps
  - Use when an agent asks for an x402 discovery audit and wants the cheapest route before the custom-body audit

- POST ${absoluteUrl(config, DISCOVERY_AUDIT_PATH)}
  - Price: ${config.discoveryAuditPrice}
  - Network: ${config.network}
  - Max amount: ${DISCOVERY_AUDIT_AMOUNT} USDC units
  - Command:
${indentText(buildPayCommand(config, DISCOVERY_AUDIT_PATH, DISCOVERY_AUDIT_AMOUNT, discoveryAuditRequestExample))}
  - Output: direct 402 metadata check, Bazaar merchant discovery check, search visibility, stale pricing mismatch, and no-spend fix steps
  - Use when a builder sees stale Bazaar pricing, missing Agentic.Market visibility, or a live endpoint that search does not surface

- POST ${absoluteUrl(config, "/api/listing-score")}
  - Price: ${config.scorePrice}
  - Network: ${config.network}
  - Max amount: 5000 USDC units
  - Command:
${indentText(buildPayCommand(config, "/api/listing-score", "5000"))}
  - Output: paid API listing quality score, checked signals, first fix, next step, upgrade endpoint

- POST ${absoluteUrl(config, ROAST_PATH)}
  - Price: ${config.price}
  - Network: ${config.network}
  - Max amount: 10000 USDC units
  - Command:
${indentText(buildPayCommand(config))}
  - Output: buyer-agent skip reasons, top fixes, rewritten listing, stop-or-upgrade guidance

Request body JSON:

${prettyJson(requestExample)}

Use the indexed $0.001 GET /api/listing-roast route first when a buyer agent wants the fastest paid test from a Bazaar-visible URL.
`);
  });

  async function serveOpenApiDocument(_request, response) {
    await recordSignal("openApiViews");
    const cashRegister = await getCashRegister();
    setFreshDiscoveryHeaders(response).json(buildOpenApiDocument(config, cashRegister));
  }

  app.get("/openapi.json", serveOpenApiDocument);
  app.get(WELL_KNOWN_OPENAPI_JSON_PATH, serveOpenApiDocument);
  app.get(API_V1_OPENAPI_JSON_PATH, serveOpenApiDocument);
  app.get(SWAGGER_JSON_PATH, serveOpenApiDocument);
  app.get(OPENAPI_YAML_PATH, (_request, response) => {
    response.redirect(302, absoluteUrl(config, "/openapi.json"));
  });

  app.get([DOCS_PATH, API_DOCS_PATH], async (_request, response) => {
    await recordSignal("llmsViews");
    response.type("text/markdown").send(buildAgentMarkdownGuide(config));
  });

  async function serveX402Manifest(_request, response) {
    await recordSignal("x402ManifestViews");
    const cashRegister = await getCashRegister();
    setFreshDiscoveryHeaders(response).json(buildX402Manifest(config, cashRegister));
  }

  app.get("/x402.json", serveX402Manifest);
  app.get(WELL_KNOWN_X402_JSON_PATH, serveX402Manifest);
  app.get(WELL_KNOWN_X402_PATH, serveX402Manifest);

  async function serveAgentCard(_request, response) {
    await recordSignal("agentCardViews");
    const cashRegister = await getCashRegister();
    setFreshDiscoveryHeaders(response).json(buildAgentCard(config, cashRegister));
  }

  app.get(WELL_KNOWN_AGENT_CARD_PATH, serveAgentCard);
  app.get(WELL_KNOWN_AGENT_JSON_PATH, serveAgentCard);

  app.get(WELL_KNOWN_AI_PLUGIN_PATH, async (_request, response) => {
    await recordSignal("aiPluginViews");
    const cashRegister = await getCashRegister();
    setFreshDiscoveryHeaders(response).json(buildAiPluginManifest(config, cashRegister));
  });

  app.head(WELL_KNOWN_API_CATALOG_PATH, (_request, response) => {
    setFreshDiscoveryHeaders(response).set("Content-Type", API_CATALOG_CONTENT_TYPE).status(200).end();
  });

  app.get(WELL_KNOWN_API_CATALOG_PATH, async (_request, response) => {
    await recordSignal("apiCatalogViews");
    setFreshDiscoveryHeaders(response).set("Content-Type", API_CATALOG_CONTENT_TYPE).send(prettyJson(buildApiCatalog(config)));
  });

  app.get(WELL_KNOWN_AGENT_TOOLS_PATH, async (_request, response) => {
    await recordSignal("agentToolsViews");
    setFreshDiscoveryHeaders(response).json(buildAgentToolsManifest(config));
  });

  app.head(WELL_KNOWN_AGENT_SKILLS_INDEX_PATH, (_request, response) => {
    setFreshDiscoveryHeaders(response)
      .set("Access-Control-Allow-Origin", "*")
      .type("application/json")
      .status(200)
      .end();
  });

  app.get(WELL_KNOWN_AGENT_SKILLS_INDEX_PATH, async (_request, response) => {
    await recordSignal("agentSkillsViews");
    setFreshDiscoveryHeaders(response)
      .set("Access-Control-Allow-Origin", "*")
      .json(buildAgentSkillsIndex(config));
  });

  app.head(WELL_KNOWN_AGENT_SKILL_PATH, (_request, response) => {
    setFreshDiscoveryHeaders(response)
      .set("Access-Control-Allow-Origin", "*")
      .type("text/markdown")
      .status(200)
      .end();
  });

  app.get(WELL_KNOWN_AGENT_SKILL_PATH, async (_request, response) => {
    await recordSignal("agentSkillViews");
    setFreshDiscoveryHeaders(response)
      .set("Access-Control-Allow-Origin", "*")
      .type("text/markdown")
      .send(buildAgentSkillMarkdown(config));
  });

  app.get("/builder", async (_request, response) => {
    await recordSignal("builderViews");
    const instantRoute = absoluteUrl(config, INSTANT_SCORE_PATH);
    const agentListingRoute = absoluteUrl(config, AGENT_LISTING_PATH);
    const buyerSkipRoute = absoluteUrl(config, "/api/buyer-agent-skip-reasons");
    const indexedRoute = absoluteUrl(config, ROAST_PATH);
    const pingRoute = absoluteUrl(config, PING_PATH);
    const siteAuditRoute = absoluteUrl(config, SITE_AUDIT_PATH);
    const discoveryAuditRoute = absoluteUrl(config, DISCOVERY_AUDIT_PATH);
    const scoreRoute = absoluteUrl(config, "/api/listing-score");
    const roastRoute = absoluteUrl(config, ROAST_PATH);
    const sampleUrl = absoluteUrl(config, "/sample");
    const sampleScoreApi = absoluteUrl(config, "/api/sample-score");
    const instantCommand = buildGetPayCommand(config);
    const agentListingCommand = buildGetPayCommand(config, AGENT_LISTING_PATH, INSTANT_SCORE_AMOUNT);
    const buyerSkipCommand = buildGetPayCommand(config, "/api/buyer-agent-skip-reasons", INSTANT_SCORE_AMOUNT);
    const indexedCommand = buildGetPayCommand(config, ROAST_PATH);
    const pingCommand = buildGetPayCommand(config, PING_PATH, PING_AMOUNT);
    const siteAuditCommand = buildGetPayCommand(config, SITE_AUDIT_PATH, SITE_AUDIT_AMOUNT);
    const discoveryAuditCommand = buildGetPayCommand(config, DISCOVERY_AUDIT_PATH, DISCOVERY_AUDIT_QUICK_AMOUNT);
    const scoreCommand = buildPayCommand(config, "/api/listing-score", "5000");
    const roastCommand = buildPayCommand(config);

    response.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Build copy-ready x402 commands for the Listing Roast $0.001 indexed GET score, buyer-agent skip reasons, discovery audit, site audit, $0.005 score, and $0.01 full roast routes." />
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
      <p class="lead">Paste the offer you are trying to sell. This page leads with the already-indexed ${config.instantScorePrice} GET command, then gives exact $0.001 commands for buyer-agent skip reasons, discovery audit, site audit, instant scoring, the ${config.scorePrice} score route, and optional ${config.price} full roast route.</p>
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
            <p class="muted" style="margin-top: 16px;"><code>GET ${escapeHtml(agentListingRoute)}</code></p>
            <pre id="agent-listing-command">${escapeHtml(agentListingCommand)}</pre>
            <button class="button" type="button" data-copy-target="agent-listing-command" data-default-text="Copy agent-listing command">Copy agent-listing command</button>
            <p class="muted" style="margin-top: 16px;"><code>GET ${escapeHtml(buyerSkipRoute)}</code></p>
            <pre id="buyer-skip-command">${escapeHtml(buyerSkipCommand)}</pre>
            <button class="button" type="button" data-copy-target="buyer-skip-command" data-default-text="Copy buyer-skip command">Copy buyer-skip command</button>
            <p class="muted" style="margin-top: 16px;"><code>GET ${escapeHtml(pingRoute)}</code></p>
            <pre id="ping-command">${escapeHtml(pingCommand)}</pre>
            <button class="button secondary" type="button" data-copy-target="ping-command" data-default-text="Copy x402 ping command">Copy x402 ping command</button>
            <p class="muted" style="margin-top: 16px;"><code>GET ${escapeHtml(siteAuditRoute)}</code></p>
            <pre id="site-audit-command">${escapeHtml(siteAuditCommand)}</pre>
            <button class="button secondary" type="button" data-copy-target="site-audit-command" data-default-text="Copy site audit command">Copy site audit command</button>
            <p class="muted" style="margin-top: 16px;"><code>GET ${escapeHtml(discoveryAuditRoute)}</code></p>
            <pre id="discovery-audit-command">${escapeHtml(discoveryAuditCommand)}</pre>
            <button class="button secondary" type="button" data-copy-target="discovery-audit-command" data-default-text="Copy discovery-audit command">Copy discovery-audit command</button>
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
    const buyerSkipCommand = buildGetPayCommand(config, "/api/buyer-agent-skip-reasons", INSTANT_SCORE_AMOUNT);
    const discoveryAuditCommand = buildGetPayCommand(config, DISCOVERY_AUDIT_PATH, DISCOVERY_AUDIT_QUICK_AMOUNT);
    const scoreCommand = buildPayCommand(config, "/api/listing-score", "5000");
    const roastCommand = buildPayCommand(config);
    const scoreOutput = buildListingScoreWithUpgrade(requestExample, config);
    const indexedOutput = buildIndexedRoastQuickScore(buildInstantScoreInput(), config);
    const builderUrl = absoluteUrl(config, "/builder");
    const sampleScoreApi = absoluteUrl(config, "/api/sample-score");
    const indexedRoute = absoluteUrl(config, ROAST_PATH);
    const buyerSkipRoute = absoluteUrl(config, "/api/buyer-agent-skip-reasons");
    const discoveryAuditRoute = absoluteUrl(config, DISCOVERY_AUDIT_PATH);
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
        <button class="button secondary" type="button" data-copy-target="buyer-skip-command" data-default-text="Copy $0.001 buyer-skip command">Copy $0.001 buyer-skip command</button>
        <button class="button secondary" type="button" data-copy-target="discovery-audit-command" data-default-text="Copy $0.001 discovery-audit command">Copy $0.001 discovery-audit command</button>
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
          <h2>Buyer-skip route</h2>
          <p><code>GET ${escapeHtml(buyerSkipRoute)}</code></p>
          <p class="muted">Price: <span class="metric">${config.instantScorePrice}</span>; exact path for buyer-agent skip reason intent.</p>
          <h2>Discovery audit route</h2>
          <p><code>GET ${escapeHtml(discoveryAuditRoute)}</code></p>
          <p class="muted">Price: <span class="metric">${config.siteAuditPrice}</span>; exact path for stale Bazaar pricing, route health, and search visibility checks.</p>
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
          <h2>Buyer-skip command</h2>
          <pre id="buyer-skip-command">${escapeHtml(buyerSkipCommand)}</pre>
        </div>
        <div class="card">
          <h2>Discovery audit command</h2>
          <pre id="discovery-audit-command">${escapeHtml(discoveryAuditCommand)}</pre>
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
    setFreshDiscoveryHeaders(response).json(buildDiscovery(config));
  });

  app.get("/api/score-schema", async (_request, response) => {
    await recordSignal("schemaViews");
    setFreshDiscoveryHeaders(response).json(buildScoreDiscovery(config));
  });

  app.get("/api/discovery-audit-schema", async (_request, response) => {
    await recordSignal("schemaViews");
    setFreshDiscoveryHeaders(response).json(buildDiscoveryAuditDiscovery(config));
  });

  app.get(WELL_KNOWN_MCP_SERVER_CARD_PATH, async (_request, response) => {
    await recordSignal("mcpViews");
    const cashRegister = await getCashRegister();
    setFreshDiscoveryHeaders(response).json(buildMcpServerCard(config, cashRegister));
  });

  app.get([WELL_KNOWN_MCP_JSON_PATH, WELL_KNOWN_MCP_PATH, WELL_KNOWN_MCP_SERVER_PATH], async (_request, response) => {
    await recordSignal("mcpViews");
    const intentRoutes = buildPayNowActions(config);
    const recommendedPaidSequence = buildRecommendedPaidSequence(intentRoutes);
    const payNowExamples = buildPayNowIntentExamples(config);
    const cashRegister = await getCashRegister();

    setFreshDiscoveryHeaders(response).json({
      name: config.serviceName,
      iconUrl: absoluteUrl(config, ICON_SVG_PATH),
      homepage: absoluteUrl(config, "/"),
      builder: absoluteUrl(config, "/builder"),
      sample: absoluteUrl(config, "/sample"),
      openApi: absoluteUrl(config, "/openapi.json"),
      openApiAliases: [absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH)],
      llms: absoluteUrl(config, LLMS_PATH),
      llmsAliases: [absoluteUrl(config, WELL_KNOWN_LLMS_PATH)],
      llmsFull: absoluteUrl(config, LLMS_FULL_PATH),
      llmsFullAliases: [absoluteUrl(config, WELL_KNOWN_LLMS_FULL_PATH)],
      markdown: absoluteUrl(config, INDEX_MARKDOWN_PATH),
      x402Manifest: absoluteUrl(config, "/x402.json"),
      x402ManifestAliases: [absoluteUrl(config, WELL_KNOWN_X402_JSON_PATH), absoluteUrl(config, WELL_KNOWN_X402_PATH)],
      agentCard: absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH),
      agentCardAliases: [absoluteUrl(config, WELL_KNOWN_AGENT_JSON_PATH)],
      aiPlugin: absoluteUrl(config, WELL_KNOWN_AI_PLUGIN_PATH),
      apiCatalog: absoluteUrl(config, WELL_KNOWN_API_CATALOG_PATH),
      agentTools: absoluteUrl(config, WELL_KNOWN_AGENT_TOOLS_PATH),
      agentSkills: absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH),
      agentSkill: absoluteUrl(config, WELL_KNOWN_AGENT_SKILL_PATH),
      mcpAliases: [absoluteUrl(config, WELL_KNOWN_MCP_PATH), absoluteUrl(config, WELL_KNOWN_MCP_SERVER_PATH)],
      mcpServerCard: absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH),
      payNow: absoluteUrl(config, PAY_NOW_PATH),
      payNowExamples,
      paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
      cashRegister: absoluteUrl(config, "/api/cash-register"),
      paidUsageProof: buildPaidUsageProof(config, cashRegister),
      settlementProof: buildSettlementProof(config),
      pricing: absoluteUrl(config, PRICING_PATH),
      find: absoluteUrl(config, FIND_PATH),
      route: absoluteUrl(config, ROUTE_PATH),
      preferredFirstPaidAction: intentRoutes.indexedQuickScore,
      recommendedPaidSequence,
      payment: {
        protocol: "x402",
        network: config.network,
        asset: "USDC",
        manifest: absoluteUrl(config, "/x402.json"),
        payNow: absoluteUrl(config, PAY_NOW_PATH),
        paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
        preferredFirstPaidAction: intentRoutes.indexedQuickScore,
        recommendedPaidSequence,
        payNowExamples,
        cashRegister: absoluteUrl(config, "/api/cash-register"),
        paidUsageProof: buildPaidUsageProof(config, cashRegister),
        settlementProof: buildSettlementProof(config)
      },
      keywords: DISCOVERY_KEYWORDS,
      quickScoreAliases: quickScoreAliasUrls(config),
      preflightAliases: preflightAliasUrls(config),
      tools: [
        {
          name: "indexed_listing_roast_quick_score",
          method: "GET",
          path: ROAST_PATH,
          url: absoluteUrl(config, ROAST_PATH),
          price: config.instantScorePrice,
          network: config.network,
          command: buildGetPayCommand(config, ROAST_PATH),
          description: "marketplace listing score, paid API listing quality score, and buyer-agent skip reasons on the already-indexed, paid-use-confirmed Listing Roast URL; one-tenth-cent GET paid API preflight, x402 site audit starter, discovery audit triage, agent service listing clarity, route-health language, Bazaar search visibility intent, stale pricing triage, and conversion checks.",
          payment: buildPaymentHint(config, {
            path: ROAST_PATH,
            method: "GET",
            price: config.instantScorePrice,
            maxAmountRequired: INSTANT_SCORE_AMOUNT,
            preferredFirstPaidAction: true,
            buyerAction: "Pay $0.001 on the already-indexed marketplace route for a quick listing quality score."
          }),
          keywords: ["listing roast", "score API", "marketplace listing quality", "paid API listing quality", "paid API discoverability", "x402 listing quality", "agent listing conversion score", "agent listing conversion", "agent service listing clarity", "buyer-agent skip reasons", "buyer agent skip reasons", "agent-service listing score", "x402 marketplace conversion", "x402 site audit", "x402 service discoverability audit", "x402 discovery audit", "x402 bazaar discovery audit", "paid API preflight", "x402 route health check", "bazaar search visibility", "x402 listing stale price", "x402 metadata audit", "x402 buyer-readiness signals"],
          input: buildInstantScoreDiscovery(config).input
        },
        {
          name: "api_entry_route_map",
          method: "GET",
          path: API_ENTRY_PATH,
          url: absoluteUrl(config, API_ENTRY_PATH),
          price: config.instantScorePrice,
          network: config.network,
          command: buildGetPayCommand(config, API_ENTRY_PATH, INSTANT_SCORE_AMOUNT),
          description: "one-tenth-cent generic x402 navigation endpoint with fallback quick score for agents that start at /api.",
          payment: buildPaymentHint(config, {
            path: API_ENTRY_PATH,
            method: "GET",
            price: config.instantScorePrice,
            maxAmountRequired: INSTANT_SCORE_AMOUNT,
            buyerAction: "Pay $0.001 for the generic API entry route map when an agent starts discovery at /api."
          }),
          keywords: ["x402 navigation", "API entrypoint", "agent commerce", "route map"],
          input: {}
        },
        {
          name: "api_v1_entry_route_map",
          method: "GET",
          path: API_V1_ENTRY_PATH,
          url: absoluteUrl(config, API_V1_ENTRY_PATH),
          price: config.instantScorePrice,
          network: config.network,
          command: buildGetPayCommand(config, API_V1_ENTRY_PATH, INSTANT_SCORE_AMOUNT),
          description: "one-tenth-cent versioned x402 navigation endpoint with fallback quick score for agents that start at /api/v1.",
          payment: buildPaymentHint(config, {
            path: API_V1_ENTRY_PATH,
            method: "GET",
            price: config.instantScorePrice,
            maxAmountRequired: INSTANT_SCORE_AMOUNT,
            buyerAction: "Pay $0.001 for the API v1 entry route map when an agent starts discovery at /api/v1."
          }),
          keywords: ["x402 navigation", "API v1 entrypoint", "agent commerce", "route map", "api v1"],
          input: {}
        },
        {
          name: "v1_entry_route_map",
          method: "GET",
          path: V1_ENTRY_PATH,
          url: absoluteUrl(config, V1_ENTRY_PATH),
          price: config.instantScorePrice,
          network: config.network,
          command: buildGetPayCommand(config, V1_ENTRY_PATH, INSTANT_SCORE_AMOUNT),
          description: "one-tenth-cent short versioned x402 navigation endpoint with fallback quick score for agents that start at /v1.",
          payment: buildPaymentHint(config, {
            path: V1_ENTRY_PATH,
            method: "GET",
            price: config.instantScorePrice,
            maxAmountRequired: INSTANT_SCORE_AMOUNT,
            buyerAction: "Pay $0.001 for the short v1 entry route map when an agent starts discovery at /v1."
          }),
          keywords: ["x402 navigation", "v1 entrypoint", "agent commerce", "route map", "v1"],
          input: {}
        },
        {
          name: "instant_paid_listing_score",
          method: "GET",
          path: INSTANT_SCORE_PATH,
          url: absoluteUrl(config, INSTANT_SCORE_PATH),
          price: config.instantScorePrice,
          network: config.network,
          command: buildGetPayCommand(config),
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
          command: buildGetPayCommand(config, CONVERSION_SCORE_PATH, INSTANT_SCORE_AMOUNT),
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
          command: buildGetPayCommand(config, AGENT_LISTING_PATH, INSTANT_SCORE_AMOUNT),
          description: AGENT_LISTING_CONVERSION_DESCRIPTION,
          payment: buildPaymentHint(config, {
            path: AGENT_LISTING_PATH,
            method: "GET",
            price: config.instantScorePrice,
            maxAmountRequired: INSTANT_SCORE_AMOUNT,
            buyerAction: "Pay $0.001 for an agent listing conversion score without building a JSON body."
          }),
          keywords: ["agent service listing clarity", "agent service listing clarity x402", "agent listing conversion score", "buyer-agent skip reasons", "buyer agent skip reasons", "agent listing clarity", "buyer intent", "paid API listing quality", "agent-service listing score", "GET paid API"],
          input: buildInstantScoreDiscovery(config).input
        },
        {
          name: "paid_x402_ping",
          method: "GET",
          path: PING_PATH,
          url: absoluteUrl(config, PING_PATH),
          price: config.instantScorePrice,
          network: config.network,
          command: buildGetPayCommand(config, PING_PATH, PING_AMOUNT),
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
          command: buildGetPayCommand(config, SITE_AUDIT_PATH, SITE_AUDIT_AMOUNT),
        description: "one-tenth-cent GET x402 listing SEO audit, listing rank doctor, seller growth checklist, service discoverability audit, and paid API preflight before paying for direct 402 metadata, route health, Bazaar pricing, search visibility, and no-spend fix steps.",
          payment: buildPaymentHint(config, {
            path: SITE_AUDIT_PATH,
            method: "GET",
            price: config.siteAuditPrice,
            maxAmountRequired: SITE_AUDIT_AMOUNT,
            buyerAction: "Pay $0.001 for a no-spend x402 listing SEO audit, listing rank doctor, seller growth checklist, metadata, pricing, and search visibility check."
          }),
          keywords: ["x402 site audit", "x402 service discoverability audit", "x402 listing SEO audit", "x402 listing rank doctor", "x402 seller growth checklist", "x402 seller intelligence", "x402 marketplace SEO audit", "paid API preflight", "x402 route health check", "x402 discovery audit", "bazaar search visibility", "x402 listing stale price"],
          input: buildSiteAuditDiscovery(config).input
        },
        {
          name: "x402_discovery_audit",
          method: "GET",
          path: DISCOVERY_AUDIT_PATH,
          url: absoluteUrl(config, DISCOVERY_AUDIT_PATH),
          price: config.siteAuditPrice,
          network: config.network,
          command: buildGetPayCommand(config, DISCOVERY_AUDIT_PATH, DISCOVERY_AUDIT_QUICK_AMOUNT),
          description: "one-tenth-cent GET x402 discovery audit on the exact audit path for stale Bazaar pricing, search visibility, route health, paid API preflight, and direct 402 metadata.",
          payment: buildPaymentHint(config, {
            path: DISCOVERY_AUDIT_PATH,
            method: "GET",
            price: config.siteAuditPrice,
            maxAmountRequired: DISCOVERY_AUDIT_QUICK_AMOUNT,
            buyerAction: "Pay $0.001 for the exact x402 discovery audit path before buying the full custom audit."
          }),
          keywords: ["x402 discovery audit", "x402 bazaar discovery audit", "x402 listing stale price", "bazaar search visibility", "paid API preflight", "x402 route health check"],
          input: buildDiscoveryAuditQuickDiscovery(config).input
        },
        {
          name: "x402_discovery_audit_full",
          method: "POST",
          path: DISCOVERY_AUDIT_PATH,
          url: absoluteUrl(config, DISCOVERY_AUDIT_PATH),
          price: config.discoveryAuditPrice,
          network: config.network,
          command: buildPayCommand(config, DISCOVERY_AUDIT_PATH, DISCOVERY_AUDIT_AMOUNT, discoveryAuditRequestExample),
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
          command: buildPayCommand(config, "/api/listing-score", "5000"),
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
          command: buildPayCommand(config),
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

  app.get(PAY_NOW_PATH, async (request, response) => {
    await recordSignal("payNowViews");
    const cashRegister = await getCashRegister();
    setFreshDiscoveryHeaders(response).json(buildPayNow(config, request.query.intent || request.query.q || request.query.query || request.query.task || "", cashRegister));
  });

  app.get(PAID_USAGE_PROOF_PATH, async (_request, response) => {
    await recordSignal("proofViews");
    const cashRegister = await getCashRegister();
    setFreshDiscoveryHeaders(response).json(buildPaidUsageProofResponse(config, cashRegister));
  });

  app.get(PRICING_PATH, async (_request, response) => {
    await recordSignal("pricingViews");
    const cashRegister = await getCashRegister();
    setFreshDiscoveryHeaders(response).json(buildPricingCatalog(config, cashRegister));
  });

  app.get(FIND_PATH, async (request, response) => {
    await recordSignal("findViews");
    const cashRegister = await getCashRegister();
    setFreshDiscoveryHeaders(response).json(buildFindResult(config, request.query.q || request.query.query || request.query.task || "", cashRegister));
  });

  app.get(ROUTE_PATH, async (request, response) => {
    await recordSignal("routeViews");
    const cashRegister = await getCashRegister();
    setFreshDiscoveryHeaders(response).json(buildRouteResult(config, request.query, cashRegister));
  });

  app.post(ROUTE_PATH, async (request, response) => {
    await recordSignal("routeViews");
    const cashRegister = await getCashRegister();
    setFreshDiscoveryHeaders(response).json(buildRouteResult(config, request.body || {}, cashRegister));
  });

  app.get(LOCAL_DISCOVERY_RESOURCE_PATHS, async (request, response) => {
    await recordSignal("localDiscoveryViews");
    const cashRegister = await getCashRegister();
    setFreshDiscoveryHeaders(response).json(buildLocalDiscoveryResources(config, request.query, cashRegister));
  });

  app.get(LOCAL_DISCOVERY_SEARCH_PATHS, async (request, response) => {
    await recordSignal("localDiscoveryViews");
    const cashRegister = await getCashRegister();
    setFreshDiscoveryHeaders(response).json(buildLocalDiscoverySearch(config, request.query, cashRegister));
  });

  app.get(LOCAL_DISCOVERY_MERCHANT_PATHS, async (request, response) => {
    await recordSignal("localDiscoveryViews");
    const cashRegister = await getCashRegister();
    setFreshDiscoveryHeaders(response).json(buildLocalDiscoveryMerchant(config, request.query, cashRegister));
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

  app.head([API_ENTRY_PATH, API_V1_ENTRY_PATH, V1_ENTRY_PATH], rejectHeadPaidRoute);
  app.use([INSTANT_SCORE_PATH, CONVERSION_SCORE_PATH, AGENT_LISTING_PATH, ...QUICK_SCORE_PAID_PATHS, PING_PATH, ...SITE_AUDIT_PAID_PATHS, DISCOVERY_AUDIT_PATH, "/api/listing-score"], rejectHeadPaidRoute);
  app.post(ROOT_DIRECTORY_POST_PATH, recordDirectoryPostProbe);
  app.get([API_ENTRY_PATH, API_V1_ENTRY_PATH, V1_ENTRY_PATH], recordApiEntryProbe);
  app.get([INSTANT_SCORE_PATH, CONVERSION_SCORE_PATH, AGENT_LISTING_PATH, ...QUICK_SCORE_PAID_PATHS], recordGetScoreProbe);
  app.get(PING_PATH, recordPingProbe);
  app.get([...SITE_AUDIT_PAID_PATHS, DISCOVERY_AUDIT_PATH], recordAuditProbe);
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

  app.post(ROOT_DIRECTORY_POST_PATH, async (_request, response) => {
    const result = buildDirectoryPostOutput(config);
    const cashRegister = await recordPaidCompletion("directoryPost", 0.001);
    response.json({ ...result, cashRegister });
  });

  app.get([API_ENTRY_PATH, API_V1_ENTRY_PATH, V1_ENTRY_PATH], async (request, response) => {
    const result = buildApiEntryOutput(config, request.query);
    const cashRegister = await recordPaidCompletion("apiEntry", 0.001);
    response.json({ ...result, cashRegister });
  });

  app.get(INSTANT_SCORE_PATH, async (request, response) => {
    const result = buildInstantListingScore(buildInstantScoreInput(request.query), config);
    const cashRegister = await recordPaidCompletion("instantScore", 0.001);
    response.json({ ...result, cashRegister });
  });

  app.get(CONVERSION_SCORE_PATH, async (request, response) => {
    const result = buildConversionScore(buildInstantScoreInput(request.query), config);
    const cashRegister = await recordPaidCompletion("conversionScore", 0.001);
    response.json({ ...result, cashRegister });
  });

  app.get(AGENT_LISTING_PATH, async (request, response) => {
    const result = buildAgentListingConversionScore(buildInstantScoreInput(request.query), config);
    const cashRegister = await recordPaidCompletion("agentListingConversion", 0.001);
    response.json({ ...result, cashRegister });
  });

  app.get(QUICK_SCORE_PAID_PATHS, async (request, response) => {
    const result = buildIndexedRoastQuickScore(buildInstantScoreInput(request.query), config);
    const cashRegister = await recordPaidCompletion("indexedRoastGet", 0.001);
    response.json({ ...result, cashRegister });
  });

  app.get(PING_PATH, async (request, response) => {
    const result = buildPingOutput(config, request.query);
    const cashRegister = await recordPaidCompletion("x402Ping", 0.001);
    response.json({ ...result, cashRegister });
  });

  app.get(SITE_AUDIT_PAID_PATHS, async (request, response) => {
    const parsed = discoveryAuditRequestSchema.safeParse(buildDiscoveryAuditInputFromQuery(request.query));
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
      return;
    }

    const result = buildSiteAuditOutput(config, await buildX402DiscoveryAudit(parsed.data));
    const cashRegister = await recordPaidCompletion("x402SiteAudit", 0.001);
    response.json({ ...result, cashRegister });
  });

  app.get(DISCOVERY_AUDIT_PATH, async (request, response) => {
    const parsed = discoveryAuditRequestSchema.safeParse(buildDiscoveryAuditInputFromQuery(request.query));
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
      return;
    }

    const result = buildDiscoveryAuditQuickOutput(config, await buildX402DiscoveryAudit(parsed.data));
    const cashRegister = await recordPaidCompletion("x402DiscoveryAuditQuick", 0.001);
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

    const result = buildListingScoreWithUpgrade(parsed.data, config);
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
