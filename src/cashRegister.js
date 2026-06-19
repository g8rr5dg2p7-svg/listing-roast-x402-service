import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SIGNAL_KEYS = new Set([
  "homepageViews",
  "builderViews",
  "builderCommandBuilds",
  "llmsViews",
  "openApiViews",
  "schemaViews",
  "sampleViews",
  "examplesViews",
  "mcpViews",
  "x402ManifestViews",
  "commandCopyClicks",
  "unpaidChallenges",
  "validUnpaidChallenges",
  "instantScoreValidUnpaidChallenges",
  "indexedRoastGetValidUnpaidChallenges",
  "pingValidUnpaidChallenges",
  "roastValidUnpaidChallenges",
  "scoreValidUnpaidChallenges",
  "discoveryAuditValidUnpaidChallenges",
  "emptyDiscoveryProbes",
  "invalidRequests"
]);

function getCashPath() {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dataDir, "cash-register.json");
}

function baselineNumber(name) {
  const value = Number(process.env[name] || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function baselineUsd(name) {
  const value = String(process.env[name] || "0").replace(/^\$/, "");
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function baselineMoney(name) {
  const value = baselineUsd(name);
  if (!value) {
    return "$0.00";
  }

  return `$${String(process.env[name]).replace(/^\$/, "")}`;
}

function initialCash() {
  const baselinePaidCompletions = baselineNumber("BASELINE_PAID_COMPLETIONS");
  const baselineGrossRevenue = baselineUsd("BASELINE_ESTIMATED_GROSS_REVENUE_USD");
  const baselineListingRoastCompletions = baselineNumber("BASELINE_LISTING_ROAST_COMPLETIONS");
  const baselineListingScoreCompletions = baselineNumber("BASELINE_LISTING_SCORE_COMPLETIONS");
  const baselineInstantScoreCompletions = baselineNumber("BASELINE_INSTANT_SCORE_COMPLETIONS");
  const baselineIndexedRoastGetCompletions = baselineNumber("BASELINE_INDEXED_ROAST_GET_COMPLETIONS");
  const baselineListingScorePostCompletions = baselineNumber("BASELINE_LISTING_SCORE_POST_COMPLETIONS");
  const baselinePingCompletions = baselineNumber("BASELINE_X402_PING_COMPLETIONS");
  const baselineSiteAuditCompletions = baselineNumber("BASELINE_X402_SITE_AUDIT_COMPLETIONS");
  const baselineDiscoveryAuditCompletions = baselineNumber("BASELINE_X402_DISCOVERY_AUDIT_COMPLETIONS");
  const baselineLastPaidAt = process.env.BASELINE_LAST_PAID_AT || null;

  return {
    paidCompletions: baselinePaidCompletions,
    estimatedGrossRevenueUsd: baselineGrossRevenue ? String(process.env.BASELINE_ESTIMATED_GROSS_REVENUE_USD).replace(/^\$/, "") : "0.00",
    listingRoastCompletions: baselineListingRoastCompletions,
    listingRoastEstimatedRevenueUsd: baselineMoney("BASELINE_LISTING_ROAST_REVENUE_USD"),
    listingScoreCompletions: baselineListingScoreCompletions,
    listingScoreEstimatedRevenueUsd: baselineMoney("BASELINE_LISTING_SCORE_REVENUE_USD"),
    instantScoreCompletions: baselineInstantScoreCompletions,
    instantScoreEstimatedRevenueUsd: baselineMoney("BASELINE_INSTANT_SCORE_REVENUE_USD"),
    indexedRoastGetCompletions: baselineIndexedRoastGetCompletions,
    indexedRoastGetEstimatedRevenueUsd: baselineMoney("BASELINE_INDEXED_ROAST_GET_REVENUE_USD"),
    listingScorePostCompletions: baselineListingScorePostCompletions,
    listingScorePostEstimatedRevenueUsd: baselineMoney("BASELINE_LISTING_SCORE_POST_REVENUE_USD"),
    x402PingCompletions: baselinePingCompletions,
    x402PingEstimatedRevenueUsd: baselineMoney("BASELINE_X402_PING_REVENUE_USD"),
    x402SiteAuditCompletions: baselineSiteAuditCompletions,
    x402SiteAuditEstimatedRevenueUsd: baselineMoney("BASELINE_X402_SITE_AUDIT_REVENUE_USD"),
    x402DiscoveryAuditCompletions: baselineDiscoveryAuditCompletions,
    x402DiscoveryAuditEstimatedRevenueUsd: baselineMoney("BASELINE_X402_DISCOVERY_AUDIT_REVENUE_USD"),
    lastPaidAt: baselineLastPaidAt,
    importedBaseline: baselinePaidCompletions > 0 ? {
      paidCompletions: baselinePaidCompletions,
      estimatedGrossRevenueUsd: baselineGrossRevenue ? String(process.env.BASELINE_ESTIMATED_GROSS_REVENUE_USD).replace(/^\$/, "") : "0.00",
      source: "env",
      lastPaidAt: baselineLastPaidAt
    } : null,
    firstSignalAt: null,
    lastSignalAt: null,
    signals: {
      homepageViews: 0,
      builderViews: 0,
      builderCommandBuilds: 0,
      llmsViews: 0,
      openApiViews: 0,
      schemaViews: 0,
      sampleViews: 0,
      examplesViews: 0,
      mcpViews: 0,
      x402ManifestViews: 0,
      commandCopyClicks: 0,
      unpaidChallenges: 0,
      validUnpaidChallenges: 0,
      instantScoreValidUnpaidChallenges: 0,
      indexedRoastGetValidUnpaidChallenges: 0,
      pingValidUnpaidChallenges: 0,
      roastValidUnpaidChallenges: 0,
      scoreValidUnpaidChallenges: 0,
      discoveryAuditValidUnpaidChallenges: 0,
      emptyDiscoveryProbes: 0,
      invalidRequests: 0
    }
  };
}

function normalizeCash(cash = {}) {
  const base = initialCash();
  const merged = {
    ...base,
    ...cash,
    signals: {
      ...base.signals,
      ...(cash.signals || {})
    }
  };

  const estimatedGrossRevenueUsd = Math.max(Number(base.estimatedGrossRevenueUsd || 0), Number(cash.estimatedGrossRevenueUsd || 0));
  const listingRoastRevenue = Math.max(Number(String(base.listingRoastEstimatedRevenueUsd || "$0").replace(/^\$/, "")), Number(String(cash.listingRoastEstimatedRevenueUsd || "$0").replace(/^\$/, "")));
  const listingScoreRevenue = Math.max(Number(String(base.listingScoreEstimatedRevenueUsd || "$0").replace(/^\$/, "")), Number(String(cash.listingScoreEstimatedRevenueUsd || "$0").replace(/^\$/, "")));
  const instantScoreRevenue = Math.max(Number(String(base.instantScoreEstimatedRevenueUsd || "$0").replace(/^\$/, "")), Number(String(cash.instantScoreEstimatedRevenueUsd || "$0").replace(/^\$/, "")));
  const indexedRoastGetRevenue = Math.max(Number(String(base.indexedRoastGetEstimatedRevenueUsd || "$0").replace(/^\$/, "")), Number(String(cash.indexedRoastGetEstimatedRevenueUsd || "$0").replace(/^\$/, "")));
  const listingScorePostRevenue = Math.max(Number(String(base.listingScorePostEstimatedRevenueUsd || "$0").replace(/^\$/, "")), Number(String(cash.listingScorePostEstimatedRevenueUsd || "$0").replace(/^\$/, "")));
  const pingRevenue = Math.max(Number(String(base.x402PingEstimatedRevenueUsd || "$0").replace(/^\$/, "")), Number(String(cash.x402PingEstimatedRevenueUsd || "$0").replace(/^\$/, "")));
  const siteAuditRevenue = Math.max(Number(String(base.x402SiteAuditEstimatedRevenueUsd || "$0").replace(/^\$/, "")), Number(String(cash.x402SiteAuditEstimatedRevenueUsd || "$0").replace(/^\$/, "")));
  const discoveryAuditRevenue = Math.max(Number(String(base.x402DiscoveryAuditEstimatedRevenueUsd || "$0").replace(/^\$/, "")), Number(String(cash.x402DiscoveryAuditEstimatedRevenueUsd || "$0").replace(/^\$/, "")));

  return {
    ...merged,
    paidCompletions: Math.max(Number(base.paidCompletions || 0), Number(cash.paidCompletions || 0)),
    estimatedGrossRevenueUsd: estimatedGrossRevenueUsd ? formatEstimatedUsd(estimatedGrossRevenueUsd) : "0.00",
    listingRoastCompletions: Math.max(Number(base.listingRoastCompletions || 0), Number(cash.listingRoastCompletions || 0)),
    listingRoastEstimatedRevenueUsd: `$${formatEstimatedUsd(listingRoastRevenue)}`,
    listingScoreCompletions: Math.max(Number(base.listingScoreCompletions || 0), Number(cash.listingScoreCompletions || 0)),
    listingScoreEstimatedRevenueUsd: `$${formatEstimatedUsd(listingScoreRevenue)}`,
    instantScoreCompletions: Math.max(Number(base.instantScoreCompletions || 0), Number(cash.instantScoreCompletions || 0)),
    instantScoreEstimatedRevenueUsd: `$${formatEstimatedUsd(instantScoreRevenue)}`,
    indexedRoastGetCompletions: Math.max(Number(base.indexedRoastGetCompletions || 0), Number(cash.indexedRoastGetCompletions || 0)),
    indexedRoastGetEstimatedRevenueUsd: `$${formatEstimatedUsd(indexedRoastGetRevenue)}`,
    listingScorePostCompletions: Math.max(Number(base.listingScorePostCompletions || 0), Number(cash.listingScorePostCompletions || 0)),
    listingScorePostEstimatedRevenueUsd: `$${formatEstimatedUsd(listingScorePostRevenue)}`,
    x402PingCompletions: Math.max(Number(base.x402PingCompletions || 0), Number(cash.x402PingCompletions || 0)),
    x402PingEstimatedRevenueUsd: `$${formatEstimatedUsd(pingRevenue)}`,
    x402SiteAuditCompletions: Math.max(Number(base.x402SiteAuditCompletions || 0), Number(cash.x402SiteAuditCompletions || 0)),
    x402SiteAuditEstimatedRevenueUsd: `$${formatEstimatedUsd(siteAuditRevenue)}`,
    x402DiscoveryAuditCompletions: Math.max(Number(base.x402DiscoveryAuditCompletions || 0), Number(cash.x402DiscoveryAuditCompletions || 0)),
    x402DiscoveryAuditEstimatedRevenueUsd: `$${formatEstimatedUsd(discoveryAuditRevenue)}`,
    lastPaidAt: cash.lastPaidAt || base.lastPaidAt
  };
}

let cashUpdateQueue = Promise.resolve();

async function readCash() {
  try {
    return normalizeCash(JSON.parse(await readFile(getCashPath(), "utf8")));
  } catch {
    return initialCash();
  }
}

async function writeCash(cash) {
  const cashPath = getCashPath();
  await mkdir(path.dirname(cashPath), { recursive: true });
  await writeFile(cashPath, `${JSON.stringify(cash, null, 2)}\n`);
}

async function updateCash(mutator) {
  const update = cashUpdateQueue.then(async () => {
    const cash = await readCash();
    const next = mutator(cash);
    await writeCash(next);
    return next;
  });

  cashUpdateQueue = update.catch(() => {});
  return update;
}

function formatEstimatedUsd(value) {
  const milliUsd = Math.round(value * 1000);
  if (milliUsd > 0 && milliUsd % 10 !== 0) {
    return (milliUsd / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  }

  return (Math.round(value * 100) / 100).toFixed(2);
}

export async function recordSignal(signalKey) {
  if (!SIGNAL_KEYS.has(signalKey)) {
    return readCash();
  }

  return updateCash((cash) => {
    const now = new Date().toISOString();
    return {
      ...cash,
      firstSignalAt: cash.firstSignalAt || now,
      lastSignalAt: now,
      signals: {
        ...cash.signals,
        [signalKey]: Number(cash.signals[signalKey] || 0) + 1
      }
    };
  });
}

export async function recordPaidCompletion(kind = "listingRoast", priceUsd = 1) {
  return updateCash((cash) => {
    const isInstantScore = kind === "instantScore";
    const isIndexedRoastGet = kind === "indexedRoastGet";
    const isListingScorePost = kind === "listingScorePost";
    const isScore = kind === "listingScore" || isInstantScore || isIndexedRoastGet || isListingScorePost;
    const isPing = kind === "x402Ping";
    const isSiteAudit = kind === "x402SiteAudit";
    const isDiscoveryAudit = kind === "x402DiscoveryAudit";
    const isDiscoveryAuditGroup = isSiteAudit || isDiscoveryAudit;
    const isRoast = !isScore && !isPing && !isDiscoveryAuditGroup;
    const listingRoastCompletions = Number(cash.listingRoastCompletions || 0) + (isRoast ? 1 : 0);
    const listingScoreCompletions = Number(cash.listingScoreCompletions || 0) + (isScore ? 1 : 0);
    const instantScoreCompletions = Number(cash.instantScoreCompletions || 0) + (isInstantScore ? 1 : 0);
    const indexedRoastGetCompletions = Number(cash.indexedRoastGetCompletions || 0) + (isIndexedRoastGet ? 1 : 0);
    const listingScorePostCompletions = Number(cash.listingScorePostCompletions || 0) + (isListingScorePost ? 1 : 0);
    const x402PingCompletions = Number(cash.x402PingCompletions || 0) + (isPing ? 1 : 0);
    const x402SiteAuditCompletions = Number(cash.x402SiteAuditCompletions || 0) + (isSiteAudit ? 1 : 0);
    const x402DiscoveryAuditCompletions = Number(cash.x402DiscoveryAuditCompletions || 0) + (isDiscoveryAuditGroup ? 1 : 0);
    const paidCompletions = Number(cash.paidCompletions || 0) + 1;
    const estimatedGrossRevenueUsd = Number(cash.estimatedGrossRevenueUsd || 0) + priceUsd;
    const roastRevenue = Number(String(cash.listingRoastEstimatedRevenueUsd || "$0").replace(/^\$/, "")) + (isScore || isPing || isDiscoveryAuditGroup ? 0 : priceUsd);
    const scoreRevenue = Number(String(cash.listingScoreEstimatedRevenueUsd || "$0").replace(/^\$/, "")) + (isScore ? priceUsd : 0);
    const instantScoreRevenue = Number(String(cash.instantScoreEstimatedRevenueUsd || "$0").replace(/^\$/, "")) + (isInstantScore ? priceUsd : 0);
    const indexedRoastGetRevenue = Number(String(cash.indexedRoastGetEstimatedRevenueUsd || "$0").replace(/^\$/, "")) + (isIndexedRoastGet ? priceUsd : 0);
    const listingScorePostRevenue = Number(String(cash.listingScorePostEstimatedRevenueUsd || "$0").replace(/^\$/, "")) + (isListingScorePost ? priceUsd : 0);
    const pingRevenue = Number(String(cash.x402PingEstimatedRevenueUsd || "$0").replace(/^\$/, "")) + (isPing ? priceUsd : 0);
    const siteAuditRevenue = Number(String(cash.x402SiteAuditEstimatedRevenueUsd || "$0").replace(/^\$/, "")) + (isSiteAudit ? priceUsd : 0);
    const discoveryAuditRevenue = Number(String(cash.x402DiscoveryAuditEstimatedRevenueUsd || "$0").replace(/^\$/, "")) + (isDiscoveryAuditGroup ? priceUsd : 0);
    const now = new Date().toISOString();
    return {
      ...cash,
      paidCompletions,
      estimatedGrossRevenueUsd: formatEstimatedUsd(estimatedGrossRevenueUsd),
      listingRoastCompletions,
      listingRoastEstimatedRevenueUsd: `$${formatEstimatedUsd(roastRevenue)}`,
      listingScoreCompletions,
      listingScoreEstimatedRevenueUsd: `$${formatEstimatedUsd(scoreRevenue)}`,
      instantScoreCompletions,
      instantScoreEstimatedRevenueUsd: `$${formatEstimatedUsd(instantScoreRevenue)}`,
      indexedRoastGetCompletions,
      indexedRoastGetEstimatedRevenueUsd: `$${formatEstimatedUsd(indexedRoastGetRevenue)}`,
      listingScorePostCompletions,
      listingScorePostEstimatedRevenueUsd: `$${formatEstimatedUsd(listingScorePostRevenue)}`,
      x402PingCompletions,
      x402PingEstimatedRevenueUsd: `$${formatEstimatedUsd(pingRevenue)}`,
      x402SiteAuditCompletions,
      x402SiteAuditEstimatedRevenueUsd: `$${formatEstimatedUsd(siteAuditRevenue)}`,
      x402DiscoveryAuditCompletions,
      x402DiscoveryAuditEstimatedRevenueUsd: `$${formatEstimatedUsd(discoveryAuditRevenue)}`,
      firstSignalAt: cash.firstSignalAt || now,
      lastSignalAt: now,
      lastPaidAt: now
    };
  });
}

export async function getCashRegister() {
  return readCash();
}
