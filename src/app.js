import express from "express";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { getAuthHeaders } from "@coinbase/cdp-sdk/auth";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware } from "@x402/express";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";

import { getCashRegister, recordIntentSignal, recordPaidCompletion, recordSignal } from "./cashRegister.js";
import {
  buildDiscoveryAuditExampleOutput,
  buildX402DiscoveryAudit,
  discoveryAuditOutputSchema,
  discoveryAuditRequestExample,
  discoveryAuditRequestSchema
} from "./discoveryAudit.js";
import { buildListingRoast, buildListingScore, listingRoastRequestSchema, normalizeListingRoastRequestBody, requestExample } from "./roast.js";

const DEFAULT_DEV_PAY_TO = "0x000000000000000000000000000000000000dEaD";
const BASE_MAINNET_NETWORK = "eip155:8453";
const BASE_USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_SEPOLIA_USDC_CONTRACT = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const USDC_DECIMALS = 1_000_000n;
const GZIP_RESPONSE_THRESHOLD_BYTES = 1024;
const COMPRESSIBLE_CONTENT_TYPE = /(json|text|javascript|svg|xml|markdown|linkset)/i;
const ROOT_DIRECTORY_POST_PATH = "/";
const API_ENTRY_PATH = "/api";
const API_V1_ENTRY_PATH = "/api/v1";
const V1_ENTRY_PATH = "/v1";
const INSTANT_SCORE_PATH = "/api/instant-listing-score";
const CONVERSION_SCORE_PATH = "/api/x402-marketplace-conversion";
const AGENT_LISTING_PATH = "/api/agent-listing-conversion";
const AGENT_LISTING_SCORE_PATH = "/api/agent-listing-conversion-score";
const AGENT_LISTING_PAID_PATHS = Object.freeze([AGENT_LISTING_PATH, AGENT_LISTING_SCORE_PATH]);
const ROAST_PATH = "/api/listing-roast";
const FULL_ROAST_GET_PATH = "/api/full-listing-roast";
const QUICK_SCORE_ALIAS_PATHS = Object.freeze([
  "/api/marketplace-listing-score",
  "/api/marketplace-listing-conversion-api",
  "/api/marketplace-listing-conversion",
  "/api/marketplace-product-listing-quality",
  "/api/paid-api-listing-quality",
  "/api/paid-api-listing-quality-score",
  "/api/listing-quality-score-api",
  "/api/agentcore-x402-payments",
  "/api/coinbase-x402-bazaar-mcp-server",
  "/api/x402-listing-quality",
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
    description: "Marketplace listing score x402: $0.001 GET alias for marketplace listing score buyers. Returns the same quick score as the indexed, paid-use-confirmed /api/listing-roast route, with paid API listing quality, buyer-agent skip reasons, and next paid action guidance.",
    keywords: ["marketplace listing score", "Agentic.Market listing score", "agentic market listing score", "marketplace listing quality", "listing quality score", "x402 listing quality", "paid API listing quality"]
  },
  "/api/marketplace-listing-conversion-api": {
    id: "marketplace_listing_conversion_api_alias",
    name: "marketplace_listing_conversion_api",
    operationId: "getMarketplaceListingConversionApiAlias",
    summary: "Paid $0.001 marketplace listing conversion API alias",
    catalogTitle: "GET $0.001 marketplace listing conversion API exact-path quick-score alias",
    description: "Marketplace listing conversion API x402: $0.001 GET exact-path alias for buyer agents searching marketplace listing conversion API. Same quick score as paid-use-confirmed /api/listing-roast, with marketplace conversion score, paid API listing quality, buyer-agent skip reasons, and upgrade guidance.",
    keywords: ["marketplace listing conversion API", "marketplace listing conversion", "marketplace conversion score", "marketplace conversion check", "x402 marketplace conversion", "paid API listing quality", "agent listing conversion score"]
  },
  "/api/marketplace-listing-conversion": {
    id: "marketplace_listing_conversion_alias",
    name: "marketplace_listing_conversion",
    operationId: "getMarketplaceListingConversionAlias",
    summary: "Paid $0.001 marketplace listing conversion alias",
    catalogTitle: "GET $0.001 marketplace listing conversion API quick-score alias",
    description: "Marketplace listing conversion API x402: $0.001 GET alias for buyer agents searching marketplace listing conversion API, marketplace listing conversion, or x402 marketplace conversion. Same quick score as paid-use-confirmed /api/listing-roast, with paid API listing quality, buyer-agent skip reasons, and upgrade guidance.",
    keywords: ["marketplace listing conversion API", "marketplace listing conversion", "marketplace conversion score", "marketplace conversion check", "x402 marketplace conversion", "paid API listing quality", "agent listing conversion score"]
  },
  "/api/marketplace-product-listing-quality": {
    id: "marketplace_product_listing_quality_alias",
    name: "marketplace_product_listing_quality",
    operationId: "getMarketplaceProductListingQualityAlias",
    summary: "Paid $0.001 marketplace product listing quality alias",
    catalogTitle: "GET $0.001 marketplace product listing quality quick-score alias",
    description: "Marketplace product listing quality x402: $0.001 GET exact-phrase alias for buyer agents searching marketplace product listing quality. Returns the same quick score as the indexed, paid-use-confirmed /api/listing-roast route, with listing quality score API, paid API listing quality score, buyer-agent skip reasons, and upgrade guidance.",
    keywords: ["marketplace product listing quality", "score marketplace product listing quality", "listing quality score API", "marketplace listing quality", "paid API listing quality score"]
  },
  "/api/paid-api-listing-quality": {
    id: "paid_api_listing_quality_alias",
    name: "paid_api_listing_quality",
    operationId: "getPaidApiListingQualityAlias",
    summary: "Paid $0.001 paid API listing quality alias",
    catalogTitle: "GET $0.001 paid API listing quality quick-score alias",
    description: "Paid API listing quality score x402: $0.001 GET alias for paid API listing quality buyers. Returns the same quick score as the indexed, paid-use-confirmed /api/listing-roast route, with marketplace listing score, agent service clarity, buyer-agent skip reasons, and upgrade guidance.",
    keywords: ["paid API listing quality", "paid API listing quality score", "paid API listing", "agent-service listing score", "marketplace listing score"]
  },
  "/api/paid-api-listing-quality-score": {
    id: "paid_api_listing_quality_score_alias",
    name: "paid_api_listing_quality_score",
    operationId: "getPaidApiListingQualityScoreAlias",
    summary: "Paid $0.001 paid API listing quality score alias",
    catalogTitle: "GET $0.001 paid API listing quality score quick-score alias",
    description: "Paid API listing quality score x402: $0.001 GET exact-phrase alias for buyer agents searching paid API listing quality score. Returns the same quick score as the indexed, paid-use-confirmed /api/listing-roast route, with marketplace listing score, buyer-agent skip reasons, and upgrade guidance.",
    keywords: ["paid API listing quality score", "paid API listing quality", "paid API listing", "marketplace listing score", "buyer-agent skip reasons"]
  },
  "/api/listing-quality-score-api": {
    id: "listing_quality_score_api_alias",
    name: "listing_quality_score_api",
    operationId: "getListingQualityScoreApiAlias",
    summary: "Paid $0.001 listing quality score API alias",
    catalogTitle: "GET $0.001 listing quality score API quick-score alias",
    description: "Listing quality score API x402: $0.001 GET exact-phrase alias for buyer agents searching listing quality score API. Returns the same quick score as the indexed, paid-use-confirmed /api/listing-roast route, with marketplace product listing quality, paid API listing quality score, buyer-agent skip reasons, and upgrade guidance.",
    keywords: ["listing quality score API", "listing quality score", "marketplace product listing quality", "paid API listing quality score", "marketplace listing score"]
  },
  "/api/agentcore-x402-payments": {
    id: "agentcore_x402_payments_alias",
    name: "agentcore_x402_payments",
    operationId: "getAgentCoreX402PaymentsAlias",
    summary: "Paid $0.001 AgentCore x402 payments alias",
    catalogTitle: "GET $0.001 AgentCore x402 payments quick-score alias",
    description: "AgentCore x402 payments readiness x402: $0.001 GET exact-phrase alias for AgentCore Gateway, Amazon Bedrock AgentCore payments, and Coinbase x402 Bazaar MCP server buyers. Returns the same quick score as the indexed, paid-use-confirmed /api/listing-roast route, with paid API listing quality, buyer-agent skip reasons, and upgrade guidance.",
    keywords: ["AgentCore x402 payments", "Amazon Bedrock AgentCore payments", "AgentCore Gateway", "Coinbase x402 Bazaar MCP server", "x402 Bazaar MCP server", "AgentCore paid API discovery", "paid API listing quality score"]
  },
  "/api/coinbase-x402-bazaar-mcp-server": {
    id: "coinbase_x402_bazaar_mcp_server_alias",
    name: "coinbase_x402_bazaar_mcp_server",
    operationId: "getCoinbaseX402BazaarMcpServerAlias",
    summary: "Paid $0.001 Coinbase x402 Bazaar MCP server alias",
    catalogTitle: "GET $0.001 Coinbase x402 Bazaar MCP server quick-score alias",
    description: "Coinbase x402 Bazaar MCP server readiness x402: $0.001 GET exact-phrase alias for buyers searching Coinbase x402 Bazaar MCP server, x402 Bazaar MCP server, or Bazaar MCP tools. Returns the same quick score as the indexed, paid-use-confirmed /api/listing-roast route, with AgentCore x402 payments, paid API listing quality, buyer-agent skip reasons, and upgrade guidance.",
    keywords: ["Coinbase x402 Bazaar MCP server", "x402 Bazaar MCP server", "Bazaar MCP tools", "Coinbase Bazaar MCP", "AgentCore x402 payments", "paid API listing quality score"]
  },
  "/api/x402-listing-quality": {
    id: "x402_listing_quality_alias",
    name: "x402_listing_quality",
    operationId: "getX402ListingQualityAlias",
    summary: "Paid $0.001 x402 listing quality alias",
    catalogTitle: "GET $0.001 x402 listing quality quick-score alias",
    description: "x402 listing quality score: $0.001 GET exact-phrase alias for buyer agents searching x402 listing quality. Returns the same quick score as the indexed, paid-use-confirmed /api/listing-roast route, with paid API listing quality, marketplace listing score, buyer-agent skip reasons, and upgrade guidance.",
    keywords: ["x402 listing quality", "x402 listing quality score", "paid API listing quality score", "marketplace listing score", "buyer-agent skip reasons"]
  },
  "/api/buyer-agent-skip-reasons": {
    id: "buyer_agent_skip_reasons_alias",
    name: "buyer_agent_skip_reasons",
    operationId: "getBuyerAgentSkipReasonsAlias",
    summary: "Paid $0.001 buyer-agent skip reasons alias",
    catalogTitle: "GET $0.001 buyer-agent skip reasons quick-score alias",
    description: "Buyer-agent skip reasons and buyer agent skip reasons x402: $0.001 GET alias for buyer-agent skip reason searches. Returns the same quick score as the indexed, paid-use-confirmed /api/listing-roast route, with top skip reasons, agent service clarity, and the next paid action.",
    keywords: ["buyer-agent skip reasons", "buyer agent skip reasons", "agent skip reasons", "agent listing conversion", "agent service clarity"]
  },
  "/api/agent-service-clarity": {
    id: "agent_service_clarity_alias",
    name: "agent_service_clarity",
    operationId: "getAgentServiceClarityAlias",
    summary: "Paid $0.001 agent service clarity alias",
    catalogTitle: "GET $0.001 agent service clarity quick-score alias",
    description: "Agent service clarity and agent-service listing score x402: $0.001 GET alias for agent service clarity and promotion-readiness buyers. Returns the same quick score as the indexed, paid-use-confirmed /api/listing-roast route, with buyer-agent skip reasons, marketplace listing quality, and first-fix guidance.",
    keywords: ["agent service clarity", "agent service listing clarity", "agent-service listing score", "agent listing clarity", "agent service promotion readiness"]
  }
});
const SCORE_PATH = "/api/listing-score";
const PING_PATH = "/api/x402-ping";
const SITE_AUDIT_PATH = "/api/x402-site-audit";
const PREFLIGHT_ALIAS_PATHS = Object.freeze(["/api/preflight", "/api/v1/preflight", "/preflight"]);
const SITE_AUDIT_EXACT_ALIAS_PATHS = Object.freeze([
  "/api/x402-buyer-prepay-risk-score",
  "/api/score-x402-endpoint-before-paying",
  "/api/x402-route-health-check",
  "/api/x402-listing-rank-doctor"
]);
const SITE_AUDIT_PAID_PATHS = Object.freeze([SITE_AUDIT_PATH, ...PREFLIGHT_ALIAS_PATHS, ...SITE_AUDIT_EXACT_ALIAS_PATHS]);
const SITE_AUDIT_EXACT_ALIAS_METADATA = Object.freeze({
  "/api/x402-buyer-prepay-risk-score": {
    id: "x402_buyer_prepay_risk_score",
    name: "x402_buyer_prepay_risk_score",
    operationId: "getX402BuyerPrepayRiskScore",
    summary: "Paid $0.001 x402 buyer prepay risk score",
    description: "x402 buyer prepay risk score: $0.001 GET exact-path alias for buyer agents checking whether an x402 endpoint is safe and useful before paying. Returns the existing x402 site-audit output for direct 402 metadata, route health, Bazaar pricing, search visibility, OpenAPI, llms.txt, and no-spend next actions.",
    buyerAction: "Pay $0.001 for an x402 buyer prepay risk score before spending more.",
    keywords: ["x402 buyer prepay risk score", "buyer prepay risk score", "prepay risk score", "x402 prepay risk", "score x402 endpoint before paying", "before paying", "paid API preflight", "x402 site audit", "x402 route health check"]
  },
  "/api/score-x402-endpoint-before-paying": {
    id: "score_x402_endpoint_before_paying",
    name: "score_x402_endpoint_before_paying",
    operationId: "getScoreX402EndpointBeforePaying",
    summary: "Paid $0.001 score x402 endpoint before paying",
    description: "Score x402 endpoint before paying: $0.001 GET exact-path alias for buyer agents that want a cheap prepay check before spending more. Returns the existing x402 site-audit output for direct 402 metadata, route health, Bazaar pricing, search visibility, OpenAPI, llms.txt, and no-spend next actions.",
    buyerAction: "Pay $0.001 to score an x402 endpoint before paying more.",
    keywords: ["score x402 endpoint before paying", "score endpoint before paying", "endpoint before paying", "before paying", "before spending", "pre-pay endpoint check", "paid API preflight", "x402 site audit", "x402 route health check"]
  },
  "/api/x402-route-health-check": {
    id: "x402_route_health_check",
    name: "x402_route_health_check",
    operationId: "getX402RouteHealthCheck",
    summary: "Paid $0.001 x402 route health check",
    description: "x402 route health check: $0.001 GET exact-path alias for buyer agents checking route health, payment challenge correctness, search visibility, and direct 402 metadata before spending more. Returns the existing x402 site-audit output.",
    buyerAction: "Pay $0.001 for an x402 route health check before buying a deeper audit.",
    keywords: ["x402 route health check", "route health check", "x402 route health", "payment challenge health", "direct 402 metadata", "paid API preflight", "x402 site audit", "Bazaar search visibility"]
  },
  "/api/x402-listing-rank-doctor": {
    id: "x402_listing_rank_doctor",
    name: "x402_listing_rank_doctor",
    operationId: "getX402ListingRankDoctor",
    summary: "Paid $0.001 x402 listing rank doctor",
    description: "x402 listing rank doctor: $0.001 GET exact-path alias for sellers and buyer agents diagnosing x402 listing rank, marketplace SEO, seller growth checklist, search visibility, and paid route health before buying the full discovery audit. Returns the existing x402 site-audit output.",
    buyerAction: "Pay $0.001 for an x402 listing rank doctor check before buying the full audit.",
    keywords: ["x402 listing rank doctor", "listing rank doctor", "x402 listing rank", "x402 listing SEO audit", "x402 marketplace SEO audit", "x402 seller growth checklist", "seller growth checklist", "Bazaar search visibility", "paid API preflight"]
  }
});
const DISCOVERY_AUDIT_PATH = "/api/x402-discovery-audit";
const AGENT402_ROUTE_VISIBILITY_PATH = "/api/agent402-route-visibility";
const DISCOVERY_AUDIT_QUICK_PATHS = Object.freeze([DISCOVERY_AUDIT_PATH, AGENT402_ROUTE_VISIBILITY_PATH]);
const PAY_NOW_PATH = "/api/pay-now";
const COMMANDS_PATH = "/api/commands";
const PAID_USAGE_PROOF_PATH = "/api/paid-usage-proof";
const PAID_USAGE_PROOF_ALIAS_PATHS = Object.freeze(["/api/proof", "/proof", "/paid-usage-proof"]);
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
const CDP_DISCOVERY_BASE_URL = "https://api.cdp.coinbase.com/platform/v2/x402/discovery";
const OFFICIAL_CDP_DISCOVERY_SEARCH_QUERY = "marketplace listing score";
const WELL_KNOWN_X402_PATH = "/.well-known/x402";
const WELL_KNOWN_X402_JSON_PATH = "/.well-known/x402.json";
const WELL_KNOWN_OPENAPI_JSON_PATH = "/.well-known/openapi.json";
const WELL_KNOWN_OPENAPI_YAML_PATH = "/.well-known/openapi.yaml";
const API_OPENAPI_JSON_PATH = "/api/openapi.json";
const API_DOCS_OPENAPI_JSON_PATH = "/api-docs/openapi.json";
const WELL_KNOWN_AGENT_CARD_PATH = "/.well-known/agent-card.json";
const WELL_KNOWN_AGENT_JSON_PATH = "/.well-known/agent.json";
const API_X402_JSON_PATH = "/api/x402.json";
const PAYMENT_MANIFEST_PATHS = [
  "/payments.json",
  "/payment.json",
  "/.well-known/payments.json",
  "/.well-known/payment.json"
];
const API_AGENT_CARD_PATH = "/api/agent-card";
const API_AGENT_JSON_PATH = "/api/agent.json";
const WELL_KNOWN_AI_PLUGIN_PATH = "/.well-known/ai-plugin.json";
const WELL_KNOWN_API_CATALOG_PATH = "/.well-known/api-catalog";
const WELL_KNOWN_API_CATALOG_JSON_PATH = "/.well-known/api-catalog.json";
const WELL_KNOWN_AGENT_TOOLS_PATH = "/.well-known/agent-tools.json";
const WELL_KNOWN_AGENT_SKILLS_INDEX_PATH = "/.well-known/agent-skills/index.json";
const WELL_KNOWN_AGENT_SKILL_PATH = "/.well-known/agent-skills/listing-roast-x402/SKILL.md";
const WELL_KNOWN_LLMS_PATH = "/.well-known/llms.txt";
const WELL_KNOWN_LLMS_FULL_PATH = "/.well-known/llms-full.txt";
const WELL_KNOWN_MCP_JSON_PATH = "/.well-known/mcp.json";
const WELL_KNOWN_MCP_PATH = "/.well-known/mcp";
const WELL_KNOWN_MCP_SERVER_PATH = "/.well-known/mcp-server";
const WELL_KNOWN_MCP_SERVER_JSON_PATH = "/.well-known/mcp-server.json";
const WELL_KNOWN_MCP_SERVER_CARD_PATH = "/.well-known/mcp/server-card.json";
const MCP_ROOT_PATH = "/mcp";
const MCP_JSON_PATH = "/mcp.json";
const MCP_SERVER_CARD_PATH = "/mcp/server-card.json";
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
const PAID_API_LISTING_QUALITY_SCORE_PATH = "/paid-api-listing-quality-score";
const LISTING_QUALITY_SCORE_API_PAGE_PATH = "/listing-quality-score-api";
const MARKETPLACE_PRODUCT_LISTING_QUALITY_PAGE_PATH = "/marketplace-product-listing-quality";
const MARKETPLACE_LISTING_CONVERSION_API_PAGE_PATH = "/marketplace-listing-conversion-api";
const MARKETPLACE_LISTING_CONVERSION_PAGE_PATH = "/marketplace-listing-conversion";
const X402_LISTING_QUALITY_PAGE_PATH = "/x402-listing-quality";
const BUYER_AGENT_SKIP_REASONS_PAGE_PATH = "/buyer-agent-skip-reasons";
const AGENT_SERVICE_CLARITY_PAGE_PATH = "/agent-service-clarity";
const AGENT_LISTING_CONVERSION_PAGE_PATH = "/agent-listing-conversion";
const X402_DISCOVERY_AUDIT_PAGE_PATH = "/x402-discovery-audit";
const X402_SITE_AUDIT_PAGE_PATH = "/x402-site-audit";
const X402_BUYER_PREPAY_RISK_SCORE_PAGE_PATH = "/x402-buyer-prepay-risk-score";
const SCORE_X402_ENDPOINT_BEFORE_PAYING_PAGE_PATH = "/score-x402-endpoint-before-paying";
const X402_ROUTE_HEALTH_CHECK_PAGE_PATH = "/x402-route-health-check";
const X402_LISTING_RANK_DOCTOR_PAGE_PATH = "/x402-listing-rank-doctor";
const AGENTCORE_X402_PAYMENTS_PAGE_PATH = "/agentcore-x402-payments";
const COINBASE_X402_BAZAAR_MCP_SERVER_PAGE_PATH = "/coinbase-x402-bazaar-mcp-server";
const INTENT_LANDING_PATHS = [
  PAID_API_LISTING_QUALITY_PATH,
  PAID_API_LISTING_QUALITY_SCORE_PATH,
  LISTING_QUALITY_SCORE_API_PAGE_PATH,
  MARKETPLACE_PRODUCT_LISTING_QUALITY_PAGE_PATH,
  MARKETPLACE_LISTING_CONVERSION_API_PAGE_PATH,
  MARKETPLACE_LISTING_CONVERSION_PAGE_PATH,
  X402_LISTING_QUALITY_PAGE_PATH,
  BUYER_AGENT_SKIP_REASONS_PAGE_PATH,
  AGENT_SERVICE_CLARITY_PAGE_PATH,
  AGENT_LISTING_CONVERSION_PAGE_PATH,
  X402_DISCOVERY_AUDIT_PAGE_PATH,
  X402_SITE_AUDIT_PAGE_PATH,
  X402_BUYER_PREPAY_RISK_SCORE_PAGE_PATH,
  SCORE_X402_ENDPOINT_BEFORE_PAYING_PAGE_PATH,
  X402_ROUTE_HEALTH_CHECK_PAGE_PATH,
  X402_LISTING_RANK_DOCTOR_PAGE_PATH,
  AGENTCORE_X402_PAYMENTS_PAGE_PATH,
  COINBASE_X402_BAZAAR_MCP_SERVER_PAGE_PATH
];
const API_V1_OPENAPI_JSON_PATH = "/api/v1/openapi.json";
const SWAGGER_JSON_PATH = "/swagger.json";
const OPENAPI_YAML_PATH = "/openapi.yaml";
const OPENAPI_JSON_PATHS = [
  "/openapi.json",
  WELL_KNOWN_OPENAPI_JSON_PATH,
  API_OPENAPI_JSON_PATH,
  API_DOCS_OPENAPI_JSON_PATH,
  API_V1_OPENAPI_JSON_PATH,
  SWAGGER_JSON_PATH
];
const OPENAPI_YAML_PATHS = [OPENAPI_YAML_PATH, WELL_KNOWN_OPENAPI_YAML_PATH];
const SCHEMA_JSON_PATH = "/schema.json";
const API_SAMPLE_PATH = "/api/sample";
const API_SAMPLE_SCORE_PATH = "/api/sample-score";
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
  "marketplace product listing quality",
  "Agentic.Market listing score",
  "score marketplace product listing quality",
  "marketplace listing conversion API",
  "marketplace listing conversion",
  "listing quality score API",
  "paid API listing quality score",
  "agent-service listing score",
  "x402 marketplace conversion",
  "x402 site audit",
  "x402 service discoverability audit",
  "x402 route health check",
  "x402 buyer prepay risk score",
  "score x402 endpoint before paying",
  "x402 navigation",
  "API entrypoint",
  "route map",
  "paid API preflight",
  "x402 discovery audit",
  "x402 bazaar discovery audit",
  "AgentCore x402 payments",
  "Amazon Bedrock AgentCore payments",
  "AgentCore Gateway",
  "Coinbase x402 Bazaar MCP server",
  "x402 Bazaar MCP server",
  "Bazaar MCP tools",
  "Coinbase Bazaar MCP",
  "AgentCore paid API discovery",
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
const DISCOVERY_DESCRIPTION = "Score paid API listing quality, x402 marketplace conversion, Agentic.Market listing score, AgentCore x402 payments readiness, and agent listing conversion before promotion: paid x402 listing quality score API for marketplace product listing quality, marketplace listing conversion API, paid API listing quality score, Coinbase x402 Bazaar MCP server buyers, AgentCore Gateway discovery, agent listing conversion score, agent-service listing clarity, buyer-agent skip reasons, marketplace listing conversion, x402 seller discoverability, listing SEO audit, seller growth checklist, and agent service promotion readiness.";
const SERVICE_CATEGORY = "paid-api-listing";
const SERVICE_TAGS = Object.freeze([
  "x402",
  "paid API listing quality score",
  "listing quality score API",
  "Agentic.Market listing score",
  "marketplace product listing quality",
  "paid API listing quality",
  "marketplace listing score",
  "marketplace listing conversion API",
  "marketplace listing conversion",
  "x402 marketplace conversion",
  "API marketplace listing quality",
  "listing discoverability",
  "metadata quality",
  "pricing clarity",
  "buyer intent",
  "keyword coverage",
  "buyer-agent skip reasons",
  "buyer agent skip reasons",
  "agent listing conversion",
  "agent-service listing score",
  "agent service clarity",
  "x402 discovery audit",
  "paid API preflight",
  "route health",
  "x402 buyer prepay risk score",
  "score x402 endpoint before paying",
  "x402 route health check",
  "x402 listing rank doctor",
  "Coinbase x402 Bazaar MCP server",
  "x402 Bazaar MCP server"
]);
const DIRECTORY_POST_DESCRIPTION = "Listing Roast directory handoff: $0.001 POST root route for buyer agents following generic marketplace or agent-tools snippets; returns an included quick score, route map, indexed /api/listing-roast handoff, prices, and next paid actions.";
const INDEXED_QUICK_SCORE_DESCRIPTION = "Listing Roast helps x402 and AgentCore sellers see why buyer agents skip a paid API. Pay $0.001 GET /api/listing-roast for a paid API listing quality score, listing quality score API, marketplace product listing quality, Agentic.Market listing score, AgentCore Gateway and AgentCore x402 payments readiness, Coinbase x402 Bazaar MCP server buyers, marketplace listing conversion API, marketplace listing score, x402 marketplace conversion, buyer-agent skip reasons, buyer agent skip reasons, agent listing conversion score, agent service clarity, agent-service listing score, x402 discovery audit, x402 site audit, paid API preflight, route health, stale Bazaar price, Bazaar search visibility, and x402 seller growth checklist; upgrade with GET /api/full-listing-roast.";
const INDEXED_QUICK_SCORE_CHALLENGE_DESCRIPTION = "Listing Roast x402: $0.001 GET /api/listing-roast paid API listing quality score for listing quality score API, marketplace product listing quality, Agentic.Market listing score, AgentCore Gateway, AgentCore x402 payments, Coinbase x402 Bazaar MCP server buyers, marketplace conversion API, agent listing conversion score, buyer-agent skip reasons, buyer agent skip reasons, agent service clarity, x402 discovery audit, x402 site audit, paid API preflight, route health, stale Bazaar price; GET /api/full-listing-roast upgrade.";
const FULL_ROAST_GET_DESCRIPTION = "Full Listing Roast by Listing Roast: $0.01 GET /api/full-listing-roast for high-intent buyers who want buyer-agent skip reasons, top fixes, rewritten listing copy, and stop-or-upgrade guidance without assembling a POST body. Uses query params or safe defaults; POST /api/listing-roast remains the custom-body full roast.";
const FULL_ROAST_GET_CHALLENGE_DESCRIPTION = "Full Listing Roast x402: $0.01 GET full listing roast, buyer-agent skip reasons, top fixes, rewritten listing copy, stop-or-upgrade guidance, and launch guidance for paid API and x402 marketplace sellers.";
const INDEXED_QUICK_SCORE_SEARCH_PHRASES = Object.freeze([
  "listing quality score API",
  "marketplace product listing quality",
  "paid API listing quality score",
  "marketplace listing score",
  "marketplace listing conversion API",
  "x402 marketplace conversion",
  "agent listing conversion",
  "agent listing conversion score",
  "buyer-agent skip reasons",
  "buyer agent skip reasons",
  "agent service clarity",
  "agent-service listing score",
  "x402 site audit",
  "x402 discovery audit",
  "AgentCore x402 payments",
  "Coinbase x402 Bazaar MCP server"
]);
const AGENT_LISTING_CONVERSION_DESCRIPTION = "Agent Listing Conversion Score by Listing Roast: $0.001 GET agent listing conversion score, agent_listing_conversion_score, agent listing conversion, buyer-agent skip reasons, buyer agent skip reasons, agent service listing clarity, and agent service promotion readiness for paid API and x402 marketplace sellers. Exact score alias /api/agent-listing-conversion-score and canonical /api/agent-listing-conversion return the same paid JSON score, buyer intent read, and first-fix upgrade guidance.";
const X402_SERVICE_NAME = "Listing Roast x402";
const DISCOVERY_METADATA_VERSION = "2026-06-20-quick-route-conversion-handoff-v44";
const DISCOVERY_METADATA_UPDATED_AT = "2026-06-21T02:45:00.000Z";
const RECEIVER_WALLET_SNAPSHOT_CACHE_MS = 60000;
let receiverWalletSnapshotCache = null;
const ROUTE_SERVICE_NAMES = Object.freeze({
  indexedQuickScore: "Listing Roast x402 Paid API Listing Quality Score"
});
const ROUTE_SERVICE_TAGS = Object.freeze({
  directoryPost: ["x402", "agent-tools", "directory handoff", "paid API", "route map"],
  apiEntry: ["x402", "paid API", "route map", "API entrypoint", "listing quality"],
  listingScore: ["x402", "paid API listing quality", "agent service clarity", "marketplace conversion", "discoverability"],
  instantScore: ["x402", "paid API listing quality", "marketplace listing score", "agent service clarity", "discoverability"],
  conversionScore: ["x402", "marketplace conversion", "paid API listing quality", "buyer-agent", "listing quality"],
  agentListingConversion: ["x402", "agent listing conversion score", "agent listing conversion", "buyer-agent skip reasons", "buyer agent skip reasons", "agent service clarity", "agent service promotion readiness", "listing conversion", "paid API"],
  indexedQuickScore: ["x402", "listing quality score API", "marketplace product listing quality", "paid API listing quality score", "paid API listing quality", "AgentCore x402 payments", "Coinbase x402 Bazaar MCP server", "marketplace listing score", "marketplace listing conversion API", "x402 marketplace conversion", "agent listing conversion", "buyer-agent skip reasons", "agent-service listing score", "x402 site audit", "x402 discovery audit", "paid API preflight", "agent service clarity", "route health"],
  x402Ping: ["x402", "payment rail", "paid API", "route health", "Base USDC"],
  x402SiteAudit: ["x402", "x402 site audit", "discovery audit", "x402 buyer prepay risk score", "score x402 endpoint before paying", "x402 seller discoverability", "fix x402 Bazaar listing", "x402 catalog metadata quality", "x402 route health check", "x402 listing SEO audit", "x402 listing rank doctor", "x402 seller growth checklist", "x402 seller intelligence", "x402 marketplace SEO audit", "paid API preflight", "route health", "Bazaar search visibility", "stale Bazaar price"],
  discoveryAuditQuick: ["x402", "Bazaar visibility", "Agent402 route visibility", "Agent402 router", "discovery audit", "x402 seller discoverability", "fix x402 Bazaar listing", "x402 listing SEO audit", "x402 listing rank doctor", "paid API preflight", "route health"],
  discoveryAudit: ["x402", "Bazaar visibility", "Agent402 route visibility", "Agent402 router", "discovery audit", "fix x402 Bazaar listing", "x402 catalog metadata quality", "x402 listing SEO audit", "x402 listing rank doctor", "x402 seller growth checklist", "x402 seller intelligence", "x402 marketplace SEO audit", "stale Bazaar price", "paid API preflight"],
  fullRoast: ["x402", "listing roast", "full listing roast", "marketplace conversion", "paid API listing quality", "buyer-agent skip reasons", "top fixes", "rewritten listing"]
});
const CHALLENGE_ROUTE_SERVICE_TAGS = Object.freeze({
  indexedQuickScore: ["x402", "paid API listing quality score", "AgentCore x402 payments", "Coinbase x402 Bazaar MCP server", "marketplace listing score", "buyer agent skip reasons", "x402 marketplace conversion", "x402 discovery audit", "paid API preflight", "stale Bazaar price"],
  x402SiteAudit: ["x402", "x402 site audit", "x402 buyer prepay risk score", "score x402 endpoint before paying", "x402 marketplace SEO audit", "x402 seller growth checklist", "x402 listing SEO audit", "paid API preflight", "x402 route health check", "route health", "Bazaar search visibility", "stale Bazaar price"],
  discoveryAuditQuick: ["x402", "x402 discovery audit", "Bazaar visibility", "Agent402 route visibility", "paid API preflight", "route health"],
  discoveryAudit: ["x402", "x402 discovery audit", "Bazaar visibility", "Agent402 route visibility", "stale Bazaar price", "paid API preflight"]
});
const LISTING_QUERY_PARAMETER_EXAMPLES = Object.freeze({
  agentName: "Listing Roast x402",
  listingText: "Score marketplace product listing quality, paid API listing quality, marketplace listing score, AgentCore Gateway, Coinbase x402 Bazaar MCP, x402 marketplace conversion, agent listing conversion score, buyer-agent skip reasons, and agent-service clarity. Start with $0.001 GET /api/listing-roast; buy $0.01 GET /api/full-listing-roast for full roast; POST /api/listing-roast for custom-body input.",
  targetBuyer: "x402, MCP, and AgentCore Gateway builders",
  currentPrice: "$0.001 GET; $0.01 GET/POST roast",
  currentCheckoutPath: "/api/listing-roast",
  goal: "Convert buyer agents through the lowest-friction paid score, then upgrade promising buyers to the $0.01 full roast while keeping custom-body and audit handoffs available."
});
const quickScoreRequestExample = Object.freeze({
  ...LISTING_QUERY_PARAMETER_EXAMPLES
});
const INDEXED_QUICK_SCORE_STALE_SOURCE = "indexed-get-score-stale-bazaar-cache-normalized";
function quickScoreAliasInputDefaults(routePath) {
  const metadata = QUICK_SCORE_ALIAS_METADATA[routePath];
  if (!metadata) {
    return quickScoreRequestExample;
  }

  const primaryIntent = metadata.keywords[0] || metadata.name.replaceAll("_", " ");
  const supportingIntents = metadata.keywords.slice(1, 4).join(", ");

  return {
    ...quickScoreRequestExample,
    listingText: `A $0.001 x402 quick score for ${primaryIntent}${supportingIntents ? `, ${supportingIntents}` : ""}. Use exact GET ${routePath} when a buyer agent searches that phrase, then buy GET ${FULL_ROAST_GET_PATH} for the $0.01 full roast when the score shows enough fit.`,
    targetBuyer: `buyer agents searching ${primaryIntent}`,
    currentCheckoutPath: routePath,
    goal: `Convert buyer agents searching "${primaryIntent}" through exact GET ${routePath}; keep the first paid action at $0.001 and hand off to the $0.01 direct full roast only after fit is proven.`
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
  agent_listing_conversion_score_alias: "agentListingConversion",
  x402_ping: "x402Ping",
  x402_site_audit: "x402SiteAudit",
  marketplace_listing_score_alias: "indexedQuickScore",
  marketplace_listing_conversion_api_alias: "indexedQuickScore",
  marketplace_listing_conversion_alias: "indexedQuickScore",
  marketplace_product_listing_quality_alias: "indexedQuickScore",
  paid_api_listing_quality_alias: "indexedQuickScore",
  paid_api_listing_quality_score_alias: "indexedQuickScore",
  listing_quality_score_api_alias: "indexedQuickScore",
  agentcore_x402_payments_alias: "indexedQuickScore",
  coinbase_x402_bazaar_mcp_server_alias: "indexedQuickScore",
  x402_listing_quality_alias: "indexedQuickScore",
  buyer_agent_skip_reasons_alias: "indexedQuickScore",
  agent_service_clarity_alias: "indexedQuickScore",
  paid_api_preflight: "x402SiteAudit",
  api_v1_paid_api_preflight: "x402SiteAudit",
  root_paid_api_preflight: "x402SiteAudit",
  x402_buyer_prepay_risk_score: "x402SiteAudit",
  score_x402_endpoint_before_paying: "x402SiteAudit",
  x402_route_health_check: "x402SiteAudit",
  x402_listing_rank_doctor: "x402SiteAudit",
  agent402_route_visibility_audit: "discoveryAuditQuick",
  x402_discovery_audit_quick: "discoveryAuditQuick",
  x402_discovery_audit: "discoveryAudit",
  full_listing_roast_get: "fullRoastGet",
  listing_score: "listingScore",
  listing_roast: "fullRoast"
});
const LISTING_REQUEST_SCHEMA_PROPERTIES = {
  agentName: {
    type: "string",
    description: "Name of the paid API, MCP tool, agent service, or listing. Aliases: serviceName,name,agent,title.",
    example: LISTING_QUERY_PARAMETER_EXAMPLES.agentName
  },
  listingText: {
    type: "string",
    description: "buyer-facing listing copy, README excerpt, marketplace description, or route summary. Aliases: description,listing,copy,summary.",
    example: LISTING_QUERY_PARAMETER_EXAMPLES.listingText
  },
  targetBuyer: {
    type: "string",
    description: "Buyer/agent persona to convert, such as x402 builders or API buyers. Aliases: buyer,audience,targetAudience.",
    example: LISTING_QUERY_PARAMETER_EXAMPLES.targetBuyer
  },
  currentPrice: {
    type: "string",
    description: "Advertised price or max x402 amount before payment. Aliases: price,amount.",
    example: LISTING_QUERY_PARAMETER_EXAMPLES.currentPrice
  },
  currentCheckoutPath: {
    type: "string",
    description: "Endpoint, checkout path, or x402 route. Aliases: checkoutPath,path,route,url,endpointUrl,resource.",
    example: LISTING_QUERY_PARAMETER_EXAMPLES.currentCheckoutPath
  },
  goal: {
    type: "string",
    description: "Goal: more paid completions. Alias: objective.",
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

function x402ManifestAliasUrls(config) {
  return [WELL_KNOWN_X402_JSON_PATH, WELL_KNOWN_X402_PATH, API_X402_JSON_PATH, ...PAYMENT_MANIFEST_PATHS].map((pathname) => absoluteUrl(config, pathname));
}

function formatX402ManifestAliasUrls(config) {
  return x402ManifestAliasUrls(config).join(", ");
}

function openApiAliasUrls(config) {
  return [WELL_KNOWN_OPENAPI_JSON_PATH, API_OPENAPI_JSON_PATH, API_DOCS_OPENAPI_JSON_PATH, API_V1_OPENAPI_JSON_PATH, SWAGGER_JSON_PATH].map((pathname) => absoluteUrl(config, pathname));
}

function openApiYamlAliasUrls(config) {
  return OPENAPI_YAML_PATHS.map((pathname) => absoluteUrl(config, pathname));
}

function mcpAliasUrls(config) {
  return [WELL_KNOWN_MCP_PATH, WELL_KNOWN_MCP_SERVER_PATH, WELL_KNOWN_MCP_SERVER_JSON_PATH, MCP_ROOT_PATH, MCP_JSON_PATH].map((pathname) => absoluteUrl(config, pathname));
}

function mcpServerCardAliasUrls(config) {
  return [MCP_SERVER_CARD_PATH].map((pathname) => absoluteUrl(config, pathname));
}

function agentCardAliasUrls(config) {
  return [WELL_KNOWN_AGENT_JSON_PATH, API_AGENT_CARD_PATH, API_AGENT_JSON_PATH].map((pathname) => absoluteUrl(config, pathname));
}

function formatAgentCardAliasUrls(config) {
  return agentCardAliasUrls(config).join(", ");
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

function appendVaryHeader(value, headerName) {
  const headers = String(value || "")
    .split(",")
    .map((header) => header.trim())
    .filter(Boolean);
  const alreadyPresent = headers.some((header) => header === "*" || header.toLowerCase() === headerName.toLowerCase());
  return alreadyPresent ? (value || headerName) : [...headers, headerName].join(", ");
}

function gzipLargeTextResponses(request, response, next) {
  if (!/\bgzip\b/i.test(request.get("accept-encoding") || "")) {
    next();
    return;
  }

  const originalSend = response.send.bind(response);
  response.send = (body) => {
    if (
      response.get("content-encoding") ||
      response.statusCode === 204 ||
      response.statusCode === 304 ||
      !(Buffer.isBuffer(body) || typeof body === "string")
    ) {
      return originalSend(body);
    }

    const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const contentType = response.get("content-type") || "";
    if (bodyBuffer.byteLength < GZIP_RESPONSE_THRESHOLD_BYTES || !COMPRESSIBLE_CONTENT_TYPE.test(contentType)) {
      return originalSend(body);
    }

    const gzippedBody = gzipSync(bodyBuffer);
    response.set("content-encoding", "gzip");
    response.set("vary", appendVaryHeader(response.get("vary"), "Accept-Encoding"));
    response.set("content-length", String(gzippedBody.byteLength));
    return originalSend(gzippedBody);
  };

  next();
}

function routeTags(routeKey) {
  return ROUTE_SERVICE_TAGS[routeKey] || [];
}

function enrichManifestResource(resource, config) {
  const routeKey = MANIFEST_RESOURCE_ROUTE_KEYS[resource.id];
  const { serviceName, tags } = routeServiceMetadata(routeKey);
  const agentPaymentRequest = buildAgentPaymentRequest(resource);
  return {
    serviceName,
    ...resource,
    route: resource.url,
    agentPaymentRequest,
    agentPaymentPrompt: agentPaymentRequest.prompt,
    maxPaymentUsd: agentPaymentRequest.maxPayment,
    tags,
    keywords: uniqueTerms([...(resource.keywords || []), ...tags])
  };
}

function buildManifestActionAliases(config, resources) {
  return resources.map((resource) => ({
    id: resource.id,
    name: resource.name,
    title: resource.name,
    description: resource.description,
    method: resource.method,
    path: resource.path,
    url: resource.url,
    route: resource.url,
    price: resource.price,
    priceUsd: priceToUsd(resource.price),
    maxAmountRequired: resource.maxAmountRequired,
    max_amount_required: resource.maxAmountRequired,
    maxPaymentUsd: resource.maxPaymentUsd,
    max_payment_usd: resource.maxPaymentUsd,
    agentPaymentRequest: resource.agentPaymentRequest,
    agentPaymentPrompt: resource.agentPaymentPrompt,
    network: config.network,
    paymentRequired: true,
    x402: {
      network: config.network,
      asset: "USDC",
      payTo: config.payTo,
      maxAmountRequired: resource.maxAmountRequired
    },
    command: resource.command,
    schema: resource.schema,
    tags: resource.tags || [],
    keywords: resource.keywords || [],
    preferredFirstPaidAction: resource.id === "indexed_roast_quick_score",
    ...(resource.canonicalRoute ? { canonicalRoute: resource.canonicalRoute } : {})
  }));
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
    [FULL_ROAST_GET_PATH, "GET $0.01 full listing roast"],
    ...QUICK_SCORE_ALIAS_PATHS.map((pathname) => [
      pathname,
      QUICK_SCORE_ALIAS_METADATA[pathname].catalogTitle.replace(" quick-score alias", "")
    ])
  ].map(([pathname, title]) => `<${absoluteUrl(config, pathname)}>; rel="payment"; type="application/json"; title="${title}"`);

  return [
    `<${absoluteUrl(config, "/x402.json")}>; rel="payment"; type="application/json"`,
    ...exactPaidRouteLinks,
    `<${absoluteUrl(config, WELL_KNOWN_X402_JSON_PATH)}>; rel="service-desc"; type="application/json"`,
    `<${absoluteUrl(config, WELL_KNOWN_X402_PATH)}>; rel="service-desc"; type="application/json"`,
    `<${absoluteUrl(config, API_X402_JSON_PATH)}>; rel="service-desc"; type="application/json"`,
    `<${absoluteUrl(config, PAY_NOW_PATH)}>; rel="help"; type="application/json"`,
    `<${absoluteUrl(config, COMMANDS_PATH)}>; rel="help"; type="application/json"; title="compact pay command handoff"`,
    `<${absoluteUrl(config, PAID_USAGE_PROOF_PATH)}>; rel="service-meta"; type="application/json"; title="wallet-backed paid-use proof"`,
    ...PAID_USAGE_PROOF_ALIAS_PATHS.map((pathname) => `<${absoluteUrl(config, pathname)}>; rel="service-meta"; type="application/json"; title="paid-use proof alias"`),
    `<${absoluteUrl(config, PRICING_PATH)}>; rel="service-meta"; type="application/json"`,
    `<${absoluteUrl(config, FIND_PATH)}>; rel="search"; type="application/json"`,
    `<${absoluteUrl(config, ROUTE_PATH)}>; rel="service-meta"; type="application/json"`,
    `<${absoluteUrl(config, LOCAL_DISCOVERY_RESOURCE_PATHS[0])}>; rel="service-meta"; type="application/json"`,
    `<${absoluteUrl(config, LOCAL_DISCOVERY_SEARCH_PATHS[0])}>; rel="search"; type="application/json"`,
    `<${absoluteUrl(config, "/openapi.json")}>; rel="describedby"; type="application/vnd.oai.openapi+json"`,
    `<${absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH)}>; rel="describedby"; type="application/vnd.oai.openapi+json"`,
    `<${absoluteUrl(config, API_V1_OPENAPI_JSON_PATH)}>; rel="describedby"; type="application/vnd.oai.openapi+json"`,
    `<${absoluteUrl(config, SWAGGER_JSON_PATH)}>; rel="describedby"; type="application/vnd.oai.openapi+json"`,
    `<${absoluteUrl(config, SCHEMA_JSON_PATH)}>; rel="describedby"; type="application/json"`,
    `<${absoluteUrl(config, API_SAMPLE_PATH)}>; rel="service-meta"; type="application/json"; title="sample score JSON alias"`,
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
    `<${absoluteUrl(config, WELL_KNOWN_MCP_SERVER_JSON_PATH)}>; rel="service-desc"; type="application/json"`,
    `<${absoluteUrl(config, MCP_ROOT_PATH)}>; rel="service-desc"; type="application/json"`,
    `<${absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH)}>; rel="mcp-server-card"; type="application/json"`,
    `<${absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH)}>; rel="service-desc"; type="application/json"`,
    `<${absoluteUrl(config, WELL_KNOWN_AGENT_JSON_PATH)}>; rel="service-desc"; type="application/json"`,
    `<${absoluteUrl(config, API_AGENT_CARD_PATH)}>; rel="service-desc"; type="application/json"`,
    `<${absoluteUrl(config, API_AGENT_JSON_PATH)}>; rel="service-desc"; type="application/json"`,
    `<${absoluteUrl(config, WELL_KNOWN_AI_PLUGIN_PATH)}>; rel="service-desc"; type="application/json"`,
    `<${absoluteUrl(config, WELL_KNOWN_API_CATALOG_PATH)}>; rel="api-catalog"; type="application/linkset+json"`,
    `<${absoluteUrl(config, WELL_KNOWN_API_CATALOG_JSON_PATH)}>; rel="api-catalog"; type="application/linkset+json"`,
    `<${absoluteUrl(config, WELL_KNOWN_AGENT_TOOLS_PATH)}>; rel="service-desc"; type="application/json"`,
    `<${absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH)}>; rel="agent-skills"; type="application/json"`,
    `<${absoluteUrl(config, ICON_SVG_PATH)}>; rel="icon"; type="image/svg+xml"`
  ].join(", ");
}

function isPaidRouteRequest(method, pathname) {
  const normalizedMethod = String(method || "GET").toUpperCase();

  if (normalizedMethod === "POST") {
    return [ROOT_DIRECTORY_POST_PATH, ROAST_PATH, SCORE_PATH, DISCOVERY_AUDIT_PATH].includes(pathname);
  }

  if (normalizedMethod !== "GET" && normalizedMethod !== "HEAD") {
    return false;
  }

  return [
    API_ENTRY_PATH,
    API_V1_ENTRY_PATH,
    V1_ENTRY_PATH,
    INSTANT_SCORE_PATH,
    CONVERSION_SCORE_PATH,
    ...AGENT_LISTING_PAID_PATHS,
    ROAST_PATH,
    FULL_ROAST_GET_PATH,
    PING_PATH,
    ...DISCOVERY_AUDIT_QUICK_PATHS,
    ...QUICK_SCORE_ALIAS_PATHS,
    ...SITE_AUDIT_PAID_PATHS
  ].includes(pathname);
}

function buildCompactPaidRouteLinks(config, pathname) {
  const routePath = pathname || ROAST_PATH;
  const routeTitle = QUICK_SCORE_ALIAS_METADATA[routePath]?.catalogTitle
    || (routePath === ROAST_PATH
      ? "GET $0.001 indexed listing-roast quick score"
      : routePath === FULL_ROAST_GET_PATH
        ? "GET $0.01 full listing roast"
      : routePath === AGENT402_ROUTE_VISIBILITY_PATH
        ? "GET $0.001 Agent402 route visibility audit"
        : routePath === DISCOVERY_AUDIT_PATH
          ? "GET $0.001 x402 discovery audit quick check"
          : "x402 paid route");
  const routeMethod = routePath === ROOT_DIRECTORY_POST_PATH ? "POST" : "GET";
  const intentRouteKey = inferPaymentHintIntentRouteKey(routePath, routeMethod);
  const selectedRoute = { path: routePath };
  const payNowIntent = payNowIntentForSelection(intentRouteKey, selectedRoute);
  const payNowUrl = payNowUrlForSelection(config, intentRouteKey, selectedRoute);
  const commandsUrl = payNowIntent
    ? `${absoluteUrl(config, COMMANDS_PATH)}?intent=${encodeURIComponent(payNowIntent)}`
    : absoluteUrl(config, COMMANDS_PATH);

  return [
    `<${absoluteUrl(config, routePath)}>; rel="payment"; type="application/json"; title="${routeTitle}"`,
    `<${absoluteUrl(config, "/x402.json")}>; rel="payment"; type="application/json"`,
    `<${absoluteUrl(config, WELL_KNOWN_X402_JSON_PATH)}>; rel="service-desc"; type="application/json"`,
    `<${payNowUrl}>; rel="help"; type="application/json"`,
    `<${commandsUrl}>; rel="help"; type="application/json"`,
    `<${absoluteUrl(config, PAID_USAGE_PROOF_PATH)}>; rel="service-meta"; type="application/json"`,
    `<${absoluteUrl(config, "/openapi.json")}>; rel="describedby"; type="application/vnd.oai.openapi+json"`,
    `<${absoluteUrl(config, WELL_KNOWN_AGENT_TOOLS_PATH)}>; rel="service-desc"; type="application/json"`
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
          url: absoluteUrl(config, AGENT_LISTING_SCORE_PATH)
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
          name: "Direct full listing roast",
          price: "0.01",
          priceCurrency: "USD",
          url: absoluteUrl(config, FULL_ROAST_GET_PATH)
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
          name: "Custom-body listing conversion roast",
          price: "0.01",
          priceCurrency: "USD",
          url: absoluteUrl(config, ROAST_PATH)
        }
      ]
    }
  };
}

function buildPayCommand(config, pathname = ROAST_PATH, maxAmount = "10000", body = requestExample) {
  return `npx awal@2.8.0 x402 pay ${shellQuote(absoluteUrl(config, pathname))} \\
  -X POST \\
  -d ${shellQuote(JSON.stringify(body))} \\
  --max-amount ${maxAmount}`;
}

function buildPostPayCommand(config, pathname = ROOT_DIRECTORY_POST_PATH, maxAmount = INSTANT_SCORE_AMOUNT) {
  return `npx awal@2.8.0 x402 pay ${shellQuote(absoluteUrl(config, pathname))} \\
  -X POST \\
  --max-amount ${maxAmount}`;
}

function buildGetPayCommand(config, pathname = INSTANT_SCORE_PATH, maxAmount = INSTANT_SCORE_AMOUNT) {
  return `npx awal@2.8.0 x402 pay ${shellQuote(absoluteUrl(config, pathname))} \\
  -X GET \\
  --max-amount ${maxAmount}`;
}

function buildGetPayCommandWithQuery(config, pathname = ROAST_PATH, maxAmount = INSTANT_SCORE_AMOUNT, query = quickScoreRequestExample) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, String(value));
    }
  }
  const queryString = searchParams.toString();
  const pathWithQuery = queryString ? `${pathname}?${queryString}` : pathname;

  return buildGetPayCommand(config, pathWithQuery, maxAmount);
}

function sha256Digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function formatPaidUseProofMarkdown(config, cashRegister = {}) {
  const proof = buildPaidUsageProof(config, cashRegister);
  return `Paid-use proof before payment: ${proof.proofText}. Preferred converted route: GET ${absoluteUrl(config, proof.preferredConvertedRoute.path)} (${proof.preferredConvertedRoute.price}, max ${proof.preferredConvertedRoute.maxAmountRequired} USDC units). Proof JSON: ${absoluteUrl(config, PAID_USAGE_PROOF_PATH)}. Cash register: ${proof.cashRegister}.`;
}

function buildBazaarCatalogingGuidance(config) {
  return {
    noSelfPay: true,
    note: "For legitimate paid use from a custom x402 client, preserve the 402 response extensions.bazaar metadata in the payment payload when the client supports extensions; this helps CDP Bazaar catalog the route after settlement.",
    doNot: "Do not pay only to refresh Bazaar search or directory metadata.",
    preferredFreeChecks: [
      absoluteUrl(config, PAID_USAGE_PROOF_PATH),
      absoluteUrl(config, COMMANDS_PATH),
      absoluteUrl(config, PAY_NOW_PATH)
    ]
  };
}

function formatBazaarCatalogingMarkdown(config) {
  const guidance = buildBazaarCatalogingGuidance(config);
  return `Bazaar cataloging note: ${guidance.note} ${guidance.doNot}`;
}

function buildAgentSkillMarkdown(config, cashRegister = {}) {
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
- Compact command handoff: ${absoluteUrl(config, COMMANDS_PATH)}?intent=paid%20API%20listing%20quality
- Pay-now handoff: ${absoluteUrl(config, PAY_NOW_PATH)}?intent=buyer-agent%20skip%20reasons
- Full-roast pay-now handoff: ${absoluteUrl(config, PAY_NOW_PATH)}?intent=full%20roast%20rewrite%20top%20fixes
- Paid-use proof: ${absoluteUrl(config, PAID_USAGE_PROOF_PATH)}
- Pricing catalog: ${absoluteUrl(config, PRICING_PATH)}
- Route finder: ${absoluteUrl(config, FIND_PATH)}?q=x402%20discovery%20audit
- Full-roast route finder: ${absoluteUrl(config, FIND_PATH)}?q=listing%20roast%20full%20rewrite
- Local route router: ${absoluteUrl(config, ROUTE_PATH)}?query=x402%20discovery%20audit&top=3
- Full-roast local router: ${absoluteUrl(config, ROUTE_PATH)}?query=listing%20roast%20full%20rewrite&top=3
- Route guide: ${absoluteUrl(config, "/llms.txt")}
- Full route guide: ${absoluteUrl(config, LLMS_FULL_PATH)}
- MCP metadata: ${absoluteUrl(config, WELL_KNOWN_MCP_JSON_PATH)}
- MCP discovery aliases: ${absoluteUrl(config, WELL_KNOWN_MCP_PATH)}, ${absoluteUrl(config, WELL_KNOWN_MCP_SERVER_PATH)}
- MCP server card: ${absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH)}

## Paid-Use Proof Before Payment

${formatPaidUseProofMarkdown(config, cashRegister)}

## Payment Rule

Do not call paid routes unless the buyer explicitly intends to pay. Paid calls require x402 payment in USDC on ${config.network}. Use the max amount shown below.

Agent payment prompt: ${formatIndexedQuickScoreAgentPaymentPrompt(config)}

## Bazaar Cataloging Note

${formatBazaarCatalogingMarkdown(config)}

## Preferred First Paid Action

Use this when a buyer wants the cheapest live score for listing quality, paid API discoverability, x402 marketplace conversion, agent listing conversion score, x402 listing quality, buyer-agent skip reasons, or agent-service listing clarity:

\`\`\`bash
${buildGetPayCommand(config, ROAST_PATH)}
\`\`\`

Expected price: ${config.instantScorePrice}. Max amount: ${INSTANT_SCORE_AMOUNT} USDC units.

Agent payment prompt: ${formatIndexedQuickScoreAgentPaymentPrompt(config)}

Exact buyer-phrase aliases for the same quick score:

${QUICK_SCORE_ALIAS_PATHS.map((pathname) => `- GET ${absoluteUrl(config, pathname)} (${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT} USDC units)`).join("\n")}

## Recommended Paid Sequence

1. Start with GET ${absoluteUrl(config, ROAST_PATH)} for ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT} USDC units. This is the already-indexed quick score route and the lowest-friction paid test.
2. Upgrade to GET ${absoluteUrl(config, FULL_ROAST_GET_PATH)} for ${config.price}, max 10000 USDC units only when the quick score is promising and the buyer wants the full rewrite, top fixes, and stop-or-upgrade guidance.

Full roast command:

\`\`\`bash
${buildGetPayCommand(config, FULL_ROAST_GET_PATH, "10000")}
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
${buildGetPayCommand(config, AGENT_LISTING_SCORE_PATH, INSTANT_SCORE_AMOUNT)}
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
${buildGetPayCommand(config, FULL_ROAST_GET_PATH, "10000")}
\`\`\`

## When To Use

Use this service for paid API listing quality, agent service listing clarity, buyer-agent skip reasons, x402 marketplace conversion, agent listing conversion score, marketplace listing conversion API, marketplace listing conversion, x402 route health, and discoverability checks before promotion.

Do not use it for legal advice, deep market research, or broad business strategy.
`;
}

function buildAuthMarkdown(config, cashRegister = {}) {
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

## Preferred First Paid Route

Agent payment prompt: ${formatIndexedQuickScoreAgentPaymentPrompt(config)}

Expected price: ${config.instantScorePrice}. Max amount: ${INSTANT_SCORE_AMOUNT} USDC units. Use ${absoluteUrl(config, ROAST_PATH)} first for the lowest-friction paid listing-quality score.

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
- Compact command handoff: ${absoluteUrl(config, COMMANDS_PATH)}?intent=paid%20API%20listing%20quality
- Pay-now handoff: ${absoluteUrl(config, PAY_NOW_PATH)}?intent=buyer-agent%20skip%20reasons
- Full-roast pay-now handoff: ${absoluteUrl(config, PAY_NOW_PATH)}?intent=full%20roast%20rewrite%20top%20fixes
- Paid-use proof: ${absoluteUrl(config, PAID_USAGE_PROOF_PATH)}
- Pricing catalog: ${absoluteUrl(config, PRICING_PATH)}
- Route finder: ${absoluteUrl(config, FIND_PATH)}?q=x402%20discovery%20audit
- Full-roast route finder: ${absoluteUrl(config, FIND_PATH)}?q=listing%20roast%20full%20rewrite
- Local route router: ${absoluteUrl(config, ROUTE_PATH)}?query=x402%20discovery%20audit&top=3
- Full-roast local router: ${absoluteUrl(config, ROUTE_PATH)}?query=listing%20roast%20full%20rewrite&top=3
- WebMCP handoff: load ${absoluteUrl(config, "/")} in a WebMCP-capable browser and call \`listing_roast_x402_handoff\`.

## Paid-Use Proof Before Payment

${formatPaidUseProofMarkdown(config, cashRegister)}

## Bazaar Cataloging Note

${formatBazaarCatalogingMarkdown(config)}

## Preferred First Paid Action

Use the already-indexed GET route first when the buyer wants a quick listing quality score:

\`\`\`bash
${buildGetPayCommand(config, ROAST_PATH)}
\`\`\`

Expected price: ${config.instantScorePrice}. Max amount: ${INSTANT_SCORE_AMOUNT} USDC units.

## Recommended Paid Sequence

1. Start with GET ${absoluteUrl(config, ROAST_PATH)} for ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT} USDC units. This is the already-indexed quick score route and the lowest-friction paid test.
2. Upgrade to GET ${absoluteUrl(config, FULL_ROAST_GET_PATH)} for ${config.price}, max 10000 USDC units only when the quick score is promising and the buyer wants the full rewrite, top fixes, and stop-or-upgrade guidance.

Full roast command:

\`\`\`bash
${buildGetPayCommand(config, FULL_ROAST_GET_PATH, "10000")}
\`\`\`

## Paid Routes

- GET ${absoluteUrl(config, API_ENTRY_PATH)} — ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT}; generic paid x402 navigation route map plus fallback quick score for agents that start at /api first.
- GET ${absoluteUrl(config, API_V1_ENTRY_PATH)} — ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT}; versioned paid x402 navigation route map plus fallback quick score for agents that start at /api/v1 first.
- GET ${absoluteUrl(config, V1_ENTRY_PATH)} — ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT}; short versioned paid x402 navigation route map plus fallback quick score for agents that start at /v1 first.
- GET ${absoluteUrl(config, ROAST_PATH)} — ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT}; already-indexed quick score.
- GET ${absoluteUrl(config, AGENT_LISTING_SCORE_PATH)} — ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT}; exact agent listing conversion score alias, buyer-agent skip reasons, and listing clarity. Canonical route: ${absoluteUrl(config, AGENT_LISTING_PATH)}.
- GET ${absoluteUrl(config, SITE_AUDIT_PATH)} — ${config.siteAuditPrice}, max ${SITE_AUDIT_AMOUNT}; x402 route and discovery preflight.
- GET ${absoluteUrl(config, DISCOVERY_AUDIT_PATH)} — ${config.siteAuditPrice}, max ${DISCOVERY_AUDIT_QUICK_AMOUNT}; exact-path quick x402 discovery audit.
- GET ${absoluteUrl(config, FULL_ROAST_GET_PATH)} — ${config.price}, max 10000; direct full listing roast and rewrite without assembling a POST body.
- POST ${absoluteUrl(config, "/api/listing-score")} — ${config.scorePrice}, max 5000; structured listing quality score.
- POST ${absoluteUrl(config, DISCOVERY_AUDIT_PATH)} — ${config.discoveryAuditPrice}, max ${DISCOVERY_AUDIT_AMOUNT}; full x402 discovery audit.
- POST ${absoluteUrl(config, ROAST_PATH)} — ${config.price}, max 10000; custom-body full listing roast; omitted bodies use safe defaults for stale directory cards.

## Guardrails For Agents

- Do not make a paid call unless the buyer explicitly intends to spend USDC.
- Do not use this document as an OAuth promise. OAuth is not available for this service.
- Do not ask the buyer for an API key or login. There is no account setup.
- Use the 402 payment challenge as the source of truth for the receiver, network, and amount.
- Use live wallet/register evidence before claiming revenue has settled.
`;
}

function buildAgentSkillsIndex(config, cashRegister = {}) {
  const skill = buildAgentSkillMarkdown(config, cashRegister);
  const intentRoutes = buildPayNowActions(config);
  const recommendedPaidSequence = buildRecommendedPaidSequence(intentRoutes);
  const officialCdpDiscovery = buildOfficialCdpDiscoveryHandoff(config);
  const commands = absoluteUrl(config, COMMANDS_PATH);
  const payNow = absoluteUrl(config, PAY_NOW_PATH);
  const paidUsageProofUrl = absoluteUrl(config, PAID_USAGE_PROOF_PATH);
  const paidUsageProof = buildPaidUsageProof(config, cashRegister);
  const openApiAliases = openApiAliasUrls(config);
  const openApiYamlAliases = openApiYamlAliasUrls(config);
  const x402ManifestAliases = x402ManifestAliasUrls(config);
  const mcpAliases = mcpAliasUrls(config);
  const mcpServerCardAliases = mcpServerCardAliasUrls(config);
  const intentLandingPages = buildIntentLandingPages(config, intentRoutes);

  return {
    $schema: AGENT_SKILLS_SCHEMA,
    service: X402_SERVICE_NAME,
    metadataVersion: DISCOVERY_METADATA_VERSION,
    metadataUpdatedAt: DISCOVERY_METADATA_UPDATED_AT,
    description: DISCOVERY_DESCRIPTION,
    keywords: DISCOVERY_KEYWORDS,
    commands,
    payNow,
    paidUsageProofUrl,
    cashRegister: absoluteUrl(config, "/api/cash-register"),
    paidUsageProof,
    officialCdpDiscovery,
    preferredFirstPaidAction: intentRoutes.indexedQuickScore,
    exactIntentPaidActions: {
      marketplaceProductListingQuality: intentRoutes.marketplaceProductListingQuality,
      listingQualityScoreApi: intentRoutes.listingQualityScoreApi,
      paidApiListingQuality: intentRoutes.paidApiListingQuality,
      agentCoreX402Payments: intentRoutes.agentCoreX402Payments,
      buyerAgentSkipReasons: intentRoutes.buyerAgentSkipReasons,
      agentServiceClarity: intentRoutes.agentServiceClarity,
      discoveryAuditQuick: intentRoutes.discoveryAuditQuick,
      x402SiteAudit: intentRoutes.x402SiteAudit
    },
    recommendedPaidSequence,
    intentLandingPages,
    routeFinderExamples: [
      `${absoluteUrl(config, FIND_PATH)}?q=buyer-agent%20skip%20reasons`,
      `${absoluteUrl(config, FIND_PATH)}?q=paid%20API%20listing%20quality`,
      `${absoluteUrl(config, FIND_PATH)}?q=x402%20discovery%20audit`,
      `${absoluteUrl(config, FIND_PATH)}?q=listing%20roast%20full%20rewrite`
    ],
    localRouterExamples: [
      `${absoluteUrl(config, ROUTE_PATH)}?query=buyer-agent%20skip%20reasons&top=3`,
      `${absoluteUrl(config, ROUTE_PATH)}?query=paid%20API%20listing%20quality&top=3`,
      `${absoluteUrl(config, ROUTE_PATH)}?query=x402%20discovery%20audit&top=3`,
      `${absoluteUrl(config, ROUTE_PATH)}?query=listing%20roast%20full%20rewrite&top=3`
    ],
    payment: {
      protocol: "x402",
      network: config.network,
      asset: "USDC",
      manifest: absoluteUrl(config, "/x402.json"),
      manifestAliases: x402ManifestAliases,
      commands,
      payNow,
      paidUsageProofUrl,
      cashRegister: absoluteUrl(config, "/api/cash-register"),
      paidUsageProof,
      officialCdpDiscovery,
      preferredFirstPaidAction: intentRoutes.indexedQuickScore,
      exactIntentPaidActions: {
        marketplaceProductListingQuality: intentRoutes.marketplaceProductListingQuality,
        listingQualityScoreApi: intentRoutes.listingQualityScoreApi,
        paidApiListingQuality: intentRoutes.paidApiListingQuality,
        agentCoreX402Payments: intentRoutes.agentCoreX402Payments,
        buyerAgentSkipReasons: intentRoutes.buyerAgentSkipReasons,
        discoveryAuditQuick: intentRoutes.discoveryAuditQuick,
        x402SiteAudit: intentRoutes.x402SiteAudit
      },
      recommendedPaidSequence
    },
    links: {
      commands,
      payNow,
      paidUsageProofUrl,
      x402Manifest: absoluteUrl(config, "/x402.json"),
      x402ManifestAliases,
      agentCard: absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH),
      openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH),
      openApiAliases,
      openApiYamlAliases,
      mcp: absoluteUrl(config, WELL_KNOWN_MCP_JSON_PATH),
      mcpAliases,
      mcpServerCard: absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH),
      mcpServerCardAliases,
      apiCatalog: absoluteUrl(config, WELL_KNOWN_API_CATALOG_PATH),
      routeFinder: absoluteUrl(config, FIND_PATH),
      localRouter: absoluteUrl(config, ROUTE_PATH),
      cashRegister: absoluteUrl(config, "/api/cash-register")
    },
    skills: [
      {
        name: "listing-roast-x402",
        type: "skill-md",
        description: "Use Listing Roast x402 when an agent needs a paid API listing quality score, buyer-agent skip reasons, agent-service listing clarity, x402 marketplace conversion feedback, or a discoverability audit before promoting a paid x402/API service. Start with free discovery and only pay when the buyer intends to spend USDC.",
        url: absoluteUrl(config, WELL_KNOWN_AGENT_SKILL_PATH),
        keywords: DISCOVERY_KEYWORDS,
        intentLandingPages,
        metadata: {
          commands,
          payNow,
          paidUsageProofUrl,
          cashRegister: absoluteUrl(config, "/api/cash-register"),
          paidUsageProof,
          officialCdpDiscovery,
          x402ManifestAliases,
          openApiAliases,
          mcpAliases,
          mcpServerCardAliases,
          exactIntentPaidActions: {
            marketplaceProductListingQuality: intentRoutes.marketplaceProductListingQuality,
            listingQualityScoreApi: intentRoutes.listingQualityScoreApi,
            paidApiListingQuality: intentRoutes.paidApiListingQuality,
            agentCoreX402Payments: intentRoutes.agentCoreX402Payments,
            buyerAgentSkipReasons: intentRoutes.buyerAgentSkipReasons,
            discoveryAuditQuick: intentRoutes.discoveryAuditQuick,
            x402SiteAudit: intentRoutes.x402SiteAudit
          },
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

function receiverWalletSnapshotCacheKey(config) {
  return `${config.network}|${config.payTo}|${config.baseRpcUrl}`;
}

async function getReceiverBalanceSnapshot(config) {
  const cacheKey = receiverWalletSnapshotCacheKey(config);
  const nowMs = Date.now();
  if (receiverWalletSnapshotCache && receiverWalletSnapshotCache.key === cacheKey && receiverWalletSnapshotCache.expiresAt > nowMs) {
    return {
      ...receiverWalletSnapshotCache.snapshot,
      cached: true
    };
  }

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
    const snapshot = {
      address: config.payTo,
      network: config.network,
      asset: "USDC",
      usdcBalance: formatUsdc(rawUnits),
      usdcUnits: rawUnits.toString(),
      checkedAt,
      source: new URL(config.baseRpcUrl).hostname
    };

    receiverWalletSnapshotCache = {
      key: cacheKey,
      expiresAt: Date.now() + RECEIVER_WALLET_SNAPSHOT_CACHE_MS,
      snapshot
    };

    return { ...snapshot };
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

async function getCashRegisterWithReceiverWallet(config) {
  const cashRegister = await getCashRegister();
  const receiverWallet = await getReceiverBalanceSnapshot(config);
  return {
    ...cashRegister,
    receiverWallet
  };
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
    },
    commands: absoluteUrl(config, COMMANDS_PATH),
    payNow: absoluteUrl(config, PAY_NOW_PATH),
    paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
    cashRegister: absoluteUrl(config, "/api/cash-register"),
    x402Manifest: absoluteUrl(config, "/x402.json")
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
        buyerSearchPhrases: {
          type: "array",
          items: { type: "string" }
        },
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
        },
        settlementRefreshNote: { type: "string" }
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
    endpointUrl: queryValue(
      query.endpointUrl || query.url || query.base_url || query.baseUrl || query.targetUrl || query.resource || query.endpoint || query.route,
      discoveryAuditRequestExample.endpointUrl
    ),
    method: queryValue(query.method, discoveryAuditRequestExample.method).toUpperCase(),
    expectedAmount: queryValue(query.expectedAmount || query.amount, discoveryAuditRequestExample.expectedAmount),
    expectedNetwork: queryValue(query.expectedNetwork || query.network, discoveryAuditRequestExample.expectedNetwork),
    searchQuery: queryValue(query.searchQuery || query.query, discoveryAuditRequestExample.searchQuery),
    agent402Query: queryValue(query.agent402Query || query.agentQuery || query.routeQuery, discoveryAuditRequestExample.agent402Query)
  };

  if (requestBody) {
    input.requestBody = requestBody;
  }

  return input;
}

function hasDiscoveryAuditEndpointOverride(query = {}) {
  return [
    query.endpointUrl,
    query.url,
    query.base_url,
    query.baseUrl,
    query.targetUrl,
    query.resource,
    query.endpoint,
    query.route
  ].some((value) => Boolean(queryValue(value, "")));
}

function buildAgent402RouteVisibilityInput(config, query = {}) {
  const defaults = {
    expectedAmount: String(DISCOVERY_AUDIT_QUICK_AMOUNT),
    expectedNetwork: config.network,
    searchQuery: "Agent402 route visibility",
    agent402Query: "Agent402 route visibility"
  };

  if (!hasDiscoveryAuditEndpointOverride(query)) {
    defaults.endpointUrl = absoluteUrl(config, AGENT402_ROUTE_VISIBILITY_PATH);
  }

  return buildDiscoveryAuditInputFromQuery({
    ...defaults,
    ...query
  });
}

function buildDiscoveryAuditBuyerVisibleInput(input = discoveryAuditRequestExample) {
  const endpointUrl = input.endpointUrl || discoveryAuditRequestExample.endpointUrl;
  return {
    url: endpointUrl,
    base_url: endpointUrl,
    endpointUrl,
    baseUrl: endpointUrl,
    targetUrl: endpointUrl,
    resource: endpointUrl,
    method: input.method || discoveryAuditRequestExample.method,
    expectedAmount: input.expectedAmount || discoveryAuditRequestExample.expectedAmount,
    expectedNetwork: input.expectedNetwork || discoveryAuditRequestExample.expectedNetwork,
    searchQuery: input.searchQuery || discoveryAuditRequestExample.searchQuery,
    agent402Query: input.agent402Query || discoveryAuditRequestExample.agent402Query,
    ...(input.requestBody ? { requestBody: input.requestBody } : {})
  };
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
    || body.url
    || body.targetUrl
    || body.target_url
    || body.resource
    || body.resourceUrl
    || body.resource_url
    || body.endpoint
    || body.route
    || combineServiceUrlAndPath(body.serviceUrl || body.service_url || body.baseUrl || body.base_url, body.expectedCheckoutPath || body.checkoutPath || body.path);
  const expectedAmount = body.expectedAmount
    || body.maxAmountRequired
    || body.amount
    || usdcPriceToAmountUnits(body.expectedPrice || body.price);
  const searchQuery = body.searchQuery
    || body.query
    || body.intent
    || body.goal;
  const agent402Query = body.agent402Query
    || body.agentQuery
    || body.routeQuery
    || searchQuery;

  return {
    ...(endpointUrl ? { endpointUrl } : {}),
    ...(body.method || body.expectedMethod ? { method: String(body.method || body.expectedMethod).toUpperCase() } : {}),
    ...(expectedAmount ? { expectedAmount: String(expectedAmount) } : {}),
    ...(body.expectedNetwork || body.network ? { expectedNetwork: body.expectedNetwork || body.network } : {}),
    ...(searchQuery ? { searchQuery: String(searchQuery) } : {}),
    ...(agent402Query ? { agent402Query: String(agent402Query) } : {}),
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

function buildDiscoveryAuditQuickOutput(config, auditOutput, options = {}) {
  const routePath = options.routePath || DISCOVERY_AUDIT_PATH;

  return {
    ...buildSiteAuditOutput(config, auditOutput),
    endpoint: options.endpoint || "x402-discovery-audit-quick",
    route: routePath,
    mode: options.mode || "quick-get-discovery-audit",
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

function buildDiscoveryAuditQuickExampleOutput(config, options = {}) {
  return buildDiscoveryAuditQuickOutput(config, buildDiscoveryAuditExampleOutput(), options);
}

function buildAgent402RouteVisibilityExampleOutput(config) {
  const endpointUrl = absoluteUrl(config, AGENT402_ROUTE_VISIBILITY_PATH);
  const input = {
    endpointUrl,
    method: "GET",
    expectedAmount: String(DISCOVERY_AUDIT_QUICK_AMOUNT),
    expectedNetwork: config.network,
    searchQuery: "Agent402 route visibility",
    agent402Query: "Agent402 route visibility"
  };

  return buildDiscoveryAuditQuickOutput(config, {
    ...buildDiscoveryAuditExampleOutput(),
    input,
    direct402: {
      ok: true,
      status: 402,
      hasPaymentRequiredHeader: true,
      hasBazaarExtension: true,
      amount: String(DISCOVERY_AUDIT_QUICK_AMOUNT),
      network: config.network
    },
    bazaarDiscovery: {
      merchantIndexed: false,
      searchVisible: false,
      indexedAmount: null,
      searchQuery: "Agent402 route visibility"
    },
    agent402Route: {
      query: "Agent402 route visibility",
      routeVisible: true,
      topRank: 1,
      matchedResult: {
        sellerName: "Listing Roast x402",
        route: AGENT402_ROUTE_VISIBILITY_PATH,
        url: endpointUrl,
        method: "GET",
        price: "$0.001"
      },
      error: null
    },
    catalogRefresh: {
      status: "needs_settled_payment_with_resource_metadata",
      directChallengeReadyForCatalog: true,
      needsRealSettlement: true,
      exactResourceUrl: endpointUrl,
      settlementRequirements: [
        "A real buyer must complete verify and settle through the CDP Facilitator for this exact endpoint URL.",
        "The settle payload must include paymentPayload.resource for the exact resource URL so CDP can catalog the route.",
        "The client/facilitator path should preserve the Bazaar extension metadata declared in the 402 challenge."
      ],
      whyUnpaidProbesAreNotEnough: "Unpaid 402/details/search probes can prove direct route truth, but they do not refresh CDP Bazaar catalog entries.",
      evidence: {
        direct402Ok: true,
        bazaarExtensionPresent: true,
        merchantIndexed: false,
        searchVisible: false,
        indexedAmount: null,
        directAmount: String(DISCOVERY_AUDIT_QUICK_AMOUNT)
      }
    },
    mismatches: ["CDP Bazaar has not indexed this exact Agent402 route-visibility alias yet."],
    nextActions: [
      "Let real buyer settlement on this exact route teach CDP Bazaar the current resource metadata.",
      "Use the Agent402 rank-1 route result as the current live routing signal while CDP Bazaar catches up."
    ]
  }, {
    routePath: AGENT402_ROUTE_VISIBILITY_PATH,
    endpoint: "agent402-route-visibility-audit",
    mode: "agent402-route-visibility"
  });
}

function isStaleIndexedQuickScoreBazaarDefault(query = {}) {
  const agentName = queryValue(query.agentName, "");
  const listingText = queryValue(query.listingText || query.text, "");
  const currentPrice = queryValue(query.currentPrice, "");
  const currentCheckoutPath = queryValue(query.currentCheckoutPath, "");

  return agentName === requestExample.agentName
    && currentPrice === "$1.00"
    && currentCheckoutPath === ROAST_PATH
    && listingText.startsWith("A paid x402 API that helps builders check whether buyer agents understand the offer before paying.");
}

export function normalizeIndexedQuickScoreQuery(query = {}) {
  if (!isStaleIndexedQuickScoreBazaarDefault(query)) {
    return query;
  }

  return {
    ...query,
    ...quickScoreRequestExample,
    source: INDEXED_QUICK_SCORE_STALE_SOURCE
  };
}

export function buildInstantScoreInput(query = {}, options = {}) {
  const effectiveQuery = options.normalizeStaleIndexedDefaults ? normalizeIndexedQuickScoreQuery(query) : query;
  return listingRoastRequestSchema.parse({
    agentName: queryValue(effectiveQuery.agentName, quickScoreRequestExample.agentName),
    listingText: queryValue(effectiveQuery.listingText || effectiveQuery.text, quickScoreRequestExample.listingText),
    targetBuyer: queryValue(effectiveQuery.targetBuyer, quickScoreRequestExample.targetBuyer),
    currentPrice: queryValue(effectiveQuery.currentPrice, quickScoreRequestExample.currentPrice),
    currentCheckoutPath: queryValue(effectiveQuery.currentCheckoutPath, quickScoreRequestExample.currentCheckoutPath),
    goal: queryValue(effectiveQuery.goal, quickScoreRequestExample.goal),
    source: queryValue(effectiveQuery.source, "instant-get-score")
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
  const route = absoluteUrl(config, path);
  const method = "POST";
  const price = options.price || config.price;
  const agentPaymentRequest = buildAgentPaymentRequest({
    route,
    path,
    method,
    price,
    maxAmountRequired
  });

  return {
    route,
    path,
    method,
    price,
    maxAmountRequired,
    maxPaymentUsd: agentPaymentRequest.maxPayment,
    agentPaymentRequest,
    agentPaymentPrompt: agentPaymentRequest.prompt,
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
  const route = absoluteUrl(config, path);
  const method = "GET";
  const price = options.price || config.instantScorePrice;
  const agentPaymentRequest = buildAgentPaymentRequest({
    route,
    path,
    method,
    price,
    maxAmountRequired
  });

  return {
    route,
    path,
    method,
    price,
    maxAmountRequired,
    maxPaymentUsd: agentPaymentRequest.maxPayment,
    agentPaymentRequest,
    agentPaymentPrompt: agentPaymentRequest.prompt,
    command: buildGetPayCommand(config, path, maxAmountRequired),
    reason: options.reason || "Buy the next GET check when the quick score confirms this route matches the buyer intent."
  };
}

function buildFullRoastGetNextPaidAction(config, input, options = {}) {
  return buildGetNextPaidAction(config, FULL_ROAST_GET_PATH, {
    price: config?.price || "$0.01",
    maxAmountRequired: "10000",
    reason: options.reason || "Buy the direct full roast when you want the rewritten listing, top fixes, buyer-agent skip reasons, and stop-or-upgrade guidance."
  });
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
      matchedBuyerIntent: "fix x402 Bazaar listing, Agent402 route visibility, stale price, search visibility, or route health",
      nextStep: "This indexed quick score confirms the listing fit. For stale Bazaar pricing, Agent402 route visibility, route health, and search visibility, buy GET /api/x402-discovery-audit next.",
      upgradeEndpoint: DISCOVERY_AUDIT_PATH,
      action: buildGetNextPaidAction(config, DISCOVERY_AUDIT_PATH, {
        price: config?.siteAuditPrice || "$0.001",
        maxAmountRequired: DISCOVERY_AUDIT_QUICK_AMOUNT,
        reason: "Buy this $0.001 audit for stale Bazaar price, Agent402 routing, route health, direct 402 metadata, and search visibility."
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
    matchedBuyerIntent: "paid API listing quality score, marketplace listing score, marketplace listing conversion API, buyer agent skip reasons, agent service clarity, or full listing roast",
    nextStep: "This indexed $0.001 GET route fits paid API listing quality, paid API listing quality score, x402 listing quality, buyer agent skip reasons, and agent service clarity; use GET /api/full-listing-roast for the full rewrite.",
    upgradeEndpoint: FULL_ROAST_GET_PATH,
    action: buildFullRoastGetNextPaidAction(config, input, {
      reason: "Buy the direct full roast when the quick score is promising and you want the rewrite, top fixes, buyer-agent skip reasons, and stop-or-upgrade guidance."
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
    ...(options.includeCommands && action.maxPaymentUsd !== undefined ? { maxPaymentUsd: action.maxPaymentUsd } : {}),
    ...(options.includeCommands && action.agentPaymentRequest ? { agentPaymentRequest: action.agentPaymentRequest } : {}),
    ...(options.includeCommands && action.agentPaymentPrompt ? { agentPaymentPrompt: action.agentPaymentPrompt } : {}),
    ...(options.includeCommands && action.command ? { command: action.command } : {}),
    ...(options.includeCommands && action.body ? { body: action.body } : {}),
    reason: action.reason
  } : null;

  return [
    {
      intent: "primary upgrade: full listing rewrite, top fixes, and launch recommendation",
      action: buildFullRoastGetNextPaidAction(config, input, {
        reason: "Buy the direct full roast when the quick score is promising and you want the rewrite, top fixes, buyer-agent skip reasons, and stop-or-upgrade guidance."
      })
    },
    {
      intent: "fix Bazaar/Agent402/search/health",
      action: buildGetNextPaidAction(config, DISCOVERY_AUDIT_PATH, {
        price: config?.siteAuditPrice || "$0.001",
        maxAmountRequired: DISCOVERY_AUDIT_QUICK_AMOUNT,
        reason: "Buy this $0.001 audit for stale Bazaar price, Agent402 routing, route health, direct 402 metadata, and search visibility."
      })
    },
    {
      intent: "paid API preflight before paying, OpenAPI, llms.txt, robots, sitemap, payment metadata, or buyer-readiness checks",
      action: buildGetNextPaidAction(config, SITE_AUDIT_PATH, {
        price: config?.siteAuditPrice || "$0.001",
        maxAmountRequired: SITE_AUDIT_AMOUNT,
        reason: "Buy the $0.001 x402 site audit when you want live pre-pay checks for OpenAPI, llms.txt, route health, pricing, and buyer-readiness signals before paying more."
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
    maxPaymentUsd: handoff.maxPaymentUsd,
    agentPaymentRequest: handoff.agentPaymentRequest,
    agentPaymentPrompt: handoff.agentPaymentPrompt,
    command: handoff.command,
    ...(handoff.body ? { body: handoff.body } : {}),
    reason: handoff.reason
  }));
}

function buildFullRoastUpgradeDecision(nextPaidActions = []) {
  const fullRoastAction = nextPaidActions.find((action) => action.path === FULL_ROAST_GET_PATH && action.method === "GET")
    || nextPaidActions.find((action) => action.path === ROAST_PATH && action.method === "POST");

  if (!fullRoastAction) {
    return null;
  }

  return {
    revenueStep: "$0.01 full roast upgrade",
    buyWhen: "Buy this after the $0.001 quick score when the buyer wants rewritten listing copy, top fixes, buyer-agent skip reasons, and a stop-or-upgrade call.",
    holdWhen: "Do not upgrade if the quick score only proves route health or the buyer only needed the low-cost score.",
    expectedOutput: ["buyerAgentSkipReasons", "topFixes", "rewrittenListing", "stopOrUpgrade"],
    agentPaymentPrompt: fullRoastAction.agentPaymentPrompt,
    action: fullRoastAction
  };
}

function buildCatalogCacheNormalizationProof(input) {
  if (input.source !== INDEXED_QUICK_SCORE_STALE_SOURCE) {
    return null;
  }

  return {
    applied: true,
    source: input.source,
    reason: "Older CDP/Bazaar cards can still forward stale $1.00 example fields; this paid response scored the current $0.001 GET /api/listing-roast offer instead.",
    staleMatched: {
      agentName: requestExample.agentName,
      currentPrice: "$1.00",
      currentCheckoutPath: ROAST_PATH
    },
    normalizedTo: {
      agentName: quickScoreRequestExample.agentName,
      currentPrice: quickScoreRequestExample.currentPrice,
      currentCheckoutPath: quickScoreRequestExample.currentCheckoutPath,
      firstPaidRoute: ROAST_PATH,
      maxAmountRequired: INSTANT_SCORE_AMOUNT
    }
  };
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
    nextStep: "This GET route is the lowest-friction paid check. Use /api/listing-score for a scored POST payload or /api/full-listing-roast for the direct full rewrite.",
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
    nextStep: "This route is optimized for x402 marketplace conversion buyers. Use GET /api/listing-roast when a marketplace result points to the already-indexed URL, or GET /api/full-listing-roast for the full rewrite.",
    upgradeEndpoint: FULL_ROAST_GET_PATH
  }, buildFullRoastGetNextPaidAction(config, input, {
    reason: "Buy the direct full roast when the conversion score shows enough buyer intent to justify a rewrite and launch recommendation."
  }));
}

function buildAgentListingConversionScore(input, config, options = {}) {
  const routePath = options.routePath || AGENT_LISTING_PATH;
  return addNextPaidAction({
    ...buildInstantListingScore(input, config),
    endpoint: "agent-listing-conversion-score",
    route: routePath,
    exactScoreAlias: AGENT_LISTING_SCORE_PATH,
    canonicalRoute: AGENT_LISTING_PATH,
    nextStep: "Listing Roast agent-listing-conversion-score is optimized for buyer agents searching agent listing conversion score, agent_listing_conversion_score, agent service listing clarity, or buyer-agent skip reasons. Use GET /api/full-listing-roast for the full rewrite and launch recommendation.",
    upgradeEndpoint: FULL_ROAST_GET_PATH
  }, buildFullRoastGetNextPaidAction(config, input, {
    reason: "Buy the direct full roast when the agent listing conversion score shows enough buyer intent to justify a rewrite and launch recommendation."
  }));
}

function buildIndexedRoastQuickScore(input, config) {
  const followup = indexedQuickScoreFollowup(config, input);
  const buyerIntentHandoffs = indexedQuickScoreIntentHandoffs(config, input);
  const nextPaidActions = indexedQuickScoreNextPaidActions(config, input);
  const fullRoastUpgradeDecision = buildFullRoastUpgradeDecision(nextPaidActions);
  const catalogCacheNormalization = buildCatalogCacheNormalizationProof(input);
  const settlementRefreshNote = "Bazaar search refreshes after a real settle with paymentPayload.resource; unpaid probes do not refresh search.";

  return addNextPaidAction({
    ...buildInstantListingScore(input, config),
    endpoint: "listing-roast-quick-score",
    ...(catalogCacheNormalization ? { catalogCacheNormalization } : {}),
    matchedBuyerIntent: followup.matchedBuyerIntent,
    buyerSearchPhrases: INDEXED_QUICK_SCORE_SEARCH_PHRASES,
    buyerIntentHandoffs,
    nextPaidActions,
    ...(fullRoastUpgradeDecision ? { fullRoastUpgradeDecision } : {}),
    officialCdpDiscovery: buildOfficialCdpDiscoveryHandoff(config),
    settlementRefreshNote,
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
    officialCdpDiscovery: compactOfficialCdpDiscoveryHandoff(buildOfficialCdpDiscoveryHandoff(config)),
    checkedSignals: undefined,
    catalogCacheNormalization: undefined,
    buyerIntentHandoffs: undefined,
    fullRoastUpgradeDecision: undefined,
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

function agentListingConversionInputDefaults(routePath = AGENT_LISTING_PATH) {
  return {
    ...quickScoreRequestExample,
    listingText: `A $0.001 x402 agent listing conversion score for agent_listing_conversion_score, agent listing conversion, buyer-agent skip reasons, agent service listing clarity, and agent service promotion readiness. Use exact GET ${routePath} for the first paid score, then buy GET ${FULL_ROAST_GET_PATH} for the $0.01 full roast when the score shows enough fit.`,
    targetBuyer: "buyer agents searching agent listing conversion score",
    currentCheckoutPath: routePath,
    goal: "Convert buyers looking for an agent listing conversion score into a one-tenth-cent paid score, then hand promising listings to the full roast upgrade."
  };
}

function buildAgentListingConversionDiscovery(config, routePath = AGENT_LISTING_PATH) {
  const inputDefaults = agentListingConversionInputDefaults(routePath);
  const discovery = buildInstantScoreDiscovery(config, inputDefaults);

  return {
    ...discovery,
    output: {
      ...discovery.output,
      example: buildAgentListingConversionScore(buildInstantScoreInput(inputDefaults), config, { routePath })
    },
    service: {
      ...discovery.service,
      route: absoluteUrl(config, routePath)
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

function buildFullRoastGetDiscovery(config) {
  const queryExample = {
    ...quickScoreRequestExample,
    currentPrice: config.price,
    currentCheckoutPath: FULL_ROAST_GET_PATH,
    goal: "Buy the full listing roast directly for rewritten listing copy, top fixes, buyer-agent skip reasons, and stop-or-upgrade guidance."
  };

  return {
    input: queryExample,
    inputSchema: {
      type: "object",
      properties: listingQuerySchemaProperties(queryExample)
    },
    output: {
      example: buildListingRoast(buildInstantScoreInput(queryExample)),
      schema: buildDiscovery(config).output.schema
    },
    service: {
      name: config.serviceName,
      url: config.serviceUrl,
      route: absoluteUrl(config, FULL_ROAST_GET_PATH),
      price: config.price,
      network: config.network
    }
  };
}

function buildFullRoastPostFallbackInput(config) {
  return buildInstantScoreInput({
    currentPrice: config.price,
    currentCheckoutPath: ROAST_PATH,
    goal: "Buy the full listing roast from the cached POST path for rewritten listing copy, top fixes, buyer-agent skip reasons, and stop-or-upgrade guidance."
  });
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
        route: absoluteUrl(config, AGENT_LISTING_SCORE_PATH),
        path: AGENT_LISTING_SCORE_PATH,
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
      agent402RouteVisibility: {
        route: absoluteUrl(config, AGENT402_ROUTE_VISIBILITY_PATH),
        path: AGENT402_ROUTE_VISIBILITY_PATH,
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
      },
      fullRoastGet: {
        route: absoluteUrl(config, FULL_ROAST_GET_PATH),
        path: FULL_ROAST_GET_PATH,
        method: "GET",
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
    nextStep: "This paid entrypoint includes a quick score so generic /api buyers get immediate value. Use the preferredFirstPaidAction route directly next time, or use GET /api/full-listing-roast for the full rewrite."
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
    nextStep: "Use the indexed /api/listing-roast GET quick score first; upgrade to GET /api/full-listing-roast when a full roast is needed."
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
      agentListingConversion: AGENT_LISTING_SCORE_PATH,
      agentListingConversionCanonical: AGENT_LISTING_PATH,
      indexedQuickScore: ROAST_PATH,
      siteAudit: SITE_AUDIT_PATH,
      discoveryAudit: DISCOVERY_AUDIT_PATH,
      score: "/api/listing-score",
      fullRoast: FULL_ROAST_GET_PATH,
      customBodyFullRoast: ROAST_PATH
    },
    nextStep: "Use this paid ping to verify the x402 rail, then call /api/listing-roast with GET for a quick score or /api/full-listing-roast with GET for the full roast."
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
    input: buildDiscoveryAuditBuyerVisibleInput(),
    bodyType: "json",
    inputSchema: {
      type: "object",
      anyOf: [
        { required: ["endpointUrl"] },
        { required: ["url"] },
        { required: ["base_url"] },
        { required: ["baseUrl"] },
        { required: ["targetUrl"] },
        { required: ["resource"] }
      ],
      properties: {
        endpointUrl: {
          type: "string",
          description: "Public HTTPS x402 endpoint to inspect without making a paid call."
        },
        url: {
          type: "string",
          description: "Alias for endpointUrl. Use this when the buyer agent expects preflight tools to accept a url query or JSON field."
        },
        base_url: {
          type: "string",
          description: "Alias for endpointUrl. Use this when the buyer agent supplies snake_case base URL input."
        },
        baseUrl: {
          type: "string",
          description: "Alias for endpointUrl. Use this when the buyer agent supplies camelCase base URL input."
        },
        targetUrl: {
          type: "string",
          description: "Alias for endpointUrl. Use this when the buyer agent names the audited endpoint as targetUrl."
        },
        resource: {
          type: "string",
          description: "Alias for endpointUrl. Use this when the buyer agent names the audited x402 endpoint as a resource."
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
        agent402Query: {
          type: "string",
          description: "Buyer query to test against Agent402 route ranking. Defaults to searchQuery."
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

function buildSiteAuditDiscovery(config, options = {}) {
  const discovery = buildDiscoveryAuditDiscovery(config);
  const routePath = options.routePath || SITE_AUDIT_PATH;

  return {
    input: buildDiscoveryAuditBuyerVisibleInput(buildDiscoveryAuditInputFromQuery()),
    inputSchema: discovery.inputSchema,
    output: {
      example: buildSiteAuditExampleOutput(config),
      schema: discoveryAuditOutputSchema
    },
    service: {
      name: config.serviceName,
      url: config.serviceUrl,
      route: absoluteUrl(config, routePath),
      price: config.siteAuditPrice,
      network: config.network
    }
  };
}

function buildDiscoveryAuditQuickDiscovery(config, options = {}) {
  const discovery = buildSiteAuditDiscovery(config);
  const routePath = options.routePath || DISCOVERY_AUDIT_PATH;

  return {
    ...discovery,
    input: options.input || discovery.input,
    output: {
      ...discovery.output,
      example: options.outputExample || buildDiscoveryAuditQuickExampleOutput(config)
    },
    service: {
      ...discovery.service,
      route: absoluteUrl(config, routePath),
      price: config.siteAuditPrice
    }
  };
}

function buildAgent402RouteVisibilityDiscovery(config) {
  const input = buildAgent402RouteVisibilityInput(config);

  return buildDiscoveryAuditQuickDiscovery(config, {
    routePath: AGENT402_ROUTE_VISIBILITY_PATH,
    input: buildDiscoveryAuditBuyerVisibleInput(input),
    outputExample: buildAgent402RouteVisibilityExampleOutput(config)
  });
}

function siteAuditIntentRouteKeyForPath(pathname) {
  const metadata = SITE_AUDIT_EXACT_ALIAS_METADATA[pathname];

  return metadata ? PAY_NOW_ACTION_BY_RESOURCE_ID[metadata.id] || "x402SiteAudit" : "x402SiteAudit";
}

function siteAuditDescriptionForPath(pathname) {
  return SITE_AUDIT_EXACT_ALIAS_METADATA[pathname]?.description
    || "Listing Roast x402 Site Audit: $0.001 GET x402 site audit, x402 buyer prepay risk score, score x402 endpoint before paying, x402 route health check, x402 listing SEO audit, x402 marketplace SEO audit, Bazaar search visibility, listing rank doctor, seller growth checklist, service discoverability audit, paid API preflight before paying more, direct 402 metadata, Bazaar pricing, and no-spend next actions.";
}

function inferPaymentHintIntentRouteKey(path, method = "GET") {
  const routeKey = `${String(method || "GET").toUpperCase()} ${path}`;
  const routeKeys = {
    [`POST ${ROOT_DIRECTORY_POST_PATH}`]: "directoryPost",
    [`GET ${API_ENTRY_PATH}`]: "apiEntry",
    [`GET ${API_V1_ENTRY_PATH}`]: "apiV1Entry",
    [`GET ${V1_ENTRY_PATH}`]: "v1Entry",
    [`GET ${ROAST_PATH}`]: "indexedQuickScore",
    [`GET ${FULL_ROAST_GET_PATH}`]: "fullRoastGet",
    [`POST ${ROAST_PATH}`]: "fullRoast",
    [`GET ${INSTANT_SCORE_PATH}`]: "instantScore",
    [`GET ${CONVERSION_SCORE_PATH}`]: "conversionScore",
    [`GET ${AGENT_LISTING_PATH}`]: "agentListingConversion",
    [`GET ${AGENT_LISTING_SCORE_PATH}`]: "agentListingConversion",
    [`GET ${PING_PATH}`]: "x402Ping",
    [`GET ${SITE_AUDIT_PATH}`]: "x402SiteAudit",
    [`GET ${PREFLIGHT_ALIAS_PATHS[0]}`]: "x402SiteAudit",
    [`GET ${PREFLIGHT_ALIAS_PATHS[1]}`]: "x402SiteAudit",
    [`GET ${PREFLIGHT_ALIAS_PATHS[2]}`]: "x402SiteAudit",
    [`GET ${DISCOVERY_AUDIT_PATH}`]: "discoveryAuditQuick",
    [`GET ${AGENT402_ROUTE_VISIBILITY_PATH}`]: "agent402RouteVisibility",
    [`POST ${DISCOVERY_AUDIT_PATH}`]: "discoveryAudit",
    [`POST ${SCORE_PATH}`]: "listingScore",
    "GET /api/marketplace-listing-score": "marketplaceListingScore",
    "GET /api/marketplace-listing-conversion-api": "marketplaceListingConversion",
    "GET /api/marketplace-listing-conversion": "marketplaceListingConversion",
    "GET /api/marketplace-product-listing-quality": "marketplaceProductListingQuality",
    "GET /api/paid-api-listing-quality": "paidApiListingQuality",
    "GET /api/paid-api-listing-quality-score": "paidApiListingQualityScore",
    "GET /api/listing-quality-score-api": "listingQualityScoreApi",
    "GET /api/agentcore-x402-payments": "agentCoreX402Payments",
    "GET /api/coinbase-x402-bazaar-mcp-server": "coinbaseX402BazaarMcpServer",
    "GET /api/x402-listing-quality": "x402ListingQuality",
    "GET /api/buyer-agent-skip-reasons": "buyerAgentSkipReasons",
    "GET /api/agent-service-clarity": "agentServiceClarity"
  };

  return routeKeys[routeKey] || "indexedQuickScore";
}

function buildPaymentHint(config, options) {
  const paidUseProof = buildPaidUseProofLinks(config);
  const route = absoluteUrl(config, options.path);
  const intentRouteKey = options.intentRouteKey || inferPaymentHintIntentRouteKey(options.path, options.method);
  const intentRoutes = buildPayNowActions(config);
  const paidAction = {
    ...buildRoutePaymentAction(config, {
      path: options.path,
      method: options.method,
      price: options.price,
      maxAmountRequired: options.maxAmountRequired,
      body: options.body,
      reason: options.buyerAction
    }),
    url: route
  };
  const agentPaymentRequest = buildAgentPaymentRequest(paidAction);
  const selectedFirstPaidAction = firstPaidActionForSelectedIntent(intentRoutes, intentRouteKey, paidAction);
  const exactIntentPaidAction = exactIntentPaidActionForSelection(intentRoutes, intentRouteKey, paidAction);
  const selectedPaidSequence = buildSelectedPaidSequence(intentRoutes, intentRouteKey, paidAction);
  const firstAgentPaymentRequest = buildAgentPaymentRequest(selectedFirstPaidAction);
  const commandHandoffUrl = commandUrlForSelection(config, intentRouteKey, paidAction);
  const freeHandoffUrl = payNowUrlForSelection(config, intentRouteKey, paidAction);
  const paymentShortcut = buildPaymentShortcutForAction(config, paidAction, selectedFirstPaidAction, intentRouteKey, intentRoutes);

  return {
    protocol: "x402",
    network: config.network,
    asset: "USDC",
    price: options.price,
    maxAmountRequired: options.maxAmountRequired,
    payTo: config.payTo,
    method: options.method,
    route,
    selectedActionKey: intentRouteKey,
    paymentShortcut,
    ...(paymentShortcut.upgradeAfterQuickScore ? { upgradeAfterQuickScore: paymentShortcut.upgradeAfterQuickScore } : {}),
    selectedPaidAction: paidAction,
    ...(exactIntentPaidAction ? { exactIntentPaidAction } : {}),
    selectedFirstPaidAction,
    selectedPaidSequence,
    preferredFirstPaidAction: Boolean(options.preferredFirstPaidAction),
    buyerAction: options.buyerAction,
    agentPaymentRequest,
    agentPaymentPrompt: agentPaymentRequest.prompt,
    maxPaymentUsd: agentPaymentRequest.maxPayment,
    firstAgentPaymentRequest,
    firstAgentPaymentPrompt: firstAgentPaymentRequest.prompt,
    firstPayCommand: selectedFirstPaidAction.command,
    firstPaidCommand: selectedFirstPaidAction.command,
    payCommand: selectedFirstPaidAction.command,
    pay_command: selectedFirstPaidAction.command,
    command: selectedFirstPaidAction.command,
    selectedPaidActionCommand: paidAction.command,
    commandHandoff: commandHandoffUrl,
    commands: commandHandoffUrl,
    freeHandoff: freeHandoffUrl,
    payNow: freeHandoffUrl,
    buyerInstruction: buildSelectedBuyerInstruction(intentRouteKey, paidAction, intentRoutes.indexedQuickScore),
    paidResponsePreview: buildPaidResponsePreview(config, intentRouteKey, paidAction),
    selectedFirstPaidResponsePreview: buildPaidResponsePreview(
      config,
      isQuickScoreExactAliasActionKey(intentRouteKey) && !shouldUseExactAliasFirst(intentRouteKey) ? "indexedQuickScore" : intentRouteKey,
      selectedFirstPaidAction
    ),
    paidUsageProof: paidUseProof.paidUsageProof,
    cashRegister: paidUseProof.cashRegister,
    paidUseProof,
    x402Retry: {
      paymentRequiredHeader: "Payment-Required",
      paymentHeader: "X-PAYMENT",
      route,
      method: options.method,
      maxAmountRequired: options.maxAmountRequired,
      maxPaymentUsd: agentPaymentRequest.maxPayment,
      agentPaymentPrompt: agentPaymentRequest.prompt,
      instruction: "Parse the Payment-Required header, complete the exact x402 payment, then retry this same route with the X-PAYMENT header."
    }
  };
}

function buildPaidUseProofLinks(config) {
  const latestWalletSettlement = buildLatestWalletSettlementProof(config);
  const walletConfirmedPaidRoute = latestWalletSettlement ? {
    method: latestWalletSettlement.route.method,
    path: latestWalletSettlement.route.path,
    url: latestWalletSettlement.route.url,
    maxAmountRequired: latestWalletSettlement.route.maxAmountRequired,
    estimatedRevenueUsd: latestWalletSettlement.usdc || null,
    source: "public_wallet_settlement",
    payerDetails: latestWalletSettlement.payerDetails,
    note: "This is the public wallet-confirmed paid route known from baseline settlement proof. The paidUsageProof URL is the source of truth for newer events."
  } : null;

  return {
    paidUsageProof: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
    payNow: absoluteUrl(config, PAY_NOW_PATH),
    cashRegister: absoluteUrl(config, "/api/cash-register"),
    ...(walletConfirmedPaidRoute ? { walletConfirmedPaidRoute } : {}),
    note: "Free public proof surfaces expose paidUsageProof and wallet-backed paid completion evidence before payment."
  };
}

function buildLocalDiscoverySearchExamples(config) {
  const examples = [
    {
      query: "paid API listing quality",
      expectedFirstPath: ROAST_PATH,
      exactIntentPath: "/api/paid-api-listing-quality",
      expectedAmount: INSTANT_SCORE_AMOUNT
    },
    {
      query: "marketplace product listing quality",
      expectedFirstPath: ROAST_PATH,
      exactIntentPath: "/api/marketplace-product-listing-quality",
      expectedAmount: INSTANT_SCORE_AMOUNT
    },
    {
      query: "listing quality score API",
      expectedFirstPath: ROAST_PATH,
      exactIntentPath: "/api/listing-quality-score-api",
      expectedAmount: INSTANT_SCORE_AMOUNT
    },
    {
      query: "buyer-agent skip reasons",
      expectedFirstPath: ROAST_PATH,
      exactIntentPath: "/api/buyer-agent-skip-reasons",
      expectedAmount: INSTANT_SCORE_AMOUNT
    },
    {
      query: "agent service clarity",
      expectedFirstPath: ROAST_PATH,
      exactIntentPath: "/api/agent-service-clarity",
      expectedAmount: INSTANT_SCORE_AMOUNT
    },
    {
      query: "x402 discovery audit",
      expectedFirstPath: DISCOVERY_AUDIT_PATH,
      expectedAmount: DISCOVERY_AUDIT_QUICK_AMOUNT
    },
    {
      query: "Agent402 route visibility",
      expectedFirstPath: AGENT402_ROUTE_VISIBILITY_PATH,
      expectedAmount: DISCOVERY_AUDIT_QUICK_AMOUNT
    },
    {
      query: "x402 route health check",
      expectedFirstPath: "/api/x402-route-health-check",
      expectedAmount: SITE_AUDIT_AMOUNT
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
    reason: "Use seller-hosted discovery search when external marketplace search is stale, incomplete, or misses this buyer intent. Listing-quality intents lead with the already-indexed /api/listing-roast route; phrase-specific aliases remain available as exact-intent alternates."
  }));
}

function withPaidUseProofDescription(config, description) {
  return `${description} Commands ${COMMANDS_PATH} Proof before payment ${PAID_USAGE_PROOF_PATH} register /api/cash-register`;
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
    "matchedBuyerIntent",
    "nextStep",
    "upgradeEndpoint",
    "settlementRefreshNote",
    "message",
    "mode",
    "route",
    "exactScoreAlias",
    "canonicalRoute",
    "safety"
  ]);

  if (example.direct402) {
    compact.direct402 = pickDefined(example.direct402, ["ok", "status", "hasPaymentRequiredHeader", "hasBazaarExtension", "amount", "network"]);
  }

  if (example.bazaarDiscovery) {
    compact.bazaarDiscovery = pickDefined(example.bazaarDiscovery, ["merchantIndexed", "searchVisible", "indexedAmount", "searchQuery"]);
  }

  if (example.agent402Route) {
    compact.agent402Route = {
      ...pickDefined(example.agent402Route, ["query", "routeVisible", "topRank"]),
      ...(example.agent402Route.matchedResult
        ? { matchedResult: pickDefined(example.agent402Route.matchedResult, ["sellerName", "route", "url", "method", "price"]) }
        : {})
    };
  }

  if (example.catalogRefresh) {
    compact.catalogRefresh = pickDefined(example.catalogRefresh, ["status", "directChallengeReadyForCatalog", "needsRealSettlement", "exactResourceUrl"]);
  }

  if (example.officialCdpDiscovery) {
    compact.officialCdpDiscovery = compactOfficialCdpDiscoveryHandoff(example.officialCdpDiscovery);
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
      .slice(0, 2)
      .map((action) => compactChallengeAction(action, { includeRoute: false, includeReason: false }));
  }

  if (example.paidRoutes) {
    compact.paidRoutes = compactChallengePaidRoutes(example.paidRoutes);
  }

  return Object.keys(compact).length ? compact : example;
}

function inferCompactSchema(value) {
  if (typeof value === "string") {
    return { type: "string" };
  }

  if (typeof value === "number") {
    return { type: "number" };
  }

  if (typeof value === "boolean") {
    return { type: "boolean" };
  }

  if (Array.isArray(value)) {
    return {
      type: "array",
      items: value.length ? inferCompactSchema(value[0]) : { type: "string" }
    };
  }

  if (value && typeof value === "object") {
    return { type: "object", additionalProperties: true };
  }

  return { type: "string" };
}

function compactActionSchema(includeIntent = false) {
  return {
    type: "object",
    properties: {
      ...(includeIntent ? { intent: { type: "string" } } : {}),
      path: { type: "string" },
      method: { type: "string" },
      price: { type: "string" },
      maxAmountRequired: { type: "string" }
    },
    additionalProperties: true
  };
}

function compactChallengeOutputSchema(example) {
  const required = ["service", "endpoint", "price"].filter((key) => example?.[key] !== undefined);
  const properties = Object.fromEntries(
    Object.entries(example || {}).map(([key, value]) => [key, inferCompactSchema(value)])
  );

  if (example?.nextPaidAction) {
    properties.nextPaidAction = compactActionSchema();
  }

  if (Array.isArray(example?.nextPaidActions)) {
    properties.nextPaidActions = {
      type: "array",
      items: compactActionSchema(true)
    };
  }

  if (example?.preferredFirstPaidAction) {
    properties.preferredFirstPaidAction = compactActionSchema();
  }

  return {
    type: "object",
    ...(required.length ? { required } : {}),
    properties,
    additionalProperties: true
  };
}

function compactChallengeInputSchema(schema) {
  if (Array.isArray(schema)) {
    return schema.map(compactChallengeInputSchema);
  }

  if (!schema || typeof schema !== "object") {
    return schema;
  }

  const compact = {};
  for (const [key, value] of Object.entries(schema)) {
    if (["$schema", "default", "description", "example", "examples", "title"].includes(key)) {
      continue;
    }

    compact[key] = compactChallengeInputSchema(value);
  }

  return compact;
}

function compactDiscoveryForChallenge(discovery) {
  if (!discovery?.output?.example) {
    return discovery;
  }

  const example = compactChallengeOutputExample(discovery.output.example);

  return {
    ...discovery,
    inputSchema: compactChallengeInputSchema(discovery.inputSchema),
    output: {
      ...discovery.output,
      example,
      schema: compactChallengeOutputSchema(example)
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
  const route = absoluteUrl(config, options.path);
  const agentPaymentRequest = buildAgentPaymentRequest({
    route,
    path: options.path,
    method,
    price: options.price,
    maxAmountRequired: options.maxAmountRequired
  });

  return {
    route,
    path: options.path,
    method,
    price: options.price,
    maxAmountRequired: options.maxAmountRequired,
    maxPaymentUsd: agentPaymentRequest.maxPayment,
    agentPaymentRequest,
    agentPaymentPrompt: agentPaymentRequest.prompt,
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
      reason: "Use this when a public directory or agent-tools listing shows a generic POST to the service root; the paid response includes a quick score plus the indexed /api/listing-roast handoff."
    }),
    indexedQuickScore: buildRoutePaymentAction(config, {
      path: ROAST_PATH,
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      reason: INDEXED_QUICK_SCORE_DESCRIPTION
    }),
    marketplaceListingScore: buildRoutePaymentAction(config, {
      path: "/api/marketplace-listing-score",
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      reason: "Use this when the buyer intent is exactly marketplace listing score or marketplace listing quality."
    }),
    marketplaceListingConversion: buildRoutePaymentAction(config, {
      path: "/api/marketplace-listing-conversion-api",
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      reason: "Use this exact-path route when the buyer intent is marketplace listing conversion API, marketplace listing conversion, marketplace conversion score, or x402 marketplace conversion."
    }),
    marketplaceProductListingQuality: buildRoutePaymentAction(config, {
      path: "/api/marketplace-product-listing-quality",
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      reason: "Use this when the buyer intent is exactly marketplace product listing quality."
    }),
    paidApiListingQuality: buildRoutePaymentAction(config, {
      path: "/api/paid-api-listing-quality",
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      reason: "Use this when the buyer intent is exactly paid API listing quality or paid API listing quality score."
    }),
    paidApiListingQualityScore: buildRoutePaymentAction(config, {
      path: "/api/paid-api-listing-quality-score",
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      reason: "Use this when the buyer intent is exactly paid API listing quality score."
    }),
    listingQualityScoreApi: buildRoutePaymentAction(config, {
      path: "/api/listing-quality-score-api",
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      reason: "Use this when the buyer intent is exactly listing quality score API."
    }),
    agentCoreX402Payments: buildRoutePaymentAction(config, {
      path: "/api/agentcore-x402-payments",
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      reason: "Use this when the buyer intent is exactly AgentCore x402 payments, AgentCore Gateway, or Coinbase x402 Bazaar MCP server readiness."
    }),
    coinbaseX402BazaarMcpServer: buildRoutePaymentAction(config, {
      path: "/api/coinbase-x402-bazaar-mcp-server",
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      reason: "Use this when the buyer intent is exactly Coinbase x402 Bazaar MCP server or x402 Bazaar MCP server readiness."
    }),
    x402ListingQuality: buildRoutePaymentAction(config, {
      path: "/api/x402-listing-quality",
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      reason: "Use this when the buyer intent is exactly x402 listing quality."
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
      path: AGENT_LISTING_SCORE_PATH,
      method: "GET",
      price: config.instantScorePrice,
      maxAmountRequired: INSTANT_SCORE_AMOUNT,
      reason: "Use this exact score alias when the buyer asks for an agent listing conversion score, agent listing conversion, buyer-agent skip reasons, or agent service listing clarity."
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
      reason: "Use this when the buyer asks for an x402 site audit, x402 marketplace SEO audit, Bazaar search visibility check, paid API preflight, route health, or buyer-readiness signals before paying more."
    }),
    x402BuyerPrepayRiskScore: buildRoutePaymentAction(config, {
      path: "/api/x402-buyer-prepay-risk-score",
      method: "GET",
      price: config.siteAuditPrice,
      maxAmountRequired: SITE_AUDIT_AMOUNT,
      reason: "Use this exact-path route when the buyer asks for an x402 buyer prepay risk score before spending more."
    }),
    scoreX402EndpointBeforePaying: buildRoutePaymentAction(config, {
      path: "/api/score-x402-endpoint-before-paying",
      method: "GET",
      price: config.siteAuditPrice,
      maxAmountRequired: SITE_AUDIT_AMOUNT,
      reason: "Use this exact-path route when the buyer asks to score an x402 endpoint before paying."
    }),
    x402RouteHealthCheck: buildRoutePaymentAction(config, {
      path: "/api/x402-route-health-check",
      method: "GET",
      price: config.siteAuditPrice,
      maxAmountRequired: SITE_AUDIT_AMOUNT,
      reason: "Use this exact-path route when the buyer asks for an x402 route health check."
    }),
    x402ListingRankDoctor: buildRoutePaymentAction(config, {
      path: "/api/x402-listing-rank-doctor",
      method: "GET",
      price: config.siteAuditPrice,
      maxAmountRequired: SITE_AUDIT_AMOUNT,
      reason: "Use this exact-path route when the buyer asks for an x402 listing rank doctor check."
    }),
    discoveryAuditQuick: buildRoutePaymentAction(config, {
      path: DISCOVERY_AUDIT_PATH,
      method: "GET",
      price: config.siteAuditPrice,
      maxAmountRequired: DISCOVERY_AUDIT_QUICK_AMOUNT,
      reason: "Use this when the buyer asks to fix x402 Bazaar listing visibility, Agent402 route visibility, stale pricing, search visibility, route health, or wants the cheapest exact-path discovery audit before the full custom audit."
    }),
    agent402RouteVisibility: buildRoutePaymentAction(config, {
      path: AGENT402_ROUTE_VISIBILITY_PATH,
      method: "GET",
      price: config.siteAuditPrice,
      maxAmountRequired: DISCOVERY_AUDIT_QUICK_AMOUNT,
      reason: "Use this exact-path alias when the buyer or router asks for Agent402 route visibility, Agent402 router ranking, or why Agent402 is not routing to an x402 endpoint."
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
      reason: "Use this when the buyer wants the full rewrite, top fixes, and stop-or-upgrade guidance with a custom request body; omitted bodies use safe defaults."
    }),
    fullRoastGet: buildRoutePaymentAction(config, {
      path: FULL_ROAST_GET_PATH,
      method: "GET",
      price: config.price,
      maxAmountRequired: "10000",
      reason: "Use this exact high-intent GET route when the buyer wants the full listing roast, rewritten copy, top fixes, buyer-agent skip reasons, and stop-or-upgrade guidance without assembling a POST body."
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
      use: "fullRoastGet",
      action: intentRoutes.fullRoastGet,
      reason: "Upgrade to the direct $0.01 GET full roast when the quick score is promising and the buyer wants rewritten copy, top fixes, buyer-agent skip reasons, and launch guidance without assembling a body."
    }
  ];
}

function buildIntentRecommendedPaidSequence(intentRoutes, selectedActionKey = "indexedQuickScore", selectedPaidAction = null) {
  return buildSelectedPaidSequence(intentRoutes, selectedActionKey, selectedPaidAction);
}

const SELECTED_FOLLOWUP_ACTION_BY_KEY = {
  directoryPost: "indexedQuickScore",
  apiEntry: "indexedQuickScore",
  apiV1Entry: "indexedQuickScore",
  v1Entry: "indexedQuickScore",
  indexedQuickScore: "fullRoastGet",
  marketplaceListingScore: "fullRoastGet",
  marketplaceListingConversion: "fullRoastGet",
  marketplaceProductListingQuality: "fullRoastGet",
  paidApiListingQuality: "fullRoastGet",
  paidApiListingQualityScore: "fullRoastGet",
  listingQualityScoreApi: "fullRoastGet",
  agentCoreX402Payments: "fullRoastGet",
  coinbaseX402BazaarMcpServer: "fullRoastGet",
  x402ListingQuality: "fullRoastGet",
  buyerAgentSkipReasons: "fullRoastGet",
  agentServiceClarity: "fullRoastGet",
  instantScore: "fullRoastGet",
  conversionScore: "fullRoastGet",
  agentListingConversion: "fullRoastGet",
  x402Ping: "indexedQuickScore",
  x402SiteAudit: "discoveryAuditQuick",
  x402BuyerPrepayRiskScore: "discoveryAudit",
  scoreX402EndpointBeforePaying: "discoveryAudit",
  x402RouteHealthCheck: "discoveryAudit",
  x402ListingRankDoctor: "discoveryAudit",
  agent402RouteVisibility: "discoveryAudit",
  discoveryAuditQuick: "discoveryAudit",
  listingScore: "fullRoastGet"
};

const QUICK_SCORE_EXACT_ALIAS_ACTION_KEYS = new Set([
  "marketplaceListingScore",
  "marketplaceListingConversion",
  "marketplaceProductListingQuality",
  "paidApiListingQuality",
  "paidApiListingQualityScore",
  "listingQualityScoreApi",
  "agentCoreX402Payments",
  "coinbaseX402BazaarMcpServer",
  "x402ListingQuality",
  "buyerAgentSkipReasons",
  "agentServiceClarity"
]);

const EXACT_ALIAS_FIRST_ACTION_KEYS = new Set([]);
const TERMINAL_PAID_ACTION_KEYS = new Set(["fullRoast", "fullRoastGet"]);

function isQuickScoreExactAliasActionKey(selectedActionKey) {
  return QUICK_SCORE_EXACT_ALIAS_ACTION_KEYS.has(selectedActionKey);
}

function shouldUseExactAliasFirst(selectedActionKey) {
  return EXACT_ALIAS_FIRST_ACTION_KEYS.has(selectedActionKey);
}

function isTerminalPaidActionKey(actionKey = "") {
  return TERMINAL_PAID_ACTION_KEYS.has(actionKey);
}

function firstPaidActionForSelectedIntent(intentRoutes, selectedActionKey = "indexedQuickScore", selectedPaidAction = null) {
  if (isQuickScoreExactAliasActionKey(selectedActionKey) && !shouldUseExactAliasFirst(selectedActionKey)) {
    return intentRoutes.indexedQuickScore;
  }

  return selectedPaidAction || intentRoutes.indexedQuickScore;
}

function handoffSelectedPaidActionForSelection(intentRoutes, selectedActionKey = "indexedQuickScore", selectedPaidAction = null) {
  return firstPaidActionForSelectedIntent(intentRoutes, selectedActionKey, selectedPaidAction);
}

function exactIntentPaidActionForSelection(intentRoutes, selectedActionKey = "indexedQuickScore", selectedPaidAction = null) {
  if (!isQuickScoreExactAliasActionKey(selectedActionKey)) {
    return null;
  }

  const firstAction = firstPaidActionForSelectedIntent(intentRoutes, selectedActionKey, selectedPaidAction);
  const exactAction = selectedPaidAction || null;

  if (!exactAction || (exactAction.path === firstAction.path && exactAction.method === firstAction.method)) {
    return null;
  }

  return exactAction;
}

function upgradePaidActionForLandingPage(intentRoutes, page, exactIntentPaidAction = null) {
  if (
    exactIntentPaidAction &&
    page.supportingAction.path === intentRoutes.indexedQuickScore.path &&
    page.supportingAction.method === intentRoutes.indexedQuickScore.method
  ) {
    return intentRoutes.fullRoastGet;
  }

  return page.supportingAction;
}

function buildSelectedPaidSequence(intentRoutes, selectedActionKey = "indexedQuickScore", selectedPaidAction = null) {
  const firstAction = firstPaidActionForSelectedIntent(intentRoutes, selectedActionKey, selectedPaidAction);
  const firstUse = isQuickScoreExactAliasActionKey(selectedActionKey) && !shouldUseExactAliasFirst(selectedActionKey)
    ? "indexedQuickScore"
    : selectedActionKey;
  const sequence = [
    {
      step: 1,
      use: firstUse,
      action: firstAction,
      reason: isQuickScoreExactAliasActionKey(selectedActionKey) && !shouldUseExactAliasFirst(selectedActionKey)
        ? "Start with the already-indexed, wallet-backed route for this quick-score intent. The phrase-specific alias remains available when an agent needs that exact URL."
        : "Use this first for the selected buyer intent. It is the exact route returned by the no-spend route selector."
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

  if (isQuickScoreExactAliasActionKey(selectedActionKey) && !isProvenRoute) {
    if (shouldUseExactAliasFirst(selectedActionKey)) {
      return `For this exact buyer intent, start with ${selected.method} ${selected.path} at max ${selected.maxAmountRequired} USDC units so the paid URL matches the buyer phrase. Use ${provenFirstPaidAction.method} ${provenFirstPaidAction.path} when the buyer came from a generic Bazaar result and wants the already-indexed route with wallet-backed paid-use proof.`;
    }

    return `For this quick-score buyer intent, start with ${provenFirstPaidAction.method} ${provenFirstPaidAction.path} at max ${provenFirstPaidAction.maxAmountRequired} USDC units because it is the already-indexed route with wallet-backed paid-use proof. Use ${selected.method} ${selected.path} only when the buyer explicitly needs the phrase-specific URL; both routes return the same $0.001 quick score.`;
  }

  if (isProvenRoute) {
    return `For generic Bazaar or marketplace traffic, start with ${selected.method} ${selected.path} at max ${selected.maxAmountRequired} USDC units; it is the proven first paid route.`;
  }

  return `For this exact buyer intent, start with ${selected.method} ${selected.path} at max ${selected.maxAmountRequired} USDC units. Use ${provenFirstPaidAction.method} ${provenFirstPaidAction.path} when the buyer came from a generic Bazaar result instead of this specific task.`;
}

const PAY_NOW_ACTION_BY_RESOURCE_ID = {
  indexed_roast_quick_score: "indexedQuickScore",
  marketplace_listing_score_alias: "marketplaceListingScore",
  marketplace_listing_conversion_api_alias: "marketplaceListingConversion",
  marketplace_listing_conversion_alias: "marketplaceListingConversion",
  marketplace_product_listing_quality_alias: "marketplaceProductListingQuality",
  paid_api_listing_quality_alias: "paidApiListingQuality",
  paid_api_listing_quality_score_alias: "paidApiListingQualityScore",
  listing_quality_score_api_alias: "listingQualityScoreApi",
  agentcore_x402_payments_alias: "agentCoreX402Payments",
  coinbase_x402_bazaar_mcp_server_alias: "coinbaseX402BazaarMcpServer",
  x402_listing_quality_alias: "x402ListingQuality",
  buyer_agent_skip_reasons_alias: "buyerAgentSkipReasons",
  agent_service_clarity_alias: "agentServiceClarity",
  directory_root_post: "directoryPost",
  instant_listing_score: "instantScore",
  x402_marketplace_conversion_score: "conversionScore",
  agent_listing_conversion_score: "agentListingConversion",
  agent_listing_conversion_score_alias: "agentListingConversion",
  x402_ping: "x402Ping",
  x402_site_audit: "x402SiteAudit",
  agent402_route_visibility_audit: "agent402RouteVisibility",
  paid_api_preflight: "x402SiteAudit",
  api_v1_paid_api_preflight: "x402SiteAudit",
  root_paid_api_preflight: "x402SiteAudit",
  x402_buyer_prepay_risk_score: "x402BuyerPrepayRiskScore",
  score_x402_endpoint_before_paying: "scoreX402EndpointBeforePaying",
  x402_route_health_check: "x402RouteHealthCheck",
  x402_listing_rank_doctor: "x402ListingRankDoctor",
  x402_discovery_audit_quick: "discoveryAuditQuick",
  full_listing_roast_get: "fullRoastGet",
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
  const selectedActionKey = quickScoreAliasActionKeyForQuery(rawIntent) || PAY_NOW_ACTION_BY_RESOURCE_ID[selectedRoute?.id] || "indexedQuickScore";

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

function buildPayNow(config, intent = "", cashRegister = {}, receiverWallet = null) {
  const selection = selectPayNowAction(config, intent);
  const { intentRoutes, selectedPaidAction } = selection;
  const provenFirstPaidAction = intentRoutes.indexedQuickScore;
  const selectedFirstPaidAction = firstPaidActionForSelectedIntent(intentRoutes, selection.selectedActionKey, selectedPaidAction);
  const exactIntentPaidAction = exactIntentPaidActionForSelection(intentRoutes, selection.selectedActionKey, selectedPaidAction);
  const selectedPaidSequence = buildSelectedPaidSequence(intentRoutes, selection.selectedActionKey, selectedPaidAction);
  const handoffSelectedPaidAction = handoffSelectedPaidActionForSelection(intentRoutes, selection.selectedActionKey, selectedPaidAction);
  const selectedPaidRoute = compactPaidAction(handoffSelectedPaidAction);
  const firstPaidRoute = compactPaidAction(selectedFirstPaidAction);
  const exactIntentPaidRoute = exactIntentPaidAction ? compactPaidAction(exactIntentPaidAction) : null;
  const genericRecommendedPaidSequence = buildRecommendedPaidSequence(intentRoutes);
  const recommendedPaidSequence = buildIntentRecommendedPaidSequence(intentRoutes, selection.selectedActionKey, selectedPaidAction);
  const paymentShortcut = buildPaymentShortcutForAction(
    config,
    handoffSelectedPaidAction,
    selectedFirstPaidAction,
    selection.selectedActionKey,
    intentRoutes
  );
  const publicCdpStaleCardOverride = buildPublicCdpStaleCardOverride(
    config,
    intentRoutes,
    selectedFirstPaidAction,
    handoffSelectedPaidAction
  );

  return {
    service: config.serviceName,
    metadataVersion: DISCOVERY_METADATA_VERSION,
    metadataUpdatedAt: DISCOVERY_METADATA_UPDATED_AT,
    paidUsageProof: buildPaidUsageProof(config, cashRegister, receiverWallet),
    settlementProof: buildSettlementProof(config, cashRegister),
    officialCdpDiscovery: buildOfficialCdpDiscoveryHandoff(config),
    publicCdpStaleCardOverride,
    commands: absoluteUrl(config, COMMANDS_PATH),
    links: {
      commands: absoluteUrl(config, COMMANDS_PATH),
      paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
      pricing: absoluteUrl(config, PRICING_PATH),
      find: absoluteUrl(config, FIND_PATH),
      route: absoluteUrl(config, ROUTE_PATH),
      x402Manifest: absoluteUrl(config, "/x402.json"),
      openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH)
    },
    intent: selection.intent || null,
    selectedActionKey: selection.selectedActionKey,
    paymentShortcut,
    ...(paymentShortcut.upgradeAfterQuickScore ? { upgradeAfterQuickScore: paymentShortcut.upgradeAfterQuickScore } : {}),
    selectedPaidRoute,
    selectedPaidUrl: selectedPaidRoute.route,
    selectedPaidPath: selectedPaidRoute.path,
    selectedPaidMethod: selectedPaidRoute.method,
    selectedPaidPrice: selectedPaidRoute.price,
    selectedPaidMaxAmountRequired: selectedPaidRoute.maxAmountRequired,
    selectedPaidAction: handoffSelectedPaidAction,
    firstPaidRoute,
    firstPaidUrl: firstPaidRoute.route,
    firstPaidPath: firstPaidRoute.path,
    firstPaidMethod: firstPaidRoute.method,
    firstPaidPrice: firstPaidRoute.price,
    firstPaidMaxAmountRequired: firstPaidRoute.maxAmountRequired,
    payableRoute: firstPaidRoute,
    ...(exactIntentPaidAction ? {
      exactIntentPaidAction,
      exactIntentPaidRoute,
      exactIntentPaidUrl: exactIntentPaidRoute.route,
      exactIntentPaidPath: exactIntentPaidRoute.path
    } : {}),
    rankedPaidRoutes: selection.rankedPaidRoutes || [],
    route: selectedFirstPaidAction.route,
    method: selectedFirstPaidAction.method,
    price: selectedFirstPaidAction.price,
    maxAmountRequired: selectedFirstPaidAction.maxAmountRequired,
    network: config.network,
    payTo: config.payTo,
    command: selectedFirstPaidAction.command,
    reason: selection.intent
      ? (exactIntentPaidAction
        ? `Selected from the buyer intent: ${selection.intent}; first paid command uses the already-indexed wallet-backed route before the phrase-specific alias.`
        : `Selected from the buyer intent: ${selection.intent}`)
      : "Already-indexed Bazaar route and lowest-friction paid score.",
    preferredFirstPaidAction: provenFirstPaidAction,
    provenFirstPaidAction,
    provenFirstPaidReason: "Use this first when the buyer wants the already-indexed route with wallet-backed paid-use proof. Exact alias routes remain available for phrase-specific searches.",
    selectedFirstPaidAction,
    paidResponsePreview: buildPaidResponsePreview(
      config,
      isQuickScoreExactAliasActionKey(selection.selectedActionKey) && !shouldUseExactAliasFirst(selection.selectedActionKey) ? "indexedQuickScore" : selection.selectedActionKey,
      selectedFirstPaidAction
    ),
    selectedFirstPaidResponsePreview: buildPaidResponsePreview(
      config,
      isQuickScoreExactAliasActionKey(selection.selectedActionKey) && !shouldUseExactAliasFirst(selection.selectedActionKey) ? "indexedQuickScore" : selection.selectedActionKey,
      selectedFirstPaidAction
    ),
    selectedPaidSequence,
    buyerInstruction: buildSelectedBuyerInstruction(selection.selectedActionKey, selectedPaidAction, provenFirstPaidAction),
    recommendedPaidSequence,
    genericRecommendedPaidSequence,
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
        when: "Buyer asks exactly for marketplace listing conversion API, marketplace listing conversion, marketplace conversion score, or x402 marketplace conversion",
        use: "marketplaceListingConversion"
      },
      {
        when: "Buyer asks exactly for marketplace product listing quality",
        use: "marketplaceProductListingQuality"
      },
      {
        when: "Buyer asks exactly for paid API listing quality",
        use: "paidApiListingQuality"
      },
      {
        when: "Buyer asks exactly for paid API listing quality score",
        use: "paidApiListingQualityScore"
      },
      {
        when: "Buyer asks exactly for listing quality score API",
        use: "listingQualityScoreApi"
      },
      {
        when: "Buyer asks exactly for AgentCore x402 payments or AgentCore Gateway readiness",
        use: "agentCoreX402Payments"
      },
      {
        when: "Buyer asks exactly for Coinbase x402 Bazaar MCP server, x402 Bazaar MCP server, or Bazaar MCP tools",
        use: "coinbaseX402BazaarMcpServer"
      },
      {
        when: "Buyer asks exactly for x402 listing quality",
        use: "x402ListingQuality"
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
        when: "Buyer asks for x402 discovery audit, stale Bazaar pricing, Agent402 route visibility, route health, or search visibility",
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
    buyerPhraseCommandPack: buildBuyerPhraseCommandPack(config),
    intentRoutes,
    expectedChallenge: {
      status: 402,
      amount: selectedFirstPaidAction.maxAmountRequired,
      network: config.network,
      route: selectedFirstPaidAction.route
    },
    upgradeRoutes: {
      score: intentRoutes.listingScore,
      roast: intentRoutes.fullRoast,
      discoveryAudit: intentRoutes.discoveryAudit
    },
    marketplaceNote: "CDP Bazaar updates indexed descriptions after a real settled payment; this free handoff reflects the current live route map without spending.",
    bazaarCataloging: buildBazaarCatalogingGuidance(config),
    intentHint: `${absoluteUrl(config, PAY_NOW_PATH)}?intent=buyer-agent%20skip%20reasons`,
    noSpendNote: "Fetching this endpoint is free. Payment happens only when a buyer calls the x402 paid route."
  };
}

function buildPayNowIntentExample(config, intent, selectedActionKey) {
  const intentRoutes = buildPayNowActions(config);
  const selectedPaidAction = intentRoutes[selectedActionKey] || intentRoutes.indexedQuickScore;
  const provenFirstPaidAction = intentRoutes.indexedQuickScore;
  const selectedFirstPaidAction = firstPaidActionForSelectedIntent(intentRoutes, selectedActionKey, selectedPaidAction);
  const exactIntentPaidAction = exactIntentPaidActionForSelection(intentRoutes, selectedActionKey, selectedPaidAction);
  const genericRecommendedPaidSequence = buildRecommendedPaidSequence(intentRoutes);
  const recommendedPaidSequence = buildIntentRecommendedPaidSequence(intentRoutes, selectedActionKey, selectedPaidAction);
  const handoffSelectedPaidAction = handoffSelectedPaidActionForSelection(intentRoutes, selectedActionKey, selectedPaidAction);
  const paymentShortcut = buildPaymentShortcutForAction(
    config,
    handoffSelectedPaidAction,
    selectedFirstPaidAction,
    selectedActionKey,
    intentRoutes
  );
  const publicCdpStaleCardOverride = buildPublicCdpStaleCardOverride(
    config,
    intentRoutes,
    selectedFirstPaidAction,
    handoffSelectedPaidAction
  );

  return {
    service: config.serviceName,
    metadataVersion: DISCOVERY_METADATA_VERSION,
    metadataUpdatedAt: DISCOVERY_METADATA_UPDATED_AT,
    intent,
    selectedActionKey,
    publicCdpStaleCardOverride,
    paymentShortcut,
    ...(paymentShortcut.upgradeAfterQuickScore ? { upgradeAfterQuickScore: paymentShortcut.upgradeAfterQuickScore } : {}),
    selectedPaidAction: handoffSelectedPaidAction,
    ...(exactIntentPaidAction ? { exactIntentPaidAction } : {}),
    selectedFirstPaidAction,
    selectedPaidSequence: buildSelectedPaidSequence(intentRoutes, selectedActionKey, selectedPaidAction),
    route: selectedFirstPaidAction.route,
    method: selectedFirstPaidAction.method,
    price: selectedFirstPaidAction.price,
    maxAmountRequired: selectedFirstPaidAction.maxAmountRequired,
    network: config.network,
    payTo: config.payTo,
    command: selectedFirstPaidAction.command,
    reason: exactIntentPaidAction
      ? `Selected from the buyer intent: ${intent}; first paid command uses the already-indexed wallet-backed route before the phrase-specific alias.`
      : `Selected from the buyer intent: ${intent}`,
    preferredFirstPaidAction: provenFirstPaidAction,
    provenFirstPaidAction,
    paidResponsePreview: buildPaidResponsePreview(
      config,
      isQuickScoreExactAliasActionKey(selectedActionKey) && !shouldUseExactAliasFirst(selectedActionKey) ? "indexedQuickScore" : selectedActionKey,
      selectedFirstPaidAction
    ),
    selectedFirstPaidResponsePreview: buildPaidResponsePreview(
      config,
      isQuickScoreExactAliasActionKey(selectedActionKey) && !shouldUseExactAliasFirst(selectedActionKey) ? "indexedQuickScore" : selectedActionKey,
      selectedFirstPaidAction
    ),
    buyerInstruction: buildSelectedBuyerInstruction(selectedActionKey, selectedPaidAction, provenFirstPaidAction),
    recommendedPaidSequence,
    genericRecommendedPaidSequence
  };
}

function buildPayNowIntentExamples(config) {
  return {
    skipReasons: buildPayNowIntentExample(config, "buyer-agent skip reasons", "buyerAgentSkipReasons"),
    discoveryAudit: buildPayNowIntentExample(config, "x402 discovery audit", "discoveryAuditQuick"),
    fullRoast: buildPayNowIntentExample(config, "full roast rewrite top fixes", "fullRoastGet")
  };
}

function compactPaidAction(action) {
  return {
    route: action.route,
    path: action.path,
    method: action.method,
    price: action.price,
    maxAmountRequired: action.maxAmountRequired,
    maxPaymentUsd: action.maxPaymentUsd,
    agentPaymentRequest: action.agentPaymentRequest,
    agentPaymentPrompt: action.agentPaymentPrompt,
    command: action.command,
    reason: action.reason,
    ...(action.body ? { body: action.body } : {})
  };
}

function buildUpgradeAfterQuickScoreShortcut(intentRoutes = {}) {
  const fullRoastUpgrade = intentRoutes.fullRoastGet || intentRoutes.fullRoast;
  if (!fullRoastUpgrade) {
    return null;
  }

  return {
    selectedPaidUrl: fullRoastUpgrade.route,
    selectedPaidPath: fullRoastUpgrade.path,
    selectedPaidMethod: fullRoastUpgrade.method,
    selectedPaidPrice: fullRoastUpgrade.price,
    selectedPaidMaxAmountRequired: fullRoastUpgrade.maxAmountRequired,
    maxPaymentUsd: fullRoastUpgrade.maxPaymentUsd,
    paymentRequiredHeader: "Payment-Required",
    paymentHeader: "X-PAYMENT",
    agentPaymentPrompt: fullRoastUpgrade.agentPaymentPrompt,
    command: fullRoastUpgrade.command,
    expectedOutput: ["rewrittenListing", "topFixes", "buyerAgentSkipReasons", "stopOrUpgrade"],
    instruction: "Use this after the $0.001 quick score when the buyer wants the full rewrite, top fixes, buyer-agent skip reasons, and launch guidance."
  };
}

function buildDirectFullRoastNowShortcut(intentRoutes = {}) {
  const fullRoast = intentRoutes.fullRoastGet || intentRoutes.fullRoast;
  if (!fullRoast) {
    return null;
  }

  return {
    selectedPaidUrl: fullRoast.route,
    selectedPaidPath: fullRoast.path,
    selectedPaidMethod: fullRoast.method,
    selectedPaidPrice: fullRoast.price,
    selectedPaidMaxAmountRequired: fullRoast.maxAmountRequired,
    maxPaymentUsd: fullRoast.maxPaymentUsd,
    paymentRequiredHeader: "Payment-Required",
    paymentHeader: "X-PAYMENT",
    agentPaymentPrompt: fullRoast.agentPaymentPrompt,
    command: fullRoast.command,
    expectedOutput: ["rewrittenListing", "topFixes", "buyerAgentSkipReasons", "stopOrUpgrade"],
    whenToUse: "Use this instead of the quick score when the buyer searched for full listing roast, rewrite, top fixes, or buyer-agent skip reasons and is willing to pay $0.01 immediately.",
    instruction: "Call this direct full-roast route with the x402 payment header when the buyer wants the complete rewrite now instead of a $0.001 quick score first."
  };
}

function isQuickScorePaidAction(action = {}) {
  return action.method === "GET"
    && action.maxAmountRequired === "1000"
    && QUICK_SCORE_PAID_PATHS.includes(action.path);
}

function buildPaymentShortcutForAction(config, selectedPaidAction, firstPaidAction, intentRouteKey = "indexedQuickScore", intentRoutes = {}) {
  const selectedAgentPaymentRequest = buildAgentPaymentRequest(selectedPaidAction);
  const firstAgentPaymentRequest = buildAgentPaymentRequest(firstPaidAction);
  const upgradeAfterQuickScore = isQuickScorePaidAction(firstPaidAction)
    ? buildUpgradeAfterQuickScoreShortcut(intentRoutes)
    : null;
  const directFullRoastNow = isQuickScorePaidAction(firstPaidAction)
    ? buildDirectFullRoastNowShortcut(intentRoutes)
    : null;

  return {
    selectedPaidUrl: selectedPaidAction.route,
    selectedPaidPath: selectedPaidAction.path,
    selectedPaidMethod: selectedPaidAction.method,
    selectedPaidPrice: selectedPaidAction.price,
    selectedPaidMaxAmountRequired: selectedPaidAction.maxAmountRequired,
    firstPaidUrl: firstPaidAction.route,
    firstPaidPath: firstPaidAction.path,
    firstPaidMethod: firstPaidAction.method,
    firstPaidPrice: firstPaidAction.price,
    firstPaidMaxAmountRequired: firstPaidAction.maxAmountRequired,
    maxPaymentUsd: selectedAgentPaymentRequest.maxPayment,
    maxAmountRequired: selectedPaidAction.maxAmountRequired,
    firstMaxPaymentUsd: firstAgentPaymentRequest.maxPayment,
    paymentRequiredHeader: "Payment-Required",
    paymentHeader: "X-PAYMENT",
    payNow: payNowUrlForSelection(config, intentRouteKey, selectedPaidAction),
    commands: commandUrlForSelection(config, intentRouteKey, selectedPaidAction),
    command: firstPaidAction.command,
    noSpend: true,
    ...(upgradeAfterQuickScore ? { upgradeAfterQuickScore } : {}),
    ...(directFullRoastNow ? { directFullRoastNow } : {}),
    instruction: upgradeAfterQuickScore
      ? "Use the firstPaidUrl for the proven first paid action. Use upgradeAfterQuickScore only after the quick score shows enough fit."
      : "Use the firstPaidUrl for this paid action. This intent already points at the direct paid route, so no follow-up upgrade shortcut is needed."
  };
}

function buildPublicCdpStaleCardOverride(config, intentRoutes = {}, firstPaidAction = {}, selectedPaidAction = {}) {
  const indexedQuickScore = intentRoutes.indexedQuickScore || firstPaidAction || {};
  const directFullRoast = intentRoutes.fullRoastGet || {};

  return {
    source: "public-cdp-bazaar-card",
    status: "owned-live-metadata-overrides-stale-public-card",
    noSpend: true,
    livePaymentRule: "Use the live Payment-Required header amount and resource; do not use cached marketplace example fields as the payment amount.",
    stalePublicFieldsToIgnore: [
      "currentPrice example values such as $1.00",
      "older full-roast hints that say POST /api/listing-roast instead of GET /api/full-listing-roast"
    ],
    preferredFirstPaidPath: indexedQuickScore.path || ROAST_PATH,
    preferredFirstPaidMaxAmountRequired: indexedQuickScore.maxAmountRequired || INSTANT_SCORE_AMOUNT,
    selectedPaidPath: selectedPaidAction.path || indexedQuickScore.path || ROAST_PATH,
    selectedPaidMaxAmountRequired: selectedPaidAction.maxAmountRequired || indexedQuickScore.maxAmountRequired || INSTANT_SCORE_AMOUNT,
    directFullRoastPath: directFullRoast.path || FULL_ROAST_GET_PATH,
    directFullRoastMaxAmountRequired: directFullRoast.maxAmountRequired || "10000",
    proofBeforePay: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
    payNow: absoluteUrl(config, PAY_NOW_PATH),
    instruction: "If public CDP/Bazaar search returns stale example input, keep the buyer on this owned handoff, then pay only the live route selected here."
  };
}

function compactPaidSequence(sequence = []) {
  return sequence.map((step) => ({
    step: step.step,
    use: step.use,
    action: compactPaidAction(step.action),
    reason: step.reason
  }));
}

function buildBuyerPhraseCommandPack(config) {
  const intentRoutes = buildPayNowActions(config);
  const entries = [
    {
      intent: "paid API listing quality score",
      actionKey: "paidApiListingQualityScore",
      landingPage: PAID_API_LISTING_QUALITY_SCORE_PATH
    },
    {
      intent: "listing quality score API",
      actionKey: "listingQualityScoreApi",
      landingPage: LISTING_QUALITY_SCORE_API_PAGE_PATH
    },
    {
      intent: "x402 listing quality",
      actionKey: "x402ListingQuality",
      landingPage: X402_LISTING_QUALITY_PAGE_PATH
    },
    {
      intent: "marketplace listing conversion API",
      actionKey: "marketplaceListingConversion",
      landingPage: MARKETPLACE_LISTING_CONVERSION_PAGE_PATH
    },
    {
      intent: "marketplace product listing quality",
      actionKey: "marketplaceProductListingQuality",
      landingPage: MARKETPLACE_PRODUCT_LISTING_QUALITY_PAGE_PATH
    },
    {
      intent: "buyer-agent skip reasons",
      actionKey: "buyerAgentSkipReasons",
      landingPage: BUYER_AGENT_SKIP_REASONS_PAGE_PATH
    },
    {
      intent: "Agentic.Market listing score",
      actionKey: "marketplaceListingScore",
      landingPage: "/api/marketplace-listing-score"
    }
  ];

  return entries.map((entry) => {
    const exactAction = intentRoutes[entry.actionKey];
    const recommendedPaidSequence = compactPaidSequence(buildSelectedPaidSequence(intentRoutes, entry.actionKey, exactAction));
    const upgradeAfterFit = recommendedPaidSequence.find((step) => step.step === 2)?.action || compactPaidAction(intentRoutes.fullRoast);

    return {
      intent: entry.intent,
      landingPage: absoluteUrl(config, entry.landingPage),
      firstPaidAction: compactPaidAction(intentRoutes.indexedQuickScore),
      exactIntentPaidAction: compactPaidAction(exactAction),
      recommendedPaidSequence,
      upgradeAfterFit,
      command: intentRoutes.indexedQuickScore.command,
      firstPaidCommand: intentRoutes.indexedQuickScore.command,
      exactIntentCommand: exactAction.command,
      commandHandoff: `${absoluteUrl(config, COMMANDS_PATH)}?intent=${encodeURIComponent(entry.intent)}`,
      payNow: `${absoluteUrl(config, PAY_NOW_PATH)}?intent=${encodeURIComponent(entry.intent)}`,
      note: "Use the proven /api/listing-roast route first for generic marketplace traffic; use this exact alias when the buyer or crawler needs the paid URL to match the phrase."
    };
  });
}

function compactPaidUseProof(proof = {}) {
  return {
    paidCompletions: proof.paidCompletions,
    estimatedGrossRevenueUsd: proof.estimatedGrossRevenueUsd,
    lastPaidAt: proof.lastPaidAt,
    preferredConvertedRoute: proof.preferredConvertedRoute,
    source: proof.source,
    cashRegister: proof.cashRegister,
    noSpend: true
  };
}

function commandActionKeyForIntent(intent = "") {
  const rawIntent = String(intent || "").trim().slice(0, 400);
  const normalizedIntent = rawIntent.toLowerCase();

  if (!rawIntent) {
    return { intent: "", selectedActionKey: "indexedQuickScore" };
  }

  const quickAliasKey = quickScoreAliasActionKeyForQuery(rawIntent);
  if (quickAliasKey) {
    return { intent: rawIntent, selectedActionKey: quickAliasKey };
  }

  if (/\bping\b/.test(normalizedIntent)) {
    return { intent: rawIntent, selectedActionKey: "x402Ping" };
  }

  if (includesAny(normalizedIntent, ["agent402 route visibility", "agent402 router", "agent402 routing", "agent402 route"])) {
    return { intent: rawIntent, selectedActionKey: "agent402RouteVisibility" };
  }

  if (normalizedIntent.includes("discovery audit") || normalizedIntent.includes("stale") || normalizedIntent.includes("bazaar") || normalizedIntent.includes("search visibility") || normalizedIntent.includes("route health")) {
    return { intent: rawIntent, selectedActionKey: "discoveryAuditQuick" };
  }

  if (wantsPaidApiPreflight(normalizedIntent) || normalizedIntent.includes("site audit") || normalizedIntent.includes("openapi") || normalizedIntent.includes("llms") || normalizedIntent.includes("robots") || normalizedIntent.includes("sitemap") || normalizedIntent.includes("metadata")) {
    return { intent: rawIntent, selectedActionKey: "x402SiteAudit" };
  }

  if (normalizedIntent.includes("marketplace listing conversion") || normalizedIntent.includes("marketplace conversion") || normalizedIntent.includes("conversion score")) {
    return { intent: rawIntent, selectedActionKey: "marketplaceListingConversion" };
  }

  if (normalizedIntent.includes("agent listing conversion") || normalizedIntent.includes("listing conversion")) {
    return { intent: rawIntent, selectedActionKey: "agentListingConversion" };
  }

  if (normalizedIntent.includes("custom") || normalizedIntent.includes("body") || normalizedIntent.includes("listing score")) {
    return { intent: rawIntent, selectedActionKey: "listingScore" };
  }

  if (wantsFullRoastOutput(normalizedIntent)) {
    return { intent: rawIntent, selectedActionKey: "fullRoastGet" };
  }

  return { intent: rawIntent, selectedActionKey: "indexedQuickScore" };
}

function buildCommandHandoff(config, intent = "", cashRegister = {}) {
  const intentRoutes = buildPayNowActions(config);
  const proof = buildPaidUsageProof(config, cashRegister);
  const selection = commandActionKeyForIntent(intent);
  const selectedPaidAction = intentRoutes[selection.selectedActionKey] || intentRoutes.indexedQuickScore;
  const firstPaidAction = firstPaidActionForSelectedIntent(intentRoutes, selection.selectedActionKey, selectedPaidAction);
  const exactIntentPaidAction = exactIntentPaidActionForSelection(intentRoutes, selection.selectedActionKey, selectedPaidAction);
  const selectedPaidSequence = buildSelectedPaidSequence(intentRoutes, selection.selectedActionKey, selectedPaidAction);
  const compactSelectedPaidSequence = compactPaidSequence(selectedPaidSequence);
  const compactGenericRecommendedPaidSequence = compactPaidSequence(buildRecommendedPaidSequence(intentRoutes));
  const compactFirstPaidAction = compactPaidAction(firstPaidAction);
  const handoffSelectedPaidAction = handoffSelectedPaidActionForSelection(intentRoutes, selection.selectedActionKey, selectedPaidAction);
  const compactSelectedPaidAction = compactPaidAction(handoffSelectedPaidAction);
  const compactExactIntentPaidAction = exactIntentPaidAction ? compactPaidAction(exactIntentPaidAction) : null;
  const paymentShortcut = buildPaymentShortcutForAction(
    config,
    handoffSelectedPaidAction,
    firstPaidAction,
    selection.selectedActionKey,
    intentRoutes
  );
  const upgradeAction = isTerminalPaidActionKey(selection.selectedActionKey)
    ? null
    : selectedPaidSequence.find((step) => step.step === 2)?.action || intentRoutes.fullRoast;
  const commandIntentSuffix = selection.intent ? `?intent=${encodeURIComponent(selection.intent)}` : "";

  return {
    service: config.serviceName,
    kind: "compact-pay-command-handoff",
    metadataVersion: DISCOVERY_METADATA_VERSION,
    noSpend: true,
    intent: selection.intent || null,
    selectedActionKey: selection.selectedActionKey,
    summary: "Compact command-first handoff for buyer agents. Fetching this JSON is free; payment happens only when the buyer calls the returned x402 route with a valid payment header.",
    paymentShortcut,
    ...(paymentShortcut.upgradeAfterQuickScore ? { upgradeAfterQuickScore: paymentShortcut.upgradeAfterQuickScore } : {}),
    selectedPaidAction: compactSelectedPaidAction,
    selectedFirstPaidAction: compactFirstPaidAction,
    ...(compactExactIntentPaidAction ? { exactIntentPaidAction: compactExactIntentPaidAction } : {}),
    agentPaymentRequest: firstPaidAction.agentPaymentRequest,
    agentPaymentPrompt: firstPaidAction.agentPaymentPrompt,
    maxPaymentUsd: firstPaidAction.maxPaymentUsd,
    maxAmountRequired: firstPaidAction.maxAmountRequired,
    command: firstPaidAction.command,
    firstPaidCommand: firstPaidAction.command,
    payCommand: firstPaidAction.command,
    pay_command: firstPaidAction.command,
    commandHandoff: `${absoluteUrl(config, COMMANDS_PATH)}${commandIntentSuffix}`,
    freeHandoff: `${absoluteUrl(config, PAY_NOW_PATH)}${commandIntentSuffix}`,
    paidUseProof: compactPaidUseProof(proof),
    firstPaidAction: compactFirstPaidAction,
    selectedPaidSequence: compactSelectedPaidSequence,
    recommendedPaidSequence: compactSelectedPaidSequence,
    genericRecommendedPaidSequence: compactGenericRecommendedPaidSequence,
    buyerPhraseCommandPack: buildBuyerPhraseCommandPack(config),
    expectedChallenge: {
      status: 402,
      amount: firstPaidAction.maxAmountRequired,
      network: config.network,
      route: firstPaidAction.route
    },
    ...(upgradeAction ? { upgradeAfterFit: compactPaidAction(upgradeAction) } : {}),
    whenToPay: "Pay only when the buyer explicitly wants a paid API listing quality score, marketplace listing score, buyer-agent skip reasons, agent-service clarity check, or full listing roast.",
    whenNotToPay: "Do not pay for discovery, proof checks, pricing, route selection, or health checks; use the free links below first.",
    freeBeforePay: {
      payNow: absoluteUrl(config, PAY_NOW_PATH),
      commands: absoluteUrl(config, COMMANDS_PATH),
      paidUsageProof: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
      pricing: absoluteUrl(config, PRICING_PATH),
      find: absoluteUrl(config, FIND_PATH),
      route: absoluteUrl(config, ROUTE_PATH),
      x402Manifest: absoluteUrl(config, "/x402.json"),
      openApi: absoluteUrl(config, "/openapi.json")
    },
    officialCdpDiscovery: buildOfficialCdpDiscoveryHandoff(config),
    marketplaceNote: "CDP Bazaar updates indexed descriptions after a real settled payment; this free handoff reflects the current live route map without spending.",
    bazaarCataloging: buildBazaarCatalogingGuidance(config)
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

function paidCompletionRouteKeyFromSettlement(method, pathname) {
  const route = `${String(method || "GET").toUpperCase()} ${pathname || ROAST_PATH}`;
  const routeKeys = {
    [`GET ${ROOT_DIRECTORY_POST_PATH}`]: "directoryPost",
    [`POST ${ROOT_DIRECTORY_POST_PATH}`]: "directoryPost",
    [`GET ${API_ENTRY_PATH}`]: "apiEntry",
    [`GET ${INSTANT_SCORE_PATH}`]: "instantScore",
    [`GET ${CONVERSION_SCORE_PATH}`]: "conversionScore",
    [`GET ${AGENT_LISTING_PATH}`]: "agentListingConversion",
    [`GET ${AGENT_LISTING_SCORE_PATH}`]: "agentListingConversion",
    [`GET ${ROAST_PATH}`]: "indexedRoastGet",
    [`GET ${FULL_ROAST_GET_PATH}`]: "fullRoastGet",
    [`POST ${ROAST_PATH}`]: "listingRoast",
    [`POST ${SCORE_PATH}`]: "listingScorePost",
    [`GET ${PING_PATH}`]: "x402Ping",
    [`GET ${SITE_AUDIT_PATH}`]: "x402SiteAudit",
    [`GET ${DISCOVERY_AUDIT_PATH}`]: "x402DiscoveryAuditQuick",
    [`GET ${AGENT402_ROUTE_VISIBILITY_PATH}`]: "x402DiscoveryAuditQuick",
    [`POST ${DISCOVERY_AUDIT_PATH}`]: "x402DiscoveryAudit"
  };

  for (const aliasPath of SITE_AUDIT_PAID_PATHS) {
    routeKeys[`GET ${aliasPath}`] = "x402SiteAudit";
  }

  return routeKeys[route] || "walletSettlement";
}

function buildDerivedPaidCompletionFromSettlement(cashRegister = {}, settlement = null) {
  if (!settlement || Number(cashRegister.paidCompletions || 0) <= 0) {
    return null;
  }

  const route = settlement.route || {};
  const method = String(route.method || "GET").toUpperCase();
  const pathname = route.path || ROAST_PATH;

  return {
    paidAt: settlement.confirmedAt || cashRegister.lastPaidAt || null,
    kind: paidCompletionRouteKeyFromSettlement(method, pathname),
    routeKey: paidCompletionRouteKeyFromSettlement(method, pathname),
    method,
    path: pathname,
    estimatedRevenueUsd: settlement.usdc || null,
    source: "public_wallet_settlement",
    txHash: settlement.txHash,
    evidenceFields: ["latestWalletSettlement", "receiverWallet.usdcUnits"],
    note: "Derived from public wallet-settlement proof because this paid completion was imported as a baseline rather than recorded by the local event log."
  };
}

function buildPublicCashRegister(config, cashRegister = {}, receiverWallet = {}) {
  const latestWalletSettlement = buildLatestWalletSettlementProof(config);
  const recentPaidCompletions = Array.isArray(cashRegister.recentPaidCompletions) ? cashRegister.recentPaidCompletions : [];
  const derivedPaidCompletion = buildDerivedPaidCompletionFromSettlement(cashRegister, latestWalletSettlement);
  const shouldUseDerivedPaidCompletion = derivedPaidCompletion && !cashRegister.lastPaidCompletion && recentPaidCompletions.length === 0;

  return {
    ...cashRegister,
    ...(latestWalletSettlement ? { latestWalletSettlement } : {}),
    ...(shouldUseDerivedPaidCompletion ? { derivedPaidCompletion } : {}),
    lastPaidCompletion: cashRegister.lastPaidCompletion || (shouldUseDerivedPaidCompletion ? derivedPaidCompletion : null),
    recentPaidCompletions: shouldUseDerivedPaidCompletion ? [derivedPaidCompletion] : recentPaidCompletions,
    receiverWallet
  };
}

function buildPaidResponsePreview(config, intentRouteKey = "indexedQuickScore", selectedPaidAction = null) {
  const quickScoreExample = () => buildIndexedRoastQuickScoreDiscoveryExample(buildInstantScoreInput(), config);
  const previewByIntent = {
    directoryPost: {
      includes: ["route map", "preferred first paid action", "paid usage proof"],
      example: () => buildApiEntryOutput(config)
    },
    apiEntry: {
      includes: ["route map", "preferred first paid action", "paid usage proof"],
      example: () => buildApiEntryOutput(config)
    },
    apiV1Entry: {
      includes: ["route map", "preferred first paid action", "paid usage proof"],
      example: () => buildApiEntryOutput(config)
    },
    v1Entry: {
      includes: ["route map", "preferred first paid action", "paid usage proof"],
      example: () => buildApiEntryOutput(config)
    },
    indexedQuickScore: {
      includes: ["verdict", "score", "first fix", "next paid action"],
      example: quickScoreExample
    },
    marketplaceListingScore: {
      includes: ["marketplace listing score", "marketplace listing conversion API", "buyer-agent skip reasons", "next paid action"],
      example: quickScoreExample
    },
    marketplaceProductListingQuality: {
      includes: ["marketplace product listing quality", "listing quality score API", "upgrade path"],
      example: quickScoreExample
    },
    paidApiListingQuality: {
      includes: ["paid API listing quality score", "first fix", "upgrade path"],
      example: quickScoreExample
    },
    paidApiListingQualityScore: {
      includes: ["paid API listing quality score", "marketplace listing score", "marketplace listing conversion API", "upgrade path"],
      example: quickScoreExample
    },
    listingQualityScoreApi: {
      includes: ["listing quality score API", "marketplace product listing quality", "upgrade path"],
      example: quickScoreExample
    },
    agentCoreX402Payments: {
      includes: ["AgentCore x402 payments readiness", "Coinbase x402 Bazaar MCP server buyers", "upgrade path"],
      example: quickScoreExample
    },
    coinbaseX402BazaarMcpServer: {
      includes: ["Coinbase x402 Bazaar MCP server readiness", "x402 Bazaar MCP server buyers", "upgrade path"],
      example: quickScoreExample
    },
    x402ListingQuality: {
      includes: ["x402 listing quality", "paid API listing quality score", "upgrade path"],
      example: quickScoreExample
    },
    buyerAgentSkipReasons: {
      includes: ["buyer-agent skip reasons", "score", "first fix"],
      example: quickScoreExample
    },
    agentServiceClarity: {
      includes: ["agent service clarity", "score", "first fix"],
      example: quickScoreExample
    },
    instantScore: {
      includes: ["verdict", "score", "first fix", "upgrade path"],
      example: () => buildInstantListingScore(buildInstantScoreInput(), config)
    },
    conversionScore: {
      includes: ["marketplace conversion verdict", "score", "next paid action"],
      example: () => buildConversionScore(buildInstantScoreInput(), config)
    },
    agentListingConversion: {
      includes: ["buyer-agent skip reasons", "agent service clarity", "next paid action"],
      example: () => buildAgentListingConversionScore(
        buildInstantScoreInput(agentListingConversionInputDefaults(selectedPaidAction?.path || AGENT_LISTING_SCORE_PATH)),
        config,
        { routePath: selectedPaidAction?.path || AGENT_LISTING_SCORE_PATH }
      )
    },
    x402Ping: {
      includes: ["payment confirmation echo", "route", "message"],
      example: () => buildPingOutput(config, { msg: "hello from x402" })
    },
    x402SiteAudit: {
      includes: ["direct 402 check", "metadata readiness", "next actions"],
      example: () => buildSiteAuditExampleOutput(config)
    },
    discoveryAuditQuick: {
      includes: ["stale pricing check", "Agent402 route visibility", "search visibility", "route health", "next actions"],
      example: () => buildDiscoveryAuditQuickExampleOutput(config)
    },
    agent402RouteVisibility: {
      includes: ["Agent402 route visibility", "Agent402 router ranking", "search visibility", "route health", "next actions"],
      example: () => buildAgent402RouteVisibilityExampleOutput(config)
    },
    listingScore: {
      includes: ["custom score", "first fix", "upgrade path"],
      example: () => buildListingScoreWithUpgrade(requestExample, config)
    },
    fullRoast: {
      includes: ["full rewrite", "top fixes", "stop-or-upgrade guidance"],
      example: () => buildListingRoast(requestExample)
    },
    fullRoastGet: {
      includes: ["full rewrite", "top fixes", "buyer-agent skip reasons", "stop-or-upgrade guidance"],
      example: () => buildListingRoast(buildInstantScoreInput({
        ...quickScoreRequestExample,
        currentPrice: config.price,
        currentCheckoutPath: FULL_ROAST_GET_PATH
      }))
    },
    discoveryAudit: {
      includes: ["full x402 discovery audit", "Agent402 route visibility", "mismatches", "next actions"],
      example: () => buildDiscoveryAuditExampleOutput()
    }
  };
  const preview = previewByIntent[intentRouteKey] || previewByIntent.indexedQuickScore;
  const action = selectedPaidAction || {};
  const upgradeAfterQuickScore = isQuickScorePaidAction(action)
    ? buildUpgradeAfterQuickScoreShortcut(buildPayNowActions(config))
    : null;

  return {
    noSpendPreview: true,
    outputType: "paid_json_response",
    route: action.path,
    method: action.method,
    price: action.price,
    maxAmountRequired: action.maxAmountRequired,
    whyPay: `Pay ${action.price || config.instantScorePrice} to receive this JSON output immediately after retrying with X-PAYMENT.`,
    ...(upgradeAfterQuickScore ? { upgradeAfterQuickScore } : {}),
    includes: preview.includes,
    example: compactChallengeOutputExample(preview.example())
  };
}

function buildAgentPaymentRequest(selected) {
  const maxPayment = priceToUsd(selected.price);
  const route = selected.route || selected.url;
  return {
    prompt: `Call this x402 endpoint with ${selected.method} and pay up to ${maxPayment} USDC: ${route}`,
    url: route,
    path: selected.path,
    method: selected.method,
    maxPayment,
    maxAmountRequired: selected.maxAmountRequired,
    paymentRequiredHeader: "Payment-Required",
    paymentHeader: "X-PAYMENT",
    safety: `Keep the cap at ${maxPayment} USDC / ${selected.maxAmountRequired} USDC units; abort if the live challenge asks for more.`
  };
}

function payNowIntentForSelection(intentRouteKey = "indexedQuickScore", selected = null) {
  if (selected?.path && QUICK_SCORE_ALIAS_METADATA[selected.path]) {
    return QUICK_SCORE_ALIAS_METADATA[selected.path].keywords[0];
  }

  if (selected?.path && PREFLIGHT_ALIAS_PATHS.includes(selected.path)) {
    return "paid API preflight";
  }

  const intentByRouteKey = {
    directoryPost: "directory handoff",
    apiEntry: "API entrypoint",
    listingScore: "custom listing score",
    instantScore: "instant listing score",
    conversionScore: "x402 marketplace conversion",
    agentListingConversion: "agent listing conversion",
    indexedQuickScore: "Listing Roast Quick Score",
    x402Ping: "x402 ping",
    x402SiteAudit: "x402 site audit",
    agent402RouteVisibility: "Agent402 route visibility",
    discoveryAuditQuick: "x402 discovery audit",
    discoveryAudit: "x402 discovery audit",
    fullRoast: "full listing roast",
    fullRoastGet: "full listing roast"
  };

  return intentByRouteKey[intentRouteKey] || "";
}

function payNowUrlForSelection(config, intentRouteKey = "indexedQuickScore", selected = null) {
  const baseUrl = absoluteUrl(config, PAY_NOW_PATH);
  const intent = payNowIntentForSelection(intentRouteKey, selected);

  return intent ? `${baseUrl}?intent=${encodeURIComponent(intent)}` : baseUrl;
}

function commandUrlForSelection(config, intentRouteKey = "indexedQuickScore", selected = null) {
  const baseUrl = absoluteUrl(config, COMMANDS_PATH);
  const intent = payNowIntentForSelection(intentRouteKey, selected);

  return intent ? `${baseUrl}?intent=${encodeURIComponent(intent)}` : baseUrl;
}

function buildUnpaidPaymentPreview(config, intentRouteKey = "indexedQuickScore", selectedOverride = null) {
  const payNow = buildPayNow(config);
  const selectedBase = payNow.intentRoutes[intentRouteKey] || payNow.preferredFirstPaidAction;
  const selected = selectedOverride?.path
    ? buildRoutePaymentAction(config, {
      path: selectedOverride.path,
      method: selectedOverride.method || selectedBase.method,
      price: selectedOverride.price || selectedBase.price,
      maxAmountRequired: selectedOverride.maxAmountRequired || selectedBase.maxAmountRequired,
      body: selectedOverride.body || selectedBase.body,
      reason: selectedOverride.reason || selectedBase.reason
    })
    : selectedBase;
  const resourceDescription = selectedOverride?.resourceDescription || selected.reason;
  const paidUseProof = buildPaidUseProofLinks(config);
  const settlementProof = buildSettlementProof(config);
  const paymentRouteKey = paymentRouteMetadataKey(intentRouteKey, selected);
  const selectedPaidUrl = absoluteUrl(config, selected.path);
  const paymentResource = {
    url: selectedPaidUrl,
    description: resourceDescription,
    mimeType: "application/json",
    ...challengeRouteServiceMetadata(paymentRouteKey)
  };
  const paymentAccepts = [{
    scheme: "exact",
    network: config.network,
    amount: selected.maxAmountRequired,
    asset: usdcAssetForNetwork(config.network),
    payTo: config.payTo,
    maxTimeoutSeconds: 300,
    extra: usdcPaymentExtra(config.network, paymentResource.url)
  }];
  const paidResponsePreview = buildPaidResponsePreview(config, intentRouteKey, selected);
  const agentPaymentRequest = buildAgentPaymentRequest(selected);
  const payNowUrl = payNowUrlForSelection(config, intentRouteKey, selected);
  const commandHandoffUrl = commandUrlForSelection(config, intentRouteKey, selected);
  const selectedFirstPaidAction = firstPaidActionForSelectedIntent(payNow.intentRoutes, intentRouteKey, selected);
  const exactIntentPaidAction = exactIntentPaidActionForSelection(payNow.intentRoutes, intentRouteKey, selected);
  const selectedPaidSequence = buildSelectedPaidSequence(payNow.intentRoutes, intentRouteKey, selected);
  const firstAgentPaymentRequest = buildAgentPaymentRequest(selectedFirstPaidAction);
  const firstPaidUrl = selectedFirstPaidAction?.path
    ? absoluteUrl(config, selectedFirstPaidAction.path)
    : selectedPaidUrl;
  const upgradeAfterQuickScore = isQuickScorePaidAction(selectedFirstPaidAction)
    ? buildUpgradeAfterQuickScoreShortcut(payNow.intentRoutes)
    : null;
  const directFullRoastNow = isQuickScorePaidAction(selectedFirstPaidAction)
    ? buildDirectFullRoastNowShortcut(payNow.intentRoutes)
    : null;
  const payableRoute = {
    selectedPaidUrl,
    selectedPaidPath: selected.path,
    selectedPaidMethod: selected.method,
    selectedPaidPrice: selected.price,
    selectedPaidMaxAmountRequired: selected.maxAmountRequired,
    firstPaidUrl,
    firstPaidPath: selectedFirstPaidAction.path,
    firstPaidMethod: selectedFirstPaidAction.method,
    firstPaidPrice: selectedFirstPaidAction.price,
    firstPaidMaxAmountRequired: selectedFirstPaidAction.maxAmountRequired,
    maxPaymentUsd: agentPaymentRequest.maxPayment,
    maxAmountRequired: selected.maxAmountRequired,
    paymentRequiredHeader: "Payment-Required",
    paymentHeader: "X-PAYMENT",
    payNow: payNowUrl,
    commands: commandHandoffUrl,
    command: selected.command,
    noSpend: true,
    ...(upgradeAfterQuickScore ? { upgradeAfterQuickScore } : {}),
    ...(directFullRoastNow ? { directFullRoastNow } : {}),
    instruction: "Use the Payment-Required header, pay no more than selectedPaidMaxAmountRequired, then retry selectedPaidUrl with the X-PAYMENT header."
  };
  const selectedFirstPaidResponsePreview = buildPaidResponsePreview(
    config,
    isQuickScoreExactAliasActionKey(intentRouteKey) && !shouldUseExactAliasFirst(intentRouteKey) ? "indexedQuickScore" : intentRouteKey,
    selectedFirstPaidAction
  );
  const sampleQueryInputs = selected.method === "GET" && QUICK_SCORE_PAID_PATHS.includes(selected.path)
    ? quickScoreAliasInputDefaults(selected.path)
    : null;
  const sampleQueryPayCommand = sampleQueryInputs
    ? buildGetPayCommandWithQuery(config, selected.path, selected.maxAmountRequired, sampleQueryInputs)
    : null;
  const officialCdpDiscovery = buildOfficialCdpDiscoveryHandoff(config);
  const publicCdpStaleCardOverride = buildPublicCdpStaleCardOverride(
    config,
    payNow.intentRoutes,
    selectedFirstPaidAction,
    selected
  );

  return {
    error: "payment_required",
    x402Version: 2,
    paymentShortcut: payableRoute,
    publicCdpStaleCardOverride,
    selectedPaidUrl,
    selectedPaidPath: selected.path,
    selectedPaidMethod: selected.method,
    selectedPaidPrice: selected.price,
    selectedPaidMaxAmountRequired: selected.maxAmountRequired,
    firstPaidUrl,
    firstPaidPath: selectedFirstPaidAction.path,
    firstPaidMethod: selectedFirstPaidAction.method,
    firstPaidPrice: selectedFirstPaidAction.price,
    firstPaidMaxAmountRequired: selectedFirstPaidAction.maxAmountRequired,
    ...(directFullRoastNow ? { directFullRoastNow } : {}),
    buyerDecision: {
      quickScoreNow: {
        route: firstPaidUrl,
        path: selectedFirstPaidAction.path,
        method: selectedFirstPaidAction.method,
        price: selectedFirstPaidAction.price,
        maxAmountRequired: selectedFirstPaidAction.maxAmountRequired,
        command: selectedFirstPaidAction.command,
        whenToUse: "Use this for the lowest-friction paid score, marketplace listing score, paid API listing quality score, or first paid proof check."
      },
      ...(directFullRoastNow ? { fullRoastNow: directFullRoastNow } : {}),
      proofBeforePay: paidUseProof.paidUsageProof,
      instruction: directFullRoastNow
        ? "If the buyer wants a quick score, pay quickScoreNow. If the buyer wants a full listing roast or rewrite immediately, pay fullRoastNow. Use proofBeforePay for free wallet-backed proof before paying."
        : "Use proofBeforePay for free wallet-backed proof before paying this direct paid route."
    },
    payableRoute,
    resource: paymentResource,
    accepts: paymentAccepts,
    paymentRequirementsSource: {
      authoritative: "Payment-Required response header",
      bodyMirror: true,
      note: "The Payment-Required header remains the source of truth. These body fields mirror the stable x402 amount, network, receiver, and resource for agents that inspect JSON first."
    },
    catalogRefreshHint: {
      resource: paymentResource.url,
      note: "Use the live Payment-Required header for payment; stale directory snippets may lag the current route metadata.",
      officialCdpDiscovery,
      ...(sampleQueryInputs ? {
        liveDefaults: {
          method: selected.method,
          path: selected.path,
          maxAmountRequired: selected.maxAmountRequired,
          ...sampleQueryInputs
        }
      } : {}),
      ...(sampleQueryInputs && selected.path === ROAST_PATH ? {
        staleCachedDirectoryInputGuard: {
          normalizedOnPaidRetry: true,
          stalePriceExample: "$1.00",
          livePrice: sampleQueryInputs.currentPrice,
          livePath: sampleQueryInputs.currentCheckoutPath,
          maxAmountRequired: selected.maxAmountRequired,
          note: "If an older CDP/Bazaar card forwards stale $1.00 query params to this route, the paid score normalizes those fields to the current live defaults before scoring."
        }
      } : {})
    },
    officialCdpDiscovery,
    service: config.serviceName,
    noSpendPreview: true,
    selectedActionKey: intentRouteKey,
    selectedPaidAction: selected,
    ...(exactIntentPaidAction ? { exactIntentPaidAction } : {}),
    selectedFirstPaidAction,
    selectedPaidSequence,
    agentPaymentRequest,
    agentPaymentPrompt: agentPaymentRequest.prompt,
    maxPaymentUsd: agentPaymentRequest.maxPayment,
    firstAgentPaymentRequest,
    firstAgentPaymentPrompt: firstAgentPaymentRequest.prompt,
    firstPayCommand: selectedFirstPaidAction.command,
    firstPaidCommand: selectedFirstPaidAction.command,
    payCommand: selected.command,
    pay_command: selected.command,
    command: selected.command,
    selectedPaidActionCommand: selected.command,
    exactIntentPayCommand: exactIntentPaidAction?.command || selected.command,
    payCommandExamples: {
      bareRoute: selected.command,
      ...(sampleQueryPayCommand ? { withSampleInputs: sampleQueryPayCommand } : {})
    },
    ...(sampleQueryPayCommand ? { sampleQueryPayCommand, sampleQueryInputs } : {}),
    payNow: payNowUrl,
    commandHandoff: commandHandoffUrl,
    whyPay: paidResponsePreview.whyPay,
    paidResponsePreview,
    selectedFirstPaidResponsePreview,
    buyerInstruction: buildSelectedBuyerInstruction(intentRouteKey, selected, payNow.preferredFirstPaidAction),
    preferredFirstPaidAction: payNow.preferredFirstPaidAction,
    recommendedPaidSequence: payNow.recommendedPaidSequence,
    routeSelector: payNow.routeSelector,
    intentRoutes: payNow.intentRoutes,
    freeHandoff: payNowUrl,
    commands: commandHandoffUrl,
    paidUsageProof: paidUseProof.paidUsageProof,
    cashRegister: paidUseProof.cashRegister,
    paidUseProof,
    settlementProof,
    x402Retry: {
      paymentRequiredHeader: "Payment-Required",
      paymentHeader: "X-PAYMENT",
      route: selected.path,
      method: selected.method,
      maxAmountRequired: selected.maxAmountRequired,
      maxPaymentUsd: agentPaymentRequest.maxPayment,
      agentPaymentPrompt: agentPaymentRequest.prompt,
      command: selected.command,
      instruction: "Parse the Payment-Required header, complete the exact x402 payment, then retry this same route with the X-PAYMENT header."
    },
    x402Manifest: absoluteUrl(config, "/x402.json"),
    openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH),
    note: "The x402 payment challenge is in the Payment-Required response header. This body is a free buyer handoff so agents can choose the right paid route without guessing."
  };
}

function unpaidPaymentPreview(config, intentRouteKey, selectedOverride = null) {
  return () => ({
    contentType: "application/json",
    body: buildUnpaidPaymentPreview(config, intentRouteKey, selectedOverride)
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
      mcpServerCardAliases: mcpServerCardAliasUrls(config),
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
        route: absoluteUrl(config, AGENT_LISTING_SCORE_PATH),
        path: AGENT_LISTING_SCORE_PATH,
        method: "GET",
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        buyerAction: "Exact agent listing conversion score alias with buyer-agent skip reasons and listing clarity score."
      },
      {
        route: absoluteUrl(config, SITE_AUDIT_PATH),
        path: SITE_AUDIT_PATH,
        method: "GET",
        price: config.siteAuditPrice,
        maxAmountRequired: SITE_AUDIT_AMOUNT,
        buyerAction: "Low-friction x402 metadata, Bazaar visibility, and Agent402 route audit."
      },
      {
        route: absoluteUrl(config, DISCOVERY_AUDIT_PATH),
        path: DISCOVERY_AUDIT_PATH,
        method: "POST",
        price: config.discoveryAuditPrice,
        maxAmountRequired: DISCOVERY_AUDIT_AMOUNT,
        buyerAction: "Full x402 discovery audit for stale marketplace pricing, Agent402 routing misses, or search misses."
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

function buildOpenApiPaymentRequiredResponse(config, intentRouteKey = "indexedQuickScore", selectedOverride = null) {
  return {
    description: "x402 payment required. Read the Payment-Required header, complete the exact USDC payment, then retry with the X-PAYMENT header.",
    headers: {
      "Payment-Required": {
        description: "Base64url-encoded x402 payment requirements with resource URL, accepted network, amount, payTo address, and Bazaar metadata.",
        schema: { type: "string" }
      },
      Link: {
        description: "Discovery links for the x402 manifest, compact command helper, pay-now helper, pricing catalog, OpenAPI document, and agent metadata.",
        schema: { type: "string" }
      }
    },
    content: {
      "application/json": {
        example: buildUnpaidPaymentPreview(config, intentRouteKey, selectedOverride)
      }
    }
  };
}

function buildOpenApiDocument(config, cashRegister = {}) {
  const intentRoutes = buildPayNowActions(config);
  const recommendedPaidSequence = buildRecommendedPaidSequence(intentRoutes);
  const officialCdpDiscovery = buildOfficialCdpDiscoveryHandoff(config);
  const paymentActionByRoute = {
    [`GET ${API_ENTRY_PATH}`]: "apiEntry",
    [`GET ${API_V1_ENTRY_PATH}`]: "apiV1Entry",
    [`GET ${V1_ENTRY_PATH}`]: "v1Entry",
    [`GET ${INSTANT_SCORE_PATH}`]: "instantScore",
    [`GET ${CONVERSION_SCORE_PATH}`]: "conversionScore",
    [`GET ${AGENT_LISTING_PATH}`]: "agentListingConversion",
    [`GET ${AGENT_LISTING_SCORE_PATH}`]: "agentListingConversion",
    [`GET ${PING_PATH}`]: "x402Ping",
    [`GET ${SITE_AUDIT_PATH}`]: "x402SiteAudit",
    [`GET ${DISCOVERY_AUDIT_PATH}`]: "discoveryAuditQuick",
    [`GET ${AGENT402_ROUTE_VISIBILITY_PATH}`]: "agent402RouteVisibility",
    [`POST ${DISCOVERY_AUDIT_PATH}`]: "discoveryAudit",
    "POST /api/listing-score": "listingScore",
    [`GET ${ROAST_PATH}`]: "indexedQuickScore",
    [`GET ${FULL_ROAST_GET_PATH}`]: "fullRoastGet",
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
        officialCdpDiscovery,
        preferredFirstPaidAction: intentRoutes.indexedQuickScore,
        recommendedPaidSequence
      },
      "x-recommended-first-paid-action": intentRoutes.indexedQuickScore,
      "x-recommended-paid-sequence": recommendedPaidSequence,
      "x-commands": absoluteUrl(config, COMMANDS_PATH),
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
      officialCdpDiscovery,
      preferredFirstPaidAction: intentRoutes.indexedQuickScore,
      recommendedPaidSequence,
      buyerInstruction: "If the buyer intends to spend USDC, start with GET /api/listing-roast at $0.001 / max 1000 USDC units; read the 402 Payment-Required header, complete x402 payment, then retry with X-PAYMENT."
    },
    "x-recommended-first-paid-action": intentRoutes.indexedQuickScore,
    "x-recommended-paid-sequence": recommendedPaidSequence,
    "x-commands": absoluteUrl(config, COMMANDS_PATH),
    "x-pay-now": absoluteUrl(config, PAY_NOW_PATH),
    "x-paid-usage-proof": absoluteUrl(config, PAID_USAGE_PROOF_PATH),
    paths: {
      [ROAST_PATH]: {
        get: {
          operationId: "getPaidApiListingQualityBuyerAgentSkipReasonsListingRoastQuickScore",
          tags: ["listing roast quick score", "paid API listing quality", "paid API listing quality score", "AgentCore x402 payments", "Coinbase x402 Bazaar MCP server", "buyer-agent skip reasons", "buyer agent skip reasons", "agent-service listing score", "agent service listing clarity", "x402 listing", "paid API listing"],
          summary: "Paid $0.001 paid API listing quality score, AgentCore x402 payments route, Listing Roast quick score, and buyer-agent skip reasons",
          description: "Listing quality score API for paid API listing quality score, AgentCore x402 payments readiness, Coinbase x402 Bazaar MCP server buyers, marketplace product listing quality, buyer-agent skip reasons, marketplace listing score, marketplace listing conversion API, agent service clarity, and agent service listing clarity. Lowest-price $0.001 score from indexed /api/listing-roast for AgentCore Gateway discovery, agent listing conversion score, x402 marketplace conversion, x402 discovery audit, x402 site audit, paid API preflight, fix x402 Bazaar listing, stale price, route health, Bazaar search visibility, and conversion checks; GET /api/full-listing-roast is the $0.01 direct full-roast upgrade.",
          "x-price": config.instantScorePrice,
          "x-x402-price": config.instantScorePrice,
          "x-payment": buildPaymentHint(config, {
            path: ROAST_PATH,
            method: "GET",
            price: config.instantScorePrice,
            maxAmountRequired: INSTANT_SCORE_AMOUNT,
            preferredFirstPaidAction: true,
            buyerAction: "Pay $0.001 on the already-indexed /api/listing-roast route for a paid API listing quality score, buyer-agent skip reasons, agent service listing clarity, and marketplace listing score."
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
          summary: "Paid $0.01 full roast rewrite and conversion guidance",
          description: "Returns paid API listing conversion feedback, marketplace listing quality fixes, buyer-agent skip reasons, rewritten listing copy, and stop-or-upgrade guidance after x402 payment. Custom JSON body is optional; omitted bodies use safe Listing Roast defaults.",
          "x-price": config.price,
          "x-x402-price": config.price,
          "x-payment": buildPaymentHint(config, {
            path: ROAST_PATH,
            method: "POST",
            price: config.price,
            maxAmountRequired: "10000",
            buyerAction: "Pay $0.01 for a custom-body full listing roast; omitted bodies use safe defaults for stale directory cards. Prefer GET /api/full-listing-roast for direct no-body checkout."
          }),
          requestBody: {
            required: false,
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
      [FULL_ROAST_GET_PATH]: {
        get: {
          operationId: "getFullListingRoast",
          tags: ["full listing roast", "listing roast rewrite", "buyer-agent skip reasons", "x402 listing"],
          summary: "Paid $0.01 direct full listing roast",
          description: "Direct GET full listing roast for buyer agents that want rewritten listing copy, top fixes, buyer-agent skip reasons, and stop-or-upgrade guidance without assembling a POST body.",
          "x-price": config.price,
          "x-x402-price": config.price,
          "x-payment": buildPaymentHint(config, {
            path: FULL_ROAST_GET_PATH,
            method: "GET",
            price: config.price,
            maxAmountRequired: "10000",
            buyerAction: "Pay $0.01 for the direct full listing roast, rewrite, top fixes, buyer-agent skip reasons, and stop-or-upgrade guidance."
          }),
          parameters: listingQueryOpenApiParameters({
            ...LISTING_QUERY_PARAMETER_EXAMPLES,
            currentPrice: config.price,
            currentCheckoutPath: FULL_ROAST_GET_PATH,
            goal: "Buy the full listing roast directly."
          }),
          responses: {
            200: {
              description: "Paid full roast response from the direct GET full-roast URL",
              content: {
                "application/json": {
                  schema: buildDiscovery(config).output.schema,
                  example: buildListingRoast(buildInstantScoreInput({
                    ...quickScoreRequestExample,
                    currentPrice: config.price,
                    currentCheckoutPath: FULL_ROAST_GET_PATH
                  }))
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
          tags: ["agent listing conversion score", "agent listing conversion", "agent service listing clarity", "agent service promotion readiness", "buyer-agent skip reasons", "buyer agent skip reasons", "x402 listing", "paid API listing", "paid API listing quality"],
          summary: "Paid $0.001 agent listing conversion score, agent listing conversion, buyer-agent skip reasons, agent service listing clarity, and agent service promotion readiness by Listing Roast",
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
          operationId: "getX402SiteAuditListingSeoMarketplaceSeoBazaarSearchVisibilitySellerGrowth",
          tags: ["x402 discovery", "x402 site audit", "x402 buyer prepay risk score", "score x402 endpoint before paying", "x402 seller discoverability", "x402 service discoverability audit", "fix x402 Bazaar listing", "x402 catalog metadata quality", "x402 listing SEO audit", "x402 listing rank doctor", "x402 seller growth checklist", "x402 seller intelligence", "x402 marketplace SEO audit", "paid API preflight", "x402 route health check", "stale Bazaar price", "paid API listing"],
          summary: "Paid $0.001 x402 site audit, x402 buyer prepay risk score, score x402 endpoint before paying, x402 listing SEO audit, x402 marketplace SEO audit, Bazaar search visibility, stale Bazaar price, route health, listing rank doctor, paid API preflight, and seller growth checklist",
          description: "Exact-path x402 site audit for agents that want a quick no-spend x402 buyer prepay risk score, score x402 endpoint before paying check, x402 route health check, x402 listing SEO audit, x402 marketplace SEO audit, Bazaar search visibility check, x402 listing rank doctor, x402 seller growth checklist, x402 seller intelligence, x402 seller discoverability audit, fix x402 Bazaar listing guidance, x402 catalog metadata quality check, paid API preflight, public x402 discovery check, pricing check, stale Bazaar price check, and direct 402 metadata check before buying the full audit.",
          "x-price": config.siteAuditPrice,
          "x-x402-price": config.siteAuditPrice,
          "x-payment": buildPaymentHint(config, {
            path: SITE_AUDIT_PATH,
            method: "GET",
            price: config.siteAuditPrice,
            maxAmountRequired: SITE_AUDIT_AMOUNT,
            buyerAction: "Pay $0.001 for a no-spend x402 site audit, buyer prepay risk score, endpoint-before-paying score, route health, listing-rank, metadata, pricing, and Bazaar search visibility check."
          }),
          parameters: [
            { name: "endpointUrl", in: "query", required: false, schema: { type: "string" } },
            { name: "url", in: "query", required: false, schema: { type: "string" } },
            { name: "base_url", in: "query", required: false, schema: { type: "string" } },
            { name: "baseUrl", in: "query", required: false, schema: { type: "string" } },
            { name: "targetUrl", in: "query", required: false, schema: { type: "string" } },
            { name: "resource", in: "query", required: false, schema: { type: "string" } },
            { name: "method", in: "query", required: false, schema: { type: "string", enum: ["GET", "POST"] } },
            { name: "expectedAmount", in: "query", required: false, schema: { type: "string" } },
            { name: "expectedNetwork", in: "query", required: false, schema: { type: "string" } },
            { name: "searchQuery", in: "query", required: false, schema: { type: "string" } },
            { name: "agent402Query", in: "query", required: false, schema: { type: "string" }, description: "Buyer query to test against Agent402 route ranking. Defaults to searchQuery." },
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
          tags: ["x402 discovery", "x402 discovery audit", "x402 seller discoverability", "Agent402 route visibility", "x402 route health check", "paid API preflight", "stale Bazaar price", "paid API listing"],
          summary: "Paid $0.001 x402 discovery audit quick check",
          description: "Exact-path GET route for agents that ask for an x402 discovery audit and need the cheapest paid route-health, stale Bazaar price, Agent402 route visibility, public x402 discovery, direct 402 metadata, and search visibility check before buying the full custom audit.",
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
            { name: "base_url", in: "query", required: false, schema: { type: "string" } },
            { name: "baseUrl", in: "query", required: false, schema: { type: "string" } },
            { name: "targetUrl", in: "query", required: false, schema: { type: "string" } },
            { name: "resource", in: "query", required: false, schema: { type: "string" } },
            { name: "method", in: "query", required: false, schema: { type: "string", enum: ["GET", "POST"] } },
            { name: "expectedAmount", in: "query", required: false, schema: { type: "string" } },
            { name: "expectedNetwork", in: "query", required: false, schema: { type: "string" } },
            { name: "searchQuery", in: "query", required: false, schema: { type: "string" } },
            { name: "agent402Query", in: "query", required: false, schema: { type: "string" }, description: "Buyer query to test against Agent402 route ranking. Defaults to searchQuery." },
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
          tags: ["x402 discovery", "fix x402 Bazaar listing", "Agent402 route visibility", "x402 catalog metadata quality", "x402 listing SEO audit", "x402 listing rank doctor", "x402 seller growth checklist", "x402 seller intelligence", "x402 marketplace SEO audit", "stale Bazaar price", "paid API listing"],
          summary: "Paid $0.01 x402 Bazaar and Agent402 discovery audit",
          description: "Audits a public x402 endpoint without making paid calls. Checks the direct unpaid 402 challenge, Bazaar extension metadata, CDP merchant discovery, Agent402 route visibility, x402 catalog metadata quality, x402 listing SEO, x402 listing rank, stale Bazaar price or stale indexed pricing, seller growth checklist, and search visibility.",
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
      [COMMANDS_PATH]: {
        get: {
          operationId: "getCommands",
          summary: "Free compact x402 command handoff",
          description: "Small no-spend JSON that returns the recommended paid route, copy-ready x402 command, proof fields, and free links for a buyer intent.",
          parameters: [
            { name: "intent", in: "query", required: false, schema: { type: "string" }, description: "Buyer task, such as paid API listing quality, buyer-agent skip reasons, x402 discovery audit, or full listing roast." },
            { name: "q", in: "query", required: false, schema: { type: "string" }, description: "Alias for intent." },
            { name: "query", in: "query", required: false, schema: { type: "string" }, description: "Alias for intent." },
            { name: "task", in: "query", required: false, schema: { type: "string" }, description: "Alias for intent." }
          ],
          responses: {
            200: {
              description: "Compact command-first handoff for the selected paid route",
              content: {
                "application/json": {
                  example: buildCommandHandoff(config, "paid API listing quality")
                }
              }
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
      x402ManifestAliases: x402ManifestAliasUrls(config),
      llms: absoluteUrl(config, LLMS_PATH),
      llmsAliases: [absoluteUrl(config, WELL_KNOWN_LLMS_PATH)],
      llmsFull: absoluteUrl(config, LLMS_FULL_PATH),
      llmsFullAliases: [absoluteUrl(config, WELL_KNOWN_LLMS_FULL_PATH)],
      markdown: absoluteUrl(config, INDEX_MARKDOWN_PATH),
      agentCard: absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH),
      agentCardAliases: agentCardAliasUrls(config),
      aiPlugin: absoluteUrl(config, WELL_KNOWN_AI_PLUGIN_PATH),
      apiCatalog: absoluteUrl(config, WELL_KNOWN_API_CATALOG_PATH),
      agentTools: absoluteUrl(config, WELL_KNOWN_AGENT_TOOLS_PATH),
      agentSkills: absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH),
      mcp: absoluteUrl(config, WELL_KNOWN_MCP_JSON_PATH),
      mcpAliases: mcpAliasUrls(config),
      mcpServerCard: absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH),
      mcpServerCardAliases: mcpServerCardAliasUrls(config),
      commands: absoluteUrl(config, COMMANDS_PATH),
      payNow: absoluteUrl(config, PAY_NOW_PATH),
      payNowExamples: buildPayNowIntentExamples(config),
      officialCdpDiscovery,
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
        officialCdpDiscovery,
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
      agentListingConversionRoute: absoluteUrl(config, AGENT_LISTING_SCORE_PATH),
      agentListingConversionCanonicalRoute: absoluteUrl(config, AGENT_LISTING_PATH),
      pingRoute: absoluteUrl(config, PING_PATH),
      siteAuditRoute: absoluteUrl(config, SITE_AUDIT_PATH),
      discoveryAuditRoute: absoluteUrl(config, DISCOVERY_AUDIT_PATH),
      agent402RouteVisibilityRoute: absoluteUrl(config, AGENT402_ROUTE_VISIBILITY_PATH),
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

  for (const aliasPath of SITE_AUDIT_EXACT_ALIAS_PATHS) {
    const metadata = SITE_AUDIT_EXACT_ALIAS_METADATA[aliasPath];
    const intentRouteKey = siteAuditIntentRouteKeyForPath(aliasPath);
    paymentActionByRoute[`GET ${aliasPath}`] = intentRouteKey;
    document.paths[aliasPath] = {
      get: {
        ...document.paths[SITE_AUDIT_PATH].get,
        operationId: metadata.operationId,
        tags: ["x402 site audit", "paid API preflight", "x402 route health check", "x402 buyer prepay risk score", "x402 listing rank doctor"],
        summary: metadata.summary,
        description: `${metadata.description} Canonical route: GET ${SITE_AUDIT_PATH}.`,
        "x-payment": buildPaymentHint(config, {
          path: aliasPath,
          method: "GET",
          price: config.siteAuditPrice,
          maxAmountRequired: SITE_AUDIT_AMOUNT,
          buyerAction: metadata.buyerAction,
          intentRouteKey
        })
      }
    };
  }

  document.paths[AGENT_LISTING_SCORE_PATH] = {
    get: {
      ...document.paths[AGENT_LISTING_PATH].get,
      operationId: "getAgentListingConversionScoreAlias",
      summary: "Paid $0.001 exact-path agent listing conversion score alias by Listing Roast",
      description: `${AGENT_LISTING_CONVERSION_DESCRIPTION} This exact alias exists for buyers and routers searching the literal agent listing conversion score phrase.`,
      "x-payment": buildPaymentHint(config, {
        path: AGENT_LISTING_SCORE_PATH,
        method: "GET",
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        buyerAction: "Pay $0.001 for the exact-path agent listing conversion score alias."
      }),
      responses: {
        ...document.paths[AGENT_LISTING_PATH].get.responses,
        200: {
          ...document.paths[AGENT_LISTING_PATH].get.responses[200],
          content: {
            "application/json": {
              schema: buildScoreDiscovery(config).output.schema,
              example: buildAgentListingConversionScore(buildInstantScoreInput(agentListingConversionInputDefaults(AGENT_LISTING_SCORE_PATH)), config, { routePath: AGENT_LISTING_SCORE_PATH })
            }
          }
        }
      }
    }
  };

  document.paths[AGENT402_ROUTE_VISIBILITY_PATH] = {
    get: {
      ...document.paths[DISCOVERY_AUDIT_PATH].get,
      operationId: "getAgent402RouteVisibilityAudit",
      tags: ["Agent402 route visibility", "Agent402 router", "x402 discovery audit", "x402 route health check", "paid API preflight", "stale Bazaar price", "paid API listing"],
      summary: "Paid $0.001 Agent402 route visibility audit",
      description: "Exact-path GET alias for agents and Agent402-style routers that ask specifically for Agent402 route visibility, Agent402 router ranking, stale Bazaar pricing, search visibility, route health, paid API preflight, and direct 402 metadata. Returns the same quick x402 discovery-audit output as GET /api/x402-discovery-audit.",
      responses: { ...document.paths[DISCOVERY_AUDIT_PATH].get.responses },
      "x-payment": buildPaymentHint(config, {
        path: AGENT402_ROUTE_VISIBILITY_PATH,
        method: "GET",
        price: config.siteAuditPrice,
        maxAmountRequired: DISCOVERY_AUDIT_QUICK_AMOUNT,
        buyerAction: "Pay $0.001 for an exact Agent402 route visibility audit before buying the full custom discovery audit."
      })
    }
  };

  for (const [pathname, pathItem] of Object.entries(document.paths)) {
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const operation = pathItem[method];
      if (operation && operation["x-payment"]) {
        const paymentHint = operation["x-payment"];
        operation.security = buildOpenApiX402Security();
        operation.responses = { ...(operation.responses || {}) };
        operation.responses[402] = buildOpenApiPaymentRequiredResponse(
          config,
          paymentHint.selectedActionKey || paymentActionByRoute[`${method.toUpperCase()} ${pathname}`],
          paymentHint.selectedPaidAction
        );
      }
    }
  }

  return document;
}

function buildPaidUsageProof(config, cashRegister = {}, receiverWallet = null) {
  const effectiveReceiverWallet = receiverWallet || cashRegister.receiverWallet || null;
  const paidCompletions = Number(cashRegister.paidCompletions || 0);
  const estimatedGrossRevenueUsd = String(cashRegister.estimatedGrossRevenueUsd || "0.00").replace(/^\$/, "");
  const indexedRoastGetCompletions = Number(cashRegister.indexedRoastGetCompletions || 0);
  const indexedRoastGetEstimatedRevenueUsd = String(cashRegister.indexedRoastGetEstimatedRevenueUsd || "$0.00");
  const latestWalletSettlement = buildLatestWalletSettlementProof(config);
  const recentPaidCompletions = Array.isArray(cashRegister.recentPaidCompletions) ? cashRegister.recentPaidCompletions : [];
  const derivedPaidCompletion = buildDerivedPaidCompletionFromSettlement(cashRegister, latestWalletSettlement);
  const latestPaidCompletion = cashRegister.lastPaidCompletion || (derivedPaidCompletion && recentPaidCompletions.length === 0 ? derivedPaidCompletion : null);
  const hasReceiverWalletSnapshot = effectiveReceiverWallet && typeof effectiveReceiverWallet === "object" && effectiveReceiverWallet.address;
  const receiverWalletHasUnits = hasReceiverWalletSnapshot && effectiveReceiverWallet.usdcUnits && /^\d+$/.test(String(effectiveReceiverWallet.usdcUnits));
  const latestSettlementHasUnits = latestWalletSettlement?.usdcUnits && /^\d+$/.test(String(latestWalletSettlement.usdcUnits));
  const receiverWalletUnits = receiverWalletHasUnits ? BigInt(effectiveReceiverWallet.usdcUnits) : null;
  const latestSettlementUnits = latestSettlementHasUnits ? BigInt(latestWalletSettlement.usdcUnits) : null;
  const receiverWalletHasBalance = receiverWalletUnits !== null && receiverWalletUnits > 0n;
  const receiverWalletCoversLatestSettlement = latestSettlementUnits === null || (receiverWalletUnits !== null && receiverWalletUnits >= latestSettlementUnits);
  const isWalletConfirmed = Boolean(paidCompletions > 0 && latestWalletSettlement && receiverWalletHasBalance && receiverWalletCoversLatestSettlement);
  const isWalletSettlementLinked = Boolean(paidCompletions > 0 && latestWalletSettlement);
  const proofText = isWalletConfirmed
    ? `${paidCompletions} wallet-confirmed paid ${paidCompletions === 1 ? "completion" : "completions"}; $${estimatedGrossRevenueUsd} registered; receiver wallet ${effectiveReceiverWallet.usdcBalance} USDC`
    : isWalletSettlementLinked
      ? `${paidCompletions} wallet-settlement-linked paid ${paidCompletions === 1 ? "completion" : "completions"}; $${estimatedGrossRevenueUsd} registered; latest settlement ${latestWalletSettlement.usdc || latestWalletSettlement.usdcUnits} USDC`
    : `${paidCompletions} paid ${paidCompletions === 1 ? "completion" : "completions"}; $${estimatedGrossRevenueUsd} registered`;

  return {
    paidCompletions,
    estimatedGrossRevenueUsd,
    proofText,
    settlementStatus: isWalletConfirmed ? "wallet-confirmed" : (latestWalletSettlement ? "wallet-settlement-linked" : "register-only"),
    lastPaidAt: cashRegister.lastPaidAt || null,
    ...(latestPaidCompletion ? { latestPaidCompletion } : {}),
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
    ...(hasReceiverWalletSnapshot ? {
      receiverWallet: effectiveReceiverWallet,
      walletProof: {
        status: isWalletConfirmed ? "wallet-confirmed" : "receiver-wallet-snapshot",
        receiverWalletUsdcBalance: effectiveReceiverWallet.usdcBalance,
        receiverWalletUsdcUnits: effectiveReceiverWallet.usdcUnits || null,
        checkedAt: effectiveReceiverWallet.checkedAt,
        source: effectiveReceiverWallet.source,
        latestSettlementTxHash: latestWalletSettlement?.txHash || null,
        note: isWalletConfirmed
          ? "The free proof endpoint includes the receiver wallet snapshot plus the latest public settlement transaction before payment."
          : "The free proof endpoint includes the receiver wallet snapshot when available before payment."
      }
    } : {}),
    source: "public_cash_register",
    cashRegister: absoluteUrl(config, "/api/cash-register"),
    walletEvidenceFields: ["receiverWallet.usdcBalance", "receiverWallet.usdcUnits", "receiverWallet.checkedAt"],
    noSpend: true
  };
}

function buildPaidUsageProofResponse(config, cashRegister = {}, receiverWallet = null) {
  const intentRoutes = buildPayNowActions(config);
  const proof = buildPaidUsageProof(config, cashRegister, receiverWallet);
  const officialCdpDiscovery = buildOfficialCdpDiscoveryHandoff(config);
  const preferredFirstPaidAction = intentRoutes.indexedQuickScore;

  return {
    service: config.serviceName,
    noSpend: true,
    purpose: "Compact public proof that Listing Roast x402 has wallet-confirmed paid usage and the first paid route is still the low-friction indexed GET.",
    paidCompletions: proof.paidCompletions,
    estimatedGrossRevenueUsd: proof.estimatedGrossRevenueUsd,
    proofText: proof.proofText,
    settlementStatus: proof.settlementStatus,
    lastPaidAt: proof.lastPaidAt,
    ...(proof.latestPaidCompletion ? { latestPaidCompletion: proof.latestPaidCompletion } : {}),
    paidUsageProof: proof,
    ...(receiverWallet ? { receiverWallet } : {}),
    settlementProof: buildSettlementProof(config),
    officialCdpDiscovery,
    searchReality: {
      knownWorkingSearchQueries: officialCdpDiscovery.knownWorkingSearchQueries,
      notYetRankingSearchQueries: officialCdpDiscovery.notYetRankingSearchQueries,
      cheapCapSearchStrategy: officialCdpDiscovery.cheapCapSearchStrategy,
      fullRoastDirectHandoff: officialCdpDiscovery.fullRoastDirectHandoff,
      competitiveCapRisks: officialCdpDiscovery.competitiveCapRisks,
      rule: officialCdpDiscovery.searchRealityRule
    },
    preferredFirstPaidAction,
    provenFirstPaidAction: preferredFirstPaidAction,
    paymentShortcut: {
      selectedPaidUrl: preferredFirstPaidAction.route,
      selectedPaidPath: preferredFirstPaidAction.path,
      selectedPaidMethod: preferredFirstPaidAction.method,
      selectedPaidPrice: preferredFirstPaidAction.price,
      selectedPaidMaxAmountRequired: preferredFirstPaidAction.maxAmountRequired,
      firstPaidUrl: preferredFirstPaidAction.route,
      firstPaidPath: preferredFirstPaidAction.path,
      firstPaidMethod: preferredFirstPaidAction.method,
      firstPaidPrice: preferredFirstPaidAction.price,
      firstPaidMaxAmountRequired: preferredFirstPaidAction.maxAmountRequired,
      maxPaymentUsd: preferredFirstPaidAction.maxPaymentUsd,
      maxAmountRequired: preferredFirstPaidAction.maxAmountRequired,
      paymentRequiredHeader: "Payment-Required",
      paymentHeader: "X-PAYMENT",
      command: preferredFirstPaidAction.command,
      noSpend: true,
      instruction: "If the buyer intends to spend USDC, pay this proven first route first; this proof endpoint itself is free."
    },
    command: preferredFirstPaidAction.command,
    firstPaidCommand: preferredFirstPaidAction.command,
    agentPaymentPrompt: preferredFirstPaidAction.agentPaymentPrompt,
    recommendedPaidSequence: buildRecommendedPaidSequence(intentRoutes),
    buyerPhraseCommandPack: buildBuyerPhraseCommandPack(config),
    commands: absoluteUrl(config, COMMANDS_PATH),
    payNow: absoluteUrl(config, PAY_NOW_PATH),
    pricing: absoluteUrl(config, PRICING_PATH),
    find: absoluteUrl(config, FIND_PATH),
    route: absoluteUrl(config, ROUTE_PATH),
    cashRegister: absoluteUrl(config, "/api/cash-register"),
    x402Manifest: absoluteUrl(config, "/x402.json"),
    openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH),
    bazaarCataloging: buildBazaarCatalogingGuidance(config),
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

function buildSiteAuditExactAliasManifestResources(config) {
  return SITE_AUDIT_EXACT_ALIAS_PATHS.map((path) => {
    const metadata = SITE_AUDIT_EXACT_ALIAS_METADATA[path];
    return {
      id: metadata.id,
      name: metadata.name,
      method: "GET",
      path,
      url: absoluteUrl(config, path),
      price: config.siteAuditPrice,
      maxAmountRequired: SITE_AUDIT_AMOUNT,
      description: metadata.description,
      keywords: uniqueTerms([...metadata.keywords, "x402 site audit", "GET paid API", "prepay check", "buyer-agent risk check"]),
      command: buildGetPayCommand(config, path, SITE_AUDIT_AMOUNT),
      input: buildSiteAuditDiscovery(config).input,
      outputExample: buildSiteAuditExampleOutput(config),
      schema: absoluteUrl(config, "/api/discovery-audit-schema"),
      canonicalRoute: SITE_AUDIT_PATH
    };
  });
}

function buildPrimaryEndpointHandoff(config, intentRoutes = buildPayNowActions(config)) {
  const action = intentRoutes.indexedQuickScore;
  const agentPaymentRequest = buildAgentPaymentRequest(action);
  return {
    id: "indexed_roast_quick_score",
    name: "indexed_roast_quick_score",
    title: "GET $0.001 indexed listing-roast quick score",
    serviceName: routeServiceMetadata("indexedQuickScore").serviceName,
    method: action.method,
    path: action.path,
    url: action.route,
    route: action.route,
    price: action.price,
    maxAmountRequired: action.maxAmountRequired,
    network: config.network,
    payTo: config.payTo,
    command: action.command,
    agentPaymentRequest,
    agentPaymentPrompt: agentPaymentRequest.prompt,
    maxPaymentUsd: agentPaymentRequest.maxPayment,
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

function buildStartHereHandoff(config, cashRegister = {}, intentRoutes = buildPayNowActions(config), options = {}) {
  const selectedSequence = Array.isArray(options.selectedPaidSequence) ? options.selectedPaidSequence : [];
  const firstStep = selectedSequence.find((step) => step.step === 1 && step.action);
  const followupStep = selectedSequence.find((step) => step.step > 1 && step.action);
  const firstAction = options.firstAction || firstStep?.action || intentRoutes.indexedQuickScore;
  const use = options.use || firstStep?.use || "indexedQuickScore";
  const upgradeAction = options.upgradeAction === null
    ? null
    : options.upgradeAction || followupStep?.action || (isTerminalPaidActionKey(use) ? null : intentRoutes.fullRoastGet);
  const upgradeUse = options.upgradeUse || followupStep?.use || (upgradeAction ? "fullRoastGet" : null);
  const proof = buildPaidUsageProof(config, cashRegister);

  return {
    use,
    route: firstAction.route,
    path: firstAction.path,
    method: firstAction.method,
    price: firstAction.price,
    maxAmountRequired: firstAction.maxAmountRequired,
    maxPaymentUsd: firstAction.maxPaymentUsd,
    network: config.network,
    payTo: config.payTo,
    command: firstAction.command,
    agentPaymentRequest: firstAction.agentPaymentRequest,
    agentPaymentPrompt: firstAction.agentPaymentPrompt,
    buyerInstruction: options.buyerInstruction || `If the buyer intends to pay, start with ${firstAction.method} ${firstAction.path} at max ${firstAction.maxAmountRequired} USDC units.`,
    whyThisRoute: options.whyThisRoute || (use === "indexedQuickScore"
      ? "This is the already-indexed, wallet-backed first paid route and the lowest-friction path to a real paid completion."
      : "This is the best first paid route for the buyer's current search intent. The already-indexed quick-score route remains available as the proven low-cost first touch."),
    paidUseProof: {
      paidCompletions: proof.paidCompletions,
      estimatedGrossRevenueUsd: proof.estimatedGrossRevenueUsd,
      routeCompletions: proof.preferredConvertedRoute.completions,
      hasConfirmedPaidUse: proof.preferredConvertedRoute.hasConfirmedPaidUse,
      lastPaidAt: proof.lastPaidAt
    },
    expectedChallenge: {
      status: 402,
      amount: firstAction.maxAmountRequired,
      network: config.network,
      route: firstAction.route
    },
    ...(upgradeAction ? { upgradeAfterFit: {
      use: upgradeUse,
      route: upgradeAction.route,
      path: upgradeAction.path,
      method: upgradeAction.method,
      price: upgradeAction.price,
      maxAmountRequired: upgradeAction.maxAmountRequired,
      maxPaymentUsd: upgradeAction.maxPaymentUsd,
      command: upgradeAction.command,
      agentPaymentRequest: upgradeAction.agentPaymentRequest,
      agentPaymentPrompt: upgradeAction.agentPaymentPrompt
    } } : {}),
    noSpendNote: "Fetching this handoff is free. Payment happens only when a buyer calls the x402 paid route with a valid payment header."
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
    maxPaymentUsd: primaryEndpoint.maxPaymentUsd,
    max_payment_usd: primaryEndpoint.maxPaymentUsd,
    agentPaymentRequest: primaryEndpoint.agentPaymentRequest,
    agentPaymentPrompt: primaryEndpoint.agentPaymentPrompt,
    description: primaryEndpoint.description,
    tags: primaryEndpoint.tags,
    keywords: primaryEndpoint.keywords,
    command: primaryEndpoint.command,
    reason: primaryEndpoint.reason
  };
}

function buildShallowPrimaryCallAliases(primaryEndpoint) {
  return {
    url: primaryEndpoint.url,
    apiUrl: primaryEndpoint.url,
    api_url: primaryEndpoint.url,
    endpoint: primaryEndpoint.url,
    endpointUrl: primaryEndpoint.url,
    endpoint_url: primaryEndpoint.url,
    resource: primaryEndpoint.url,
    resourceUrl: primaryEndpoint.url,
    resource_url: primaryEndpoint.url,
    method: primaryEndpoint.method,
    path: primaryEndpoint.path,
    x402Route: primaryEndpoint.path,
    x402_route: primaryEndpoint.path,
    price: primaryEndpoint.price,
    priceUsd: priceToUsd(primaryEndpoint.price),
    price_usd: priceToUsd(primaryEndpoint.price),
    maxAmountRequired: primaryEndpoint.maxAmountRequired,
    max_amount_required: primaryEndpoint.maxAmountRequired,
    maxPaymentUsd: primaryEndpoint.maxPaymentUsd,
    max_payment_usd: primaryEndpoint.maxPaymentUsd,
    agentPaymentRequest: primaryEndpoint.agentPaymentRequest,
    agentPaymentPrompt: primaryEndpoint.agentPaymentPrompt,
    command: primaryEndpoint.command,
    callCommand: primaryEndpoint.command,
    call_command: primaryEndpoint.command,
    curl: `curl -X ${primaryEndpoint.method} ${primaryEndpoint.url}`,
    callNote: primaryEndpoint.note,
    call_note: primaryEndpoint.note
  };
}

function buildX402Manifest(config, cashRegister = {}) {
  const intentRoutes = buildPayNowActions(config);
  const primaryEndpoint = buildPrimaryEndpointHandoff(config, intentRoutes);
  const primaryResourceSample = buildPrimaryResourceSample(primaryEndpoint);
  const startHere = buildStartHereHandoff(config, cashRegister, intentRoutes);
  const officialCdpDiscovery = buildOfficialCdpDiscoveryHandoff(config);
  const baseUrl = absoluteUrl(config, "/").replace(/\/$/, "");
  const resources = [
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
        keywords: ["agent listing conversion score", "agent listing conversion", "agent service listing clarity", "agent service listing clarity x402", "buyer-agent skip reasons", "buyer agent skip reasons", "agent listing clarity", "buyer intent", "paid API listing quality", "agent-service listing score", "marketplace listing conversion API", "marketplace listing conversion", "GET paid API"],
        command: buildGetPayCommand(config, AGENT_LISTING_PATH, INSTANT_SCORE_AMOUNT),
        input: buildAgentListingConversionDiscovery(config).input,
        outputExample: buildAgentListingConversionScore(buildInstantScoreInput(agentListingConversionInputDefaults()), config),
        schema: absoluteUrl(config, "/api/score-schema")
      },
      {
        id: "agent_listing_conversion_score_alias",
        name: "agent_listing_conversion_score_alias",
        method: "GET",
        path: AGENT_LISTING_SCORE_PATH,
        url: absoluteUrl(config, AGENT_LISTING_SCORE_PATH),
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        description: AGENT_LISTING_CONVERSION_DESCRIPTION,
        keywords: ["agent listing conversion score", "agent_listing_conversion_score", "agent listing conversion score API", "agent listing conversion", "agent service listing clarity", "agent service promotion readiness", "buyer-agent skip reasons", "buyer agent skip reasons", "agent listing clarity", "buyer intent", "paid API listing quality", "agent-service listing score", "marketplace listing conversion API", "GET paid API"],
        command: buildGetPayCommand(config, AGENT_LISTING_SCORE_PATH, INSTANT_SCORE_AMOUNT),
        input: buildAgentListingConversionDiscovery(config, AGENT_LISTING_SCORE_PATH).input,
        outputExample: buildAgentListingConversionScore(buildInstantScoreInput(agentListingConversionInputDefaults(AGENT_LISTING_SCORE_PATH)), config, { routePath: AGENT_LISTING_SCORE_PATH }),
        schema: absoluteUrl(config, "/api/score-schema"),
        canonicalRoute: AGENT_LISTING_PATH
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
        description: "One-tenth-cent GET x402 site audit, x402 buyer prepay risk score, score x402 endpoint before paying, x402 route health check, x402 listing rank doctor, x402 listing SEO audit, x402 marketplace SEO audit, Bazaar search visibility, seller growth checklist, service discoverability audit, and paid API preflight before paying for direct 402 metadata, Bazaar pricing, OpenAPI, llms.txt, and no-spend next actions.",
        keywords: ["x402 site audit", "x402 site audit API", "x402 buyer prepay risk score", "score x402 endpoint before paying", "score endpoint before paying", "x402 service discoverability audit", "x402 listing SEO audit", "x402 listing rank doctor", "x402 seller growth checklist", "x402 seller intelligence", "x402 marketplace SEO audit", "paid API preflight", "x402 route health check", "x402 discovery audit", "x402 bazaar discovery audit", "bazaar search visibility", "x402 listing stale price"],
        command: buildGetPayCommand(config, SITE_AUDIT_PATH, SITE_AUDIT_AMOUNT),
        input: buildSiteAuditDiscovery(config).input,
        outputExample: buildSiteAuditExampleOutput(config),
        schema: absoluteUrl(config, "/api/discovery-audit-schema")
      },
      ...buildPreflightAliasManifestResources(config),
      ...buildSiteAuditExactAliasManifestResources(config),
      {
        id: "agent402_route_visibility_audit",
        name: "agent402_route_visibility",
        method: "GET",
        path: AGENT402_ROUTE_VISIBILITY_PATH,
        url: absoluteUrl(config, AGENT402_ROUTE_VISIBILITY_PATH),
        price: config.siteAuditPrice,
        maxAmountRequired: DISCOVERY_AUDIT_QUICK_AMOUNT,
        description: "One-tenth-cent GET Agent402 route visibility audit for agents probing Agent402 router ranking, Agent402 route visibility, stale Bazaar pricing, search visibility, route health, paid API preflight, direct 402 metadata, and no-spend next actions before buying the full custom audit.",
        keywords: ["Agent402 route visibility", "Agent402 router", "Agent402 routing", "Agent402 route visibility audit", "x402 discovery audit", "x402 bazaar discovery audit", "x402 service discoverability audit", "paid API preflight", "x402 route health check", "bazaar search visibility", "x402 listing stale price", "stale Bazaar price", "GET paid API"],
        command: buildGetPayCommand(config, AGENT402_ROUTE_VISIBILITY_PATH, DISCOVERY_AUDIT_QUICK_AMOUNT),
        input: buildAgent402RouteVisibilityDiscovery(config).input,
        outputExample: buildAgent402RouteVisibilityExampleOutput(config),
        schema: absoluteUrl(config, "/api/discovery-audit-schema")
      },
      {
        id: "x402_discovery_audit_quick",
        name: "x402_discovery_audit_quick",
        method: "GET",
        path: DISCOVERY_AUDIT_PATH,
        url: absoluteUrl(config, DISCOVERY_AUDIT_PATH),
        price: config.siteAuditPrice,
        maxAmountRequired: DISCOVERY_AUDIT_QUICK_AMOUNT,
        description: "One-tenth-cent GET x402 discovery audit on the exact discovery-audit path for agents probing stale Bazaar pricing, Agent402 route visibility, search visibility, route health, paid API preflight, direct 402 metadata, and no-spend next actions before buying the full custom audit.",
        keywords: ["x402 discovery audit", "x402 bazaar discovery audit", "Agent402 route visibility", "Agent402 router", "x402 service discoverability audit", "paid API preflight", "x402 route health check", "bazaar search visibility", "x402 listing stale price", "stale Bazaar price", "GET paid API"],
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
        description: "One-cent x402 Bazaar and Agent402 discovery audit for listing SEO, listing rank, seller growth, stale indexed pricing, missing marketplace visibility, Agent402 route visibility, direct 402 metadata, and next actions. Makes no paid calls.",
        keywords: ["x402 bazaar discovery audit", "Agent402 route visibility", "Agent402 router", "x402 listing SEO audit", "x402 listing rank doctor", "x402 seller growth checklist", "x402 seller intelligence", "x402 marketplace SEO audit", "x402 listing stale price", "bazaar search visibility", "paid API listing", "x402 listing"],
        command: buildPayCommand(config, DISCOVERY_AUDIT_PATH, DISCOVERY_AUDIT_AMOUNT, discoveryAuditRequestExample),
        input: buildDiscoveryAuditBuyerVisibleInput(),
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
        id: "full_listing_roast_get",
        name: "full_listing_roast_get",
        method: "GET",
        path: FULL_ROAST_GET_PATH,
        url: absoluteUrl(config, FULL_ROAST_GET_PATH),
        price: config.price,
        maxAmountRequired: "10000",
        description: FULL_ROAST_GET_DESCRIPTION,
        keywords: ["full listing roast", "listing roast full", "full roast", "listing roast rewrite", "top fixes", "rewritten listing", "stop-or-upgrade guidance", "buyer-agent skip reasons", "buyer agent skip reasons", "launch guidance", "paid API listing quality", "x402 marketplace conversion", "GET paid API"],
        command: buildGetPayCommand(config, FULL_ROAST_GET_PATH, "10000"),
        input: buildFullRoastGetDiscovery(config).input,
        outputExample: buildListingRoast(buildInstantScoreInput({
          ...quickScoreRequestExample,
          currentPrice: config.price,
          currentCheckoutPath: FULL_ROAST_GET_PATH
        })),
        schema: absoluteUrl(config, "/api/schema"),
        canonicalPostRoute: ROAST_PATH
      },
      {
        id: "listing_roast",
        name: "listing_roast",
        method: "POST",
        path: ROAST_PATH,
        url: absoluteUrl(config, ROAST_PATH),
        price: config.price,
        maxAmountRequired: "10000",
        description: "Custom-body Listing Roast POST: one-cent marketplace listing conversion API roast for paid API listing quality, agent service listing clarity, buyer-agent skip reasons, top fixes, rewrite, and launch guidance. JSON body is optional for stale directory cards; omitted bodies use safe defaults. Prefer GET /api/full-listing-roast for the direct full roast.",
        keywords: ["marketplace listing conversion API", "marketplace listing conversion", "paid API listing quality", "agent service listing clarity", "buyer-agent skip reasons", "buyer agent skip reasons", "agent-service listing score", "x402 marketplace conversion", "custom-body full roast", "stale directory card", "safe defaults"],
        command: buildPayCommand(config),
        input: requestExample,
        outputExample: buildListingRoast(requestExample),
        schema: absoluteUrl(config, "/api/schema")
      }
    ].map((resource) => enrichManifestResource(resource, config));
  const actionAliases = buildManifestActionAliases(config, resources);

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
    ...buildShallowPrimaryCallAliases(primaryEndpoint),
    primaryCall: buildShallowPrimaryCallAliases(primaryEndpoint),
    primary_call: buildShallowPrimaryCallAliases(primaryEndpoint),
    category: SERVICE_CATEGORY,
    tags: SERVICE_TAGS,
    keywords: DISCOVERY_KEYWORDS,
    homepage: absoluteUrl(config, "/"),
    builder: absoluteUrl(config, "/builder"),
    sample: absoluteUrl(config, "/sample"),
    sampleJson: absoluteUrl(config, API_SAMPLE_SCORE_PATH),
    sampleAliases: [absoluteUrl(config, API_SAMPLE_PATH)],
    openApi: absoluteUrl(config, "/openapi.json"),
    openApiAliases: openApiAliasUrls(config),
    openApiYaml: absoluteUrl(config, OPENAPI_YAML_PATH),
    openApiYamlAliases: openApiYamlAliasUrls(config),
    schema: absoluteUrl(config, "/api/schema"),
    schemaAliases: [absoluteUrl(config, SCHEMA_JSON_PATH)],
    llms: absoluteUrl(config, LLMS_PATH),
    llmsAliases: [absoluteUrl(config, WELL_KNOWN_LLMS_PATH)],
    llmsFull: absoluteUrl(config, LLMS_FULL_PATH),
    llmsFullAliases: [absoluteUrl(config, WELL_KNOWN_LLMS_FULL_PATH)],
    markdown: absoluteUrl(config, INDEX_MARKDOWN_PATH),
    agentCard: absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH),
    agentCardAliases: agentCardAliasUrls(config),
    aiPlugin: absoluteUrl(config, WELL_KNOWN_AI_PLUGIN_PATH),
    apiCatalog: absoluteUrl(config, WELL_KNOWN_API_CATALOG_PATH),
    apiCatalogAliases: [absoluteUrl(config, WELL_KNOWN_API_CATALOG_JSON_PATH)],
    agentTools: absoluteUrl(config, WELL_KNOWN_AGENT_TOOLS_PATH),
    agentSkills: absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH),
    mcp: absoluteUrl(config, WELL_KNOWN_MCP_JSON_PATH),
    mcpAliases: mcpAliasUrls(config),
    mcpServerCard: absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH),
    mcpServerCardAliases: mcpServerCardAliasUrls(config),
    payNow: absoluteUrl(config, PAY_NOW_PATH),
    commands: absoluteUrl(config, COMMANDS_PATH),
    compactCommandHandoff: buildCommandHandoff(config, "paid API listing quality", cashRegister),
    startHere,
    payNowExamples: buildPayNowIntentExamples(config),
    intentLandingPages: buildIntentLandingHandoffs(config),
    paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
    officialCdpDiscovery,
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
      officialCdpDiscovery,
      searchExamples: buildLocalDiscoverySearchExamples(config),
      aliases: {
        resources: LOCAL_DISCOVERY_RESOURCE_PATHS.map((path) => absoluteUrl(config, path)),
        search: LOCAL_DISCOVERY_SEARCH_PATHS.map((path) => absoluteUrl(config, path)),
        merchant: LOCAL_DISCOVERY_MERCHANT_PATHS.map((path) => absoluteUrl(config, path))
      }
    },
    aliases: x402ManifestAliasUrls(config),
    network: config.network,
    payTo: config.payTo,
    payment: {
      primaryNetwork: "base",
      network: config.network,
      currency: "USDC",
      asset: "USDC",
      payTo: config.payTo,
      commands: absoluteUrl(config, COMMANDS_PATH),
      officialCdpDiscovery,
      x402: {
        primaryNetwork: "base",
        network: config.network,
        asset: "USDC",
        payTo: config.payTo,
        officialCdpDiscovery
      }
    },
    capabilities: {
      tools: resources.length,
      actions: actionAliases.length
    },
    primaryEndpoint,
    primaryPaidEndpoint: primaryEndpoint,
    resource_count: resources.length,
    resource_samples: [primaryResourceSample],
    call_info: {
      resource_count: resources.length,
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
    resources,
    actions: actionAliases,
    paidActions: actionAliases,
    tools: actionAliases
  };
}

function priceToUsd(price) {
  return String(price || "").replace(/^\$/, "");
}

function buildAgentToolsManifest(config, cashRegister = {}) {
  const x402Manifest = buildX402Manifest(config);
  const intentRoutes = buildPayNowActions(config);
  const primaryEndpoint = buildPrimaryEndpointHandoff(config, intentRoutes);
  const primaryResourceSample = buildPrimaryResourceSample(primaryEndpoint);
  const recommendedPaidSequence = buildRecommendedPaidSequence(intentRoutes);
  const officialCdpDiscovery = buildOfficialCdpDiscoveryHandoff(config);
  const commands = absoluteUrl(config, COMMANDS_PATH);
  const paidUsageProof = buildPaidUsageProof(config, cashRegister);
  const payment = {
    asset: config.network === BASE_MAINNET_NETWORK ? BASE_USDC_CONTRACT : "USDC",
    assetName: config.network === BASE_MAINNET_NETWORK ? "Base mainnet USDC" : "USDC",
    network: config.network,
    payTo: config.payTo,
    commands,
    payNow: absoluteUrl(config, PAY_NOW_PATH),
    paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
    officialCdpDiscovery,
    preferredFirstPaidAction: intentRoutes.indexedQuickScore,
    recommendedPaidSequence
  };

  const tools = x402Manifest.resources.map((resource) => ({
    name: resource.id,
    title: resource.name,
    description: resource.description,
    category: resource.id === "x402_site_audit" || resource.id === "x402_discovery_audit" || resource.canonicalRoute === SITE_AUDIT_PATH ? "x402-discovery" : "paid-api-listing",
    method: resource.method,
    path: resource.path,
    route: resource.url,
    local_route: resource.path,
    x402_route: resource.path,
    url: resource.url,
    price_usd: priceToUsd(resource.price),
    max_amount_required: resource.maxAmountRequired,
    max_payment_usd: resource.maxPaymentUsd,
    network: config.network,
    asset: payment.asset,
    assetName: payment.assetName,
    payment,
    agentPaymentRequest: resource.agentPaymentRequest,
    agentPaymentPrompt: resource.agentPaymentPrompt,
    maxPaymentUsd: resource.maxPaymentUsd,
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
    service: config.serviceName,
    metadataVersion: DISCOVERY_METADATA_VERSION,
    metadataUpdatedAt: DISCOVERY_METADATA_UPDATED_AT,
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
    ...buildShallowPrimaryCallAliases(primaryEndpoint),
    primaryCall: buildShallowPrimaryCallAliases(primaryEndpoint),
    primary_call: buildShallowPrimaryCallAliases(primaryEndpoint),
    payment,
    officialCdpDiscovery,
    official_cdp_discovery: officialCdpDiscovery,
    commands,
    paidUsageProof,
    paid_usage_proof_summary: {
      proofText: paidUsageProof.proofText,
      paidCompletions: paidUsageProof.paidCompletions,
      estimatedGrossRevenueUsd: paidUsageProof.estimatedGrossRevenueUsd,
      lastPaidAt: paidUsageProof.lastPaidAt,
      preferredConvertedRoute: paidUsageProof.preferredConvertedRoute,
      cashRegister: paidUsageProof.cashRegister,
      paidUsageProof: paidUsageProof.paidUsageProof
    },
    links: {
      commands,
      payNow: absoluteUrl(config, PAY_NOW_PATH),
      paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
      x402Manifest: absoluteUrl(config, "/x402.json"),
      agentCard: absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH),
      apiCatalog: absoluteUrl(config, WELL_KNOWN_API_CATALOG_PATH),
      openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH)
    },
    paid_relay: true,
    resource_count: tools.length,
    resource_samples: [primaryResourceSample],
    call_info: {
      resource_count: tools.length,
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
    primaryEndpoint,
    primaryPaidEndpoint: primaryEndpoint,
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
    recommended_paid_sequence: recommendedPaidSequence,
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
  const startHere = buildStartHereHandoff(config, cashRegister, intentRoutes);

  return {
    service: config.serviceName,
    noSpend: true,
    paidUsageProof: buildPaidUsageProof(config, cashRegister),
    paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
    homepage: absoluteUrl(config, "/"),
    pricing: absoluteUrl(config, PRICING_PATH),
    find: absoluteUrl(config, FIND_PATH),
    route: absoluteUrl(config, ROUTE_PATH),
    commands: absoluteUrl(config, COMMANDS_PATH),
    links: {
      commands: absoluteUrl(config, COMMANDS_PATH),
      payNow: absoluteUrl(config, PAY_NOW_PATH),
      paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
      x402Manifest: absoluteUrl(config, "/x402.json"),
      openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH)
    },
    localDiscovery: {
      resources: absoluteUrl(config, LOCAL_DISCOVERY_RESOURCE_PATHS[0]),
      search: absoluteUrl(config, LOCAL_DISCOVERY_SEARCH_PATHS[0]),
      merchant: absoluteUrl(config, LOCAL_DISCOVERY_MERCHANT_PATHS[0]),
      searchExamples: buildLocalDiscoverySearchExamples(config)
    },
    openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH),
    x402Manifest: absoluteUrl(config, "/x402.json"),
    payNow: absoluteUrl(config, PAY_NOW_PATH),
    startHere,
    count: routes.length,
    preferredFirstPaidAction: routes[0],
    preferredFirstPaidResponsePreview: buildPaidResponsePreview(config, "indexedQuickScore", intentRoutes.indexedQuickScore),
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

  return buildX402Manifest(config).resources.map((resource) => {
    const amount = resource.maxAmountRequired;
    const priceUsd = atomicAmountToUsd(amount);
    const bazaarExtension = {
      bazaar: {
        info: {
          input: {
            type: "http",
            method: resource.method,
            path: resource.path,
            url: resource.url
          }
        },
        schema: {
          input: resource.input || {},
          output: {
            example: resource.outputExample || {}
          },
          schemaUrl: resource.schema
        }
      }
    };

    return {
      resource: resource.url,
      url: resource.url,
      route: resource.url,
      type: "http",
      x402Version: 2,
      serviceName: resource.serviceName || config.serviceName,
      name: resource.name,
      method: resource.method,
      path: resource.path,
      price: resource.price,
      priceUsd,
      maxAmountRequired: amount,
      max_amount_required: amount,
      command: resource.command,
      description: resource.description,
      tags: resource.tags || [],
      keywords: resource.keywords || [],
      accepts: [
        {
          scheme: "exact",
          network: config.network,
          amount,
          asset: config.network === BASE_MAINNET_NETWORK ? BASE_USDC_CONTRACT : "USDC",
          payTo: config.payTo,
          extra: {
            name: "USDC",
            decimals: 6
          }
        }
      ],
      extensions: bazaarExtension,
      lastUpdated: now,
      metadata: {
        id: resource.id,
        serviceName: config.serviceName,
        name: resource.name,
        method: resource.method,
        path: resource.path,
        price: resource.price,
        priceUsd,
        maxAmountRequired: amount,
        max_amount_required: amount,
        url: resource.url,
        route: resource.url,
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
        commands: absoluteUrl(config, COMMANDS_PATH),
        preferredFirstPaidAction: resource.id === "indexed_roast_quick_score",
        noSpendHandoff: absoluteUrl(config, PAY_NOW_PATH),
        paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH)
      }
    };
  });
}

function buildOfficialCdpDiscoveryHandoff(config) {
  let serviceDomain = config.serviceUrl;
  try {
    serviceDomain = new URL(config.serviceUrl).hostname;
  } catch {
    serviceDomain = String(config.serviceUrl || "").replace(/^https?:\/\//, "").split("/")[0];
  }
  const merchantParams = new URLSearchParams({
    payTo: config.payTo,
    limit: "100"
  });
  const searchParams = new URLSearchParams({
    query: OFFICIAL_CDP_DISCOVERY_SEARCH_QUERY,
    network: config.network,
    maxUsdPrice: "0.001",
    limit: "10"
  });
  const domainSearchParams = new URLSearchParams({
    network: config.network,
    maxUsdPrice: "0.001",
    urlSubstring: serviceDomain,
    limit: "10"
  });
  const domainRecommendedSearchParams = new URLSearchParams({
    query: OFFICIAL_CDP_DISCOVERY_SEARCH_QUERY,
    network: config.network,
    maxUsdPrice: "0.001",
    urlSubstring: serviceDomain,
    limit: "10"
  });
  const buildSearchUrl = (query, maxUsdPrice = "0.001") => {
    const params = new URLSearchParams({
      query,
      network: config.network,
      maxUsdPrice,
      limit: "10"
    });
    return `${CDP_DISCOVERY_BASE_URL}/search?${params.toString()}`;
  };
  const workingSearchQueries = [
    {
      query: OFFICIAL_CDP_DISCOVERY_SEARCH_QUERY,
      maxUsdPrice: "0.001",
      result: "Listing Roast currently ranks first for the indexed $0.001 /api/listing-roast route.",
      searchUrl: buildSearchUrl(OFFICIAL_CDP_DISCOVERY_SEARCH_QUERY, "0.001")
    },
    {
      query: "paid api listing quality",
      maxUsdPrice: "0.001",
      result: "Listing Roast currently ranks first for the indexed $0.001 /api/listing-roast route.",
      searchUrl: buildSearchUrl("paid api listing quality", "0.001")
    },
    {
      query: "paid API listing quality score",
      maxUsdPrice: "0.001",
      result: "Listing Roast currently ranks first for the indexed $0.001 /api/listing-roast route.",
      searchUrl: buildSearchUrl("paid API listing quality score", "0.001")
    },
    {
      query: "listing roast",
      maxUsdPrice: "0.01",
      result: "Listing Roast currently ranks first and returns the indexed $0.001 /api/listing-roast route, with upgrade handoffs to the $0.01 full roast.",
      searchUrl: buildSearchUrl("listing roast", "0.01")
    },
    {
      query: "full listing roast",
      maxUsdPrice: "0.01",
      result: "Listing Roast currently ranks first and returns the indexed $0.001 /api/listing-roast route, with direct /api/full-listing-roast handoffs available from owned metadata.",
      searchUrl: buildSearchUrl("full listing roast", "0.01")
    }
  ];
  const staleOrNotYetRankingQueries = [
    {
      query: "buyer-agent skip reasons",
      currentPublicSearchState: "Can miss Listing Roast in CDP search until the next real settlement refreshes the public card. Use /api/pay-now?intent=buyer-agent%20skip%20reasons or local discovery search to reach the indexed paid route."
    },
    {
      query: "agent service clarity",
      currentPublicSearchState: "Can return unrelated agent-directory services in CDP search. Use /api/pay-now?intent=agent%20service%20clarity or local discovery search to reach the indexed paid route."
    },
    {
      query: "x402 discovery audit",
      currentPublicSearchState: "Can return other audit services first in CDP search until a real discovery-audit settlement refreshes public metadata. Use /api/pay-now?intent=x402%20discovery%20audit for the owned route."
    },
    {
      query: "x402 site audit",
      currentPublicSearchState: "Can return other x402 audit or health tools first in CDP search. Use /api/pay-now?intent=x402%20site%20audit for the owned route."
    },
    {
      query: "AgentCore x402 payments",
      currentPublicSearchState: "Can return agent-wallet or ERC-8004 services first in CDP search. Use /api/pay-now?intent=AgentCore%20x402%20payments for the owned route."
    },
    {
      query: "Coinbase x402 Bazaar MCP server",
      currentPublicSearchState: "Can return unrelated Base/CDP services first in CDP search. Use /api/pay-now?intent=Coinbase%20x402%20Bazaar%20MCP%20server for the owned route."
    }
  ];
  const cheapCapSearchStrategy = {
    rule: "Search public CDP/Bazaar with maxUsdPrice=0.001 first, or use the direct proven route. Broader 0.005/0.01 caps can rank higher-priced generic competitors above Listing Roast.",
    recommendedQuery: OFFICIAL_CDP_DISCOVERY_SEARCH_QUERY,
    recommendedMaxUsdPrice: "0.001",
    recommendedSearchUrl: `${CDP_DISCOVERY_BASE_URL}/search?${searchParams.toString()}`,
    directRoute: absoluteUrl(config, ROAST_PATH),
    directRouteMethod: "GET",
    directRouteMaxAmountRequired: "1000",
    directPayNow: absoluteUrl(config, PAY_NOW_PATH),
    domainRestrictedSearchUrl: `${CDP_DISCOVERY_BASE_URL}/search?${domainSearchParams.toString()}`,
    noSpend: true
  };
  const fullRoastDirectHandoff = {
    query: "full listing roast",
    publicCdpSearchState: "Public CDP search can rank Listing Roast first for full listing roast while still returning the already-indexed $0.001 /api/listing-roast card. Use this direct handoff when the buyer wants the $0.01 full-roast output immediately.",
    publicCdpSearchUrl: buildSearchUrl("full listing roast", "0.01"),
    directRoute: absoluteUrl(config, FULL_ROAST_GET_PATH),
    directRouteMethod: "GET",
    directRoutePrice: config.price,
    directRouteMaxAmountRequired: "10000",
    directPayNow: `${absoluteUrl(config, PAY_NOW_PATH)}?intent=${encodeURIComponent("full roast rewrite top fixes")}`,
    localDiscoverySearchUrl: `${absoluteUrl(config, LOCAL_DISCOVERY_SEARCH_PATHS[0])}?${new URLSearchParams({ query: "full listing roast", limit: "3" }).toString()}`,
    expectedOutput: ["rewrittenListing", "topFixes", "buyerAgentSkipReasons", "stopOrUpgrade"],
    noSpend: true
  };
  const competitiveCapRisks = [
    {
      query: "marketplace listing score",
      riskAtMaxUsdPrice: "0.005 or 0.01",
      observedPublicSearchState: "Higher-priced generic marketplace listing-score cards can rank above Listing Roast; use maxUsdPrice=0.001 or urlSubstring to reach the proven $0.001 route."
    },
    {
      query: "paid api listing quality",
      riskAtMaxUsdPrice: "0.005 or 0.01",
      observedPublicSearchState: "Higher-priced listing-quality cards can rank above Listing Roast; use maxUsdPrice=0.001 or the direct pay-now handoff."
    },
    {
      query: "buyer-agent skip reasons",
      riskAtMaxUsdPrice: "0.001, 0.005, or 0.01",
      observedPublicSearchState: "Listing Roast can still be absent or below unrelated agent services; use /api/pay-now?intent=buyer-agent%20skip%20reasons or local discovery."
    },
    {
      query: "x402 discovery audit",
      riskAtMaxUsdPrice: "0.001, 0.005, or 0.01",
      observedPublicSearchState: "Other x402 audit tools can rank above Listing Roast; use /api/pay-now?intent=x402%20discovery%20audit or the exact owned route."
    }
  ];

  return {
    source: "coinbase-cdp-bazaar",
    noSpend: true,
    indexedRoute: absoluteUrl(config, ROAST_PATH),
    recommendedSearchQuery: OFFICIAL_CDP_DISCOVERY_SEARCH_QUERY,
    recommendedMaxUsdPrice: "0.001",
    recommendedSearchUrl: `${CDP_DISCOVERY_BASE_URL}/search?${searchParams.toString()}`,
    domainRestrictedSearchUrl: `${CDP_DISCOVERY_BASE_URL}/search?${domainSearchParams.toString()}`,
    domainRestrictedRecommendedSearchUrl: `${CDP_DISCOVERY_BASE_URL}/search?${domainRecommendedSearchParams.toString()}`,
    domainRestrictedUrlSubstring: serviceDomain,
    cheapCapSearchStrategy,
    fullRoastDirectHandoff,
    competitiveCapRisks,
    workingSearchQueries,
    knownWorkingSearchQueries: workingSearchQueries,
    staleOrNotYetRankingQueries,
    notYetRankingSearchQueries: staleOrNotYetRankingQueries,
    alternateSearchQueries: [
      "paid api listing quality",
      "buyer-agent skip reasons",
      "agent service clarity",
      "AgentCore x402 payments",
      "Coinbase x402 Bazaar MCP server",
      "x402 site audit",
      "x402 discovery audit",
      "listing roast"
    ],
    merchantDiscoveryUrl: `${CDP_DISCOVERY_BASE_URL}/merchant?${merchantParams.toString()}`,
    indexedRouteReason: "Use the already-settled GET /api/listing-roast route first when external marketplace search metadata is stale.",
    domainRestrictedSearchReason: "Use urlSubstring when broad CDP search is stale or noisy; it narrows discovery to this exact seller domain without payment.",
    priceFilterReason: "Use maxUsdPrice=0.001 for cheap-route discovery; current live checks show this finds the indexed route ahead of broader unfiltered marketplace results.",
    merchantDiscoveryStaleMetadataNote: "Merchant discovery can show cached Bazaar extension fields from the last real settlement; use the live 402 challenge for current price before payment.",
    searchRealityRule: "Use maxUsdPrice=0.001 for public CDP discovery first, or the direct proven route, because broader caps can rank higher-priced generic competitors above Listing Roast until another real settlement refreshes the public card.",
    refreshRule: "CDP Bazaar refreshes catalog metadata after real settlement; unpaid probes do not refresh search."
  };
}

function compactOfficialCdpDiscoveryHandoff(handoff) {
  return pickDefined(handoff, [
    "recommendedSearchQuery",
    "recommendedMaxUsdPrice",
    "alternateSearchQueries"
  ]);
}

function formatOfficialCdpDiscoveryMarkdown(config) {
  const handoff = buildOfficialCdpDiscoveryHandoff(config);
  return `Official CDP discovery handoff:

- Official CDP search: ${handoff.recommendedSearchUrl}
- Official CDP domain-restricted search: ${handoff.domainRestrictedSearchUrl}
- Official CDP merchant lookup: ${handoff.merchantDiscoveryUrl}
- Recommended search query: ${handoff.recommendedSearchQuery}
- Recommended maxUsdPrice: ${handoff.recommendedMaxUsdPrice}
- Cheap-cap search rule: ${handoff.cheapCapSearchStrategy.rule}
- Known working public CDP queries: ${handoff.knownWorkingSearchQueries.map((entry) => `${entry.query} (max ${entry.maxUsdPrice})`).join(", ")}
- Not-yet-ranking public CDP queries: ${handoff.notYetRankingSearchQueries.map((entry) => entry.query).join(", ")}
- Broader-cap risk queries: ${handoff.competitiveCapRisks.map((entry) => `${entry.query} (${entry.riskAtMaxUsdPrice})`).join(", ")}
- Alternate search queries: ${handoff.alternateSearchQueries.join(", ")}
- Start paid use with the already-settled indexed route: ${handoff.indexedRoute}
- Domain-restricted search reason: ${handoff.domainRestrictedSearchReason}
- Price-filter reason: ${handoff.priceFilterReason}
- Merchant discovery stale metadata note: ${handoff.merchantDiscoveryStaleMetadataNote}
- Search reality rule: ${handoff.searchRealityRule}
- Refresh rule: ${handoff.refreshRule}`;
}

function buildLocalDiscoveryResources(config, query = {}, cashRegister = {}) {
  const allItems = buildLocalDiscoveryItems(config);
  const intentRoutes = buildPayNowActions(config);
  const startHere = buildStartHereHandoff(config, cashRegister, intentRoutes);
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
    commands: absoluteUrl(config, COMMANDS_PATH),
    links: {
      commands: absoluteUrl(config, COMMANDS_PATH),
      payNow: absoluteUrl(config, PAY_NOW_PATH),
      pricing: absoluteUrl(config, PRICING_PATH),
      paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
      x402Manifest: absoluteUrl(config, "/x402.json"),
      openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH)
    },
    startHere,
    officialCdpDiscovery: buildOfficialCdpDiscoveryHandoff(config),
    preferredFirstPaidAction: intentRoutes.indexedQuickScore,
    preferredFirstPaidResponsePreview: buildPaidResponsePreview(config, "indexedQuickScore", intentRoutes.indexedQuickScore),
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
  const selectedActionKey = quickScoreAliasActionKeyForQuery(rawQuery) || selected?.selectedActionKey || "indexedQuickScore";
  const selectedPaidAction = selected?.selectedPaidAction || intentRoutes.indexedQuickScore;
  const selectedIntentPaidAction = intentRoutes[selectedActionKey] || selectedPaidAction;
  const selectedFirstPaidAction = firstPaidActionForSelectedIntent(intentRoutes, selectedActionKey, selectedIntentPaidAction);
  const exactIntentPaidAction = exactIntentPaidActionForSelection(intentRoutes, selectedActionKey, selectedIntentPaidAction);
  const selectedPaidSequence = buildSelectedPaidSequence(intentRoutes, selectedActionKey, selectedIntentPaidAction);
  const selectedPaidRoute = compactPaidAction(handoffSelectedPaidActionForSelection(intentRoutes, selectedActionKey, selectedIntentPaidAction));
  const firstPaidRoute = compactPaidAction(selectedFirstPaidAction);
  const exactIntentPaidRoute = exactIntentPaidAction ? compactPaidAction(exactIntentPaidAction) : null;
  const startHere = buildStartHereHandoff(config, cashRegister, intentRoutes, {
    selectedPaidSequence,
    use: selectedPaidSequence[0]?.use || selectedActionKey,
    firstAction: selectedFirstPaidAction
  });
  const genericRecommendedPaidSequence = buildRecommendedPaidSequence(intentRoutes);

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
    commands: absoluteUrl(config, COMMANDS_PATH),
    links: {
      commands: absoluteUrl(config, COMMANDS_PATH),
      payNow: absoluteUrl(config, PAY_NOW_PATH),
      pricing: absoluteUrl(config, PRICING_PATH),
      paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
      x402Manifest: absoluteUrl(config, "/x402.json"),
      openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH)
    },
    startHere,
    officialCdpDiscovery: buildOfficialCdpDiscoveryHandoff(config),
    ...(selected || {}),
    selectedActionKey,
    selectedPaidRoute,
    selectedPaidUrl: selectedPaidRoute.route,
    selectedPaidPath: selectedPaidRoute.path,
    selectedPaidMethod: selectedPaidRoute.method,
    selectedPaidPrice: selectedPaidRoute.price,
    selectedPaidMaxAmountRequired: selectedPaidRoute.maxAmountRequired,
    selectedPaidAction: handoffSelectedPaidActionForSelection(intentRoutes, selectedActionKey, selectedIntentPaidAction),
    firstPaidRoute,
    firstPaidUrl: firstPaidRoute.route,
    firstPaidPath: firstPaidRoute.path,
    firstPaidMethod: firstPaidRoute.method,
    firstPaidPrice: firstPaidRoute.price,
    firstPaidMaxAmountRequired: firstPaidRoute.maxAmountRequired,
    payableRoute: firstPaidRoute,
    ...(exactIntentPaidAction ? {
      exactIntentPaidAction,
      exactIntentPaidRoute,
      exactIntentPaidUrl: exactIntentPaidRoute.route,
      exactIntentPaidPath: exactIntentPaidRoute.path
    } : {}),
    selectedFirstPaidAction,
    selectedPaidSequence,
    buyerInstruction: buildSelectedBuyerInstruction(selectedActionKey, selectedIntentPaidAction, intentRoutes.indexedQuickScore),
    preferredFirstPaidAction: intentRoutes.indexedQuickScore,
    provenFirstPaidAction: intentRoutes.indexedQuickScore,
    paidResponsePreview: buildPaidResponsePreview(
      config,
      isQuickScoreExactAliasActionKey(selectedActionKey) && !shouldUseExactAliasFirst(selectedActionKey) ? "indexedQuickScore" : selectedActionKey,
      selectedFirstPaidAction
    ),
    selectedFirstPaidResponsePreview: buildPaidResponsePreview(
      config,
      isQuickScoreExactAliasActionKey(selectedActionKey) && !shouldUseExactAliasFirst(selectedActionKey) ? "indexedQuickScore" : selectedActionKey,
      selectedFirstPaidAction
    ),
    recommendedPaidSequence: selectedPaidSequence,
    genericRecommendedPaidSequence,
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
  const startHere = buildStartHereHandoff(config, cashRegister, intentRoutes);
  const allItems = matchesMerchant ? buildLocalDiscoveryItems(config) : [];
  const limit = parseDiscoveryLimit(query.limit, 20);
  const offset = parseDiscoveryOffset(query.offset);
  const items = allItems.slice(offset, offset + limit);

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
    commands: absoluteUrl(config, COMMANDS_PATH),
    links: {
      commands: absoluteUrl(config, COMMANDS_PATH),
      payNow: absoluteUrl(config, PAY_NOW_PATH),
      pricing: absoluteUrl(config, PRICING_PATH),
      paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
      x402Manifest: absoluteUrl(config, "/x402.json"),
      openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH)
    },
    startHere,
    officialCdpDiscovery: buildOfficialCdpDiscoveryHandoff(config),
    preferredFirstPaidAction: intentRoutes.indexedQuickScore,
    preferredFirstPaidResponsePreview: buildPaidResponsePreview(config, "indexedQuickScore", intentRoutes.indexedQuickScore),
    recommendedPaidSequence: buildRecommendedPaidSequence(intentRoutes),
    resources: items,
    count: items.length,
    pagination: {
      limit,
      offset,
      total: allItems.length
    },
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
    "pre pay",
    "x402 buyer prepay risk score",
    "buyer prepay risk score",
    "prepay risk score",
    "score x402 endpoint before paying",
    "score endpoint before paying",
    "endpoint before paying",
    "x402 route health check",
    "route health check",
    "x402 listing rank doctor",
    "listing rank doctor",
    "seller growth checklist",
    "growth checklist",
    "buyer-readiness",
    "buyer readiness"
  ]);
}

function wantsBazaarDiscoveryFix(query) {
  const normalizedQuery = String(query || "").toLowerCase()
    .replaceAll("coinbase x402 bazaar mcp server", "coinbase x402 mcp server")
    .replaceAll("coinbase bazaar mcp server", "coinbase mcp server")
    .replaceAll("x402 bazaar mcp server", "x402 mcp server")
    .replaceAll("bazaar mcp server", "mcp server")
    .replaceAll("bazaar mcp", "mcp");

  return includesAny(normalizedQuery, [
    "discovery audit",
    "agent402",
    "agent 402",
    "agent402 router",
    "agent402 route",
    "agent402 routing",
    "agent router",
    "router visibility",
    "route visibility",
    "route ranking",
    "bazaar",
    "stale price",
    "stale pricing",
    "search visibility",
    "search position"
  ]);
}

function wantsCustomBodyScore(query) {
  return includesAny(query, [
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
}

function wantsFullRoastOutput(query) {
  return includesAny(query, [
    "full roast",
    "rewrite",
    "top fixes",
    "launch guidance",
    "launch recommendation"
  ]);
}

function quickScoreAliasActionKeyForQuery(query) {
  const normalizedQuery = String(query || "").toLowerCase();

  if (includesAny(normalizedQuery, ["coinbase x402 bazaar mcp server", "x402 bazaar mcp server", "bazaar mcp tools", "coinbase bazaar mcp"])) {
    return "coinbaseX402BazaarMcpServer";
  }

  if (
    !normalizedQuery ||
    wantsPaidApiPreflight(normalizedQuery) ||
    wantsBazaarDiscoveryFix(normalizedQuery) ||
    wantsCustomBodyScore(normalizedQuery) ||
    wantsFullRoastOutput(normalizedQuery)
  ) {
    return null;
  }

  if (includesAny(normalizedQuery, ["buyer-agent skip reason", "buyer-agent skip reasons", "buyer agent skip reason", "buyer agent skip reasons", "skip reasons"])) {
    return "buyerAgentSkipReasons";
  }

  if (includesAny(normalizedQuery, ["agent service clarity", "agent-service clarity", "agent service listing clarity", "agent-service listing score", "agent service listing score", "listing clarity"])) {
    return "agentServiceClarity";
  }

  if (includesAny(normalizedQuery, ["paid api listing quality score"])) {
    return "paidApiListingQualityScore";
  }

  if (includesAny(normalizedQuery, ["agentcore x402 payment", "agentcore x402 payments", "amazon bedrock agentcore payment", "amazon bedrock agentcore payments", "agentcore gateway", "agentcore paid api discovery"])) {
    return "agentCoreX402Payments";
  }

  if (includesAny(normalizedQuery, ["x402 listing quality", "x402 listing quality score"])) {
    return "x402ListingQuality";
  }

  if (includesAny(normalizedQuery, ["marketplace listing conversion API", "marketplace listing conversion", "marketplace conversion score", "marketplace conversion check", "x402 marketplace conversion"])) {
    return "marketplaceListingConversion";
  }

  if (includesAny(normalizedQuery, ["marketplace product listing quality", "score marketplace product listing quality"])) {
    return "marketplaceProductListingQuality";
  }

  if (includesAny(normalizedQuery, ["listing quality score api", "listing quality score"])) {
    return "listingQualityScoreApi";
  }

  if (includesAny(normalizedQuery, ["paid api listing quality", "paid api listing"])) {
    return "paidApiListingQuality";
  }

  if (includesAny(normalizedQuery, [
    "agentic market listing score",
    "agentic.market listing score",
    "agentic market listing quality",
    "agentic.market listing quality",
    "marketplace listing score",
    "marketplace listing quality"
  ])) {
    return "marketplaceListingScore";
  }

  return null;
}

function scoreCatalogResource(resource, query) {
  const normalizedQuery = query.toLowerCase();
  const wantsPreflight = wantsPaidApiPreflight(normalizedQuery);
  const wantsDiscoveryFix = wantsBazaarDiscoveryFix(normalizedQuery);
  const wantsCustomScore = wantsCustomBodyScore(normalizedQuery);
  const wantsFullRoast = wantsFullRoastOutput(normalizedQuery);
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
  const selectedQuickScoreAliasActionKey = quickScoreAliasActionKeyForQuery(normalizedQuery);
  const resourceActionKey = PAY_NOW_ACTION_BY_RESOURCE_ID[resource.id];

  if (selectedQuickScoreAliasActionKey && isIndexedRoastGet) {
    score += 500;
  }

  if (selectedQuickScoreAliasActionKey && resourceActionKey === selectedQuickScoreAliasActionKey) {
    score += 100;
  }

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

  if (includesAny(normalizedQuery, ["x402 buyer prepay risk score", "buyer prepay risk score", "prepay risk score", "x402 prepay risk"])) {
    if (resource.id === "x402_buyer_prepay_risk_score") score += 620;
    if (resource.path === SITE_AUDIT_PATH) score += 120;
  }

  if (includesAny(normalizedQuery, ["score x402 endpoint before paying", "score endpoint before paying", "endpoint before paying"])) {
    if (resource.id === "score_x402_endpoint_before_paying") score += 620;
    if (resource.path === SITE_AUDIT_PATH) score += 120;
  }

  if (includesAny(normalizedQuery, ["x402 route health check", "route health check", "x402 route health"])) {
    if (resource.id === "x402_route_health_check") score += 620;
    if (resource.path === SITE_AUDIT_PATH) score += 140;
  }

  if (includesAny(normalizedQuery, ["x402 listing rank doctor", "listing rank doctor", "x402 listing rank"])) {
    if (resource.id === "x402_listing_rank_doctor") score += 620;
    if (resource.path === SITE_AUDIT_PATH) score += 140;
    if (resource.id === "x402_discovery_audit") score += 60;
  }

  if (wantsDiscoveryFix || includesAny(normalizedQuery, ["route health"])) {
    if (resource.id === "agent402_route_visibility_audit" && includesAny(normalizedQuery, ["agent402 route visibility", "agent402 router", "agent402 routing", "agent402 route"])) score += 360;
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
    if (resource.id === "agent402_route_visibility_audit" && includesAny(normalizedQuery, ["agent402"])) score += 140;
    if (resource.id === "x402_discovery_audit_quick") score += 70;
    if (resource.id === "x402_discovery_audit") score += 35;
  }

  if (includesAny(normalizedQuery, ["skip reason", "skip reasons", "agent listing", "listing clarity", "agent service clarity", "agent-service", "buyer intent"])) {
    if (isIndexedRoastGet) score += 155;
    if (resource.id === "buyer_agent_skip_reasons_alias" && includesAny(normalizedQuery, ["buyer-agent skip reason", "buyer-agent skip reasons", "buyer agent skip reason", "buyer agent skip reasons", "skip reasons"])) score += 320;
    if (resource.id === "agent_service_clarity_alias" && includesAny(normalizedQuery, ["agent service clarity", "agent-service clarity", "agent service listing clarity", "agent-service listing score", "listing clarity"])) score += 320;
    if (resource.path === AGENT_LISTING_SCORE_PATH && includesAny(normalizedQuery, ["agent listing conversion score", "agent_listing_conversion_score"])) score += 360;
    if (AGENT_LISTING_PAID_PATHS.includes(resource.path)) score += 90;
    if (resource.id === "listing_roast") score += 30;
  }

  if (includesAny(normalizedQuery, ["agentic market listing score", "agentic.market listing score", "agentic market listing quality", "agentic.market listing quality", "marketplace listing score", "marketplace listing quality", "paid api listing quality", "paid api listing quality score", "listing quality score", "x402 listing quality", "agent-service listing score", "agent service listing score"])) {
    if (isIndexedRoastGet) score += 260;
    if (resource.id === "marketplace_listing_score_alias" && includesAny(normalizedQuery, ["agentic market listing score", "agentic.market listing score", "agentic market listing quality", "agentic.market listing quality", "marketplace listing score", "marketplace listing quality"])) score += 460;
    if (resource.id === "paid_api_listing_quality_alias" && includesAny(normalizedQuery, ["paid api listing quality", "paid api listing quality score", "paid api listing"])) score += 460;
    if (resource.id === "paid_api_listing_quality_score_alias" && includesAny(normalizedQuery, ["paid api listing quality score", "paid api listing quality"])) score += 470;
    if (resource.id === "x402_listing_quality_alias" && includesAny(normalizedQuery, ["x402 listing quality", "x402 listing quality score"])) score += 470;
    if (resource.id === "agent_service_clarity_alias" && includesAny(normalizedQuery, ["agent-service listing score", "agent service listing score"])) score += 430;
    if (resource.path === INSTANT_SCORE_PATH) score += 10;
  }

  if (includesAny(normalizedQuery, ["x402 marketplace conversion", "marketplace listing conversion API", "marketplace listing conversion", "marketplace conversion score", "marketplace conversion check"])) {
    if (resource.id === "marketplace_listing_conversion_api_alias") score += 485;
    if (resource.id === "marketplace_listing_conversion_alias") score += 455;
    if (resource.path === CONVERSION_SCORE_PATH) score += 140;
    if (isIndexedRoastGet) score += 15;
  }

  if (includesAny(normalizedQuery, ["coinbase x402 bazaar mcp server", "x402 bazaar mcp server", "bazaar mcp tools", "coinbase bazaar mcp"])) {
    if (resource.id === "coinbase_x402_bazaar_mcp_server_alias") score += 120;
    if (resource.id === "agentcore_x402_payments_alias") score += 40;
    if (isIndexedRoastGet) score += 650;
  }

  if (includesAny(normalizedQuery, ["agentcore x402 payment", "agentcore x402 payments", "amazon bedrock agentcore payment", "amazon bedrock agentcore payments", "agentcore gateway", "agentcore paid api discovery"])) {
    if (resource.id === "agentcore_x402_payments_alias") score += 80;
    if (resource.id === "coinbase_x402_bazaar_mcp_server_alias") score += 20;
    if (isIndexedRoastGet) score += 25;
  }

  if (includesAny(normalizedQuery, ["agent listing conversion", "listing conversion score", "agent listing conversion score"])) {
    if (resource.path === AGENT_LISTING_SCORE_PATH && includesAny(normalizedQuery, ["agent listing conversion score", "agent_listing_conversion_score"])) score += 520;
    if (AGENT_LISTING_PAID_PATHS.includes(resource.path)) score += 260;
    if (isIndexedRoastGet) score += 15;
  }

  if (includesAny(normalizedQuery, ["full roast", "rewrite", "top fixes", "launch guidance", "custom body", "body-specific"])) {
    if (resource.id === "full_listing_roast_get" && !includesAny(normalizedQuery, ["custom body", "body-specific", "post body"])) score += 260;
    if (resource.id === "listing_roast") score += 125;
    if (resource.id === "listing_score") score += 55;
    if (resource.id === "indexed_roast_quick_score") score += 20;
  }

  if (wantsCustomScore) {
    if (resource.id === "listing_score") score += 170;
    if (resource.path === INSTANT_SCORE_PATH) score += 15;
  }

  if (wantsFullRoast) {
    if (resource.id === "full_listing_roast_get") score += 220;
    if (resource.id === "listing_roast") score += 70;
  }

  if (includesAny(normalizedQuery, ["score", "listing quality", "marketplace conversion", "paid api listing", "discoverability", "conversion"])) {
    if (resource.id === "indexed_roast_quick_score") score += 105;
    if (resource.path === CONVERSION_SCORE_PATH) score += 85;
    if (resource.path === INSTANT_SCORE_PATH) score += 70;
    if (resource.id === "listing_score") score += 45;
    if (AGENT_LISTING_PAID_PATHS.includes(resource.path)) score += 30;
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
  const selectedActionKey = quickScoreAliasActionKeyForQuery(query) || selected?.selectedActionKey || "indexedQuickScore";
  const selectedPaidAction = intentRoutes[selectedActionKey] || selected?.selectedPaidAction || provenFirstPaidAction;
  const selectedFirstPaidAction = firstPaidActionForSelectedIntent(intentRoutes, selectedActionKey, selectedPaidAction);
  const exactIntentPaidAction = exactIntentPaidActionForSelection(intentRoutes, selectedActionKey, selectedPaidAction);
  const selectedPaidSequence = buildSelectedPaidSequence(intentRoutes, selectedActionKey, selectedPaidAction);
  const selectedPaidRoute = compactPaidAction(handoffSelectedPaidActionForSelection(intentRoutes, selectedActionKey, selectedPaidAction));
  const firstPaidRoute = compactPaidAction(selectedFirstPaidAction);
  const exactIntentPaidRoute = exactIntentPaidAction ? compactPaidAction(exactIntentPaidAction) : null;
  const officialCdpDiscovery = buildOfficialCdpDiscoveryHandoff(config);
  const startHere = buildStartHereHandoff(config, cashRegister, intentRoutes, {
    selectedPaidSequence,
    use: selectedPaidSequence[0]?.use || selectedActionKey,
    firstAction: selectedFirstPaidAction
  });
  const genericRecommendedPaidSequence = buildRecommendedPaidSequence(intentRoutes);

  return {
    service: config.serviceName,
    query,
    noSpend: true,
    paidUsageProof: buildPaidUsageProof(config, cashRegister),
    paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
    recommended,
    recommendedRoute: recommended,
    recommendedPaidRoute: recommended,
    ...(selected || {}),
    selectedActionKey,
    selectedPaidRoute,
    selectedPaidUrl: selectedPaidRoute.route,
    selectedPaidPath: selectedPaidRoute.path,
    selectedPaidMethod: selectedPaidRoute.method,
    selectedPaidPrice: selectedPaidRoute.price,
    selectedPaidMaxAmountRequired: selectedPaidRoute.maxAmountRequired,
    selectedPaidAction: handoffSelectedPaidActionForSelection(intentRoutes, selectedActionKey, selectedPaidAction),
    firstPaidRoute,
    firstPaidUrl: firstPaidRoute.route,
    firstPaidPath: firstPaidRoute.path,
    firstPaidMethod: firstPaidRoute.method,
    firstPaidPrice: firstPaidRoute.price,
    firstPaidMaxAmountRequired: firstPaidRoute.maxAmountRequired,
    payableRoute: firstPaidRoute,
    ...(exactIntentPaidAction ? {
      exactIntentPaidAction,
      exactIntentPaidRoute,
      exactIntentPaidUrl: exactIntentPaidRoute.route,
      exactIntentPaidPath: exactIntentPaidRoute.path
    } : {}),
    rankedPaidRoutes: ranked.slice(0, 5).map((route) => ({
      id: route.id,
      path: route.path,
      method: route.method,
      price: route.price,
      maxAmountRequired: route.maxAmountRequired,
      matchScore: route.matchScore
    })),
    alternatives: ranked.filter((route) => route.id !== recommended.id).slice(0, 4),
    pricing: absoluteUrl(config, PRICING_PATH),
    find: absoluteUrl(config, FIND_PATH),
    route: absoluteUrl(config, ROUTE_PATH),
    routeSelector: absoluteUrl(config, ROUTE_PATH),
    routeSelectorUrl: absoluteUrl(config, ROUTE_PATH),
    openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH),
    x402Manifest: absoluteUrl(config, "/x402.json"),
    payNow: absoluteUrl(config, PAY_NOW_PATH),
    commands: absoluteUrl(config, COMMANDS_PATH),
    links: {
      commands: absoluteUrl(config, COMMANDS_PATH),
      payNow: absoluteUrl(config, PAY_NOW_PATH),
      pricing: absoluteUrl(config, PRICING_PATH),
      route: absoluteUrl(config, ROUTE_PATH),
      paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
      x402Manifest: absoluteUrl(config, "/x402.json"),
      openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH)
    },
    officialCdpDiscovery,
    startHere,
    preferredFirstPaidAction: provenFirstPaidAction,
    provenFirstPaidAction,
    provenFirstPaidReason: "Use this first when the buyer wants the already-indexed route with wallet-backed paid-use proof. The recommended route may still point to a phrase-specific alias.",
    selectedFirstPaidAction,
    command: selectedFirstPaidAction.command,
    commandHandoff: `${absoluteUrl(config, COMMANDS_PATH)}?intent=${encodeURIComponent(query || selectedActionKey)}`,
    ...(exactIntentPaidAction ? { exactIntentCommand: exactIntentPaidAction.command } : {}),
    paidResponsePreview: buildPaidResponsePreview(
      config,
      isQuickScoreExactAliasActionKey(selectedActionKey) && !shouldUseExactAliasFirst(selectedActionKey) ? "indexedQuickScore" : selectedActionKey,
      selectedFirstPaidAction
    ),
    selectedFirstPaidResponsePreview: buildPaidResponsePreview(
      config,
      isQuickScoreExactAliasActionKey(selectedActionKey) && !shouldUseExactAliasFirst(selectedActionKey) ? "indexedQuickScore" : selectedActionKey,
      selectedFirstPaidAction
    ),
    selectedPaidSequence,
    buyerInstruction: buildSelectedBuyerInstruction(selectedActionKey, selectedPaidAction, provenFirstPaidAction),
    recommendedPaidSequence: selectedPaidSequence,
    genericRecommendedPaidSequence,
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
  const selectedActionKey = quickScoreAliasActionKeyForQuery(query) || selected?.selectedActionKey || "indexedQuickScore";
  const selectedPaidAction = intentRoutes[selectedActionKey] || selected?.selectedPaidAction || provenFirstPaidAction;
  const selectedFirstPaidAction = firstPaidActionForSelectedIntent(intentRoutes, selectedActionKey, selectedPaidAction);
  const exactIntentPaidAction = exactIntentPaidActionForSelection(intentRoutes, selectedActionKey, selectedPaidAction);
  const selectedPaidSequence = buildSelectedPaidSequence(intentRoutes, selectedActionKey, selectedPaidAction);
  const selectedPaidRoute = compactPaidAction(handoffSelectedPaidActionForSelection(intentRoutes, selectedActionKey, selectedPaidAction));
  const firstPaidRoute = compactPaidAction(selectedFirstPaidAction);
  const exactIntentPaidRoute = exactIntentPaidAction ? compactPaidAction(exactIntentPaidAction) : null;
  const startHere = buildStartHereHandoff(config, cashRegister, intentRoutes, {
    selectedPaidSequence,
    use: selectedPaidSequence[0]?.use || selectedActionKey,
    firstAction: selectedFirstPaidAction
  });
  const genericRecommendedPaidSequence = buildRecommendedPaidSequence(intentRoutes);

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
    selectedActionKey,
    selectedPaidRoute,
    selectedPaidUrl: selectedPaidRoute.route,
    selectedPaidPath: selectedPaidRoute.path,
    selectedPaidMethod: selectedPaidRoute.method,
    selectedPaidPrice: selectedPaidRoute.price,
    selectedPaidMaxAmountRequired: selectedPaidRoute.maxAmountRequired,
    selectedPaidAction: handoffSelectedPaidActionForSelection(intentRoutes, selectedActionKey, selectedPaidAction),
    firstPaidRoute,
    firstPaidUrl: firstPaidRoute.route,
    firstPaidPath: firstPaidRoute.path,
    firstPaidMethod: firstPaidRoute.method,
    firstPaidPrice: firstPaidRoute.price,
    firstPaidMaxAmountRequired: firstPaidRoute.maxAmountRequired,
    payableRoute: firstPaidRoute,
    ...(exactIntentPaidAction ? {
      exactIntentPaidAction,
      exactIntentPaidRoute,
      exactIntentPaidUrl: exactIntentPaidRoute.route,
      exactIntentPaidPath: exactIntentPaidRoute.path
    } : {}),
    count: ranked.length,
    totalLocalRoutes: buildPaidRouteCatalog(config).length,
    pricing: absoluteUrl(config, PRICING_PATH),
    find: absoluteUrl(config, FIND_PATH),
    route: absoluteUrl(config, ROUTE_PATH),
    openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH),
    x402Manifest: absoluteUrl(config, "/x402.json"),
    commands: absoluteUrl(config, COMMANDS_PATH),
    links: {
      commands: absoluteUrl(config, COMMANDS_PATH),
      payNow: absoluteUrl(config, PAY_NOW_PATH),
      pricing: absoluteUrl(config, PRICING_PATH),
      find: absoluteUrl(config, FIND_PATH),
      paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
      x402Manifest: absoluteUrl(config, "/x402.json"),
      openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH)
    },
    localDiscovery: {
      resources: absoluteUrl(config, LOCAL_DISCOVERY_RESOURCE_PATHS[0]),
      search: absoluteUrl(config, LOCAL_DISCOVERY_SEARCH_PATHS[0]),
      merchant: absoluteUrl(config, LOCAL_DISCOVERY_MERCHANT_PATHS[0]),
      searchExamples: buildLocalDiscoverySearchExamples(config)
    },
    payNow: absoluteUrl(config, PAY_NOW_PATH),
    startHere,
    preferredFirstPaidAction: provenFirstPaidAction,
    provenFirstPaidAction,
    provenFirstPaidReason: "Use this first when the buyer wants the already-indexed route with wallet-backed paid-use proof. The best match may still point to a phrase-specific alias.",
    selectedFirstPaidAction,
    command: selectedFirstPaidAction.command,
    commandHandoff: `${absoluteUrl(config, COMMANDS_PATH)}?intent=${encodeURIComponent(query || selectedActionKey)}`,
    ...(exactIntentPaidAction ? { exactIntentCommand: exactIntentPaidAction.command } : {}),
    paidResponsePreview: buildPaidResponsePreview(
      config,
      isQuickScoreExactAliasActionKey(selectedActionKey) && !shouldUseExactAliasFirst(selectedActionKey) ? "indexedQuickScore" : selectedActionKey,
      selectedFirstPaidAction
    ),
    selectedFirstPaidResponsePreview: buildPaidResponsePreview(
      config,
      isQuickScoreExactAliasActionKey(selectedActionKey) && !shouldUseExactAliasFirst(selectedActionKey) ? "indexedQuickScore" : selectedActionKey,
      selectedFirstPaidAction
    ),
    selectedPaidSequence,
    buyerInstruction: buildSelectedBuyerInstruction(selectedActionKey, selectedPaidAction, provenFirstPaidAction),
    recommendedPaidSequence: selectedPaidSequence,
    genericRecommendedPaidSequence,
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
  const actionAliases = buildManifestActionAliases(config, buildX402Manifest(config, cashRegister).resources);
  const officialCdpDiscovery = buildOfficialCdpDiscoveryHandoff(config);
  const commands = absoluteUrl(config, COMMANDS_PATH);
  const payNow = absoluteUrl(config, PAY_NOW_PATH);
  const paidUsageProofUrl = absoluteUrl(config, PAID_USAGE_PROOF_PATH);
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
    commands,
    payNow,
    paidUsageProofUrl,
    officialCdpDiscovery,
    preferredFirstPaidAction: intentRoutes.indexedQuickScore,
    recommendedPaidSequence,
    payNowExamples: buildPayNowIntentExamples(config),
    cashRegister: absoluteUrl(config, "/api/cash-register"),
    paidUsageProof: buildPaidUsageProof(config, cashRegister),
    settlementProof: buildSettlementProof(config),
    payment: {
      protocol: "x402",
      network: config.network,
      asset: "USDC",
      manifest: absoluteUrl(config, "/x402.json"),
      commands,
      payNow,
      paidUsageProofUrl,
      officialCdpDiscovery,
      preferredFirstPaidAction: intentRoutes.indexedQuickScore,
      recommendedPaidSequence,
      payNowExamples: buildPayNowIntentExamples(config),
      cashRegister: absoluteUrl(config, "/api/cash-register"),
      paidUsageProof: buildPaidUsageProof(config, cashRegister),
      settlementProof: buildSettlementProof(config)
    },
    links: {
      commands,
      payNow,
      paidUsageProofUrl,
      x402Manifest: absoluteUrl(config, "/x402.json"),
      openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH),
      agentSkills: absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH),
      mcp: absoluteUrl(config, WELL_KNOWN_MCP_JSON_PATH),
      cashRegister: absoluteUrl(config, "/api/cash-register")
    },
    actions: actionAliases,
    paidActions: actionAliases,
    tools: actionAliases,
    skills: [
      buildAgentSkill(config, {
        id: "indexed-listing-roast-quick-score",
        name: "Paid API listing quality score",
        description: "$0.001 GET paid API listing quality score for buyer-agent skip reasons, agent service listing clarity, and marketplace listing score on the already-indexed Listing Roast route.",
        tags: ["x402", "paid API listing", "listing roast", "buyer-agent skip reasons"],
        method: "GET",
        path: ROAST_PATH,
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        preferredFirstPaidAction: true,
        buyerAction: "Pay $0.001 on the already-indexed /api/listing-roast route for a paid API listing quality score."
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
        path: AGENT_LISTING_SCORE_PATH,
        price: config.instantScorePrice,
        maxAmountRequired: INSTANT_SCORE_AMOUNT,
        buyerAction: "Pay $0.001 for the exact agent listing conversion score alias without building a JSON body."
      }),
      buildAgentSkill(config, {
        id: "x402-site-audit",
        name: "x402 site audit",
        description: "$0.001 GET x402 buyer prepay risk score, score x402 endpoint before paying, route health check, listing SEO audit, listing rank doctor, seller growth checklist, service discoverability, and paid API preflight before paying audit.",
        tags: ["x402 site audit", "x402 buyer prepay risk score", "score x402 endpoint before paying", "x402 service discoverability", "x402 listing SEO audit", "x402 listing rank doctor", "x402 seller growth checklist", "x402 seller intelligence", "paid API preflight"],
        method: "GET",
        path: SITE_AUDIT_PATH,
        price: config.siteAuditPrice,
        maxAmountRequired: SITE_AUDIT_AMOUNT,
        buyerAction: "Pay $0.001 for a no-spend x402 metadata, pricing, and search visibility check."
      }),
      buildAgentSkill(config, {
        id: "x402-discovery-audit-quick",
        name: "x402 discovery audit quick check",
        description: "$0.001 GET x402 discovery audit on the exact audit path for stale pricing, Agent402 route visibility, search visibility, route health, paid API preflight, and direct 402 metadata.",
        tags: ["x402 discovery audit", "x402 bazaar discovery", "Agent402 route visibility", "x402 route health", "paid API preflight", "stale price"],
        method: "GET",
        path: DISCOVERY_AUDIT_PATH,
        price: config.siteAuditPrice,
        maxAmountRequired: DISCOVERY_AUDIT_QUICK_AMOUNT,
        buyerAction: "Pay $0.001 for the exact x402 discovery audit path before buying the full custom audit."
      }),
      buildAgentSkill(config, {
        id: "agent402-route-visibility-audit",
        name: "Agent402 route visibility audit",
        description: "$0.001 GET exact Agent402 route visibility audit for Agent402 router ranking, stale pricing, search visibility, route health, paid API preflight, and direct 402 metadata.",
        tags: ["Agent402 route visibility", "Agent402 router", "Agent402 routing", "x402 discovery audit", "x402 route health", "paid API preflight", "stale price"],
        method: "GET",
        path: AGENT402_ROUTE_VISIBILITY_PATH,
        price: config.siteAuditPrice,
        maxAmountRequired: DISCOVERY_AUDIT_QUICK_AMOUNT,
        buyerAction: "Pay $0.001 for the exact Agent402 route visibility audit before buying the full custom audit."
      }),
      buildAgentSkill(config, {
        id: "x402-discovery-audit",
        name: "x402 discovery audit",
        description: "$0.01 POST audit for stale pricing, search visibility, listing SEO, seller growth, and direct 402 metadata.",
        tags: ["x402 discovery audit", "x402 bazaar discovery", "Agent402 route visibility", "x402 listing SEO audit", "x402 listing rank doctor", "x402 seller growth checklist", "x402 seller intelligence", "stale price"],
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
        description: "$0.01 GET direct full roast with skip reasons, top fixes, rewritten listing, and stop-or-upgrade guidance.",
        tags: ["listing roast", "marketplace listing conversion API", "marketplace listing conversion", "paid API listing quality"],
        method: "GET",
        path: FULL_ROAST_GET_PATH,
        price: config.price,
        maxAmountRequired: "10000",
        buyerAction: "Pay $0.01 for the direct full listing roast, rewrite, and stop-or-upgrade guidance without assembling a POST body."
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
      mcpAliases: mcpAliasUrls(config),
      mcpServerCard: absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH),
      mcpServerCardAliases: mcpServerCardAliasUrls(config),
      quickScoreAliases: quickScoreAliasUrls(config),
      preflightAliases: preflightAliasUrls(config),
      agentSkills: absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH),
      officialCdpDiscovery,
      noSpendDiscovery: true,
      preferredFirstPaidAction: intentRoutes.indexedQuickScore,
      recommendedPaidSequence,
      commands: absoluteUrl(config, COMMANDS_PATH),
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
  const officialCdpDiscovery = buildOfficialCdpDiscoveryHandoff(config);

  return {
    schema_version: "v1",
    name_for_human: "Listing Roast x402",
    name_for_model: "listing_roast_x402",
    description_for_human: "Paid x402 API for listing quality scoring, x402 marketplace conversion, agent listing conversion score, buyer-agent skip reasons, and x402 discoverability checks.",
    description_for_model: [
      "Listing Roast x402 is a paid HTTP JSON API for x402, MCP, and agent-service builders.",
      "Use it when a builder needs a paid API listing quality score, buyer-agent skip reasons, x402 marketplace conversion feedback, or x402 service discoverability guidance before promotion.",
      "Protected routes require x402 payment in USDC on Base before JSON output is returned.",
      `Use GET ${absoluteUrl(config, API_ENTRY_PATH)}, GET ${absoluteUrl(config, API_V1_ENTRY_PATH)}, or GET ${absoluteUrl(config, V1_ENTRY_PATH)} for a generic ${config.instantScorePrice} paid x402 navigation route map with fallback quick score when an agent starts at /api, /api/v1, or /v1 first.`,
      `Preferred first paid action: GET ${absoluteUrl(config, ROAST_PATH)} for ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT} USDC units; direct quick-score aliases are ${formatQuickScoreAliasUrls(config)}.`,
      `Use GET ${absoluteUrl(config, AGENT_LISTING_SCORE_PATH)} for the exact agent listing conversion score alias, agent service listing clarity, and buyer-agent skip reasons; canonical route: ${absoluteUrl(config, AGENT_LISTING_PATH)}.`,
      `Use GET ${absoluteUrl(config, SITE_AUDIT_PATH)} for a cheap x402 site audit and paid API preflight before paying; direct preflight aliases are ${formatPreflightAliasUrls(config)}.`,
      `Use POST ${absoluteUrl(config, ROAST_PATH)} only when the buyer wants the full ${config.price} roast, rewrite, and stop-or-upgrade guidance.`,
      `Use free GET ${absoluteUrl(config, PRICING_PATH)} for the paid route price catalog, free GET ${absoluteUrl(config, FIND_PATH)}?q=<task> to choose one route, and free GET/POST ${absoluteUrl(config, ROUTE_PATH)} to rank local paid routes before spending.`,
      "Do not call paid routes unless the buyer intends to pay; free discovery files are OpenAPI, x402 manifest, agent card, Agent Skills index, MCP metadata, llms.txt, compact command handoff, examples, sample score, paid-use proof, pricing, route finder, local route router, and pay-now JSON."
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
    commands: absoluteUrl(config, COMMANDS_PATH),
    officialCdpDiscovery,
    links: {
      commands: absoluteUrl(config, COMMANDS_PATH),
      payNow: absoluteUrl(config, PAY_NOW_PATH),
      paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
      pricing: absoluteUrl(config, PRICING_PATH),
      find: absoluteUrl(config, FIND_PATH),
      route: absoluteUrl(config, ROUTE_PATH),
      x402Manifest: absoluteUrl(config, "/x402.json"),
      agentCard: absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH),
      openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH)
    },
    x_listing_roast: {
      paymentProtocol: "x402",
      network: config.network,
      asset: "USDC",
      commands: absoluteUrl(config, COMMANDS_PATH),
      payNow: absoluteUrl(config, PAY_NOW_PATH),
      pricing: absoluteUrl(config, PRICING_PATH),
      find: absoluteUrl(config, FIND_PATH),
      route: absoluteUrl(config, ROUTE_PATH),
      officialCdpDiscovery,
      links: {
        commands: absoluteUrl(config, COMMANDS_PATH),
        payNow: absoluteUrl(config, PAY_NOW_PATH),
        paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
        pricing: absoluteUrl(config, PRICING_PATH),
        find: absoluteUrl(config, FIND_PATH),
        route: absoluteUrl(config, ROUTE_PATH),
        x402Manifest: absoluteUrl(config, "/x402.json"),
        agentCard: absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH),
        openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH)
      },
      x402Manifest: absoluteUrl(config, "/x402.json"),
      agentCard: absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH),
      agentSkills: absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH),
      openApi: absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH),
      quickScoreAliases: quickScoreAliasUrls(config),
      preflightAliases: preflightAliasUrls(config),
      recommendedFirstPaidAction: intentRoutes.indexedQuickScore,
      recommendedPaidSequence,
      payNowExamples: buildPayNowIntentExamples(config),
      officialCdpDiscovery,
      cashRegister: absoluteUrl(config, "/api/cash-register"),
      paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
      paidUsageProof: buildPaidUsageProof(config, cashRegister),
      settlementProof: buildSettlementProof(config)
    }
  };
}

function buildApiCatalog(config, cashRegister = {}) {
  const paidUsageProof = buildPaidUsageProof(config, cashRegister);
  const intentRoutes = buildPayNowActions(config);
  const officialCdpDiscovery = buildOfficialCdpDiscoveryHandoff(config);
  const intentHandoffs = [
    "marketplace listing score",
    "paid API listing quality score",
    "buyer-agent skip reasons",
    "full roast rewrite top fixes",
    "x402 discovery audit"
  ];
  const paymentHandoffLinks = intentHandoffs.map((intent) => ({
    href: `${absoluteUrl(config, PAY_NOW_PATH)}?intent=${encodeURIComponent(intent)}`,
    type: "application/json",
    title: `No-spend pay-now handoff for ${intent}`
  }));
  const commandHandoffLinks = intentHandoffs.map((intent) => ({
    href: `${absoluteUrl(config, COMMANDS_PATH)}?intent=${encodeURIComponent(intent)}`,
    type: "application/json",
    title: `No-spend command handoff for ${intent}`
  }));
  const recommendedPaidSequence = buildRecommendedPaidSequence(intentRoutes).map((step) => ({
    href: step.action.route,
    type: "application/json",
    title: `${step.step === 1 ? "Start" : "Upgrade"}: ${step.action.method} ${step.action.path} ${step.action.price}, max ${step.action.maxAmountRequired} USDC units`,
    step: step.step,
    use: step.use,
    method: step.action.method,
    price: step.action.price,
    maxAmountRequired: step.action.maxAmountRequired,
    maxPaymentUsd: step.action.maxPaymentUsd,
    agentPaymentRequest: step.action.agentPaymentRequest,
    agentPaymentPrompt: step.action.agentPaymentPrompt,
    command: step.action.command,
    reason: step.reason,
    expectedChallenge: {
      status: 402,
      network: config.network,
      amount: step.action.maxAmountRequired,
      route: step.action.route
    }
  }));
  const item = [
    { href: absoluteUrl(config, ROAST_PATH), type: "application/json", title: "GET preferred first $0.001 indexed listing score" },
    ...QUICK_SCORE_ALIAS_PATHS.map((pathname) => ({ href: absoluteUrl(config, pathname), type: "application/json", title: QUICK_SCORE_ALIAS_METADATA[pathname].catalogTitle })),
    { href: absoluteUrl(config, ROOT_DIRECTORY_POST_PATH), type: "application/json", title: "POST $0.001 root directory handoff for generic agent-tools snippets" },
    { href: absoluteUrl(config, INSTANT_SCORE_PATH), type: "application/json", title: "GET $0.001 instant paid API listing quality score" },
    { href: absoluteUrl(config, CONVERSION_SCORE_PATH), type: "application/json", title: "GET $0.001 x402 marketplace conversion score" },
    { href: absoluteUrl(config, AGENT_LISTING_SCORE_PATH), type: "application/json", title: "GET $0.001 exact agent listing conversion score alias" },
    { href: absoluteUrl(config, AGENT_LISTING_PATH), type: "application/json", title: "GET $0.001 canonical buyer-agent skip reasons and agent listing conversion route" },
    { href: absoluteUrl(config, PING_PATH), type: "application/json", title: "GET $0.001 paid x402 ping" },
    { href: absoluteUrl(config, SITE_AUDIT_PATH), type: "application/json", title: "GET $0.001 x402 site audit and paid API preflight" },
    ...PREFLIGHT_ALIAS_PATHS.map((pathname) => ({ href: absoluteUrl(config, pathname), type: "application/json", title: "GET $0.001 paid API preflight alias for x402 site audit" })),
    ...SITE_AUDIT_EXACT_ALIAS_PATHS.map((pathname) => ({ href: absoluteUrl(config, pathname), type: "application/json", title: `GET $0.001 ${SITE_AUDIT_EXACT_ALIAS_METADATA[pathname].name.replaceAll("_", " ")}` })),
    { href: absoluteUrl(config, "/api/listing-score"), type: "application/json", title: "POST $0.005 paid API listing quality score" },
    { href: absoluteUrl(config, DISCOVERY_AUDIT_PATH), type: "application/json", title: "GET $0.001 and POST $0.01 x402 discovery audit" },
    { href: absoluteUrl(config, API_ENTRY_PATH), type: "application/json", title: "GET $0.001 generic x402 navigation route map" },
    { href: absoluteUrl(config, API_V1_ENTRY_PATH), type: "application/json", title: "GET $0.001 versioned x402 navigation route map" },
    { href: absoluteUrl(config, V1_ENTRY_PATH), type: "application/json", title: "GET $0.001 short versioned x402 navigation route map" },
    { href: absoluteUrl(config, PAY_NOW_PATH), type: "application/json", title: "GET free intent-aware pay-now handoff for the selected paid route" },
    { href: absoluteUrl(config, COMMANDS_PATH), type: "application/json", title: "GET free compact command-first pay handoff" },
    { href: absoluteUrl(config, PAID_USAGE_PROOF_PATH), type: "application/json", title: "GET free wallet-backed paid-use proof" },
    { href: absoluteUrl(config, PRICING_PATH), type: "application/json", title: "GET free paid route pricing catalog" },
    { href: absoluteUrl(config, FIND_PATH), type: "application/json", title: "GET free task-to-paid-route finder" },
    { href: absoluteUrl(config, ROUTE_PATH), type: "application/json", title: "GET/POST free local paid-route router" },
    { href: absoluteUrl(config, LOCAL_DISCOVERY_RESOURCE_PATHS[0]), type: "application/json", title: "GET free local x402 discovery resources" },
    { href: absoluteUrl(config, LOCAL_DISCOVERY_SEARCH_PATHS[0]), type: "application/json", title: "GET free local x402 discovery search" },
    { href: absoluteUrl(config, LOCAL_DISCOVERY_MERCHANT_PATHS[0]), type: "application/json", title: "GET free local x402 merchant resources" },
    { href: absoluteUrl(config, "/api/examples"), type: "application/json", title: "GET free examples, commands, payment hints, and sample outputs" },
    { href: absoluteUrl(config, API_SAMPLE_SCORE_PATH), type: "application/json", title: "GET free sample score output" },
    { href: absoluteUrl(config, API_SAMPLE_PATH), type: "application/json", title: "GET free sample score output alias" }
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
          { href: absoluteUrl(config, API_X402_JSON_PATH), type: "application/json", title: "API x402 JSON alias" },
          { href: absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH), type: "application/json", title: "A2A-style agent card" },
          { href: absoluteUrl(config, WELL_KNOWN_AGENT_JSON_PATH), type: "application/json", title: "Agent card alias" },
          { href: absoluteUrl(config, API_AGENT_CARD_PATH), type: "application/json", title: "API agent card alias" },
          { href: absoluteUrl(config, API_AGENT_JSON_PATH), type: "application/json", title: "API agent JSON alias" },
          { href: absoluteUrl(config, WELL_KNOWN_AI_PLUGIN_PATH), type: "application/json", title: "Fallback AI plugin manifest" },
          { href: absoluteUrl(config, WELL_KNOWN_AGENT_TOOLS_PATH), type: "application/json", title: "Agent tools discovery manifest" },
          { href: absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH), type: "application/json", title: "Agent Skills discovery index" },
          { href: absoluteUrl(config, WELL_KNOWN_MCP_JSON_PATH), type: "application/json", title: "MCP metadata" },
          { href: absoluteUrl(config, WELL_KNOWN_MCP_PATH), type: "application/json", title: "MCP discovery alias" },
          { href: absoluteUrl(config, WELL_KNOWN_MCP_SERVER_PATH), type: "application/json", title: "MCP server discovery draft alias" },
          { href: absoluteUrl(config, WELL_KNOWN_MCP_SERVER_JSON_PATH), type: "application/json", title: "MCP server JSON discovery alias" },
          { href: absoluteUrl(config, MCP_ROOT_PATH), type: "application/json", title: "Root MCP discovery alias" },
          { href: absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH), type: "application/json", title: "MCP server card" },
          { href: absoluteUrl(config, LLMS_FULL_PATH), type: "text/markdown", title: "Full agent-readable route guide" },
          { href: absoluteUrl(config, INDEX_MARKDOWN_PATH), type: "text/markdown", title: "Homepage Markdown guide" },
          { href: absoluteUrl(config, PAY_NOW_PATH), type: "application/json", title: "Intent-aware pay-now handoff" },
          { href: absoluteUrl(config, COMMANDS_PATH), type: "application/json", title: "Compact command-first pay handoff" },
          { href: absoluteUrl(config, PRICING_PATH), type: "application/json", title: "Paid route pricing catalog" },
          { href: absoluteUrl(config, FIND_PATH), type: "application/json", title: "Task-to-paid-route finder" },
          { href: absoluteUrl(config, ROUTE_PATH), type: "application/json", title: "Local paid-route router" },
          { href: absoluteUrl(config, "/api/cash-register"), type: "application/json", title: "Paid completion and receiver wallet proof" },
          { href: absoluteUrl(config, LOCAL_DISCOVERY_RESOURCE_PATHS[0]), type: "application/json", title: "Local x402 discovery resources" },
          { href: absoluteUrl(config, LOCAL_DISCOVERY_SEARCH_PATHS[0]), type: "application/json", title: "Local x402 discovery search" },
          { href: absoluteUrl(config, LOCAL_DISCOVERY_MERCHANT_PATHS[0]), type: "application/json", title: "Local x402 merchant resources" },
          { href: absoluteUrl(config, "/api/examples"), type: "application/json", title: "Examples and copy-ready commands" },
          { href: absoluteUrl(config, SCHEMA_JSON_PATH), type: "application/json", title: "Root schema JSON alias" },
          { href: absoluteUrl(config, WELL_KNOWN_API_CATALOG_JSON_PATH), type: API_CATALOG_CONTENT_TYPE, title: "API catalog JSON alias" }
        ],
        "payment-handoff": paymentHandoffLinks,
        "command-handoff": commandHandoffLinks,
        "recommended-paid-sequence": recommendedPaidSequence,
        "official-cdp-discovery": [
          {
            href: officialCdpDiscovery.indexedRoute,
            type: "application/json",
            title: "Already-settled Listing Roast route to use first",
            noSpend: officialCdpDiscovery.noSpend,
            recommendedSearchQuery: officialCdpDiscovery.recommendedSearchQuery,
            indexedRouteReason: officialCdpDiscovery.indexedRouteReason,
            refreshRule: officialCdpDiscovery.refreshRule
          },
          {
            href: officialCdpDiscovery.recommendedSearchUrl,
            type: "application/json",
            title: "Official CDP Bazaar search for Listing Roast under $0.01",
            noSpend: officialCdpDiscovery.noSpend,
            recommendedSearchQuery: officialCdpDiscovery.recommendedSearchQuery
          },
          {
            href: officialCdpDiscovery.merchantDiscoveryUrl,
            type: "application/json",
            title: "Official CDP Bazaar merchant lookup for receiver wallet",
            noSpend: officialCdpDiscovery.noSpend
          }
        ],
        "paid-use-proof": [
          {
            href: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
            type: "application/json",
            title: paidUsageProof.proofText,
            paidCompletions: paidUsageProof.paidCompletions,
            estimatedGrossRevenueUsd: paidUsageProof.estimatedGrossRevenueUsd,
            lastPaidAt: paidUsageProof.lastPaidAt,
            preferredConvertedRoute: paidUsageProof.preferredConvertedRoute,
            cashRegister: paidUsageProof.cashRegister
          }
        ],
        status: [
          { href: absoluteUrl(config, "/health"), type: "application/json", title: "Service health" },
          { href: absoluteUrl(config, "/api/cash-register"), type: "application/json", title: `Paid completion and receiver wallet proof: ${paidUsageProof.proofText}` }
        ]
      }
    ]
  };
}

function formatIndexedQuickScoreAgentPaymentPrompt(config) {
  return `Call this x402 endpoint with GET and pay up to ${priceToUsd(config.instantScorePrice)} USDC: ${absoluteUrl(config, ROAST_PATH)}`;
}

function buildAgentMarkdownGuide(config, cashRegister = {}) {
  return `# Listing Roast x402

Listing Roast x402 is a paid HTTP JSON API for builders, AgentCore Gateway flows, and x402 marketplace buyers who need a quick read on why buyer agents skip a paid API or x402 marketplace listing.

Preferred first paid route: GET ${absoluteUrl(config, ROAST_PATH)} (${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT} USDC units). Use this already-indexed quick score before generic /api, /api/v1, or /v1 entrypoints.

Agent payment prompt: ${formatIndexedQuickScoreAgentPaymentPrompt(config)}

Quick-score aliases: GET ${formatQuickScoreAliasUrls(config)}. These aliases cost ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT} USDC units, and return the same quick score for marketplace listing score, marketplace listing conversion API, marketplace listing conversion, paid API listing quality, paid API listing quality score, AgentCore x402 payments, Coinbase x402 Bazaar MCP server buyer flows, x402 marketplace conversion, agent listing conversion score, x402 listing quality, buyer-agent skip reasons, and agent service clarity searches.

## Paid-Use Proof Before Payment

${formatPaidUseProofMarkdown(config, cashRegister)}

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
- Compact command handoff: ${absoluteUrl(config, COMMANDS_PATH)}?intent=paid%20API%20listing%20quality
- Pay-now handoff: ${absoluteUrl(config, PAY_NOW_PATH)}?intent=buyer-agent%20skip%20reasons
- Paid-use proof: ${absoluteUrl(config, PAID_USAGE_PROOF_PATH)}
- AgentCore x402 payments page: ${absoluteUrl(config, AGENTCORE_X402_PAYMENTS_PAGE_PATH)}
- Coinbase x402 Bazaar MCP server page: ${absoluteUrl(config, COINBASE_X402_BAZAAR_MCP_SERVER_PAGE_PATH)}
- Pricing catalog: ${absoluteUrl(config, PRICING_PATH)}
- Route finder: ${absoluteUrl(config, FIND_PATH)}?q=x402%20discovery%20audit
- Cash register: ${absoluteUrl(config, "/api/cash-register")}

${formatOfficialCdpDiscoveryMarkdown(config)}

## Payment Rule

Do not call paid routes unless the buyer explicitly intends to pay USDC through x402. All free discovery routes above are safe to fetch without payment.

## Bazaar Cataloging Note

${formatBazaarCatalogingMarkdown(config)}

## Preferred First Paid Route

- Method: GET
- URL: ${absoluteUrl(config, ROAST_PATH)}
- Price: ${config.instantScorePrice}
- Max amount: ${INSTANT_SCORE_AMOUNT} USDC units
- Agent payment prompt: ${formatIndexedQuickScoreAgentPaymentPrompt(config)}
- Best for: paid API listing quality, marketplace listing quality, x402 marketplace conversion, agent listing conversion score, x402 listing quality, agent service listing clarity, and buyer-agent skip reasons.
- Exact buyer-phrase aliases: GET ${formatQuickScoreAliasUrls(config)}

\`\`\`bash
${buildGetPayCommand(config, ROAST_PATH)}
\`\`\`

## Recommended Paid Sequence

1. Start with GET ${absoluteUrl(config, ROAST_PATH)} for ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT} USDC units. This is the already-indexed quick score route and the lowest-friction paid test for x402 marketplace conversion and agent listing conversion score buyers.
2. Upgrade to GET ${absoluteUrl(config, FULL_ROAST_GET_PATH)} for ${config.price}, max 10000 USDC units only when the quick score is promising and the buyer wants the full rewrite, top fixes, and stop-or-upgrade guidance.

Full roast command:

\`\`\`bash
${buildGetPayCommand(config, FULL_ROAST_GET_PATH, "10000")}
\`\`\`

## Other Paid Routes

- GET ${absoluteUrl(config, API_ENTRY_PATH)} for a generic paid x402 navigation route map with fallback quick score when an agent starts at /api first. Price: ${config.instantScorePrice}. Max amount: ${INSTANT_SCORE_AMOUNT}.
- GET ${absoluteUrl(config, API_V1_ENTRY_PATH)} for a versioned paid x402 navigation route map with fallback quick score when an agent starts at /api/v1 first. Price: ${config.instantScorePrice}. Max amount: ${INSTANT_SCORE_AMOUNT}.
- GET ${absoluteUrl(config, V1_ENTRY_PATH)} for a short versioned paid x402 navigation route map with fallback quick score when an agent starts at /v1 first. Price: ${config.instantScorePrice}. Max amount: ${INSTANT_SCORE_AMOUNT}.
- GET ${absoluteUrl(config, AGENT_LISTING_SCORE_PATH)} after the indexed quick score for the exact agent-listing conversion score deep dive. Price: ${config.instantScorePrice}. Max amount: ${INSTANT_SCORE_AMOUNT}. Canonical route: ${absoluteUrl(config, AGENT_LISTING_PATH)}.
- GET ${absoluteUrl(config, CONVERSION_SCORE_PATH)} for x402 marketplace conversion score. Price: ${config.instantScorePrice}. Max amount: ${INSTANT_SCORE_AMOUNT}.
- GET ${absoluteUrl(config, SITE_AUDIT_PATH)} for x402 route health, direct 402 metadata, stale price checks, and search visibility. Price: ${config.siteAuditPrice}. Max amount: ${SITE_AUDIT_AMOUNT}.
- GET ${formatPreflightAliasUrls(config)} for common paid API preflight aliases that return the same x402 site-audit output. Price: ${config.siteAuditPrice}. Max amount: ${SITE_AUDIT_AMOUNT}.
- GET ${absoluteUrl(config, DISCOVERY_AUDIT_PATH)} for the exact-path quick x402 discovery audit. Price: ${config.siteAuditPrice}. Max amount: ${DISCOVERY_AUDIT_QUICK_AMOUNT}.
- POST ${absoluteUrl(config, "/api/listing-score")} for a custom-body listing score. Price: ${config.scorePrice}. Max amount: 5000.
- GET ${absoluteUrl(config, FULL_ROAST_GET_PATH)} for the direct full listing roast, rewrite, top fixes, and stop-or-upgrade guidance without assembling a POST body. Price: ${config.price}. Max amount: 10000.
- POST ${absoluteUrl(config, DISCOVERY_AUDIT_PATH)} for a custom-body x402 discovery audit. Price: ${config.discoveryAuditPrice}. Max amount: ${DISCOVERY_AUDIT_AMOUNT}.
- POST ${absoluteUrl(config, ROAST_PATH)} for a custom-body full listing roast; omitted bodies use safe defaults for stale directory cards. Price: ${config.price}. Max amount: 10000.

## Keywords

${DISCOVERY_KEYWORDS.join(", ")}
`;
}

function buildAgentsMarkdown(config, cashRegister = {}) {
  return `# AGENTS.md

Listing Roast x402 is a paid API for agents, AgentCore Gateway buyers, and builders who need a quick x402 listing-quality score, x402 marketplace conversion read, agent listing conversion score, buyer-agent skip-reason check, or service-discovery audit.

## Safety

- Free discovery routes may be fetched without payment.
- Do not call paid routes unless the buyer explicitly intends to pay USDC through x402.
- No OAuth, account registration, API key, agent registration, ACP, UCP, or MPP endpoint is supported.
- Use the HTTP 402 challenge and x402 payment header flow for paid routes.

## Bazaar Cataloging Note

${formatBazaarCatalogingMarkdown(config)}

${formatOfficialCdpDiscoveryMarkdown(config)}

## Paid-Use Proof Before Payment

${formatPaidUseProofMarkdown(config, cashRegister)}

## Best First Paid Route

- Method: GET
- URL: ${absoluteUrl(config, ROAST_PATH)}
- Price: ${config.instantScorePrice}
- Max amount: ${INSTANT_SCORE_AMOUNT} USDC units
- Agent payment prompt: ${formatIndexedQuickScoreAgentPaymentPrompt(config)}
- Use it for the fastest paid score from the already-indexed listing-roast URL when the buyer asks for paid API listing quality, AgentCore x402 payments readiness, x402 marketplace conversion, or agent listing conversion score.
- Exact buyer-phrase aliases: GET ${formatQuickScoreAliasUrls(config)}.

\`\`\`bash
${buildGetPayCommand(config, ROAST_PATH)}
\`\`\`

## Recommended Paid Sequence

1. Start with GET ${absoluteUrl(config, ROAST_PATH)} for ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT} USDC units. This is the already-indexed quick score route and the lowest-friction paid test.
2. Upgrade to GET ${absoluteUrl(config, FULL_ROAST_GET_PATH)} for ${config.price}, max 10000 USDC units only when the quick score is promising and the buyer wants the full rewrite, top fixes, and stop-or-upgrade guidance.

Full roast command:

\`\`\`bash
${buildGetPayCommand(config, FULL_ROAST_GET_PATH, "10000")}
\`\`\`

## Generic Paid Entry Points

- GET ${absoluteUrl(config, API_ENTRY_PATH)} for agents that start at /api first.
- GET ${absoluteUrl(config, API_V1_ENTRY_PATH)} for agents that start at /api/v1 first.
- GET ${absoluteUrl(config, V1_ENTRY_PATH)} for agents that start at /v1 first.

Each generic entrypoint costs ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT} USDC units, and returns the paid route map after x402 payment.

## Quick-Score Buyer Phrase Aliases

- GET ${formatQuickScoreAliasUrls(config)} are direct aliases for marketplace listing score, marketplace listing conversion API, marketplace listing conversion, paid API listing quality, paid API listing quality score, AgentCore x402 payments, Coinbase x402 Bazaar MCP server buyer flows, x402 marketplace conversion, agent listing conversion score, x402 listing quality, buyer-agent skip reasons, and agent service clarity searches.
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
- Paid-use proof: ${absoluteUrl(config, PAID_USAGE_PROOF_PATH)}
- Cash register: ${absoluteUrl(config, "/api/cash-register")}

## Other Paid Routes

- GET ${absoluteUrl(config, INSTANT_SCORE_PATH)} for an instant listing score.
- GET ${absoluteUrl(config, AGENT_LISTING_SCORE_PATH)} for exact agent listing conversion score and buyer-agent skip reasons. Canonical route: ${absoluteUrl(config, AGENT_LISTING_PATH)}.
- GET ${absoluteUrl(config, CONVERSION_SCORE_PATH)} for x402 marketplace conversion.
- GET ${absoluteUrl(config, SITE_AUDIT_PATH)} for a no-spend x402 site audit.
  - Paid API preflight aliases: GET ${formatPreflightAliasUrls(config)}.
- GET ${absoluteUrl(config, DISCOVERY_AUDIT_PATH)} for the exact-path quick x402 discovery audit.
- GET ${absoluteUrl(config, PING_PATH)} for a paid x402 rail ping.
- POST ${absoluteUrl(config, "/api/listing-score")} for a custom-body listing score.
- GET ${absoluteUrl(config, FULL_ROAST_GET_PATH)} for the direct full listing roast.
- POST ${absoluteUrl(config, DISCOVERY_AUDIT_PATH)} for a custom-body x402 discovery audit.
- POST ${absoluteUrl(config, ROAST_PATH)} for a custom-body full listing roast; omitted bodies use safe defaults for stale directory cards.
`;
}

function buildRobotsTxt(config) {
  const sitemapUrl = absoluteUrl(config, "/sitemap.xml");
  const officialCdpDiscovery = buildOfficialCdpDiscoveryHandoff(config);

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
# - ${absoluteUrl(config, PAID_API_LISTING_QUALITY_SCORE_PATH)}
# - ${absoluteUrl(config, X402_LISTING_QUALITY_PAGE_PATH)}
# - ${absoluteUrl(config, BUYER_AGENT_SKIP_REASONS_PAGE_PATH)}
# - ${absoluteUrl(config, AGENT_SERVICE_CLARITY_PAGE_PATH)}
# - ${absoluteUrl(config, AGENT_LISTING_CONVERSION_PAGE_PATH)}
# - ${absoluteUrl(config, X402_DISCOVERY_AUDIT_PAGE_PATH)}
# - ${absoluteUrl(config, X402_SITE_AUDIT_PAGE_PATH)}
# - ${absoluteUrl(config, X402_BUYER_PREPAY_RISK_SCORE_PAGE_PATH)}
# - ${absoluteUrl(config, SCORE_X402_ENDPOINT_BEFORE_PAYING_PAGE_PATH)}
# - ${absoluteUrl(config, X402_ROUTE_HEALTH_CHECK_PAGE_PATH)}
# - ${absoluteUrl(config, X402_LISTING_RANK_DOCTOR_PAGE_PATH)}
# - ${absoluteUrl(config, COINBASE_X402_BAZAAR_MCP_SERVER_PAGE_PATH)}
# - ${absoluteUrl(config, "/llms.txt")}
# - ${absoluteUrl(config, LLMS_FULL_PATH)}
# - ${absoluteUrl(config, "/x402.json")}
# - ${absoluteUrl(config, COMMANDS_PATH)}?intent=paid%20API%20listing%20quality
# - ${absoluteUrl(config, PRICING_PATH)}
# - ${absoluteUrl(config, FIND_PATH)}?q=x402%20discovery%20audit
# - ${absoluteUrl(config, ROUTE_PATH)}?query=x402%20discovery%20audit&top=3
# - ${absoluteUrl(config, WELL_KNOWN_API_CATALOG_PATH)}
# - ${absoluteUrl(config, WELL_KNOWN_AGENT_TOOLS_PATH)}
# - ${absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH)}
# - ${absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH)}
# Official CDP search: ${officialCdpDiscovery.recommendedSearchUrl}
# Official CDP domain-restricted search: ${officialCdpDiscovery.domainRestrictedSearchUrl}
# Official CDP merchant lookup: ${officialCdpDiscovery.merchantDiscoveryUrl}
# Official CDP recommended query: ${officialCdpDiscovery.recommendedSearchQuery}
# Official CDP indexed paid route: ${officialCdpDiscovery.indexedRoute}
# Official CDP refresh rule: ${officialCdpDiscovery.refreshRule}
# Pay-now handoff: ${absoluteUrl(config, PAY_NOW_PATH)}?intent=paid%20API%20listing%20quality%20score
# Agent payment prompt: ${formatIndexedQuickScoreAgentPaymentPrompt(config)}
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
      selectedActionKey: "paidApiListingQuality",
      primaryAction: intentRoutes.paidApiListingQuality,
      primaryLabel: "Use the $0.001 paid API listing quality route",
      supportingAction: intentRoutes.indexedQuickScore,
      supportingLabel: "Use the indexed /api/listing-roast route when a marketplace result points there.",
      keywords: ["paid API listing quality", "marketplace listing quality", "x402 listing quality", "paid API discoverability", "buyer-agent skip reasons"]
    },
    {
      path: PAID_API_LISTING_QUALITY_SCORE_PATH,
      title: "Paid API listing quality score route | Listing Roast x402",
      heading: "Exact paid API listing quality score route for buyer agents",
      summary: "Use this when a buyer agent searches for paid API listing quality score and needs the $0.001 exact-phrase route before deciding whether to buy the full roast.",
      selectedActionKey: "paidApiListingQualityScore",
      primaryAction: intentRoutes.paidApiListingQualityScore,
      primaryLabel: "Use the $0.001 paid API listing quality score route",
      supportingAction: intentRoutes.indexedQuickScore,
      supportingLabel: "Use the indexed /api/listing-roast route first when external marketplace search points there.",
      keywords: ["paid API listing quality score", "paid API listing quality", "marketplace listing score", "paid API discoverability", "buyer-agent skip reasons"]
    },
    {
      path: LISTING_QUALITY_SCORE_API_PAGE_PATH,
      title: "Listing quality score API | Listing Roast x402",
      heading: "Listing quality score API for paid marketplace offers",
      summary: "Use this when a buyer agent searches for listing quality score API and needs the $0.001 exact-phrase route before deciding whether to buy the full roast.",
      selectedActionKey: "listingQualityScoreApi",
      primaryAction: intentRoutes.listingQualityScoreApi,
      primaryLabel: "Use the $0.001 listing quality score API route",
      supportingAction: intentRoutes.indexedQuickScore,
      supportingLabel: "Use the indexed /api/listing-roast route first when external marketplace search points there.",
      keywords: ["listing quality score API", "listing quality score", "marketplace product listing quality", "paid API listing quality score", "buyer-agent skip reasons"]
    },
    {
      path: MARKETPLACE_PRODUCT_LISTING_QUALITY_PAGE_PATH,
      title: "Marketplace product listing quality | Listing Roast x402",
      heading: "Marketplace product listing quality score for paid APIs",
      summary: "Use this when a buyer agent searches for marketplace product listing quality and needs a $0.001 exact-phrase route that scores the offer before a larger paid call.",
      selectedActionKey: "marketplaceProductListingQuality",
      primaryAction: intentRoutes.marketplaceProductListingQuality,
      primaryLabel: "Use the $0.001 marketplace product listing quality route",
      supportingAction: intentRoutes.indexedQuickScore,
      supportingLabel: "Use the indexed /api/listing-roast route first when external marketplace search points there.",
      keywords: ["marketplace product listing quality", "score marketplace product listing quality", "listing quality score API", "marketplace listing quality", "paid API listing quality score"]
    },
    {
      path: MARKETPLACE_LISTING_CONVERSION_API_PAGE_PATH,
      title: "Marketplace listing conversion API | Listing Roast x402",
      heading: "Marketplace listing conversion API score for paid APIs",
      summary: "Use this exact landing page when a buyer agent searches for marketplace listing conversion API and needs a no-spend handoff to the $0.001 /api/marketplace-listing-conversion-api paid route.",
      selectedActionKey: "marketplaceListingConversion",
      primaryAction: intentRoutes.marketplaceListingConversion,
      primaryLabel: "Use the $0.001 marketplace listing conversion API route",
      supportingAction: intentRoutes.indexedQuickScore,
      supportingLabel: "Use the indexed /api/listing-roast route first when external marketplace search points there.",
      keywords: ["marketplace listing conversion API", "marketplace-listing-conversion-api", "marketplace listing conversion", "marketplace conversion score", "x402 marketplace conversion", "paid API listing quality"]
    },
    {
      path: MARKETPLACE_LISTING_CONVERSION_PAGE_PATH,
      title: "Marketplace listing conversion API score | Listing Roast x402",
      heading: "Marketplace listing conversion API score for paid APIs",
      summary: "Use this when a buyer agent searches for marketplace listing conversion API, marketplace listing conversion, marketplace conversion score, or x402 marketplace conversion and needs a $0.001 exact-phrase route before a larger paid call.",
      selectedActionKey: "marketplaceListingConversion",
      primaryAction: intentRoutes.marketplaceListingConversion,
      primaryLabel: "Use the $0.001 marketplace listing conversion API route",
      supportingAction: intentRoutes.indexedQuickScore,
      supportingLabel: "Use the indexed /api/listing-roast route first when external marketplace search points there.",
      keywords: ["marketplace listing conversion API", "marketplace listing conversion", "marketplace conversion score", "x402 marketplace conversion", "paid API listing quality", "agent listing conversion score"]
    },
    {
      path: X402_LISTING_QUALITY_PAGE_PATH,
      title: "x402 listing quality score | Listing Roast x402",
      heading: "x402 listing quality score for paid APIs",
      summary: "Use this when a buyer agent searches for x402 listing quality and needs a $0.001 exact-phrase route that scores the offer before a larger paid call.",
      selectedActionKey: "x402ListingQuality",
      primaryAction: intentRoutes.x402ListingQuality,
      primaryLabel: "Use the $0.001 x402 listing quality route",
      supportingAction: intentRoutes.indexedQuickScore,
      supportingLabel: "Use the indexed /api/listing-roast route first when external marketplace search points there.",
      keywords: ["x402 listing quality", "x402 listing quality score", "paid API listing quality score", "marketplace listing score", "x402 service discoverability"]
    },
    {
      path: BUYER_AGENT_SKIP_REASONS_PAGE_PATH,
      title: "Buyer-agent skip reasons | Listing Roast x402",
      heading: "Buyer-agent skip reasons for paid API listings",
      summary: "Use this when the buyer asks why agents skip a paid API listing, whether the offer is clear enough to pay for, or what the first conversion fix should be.",
      selectedActionKey: "buyerAgentSkipReasons",
      primaryAction: intentRoutes.buyerAgentSkipReasons,
      primaryLabel: "Use the $0.001 buyer-agent skip reasons route",
      supportingAction: intentRoutes.indexedQuickScore,
      supportingLabel: "Use the indexed /api/listing-roast route when Bazaar already points to Listing Roast.",
      keywords: ["buyer-agent skip reasons", "buyer agent skip reasons", "agent skip reasons", "paid API listing quality", "agent listing conversion"]
    },
    {
      path: AGENT_SERVICE_CLARITY_PAGE_PATH,
      title: "Agent service clarity score | Listing Roast x402",
      heading: "Agent service clarity score for x402 paid APIs",
      summary: "Use this when the buyer wants to know whether an agent service listing names the buyer, output, price, and checkout path clearly enough to justify a paid call.",
      selectedActionKey: "agentServiceClarity",
      primaryAction: intentRoutes.agentServiceClarity,
      primaryLabel: "Use the $0.001 agent service clarity route",
      supportingAction: intentRoutes.agentListingConversion,
      supportingLabel: "Use the agent listing conversion route for the dedicated conversion deep dive.",
      keywords: ["agent service clarity", "agent service listing clarity", "agent-service listing score", "agent listing clarity", "agent service promotion readiness"]
    },
    {
      path: AGENT_LISTING_CONVERSION_PAGE_PATH,
      title: "Agent listing conversion score | Listing Roast x402",
      heading: "Agent listing conversion score and buyer-agent skip reasons",
      summary: "Use this when the buyer wants to know whether agents understand the offer, price, output, and checkout path before paying.",
      selectedActionKey: "agentListingConversion",
      primaryAction: intentRoutes.agentListingConversion,
      primaryLabel: "Use the $0.001 agent listing conversion route",
      supportingAction: intentRoutes.fullRoastGet,
      supportingLabel: "Upgrade to the $0.01 full roast for rewritten listing copy and launch guidance.",
      keywords: ["agent listing conversion", "agent service listing clarity", "buyer-agent skip reasons", "buyer intent", "paid API listing quality"]
    },
    {
      path: X402_DISCOVERY_AUDIT_PAGE_PATH,
      title: "x402 discovery audit | Listing Roast x402",
      heading: "x402 discovery audit for stale Bazaar visibility and Agent402 routing",
      summary: "Use this when a seller needs to compare direct x402 payment metadata with marketplace search visibility, Agent402 route visibility, stale pricing, and route health before promotion.",
      selectedActionKey: "discoveryAuditQuick",
      primaryAction: intentRoutes.discoveryAuditQuick,
      primaryLabel: "Start with the $0.001 GET discovery audit",
      supportingAction: intentRoutes.discoveryAudit,
      supportingLabel: "Use the $0.01 POST discovery audit when a custom endpoint body is needed.",
      keywords: ["x402 discovery audit", "x402 bazaar discovery audit", "Agent402 route visibility", "Agent402 router", "bazaar search visibility", "x402 listing stale price", "x402 route health check"]
    },
    {
      path: X402_SITE_AUDIT_PAGE_PATH,
      title: "x402 site audit | Listing Roast x402",
      heading: "x402 site audit and paid API preflight",
      summary: "Use this when a buyer wants a quick paid API preflight before paying more: route-health, OpenAPI, llms.txt, pricing, and Bazaar visibility without assembling a request body. Direct aliases: /api/preflight, /api/v1/preflight, and /preflight.",
      selectedActionKey: "x402SiteAudit",
      primaryAction: intentRoutes.x402SiteAudit,
      primaryLabel: "Use the $0.001 GET site audit",
      supportingAction: intentRoutes.discoveryAudit,
      supportingLabel: "Use the $0.01 POST discovery audit for a custom-body report.",
      keywords: ["x402 site audit", "x402 buyer prepay risk score", "score x402 endpoint before paying", "paid API preflight", "x402 route health check", "x402 service discoverability audit", "x402 listing SEO audit"]
    },
    {
      path: X402_BUYER_PREPAY_RISK_SCORE_PAGE_PATH,
      title: "x402 buyer prepay risk score | Listing Roast x402",
      heading: "x402 buyer prepay risk score before paying more",
      summary: "Use this when a buyer agent wants a cheap risk and usefulness check before spending more on an x402 endpoint.",
      selectedActionKey: "x402BuyerPrepayRiskScore",
      primaryAction: intentRoutes.x402BuyerPrepayRiskScore,
      primaryLabel: "Use the exact $0.001 buyer prepay risk route",
      supportingAction: intentRoutes.discoveryAudit,
      supportingLabel: "Use the $0.01 POST discovery audit when a custom endpoint body is needed.",
      keywords: ["x402 buyer prepay risk score", "buyer prepay risk score", "prepay risk score", "score x402 endpoint before paying", "paid API preflight", "x402 route health check"]
    },
    {
      path: SCORE_X402_ENDPOINT_BEFORE_PAYING_PAGE_PATH,
      title: "Score x402 endpoint before paying | Listing Roast x402",
      heading: "Score an x402 endpoint before paying",
      summary: "Use this when a buyer agent wants a one-tenth-cent preflight check before committing more spend to an x402 route.",
      selectedActionKey: "scoreX402EndpointBeforePaying",
      primaryAction: intentRoutes.scoreX402EndpointBeforePaying,
      primaryLabel: "Use the exact $0.001 endpoint-before-paying route",
      supportingAction: intentRoutes.discoveryAudit,
      supportingLabel: "Use the $0.01 POST discovery audit when a custom endpoint body is needed.",
      keywords: ["score x402 endpoint before paying", "score endpoint before paying", "endpoint before paying", "x402 buyer prepay risk score", "paid API preflight", "x402 site audit"]
    },
    {
      path: X402_ROUTE_HEALTH_CHECK_PAGE_PATH,
      title: "x402 route health check | Listing Roast x402",
      heading: "x402 route health check before paying more",
      summary: "Use this when a buyer or seller needs direct 402 metadata, price, route health, and agent-readable discovery checks before a deeper paid action.",
      selectedActionKey: "x402RouteHealthCheck",
      primaryAction: intentRoutes.x402RouteHealthCheck,
      primaryLabel: "Use the exact $0.001 x402 route health route",
      supportingAction: intentRoutes.discoveryAudit,
      supportingLabel: "Use the $0.01 POST discovery audit when a custom endpoint body is needed.",
      keywords: ["x402 route health check", "route health check", "x402 route health", "payment challenge health", "direct 402 metadata", "paid API preflight"]
    },
    {
      path: X402_LISTING_RANK_DOCTOR_PAGE_PATH,
      title: "x402 listing rank doctor | Listing Roast x402",
      heading: "x402 listing rank doctor for marketplace visibility",
      summary: "Use this when a seller wants a cheap first check for listing rank, marketplace SEO, search visibility, and route health before buying a full discovery audit.",
      selectedActionKey: "x402ListingRankDoctor",
      primaryAction: intentRoutes.x402ListingRankDoctor,
      primaryLabel: "Use the exact $0.001 x402 listing rank doctor route",
      supportingAction: intentRoutes.discoveryAudit,
      supportingLabel: "Use the $0.01 POST discovery audit when a custom endpoint body is needed.",
      keywords: ["x402 listing rank doctor", "listing rank doctor", "x402 listing SEO audit", "x402 marketplace SEO audit", "Bazaar search visibility", "x402 seller growth checklist"]
    },
    {
      path: AGENTCORE_X402_PAYMENTS_PAGE_PATH,
      title: "AgentCore x402 payments route | Listing Roast x402",
      heading: "AgentCore x402 payments route for paid API listing quality",
      summary: "Use this when an AgentCore Gateway, MCP buyer, or Coinbase x402 Bazaar MCP search needs a wallet-confirmed $0.001 paid API listing quality score before a larger paid call.",
      selectedActionKey: "indexedQuickScore",
      primaryAction: intentRoutes.indexedQuickScore,
      primaryLabel: "Use the wallet-confirmed $0.001 indexed Listing Roast route",
      supportingAction: intentRoutes.fullRoastGet,
      supportingLabel: "Upgrade to the $0.01 full roast only after the quick score shows a fit.",
      keywords: ["AgentCore x402 payments", "Amazon Bedrock AgentCore payments", "AgentCore Gateway", "Coinbase x402 Bazaar MCP server", "paid API listing quality score", "x402 paid API discovery"]
    },
    {
      path: COINBASE_X402_BAZAAR_MCP_SERVER_PAGE_PATH,
      title: "Coinbase x402 Bazaar MCP server route | Listing Roast x402",
      heading: "Coinbase x402 Bazaar MCP server route for paid API listing quality",
      summary: "Use this when a buyer agent searches Coinbase x402 Bazaar MCP server, x402 Bazaar MCP server, or Bazaar MCP tools and needs a wallet-confirmed $0.001 paid API listing quality score before a larger paid call.",
      selectedActionKey: "coinbaseX402BazaarMcpServer",
      primaryAction: intentRoutes.coinbaseX402BazaarMcpServer,
      primaryLabel: "Use the $0.001 Coinbase x402 Bazaar MCP server route",
      supportingAction: intentRoutes.indexedQuickScore,
      supportingLabel: "Use the indexed /api/listing-roast route first when marketplace search points there.",
      keywords: ["Coinbase x402 Bazaar MCP server", "x402 Bazaar MCP server", "Bazaar MCP tools", "Coinbase Bazaar MCP", "AgentCore x402 payments", "paid API listing quality score"]
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

function intentForLandingPage(page) {
  return page.keywords?.[0] || "";
}

function relativeIntentUrl(pathname, intent = "") {
  return intent ? `${pathname}?intent=${encodeURIComponent(intent)}` : pathname;
}

function absoluteIntentUrl(config, pathname, intent = "") {
  return intent ? `${absoluteUrl(config, pathname)}?intent=${encodeURIComponent(intent)}` : absoluteUrl(config, pathname);
}

function buildIntentLandingHandoffs(config) {
  const intentRoutes = buildPayNowActions(config);

  return buildIntentLandingPages(config).map((page) => {
    const intent = intentForLandingPage(page);
    const firstPaidAction = firstPaidActionForSelectedIntent(intentRoutes, page.selectedActionKey, page.primaryAction);
    const exactIntentPaidAction = exactIntentPaidActionForSelection(intentRoutes, page.selectedActionKey, page.primaryAction);
    const upgradePaidAction = upgradePaidActionForLandingPage(intentRoutes, page, exactIntentPaidAction);

    return {
      path: page.path,
      url: absoluteUrl(config, page.path),
      title: page.heading,
      summary: page.summary,
      keywords: page.keywords,
      selectedActionKey: page.selectedActionKey,
      payNow: absoluteIntentUrl(config, PAY_NOW_PATH, intent),
      commands: absoluteIntentUrl(config, COMMANDS_PATH, intent),
      firstPaidAction: summarizePaidAction(firstPaidAction),
      primaryPaidAction: summarizePaidAction(firstPaidAction),
      ...(exactIntentPaidAction ? { exactIntentPaidAction: summarizePaidAction(exactIntentPaidAction) } : {}),
      supportingPaidAction: summarizePaidAction(exactIntentPaidAction || page.supportingAction),
      upgradePaidAction: summarizePaidAction(upgradePaidAction),
      buyerInstruction: buildSelectedBuyerInstruction(page.selectedActionKey, page.primaryAction, intentRoutes.indexedQuickScore)
    };
  });
}

function buildIntentLandingPage(config, page) {
  const intentRoutes = buildPayNowActions(config);
  const indexedAction = intentRoutes.indexedQuickScore;
  const intent = intentForLandingPage(page);
  const payNowUrl = relativeIntentUrl(PAY_NOW_PATH, intent);
  const commandsUrl = relativeIntentUrl(COMMANDS_PATH, intent);
  const firstPaidAction = firstPaidActionForSelectedIntent(intentRoutes, page.selectedActionKey, page.primaryAction);
  const exactIntentPaidAction = exactIntentPaidActionForSelection(intentRoutes, page.selectedActionKey, page.primaryAction);
  const upgradePaidAction = upgradePaidActionForLandingPage(intentRoutes, page, exactIntentPaidAction);
  const upgradeLabel = exactIntentPaidAction && upgradePaidAction.path === intentRoutes.fullRoastGet.path && upgradePaidAction.method === intentRoutes.fullRoastGet.method
    ? "Upgrade to the $0.01 full roast for rewritten listing copy and launch guidance."
    : page.supportingLabel;
  const firstPaidLabel = firstPaidAction.path === page.primaryAction.path && firstPaidAction.method === page.primaryAction.method
    ? page.primaryLabel
    : "Start with the proven $0.001 indexed route";

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
  <link rel="alternate" type="application/json" title="Listing Roast compact command handoff" href="${escapeHtml(absoluteUrl(config, COMMANDS_PATH))}" />
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
        <a href="/api/commands">Commands</a>
        <a href="${PAID_USAGE_PROOF_PATH}">Proof</a>
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
        <a class="button" href="${escapeHtml(firstPaidAction.route)}">${escapeHtml(firstPaidLabel)}</a>
        <a class="button secondary" href="${escapeHtml(payNowUrl)}">Open free route handoff</a>
        <a class="button secondary" href="${PAID_USAGE_PROOF_PATH}">Verify paid-use proof</a>
        <a class="button secondary" href="${escapeHtml(commandsUrl)}">Open compact command JSON</a>
      </div>
    </section>
    <section>
      <div class="wrap grid">
        <div class="card">
          <h2>${exactIntentPaidAction ? "Exact intent route" : "Primary paid route"}</h2>
          <p><code>${escapeHtml(page.primaryAction.method)} ${escapeHtml(page.primaryAction.path)}</code></p>
          <p class="muted">Price: ${escapeHtml(page.primaryAction.price)}. Max amount: ${escapeHtml(page.primaryAction.maxAmountRequired)} USDC units. ${escapeHtml(page.primaryAction.reason)}</p>
          <pre>${escapeHtml(page.primaryAction.command)}</pre>
        </div>
        <div class="card">
          <h2>Proven first paid route</h2>
          <p><code>${escapeHtml(indexedAction.method)} ${escapeHtml(indexedAction.path)}</code></p>
          <p class="muted">This is the already-indexed route with confirmed paid use. Check <a href="${PAID_USAGE_PROOF_PATH}">/api/paid-usage-proof</a> before paying.</p>
          <pre>${escapeHtml(indexedAction.command)}</pre>
        </div>
        <div class="card">
          <h2>Upgrade path</h2>
          <p>${escapeHtml(upgradeLabel)}</p>
          <p><code>${escapeHtml(upgradePaidAction.method)} ${escapeHtml(upgradePaidAction.path)}</code></p>
          <p class="muted">Price: ${escapeHtml(upgradePaidAction.price)}. Max amount: ${escapeHtml(upgradePaidAction.maxAmountRequired)} USDC units.</p>
        </div>
        <div class="card">
          <h2>Free discovery before payment</h2>
          <p><a href="/llms.txt">llms.txt</a> gives the short route guide. <a href="/x402.json">x402.json</a> gives machine-readable paid routes. <a href="/api/commands">/api/commands</a> gives the compact command handoff. <a href="/api/examples">/api/examples</a> gives command-ready examples. <a href="${PAID_USAGE_PROOF_PATH}">/api/paid-usage-proof</a> gives wallet-backed paid-use proof.</p>
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
  const jsonRpcEndpoint = absoluteUrl(config, MCP_ROOT_PATH);
  const intentRoutes = buildPayNowActions(config);
  const recommendedPaidSequence = buildRecommendedPaidSequence(intentRoutes);
  const officialCdpDiscovery = buildOfficialCdpDiscoveryHandoff(config);

  return {
    mcp_version: "2025-06-18",
    protocolVersion: "2025-06-18",
    name: config.serviceName,
    description: "Public discovery card for Listing Roast x402 paid HTTP+JSON routes. This card points agents to metadata, OpenAPI, x402 payment hints, and free route guides before any paid call.",
    iconUrl: absoluteUrl(config, ICON_SVG_PATH),
    endpoint: metadataUrl,
    jsonRpcEndpoint,
    transport: "http",
    serverInfo: {
      name: config.serviceName,
      version: DISCOVERY_METADATA_VERSION
    },
    transports: [
      {
        type: "http",
        url: metadataUrl,
        note: "GET returns metadata; POST accepts a small MCP JSON-RPC bridge for no-spend tool handoff, including Bazaar-style search_resources and proxy_tool_call compatibility aliases. Paid callable APIs are HTTP+JSON x402 routes described by OpenAPI and the x402 manifest."
      },
      {
        type: "http",
        url: jsonRpcEndpoint,
        note: "POST JSON-RPC endpoint for initialize, tools/list, tools/call, resources/list, resources/read, prompts/list, and safe no-spend handoffs. Bazaar-style search_resources and proxy_tool_call tool names return route handoffs only."
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
      commands: absoluteUrl(config, COMMANDS_PATH),
      paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
      officialCdpDiscovery,
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
      commands: absoluteUrl(config, COMMANDS_PATH),
      paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
      jsonRpcEndpoint,
      cashRegister: absoluteUrl(config, "/api/cash-register"),
      llms: absoluteUrl(config, LLMS_PATH),
      llmsAliases: [absoluteUrl(config, WELL_KNOWN_LLMS_PATH)],
      llmsFull: absoluteUrl(config, LLMS_FULL_PATH),
      llmsFullAliases: [absoluteUrl(config, WELL_KNOWN_LLMS_FULL_PATH)],
      quickScoreAliases: quickScoreAliasUrls(config),
      preflightAliases: preflightAliasUrls(config),
      markdown: absoluteUrl(config, INDEX_MARKDOWN_PATH)
    },
    officialCdpDiscovery,
    categories: ["x402", "paid-api", "agent-commerce", "api-discovery"],
    crawl: true,
    last_updated: DISCOVERY_METADATA_UPDATED_AT
  };
}

function mcpToolContent(text, structuredContent = {}) {
  return {
    content: [
      {
        type: "text",
        text
      }
    ],
    structuredContent,
    isError: false
  };
}

function buildMcpJsonRpcTools() {
  return [
    {
      name: "search_resources",
      title: "Search Listing Roast x402 resources",
      description: "Bazaar MCP-compatible no-spend search over owned Listing Roast x402 paid resources. Returns matching routes, prices, schemas, commands, and proof links without making a paid call.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Free-text route search, for example paid API listing quality, buyer-agent skip reasons, AgentCore x402 payments, or x402 discovery audit."
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 20,
            description: "Maximum owned resources to return."
          }
        }
      }
    },
    {
      name: "proxy_tool_call",
      title: "Listing Roast x402 paid-route handoff",
      description: "Bazaar MCP-compatible proxy alias that returns the exact Listing Roast x402 route, command, cap, and proof link. It does not execute paid calls or spend funds.",
      inputSchema: {
        type: "object",
        properties: {
          toolName: {
            type: "string",
            description: "Owned Listing Roast resource/tool name or route intent."
          },
          query: {
            type: "string",
            description: "Fallback buyer intent or route search phrase."
          },
          arguments: {
            type: "object",
            additionalProperties: true,
            description: "Optional buyer-provided arguments; these are only echoed into the handoff and never used to make a paid call."
          }
        }
      }
    },
    {
      name: "listing_roast_x402_handoff",
      title: "Listing Roast x402 paid route handoff",
      description: "Map a buyer intent to the safest Listing Roast x402 paid route and return copy-ready payment commands without making a paid call.",
      inputSchema: {
        type: "object",
        properties: {
          intent: {
            type: "string",
            description: "Buyer task or search phrase, for example paid API listing quality, buyer-agent skip reasons, x402 discovery audit, or full listing roast."
          }
        }
      }
    },
    {
      name: "listing_roast_route_search",
      title: "Search Listing Roast paid routes",
      description: "Search owned Listing Roast x402 paid routes and return prices, max amounts, commands, and proof links without spending.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Route search query."
          }
        }
      }
    },
    {
      name: "listing_roast_paid_usage_proof",
      title: "Listing Roast paid-use proof",
      description: "Return wallet-backed paid-use proof, receiver wallet snapshot, and preferred first paid action before any payment.",
      inputSchema: {
        type: "object",
        properties: {}
      }
    }
  ];
}

function buildMcpInitializeResult(config) {
  return {
    protocolVersion: "2025-06-18",
    capabilities: {
      tools: {},
      resources: {}
    },
    serverInfo: {
      name: config.serviceName,
      version: DISCOVERY_METADATA_VERSION
    },
    instructions: "Use tools/list, then tools/call for no-spend route handoffs. Bazaar-style search_resources and proxy_tool_call names are supported as compatibility aliases. Paid execution happens only through explicit x402 HTTP calls returned by the tools."
  };
}

function buildMcpJsonRpcResources(config) {
  return [
    {
      uri: "listing-roast://x402-manifest",
      name: "Listing Roast x402 manifest",
      title: "Listing Roast x402 paid route manifest",
      description: "Machine-readable paid routes, prices, commands, aliases, and wallet-backed proof hints.",
      mimeType: "application/json"
    },
    {
      uri: "listing-roast://paid-usage-proof",
      name: "Listing Roast paid-use proof",
      title: "Wallet-backed paid-use proof",
      description: "Public paid completion counters, latest wallet settlement evidence, and receiver wallet snapshot.",
      mimeType: "application/json"
    },
    {
      uri: "listing-roast://commands",
      name: "Listing Roast payment commands",
      title: "Copy-ready x402 payment commands",
      description: "No-spend command handoff for the preferred indexed route and intent-specific paid routes.",
      mimeType: "application/json"
    },
    {
      uri: "listing-roast://route-search",
      name: "Listing Roast route search",
      title: "Owned paid route search",
      description: "Default owned-route search for paid API listing quality and buyer-agent skip reasons.",
      mimeType: "application/json"
    }
  ];
}

function mcpResourceText(uri, value) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function buildMcpResourceReadResult(config, cashRegister, uri = "") {
  if (uri === "listing-roast://x402-manifest") {
    return mcpResourceText(uri, buildX402Manifest(config, cashRegister));
  }

  if (uri === "listing-roast://paid-usage-proof") {
    return mcpResourceText(uri, {
      paidUsageProof: buildPaidUsageProof(config, cashRegister),
      settlementProof: buildSettlementProof(config, cashRegister),
      cashRegister: absoluteUrl(config, "/api/cash-register")
    });
  }

  if (uri === "listing-roast://commands") {
    return mcpResourceText(uri, buildCommandHandoff(config, "paid API listing quality", cashRegister));
  }

  if (uri === "listing-roast://route-search") {
    return mcpResourceText(uri, buildFindResult(config, "paid API listing quality", cashRegister));
  }

  return mcpResourceText(uri || "listing-roast://unknown", {
    error: "unknown_resource",
    availableResources: buildMcpJsonRpcResources(config).map((resource) => resource.uri),
    noSpend: true
  });
}

function buildMcpToolCallResult(config, cashRegister, name, args = {}) {
  if (name === "search_resources") {
    const query = String(args.query || args.q || args.intent || "").slice(0, 240);
    const search = buildLocalDiscoverySearch(config, {
      query,
      limit: args.limit || 10,
      maxUsdPrice: args.maxUsdPrice,
      network: args.network,
      payTo: args.payTo
    }, cashRegister);
    const first = search.resources[0];
    const selected = search.selectedFirstPaidAction || search.selectedPaidAction || search.preferredFirstPaidAction;
    const text = [
      `Found ${search.resources.length} owned Listing Roast x402 resources for "${query || "default"}".`,
      first ? `Top match: ${first.resource || first.metadata?.path || selected?.path || ROAST_PATH}.` : `Top match: ${selected?.method || "GET"} ${selected?.path || ROAST_PATH}.`,
      `Suggested first paid route: ${selected?.method || "GET"} ${selected?.path || ROAST_PATH} at ${selected?.price || config.instantScorePrice}.`,
      `Proof before payment: ${absoluteUrl(config, PAID_USAGE_PROOF_PATH)}`
    ].join("\n");

    return mcpToolContent(text, {
      noSpend: true,
      compatibility: "coinbase-bazaar-mcp-search_resources",
      query,
      selectedActionKey: search.selectedActionKey,
      resources: search.resources,
      selectedFirstPaidAction: selected,
      selectedPaidAction: search.selectedPaidAction,
      selectedPaidSequence: search.selectedPaidSequence,
      paidUsageProof: search.paidUsageProof,
      links: search.links,
      paymentRule: "This compatibility tool only returns owned Listing Roast route metadata. It does not call proxy_tool_call against CDP and does not spend funds."
    });
  }

  if (name === "proxy_tool_call") {
    const toolName = String(args.toolName || args.name || args.resource || args.path || "").slice(0, 240);
    const nestedArguments = args.arguments && typeof args.arguments === "object" ? args.arguments : {};
    const query = String(args.query || args.intent || nestedArguments.query || nestedArguments.intent || toolName || "paid API listing quality").slice(0, 240);
    const result = buildFindResult(config, query, cashRegister);
    const selected = result.selectedFirstPaidAction || result.recommendedPaidRoute || result.preferredFirstPaidAction;
    const text = [
      `Resolved Listing Roast tool "${toolName || query}" to ${selected?.method || "GET"} ${selected?.path || ROAST_PATH}.`,
      `Price: ${selected?.price || config.instantScorePrice}; max amount: ${selected?.maxAmountRequired || INSTANT_SCORE_AMOUNT} USDC units.`,
      `Command: ${selected?.command || result.command || buildGetPayCommand(config, ROAST_PATH)}`,
      `Proof before payment: ${absoluteUrl(config, PAID_USAGE_PROOF_PATH)}`,
      "No paid request was executed by this MCP tool."
    ].join("\n");

    return mcpToolContent(text, {
      noSpend: true,
      compatibility: "coinbase-bazaar-mcp-proxy_tool_call-handoff-only",
      toolName: toolName || null,
      argumentsPreview: nestedArguments,
      selectedActionKey: result.selectedActionKey,
      selectedFirstPaidAction: selected,
      selectedPaidAction: result.selectedPaidAction,
      exactIntentPaidAction: result.exactIntentPaidAction,
      selectedPaidSequence: result.selectedPaidSequence,
      paidUsageProof: result.paidUsageProof,
      paymentRule: "This Listing Roast compatibility alias returns a command handoff only. A buyer must make a separate explicit x402 HTTP call to spend USDC."
    });
  }

  if (name === "listing_roast_x402_handoff") {
    const intent = String(args.intent || args.query || "").slice(0, 240);
    const handoff = buildPayNow(config, intent, cashRegister);
    const selected = handoff.selectedFirstPaidAction || handoff.selectedPaidAction || handoff.preferredFirstPaidAction;
    const text = [
      `Selected ${selected?.method || "GET"} ${selected?.path || ROAST_PATH} at ${selected?.price || config.instantScorePrice}.`,
      `Max amount: ${selected?.maxAmountRequired || INSTANT_SCORE_AMOUNT} USDC units.`,
      `Command: ${selected?.command || buildGetPayCommand(config, ROAST_PATH)}`,
      `Proof before payment: ${absoluteUrl(config, PAID_USAGE_PROOF_PATH)}`
    ].join("\n");

    return mcpToolContent(text, {
      noSpend: true,
      intent: intent || null,
      selectedActionKey: handoff.selectedActionKey,
      selectedFirstPaidAction: selected,
      selectedPaidAction: handoff.selectedPaidAction,
      exactIntentPaidAction: handoff.exactIntentPaidAction,
      selectedPaidSequence: handoff.selectedPaidSequence,
      paidUsageProof: handoff.paidUsageProof,
      links: handoff.links,
      paymentRule: "Do not run the returned command unless the buyer explicitly intends to pay USDC through x402."
    });
  }

  if (name === "listing_roast_route_search") {
    const query = String(args.query || args.intent || args.q || "").slice(0, 240);
    const result = buildFindResult(config, query, cashRegister);
    const selected = result.selectedFirstPaidAction || result.recommendedPaidRoute || result.preferredFirstPaidAction;
    const text = [
      `Best route for "${query || "default"}": ${selected?.method || result.recommended?.method || "GET"} ${selected?.path || result.recommended?.path || ROAST_PATH}.`,
      `Price: ${selected?.price || result.recommended?.price || config.instantScorePrice}; max amount: ${selected?.maxAmountRequired || result.recommended?.maxAmountRequired || INSTANT_SCORE_AMOUNT} USDC units.`,
      `Command: ${result.command || selected?.command || buildGetPayCommand(config, ROAST_PATH)}`,
      `Proof before payment: ${absoluteUrl(config, PAID_USAGE_PROOF_PATH)}`
    ].join("\n");

    return mcpToolContent(text, {
      noSpend: true,
      query,
      selectedActionKey: result.selectedActionKey,
      result,
      paymentRule: result.paymentRule
    });
  }

  if (name === "listing_roast_paid_usage_proof") {
    const proof = buildPaidUsageProof(config, cashRegister);
    const text = `${proof.proofText}. Preferred first paid route: ${proof.preferredConvertedRoute.method} ${proof.preferredConvertedRoute.path} at ${proof.preferredConvertedRoute.price}.`;

    return mcpToolContent(text, {
      noSpend: true,
      paidUsageProof: proof,
      settlementProof: buildSettlementProof(config, cashRegister),
      cashRegister: absoluteUrl(config, "/api/cash-register")
    });
  }

  return {
    content: [
      {
        type: "text",
        text: `Unknown Listing Roast MCP tool: ${name || "(missing name)"}`
      }
    ],
    structuredContent: {
      noSpend: true,
      availableTools: buildMcpJsonRpcTools().map((tool) => tool.name)
    },
    isError: true
  };
}

function mcpJsonRpcResponse(id, result) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    result
  };
}

function mcpJsonRpcError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message
    }
  };
}

function buildMcpJsonRpcResponse(config, cashRegister, payload = {}) {
  const { id = null, method, params = {} } = payload || {};

  if (!id && String(method || "").startsWith("notifications/")) {
    return null;
  }

  if (method === "initialize") {
    return mcpJsonRpcResponse(id, buildMcpInitializeResult(config));
  }

  if (method === "ping") {
    return mcpJsonRpcResponse(id, {});
  }

  if (method === "tools/list") {
    return mcpJsonRpcResponse(id, { tools: buildMcpJsonRpcTools() });
  }

  if (method === "tools/call") {
    return mcpJsonRpcResponse(id, buildMcpToolCallResult(config, cashRegister, params.name, params.arguments || {}));
  }

  if (method === "resources/list") {
    return mcpJsonRpcResponse(id, { resources: buildMcpJsonRpcResources(config) });
  }

  if (method === "resources/read") {
    return mcpJsonRpcResponse(id, buildMcpResourceReadResult(config, cashRegister, params.uri));
  }

  if (method === "prompts/list") {
    return mcpJsonRpcResponse(id, { prompts: [] });
  }

  return mcpJsonRpcError(id, -32601, `Unsupported MCP method: ${method || "(missing method)"}`);
}

function routeServiceMetadata(routeKey) {
  return {
    serviceName: ROUTE_SERVICE_NAMES[routeKey] || X402_SERVICE_NAME,
    tags: routeTags(routeKey)
  };
}

function challengeRouteServiceMetadata(routeKey) {
  return {
    serviceName: ROUTE_SERVICE_NAMES[routeKey] || X402_SERVICE_NAME,
    tags: CHALLENGE_ROUTE_SERVICE_TAGS[routeKey] || routeTags(routeKey).slice(0, 8)
  };
}

function paymentRouteMetadataKey(intentRouteKey, selected) {
  const method = String(selected?.method || "GET").toUpperCase();
  const pathname = selected?.path || "";

  if (method === "GET" && [ROAST_PATH, ...QUICK_SCORE_ALIAS_PATHS].includes(pathname)) {
    return "indexedQuickScore";
  }

  if (method === "GET" && pathname === FULL_ROAST_GET_PATH) {
    return "fullRoast";
  }

  if (method === "GET" && SITE_AUDIT_PAID_PATHS.includes(pathname)) {
    return "x402SiteAudit";
  }

  if (method === "GET" && DISCOVERY_AUDIT_QUICK_PATHS.includes(pathname)) {
    return "discoveryAuditQuick";
  }

  return intentRouteKey;
}

function usdcAssetForNetwork(network) {
  if (network === BASE_MAINNET_NETWORK) {
    return BASE_USDC_CONTRACT;
  }

  if (network === "eip155:84532") {
    return BASE_SEPOLIA_USDC_CONTRACT;
  }

  return "USDC";
}

function usdcPaymentExtra(network, resource) {
  return {
    name: network === BASE_MAINNET_NETWORK ? "USD Coin" : "USDC",
    version: "2",
    resource
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
  const acceptsForRoute = (routePath, price) => ({
    scheme: "exact",
    price,
    network: config.network,
    payTo: config.payTo,
    maxTimeoutSeconds: 300,
    extra: usdcPaymentExtra(config.network, resourceUrl(routePath))
  });
  const buildSiteAuditPaymentRoute = (routePath) => {
    const intentRouteKey = siteAuditIntentRouteKeyForPath(routePath);
    const description = withPaidUseProofDescription(config, siteAuditDescriptionForPath(routePath));

    return {
      resource: resourceUrl(routePath),
      ...challengeRouteServiceMetadata("x402SiteAudit"),
      accepts: acceptsForRoute(routePath, config.siteAuditPrice),
      description,
      mimeType: "application/json",
      customPaywallHtml: buildCustomPaywallHtml(config, intentRouteKey),
      unpaidResponseBody: unpaidPaymentPreview(config, intentRouteKey, {
        path: routePath,
        method: "GET",
        price: config.siteAuditPrice,
        maxAmountRequired: SITE_AUDIT_AMOUNT,
        resourceDescription: description
      }),
      extensions: declareChallengeDiscoveryExtension(buildSiteAuditDiscovery(config, { routePath }))
    };
  };
  const buildDiscoveryAuditQuickPaymentRoute = (routePath) => {
    const isAgent402Alias = routePath === AGENT402_ROUTE_VISIBILITY_PATH;
    const intentRouteKey = isAgent402Alias ? "agent402RouteVisibility" : "discoveryAuditQuick";
    return {
      resource: resourceUrl(routePath),
      ...challengeRouteServiceMetadata("discoveryAuditQuick"),
      accepts: acceptsForRoute(routePath, config.siteAuditPrice),
      description: withPaidUseProofDescription(config, isAgent402Alias
        ? "Listing Roast Agent402 Route Visibility Audit: $0.001 GET exact Agent402 route visibility check for Agent402 router ranking, stale Bazaar pricing, search visibility, route health, paid API preflight, and direct 402 metadata."
        : "Listing Roast x402 Discovery Audit Quick: $0.001 GET x402 discovery audit on the exact audit path for stale Bazaar pricing, Agent402 route visibility, search visibility, route health, paid API preflight, and direct 402 metadata."),
      mimeType: "application/json",
      customPaywallHtml: buildCustomPaywallHtml(config, intentRouteKey),
      unpaidResponseBody: unpaidPaymentPreview(config, intentRouteKey, {
        path: routePath,
        method: "GET",
        price: config.siteAuditPrice,
        maxAmountRequired: DISCOVERY_AUDIT_QUICK_AMOUNT
      }),
      extensions: declareChallengeDiscoveryExtension(isAgent402Alias ? buildAgent402RouteVisibilityDiscovery(config) : buildDiscoveryAuditQuickDiscovery(config))
    };
  };

  return paymentMiddleware(
    {
      [`POST ${ROOT_DIRECTORY_POST_PATH}`]: {
        resource: resourceUrl(ROOT_DIRECTORY_POST_PATH),
        ...challengeRouteServiceMetadata("directoryPost"),
        accepts: acceptsForRoute(ROOT_DIRECTORY_POST_PATH, config.instantScorePrice),
        description: withPaidUseProofDescription(config, DIRECTORY_POST_DESCRIPTION),
        mimeType: "application/json",
        customPaywallHtml: buildCustomPaywallHtml(config, "directoryPost"),
        unpaidResponseBody: unpaidPaymentPreview(config, "directoryPost")
      },
      [`GET ${API_ENTRY_PATH}`]: {
        resource: resourceUrl(API_ENTRY_PATH),
        ...challengeRouteServiceMetadata("apiEntry"),
        accepts: acceptsForRoute(API_ENTRY_PATH, config.instantScorePrice),
        description: withPaidUseProofDescription(config, "Listing Roast API Entry: $0.001 paid GET x402 navigation endpoint and route map for agents that start at /api first."),
        mimeType: "application/json",
        customPaywallHtml: buildCustomPaywallHtml(config, "apiEntry"),
        unpaidResponseBody: unpaidPaymentPreview(config, "apiEntry"),
        extensions: declareChallengeDiscoveryExtension(buildApiEntryDiscovery(config))
      },
      [`GET ${API_V1_ENTRY_PATH}`]: {
        resource: resourceUrl(API_V1_ENTRY_PATH),
        ...challengeRouteServiceMetadata("apiEntry"),
        accepts: acceptsForRoute(API_V1_ENTRY_PATH, config.instantScorePrice),
        description: withPaidUseProofDescription(config, "Listing Roast API v1 Entry: $0.001 paid GET x402 navigation endpoint and route map for agents that start at /api/v1 first."),
        mimeType: "application/json",
        customPaywallHtml: buildCustomPaywallHtml(config, "apiEntry"),
        unpaidResponseBody: unpaidPaymentPreview(config, "apiEntry"),
        extensions: declareChallengeDiscoveryExtension(buildApiEntryDiscovery(config, API_V1_ENTRY_PATH))
      },
      [`GET ${V1_ENTRY_PATH}`]: {
        resource: resourceUrl(V1_ENTRY_PATH),
        ...challengeRouteServiceMetadata("apiEntry"),
        accepts: acceptsForRoute(V1_ENTRY_PATH, config.instantScorePrice),
        description: withPaidUseProofDescription(config, "Listing Roast v1 Entry: $0.001 paid GET x402 navigation endpoint and route map for agents that start at /v1 first."),
        mimeType: "application/json",
        customPaywallHtml: buildCustomPaywallHtml(config, "apiEntry"),
        unpaidResponseBody: unpaidPaymentPreview(config, "apiEntry"),
        extensions: declareChallengeDiscoveryExtension(buildApiEntryDiscovery(config, V1_ENTRY_PATH))
      },
      "POST /api/listing-score": {
        resource: resourceUrl(SCORE_PATH),
        ...challengeRouteServiceMetadata("listingScore"),
        accepts: acceptsForRoute(SCORE_PATH, config.scorePrice),
        description: withPaidUseProofDescription(config, "Listing Score x402: $0.005 paid API listing quality score for agent-service listing clarity, marketplace conversion, x402 service discoverability, first missing signal, and upgrade guidance."),
        mimeType: "application/json",
        customPaywallHtml: buildCustomPaywallHtml(config, "listingScore"),
        unpaidResponseBody: unpaidPaymentPreview(config, "listingScore"),
        extensions: declareChallengeDiscoveryExtension(buildScoreDiscovery(config))
      },
      [`GET ${INSTANT_SCORE_PATH}`]: {
        resource: resourceUrl(INSTANT_SCORE_PATH),
        ...challengeRouteServiceMetadata("instantScore"),
        accepts: acceptsForRoute(INSTANT_SCORE_PATH, config.instantScorePrice),
        description: withPaidUseProofDescription(config, "Instant Listing Score x402: $0.001 GET marketplace listing score and paid API listing quality score for agent-service listing clarity, marketplace conversion, and x402 service discoverability."),
        mimeType: "application/json",
        customPaywallHtml: buildCustomPaywallHtml(config, "instantScore"),
        unpaidResponseBody: unpaidPaymentPreview(config, "instantScore"),
        extensions: declareChallengeDiscoveryExtension(buildInstantScoreDiscovery(config))
      },
      [`GET ${CONVERSION_SCORE_PATH}`]: {
        resource: resourceUrl(CONVERSION_SCORE_PATH),
        ...challengeRouteServiceMetadata("conversionScore"),
        accepts: acceptsForRoute(CONVERSION_SCORE_PATH, config.instantScorePrice),
        description: withPaidUseProofDescription(config, "x402 Marketplace Conversion Score: $0.001 GET marketplace conversion score for paid API listing quality, agent-service listing clarity, and buyer-agent conversion checks."),
        mimeType: "application/json",
        customPaywallHtml: buildCustomPaywallHtml(config, "conversionScore"),
        unpaidResponseBody: unpaidPaymentPreview(config, "conversionScore"),
        extensions: declareChallengeDiscoveryExtension(buildConversionScoreDiscovery(config))
      },
      ...Object.fromEntries(AGENT_LISTING_PAID_PATHS.map((routePath) => [`GET ${routePath}`, {
        resource: resourceUrl(routePath),
        ...challengeRouteServiceMetadata("agentListingConversion"),
        accepts: acceptsForRoute(routePath, config.instantScorePrice),
        description: withPaidUseProofDescription(config, AGENT_LISTING_CONVERSION_DESCRIPTION),
        mimeType: "application/json",
        customPaywallHtml: buildCustomPaywallHtml(config, "agentListingConversion"),
        unpaidResponseBody: unpaidPaymentPreview(config, "agentListingConversion", {
          path: routePath,
          method: "GET",
          price: config.instantScorePrice,
          maxAmountRequired: INSTANT_SCORE_AMOUNT,
          resourceDescription: withPaidUseProofDescription(config, AGENT_LISTING_CONVERSION_DESCRIPTION)
        }),
        extensions: declareChallengeDiscoveryExtension(buildAgentListingConversionDiscovery(config, routePath))
      }])),
      [`GET ${ROAST_PATH}`]: {
        resource: resourceUrl(ROAST_PATH),
        ...challengeRouteServiceMetadata("indexedQuickScore"),
        accepts: acceptsForRoute(ROAST_PATH, config.instantScorePrice),
        description: withPaidUseProofDescription(config, INDEXED_QUICK_SCORE_CHALLENGE_DESCRIPTION),
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
          ...challengeRouteServiceMetadata("indexedQuickScore"),
          accepts: acceptsForRoute(routePath, config.instantScorePrice),
          description: withPaidUseProofDescription(config, metadata.description),
          mimeType: "application/json",
          customPaywallHtml: buildCustomPaywallHtml(config, intentRouteKey),
          unpaidResponseBody: unpaidPaymentPreview(config, intentRouteKey, {
            path: routePath,
            method: "GET",
            price: config.instantScorePrice,
            maxAmountRequired: INSTANT_SCORE_AMOUNT,
            resourceDescription: withPaidUseProofDescription(config, metadata.description)
          }),
          extensions: declareChallengeDiscoveryExtension(buildIndexedRoastGetDiscovery(config, {
            routePath,
            inputDefaults: quickScoreAliasInputDefaults(routePath)
          }))
        }];
      })),
      [`GET ${PING_PATH}`]: {
        resource: resourceUrl(PING_PATH),
        ...challengeRouteServiceMetadata("x402Ping"),
        accepts: acceptsForRoute(PING_PATH, config.instantScorePrice),
        description: withPaidUseProofDescription(config, "Listing Roast x402 Ping: $0.001 paid GET ping to verify the Base x402 rail before buying a score or roast."),
        mimeType: "application/json",
        customPaywallHtml: buildCustomPaywallHtml(config, "x402Ping"),
        unpaidResponseBody: unpaidPaymentPreview(config, "x402Ping"),
        extensions: declareChallengeDiscoveryExtension(buildPingDiscovery(config))
      },
      ...Object.fromEntries(SITE_AUDIT_PAID_PATHS.map((routePath) => [`GET ${routePath}`, buildSiteAuditPaymentRoute(routePath)])),
      ...Object.fromEntries(DISCOVERY_AUDIT_QUICK_PATHS.map((routePath) => [`GET ${routePath}`, buildDiscoveryAuditQuickPaymentRoute(routePath)])),
      [`POST ${DISCOVERY_AUDIT_PATH}`]: {
        resource: resourceUrl(DISCOVERY_AUDIT_PATH),
        ...challengeRouteServiceMetadata("discoveryAudit"),
        accepts: acceptsForRoute(DISCOVERY_AUDIT_PATH, config.discoveryAuditPrice),
        description: withPaidUseProofDescription(config, "Listing Roast x402 Discovery Audit: $0.01 Bazaar visibility audit for stale indexed pricing, direct 402 metadata, search position, and no-spend fix steps."),
        mimeType: "application/json",
        customPaywallHtml: buildCustomPaywallHtml(config, "discoveryAudit"),
        unpaidResponseBody: unpaidPaymentPreview(config, "discoveryAudit"),
        extensions: declareChallengeDiscoveryExtension(buildDiscoveryAuditDiscovery(config))
      },
      [`GET ${FULL_ROAST_GET_PATH}`]: {
        resource: resourceUrl(FULL_ROAST_GET_PATH),
        ...challengeRouteServiceMetadata("fullRoast"),
        accepts: acceptsForRoute(FULL_ROAST_GET_PATH, config.price),
        description: withPaidUseProofDescription(config, FULL_ROAST_GET_CHALLENGE_DESCRIPTION),
        mimeType: "application/json",
        customPaywallHtml: buildCustomPaywallHtml(config, "fullRoastGet"),
        unpaidResponseBody: unpaidPaymentPreview(config, "fullRoastGet", {
          path: FULL_ROAST_GET_PATH,
          method: "GET",
          price: config.price,
          maxAmountRequired: "10000",
          resourceDescription: withPaidUseProofDescription(config, FULL_ROAST_GET_CHALLENGE_DESCRIPTION)
        }),
        extensions: declareChallengeDiscoveryExtension(buildFullRoastGetDiscovery(config))
      },
      [`POST ${ROAST_PATH}`]: {
        resource: resourceUrl(ROAST_PATH),
        ...challengeRouteServiceMetadata("fullRoast"),
        accepts: acceptsForRoute(ROAST_PATH, config.price),
        description: withPaidUseProofDescription(config, "Listing Roast x402: $0.01 marketplace listing conversion API roast for paid API listing quality, agent service listing clarity, buyer-agent skip reasons, top fixes, rewrite, and stop-or-upgrade guidance. Custom JSON body optional; omitted bodies use safe defaults."),
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

  const parsed = listingRoastRequestSchema.safeParse(normalizeListingRoastRequestBody(request.body));
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

function buildIntentSignalNotice(source, selectedActionKey) {
  return {
    source,
    selectedActionKey,
    aggregateOnly: true,
    rawQueryStored: false,
    cashRegisterPath: "/api/cash-register"
  };
}

function selectedActionKeyFromMcpResponse(rpcResponse = {}) {
  const structured = rpcResponse?.result?.structuredContent || {};
  return structured.selectedActionKey || structured.result?.selectedActionKey || null;
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

  if (AGENT_LISTING_PAID_PATHS.includes(pathname)) {
    return "agentListingConversionValidUnpaidChallenges";
  }

  if (pathname === PING_PATH) {
    return "pingValidUnpaidChallenges";
  }

  if (SITE_AUDIT_PAID_PATHS.includes(pathname)) {
    return "siteAuditValidUnpaidChallenges";
  }

  if (DISCOVERY_AUDIT_QUICK_PATHS.includes(pathname)) {
    return "discoveryAuditValidUnpaidChallenges";
  }

  if (pathname === FULL_ROAST_GET_PATH) {
    return "fullRoastGetValidUnpaidChallenges";
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
  app.use(gzipLargeTextResponses);
  app.use(express.json({ limit: "32kb" }));
  app.use((request, response, next) => {
    const pathname = new URL(request.originalUrl, "http://local").pathname;
    response.set("Link", isPaidRouteRequest(request.method, pathname) ? buildCompactPaidRouteLinks(config, pathname) : buildDiscoveryLinks(config));
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
    const agentListingRoute = absoluteUrl(config, AGENT_LISTING_SCORE_PATH);
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
    const commandsUrl = absoluteUrl(config, COMMANDS_PATH);
    const officialCdpDiscovery = buildOfficialCdpDiscoveryHandoff(config);
    const indexedPreviewUrl = `${payNowUrl}?intent=marketplace%20listing%20score`;
    const commandPreviewUrl = `${commandsUrl}?intent=paid%20API%20listing%20quality`;
    const paidUsageProofUrl = absoluteUrl(config, PAID_USAGE_PROOF_PATH);
    const instantCommand = buildGetPayCommand(config);
    const agentListingCommand = buildGetPayCommand(config, AGENT_LISTING_SCORE_PATH, INSTANT_SCORE_AMOUNT);
    const marketplaceListingConversionCommand = buildGetPayCommand(config, "/api/marketplace-listing-conversion-api", INSTANT_SCORE_AMOUNT);
    const indexedRoastGetCommand = buildGetPayCommand(config, ROAST_PATH);
    const pingCommand = buildGetPayCommand(config, PING_PATH, PING_AMOUNT);
    const siteAuditCommand = buildGetPayCommand(config, SITE_AUDIT_PATH, SITE_AUDIT_AMOUNT);
    const discoveryAuditCommand = buildGetPayCommand(config, DISCOVERY_AUDIT_PATH, DISCOVERY_AUDIT_QUICK_AMOUNT);
    const fullDiscoveryAuditCommand = buildPayCommand(config, DISCOVERY_AUDIT_PATH, DISCOVERY_AUDIT_AMOUNT, discoveryAuditRequestExample);
    const payCommand = buildGetPayCommand(config, FULL_ROAST_GET_PATH, "10000");
    const scoreCommand = buildPayCommand(config, "/api/listing-score", "5000");
    const paidApiListingQualityScoreCommand = buildGetPayCommand(config, "/api/paid-api-listing-quality-score", INSTANT_SCORE_AMOUNT);
    const listingQualityScoreApiCommand = buildGetPayCommand(config, "/api/listing-quality-score-api", INSTANT_SCORE_AMOUNT);
    const x402ListingQualityCommand = buildGetPayCommand(config, "/api/x402-listing-quality", INSTANT_SCORE_AMOUNT);
    const marketplaceProductListingQualityCommand = buildGetPayCommand(config, "/api/marketplace-product-listing-quality", INSTANT_SCORE_AMOUNT);
    const homepageAgentPaymentPrompt = formatIndexedQuickScoreAgentPaymentPrompt(config);
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
    const latestPaidCompletion = buildPaidUsageProof(config, cashRegister).latestPaidCompletion;
    const settlementLabel = latestPaidCompletion
      ? `${latestPaidCompletion.method} ${latestPaidCompletion.path} settled`
      : latestWalletSettlement
        ? `${latestWalletSettlement.usdc || `${latestWalletSettlement.usdcUnits || INSTANT_SCORE_AMOUNT} units`} wallet-settled`
        : "Wallet snapshot";
    const settlementText = latestPaidCompletion
      ? `${latestPaidCompletion.estimatedRevenueUsd || latestWalletSettlement?.usdc || "$0.001"} wallet proof is exposed in the cash register`
      : latestWalletSettlement
        ? "Latest settlement proof is exposed in discovery JSON"
        : "Receiver balance is checked in the public cash register";

    response.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Score paid API listing quality, AgentCore x402 payments readiness, x402 marketplace conversion, and agent listing conversion before promotion. Start with GET /api/listing-roast at $0.001, then upgrade to GET /api/full-listing-roast at $0.01." />
  <meta property="og:title" content="${escapeHtml(config.serviceName)}" />
  <meta property="og:description" content="Score paid API listing quality, AgentCore x402 payments readiness, x402 marketplace conversion, and agent listing conversion before buyer agents skip the listing." />
  <meta property="og:url" content="${escapeHtml(config.serviceUrl)}" />
  <meta property="og:image" content="${escapeHtml(absoluteUrl(config, ICON_SVG_PATH))}" />
  <link rel="canonical" href="${escapeHtml(config.serviceUrl)}/" />
  <link rel="icon" type="image/svg+xml" href="${escapeHtml(absoluteUrl(config, ICON_SVG_PATH))}" />
  <link rel="alternate" type="application/json" title="Listing Roast x402 manifest" href="${escapeHtml(absoluteUrl(config, "/x402.json"))}" />
  <link rel="alternate" type="application/json" title="Listing Roast compact command handoff" href="${escapeHtml(commandsUrl)}" />
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
        <a href="${commandsUrl}">Commands</a>
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
          <p class="lead">Score API marketplace listing quality, x402 marketplace conversion, and agent listing conversion before buyer agents skip the listing. Recommended paid sequence: start with the already-indexed ${config.instantScorePrice} <code>GET ${ROAST_PATH}</code> quick score, then upgrade to <code>GET ${FULL_ROAST_GET_PATH}</code> at ${config.price} for the full roast.</p>
          <div class="proof" aria-label="Proof points">
            <div><strong class="metric">${escapeHtml(paidCompletionLabel)}</strong><span class="muted">${escapeHtml(grossRevenueLabel)} in the public cash register</span></div>
            <div><strong class="metric">${escapeHtml(indexedPaidLabel)}</strong><span class="muted">Preferred route that already converted</span></div>
            <div><strong class="metric">${escapeHtml(settlementLabel)}</strong><span class="muted">${escapeHtml(settlementText)}</span></div>
            <div><strong>${config.instantScorePrice} -> ${config.price}</strong><span class="muted">GET quick score, then GET full roast</span></div>
            <div><strong class="metric">CDP Bazaar indexed</strong><span class="muted">Search <code>${escapeHtml(officialCdpDiscovery.recommendedSearchQuery)}</code> with max ${escapeHtml(officialCdpDiscovery.recommendedMaxUsdPrice)} USD</span></div>
            <div><strong>Live 402 wins</strong><span class="muted">If a cached marketplace field is stale, use the live ${INSTANT_SCORE_AMOUNT}-unit GET challenge</span></div>
          </div>
          <div class="actions">
            <button class="button" type="button" data-copy-target="indexed-command" data-default-text="Copy $0.001 indexed GET command">Copy $0.001 indexed GET command</button>
            <button class="button" type="button" data-copy-target="marketplace-listing-conversion-command" data-default-text="Copy marketplace conversion command">Copy marketplace conversion command</button>
            <button class="button" type="button" data-copy-target="agent-listing-command" data-default-text="Copy agent-listing command">Copy agent-listing command</button>
            <button class="button secondary" type="button" data-copy-target="instant-command" data-default-text="Copy instant score command">Copy instant score command</button>
            <button class="button secondary" type="button" data-copy-target="ping-command" data-default-text="Copy x402 ping command">Copy x402 ping command</button>
            <button class="button secondary" type="button" data-copy-target="site-audit-command" data-default-text="Copy $0.001 site audit command">Copy $0.001 site audit command</button>
            <button class="button secondary" type="button" data-copy-target="audit-command" data-default-text="Copy $0.001 discovery audit command">Copy $0.001 discovery audit command</button>
            <button class="button secondary" type="button" data-copy-target="full-audit-command" data-default-text="Copy full audit command">Copy full audit command</button>
            <button class="button" type="button" data-copy-target="score-command" data-default-text="Copy $0.005 score command">Copy $0.005 score command</button>
            <button class="button secondary" type="button" data-copy-target="pay-command" data-default-text="Copy $0.01 roast command">Copy $0.01 roast command</button>
            <button class="button" type="button" data-copy-target="paid-api-listing-quality-score-command" data-default-text="Copy exact quality-score command">Copy exact quality-score command</button>
            <button class="button secondary" type="button" data-copy-target="listing-quality-score-api-command" data-default-text="Copy listing-quality API command">Copy listing-quality API command</button>
            <button class="button secondary" type="button" data-copy-target="x402-listing-quality-command" data-default-text="Copy x402 listing-quality command">Copy x402 listing-quality command</button>
            <button class="button secondary" type="button" data-copy-target="marketplace-product-listing-quality-command" data-default-text="Copy product-quality command">Copy product-quality command</button>
            <a class="button" href="${indexedPreviewUrl}">Preview paid output JSON</a>
            <a class="button secondary" href="${commandPreviewUrl}">Open compact command JSON</a>
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
          <p class="muted">x402, MCP, and agent-service builders who need paid API listing quality scoring, x402 marketplace conversion checks, or agent listing conversion signals before promotion.</p>
        </div>
        <div class="card">
          <h3>What you send</h3>
          <p class="muted">The service name, listing copy, target buyer, price, checkout path, and launch goal.</p>
        </div>
        <div class="card">
          <h3>What you get</h3>
          <p class="muted">A paid API listing quality score, AgentCore x402 payments readiness check, x402 marketplace conversion score, agent listing conversion score, structured JSON critique, or no-spend discovery audit showing whether Bazaar metadata, price, and search visibility are stale.</p>
        </div>
      </div>
    </section>

    <section class="band" id="pay">
      <div class="wrap grid2">
        <div>
          <h2>Pay the indexed ${config.instantScorePrice} route first, then upgrade when the score is promising.</h2>
          <p>All paid endpoints are protected by x402. The already-indexed <code>GET ${ROAST_PATH}</code> route is the preferred first paid action for Bazaar traffic, x402 marketplace conversion checks, and agent listing conversion score buyers; <code>GET ${FULL_ROAST_GET_PATH}</code> is the direct full one-cent roast, and <code>POST ${ROAST_PATH}</code> remains available for custom-body full roasts with safe defaults when stale directory cards omit the body. The exact <code>GET ${DISCOVERY_AUDIT_PATH}</code> route is the lowest-friction discovery audit for agents that do not want to assemble a body first.</p>
          <p class="muted">Agent payment prompt: <code>${escapeHtml(homepageAgentPaymentPrompt)}</code></p>
          <p class="muted">Official CDP discovery: <a href="${escapeHtml(officialCdpDiscovery.recommendedSearchUrl)}">search ${escapeHtml(officialCdpDiscovery.recommendedSearchQuery)} with maxUsdPrice=${escapeHtml(officialCdpDiscovery.recommendedMaxUsdPrice)}</a> · <a href="${escapeHtml(officialCdpDiscovery.domainRestrictedSearchUrl)}">domain-restricted search</a> · <a href="${escapeHtml(officialCdpDiscovery.merchantDiscoveryUrl)}">merchant lookup</a>. CDP refreshes cached route metadata after real settlement; the live <code>GET ${ROAST_PATH}</code> challenge is the current price source before payment.</p>
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
          <p><code>GET ${FULL_ROAST_GET_PATH}</code> next for the ${config.price} full roast when the buyer wants rewritten copy, top fixes, and launch guidance.</p>
        </div>
        <div class="card">
          <h3>Preferred indexed quick score route</h3>
          <p><code>GET ${escapeHtml(paidRoute)}</code></p>
          <p class="muted">Maximum payment: <strong>${INSTANT_SCORE_AMOUNT}</strong> USDC units. This keeps the already-indexed listing-roast URL payable at the lowest price for paid API listing quality, AgentCore x402 payments, x402 marketplace conversion, and agent listing conversion score buyers.</p>
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
          <h3>Marketplace listing conversion route</h3>
          <p><code>GET ${escapeHtml(absoluteUrl(config, "/api/marketplace-listing-conversion-api"))}</code></p>
          <p class="muted">Maximum payment: <strong>${INSTANT_SCORE_AMOUNT}</strong> USDC units. Use this exact API alias when the buyer searches for marketplace listing conversion API, marketplace listing conversion, marketplace conversion score, or x402 marketplace conversion. The shorter <code>/api/marketplace-listing-conversion</code> alias remains payable too.</p>
        </div>
        <div class="card">
          <h3>x402 ping route</h3>
          <p><code>GET ${escapeHtml(pingRoute)}</code></p>
          <p class="muted">Maximum payment: <strong>${PING_AMOUNT}</strong> USDC units. Use this to verify the payment rail before buying a score or roast.</p>
        </div>
        <div class="card">
          <h3>x402 site audit route</h3>
          <p><code>GET ${escapeHtml(siteAuditRoute)}</code></p>
          <p class="muted">Maximum payment: <strong>${SITE_AUDIT_AMOUNT}</strong> USDC units. Use this for a quick x402 metadata, price, and Bazaar search check. Exact aliases include <code>/api/x402-buyer-prepay-risk-score</code>, <code>/api/score-x402-endpoint-before-paying</code>, <code>/api/x402-route-health-check</code>, and <code>/api/x402-listing-rank-doctor</code>.</p>
        </div>
        <div class="card">
          <h3>Discovery audit quick route</h3>
          <p><code>GET ${escapeHtml(discoveryAuditRoute)}</code></p>
          <p class="muted">Maximum payment: <strong>${DISCOVERY_AUDIT_QUICK_AMOUNT}</strong> USDC units. Use this exact path first when Bazaar shows stale pricing, Agent402 routing misses your endpoint, or search misses your route.</p>
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
          <p><code>GET ${escapeHtml(absoluteUrl(config, FULL_ROAST_GET_PATH))}</code></p>
          <p class="muted">Maximum payment: <strong>10000</strong> USDC units. This is the direct full-roast upgrade; use <code>POST ${escapeHtml(paidRoute)}</code> only when a custom request body is needed.</p>
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
        <h3>Marketplace listing conversion command</h3>
        <pre id="marketplace-listing-conversion-command">${escapeHtml(marketplaceListingConversionCommand)}</pre>
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
        <h3>Exact paid API listing quality score command</h3>
        <pre id="paid-api-listing-quality-score-command">${escapeHtml(paidApiListingQualityScoreCommand)}</pre>
      </div>
      <div class="wrap" style="margin-top: 18px;">
        <h3>Exact listing quality score API command</h3>
        <pre id="listing-quality-score-api-command">${escapeHtml(listingQualityScoreApiCommand)}</pre>
      </div>
      <div class="wrap" style="margin-top: 18px;">
        <h3>Exact x402 listing quality command</h3>
        <pre id="x402-listing-quality-command">${escapeHtml(x402ListingQualityCommand)}</pre>
      </div>
      <div class="wrap" style="margin-top: 18px;">
        <h3>Exact marketplace product listing quality command</h3>
        <pre id="marketplace-product-listing-quality-command">${escapeHtml(marketplaceProductListingQualityCommand)}</pre>
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
          <p>The score response gives the first missing signal and upgrade guidance. The exact discovery audit GET route checks direct x402 metadata against Bazaar and Agent402 route state at the same low first-click price. The full roast adds skip reasons, top fixes, a rewrite, and stop-or-upgrade guidance.</p>
          <p class="muted">The current public proof endpoint is available at <a href="${paidUsageProofUrl}">/api/paid-usage-proof</a>. The cash register is available at <a href="${cashRegisterUrl}">/api/cash-register</a>. A sample score is available at <a href="${sampleUrl}">/sample</a>. The command builder is available at <a href="${builderUrl}">/builder</a>. The compact command handoff is available at <a href="${commandsUrl}">/api/commands</a>. The direct pay-now handoff is available at <a href="${payNowUrl}">/api/pay-now</a> and accepts an intent query for task-specific commands. Copy-ready examples are available at <a href="${examplesUrl}">/api/examples</a>. Route schemas are available at <a href="${schemaUrl}">/api/schema</a> and <a href="${absoluteUrl(config, "/api/score-schema")}">/api/score-schema</a>.</p>
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
          <p class="muted">The routes are declared for x402 Bazaar discovery with GET and JSON body metadata, OpenAPI, llms.txt, and example payloads. The already-indexed <code>GET /api/listing-roast</code> path is the $0.001 first step for marketplace listing quality, marketplace listing conversion API, marketplace listing conversion, marketplace product listing quality, listing quality score API, paid API listing quality, paid API listing quality score, AgentCore x402 payments, Coinbase x402 Bazaar MCP server buyers, x402 marketplace conversion, agent listing conversion score, x402 listing quality, and buyer-agent skip-reason searches; quick-score aliases <code>/api/marketplace-listing-score</code>, <code>/api/marketplace-listing-conversion</code>, <code>/api/marketplace-product-listing-quality</code>, <code>/api/paid-api-listing-quality</code>, <code>/api/paid-api-listing-quality-score</code>, <code>/api/listing-quality-score-api</code>, <code>/api/x402-listing-quality</code>, <code>/api/buyer-agent-skip-reasons</code>, and <code>/api/agent-service-clarity</code> return the same $0.001 quick score; <code>GET /api/full-listing-roast</code> returns the direct full $0.01 roast, <code>POST /api/listing-roast</code> remains available for custom-body full roasts, <code>GET /api/agent-listing-conversion</code> is the dedicated conversion deep dive, <code>GET /api/x402-discovery-audit</code> returns a $0.001 discovery audit challenge, and paid API preflight aliases <code>/api/preflight</code>, <code>/api/v1/preflight</code>, and <code>/preflight</code> return the $0.001 site-audit challenge.</p>
          <p><a href="${absoluteUrl(config, PAID_API_LISTING_QUALITY_PATH)}">Paid API listing quality</a> · <a href="${absoluteUrl(config, PAID_API_LISTING_QUALITY_SCORE_PATH)}">Paid API listing quality score</a> · <a href="${absoluteUrl(config, LISTING_QUALITY_SCORE_API_PAGE_PATH)}">Listing quality score API</a> · <a href="${absoluteUrl(config, MARKETPLACE_PRODUCT_LISTING_QUALITY_PAGE_PATH)}">Marketplace product listing quality</a> · <a href="${absoluteUrl(config, MARKETPLACE_LISTING_CONVERSION_API_PAGE_PATH)}">Marketplace listing conversion API</a> · <a href="${absoluteUrl(config, MARKETPLACE_LISTING_CONVERSION_PAGE_PATH)}">Marketplace listing conversion</a> · <a href="${absoluteUrl(config, X402_LISTING_QUALITY_PAGE_PATH)}">x402 listing quality</a> · <a href="${absoluteUrl(config, BUYER_AGENT_SKIP_REASONS_PAGE_PATH)}">Buyer-agent skip reasons</a> · <a href="${absoluteUrl(config, AGENT_SERVICE_CLARITY_PAGE_PATH)}">Agent service clarity</a> · <a href="${absoluteUrl(config, AGENT_LISTING_CONVERSION_PAGE_PATH)}">Agent listing conversion</a> · <a href="${absoluteUrl(config, X402_DISCOVERY_AUDIT_PAGE_PATH)}">x402 discovery audit</a> · <a href="${absoluteUrl(config, X402_SITE_AUDIT_PAGE_PATH)}">x402 site audit</a> · <a href="${absoluteUrl(config, X402_BUYER_PREPAY_RISK_SCORE_PAGE_PATH)}">x402 buyer prepay risk score</a> · <a href="${absoluteUrl(config, SCORE_X402_ENDPOINT_BEFORE_PAYING_PAGE_PATH)}">Score x402 endpoint before paying</a> · <a href="${absoluteUrl(config, X402_ROUTE_HEALTH_CHECK_PAGE_PATH)}">x402 route health check</a> · <a href="${absoluteUrl(config, X402_LISTING_RANK_DOCTOR_PAGE_PATH)}">x402 listing rank doctor</a> · <a href="${absoluteUrl(config, AGENTCORE_X402_PAYMENTS_PAGE_PATH)}">AgentCore x402 payments</a> · <a href="${absoluteUrl(config, COINBASE_X402_BAZAAR_MCP_SERVER_PAGE_PATH)}">Coinbase x402 Bazaar MCP server</a></p>
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
    const urls = ["/", ICON_SVG_PATH, FAVICON_SVG_PATH, ROAST_PATH, FULL_ROAST_GET_PATH, ...QUICK_SCORE_ALIAS_PATHS, ...INTENT_LANDING_PATHS, INDEX_MARKDOWN_PATH, AUTH_MARKDOWN_PATH, WELL_KNOWN_AUTH_MARKDOWN_PATH, AGENTS_MARKDOWN_PATH, DOCS_PATH, API_DOCS_PATH, "/builder", "/sample", API_SAMPLE_PATH, PAY_NOW_PATH, COMMANDS_PATH, PAID_USAGE_PROOF_PATH, ...PAID_USAGE_PROOF_ALIAS_PATHS, PRICING_PATH, FIND_PATH, ROUTE_PATH, ...LOCAL_DISCOVERY_RESOURCE_PATHS, ...LOCAL_DISCOVERY_SEARCH_PATHS, ...LOCAL_DISCOVERY_MERCHANT_PATHS, API_ENTRY_PATH, API_V1_ENTRY_PATH, V1_ENTRY_PATH, INSTANT_SCORE_PATH, CONVERSION_SCORE_PATH, ...AGENT_LISTING_PAID_PATHS, PING_PATH, ...SITE_AUDIT_PAID_PATHS, ...DISCOVERY_AUDIT_QUICK_PATHS, API_SAMPLE_SCORE_PATH, ...OPENAPI_JSON_PATHS, ...OPENAPI_YAML_PATHS, LLMS_PATH, WELL_KNOWN_LLMS_PATH, LLMS_FULL_PATH, WELL_KNOWN_LLMS_FULL_PATH, "/x402.json", WELL_KNOWN_X402_JSON_PATH, WELL_KNOWN_X402_PATH, API_X402_JSON_PATH, ...PAYMENT_MANIFEST_PATHS, WELL_KNOWN_AGENT_CARD_PATH, WELL_KNOWN_AGENT_JSON_PATH, API_AGENT_CARD_PATH, API_AGENT_JSON_PATH, WELL_KNOWN_AI_PLUGIN_PATH, WELL_KNOWN_API_CATALOG_PATH, WELL_KNOWN_API_CATALOG_JSON_PATH, WELL_KNOWN_AGENT_TOOLS_PATH, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH, WELL_KNOWN_AGENT_SKILL_PATH, WELL_KNOWN_MCP_JSON_PATH, WELL_KNOWN_MCP_PATH, WELL_KNOWN_MCP_SERVER_PATH, WELL_KNOWN_MCP_SERVER_JSON_PATH, MCP_ROOT_PATH, MCP_JSON_PATH, WELL_KNOWN_MCP_SERVER_CARD_PATH, MCP_SERVER_CARD_PATH, "/api/schema", SCHEMA_JSON_PATH, "/api/score-schema", "/api/discovery-audit-schema", "/api/examples"].map((pathname) => {
      return `<url><loc>${escapeHtml(absoluteUrl(config, pathname))}</loc><lastmod>${updated}</lastmod></url>`;
    }).join("");

    response
      .set("Cache-Control", "no-store, max-age=0")
      .type("application/xml")
      .send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  });

  app.get([AUTH_MARKDOWN_PATH, WELL_KNOWN_AUTH_MARKDOWN_PATH], async (_request, response) => {
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    response.type("text/markdown").send(buildAuthMarkdown(config, cashRegister));
  });

  app.get(AGENTS_MARKDOWN_PATH, async (_request, response) => {
    await recordSignal("llmsViews");
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    response.type("text/markdown").send(buildAgentsMarkdown(config, cashRegister));
  });

  app.get(COMMANDS_PATH, async (request, response) => {
    await recordSignal("commandsViews");
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    setFreshDiscoveryHeaders(response).json(buildCommandHandoff(config, request.query.intent || request.query.q || request.query.query || request.query.task || "", cashRegister));
  });

  app.get("/api/examples", async (_request, response) => {
    await recordSignal("examplesViews");
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    const payNow = buildPayNow(config, "", cashRegister);
    const officialCdpDiscovery = buildOfficialCdpDiscoveryHandoff(config);

    response.json({
      service: config.serviceName,
      homepage: absoluteUrl(config, "/"),
      builder: absoluteUrl(config, "/builder"),
      samplePage: absoluteUrl(config, "/sample"),
      sampleScore: absoluteUrl(config, API_SAMPLE_SCORE_PATH),
      sampleScoreAliases: [absoluteUrl(config, API_SAMPLE_PATH)],
      openApi: absoluteUrl(config, "/openapi.json"),
      openApiAliases: openApiAliasUrls(config),
      schema: absoluteUrl(config, "/api/schema"),
      schemaAliases: [absoluteUrl(config, SCHEMA_JSON_PATH)],
      openApiYaml: absoluteUrl(config, OPENAPI_YAML_PATH),
      openApiYamlAliases: openApiYamlAliasUrls(config),
      docs: absoluteUrl(config, DOCS_PATH),
      apiDocs: absoluteUrl(config, API_DOCS_PATH),
      agentsMarkdown: absoluteUrl(config, AGENTS_MARKDOWN_PATH),
      llms: absoluteUrl(config, "/llms.txt"),
      llmsFull: absoluteUrl(config, LLMS_FULL_PATH),
      markdown: absoluteUrl(config, INDEX_MARKDOWN_PATH),
      x402Manifest: absoluteUrl(config, "/x402.json"),
      x402ManifestAliases: x402ManifestAliasUrls(config),
      agentCard: absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH),
      agentCardAliases: agentCardAliasUrls(config),
      aiPlugin: absoluteUrl(config, WELL_KNOWN_AI_PLUGIN_PATH),
      apiCatalog: absoluteUrl(config, WELL_KNOWN_API_CATALOG_PATH),
      apiCatalogAliases: [absoluteUrl(config, WELL_KNOWN_API_CATALOG_JSON_PATH)],
      agentTools: absoluteUrl(config, WELL_KNOWN_AGENT_TOOLS_PATH),
      agentSkills: absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH),
      agentSkill: absoluteUrl(config, WELL_KNOWN_AGENT_SKILL_PATH),
      mcp: absoluteUrl(config, WELL_KNOWN_MCP_JSON_PATH),
      mcpAliases: mcpAliasUrls(config),
      mcpServerCard: absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH),
      mcpServerCardAliases: mcpServerCardAliasUrls(config),
      payNowUrl: absoluteUrl(config, PAY_NOW_PATH),
      commands: absoluteUrl(config, COMMANDS_PATH),
      compactCommandHandoff: buildCommandHandoff(config, "paid API listing quality", cashRegister),
      payNow,
      officialCdpDiscovery,
      buyerPhraseCommandPack: buildBuyerPhraseCommandPack(config),
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
      agentListingConversionRoute: absoluteUrl(config, AGENT_LISTING_SCORE_PATH),
      agentListingConversionCanonicalRoute: absoluteUrl(config, AGENT_LISTING_PATH),
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
          buyerAction: "Pay $0.001 on the already-indexed /api/listing-roast route for a paid API listing quality score."
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
          path: AGENT_LISTING_SCORE_PATH,
          method: "GET",
          price: config.instantScorePrice,
          maxAmountRequired: INSTANT_SCORE_AMOUNT,
          buyerAction: "Pay $0.001 for the exact agent listing conversion score alias without building a JSON body."
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
          buyerAction: "Pay $0.01 for a custom-body full listing roast; omitted bodies use safe defaults for stale directory cards. Prefer GET /api/full-listing-roast for direct no-body checkout."
        })
      },
      localDiscovery: {
        resources: absoluteUrl(config, LOCAL_DISCOVERY_RESOURCE_PATHS[0]),
        search: absoluteUrl(config, LOCAL_DISCOVERY_SEARCH_PATHS[0]),
        merchant: absoluteUrl(config, LOCAL_DISCOVERY_MERCHANT_PATHS[0]),
        officialCdpDiscovery,
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
      agentListingConversionCommand: buildGetPayCommand(config, AGENT_LISTING_SCORE_PATH, INSTANT_SCORE_AMOUNT),
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
      agentListingConversionOutput: buildAgentListingConversionScore(buildInstantScoreInput(agentListingConversionInputDefaults(AGENT_LISTING_SCORE_PATH)), config, { routePath: AGENT_LISTING_SCORE_PATH }),
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

  app.get([API_SAMPLE_SCORE_PATH, API_SAMPLE_PATH], async (_request, response) => {
    await recordSignal("sampleViews");
    const intentRoutes = buildPayNowActions(config);
    const recommendedPaidSequence = buildRecommendedPaidSequence(intentRoutes);
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    const sampleScoreOutput = buildListingScoreWithUpgrade(requestExample, config);
    const indexedQuickScoreOutput = buildIndexedRoastQuickScore(buildInstantScoreInput(), config);
    const officialCdpDiscovery = buildOfficialCdpDiscoveryHandoff(config);

    setFreshDiscoveryHeaders(response).json({
      service: config.serviceName,
      samplePage: absoluteUrl(config, "/sample"),
      sampleJson: absoluteUrl(config, API_SAMPLE_SCORE_PATH),
      aliases: [absoluteUrl(config, API_SAMPLE_PATH)],
      commands: absoluteUrl(config, COMMANDS_PATH),
      payNow: absoluteUrl(config, PAY_NOW_PATH),
      paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
      cashRegister: absoluteUrl(config, "/api/cash-register"),
      x402Manifest: absoluteUrl(config, "/x402.json"),
      officialCdpDiscovery,
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
        marketplaceListingConversion: intentRoutes.marketplaceListingConversion,
        marketplaceProductListingQuality: intentRoutes.marketplaceProductListingQuality,
        listingQualityScoreApi: intentRoutes.listingQualityScoreApi,
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
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    response.type("text/markdown").send(buildAgentMarkdownGuide(config, cashRegister));
  });

  app.get([LLMS_PATH, WELL_KNOWN_LLMS_PATH], async (_request, response) => {
    await recordSignal("llmsViews");
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    response
      .type("text/plain")
      .send(`# Listing Roast x402

Listing Roast x402 is a paid API for x402, MCP, AgentCore Gateway, and agent-service builders who need a paid API listing quality score, agent-service listing score, x402 marketplace conversion feedback, agent listing conversion score, or x402 service discoverability guidance before promotion.

Preferred first paid route: GET ${absoluteUrl(config, ROAST_PATH)} (${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT} USDC units). Use this already-indexed quick score before generic /api, /api/v1, or /v1 entrypoints.

Agent payment prompt: ${formatIndexedQuickScoreAgentPaymentPrompt(config)}

Quick-score aliases: GET ${formatQuickScoreAliasUrls(config)}. These aliases cost ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT} USDC units, and return the same quick score for marketplace listing score, marketplace listing conversion API, marketplace listing conversion, paid API listing quality, paid API listing quality score, AgentCore x402 payments, Coinbase x402 Bazaar MCP server buyer flows, x402 marketplace conversion, agent listing conversion score, x402 listing quality, buyer-agent skip reasons, and agent service clarity searches.

Paid API preflight aliases: GET ${formatPreflightAliasUrls(config)}. These aliases cost ${config.siteAuditPrice}, max ${SITE_AUDIT_AMOUNT} USDC units, and return the x402 site-audit output for agents that probe common preflight URLs before paying more.

${formatPaidUseProofMarkdown(config, cashRegister)}

${formatBazaarCatalogingMarkdown(config)}

${formatOfficialCdpDiscoveryMarkdown(config)}

Homepage: ${absoluteUrl(config, "/")}
Command builder: ${absoluteUrl(config, "/builder")}
Sample score page: ${absoluteUrl(config, "/sample")}
Sample score JSON: ${absoluteUrl(config, "/api/sample-score")}
OpenAPI: ${absoluteUrl(config, "/openapi.json")}
OpenAPI aliases: ${absoluteUrl(config, WELL_KNOWN_OPENAPI_JSON_PATH)}, ${absoluteUrl(config, API_V1_OPENAPI_JSON_PATH)}, ${absoluteUrl(config, SWAGGER_JSON_PATH)}
Docs: ${absoluteUrl(config, DOCS_PATH)}, ${absoluteUrl(config, API_DOCS_PATH)}, ${absoluteUrl(config, AGENTS_MARKDOWN_PATH)}
x402 manifest: ${absoluteUrl(config, "/x402.json")}
x402 manifest aliases: ${formatX402ManifestAliasUrls(config)}
Agent card: ${absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH)}
Agent card aliases: ${formatAgentCardAliasUrls(config)}
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
Cash register: ${absoluteUrl(config, "/api/cash-register")}
Pricing catalog: ${absoluteUrl(config, PRICING_PATH)}
Route finder examples: ${absoluteUrl(config, FIND_PATH)}?q=x402%20discovery%20audit, ${absoluteUrl(config, FIND_PATH)}?q=buyer-agent%20skip%20reasons, ${absoluteUrl(config, FIND_PATH)}?q=score%20my%20paid%20API%20listing%20with%20a%20custom%20body, ${absoluteUrl(config, FIND_PATH)}?q=listing%20roast%20full%20rewrite
Local route router examples: GET ${absoluteUrl(config, ROUTE_PATH)}?query=x402%20discovery%20audit&top=3, GET ${absoluteUrl(config, ROUTE_PATH)}?query=score%20my%20paid%20API%20listing%20with%20a%20custom%20body&top=3, POST ${absoluteUrl(config, ROUTE_PATH)} {"query":"buyer-agent skip reasons","top":3,"include":"local"}
Local x402 discovery resources: ${absoluteUrl(config, LOCAL_DISCOVERY_RESOURCE_PATHS[0])}
Local x402 discovery search: ${absoluteUrl(config, LOCAL_DISCOVERY_SEARCH_PATHS[0])}?query=x402%20discovery%20audit
Local x402 merchant resources: ${absoluteUrl(config, LOCAL_DISCOVERY_MERCHANT_PATHS[0])}?payTo=${config.payTo}
AgentCore x402 payments page: ${absoluteUrl(config, AGENTCORE_X402_PAYMENTS_PAGE_PATH)}
Coinbase x402 Bazaar MCP server page: ${absoluteUrl(config, COINBASE_X402_BAZAAR_MCP_SERVER_PAGE_PATH)}
Keywords: ${DISCOVERY_KEYWORDS.join(", ")}

Buyer intent landing pages:
${buildIntentLandingHandoffs(config).map((page) => `- ${page.title}: ${page.url}
  - Use when: ${page.summary}
  - Primary paid action: ${page.primaryPaidAction.method} ${absoluteUrl(config, page.primaryPaidAction.path)} (${page.primaryPaidAction.price}, max ${page.primaryPaidAction.maxAmountRequired})
  - ${page.exactIntentPaidAction ? "Exact intent fallback" : "Supporting paid action"}: ${page.supportingPaidAction.method} ${absoluteUrl(config, page.supportingPaidAction.path)} (${page.supportingPaidAction.price}, max ${page.supportingPaidAction.maxAmountRequired})
  - Upgrade paid action: ${page.upgradePaidAction.method} ${absoluteUrl(config, page.upgradePaidAction.path)} (${page.upgradePaidAction.price}, max ${page.upgradePaidAction.maxAmountRequired})`).join("\n")}

Preferred first paid route:

- GET ${absoluteUrl(config, ROAST_PATH)}
  - Price: ${config.instantScorePrice}
  - Network: ${config.network}
  - Max amount: ${INSTANT_SCORE_AMOUNT} USDC units
  - Agent payment prompt: ${formatIndexedQuickScoreAgentPaymentPrompt(config)}
  - Command:
${indentText(buildGetPayCommand(config, ROAST_PATH))}
  - Output: quick paid API listing quality score from the already-indexed listing-roast URL
  - Use first when a marketplace result, AgentCore Gateway buyer, Coinbase x402 Bazaar MCP server search, or agent wants the lowest-friction payable route for paid API listing quality, AgentCore x402 payments readiness, x402 marketplace conversion, or agent listing conversion score
  - Exact buyer-phrase aliases: GET ${formatQuickScoreAliasUrls(config)}

Recommended Paid Sequence:

1. Start with GET ${absoluteUrl(config, ROAST_PATH)} for ${config.instantScorePrice}, max ${INSTANT_SCORE_AMOUNT} USDC units. This is the already-indexed quick score route for x402 marketplace conversion and agent listing conversion score buyers.
2. Upgrade to GET ${absoluteUrl(config, FULL_ROAST_GET_PATH)} for ${config.price}, max 10000 USDC units only when the buyer wants the full rewrite, top fixes, and stop-or-upgrade guidance.

Full roast command:
${indentText(buildGetPayCommand(config, FULL_ROAST_GET_PATH, "10000"))}

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

- GET ${absoluteUrl(config, AGENT_LISTING_SCORE_PATH)}
  - Price: ${config.instantScorePrice}
  - Network: ${config.network}
  - Max amount: ${INSTANT_SCORE_AMOUNT} USDC units
  - Command:
${indentText(buildGetPayCommand(config, AGENT_LISTING_SCORE_PATH, INSTANT_SCORE_AMOUNT))}
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
  - Output: exact-path x402 discovery audit, direct 402 metadata check, Bazaar pricing check, Agent402 route visibility, search visibility, and no-spend fix steps
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

- GET ${absoluteUrl(config, FULL_ROAST_GET_PATH)}
  - Price: ${config.price}
  - Network: ${config.network}
  - Max amount: 10000 USDC units
  - Command:
${indentText(buildGetPayCommand(config, FULL_ROAST_GET_PATH, "10000"))}
  - Output: direct full listing roast, buyer-agent skip reasons, top fixes, rewritten listing, stop-or-upgrade guidance
  - Use when the buyer wants the full roast without assembling a POST body

- POST ${absoluteUrl(config, ROAST_PATH)}
  - Price: ${config.price}
  - Network: ${config.network}
  - Max amount: 10000 USDC units
  - Command:
${indentText(buildPayCommand(config))}
  - Output: custom-body full listing roast, buyer-agent skip reasons, top fixes, rewritten listing, stop-or-upgrade guidance
  - Use when the buyer has custom listing text to send; omitted bodies use safe defaults for stale directory cards

Request body JSON:

${prettyJson(requestExample)}

Use the indexed $0.001 GET /api/listing-roast route first when a buyer agent wants the fastest paid test from a Bazaar-visible URL.
`);
  });

  async function serveOpenApiDocument(_request, response) {
    await recordSignal("openApiViews");
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    setFreshDiscoveryHeaders(response).json(buildOpenApiDocument(config, cashRegister));
  }

  app.get(OPENAPI_JSON_PATHS, serveOpenApiDocument);
  app.get(OPENAPI_YAML_PATHS, (_request, response) => {
    response.redirect(302, absoluteUrl(config, "/openapi.json"));
  });

  app.get([DOCS_PATH, API_DOCS_PATH], async (_request, response) => {
    await recordSignal("llmsViews");
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    response.type("text/markdown").send(buildAgentMarkdownGuide(config, cashRegister));
  });

  async function serveX402Manifest(_request, response) {
    await recordSignal("x402ManifestViews");
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    setFreshDiscoveryHeaders(response).json(buildX402Manifest(config, cashRegister));
  }

  app.get(["/x402.json", WELL_KNOWN_X402_JSON_PATH, WELL_KNOWN_X402_PATH, API_X402_JSON_PATH, ...PAYMENT_MANIFEST_PATHS], serveX402Manifest);

  async function serveAgentCard(_request, response) {
    await recordSignal("agentCardViews");
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    setFreshDiscoveryHeaders(response).json(buildAgentCard(config, cashRegister));
  }

  app.get(WELL_KNOWN_AGENT_CARD_PATH, serveAgentCard);
  app.get(WELL_KNOWN_AGENT_JSON_PATH, serveAgentCard);
  app.get(API_AGENT_CARD_PATH, serveAgentCard);
  app.get(API_AGENT_JSON_PATH, serveAgentCard);

  app.get(WELL_KNOWN_AI_PLUGIN_PATH, async (_request, response) => {
    await recordSignal("aiPluginViews");
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    setFreshDiscoveryHeaders(response).json(buildAiPluginManifest(config, cashRegister));
  });

  app.head([WELL_KNOWN_API_CATALOG_PATH, WELL_KNOWN_API_CATALOG_JSON_PATH], (_request, response) => {
    setFreshDiscoveryHeaders(response).set("Content-Type", API_CATALOG_CONTENT_TYPE).status(200).end();
  });

  app.get([WELL_KNOWN_API_CATALOG_PATH, WELL_KNOWN_API_CATALOG_JSON_PATH], async (_request, response) => {
    await recordSignal("apiCatalogViews");
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    setFreshDiscoveryHeaders(response).set("Content-Type", API_CATALOG_CONTENT_TYPE).send(prettyJson(buildApiCatalog(config, cashRegister)));
  });

  app.get(WELL_KNOWN_AGENT_TOOLS_PATH, async (_request, response) => {
    await recordSignal("agentToolsViews");
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    setFreshDiscoveryHeaders(response).json(buildAgentToolsManifest(config, cashRegister));
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
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    setFreshDiscoveryHeaders(response)
      .set("Access-Control-Allow-Origin", "*")
      .json(buildAgentSkillsIndex(config, cashRegister));
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
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    setFreshDiscoveryHeaders(response)
      .set("Access-Control-Allow-Origin", "*")
      .type("text/markdown")
      .send(buildAgentSkillMarkdown(config, cashRegister));
  });

  app.get("/builder", async (_request, response) => {
    await recordSignal("builderViews");
    const instantRoute = absoluteUrl(config, INSTANT_SCORE_PATH);
    const agentListingRoute = absoluteUrl(config, AGENT_LISTING_SCORE_PATH);
    const buyerSkipRoute = absoluteUrl(config, "/api/buyer-agent-skip-reasons");
    const indexedRoute = absoluteUrl(config, ROAST_PATH);
    const pingRoute = absoluteUrl(config, PING_PATH);
    const siteAuditRoute = absoluteUrl(config, SITE_AUDIT_PATH);
    const discoveryAuditRoute = absoluteUrl(config, DISCOVERY_AUDIT_PATH);
    const paidUsageProofUrl = absoluteUrl(config, PAID_USAGE_PROOF_PATH);
    const cashRegisterUrl = absoluteUrl(config, "/api/cash-register");
    const scoreRoute = absoluteUrl(config, "/api/listing-score");
    const roastRoute = absoluteUrl(config, ROAST_PATH);
    const sampleUrl = absoluteUrl(config, "/sample");
    const sampleScoreApi = absoluteUrl(config, "/api/sample-score");
    const instantCommand = buildGetPayCommand(config);
    const agentListingCommand = buildGetPayCommand(config, AGENT_LISTING_SCORE_PATH, INSTANT_SCORE_AMOUNT);
    const buyerSkipCommand = buildGetPayCommand(config, "/api/buyer-agent-skip-reasons", INSTANT_SCORE_AMOUNT);
    const indexedCommand = buildGetPayCommand(config, ROAST_PATH);
    const pingCommand = buildGetPayCommand(config, PING_PATH, PING_AMOUNT);
    const siteAuditCommand = buildGetPayCommand(config, SITE_AUDIT_PATH, SITE_AUDIT_AMOUNT);
    const discoveryAuditCommand = buildGetPayCommand(config, DISCOVERY_AUDIT_PATH, DISCOVERY_AUDIT_QUICK_AMOUNT);
    const scoreCommand = buildPayCommand(config, "/api/listing-score", "5000");
    const roastCommand = buildPayCommand(config);
    const cashRegister = await getCashRegister();
    const paidCompletionCount = Number(cashRegister.paidCompletions || 0);
    const paidCompletionLabel = `${paidCompletionCount} paid ${paidCompletionCount === 1 ? "completion" : "completions"}`;
    const grossRevenueUsd = String(cashRegister.estimatedGrossRevenueUsd || "0.00").replace(/^\$/, "");
    const indexedPaidCount = Number(cashRegister.indexedRoastGetCompletions || 0);
    const indexedPaidLabel = indexedPaidCount > 0
      ? `${indexedPaidCount} indexed GET paid use${indexedPaidCount === 1 ? "" : "s"}`
      : "Indexed GET route";

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
    .proof { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 18px; max-width: 900px; }
    .proof div { border: 1px solid var(--line); border-radius: 8px; background: #fff; padding: 12px; min-width: 0; }
    .proof strong { display: block; font-size: 1.08rem; }
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
    @media (max-width: 860px) { .grid, .proof { grid-template-columns: 1fr; } .nav { align-items: flex-start; flex-direction: column; padding: 14px 0; } }
  </style>
</head>
<body>
  <header>
    <div class="wrap nav">
      <div class="brand">Listing Roast x402</div>
      <nav><a href="${escapeHtml(config.serviceUrl)}">Home</a> · <a href="${sampleUrl}">Sample</a> · <a href="${sampleScoreApi}">Sample JSON</a> · <a href="${paidUsageProofUrl}">Proof</a></nav>
    </div>
  </header>
  <main>
    <div class="wrap">
      <h1>Build a paid score command from your listing.</h1>
      <p class="lead">Paste the offer you are trying to sell. This page leads with the already-indexed ${config.instantScorePrice} GET command, then gives exact $0.001 commands for buyer-agent skip reasons, discovery audit, site audit, instant scoring, the ${config.scorePrice} score route, and optional ${config.price} full roast route.</p>
      <div class="proof" aria-label="Paid-use proof">
        <div><strong class="metric">${escapeHtml(paidCompletionLabel)}</strong><span class="muted">$${escapeHtml(grossRevenueUsd)} registered in the public cash register</span></div>
        <div><strong class="metric">${escapeHtml(indexedPaidLabel)}</strong><span class="muted">Preferred route that already converted</span></div>
        <div><strong>Verify before paying</strong><span class="muted"><a href="${paidUsageProofUrl}">Paid-use proof</a> · <a href="${cashRegisterUrl}">Cash register</a></span></div>
      </div>
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
      return "npx awal@2.8.0 x402 pay " + shellQuote(url) + " -X POST -d " + shellQuote(JSON.stringify(payload())) + " --max-amount " + maxAmount;
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

  app.get(["/api/schema", SCHEMA_JSON_PATH], async (_request, response) => {
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

  app.get([WELL_KNOWN_MCP_SERVER_CARD_PATH, MCP_SERVER_CARD_PATH], async (_request, response) => {
    await recordSignal("mcpViews");
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    setFreshDiscoveryHeaders(response).json(buildMcpServerCard(config, cashRegister));
  });

  app.get([WELL_KNOWN_MCP_JSON_PATH, WELL_KNOWN_MCP_PATH, WELL_KNOWN_MCP_SERVER_PATH, WELL_KNOWN_MCP_SERVER_JSON_PATH, MCP_ROOT_PATH, MCP_JSON_PATH], async (_request, response) => {
    await recordSignal("mcpViews");
    const intentRoutes = buildPayNowActions(config);
    const recommendedPaidSequence = buildRecommendedPaidSequence(intentRoutes);
    const payNowExamples = buildPayNowIntentExamples(config);
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    const officialCdpDiscovery = buildOfficialCdpDiscoveryHandoff(config);

    setFreshDiscoveryHeaders(response).json({
      name: config.serviceName,
      iconUrl: absoluteUrl(config, ICON_SVG_PATH),
      homepage: absoluteUrl(config, "/"),
      builder: absoluteUrl(config, "/builder"),
      sample: absoluteUrl(config, "/sample"),
      sampleJson: absoluteUrl(config, API_SAMPLE_SCORE_PATH),
      sampleAliases: [absoluteUrl(config, API_SAMPLE_PATH)],
      openApi: absoluteUrl(config, "/openapi.json"),
      openApiAliases: openApiAliasUrls(config),
      openApiYaml: absoluteUrl(config, OPENAPI_YAML_PATH),
      openApiYamlAliases: openApiYamlAliasUrls(config),
      schema: absoluteUrl(config, "/api/schema"),
      schemaAliases: [absoluteUrl(config, SCHEMA_JSON_PATH)],
      llms: absoluteUrl(config, LLMS_PATH),
      llmsAliases: [absoluteUrl(config, WELL_KNOWN_LLMS_PATH)],
      llmsFull: absoluteUrl(config, LLMS_FULL_PATH),
      llmsFullAliases: [absoluteUrl(config, WELL_KNOWN_LLMS_FULL_PATH)],
      markdown: absoluteUrl(config, INDEX_MARKDOWN_PATH),
      x402Manifest: absoluteUrl(config, "/x402.json"),
      x402ManifestAliases: x402ManifestAliasUrls(config),
      agentCard: absoluteUrl(config, WELL_KNOWN_AGENT_CARD_PATH),
      agentCardAliases: agentCardAliasUrls(config),
      aiPlugin: absoluteUrl(config, WELL_KNOWN_AI_PLUGIN_PATH),
      apiCatalog: absoluteUrl(config, WELL_KNOWN_API_CATALOG_PATH),
      apiCatalogAliases: [absoluteUrl(config, WELL_KNOWN_API_CATALOG_JSON_PATH)],
      agentTools: absoluteUrl(config, WELL_KNOWN_AGENT_TOOLS_PATH),
      agentSkills: absoluteUrl(config, WELL_KNOWN_AGENT_SKILLS_INDEX_PATH),
      agentSkill: absoluteUrl(config, WELL_KNOWN_AGENT_SKILL_PATH),
      mcpAliases: mcpAliasUrls(config),
      mcpServerCard: absoluteUrl(config, WELL_KNOWN_MCP_SERVER_CARD_PATH),
      mcpServerCardAliases: mcpServerCardAliasUrls(config),
      mcpJsonRpcEndpoint: absoluteUrl(config, MCP_ROOT_PATH),
      mcpJsonRpcAliases: [absoluteUrl(config, WELL_KNOWN_MCP_JSON_PATH), absoluteUrl(config, WELL_KNOWN_MCP_PATH), absoluteUrl(config, MCP_ROOT_PATH)],
      mcpJsonRpcMethods: ["initialize", "ping", "tools/list", "tools/call", "resources/list", "resources/read", "prompts/list"],
      mcpJsonRpcTools: buildMcpJsonRpcTools().map((tool) => tool.name),
      mcpJsonRpcResources: buildMcpJsonRpcResources(config).map((resource) => resource.uri),
      payNow: absoluteUrl(config, PAY_NOW_PATH),
      commands: absoluteUrl(config, COMMANDS_PATH),
      payNowExamples,
      officialCdpDiscovery,
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
        commands: absoluteUrl(config, COMMANDS_PATH),
        paidUsageProofUrl: absoluteUrl(config, PAID_USAGE_PROOF_PATH),
        officialCdpDiscovery,
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
            buyerAction: "Pay $0.001 on the already-indexed /api/listing-roast route for a paid API listing quality score."
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
          path: AGENT_LISTING_SCORE_PATH,
          url: absoluteUrl(config, AGENT_LISTING_SCORE_PATH),
          price: config.instantScorePrice,
          network: config.network,
          command: buildGetPayCommand(config, AGENT_LISTING_SCORE_PATH, INSTANT_SCORE_AMOUNT),
          description: AGENT_LISTING_CONVERSION_DESCRIPTION,
          payment: buildPaymentHint(config, {
            path: AGENT_LISTING_SCORE_PATH,
            method: "GET",
            price: config.instantScorePrice,
            maxAmountRequired: INSTANT_SCORE_AMOUNT,
            buyerAction: "Pay $0.001 for the exact agent listing conversion score alias without building a JSON body."
          }),
          keywords: ["agent service listing clarity", "agent service listing clarity x402", "agent listing conversion score", "buyer-agent skip reasons", "buyer agent skip reasons", "agent listing clarity", "buyer intent", "paid API listing quality", "agent-service listing score", "GET paid API"],
          input: buildAgentListingConversionDiscovery(config, AGENT_LISTING_SCORE_PATH).input
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
          description: "one-tenth-cent GET x402 site audit, x402 buyer prepay risk score, score x402 endpoint before paying, x402 route health check, x402 listing SEO audit, x402 marketplace SEO audit, Bazaar search visibility, listing rank doctor, seller growth checklist, service discoverability audit, and paid API preflight before paying for direct 402 metadata, Bazaar pricing, and no-spend fix steps.",
          payment: buildPaymentHint(config, {
            path: SITE_AUDIT_PATH,
            method: "GET",
            price: config.siteAuditPrice,
            maxAmountRequired: SITE_AUDIT_AMOUNT,
            buyerAction: "Pay $0.001 for a no-spend x402 listing SEO audit, listing rank doctor, seller growth checklist, metadata, pricing, and search visibility check."
          }),
          keywords: ["x402 site audit", "x402 site audit API", "x402 buyer prepay risk score", "score x402 endpoint before paying", "score endpoint before paying", "x402 service discoverability audit", "x402 listing SEO audit", "x402 listing rank doctor", "x402 seller growth checklist", "x402 seller intelligence", "x402 marketplace SEO audit", "paid API preflight", "x402 route health check", "x402 discovery audit", "bazaar search visibility", "x402 listing stale price"],
          input: buildSiteAuditDiscovery(config).input
        },
        {
          name: "agent402_route_visibility",
          method: "GET",
          path: AGENT402_ROUTE_VISIBILITY_PATH,
          url: absoluteUrl(config, AGENT402_ROUTE_VISIBILITY_PATH),
          price: config.siteAuditPrice,
          network: config.network,
          command: buildGetPayCommand(config, AGENT402_ROUTE_VISIBILITY_PATH, DISCOVERY_AUDIT_QUICK_AMOUNT),
          description: "one-tenth-cent GET exact Agent402 route visibility audit for Agent402 router ranking, stale Bazaar pricing, search visibility, route health, paid API preflight, and direct 402 metadata.",
          payment: buildPaymentHint(config, {
            path: AGENT402_ROUTE_VISIBILITY_PATH,
            method: "GET",
            price: config.siteAuditPrice,
            maxAmountRequired: DISCOVERY_AUDIT_QUICK_AMOUNT,
            buyerAction: "Pay $0.001 for an exact Agent402 route visibility audit before buying the full custom audit."
          }),
          keywords: ["Agent402 route visibility", "Agent402 router", "Agent402 routing", "x402 discovery audit", "x402 listing stale price", "bazaar search visibility", "paid API preflight", "x402 route health check"],
          input: buildAgent402RouteVisibilityDiscovery(config).input
        },
        {
          name: "x402_discovery_audit",
          method: "GET",
          path: DISCOVERY_AUDIT_PATH,
          url: absoluteUrl(config, DISCOVERY_AUDIT_PATH),
          price: config.siteAuditPrice,
          network: config.network,
          command: buildGetPayCommand(config, DISCOVERY_AUDIT_PATH, DISCOVERY_AUDIT_QUICK_AMOUNT),
          description: "one-tenth-cent GET x402 discovery audit on the exact audit path for stale Bazaar pricing, Agent402 route visibility, search visibility, route health, paid API preflight, and direct 402 metadata.",
          payment: buildPaymentHint(config, {
            path: DISCOVERY_AUDIT_PATH,
            method: "GET",
            price: config.siteAuditPrice,
            maxAmountRequired: DISCOVERY_AUDIT_QUICK_AMOUNT,
            buyerAction: "Pay $0.001 for the exact x402 discovery audit path before buying the full custom audit."
          }),
          keywords: ["x402 discovery audit", "x402 bazaar discovery audit", "Agent402 route visibility", "Agent402 router", "x402 listing stale price", "bazaar search visibility", "paid API preflight", "x402 route health check"],
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
          description: "Bazaar and Agent402 discovery audit for stale indexed pricing, missing search visibility, Agent402 route visibility, direct 402 metadata, and no-spend fix steps.",
          payment: buildPaymentHint(config, {
            path: DISCOVERY_AUDIT_PATH,
            method: "POST",
            price: config.discoveryAuditPrice,
            maxAmountRequired: DISCOVERY_AUDIT_AMOUNT,
            buyerAction: "Pay $0.01 for a custom-body discovery audit without making paid calls to the audited endpoint."
          }),
          keywords: ["x402 bazaar discovery audit", "Agent402 route visibility", "Agent402 router", "x402 listing stale price", "bazaar search visibility", "paid API listing"],
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
          description: "custom-body marketplace listing conversion API roast for paid API listing quality, agent service listing clarity, and buyer-agent skip reasons. JSON body is optional for stale directory cards; prefer GET /api/full-listing-roast for direct no-body checkout.",
          payment: buildPaymentHint(config, {
            path: ROAST_PATH,
            method: "POST",
            price: config.price,
            maxAmountRequired: "10000",
            buyerAction: "Pay $0.01 for a custom-body full listing roast; omitted bodies use safe defaults for stale directory cards. Prefer GET /api/full-listing-roast for direct no-body checkout."
          }),
          keywords: ["marketplace listing conversion API", "marketplace listing conversion", "paid API listing quality", "agent service listing clarity", "buyer-agent skip reasons", "buyer agent skip reasons", "agent-service listing score", "custom-body full roast", "stale directory card", "safe defaults"],
          input: requestExample
        }
      ]
    });
  });

  app.post([WELL_KNOWN_MCP_JSON_PATH, WELL_KNOWN_MCP_PATH, WELL_KNOWN_MCP_SERVER_PATH, WELL_KNOWN_MCP_SERVER_JSON_PATH, MCP_ROOT_PATH, MCP_JSON_PATH], async (request, response) => {
    await recordSignal("mcpViews");
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    const rpcResponse = buildMcpJsonRpcResponse(config, cashRegister, request.body);
    if (!rpcResponse) {
      setFreshDiscoveryHeaders(response).status(204).end();
      return;
    }

    const selectedActionKey = selectedActionKeyFromMcpResponse(rpcResponse);
    if (selectedActionKey) {
      await recordIntentSignal("mcp", selectedActionKey);
    }

    setFreshDiscoveryHeaders(response).json(rpcResponse);
  });

  app.get("/api/cash-register", async (_request, response) => {
    const cashRegister = await getCashRegister();
    const receiverWallet = await getReceiverBalanceSnapshot(config);
    response.json(buildPublicCashRegister(config, cashRegister, receiverWallet));
  });

  app.get(PAY_NOW_PATH, async (request, response) => {
    await recordSignal("payNowViews");
    const cashRegister = await getCashRegister();
    const receiverWallet = await getReceiverBalanceSnapshot(config);
    const payNow = buildPayNow(config, request.query.intent || request.query.q || request.query.query || request.query.task || "", cashRegister, receiverWallet);
    await recordIntentSignal("payNow", payNow.selectedActionKey);
    setFreshDiscoveryHeaders(response).json({
      ...payNow,
      intentSignal: buildIntentSignalNotice("payNow", payNow.selectedActionKey)
    });
  });

  app.get([PAID_USAGE_PROOF_PATH, ...PAID_USAGE_PROOF_ALIAS_PATHS], async (_request, response) => {
    await recordSignal("proofViews");
    const cashRegister = await getCashRegister();
    const receiverWallet = await getReceiverBalanceSnapshot(config);
    setFreshDiscoveryHeaders(response).json(buildPaidUsageProofResponse(config, cashRegister, receiverWallet));
  });

  app.get(PRICING_PATH, async (_request, response) => {
    await recordSignal("pricingViews");
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    setFreshDiscoveryHeaders(response).json(buildPricingCatalog(config, cashRegister));
  });

  app.get(FIND_PATH, async (request, response) => {
    await recordSignal("findViews");
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    const findResult = buildFindResult(config, request.query.q || request.query.query || request.query.task || "", cashRegister);
    await recordIntentSignal("find", findResult.selectedActionKey);
    setFreshDiscoveryHeaders(response).json({
      ...findResult,
      intentSignal: buildIntentSignalNotice("find", findResult.selectedActionKey)
    });
  });

  app.get(ROUTE_PATH, async (request, response) => {
    await recordSignal("routeViews");
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    const routeResult = buildRouteResult(config, request.query, cashRegister);
    await recordIntentSignal("route", routeResult.selectedActionKey);
    setFreshDiscoveryHeaders(response).json({
      ...routeResult,
      intentSignal: buildIntentSignalNotice("route", routeResult.selectedActionKey)
    });
  });

  app.post(ROUTE_PATH, async (request, response) => {
    await recordSignal("routeViews");
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    const routeResult = buildRouteResult(config, request.body || {}, cashRegister);
    await recordIntentSignal("route", routeResult.selectedActionKey);
    setFreshDiscoveryHeaders(response).json({
      ...routeResult,
      intentSignal: buildIntentSignalNotice("route", routeResult.selectedActionKey)
    });
  });

  app.get(LOCAL_DISCOVERY_RESOURCE_PATHS, async (request, response) => {
    await recordSignal("localDiscoveryViews");
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    setFreshDiscoveryHeaders(response).json(buildLocalDiscoveryResources(config, request.query, cashRegister));
  });

  app.get(LOCAL_DISCOVERY_SEARCH_PATHS, async (request, response) => {
    await recordSignal("localDiscoveryViews");
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
    const search = buildLocalDiscoverySearch(config, request.query, cashRegister);
    await recordIntentSignal("localDiscovery", search.selectedActionKey);
    setFreshDiscoveryHeaders(response).json({
      ...search,
      intentSignal: buildIntentSignalNotice("localDiscovery", search.selectedActionKey)
    });
  });

  app.get(LOCAL_DISCOVERY_MERCHANT_PATHS, async (request, response) => {
    await recordSignal("localDiscoveryViews");
    const cashRegister = await getCashRegisterWithReceiverWallet(config);
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
  app.use([INSTANT_SCORE_PATH, CONVERSION_SCORE_PATH, ...AGENT_LISTING_PAID_PATHS, ...QUICK_SCORE_PAID_PATHS, FULL_ROAST_GET_PATH, PING_PATH, ...SITE_AUDIT_PAID_PATHS, ...DISCOVERY_AUDIT_QUICK_PATHS, "/api/listing-score"], rejectHeadPaidRoute);
  app.post(ROOT_DIRECTORY_POST_PATH, recordDirectoryPostProbe);
  app.get([API_ENTRY_PATH, API_V1_ENTRY_PATH, V1_ENTRY_PATH], recordApiEntryProbe);
  app.get([INSTANT_SCORE_PATH, CONVERSION_SCORE_PATH, ...AGENT_LISTING_PAID_PATHS, ...QUICK_SCORE_PAID_PATHS, FULL_ROAST_GET_PATH], recordGetScoreProbe);
  app.get(PING_PATH, recordPingProbe);
  app.get([...SITE_AUDIT_PAID_PATHS, ...DISCOVERY_AUDIT_QUICK_PATHS], recordAuditProbe);
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

  app.get(AGENT_LISTING_PAID_PATHS, async (request, response) => {
    const result = buildAgentListingConversionScore(buildInstantScoreInput(request.query), config, { routePath: request.path });
    const cashRegister = await recordPaidCompletion("agentListingConversion", 0.001);
    response.json({ ...result, cashRegister });
  });

  app.get(QUICK_SCORE_PAID_PATHS, async (request, response) => {
    const result = buildIndexedRoastQuickScore(buildInstantScoreInput(request.query, {
      normalizeStaleIndexedDefaults: request.path === ROAST_PATH
    }), config);
    const cashRegister = await recordPaidCompletion("indexedRoastGet", 0.001);
    response.json({ ...result, cashRegister });
  });

  app.get(FULL_ROAST_GET_PATH, async (request, response) => {
    const result = buildListingRoast(buildInstantScoreInput(request.query));
    const cashRegister = await recordPaidCompletion("fullRoastGet", 0.01);
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

  app.get(DISCOVERY_AUDIT_QUICK_PATHS, async (request, response) => {
    const isAgent402RouteVisibility = request.path === AGENT402_ROUTE_VISIBILITY_PATH;
    const input = isAgent402RouteVisibility
      ? buildAgent402RouteVisibilityInput(config, request.query)
      : buildDiscoveryAuditInputFromQuery(request.query);
    const parsed = discoveryAuditRequestSchema.safeParse(input);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
      return;
    }

    const result = buildDiscoveryAuditQuickOutput(
      config,
      await buildX402DiscoveryAudit(parsed.data),
      isAgent402RouteVisibility
        ? {
          routePath: AGENT402_ROUTE_VISIBILITY_PATH,
          endpoint: "agent402-route-visibility-audit",
          mode: "agent402-route-visibility"
        }
        : {}
    );
    const cashRegister = await recordPaidCompletion("x402DiscoveryAuditQuick", 0.001);
    response.json({ ...result, cashRegister });
  });

  app.post(DISCOVERY_AUDIT_PATH, async (request, response) => {
    const parsed = discoveryAuditRequestSchema.safeParse(request.discoveryAuditInput ?? normalizeDiscoveryAuditRequestBody(request.body));
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
      return;
    }

    const result = await buildX402DiscoveryAudit(parsed.data);
    const cashRegister = await recordPaidCompletion("x402DiscoveryAudit", 0.01);
    response.json({ ...result, cashRegister });
  });

  app.post("/api/listing-score", async (request, response) => {
    const parsed = listingRoastRequestSchema.safeParse(request.listingRoastInput ?? normalizeListingRoastRequestBody(request.body));
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
      return;
    }

    const result = buildListingScoreWithUpgrade(parsed.data, config);
    const cashRegister = await recordPaidCompletion("listingScorePost", 0.005);
    response.json({ ...result, cashRegister });
  });

  app.post(ROAST_PATH, async (request, response) => {
    const parsed = listingRoastRequestSchema.safeParse(
      request.listingRoastInput
        ?? (isEmptyBody(request.body) ? buildFullRoastPostFallbackInput(config) : normalizeListingRoastRequestBody(request.body))
    );
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
